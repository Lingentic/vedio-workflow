import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { TestContext } from 'node:test';
import { Store } from '../lib/store.ts';
import { Media } from '../lib/media.ts';
import { Library } from '../lib/library.ts';
import { ShotNamer } from '../lib/material-naming.ts';

async function environment(t: TestContext) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'material-recovery-'));
  const store = new Store(path.join(root, 'data')), media = new Media();
  const original = path.join(root, 'source.mp4');
  await media.ff(['-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=25:d=2', '-f', 'lavfi', '-i', 'color=c=white:s=160x90:r=25:d=2', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', original]);
  let calls = 0;
  const namer = new ShotNamer({ namingCredentialsFile: path.join(root, 'absent.env') }, async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    const ids: string[] = body.generationConfig.responseJsonSchema.properties.shots.items.properties.shot_id.enum;
    return new Response(JSON.stringify({ responseId: 'recovery-fixture', candidates: [{ content: { parts: [{ text: JSON.stringify({ shots: ids.map(id => ({ shot_id: id, short_name: '恢复测试片段', visual_description: '仅验证本地恢复与保存，不调用真实模型。' })) }) }] } }] }), { status: 200 });
  }, media);
  namer.key = 'fixture'; namer.model = 'fixture';
  let library = new Library(store, media, () => false, namer);
  store.putProduct({ productId: 'p', name: '隔离恢复测试', price: '', specification: '', sellingPoints: '' });
  const source = (await library.importFiles('p', [original], false))[0];
  t.after(async () => {
    await library.stopProcessing(); store.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('material-recovery-'));
    await fsp.rm(root, { recursive: true, force: true });
  });
  return { root, store, media, namer, source, get library() { return library; }, restart() { library = new Library(store, media, () => false, namer); return library; }, calls: () => calls };
}

test('a disk failure after the response preserves uncertainty and recovers the returned receipt without resubmission', async t => {
  const e = await environment(t);
  const temporary = path.join(path.dirname(e.store.path(e.source.relativePath!)), 'naming-result.json.tmp');
  await fsp.mkdir(temporary);
  e.library.startProcessing('p', [e.source.id]); await e.library.processingPromise;
  const failed = e.store.asset(e.source.id)!;
  assert.equal(e.calls(), 1); assert.equal(failed.naming?.status, 'uncertain'); assert.equal(failed.processed, false);
  assert.throws(() => e.library.startProcessing('p', [failed.id]), /再次计费/);
  await fsp.rmdir(temporary);
  e.restart().startProcessing('p', [failed.id], true); await e.library.processingPromise;
  assert.equal(e.store.asset(failed.id)!.processed, true);
  assert.equal(e.calls(), 1, 'returned model response is validated and saved locally without another request');
});

test('interruption during thumbnail work already has the child identity and source link, so resume creates no duplicate', async t => {
  const e = await environment(t), originalPoster = e.media.poster.bind(e.media);
  let interrupted = false, linkedAtInterruption = false;
  e.media.poster = async (source, target) => {
    if (!interrupted && e.library.controller) {
      interrupted = true;
      const parent = e.store.asset(e.source.id)!;
      const id = Object.values(parent.outputs || {})[0], child = id && e.store.asset(id);
      linkedAtInterruption = !!child && child.parentId === parent.id && !!child.sourceRange;
      e.library.controller.abort();
      throw new DOMException('fixture interrupted during thumbnail', 'AbortError');
    }
    await originalPoster(source, target);
  };
  e.library.startProcessing('p', [e.source.id]); await e.library.processingPromise;
  assert.equal(linkedAtInterruption, true); assert.equal(e.calls(), 0);
  const before = e.store.asset(e.source.id)!, firstId = Object.values(before.outputs!)[0];
  assert.equal(before.processing?.stage, 'interrupted');
  e.restart().startProcessing('p', [before.id]); await e.library.processingPromise;
  const ready = e.store.asset(before.id)!;
  assert.equal(ready.processed, true); assert.equal(Object.values(ready.outputs!)[0], firstId);
  assert.equal(e.store.assets('p').filter(asset => asset.kind === 'product').length, 2);
  assert.equal(e.calls(), 1);
});
