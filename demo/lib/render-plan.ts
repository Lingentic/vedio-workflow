import fs from 'node:fs';
import type { Library } from './library.ts';
import { soundBlocks } from './plan.ts';
import { signature } from './templates.ts';
import { AppError } from './types.ts';
import type { Asset, PicturePiece, Plan, QueueEntry, Task, VisualEvent } from './types.ts';

const EPSILON = 1e-6;

/** Compile the saved per-slot choices without sampling or consuming a global queue. */
export function compileSelectionPlan(task: Task, library: Library): Plan {
  const selection = task.shotSelection;
  if (!selection || selection.stale || selection.taskId !== task.id || selection.productId !== task.productId) throw new AppError('请先完成当前任务的有效选片');
  if (!task.copyConfirmed || !task.audioConfirmed) throw new AppError('请先确认文案和真实配音');
  const groups: string[][] = [];
  let group: string[] | undefined;
  for (const node of task.nodes) {
    if (node.type === 'host_clip') { group = undefined; continue; }
    if (!group) { group = []; groups.push(group); }
    group.push(node.id);
  }
  if (!task.nodes.length || new Set(task.nodes.map(node => node.id)).size !== task.nodes.length || groups.length !== task.intervals.length || new Set(task.intervals.map(interval => interval.id)).size !== task.intervals.length || groups.some((ids, index) => ids.join('\0') !== task.intervals[index].nodeIds.join('\0'))) throw new AppError('配音区间与全文节点不一致');
  const blocks = soundBlocks(task, library);
  if (!blocks.length || blocks.filter(block => block.kind === 'ai').length !== task.intervals.length) throw new AppError('配音区间与全文节点不一致');
  const assets = new Map<string, Asset>();
  const video = (id: string, kind: Asset['kind'], nodeId?: string) => {
    const asset = library.store.asset(id);
    if (!asset || asset.kind !== kind || (kind === 'product' && (asset.productId !== task.productId || !!asset.binding)) || (nodeId && asset.binding !== nodeId) || asset.hasVideo === false || !library.available(asset)) throw new AppError(`选片素材已删除、不可用或归属不符：${id}`);
    const duration = asset.videoDuration ?? asset.duration;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(asset.videoStart ?? 0) || (asset.videoStart ?? 0) < 0) throw new AppError(`选片素材视频时长无效：${asset.title}`);
    assets.set(id, asset);
    return { asset, duration };
  };
  const intervalIds = new Set(blocks.flatMap(block => block.interval ? [block.interval.id] : []));
  if ([...selection.slots, ...selection.fixedVisuals].some(range => !intervalIds.has(range.intervalId)) || new Set(selection.slots.map(slot => slot.id)).size !== selection.slots.length || selection.choices.length !== selection.slots.length) throw new AppError('选片区间编号或数量与配音不一致');
  const entries: QueueEntry[] = [], events: VisualEvent[] = [], pieces: PicturePiece[] = [];
  let requiredDuration = 0, availableDuration = 0;
  for (const block of blocks) {
    if (!Number.isFinite(block.duration) || block.duration <= 0) throw new AppError('声音区间时长无效');
    if (block.kind === 'host') {
      video(block.asset!.id, 'host');
      if (block.asset!.hasAudio === false) throw new AppError('主播原片缺少原声音轨');
      const image = task.hostImage;
      if (!image || !fs.existsSync(library.store.path(image.relativePath)) || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0 || !Number.isFinite(image.scale) || image.scale < 1 || !Number.isFinite(image.x) || image.x < 0 || image.x > 1 || !Number.isFinite(image.y) || image.y < 0 || image.y > 1) throw new AppError('请先保存有效的主播下半屏商品图片');
      const event: VisualEvent = { mode: 'host', assetId: block.asset!.id, start: block.start, duration: block.duration, sourceStart: 0 };
      events.push(event); pieces.push(event);
      continue;
    }
    const interval = block.interval!;
    const nodes = task.nodes.filter(node => interval.nodeIds.includes(node.id));
    if (!interval.confirmed || !interval.relativePath || !fs.existsSync(library.store.path(interval.relativePath)) || nodes.map(node => node.id).join('\0') !== interval.nodeIds.join('\0') || nodes.map(node => node.text).join('') !== interval.text) throw new AppError(`配音区间 ${interval.id} 与当前文案不一致或音频无效`);
    const ranges = [
      ...selection.slots.filter(slot => slot.intervalId === interval.id).map(slot => ({ ...slot, slot })),
      ...selection.fixedVisuals.filter(fixed => fixed.intervalId === interval.id).map(fixed => ({ ...fixed, fixed })),
    ].sort((a, b) => a.begin - b.begin);
    let cursor = 0;
    for (const range of ranges) {
      if (!interval.nodeIds.includes(range.nodeId) || !Number.isFinite(range.begin) || !Number.isFinite(range.end) || !Number.isFinite(range.duration) || range.end <= range.begin || Math.abs(range.begin - cursor) > EPSILON || range.end > interval.duration! + EPSILON || Math.abs(range.duration - (range.end - range.begin)) > EPSILON) throw new AppError(`选片区间 ${interval.id} 存在空洞、重叠或无效时长`);
      const start = block.start + range.begin;
      if ('fixed' in range) {
        const fixed = range.fixed;
        const { duration } = video(fixed.assetId, 'presenter', fixed.nodeId);
        if (!Number.isFinite(fixed.sourceStart) || fixed.sourceStart < 0 || fixed.sourceStart + range.duration > duration + EPSILON) throw new AppError(`固定画面 ${fixed.nodeId} 可用时长不足`);
        const event: VisualEvent = { mode: 'presenter', start, duration: range.duration, sourceStart: fixed.sourceStart, assetId: fixed.assetId, nodeId: fixed.nodeId, intervalId: interval.id };
        events.push(event); pieces.push(event);
      } else {
        const slot = range.slot;
        const choices = selection.choices.filter(choice => choice.slotId === slot.id);
        if (choices.length !== 1 || choices[0].nodeId !== slot.nodeId || !choices[0].assetIds.length) throw new AppError(`选片区间 ${slot.id} 缺少唯一有效选择`);
        const event: VisualEvent = { mode: 'product', start, duration: range.duration, nodeId: slot.nodeId, intervalId: interval.id };
        events.push(event); requiredDuration += range.duration;
        let elapsed = 0;
        for (const [index, id] of choices[0].assetIds.entries()) {
          const { asset, duration } = video(id, 'product');
          entries.push({ entryId: `${slot.id}-${index}`, assetId: id, title: asset.title, duration, available: true, url: `/media/asset/${id}` });
          availableDuration += duration;
          const used = Math.min(duration, range.duration - elapsed);
          if (used > EPSILON) pieces.push({ ...event, start: start + elapsed, duration: used, productAssetId: id, productStart: 0 });
          elapsed += Math.max(0, used);
        }
        if (elapsed < range.duration - EPSILON) throw new AppError(`选片区间 ${slot.id} 商品画面时长不足`);
      }
      cursor = range.end;
    }
    if (Math.abs(cursor - block.duration) > EPSILON) throw new AppError(`选片区间 ${interval.id} 未覆盖完整配音`);
  }
  const duration = blocks.reduce((sum, block) => sum + block.duration, 0);
  if (Math.round(duration * 30) < 1) throw new AppError('成片时长不足一帧');
  return { mode: selection.mode === 'manual' ? 'manual' : 'auto', entries, events, pieces, duration, requiredDuration, availableDuration, valid: true,
    repeated: new Set(entries.map(entry => entry.assetId)).size < entries.length, warnings: [...selection.warnings],
    signature: signature({ renderer: 'selection-v1', selection:{slots:selection.slots,fixedVisuals:selection.fixedVisuals,choices:selection.choices}, pieces, assets: [...assets.values()].map(asset => ({ id: asset.id, path: asset.relativePath, duration: asset.videoDuration ?? asset.duration, start: asset.videoStart ?? 0 })),
      hostImage: task.hostImage && { path: task.hostImage.relativePath, width: task.hostImage.width, height: task.hostImage.height, x: task.hostImage.x, y: task.hostImage.y, scale: task.hostImage.scale },
      audio: blocks.map(block => ({ start: block.start, duration: block.duration, assetId: block.asset?.id, intervalId: block.interval?.id, file: block.interval?.relativePath, signature: block.interval?.signature })) }) };
}
