"""Online preview streams bytes and releases processes without writing media."""
import importlib.util
import io
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import MagicMock, patch

SPEC = importlib.util.spec_from_file_location("collect_stream", Path(__file__).with_name("collect_service.py"))
service = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(service)

class StreamTests(unittest.TestCase):
    def test_stream_writes_no_files_and_releases_process(self):
        process = MagicMock()
        process.stdout = io.BytesIO(b"fragmented-mp4-data" * 100)
        process.poll.return_value = None
        with tempfile.TemporaryDirectory() as directory, patch.object(service, "MEDIA", directory), patch.object(service, "_ffmpeg", return_value="ffmpeg"), patch.object(service, "_cookie_header", return_value=""), patch.object(service.subprocess, "Popen", return_value=process) as launch:
            server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}/api/stream?url=https%3A%2F%2Fcdn.example%2Fvideo.mp4&start=30.5"
                with urllib.request.urlopen(url, timeout=3) as response:
                    self.assertEqual(response.headers["Content-Type"], "video/mp4")
                    self.assertEqual(response.headers["Cache-Control"], "no-store")
                    self.assertEqual(response.read(), b"fragmented-mp4-data" * 100)
                self.assertEqual(list(Path(directory).iterdir()), [])
                self.assertEqual(launch.call_args.args[0][-1], "pipe:1")
                args = launch.call_args.args[0]
                self.assertEqual(args[args.index('-ss') + 1], '30.5')
                self.assertLess(args.index('-ss'), args.index('-i'))
                process.kill.assert_called_once()
                process.wait.assert_called_once()
                self.assertTrue(service._STREAM_SLOTS.acquire(blocking=False))
                service._STREAM_SLOTS.release()
            finally:
                server.shutdown(); server.server_close(); thread.join(3)

    def test_invalid_seek_times_are_rejected(self):
        for start in ('-1', 'nan', 'inf', '999999'):
            handler = object.__new__(service.Handler)
            handler.path = '/api/stream?url=https%3A%2F%2Fcdn.example%2Fv.mp4&start=' + start
            handler._json = MagicMock()
            handler._stream_video = MagicMock()
            handler.do_GET()
            self.assertEqual(handler._json.call_args.args[1], 400)
            handler._stream_video.assert_not_called()

    def test_invalid_source_does_not_start_process(self):
        with patch.object(service.subprocess, "Popen") as launch:
            handler = object.__new__(service.Handler)
            handler._json = MagicMock()
            handler._stream_video("file:///private.mp4", "kuaishou")
            handler._json.assert_called_once()
            self.assertEqual(handler._json.call_args.args[1], 400)
            launch.assert_not_called()

if __name__ == "__main__": unittest.main()
