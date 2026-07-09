#!/bin/bash
cd ~/insta-bulk-grabber

cleanup_all() {
    echo "🛑 Notification exit detected. Triggering graceful backlog dump..."
    
    # 1. Fire the exact pkill command you found that triggers the Node save state
    pkill -TERM -f "node android_grabber.js"
    
    # 2. Give Node 3 seconds to finish writing queue_backlog.json to your storage
    sleep 3
    
    # 3. Sweep up any ghost browser processes and drop the wake lock
    pkill -f "chromium-browser" 2>/dev/null
    exit
}

# Catch the notification exit signals
trap cleanup_all EXIT INT TERM SIGHUP

# 🎯 THE FIX: 'nohup' shields Node from the notification crash signal,
# allowing our trap above to shut it down gracefully using pkill.
nohup node android_grabber.js > live_crawler.log 2>&1 &

NODE_PID=$!
wait $NODE_PID