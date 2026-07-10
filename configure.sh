#!/bin/bash

# Define paths
DIR="$HOME/insta-bulk-grabber"
GRABBER_FILE="$DIR/android_grabber.js"
COOKIES_FILE="$DIR/cookies.json"

echo "============================================="
echo "   Insta Bulk Grabber Configurator          "
echo "============================================="
echo ""

# 1. Ask about Download Count
read -p "Do you want to update the Download Count? (y/n): " edit_count
if [[ "$edit_count" =~ ^[Yy]$ ]]; then
    if [ -f "$GRABBER_FILE" ]; then
        read -p "Enter new target download count: " new_count
        # Basic validation to ensure it's a number
        if [[ "$new_count" =~ ^[0-9]*$ ]]; then
            # Uses sed to look for the pattern and replace whatever number is currently there
            sed -i "s/const TARGET_DOWNLOAD_COUNT = [0-9]*;/const TARGET_DOWNLOAD_COUNT = $new_count;/g" "$GRABBER_FILE"
            echo "✅ Successfully updated download count to $new_count in Android_grabber.js"
        else
            echo "❌ Invalid number. Skipping download count update."
        fi
    else
        echo "❌ Error: Android_grabber.js not found!"
    fi
fi

echo ""

# 2. Ask about Cookies/Session ID
read -p "Do you want to update your Cookies / Session ID? (y/n): " edit_cookies
if [[ "$edit_cookies" =~ ^[Yy]$ ]]; then
    if [ -f "$COOKIES_FILE" ]; then
        read -p "Enter your new Session ID / Cookie text: " new_cookie
        # Replaces "value": "..." with the user's input
        sed -i "s/\"value\": \"[^\"]*\"/\"value\": \"$new_cookie\"/g" "$COOKIES_FILE"
        echo "✅ Successfully updated Session ID in cookies.json"
    else
        echo "❌ Error: cookies.json not found!"
    fi
fi
# 3. Ask about Launch Intent Execution Mode
echo "3. Termux Intent Launch Configuration"
read -p "Do you want to switch or update your Termux Launch Intent mode? (y/n): " edit_intent
if [[ "$edit_intent" =~ ^[Yy]$ ]]; then
    echo "Select Execution Layout:"
    echo "1) Background Intent Mode (Runs script invisibly and streams logs)"
    echo "2) Foreground Launch Mode (Executes script directly in terminal and closes)"
    read -p "Enter layout path choice (1 or 2): " intent_choice

    BASHRC="$PREFIX/etc/bash.bashrc"
    
    # Clean out any old, messy iterations of the automation blocks first
    if [ -f "$BASHRC" ]; then
        sed -i '/# --- Insta-Bulk-Grabber Automation ---/,/BASHRC_END/d' "$BASHRC"
        sed -i '/# --- Insta-Bulk-Grabber Automation ---/,$d' "$BASHRC" 2>/dev/null
    fi

    if [ "$intent_choice" == "1" ]; then
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
        echo "✅ Successfully assigned execution routine to Background Intent Mode!"
    elif [ "$intent_choice" == "2" ]; then
        cat << 'BASHRC_EOF' >> "$BASHRC"

# --- Insta-Bulk-Grabber Automation ---
clear
echo "----Starting downloads----"
node insta-bulk-grabber/android_grabber.js&
NODE_PID=$!
wait $NODE_PID
exit
# BASHRC_END
BASHRC_EOF
        echo "✅ Successfully assigned execution routine to Foreground Launch Mode!"
    else
        echo "❌ Invalid configuration choice selection. Intent script unchanged."
    fi
fi
echo ""
echo "Configuration complete!"
