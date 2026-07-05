#!/bin/bash

echo "============================================="
echo "   Starting Insta-Bulk-Grabber Setup        "
echo "============================================="

# 1. Update and install repository extensions
echo "Updating packages and setting up additional repos..."
pkg update && pkg upgrade -y
pkg install nodejs python x11-repo tur-repo curl -y

# 2. Install all system dependencies and Chromium (Corrected for Termux)
echo "Installing build essentials and system UI libraries..."
pkg install build-essential binutils freetype fontconfig chromium -y

# Install the specific X11/graphics libraries with proper Termux naming
pkg install libcairo libpango libxi libxtst libxcomposite libxdamage alsa-lib -y

# 3. Request storage access if not already granted
echo "Requesting storage permissions..."
termux-setup-storage

# 4. Create directory and download necessary files
echo "Downloading project core files..."
mkdir -p ~/insta-bulk-grabber
cd ~/insta-bulk-grabber

curl -o android_grabber.js https://raw.githubusercontent.com/Shidh0/instadowply/refs/heads/main/android_grabber.js
curl -o cookies.json https://raw.githubusercontent.com/Shidh0/instadowply/refs/heads/main/cookies.json
curl -o package.json https://raw.githubusercontent.com/Shidh0/instadowply/refs/heads/main/package.json
curl -o package-lock.json https://raw.githubusercontent.com/Shidh0/instadowply/refs/heads/main/package-lock.json
curl -o configure.sh https://raw.githubusercontent.com/Shidh0/instadowply/refs/heads/main/configure.sh
curl -o Update.sh https://raw.githubusercontent.com/Shidh0/instadowply/refs/heads/main/Update.sh

# 5. Set appropriate permissions
chmod +x ~/insta-bulk-grabber/configure.sh
chmod +x ~/insta-bulk-grabber/Update.sh

# 6. Install Node modules with Playwright adjustments
echo "Installing Node packages (Skipping heavy browser bundle)..."
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright axios

# 7. Dynamic Warning Prompt before modifying bash.bashrc
echo ""
echo "⚠️  CRITICAL WARNING: TERMUX AUTOMATION SETUP ⚠️"
echo "--------------------------------------------------------"
echo "This step injects the startup script directly into Termux."
echo "Every single time you open Termux, it will automatically"
echo "launch the grabber and try to snap back to the app."
echo ""
echo "👉 ONLY PROCEED IF:"
echo "1. You do not plan to use Termux for anything else, OR"
echo "2. You are comfortable pressing 'Ctrl + C' quickly every"
echo "   time Termux opens to stop the script manually."
echo ""
echo "⚠️ NOTE: If you skip this part, the 'Start Script' button"
echo "   inside the InstaDowply app WILL NOT work."
echo "--------------------------------------------------------"
read -p "Do you want to enable this auto-start feature? (y/n): " confirm_boot

if [[ "$confirm_boot" =~ ^[Yy]$ ]]; then
    echo "Injecting boot routine into Termux start scripts..."
    cat << 'BASHRC_EOF' >> $PREFIX/etc/bash.bashrc

# --- Insta-Bulk-Grabber Automation ---
clear
echo "=== Engine Booted ==="
termux-open "instadowply://open"         
cd ~/insta-bulk-grabber
node android_grabber.js & 
NODE_PID=$!
echo "Snapping back to InstaDowply..."
wait $NODE_PID
exit
BASHRC_EOF
    echo "✅ Auto-start configuration successfully added to bash.bashrc."
else
    echo "⏭️  Skipped auto-start configuration. Your bash.bashrc was left untouched."
fi

echo ""

# 8. Fire up the configuration script right at the end of the installation
echo "Running initial configuration sequence..."
~/insta-bulk-grabber/configure.sh

echo "============================================="
echo "        Setup Successfully Completed!        "
echo "============================================="
