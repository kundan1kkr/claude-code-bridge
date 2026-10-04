#!/bin/bash
# ==============================================================================
# All-in-One Controller: Claude Proxy Bridge & Dashboard
# ==============================================================================

DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_BIN="$DIR/.venv_litellm/bin/python"

if [ -f "$DIR/litellm_config.yaml" ]; then
    CONFIG_PATH="$DIR/litellm_config.yaml"
elif [ -f "$DIR/dahl_litellm_config.yaml" ]; then
    CONFIG_PATH="$DIR/dahl_litellm_config.yaml"
elif [ -f "$DIR/litellm_config.example.yaml" ]; then
    cp "$DIR/litellm_config.example.yaml" "$DIR/litellm_config.yaml"
    CONFIG_PATH="$DIR/litellm_config.yaml"
else
    CONFIG_PATH="$DIR/litellm_config.yaml"
fi

PROXY_LOG="$DIR/proxy.log"
UI_LOG="$DIR/ui.log"
PROXY_PORT=4000
UI_PORT=4001

if [ ! -f "$PYTHON_BIN" ]; then
    if [ -f "$DIR/requirements.txt" ]; then
        echo "⚙️  First-time setup: Creating Python virtual environment (.venv_litellm)..."
        python3 -m venv "$DIR/.venv_litellm"
        "$DIR/.venv_litellm/bin/python" -m pip install -q --upgrade pip
        "$DIR/.venv_litellm/bin/python" -m pip install -q -r "$DIR/requirements.txt"
        echo "✓ Dependencies installed successfully."
    else
        PYTHON_BIN="python3"
    fi
fi

status_check() {
    local proxy_up=false
    local ui_up=false

    if nc -z localhost $PROXY_PORT 2>/dev/null; then
        proxy_up=true
    fi
    if nc -z localhost $UI_PORT 2>/dev/null; then
        ui_up=true
    fi

    echo "--------------------------------------------------------"
    echo "📊 Service Status:"
    if [ "$proxy_up" = true ]; then
        echo "  🟢 LiteLLM Proxy Bridge : ACTIVE (http://localhost:$PROXY_PORT)"
    else
        echo "  🔴 LiteLLM Proxy Bridge : STOPPED"
    fi

    if [ "$ui_up" = true ]; then
        echo "  🟢 Web Dashboard UI    : ACTIVE (http://localhost:$UI_PORT)"
    else
        echo "  🔴 Web Dashboard UI    : STOPPED"
    fi
    echo "--------------------------------------------------------"
}

stop_services() {
    echo "⏹ Stopping all services..."
    lsof -ti :$PROXY_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
    lsof -ti :$UI_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
    sleep 1
    echo "✓ All services stopped."
}

start_services() {
    echo "========================================================"
    echo "🚀 Starting Claude Proxy Bridge & Dashboard..."
    echo "========================================================"

    # 1. Start LiteLLM Proxy Bridge on Port 4000
    if nc -z localhost $PROXY_PORT 2>/dev/null; then
        echo "ℹ️ LiteLLM Proxy is already running on port $PROXY_PORT."
    else
        echo "⏳ Launching LiteLLM Proxy (Port $PROXY_PORT)..."
        BRIDGE_CONFIG_PATH="$CONFIG_PATH" "$PYTHON_BIN" "$DIR/start_proxy.py" --config "$CONFIG_PATH" --port $PROXY_PORT > "$PROXY_LOG" 2>&1 &
        PROXY_PID=$!
        
        # Wait up to 6 seconds for proxy to become ready
        for i in {1..12}; do
            if nc -z localhost $PROXY_PORT 2>/dev/null; then
                break
            fi
            sleep 0.5
        done
        echo "✓ LiteLLM Proxy active (PID: $PROXY_PID)"
    fi

    # 2. Start Web Management UI on Port 4001
    if nc -z localhost $UI_PORT 2>/dev/null; then
        echo "ℹ️ Web UI Dashboard is already running on port $UI_PORT."
    else
        echo "⏳ Launching Management UI (Port $UI_PORT)..."
        "$PYTHON_BIN" "$DIR/proxy_ui.py" > "$UI_LOG" 2>&1 &
        UI_PID=$!

        # Wait up to 6 seconds for UI to become ready
        for i in {1..12}; do
            if nc -z localhost $UI_PORT 2>/dev/null; then
                break
            fi
            sleep 0.5
        done
        echo "✓ Web UI active (PID: $UI_PID)"
    fi

    echo ""
    status_check
    echo ""

    # 3. Open Web UI in browser
    echo "🌐 Opening Dashboard in browser..."
    open "http://localhost:$UI_PORT" 2>/dev/null || true

    echo ""
    echo "💡 Everything is up and running!"
    echo "   • Dashboard UI : http://localhost:$UI_PORT"
    echo "   • Proxy Port   : http://localhost:$PROXY_PORT"
    echo ""
    echo "👉 To run Claude Code in ANY folder:"
    echo "   ./run_claude.sh"
    echo "========================================================"
}

case "$1" in
    stop)
        stop_services
        ;;
    restart)
        stop_services
        start_services
        ;;
    status)
        status_check
        ;;
    *)
        start_services
        ;;
esac
