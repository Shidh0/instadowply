// 🔥 FORCE PLAYWRIGHT TO THINK THIS IS LINUX
Object.defineProperty(process, 'platform', { value: 'linux' });

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
// SYSTEM ARCHITECTURE CONFIGURATIONS
// ============================================================================
const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';
const COOKIES_FILE = path.join(__dirname, 'cookies.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const QUEUE_BACKLOG_FILE = path.join(__dirname, 'queue_backlog.json'); // 📦 Persistent Queue State
const DOWNLOAD_FOLDER = '/storage/emulated/0/.Reels'; // 🛑 Hidden directory with leading dot
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
            console.log('🗑️ download.lock successfully removed from hidden .Reels folder.');
        }
    } catch (e) {
        console.log('⚠️ Could not complete cleanup cycle during shutdown:', e.message);
    }
    process.exit(0);
};

process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);

const TARGET_DOWNLOAD_COUNT = 400;
const MAX_HISTORY_SIZE = 15000;
const MAX_CONCURRENT_DOWNLOADS = 3; // ⚡ Parallelize IO download pipelines to maximize storage write speeds

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

// Restore background un-downloaded queue backup items if they exist
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
// LIKE SYNC ENGINE (Decodes long IDs, kills interstitials & executes click matrix)
// ============================================================================
async function processPlayerLikes(page) {
    const LIKES_FILE = path.join(DOWNLOAD_FOLDER, 'pending_likes.json');
    if (!fs.existsSync(LIKES_FILE)) return;

    try {
        const fileContent = fs.readFileSync(LIKES_FILE, 'utf8');
        let pendingIds = [];
        try { pendingIds = JSON.parse(fileContent); } catch (jsonErr) { return; }

        if (!Array.isArray(pendingIds) || pendingIds.length === 0) return;

        console.log(`\n❤️ Found ${pendingIds.length} pending Likes shared from Player App. Processing Priority Queue...`);

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
                console.log(`     [DIAGNOSTIC] Viewport directed location: ${page.url()}`);

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
                    console.log(`     ℹ️ Reel is already liked. Skipping entry adjustment.`);
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
                console.log(`     ⏳ Sleeping ${Math.round(postLikeDelay / 1000)}s to mask priority profile navigation behavior...`);
                await page.waitForTimeout(postLikeDelay);
            } catch (err) {
                console.log(`     ❌ Link unavailable or skipped: ${err.message}`);
            }
        }

        fs.writeFileSync(LIKES_FILE, JSON.stringify([]), 'utf8');
        console.log('🔄 Returning browser context back to main Reels stream feed...');
        await page.goto('https://www.instagram.com/reels/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        console.log('❤️ Priority Likes sync sequence finalized.\n');
    } catch (e) {
        console.log('⚠️ Notice processing sync pipeline:', e.message);
    }
}

// ============================================================================
// SPEED-OPTIMIZED ASYNC MULTI-SLOT CONCURRENT DOWNLOAD WORKER
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
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
                'Accept': '*/*'
            }
        });

        const writer = fs.createWriteStream(filePath);
        
        return await new Promise((resolve) => {
            response.data.pipe(writer);

            writer.on('finish', () => {
                downloadCount++;
                saveToHistory(task.id); 

                if (task.caption && task.caption.trim().length > 0) {
                    try {
                        fs.writeFileSync(captionPath, task.caption, 'utf8');
                    } catch (e) {}
                }
                resolve(true); 
            });

            const handleFailure = () => {
                writer.end();
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e){}
                resolve(false); 
            };

            response.data.on('error', handleFailure);
            writer.on('error', handleFailure);
        });
    } catch (error) {
        return false;
    }
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

        executeIndividualDownload(nextTask).then((success) => {
            activeDownloads--;
            if (success) {
                console.log(` ✅ [SAVED] Progress: ${downloadCount}/${TARGET_DOWNLOAD_COUNT} files. (Queue size: ${downloadQueue.length})`);
            } else {
                console.log(` ♻️ [RE-QUEUE] Network drop for ${nextTask.id}. Retrying later.`);
             setTimeout(() => {
            downloadQueue.push(nextTask);
             }, 1500);
      }
        }).catch(() => {
            activeDownloads--;
            downloadQueue.push(nextTask); 
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
        
        const highestResVideo = obj.video_versions.reduce((max, video) => {
            const currentArea = (video.width || 0) * (video.height || 0);
            const maxArea = (max.width || 0) * (max.height || 0);
            return currentArea > maxArea ? video : max;
        }, obj.video_versions[0]);

        foundLinks.push({ 
            url: highestResVideo.url, 
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

// ============================================================================
// NATIVE PLAYWRIGHT INTERCEPTOR: Direct Terminal Feedback & Trusted Native Click
// ============================================================================
async function dismissLoginPopup(page) {
    try {
        const bodyText = await page.evaluate(() => document.body.innerText || "").catch(() => "");
        const lowerText = bodyText.toLowerCase();

        if (lowerText.includes("save your login info") || lowerText.includes("save info")) {
            console.log('🚨 [INTERCEPT] "Save your login info?" overlay detected on viewport.');

            const targetBtn = page.locator('button, [role="button"], div, span').filter({ hasText: /^Not now$/i }).first();
            if (await targetBtn.isVisible()) {
                console.log('   👉 Found target button element. Dispatching trusted hardware click...');
                await targetBtn.click({ force: true, timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(1000);
                return;
            }

            const looseBtn = page.locator('text=/not now/i').first();
            if (await looseBtn.isVisible()) {
                console.log('   👉 Found loose context text match. Executing native hit...');
                await looseBtn.click({ force: true, timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(1000);
                return;
            }

            const targetCoordinates = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('button, [role="button"], div, span'));
                const matched = elements.find(el => el.innerText?.toLowerCase().trim() === 'not now');
                if (matched) {
                    const rect = matched.getBoundingClientRect();
                    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                }
                return null;
            }).catch(() => null);

            if (targetCoordinates && targetCoordinates.x > 0 && targetCoordinates.y > 0) {
                console.log(`   🎯 Geometry target fallback mapped at (${targetCoordinates.x}, ${targetCoordinates.y}). Tapping screen...`);
                await page.touchscreen.tap(targetCoordinates.x, targetCoordinates.y).catch(() => {});
                await page.waitForTimeout(1000);
            }
        }
    } catch (e) {}
}

// ============================================================================
// AUTOMATION ENGINE
// ============================================================================
(async () => {
    console.log('Initializing Termux Android Native Scraper Pipeline...');

    const browser = await chromium.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
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
            timeout: 60000
        });
    } catch (gotoError) {
        console.log('⚠️  Navigation warning:', gotoError.message);
    }
    
    const finalUrl = page.url();
    console.log(`Verified Browser Location: ${finalUrl}`);

    if (!finalUrl.includes('/reels/')) {
        console.error('❌ CRITICAL: Session cookies likely expired or invalid.');
        await browser.close();
        process.exit(1);
    }

    await processPlayerLikes(page);

    await page.waitForTimeout(2000);
    await dismissLoginPopup(page);

    console.log('Connected to Algorithmic Feed Stream. Beginning automatic crawl loop...');

    processDownloadQueue();

    let lastDownloadCount = 0;
    let stuckCounter = 0;
    let lastSuccessTime = Date.now(); 

    while (downloadCount < TARGET_DOWNLOAD_COUNT) {
        
        if (Date.now() - lastSuccessTime > 25000) {
            console.log('⚠️  [STUCK DETECTED] No media progress in 25s. Running soft pipeline recovery...');
            try {
                await page.goto('https://www.instagram.com/reels/', { waitUntil: 'domcontentloaded', timeout: 30000 });
                console.log('   -> Soft recovery completed. Stream baseline successfully synchronized.');
                lastSuccessTime = Date.now(); 
                await page.waitForTimeout(2000);
            } catch (e) {
                console.log('   -> Soft recovery navigation timed out, shifting layout elements manually...');
                try { await page.evaluate(() => window.scrollTo(0, 0)); } catch(err){}
                lastSuccessTime = Date.now(); 
            }
        }

        await dismissLoginPopup(page);
        
        if (downloadQueue.length > 20) { 
            console.log(`\n🛑 [QUEUE BACKLOG DETECTED] Backlog size: ${downloadQueue.length}. Freezing media play states...`);
            
            await page.evaluate(() => {
                const currentVideo = document.querySelector('video');
                if (currentVideo && typeof currentVideo.pause === 'function') {
                    currentVideo.pause();
                }
            }).catch(() => {});

            while (downloadQueue.length > 6) {
                await page.waitForTimeout(1000);
            }

            console.log('▶️ [BACKLOG RESOLVED] Buffer safe margin reached. Resuming stream playback...\n');
            
            await page.evaluate(() => {
                const currentVideo = document.querySelector('video');
                if (currentVideo && typeof currentVideo.play === 'function') {
                    currentVideo.play();
                }
            }).catch(() => {});
        }

        try {
            const startX = 195 + (Math.random() * 30 - 15);
            const startY = 680 + (Math.random() * 40 - 20);
            const endY = 130 + (Math.random() * 30 - 15);

            await page.mouse.move(startX, startY);
            await page.mouse.down();
            await page.mouse.move(startX - (Math.random() * 12), 430, { steps: Math.floor(Math.random() * 3) + 4 });
            await page.mouse.move(startX + (Math.random() * 8), endY, { steps: Math.floor(Math.random() * 3) + 4 });
            await page.mouse.up();
            
            console.log(`[TOUCH SWIPE] Crawled feed step. Saved items: ${downloadCount}/${TARGET_DOWNLOAD_COUNT}`);
        } catch (swipeError) {
            try { await page.evaluate(() => window.scrollBy(0, window.innerHeight)); } catch(e){}
        }
       // ⏳ Allow 1.5 seconds for the API context to trigger, then freeze the browser video player
await page.waitForTimeout(1500);
await page.evaluate(() => {
    document.querySelectorAll('video').forEach(video => {
        if (video && typeof video.pause === 'function') {
            video.pause();
            // Tells the browser to stop downloading data for this stream pipeline
            video.removeAttribute('src'); 
            video.load(); 
        }
    });
}).catch(() => {});
        if (downloadCount === lastDownloadCount) {
            stuckCounter++;
            
            if (stuckCounter > 2) {
                console.log('⚠️  [STUCK SEGMENT] Container tracking lost. Re-focusing viewport elements...');
                try {
                    await page.touchscreen.tap(195, 400);
                    await page.waitForTimeout(400);
                    
                    await page.evaluate(() => {
                        const mainContainer = document.querySelector('main') || window;
                        mainContainer.scrollBy(0, window.innerHeight);
                    });
                } catch (scrollErr) {}
                stuckCounter = 0;
            }
        } else {
            stuckCounter = 0;
            lastDownloadCount = downloadCount;
            lastSuccessTime = Date.now(); 
        }
        
        const behavioralRoll = Math.random();
        let viewDelay = Math.floor(Math.random() * 2500) + 2200; 
        
        if (behavioralRoll < 0.20) {
            viewDelay = Math.floor(Math.random() * 800) + 1200;
            console.log('  -> [BEHAVIOR] Simulating immediate rapid swipe-past...');
            
        } else if (behavioralRoll > 0.82 && behavioralRoll <= 0.92) {
            console.log('  -> [BEHAVIOR] Simulating deeply engaged play session...');
            try {
                const jitterX = 195 + Math.floor(Math.random() * 40 - 20);
                const jitterY = 422 + Math.floor(Math.random() * 40 - 20);
                
                await page.touchscreen.tap(jitterX, jitterY);
                await page.waitForTimeout(Math.floor(Math.random() * 1500) + 1000);
                
                await page.evaluate(() => window.scrollBy(0, 120));
                await page.waitForTimeout(Math.floor(Math.random() * 2000) + 2000);
                
                await page.evaluate(() => window.scrollBy(0, -120));
                await page.waitForTimeout(Math.floor(Math.random() * 1000) + 1000);
                
                await page.touchscreen.tap(jitterX, jitterY);
            } catch (err) {}
            viewDelay = Math.floor(Math.random() * 2000) + 2000;

        } else if (behavioralRoll > 0.92 && behavioralRoll <= 0.96) {
            console.log('  -> [BEHAVIOR] Simulating device slip / grip fumble behavior...');
            try {
                const fumbleX = Math.random() < 0.5 ? (30 + Math.random() * 40) : (340 + Math.random() * 30);
                const fumbleY = 300 + Math.floor(Math.random() * 200);
                
                await page.mouse.move(fumbleX, fumbleY);
                await page.mouse.down();
                await page.mouse.move(fumbleX + (Math.random() * 40 - 20), fumbleY - (Math.random() * 60 + 20), { steps: 2 });
                await page.mouse.up();
                console.log('     -> Unintentional screen swipe registered.');
                
                const recoveryPause = Math.floor(Math.random() * 2500) + 2000;
                console.log(`     -> Pausing ${Math.round(recoveryPause/1000)}s for natural hand grip readjustment...`);
                await page.waitForTimeout(recoveryPause);
            } catch (err) {}
            viewDelay = Math.floor(Math.random() * 2000) + 2000;

        } else if (behavioralRoll > 0.96) {
            console.log('  -> [BEHAVIOR] Simulating profile context discovery tracking detour...');
            try {
                const profileHandleX = 65 + Math.floor(Math.random() * 30 - 15);
                const profileHandleY = 745 + Math.floor(Math.random() * 20 - 10);
                
                await page.touchscreen.tap(profileHandleX, profileHandleY);
                console.log('     -> Navigating away from main feed to examine profile grid details...');
                await page.waitForTimeout(Math.floor(Math.random() * 3000) + 4000);
                await page.goBack({ waitUntil: 'domcontentloaded' });
                console.log('     -> Executed native history navigation back. Returned to operational stream baseline.');
            } catch (err) {}
            viewDelay = Math.floor(Math.random() * 3000) + 3000;
        }

        await page.waitForTimeout(viewDelay);
    }

    while(downloadQueue.length > 0 || activeDownloads > 0) {
        await new Promise(r => setTimeout(r, 1000));
    }

    try { if (fs.existsSync(LOCK_FILE_PATH)) fs.unlinkSync(LOCK_FILE_PATH); } catch(e){}

    console.log(`\n🎉 Success! Processed session cap of ${downloadCount} fresh items into storage.`);
    await browser.close();
    process.exit(0);
})();