#!/bin/bash

echo "============================================="
echo "   Starting Insta-Bulk-Grabber Setup        "
echo "============================================="

# 1. Update and install repository extensions
echo "Updating packages and setting up additional repos..."
pkg update && pkg upgrade -y
pkg install nodejs python x11-repo tur-repo -y

# 2. Install all system dependencies and Chromium
echo "Installing build essentials and system UI libraries..."
pkg install build-essential binutils pango cairo libxi libxtst libxcomposite libxdamage alsa-lib nss freetype fontconfig chromium curl -y

# 3. Request storage access if not already granted
echo "Requesting storage permissions..."
termux-setup-storage

# 4. Create directory and download necessary files
echo "Downloading project core files..."
mkdir -p ~/insta-bulk-grabber
cd ~/insta-bulk-grabber

curl -o android_grabber.js https://raw.githubusercontent.com/Gamingarc16/instadowply/refs/heads/main/android_grabber.js
curl -o cookies.json https://raw.githubusercontent.com/Gamingarc16/instadowply/refs/heads/main/cookies.json
curl -o package.json https://raw.githubusercontent.com/Gamingarc16/instadowply/refs/heads/main/package.json
curl -o configure.sh https://raw.githubusercontent.com/Gamingarc16/instadowply/refs/heads/main/configure.sh

# 5. Set appropriate permissions
chmod +x ~/insta-bulk-grabber/configure.sh

# 6. Install Node modules with Playwright adjustments
echo "Installing Node packages (Skipping heavy browser bundle)..."
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright axios

# 7. Append the boot routine to bash.bashrc so it runs automatically on every Termux launch
echo "Injecting boot routine into Termux start scripts..."
cat << 'BASHRC_EOF' >> $PREFIX/etc/bash.bashrc

# --- Insta-Bulk-Grabber Automation ---
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
BASHRC_EOF

# 8. Fire up the configuration script right at the end of the installation
echo "Running initial configuration sequence..."
~/insta-bulk-grabber/configure.sh

echo "============================================="
echo "        Setup Successfully Completed!        "
echo "============================================="
