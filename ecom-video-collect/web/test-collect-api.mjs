import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
for (const embedded of [true, false]) {
  const context = { window: {}, URL, URLSearchParams, document: { currentScript: { src: `http://localhost:4186/${embedded ? 'collect/' : ''}collect-api.js` } }, location: { origin: 'http://localhost:4186', search: '' } };
  vm.runInNewContext(readFileSync(new URL('./collect-api.js', import.meta.url), 'utf8'), context);
  assert.equal(context.window.CollectApi.onlineEnabled, true);
  for (const search of ['', '?preview=online', '?preview=download']) {
    context.location.search = search;
    vm.runInNewContext(readFileSync(new URL('./collect-api.js', import.meta.url), 'utf8'), context);
    assert.equal(context.window.CollectApi.onlineEnabled, true, 'candidate preview must not require a special URL');
  }
  const remote = 'https://cdn.example/视频.mp4?a=1&signature=abc%23';
  const stream = new URL(context.window.CollectApi.onlineUrl(remote, '抖音', 30.5), 'http://localhost:4186');
  assert.equal(stream.pathname, embedded ? '/api/collect/stream' : '/api/stream');
  assert.equal(stream.searchParams.get('url'), remote);
  assert.equal(stream.searchParams.get('platform'), 'douyin');
  assert.equal(stream.searchParams.get('start'), '30.5');
  const raw = '测试 #标签?100%.mp4';
  const url = context.window.CollectApi.mediaUrl('/media/' + raw);
  const parsed = new URL(url, 'http://localhost:4186');
  assert.equal(parsed.hash, ''); assert.equal(parsed.search, '');
  assert.equal(decodeURIComponent(parsed.pathname.split('/').pop()), raw);
  assert.equal(parsed.pathname.startsWith(embedded ? '/collect-media/' : '/media/'), true);
}
console.log('Media filenames preserve #, ?, %, spaces and Chinese in both routes.');
