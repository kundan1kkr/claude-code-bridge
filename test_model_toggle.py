import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

import proxy_ui
from strip_images_callback import proxy_handler_instance


class ModelToggleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = Path(self.temp.name) / "config.yaml"
        self.state = self.config.with_suffix(".models.local.json")
        self.config.write_text(yaml.safe_dump({
            "model_list": [
                *proxy_ui.build_deployments("default", "openai/first", "https://first/v1", ["a", "b"]),
                *proxy_ui.build_deployments("first", "openai/first", "https://first/v1", ["a", "b"]),
                *proxy_ui.build_deployments("second", "openai/second", "https://second/v1", ["c"]),
            ],
            "router_settings": {"fallbacks": [{"default": ["second"]}]},
        }))
        patches = [
            patch.object(proxy_ui, "CONFIG_PATH", self.config),
            patch.object(proxy_ui, "BACKUP_PATH", self.config.with_suffix(".yaml.bak")),
            patch.object(proxy_ui, "STATE_PATH", self.state),
            patch.object(proxy_ui, "start_proxy_process"),
            patch.object(proxy_ui, "stop_proxy_process"),
            patch.object(proxy_ui, "get_status", return_value={"running": True}),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def toggle(self, name, enabled):
        return asyncio.run(proxy_ui.toggle_model(proxy_ui.ToggleModelRequest(model_name=name, enabled=enabled)))

    def runtime(self):
        return yaml.safe_load(self.config.read_text())

    def test_primary_promotes_fallback_and_restores_keys_without_stealing_primary(self):
        config = self.toggle("first", False)
        self.assertFalse(config["catalog"]["first"]["enabled"])
        self.assertEqual(config["pipeline"][0], "second")
        self.assertEqual(len(config["catalog"]["first"]["api_keys"]), 2)
        self.assertNotIn("first", proxy_ui.active_model_names(self.runtime()))
        self.assertTrue(all(item["litellm_params"]["model"] == "openai/second"
                            for item in self.runtime()["model_list"] if item["model_name"] in proxy_ui.CLAUDE_ALIASES))
        self.assertNotIn("first", str(self.runtime()["router_settings"]["fallbacks"]))
        config = self.toggle("first", True)
        self.assertEqual(config["pipeline"][0], "second")
        self.assertEqual(config["catalog"]["first"]["api_keys"], ["a", "b"])
        self.assertEqual(sum(item["model_name"] == "first" for item in self.runtime()["model_list"]), 2)

    def test_last_enabled_model_stops_proxy_then_restarts(self):
        self.toggle("first", False)
        self.toggle("second", False)
        self.assertFalse(proxy_ui.active_model_names(self.runtime()))
        proxy_ui.stop_proxy_process.assert_called()
        self.toggle("first", True)
        self.assertEqual(asyncio.run(proxy_ui.get_config())["pipeline"], ["first"])
        proxy_ui.start_proxy_process.assert_called()

    def test_direct_request_for_disabled_model_rejected_before_wildcard(self):
        self.toggle("first", False)
        with patch.dict("os.environ", {"BRIDGE_CONFIG_PATH": str(self.config)}):
            rejection = asyncio.run(proxy_handler_instance.async_pre_call_hook(None, None, {
                "model": "first", "messages": [{"role": "user", "content": "Hi"}]
            }, "completion"))
            self.assertIn("turned off", rejection)
            allowed = asyncio.run(proxy_handler_instance.async_pre_call_hook(None, None, {
                "model": "second", "messages": [{"role": "user", "content": "Hi"}]
            }, "completion"))
            self.assertEqual(allowed["model"], "second")

    def test_pipeline_save_keeps_disabled_model_off(self):
        self.toggle("first", False)
        asyncio.run(proxy_ui.save_pipeline(proxy_ui.SavePipelineRequest(pipeline=["second"], restart_proxy=False)))
        self.assertNotIn("first", proxy_ui.active_model_names(self.runtime()))
        self.assertFalse(asyncio.run(proxy_ui.get_config())["catalog"]["first"]["enabled"])

    def test_edit_disabled_model_preserves_state(self):
        self.toggle("first", False)
        asyncio.run(proxy_ui.save_model(proxy_ui.SaveModelRequest(model_name="first", api_base="https://first/v1",
                                                            api_keys=["new-a", "new-b"], restart_proxy=False)))
        self.assertEqual(asyncio.run(proxy_ui.get_config())["catalog"]["first"]["api_keys"], ["new-a", "new-b"])
        self.assertNotIn("first", proxy_ui.active_model_names(self.runtime()))

    def test_raw_yaml_cannot_reenable_disabled_model(self):
        self.toggle("first", False)
        data = self.runtime()
        data["model_list"].extend(proxy_ui.build_deployments("first", "openai/first", "https://first/v1", ["new-key"]))
        asyncio.run(proxy_ui.save_raw_config(proxy_ui.SaveRawConfigRequest(yaml_content=yaml.safe_dump(data), restart_proxy=False)))
        self.assertNotIn("first", proxy_ui.active_model_names(self.runtime()))
        self.assertEqual(json.loads(self.state.read_text())["disabled"]["first"][0]["litellm_params"]["api_key"], "new-key")


if __name__ == "__main__":
    unittest.main()
