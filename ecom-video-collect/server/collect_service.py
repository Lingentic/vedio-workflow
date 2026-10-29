#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""collect_service.py —— 电商 AI 视频工作流的本地采集服务.

把 ai-reverse（抖音 a_bogus / 快手 __NS_hxfalcon 纯算签名）包装成页面可调用的 HTTP 接口,
同时静态托管原型页面与已下载的媒体文件, 使素材可预览、可入库。

用法:
    python server/collect_service.py [--port 8765]

页面入口:  http://127.0.0.1:8765/index.html  （商品获取 → 录入商品 → 采集/爬取）

接口:
    GET  /api/health                        凭证与依赖自检
    GET  /api/search?platform=kuaishou|douyin&keyword=X&pages=1
    GET  /api/proxy?platform=&url=          带 Referer/UA 中转封面与视频流（预览用）
    POST /api/download {platform,url,name}  下载媒体到 media/，返回 /media/<file>
    POST /api/workbench-import {product,materials}  落盘所选视频并推入视频工作台素材库

凭证（不随项目分发）放在 ai-reverse 的 dist/ai-reverse-pure/config/ 下:
    kuaishou.cookie.txt / douyin.cookie.txt / session.secrets.json

ai-reverse 运行目录按以下顺序解析（取第一个非空值）:
    1. 环境变量 AI_REVERSE_DIR
    2. 本脚本旁的 collect_service.json（gitignore 不入库），形如
       {"aiReverseDir": "C:/path/to/ai-reverse/dist/ai-reverse-pure",
        "workbenchUrl": "http://127.0.0.1:4186"}
    3. 否则按未配置处理（/api/health 会报告凭证缺失）

工作台地址按 WORKBENCH_URL 环境变量、collect_service.json 的 workbenchUrl、
默认 http://127.0.0.1:4186 顺序解析；它是 vedio-workflow demo/ 的本地服务，
本模块只走它的 /api/products 与 /api/products/:id/import 上游接口。
"""
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)                      # ecom-video-collect/ 模块根
WEB = os.path.join(ROOT, "web")                   # 静态页面目录
MEDIA = os.environ.get("COLLECT_MEDIA_DIR") or os.path.join(ROOT, "media")  # 下载素材落盘处，经 /media/ 可访问


def _local_config():
    try:
        # utf-8-sig 兼容 Windows 编辑器写出的带 BOM JSON
        with open(os.path.join(BASE, "collect_service.json"), encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return {}


AI_REVERSE = os.environ.get("AI_REVERSE_DIR") or _local_config().get("aiReverseDir") or ""
WORKBENCH = (os.environ.get("WORKBENCH_URL") or _local_config().get("workbenchUrl") or "http://127.0.0.1:4186").rstrip("/")
CONFIG = os.path.join(AI_REVERSE, "config")
KS_COOKIE = os.path.join(CONFIG, "kuaishou.cookie.txt")
DY_COOKIE = os.path.join(CONFIG, "douyin.cookie.txt")
DY_SECRETS = os.path.join(CONFIG, "session.secrets.json")

for sub in ("douyin", "kuaishou"):
    p = os.path.join(AI_REVERSE, sub)
    if os.path.isdir(p) and p not in sys.path:
        sys.path.insert(0, p)

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    from curl_cffi import requests as creq
except ImportError:  # pragma: no cover
    creq = None

_lock = threading.RLock()
_clients = {"kuaishou": None, "douyin": None}
_cookie_mtime = {"kuaishou": None, "douyin": None}

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36")


def _mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return None


def _cookie_ok(path):
    return os.path.exists(path) and os.path.getsize(path) > 20


def _secrets_ok():
    if not os.path.exists(DY_SECRETS):
        return False
    try:
        s = json.load(open(DY_SECRETS, encoding="utf-8"))
        return all(s.get(k) for k in ("ua", "uifid", "webid"))
    except Exception:
        return False


def get_client(platform):
    """按平台返回常驻客户端；cookie 文件更新后自动重建。"""
    with _lock:
        cur_mtime = _mtime(KS_COOKIE if platform == "kuaishou" else DY_COOKIE)
        if _clients.get(platform) is not None and _cookie_mtime[platform] == cur_mtime:
            return _clients[platform]
        old = _clients.pop(platform, None)
        if old is not None:
            try:
                old.close()
            except Exception:
                pass
        if platform == "kuaishou":
            from ks_pure import KuaishouPure
            client = KuaishouPure(cookie_file=KS_COOKIE).__enter__()
        else:
            from dy_abogus import DouyinPure
            client = DouyinPure().__enter__()
            class SearchSigner:
                def sign_search(self, keyword, offset, count):
                    import dy_abogus
                    result = subprocess.run(["node", dy_abogus.SIGNER, "search", keyword, str(offset), str(count)],
                                            cwd=os.path.dirname(dy_abogus.SIGNER), capture_output=True,
                                            text=True, encoding="utf-8", timeout=20)
                    url = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""
                    if result.returncode or not url.startswith("https://www.douyin.com/"):
                        raise RuntimeError("抖音搜索签名失败，请检查签名服务")
                    return url
                def close(self):
                    pass
            client.signer.close()
            client.signer = SearchSigner()
        _clients[platform] = client
        _cookie_mtime[platform] = cur_mtime
        return client


def drop_client(platform):
    with _lock:
        old = _clients.pop(platform, None)
        _cookie_mtime[platform] = None
    if old is not None:
        try:
            old.close()
        except Exception:
            pass


# ---------- 归一化 ----------

def _ks_video_urls(photo):
    out = []
    man = photo.get("manifest")
    if isinstance(man, str):
        try:
            man = json.loads(man)
        except Exception:
            man = None
    for ads in (man or {}).get("adaptationSet") or []:
        if "audio" in str(ads.get("contentType") or "").lower():
            continue
        for rep in ads.get("representation") or []:
            if "audio" in str(rep.get("contentType") or rep.get("mediaType") or rep.get("mimeType") or "").lower():
                continue
            u = rep.get("url")
            if u:
                out.append({"quality": rep.get("qualityLabel") or rep.get("qualityType") or "?", "url": u})
    # 优先 .mp4 直链；m3u8(HLS) 排后，页面预览与下载都以 mp4 为先
    out.sort(key=lambda x: (0 if ".mp4" in x["url"] else 1))
    return out


def norm_ks(feed):
    ph = feed.get("photo") or {}
    if not ph:
        return None
    au = feed.get("author") or {}
    vids = _ks_video_urls(ph)
    vid = str(ph.get("id") or "")
    return {
        "id": vid,
        "title": ph.get("caption") or "",
        "author": au.get("name") or ph.get("userName") or au.get("id") or "",
        "like": ph.get("likeCount"),
        "view": ph.get("viewCount"),
        "durationMs": ph.get("duration"),
        "cover": ph.get("coverUrl"),
        "pageUrl": "https://www.kuaishou.com/short-video/" + vid if vid else "",
        "playUrl": vids[0]["url"] if vids else "",
        "playUrls": vids,
        "platform": "kuaishou",
    }


def norm_dy(item):
    aw = item.get("aweme_info") or item.get("aweme") or (item if item.get("aweme_id") else {})
    if not aw:
        return None
    from dy_abogus import DouyinPure
    links = DouyinPure.video_links({"aweme_info": aw})
    stats = aw.get("statistics") or {}
    vid = aw.get("video") or {}
    vids = [{"quality": q, "url": u}
            for q, key in (("hd", "hd"), ("sd", "sd"), ("dl", "dl"))
            for u in (links.get(key) or [])]
    aid = str(aw.get("aweme_id") or "")
    return {
        "id": aid,
        "title": aw.get("desc") or "",
        "author": (aw.get("author") or {}).get("nickname") or "",
        "like": stats.get("digg_count"),
        "view": stats.get("play_count"),
        "durationMs": vid.get("duration"),
        "cover": (links.get("cover") or [None])[0],
        "pageUrl": links.get("page_url") or "",
        "playUrl": vids[0]["url"] if vids else "",
        "playUrls": vids,
        "platform": "douyin",
    }


def do_search(platform, keyword, pages):
    """返回 (items, error)。error 为 dict 或 None。"""
    if creq is None:
        return None, {"code": "dependency", "message": "缺少 curl_cffi：python -m pip install curl_cffi"}
    if platform == "kuaishou":
        if not _cookie_ok(KS_COOKIE):
            return None, {"code": "not_configured",
                          "message": "未配置快手凭证：把 kuaishou.com 登录 Cookie 行写入 config/kuaishou.cookie.txt"}
    else:
        if not _cookie_ok(DY_COOKIE) or not _secrets_ok():
            return None, {"code": "not_configured",
                          "message": "未配置抖音凭证：需 config/douyin.cookie.txt 与 config/session.secrets.json"}
    try:
        client = get_client(platform)
    except Exception as e:
        return None, {"code": "init_error", "message": "签名器初始化失败：" + str(e)[:200]}

    with _lock:
        try:
            if platform == "kuaishou":
                feeds, raws = client.search(keyword, pages=pages)
                bad = next((r for r in raws if r.get("result") != 1), None)
                if bad is not None:
                    drop_client(platform)
                    code = "verify" if bad.get("result") in (2, 3) else "api_error"
                    return None, {"code": code, "raw": bad,
                                  "message": f"快手接口返回 result={bad.get('result')}：凭证失效或触发风控，需更新 cookie"}
                items = [n for n in (norm_ks(f) for f in feeds) if n]
            else:
                data, raws = client.search(keyword, pages=pages)
                items = [n for n in (norm_dy(x) for x in data) if n]
                if not items and raws:
                    last = raws[-1] or {}
                    if not last.get("data") and (last.get("status_code") not in (0, None) or last.get("http") or last.get("err")):
                        drop_client(platform)
                        return None, {"code": "api_error", "raw": {"http": last.get("http"), "status": last.get("status_code"), "msg": last.get("status_msg")},
                                      "message": "抖音搜索接口请求失败：请检查网络及采集服务使用的登录凭证（浏览器登录态与采集凭证独立）"}
        except Exception as e:
            drop_client(platform)
            return None, {"code": "api_error", "message": str(e)[:300]}
    if not items:
        return None, {"code": "empty", "message": "搜索无结果，换个关键词试试"}
    return items, None


# ---------- 中转 / 下载 ----------

def _platform_of(url):
    host = urllib.parse.urlparse(url).hostname or ""
    if "douyin" in host or "douyinpic" in host or "douyinvod" in host or "bytecdn" in host or "amemv" in host:
        return "douyin"
    return "kuaishou"


def open_remote(url, platform):
    # 媒体 URL、重定向和 HLS 分段都可能来自第三方；登录态只留在搜索客户端。
    referer = "https://www.douyin.com/" if platform == "douyin" else "https://www.kuaishou.com/"
    headers = {"User-Agent": UA, "Referer": referer}
    return creq.get(url, headers=headers, impersonate="chrome131", timeout=20, stream=True)


def safe_name(name, ext):
    base = re.sub(r'[\\/:*?"<>|\r\n]+', "_", str(name or "media")).strip()[:80] or "media"
    return base + ext


def _publish_media(source, name):
    """原子发布已校验文件；link 不会覆盖任何已存在的路径。"""
    stem, ext = os.path.splitext(name)
    while True:
        filename = f"{stem}-{uuid.uuid4().hex}{ext}"
        try:
            os.link(source, os.path.join(MEDIA, filename))
            return "/media/" + filename
        except FileExistsError:
            continue


_IMG_SIG = (b"\xff\xd8\xff", b"\x89PNG", b"GIF87", b"GIF89", b"RIFF", b"BM", b"II*\x00", b"MM\x00*")


def _ffmpeg():
    return os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg") or ""


def _ffprobe():
    p = os.environ.get("FFPROBE_PATH") or shutil.which("ffprobe") or ""
    if p:
        return p
    ff = _ffmpeg()
    if ff:
        cand = os.path.join(os.path.dirname(ff), "ffprobe.exe" if os.name == "nt" else "ffprobe")
        if os.path.isfile(cand):
            return cand
    return ""


def _require_video_stream(path):
    """校验文件含视频流；缺少 ffprobe 时放行，交由工作台判定。"""
    fp = _ffprobe()
    if not fp:
        return
    try:
        out = subprocess.run([fp, "-v", "error", "-select_streams", "v:0",
                              "-show_entries", "stream=codec_type", "-of", "csv=p=0", path],
                             capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        raise RuntimeError("无法执行 FFprobe 校验媒体") from e
    if out.returncode != 0:
        err = (out.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        raise RuntimeError("媒体文件不可解析" + ("：" + err[-1][:80] if err else ""))
    if b"video" not in out.stdout:
        raise RuntimeError("返回的是纯音频流，无视频画面")


_PREVIEW_LOCK = threading.Lock()


def browser_preview(local, force=False):
    """Keep the downloaded original; make a browser-compatible MP4 only when needed."""
    if not isinstance(local, str) or not local.startswith("/media/"):
        raise ValueError("请选择已下载的本地视频")
    filename = local[len("/media/"):]
    if not filename or filename != os.path.basename(filename) or not filename.lower().endswith((".mp4", ".ts", ".mov", ".webm")):
        raise ValueError("本地视频路径无效")
    source = os.path.realpath(os.path.join(MEDIA, filename))
    if os.path.commonpath((os.path.realpath(MEDIA), source)) != os.path.realpath(MEDIA) or not os.path.isfile(source):
        raise ValueError("本地视频不存在，请重新爬取")
    probe = _ffprobe()
    if not probe:
        raise RuntimeError("视频预览需要 FFprobe，请用一键启动脚本启动采集服务")
    result = subprocess.run([probe, "-v", "error", "-show_entries", "stream=codec_type,codec_name",
                             "-of", "json", source], capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError("视频文件不可解析，无法预览")
    streams = json.loads(result.stdout).get("streams") or []
    video = next((s.get("codec_name") for s in streams if s.get("codec_type") == "video"), None)
    audio = [s.get("codec_name") for s in streams if s.get("codec_type") == "audio"]
    if not video:
        raise RuntimeError("视频文件没有画面，无法预览")
    if not force and filename.lower().endswith(".mp4") and video == "h264" and all(codec == "aac" for codec in audio):
        return local
    ffmpeg = _ffmpeg()
    if not ffmpeg:
        raise RuntimeError("此视频编码需要 FFmpeg 转为浏览器可播放格式")
    preview = os.path.join(MEDIA, os.path.splitext(filename)[0] + "-browser-preview.mp4")
    with _PREVIEW_LOCK:
        if not force and os.path.isfile(preview) and os.path.getsize(preview) > 1024 and os.path.getmtime(preview) >= os.path.getmtime(source):
            return "/media/" + os.path.basename(preview)
        temporary = preview + ".partial"
        try:
            out = subprocess.run([ffmpeg, "-y", "-nostdin", "-loglevel", "error", "-i", source,
                                  "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                                  "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-threads", "2",
                                  "-f", "mp4", temporary], capture_output=True, timeout=900)
            if out.returncode or not os.path.isfile(temporary) or os.path.getsize(temporary) < 1024:
                message = (out.stderr or b"").decode("utf-8", "replace").strip().splitlines()
                raise RuntimeError("视频转码失败" + ("：" + message[-1][:120] if message else ""))
            os.replace(temporary, preview)
        finally:
            if os.path.isfile(temporary):
                os.remove(temporary)
    return "/media/" + os.path.basename(preview)


def download_to_media(url, platform, name, kind):
    """独立暂存、校验后发布媒体，返回 ("/media/<file>", size, is_hls)。"""
    os.makedirs(MEDIA, exist_ok=True)
    r = open_remote(url, platform)
    try:
        if r.status_code != 200:
            raise RuntimeError(f"远端返回 {r.status_code}")
        it = r.iter_content(1 << 16)
        head = next(it, b"")
        # 临时目录由系统原子分配；失败清理只触及本次下载拥有的文件。
        with tempfile.TemporaryDirectory(prefix=".download-", dir=MEDIA) as temporary:
            is_hls = head.lstrip().startswith(b"#EXTM3U")
            ext = ".ts" if is_hls else ".mp4" if kind == "video" else ".jpg"
            dest = os.path.join(temporary, "source" + ext)
            size = 0
            with open(dest, "xb") as f:
                if is_hls:
                    playlist = (head + b"".join(it)).decode("utf-8", "replace")
                    segs = [ln.strip() for ln in playlist.splitlines()
                            if ln.strip() and not ln.startswith("#")]
                    if not segs:
                        raise RuntimeError("HLS 清单为空")
                    for seg in segs:
                        sr = open_remote(urllib.parse.urljoin(url, seg), platform)
                        try:
                            if sr.status_code != 200:
                                raise RuntimeError(f"HLS 分段返回 {sr.status_code}")
                            for chunk in sr.iter_content(1 << 20):
                                f.write(chunk)
                                size += len(chunk)
                        finally:
                            sr.close()
                else:
                    f.write(head)
                    size = len(head)
                    for chunk in it:
                        f.write(chunk)
                        size += len(chunk)
            if size < 1024:
                raise RuntimeError("下载内容过小，疑似失效链接")
            if kind == "image" and not is_hls:
                if not head.startswith(_IMG_SIG):
                    raise RuntimeError("返回的是网页而非图片（防盗链或链接失效），请检查凭证后重新采集")
            else:
                _require_video_stream(dest)
            ffmpeg = _ffmpeg() if is_hls else ""
            if ffmpeg:
                mp4 = os.path.join(temporary, "remux.mp4")
                try:
                    subprocess.run([ffmpeg, "-n", "-nostdin", "-loglevel", "error", "-i", dest,
                                    "-c", "copy", "-movflags", "+faststart", mp4],
                                   check=True, timeout=300, capture_output=True)
                    if not os.path.isfile(mp4) or os.path.getsize(mp4) < 1024:
                        raise RuntimeError("HLS 转封装结果无效")
                    _require_video_stream(mp4)
                except (subprocess.SubprocessError, OSError, RuntimeError):
                    # 已校验的 TS 仍可导入；失败的 MP4 不发布。
                    pass
                else:
                    return _publish_media(mp4, safe_name(name, ".mp4")), os.path.getsize(mp4), False
            return _publish_media(dest, safe_name(name, ext)), size, is_hls
    finally:
        r.close()


# ---------- 工作台联动 ----------

def wb_post(api, payload, timeout=120):
    """向视频工作台 POST JSON，返回解析后的对象；失败抛异常。"""
    req = urllib.request.Request(WORKBENCH + api, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "Accept": "application/json"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            detail = {}
        raise RuntimeError(detail.get("message") or f"工作台返回 HTTP {e.code}")
    except urllib.error.URLError:
        raise RuntimeError(f"连不上视频工作台（{WORKBENCH}）：请先在 vedio-workflow 的 demo/ 目录执行 node server.ts")


def workbench_import(product, materials):
    """落盘所选视频素材并推入工作台素材库。materials 为页面素材池条目。"""
    fields = {}
    for key in ("productId", "name", "price", "specification", "sellingPoints"):
        value = product.get(key)
        if not isinstance(value, str):
            raise ValueError(f"商品字段 {key} 需要字符串")
        fields[key] = value.strip()
    if len(fields["sellingPoints"]) > 12000 or any(len(fields[k]) > 300 for k in ("productId", "name", "price", "specification")):
        raise ValueError("商品字段超长")
    if not fields["productId"] or not fields["name"]:
        raise ValueError("商品ID和名称不能为空")

    files, skipped = [], []
    for m in materials:
        name = str(m.get("name") or "素材")
        key = m.get("key")
        kind = "image" if m.get("kind") == "image" else "video"
        local = str(m.get("local") or "").lstrip("/")
        target = None
        if local.startswith("media/"):
            cand = os.path.realpath(os.path.join(MEDIA, local[6:]))
            if os.path.commonpath((os.path.realpath(MEDIA), cand)) == os.path.realpath(MEDIA) and os.path.isfile(cand):
                try:
                    if kind == "video":
                        _require_video_stream(cand)
                    else:
                        with open(cand, "rb") as image:
                            if not image.read(12).startswith(_IMG_SIG):
                                raise RuntimeError("本地图片文件无效")
                    target = cand
                except Exception:
                    local = ""
        if target is None:
            # 只尝试真实媒体地址；pageUrl 是商品网页，src 对视频是封面图。
            cands = [m.get("src")] if kind == "image" else [m.get("playUrl")]
            cands += [x.get("url") for x in (m.get("playUrls") or []) if isinstance(x, dict)]
            urls = []
            for u in cands:
                if isinstance(u, str) and u.startswith("http") and u not in urls:
                    urls.append(u)
            if not urls:
                skipped.append({"key": key, "kind": kind, "name": name, "reason": "没有可下载的视频地址" if kind == "video" else "没有可下载的图片地址"})
                continue
            platform = m.get("platform") if m.get("platform") in ("kuaishou", "douyin") else _platform_of(urls[0])
            err = None
            for u in urls:
                try:
                    local, size, _hls = download_to_media(u, platform, name, kind)
                    target = os.path.join(MEDIA, os.path.basename(local))
                    break
                except Exception as e:
                    err = e
            if target is None:
                skipped.append({"key": key, "kind": kind, "name": name, "reason": "下载失败：" + str(err)[:120]})
                continue
        files.append({"key": key, "kind": kind, "name": name, "path": target, "local": local})

    wb_post("/api/products", fields)
    imported = []
    if files:
        res = wb_post("/api/products/" + urllib.parse.quote(fields["productId"], safe="") + "/import",
                      {"paths": [f["path"] for f in files], "processed": True}, timeout=600)
        assets = res.get("assets") if isinstance(res, dict) else None
        by_path = {a.get("sourcePath"): a for a in (assets or []) if isinstance(a, dict)}
        for f in files:
            asset = by_path.get(f["path"]) or {}
            imported.append({"key": f["key"], "kind": f["kind"], "name": f["name"], "local": f["local"],
                             "status": asset.get("status") or "unknown",
                             "assetId": asset.get("id") or "",
                             "error": asset.get("error") or ""})
    return {"ok": True, "workbench": WORKBENCH, "productId": fields["productId"],
            "imported": imported, "skipped": skipped}


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "CollectService/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[collect] %s %s\n" % (self.address_string(), fmt % args))

    def _allowed_origins(self):
        port = self.server.server_port
        origins = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
        try:
            wb = urllib.parse.urlsplit(WORKBENCH)
            if wb.scheme in ("http", "https") and wb.hostname in ("127.0.0.1", "localhost") and not wb.username and not wb.password:
                port = wb.port
                authority = wb.hostname
                if port and port != (80 if wb.scheme == "http" else 443):
                    authority += f":{port}"
                origins.add(f"{wb.scheme}://{authority}")
        except ValueError:
            pass  # 无效配置不能扩展允许来源。
        return origins

    def parse_request(self):
        if not super().parse_request():
            return False
        hosts = self.headers.get_all("Host", [])
        origins = self.headers.get_all("Origin", [])
        allowed_hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if len(hosts) != 1 or hosts[0] not in allowed_hosts or len(origins) > 1 or (origins and origins[0] not in self._allowed_origins()):
            self.close_connection = True
            self._json({"ok": False, "message": "不允许的 Host 或 Origin"}, 403)
            return False
        return True

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin in self._allowed_origins():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type,Range")
            self.send_header("Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges")

    # ---- helpers ----
    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8", headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    # ---- routes ----
    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/media/"):
            return self._media(path)
        if path == "/api/health":
            return self._json({
                "ok": True,
                "aiReverse": AI_REVERSE,
                "platforms": {
                    "kuaishou": {"cookie": _cookie_ok(KS_COOKIE)},
                    "douyin": {"cookie": _cookie_ok(DY_COOKIE), "secrets": _secrets_ok()},
                },
                "mediaDir": MEDIA,
                "workbench": WORKBENCH,
                "interfaceVersion": "collection-search-preview-v3",
            })
        if path == "/api/search":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            platform = (q.get("platform") or [""])[0]
            keyword = (q.get("keyword") or [""])[0].strip()
            pages = min(max(int((q.get("pages") or ["1"])[0] or 1), 1), 3)
            if platform not in ("kuaishou", "douyin"):
                return self._json({"ok": False, "code": "bad_param", "message": "platform 须为 kuaishou|douyin"}, 400)
            if not keyword:
                return self._json({"ok": False, "code": "bad_param", "message": "缺 keyword"}, 400)
            items, err = do_search(platform, keyword, pages)
            if err:
                return self._json({"ok": False, **err})
            return self._json({"ok": True, "items": items})
        if path == "/api/proxy":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            url = (q.get("url") or [""])[0]
            if not url.startswith("http"):
                return self._json({"ok": False, "message": "bad url"}, 400)
            platform = (q.get("platform") or [""])[0] or _platform_of(url)
            try:
                r = open_remote(url, platform)
            except Exception as e:
                return self._json({"ok": False, "message": str(e)[:200]}, 502)
            self.send_response(r.status_code)
            for h in ("Content-Type", "Content-Length", "Accept-Ranges", "Content-Range"):
                v = r.headers.get(h)
                if v:
                    self.send_header(h, v)
            self._cors()
            if not r.headers.get("Content-Length"):
                # 无长度流式响应：HTTP/1.1 keep-alive 下客户端无法判定结束，改为关连接收尾
                self.send_header("Connection", "close")
                self.close_connection = True
            self.end_headers()
            try:
                for chunk in r.iter_content(1 << 16):
                    self.wfile.write(chunk)
            except Exception:
                pass
            return
        return self._static(path)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/preview":
            try:
                body = self._read_json()
                return self._json({"ok": True, "path": browser_preview(body.get("path"), force=body.get("force") is True)})
            except ValueError as e:
                return self._json({"ok": False, "message": str(e)[:300]}, 400)
            except Exception as e:
                return self._json({"ok": False, "message": str(e)[:300]}, 502)
        if path == "/api/download":
            body = self._read_json()
            url = body.get("url") or ""
            if not url.startswith("http"):
                return self._json({"ok": False, "message": "bad url"}, 400)
            platform = body.get("platform") or _platform_of(url)
            kind = body.get("kind") or ("video" if ".mp4" in url or "video" in url else "image")
            try:
                rel, size, hls = download_to_media(url, platform, body.get("name"), kind)
            except Exception as e:
                return self._json({"ok": False, "message": str(e)[:200]}, 502)
            out = {"ok": True, "path": rel, "size": size}
            if hls:
                out["hls"] = True
            return self._json(out)
        if path == "/api/workbench-import":
            body = self._read_json()
            try:
                return self._json(workbench_import(body.get("product") or {}, body.get("materials") or []))
            except ValueError as e:
                return self._json({"ok": False, "message": str(e)[:300]}, 400)
            except Exception as e:
                return self._json({"ok": False, "message": str(e)[:300]}, 502)
        return self._json({"ok": False, "message": "not found"}, 404)

    def do_HEAD(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/media/"):
            return self._media(path, head_only=True)
        target = self._resolve(path)
        if target is None:
            return self._send(404)
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(target)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(os.path.getsize(target)))
        self._cors()
        self.end_headers()

    # ---- static ----
    def _media(self, path, head_only=False):
        target = self._resolve(path)
        if target is None:
            return self._send(404)
        size = os.path.getsize(target)
        start, end = 0, size - 1
        requested = self.headers.get("Range")
        if requested:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
            if not match or not any(match.groups()):
                return self._send(416, headers={"Content-Range": f"bytes */{size}"})
            start = int(match[1]) if match[1] else max(0, size - int(match[2]))
            end = min(int(match[2]), end) if match[1] and match[2] else end
            if start > end or start >= size:
                return self._send(416, headers={"Content-Range": f"bytes */{size}"})
        self.send_response(206 if requested else 200)
        self.send_header("Content-Type", mimetypes.guess_type(target)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(max(0, end - start + 1)))
        self.send_header("Accept-Ranges", "bytes")
        self._cors()
        if requested:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if head_only:
            return
        with open(target, "rb") as stream:
            stream.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = stream.read(min(1 << 16, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def _resolve(self, path):
        """/media/* 走媒体目录，其余静态文件只服务 web/ 子树。"""
        rel = urllib.parse.unquote(path).lstrip("/") or "index.html"
        if rel in ("", "app", "app/"):
            rel = "index.html"
        if rel.startswith("media/"):
            base, inner = MEDIA, rel[6:]
        else:
            base, inner = WEB, rel
        target = os.path.normpath(os.path.join(base, inner))
        if not (target == base or target.startswith(base + os.sep)) or not os.path.isfile(target):
            return None
        return target

    def _static(self, path):
        target = self._resolve(path)
        rel = urllib.parse.unquote(path).lstrip("/")
        if target is None:
            return self._send(404, "not found: " + rel)
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        if target.endswith(".js"):
            ctype = "application/javascript; charset=utf-8"
        elif ctype.startswith("text/") or ctype == "application/javascript":
            ctype += "; charset=utf-8"
        with open(target, "rb") as f:
            body = f.read()
        self._send(200, body, ctype)


def main():
    port = 8765
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    os.makedirs(MEDIA, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"[collect] 原型入口  http://127.0.0.1:{port}/index.html")
    print(f"[collect] API       http://127.0.0.1:{port}/api/health")
    print(f"[collect] ai-reverse 目录: {AI_REVERSE}")
    print(f"[collect] 快手cookie: {'已配置' if _cookie_ok(KS_COOKIE) else '缺失'} | "
          f"抖音cookie: {'已配置' if _cookie_ok(DY_COOKIE) else '缺失'} | "
          f"抖音secrets: {'已配置' if _secrets_ok() else '缺失'}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for p in list(_clients):
            drop_client(p)


if __name__ == "__main__":
    main()
