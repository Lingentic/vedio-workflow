import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.ts';
import { Library } from '../lib/library.ts';
import { Media, fileHash } from '../lib/media.ts';
import { ShotNamer, validateMaterialLabels } from '../lib/material-naming.ts';
import { DEFAULT_PROCESSING_SETTINGS, planFixedShots, validateProcessingSettings } from '../lib/shot-plan.ts';
import type { FixedShot } from '../lib/shot-plan.ts';

test('confirmed cut settings preserve full coverage while filtering nearby scene changes', () => {
  const shots = planFixedShots([{ timeSec: 2, score: 40 }, { timeSec: 2.4, score: 70 }, { timeSec: 4, score: 30 }, { timeSec: 5, score: 80 }], 6, DEFAULT_PROCESSING_SETTINGS);
  assert.deepEqual(shots.map(shot => [shot.startSec, shot.endSec]), [[0, 2], [2, 4], [4, 6]]);
  assert.throws(() => validateProcessingSettings({ threshold: 101, minDurationSec: 1.9 }));
  assert.throws(() => validateProcessingSettings({ threshold: 15.2, minDurationSec: '1.9' }));
  assert.deepEqual(planFixedShots([], 1, DEFAULT_PROCESSING_SETTINGS).map(shot => shot.durationSec), [1]);
});

test('naming accepts complete descriptions and rejects missing, duplicate or changed-boundary entries', () => {
  const shots: FixedShot[] = [{ shotId: 'shot_001', startSec: 0, endSec: 3, durationSec: 3 }, { shotId: 'shot_002', startSec: 3, endSec: 6, durationSec: 3 }];
  const labels = shots.map(shot => ({ shot_id: shot.shotId, short_name: '拉链头安装演示', visual_description: '近景展示手指安装并拉动拉链头。' }));
  assert.equal(validateMaterialLabels({ shots: labels }, shots).length, 2);
  assert.throws(() => validateMaterialLabels({ shots: [labels[0], labels[0]] }, shots));
  assert.throws(() => validateMaterialLabels({ shots: [labels[0]] }, shots));
  assert.throws(() => validateMaterialLabels({ shots: labels.map(label => ({ ...label, visual_description: '' })) }, shots));
  assert.throws(() => validateMaterialLabels({ shots: labels.map(label => ({ ...label, end_sec: 99 })) }, shots));
});

test('pending imports require explicit processing; batch failure preserves clips and restart reuses saved naming without paid resubmission', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'material-processing-'));
  const store = new Store(path.join(root, 'data')), media = new Media();
  const original = path.join(root, '原始视频.mp4');
  let calls = 0;
  const namer = new ShotNamer({ namingCredentialsFile: path.join(root, 'absent.env') }, async (_input, init) => {
    calls++;
    if (calls === 1) throw new Error('fixture disconnected after submission');
    const request = JSON.parse(String(init?.body));
    const ids: string[] = request.generationConfig.responseJsonSchema.properties.shots.items.properties.shot_id.enum;
    return new Response(JSON.stringify({ responseId: 'fixture-request', candidates: [{ content: { parts: [{ text: JSON.stringify({ shots: ids.map(id => ({ shot_id: id, short_name: `测试名称 ${id}`, visual_description: '隔离测试画面描述，验证保存而不调用真实模型。' })) }) }] } }], usageMetadata: { totalTokenCount: 123 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }, media);
  namer.key = 'fixture-key'; namer.model = 'fixture-model';
  let library = new Library(store, media, () => false, namer);
  try {
    await media.ff(['-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=25:d=2', '-f', 'lavfi', '-i', 'color=c=white:s=160x90:r=25:d=2',
      '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=25:d=2', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=6',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', original]);
    const originalHash = await fileHash(original);
    store.putProduct({ productId: 'product-a', name: '测试商品', price: '', specification: '', sellingPoints: '' });
    const first = (await library.importFiles('product-a', [original], false))[0];
    const second = (await library.importFiles('product-a', [original], false))[0];
    assert.equal(first.processed, false); assert.equal(calls, 0); assert.equal(store.assets().filter(asset => asset.kind === 'product').length, 0);
    assert.throws(() => library.startProcessing('other-product', [first.id]));
    library.startProcessing('product-a', [first.id, second.id]);
    await library.processingPromise;
    const failed = store.asset(first.id)!, done = store.asset(second.id)!;
    assert.equal(calls, 2, 'one request per source; no automatic retry after disconnect');
    assert.equal(failed.naming?.status, 'uncertain'); assert.equal(failed.processed, false);
    assert.equal(done.processing?.stage, 'ready'); assert.equal(done.processed, true);
    assert.deepEqual(failed.splitSettings, DEFAULT_PROCESSING_SETTINGS);
    const childIds = Object.values(failed.outputs!);
    assert.equal(childIds.length, 3);
    assert.ok(childIds.every(id => store.asset(id)!.processed === false && !library.publicAsset(store.asset(id)!).available), 'unnamed clips remain internal recovery material');
    assert.equal(library.ready('product-a').length, 3, 'only the successfully named source is available for selection');
    const hashes = await Promise.all(childIds.map(id => fileHash(store.path(store.asset(id)!.relativePath!))));
    assert.throws(() => library.startProcessing('product-a', [first.id]), /再次计费/);
    assert.equal(calls, 2);
    library.startProcessing('product-a', [first.id], true);
    await assert.rejects(library.remove(childIds[0]), /正在处理/);
    await library.processingPromise;
    const resumed = store.asset(first.id)!;
    assert.equal(calls, 3); assert.equal(resumed.processed, true);
    assert.deepEqual(Object.values(resumed.outputs!), childIds);
    assert.deepEqual(await Promise.all(childIds.map(id => fileHash(store.path(store.asset(id)!.relativePath!)))), hashes);
    assert.ok(childIds.every(id => store.asset(id)!.description && store.asset(id)!.naming?.status === 'ready'));
    assert.equal(fs.existsSync(store.path(resumed.relativePath!)), true, 'managed source remains available for recovery');
    assert.equal(await fileHash(original), originalHash, 'external original is unchanged');
    resumed.processed = false; resumed.processing = { stage: 'naming', progress: 75, message: 'simulated interrupted commit' }; resumed.naming = { status: 'running', attemptId: 'saved' }; store.putAsset(resumed);
    library = new Library(store, media, () => false, namer);
    assert.equal(store.asset(first.id)!.naming?.status, 'uncertain'); assert.equal(calls, 3);
    library.startProcessing('product-a', [first.id], true); await library.processingPromise;
    assert.equal(store.asset(first.id)!.processed, true); assert.equal(calls, 3, 'restart reuses validated local naming results');
    const damaged = store.asset(childIds[0])!, expectedTitle = damaged.title, expectedDescription = damaged.description;
    await fsp.unlink(store.path(damaged.relativePath!));
    await library.retry(damaged.id);
    assert.equal(store.asset(damaged.id)!.title, expectedTitle); assert.equal(store.asset(damaged.id)!.description, expectedDescription); assert.equal(calls, 3);
    library.saveProcessingSettings({ threshold: 20, minDurationSec: 2.5 });
    assert.deepEqual(new Library(store, media, () => false, namer).processingSettings(), { threshold: 20, minDurationSec: 2.5 });
  } finally {
    await library.stopProcessing(); store.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('material-processing-'));
    await fsp.rm(root, { recursive: true, force: true });
  }
});
