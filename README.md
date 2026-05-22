# com.shi.instadowply
An app to download and watch instagram reels offline

# INSTALL
Install the player from [Releases](https://github.com/Gamingarc/com.shi.instadowply/releases/tag/v1.0)

Termux needed to run backend script
Download from
https://f-droid.org/en/packages/com.termux/
or
https://github.com/termux/termux-app/releases

```
pkg update && pkg upgrade -y
pkg install nodejs python x14-repo tur-repo build-essential binutils pango cairo libxi libxtst libxcomposite libxdamage alsa-lib nss freetype fontconfig chromium curl -y
termux-setup-storage
mkdir insta-bulk-grabber
cd insta-bulk-grabber
curl -o android_grabber.js https://raw.githubusercontent.com/Gamingarc/com.shi.instadowply/refs/heads/main/android_grabber.js
curl -o cookies.json https://raw.githubusercontent.com/Gamingarc/com.shi.instadowply/refs/heads/main/cookies.json
curl -o package.json https://raw.githubusercontent.com/Gamingarc/com.shi.instadowply/refs/heads/main/package.json
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright axios
```
Add your Session Id to the cookies.json

You can get the Session ID from signing in to instagram in kiwi browser and using cookie editor extension or by using a pc and finding it manually.

```
nano ~/insta-bulk-grabber/cookies.json
```
↓This is needed for the in-app button "Run Termux Engine" (NOTE: it will make the script run every time you open Termux)

```
nano $PREFIX/etc/bash.bashrc
```
↓Then add these line of codes after the last lines
```
clear                                                                 
echo "=== Engine Booted ==="         
cd ~/insta-bulk-grabber
node android_grabber.js & 
NODE_PID=$!
sleep 0.5
echo "Snapping back to InstaDowply..."
am start -n com.shi.instadowply/com.shi.instadowply.MainActivity
wait $NODE_PID
exit
```
Save and Exit (Ctrl+S , Ctrl +X)

# YOU CAN GET YOUR INSTA ACCOUNT FLAGGED/BANNED, USE THIS AT YOUR OWN RISK
*If your cookies get expired or flagged get a new one

*Updated script for better randomised human like behaviours to evade the flag.
*Fixed a bug in the script in which the reels tab get stuck in 10-12 count
