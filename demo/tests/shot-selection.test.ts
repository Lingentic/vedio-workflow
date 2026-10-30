import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.ts';
import { Media } from '../lib/media.ts';
import { Library } from '../lib/library.ts';
import { fixedNarrationDefinitions } from '../lib/fixed-narration-visuals.ts';
import { intervalsFromNodes } from '../lib/templates.ts';
import { inside } from '../lib/paths.ts';
import { prepareShotSelection, validateShotSelection, SHOT_SELECTION_DESCRIPTION_LIMIT } from '../lib/shot-selection.ts';
import type { Asset, ScriptNode, Task } from '../lib/types.ts';
import type { ShotSelectionInput } from '../lib/shot-selection.ts';

function environment(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-selection-'));
  const store = new Store(root), library = new Library(store, new Media(), () => false);
  t.after(() => {
    store.close();
    assert.ok(inside(os.tmpdir(), root));
    assert.ok(path.basename(root).startsWith('shot-selection-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  function asset(id: string, duration: number, overrides: Partial<Asset> = {}) {
    fs.writeFileSync(store.path(`${id}.mp4`), 'fixture, no real video or model call');
    return store.putAsset({ id, duration, productId: 'product', kind: 'product', title: id, hasVideo: true,
      status: 'ready', relativePath: `${id}.mp4`, createdAt: '2026-10-30T00:00:00Z', ...overrides });
  }
  function fixed(nodeId: string, duration: number) {
    const definition = fixedNarrationDefinitions.find(item => item.nodeId === nodeId)!;
    return asset(`fixed-${nodeId}`, duration, { productId: undefined, kind: 'presenter', binding: nodeId, sourceHash: definition.sha256 });
  }
  function task(nodes: ScriptNode[] = [{ id: 'g1', type: 'generated_narration', text: '商品文案' }], duration = 3): Task {
    const intervals = intervalsFromNodes(nodes);
    intervals.forEach(interval => {
      fs.writeFileSync(store.path(`${interval.id}.wav`), 'fixture audio');
      const step = duration / interval.nodeIds.length;
      Object.assign(interval, { status: 'ready', confirmed: true, duration, relativePath: `${interval.id}.wav`,
        nodeTimes: interval.nodeIds.map((id, index) => ({ id, begin: index * step, end: (index + 1) * step })) });
    });
    const product = { productId: 'product', name: '测试商品', price: '9', specification: '一件', sellingPoints: '测试' };
    return { id: 'task', name: '测试', productId: 'product', templateId: 'template', productSnapshot: product,
      templateSnapshot: { id: 'template', name: '模板', title: '模板', summary: '', nodes }, nodes, variable: '', example: '', black: {},
      stage: 'visual', copyConfirmed: true, audioConfirmed: true, intervals, plan: null,
      settings: { subtitles: false, bgmId: null, bgmVolume: 0 }, preview: null, previewStale: false,
      completed: false, execution: null, error: '', createdAt: '', updatedAt: '' };
  }
  return { store, library, asset, fixed, task };
}

function coveredIntervals(input: ShotSelectionInput, intervalId: string) {
  const ranges = [...input.slots, ...input.fixedVisuals].filter(item => item.intervalId === intervalId).sort((a, b) => a.begin - b.begin);
  assert.equal(ranges[0].begin, 0);
  for (let i = 1; i < ranges.length; i++) assert.ok(Math.abs(ranges[i].begin - ranges[i - 1].end) < 1e-9, '不重叠、不留缝');
  return ranges.at(-1)!.end;
}

test('按真实配音覆盖节点、首尾和停顿；固定画面保留句首/句末部分，红色不消耗商品视频', t => {
  const e = environment(t);
  const nodes: ScriptNode[] = [
    { id: 'red1', type: 'host_clip', text: '主播开场' },
    { id: 't1-b1', type: 'fixed_narration', text: '句首固定画面' },
    { id: 'g1', type: 'generated_narration', text: '商品文案一' },
    { id: 't1-b3', type: 'fixed_narration', text: '句末固定画面' },
    { id: 'red2', type: 'host_clip', text: '主播过场' },
    { id: 't2-b2', type: 'fixed_narration', text: '未指定固定画面' },
    { id: 'g2', type: 'generated_narration', text: '商品文案二' },
  ];
  const task = e.task(nodes);
  Object.assign(task.intervals[0], { duration: 8.4, nodeTimes: [
    { id: 't1-b1', begin: .2, end: 2 }, { id: 'g1', begin: 2.3, end: 5 }, { id: 't1-b3', begin: 5.5, end: 8 },
  ] });
  Object.assign(task.intervals[1], { duration: 3.2, nodeTimes: [{ id: 't2-b2', begin: .1, end: 1.5 }, { id: 'g2', begin: 1.8, end: 3 }] });
  e.fixed('t1-b1', .8); e.fixed('t1-b3', 1); e.asset('product-video', 20);
  const input = prepareShotSelection(task, e.library);
  assert.equal(coveredIntervals(input, 'ai-1'), 8.4);
  assert.equal(coveredIntervals(input, 'ai-2'), 3.2);
  assert.deepEqual(input.fixedVisuals.map(item => [item.nodeId, item.begin, item.end]), [['t1-b1', .2, 1], ['t1-b3', 7, 8]]);
  assert.deepEqual(input.slots.map(item => [item.nodeId, item.begin, item.end]), [
    ['t1-b1', 0, .2], ['t1-b1', 1, 2.3], ['g1', 2.3, 5.5], ['t1-b3', 5.5, 7], ['t1-b3', 8, 8.4], ['t2-b2', 0, 1.8], ['g2', 1.8, 3.2],
  ]);
  assert.equal(input.slots.some(slot => slot.nodeId.startsWith('red')), false);
  assert.deepEqual(input.nodes, nodes);
  assert.ok(Math.abs(input.requiredDuration - 9.8) < 1e-9);
});

test('固定视频超过真实口播时只保留所需部分；完全覆盖时不要求商品候选', t => {
  const e = environment(t), task = e.task([{ id: 't1-b1', type: 'fixed_narration', text: '完整覆盖' }], 2);
  e.fixed('t1-b1', 8);
  const input = prepareShotSelection(task, e.library);
  assert.deepEqual(input.slots, []);
  assert.equal(input.fixedVisuals[0].duration, 2);
  assert.deepEqual(validateShotSelection(input, { choices: [] }).choices, []);
});

test('已指定的固定画面缺失或版本错误明确失败，不随机使用商品视频冒充', t => {
  const e = environment(t), task = e.task([{ id: 't1-b1', type: 'fixed_narration', text: '固定文案' }]);
  e.asset('product-video', 20);
  assert.throws(() => prepareShotSelection(task, e.library), /已绑定画面缺失/);
  const fixed = e.fixed('t1-b1', 2);
  e.store.putAsset({ ...fixed, sourceHash: 'wrong-version' });
  assert.throws(() => prepareShotSelection(task, e.library), /已绑定画面缺失/);
});

test('配音未确认、文件缺失、文案不符和无效节点时间都拒绝规划', t => {
  const e = environment(t); e.asset('video', 20);
  const task = e.task();
  const mutations: [((copy: Task) => void), RegExp][] = [
    [copy => { copy.audioConfirmed = false; }, /完成真实配音/],
    [copy => { copy.intervals[0].confirmed = false; }, /有效音频或时长/],
    [copy => { copy.intervals[0].relativePath = 'absent.wav'; }, /有效音频或时长/],
    [copy => { copy.intervals[0].duration = NaN; }, /有效音频或时长/],
    [copy => { copy.intervals[0].text = '旧稿'; }, /当前文案不一致/],
    [copy => { copy.intervals[0].nodeTimes = []; }, /节点时间/],
    [copy => { copy.intervals[0].nodeTimes![0].end = 4; }, /节点时间/],
    [copy => { copy.intervals[0].nodeTimes![0].begin = -1; }, /节点时间/],
    [copy => { copy.intervals = []; }, /区间与全文节点不一致/],
  ];
  for (const [mutate, expected] of mutations) {
    const copy = structuredClone(task); mutate(copy);
    assert.throws(() => prepareShotSelection(copy, e.library), expected);
  }
  const two = e.task([{ id: 'a', type: 'generated_narration', text: '甲' }, { id: 'b', type: 'generated_narration', text: '乙' }]);
  two.intervals[0].nodeTimes![1].begin = 1;
  assert.throws(() => prepareShotSelection(two, e.library), /节点时间/);
});

test('候选随机不重复，兼顾3倍时长、最少8条、最多40条，短素材不足时有限结束', t => {
  const e = environment(t), task = e.task(undefined, 10);
  for (let i = 0; i < 50; i++) e.asset(`video-${i}`, 5);
  let input = prepareShotSelection(task, e.library);
  assert.equal(input.candidates.length, 8);
  assert.equal(input.candidateDuration, 40);
  assert.equal(input.targetCandidateDuration, 30);
  assert.equal(new Set(input.candidates.map(item => item.id)).size, 8);
  task.intervals[0].duration = 20; task.intervals[0].nodeTimes![0].end = 20;
  input = prepareShotSelection(task, e.library);
  assert.equal(input.candidates.length, 12, '达到最少8条后继续抽至3倍需求时长');
  assert.equal(input.candidateDuration, 60);
  task.intervals[0].duration = 10; task.intervals[0].nodeTimes![0].end = 10;
  for (const asset of e.library.ready('product')) e.store.putAsset({ ...asset, duration: .01 });
  input = prepareShotSelection(task, e.library);
  assert.equal(input.candidates.length, 40);
  assert.equal(new Set(input.candidates.map(item => item.id)).size, 40);
  assert.ok(input.warnings.some(warning => warning.includes('总时长不足')));
  for (const asset of e.library.ready('product').slice(5)) e.store.putAsset({ ...asset, status: 'deleted' });
  assert.equal(prepareShotSelection(task, e.library).candidates.length, 5);
});

test('只提交当前商品可用视频的有界文字描述，标题可兜底，不含本地路径或固定素材', t => {
  const e = environment(t), task = e.task();
  e.asset('description', 10, { description: '长'.repeat(2000), videoDuration: 2 });
  e.asset('title-only', 10, { title: '仅标题', description: '  ' });
  e.asset('other-product', 10, { productId: 'other' });
  e.asset('image', 10, { hasVideo: false });
  e.asset('pending', 10, { status: 'pending' });
  e.asset('unnamed', 10, { title: ' ', description: '' });
  e.asset('unprocessed', 10, { processed: false });
  e.asset('unavailable', 10, { relativePath: 'absent.mp4' });
  e.asset('bad-video-duration', 10, { videoDuration: 0 });
  e.fixed('t1-b1', 10);
  const input = prepareShotSelection(task, e.library);
  assert.deepEqual(input.candidates.map(item => item.id).sort(), ['description', 'title-only']);
  assert.equal(input.candidates.find(item => item.id === 'description')!.description.length, SHOT_SELECTION_DESCRIPTION_LIMIT);
  assert.equal(input.candidates.find(item => item.id === 'description')!.duration, 2);
  assert.equal(input.candidates.find(item => item.id === 'title-only')!.description, '仅标题');
  assert.ok(input.candidates.every(item => Object.keys(item).sort().join(',') === 'description,duration,id'));
  e.store.putAsset({ ...e.store.asset('title-only')!, status: 'deleted' });
  e.store.putAsset({ ...e.store.asset('description')!, status: 'deleted' });
  assert.throws(() => prepareShotSelection(task, e.library), /没有.*可用视频素材/);
});

test('严格校验每段一次和顺序、候选ID、额外字段与覆盖时长，不补错结果', t => {
  const e = environment(t);
  const task = e.task([{ id: 'a', type: 'generated_narration', text: '甲' }, { id: 'b', type: 'generated_narration', text: '乙' }], 6);
  e.asset('short', 1); e.asset('long', 4); e.asset('other-product', 20, { productId: 'other' }); e.fixed('t1-b1', 10);
  const input = prepareShotSelection(task, e.library);
  const correct = input.slots.map(slot => ({ slotId: slot.id, assetIds: ['long'] }));
  for (const response of [null, [], { choices: correct, text: 'injected' }, { choices: correct.slice(1) },
    { choices: [correct[0], correct[0]] }, { choices: [...correct].reverse() },
    { choices: correct.map(row => ({ ...row, assetIds: ['other-product'] })) },
    { choices: correct.map(row => ({ ...row, assetIds: ['fixed-t1-b1'] })) },
    { choices: correct.map(row => ({ ...row, nodeId: 'injected' })) },
    { choices: correct.map(row => ({ ...row, assetIds: ['short'] })) },
    { choices: correct.map(row => ({ ...row, assetIds: [] })) },
  ]) assert.throws(() => validateShotSelection(input, response), /选片/);
});

test('素材不足允许必要重复并提示；保留模型素材播放顺序，按区间末尾裁断', t => {
  const e = environment(t), task = e.task(undefined, 5);
  e.asset('a', 1); e.asset('b', 2);
  const input = prepareShotSelection(task, e.library);
  const response = { choices: [{ slotId: input.slots[0].id, assetIds: ['b', 'a', 'b', 'a'] }] };
  const saved = validateShotSelection(input, response);
  assert.deepEqual(saved.choices, [{ slotId: 'slot-1', nodeId: 'g1', assetIds: ['b', 'a', 'b', 'a'], duration: 6 }]);
  assert.equal(saved.requiredDuration, 5);
  assert.equal(saved.selectedDuration, 6);
  assert.equal(saved.trimToSlotEnd, true);
  assert.deepEqual(saved.candidateIds, input.candidates.map(item => item.id));
  assert.ok(saved.warnings.some(warning => warning.includes('重复使用') && warning.includes('2 条')));
  response.choices[0].assetIds.reverse(); input.slots[0].text = 'mutated';
  assert.deepEqual(saved.choices[0].assetIds, ['b', 'a', 'b', 'a']);
  assert.equal(saved.slots[0].text, '商品文案');
  assert.doesNotThrow(() => JSON.stringify(saved));
});
