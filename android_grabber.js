// ============================================================================
// android_grabber.js  —  v2.2 (Termux)
// Same save locations / lock file / file names as v1. See the notes in chat.
//
// Usage: node android_grabber.js [flags]
//   --debug     verbose console output, periodic screenshots, live view (see below)
//   --live      live view only: open http://127.0.0.1:8787 in your phone browser
//   --no-live   turn the live view off even when --debug is on
//   --headed    real browser window on an X11 display (termux-x11; needs DISPLAY)
//   --trace     record a Playwright trace to debug/trace.zip (open at trace.playwright.dev)
//   --help      show this list
// Env: GRABBER_DEBUG=1 (same as --debug), LIVE_PORT=8787
// A log file is ALWAYS written to logs/run-<time>.log (last 10 runs are kept).
// ============================================================================

// Termux reports process.platform as 'android'; Playwright only knows 'linux'.
try { Object.defineProperty(process, 'platform', { value: 'linux' }); } catch (_) {}

const fs = require('fs');
const path = require('path');
const http = require('http');
const util = require('util');
const { pipeline } = require('stream/promises');

// ============================================================================
// COMMAND-LINE FLAGS
// ============================================================================
const ARGS = new Set(process.argv.slice(2));
if (ARGS.has('--help') || ARGS.has('-h')) {
    console.log(`Usage: node android_grabber.js [flags]
  --debug     verbose console + file logs, screenshots, live view at http://127.0.0.1:8787
  --live      live view only (browser screenshot + status in your phone browser)
  --no-live   disable the live view even with --debug
  --headed    show a real browser window on an X11 display (termux-x11)
  --trace     record a Playwright trace to debug/trace.zip
Env: GRABBER_DEBUG=1, LIVE_PORT=8787`);
    process.exit(0);
}
const DEBUG  = ARGS.has('--debug') || process.env.GRABBER_DEBUG === '1';
const HEADED = ARGS.has('--headed');
const TRACE  = ARGS.has('--trace');
const LIVE_PORT = ARGS.has('--no-live') ? 0 : (DEBUG || ARGS.has('--live')) ? (Number(process.env.LIVE_PORT) || 8787) : 0;
const LIVE_SHOT_INTERVAL_MS = 2000;

// ============================================================================
// PATHS  (unchanged from v1 — your app depends on these)
// ============================================================================
const CHROMIUM_PATH      = '/data/data/com.termux/files/usr/bin/chromium-browser';
const COOKIES_FILE       = path.join(__dirname, 'cookies.json');
const HISTORY_FILE       = path.join(__dirname, 'history.json');
const QUEUE_BACKLOG_FILE = path.join(__dirname, 'queue_backlog.json');
const PID_FILE           = path.join(__dirname, 'grabber.pid');
const DOWNLOAD_FOLDER    = '/storage/emulated/0/.Reels';
const LOCK_FILE_PATH     = path.join(DOWNLOAD_FOLDER, 'download.lock');
const LIKES_FILE         = path.join(DOWNLOAD_FOLDER, 'pending_likes.json');

// ============================================================================
// TUNABLES
// ============================================================================
const TARGET_DOWNLOAD_COUNT   = 200;     // reels to save per run
const MAX_HISTORY_SIZE        = 15000;
const MAX_CONCURRENT_DOWNLOADS = 3;
const MAX_ATTEMPTS_PER_REEL   = 3;
const MAX_LIKES_PER_RUN       = 30;      // extra likes stay in pending_likes.json for next run
const MAX_SESSION_MINUTES     = 90;      // hard stop for one run
const MAX_SWIPES_WITHOUT_SAVE = 150;     // feed only shows already-saved reels -> stop
const FEED_IDLE_RELOAD_MS     = 30000;   // no new reels from the feed for this long -> reload feed
const MAX_FEED_RELOADS_IN_ROW = 3;       // reload this many times without result -> stop
const DOWNLOAD_IDLE_TIMEOUT_MS = 30000;  // abort a download that stops receiving bytes
const BACKLOG_PAUSE_AT        = 20;      // stop swiping while queue is longer than this...
const BACKLOG_RESUME_AT       = 6;       // ...until it drains to this

// ============================================================================
// SMALL HELPERS
// ============================================================================
const sleep   = (ms) => new Promise((r) => setTimeout(r, ms));
const rand    = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));

// ============================================================================
// LOGGING — console + logs/run-<time>.log (the file always gets everything,
// including DEBUG lines; the console only shows DEBUG lines with --debug)
// ============================================================================
const LOG_DIR   = path.join(__dirname, 'logs');
const DEBUG_DIR = path.join(__dirname, 'debug');
const startedAt = Date.now();
const recentLines = [];
let logStream = null;
let logFile = '(file logging unavailable)';
try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const old = fs.readdirSync(LOG_DIR).filter((f) => /^run-.*\.log$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - 9)).forEach((f) => safeUnlink(path.join(LOG_DIR, f)));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    logFile = path.join(LOG_DIR, `run-${stamp}.log`);
    logStream = fs.createWriteStream(logFile, { flags: 'a' });
    logStream.on('error', () => { logStream = null; });
} catch (_) {}

function fmtArgs(args) {
    return args.map((a) => typeof a === 'string' ? a
        : a instanceof Error ? (a.stack || a.message)
        : util.inspect(a, { depth: 3, breakLength: 160 })).join(' ');
}
function emit(level, args) {
    const msg = fmtArgs(args);
    const now = new Date();
    const hms = now.toTimeString().slice(0, 8);
    let tag = level;
    if (level === 'INFO') {
        if (/^\s*(❌|💥|⛔)/.test(msg)) tag = 'ERROR';
        else if (/^\s*⚠️/.test(msg)) tag = 'WARN';
    }
    if (logStream) logStream.write(`${now.toISOString()} ${tag.padEnd(5)} ${msg}\n`);
    const line = level === 'DEBUG' ? `[${hms}] 🔍 ${msg}` : `[${hms}] ${msg}`;
    recentLines.push(line);
    if (recentLines.length > 60) recentLines.shift();
    if (level !== 'DEBUG' || DEBUG) console.log(line);
}
const log = (...a) => emit('INFO', a);
const dbg = (...a) => emit('DEBUG', a);

function safeUnlink(p) { try { fs.unlinkSync(p); } catch (_) {} }

// Write to a temp file then rename, so a crash can never leave half a JSON file.
function writeFileAtomic(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, file);
}

function readJsonSafe(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

// ============================================================================
// STATE
// ============================================================================
let USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

let browser = null;
let stopping = false;
let shuttingDown = false;

let downloadQueue = [];          // tasks waiting
const inFlight = new Map();      // id -> task currently downloading
const seenIds = new Set();       // queued / in flight / saved during this run (prevents duplicates)
const feedSeen = new Set();      // every reel id the feed has shown us this run
let downloadCount = 0;
let lastFeedActivity = Date.now();
let swipesSinceSave = 0;
let lockHeld = false;
let pumpTimer = null;
let context = null;
let activePage = null;
let lastShot = null;
let snapSeq = 0;
let liveServer = null;
const knownCodes = new Set();     // reel shortcodes whose data we have (saved, queued, or already in history)
const visitedCodes = new Set();   // reel shortcodes the browser has actually shown (from the URL)
let fallbackFails = 0;
let fallbackDisabled = false;
let samplesSaved = 0;
const stats = {
    swipes: 0, queued: 0, skippedHistory: 0, skippedDuplicate: 0, skippedTarget: 0,
    expired: 0, failed: 0, bytes: 0, apiResponses: 0, apiParseErrors: 0, reloads: 0, fallbackCalls: 0, fallbackFail: 0,
};

// ---- history -------------------------------------------------------------
let historyList = [];
if (fs.existsSync(HISTORY_FILE)) {
    try {
        const h = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        if (!Array.isArray(h)) throw new Error('history.json is not an array');
        historyList = h.map(String);
        log(`📦 Loaded ${historyList.length} historical Reel IDs from history.json`);
    } catch (e) {
        try { fs.copyFileSync(HISTORY_FILE, HISTORY_FILE + '.corrupt'); } catch (_) {}
        log(`⚠️ history.json unreadable (${e.message}). Backed up to history.json.corrupt and starting fresh.`);
        historyList = [];
    }
}
const historySet = new Set(historyList);
let historyDirty = false;

function addToHistory(id) {
    if (historySet.has(id)) return;
    historySet.add(id);
    historyList.push(id);
    if (historyList.length > MAX_HISTORY_SIZE) {
        const removed = historyList.splice(0, historyList.length - MAX_HISTORY_SIZE);
        removed.forEach((r) => historySet.delete(r));
        log(`🧹 History limit reached. Purged ${removed.length} oldest entries.`);
    }
    historyDirty = true;
}

function flushHistory() {
    if (!historyDirty) return;
    try { writeFileAtomic(HISTORY_FILE, JSON.stringify(historyList, null, 2)); historyDirty = false; }
    catch (e) { log('⚠️ Could not write history.json:', e.message); }
}
setInterval(flushHistory, 3000).unref();

// ---- lock file (same path + content as v1) ---------------------------------
function syncLock() {
    const busy = inFlight.size > 0 || downloadQueue.length > 0;
    try {
        if (busy && !lockHeld) { fs.writeFileSync(LOCK_FILE_PATH, 'ACTIVE', 'utf8'); lockHeld = true; }
        else if (!busy && lockHeld) { fs.unlinkSync(LOCK_FILE_PATH); lockHeld = false; }
    } catch (_) {}
}
function removeLock() { safeUnlink(LOCK_FILE_PATH); lockHeld = false; }

// ---- backlog ---------------------------------------------------------------
function persistBacklog() {
    const pending = [...inFlight.values(), ...downloadQueue];
    try {
        if (pending.length) {
            writeFileAtomic(QUEUE_BACKLOG_FILE, JSON.stringify(pending));
            log(`💾 Saved ${pending.length} unfinished item(s) to queue_backlog.json`);
        } else if (fs.existsSync(QUEUE_BACKLOG_FILE)) {
            fs.unlinkSync(QUEUE_BACKLOG_FILE);
        }
    } catch (e) { log('⚠️ Could not save backlog:', e.message); }
}

// ============================================================================
// DEBUG TOOLS: screenshots, live view, page diagnostics, summaries
// ============================================================================
const mb = (n) => (n / 1048576).toFixed(1);

function logSummary() {
    const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
    log(`📊 Summary: ${downloadCount} saved (${mb(stats.bytes)} MB) · ${stats.swipes} swipes · ${mins} min`);
    log(`   queued ${stats.queued} · skipped: history ${stats.skippedHistory}, duplicate ${stats.skippedDuplicate}, over-target ${stats.skippedTarget} · expired ${stats.expired} · failed ${stats.failed}`);
    log(`   Instagram API bodies read ${stats.apiResponses} (errors ${stats.apiParseErrors}) · reels visited ${visitedCodes.size}, data captured ${knownCodes.size} · URL lookups ${stats.fallbackCalls} (failed ${stats.fallbackFail}) · feed reloads ${stats.reloads}`);
    log(`   log file: ${logFile}`);
}

async function takeShot(quality = 55) {
    if (!activePage) return null;
    try { return await activePage.screenshot({ type: 'jpeg', quality, timeout: 5000 }); }
    catch (e) { dbg(`screenshot failed: ${e.message}`); return null; }
}

// Saved to ./debug (newest 40 kept). Taken automatically on problems, and every
// 10 swipes in --debug mode.
async function snap(label) {
    const buf = await takeShot();
    if (!buf) return;
    lastShot = buf;
    try {
        fs.mkdirSync(DEBUG_DIR, { recursive: true });
        const name = `${Math.floor(Date.now() / 1000)}-${String(++snapSeq).padStart(3, '0')}-${label.replace(/[^a-z0-9_-]/gi, '_')}.jpg`;
        fs.writeFileSync(path.join(DEBUG_DIR, name), buf);
        const files = fs.readdirSync(DEBUG_DIR).filter((f) => f.endsWith('.jpg')).sort();
        files.slice(0, Math.max(0, files.length - 40)).forEach((f) => safeUnlink(path.join(DEBUG_DIR, f)));
        log(`📸 Screenshot: debug/${name}`);
    } catch (e) { dbg(`could not save screenshot: ${e.message}`); }
}

function getStatus() {
    return {
        running: `${Math.round((Date.now() - startedAt) / 1000)}s`,
        url: activePage ? activePage.url().slice(0, 100) : '',
        saved: `${downloadCount}/${TARGET_DOWNLOAD_COUNT}`,
        queue: downloadQueue.length,
        downloading: inFlight.size,
        swipes: stats.swipes,
        reelsSeen: feedSeen.size,
        secondsSinceNewReel: Math.round((Date.now() - lastFeedActivity) / 1000),
        lockFile: lockHeld ? 'ACTIVE' : 'none',
        log: recentLines.slice(-25),
    };
}

const LIVE_HTML = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Grabber live</title>
<style>body{margin:0;background:#111;color:#ddd;font:12px monospace}img{width:100%;max-width:420px;display:block;margin:auto;background:#000}pre{white-space:pre-wrap;padding:8px;margin:0}</style>
<img id=s><pre id=t>connecting...</pre>
<script>
const img=document.getElementById('s'),t=document.getElementById('t');
function shot(){img.onload=img.onerror=()=>setTimeout(shot,1200);img.src='/shot.jpg?'+Date.now()}
async function st(){try{const j=await(await fetch('/status')).json();t.textContent=Object.entries(j).filter(([k])=>k!=='log').map(([k,v])=>k+': '+v).join('\\n')+'\\n\\n'+j.log.join('\\n')}catch(e){}setTimeout(st,1500)}
shot();st();
</script>`;

// Local-only (127.0.0.1) page showing what the headless browser sees right now.
function startLiveView() {
    if (!LIVE_PORT) return;
    liveServer = http.createServer((req, res) => {
        if (req.url.startsWith('/shot.jpg')) {
            if (!lastShot) { res.writeHead(204); return res.end(); }
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
            return res.end(lastShot);
        }
        if (req.url.startsWith('/status')) {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify(getStatus()));
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(LIVE_HTML);
    });
    liveServer.on('error', (e) => { log(`⚠️ Live view could not start on port ${LIVE_PORT}: ${e.message}`); liveServer = null; });
    liveServer.listen(LIVE_PORT, '127.0.0.1', () => log(`👁️ Live view: open http://127.0.0.1:${LIVE_PORT} in your phone's browser`));

    let busy = false;
    setInterval(async () => {
        if (busy || shuttingDown) return;
        busy = true;
        const b = await takeShot(50);
        if (b) lastShot = b;
        busy = false;
    }, LIVE_SHOT_INTERVAL_MS).unref();
}

function attachPageDiagnostics(page) {
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) log(`🧭 Navigated: ${f.url().slice(0, 120)}`); });
    page.on('crash', () => log('💥 Browser tab crashed (probably out of memory).'));
    page.on('pageerror', (e) => { if (DEBUG) dbg(`page error: ${e.message}`); });
    page.on('console', (m) => { if (DEBUG && (m.type() === 'error' || m.type() === 'warning')) dbg(`console.${m.type()}: ${m.text().slice(0, 200)}`); });
    page.on('requestfailed', (r) => { if (DEBUG) dbg(`request failed (${(r.failure() || {}).errorText}): ${r.url().slice(0, 100)}`); });
    page.on('response', (r) => {
        const st = r.status();
        if (st >= 400 && /instagram\.com|cdninstagram|fbcdn/.test(r.url())) dbg(`HTTP ${st} ${r.request().resourceType()}: ${r.url().slice(0, 110)}`);
    });
}

// ============================================================================
// SHUTDOWN (Ctrl+C, kill, crash, or normal finish all go through here)
// ============================================================================
async function shutdown(reason, code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    stopping = true;
    log(`🛑 Shutting down (${reason})...`);
    try {
        persistBacklog();
        flushHistory();
        for (const id of inFlight.keys()) safeUnlink(path.join(DOWNLOAD_FOLDER, `reel_${id}.mp4.part`));
        removeLock();
        safeUnlink(PID_FILE);
        logSummary();
        if (liveServer) { try { liveServer.close(); } catch (_) {} }
        if (TRACE && context) {
            try {
                fs.mkdirSync(DEBUG_DIR, { recursive: true });
                await Promise.race([context.tracing.stop({ path: path.join(DEBUG_DIR, 'trace.zip') }).catch(() => {}), sleep(20000)]);
                log('🧵 Trace saved: debug/trace.zip (open it at https://trace.playwright.dev on any device)');
            } catch (_) {}
        }
        if (browser) await Promise.race([browser.close().catch(() => {}), sleep(4000)]);
    } catch (e) { log('⚠️ Cleanup problem:', e.message); }
    process.exit(code);
}

process.on('SIGINT',  () => shutdown('Ctrl+C', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGHUP',  () => shutdown('terminal closed', 0));
process.on('uncaughtException', async (e) => { log('💥 Fatal:', e && e.stack || e); await snap('fatal').catch(() => {}); shutdown('uncaught exception', 1); });
process.on('unhandledRejection', (r) => { log('⚠️ Unhandled rejection:', (r && r.message) || r); });

// ============================================================================
// DOWNLOAD WORKERS
// ============================================================================
function cleanupSidecars(id) {
    for (const suffix of ['.jpg', '_song.jpg', '_metadata.json']) {
        safeUnlink(path.join(DOWNLOAD_FOLDER, `reel_${id}${suffix}`));
    }
    safeUnlink(path.join(DOWNLOAD_FOLDER, `reel_${id}.mp4.part`));
}

async function downloadToFile(axios, url, dest) {
    const res = await axios({
        method: 'GET', url, responseType: 'stream', timeout: 20000,
        headers: { 'User-Agent': USER_AGENT, 'Accept': '*/*' },
    });
    const expected = Number(res.headers['content-length']) || 0;

    // axios' timeout only covers the response headers; this kills stalled bodies.
    let idle;
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => res.data.destroy(new Error('download stalled')), DOWNLOAD_IDLE_TIMEOUT_MS); };
    arm();
    res.data.on('data', arm);
    try { await pipeline(res.data, fs.createWriteStream(dest)); }
    finally { clearTimeout(idle); }

    const size = fs.statSync(dest).size;
    if (size === 0) throw new Error('empty file');
    if (expected && size !== expected) throw new Error(`truncated (${size}/${expected} bytes)`);
    return size;
}

async function downloadSmall(axios, url, dest) {
    const res = await axios({
        method: 'GET', url, responseType: 'arraybuffer', timeout: 10000,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
    });
    fs.writeFileSync(dest, res.data);
}

// Order matters for your app: video goes to *.mp4.part first, then pfp / song /
// metadata are written, and the .mp4 appears LAST via an atomic rename. So when
// reel_<id>.mp4 exists, everything that belongs to it is already there.
async function executeDownload(task) {
    const axios = require('axios');
    const id = String(task.id);
    const filePath     = path.join(DOWNLOAD_FOLDER, `reel_${id}.mp4`);
    const partPath     = filePath + '.part';
    const pfpPath      = path.join(DOWNLOAD_FOLDER, `reel_${id}.jpg`);
    const songPath     = path.join(DOWNLOAD_FOLDER, `reel_${id}_song.jpg`);
    const metadataPath = path.join(DOWNLOAD_FOLDER, `reel_${id}_metadata.json`);

    if (fs.existsSync(filePath)) { addToHistory(id); return 'EXISTS'; }

    const t0 = Date.now();
    let bytes = 0;
    try {
        dbg(`↓ ${id} start from ${new URL(task.url).host} (attempt ${task.attempts})`);
        bytes = await downloadToFile(axios, task.url, partPath);
    } catch (err) {
        safeUnlink(partPath);
        const status = err.response && err.response.status;
        if (status === 403 || status === 404 || status === 410) { dbg(`↓ ${id} HTTP ${status}`); return 'EXPIRED'; }
        log(`   ↳ ${id}: ${err.message}${err.code ? ' [' + err.code + ']' : ''} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        return 'RETRY';
    }

    if (task.pfpUrl) {
        try { await downloadSmall(axios, task.pfpUrl, pfpPath); }
        catch (e) { log(`   ⚠️ Profile pic skipped for ${id}: ${e.message}`); }
    }
    if (task.songImgUrl) {
        try { await downloadSmall(axios, task.songImgUrl, songPath); }
        catch (e) { log(`   ⚠️ Song art skipped for ${id}: ${e.message}`); }
    }
    if (task.rawMetadata) {
        try { fs.writeFileSync(metadataPath, JSON.stringify(task.rawMetadata, null, 2), 'utf8'); } catch (_) {}
    }

    try { fs.renameSync(partPath, filePath); }
    catch (e) { safeUnlink(partPath); log(`   ↳ ${id}: rename failed (${e.message})`); return 'RETRY'; }
    task.stat = { bytes, ms: Date.now() - t0 };
    stats.bytes += bytes;
    dbg(`↓ ${id} saved ${mb(bytes)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s (pfp: ${task.pfpUrl ? 'yes' : 'no'}, song art: ${task.songImgUrl ? 'yes' : 'no'})`);
    return 'SAVED';
}

function startTask(task) {
    const id = String(task.id);
    task.attempts = (task.attempts || 0) + 1;
    delete task.retryAt;
    inFlight.set(id, task);
    syncLock();

    executeDownload(task)
        .catch((err) => { log(`   ↳ ${id}: unexpected error ${err.message}`); return 'RETRY'; })
        .then((status) => {
            inFlight.delete(id);
            if (status === 'SAVED') {
                downloadCount++;
                swipesSinceSave = 0;
                addToHistory(id);
                const st = task.stat || {};
                log(` ✅ [SAVED] ${downloadCount}/${TARGET_DOWNLOAD_COUNT} ${id} · @${task.username || '?'} · ${mb(st.bytes || 0)} MB in ${((st.ms || 0) / 1000).toFixed(1)}s  (queue: ${downloadQueue.length}, active: ${inFlight.size})`);
            } else if (status === 'EXISTS') {
                log(` ℹ️ [SKIP] ${id} already on disk.`);
            } else if (status === 'EXPIRED') {
                log(` ❌ [EXPIRED] ${id} link expired/denied. Dropped (a fresh link from the feed may re-queue it).`);
                seenIds.delete(id);
                stats.expired++;
            } else if (task.attempts >= MAX_ATTEMPTS_PER_REEL) {
                log(` ❌ [GAVE UP] ${id} failed ${task.attempts} times.`);
                stats.failed++;
                cleanupSidecars(id);
            } else {
                task.retryAt = Date.now() + 1500 * task.attempts;
                downloadQueue.push(task);
                log(` ♻️ [RETRY] ${id} (attempt ${task.attempts}/${MAX_ATTEMPTS_PER_REEL})`);
            }
            pump();
        });
}

function pump() {
    if (stopping) return;
    while (inFlight.size < MAX_CONCURRENT_DOWNLOADS && downloadCount + inFlight.size < TARGET_DOWNLOAD_COUNT) {
        const now = Date.now();
        const idx = downloadQueue.findIndex((t) => !t.retryAt || t.retryAt <= now);
        if (idx === -1) break;
        startTask(downloadQueue.splice(idx, 1)[0]);
    }
    syncLock();
    // something is waiting for its retry time -> look again shortly
    if (downloadQueue.length && !pumpTimer && downloadCount + inFlight.size < TARGET_DOWNLOAD_COUNT) {
        pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, 500);
    }
}

// ============================================================================
// FEED INTERCEPTION
// ============================================================================
function findVideoItems(root) {
    const found = [];
    const stack = [{ node: root, depth: 0 }];
    while (stack.length) {
        const { node, depth } = stack.pop();
        if (!node || typeof node !== 'object' || depth > 14) continue;

        if (Array.isArray(node.video_versions) && node.video_versions.length > 0) {
            const rawId = node.id != null ? node.id : node.pk;
            if (rawId == null) continue;                       // no stable id -> can't dedupe, skip
            const best = node.video_versions.reduce((m, v) =>
                ((v.width || 0) * (v.height || 0) > (m.width || 0) * (m.height || 0) ? v : m), node.video_versions[0]);
            if (!best || !best.url) continue;

            const user = node.user || node.owner || {};
            const music = (node.clips_metadata && node.clips_metadata.music_info && node.clips_metadata.music_info.music_asset_info)
                || (node.music_info && node.music_info.music_asset_info) || {};
            found.push({
                id: String(rawId),
                code: node.code || '',
                url: best.url,
                caption: (node.caption && node.caption.text) || '',
                username: user.username || 'Instagram User',
                pfpUrl: user.profile_pic_url || '',
                songImgUrl: music.cover_artwork_uri || music.cover_artwork_thumbnail_uri || '',
                rawMetadata: node,
            });
            continue;                                          // don't dig into the reel we just captured
        }
        for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push({ node: v, depth: depth + 1 });
    }
    return found.reverse();
}

function registerFeedItems(json, source) {
    const items = findVideoItems(json);
    let fresh = 0;
    for (const t of items) {
        if (t.code) knownCodes.add(t.code);
        if (!feedSeen.has(t.id)) { feedSeen.add(t.id); lastFeedActivity = Date.now(); }
        if (historySet.has(t.id)) { stats.skippedHistory++; continue; }
        if (seenIds.has(t.id)) { stats.skippedDuplicate++; continue; }
        if (downloadCount + inFlight.size + downloadQueue.length >= TARGET_DOWNLOAD_COUNT) { stats.skippedTarget++; continue; }
        seenIds.add(t.id);
        downloadQueue.push(t);
        stats.queued++; fresh++;
        log(`[QUEUE] New reel ${t.id} · @${t.username}`);
    }
    dbg(`API ${source}: ${items.length} reel(s) in response, ${fresh} new`);
    pump();
    return items.length;
}

// ============================================================================
// COOKIES (accepts Playwright format AND browser-extension exports)
// ============================================================================
function loadCookies() {
    if (!fs.existsSync(COOKIES_FILE)) throw new Error('cookies.json is missing next to the script.');
    const raw = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.cookies;
    if (!Array.isArray(list) || !list.length) throw new Error('cookies.json has no cookies in it.');

    const sameSiteMap = { no_restriction: 'None', none: 'None', lax: 'Lax', strict: 'Strict', unspecified: 'Lax' };
    return list.filter((c) => c && c.name && c.value !== undefined).map((c) => {
        const out = {
            name: c.name,
            value: String(c.value),
            domain: c.domain || '.instagram.com',
            path: c.path || '/',
            secure: c.secure !== false,
            httpOnly: !!c.httpOnly,
            sameSite: sameSiteMap[String(c.sameSite || '').toLowerCase()] || 'Lax',
        };
        const exp = c.expires != null ? c.expires : c.expirationDate;
        if (typeof exp === 'number' && exp > 0) out.expires = Math.floor(exp);
        return out;
    });
}

// ============================================================================
// PAGE HELPERS
// ============================================================================
async function dismissPopups(page) {
    try {
        const notNow = page.getByText(/^not now$/i).first();
        if (await notNow.isVisible()) {
            log('   ↳ Dismissing "Not now" popup');
            await notNow.click({ timeout: 3000 }).catch(() => {});
            await sleep(800);
        }
    } catch (_) {}
}

// Returns a reason string if Instagram is asking for login / challenge / slowing us down.
async function detectBlock(page) {
    try {
        const url = page.url();
        if (/\/accounts\/login|\/challenge|\/accounts\/suspended|\/accounts\/disabled|\/accounts\/onetap/.test(url)) {
            return `redirected to ${new URL(url).pathname}`;
        }
        const text = ((await page.evaluate(() => (document.body && document.body.innerText) || '').catch(() => '')) || '').toLowerCase();
        if (/try again later|action blocked|we restrict certain activity|confirm it'?s you/.test(text)) {
            return 'Instagram showed a restriction / verification message';
        }
    } catch (_) {}
    return null;
}

// Real touch swipe through Chrome DevTools (trusted input), with fallbacks.
let cdp = null;
let cdpBroken = false;
async function swipeToNextReel(page) {
    if (cdp && !cdpBroken) {
        try {
            await cdp.send('Input.synthesizeScrollGesture', {
                x: Math.round(195 + rand(-20, 20)),
                y: Math.round(640 + rand(-30, 30)),
                yDistance: -Math.round(rand(380, 520)),   // negative = finger moves up = next reel
                speed: Math.round(rand(900, 1600)),
                gestureSourceType: 'touch',
            });
            return 'touch';
        } catch (e) { cdpBroken = true; log(`   ⚠️ Touch gesture unavailable (${e.message}); using wheel scroll.`); }
    }
    try { await page.mouse.move(195, 500); await page.mouse.wheel(0, Math.round(rand(700, 900))); return 'wheel'; } catch (_) {}
    try { await page.evaluate(() => window.scrollBy(0, window.innerHeight)); } catch (_) {}
    return 'scrollBy';
}

// ============================================================================
// LIKES (from the player app)
// ============================================================================
function idToShortcode(id) {
    const s = String(id).trim();
    if (!/^\d+(_\d+)?$/.test(s)) return s;                 // already a shortcode
    let num = BigInt(s.split('_')[0]);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let code = '';
    while (num > 0n) { code = alphabet[Number(num % 64n)] + code; num /= 64n; }
    return code;
}

// 'ALREADY' | 'LIKED' | 'UNAVAILABLE' | 'FAILED'   (English UI labels, like v1)
async function likeCurrentReel(page) {
    const unlike = page.locator('svg[aria-label="Unlike"]').first();
    const like = page.locator('svg[aria-label="Like"]').first();

    if (await unlike.isVisible().catch(() => false)) return 'ALREADY';
    await like.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
    if (!(await like.isVisible().catch(() => false))) {
        return (await unlike.isVisible().catch(() => false)) ? 'ALREADY' : 'UNAVAILABLE';
    }

    for (let attempt = 0; attempt < 2; attempt++) {
        await like.scrollIntoViewIfNeeded().catch(() => {});
        const box = await like.boundingBox().catch(() => null);
        if (!box) break;
        await page.touchscreen.tap(box.x + box.width / 2 + rand(-3, 3), box.y + box.height / 2 + rand(-3, 3));
        await sleep(1500);
        if (await unlike.isVisible().catch(() => false)) return 'LIKED';    // verified: icon flipped
    }
    return 'FAILED';
}

async function processPendingLikes(page) {
    if (!fs.existsSync(LIKES_FILE)) return;
    const pending = readJsonSafe(LIKES_FILE, null);
    if (!Array.isArray(pending) || pending.length === 0) return;

    const todo = [...new Set(pending.map(String))].slice(0, MAX_LIKES_PER_RUN);
    log(`❤️ ${pending.length} pending like(s) from the player app — doing ${todo.length} this run`);

    const resolved = new Set();
    for (const id of todo) {
        if (stopping) break;
        const code = idToShortcode(id);
        if (!code) { resolved.add(id); continue; }
        try {
            await page.goto(`https://www.instagram.com/reel/${code}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await sleep(randInt(4000, 6000));
            await dismissPopups(page);
            dbg(`like page landed on ${page.url()}`);
            const blocked = await detectBlock(page);
            if (blocked) { log(`   ⛔ ${blocked} — stopping likes.`); await snap('blocked-likes'); break; }

            const outcome = await likeCurrentReel(page);
            log(`   -> ${id} (${code}): ${outcome}`);
            if (outcome === 'FAILED' || outcome === 'UNAVAILABLE') await snap(`like-${outcome.toLowerCase()}`);
            if (outcome !== 'FAILED') resolved.add(id);        // FAILED stays pending for next run
            await sleep(randInt(3000, 6000));
        } catch (err) {
            log(`   ❌ ${id}: ${err.message}`);                 // stays pending
        }
    }

    // Re-read before writing so likes the app added while we were busy are not lost.
    try {
        const latest = readJsonSafe(LIKES_FILE, []);
        const remaining = Array.isArray(latest) ? latest.map(String).filter((x) => !resolved.has(x)) : [];
        writeFileAtomic(LIKES_FILE, JSON.stringify(remaining));
        log(`❤️ Likes done. ${remaining.length} still pending.`);
    } catch (e) { log('⚠️ Could not update pending_likes.json:', e.message); }
}

// ============================================================================
// CAPTURE: read every Instagram API response (any URL, any content-type), plus
// a fallback that looks the current reel up by the code in the page URL when the
// feed never delivered its data.
// ============================================================================
function parseIgJson(text) {
    if (!text) return [];
    let t = text.trim();
    if (t.startsWith('for (;;);')) t = t.slice(9);
    try { return [JSON.parse(t)]; } catch (_) {}
    const out = [];                                        // some responses are several JSON objects, one per line
    for (const line of t.split('\n')) {
        const l = line.trim();
        if (!l) continue;
        try { out.push(JSON.parse(l)); } catch (_) {}
    }
    return out;
}

function extractEmbeddedJson(html) {
    const out = [];
    const re = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) {
        if (!m[1].includes('video_versions')) continue;
        try { out.push(JSON.parse(m[1])); } catch (_) {}
    }
    return out;
}

// Keeps up to 4 raw responses we could not use, so the format can be inspected.
function saveSample(label, where, text) {
    if (samplesSaved >= 4) return;
    samplesSaved++;
    try {
        fs.mkdirSync(DEBUG_DIR, { recursive: true });
        const name = `sample-${label}-${samplesSaved}.txt`;
        fs.writeFileSync(path.join(DEBUG_DIR, name), `// ${where}\n${text.slice(0, 200000)}`);
        log(`🧪 Saved raw API sample: debug/${name}`);
    } catch (_) {}
}

async function handleIgResponse(response) {
    let u;
    try { u = new URL(response.url()); } catch (_) { return; }
    if (!/(^|\.)instagram\.com$/.test(u.hostname)) return;
    const type = response.request().resourceType();
    if (type !== 'xhr' && type !== 'fetch' && type !== 'document') return;
    if (response.status() !== 200) return;
    if ((Number(response.headers()['content-length']) || 0) > 8 * 1024 * 1024) return;

    const text = await response.text();
    stats.apiResponses++;

    if (!text.includes('video_versions')) {
        if (text.includes('video_dash_manifest')) {
            dbg(`${type} ${u.pathname}: DASH manifests but no video_versions`);
            saveSample('dash-only', u.pathname, text);
        } else if (/clips|graphql|media|reel/.test(u.pathname)) {
            dbg(`${type} ${u.pathname}: ${text.length}B, no video data`);
        }
        return;
    }
    const objs = type === 'document' ? extractEmbeddedJson(text) : parseIgJson(text);
    let found = 0;
    for (const o of objs) found += registerFeedItems(o, u.pathname);
    if (found === 0) {
        dbg(`${type} ${u.pathname}: mentions video_versions but 0 usable reels parsed`);
        saveSample('unparsed', u.pathname, text);
    }
}

function currentReelCode(page) {
    try {
        const m = new URL(page.url()).pathname.match(/^\/reels?\/([A-Za-z0-9_-]{6,})\/?$/);
        return m ? m[1] : null;
    } catch (_) { return null; }
}

function shortcodeToId(code) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let n = 0n;
    for (const ch of code) {
        const i = alphabet.indexOf(ch);
        if (i < 0) return null;
        n = n * 64n + BigInt(i);
    }
    return n.toString();
}

// Called after every swipe. Marks the reel in the URL as visited and, if the
// feed responses never gave us its data, asks Instagram for it the same way the
// web app does. Returns a stop-reason string if Instagram pushes back, else null.
async function ensureCurrentReelCaptured(page) {
    const code = currentReelCode(page);
    if (!code) return null;
    if (!visitedCodes.has(code)) { visitedCodes.add(code); lastFeedActivity = Date.now(); }
    if (knownCodes.has(code) || fallbackDisabled) return null;
    const mediaId = shortcodeToId(code);
    if (!mediaId) return null;

    stats.fallbackCalls++;
    let r;
    try {
        r = await page.evaluate(async (id) => {
            const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
            const res = await fetch(`/api/v1/media/${id}/info/`, {
                credentials: 'include',
                headers: { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrf, 'x-requested-with': 'XMLHttpRequest', 'x-asbd-id': '129477' },
            });
            return { status: res.status, text: (await res.text()).slice(0, 3000000) };
        }, mediaId);
    } catch (e) { dbg(`URL lookup could not run: ${e.message}`); return null; }

    dbg(`URL lookup ${code} → HTTP ${r.status}, ${r.text.length}B`);
    if (r.status === 200 && r.text.includes('video_versions')) {
        fallbackFails = 0;
        knownCodes.add(code);
        for (const o of parseIgJson(r.text)) registerFeedItems(o, '/api/v1/media/info (URL lookup)');
        return null;
    }

    fallbackFails++; stats.fallbackFail++;
    log(`⚠️ Could not look up reel ${code} (HTTP ${r.status}).`);
    saveSample('lookup-failed', `media ${mediaId} status ${r.status}`, r.text);
    if (r.status === 429 || /challenge_required|checkpoint_required|login_required|feedback_required/.test(r.text.slice(0, 600))) {
        return `Instagram answered the lookup with HTTP ${r.status} (${(r.text.match(/"message":"([^"]+)"/) || [])[1] || 'restriction'})`;
    }
    if (fallbackFails >= 4) { fallbackDisabled = true; log('⚠️ URL lookup disabled after 4 failures in a row.'); }
    return null;
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
    log(`Initializing Termux Reels grabber v2.2 · pid ${process.pid} · node ${process.version}`);
    log(`Flags: debug=${DEBUG} headed=${HEADED} trace=${TRACE} live=${LIVE_PORT || 'off'}`);
    log(`Log file: ${logFile}`);
    dbg('Config', { TARGET_DOWNLOAD_COUNT, MAX_CONCURRENT_DOWNLOADS, MAX_ATTEMPTS_PER_REEL, MAX_LIKES_PER_RUN, MAX_SESSION_MINUTES, MAX_SWIPES_WITHOUT_SAVE, FEED_IDLE_RELOAD_MS, DOWNLOAD_FOLDER, CHROMIUM_PATH });

    // --- single-instance guard -------------------------------------------------
    if (fs.existsSync(PID_FILE)) {
        const old = Number(fs.readFileSync(PID_FILE, 'utf8'));
        let alive = false;
        try { if (old && old !== process.pid) { process.kill(old, 0); alive = true; } } catch (_) {}
        if (alive) { log(`❌ Another grabber is already running (pid ${old}). Close it first.`); process.exit(1); }
    }
    fs.writeFileSync(PID_FILE, String(process.pid));

    // --- housekeeping ----------------------------------------------------------
    if (!fs.existsSync(DOWNLOAD_FOLDER)) fs.mkdirSync(DOWNLOAD_FOLDER, { recursive: true });
    removeLock();                                              // leftover from a crashed run
    for (const f of fs.readdirSync(DOWNLOAD_FOLDER)) if (f.endsWith('.mp4.part')) safeUnlink(path.join(DOWNLOAD_FOLDER, f));

    if (fs.existsSync(QUEUE_BACKLOG_FILE)) {
        const b = readJsonSafe(QUEUE_BACKLOG_FILE, null);
        if (Array.isArray(b)) {
            downloadQueue = b.filter((t) => t && t.id && t.url && !historySet.has(String(t.id)));
            downloadQueue.forEach((t) => { t.id = String(t.id); delete t.retryAt; seenIds.add(t.id); });
            log(`📥 Restored ${downloadQueue.length} unfinished item(s) from queue_backlog.json`);
        } else {
            log('⚠️ queue_backlog.json unreadable, ignoring it.');
        }
    }

    // --- cookies ---------------------------------------------------------------
    let cookies;
    try { cookies = loadCookies(); }
    catch (e) { log(`❌ ${e.message}`); return shutdown('no cookies', 1); }

    // --- browser ---------------------------------------------------------------
    const { chromium } = require('playwright');
    let headless = !HEADED;
    if (HEADED && !process.env.DISPLAY) {
        log('⚠️ --headed needs an X server (DISPLAY is not set). Start termux-x11, run `export DISPLAY=:0`, then retry. Falling back to headless.');
        headless = true;
    }
    log(`Launching Chromium (${headless ? 'headless' : 'headed on DISPLAY=' + process.env.DISPLAY})...`);
    browser = await chromium.launch({
        executablePath: CHROMIUM_PATH,
        headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled'],
    });

    // Use the real Chromium major version in the UA instead of a hard-coded old one.
    const major = browser.version().split('.')[0];
    USER_AGENT = `Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`;

    log(`Chromium ${browser.version()} started.`);
    context = await browser.newContext({
        userAgent: USER_AGENT,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
    });

    try { await context.addCookies(cookies); log(`🍪 Injected ${cookies.length} session cookies.`); }
    catch (e) { log(`❌ Playwright rejected the cookies: ${e.message}`); return shutdown('bad cookies', 1); }

    if (TRACE) {
        try { await context.tracing.start({ screenshots: true, snapshots: true }); log('🧵 Tracing is on (saved on exit).'); }
        catch (e) { log(`⚠️ Tracing unavailable: ${e.message}`); }
    }
    const page = await context.newPage();
    activePage = page;
    startLiveView();
    attachPageDiagnostics(page);
    try { cdp = await context.newCDPSession(page); } catch (e) { cdpBroken = true; log('⚠️ CDP session unavailable:', e.message); }

    page.on('response', (response) => {
        handleIgResponse(response).catch((e) => { stats.apiParseErrors++; dbg(`response not read: ${e.message}`); });
    });

    // --- open feed -------------------------------------------------------------
    try {
        log('Opening Reels feed...');
        await page.goto('https://www.instagram.com/reels/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) { log('⚠️ Navigation warning:', e.message); }

    const landed = new URL(page.url());
    log(`Landed on: ${landed.pathname}`);
    if (!/^\/reels?\//.test(landed.pathname)) {
        log('❌ Not on the Reels feed — cookies are probably expired. Export fresh cookies.json.');
        await snap('not-on-feed');
        return shutdown('session invalid', 1);
    }

    await processPendingLikes(page);
    if (!stopping) {
        await page.goto('https://www.instagram.com/reels/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await sleep(2000);
        await dismissPopups(page);
    }

    log('Connected to feed. Starting crawl...');
    lastFeedActivity = Date.now();
    pump();

    // --- crawl loop ------------------------------------------------------------
    const sessionStart = Date.now();
    let reloadsInRow = 0;
    let lastFeedSize = feedSeen.size;
    let exitCode = 0;

    while (downloadCount < TARGET_DOWNLOAD_COUNT && !stopping) {
        if (Date.now() - sessionStart > MAX_SESSION_MINUTES * 60000) { log('⏱️ Session time limit reached.'); break; }
        if (swipesSinceSave >= MAX_SWIPES_WITHOUT_SAVE) { log('ℹ️ Feed keeps showing reels you already have. Stopping.'); break; }

        if (stats.swipes % 8 === 0) {
            const blocked = await detectBlock(page);
            if (blocked) { log(`⛔ ${blocked}. Stopping to protect the account.`); await snap('blocked'); exitCode = 2; break; }
        }
        await dismissPopups(page);

        // let downloads catch up instead of racing ahead
        if (downloadQueue.length > BACKLOG_PAUSE_AT) {
            log(`⏸️ Queue is ${downloadQueue.length} long — waiting for downloads to catch up...`);
            const t0 = Date.now();
            while (downloadQueue.length > BACKLOG_RESUME_AT && !stopping && Date.now() - t0 < 120000) await sleep(1000);
        }

        // feed went quiet -> reload it; give up after a few useless reloads
        if (feedSeen.size !== lastFeedSize) { lastFeedSize = feedSeen.size; reloadsInRow = 0; }
        if (Date.now() - lastFeedActivity > FEED_IDLE_RELOAD_MS) {
            if (reloadsInRow >= MAX_FEED_RELOADS_IN_ROW) { log('❌ Feed stopped producing reels after several reloads. Stopping.'); exitCode = 3; break; }
            reloadsInRow++; stats.reloads++;
            await snap('feed-idle');
            log(`⚠️ No new reels for ${Math.round((Date.now() - lastFeedActivity) / 1000)}s — reloading feed (${reloadsInRow}/${MAX_FEED_RELOADS_IN_ROW})`);
            await page.goto('https://www.instagram.com/reels/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            lastFeedActivity = Date.now();
            await sleep(2500);
            continue;
        }

        const method = await swipeToNextReel(page);
        stats.swipes++; swipesSinceSave++;
        log(`[SWIPE ${stats.swipes}] saved ${downloadCount}/${TARGET_DOWNLOAD_COUNT} · queue ${downloadQueue.length} · active ${inFlight.size}`);
        dbg(`swipe via ${method}; reels seen ${feedSeen.size}; ${Math.round((Date.now() - lastFeedActivity) / 1000)}s since a new reel; ${swipesSinceSave} swipes since last save`);
        if (stats.swipes % 10 === 0) {
            log(`💓 ${stats.swipes} swipes · ${downloadCount} saved · ${visitedCodes.size} visited / ${knownCodes.size} captured · skipped (history ${stats.skippedHistory}, dup ${stats.skippedDuplicate}) · page: ${page.url().slice(0, 70)}`);
            if (DEBUG) await snap('crawl');
        }

        // watch-time: mostly normal, sometimes quick skip, sometimes a longer look
        const roll = Math.random();
        const dwell = roll < 0.20 ? randInt(1200, 2000)
                    : roll > 0.88 ? randInt(5000, 9000)
                    : randInt(2200, 4700);
        dbg(`dwell ${dwell}ms (roll ${roll.toFixed(2)})`);
        const settle = Math.min(dwell, 1800);              // give the feed a moment to deliver this reel's data
        await sleep(settle);
        const stopReason = await ensureCurrentReelCaptured(page);
        if (stopReason) { log(`⛔ ${stopReason}. Stopping to protect the account.`); await snap('lookup-blocked'); exitCode = 2; break; }
        await sleep(Math.max(0, dwell - settle));

        if (visitedCodes.size >= 15 && knownCodes.size < visitedCodes.size * 0.3) {
            log(`❌ The browser showed ${visitedCodes.size} reels but data was captured for only ${knownCodes.size}. Capture is not working — send me the log and debug/sample-*.txt.`);
            await snap('capture-failing');
            exitCode = 4;
            break;
        }
    }

    // --- finish ----------------------------------------------------------------
    const t0 = Date.now();
    while ((downloadQueue.length > 0 || inFlight.size > 0) && !stopping && Date.now() - t0 < 180000) { pump(); await sleep(500); }

    if (exitCode === 0 && !stopping) await processPendingLikes(page);

    log(`\n🎉 Done. Saved ${downloadCount} new reel(s) this run.`);
    await shutdown('finished', exitCode);
}

if (require.main === module) {
    main().catch((e) => { log('💥 Fatal:', e && e.stack || e); shutdown('fatal error', 1); });
} else {
    module.exports = { findVideoItems, idToShortcode, loadCookies, writeFileAtomic };   // for tests
}
