#!/bin/bash
# Launcher for Claude Proxy Bridge Management Dashboard

DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_BIN="$DIR/.venv_litellm/bin/python"
PORT=4001

echo "========================================================"
echo "⚡ Starting Claude Proxy Bridge Management Dashboard..."
echo "========================================================"

# Check if port 4001 is already running
if nc -z localhost $PORT 2>/dev/null; then
    echo "UI Dashboard is already running on http://localhost:$PORT"
    open "http://localhost:$PORT" 2>/dev/null || true
    exit 0
fi

# Run the UI server in background
"$PYTHON_BIN" "$DIR/proxy_ui.py" > "$DIR/ui.log" 2>&1 &
UI_PID=$!
echo "Dashboard launched (PID: $UI_PID)"
sleep 1

# Open in default browser
open "http://localhost:$PORT" 2>/dev/null || true

echo "Dashboard running at: http://localhost:$PORT"
echo "Proxy translation port: http://localhost:4000"
