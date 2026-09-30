# Universal Guide: Connecting Claude Desktop & Claude Code to Any Custom AI Provider

> **For Users & AI Agents:**  
> This is a **general, provider-agnostic specification**. It explains how to route **Claude Desktop (Mac App)** and **Claude Code (Terminal CLI)** to **ANY** third-party or local OpenAI-compatible AI provider (OpenRouter, DeepSeek, Groq, Ollama, vLLM, Together AI, or any custom inference endpoint) via a local **LiteLLM** translation proxy.  
> You can follow this guide directly or pass this file to any AI coding agent (Cursor, Claude Code, Windsurf, Copilot, etc.) to set it up automatically on any machine.

---

## 1. How It Works (The Universal Bridge Pattern)

- **Claude Desktop** and **Claude Code** strictly communicate via the **Anthropic Messages Protocol** (`POST /v1/messages`).
- Most external AI providers and local servers (Ollama, vLLM, OpenRouter, DeepSeek, custom gateways) expose the **OpenAI Chat Protocol** (`POST /v1/chat/completions`).
- **LiteLLM** runs locally (default port `4000`), receives Anthropic-formatted requests from Claude, translates them to OpenAI format, forwards them to your target provider, and streams the responses back.
- **Failover & Fallbacks**: You can define multiple providers and automatic fallbacks so that if your primary model or provider experiences rate limits (`429`) or server errors (`500`), traffic automatically reroutes to a backup model without interrupting your workflow.

```
┌─────────────────────────────────┐
│     Claude Desktop (Mac App)    │
│               OR                │
│       Claude Code (CLI)         │
└────────────────┬────────────────┘
                 │ Anthropic Protocol: POST /v1/messages
                 ▼
┌─────────────────────────────────┐
│       Local LiteLLM Proxy       │
│     (http://localhost:4000)     │
│   • Protocol Translation        │
│   • Multi-Provider Routing      │
│   • Automatic Fallbacks         │
│   • No-Auth Dev Mode            │
└────────┬───────────────┬────────┘
         │               │
 OpenAI  │               │ OpenAI
 Format  ▼               ▼ Format
┌──────────────────┐   ┌──────────────────────────┐
│   Provider A     │   │       Provider B         │
│ (Custom / Cloud) │   │ (Local Ollama / vLLM /   │
│  e.g., DeepSeek, │   │  OpenRouter, etc.)       │
│  Groq, Gateway   │   │                          │
└──────────────────┘   └──────────────────────────┘
```

---

## 2. Prerequisites

1. **Node.js (v18+) & npm**:
   ```bash
   node -v
   npm -v
   ```
2. **`uv` (fast Python runner)** or standard Python 3.10+:
   ```bash
   # Install uv (macOS / Linux):
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
3. **Your Target AI Provider(s)**:
   - Base URL of the API (e.g. `https://api.your-provider.com/v1` or `http://localhost:11434/v1` for local Ollama).
   - API Key for the provider (or dummy string like `ollama` for local engines).

---

## 3. General Configuration Template (`litellm_config.yaml`)

Create a `litellm_config.yaml` file. The schema follows this general formula:

```yaml
model_list:
  # -------------------------------------------------------------------------
  # A. CLAUDE DESKTOP DROPDOWN MAPPINGS
  # When you select an item in Claude Desktop's model selector, Claude Desktop
  # requests standard Anthropic model IDs. Map them to whichever custom models
  # you want to execute:
  # -------------------------------------------------------------------------

  # Maps "Claude 3.5 Sonnet" in Desktop UI to your chosen primary model:
  - model_name: "claude-3-5-sonnet-20241022"
    litellm_params:
      model: "openai/<YOUR_PRIMARY_MODEL_ID>"
      api_base: "<YOUR_PRIMARY_API_BASE_URL>"
      api_key: "<YOUR_PRIMARY_API_KEY>"

  # Maps "Claude 3.7 Sonnet" in Desktop UI to your chosen fast/reasoning model:
  - model_name: "claude-3-7-sonnet-20250219"
    litellm_params:
      model: "openai/<YOUR_FAST_MODEL_ID>"
      api_base: "<YOUR_FAST_API_BASE_URL>"
      api_key: "<YOUR_FAST_API_KEY>"

  # Maps "Claude 3.5 Haiku" in Desktop UI to your high-speed / large-context model:
  - model_name: "claude-3-5-haiku-20241022"
    litellm_params:
      model: "openai/<YOUR_FAST_MODEL_ID>"
      api_base: "<YOUR_FAST_API_BASE_URL>"
      api_key: "<YOUR_FAST_API_KEY>"

  # -------------------------------------------------------------------------
  # B. DIRECT MODEL ALIASES (For Claude Code CLI and API scripts)
  # Allows invoking models by their real name or short aliases in terminal:
  # -------------------------------------------------------------------------

  - model_name: "primary-model"
    litellm_params:
      model: "openai/<YOUR_PRIMARY_MODEL_ID>"
      api_base: "<YOUR_PRIMARY_API_BASE_URL>"
      api_key: "<YOUR_PRIMARY_API_KEY>"

  - model_name: "backup-model"
    litellm_params:
      model: "openai/<YOUR_BACKUP_MODEL_ID>"
      api_base: "<YOUR_BACKUP_API_BASE_URL>"
      api_key: "<YOUR_BACKUP_API_KEY>"

# ---------------------------------------------------------------------------
# C. ROUTER & AUTOMATIC FAILOVER SETTINGS
# Automatically retries or falls back to a backup model if the primary fails:
# ---------------------------------------------------------------------------
router_settings:
  routing_strategy: "simple-shuffle"
  num_retries: 2
  cooldown_time: 60
  allowed_fails: 1
  fallbacks:
    - claude-3-5-sonnet-20241022: ["backup-model"]
    - primary-model: ["backup-model"]

litellm_settings:
  drop_params: true
```

> [!CRITICAL]
> **DO NOT set `general_settings: master_key` in this configuration!**  
> Leaving `master_key` undefined keeps LiteLLM in **no-auth dev mode** on localhost. This ensures both Claude Desktop and Claude Code can pass any API key or session token without being rejected with `401: LiteLLM Virtual Key expected`.

---

## 4. General Launch Script (`run_claude_bridge.sh`)

Create a shell script named `run_claude_bridge.sh` to manage starting the proxy and launching Claude Code:

```bash
#!/bin/bash
# Universal Launcher for Claude Code via LiteLLM Bridge

CONFIG_PATH="$(cd "$(dirname "$0")" && pwd)/litellm_config.yaml"
PORT=4000

echo "=== Claude Custom Provider Bridge ==="

# 1. Start LiteLLM proxy in background if not already active
if ! nc -z localhost $PORT 2>/dev/null; then
    echo "Starting LiteLLM proxy on port $PORT..."
    uvx --with 'litellm[proxy]' litellm --config "$CONFIG_PATH" --port $PORT > /private/tmp/litellm_proxy.log 2>&1 &
    sleep 3
else
    echo "LiteLLM proxy is already active on port $PORT."
fi

# 2. Configure environment variables for Claude Code
export ANTHROPIC_BASE_URL="http://localhost:$PORT"
export ANTHROPIC_API_KEY="sk-litellm-proxy"
# Overwrite ANTHROPIC_AUTH_TOKEN to avoid collisions with existing terminal env vars:
export ANTHROPIC_AUTH_TOKEN="sk-litellm-proxy"

# 3. Launch Claude Code with specified model or default
DEFAULT_MODEL="claude-3-5-sonnet-20241022"
MODEL="${1:-$DEFAULT_MODEL}"

echo "Launching Claude Code with model: $MODEL"
npx -y @anthropic-ai/claude-code --model "$MODEL" "${@:2}"
```

Make it executable:
```bash
chmod +x run_claude_bridge.sh
```

---

## 5. Verification & Health Checks

Before connecting Claude Desktop or Claude Code, test your setup with these simple commands:

### Check 1: Verify Models Endpoint
```bash
curl -s http://localhost:4000/models | grep -o '"id":"[^"]*"' | head -n 5
```
*Expected: Returns your defined model names without requiring authentication.*

### Check 2: Verify Messages Endpoint (Anthropic Protocol)
```bash
curl -s -X POST http://localhost:4000/v1/messages \
  -H "x-api-key: sk-litellm-proxy" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 20,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```
*Expected: Returns HTTP 200 with an assistant message response from your custom model.*

---

## 6. How to Configure Claude Desktop (Mac App)

1. Open **Claude Desktop**.
2. Click your profile/account icon in the bottom-left corner → **Settings** → **Gateway** (or enterprise gateway settings).
3. Set the connection fields:
   - **Base URL**: `http://localhost:4000`
   - **API Key**: `sk-litellm-proxy` (or any string; no-auth mode accepts any key on localhost)
4. Save and start a new chat.
5. Select your model from the bottom-right model picker:
   - Selecting **Claude 3.5 Sonnet** routes to whatever model you mapped to `claude-3-5-sonnet-20241022`.
   - Selecting **Claude 3.7 Sonnet** routes to whatever model you mapped to `claude-3-7-sonnet-20250219`.
   - Selecting **Claude 3.5 Haiku** routes to whatever model you mapped to `claude-3-5-haiku-20241022`.

---

## 7. How to Use Claude Code (Terminal CLI)

Run the bridge script directly from your terminal:

```bash
# 1. Launch with default mapped model:
./run_claude_bridge.sh

# 2. Launch with a specific alias defined in your config:
./run_claude_bridge.sh primary-model
./run_claude_bridge.sh backup-model

# 3. Pass additional Claude Code arguments:
./run_claude_bridge.sh primary-model --print "Explain quicksort in 2 sentences"
```

---

## 8. Common Pitfalls & Troubleshooting

### Pitfall A: `401: LiteLLM Virtual Key expected`
- **Cause**: Defining `general_settings: master_key: ...` forces LiteLLM to enforce strict virtual key hashing and format rules (demanding keys start with `sk-`).
- **Fix**: Remove `general_settings: master_key` from your YAML. In local dev mode with no master key, LiteLLM accepts all incoming requests.

### Pitfall B: Claude Code 401 Unauthorized / Token Rejection
- **Cause**: If `ANTHROPIC_AUTH_TOKEN` is set in your shell (e.g. in `~/.zshrc`), Claude Code sends that token instead of `ANTHROPIC_API_KEY`.
- **Fix**: The launch script explicitly sets `export ANTHROPIC_AUTH_TOKEN="sk-litellm-proxy"` to override any host token.

### Pitfall C: Rate Limits / Upstream Capacity (429 / 500)
- **Cause**: Your primary custom provider may hit concurrency caps or temporary downtime.
- **Fix**: Always specify a `fallbacks:` block in `router_settings`. LiteLLM will automatically redirect failed requests to your designated backup provider.

---

## 9. Process Management

```bash
# Check if bridge proxy is running:
lsof -i :4000

# View real-time bridge logs:
tail -f /private/tmp/litellm_proxy.log

# Stop the proxy:
kill $(lsof -t -i :4000)
```
