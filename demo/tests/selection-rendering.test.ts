import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.ts';
import { Media } from '../lib/media.ts';
import { Library } from '../lib/library.ts';
import { compileSelectionPlan } from '../lib/render-plan.ts';
import { renderTask } from '../lib/renderer.ts';
import type { Asset, Task } from '../lib/types.ts';

test('新选片真实合成：局部区间、固定源起点、主播图片裁切渐变、累计帧数、原声和设置缓存', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-render-'));
  const store = new Store(root), media = new Media(), library = new Library(store, media, () => false);
  t.after(() => { store.close(); assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('selection-render-')); fs.rmSync(root, { recursive: true, force: true }); });
  async function asset(id: string, color: string, duration: number, overrides: Partial<Asset> = {}) {
    const relativePath = `${id}.mp4`;
    await media.ff(['-n', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64:r=30:d=${duration}`, '-f', 'lavfi', '-i', `sine=frequency=${id === 'host' ? 220 : 1000}:duration=${duration}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', store.path(relativePath)]);
    const info = await media.probe(store.path(relativePath));
    return store.putAsset({ id, productId: 'product', kind: 'product', title: id, status: 'ready', relativePath, createdAt: '', ...info, ...overrides });
  }
  await asset('host', 'red', .2, { kind: 'host', productId: undefined, binding: 'red' });
  await asset('A', 'yellow', 4 / 30);
  await asset('B', 'green', .4);
  await asset('fixed', 'cyan', .2, { kind: 'presenter', productId: undefined, binding: 'blue' });
  // Its first half is cyan, second half blue. sourceStart=.2 must use blue.
  await media.ff(['-n', '-f', 'lavfi', '-i', 'color=c=cyan:s=64x64:r=30:d=0.2', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=30:d=0.2', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', store.path('fixed-source.mp4')]);
  store.putAsset({ ...store.asset('fixed')!, relativePath: 'fixed-source.mp4', ...await media.probe(store.path('fixed-source.mp4')) });
  await media.ff(['-n', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.845', '-c:a', 'pcm_s16le', store.path('voice.wav')]);
  await media.ff(['-n', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.15', '-c:a', 'pcm_s16le', store.path('music.wav')]);
  store.putAsset({ id: 'music', title: 'music', kind: 'bgm', duration: .15, status: 'ready', relativePath: 'music.wav', hasAudio: true, createdAt: '' });
  // Four quadrants expose both crop coordinates and zoom. x=1,y=1,scale=2 selects white.
  await media.ff(['-n', '-f', 'lavfi', '-i', 'color=c=black:s=400x200,drawbox=x=200:y=0:w=200:h=100:color=blue:t=fill,drawbox=x=0:y=100:w=200:h=100:color=green:t=fill,drawbox=x=200:y=100:w=200:h=100:color=white:t=fill', '-frames:v', '1', store.path('host.jpg')]);
  const nodes = [{ id: 'red', type: 'host_clip' as const, text: '主播' }, { id: 'blue', type: 'fixed_narration' as const, text: '固定画面' }];
  const product = { productId: 'product', name: '测试', price: '', specification: '', sellingPoints: '' };
  const task: Task = { id: 'task', name: '测试', productId: 'product', templateId: 'template', productSnapshot: product, templateSnapshot: { id: 'template', name: '', title: '', summary: '', nodes }, nodes,
    variable: '', example: '', black: {}, stage: 'visual', copyConfirmed: true, audioConfirmed: true,
    intervals: [{ id: 'ai', nodeIds: ['blue'], text: '固定画面', signature: 'voice-v1', status: 'ready', confirmed: true, relativePath: 'voice.wav', duration: .845, nodeTimes: [{ id: 'blue', begin: 0, end: .845 }], cues: [{ text: '测试字幕', begin: 0, end: .845 }] }],
    hostImage: { relativePath: 'host.jpg', title: '测试', width: 400, height: 200, x: 1, y: 1, scale: 2 },
    shotSelection: { version: 1, taskId: 'task', productId: 'product', signature: 'selection', slots: [
      { id: 'slot1', nodeId: 'blue', intervalId: 'ai', begin: 0, end: .245, duration: .245, text: '固定画面' },
      { id: 'slot2', nodeId: 'blue', intervalId: 'ai', begin: .445, end: .845, duration: .4, text: '固定画面' },
    ], fixedVisuals: [{ nodeId: 'blue', intervalId: 'ai', assetId: 'fixed', begin: .245, end: .445, duration: .2, sourceStart: .2 }],
    choices: [{ slotId: 'slot1', nodeId: 'blue', assetIds: ['A', 'B'], duration: .533333 }, { slotId: 'slot2', nodeId: 'blue', assetIds: ['B'], duration: .4 }], candidateIds: ['A', 'B'], requiredDuration: .645, selectedDuration: .933333, warnings: [], trimToSlotEnd: true },
    plan: null, settings: { subtitles: false, bgmId: null, bgmVolume: 0 }, preview: null, previewStale: false, completed: false, execution: null, error: '', createdAt: '', updatedAt: '' };
  task.plan = compileSelectionPlan(task, library);
  assert.deepEqual(task.plan.pieces.map(piece => piece.mode), ['host', 'product', 'product', 'presenter', 'product']);
  assert.equal(task.plan.entries.length, 3, '主播不消耗商品队列');
  assert.equal(task.plan.pieces[4].productStart, 0, '每个槽位重新从素材片头取用');
  assert.equal(task.plan.signature, compileSelectionPlan(task, library).signature, '编译无随机变化');
  const first = await renderTask(task, library, media, new AbortController().signal, () => {});
  const output = store.path(first.preview.relativePath);
  assert.equal((await media.probe(output)).videoFrames, 31);
  const chunks = await Promise.all(task.plan.pieces.map((_, i) => media.probe(path.join(path.dirname(store.path(first.base.relativePath)), `piece-${String(i).padStart(4, '0')}.mp4`))));
  assert.deepEqual(chunks.map(info => info.videoFrames), [6, 4, 3, 6, 12]);
  let capture = 0;
  async function frame(file: string, time: number) {
    const raw = store.path(`frame-${capture++}.rgb`);
    await media.ff(['-n', '-ss', String(time), '-i', file, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', raw]);
    const buffer = fs.readFileSync(raw);
    assert.equal(buffer.length, 1080 * 1920 * 3);
    return (x: number, y: number) => [...buffer.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3)];
  }
  const host = await frame(output, .1);
  assert.ok(host(540, 500)[0] > 230 && host(540, 500)[1] < 25, '主播上半屏保留红画面');
  assert.ok(host(540, 1500).every(value => value > 225), '放大并定位到右下白色图片，裁满下半屏');
  const upper = host(540, 960), middle = host(540, 1020), lower = host(540, 1080);
  assert.ok(upper[1] < 30 && middle[1] > 80 && middle[1] < 180 && lower[1] > 225, '50%到56.25%即960..1080产生120px渐变');
  const yellow = (await frame(output, .25))(540, 500), green = (await frame(output, .38))(540, 500), blue = (await frame(output, .55))(540, 500);
  assert.ok(yellow[0] > 220 && yellow[1] > 220 && yellow[2] < 30);
  assert.ok(green[1] > 90 && green[0] < 25 && green[2] < 25);
  assert.ok(blue[2] > 220 && blue[0] < 25 && blue[1] < 25, '固定画面从sourceStart=.2的蓝色部分播放');
  async function tone(file: string, start: number, frequency: number) {
    const raw = store.path(`audio-${capture++}.pcm`);
    await media.ff(['-n', '-ss', String(start), '-i', file, '-t', '0.1', '-vn', '-ar', '48000', '-ac', '1', '-f', 's16le', raw]);
    const pcm = fs.readFileSync(raw); let real = 0, imaginary = 0;
    for (let i = 0; i < pcm.length / 2; i++) { const value = pcm.readInt16LE(i * 2) / 32768; real += value * Math.cos(i * 2 * Math.PI * frequency / 48000); imaginary += value * Math.sin(i * 2 * Math.PI * frequency / 48000); }
    return Math.hypot(real, imaginary) / (pcm.length / 2);
  }
  assert.ok(await tone(output, .03, 220) > .03, '保留主播原声');
  assert.ok(await tone(output, .7, 440) > .03, 'AI区间使用真实配音');
  assert.ok(await tone(output, .7, 1000) < .003, '商品视频原声静音');
  task.renderBase = first.base;
  task.settings = { subtitles: true, bgmId: 'music', bgmVolume: .5 };
  assert.equal(compileSelectionPlan(task, library).signature, task.plan.signature, '字幕BGM不影响选片签名');
  const second = await renderTask(task, library, media, new AbortController().signal, () => {});
  assert.equal(second.base.relativePath, first.base.relativePath, '设置返工复用基础画面');
  assert.notEqual(second.preview.relativePath, first.preview.relativePath);
  assert.ok(fs.existsSync(output), '旧成片保留');
  const musicOutput = store.path(second.preview.relativePath);
  assert.ok(await tone(musicOutput, .7, 880) > .015, '短BGM循环且混合正确输入音轨');
  const caption = await frame(musicOutput, .55);
  let yellowPixels = 0, blackPixels = 0;
  for (let y = 1300; y < 1430; y += 2) for (let x = 150; x < 930; x += 2) { const [r, g, b] = caption(x, y); if (r > 180 && g > 180 && b < 70) yellowPixels++; if (r < 35 && g < 35 && b < 35) blackPixels++; }
  assert.ok(yellowPixels > 50 && blackPixels > 50, 'ASS字幕实际出现黄字与黑描边');
  const changed = structuredClone(task); changed.hostImage!.x = 0;
  assert.notEqual(compileSelectionPlan(changed, library).signature, task.plan.signature, '图片位置影响基础画面签名');
  changed.hostImage!.y = 0;
  changed.plan = compileSelectionPlan(changed, library);
  const third = await renderTask(changed, library, media, new AbortController().signal, () => {});
  assert.notEqual(third.base.relativePath, first.base.relativePath, '修改图片裁切必须重建基础画面');
  assert.ok((await frame(store.path(third.preview.relativePath), .1))(540, 1600).every(value => value < 30), '移动到左上角实际呈现黑色图片区域');
  for (const mutate of [
    (copy: Task) => { copy.shotSelection!.slots[0].begin = .01; },
    (copy: Task) => { copy.shotSelection!.fixedVisuals[0].begin = .2; },
    (copy: Task) => { copy.shotSelection!.choices[0].assetIds = ['A']; },
    (copy: Task) => { copy.intervals[0].confirmed = false; },
    (copy: Task) => { copy.hostImage!.scale = .5; },
  ]) { const copy = structuredClone(task); mutate(copy); assert.throws(() => compileSelectionPlan(copy, library)); }
  const abort = new AbortController(); abort.abort();
  await assert.rejects(renderTask(task, library, media, abort.signal, () => {}), { name: 'AbortError' });
  const shortAudio = structuredClone(task); shortAudio.intervals[0].relativePath = 'music.wav';
  shortAudio.plan = compileSelectionPlan(shortAudio, library);
  await assert.rejects(renderTask(shortAudio, library, media, new AbortController().signal, () => {}), /真实配音.*时长/);
  store.putAsset({ ...store.asset('B')!, relativePath: 'A.mp4' });
  task.plan = compileSelectionPlan(task, library);
  await assert.rejects(renderTask(task, library, media, new AbortController().signal, () => {}), /实际画面时长不足/);
  store.putAsset({ ...store.asset('A')!, productId: 'other' });
  assert.throws(() => compileSelectionPlan(task, library), /归属不符/);
});

test('主播AAC尾部超过画面13ms或45ms时，按全片帧边界只补至多一帧', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-aac-tail-'));
  const store = new Store(root), media = new Media(), library = new Library(store, media, () => false);
  t.after(() => { store.close(); assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('selection-aac-tail-')); fs.rmSync(root, { recursive: true, force: true }); });
  await media.ff(['-n', '-f', 'lavfi', '-i', 'color=c=white:s=64x64', '-frames:v', '1', store.path('image.jpg')]);
  const product = { productId: 'product', name: '测试', price: '', specification: '', sellingPoints: '' };
  for (const [videoDuration, audioDuration, expectedFrames] of [[3.4, 3.412993, 102], [4.9, 4.945102, 148]]) {
    const id = `host-${expectedFrames}`, relativePath = `${id}.mp4`;
    await media.ff(['-n', '-f', 'lavfi', '-i', `color=c=red:s=64x64:r=30:d=${videoDuration}`, '-f', 'lavfi', '-i', `sine=frequency=220:duration=${audioDuration}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', store.path(relativePath)]);
    const info = await media.probe(store.path(relativePath));
    assert.ok(Math.abs(info.duration - audioDuration) < .001);
    assert.ok(Math.abs(info.videoDuration! - videoDuration) < .001);
    store.putAsset({ id, title: `正常AAC尾部${expectedFrames}`, kind: 'host', binding: id, status: 'ready', relativePath, createdAt: '', ...info, duration: audioDuration });
    const nodes = [{ id, type: 'host_clip' as const, text: '主播原声' }];
    const task: Task = { id, name: id, productId: 'product', templateId: 'template', productSnapshot: product, templateSnapshot: { id: 'template', name: '', title: '', summary: '', nodes }, nodes,
      variable: '', example: '', black: {}, stage: 'visual', copyConfirmed: true, audioConfirmed: true, intervals: [],
      hostImage: { relativePath: 'image.jpg', title: '测试', width: 64, height: 64, x: .5, y: .5, scale: 1 },
      shotSelection: { version: 1, taskId: id, productId: 'product', signature: id, slots: [], fixedVisuals: [], choices: [], candidateIds: [], requiredDuration: 0, selectedDuration: 0, warnings: [], trimToSlotEnd: true },
      plan: null, settings: { subtitles: false, bgmId: null, bgmVolume: 0 }, preview: null, previewStale: false, completed: false, execution: null, error: '', createdAt: '', updatedAt: '' };
    task.plan = compileSelectionPlan(task, library);
    const result = await renderTask(task, library, media, new AbortController().signal, () => {});
    assert.equal((await media.probe(store.path(result.preview.relativePath))).videoFrames, expectedFrames);
    assert.equal((await media.probe(store.path(result.base.relativePath))).videoFrames, expectedFrames);
    // One extra frame is the limit, even when the float duration looks close.
    task.plan.pieces[0].duration += 2 / 30;
    await assert.rejects(renderTask(task, library, media, new AbortController().signal, () => {}), new RegExp(`实际画面时长不足：正常AAC尾部${expectedFrames}`));
  }
});
