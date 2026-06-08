# Instadowply
An app to download and watch instagram reels offline

<img width="720" height="1535" alt="1000044063" src="https://github.com/user-attachments/assets/bc819e96-a4b9-4388-834f-ce565249247c" />

<img width="720" height="1494" alt="1000044068" src="https://github.com/user-attachments/assets/a26d34cc-2b22-4a10-bcb5-c7c3ec5a601d" />

# INSTALL
Install the player from [Releases]()

Termux needed to run backend script
Download from
https://f-droid.org/en/packages/com.termux/
or
https://github.com/termux/termux-app/releases

```
pkg install nodejs python x14-repo tur-repo -y
pkg update && pkg upgrade -y
pkg install build-essential binutils pango cairo libxi libxtst libxcomposite libxdamage alsa-lib nss freetype fontconfig chromium curl -y
termux-setup-storage
mkdir insta-bulk-grabber
cd insta-bulk-grabber
curl -o android_grabber.js https://raw.githubusercontent.com/Gamingarc16/instadowply/refs/heads/main/android_grabber.js
curl -o cookies.json https://raw.githubusercontent.com/Gamingarc16/instadowply/refs/heads/main/cookies.json
curl -o package.json https://raw.githubusercontent.com/Gamingarc16/instadowply/refs/heads/main/package.json
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

# USE THIS AT YOUR OWN RISK
 * The Reels might get a little not to your liking after some time (4-7 Days) so keep opening the Insta and like/save/share/repost the stuff you like to recalibrate the algorithm.
 * Also try to use a alt/spare/burner account for this script just for safety, Don't use your main account.
# Updates
* Fixed a bug in the script in which the reels tab get stuck in 10-12 count
* Improved download speed and added asynchronous downloads.
