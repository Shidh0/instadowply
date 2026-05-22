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
const DOWNLOAD_FOLDER = '/storage/emulated/0/Reels';

const TARGET_DOWNLOAD_COUNT = 50; 
const MAX_HISTORY_SIZE = 5000; 

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

let downloadCount = 0;

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
// ROBUST DOWNLOAD ROUTINE WITH SAFE TIMING JITTER
// ============================================================================
async function downloadVideo(videoUrl, videoId) {
    if (downloadedVideoIds.includes(videoId)) {
        console.log(`  -> [SKIP] Reel ID ${videoId} already exists in history.json`);
        return; 
    }

    const filePath = path.join(DOWNLOAD_FOLDER, `reel_${videoId}.mp4`);
    console.log(`[QUEUE] Intercepted NEW Reel ID: ${videoId}`);

    try {
        const response = await axios({
            method: 'GET',
            url: videoUrl,
            responseType: 'stream',
            timeout: 20000, 
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                'Accept': '*/*'
            }
        });

        const writer = fs.createWriteStream(filePath);
        
        return new Promise((resolve) => {
            response.data.on('data', async (chunk) => {
                writer.write(chunk);
                if (Math.random() > 0.7) {
                    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 50) + 10));
                }
            });

            response.data.on('end', () => {
                writer.end();
            });

            writer.on('finish', () => {
                downloadCount++;
                saveToHistory(videoId); 
                console.log(`  -> [SAVED] Progress: ${downloadCount}/${TARGET_DOWNLOAD_COUNT} files.`);
                resolve();
            });

            response.data.on('error', (err) => {
                writer.end();
                fs.unlink(filePath, () => {}); 
                resolve();
            });
            
            writer.on('error', () => {
                fs.unlink(filePath, () => {});
                resolve();
            });
        });
    } catch (error) {
        // Fail silently and keep loop forward
    }
}

function findVideoUrls(obj, foundLinks = []) {
    if (!obj || typeof obj !== 'object') return foundLinks;
    
    if (obj.video_versions && Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
        const id = obj.id || obj.pk || Math.random().toString(36).substring(7);
        foundLinks.push({ url: obj.video_versions[0].url, id: id });
    }
    
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            findVideoUrls(obj[key], foundLinks);
        }
    }
    return foundLinks;
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
            '--disable-blink-features=AutomationControlled'
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
        if (url.includes('/api/v1/clips/home/') || url.includes('graphql/query')) {
            try {
                const json = await response.json();
                const targets = findVideoUrls(json);
                for (const target of targets) {
                    if (downloadCount >= TARGET_DOWNLOAD_COUNT) break;
                    await downloadVideo(target.url, target.id);
                }
            } catch (e) {
                // Ignore parsing errors
            }
        }
    });

    try {
        console.log('Navigating directly to Reels target area...');
        await page.goto('https://www.instagram.com/reels/', { 
            waitUntil: 'networkidle', 
            timeout: 60000 
        });
    } catch (gotoError) {
        console.log('⚠️ Navigation warning:', gotoError.message);
    }
    
    const finalUrl = page.url();
    console.log(`Verified Browser Location: ${finalUrl}`);

    if (!finalUrl.includes('/reels/')) {
        console.error('❌ CRITICAL: Session cookies likely expired or invalid.');
        await browser.close();
        process.exit(1);
    }

    console.log('Connected to Algorithmic Feed Stream. Beginning automatic crawl loop...');

    let lastDownloadCount = 0;
    let stuckCounter = 0;

    // ============================================================================
    // HUMANIZED CONTROL SCROLL LOOP (ANTI-DETECTION COMPLIANT)
    // ============================================================================
    while (downloadCount < TARGET_DOWNLOAD_COUNT) {
        
        if (downloadCount > 0 && downloadCount % 20 === 0) {
            const randomNapTime = Math.floor(Math.random() * 40000) + 50000; 
            console.log(`\n☕ [HUMAN BREAK] Simulating stepping away for ${Math.round(randomNapTime/1000)}s...`);
            await page.waitForTimeout(randomNapTime);
            console.log('▶️ Resuming feed stream...\n');
        }

        try {
            // Main Touch Drag Engine
            const startX = 195 + (Math.random() * 30 - 15); 
            const startY = 680 + (Math.random() * 40 - 20); 
            const endY = 130 + (Math.random() * 30 - 15);

            await page.mouse.move(startX, startY);
            await page.mouse.down();
            await page.mouse.move(startX - (Math.random() * 12), 430, { steps: Math.floor(Math.random() * 3) + 4 });
            await page.mouse.move(startX + (Math.random() * 8), endY, { steps: Math.floor(Math.random() * 3) + 4 });
            await page.mouse.up();
            
            console.log(`[TOUCH SWIPE] Progress this session: ${downloadCount}/${TARGET_DOWNLOAD_COUNT}`);
        } catch (swipeError) {
            try { await page.evaluate(() => window.scrollBy(0, window.innerHeight)); } catch(e){}
        }

        // ============================================================================
        // HYBRID VIEWPORT STUCK RECOVERY ENGINE (WITH PATH CORRECTION)
        // ============================================================================
        if (downloadCount === lastDownloadCount) {
            stuckCounter++;
            
            if (stuckCounter > 2) {
                const currentUrl = page.url();
                
                // DETECT STATIC LINK BLOCKS: If we are trapped inside an individual item page layout path
                if (currentUrl.match(/\/reels\/[A-Za-z0-9_-]+\//)) {
                    console.log('⚠️ [PATH CORRECTION] Trapped inside a static Reel deep link context. Steering back to main stream...');
                    try {
                        // Use a history state redirect instead of a hard page.reload() to remain secure
                        await page.evaluate(() => {
                            window.location.href = 'https://www.instagram.com/reels/';
                        });
                        await page.waitForTimeout(4000); // Allow container to shift contexts cleanly
                    } catch (urlErr) {}
                    stuckCounter = 0;
                    continue;
                }

                console.log('⚠️ [STUCK SEGMENT] Container tracking lost. Re-focusing viewport elements...');
                try {
                    const focusX = 195 + Math.floor(Math.random() * 20 - 10);
                    const focusY = 400 + Math.floor(Math.random() * 20 - 10);
                    await page.mouse.click(focusX, focusY);
                    await page.waitForTimeout(400);

                    await page.keyboard.press('ArrowDown');
                    console.log('     -> Sent native viewport snap signal (ArrowDown).');
                    
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
        }
        
        // ============================================================================
        // ADVANCED BEHAVIORAL INTERACTION MATRIX
        // ============================================================================
        const behavioralRoll = Math.random();
        let viewDelay = Math.floor(Math.random() * 4000) + 6000; 
        
        if (behavioralRoll < 0.20) {
            viewDelay = Math.floor(Math.random() * 800) + 1200; 
            console.log('  -> [BEHAVIOR] Simulating immediate rapid swipe-past...');
            
        } else if (behavioralRoll > 0.82 && behavioralRoll <= 0.92) {
            console.log('  -> [BEHAVIOR] Simulating deeply engaged play session...');
            try {
                const jitterX = 195 + Math.floor(Math.random() * 40 - 20);
                const jitterY = 422 + Math.floor(Math.random() * 40 - 20);
                
                await page.mouse.click(jitterX, jitterY); 
                await page.waitForTimeout(Math.floor(Math.random() * 1500) + 1000);
                
                await page.evaluate(() => window.scrollBy(0, 120)); 
                await page.waitForTimeout(Math.floor(Math.random() * 2000) + 2000);
                
                await page.evaluate(() => window.scrollBy(0, -120)); 
                await page.waitForTimeout(Math.floor(Math.random() * 1000) + 1000);
                
                await page.mouse.click(jitterX, jitterY); 
            } catch (err) {}
            viewDelay = Math.floor(Math.random() * 4000) + 6000;

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
                
                await page.mouse.click(profileHandleX, profileHandleY);
                console.log('     -> Navigating away from main feed to examine profile grid details...');
                
                await page.waitForTimeout(Math.floor(Math.random() * 3000) + 4000);
                
                await page.goBack({ waitUntil: 'domcontentloaded' });
                console.log('     -> Executed native history navigation back. Returned to operational stream baseline.');
            } catch (err) {}
            viewDelay = Math.floor(Math.random() * 4000) + 4000;
        }

        await page.waitForTimeout(viewDelay);
    }

    console.log(`\n🎉 Success! Processed session cap of ${downloadCount} fresh items into storage.`);
    await browser.close();
})();
