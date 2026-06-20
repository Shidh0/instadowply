# Instadowply
An app to download and watch instagram reels offline

* App/Player👇🏻
  
<img width="720" height="1506" alt="1000051247" src="https://github.com/user-attachments/assets/48d0636f-3173-4201-a992-20f5a1f08af5" />

<img width="711" height="1486" alt="1000053017" src="https://github.com/user-attachments/assets/91e8aa5c-6392-4f94-ae42-750f68a7a906" />


<img width="720" height="1491" alt="1000053015" src="https://github.com/user-attachments/assets/1bcd5c19-646f-429e-aef4-ba173fa60e55" />

* Termux/script👇🏻

<img width="532" height="354" alt="1000044072" src="https://github.com/user-attachments/assets/2a3af4c8-9e21-4dae-9d02-9c9857edebfe" />


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
* You can get the Session ID from signing in to instagram in [Kiwi Browser](https://play.google.com/store/apps/details?id=secure.unblock.unlimited.proxy.snap.hotspot.shield) and using cookie editor extension or by using a pc and finding it manually.
* 
You can update the script by running 
  ```bash
  ~/insta-bulk-grabber/Update.sh
  ```
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
 * The Reels might get a little not to your liking after some time (4-7 Days) so keep opening the Insta and like/save/share/repost the stuff you like to recalibrate the algorithm.
 * I have used this script for quite some time and downloaded around 2500+ reels without any problem as you can see in the image on top.
# Script Updates
* Fixed a bug in the script in which the reels tab get stuck in 10-12 count
* Improved download speed and added asynchronous downloads.
* Added parallel downloading to up to 3 reels at a time
* Added a Queue backlog file that get created when you Ctrl+C to interrupt the script
* Added some fixes to save bandwidth and increase speed.
