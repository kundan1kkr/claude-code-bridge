#!/bin/bash
# ==============================================================================
# Claude Proxy Bridge — Active Model Checker
# Usage:
#   ./which_model.sh        -> Show current configured & last active model
#   ./which_model.sh --live -> Watch model usage live as Claude makes requests
# ==============================================================================

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$DIR/litellm_config.yaml" ]; then
    CONFIG_PATH="$DIR/litellm_config.yaml"
elif [ -f "$DIR/dahl_litellm_config.yaml" ]; then
    CONFIG_PATH="$DIR/dahl_litellm_config.yaml"
elif [ -f "$DIR/litellm_config.example.yaml" ]; then
    CONFIG_PATH="$DIR/litellm_config.example.yaml"
else
    CONFIG_PATH="$DIR/litellm_config.yaml"
fi

PROXY_LOG="$DIR/proxy.log"

if [ "$1" == "--live" ] || [ "$1" == "-f" ] || [ "$1" == "--watch" ]; then
    echo "======================================================================"
    echo "👀 LIVE MODEL ROUTING MONITOR (Press Ctrl+C to stop)"
    echo "======================================================================"
    echo "Listening for requests from Claude Code & Claude Desktop..."
    echo ""
    tail -f "$PROXY_LOG" 2>/dev/null | grep --line-buffered -E "MODEL ACTIVE|FALLBACK ROUTE"
    exit 0
fi

echo "======================================================================"
echo "🤖 CLAUDE PROXY BRIDGE — ACTIVE MODEL STATUS"
echo "======================================================================"

# 1. Check Service Health
if nc -z localhost 4000 2>/dev/null; then
    echo "🟢 Proxy Service : ONLINE (http://localhost:4000)"
else
    echo "🔴 Proxy Service : OFFLINE (Run ./start_all.sh to start)"
fi

if nc -z localhost 4001 2>/dev/null; then
    echo "🟢 Web Dashboard : ONLINE (http://localhost:4001)"
else
    echo "🟡 Web Dashboard : OFFLINE"
fi
echo "----------------------------------------------------------------------"

# 2. Get Configured Primary Model from YAML
PRIMARY_MODEL=$(grep -A 4 "model_name: default" "$CONFIG_PATH" 2>/dev/null | grep "model:" | head -n 1 | awk '{print $2}' | sed 's/openai\///')
PRIMARY_BASE=$(grep -A 4 "model_name: default" "$CONFIG_PATH" 2>/dev/null | grep "api_base:" | head -n 1 | awk '{print $2}')

if [ -n "$PRIMARY_MODEL" ]; then
    echo "📌 Configured Primary Model : $PRIMARY_MODEL"
    echo "🌐 Provider Endpoint        : $PRIMARY_BASE"
else
    echo "📌 Configured Primary Model : (Loading / Unknown)"
fi

echo "----------------------------------------------------------------------"

# 3. Get Last Successfully Processed Request from Logs
LAST_SUCCESS=$(grep "MODEL ACTIVE" "$PROXY_LOG" 2>/dev/null | tail -n 1)

if [ -n "$LAST_SUCCESS" ]; then
    echo "⚡ Last Request Served:"
    echo "   $LAST_SUCCESS"
else
    echo "⚡ Last Request Served: No requests recorded yet."
fi

# 4. Check if any fallback was recently triggered
LAST_FALLBACK=$(grep "FALLBACK ROUTE" "$PROXY_LOG" 2>/dev/null | tail -n 1)
if [ -n "$LAST_FALLBACK" ]; then
    echo ""
    echo "⚠️ Recent Fallback Event:"
    echo "   $LAST_FALLBACK"
fi

echo "======================================================================"
echo "💡 Commands:"
echo "   • Watch live as you type : ./which_model.sh --live"
echo "   • Open Web Dashboard     : http://localhost:4001"
echo "   • Run Claude Code        : ./run_claude.sh"
echo "======================================================================"
