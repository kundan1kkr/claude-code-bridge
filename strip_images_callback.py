import os
import json
from pathlib import Path
from datetime import datetime
from litellm.integrations.custom_logger import CustomLogger

class StripImageHandler(CustomLogger):
    """
    Strips or converts image blocks from messages into text placeholders
    and logs active model routing details in real-time to the proxy log.
    """
    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        if not data:
            return data
        config_path = Path(os.environ.get("BRIDGE_CONFIG_PATH", str(Path(__file__).resolve().parent / "dahl_litellm_config.yaml")))
        state_path = config_path.with_suffix(".models.local.json")
        if state_path.exists():
            with open(state_path, encoding="utf-8") as f:
                disabled = json.load(f).get("disabled", {})
            if data.get("model") in disabled:
                return f"Model '{data['model']}' is turned off"

        for k in ("prompt_cache_key", "prompt_cache", "cache_control", "anthropic_beta"):
            data.pop(k, None)
            
        if "messages" not in data:
            return data
            
        for msg in data["messages"]:
            content = msg.get("content")
            if isinstance(content, list):
                new_content = []
                for part in content:
                    if isinstance(part, dict) and part.get("type") in ("image_url", "image", "input_image"):
                        new_content.append({
                            "type": "text",
                            "text": "[Image: attached in conversation, omitted for text-only model]"
                        })
                    else:
                        new_content.append(part)
                msg["content"] = new_content
        return data

    def _write_to_file(self, msg):
        try:
            log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxy.log")
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(msg + "\n")
        except Exception:
            pass

    def _format_success_log(self, kwargs, response_obj, start_time, end_time):
        try:
            req_model = kwargs.get("model", "")
            litellm_params = kwargs.get("litellm_params", {}) or {}
            target_model = litellm_params.get("model", "") or req_model
            api_base = litellm_params.get("api_base", "") or "default"
            
            if target_model.startswith("openai/"):
                target_model = target_model[len("openai/"):]

            latency_ms = 0
            if start_time and end_time:
                latency_ms = round((end_time - start_time).total_seconds() * 1000, 1)

            tokens_info = ""
            if isinstance(response_obj, dict):
                usage = response_obj.get("usage")
            else:
                usage = getattr(response_obj, "usage", None)

            if isinstance(usage, dict):
                in_tok = usage.get("prompt_tokens", 0) or 0
                out_tok = usage.get("completion_tokens", 0) or 0
                tot_tok = usage.get("total_tokens", 0) or (in_tok + out_tok)
                tokens_info = f" | {tot_tok} tokens (in:{in_tok}, out:{out_tok})"
            elif usage:
                in_tok = getattr(usage, "prompt_tokens", 0) or 0
                out_tok = getattr(usage, "completion_tokens", 0) or 0
                tot_tok = getattr(usage, "total_tokens", 0) or (in_tok + out_tok)
                tokens_info = f" | {tot_tok} tokens (in:{in_tok}, out:{out_tok})"

            now_str = datetime.now().strftime("%H:%M:%S")
            return f"[{now_str}] 🚀 [MODEL ACTIVE] Request: {req_model} ➔ Upstream: {target_model} @ {api_base} | 🟢 200 OK ({latency_ms}ms{tokens_info})"
        except Exception:
            return None

    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        msg = self._format_success_log(kwargs, response_obj, start_time, end_time)
        if msg:
            print(msg, flush=True)
            self._write_to_file(msg)

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        self.log_success_event(kwargs, response_obj, start_time, end_time)

    def log_failure_event(self, kwargs, response_obj, start_time, end_time):
        try:
            req_model = kwargs.get("model", "")
            litellm_params = kwargs.get("litellm_params", {}) or {}
            target_model = litellm_params.get("model", "") or req_model
            err = kwargs.get("exception", "Error")
            if target_model.startswith("openai/"):
                target_model = target_model[len("openai/"):]
            now_str = datetime.now().strftime("%H:%M:%S")
            msg = f"[{now_str}] ⚠️ [FALLBACK ROUTE] Model {target_model} failed ({err}) ➔ Cascading to next fallback..."
            print(msg, flush=True)
            self._write_to_file(msg)
        except Exception:
            pass

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        self.log_failure_event(kwargs, response_obj, start_time, end_time)

proxy_handler_instance = StripImageHandler()
