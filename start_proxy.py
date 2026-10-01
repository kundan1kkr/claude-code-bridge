#!/usr/bin/env python3
import sys
import os

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
    from litellm import run_server
    sys.exit(run_server())
