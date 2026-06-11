// ============================================================================
// SAFE PIPELINE CORES (Silently absorb background media or asset timeout drops)
// ============================================================================
process.on('unhandledRejection', (reason) => {
    if (reason?.message?.includes('Timeout') || reason?.message?.includes('status code')) return;
    if (reason?.message?.includes('Target page snapped') || reason?.message?.includes('context mapping')) return;
    console.log('💡 Intercepted background stream exception:', reason?.message || reason);
});

const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============================================================================
// SYSTEM ARCHITECTURE CONFIGURATIONS (WINDOWS OPTIMIZED)
// ============================================================================
const COOKIES_FILE = path.join(__dirname, 'cookies.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const QUEUE_BACKLOG_FILE = path.join(__dirname, 'queue_backlog.json'); 
const DOWNLOAD_FOLDER = path.join(__dirname, '.Reels'); // 📂 Saves to a local .Reels folder on Windows
const LOCK_FILE_PATH = path.join(DOWNLOAD_FOLDER, 'download.lock');

// ============================================================================
// GRACEFUL SHUTDOWN INTERCEPTOR (Ctrl+C Cleanup & Backlog State Save)
// ============================================================================
const cleanupAndExit = () => {
    console.log('\n🛑 Script interrupted via Ctrl+C. Initiating structural cache dump...');
    try {
        if (downloadQueue.length > 0) {
            fs.writeFileSync(QUEUE_BACKLOG_FILE, JSON.stringify(downloadQueue, null, 2), 'utf8');
            console.log(`💾 Saved ${downloadQueue.length} pending items from memory stream to queue_backlog.json.`);
        }
        if (fs.existsSync(LOCK_FILE_PATH)) {
            fs.unlinkSync(LOCK_FILE_PATH);
            console.log('🗑️ download.lock successfully removed.');
        }
    } catch (e) {
        console.log('⚠️ Could not complete cleanup cycle during shutdown:', e.message);
    }
    process.exit(0);
};

// Ctrl+C interceptor for Windows Command Prompt / PowerShell
process.on('SIGINT', cleanupAndExit);

const TARGET_DOWNLOAD_COUNT = 400;
const MAX_HISTORY_SIZE = 15000;
const MAX_CONCURRENT_DOWNLOADS = 3; 

if (!fs.existsSync(DOWNLOAD_FOLDER)) {
    fs.mkdirSync(DOWNLOAD_FOLDER, { recursive: true });
}

let downloadedVideoIds = [];
if (fs.existsSync(HISTORY_FILE)) {
    try {
        downloadedVideoIds = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        console.log(`📦 Loaded ${downloadedVideoIds.length} historical Reel IDs from history.json`);
    } catch (e) {
        console.log('⚠️ History log corrupted, initializing fresh array.');
        downloadedVideoIds = [];
    }
}

let downloadQueue = []; 
if (fs.existsSync(QUEUE_BACKLOG_FILE)) {
    try {
        downloadQueue = JSON.parse(fs.readFileSync(QUEUE_BACKLOG_FILE, 'utf8'));
        console.log(`📥 Successfully restored ${downloadQueue.length} unfinished targets from queue_backlog.json`);
        fs.unlinkSync(QUEUE_BACKLOG_FILE); 
    } catch (e) {
        console.log('⚠️ Queue backlog state corrupted, cleaning execution context.');
        downloadQueue = [];
    }
}

let downloadCount = 0;
let activeDownloads = 0;

function saveToHistory(videoId) {
    if (downloadedVideoIds.includes(videoId)) return;
    downloadedVideoIds.push(videoId);
    if (downloadedVideoIds.length > MAX_HISTORY_SIZE) {
        const itemsToRemove = downloadedVideoIds.length - MAX_HISTORY_SIZE;
        downloadedVideoIds.splice(0, itemsToRemove);
        console.log(`\n🧹 History limit reached. Purged ${itemsToRemove} oldest entries from log.`);
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(downloadedVideoIds, null, 2), 'utf8');
}

// ============================================================================
// LIKE SYNC ENGINE
// ============================================================================
async function processPlayerLikes(page) {
    const LIKES_FILE = path.join(DOWNLOAD_FOLDER, 'pending_likes.json');
    if (!fs.existsSync(LIKES_FILE)) return;

    try {
        const fileContent = fs.readFileSync(LIKES_FILE, 'utf8');
        let pendingIds = [];
        try { pendingIds = JSON.parse(fileContent); } catch (jsonErr) { return; }

        if (!Array.isArray(pendingIds) || pendingIds.length === 0) return;

        console.log(`\n❤️ Found ${pendingIds.length} pending Likes to process...`);

        for (const id of pendingIds) {
            let targetShortcode = id;

            if (/^\d+(_\d+)?$/.test(id)) {
                const mediaIdStr = id.split('_')[0];
                try {
                    let num = BigInt(mediaIdStr);
                    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
                    let buildCode = '';
                    while (num > 0n) {
                        let remainder = num % 64n;
                        buildCode = alphabet[Number(remainder)] + buildCode;
                        num = num / 64n;
                    }
                    targetShortcode = buildCode;
                } catch (err) {
                    targetShortcode = id;
                }
            }

            console.log(`  -> Automated targeting for Reel ID: ${id} (Resolved Shortcode: ${targetShortcode})`);
            try {
                await page.goto(`https://www.instagram.com/reels/${targetShortcode}/`, { 
                    waitUntil: 'domcontentloaded', 
                    timeout: 30000 
                });
                
                await page.waitForTimeout(5000);

                await page.evaluate(() => {
                    document.body.style.overflow = 'auto';
                    document.body.style.pointerEvents = 'auto';
                    document.documentElement.style.overflow = 'auto';

                    const blockingPhrases = ['open app', 'watch in app', 'use app', 'log in', 'sign up', 'experience the best', 'not now'];
                    const overlays = document.querySelectorAll('div, section, [role="dialog"]');
                    
                    overlays.forEach(el => {
                        const style = window.getComputedStyle(el);
                        if (style.position === 'fixed' || style.position === 'absolute') {
                            const text = el.innerText?.toLowerCase() || '';
                            if (blockingPhrases.some(p => text.includes(p))) {
                                const dismissBtns = el.querySelectorAll('button, [role="button"]');
                                dismissBtns.forEach(b => {
                                    const bText = b.innerText?.toLowerCase() || '';
                                    if (bText.includes('not now') || bText.includes('close') || bText.length === 0) {
                                        b.click();
                                    }
                                });
                                el.remove();
                            }
                        }
                    });
                }).catch(() => {});

                await page.waitForTimeout(1000);

                const currentStatus = await page.evaluate(() => {
                    const allSvgs = Array.from(document.querySelectorAll('svg'));
                    const isUnlikedAlready = allSvgs.some(s => /unlike/i.test(s.getAttribute('aria-label') || ''));
                    return { liked: isUnlikedAlready };
                }).catch(() => ({ liked: false }));

                if (currentStatus.liked) {
                    console.log(`     ℹ️ Reel is already liked.`);
                    continue;
                }

                const likeDispatched = await page.evaluate(() => {
                    const allSvgs = Array.from(document.querySelectorAll('svg'));
                    let matchIcon = allSvgs.find(svg => {
                        const label = svg.getAttribute('aria-label') || '';
                        return /like/i.test(label) && !/unlike/i.test(label);
                    });

                    if (!matchIcon) {
                        matchIcon = document.querySelector('[aria-label="Like"]') || document.querySelector('[aria-label="like"]');
                    }

                    if (!matchIcon) return false;

                    const coreTarget = matchIcon.closest('button') || matchIcon.closest('[role="button"]') || matchIcon;
                    coreTarget.scrollIntoView({ block: 'center' });

                    const rect = coreTarget.getBoundingClientRect();
                    const baseX = rect.left + rect.width / 2;
                    const baseY = rect.top + rect.height / 2;

                    const jitterX = baseX + (Math.floor(Math.random() * 9) - 4);
                    const jitterY = baseY + (Math.floor(Math.random() * 9) - 4);

                    const eventSequence = ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'];
                    
                    let executionLayer = coreTarget;
                    for (let depth = 0; depth < 3; depth++) {
                        if (!executionLayer) break;
                        
                        eventSequence.forEach(evtName => {
                            let simulatedEvt;
                            const standardConfig = { bubbles: true, cancelable: true, view: window, clientX: jitterX, clientY: jitterY };
                            
                            if (evtName.startsWith('touch')) {
                                const singleTouch = new Touch({ identifier: Date.now(), target: executionLayer, clientX: jitterX, clientY: jitterY });
                                simulatedEvt = new TouchEvent(evtName, { bubbles: true, cancelable: true, touches: [singleTouch], targetTouches: [singleTouch], changedTouches: [singleTouch] });
                            } else if (evtName.startsWith('pointer')) {
                                simulatedEvt = new PointerEvent(evtName, standardConfig);
                            } else {
                                simulatedEvt = new MouseEvent(evtName, standardConfig);
                            }
                            executionLayer.dispatchEvent(simulatedEvt);
                        });

                        if (typeof executionLayer.click === 'function') {
                            executionLayer.click();
                        }
                        executionLayer = executionLayer.parentElement;
                    }
                    return true;
                }).catch(() => false);

                if (likeDispatched) {
                    console.log(`     ✅ Complete Event Dispatch Matrix injected into Like element layers.`);
                } else {
                    const heartBtn = await page.$('button:has(svg[aria-label="Like"]), svg[aria-label="Like"], [aria-label="Like"]').catch(() => null);
                    if (heartBtn) {
                        const box = await heartBtn.boundingBox().catch(() => null);
                        if (box) {
                            const nativeJitterX = (box.x + box.width / 2) + (Math.floor(Math.random() * 7) - 3);
                            const nativeJitterY = (box.y + box.height / 2) + (Math.floor(Math.random() * 7) - 3);
                            
                            await page.touchscreen.tap(nativeJitterX, nativeJitterY);
                            console.log(`     ✅ Playwright Native Jittered Touchscreen Tap Fallback deployed.`);
                        }
                    }
                }

                const postLikeDelay = Math.floor(Math.random() * 3000) + 3000; 
                await page.waitForTimeout(postLikeDelay);
            } catch (err) {
                console.log(`     ❌ Link unavailable or skipped: ${err.message}`);
            }
        }

        fs.writeFileSync(LIKES_FILE, JSON.stringify([]), 'utf8');
        await page.goto('https://www.instagram.com/reels/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    } catch (e) {
        console.log('⚠️ Notice processing sync pipeline:', e.message);
    }
}

// ============================================================================
// CONCURRENT DOWNLOAD WORKER
// ============================================================================
async function executeIndividualDownload(task) {
    const filePath = path.join(DOWNLOAD_FOLDER, `reel_${task.id}.mp4`);
    const captionPath = path.join(DOWNLOAD_FOLDER, `reel_${task.id}.txt`);
    const pfpPath = path.join(DOWNLOAD_FOLDER, `reel_${task.id}.jpg`);
    const userPath = path.join(DOWNLOAD_FOLDER, `reel_${task.id}_user.txt`);

    if (task.username) {
        try { fs.writeFileSync(userPath, `@${task.username}`, 'utf8'); } catch(e){}
    }

    if (task.pfpUrl) {
        try {
            const pfpResponse = await axios({
                method: 'GET',
                url: task.pfpUrl,
                responseType: 'arraybuffer',
                timeout: 10000
            });
            fs.writeFileSync(pfpPath, pfpResponse.data);
        } catch (e) {}
    }

    try {
        const response = await axios({
            method: 'GET',
            url: task.url,
            responseType: 'stream',
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*'
            }
        });

        const writer = fs.createWriteStream(filePath);
        
        await new Promise((resolve) => {
            response.data.pipe(writer);

            writer.on('finish', () => {
                downloadCount++;
                saveToHistory(task.id); 

                if (task.caption && task.caption.trim().length > 0) {
                    try {
                        fs.writeFileSync(captionPath, task.caption, 'utf8');
                    } catch (e) {}
                }

                console.log(`  -> [SAVED] Progress: ${downloadCount}/${TARGET_DOWNLOAD_COUNT} files. (Queue size: ${downloadQueue.length})`);
                resolve();
            });

            const handleFailure = () => {
                writer.end();
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e){}
                resolve();
            };

            response.data.on('error', handleFailure);
            writer.on('error', handleFailure);
        });
    } catch (error) {}
}

async function processDownloadQueue() {
    if (downloadCount >= TARGET_DOWNLOAD_COUNT || (downloadQueue.length === 0 && activeDownloads === 0)) {
        if (downloadQueue.length === 0 && activeDownloads === 0) {
            try { if (fs.existsSync(LOCK_FILE_PATH)) fs.unlinkSync(LOCK_FILE_PATH); } catch(e){}
        }
        setTimeout(processDownloadQueue, 400);
        return;
    }

    while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0 && downloadCount < TARGET_DOWNLOAD_COUNT) {
        const nextTask = downloadQueue.shift();
        if (!nextTask) break;

        activeDownloads++;
        try {
            fs.writeFileSync(LOCK_FILE_PATH, 'ACTIVE', 'utf8');
        } catch (lockError) {}

        executeIndividualDownload(nextTask).then(() => {
            activeDownloads--;
        }).catch(() => {
            activeDownloads--;
        });
    }

    setTimeout(processDownloadQueue, 300);
}

function findVideoUrls(obj, foundLinks = []) {
    if (!obj || typeof obj !== 'object') return foundLinks;
    
    if (obj.video_versions && Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
        const id = obj.id || obj.pk || Math.random().toString(36).substring(7);
        const captionText = obj.caption?.text || obj.edge_media_to_caption?.edges?.[0]?.node?.text || '';
        
        const username = obj.user?.username || obj.owner?.username || 'Instagram User';
        const pfpUrl = obj.user?.profile_pic_url || obj.owner?.profile_pic_url || '';
        
        foundLinks.push({ 
            url: obj.video_versions[0].url, 
            id: id, 
            caption: captionText,
            username: username,
            pfpUrl: pfpUrl
        });
    }
    
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            findVideoUrls(obj[key], foundLinks);
        }
    }
    return foundLinks;
}

async function dismissLoginPopup(page) {
    try {
        const bodyText = await page.evaluate(() => document.body.innerText || "").catch(() => "");
        const lowerText = bodyText.toLowerCase();

        if (lowerText.includes("save your login info") || lowerText.includes("save info")) {
            console.log('🚨 [INTERCEPT] "Save your login info?" overlay detected.');

            const targetBtn = page.locator('button, [role="button"], div, span').filter({ hasText: /^Not now$/i }).first();
            if (await targetBtn.isVisible()) {
                await targetBtn.click({ force: true, timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(1000);
                return;
            }
        }
    } catch (e) {}
}

// ============================================================================
// AUTOMATION ENGINE
// ============================================================================
(async () => {
    console.log('Initializing Windows Native Scraper Pipeline...');

    // Removed hardcoded executablePath so Playwright natively resolves its browser or uses your local Chrome
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    // Switched user agent profile securely to a standard desktop Windows device profile 
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
    });

    if (fs.existsSync(COOKIES_FILE)) {
        const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
        await context.addCookies(cookies);
        console.log('Successfully injected authenticated session cookies.');
    } else {
        console.error('CRITICAL ERROR: cookies.json is missing!');
        process.exit(1);
    }
    
    const page = await context.newPage();

    page.on('response', async (response) => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        
        if ((url.includes('/api/v1/clips/home/') || url.includes('graphql/query')) && contentType.includes('json')) {
            try {
                const json = await response.json();
                const targets = findVideoUrls(json);
                for (const target of targets) {
                    if (downloadCount >= TARGET_DOWNLOAD_COUNT) break;
                    if (downloadedVideoIds.includes(target.id)) continue;

                    if (!downloadQueue.some(item => item.id === target.id)) {
                        console.log(`[QUEUE] Intercepted NEW Reel ID: ${target.id}`);
                        downloadQueue.push(target);
                    }
                }
            } catch (e) {}
        }
    });

    try {
        console.log('Navigating directly to Reels target area...');
        await page.goto('https://www.instagram.com/reels/', {
            waitUntil: 'domcontentloaded',
      
