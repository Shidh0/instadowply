# Instadowply
An app to download and watch instagram fyp reels  offline
# Contents
* [Overview](#Overview)
* [Installation](#Install)
  - [Android](#Android)
  - [Windows](#Windows)
  - [Lunix](#Lunix)
* [Warnings](#use-this-with-caution)
* [Script Update Notes](#script-updates)
* [Upcoming Features](#upcoming-features)
# Overview 
* App/Player👇🏻
  
<img width="720" height="1493" alt="IMG_20260710_161153" src="https://github.com/user-attachments/assets/093ed4c1-cd96-4e1d-b62b-ddb0e5866976" />

<img width="720" height="1498" alt="IMG_20260710_161305" src="https://github.com/user-attachments/assets/f530d5f7-445a-4b94-acc8-3f818c1cedc7" />

<img width="720" height="1501" alt="IMG_20260710_161355" src="https://github.com/user-attachments/assets/bdbe9039-6104-4faf-8308-dcfc7eba5cb4" />


* Termux/script👇🏻

<img width="532" height="354" alt="1000044072" src="https://github.com/user-attachments/assets/2a3af4c8-9e21-4dae-9d02-9c9857edebfe" />
<img width="720" height="1294" alt="1000068287" src="https://github.com/user-attachments/assets/6cff3bf4-b148-4054-a14d-19f0e4c56580" />
<img width="720" height="1347" alt="1000068286" src="https://github.com/user-attachments/assets/848e7fe3-587a-4124-a7a8-071169181458" />


# INSTALL

   ## Android
Install the player from [Releases](https://github.com/Shidh0/instadowply/releases/latest)

Termux needed to run backend script
Download from:

[FDroid](https://f-droid.org/en/packages/com.termux/)

or

[GitHub](https://github.com/termux/termux-app/releases)

In Termux run these commands
```bash
curl -o setup_grabber.sh https://raw.githubusercontent.com/Shidh0/instadowply/refs/heads/main/setup_grabber.sh
chmod +x ~/setup_grabber.sh
~/setup_grabber.sh
```
* If you want to you can add your Session Id and download count (how many reels to download in one session) later also , using
```bash
~/insta-bulk-grabber/configure.sh
```
* You can get the Session ID from signing in to instagram in Kiwi Browser Or [Mozilla Firefox](https://play.google.com/store/apps/details?id=org.mozilla.firefox) and using cookie editor extension or by using a pc and finding it manually.
* 
You can update the script by running 
  ```bash
  ~/insta-bulk-grabber/Update.sh
  ```
* NOTE:If you want to exit/stop downloading half way just open termux and do Ctrl+c.
   ## Windows
  NOTE: Windows version is not actively maintained (bcus i don't have a pc lol)
  
   Node js needed for the script install it from [Node js Download](https://nodejs.org/en/download)
Then run terminal and paste these
```bash
mkdir insta-bulk-grabber
cd insta-bulk-grabber
curl -o windows_grabber.js https://raw.githubusercontent.com/Shidh0/instadowply/refs/heads/main/Windows/windows_grabber.js
curl -o cookies.json https://raw.githubusercontent.com/Shidh0/instadowply/refs/heads/main/cookies.json
curl -o package.json https://raw.githubusercontent.com/Shidh0/instadowply/refs/heads/main/Windows/package.json
npm run setup
```
## Lunix
 Just do same a Windows but run this also
 ```bash
npx playwright install chromium --with-deps
```
# USE THIS WITH CAUTION 
 * Try to use a alt/spare/burner account for this script just for safety, Don't use your main account.
 * I have used this script for quite some time and downloaded around 7500+ reels without any problem.
# Script Updates
* Fixed a bug in the script in which the reels tab get stuck in 10-12 count
* Improved download speed and added asynchronous downloads.
* Added parallel downloading to up to 3 reels at a time
* Added a Queue backlog file that get created when you Ctrl+C to interrupt the script
* Added some fixes to save bandwidth and increase speed.
* some fixes (im lazy..)

# Upcoming Features
 * ~~Comments~~
 * Open in Instagram/browser
 * Share
 * Copy reel link
 * Repost (not sure)
 * Save in Instagram (not sure)
 * Intrested/Not Interested button(instagram sync)
 * Many more..
