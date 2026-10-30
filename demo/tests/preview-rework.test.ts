import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.ts';
import { Media } from '../lib/media.ts';
import { Models } from '../lib/models.ts';
import { Library } from '../lib/library.ts';
import { Workflow } from '../lib/workflow.ts';
import { buildPlan } from '../lib/plan.ts';
import { intervalsFromNodes, signature } from '../lib/templates.ts';
import { inside } from '../lib/paths.ts';
import type { Asset, Task } from '../lib/types.ts';

function environment(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecommerce-demo-rework-'));
  const store = new Store(root), media = new Media(), models = new Models({ credentialsFile: path.join(root, 'absent.env') });
  let workflow: Workflow;
  const library = new Library(store, media, id => !!workflow?.active?.inputIds.has(id));
  workflow = new Workflow(store, library, media, models);
  store.putProduct({ productId: 'p', name: '测试商品', price: '9', specification: '1件', sellingPoints: '耐用' });
  t.after(() => { store.close(); assert.ok(inside(os.tmpdir(), root)); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store, media, models, library, workflow };
}
function addAsset(store: Store, id: string) {
  const file = path.join('商品素材', `${id}.mp4`), full = store.path(file);
  fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, 'fixture');
  const asset: Asset = { id, productId: 'p', kind: 'product', title: id, status: 'ready', relativePath: file, duration: 2, videoDuration: 2, videoStart: 0, videoFrames: 60, createdAt: new Date().toISOString() };
  store.putAsset(asset); return asset;
}
function renderableTask(e: ReturnType<typeof environment>) {
  const task = e.workflow.create('p', 'template-01-insoles');
  task.nodes = [{ id: 'voice', type: 'generated_narration', text: '测试文案' }];
  task.intervals = intervalsFromNodes(task.nodes);
  const audio = e.store.path(path.join('制作任务', task.id, 'audio', 'voice.wav'));
  fs.mkdirSync(path.dirname(audio), { recursive: true }); fs.writeFileSync(audio, 'fixture');
  Object.assign(task.intervals[0], { status: 'ready', confirmed: true, duration: 3, relativePath: path.relative(e.store.root, audio), cues: [{ text: '测试文案', begin: 0, end: 3 }], nodeTimes: [{ id: 'voice', begin: 0, end: 3 }] });
  task.copyConfirmed = true; task.audioConfirmed = true;
  addAsset(e.store, 'A'); addAsset(e.store, 'B');
  task.plan = buildPlan(task, e.library, ['A', 'B']);
  e.store.putTask(task);
  return task;
}

test('预览快照仅在设置变化时报告具体字幕和BGM原因', t => {
  const e = environment(t), task = e.workflow.create('p', 'template-01-insoles');
  const musicPath = e.store.path(path.join('固定素材', 'music.mp3'));
  fs.mkdirSync(path.dirname(musicPath), { recursive: true }); fs.writeFileSync(musicPath, 'fixture');
  e.store.putAsset({ id: 'music', kind: 'bgm', title: 'music', status: 'ready', relativePath: path.relative(e.store.root, musicPath), duration: 10, createdAt: new Date().toISOString() });
  task.plan = { mode: 'auto', entries: [], requiredDuration: 0, availableDuration: 0, valid: true, repeated: false, warnings: [], events: [], pieces: [], signature: 'plan', duration: 0 };
  task.preview = { relativePath: 'old.mp4', duration: 3, width: 1080, height: 1920, fps: 30, size: 1, signature: 'old', createdAt: new Date().toISOString() };
  task.previewStale = false; e.store.putTask(task);
  e.workflow.patch(task.id, { settings: { subtitles: false, bgmId: 'music', bgmVolume: .3 } });
  const result = e.workflow.publicTask(e.workflow.get(task.id));
  assert.deepEqual(result.previewChanges, ['字幕设置已变化', 'BGM已变化', 'BGM音量已变化']);
});

test('文案变化导致确认失效后，即使设置恢复原值也不能恢复预览有效状态', t => {
  const e = environment(t), task = e.workflow.create('p', 'template-01-insoles');
  task.plan = { mode: 'auto', entries: [], requiredDuration: 0, availableDuration: 0, valid: true, repeated: false, warnings: [], events: [], pieces: [], signature: 'plan', duration: 0 };
  task.copyConfirmed = true; task.audioConfirmed = true;
  task.preview = { relativePath: 'old.mp4', duration: 3, width: 1080, height: 1920, fps: 30, size: 1, signature: signature({ plan: 'plan', settings: task.settings }), createdAt: new Date().toISOString() };
  e.store.putTask(task);

  e.workflow.patch(task.id, { settings: { bgmVolume: .3 } });
  e.workflow.patch(task.id, { black: { 't1-g4': '修改后的文案。' } });
  assert.equal(e.workflow.get(task.id).copyConfirmed, false);
  e.workflow.patch(task.id, { settings: { bgmVolume: .12 } });
  assert.equal(e.workflow.get(task.id).previewStale, true);
});

test('render默认保留画面；refill选择auto商品方案且不触发模型', async t => {
  const e = environment(t), task = renderableTask(e), original = task.plan!.entries.map(entry => entry.assetId);
  assert.equal(task.videoSubmittedAt, null);
  let modelCalls = 0;
  e.models.copy = async () => { modelCalls++; throw new Error('unexpected model call'); };
  e.models.voice = async () => { modelCalls++; throw new Error('unexpected model call'); };
  e.media.ff = async (_args: string[], options?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true });
  });

  e.workflow.render(task.id);
  const submittedAt = e.workflow.get(task.id).videoSubmittedAt;
  assert.ok(submittedAt);
  assert.equal(e.workflow.get(task.id).plan?.mode, 'manual');
  assert.deepEqual(e.workflow.get(task.id).plan?.entries.map(entry => entry.assetId), original);
  e.workflow.stop(task.id); await e.workflow.active?.promise;
  assert.equal(e.workflow.get(task.id).videoSubmittedAt, submittedAt);

  e.workflow.render(task.id, true);
  const refilled = e.workflow.get(task.id).plan!;
  assert.equal(refilled.mode, 'auto');
  assert.notDeepEqual(refilled.entries.map(entry => entry.assetId), original);
  e.workflow.stop(task.id); await e.workflow.active?.promise;
  assert.equal(modelCalls, 0);
  assert.equal(e.workflow.get(task.id).videoSubmittedAt, submittedAt);
});

test('文案和配音执行不会把草稿加入生成记录；前置拒绝的render也不会提交', async t => {
  const e = environment(t), task = e.workflow.create('p', 'template-01-insoles');
  assert.equal(task.videoSubmittedAt, null);
  e.models.ready = () => true;
  e.models.copy = async () => { throw new Error('fixture copy failure'); };
  e.workflow.generateCopy(task.id);
  await e.workflow.active?.promise;
  assert.equal(e.workflow.get(task.id).videoSubmittedAt, null);

  task.copyConfirmed = true;
  task.intervals = intervalsFromNodes([{ id: 'voice', type: 'generated_narration', text: '测试文案' }]);
  e.store.putTask(task);
  e.models.voice = async () => { throw new Error('fixture voice failure'); };
  e.workflow.generateVoice(task.id);
  await e.workflow.active?.promise;
  assert.equal(e.workflow.get(task.id).videoSubmittedAt, null);

  assert.throws(() => e.workflow.render(task.id), /请先确认文案、配音并补足画面时长/);
  assert.equal(e.workflow.get(task.id).videoSubmittedAt, null);
});

test('切换仅允许已提交任务保留并新建，兼容旧提交证据且覆盖沿用原时间', t => {
  const e = environment(t), draft = e.workflow.create('p', 'template-01-insoles');
  delete draft.videoSubmittedAt;
  e.store.putTask(draft);
  assert.equal(e.workflow.publicTask(draft).videoSubmittedAt, null);
  assert.equal(e.store.task(draft.id)?.videoSubmittedAt, undefined);
  assert.equal(e.workflow.get(draft.id).videoSubmittedAt, null);
  assert.equal(e.store.task(draft.id)?.videoSubmittedAt, undefined);
  draft.videoSubmittedAt = null;
  assert.equal(e.workflow.publicTask(draft).videoSubmittedAt, null);
  const savedDraft = e.store.task(draft.id);
  assert.throws(() => e.workflow.switch(draft.id, 'p', 'template-02-zipper', 'new'), /尚未提交生成视频/);
  assert.equal(e.store.tasks().length, 1);
  assert.deepEqual(e.store.task(draft.id), savedDraft);

  const rendered = structuredClone(draft);
  delete rendered.videoSubmittedAt;
  rendered.id = 'legacy-rendered'; rendered.execution = { id: 'run', kind: 'render', status: 'failed', progress: 0, message: '', startedAt: '2026-01-02T03:04:05.000Z' };
  e.store.putTask(rendered);
  assert.equal(e.workflow.publicTask(rendered).videoSubmittedAt, rendered.execution.startedAt);
  assert.equal(e.workflow.get(rendered.id).videoSubmittedAt, rendered.execution.startedAt);
  assert.equal(e.store.task(rendered.id)?.videoSubmittedAt, undefined);

  const overwritten = e.workflow.switch(rendered.id, 'p', 'template-01-insoles', 'overwrite');
  assert.equal(overwritten.videoSubmittedAt, rendered.execution.startedAt);
  const fresh = e.workflow.switch(overwritten.id, 'p', 'template-01-insoles', 'new');
  assert.equal(fresh.videoSubmittedAt, null);
  assert.notEqual(fresh.id, overwritten.id);
  assert.deepEqual(e.store.task(overwritten.id), overwritten);
});
