# Claude Proxy Bridge & Management Dashboard

A local translation and failover bridge that seamlessly routes **Claude Desktop** and **Claude Code CLI** to any OpenAI-compatible provider (OpenRouter, DeepSeek, Groq, Ollama, Together AI, vLLM, or custom gateways) with automatic multi-model failover and a real-time web management UI.

---

## 🚀 Quick Start

### 1. Clone & Start
```bash
git clone https://github.com/kundan1kkr/claude-code-bridge.git
cd claude-code-bridge
./start_all.sh
```
*`./start_all.sh` automatically sets up the Python virtual environment, installs dependencies, initializes `litellm_config.yaml` from the starter template, and opens the Web Dashboard in your browser.*

### 2. Configure Providers & Models (In Web UI)
Open **`http://localhost:4001`**:
* **Catalog Tab**: Enter your provider API keys and base URLs (DeepSeek, OpenRouter, Groq, Ollama, etc.).
* **Pipeline Tab**: Order your models with ▲ / ▼ buttons to set your primary route and automatic fallbacks.
* **Multiple API keys per model**: stack several keys on one model; all of them are tried before the next provider is used (see below).
* Click **"Save & Reload Proxy"**.

### 3. Launch Claude Code CLI
```bash
./run_claude.sh
```
Or to run in autonomous agent mode:
```bash
./run_claude.sh --dangerously-skip-permissions
```

---

## 🌟 Web Management Dashboard (`http://localhost:4001`)

The built-in web UI allows you to manage the entire bridge without manually editing YAML files:

- **Visual Fallback Pipeline**:
  - Drag or reorder priority using ▲ / ▼ buttons (e.g. `Primary Fast Model` $\to$ `Reasoning Model` $\to$ `Fallback Provider`).
  - 1-Click `Save & Reload Proxy` to update the config and restart LiteLLM.
- **Provider & Model Catalog**:
  - Edit Base URLs, API keys, and model names visually.
  - Add custom OpenAI-compatible providers (Ollama, Together, OpenRouter, DeepSeek, etc.).
- **Live Latency & Ping Diagnostics**:
  - Click `Ping` on any model to measure response time in milliseconds.
  - Diagnose errors (such as `429 Too Many Requests` or quota exhaustion) before sending Claude traffic.
- **Proxy Lifecycle Controls**:
  - 1-Click `Start`, `Stop`, and `Restart` buttons with live status indicators.
- **Live Logs Console**:
  - Real-time tail of proxy requests, latency, token usage, and automatic fallback triggers.

---

## ⚙️ How It Works (Universal Fallback Chain)

When Claude Desktop or Claude Code makes a request:
1. It sends an Anthropic-formatted request (`POST /v1/messages`) to `http://localhost:4000`.
2. LiteLLM translates the request to OpenAI format and forwards it to your **Priority #1 model**.
3. If Priority #1 returns an error or rate limit (`429`), LiteLLM **automatically shifts down** to **Priority #2**, then **Priority #3**, etc.
4. Claude receives a seamless response without aborting the session.

---

## 🛠️ Architecture

- **Proxy Bridge**: Port `4000` (`start_proxy.py` + `litellm_config.yaml`)
- **Web UI Server**: Port `4001` (`proxy_ui.py` + `static/`)
- **CLI Model Monitor**: `./which_model.sh --live`
- **Claude Launcher**: `./run_claude.sh`
- **Service Controller**: `./start_all.sh` (`start` | `stop` | `restart` | `status`)

---

## 🔑 Multiple API Keys per Model

Free tiers rate-limit fast, so you can stack several keys on one model and burn
through them before giving up on that provider. Failover then happens on two
levels: **keys within a model**, then **models within the pipeline**.

```
claude-3-5-sonnet  →  groq-llama-3.3-70b   key #1  ✗ 429
                                           key #2  ✗ 429
                                           key #3  ✗ 429
                   →  deepseek-chat        key #1  ✓ 200
```

**In the dashboard**: open a model in the catalog and use **+ Add another key**.
Keys are tried top to bottom; the `×` button removes one. Catalog cards show a
`+N backup` marker for models that have a key group.

**In YAML**, a key group is just several `model_list` entries sharing one
`model_name`:

```yaml
- model_name: deepseek-chat
  litellm_params:
    model: openai/deepseek-chat
    api_base: https://api.deepseek.com/v1
    api_key: sk-key-one
    weight: 2          # higher weight = tried first
- model_name: deepseek-chat
  litellm_params:
    model: openai/deepseek-chat
    api_base: https://api.deepseek.com/v1
    api_key: sk-key-two
    weight: 1
```

Two router settings make this reliable, and the dashboard maintains both:

- `num_retries` is kept `>=` your largest key group, so a fallback can never fire
  while some of that model's keys are still untried.
- `allowed_fails: 0` cools a key down after its first failure, so the retry lands
  on the *next* key instead of re-rolling onto the same dead one.

Keys are tried in order on a healthy router. Ordering is a strong preference
rather than a hard guarantee — LiteLLM's shuffle may repeat a key once the group
is cooling down — but the group is always exhausted before the next provider.
