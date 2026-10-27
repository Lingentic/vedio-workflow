import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { MediaInfo } from './types.ts';

export interface RunOptions { signal?: AbortSignal; cwd?: string; onProgress?: (seconds: number) => void; }
export class Media {
  ffmpeg: string; ffprobe: string;
  constructor(ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', ffprobe = process.env.FFPROBE_PATH || '') {
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe || (path.isAbsolute(ffmpeg) ? path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : 'ffprobe');
  }
  run(program: string, args: string[], options: RunOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) return reject(new DOMException('生成已停止', 'AbortError'));
      const child = spawn(program, args, { windowsHide: true, cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '', partial = '';
      const stop = () => child.kill();
      options.signal?.addEventListener('abort', stop, { once: true });
      child.stdout.setEncoding('utf8').on('data', (data: string) => {
        out = (out + data).slice(-2_000_000);
        partial += data;
        const lines = partial.split(/\r?\n/); partial = lines.pop() || '';
        for (const line of lines) if (line.startsWith('out_time_us=')) options.onProgress?.(Number(line.slice(12)) / 1_000_000);
      });
      child.stderr.setEncoding('utf8').on('data', (data: string) => { err = (err + data).slice(-12_000); });
      child.on('error', error => { options.signal?.removeEventListener('abort', stop); reject(error); });
      child.on('close', code => {
        options.signal?.removeEventListener('abort', stop);
        if (options.signal?.aborted) return reject(new DOMException('生成已停止', 'AbortError'));
        if (code !== 0) return reject(new Error(`媒体处理失败：${err.trim().slice(-1800) || `退出码 ${code}`}`));
        resolve(out);
      });
    });
  }
  ff(args: string[], options: RunOptions = {}) { return this.run(this.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], options); }
  async probe(file: string): Promise<MediaInfo> {
    const result = JSON.parse(await this.run(this.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,duration,start_time,nb_frames:format=duration,size,start_time', '-of', 'json', file])) as {
      streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; duration?: string; start_time?: string; nb_frames?: string }[];
      format?: { duration?: string; size?: string; start_time?: string };
    };
    const video = result.streams.find(stream => stream.codec_type === 'video');
    const [a, b] = (video?.r_frame_rate || '0/1').split('/').map(Number);
    const duration = Number(result.format?.duration || video?.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('视频或音频时长无效');
    const videoDuration = Number(video?.duration), videoFrames = Number(video?.nb_frames);
    const videoStart = Number(video?.start_time || 0) - Number(result.format?.start_time || 0);
    if (video && !Number.isFinite(videoStart)) throw new Error('无法读取视频起始时间');
    return { duration, width: video?.width || 0, height: video?.height || 0, fps: b ? a / b : 0, hasVideo: !!video, hasAudio: result.streams.some(stream => stream.codec_type === 'audio'), size: Number(result.format?.size || 0),
      ...(video ? { videoStart } : {}),
      ...(videoDuration > 0 ? { videoDuration } : {}), ...(Number.isSafeInteger(videoFrames) && videoFrames > 0 ? { videoFrames } : {}) };
  }
  async poster(source: string, target: string) {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await this.ff(['-n', '-ss', '0.1', '-i', source, '-frames:v', '1', '-vf', 'scale=320:568:force_original_aspect_ratio=increase,crop=320:568', '-q:v', '3', target]);
  }
}

export async function fileHash(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function repairWav(raw: Buffer): Buffer {
  if (raw.toString('ascii', 0, 4) !== 'RIFF' || raw.toString('ascii', 8, 12) !== 'WAVE') throw new Error('接口未返回有效的 WAV 音频');
  const out = Buffer.from(raw);
  for (let at = 12; at + 8 <= out.length;) {
    const id = out.toString('ascii', at, at + 4), n = out.readUInt32LE(at + 4);
    if (id === 'data') {
      const available = out.length - at - 8;
      if (!n || n === 0xffffffff || n > available) out.writeUInt32LE(available, at + 4);
      out.writeUInt32LE(out.length - 8, 4);
      return out;
    }
    at += 8 + n + n % 2;
  }
  throw new Error('WAV 音频缺少数据块');
}
