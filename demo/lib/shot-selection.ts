import fs from 'node:fs';
import { fixedNarrationVisuals } from './fixed-narration-visuals.ts';
import { signature } from './templates.ts';
import { AppError } from './types.ts';
import type { Library } from './library.ts';
import type { ScriptNode, Task } from './types.ts';

export interface ShotSelectionSlot {
  id: string; nodeId: string; intervalId: string;
  /** Seconds relative to the interval audio, including its pauses. */
  begin: number; end: number; duration: number; text: string;
}
export interface ShotSelectionCandidate { id: string; description: string; duration: number; }
export interface ShotSelectionFixedVisual {
  nodeId: string; intervalId: string; assetId: string;
  begin: number; end: number; duration: number; sourceStart: number;
}
export interface ShotSelectionInput {
  taskId: string; productId: string; nodes: ScriptNode[];
  slots: ShotSelectionSlot[]; candidates: ShotSelectionCandidate[]; fixedVisuals: ShotSelectionFixedVisual[];
  requiredDuration: number; candidateDuration: number; targetCandidateDuration: number;
  availableCandidateCount: number; warnings: string[]; signature: string;
}
export interface ShotSelectionResponse { choices: { slotId: string; assetIds: string[] }[]; }
export interface ShotSelection {
  version: 1; taskId: string; productId: string; signature: string;
  slots: ShotSelectionSlot[]; fixedVisuals: ShotSelectionFixedVisual[];
  choices: { slotId: string; nodeId: string; assetIds: string[]; duration: number }[];
  candidateIds: string[]; requiredDuration: number; selectedDuration: number; warnings: string[];
  /** The renderer must trim each choice's last video to the slot end. */
  trimToSlotEnd: true;
}

const EPSILON = 1e-6;
export const SHOT_SELECTION_DESCRIPTION_LIMIT = 1200;

export function prepareShotSelection(task: Task, library: Library): ShotSelectionInput {
  if (!task.copyConfirmed || !task.audioConfirmed) throw new AppError('请先确认文案并完成真实配音');
  const nodes = task.nodes.map(node => ({ id: node.id, type: node.type, text: node.text }));
  if (!nodes.length || new Set(nodes.map(node => node.id)).size !== nodes.length) throw new AppError('文案节点为空或编号重复');
  const groups: ScriptNode[][] = [];
  let group: ScriptNode[] | undefined;
  for (const node of nodes) {
    if (node.type === 'host_clip') { group = undefined; continue; }
    if (!group) { group = []; groups.push(group); }
    group.push(node);
  }
  if (groups.length !== task.intervals.length || new Set(task.intervals.map(interval => interval.id)).size !== task.intervals.length) throw new AppError('配音区间与全文节点不一致，请重新确认配音');
  const bindings = new Map(fixedNarrationVisuals(library).map(binding => [binding.nodeId, binding]));
  const slots: ShotSelectionSlot[] = [], fixedVisuals: ShotSelectionFixedVisual[] = [];
  for (let i = 0; i < groups.length; i++) {
    const interval = task.intervals[i], currentNodes = groups[i];
    const duration = interval.duration;
    if (interval.status !== 'ready' || !interval.confirmed || !interval.relativePath || !fs.existsSync(library.store.path(interval.relativePath)) || !Number.isFinite(duration) || duration! <= 0) throw new AppError(`配音区间 ${interval.id} 缺少已确认的有效音频或时长`);
    if (interval.nodeIds.length !== currentNodes.length || interval.nodeIds.some((id, index) => id !== currentNodes[index].id) || interval.text !== currentNodes.map(node => node.text).join('')) throw new AppError(`配音区间 ${interval.id} 与当前文案不一致`);
    const times = interval.nodeTimes;
    if (!times || times.length !== currentNodes.length || times.some((time, index) => time.id !== currentNodes[index].id || !Number.isFinite(time.begin) || !Number.isFinite(time.end) || time.begin < 0 || time.end <= time.begin || time.end > duration! + EPSILON || (index > 0 && time.begin < times[index - 1].end - EPSILON))) throw new AppError(`配音区间 ${interval.id} 缺少完整、有序的节点时间`);
    for (let j = 0; j < currentNodes.length; j++) {
      const node = currentNodes[j], time = times[j];
      // The preceding node owns an inter-node pause; the first/last owns audio head/tail.
      const begin = j === 0 ? 0 : time.begin;
      const end = j === currentNodes.length - 1 ? duration! : times[j + 1].begin;
      const binding = node.type === 'fixed_narration' ? bindings.get(node.id) : undefined;
      if (binding?.status === 'missing') throw new AppError(`固定口播 ${node.id} 的已绑定画面缺失，请恢复原绑定素材`);
      let visual: ShotSelectionFixedVisual | undefined;
      if (binding?.status === 'ready') {
        const asset = binding.assetId ? library.store.asset(binding.assetId) : null;
        const videoDuration = asset?.videoDuration ?? binding.duration;
        if (!asset || asset.kind !== 'presenter' || asset.binding !== node.id || asset.hasVideo === false || !library.available(asset) || !Number.isFinite(videoDuration) || videoDuration <= 0) throw new AppError(`固定口播 ${node.id} 的绑定视频无效`);
        const covered = Math.min(videoDuration, time.end - time.begin);
        const visualBegin = binding.placement === 'end' ? time.end - covered : time.begin;
        visual = { nodeId: node.id, intervalId: interval.id, assetId: asset.id, begin: visualBegin, end: visualBegin + covered, duration: covered, sourceStart: 0 };
        fixedVisuals.push(visual);
      }
      const ranges = visual ? [[begin, visual.begin], [visual.end, end]] : [[begin, end]];
      for (const [from, to] of ranges) {
        if (to - from <= EPSILON) continue;
        slots.push({ id: `slot-${slots.length + 1}`, nodeId: node.id, intervalId: interval.id, begin: from, end: to, duration: to - from, text: node.text });
      }
    }
  }
  const requiredDuration = slots.reduce((sum, slot) => sum + slot.duration, 0);
  const targetCandidateDuration = requiredDuration * 3;
  const pool = library.ready(task.productId).filter(asset => asset.kind === 'product' && asset.productId === task.productId && !asset.binding && (asset.description?.trim() || asset.title.trim())).map(asset => ({
    id: asset.id, description: (asset.description?.trim() || asset.title.trim()).slice(0, SHOT_SELECTION_DESCRIPTION_LIMIT), duration: asset.videoDuration ?? asset.duration,
  })).filter(candidate => Number.isFinite(candidate.duration) && candidate.duration > 0);
  // A finite Fisher-Yates shuffle samples without replacement, even with tiny clips.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const candidates: ShotSelectionCandidate[] = [];
  let candidateDuration = 0;
  for (const candidate of pool) {
    if (!slots.length || candidates.length === 40 || (candidates.length >= Math.min(8, pool.length) && candidateDuration >= targetCandidateDuration)) break;
    candidates.push(candidate); candidateDuration += candidate.duration;
  }
  if (slots.length && !candidates.length) throw new AppError('当前商品没有带描述或标题的可用视频素材');
  const warnings: string[] = [];
  if (candidateDuration + EPSILON < requiredDuration) warnings.push('候选素材总时长不足，选片时需要重复素材并保留重复提示');
  const content = { taskId: task.id, productId: task.productId, nodes, slots, candidates, fixedVisuals,
    requiredDuration, candidateDuration, targetCandidateDuration, availableCandidateCount: pool.length, warnings };
  return { ...content, signature: signature(content) };
}

export function validateShotSelection(input: ShotSelectionInput, response: unknown): ShotSelection {
  if (!response || typeof response !== 'object' || Array.isArray(response) || Object.keys(response).some(key => key !== 'choices') || !Array.isArray((response as Record<string, unknown>).choices)) throw new AppError('选片模型结果必须只包含 choices 列表');
  const rows = (response as { choices: unknown[] }).choices;
  if (rows.length !== input.slots.length) throw new AppError('选片模型结果必须覆盖所有填充区间，且每段恰好一次');
  const candidates = new Map(input.candidates.map(candidate => [candidate.id, candidate]));
  const used = new Set<string>(), repeated = new Set<string>();
  const choices = input.slots.map((slot, index) => {
    const row = rows[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new AppError(`选片区间 ${slot.id} 格式错误`);
    const record = row as Record<string, unknown>;
    if (Object.keys(record).some(key => !['slotId', 'assetIds'].includes(key)) || record.slotId !== slot.id || !Array.isArray(record.assetIds) || !record.assetIds.length) throw new AppError(`选片区间 ${slot.id} 编号、顺序或素材列表不正确`);
    let duration = 0;
    const assetIds = record.assetIds.map(id => {
      if (typeof id !== 'string' || !candidates.has(id)) throw new AppError(`选片区间 ${slot.id} 包含非候选商品视频`);
      duration += candidates.get(id)!.duration;
      if (used.has(id)) repeated.add(id);
      used.add(id);
      return id;
    });
    if (!Number.isFinite(duration) || duration + EPSILON < slot.duration) throw new AppError(`选片区间 ${slot.id} 素材时长不足，需要 ${slot.duration.toFixed(3)} 秒`);
    return { slotId: slot.id, nodeId: slot.nodeId, assetIds, duration };
  });
  const warnings = [...input.warnings];
  if (repeated.size) warnings.push(`部分画面会重复使用（${repeated.size} 条素材）`);
  return { version: 1, taskId: input.taskId, productId: input.productId, signature: input.signature,
    slots: structuredClone(input.slots), fixedVisuals: structuredClone(input.fixedVisuals), choices,
    candidateIds: input.candidates.map(candidate => candidate.id), requiredDuration: input.requiredDuration,
    selectedDuration: choices.reduce((sum, choice) => sum + choice.duration, 0), warnings, trimToSlotEnd: true };
}
