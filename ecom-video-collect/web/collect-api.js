/* Real local-service and extension bridge for the pm collection UI. */
(() => {
  'use strict';
  const embedded = new URL(document.currentScript.src).pathname.startsWith('/collect/');
  let workbenchUrl = embedded ? location.origin : 'http://127.0.0.1:4186';
  const apiPath = path => embedded ? path.replace(/^\/api\//, '/api/collect/') : path;
  const mediaUrl = value => embedded ? (value || '').replace(/^\/?media\//, '/collect-media/') : value || '';
  const platformOf = value => value === '抖音' || value === 'douyin' ? 'douyin' : 'kuaishou';
  const request = async (path, options) => {
    const response = await fetch(apiPath(path), options);
    let result;
    try { result = await response.json(); } catch { throw new Error('采集服务返回了无效响应，请检查服务日志'); }
    if (!response.ok || result.ok === false) throw new Error(result.message || `请求失败（HTTP ${response.status}）`);
    return result;
  };
  const post = (path, body) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const extensionCall = (type, payload, timeoutMs) => new Promise(resolve => {
    const reqId = `collect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMessage); };
    const onMessage = event => {
      const message = event.data;
      if (event.source !== window || event.origin !== location.origin || message?.source !== 'ks-product-bridge' || message.reqId !== reqId) return;
      cleanup(); resolve(message);
    };
    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'ec-prod-page', type, reqId, ...payload }, location.origin);
  });
  const collectProduct = async id => {
    const ping = await extensionCall('KS_PRODUCT_PING', {}, 1500);
    if (ping?.type !== 'KS_PRODUCT_PONG') throw new Error('未检测到快手采集扩展，请在装有扩展、已登录快分销的 Chrome 中打开本页');
    const response = await extensionCall('KS_PRODUCT_LOOKUP', { id }, 60000);
    if (!response?.ok) throw new Error(response?.error || '商品采集超时，请确认快分销登录状态后重试');
    return response;
  };
  const proxy = (url, platform) => /^https?:\/\//.test(url || '') ? `${apiPath('/api/proxy')}?platform=${platformOf(platform)}&url=${encodeURIComponent(url)}` : mediaUrl(url);
  const thumbnail = row => /\.(?:jpe?g|png|webp|gif|bmp|tiff?|avif)(?:\?|$)/i.test(row?.local || '') ? mediaUrl(row.local) : proxy(row?.src || '', row?.platform);
  const download = async (row, kind) => {
    if (/^\/?media\//.test(row.local || '')) return { path: '/' + row.local.replace(/^\//, '') };
    const urls = [...new Set((kind === 'image' ? [row.src] : [row.playUrl, ...(row.playUrls || []).map(item => item?.url)]).filter(url => /^https?:\/\//.test(url || '')))];
    if (!urls.length) throw new Error(kind === 'video' ? '这条旧记录没有视频播放地址，请重新爬取视频' : '这条记录没有图片地址');
    let error;
    for (const url of urls) {
      try { return await post('/api/download', { url, name: row.name, kind, platform: row.platform || platformOf(row.channel || row.from) }); }
      catch (failure) { error = failure; }
    }
    throw error;
  };
  const setWorkbench = value => {
    if (embedded) return;
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname) && !url.username && !url.password) workbenchUrl = url.origin;
    } catch { /* Keep the known local workbench address. */ }
  };
  const migrateLegacyStorage = () => new Promise(resolve => {
    const key = 'laogge-products-v2:account:local';
    if (!embedded) return resolve();
    try { if (localStorage.getItem(key) || localStorage.getItem(key + ':migrated')) return resolve(); }
    catch { return resolve(); }
    const origin = `http://${location.hostname}:8765`;
    const nonce = crypto.randomUUID();
    const frame = document.createElement('iframe'); frame.hidden = true;
    const finish = () => { clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); resolve(); };
    const receive = event => {
      if (event.source !== frame.contentWindow || event.origin !== origin || event.data?.source !== 'collect-storage-migration' || event.data.nonce !== nonce) return;
      try {
        const saved = JSON.parse(event.data.snapshot || 'null');
        if (Array.isArray(saved?.items) && !localStorage.getItem(key)) localStorage.setItem(key, event.data.snapshot);
        localStorage.setItem(key + ':migrated', '1');
      } catch { /* Never replace existing records with an invalid snapshot. */ }
      finish();
    };
    const timer = setTimeout(finish, 1800);
    window.addEventListener('message', receive);
    frame.src = origin + '/storage-bridge.html?target=' + encodeURIComponent(location.origin) + '&nonce=' + nonce;
    document.body.append(frame);
  });
  const categories = [
    ['美妆|护肤|洗护|个护','美妆个护'], ['食品|零食|饮料|粮油|生鲜|调味|酒','食品饮料'],
    ['数码|家电|电器|手机|电脑|电子','数码家电'], ['服饰|服装|鞋|箱包|内衣|配饰','服饰鞋包'],
    ['家居|百货|收纳|厨具|日用|清洁|家装','家居百货'],
  ];
  window.CollectApi = {
    platformOf, proxy, thumbnail, collectProduct, download, setWorkbench, mediaUrl, embedded, migrateLegacyStorage,
    get workbenchUrl() { return workbenchUrl; },
    previewVideo: path => post('/api/preview', { path }),
    search: (channel, keyword, signal) => request(`/api/search?platform=${platformOf(channel)}&keyword=${encodeURIComponent(keyword)}&pages=1`, { signal }),
    importProduct: payload => post('/api/workbench-import', payload),
    categoryOf: record => {
      const text = [...(record?.category?.path || []), record?.category?.name || '', record?.productName || ''].join(' ');
      return categories.find(([pattern]) => new RegExp(pattern).test(text))?.[1] || '其他';
    },
  };
})();
