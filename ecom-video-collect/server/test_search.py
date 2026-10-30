"""Search failures must settle; signer's argv must preserve complete keywords."""
import importlib.util
import threading
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("collect_search", Path(__file__).with_name("collect_service.py"))
service = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(service)

class SearchTests(unittest.TestCase):
    def test_signer_preserves_spaces_and_paging_in_separate_arguments(self):
        client = SimpleNamespace(signer=SimpleNamespace(close=lambda: None))
        fake = SimpleNamespace(SIGNER="signer.js", DouyinPure=lambda: SimpleNamespace(__enter__=lambda: client))
        output = SimpleNamespace(returncode=0, stdout="https://www.douyin.com/search/signed\n")
        with patch.dict(sys.modules, {"dy_abogus": fake}), patch.object(service, "_clients", {}), patch.object(service, "_mtime", return_value=None), patch.object(service.subprocess, "run", return_value=output) as run:
            service.get_client("douyin").signer.sign_search("商品 名称 含空格", 12, 24)
            self.assertEqual(run.call_args.args[0][-3:], ["商品 名称 含空格", "12", "24"])
            self.assertEqual(run.call_args.kwargs["timeout"], 20)

    def test_failed_search_does_not_deadlock_and_can_retry(self):
        client = SimpleNamespace(search=lambda *a, **k: (_ for _ in ()).throw(RuntimeError("network failed")), close=lambda: None)
        results = []
        with patch.object(service, "creq", object()), patch.object(service, "_cookie_ok", return_value=True), patch.object(service, "get_client", return_value=client):
            thread = threading.Thread(target=lambda: results.append(service.do_search("kuaishou", "test", 1)), daemon=True)
            thread.start(); thread.join(2)
            self.assertFalse(thread.is_alive(), "error path deadlocked")
            self.assertEqual(results[0][1]["code"], "api_error")
            client.search = lambda *a, **k: ([{"photo": {"id": "1"}}], [{"result": 1}])
            self.assertEqual(service.do_search("kuaishou", "test", 1)[0][0]["id"], "1")

    def test_transport_error_is_not_reported_as_empty_results(self):
        client = SimpleNamespace(search=lambda *a, **k: ([], [{"err": "network timeout"}]), close=lambda: None)
        with patch.object(service, "creq", object()), patch.object(service, "_cookie_ok", return_value=True), patch.object(service, "_secrets_ok", return_value=True), patch.object(service, "get_client", return_value=client):
            self.assertEqual(service.do_search("douyin", "test", 1)[1]["code"], "api_error")

if __name__ == "__main__":
    unittest.main()
