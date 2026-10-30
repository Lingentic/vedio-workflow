import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Media } from '../../demo/lib/media.ts';
import type { SceneEvent } from './cutting.ts';

const previewScale = "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";

class RequestError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
interface Job {
  id: string; name: string; source: string; directory: string; fingerprint: string;
  duration: number; fps: number; phase: 'scanning' | 'previewing' | 'ready' | 'failed' | 'cancelled';
  progress: number; events: SceneEvent[]; previewReady: boolean; error?: string;
}
function publicJob(job: Job | null) {
  if (!job) return null;
  const { source: _source, directory: _directory, fingerprint: _fingerprint, ...result } = job;
  return result;
}

/** One full-resolution scan; threshold=0 exposes scores so later slider changes need no FFmpeg. */
export function scanScenes(media: Media, source: string, signal: AbortSignal, onProgress: (seconds: number) => void): Promise<SceneEvent[]> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(media.ffmpeg, ['-nostdin', '-hide_banner', '-nostats', '-i', source,
      '-map', '0:v:0', '-vf', 'setpts=PTS-STARTPTS,scdet=threshold=0', '-an', '-progress', 'pipe:1', '-f', 'null', '-'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const events: SceneEvent[] = [];
    let stderr = '', partial = '', progressLines = '';
    const stop = () => { child.kill(); };
    signal.addEventListener('abort', stop, { once: true });
    const line = (value: string) => {
      const found = /lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/.exec(value);
      if (found) {
        const score = Number(found[1]), timeSec = Number(found[2]);
        if (score > 0 && Number.isFinite(timeSec)) events.push({ score, timeSec });
      }
    };
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000); partial += chunk;
      const lines = partial.split(/\r?\n/); partial = lines.pop() || '';
      lines.forEach(line);
    });
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      progressLines += chunk;
      const lines = progressLines.split(/\r?\n/); progressLines = lines.pop() || '';
      for (const item of lines) if (item.startsWith('out_time_us=')) onProgress(Number(item.slice(12)) / 1_000_000);
    });
    child.on('error', error => { signal.removeEventListener('abort', stop); reject(error); });
    child.on('close', code => {
      signal.removeEventListener('abort', stop); line(partial);
      if (signal.aborted) return reject(new DOMException('已停止扫描', 'AbortError'));
      if (code !== 0) return reject(new Error(`镜头扫描失败：${stderr.trim().slice(-1800) || `退出码 ${code}`}`));
      resolve(events);
    });
  });
}

async function body(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.includes('application/json')) throw new RequestError('请求需要 JSON', 415);
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 16000) throw new RequestError('请求过大', 413); chunks.push(chunk); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new RequestError('JSON 格式错误'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('请求需要对象');
  return value as Record<string, unknown>;
}
function json(response: http.ServerResponse, data: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}
async function sendMedia(request: http.IncomingMessage, response: http.ServerResponse, file: string) {
  const stat = await fsp.stat(file); let start = 0, end = stat.size - 1, partial = false;
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!match || (!match[1] && !match[2])) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
    start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
      response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return;
    }
    partial = true;
  }
  response.writeHead(partial ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) });
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', error => response.destroy(error)); response.on('close', () => stream.destroy()); stream.pipe(response);
}

export function createLabServer(options: { root?: string; media?: Media } = {}) {
  const media = options.media || new Media();
  const root = options.root || path.join(os.tmpdir(), 'ecommerce-split-lab');
  const jobs = new Map<string, Job>(), clips = new Map<string, Promise<string>>();
  const clipControllers = new Set<AbortController>();
  let current: Job | null = null, active: AbortController | null = null;
  let processing: Promise<void> = Promise.resolve();

  async function processJob(job: Job, controller: AbortController) {
    const signal = controller.signal;
    try {
      const info = await media.probe(job.source);
      if (!info.hasVideo) throw new RequestError('所选文件没有视频画面');
      job.duration = info.videoDuration || Math.max(0, info.duration - (info.videoStart || 0));
      job.fps = info.fps;
      if (!Number.isFinite(job.duration) || job.duration <= 0) throw new RequestError('无法读取视频时长');
      signal.throwIfAborted();
      job.events = await scanScenes(media, job.source, signal, seconds => { job.progress = Math.min(99, seconds / job.duration * 100); });
      job.phase = 'previewing'; job.progress = 0;
      await media.ff(['-y', '-i', job.source, '-map', '0:v:0', '-map', '0:a?', '-t', String(job.duration),
        '-vf', 'setpts=PTS-STARTPTS,' + previewScale,
        '-af', 'asetpts=PTS-STARTPTS', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-movflags', '+faststart', '-progress', 'pipe:1', path.join(job.directory, 'preview.mp4')],
      { signal, onProgress: seconds => { job.progress = Math.min(99, seconds / job.duration * 100); } });
      signal.throwIfAborted();
      job.previewReady = true; job.phase = 'ready'; job.progress = 100;
      await fsp.writeFile(path.join(job.directory, 'scan.json'), JSON.stringify({ source: job.source, ...publicJob(job) }, null, 2));
    } catch (error) {
      job.phase = signal.aborted ? 'cancelled' : 'failed';
      job.error = signal.aborted ? '已停止，可重新扫描' : (error as Error).message;
    } finally { if (active === controller) active = null; }
  }

  async function analyze(value: unknown) {
    if (typeof value !== 'string' || !path.isAbsolute(value.trim())) throw new RequestError('请选择视频或填写完整文件路径');
    if (active) throw new RequestError('正在扫描，请先停止当前扫描', 409);
    const controller = new AbortController(); active = controller;
    try {
      const source = await fsp.realpath(value.trim());
      const info = await fsp.stat(source);
      if (!info.isFile()) throw new RequestError('请选择一个视频文件');
      if (!/\.(mp4|mov|mkv|webm|m4v|avi|mts|ts)$/i.test(source)) throw new RequestError('请选择 MP4、MOV、MKV、WebM 等视频文件');
      const fingerprint = `${source}|${info.size}|${info.mtimeMs}`;
      const cached = [...jobs.values()].find(job => job.fingerprint === fingerprint && job.phase === 'ready');
      if (cached) { current = cached; active = null; return publicJob(cached); }
      controller.signal.throwIfAborted();
      const id = randomUUID(), directory = path.join(root, id);
      await fsp.mkdir(directory, { recursive: true });
      const job: Job = { id, name: path.basename(source), source, directory, fingerprint, duration: 0, fps: 0,
        phase: 'scanning', progress: 0, events: [], previewReady: false };
      jobs.set(id, job); current = job;
      processing = processJob(job, controller);
      return publicJob(job);
    } catch (error) { if (active === controller) active = null; throw error; }
  }

  async function clip(job: Job, start: number, end: number) {
    if (job.phase !== 'ready') throw new RequestError('请等待扫描及预览准备完成', 409);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > job.duration + 1e-6) throw new RequestError('片段时间范围无效');
    const key = createHash('sha256').update(`${job.id}:${start}:${end}`).digest('hex').slice(0, 24);
    const filename = `${key}.mp4`, directory = path.join(job.directory, 'clips'), target = path.join(directory, filename);
    let pending = clips.get(key);
    if (!pending) {
      const controller = new AbortController(); clipControllers.add(controller);
      pending = (async () => {
        await fsp.mkdir(directory, { recursive: true });
        await media.ff(['-y', '-i', job.source, '-ss', String(start), '-t', String(end - start), '-map', '0:v:0', '-map', '0:a?',
          '-vf', previewScale,
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', target], { signal: controller.signal });
        return target;
      })().catch(error => { clips.delete(key); throw error; }).finally(() => { clipControllers.delete(controller); });
      clips.set(key, pending);
    }
    await pending;
    return { url: `/media/${job.id}/clips/${filename}`, name: `${path.parse(job.name).name}_${start.toFixed(3)}-${end.toFixed(3)}.mp4` };
  }

  const server = http.createServer(async (request, response) => {
    try {
      const address = server.address(), port = typeof address === 'object' && address ? address.port : 0;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes(request.headers.host || '')) throw new RequestError('仅允许本机访问', 403);
      if (request.headers.origin && !hosts.some(host => request.headers.origin === `http://${host}`)) throw new RequestError('请求来源不受支持', 403);
      const url = new URL(request.url || '/', `http://127.0.0.1:${port}`), method = request.method || 'GET';
      if (url.pathname === '/api/state' && method === 'GET') return json(response, { job: publicJob(current), busy: !!active });
      if (url.pathname === '/api/analyze' && method === 'POST') return json(response, { job: await analyze((await body(request)).source) }, 202);
      if (url.pathname === '/api/upload' && method === 'POST') {
        if (active) throw new RequestError('请先停止当前扫描再选择视频', 409);
        const name = url.searchParams.get('name');
        if (!name || name.length > 255 || /[\x00-\x1f<>:"/\\|?*]/.test(name) || !/\.(mp4|mov|mkv|webm|m4v|avi|mts|ts)$/i.test(name)) throw new RequestError('请选择一个视频文件');
        const directory = path.join(root, 'uploads', randomUUID());
        await fsp.mkdir(directory, { recursive: true });
        const source = path.join(directory, name);
        try {
          await pipeline(request, fs.createWriteStream(source, { flags: 'wx' }));
          if (!(await fsp.stat(source)).size) throw new RequestError('视频文件为空');
        } catch (error) { await fsp.rm(source, { force: true }); throw error; }
        return json(response, { source }, 201);
      }
      if (url.pathname === '/api/cancel' && method === 'POST') { active?.abort(); return json(response, { ok: true }); }
      const clipRoute = /^\/api\/jobs\/([\w-]+)\/clip$/.exec(url.pathname);
      if (clipRoute && method === 'GET') {
        const job = jobs.get(clipRoute[1]); if (!job) throw new RequestError('视频会话不存在，请重新扫描', 404);
        const start = url.searchParams.get('start'), end = url.searchParams.get('end');
        if (start === null || end === null) throw new RequestError('缺少片段时间');
        return json(response, await clip(job, Number(start), Number(end)));
      }
      const mediaRoute = /^\/media\/([\w-]+)\/(source|clips\/([a-f0-9]{24}\.mp4))$/.exec(url.pathname);
      if (mediaRoute && ['GET', 'HEAD'].includes(method)) {
        const job = jobs.get(mediaRoute[1]); if (!job) throw new RequestError('视频会话不存在', 404);
        if (!job.previewReady) throw new RequestError('视频尚未准备好', 409);
        const file = mediaRoute[2] === 'source' ? path.join(job.directory, 'preview.mp4') : path.join(job.directory, 'clips', mediaRoute[3]);
        return await sendMedia(request, response, file);
      }
      const staticFiles: Record<string, string> = { '/': 'public/index.html', '/styles.css': 'public/styles.css', '/app.js': 'public/app.ts', '/cutting.js': 'cutting.ts', '/cutting.ts': 'cutting.ts' };
      if (method === 'GET' && staticFiles[url.pathname]) {
        const filename = staticFiles[url.pathname], file = path.join(import.meta.dirname, filename);
        const source = await fsp.readFile(file, 'utf8');
        response.writeHead(200, { 'Content-Type': filename.endsWith('.html') ? 'text/html; charset=utf-8' : filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(filename.endsWith('.ts') ? stripTypeScriptTypes(source, { mode: 'strip' }) : source); return;
      }
      throw new RequestError('找不到此资源', 404);
    } catch (error) {
      if (response.headersSent) { response.destroy(error as Error); return; }
      const code = (error as NodeJS.ErrnoException).code;
      const status = error instanceof RequestError ? error.status : code === 'ENOENT' ? 404 : 500;
      json(response, { error: status === 404 ? '文件不存在，请重新选择视频' : (error as Error).message }, status);
    }
  });
  return { server, root, async stop() {
    active?.abort(); for (const controller of clipControllers) controller.abort();
    await processing;
    await Promise.allSettled(clips.values());
    if (server.listening) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  } };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.SPLIT_LAB_PORT || 4196);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('SPLIT_LAB_PORT 需要是 1024–65535 的端口');
  const app = createLabServer();
  app.server.on('error', error => { console.error((error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `端口 ${port} 已被占用；请打开已有工具或设置 SPLIT_LAB_PORT。` : error.message); process.exitCode = 1; });
  app.server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`切分调参台  ${url}\n实验文件目录：${app.root}\n按 Ctrl+C 停止。原视频不会被修改。`);
    if (process.argv.includes('--open')) {
      const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
      const opener = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
      opener.on('error', error => console.error(`请手动打开 ${url}：${error.message}`));
    }
  });
  process.once('SIGINT', () => { void app.stop(); }); process.once('SIGTERM', () => { void app.stop(); });
}
