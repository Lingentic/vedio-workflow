import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Media } from '../../demo/lib/media.ts';
import { planShots } from './cutting.ts';
import { createLabServer } from './server.ts';

test('threshold controls candidates; minimum duration filters short neighbors without creating gaps', () => {
  const events = [{ timeSec: 1, score: 30 }, { timeSec: 1.2, score: 15 }, { timeSec: 2.5, score: 40 }];
  const fine = planShots(events, 4, { threshold: 12, minDurationSec: 0.2 });
  assert.deepEqual(fine.shots.map(shot => [shot.startSec, shot.endSec]), [[0, 1], [1, 1.2], [1.2, 2.5], [2.5, 4]]);
  const filtered = planShots(events, 4, { threshold: 12, minDurationSec: 0.5 });
  assert.deepEqual(filtered.shots.map(shot => [shot.startSec, shot.endSec]), [[0, 1], [1, 2.5], [2.5, 4]]);
  assert.equal(filtered.rejected[0].reason, 'minimum');
  assert.equal(planShots(events, 4, { threshold: 35, minDurationSec: 0.2 }).shots.length, 2);
  assert.deepEqual(planShots(events, 4, { threshold: 12, minDurationSec: 2 }).shots.map(shot => [shot.startSec, shot.endSec]), [[0, 4]]);
});

test('local scan matches direct FFmpeg detection; real clips, cache, media ranges and original preservation', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'split-lab-test-'));
  const source = path.join(directory, '商品原视频.mp4'), media = new Media();
  const app = createLabServer({ root: path.join(directory, 'runs'), media });
  try {
    await media.ff(['-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=25:d=1',
      '-f', 'lavfi', '-i', 'color=c=white:s=160x90:r=25:d=0.2',
      '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=25:d=1.32',
      '-f', 'lavfi', '-i', 'color=c=white:s=160x90:r=25:d=1.48',
      '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=44100:duration=4',
      '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]', '-map', '[v]', '-map', '4:a:0', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', source]);
    const originalHash = createHash('sha256').update(await fsp.readFile(source)).digest('hex');
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const uploaded = await fetch(base + '/api/upload?name=' + encodeURIComponent(path.basename(source)), { method: 'POST', body: new Blob([await fsp.readFile(source)]) });
    assert.equal(uploaded.status, 201);
    const { source: selectedSource } = await uploaded.json() as { source: string };
    assert.equal(path.basename(selectedSource), path.basename(source));
    assert.equal(createHash('sha256').update(await fsp.readFile(selectedSource)).digest('hex'), originalHash);
    assert.equal((await fetch(base + '/api/upload?name=../invalid.mp4', { method: 'POST', body: 'invalid' })).status, 400);
    const response = await fetch(base + '/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: selectedSource }) });
    assert.equal(response.status, 202);
    const started = await response.json() as { job: { id: string } };
    let job: { id: string; phase: string; error?: string; duration: number; previewReady: boolean; events: { timeSec: number; score: number }[] } | undefined;
    for (let tries = 0; tries < 300; tries++) {
      job = (await (await fetch(base + '/api/state')).json()).job;
      if (job && ['ready', 'failed', 'cancelled'].includes(job.phase)) break;
      await delay(30);
    }
    assert.equal(job?.phase, 'ready', job?.error); assert.ok(job); assert.equal(job.previewReady, true);
    assert.ok(Math.abs(job.duration - 4) < 0.05);
    const { stderr } = await promisify(execFile)(media.ffmpeg, ['-nostdin', '-hide_banner', '-i', source, '-vf', 'scdet=threshold=12', '-an', '-f', 'null', '-'], { windowsHide: true });
    const direct = [...stderr.matchAll(/lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/g)].map(item => Number(item[2]));
    assert.deepEqual(job.events.filter(event => event.score >= 12).map(event => event.timeSec), direct);
    assert.equal(direct.length, 3, 'fixture has three real scene changes');
    assert.equal(planShots(job.events, job.duration, { threshold: 12, minDurationSec: 0.2 }).shots.length, 4);
    assert.equal(planShots(job.events, job.duration, { threshold: 12, minDurationSec: 0.5 }).shots.length, 3);
    const clipResponse = await fetch(base + `/api/jobs/${job.id}/clip?start=1&end=1.2`);
    assert.equal(clipResponse.status, 200);
    const clip = await clipResponse.json() as { url: string };
    const clipName = clip.url.split('/').at(-1)!;
    const info = await media.probe(path.join(directory, 'runs', job.id, 'clips', clipName));
    assert.equal(info.hasAudio, true); assert.equal(info.width, 160, 'preview must not upscale the original');
    assert.ok(Math.abs((info.videoDuration || info.duration) - 0.2) < 0.05);
    const stat = await fsp.stat(path.join(directory, 'runs', job.id, 'clips', clipName));
    assert.deepEqual(await (await fetch(base + `/api/jobs/${job.id}/clip?start=1&end=1.2`)).json(), clip);
    assert.equal((await fsp.stat(path.join(directory, 'runs', job.id, 'clips', clipName))).mtimeMs, stat.mtimeMs);
    const ranged = await fetch(base + clip.url, { headers: { Range: 'bytes=0-31' } });
    assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 32);
    assert.equal((await fetch(base + clip.url, { headers: { Range: 'bytes=999999999-' } })).status, 416);
    const cached = await (await fetch(base + '/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: selectedSource }) })).json();
    assert.equal(cached.job.id, started.job.id);
    assert.equal((await fetch(base + `/api/jobs/${job.id}/clip?start=-1&end=2`)).status, 400);
    assert.equal((await fetch(base + '/api/cancel', { method: 'POST', headers: { Origin: 'https://example.org' } })).status, 403);
    assert.equal(createHash('sha256').update(await fsp.readFile(source)).digest('hex'), originalHash);
  } finally { await app.stop(); await fsp.rm(directory, { recursive: true, force: true }); }
});
