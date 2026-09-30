#!/bin/bash
# ==============================================================================
# Script to launch Claude Code CLI connected to local LiteLLM Proxy Bridge
# ==============================================================================

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=4000

# Locate configuration: standard litellm_config.yaml, fallback to dahl_litellm_config.yaml
if [ -f "$DIR/litellm_config.yaml" ]; then
    CONFIG_PATH="$DIR/litellm_config.yaml"
elif [ -f "$DIR/dahl_litellm_config.yaml" ]; then
    CONFIG_PATH="$DIR/dahl_litellm_config.yaml"
elif [ -f "$DIR/litellm_config.example.yaml" ]; then
    CONFIG_PATH="$DIR/litellm_config.example.yaml"
else
    echo "⚠️ Warning: No config file found. Please create litellm_config.yaml (copy from litellm_config.example.yaml)."
    CONFIG_PATH="$DIR/litellm_config.yaml"
fi

echo "=== Claude Code <-> Proxy Bridge ==="

# Check if proxy is already running on port 4000
if ! nc -z localhost $PORT 2>/dev/null; then
    echo "Starting LiteLLM proxy in background on port $PORT..."
    if [ -x "$DIR/.venv_litellm/bin/python" ]; then
        PYTHON_BIN="$DIR/.venv_litellm/bin/python"
    else
        PYTHON_BIN="python3"
    fi
    "$PYTHON_BIN" "$DIR/start_proxy.py" --config "$CONFIG_PATH" --port $PORT > /private/tmp/litellm_proxy.log 2>&1 &
    PROXY_PID=$!
    echo "LiteLLM PID: $PROXY_PID"
    sleep 3
else
    echo "LiteLLM proxy already active on port $PORT."
fi

# Configure environment variables for Claude Code
export ANTHROPIC_BASE_URL="http://localhost:$PORT"
export ANTHROPIC_API_KEY="sk-litellm-proxy"
unset ANTHROPIC_AUTH_TOKEN

echo ""
echo "Claude Code is configured via LiteLLM Bridge:"
echo "  • Bridge URL : http://localhost:$PORT"
echo "  • Dashboard  : http://localhost:4001"
echo ""

# Handle arguments: check if first argument is a flag or a model name
if [[ "$1" == --* ]] || [ -z "$1" ]; then
    MODEL="claude-3-5-sonnet-20241022"
    ARGS=("$@")
else
    MODEL="$1"
    ARGS=("${@:2}")
fi

if command -v claude >/dev/null 2>&1; then
    exec claude --model "$MODEL" "${ARGS[@]}"
else
    exec npx -y @anthropic-ai/claude-code --model "$MODEL" "${ARGS[@]}"
fi
