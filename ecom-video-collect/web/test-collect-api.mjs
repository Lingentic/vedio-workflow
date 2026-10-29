import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
for (const embedded of [true, false]) {
  const context = { window: {}, URL, document: { currentScript: { src: `http://localhost:4186/${embedded ? 'collect/' : ''}collect-api.js` } }, location: { origin: 'http://localhost:4186' } };
  vm.runInNewContext(readFileSync(new URL('./collect-api.js', import.meta.url), 'utf8'), context);
  const raw = '测试 #标签?100%.mp4';
  const url = context.window.CollectApi.mediaUrl('/media/' + raw);
  const parsed = new URL(url, 'http://localhost:4186');
  assert.equal(parsed.hash, ''); assert.equal(parsed.search, '');
  assert.equal(decodeURIComponent(parsed.pathname.split('/').pop()), raw);
  assert.equal(parsed.pathname.startsWith(embedded ? '/collect-media/' : '/media/'), true);
}
console.log('Media filenames preserve #, ?, %, spaces and Chinese in both routes.');
