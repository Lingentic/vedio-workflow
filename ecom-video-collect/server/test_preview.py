"""Preview keeps original files and gives browsers byte-range access."""
import importlib.util
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("collect_preview", Path(__file__).with_name("collect_service.py"))
service = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(service)


class PreviewTests(unittest.TestCase):
    def test_codec_conversion_is_cached_and_preserves_original(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(service, "MEDIA", directory), \
             patch.object(service, "_ffprobe", return_value="probe"), patch.object(service, "_ffmpeg", return_value="ffmpeg"):
            source = Path(directory, "source.mp4")
            original = b"original-video" * 100
            source.write_bytes(original)
            calls = []

            def run(args, **_kwargs):
                calls.append(args[0])
                if args[0] == "probe":
                    return SimpleNamespace(returncode=0, stdout=json.dumps({"streams": [
                        {"codec_type": "video", "codec_name": "hevc"},
                        {"codec_type": "audio", "codec_name": "aac"}]}).encode(), stderr=b"")
                Path(args[-1]).write_bytes(b"browser-video" * 100)
                return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

            with patch.object(service.subprocess, "run", side_effect=run):
                result = service.browser_preview("/media/source.mp4")
                self.assertEqual(result, "/media/source-browser-preview.mp4")
                self.assertEqual(service.browser_preview("/media/source.mp4"), result)
            self.assertEqual(calls.count("ffmpeg"), 1)
            self.assertEqual(source.read_bytes(), original)

    def test_h264_aac_reuses_original_and_rejects_outside_paths(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(service, "MEDIA", directory), \
             patch.object(service, "_ffprobe", return_value="probe"):
            Path(directory, "source.mp4").write_bytes(b"video")
            probe = SimpleNamespace(returncode=0, stdout=json.dumps({"streams": [
                {"codec_type": "video", "codec_name": "h264"},
                {"codec_type": "audio", "codec_name": "aac"}]}).encode(), stderr=b"")
            with patch.object(service.subprocess, "run", return_value=probe):
                self.assertEqual(service.browser_preview("/media/source.mp4"), "/media/source.mp4")
            for value in ("/media/../secrets.mp4", "C:/secrets.mp4", "/media/missing.mp4"):
                with self.assertRaises(ValueError):
                    service.browser_preview(value)

    def test_forced_conversion_of_h264_when_browser_rejects_original(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(service, "MEDIA", directory), \
             patch.object(service, "_ffprobe", return_value="probe"), patch.object(service, "_ffmpeg", return_value="ffmpeg"):
            Path(directory, "source.mp4").write_bytes(b"original-video" * 100)

            def run(args, **_kwargs):
                if args[0] == "probe":
                    return SimpleNamespace(returncode=0, stdout=json.dumps({"streams": [
                        {"codec_type": "video", "codec_name": "h264"},
                        {"codec_type": "audio", "codec_name": "aac"}]}).encode(), stderr=b"")
                Path(args[-1]).write_bytes(b"browser-video" * 100)
                return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

            with patch.object(service.subprocess, "run", side_effect=run):
                self.assertEqual(service.browser_preview("/media/source.mp4", force=True),
                                 "/media/source-browser-preview.mp4")
            self.assertTrue(Path(directory, "source-browser-preview.mp4").is_file())

    def test_media_byte_ranges_and_head(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(service, "MEDIA", directory):
            data = b"0123456789" * 200
            Path(directory, "preview.mp4").write_bytes(data)
            server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}/media/preview.mp4"
                with urllib.request.urlopen(urllib.request.Request(url, headers={"Range": "bytes=10-19"})) as response:
                    self.assertEqual(response.status, 206)
                    self.assertEqual(response.headers["Content-Range"], f"bytes 10-19/{len(data)}")
                    self.assertEqual(response.read(), data[10:20])
                with urllib.request.urlopen(urllib.request.Request(url, method="HEAD")) as response:
                    self.assertEqual(response.headers["Accept-Ranges"], "bytes")
                    self.assertEqual(response.read(), b"")
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(urllib.request.Request(url, headers={"Range": "bytes=9999-"}))
                self.assertEqual(error.exception.code, 416)
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
