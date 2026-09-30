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
