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
mkdir -p ~/.termux
if ! grep -q "allow-external-apps = true" ~/.termux/termux.properties 2>/dev/null; then
    echo "allow-external-apps = true" >> ~/.termux/termux.properties
fi

# 4. Create directory and download necessary files
echo "Downloading project core files..."
curl -o sync_reels.sh https://raw.githubusercontent.com/Shidh0/instadowply/refs/heads/main/sync_reels.sh
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
chmod +x ~/sync_reels.sh

# 6. Install Node modules with Playwright adjustments
echo "Installing Node packages (Skipping heavy browser bundle)..."
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright axios

# 7. Dynamic Warning Prompt before modifying bash.bashrc
echo ""
echo " TERMUX AUTOMATION SETUP "
echo "--------------------------------------------------------"
echo "This step injects the log script directly into Termux."
echo "Every single time you open Termux, it will automatically"
echo "launch the log viewer."
echo "(You can Ctrl+C to exit the log viewer and exit the reel downloader.)"
echo ""
echo " NOTE: If you skip this part, the 'Start Script' button"
echo "   inside the InstaDowply app Won't work."
echo "--------------------------------------------------------"
read -p "Do you want to enable this feature? (y/n): " confirm_boot
if [[ "$confirm_boot" =~ ^[Yy]$ ]]; then
    echo "Injecting boot routine into Termux start scripts..."
    BASHRC="$PREFIX/etc/bash.bashrc"
    
    # Wipe any existing automation layout sections safely
    if [ -f "$BASHRC" ]; then
        sed -i '/# --- Insta-Bulk-Grabber Automation ---/,/BASHRC_END/d' "$BASHRC"
    fi

    cat << 'BASHRC_EOF' >> "$BASHRC"

# --- Insta-Bulk-Grabber Automation ---
clear
grablog() {
    trap "pkill -TERM -f 'node android_grabber.js'; clear" SIGINT
    clear
    tail -f insta-bulk-grabber/live_crawler.log
    trap - SIGINT
}
grablog
# BASHRC_END
BASHRC_EOF
    echo "✅ Configuration successfully added to bash.bashrc."
else
    echo "⏭️  Skipped Configuration. Your bash.bashrc was left untouched."
fi

echo ""

# 8. Fire up the configuration script right at the end of the installation
echo "Running initial configuration sequence..."
~/insta-bulk-grabber/configure.sh

echo "============================================="
echo "        Setup Successfully Completed!        "
echo "============================================="
termux-reload-settings
