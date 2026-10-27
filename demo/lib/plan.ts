import { randomInt } from 'node:crypto';
import type { Asset, Cue, Interval, PicturePiece, Plan, QueueEntry, Task, VisualEvent } from './types.ts';
import { AppError } from './types.ts';
import { Store } from './store.ts';
import { signature } from './templates.ts';
import type { Library } from './library.ts';

export function soundBlocks(task: Task, library: Library): { kind: 'host' | 'ai'; asset?: Asset; interval?: Interval; start: number; duration: number; text: string }[] {
  const result: ReturnType<typeof soundBlocks> = [];
  let elapsed = 0;
  for (const node of task.nodes) {
    if (node.type === 'host_clip') {
      const asset = library.store.assets().find(item => item.kind === 'host' && item.binding === node.id && library.available(item));
      if (!asset) throw new AppError(`固定主播片段未准备好：${node.text}`);
      result.push({ kind: 'host', asset, start: elapsed, duration: asset.duration, text: node.text }); elapsed += asset.duration;
    } else {
      const interval = task.intervals.find(item => item.nodeIds[0] === node.id);
      if (!interval) continue;
      if (interval.status !== 'ready' || !interval.duration || !interval.relativePath) throw new AppError('请先完成并确认全部配音和字幕时间');
      result.push({ kind: 'ai', interval, start: elapsed, duration: interval.duration, text: interval.text }); elapsed += interval.duration;
    }
  }
  return result;
}

export function visualEvents(task: Task, library: Library): VisualEvent[] {
  const result: VisualEvent[] = [];
  for (const block of soundBlocks(task, library)) {
    if (block.kind === 'host') { result.push({ mode: 'host', start: block.start, duration: block.duration, assetId: block.asset!.id, sourceStart: 0 }); continue; }
    const interval = block.interval!;
    let cursor = 0;
    for (const timing of interval.nodeTimes || []) {
      const node = task.nodes.find(item => item.id === timing.id);
      if (node?.type !== 'fixed_narration') continue;
      const presenter = library.store.assets().find(item => item.kind === 'presenter' && item.binding === node.id && library.available(item));
      if (!presenter) continue;
      // Leading TTS silence belongs to the first narration node, not a separate product shot.
      const start = timing.id === interval.nodeIds[0] ? 0 : Math.max(cursor, timing.begin);
      const duration = Math.min(presenter.duration, timing.end - start, block.duration - start);
      if (duration <= 0) continue;
      if (start > cursor) result.push({ mode: 'product', start: block.start + cursor, duration: start - cursor, intervalId: interval.id });
      result.push({ mode: 'presenter', start: block.start + start, duration, assetId: presenter.id, sourceStart: 0, nodeId: node.id, intervalId: interval.id });
      cursor = start + duration;
    }
    if (cursor < block.duration) result.push({ mode: 'product', start: block.start + cursor, duration: block.duration - cursor, intervalId: interval.id });
  }
  return result.filter(event => event.duration > 0.000001);
}

function shuffled<T>(array: T[]): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) { const j = randomInt(i + 1); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

export function buildPlan(task: Task, library: Library, manualIds?: string[], retainAutoIds?: string[]): Plan {
  const events = visualEvents(task, library);
  const requiredDuration = events.filter(event => event.mode !== 'presenter').reduce((sum, event) => sum + event.duration, 0);
  const candidates = library.ready(task.productId);
  let repeated = false;
  let selected: (Asset | null)[] = [];
  if (manualIds) selected = manualIds.map(id => library.store.asset(id)).map(asset => asset?.kind === 'product' && asset.productId === task.productId && library.available(asset) ? asset : null);
  else if (candidates.length) {
    const retained = retainAutoIds?.map(id => candidates.find(asset => asset.id === id)).filter((asset): asset is Asset => !!asset) || [];
    selected.push(...retained);
    let seconds = selected.reduce((sum, asset) => sum + asset!.duration, 0);
    while (seconds < requiredDuration - 0.000001) {
      let cycle = shuffled(candidates);
      if (cycle.length > 1 && selected.at(-1)?.id === cycle[0].id) cycle = [...cycle.slice(1), cycle[0]];
      if (selected.length) repeated = true;
      for (const asset of cycle) { selected.push(asset); seconds += asset.duration; if (seconds >= requiredDuration) break; }
    }
  }
  const ids = manualIds || selected.map(asset => asset!.id);
  repeated = repeated || new Set(ids).size < ids.length;
  const entries: QueueEntry[] = selected.map((asset, i) => ({ entryId: Store.id(), assetId: ids[i], title: asset?.title || '片段已删除或暂不可用', duration: asset?.duration || 0, available: !!asset, url: asset ? `/media/asset/${asset.id}` : undefined, posterUrl: asset?.posterPath ? `/poster/${asset.id}` : undefined }));
  const availableDuration = entries.reduce((sum, entry) => sum + entry.duration, 0);
  const valid = entries.length > 0 && entries.every(entry => entry.available) && availableDuration + 0.000001 >= requiredDuration;
  const warnings: string[] = [];
  if (repeated && !manualIds) warnings.push('当前商品素材时长不足，成片中会重复使用部分画面');
  if (!valid) warnings.push(!candidates.length ? '当前商品没有可用片段，请先补充素材' : `商品画面还缺 ${Math.max(0, requiredDuration - availableDuration).toFixed(2)} 秒，请补充或调整素材`);
  const pieces: PicturePiece[] = [];
  if (valid) {
    let index = 0, used = 0;
    for (const event of events) {
      if (event.mode === 'presenter') { pieces.push({ ...event }); continue; }
      let remaining = event.duration, offset = 0;
      while (remaining > 0.000001) {
        const entry = entries[index];
        if (!entry) throw new Error('商品画面队列提前耗尽');
        const duration = Math.min(remaining, entry.duration - used);
        if (duration <= 0.000001) { index++; used = 0; continue; }
        pieces.push({ ...event, start: event.start + offset, duration, sourceStart: (event.sourceStart || 0) + offset, productAssetId: entry.assetId, productStart: used });
        used += duration; remaining -= duration; offset += duration;
        if (used >= entry.duration - 0.000001) { index++; used = 0; }
      }
    }
  }
  const duration = events.reduce((end, event) => Math.max(end, event.start + event.duration), 0);
  return { mode: manualIds ? 'manual' : 'auto', entries, events, pieces, duration, requiredDuration, availableDuration, valid, repeated, warnings,
    signature: signature({ events, pieces, intervals: task.intervals.map(item => ({ id: item.id, signature: item.signature, duration: item.duration, file: item.relativePath })) }) };
}

export function fullCues(task: Task, library: Library): Cue[] {
  return soundBlocks(task, library).flatMap(block => block.kind === 'host' ? [{ text: block.text, begin: block.start, end: block.start + block.duration }] : block.interval!.cues!.map(cue => ({ ...cue, begin: block.start + cue.begin, end: block.start + cue.end })));
}
