// FORCE PLAYWRIGHT TO THINK THIS IS LINUX
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
const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser'; //[cite: 1]
const COOKIES_FILE = path.join(__dirname, 'cookies.json'); //[cite: 1]
const HISTORY_FILE = path.join(__dirname, 'history.json'); //[cite: 1]
const DOWNLOAD_FOLDER = '/storage/emulated/0/Reels'; //[cite: 1]

const TARGET_DOWNLOAD_COUNT = 600; //[cite: 1]
const MAX_HISTORY_SIZE = 15000; //[cite: 1]

if (!fs.existsSync(DOWNLOAD_FOLDER)) {
    fs.mkdirSync(DOWNLOAD_FOLDER, { recursive: true }); //[cite: 1]
}

let downloadedVideoIds = [];
if (fs.existsSync(HISTORY_FILE)) { //[cite: 1]
    try {
        downloadedVideoIds = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); //[cite: 1]
        console.log(`📦 Loaded ${downloadedVideoIds.length} historical Reel IDs from history.json`); //[cite: 1]
    } catch (e) {
        console.log('⚠️ History log corrupted, initializing fresh array.'); //[cite: 1]
        downloadedVideoIds = []; //[cite: 1]
    }
}

let downloadCount = 0; //[cite: 1]
let downloadQueue = []; // New asynchronous optimization queue
let isDownloading = false;

function saveToHistory(videoId) {
    if (downloadedVideoIds.includes(videoId)) return; //[cite: 1]
    downloadedVideoIds.push(videoId); //[cite: 1]
    if (downloadedVideoIds.length > MAX_HISTORY_SIZE) { //[cite: 1]
        const itemsToRemove = downloadedVideoIds.length - MAX_HISTORY_SIZE; //[cite: 1]
        downloadedVideoIds.splice(0, itemsToRemove); //[cite: 1]
        console.log(`\n🧹 History limit reached. Purged ${itemsToRemove} oldest entries from log.`); //[cite: 1]
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(downloadedVideoIds, null, 2), 'utf8'); //[cite: 1]
}

// ============================================================================
// NON-BLOCKING ASYNC DOWNLOAD WORKER
// ============================================================================
async function processDownloadQueue() {
    if (isDownloading || downloadQueue.length === 0 || downloadCount >= TARGET_DOWNLOAD_COUNT) return;
    
    isDownloading = true;
    const task = downloadQueue.shift();

    const filePath = path.join(DOWNLOAD_FOLDER, `reel_${task.id}.mp4`); //[cite: 1]

    try {
        const response = await axios({
            method: 'GET',
            url: task.url,
            responseType: 'stream',
            timeout: 20000, //[cite: 1]
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', //[cite: 1]
                'Accept': '*/*' //[cite: 1]
            }
        });

        const writer = fs.createWriteStream(filePath); //[cite: 1]
        
        await new Promise((resolve) => {
            response.data.on('data', async (chunk) => {
                writer.write(chunk); //[cite: 1]
                if (Math.random() > 0.7) { //[cite: 1]
                    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 50) + 10)); //[cite: 1]
                }
            });

            response.data.on('end', () => {
                writer.end(); //[cite: 1]
            });

            writer.on('finish', () => {
                downloadCount++;
                saveToHistory(task.id); 
                console.log(`  -> [SAVED] Progress: ${downloadCount}/${TARGET_DOWNLOAD_COUNT} files. (Queue size: ${downloadQueue.length})`);
                resolve();
            });

            response.data.on('error', (err) => {
                writer.end(); //[cite: 1]
                fs.unlink(filePath, () => {}); //[cite: 1]
                resolve();
            });
            
            writer.on('error', () => {
                fs.unlink(filePath, () => {}); //[cite: 1]
                resolve();
            });
        });
    } catch (error) {
        // Fail silently and keep processing queue forward
    }

    isDownloading = false;
    // Tiny millisecond cooling break between file downloads
    setTimeout(processDownloadQueue, Math.floor(Math.random() * 400) + 200);
}

function findVideoUrls(obj, foundLinks = []) {
    if (!obj || typeof obj !== 'object') return foundLinks; //[cite: 1]
    
    if (obj.video_versions && Array.isArray(obj.video_versions) && obj.video_versions.length > 0) { //[cite: 1]
        const id = obj.id || obj.pk || Math.random().toString(36).substring(7); //[cite: 1]
        foundLinks.push({ url: obj.video_versions[0].url, id: id }); //[cite: 1]
    }
    
    for (const key in obj) { //[cite: 1]
        if (Object.prototype.hasOwnProperty.call(obj, key)) { //[cite: 1]
            findVideoUrls(obj[key], foundLinks); //[cite: 1]
        }
    }
    return foundLinks; //[cite: 1]
}

// ============================================================================
// AUTOMATION ENGINE
// ============================================================================
(async () => {
    console.log('Initializing Termux Android Native Scraper Pipeline...'); //[cite: 1]

    const browser = await chromium.launch({
        executablePath: CHROMIUM_PATH, //[cite: 1]
        headless: true, //[cite: 1]
        args: [
            '--no-sandbox', //[cite: 1]
            '--disable-setuid-sandbox', //[cite: 1]
            '--disable-dev-shm-usage', //[cite: 1]
            '--disable-gpu', //[cite: 1]
            '--disable-blink-features=AutomationControlled' //[cite: 1]
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36', //[cite: 1]
        viewport: { width: 390, height: 844 }, //[cite: 1]
        isMobile: true, //[cite: 1]
        hasTouch: true //[cite: 1]
    });

    if (fs.existsSync(COOKIES_FILE)) { //[cite: 1]
        const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8')); //[cite: 1]
        await context.addCookies(cookies); //[cite: 1]
        console.log('Successfully injected authenticated session cookies.'); //[cite: 1]
    } else {
        console.error('CRITICAL ERROR: cookies.json is missing!'); //[cite: 1]
    }

    const page = await context.newPage(); //[cite: 1]

    page.on('response', async (response) => {
        const url = response.url(); //[cite: 1]
        if (url.includes('/api/v1/clips/home/') || url.includes('graphql/query')) { //[cite: 1]
            try {
                const json = await response.json(); //[cite: 1]
                const targets = findVideoUrls(json); //[cite: 1]
                for (const target of targets) {
                    if (downloadCount >= TARGET_DOWNLOAD_COUNT) break; //[cite: 1]
                    
                    // Skip checking item if it's already logged in history
                    if (downloadedVideoIds.includes(target.id)) continue;

                    // Push directly to non-blocking background task worker
                    if (!downloadQueue.some(item => item.id === target.id)) {
                        console.log(`[QUEUE] Intercepted NEW Reel ID: ${target.id}`);
                        downloadQueue.push(target);
                        processDownloadQueue(); // Signal worker loop
                    }
                }
            } catch (e) {
                // Ignore parsing errors
            }
        }
    });

    try {
        console.log('Navigating directly to Reels target area...'); //[cite: 1]
        await page.goto('https://www.instagram.com/reels/', { //[cite: 1]
            waitUntil: 'networkidle', //[cite: 1]
            timeout: 60000 //[cite: 1]
        });
    } catch (gotoError) {
        console.log('⚠️  Navigation warning:', gotoError.message); //[cite: 1]
    }
    
    const finalUrl = page.url(); //[cite: 1]
    console.log(`Verified Browser Location: ${finalUrl}`); //[cite: 1]

    if (!finalUrl.includes('/reels/')) { //[cite: 1]
        console.error('❌ CRITICAL: Session cookies likely expired or invalid.'); //[cite: 1]
        await browser.close(); //[cite: 1]
        process.exit(1); //[cite: 1]
    }

    console.log('Connected to Algorithmic Feed Stream. Beginning automatic crawl loop...'); //[cite: 1]

    let lastDownloadCount = 0; //[cite: 1]
    let stuckCounter = 0; //[cite: 1]

    // ============================================================================
    // HUMANIZED CONTROL SCROLL LOOP (ANTI-DETECTION COMPLIANT)
    // ============================================================================
    while (downloadCount < TARGET_DOWNLOAD_COUNT) {
        
        if (downloadCount > 0 && downloadCount % 20 === 0) { //[cite: 1]
            const randomNapTime = Math.floor(Math.random() * 4000) + 2000; //[cite: 1]
            console.log(`\n☕ [HUMAN BREAK] Simulating stepping away for ${Math.round(randomNapTime/1000)}s...`); //[cite: 1]
            await page.waitForTimeout(randomNapTime); //[cite: 1]
            console.log('▶️  Resuming feed stream...\n'); //[cite: 1]
        }

        try {
            // Main Touch Drag Engine
            const startX = 195 + (Math.random() * 30 - 15); //[cite: 1]
            const startY = 680 + (Math.random() * 40 - 20); //[cite: 1]
            const endY = 130 + (Math.random() * 30 - 15); //[cite: 1]

            await page.mouse.move(startX, startY); //[cite: 1]
            await page.mouse.down(); //[cite: 1]
            await page.mouse.move(startX - (Math.random() * 12), 430, { steps: Math.floor(Math.random() * 3) + 4 }); //[cite: 1]
            await page.mouse.move(startX + (Math.random() * 8), endY, { steps: Math.floor(Math.random() * 3) + 4 }); //[cite: 1]
            await page.mouse.up(); //[cite: 1]
            
            console.log(`[TOUCH SWIPE] Crawled feed step. Saved items: ${downloadCount}/${TARGET_DOWNLOAD_COUNT}`);
        } catch (swipeError) {
            try { await page.evaluate(() => window.scrollBy(0, window.innerHeight)); } catch(e){} //[cite: 1]
        }

        // ============================================================================
        // HYBRID VIEWPORT STUCK RECOVERY ENGINE (WITH PATH CORRECTION)
        // ============================================================================
        if (downloadCount === lastDownloadCount) { //[cite: 1]
            stuckCounter++; //[cite: 1]
            
            if (stuckCounter > 2) { //[cite: 1]
                const currentUrl = page.url(); //[cite: 1]
                
                if (currentUrl.match(/\/reels\/[A-Za-z0-9_-]+\//)) { //[cite: 1]
                    console.log('⚠️  [PATH CORRECTION] Trapped inside a static Reel deep link context. Steering back to main stream...'); //[cite: 1]
                    try {
                        await page.evaluate(() => {
                            window.location.href = 'https://www.instagram.com/reels/'; //[cite: 1]
                        });
                        await page.waitForTimeout(4000); //[cite: 1]
                    } catch (urlErr) {}
                    stuckCounter = 0; //[cite: 1]
                    continue; //[cite: 1]
                }

                console.log('⚠️  [STUCK SEGMENT] Container tracking lost. Re-focusing viewport elements...'); //[cite: 1]
                try {
                    const focusX = 195 + Math.floor(Math.random() * 20 - 10); //[cite: 1]
                    const focusY = 400 + Math.floor(Math.random() * 20 - 10); //[cite: 1]
                    await page.mouse.click(focusX, focusY); //[cite: 1]
                    await page.waitForTimeout(400); //[cite: 1]

                    await page.keyboard.press('ArrowDown'); //[cite: 1]
                    console.log('     -> Sent native viewport snap signal (ArrowDown).'); //[cite: 1]
                    
                    await page.evaluate(() => {
                        const mainContainer = document.querySelector('main') || window; //[cite: 1]
                        mainContainer.scrollBy(0, window.innerHeight); //[cite: 1]
                    });
                } catch (scrollErr) {}
                stuckCounter = 0; //[cite: 1]
            }
        } else {
            stuckCounter = 0; //[cite: 1]
            lastDownloadCount = downloadCount; //[cite: 1]
        }
        
        // ============================================================================
        // ADVANCED BEHAVIORAL INTERACTION MATRIX (Slightly reduced base wait limits)
        // ============================================================================
        const behavioralRoll = Math.random(); //[cite: 1]
        let viewDelay = Math.floor(Math.random() * 2500) + 3500; // Optimized: Scaled down from 6-10s to 3.5-6s to increase crawling throughput safely
        
        if (behavioralRoll < 0.20) { //[cite: 1]
            viewDelay = Math.floor(Math.random() * 800) + 1200; //[cite: 1]
            console.log('  -> [BEHAVIOR] Simulating immediate rapid swipe-past...'); //[cite: 1]
            
        } else if (behavioralRoll > 0.82 && behavioralRoll <= 0.92) { //[cite: 1]
            console.log('  -> [BEHAVIOR] Simulating deeply engaged play session...'); //[cite: 1]
            try {
                const jitterX = 195 + Math.floor(Math.random() * 40 - 20); //[cite: 1]
                const jitterY = 422 + Math.floor(Math.random() * 40 - 20); //[cite: 1]
                
                await page.mouse.click(jitterX, jitterY); //[cite: 1]
                await page.waitForTimeout(Math.floor(Math.random() * 1500) + 1000); //[cite: 1]
                
                await page.evaluate(() => window.scrollBy(0, 120)); //[cite: 1]
                await page.waitForTimeout(Math.floor(Math.random() * 2000) + 2000); //[cite: 1]
                
                await page.evaluate(() => window.scrollBy(0, -120)); //[cite: 1]
                await page.waitForTimeout(Math.floor(Math.random() * 1000) + 1000); //[cite: 1]
                
                await page.mouse.click(jitterX, jitterY); //[cite: 1]
            } catch (err) {}
            viewDelay = Math.floor(Math.random() * 3000) + 4000;

        } else if (behavioralRoll > 0.92 && behavioralRoll <= 0.96) { //[cite: 1]
            console.log('  -> [BEHAVIOR] Simulating device slip / grip fumble behavior...'); //[cite: 1]
            try {
                const fumbleX = Math.random() < 0.5 ? (30 + Math.random() * 40) : (340 + Math.random() * 30); //[cite: 1]
                const fumbleY = 300 + Math.floor(Math.random() * 200); //[cite: 1]
                
                await page.mouse.move(fumbleX, fumbleY); //[cite: 1]
                await page.mouse.down(); //[cite: 1]
                await page.mouse.move(fumbleX + (Math.random() * 40 - 20), fumbleY - (Math.random() * 60 + 20), { steps: 2 }); //[cite: 1]
                await page.mouse.up(); //[cite: 1]
                console.log('     -> Unintentional screen swipe registered.'); //[cite: 1]
                
                const recoveryPause = Math.floor(Math.random() * 2500) + 2000; //[cite: 1]
                console.log(`     -> Pausing ${Math.round(recoveryPause/1000)}s for natural hand grip readjustment...`); //[cite: 1]
                await page.waitForTimeout(recoveryPause); //[cite: 1]
            } catch (err) {}
            viewDelay = Math.floor(Math.random() * 2000) + 2000; //[cite: 1]

        } else if (behavioralRoll > 0.96) { //[cite: 1]
            console.log('  -> [BEHAVIOR] Simulating profile context discovery tracking detour...'); //[cite: 1]
            try {
                const profileHandleX = 65 + Math.floor(Math.random() * 30 - 15); //[cite: 1]
                const profileHandleY = 745 + Math.floor(Math.random() * 20 - 10); //[cite: 1]
                
                await page.mouse.click(profileHandleX, profileHandleY); //[cite: 1]
                console.log('     -> Navigating away from main feed to examine profile grid details...'); //[cite: 1]
                
                await page.waitForTimeout(Math.floor(Math.random() * 3000) + 4000); //[cite: 1]
                
                await page.goBack({ waitUntil: 'domcontentloaded' }); //[cite: 1]
                console.log('     -> Executed native history navigation back. Returned to operational stream baseline.'); //[cite: 1]
            } catch (err) {}
            viewDelay = Math.floor(Math.random() * 3000) + 3000;
        }

        await page.waitForTimeout(viewDelay); //[cite: 1]
    }

    // Await outstanding queue clearance before exit context cleanly
    while(downloadQueue.length > 0 || isDownloading) {
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n🎉 Success! Processed session cap of ${downloadCount} fresh items into storage.`); //[cite: 1]
    await browser.close(); //[cite: 1]
})();
