import os
import sys
import time
import socket
import signal
import subprocess
import shutil
from pathlib import Path
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import httpx
import yaml

APP_DIR = Path(__file__).resolve().parent
if (APP_DIR / "litellm_config.yaml").exists() or not (APP_DIR / "dahl_litellm_config.yaml").exists():
    CONFIG_PATH = APP_DIR / "litellm_config.yaml"
    BACKUP_PATH = APP_DIR / "litellm_config.yaml.bak"
else:
    CONFIG_PATH = APP_DIR / "dahl_litellm_config.yaml"
EXAMPLE_CONFIG_PATH = APP_DIR / "litellm_config.example.yaml"

def ensure_config_exists():
    global CONFIG_PATH, BACKUP_PATH
    if not CONFIG_PATH.exists() and EXAMPLE_CONFIG_PATH.exists():
        shutil.copyfile(EXAMPLE_CONFIG_PATH, CONFIG_PATH)

ensure_config_exists()

START_PROXY_SCRIPT = APP_DIR / "start_proxy.py"
VENV_PYTHON = APP_DIR / ".venv_litellm" / "bin" / "python"
LOG_FILE = APP_DIR / "proxy.log"
TMP_LOG_FILE = Path("/private/tmp/litellm_proxy.log")
STATIC_DIR = APP_DIR / "static"

CLAUDE_ALIASES = [
    "claude*",
    "*",
    "default",
    "claude-opus-5-5",
    "claude-opus-4-6",
    "claude-opus-4-5-20250219",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-sonnet",
    "claude-3-5-haiku-20241022",
    "claude-sonnet-4-6-alias"
]

app = FastAPI(title="Claude Proxy Bridge Manager", version="1.0.0")

# Mount static files
os.makedirs(STATIC_DIR, exist_ok=True)


class ProxyActionRequest(BaseModel):
    action: str  # "start", "stop", "restart"


class TestProviderRequest(BaseModel):
    api_base: str
    api_key: str
    model: str


class SavePipelineRequest(BaseModel):
    pipeline: List[str]  # Ordered list of model names [primary, fallback 1, fallback 2, ...]
    models: Optional[Dict[str, Dict[str, Any]]] = None  # model definitions { model_name: { model, api_base, api_key } }
    restart_proxy: bool = True


class SaveRawConfigRequest(BaseModel):
    yaml_content: str
    restart_proxy: bool = True


def get_proxy_pid() -> Optional[int]:
    """Finds the PID of the process listening on port 4000."""
    try:
        res = subprocess.run(
            ["lsof", "-ti", ":4000"],
            capture_output=True,
            text=True,
            timeout=2
        )
        pids = [int(p.strip()) for p in res.stdout.strip().split() if p.strip().isdigit()]
        return pids[0] if pids else None
    except Exception:
        return None


def is_port_open(port: int = 4000, host: str = "127.0.0.1") -> bool:
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


def stop_proxy_process():
    pid = get_proxy_pid()
    if pid:
        try:
            os.kill(pid, signal.SIGTERM)
            time.sleep(1)
        except OSError:
            pass
        # Force kill if still open
        if is_port_open(4000):
            try:
                subprocess.run("lsof -ti :4000 | xargs kill -9 2>/dev/null", shell=True, timeout=2)
            except Exception:
                pass
    time.sleep(0.5)


def start_proxy_process():
    stop_proxy_process()
    log_fd = open(LOG_FILE, "a")
    python_bin = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable
    cmd = [
        python_bin,
        str(START_PROXY_SCRIPT),
        "--config", str(CONFIG_PATH),
        "--port", "4000"
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=log_fd,
        stderr=subprocess.STDOUT,
        cwd=str(APP_DIR),
        start_new_session=True
    )
    # Give it up to 5 seconds to bind
    for _ in range(10):
        time.sleep(0.5)
        if is_port_open(4000):
            break


@app.get("/api/status")
async def get_status():
    pid = get_proxy_pid()
    port_active = is_port_open(4000)
    health_ok = False
    models_available = []

    if port_active:
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                res = await client.get("http://localhost:4000/health/readiness")
                if res.status_code == 200:
                    health_ok = True
                m_res = await client.get("http://localhost:4000/v1/models")
                if m_res.status_code == 200:
                    m_json = m_res.json()
                    models_available = [m.get("id") for m in m_json.get("data", [])]
        except Exception:
            pass

    return {
        "running": port_active,
        "pid": pid,
        "port": 4000,
        "healthy": health_ok,
        "models": models_available,
        "config_path": str(CONFIG_PATH)
    }


@app.post("/api/proxy/action")
async def proxy_action(req: ProxyActionRequest):
    action = req.action.lower()
    if action == "start":
        start_proxy_process()
    elif action == "stop":
        stop_proxy_process()
    elif action == "restart":
        start_proxy_process()
    else:
        raise HTTPException(status_code=400, detail=f"Invalid action: {action}")

    return await get_status()


@app.get("/api/config/example")
async def get_example_config():
    if not EXAMPLE_CONFIG_PATH.exists():
        raise HTTPException(status_code=404, detail="Example configuration template not found")
    with open(EXAMPLE_CONFIG_PATH, "r", encoding="utf-8") as f:
        return {"raw_yaml": f.read()}


@app.get("/api/config")
async def get_config():
    ensure_config_exists()
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=404, detail="Config file not found")

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        raw_text = f.read()

    try:
        data = yaml.safe_load(raw_text) or {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse YAML: {e}")

    model_list = data.get("model_list", [])
    router_settings = data.get("router_settings", {})
    fallbacks_raw = router_settings.get("fallbacks", [])

    # Catalog unique model definitions (excluding Claude aliases)
    claude_alias_keys = set(CLAUDE_ALIASES)

    # Find what the Claude aliases currently point to
    current_primary = None
    alias_target_str = None
    for item in model_list:
        if item.get("model_name") in ("default", "claude-3-5-sonnet-20241022", "claude*"):
            alias_target_str = item.get("litellm_params", {}).get("model", "")
            if alias_target_str.startswith("openai/"):
                alias_target_str = alias_target_str[len("openai/"):]
            break

    # Match alias_target_str with concrete model_name in model_list
    if alias_target_str:
        for item in model_list:
            m_name = item.get("model_name")
            if m_name and m_name not in claude_alias_keys:
                tgt = item.get("litellm_params", {}).get("model", "")
                if tgt.startswith("openai/"):
                    tgt = tgt[len("openai/"):]
                if m_name == alias_target_str or tgt == alias_target_str:
                    current_primary = m_name
                    break
        if not current_primary:
            current_primary = alias_target_str

    # Parse fallback chain from router_settings
    current_pipeline = []
    if current_primary:
        current_pipeline.append(current_primary)

    for item in fallbacks_raw:
        if isinstance(item, dict):
            for k, v in item.items():
                if k in ("default", "claude-3-5-sonnet-20241022", "claude*", "*"):
                    if isinstance(v, list):
                        for fb in v:
                            clean_fb = fb[len("openai/"):] if fb.startswith("openai/") else fb
                            matched_name = clean_fb
                            for c_item in model_list:
                                c_m = c_item.get("model_name")
                                if c_m and c_m not in claude_alias_keys:
                                    c_tgt = c_item.get("litellm_params", {}).get("model", "")
                                    if c_tgt.startswith("openai/"):
                                        c_tgt = c_tgt[len("openai/"):]
                                    if c_m == clean_fb or c_tgt == clean_fb:
                                        matched_name = c_m
                                        break
                            if matched_name not in current_pipeline:
                                current_pipeline.append(matched_name)

    # Collect distinct concrete models
    catalog = {}
    for item in model_list:
        m_name = item.get("model_name")
        params = item.get("litellm_params", {})
        if m_name and m_name not in claude_alias_keys:
            raw_model = params.get("model", "")
            if raw_model.startswith("openai/"):
                raw_model = raw_model[len("openai/"):]
            if m_name not in catalog:
                catalog[m_name] = {
                    "model_name": m_name,
                    "target_model": raw_model,
                    "api_base": params.get("api_base", ""),
                    "api_key": params.get("api_key", ""),
                }

    return {
        "raw_yaml": raw_text,
        "pipeline": current_pipeline,
        "catalog": catalog,
        "router_settings": router_settings,
        "claude_aliases": list(claude_alias_keys)
    }


class SaveModelRequest(BaseModel):
    model_name: str
    target_model: Optional[str] = None
    api_base: str
    api_key: str
    restart_proxy: bool = True


@app.post("/api/config/model")
async def save_model(req: SaveModelRequest):
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=404, detail="Config file not found")

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    shutil.copyfile(CONFIG_PATH, BACKUP_PATH)

    api_base = req.api_base.rstrip("/")
    if not api_base.endswith("/v1"):
        api_base += "/v1"

    model_list = data.get("model_list", [])
    raw_target = req.target_model or req.model_name
    target_str = f"openai/{raw_target}" if not raw_target.startswith("openai/") else raw_target

    claude_aliases = set(CLAUDE_ALIASES)

    # Determine if this model or its endpoint is the active primary for Claude aliases
    is_primary = False
    for item in model_list:
        if item.get("model_name") in ("default", "claude*", "claude-3-5-sonnet-20241022"):
            curr_p = item.get("litellm_params", {})
            curr_target = curr_p.get("model", "")
            curr_base = curr_p.get("api_base", "").rstrip("/")
            if (curr_base and curr_base == api_base) or \
               (curr_target in (target_str, f"openai/{req.model_name}", req.model_name)) or \
               (req.model_name in curr_target or curr_target in f"openai/{req.model_name}"):
                is_primary = True
            break

    updated = False
    for item in model_list:
        m_name = item.get("model_name", "")
        p = item.setdefault("litellm_params", {})
        item_base = p.get("api_base", "").rstrip("/")

        if m_name in claude_aliases:
            if is_primary:
                p["api_base"] = api_base
                p["api_key"] = req.api_key
                p["model"] = target_str
        else:
            matches_name = (m_name == req.model_name)
            matches_provider = bool(item_base and item_base == api_base)
            matches_variant = bool(req.model_name in m_name or m_name in req.model_name)

            if matches_name:
                p["api_base"] = api_base
                p["api_key"] = req.api_key
                p["model"] = target_str
                updated = True
            elif matches_provider or matches_variant:
                p["api_base"] = api_base
                p["api_key"] = req.api_key

    if not updated:
        model_list.append({
            "model_name": req.model_name,
            "litellm_params": {
                "model": target_str,
                "api_base": req.api_base,
                "api_key": req.api_key
            }
        })

    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.dump(data, f, sort_keys=False, indent=2)

    if req.restart_proxy:
        start_proxy_process()

    return await get_status()


@app.post("/api/config/pipeline")
async def save_pipeline(req: SavePipelineRequest):
    if not req.pipeline:
        raise HTTPException(status_code=400, detail="Pipeline cannot be empty")

    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=404, detail="Config file not found")

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    # Backup existing
    shutil.copyfile(CONFIG_PATH, BACKUP_PATH)

    model_list = data.get("model_list", [])
    primary_id = req.pipeline[0]

    claude_aliases = CLAUDE_ALIASES

    # If new model definitions were provided in request, merge them into catalog
    catalog = {}
    for item in model_list:
        m_name = item.get("model_name")
        if m_name and m_name not in claude_aliases:
            catalog[m_name] = dict(item.get("litellm_params", {}))

    if req.models:
        for m_name, m_def in req.models.items():
            if m_name in claude_aliases:
                continue
            raw_target = m_def.get("target_model") or m_def.get("model") or m_name
            target_str = f"openai/{raw_target}" if not raw_target.startswith("openai/") else raw_target
            if m_name not in catalog:
                catalog[m_name] = {
                    "model": target_str,
                    "api_base": m_def.get("api_base"),
                    "api_key": m_def.get("api_key")
                }
            else:
                # Retain disk credentials unless an explicitly updated new key was sent
                if m_def.get("api_key") and m_def.get("api_key") not in ("configured", "(none)"):
                    catalog[m_name]["api_key"] = m_def.get("api_key")
                if m_def.get("api_base"):
                    catalog[m_name]["api_base"] = m_def.get("api_base")

    # Find the target parameters for the primary model
    primary_params = catalog.get(primary_id)
    if not primary_params:
        # Check if primary_id matches a target_model in catalog
        for k, v in catalog.items():
            raw_target = v.get("model", "")
            if raw_target.startswith("openai/"):
                raw_target = raw_target[len("openai/"):]
            if raw_target == primary_id:
                primary_params = v
                break

    if not primary_params:
        # Check if any existing entry in model_list (including claude aliases) matches
        for item in model_list:
            item_name = item.get("model_name", "")
            params = item.get("litellm_params", {})
            raw_target = params.get("model", "")
            if raw_target.startswith("openai/"):
                raw_target = raw_target[len("openai/"):]
            if raw_target == primary_id or item_name == primary_id:
                primary_params = dict(params)
                catalog[primary_id] = primary_params
                break

    if not primary_params:
        # Fuzzy match in catalog (e.g. glm-5.3 matching glm-5.3-flash or z-ai/glm-5.3)
        for k, v in catalog.items():
            if primary_id.lower() in k.lower() or k.lower() in primary_id.lower():
                primary_params = v
                catalog[primary_id] = primary_params
                break

    if not primary_params:
        raise HTTPException(status_code=400, detail=f"Parameters for primary model '{primary_id}' not found in catalog ({', '.join(list(catalog.keys())[:10])}...)")

    # Rebuild model_list:
    # 1. Claude aliases pointing to the new primary route
    new_model_list = []
    for alias in claude_aliases:
        new_model_list.append({
            "model_name": alias,
            "litellm_params": {
                "model": primary_params.get("model"),
                "api_base": primary_params.get("api_base"),
                "api_key": primary_params.get("api_key")
            }
        })

    # 2. Add all catalog entries permanently (NEVER DELETE ANY MODEL)
    for m_name, params in catalog.items():
        if m_name not in claude_aliases:
            new_model_list.append({
                "model_name": m_name,
                "litellm_params": params
            })

    # 3. Build cascading fallbacks
    fallbacks_list = []
    pipeline_targets = req.pipeline[1:]  # Remaining fallback models

    for alias in claude_aliases:
        fallbacks_list.append({alias: pipeline_targets})

    for i, p_model in enumerate(req.pipeline):
        rem = req.pipeline[i + 1:]
        if rem:
            fallbacks_list.append({p_model: rem})

    data["model_list"] = new_model_list
    if "router_settings" not in data:
        data["router_settings"] = {}
    data["router_settings"]["fallbacks"] = fallbacks_list
    data["router_settings"]["routing_strategy"] = "simple-shuffle"
    data["router_settings"]["num_retries"] = 3
    data["router_settings"]["cooldown_time"] = 10
    data["router_settings"]["allowed_fails"] = 1

    if "litellm_settings" not in data:
        data["litellm_settings"] = {}
    data["litellm_settings"]["drop_params"] = True
    data["litellm_settings"]["request_timeout"] = 90
    data["litellm_settings"]["use_chat_completions_url_for_anthropic_messages"] = True

    # Save to file
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.dump(data, f, sort_keys=False, indent=2)

    if req.restart_proxy:
        start_proxy_process()

    return await get_status()


@app.post("/api/config/raw")
async def save_raw_config(req: SaveRawConfigRequest):
    try:
        data = yaml.safe_load(req.yaml_content)
        if not isinstance(data, dict):
            raise ValueError("YAML must be a mapping/dictionary")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

    shutil.copyfile(CONFIG_PATH, BACKUP_PATH)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        f.write(req.yaml_content)

    if req.restart_proxy:
        start_proxy_process()

    return await get_status()


@app.post("/api/test-provider")
async def test_provider(req: TestProviderRequest):
    model = req.model
    if model.startswith("openai/"):
        model = model[len("openai/"):]

    api_base = req.api_base.rstrip("/")
    if not api_base.endswith("/v1"):
        api_base += "/v1"

    url = f"{api_base}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {req.api_key}"
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 5
    }

    start = time.time()
    try:
        async with httpx.AsyncClient(timeout=35.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            elapsed_ms = round((time.time() - start) * 1000, 1)

            if resp.status_code == 200:
                try:
                    body = resp.json()
                except Exception:
                    return {
                        "success": False,
                        "status_code": 200,
                        "latency_ms": elapsed_ms,
                        "response": None,
                        "error": "Endpoint returned HTML instead of JSON. Please verify the URL ends with /v1"
                    }
                text = ""
                choices = body.get("choices", [])
                if choices:
                    msg = choices[0].get("message", {})
                    text = msg.get("content") or msg.get("reasoning_content") or ""
                return {
                    "success": True,
                    "status_code": 200,
                    "latency_ms": elapsed_ms,
                    "response": text.strip() or "OK",
                    "error": None
                }
            else:
                return {
                    "success": False,
                    "status_code": resp.status_code,
                    "latency_ms": elapsed_ms,
                    "response": None,
                    "error": f"HTTP {resp.status_code}: {resp.text[:200]}"
                }
    except httpx.TimeoutException:
        elapsed_ms = round((time.time() - start) * 1000, 1)
        return {
            "success": False,
            "status_code": 0,
            "latency_ms": elapsed_ms,
            "response": None,
            "error": "Request timed out (>35s) — upstream server was slow to respond."
        }
    except Exception as ex:
        elapsed_ms = round((time.time() - start) * 1000, 1)
        return {
            "success": False,
            "status_code": 0,
            "latency_ms": elapsed_ms,
            "response": None,
            "error": str(ex) or type(ex).__name__
        }


@app.get("/api/logs")
async def get_logs(lines: int = 80):
    candidates = [LOG_FILE, TMP_LOG_FILE]
    
    # Also look for any recent litellm logs in task logs
    task_dir = Path("/Users/kundankumar/.gemini/antigravity-ide/brain/38062407-c496-409f-bb78-5e01e983931a/.system_generated/tasks")
    if task_dir.exists():
        task_logs = sorted(task_dir.glob("task-*.log"), key=os.path.getmtime, reverse=True)
        candidates.extend(task_logs)

    content = []
    for cand in candidates:
        if cand.exists() and cand.stat().st_size > 0:
            try:
                with open(cand, "r", encoding="utf-8", errors="ignore") as f:
                    all_lines = f.readlines()
                    if all_lines:
                        content = all_lines[-lines:]
                        break
            except Exception:
                continue

    return {"lines": [l.rstrip("\r\n") for l in content]}


@app.get("/")
async def serve_index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return JSONResponse({"message": "Static assets loading..."})


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if __name__ == "__main__":
    import uvicorn
    print("Starting Claude Proxy Bridge UI on http://localhost:4001")
    uvicorn.run(app, host="0.0.0.0", port=4001, log_level="info")
