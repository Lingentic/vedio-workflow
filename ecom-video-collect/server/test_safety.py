"""离线安全回归：仅使用虚构凭证、临时媒体和本机测试服务。"""
import concurrent.futures
import http.client
import importlib.util
import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("collect_safety", Path(__file__).with_name("collect_service.py"))
service = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(service)


class Remote:
    status_code = 200

    def __init__(self, data):
        self.data = data

    def iter_content(self, _size):
        yield self.data

    def close(self):
        pass


class SafetyTests(unittest.TestCase):
    def test_media_redirect_and_hls_never_receive_platform_cookie(self):
        received = []

        class Upstream(service.BaseHTTPRequestHandler):
            def do_GET(self):
                received.append((self.path, self.headers.get("Cookie")))
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "/playlist")
                    self.end_headers()
                    return
                data = b"#EXTM3U\n/segment\n" if self.path == "/playlist" else b"video" * 400
                self.send_response(200)
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *_args):
                pass

        server = service.ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def get(url, headers, **_kwargs):
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers)) as response:
                return Remote(response.read())

        try:
            with tempfile.TemporaryDirectory() as directory:
                cookie = Path(directory, "fake.cookie.txt")
                cookie.write_text("fake_session=must-never-leave-this-file", encoding="utf-8")
                with patch.object(service, "MEDIA", directory), patch.object(service, "KS_COOKIE", str(cookie)), \
                     patch.object(service, "DY_COOKIE", str(cookie)), patch.object(service, "creq", SimpleNamespace(get=get)), \
                     patch.object(service, "_ffmpeg", return_value=""), patch.object(service, "_require_video_stream"):
                    for platform in ("kuaishou", "douyin"):
                        path, _, hls = service.download_to_media(
                            f"http://127.0.0.1:{server.server_port}/redirect", platform, "sample", "video")
                        self.assertTrue(hls)
                        self.assertEqual(Path(directory, Path(path).name).read_bytes(), b"video" * 400)
                self.assertEqual(cookie.read_text(encoding="utf-8"), "fake_session=must-never-leave-this-file")
            self.assertEqual([path for path, _ in received], ["/redirect", "/playlist", "/segment"] * 2)
            self.assertTrue(all(cookie is None for _, cookie in received))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_host_origin_guard_blocks_writes_and_preserves_range_and_options(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(service, "MEDIA", directory), \
             patch.object(service, "WORKBENCH", "http://localhost:4186"), \
             patch.object(service, "download_to_media", return_value=("/media/result.mp4", 2048, False)) as download:
            data = b"0123456789" * 200
            Path(directory, "original.mp4").write_bytes(data)
            server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def request(method, path, headers=None, body=None):
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                try:
                    connection.request(method, path, body=body, headers=headers or {})
                    response = connection.getresponse()
                    return response.status, dict(response.getheaders()), response.read()
                finally:
                    connection.close()

            try:
                payload = json.dumps({"url": "https://media.invalid/video.mp4"})
                invalid = [
                    {"Origin": "null"},
                    {"Origin": "https://attacker.invalid"},
                    {"Origin": "http://localhost:4186.evil.invalid"},
                    {"Origin": "http://localhost:4187"},
                    {"Host": f"localhost.evil.invalid:{server.server_port}"},
                    {"Host": "127.0.0.1:1"},
                    {"Host": f"evil.invalid:{server.server_port}"},
                ]
                for headers in invalid:
                    with self.subTest(headers=headers):
                        status, response_headers, _ = request("POST", "/api/download", headers, payload)
                        self.assertEqual(status, 403)
                        self.assertNotIn("Access-Control-Allow-Origin", response_headers)
                download.assert_not_called()
                self.assertEqual(Path(directory, "original.mp4").read_bytes(), data)
                self.assertEqual(len(list(Path(directory).iterdir())), 1)

                for origin in (None, f"http://127.0.0.1:{server.server_port}", f"http://localhost:{server.server_port}", "http://localhost:4186"):
                    headers = {"Range": "bytes=10-19"}
                    if origin:
                        headers["Origin"] = origin
                    status, response_headers, body = request("GET", "/media/original.mp4", headers)
                    self.assertEqual((status, body), (206, data[10:20]))
                    self.assertEqual(response_headers.get("Access-Control-Allow-Origin"), origin)
                status, headers, body = request("OPTIONS", "/api/download", {
                    "Origin": "http://localhost:4186", "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type,range"})
                self.assertEqual((status, body), (204, b""))
                self.assertEqual(headers["Access-Control-Allow-Origin"], "http://localhost:4186")
                self.assertIn("Range", headers["Access-Control-Allow-Headers"])
                status, _, _ = request("POST", "/api/download", body=payload)
                self.assertEqual(status, 200)  # Node 代理/CLI 无 Origin。
                download.assert_called_once()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_concurrent_same_name_downloads_keep_all_content(self):
        barrier = threading.Barrier(6)

        class ConcurrentRemote(Remote):
            def iter_content(self, _size):
                barrier.wait(timeout=5)
                yield self.data

        with tempfile.TemporaryDirectory() as directory, patch.object(service, "MEDIA", directory), \
             patch.object(service, "_require_video_stream"), \
             patch.object(service, "open_remote", side_effect=lambda url, _: ConcurrentRemote(url.encode() * 200)):
            original = Path(directory, "same.mp4")
            original.write_bytes(b"original")
            urls = [f"https://media.invalid/video-{i}" for i in range(6)]
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
                results = list(pool.map(lambda url: service.download_to_media(url, "douyin", "same", "video"), urls))
            self.assertEqual(len({result[0] for result in results}), 6)
            for url, (local, size, hls) in zip(urls, results):
                content = Path(directory, Path(local).name).read_bytes()
                self.assertEqual(content, url.encode() * 200)
                self.assertEqual(size, len(content))
                self.assertFalse(hls)
            self.assertEqual(original.read_bytes(), b"original")
            self.assertEqual(len(list(Path(directory).iterdir())), 7)

    def test_same_name_hls_cannot_overwrite_existing_or_other_download(self):
        def remote(url, _platform):
            if url.endswith(".m3u8"):
                return Remote(b"#EXTM3U\n" + url.replace(".m3u8", ".ts").encode() + b"\n")
            return Remote(url.encode() * 100)

        def remux(args, **_kwargs):
            self.assertIn("-n", args)
            output = Path(args[-1])
            self.assertFalse(output.exists())
            output.write_bytes(Path(args[args.index("-i") + 1]).read_bytes() + b"-mp4")

        with tempfile.TemporaryDirectory() as directory, patch.object(service, "MEDIA", directory), \
             patch.object(service, "open_remote", side_effect=remote), patch.object(service, "_ffmpeg", return_value="ffmpeg"), \
             patch.object(service, "_require_video_stream"), patch.object(service.subprocess, "run", side_effect=remux):
            original = Path(directory, "same.mp4")
            original.write_bytes(b"original")
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda i: service.download_to_media(
                    f"https://media.invalid/{i}.m3u8", "kuaishou", "same", "video"), range(4)))
            self.assertEqual(len({result[0] for result in results}), 4)
            for i, (local, size, hls) in enumerate(results):
                expected = f"https://media.invalid/{i}.ts".encode() * 100 + b"-mp4"
                self.assertEqual(Path(directory, Path(local).name).read_bytes(), expected)
                self.assertEqual(size, len(expected))
                self.assertFalse(hls)
            self.assertEqual(original.read_bytes(), b"original")
            self.assertEqual(len(list(Path(directory).iterdir())), 5)

    def test_failed_download_and_invalid_remux_only_clean_own_temporary_files(self):
        def invalid_remux(args, **_kwargs):
            Path(args[-1]).write_bytes(b"invalid" * 200)

        def validate(path):
            if path.endswith("remux.mp4"):
                raise RuntimeError("not a video")

        with tempfile.TemporaryDirectory() as directory, patch.object(service, "MEDIA", directory):
            original = Path(directory, "same.mp4")
            original.write_bytes(b"original")
            with patch.object(service, "open_remote", return_value=Remote(b"too small")):
                with self.assertRaises(RuntimeError):
                    service.download_to_media("https://media.invalid/video", "douyin", "same", "video")
            self.assertEqual(list(Path(directory).iterdir()), [original])
            with patch.object(service, "open_remote", return_value=Remote(b"video" * 400)), \
                 patch.object(service, "_ffprobe", return_value="probe"), \
                 patch.object(service.subprocess, "run", side_effect=OSError("probe unavailable")):
                with self.assertRaisesRegex(RuntimeError, "FFprobe"):
                    service.download_to_media("https://media.invalid/video", "douyin", "same", "video")
            self.assertEqual(list(Path(directory).iterdir()), [original])
            with patch.object(service, "open_remote", side_effect=[Remote(b"#EXTM3U\nsegment.ts\n"), Remote(b"video" * 400)]), \
                 patch.object(service, "_ffmpeg", return_value="ffmpeg"), patch.object(service, "_require_video_stream", side_effect=validate), \
                 patch.object(service.subprocess, "run", side_effect=invalid_remux):
                local, _, hls = service.download_to_media("https://media.invalid/list", "douyin", "same", "video")
            self.assertTrue(hls)
            self.assertEqual(Path(directory, Path(local).name).read_bytes(), b"video" * 400)
            self.assertEqual(original.read_bytes(), b"original")
            self.assertEqual(len(list(Path(directory).iterdir())), 2)


if __name__ == "__main__":
    unittest.main()
