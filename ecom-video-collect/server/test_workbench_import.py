"""采集桥接的无网络回归测试；不读真实素材库或平台凭证。"""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("collect_service", Path(__file__).with_name("collect_service.py"))
service = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(service)


class WorkbenchImportTests(unittest.TestCase):
    def test_failed_primary_video_uses_backup_without_trying_page_or_cover(self):
        product = {"productId": "test-1", "name": "测试商品", "price": "9", "specification": "一件", "sellingPoints": ""}
        material = {"key": 0, "kind": "video", "name": "展示视频", "platform": "kuaishou",
                    "playUrl": "https://cdn.example/expired.mp4",
                    "playUrls": [{"url": "https://cdn.example/backup.mp4"}],
                    "pageUrl": "https://example.com/product", "src": "https://cdn.example/cover.jpg"}
        tried = []
        posted = []
        with tempfile.TemporaryDirectory() as tmp:
            source = os.path.join(tmp, "video.mp4")
            Path(source).write_bytes(b"video fixture")

            def download(url, platform, name, kind):
                tried.append(url)
                if "expired" in url:
                    raise RuntimeError("链接已过期")
                return "/media/video.mp4", 13, False

            def post(api, payload, timeout=120):
                posted.append((api, payload))
                if api.endswith("/import"):
                    return {"assets": [{"sourcePath": source, "status": "ready", "id": "asset-1"}]}
                return {}

            with patch.object(service, "MEDIA", tmp), patch.object(service, "download_to_media", download), patch.object(service, "wb_post", post):
                result = service.workbench_import(product, [material])

        self.assertEqual(tried, ["https://cdn.example/expired.mp4", "https://cdn.example/backup.mp4"])
        self.assertEqual(result["imported"][0]["status"], "ready")
        self.assertEqual(result["imported"][0]["assetId"], "asset-1")
        self.assertEqual(posted[-1][1]["paths"], [source])
        self.assertFalse(posted[-1][1]["processed"], "Collected videos must enter the source queue before splitting and naming")

    def test_page_and_cover_alone_are_not_importable_video(self):
        product = {"productId": "test-2", "name": "测试商品", "price": "", "specification": "", "sellingPoints": ""}
        material = {"key": 0, "kind": "video", "name": "无源视频",
                    "pageUrl": "https://example.com/product", "src": "https://cdn.example/cover.jpg"}
        with patch.object(service, "wb_post", return_value={}):
            result = service.workbench_import(product, [material])
        self.assertEqual(result["imported"], [])
        self.assertIn("没有可下载的视频地址", result["skipped"][0]["reason"])


if __name__ == "__main__":
    unittest.main()
