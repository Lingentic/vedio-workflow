import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Media, fileHash } from '../lib/media.ts';

test('HEVC asset gets a cached H264 preview; original stays unchanged', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-preview-'));
  const media = new Media();
  try {
    const source = path.join(root, 'original #视频.mp4');
    await media.ff(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x96:r=10:d=0.5', '-c:v', 'libx265', '-x265-params', 'pools=1', '-pix_fmt', 'yuv420p', source]);
    const original = await fileHash(source);
    const cache = path.join(root, 'cache');
    const [preview, duplicate] = await Promise.all([media.browserPreview(source, cache), media.browserPreview(source, cache)]);
    assert.equal(duplicate, preview);
    assert.notEqual(preview, source);
    const probe = JSON.parse(await media.run(media.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,pix_fmt,width,height', '-of', 'json', preview]));
    assert.equal(probe.streams[0].codec_name, 'h264');
    assert.equal(probe.streams[0].pix_fmt, 'yuv420p');
    assert.equal(probe.streams[0].height, 96);
    const stat = await fs.stat(preview);
    assert.equal(await media.browserPreview(source, cache), preview);
    assert.equal((await fs.stat(preview)).mtimeMs, stat.mtimeMs);
    assert.equal(await fileHash(source), original);
    assert.equal(await media.browserPreview(preview, path.join(root, 'other-cache')), preview);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
