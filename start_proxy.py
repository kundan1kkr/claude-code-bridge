#!/usr/bin/env python3
import sys
import os
import json
from pathlib import Path

# Ensure local directory is on python path
dir_path = os.path.dirname(os.path.abspath(__file__))
if dir_path not in sys.path:
    sys.path.insert(0, dir_path)

import litellm
from strip_images_callback import proxy_handler_instance

# Register the image-stripping pre-call hook and custom logger for active model tracking
litellm.input_callback.append(proxy_handler_instance)
litellm._async_input_callback.append(proxy_handler_instance)
litellm.callbacks.append(proxy_handler_instance)

# Always use /chat/completions instead of /responses for OpenAI-compatible providers
litellm.use_chat_completions_url_for_anthropic_messages = True

# Suppress upstream LiteLLM bug where streaming Anthropic responses
# pass result=None to AnthropicResponse.model_validate during background success logging.
try:
    from litellm.litellm_core_utils.litellm_logging import Logging
    _orig_handle_anthropic = Logging._handle_anthropic_messages_response_logging

    def _safe_handle_anthropic_messages_response_logging(self, result):
        if result is None:
            return litellm.ModelResponse()
        try:
            return _orig_handle_anthropic(self, result)
        except Exception:
            return litellm.ModelResponse()

    Logging._handle_anthropic_messages_response_logging = _safe_handle_anthropic_messages_response_logging
except Exception:
    pass

if __name__ == "__main__":
    config_arg = next((sys.argv[i + 1] for i, arg in enumerate(sys.argv[:-1]) if arg == "--config"), None)
    config_path = Path(config_arg or os.environ.get("BRIDGE_CONFIG_PATH", str(Path(dir_path) / "dahl_litellm_config.yaml")))
    os.environ["BRIDGE_CONFIG_PATH"] = str(config_path)
    state_path = config_path.with_suffix(".models.local.json")
    if state_path.exists():
        with open(state_path, encoding="utf-8") as f:
            state = json.load(f)
        import yaml
        with open(config_path, encoding="utf-8") as f:
            runtime = yaml.safe_load(f) or {}
        active = {entry.get("model_name") for entry in runtime.get("model_list", [])
                  if entry.get("model_name") not in state.get("disabled", {})
                  and entry.get("model_name") not in {"*", "claude*", "default", "claude-opus-5-5", "claude-opus-4-6", "claude-opus-4-5-20250219", "claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-3-5-sonnet", "claude-3-5-haiku-20241022", "claude-sonnet-4-6-alias"}}
        if not active:
            sys.exit("No enabled models. Turn on a model in the dashboard before starting the proxy.")
    from litellm import run_server
    sys.exit(run_server())
