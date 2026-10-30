import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Store } from './store.ts';
import type { Library } from './library.ts';
import type { Media } from './media.ts';
import type { Preview, Task } from './types.ts';
import { fullCues, soundBlocks } from './plan.ts';
import { signature } from './templates.ts';

const number = (value: number) => value.toFixed(6);
const fit = (width: number, height: number) => `fps=30:start_time=0,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,tpad=stop_mode=clone:stop=-1`;
const codec = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-pix_fmt', 'yuv420p', '-threads', '2'];

function assTime(value: number) {
  const cs = Math.max(0, Math.round(value * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}
function subtitleText(text: string) {
  const chars = [...text.trim()];
  const lines: string[] = [];
  while (chars.length) lines.push(chars.splice(0, 15).join(''));
  return lines.map(line => line.replaceAll('\\', '\\u005c').replaceAll('{', '\\{').replaceAll('}', '\\}')).join('\\N');
}
export function assDocument(task: Task, library: Library): string {
  const cues = fullCues(task, library);
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft YaHei,68,&H0000FFFF,&H0000FFFF,&H00000000,&HFF000000,-1,0,0,0,100,100,0,0,1,6,0,2,55,55,500,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` + cues.map(cue => `Dialogue: 0,${assTime(cue.begin)},${assTime(cue.end)},Default,,0,0,0,,${subtitleText(cue.text)}`).join('\n') + '\n';
}

export async function renderTask(task: Task, library: Library, media: Media, signal: AbortSignal, onProgress: (progress: number, message: string) => void): Promise<{ preview: Preview; base: { relativePath: string; planSignature: string } }> {
  if (!task.plan?.valid) throw new Error('请先补齐商品画面时长');
  const store = library.store, plan = task.plan;
  const selectionPlan = !!task.shotSelection;
  const blocks = soundBlocks(task, library);
  if (signal.aborted) throw new DOMException('生成已停止', 'AbortError');
  const runId = Store.id(), work = path.join(store.taskDir(task.id), 'work', runId), out = path.join(store.taskDir(task.id), 'renders', runId);
  await fsp.mkdir(work, { recursive: true }); await fsp.mkdir(out, { recursive: true });
  const source = (id: string | undefined): string => {
    const asset = id && store.asset(id);
    if (!asset || !library.available(asset)) throw new Error('素材已删除或暂不可用，请返回画面检查');
    return store.path(asset.relativePath!);
  };
  // Inspect the actual streams before a cached picture can conceal a short source.
  const videoInfo = new Map<string, Awaited<ReturnType<Media['probe']>>>();
  if (selectionPlan) {
    const ids = new Set([...plan.entries.map(entry => entry.assetId), ...plan.pieces.flatMap(piece => [piece.assetId, piece.productAssetId].filter((id): id is string => !!id))]);
    for (const id of ids) {
      if (signal.aborted) throw new DOMException('生成已停止', 'AbortError');
      const info = await media.probe(source(id));
      if (!info.hasVideo || !info.videoDuration) throw new Error(`素材没有有效视频画面：${store.asset(id)!.title}`);
      videoInfo.set(id, info);
    }
    for (const piece of plan.pieces) {
      const id = piece.mode === 'product' ? piece.productAssetId! : piece.assetId!;
      const start = piece.mode === 'product' ? piece.productStart || 0 : piece.sourceStart || 0;
      const frames = Math.round((piece.start + piece.duration) * 30) - Math.round(piece.start * 30);
      const available = videoInfo.get(id)!.videoDuration! - start;
      // AAC can end after the last picture. Only the actual quantized output
      // matters; fit's tpad may supply at most one additional output frame.
      if (frames > 0 && (available <= 0 || frames / 30 > available + 1 / 30 + 1e-6)) throw new Error(`素材实际画面时长不足：${store.asset(id)!.title}`);
    }
    for (const block of blocks) {
      if (signal.aborted) throw new DOMException('生成已停止', 'AbortError');
      const input = block.kind === 'host' ? source(block.asset!.id) : store.path(block.interval!.relativePath!);
      const audio = JSON.parse(await media.run(media.ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration:format=duration', '-of', 'json', input], { signal })) as { streams: { duration?: string }[]; format?: { duration?: string } };
      const duration = Number(audio.streams[0]?.duration ?? audio.format?.duration);
      if (!audio.streams.length || !Number.isFinite(duration) || Math.abs(duration - block.duration) > .05) throw new Error('真实配音或主播原声音轨无效，或时长与已确认记录不符');
    }
    if (blocks.some(block => block.kind === 'host')) {
      if (!task.hostImage) throw new Error('请先保存主播下半屏商品图片');
      const image = JSON.parse(await media.run(media.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', store.path(task.hostImage.relativePath)], { signal })) as { streams: { width: number; height: number }[] };
      if (image.streams[0]?.width !== task.hostImage.width || image.streams[0]?.height !== task.hostImage.height) throw new Error('商品图片尺寸与保存配置不一致，请重新保存图片');
    }
  }
  const pictureSignature = signature({ renderer: selectionPlan ? 'selection-image-v1' : 'video-frames-v2', plan: plan.signature, ...(selectionPlan ? { hostImage: task.hostImage } : {}) });
  let picture = task.renderBase && task.renderBase.planSignature === pictureSignature && fs.existsSync(store.path(task.renderBase.relativePath)) ? store.path(task.renderBase.relativePath) : '';
  if (!picture) {
    const files: string[] = [];
    for (let index = 0; index < plan.pieces.length; index++) {
      if (signal.aborted) throw new DOMException('生成已停止', 'AbortError');
      const piece = plan.pieces[index];
      const frames = Math.round((piece.start + piece.duration) * 30) - Math.round(piece.start * 30);
      if (!frames) continue;
      const filename = `piece-${String(index).padStart(4, '0')}.mp4`, target = path.join(work, filename);
      const args = ['-n'];
      let filters: string;
      if (piece.mode === 'host' && selectionPlan) {
        const image = task.hostImage!;
        const ratio = Math.max(1080 / image.width, 960 / image.height) * image.scale;
        const width = Math.ceil(image.width * ratio / 2) * 2, height = Math.ceil(image.height * ratio / 2) * 2;
        args.push('-ss', number((piece.sourceStart || 0) + (videoInfo.get(piece.assetId!)?.videoStart || 0)), '-i', source(piece.assetId), '-loop', '1', '-i', store.path(image.relativePath));
        filters = `[0:v]${fit(1080,1920)},split=2[ht][hf];[ht]crop=1080:960:0:0[top];[hf]crop=1080:120:0:960,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*(1-Y/120)'[fade];[1:v]fps=30,scale=${width}:${height},crop=1080:960:(iw-1080)*${number(image.x)}:(ih-960)*${number(image.y)},setsar=1,pad=1080:1920:0:960:black[bottom];[bottom][top]overlay=0:0:shortest=1[base];[base][fade]overlay=0:960:shortest=1,format=yuv420p[v]`;
      } else if (piece.mode === 'host') {
        const product = store.asset(piece.productAssetId!);
        args.push('-ss', number(piece.sourceStart || 0), '-i', source(piece.assetId), '-ss', number((piece.productStart || 0) + (product!.videoStart || 0)), '-i', source(piece.productAssetId));
        filters = `[0:v]${fit(1080,1920)},split=2[ht][hf];[ht]crop=1080:1080:0:0[top];[hf]crop=1080:120:0:1080,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*(1-Y/120)'[fade];[1:v]${fit(1080,840)},pad=1080:1920:0:1080:black[bottom];[bottom][top]overlay=0:0:shortest=1[base];[base][fade]overlay=0:1080:shortest=1,format=yuv420p[v]`;
      } else {
        const assetId = piece.mode === 'presenter' ? piece.assetId : piece.productAssetId;
        const start = piece.mode === 'presenter' ? piece.sourceStart || 0 : piece.productStart || 0;
        args.push('-ss', number(start + (videoInfo.get(assetId!)?.videoStart ?? store.asset(assetId!)!.videoStart ?? 0)), '-i', source(assetId));
        filters = `[0:v]${fit(1080,1920)},format=yuv420p[v]`;
      }
      onProgress(3 + index / plan.pieces.length * 64, `正在整理画面 ${index + 1}/${plan.pieces.length}`);
      await media.ff([...args, '-filter_complex_threads', '2', '-filter_complex', filters, '-map', '[v]', '-an', '-frames:v', String(frames), ...codec, target], { signal });
      const pieceInfo = await media.probe(target);
      if (pieceInfo.videoFrames !== frames || Math.abs(pieceInfo.videoStart || 0) > .001) throw new Error(`第${index + 1}段画面帧数或起始时间不正确，原预览已保留`);
      files.push(filename);
    }
    await fsp.writeFile(path.join(work, 'picture-list.txt'), files.map(file => `file '${file}'`).join('\n'));
    picture = path.join(work, 'picture.mp4');
    await media.ff(['-n', '-f', 'concat', '-safe', '0', '-i', 'picture-list.txt', '-an', '-c:v', 'copy', '-movflags', '+faststart', 'picture.mp4'], { signal, cwd: work });
  } else onProgress(66, '复用已确认画面和素材顺序');

  const audioFiles: string[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index], filename = `voice-${index}.wav`;
    const input = block.kind === 'host' ? source(block.asset!.id) : store.path(block.interval!.relativePath!);
    onProgress(68 + index / blocks.length * 10, `正在拼接口播 ${index + 1}/${blocks.length}`);
    await media.ff(['-n', '-i', input, '-vn', '-af', `apad=whole_dur=${number(block.duration)},atrim=duration=${number(block.duration)}`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', filename], { signal, cwd: work });
    audioFiles.push(filename);
  }
  await fsp.writeFile(path.join(work, 'voice-list.txt'), audioFiles.map(file => `file '${file}'`).join('\n'));
  await media.ff(['-n', '-f', 'concat', '-safe', '0', '-i', 'voice-list.txt', '-c:a', 'copy', 'narration.wav'], { signal, cwd: work });
  const args = ['-n', '-i', picture, '-i', 'narration.wav'];
  const filters: string[] = [];
  let video = '';
  if (task.settings.subtitles) {
    await fsp.writeFile(path.join(work, 'captions.ass'), assDocument(task, library), 'utf8');
    const fonts = path.join(store.root, '固定素材', '字幕字体');
    await fsp.mkdir(fonts, { recursive: true });
    const sourceFont = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'msyhbd.ttc');
    if (!fs.existsSync(path.join(fonts, 'msyhbd.ttc'))) {
      if (!fs.existsSync(sourceFont)) throw new Error('当前电脑缺少微软雅黑粗体字幕字体，请配置中文字体后再生成');
      await fsp.copyFile(sourceFont, path.join(fonts, 'msyhbd.ttc'));
    }
    const escaped = fonts.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
    video = `ass=filename=captions.ass:fontsdir='${escaped}',`;
  }
  filters.push(`[0:v]${video}format=yuv420p[v]`);
  if (task.settings.bgmId) {
    const musicInput = args.filter(value => value === '-i').length;
    args.push('-stream_loop', '-1', '-i', source(task.settings.bgmId));
    filters.push(`[${musicInput}:a]volume=${task.settings.bgmVolume}[music];[1:a][music]amix=inputs=2:duration=first:normalize=0[a]`);
  }
  args.push('-filter_complex_threads', '2', '-filter_complex', filters.join(';'));
  args.push('-map', '[v]', '-map', task.settings.bgmId ? '[a]' : '1:a:0', ...codec, '-c:a', 'aac', '-b:a', '192k', '-frames:v', String(Math.round(plan.duration * 30)), '-t', number(plan.duration), '-movflags', '+faststart', '-progress', 'pipe:1', path.join(out, 'result.mp4'));
  onProgress(80, '正在合成字幕和背景音乐');
  await media.ff(args, { signal, cwd: work, onProgress: seconds => onProgress(80 + Math.min(18, seconds / plan.duration * 18), '正在合成字幕和背景音乐') });
  const output = path.join(out, 'result.mp4'), info = await media.probe(output);
  if (info.videoFrames !== Math.round(plan.duration * 30) || info.width !== 1080 || info.height !== 1920 || Math.abs(info.fps - 30) > .001 || !info.hasAudio || Math.abs(info.duration - plan.duration) > .15) throw new Error('成片规格或时长校验未通过，已保留原预览');
  onProgress(99, '正在检查成片是否可完整播放');
  await media.ff(['-xerror', '-i', output, '-f', 'null', '-'], { signal });
  return {
    preview: { relativePath: path.relative(store.root, output), ...info, signature: signature({ plan: plan.signature, settings: task.settings }), createdAt: new Date().toISOString() },
    base: { relativePath: path.relative(store.root, picture), planSignature: pictureSignature },
  };
}
