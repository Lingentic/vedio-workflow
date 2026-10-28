/* 商品获取模块（PRD v2.4 §4，原「商品素材」）。
 * 工作流第 1 步：商品资料录入 + 联网爬取素材；单一商品列表，整行可点进入商品详情子页。
 * 内容架构取自 UUclip 实测截图与 PRD §4.4 规则表，配色与控件走 pm 电商工作流风格。
 * 自包含：状态、渲染、事件委托都在本文件内，通过 window.EcommerceVideoProducts 暴露给 app.js。
 */
(() => {
  'use strict';

  const STORE_KEY = 'laogge-products-v2';

  /* ---------- 素材状态机（PRD §3.1 在本模块侧可达的子集） ---------- */
  const STATUS = {
    pending: { label: '待爬取', tone: 'neutral' },
    crawling: { label: '爬取中', tone: 'working' },
    ready: { label: '素材就绪', tone: 'ok' },
    crawlFailed: { label: '爬取失败', tone: 'danger' },
    generating: { label: '生成中', tone: 'working' },
    review: { label: '待审核', tone: 'warn' },
    done: { label: '已生成', tone: 'ok' },
  };

  const CATEGORIES = ['家居百货', '食品饮料', '数码家电', '服饰鞋包', '美妆个护', '其他'];
  const PLATFORMS = ['快手', '抖音', 'TikTok'];

  /* 黑段（AI 补全）装配所需的素材位，用于「素材缺失清单」（PRD §3.3 末行 / §4.4-②） */
  const REQUIRED_SLOTS = [
    { key: 'product', label: '产品画面' },
    { key: 'usage', label: '使用场景' },
    { key: 'detail', label: '细节特写' },
    { key: 'price', label: '价格机制' },
  ];

  /* ---------- 联网爬取（PRD §4.7：视频 / 图片两个独立分区，分开回填、分开勾选） ---------- */
  const CRAWL_CHANNELS = ['快手', '抖音'];
  const CRAWL_ZONES = [
    { key: 'video', label: '视频', mark: '▶', card: 'video' },
    { key: 'image', label: '图片', mark: '⛰', card: 'image' },
  ];
  /* 候选库（原型演示数据）：按「分区 → 渠道」两级组织；两渠道刻意共用一条同名素材，用于演示去重标识 */
  const CRAWL_BANK = {
    video: {
      快手: [
        { name: '开箱展示.mp4', duration: 12.4, size: '18.2 MB' },
        { name: '上身演示.mp4', duration: 9.8, size: '14.6 MB' },
        { name: '同角度实拍.mp4', duration: 8.6, size: '11.3 MB' },
      ],
      抖音: [
        { name: '使用过程实拍.mp4', duration: 15.6, size: '22.1 MB' },
        { name: '细节特写运镜.mp4', duration: 7.2, size: '9.4 MB' },
        { name: '同角度实拍.mp4', duration: 8.6, size: '11.3 MB' },
      ],
    },
    image: {
      快手: [
        { name: '白底主图.jpg', size: '1.8 MB' },
        { name: '使用场景.jpg', size: '2.4 MB' },
        { name: '规格对比.jpg', size: '1.1 MB' },
      ],
      抖音: [
        { name: '手持实拍图.jpg', size: '2.1 MB' },
        { name: '效果对比图.jpg', size: '1.9 MB' },
        { name: '规格对比.jpg', size: '1.1 MB' },
      ],
    },
  };
  /* 演示用的固定失败规则（刻意不随机）：抖音图片接口反爬最重 → 首轮只有「图片」分区失败，
   * 该分区「重试该分区」即放行，另一分区全程不受影响。真实接入后由后端返回的渠道状态驱动同一套 UI。 */
  const crawlFails = (zoneKey, channel, attempts) => zoneKey === 'image' && channel === '抖音' && attempts === 0;

  const newZone = () => ({ running: false, results: [], failed: [], attempts: {}, errors: {} });
  const newCrawl = () => ({ channels: [CRAWL_CHANNELS[0]], zones: { video: newZone(), image: newZone() }, taken: new Set() });
  const crawlBusy = crawl => Object.values(crawl.zones).some(zone => zone.running);
  const crawlPicked = crawl => CRAWL_ZONES.reduce((sum, zone) => sum + crawl.zones[zone.key].results.filter(row => row.picked && !row.dup).length, 0);
  const crawlPickedByZone = (crawl, key) => crawl.zones[key].results.filter(row => row.picked && !row.dup);

  /* ---------- 种子数据（单一列表，不区分我的 / 全部） ---------- */
  const seedItems = () => [
    { id: 'p-58096', kuaishouId: '38908', name: '家用立体收纳压缩袋抽两用棉季衣服棉被真空防尘袋', cat: '家居百货', price: 9.99, spec: '包邮到家', comm: 35, cma: 3.5, gen: 25, platform: '快手', status: 'ready', updated: '2026-09-27', highlight: '换季的厚棉被、羽绒服，塞进柜子顶占地方，落灰还返潮。这压缩袋立体设计，装得多，抽压两用，气泵抽手压都行，压完薄薄一摞，衣柜腾出大半空间。防尘防潮，来年拿出来没霉味，晒晒就能盖。', negatives: '最好,第一,绝对', team: '铮铮-雅琪糯米胶', materials: { main: 1, video: 5, image: 8 } },
    { id: 'p-58005', kuaishouId: '58005', name: '加厚锁腰孩子肩背服饰高弹力秋冬季衣保暖护腰披肩A20', cat: '家居百货', price: 7.99, spec: '均码', comm: 30, cma: 2.4, gen: 3, platform: '抖音', status: 'ready', updated: '2026-09-26', highlight: '高弹针织不勒肩，秋冬打底或外披都行，孩子写作业披着不凉背。', negatives: '', team: '铮铮-雅琪糯米胶', materials: { main: 1, video: 3, image: 6 } },
    { id: 'p-34337', kuaishouId: '34337', name: '【到手5斤】原切牛肋排2500g*1碗 顺丰+云仓发货JY', cat: '食品饮料', price: 99.9, spec: '2500g/碗', comm: 8, cma: 7.99, gen: 3, platform: '快手', status: 'ready', updated: '2026-07-30', highlight: '原切不拼接，肥瘦相间，炖煮煎烤都合适，顺丰冷链到手。', negatives: '顶级,最便宜', team: '铮铮-雅琪糯米胶', materials: { main: 1, video: 4, image: 7 } },
    { id: 'p-34349', kuaishouId: '34349', name: '【特惠49.9】黑土玉米胚芽油5升 非转基因物理压榨', cat: '食品饮料', price: 49.9, spec: '5L', comm: 5, cma: 2.5, gen: 6, platform: '快手', status: 'ready', updated: '2026-07-30', highlight: '黑土地玉米胚芽，物理压榨非转基因，5升装一家人吃一季。', negatives: '', team: '铮铮-雅琪糯米胶', materials: { main: 1, video: 3, image: 5 } },
    { id: 'p-34340', kuaishouId: '34340', name: '充电器适用于安全车系统低温快速充电器配type-c口通用', cat: '数码家电', price: 27.9, spec: 'type-c', comm: 40, cma: 11.16, gen: 11, platform: '快手', status: 'crawlFailed', updated: '2026-07-30', highlight: '', negatives: '', team: '', materials: { main: 1, video: 0, image: 2 } },
    { id: 'p-35121', kuaishouId: '35121', name: '电动车头盔男女半盔电瓶车冬季保暖四季通用骑行防护安全帽E07', cat: '数码家电', price: 26.9, spec: '四季通用', comm: 20, cma: 5.38, gen: 0, platform: '抖音', status: 'crawling', updated: '2026-10-21', highlight: '', negatives: '', team: '', materials: { main: 1, video: 2, image: 3 } },
    { id: 'p-36077', kuaishouId: '36077', name: '【17.9元抢12箱】正宗黑糯玉米新鲜甜糯玉米真空独立装粗粮代餐', cat: '食品饮料', price: 17.9, spec: '250g*12箱', comm: 18, cma: 3.22, gen: 0, platform: '快手', status: 'pending', updated: '2026-10-20', highlight: '', negatives: '', team: '', materials: { main: 0, video: 0, image: 1 } },
    { id: 'p-36090', kuaishouId: '36090', name: '【到手5斤】原味生核腰果皮核桃话梅味休闲零食', cat: '食品饮料', price: 15.9, spec: '5斤', comm: 12, cma: 1.91, gen: 0, platform: '快手', status: 'ready', updated: '2026-10-19', highlight: '带皮核桃加话梅同装，咸甜回甘，追剧零嘴一次到手5斤。', negatives: '', team: '铮铮-雅琪糯米胶', materials: { main: 1, video: 1, image: 2 } },
    { id: 'p-70012', kuaishouId: '70012', name: '加厚保暖鞋垫 男女同款 踩屎感软弹 5双装', cat: '服饰鞋包', price: 6.9, spec: '5双装', comm: 45, cma: 3.11, gen: 0, platform: '快手', status: 'ready', updated: '2026-10-18', highlight: '踩上去软弹不硌脚，冬天出门脚底不凉，5双换着垫。', negatives: '', team: '', materials: { main: 1, video: 3, image: 5 } },
    { id: 'p-70034', kuaishouId: '70034', name: '不锈钢锅清洁全过程 去黑垢不伤手', cat: '家居百货', price: 19.9, spec: '单只', comm: 30, cma: 5.97, gen: 0, platform: '抖音', status: 'crawling', updated: '2026-10-22', highlight: '', negatives: '', team: '', materials: { main: 1, video: 1, image: 2 } },
    { id: 'p-70051', kuaishouId: '70051', name: '海藻泥清洁膏 厨房去污 一擦即净 3罐装', cat: '家居百货', price: 12.9, spec: '3罐装', comm: 38, cma: 4.9, gen: 0, platform: '快手', status: 'ready', updated: '2026-10-17', highlight: '厨房油污一擦就掉，不伤手不伤锅面，3罐够用一季。', negatives: '', team: '', materials: { main: 1, video: 2, image: 4 } },
    { id: 'p-70068', kuaishouId: '70068', name: 'BOTTLED JOY 星空杯 吸管杯 高硼硅玻璃 500ml', cat: '美妆个护', price: 39.9, spec: '500ml', comm: 25, cma: 9.98, gen: 0, platform: '抖音', status: 'crawlFailed', updated: '2026-10-16', highlight: '', negatives: '', team: '', materials: { main: 0, video: 0, image: 1 } },
    { id: 'p-70090', kuaishouId: '70090', name: '冬季加绒护膝 老人保暖 防滑不卷边 一双', cat: '服饰鞋包', price: 14.9, spec: '一双', comm: 42, cma: 6.26, gen: 0, platform: '快手', status: 'pending', updated: '2026-10-15', highlight: '', negatives: '', team: '', materials: { main: 0, video: 0, image: 0 } },
    { id: 'p-70115', kuaishouId: '70115', name: '多功能插排 Type-C 快充 独立开关 5位', cat: '数码家电', price: 34.9, spec: '5位', comm: 28, cma: 9.77, gen: 0, platform: '快手', status: 'ready', updated: '2026-10-14', highlight: '5位独立开关，Type-C 快充不用找插头，桌面走线干净。', negatives: '', team: '', materials: { main: 1, video: 2, image: 3 } },
  ];

  /* ---------- 状态 ---------- */
  const blankFilters = () => ({ q: '', priceMin: '', priceMax: '', commMin: '', commMax: '', cat: '', platform: '', status: '' });
  const blank = () => ({ filters: blankFilters(), items: seedItems(), dialog: null, detailId: null, draft: null, confirm: null });

  let state = blank();
  let timers = [];
  let api = {};

  const accountScope = window.EcommerceVideoAccountScope.create({
    storeKey: STORE_KEY, createState: blank, getState: () => state,
    setState: next => { state = next; api = {}; },
    serialize: current => ({ items: current.items }),
    restore: (fresh, saved) => {
      if (Array.isArray(saved?.items)) fresh.items = saved.items;
      return fresh;
    },
    suspend: () => clearTimers(),
  });
  const persist = accountScope.persist;
  /* 导入工作台进行中的商品 id；不持久化 */
  const pushing = new Set();

  /* ---------- 工具 ---------- */
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const productImage = (item, fallback) => {
    const real = item?.materialDetails?.main?.[0];
    if (real?.src) {
      return `<img src="${esc(mediaSrc(real))}" alt="${esc(item.name)}" title="采集主图" width="46" height="46" loading="lazy" decoding="async">`;
    }
    const image = window.EcommerceVideoProductImages?.get(item);
    return image ? `<img src="${esc(image.src)}" alt="${esc(image.alt || item.name)}" title="${esc(image.label || '相似商品示意图')}" width="46" height="46" loading="lazy" decoding="async">` : esc(fallback);
  };
  const money = value => `¥${Number(value || 0).toFixed(2)}`;
  const pct = value => `${Number(value || 0)}%`;
  const later = (fn, ms) => { const t = setTimeout(accountScope.guard(fn), ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const uid = prefix => `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const find = id => state.items.find(item => item.id === id) || null;
  const toast = message => api.toast?.(message);
  /* 真实图片：与商品/素材名稳定绑定，缺模块时退回文字占位 */
  const imgOf = (key, count) => window.EcommerceVideoImages?.of(key, count) || '';
  const imgTag = key => { const src = imgOf(key); return src ? `<img src="${esc(src)}" alt="">` : ''; };
  const materialTotal = item => (item?.materials?.main || 0) + (item?.materials?.video || 0) + (item?.materials?.image || 0);
  /* 可推送工作台：有远程播放/来源地址，或已在采集服务落盘 */
  const pushable = v => /^https?:/.test(v?.playUrl || '') || /^https?:/.test(v?.pageUrl || '') || String(v?.local || '').startsWith('media/');

  /* ---------- 真实采集接入：商品走浏览器插件桥，视频走本地采集服务 ---------- */
  const apiBase = () => (/^https?:$/.test(location.protocol) ? location.origin : 'http://127.0.0.1:8765') + '/api';
  const postTarget = () => (location.origin === 'null' ? '*' : location.origin);
  /* 媒体直链带防盗链 Referer 要求，统一经服务中转后供页面预览 */
  const proxyOf = (url, platform) => url ? `${apiBase()}/proxy?platform=${encodeURIComponent(platform || '')}&url=${encodeURIComponent(url)}` : '';
  const extCall = (type, payload, timeoutMs) => new Promise(resolve => {
    const reqId = uid('req');
    const onMsg = event => {
      const m = event.data;
      if (!m || m.source !== 'ks-product-bridge' || m.reqId !== reqId) return;
      cleanup(); resolve(m);
    };
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMsg); };
    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    window.addEventListener('message', onMsg);
    window.postMessage({ source: 'ec-prod-page', type, reqId, ...payload }, postTarget());
  });
  const extPing = () => extCall('KS_PRODUCT_PING', {}, 1200).then(m => (m && m.type === 'KS_PRODUCT_PONG' ? m : null));
  const extLookup = id => extCall('KS_PRODUCT_LOOKUP', { id }, 60000);
  const channelPlatform = channel => (channel === '抖音' ? 'douyin' : 'kuaishou');
  const serviceSearch = (platform, keyword) =>
    fetch(`${apiBase()}/search?platform=${platform}&keyword=${encodeURIComponent(keyword)}&pages=1`)
      .then(r => r.json())
      .catch(() => ({ ok: false, code: 'offline', message: '采集服务未启动：python tools/collect_service.py' }));
  /* 选品中心类目路径 → 原型固定类目表 */
  const CAT_KEYWORDS = [
    ['美妆', '美妆个护'], ['个护', '美妆个护'], ['护肤', '美妆个护'], ['化妆', '美妆个护'], ['洗护', '美妆个护'],
    ['食品', '食品饮料'], ['零食', '食品饮料'], ['饮料', '食品饮料'], ['粮油', '食品饮料'], ['生鲜', '食品饮料'], ['调味', '食品饮料'], ['冲饮', '食品饮料'], ['酒', '食品饮料'],
    ['数码', '数码家电'], ['家电', '数码家电'], ['电器', '数码家电'], ['手机', '数码家电'], ['电脑', '数码家电'], ['电子', '数码家电'],
    ['服饰', '服饰鞋包'], ['服装', '服饰鞋包'], ['鞋', '服饰鞋包'], ['箱包', '服饰鞋包'], ['内衣', '服饰鞋包'], ['配饰', '服饰鞋包'],
    ['家居', '家居百货'], ['百货', '家居百货'], ['收纳', '家居百货'], ['厨具', '家居百货'], ['日用', '家居百货'], ['清洁', '家居百货'], ['家装', '家居百货'],
  ];
  const mapCategory = (record, name) => {
    const text = [...(record?.category?.path || []), record?.category?.name || '', name || ''].join(' ');
    const hit = CAT_KEYWORDS.find(([kw]) => text.includes(kw));
    return hit ? hit[1] : '其他';
  };

  /* 黑段缺料：按素材位规则推断，用于详情页缺失清单 */
  const missingSlots = item => {
    const videos = item?.materials?.video || 0;
    const images = (item?.materials?.main || 0) + (item?.materials?.image || 0);
    const missing = [];
    if (images < 1) missing.push(REQUIRED_SLOTS[0]);
    if (videos < 2) missing.push(REQUIRED_SLOTS[1]);
    if (images < 4) missing.push(REQUIRED_SLOTS[2]);
    if (videos < 3) missing.push(REQUIRED_SLOTS[3]);
    return missing;
  };

  const filtered = () => {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    return state.items.filter(item => {
      if (q && !`${item.name} ${item.kuaishouId || ''} ${item.id}`.toLowerCase().includes(q)) return false;
      if (f.cat && item.cat !== f.cat) return false;
      if (f.platform && item.platform !== f.platform) return false;
      if (f.status && item.status !== f.status) return false;
      if (f.priceMin !== '' && Number(item.price) < Number(f.priceMin)) return false;
      if (f.priceMax !== '' && Number(item.price) > Number(f.priceMax)) return false;
      if (f.commMin !== '' && Number(item.comm) < Number(f.commMin)) return false;
      if (f.commMax !== '' && Number(item.comm) > Number(f.commMax)) return false;
      return true;
    });
  };

  /* ---------- 片段 ---------- */
  const badge = status => {
    const meta = STATUS[status] || STATUS.pending;
    return `<span class="ec-prod-badge ec-prod-badge--${meta.tone}">${meta.label}</span>`;
  };

  const filterCard = () => {
    const f = state.filters;
    const option = (value, label, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
    return `<div class="ec-prod-card"><div class="ec-prod-card-body"><div class="ec-prod-filters">
      <div class="ec-prod-field ec-prod-field--search"><label for="lpQ">搜索商品名称 / 款式 / 快手商品ID</label><input id="lpQ" class="ec-prod-control" value="${esc(f.q)}" data-lp-filter="q" placeholder="搜索商品名称/款式/快手商品ID" autocomplete="off"></div>
      <div class="ec-prod-field"><label>商品价格</label><div class="ec-prod-range"><input class="ec-prod-control is-num" data-lp-filter="priceMin" type="number" min="0" value="${esc(f.priceMin)}" placeholder="0"><span>–</span><input class="ec-prod-control is-num" data-lp-filter="priceMax" type="number" min="0" value="${esc(f.priceMax)}" placeholder="999"><span>元</span></div></div>
      <div class="ec-prod-field"><label>佣金范围</label><div class="ec-prod-range"><input class="ec-prod-control is-num" data-lp-filter="commMin" type="number" min="0" max="100" value="${esc(f.commMin)}" placeholder="0"><span>–</span><input class="ec-prod-control is-num" data-lp-filter="commMax" type="number" min="0" max="100" value="${esc(f.commMax)}" placeholder="100"><span>%</span></div></div>
      <div class="ec-prod-field"><label for="lpCat">类目</label><select id="lpCat" class="ec-prod-control" data-lp-filter="cat">${option('', '全部类目', f.cat)}${CATEGORIES.map(c => option(c, c, f.cat)).join('')}</select></div>
      <div class="ec-prod-field"><label for="lpPf">平台</label><select id="lpPf" class="ec-prod-control" data-lp-filter="platform">${option('', '全部平台', f.platform)}${PLATFORMS.map(p => option(p, p, f.platform)).join('')}</select></div>
      <div class="ec-prod-field"><label for="lpSt">素材状态</label><select id="lpSt" class="ec-prod-control" data-lp-filter="status">${option('', '全部状态', f.status)}${Object.entries(STATUS).map(([k, v]) => option(k, v.label, f.status)).join('')}</select></div>
      <div class="ec-prod-filter-actions"><span class="ec-prod-hint is-num">匹配 ${filtered().length} / ${state.items.length}</span><button type="button" class="ec-prod-btn" data-lp="reset-filters">⟳ 重置</button><button type="button" class="ec-prod-btn ec-prod-btn--primary" data-lp="open-entry">＋ 录入商品</button></div>
    </div></div></div>`;
  };

  /* 单一列表：整行可点，行内不放任何操作按钮（PRD §4.4-①） */
  const table = rows => `<div class="ec-prod-table-wrap"><table class="ec-prod-table ec-prod-table--rows"><thead><tr>
      <th>商品</th><th class="is-num">价格 · 规格</th><th>类目</th><th>平台</th><th>素材</th><th>素材状态</th><th class="is-num">更新时间</th>
    </tr></thead><tbody>${rows.map(item => `<tr class="ec-prod-rowlink" tabindex="0" role="link" data-lp="open-detail" data-id="${item.id}" aria-label="查看商品详情：${esc(item.name)}">
      <td><div class="ec-prod-cell-product"><span class="ec-prod-thumb">${productImage(item, item.materials.main ? '主图' : '无图')}${item.status === 'crawlFailed' ? '<em class="ec-prod-flag" title="爬取失败，进入详情可重新爬取">!</em>' : ''}</span><span><strong title="${esc(item.name)}">${esc(item.name)}</strong><small>快手 ID ${esc(item.kuaishouId || '—')} · 商品ID ${esc(item.id)}</small></span></div></td>
      <td class="is-num"><span class="ec-prod-price">${money(item.price)}</span><small class="ec-prod-sub">${esc(item.spec || '—')} · 佣金 ${pct(item.comm)}</small></td>
      <td>${item.cat ? `<span class="ec-prod-cat">${esc(item.cat)}</span>` : '<span class="ec-prod-hint">—</span>'}</td>
      <td>${esc(item.platform)}</td>
      <td><span class="is-num">${item.materials.video} 视 / ${item.materials.image + item.materials.main} 图</span></td>
      <td>${badge(item.status)}</td>
      <td class="is-num">${esc(item.updated)}</td>
    </tr>`).join('')}</tbody></table></div>`;

  const emptyState = () => `<div class="ec-prod-empty"><i>商</i><h3>${state.items.length ? '没有匹配的商品' : '还没有录入任何商品'}</h3><p>${state.items.length ? '换个关键词，或放宽价格、佣金区间再试。' : '点「录入商品」填写快手商品ID 并采集资料，右列联网爬取素材，确认添加即入库。'}</p><div>${state.items.length ? '<button type="button" class="ec-prod-btn" data-lp="reset-filters">⟳ 清空筛选</button>' : '<button type="button" class="ec-prod-btn ec-prod-btn--primary" data-lp="open-entry">＋ 录入第一个商品</button>'}</div></div>`;

  const gapNotice = () => {
    const rows = state.items.filter(item => item.status === 'ready' && missingSlots(item).length);
    if (!rows.length) return '';
    return `<div class="ec-prod-gap"><strong>${rows.length} 个商品已「素材就绪」，但黑段素材位仍缺料，进视频制作生成时会逐项提示：</strong><ul>${rows.map(item => `<li>${esc(item.name.slice(0, 18))}… 缺 ${missingSlots(item).map(s => s.label).join('、')}</li>`).join('')}</ul></div>`;
  };

  /* ---------- 爬取面板（唯一实现，录入弹窗右列直接调用） ---------- */
  const dupText = dup => dup === 'pool' ? '素材池已有' : dup === 'seen' ? '与其他渠道重复' : '';
  const mediaSrc = file => (file?.src && /^https?:/.test(file.src)) ? proxyOf(file.src, file.platform) : (file?.src || '');

  const candidateTile = (row, index, zone) => `<button type="button" class="ec-prod-cand${row.picked ? ' is-picked' : ''}${row.dup ? ' is-dup' : ''}" data-lp="pick" data-zone="${zone.key}" data-index="${index}" ${row.dup ? 'disabled' : ''} aria-pressed="${row.picked}">
      <span class="ec-prod-cand-media">
        ${row.src ? `<img src="${esc(mediaSrc(row))}" alt="" loading="lazy" decoding="async">` : (imgTag(row.name) || `<i class="ec-prod-cand-mark">${zone.mark}</i>`)}
        <span class="ec-prod-cand-ck" aria-hidden="true">✓</span>
        <span class="ec-prod-cand-src">${esc(row.channel)}</span>
        ${row.dup ? `<span class="ec-prod-cand-dup">${esc(dupText(row.dup))}</span>` : `<span class="ec-prod-cand-dur">${row.duration ? `${row.duration}s` : esc(row.size)}</span>`}
      </span>
      <span class="ec-prod-cand-cap"><strong title="${esc(row.name)}">${esc(row.name)}</strong><small class="is-num">${esc(row.author ? row.author + ' · ' : '')}${esc(row.size)}${row.duration ? ` · ${row.duration}s` : ''}</small></span>
      <span class="ec-prod-cand-preview">${row.dup ? '重复素材' : row.picked ? '已选 · 再点取消' : '点击勾选'}</span>
    </button>`;

  const poolStrip = (files, zoneKey) => `<div class="ec-prod-pool">
      <span class="ec-prod-pool-label">已归入 ${files.length}</span>
      ${files.length ? files.map((file, index) => `<span class="ec-prod-chip">${file.src ? `<img src="${esc(mediaSrc(file))}" alt="">` : `<i>${zoneKey === 'video' ? '▶' : '图'}</i>`}<span title="${esc(file.name)}">${esc(file.from ? `${file.from} · ${file.name}` : file.name)}</span><button type="button" data-lp="remove-pool" data-zone="${zoneKey}" data-index="${index}" aria-label="移出 ${esc(file.name)}">×</button></span>`).join('') : '<span class="ec-prod-hint">勾选候选后点「归入素材池」</span>'}
    </div>`;

  const crawlZone = (crawl, pool, zone) => {
    const data = crawl.zones[zone.key];
    const picked = crawlPickedByZone(crawl, zone.key).length;
    const emptyText = zoneEmptyText(data, zone);
    return `<div class="ec-prod-zone ec-prod-zone--${zone.key}">
      <header><i>${zone.mark}</i><b>${zone.label}</b>${data.running ? '<span class="ec-prod-badge ec-prod-badge--working ec-prod-badge--plain">爬取中</span>' : ''}<span class="ec-prod-zone-count${data.results.length ? '' : ' is-zero'}">${data.results.length} 条候选</span>${picked ? `<span class="ec-prod-zone-picked">已选 ${picked}</span>` : ''}</header>
      <div class="ec-prod-zone-body${data.running && !data.results.length ? ' is-loading' : ''}">
        ${data.running && !data.results.length ? `<span class="ec-prod-spinner"></span><span>正在检索同类${zone.label}素材…</span>` : ''}
        ${!data.results.length && !data.running ? `<div class="ec-prod-zone-empty">${esc(emptyText)}</div>` : ''}
        ${data.results.length ? `<div class="ec-prod-zone-grid">${data.results.map((row, index) => candidateTile(row, index, zone)).join('')}</div>` : ''}
      </div>
      ${poolStrip(pool[zone.key], zone.key)}
      ${data.failed.length ? `<div class="ec-prod-zone-fail"><span><b>${esc(data.failed.join('、'))} 渠道未返回${zone.label}候选</b>${esc(data.failed.map(ch => data.errors[ch] || `${ch} 未返回候选`).join('；'))}；本分区已按「可用即通过」跳过，可完善信息后重试本分区。</span><button type="button" class="ec-prod-btn ec-prod-btn--sm" data-lp="retry-zone" data-zone="${zone.key}" ${data.running ? 'disabled' : ''}>⟳ 重试该分区</button></div>` : ''}
    </div>`;
  };

  const crawlPanel = (crawl, pool, basis) => {
    const busy = crawlBusy(crawl);
    const noName = !basis.name.trim();
    const canRun = !noName && crawl.channels.length > 0 && !busy;
    const disabledTitle = noName ? '请先填写商品名称，爬取按名称 / 类目发起'
      : !crawl.channels.length ? '请先至少选择一个渠道'
      : busy ? '候选正在流式回填中' : '';
    const picked = crawlPicked(crawl);
    return `<div class="ec-prod-crawl">
      <div class="ec-prod-crawl-bar">
        <div class="ec-prod-channel" role="group" aria-label="爬取渠道"><span>渠道</span>${CRAWL_CHANNELS.map(ch => `<button type="button" class="${crawl.channels.includes(ch) ? 'active' : ''}" data-lp-channel="${ch}" aria-pressed="${crawl.channels.includes(ch)}">${ch}</button>`).join('')}</div>
        <button type="button" class="ec-prod-btn ec-prod-btn--sm ec-prod-btn--collect" data-lp="run-crawl" ${canRun ? '' : `disabled title="${esc(disabledTitle)}"`}>${busy ? '爬取中…' : '↓ 开始爬取'}</button>
        ${noName ? '<span class="ec-prod-crawl-note is-warn">⚠ 未填商品名称，暂不可发起爬取</span>' : `<span class="ec-prod-crawl-note">依据 <b>${esc(basis.name.trim().slice(0, 14))}</b>${basis.cat ? ` · <b>${esc(basis.cat)}</b>` : ''} 检索同类型素材</span>`}
      </div>
      ${CRAWL_ZONES.map(zone => crawlZone(crawl, pool, zone)).join('')}
      <div class="ec-prod-crawl-actions"><small>勾选后归入对应分区，底栏「视频 / 图片」计数同步更新；确认添加时随商品一同入库。</small><button type="button" class="ec-prod-btn ec-prod-btn--sm ec-prod-btn--primary" data-lp="commit-crawl" ${picked ? '' : 'disabled title="先点击勾选上方的候选素材，再归入素材池"'}>↓ 归入素材池${picked ? ` (${picked})` : ''}</button></div>
    </div>`;
  };

  /* ---------- 录入商品弹窗（PRD §4.4-③：左基本信息 ＋ 右联网爬取） ---------- */
  const entryValid = d => Boolean(d.kuaishouId.trim() && d.name.trim() && d.price !== '' && d.spec.trim() && d.comm !== '' && d.cat && d.highlight.trim());

  const entryDialog = () => {
    const d = state.draft;
    const option = (value, label) => `<option value="${esc(value)}"${value === d.cat ? ' selected' : ''}>${esc(label)}</option>`;
    return `<div class="ec-prod-backdrop" role="presentation"><div class="ec-prod-dialog" role="dialog" aria-modal="true" aria-labelledby="lpEntryTitle">
      <header><div><h2 id="lpEntryTitle">录入商品</h2><p>左列填商品资料（可「采集」自动填表），右列联网爬取素材；点「确认添加」即入库。</p></div><button type="button" data-lp="dismiss-entry" aria-label="关闭">×</button></header>
      <div class="ec-prod-dialog-body"><div class="ec-prod-form-grid">
        <section class="ec-prod-form-section">
          <header><b><i>1</i>基本信息</b><button type="button" class="ec-prod-btn ec-prod-btn--sm ec-prod-btn--quiet" data-lp="ext-id">⚙ 设置扩展ID</button></header>
          <div class="ec-prod-form-section-body">
            <div class="ec-prod-row"><div class="ec-prod-row-head"><label>所属平台 <em>*</em></label></div><div class="ec-prod-seg" role="group" aria-label="所属平台">${['Kuaishou', 'TikTok'].map(p => `<button type="button" class="${d.platform === p ? 'active' : ''}" data-lp-draft="platform" data-value="${p}" aria-pressed="${d.platform === p}">${p}</button>`).join('')}</div></div>
            <div class="ec-prod-row"><div class="ec-prod-row-head"><label for="lpKsId">快手商品ID <em>*</em></label></div>
              <div class="ec-prod-inline"><input id="lpKsId" class="ec-prod-control is-num" value="${esc(d.kuaishouId)}" data-lp-draft="kuaishouId" placeholder="请输入快手商品ID" autocomplete="off"><button type="button" class="ec-prod-btn ec-prod-btn--collect" data-lp="collect"${d.collecting ? ' disabled' : ''}>${d.collecting ? '<span class="ec-prod-spinner" style="width:14px;height:14px;border-width:2px"></span> 采集中' : '↓ 采集'}</button><span class="ec-prod-hint"><a data-lp="ext-help">❓ 获取插件</a><a data-lp="ext-help">❓ 安装教程</a></span></div>
              ${d.collectState ? `<div class="ec-prod-collect-state is-${d.collectState.tone}">${esc(d.collectState.text)}</div>` : ''}
            </div>
            <div class="ec-prod-row"><div class="ec-prod-row-head"><label for="lpName">商品名称 <em>*</em></label></div>
              <div class="ec-prod-inline"><input id="lpName" class="ec-prod-control" value="${esc(d.name)}" data-lp-draft="name" placeholder="商品名称或商品名+价格+规格+佣金比例+商品ID的格式" autocomplete="off"><button type="button" class="ec-prod-btn ec-prod-btn--collect" data-lp="recognize">✦ 智能识别</button></div>
            </div>
            <div class="ec-prod-row ec-prod-row--split">
              <div><div class="ec-prod-row-head"><label for="lpPrice">价格（元）<em>*</em></label></div><input id="lpPrice" class="ec-prod-control is-num" type="number" min="0" max="99999" step="0.01" value="${esc(d.price)}" data-lp-draft="price" placeholder="0.00，最高 99999"></div>
              <div><div class="ec-prod-row-head"><label for="lpSpec">规格 <em>*</em></label></div><input id="lpSpec" class="ec-prod-control" value="${esc(d.spec)}" data-lp-draft="spec" placeholder="商品规格"></div>
            </div>
            <div class="ec-prod-row ec-prod-row--split">
              <div><div class="ec-prod-row-head"><label for="lpComm">佣金比例（%）<em>*</em></label></div><input id="lpComm" class="ec-prod-control is-num" type="number" min="0" max="100" value="${esc(d.comm)}" data-lp-draft="comm" placeholder="如:15，最高 100"></div>
              <div><div class="ec-prod-row-head"><label for="lpCatSel">类目 <em>*</em></label></div><select id="lpCatSel" class="ec-prod-control" data-lp-draft="cat"><option value="">请选择类目</option>${CATEGORIES.map(c => option(c, c)).join('')}</select></div>
            </div>
            <div class="ec-prod-row"><div class="ec-prod-row-head"><label for="lpTeam">团队</label></div><input id="lpTeam" class="ec-prod-control" value="${esc(d.team)}" data-lp-draft="team" placeholder="请选择团队" list="lpTeamList"><datalist id="lpTeamList"><option value="铮铮-雅琪糯米胶"></option><option value="老葛直播组"></option></datalist></div>
            <div class="ec-prod-row"><div class="ec-prod-row-head"><label for="lpHi">商品亮点 <em>*</em></label><button type="button" class="ec-prod-ai" data-lp="ai-highlight"${d.generating ? ' disabled' : ''}>✦ AI生成卖点</button></div><textarea id="lpHi" class="ec-prod-control" data-lp-draft="highlight" placeholder="商品卖点、特色等">${esc(d.highlight)}</textarea></div>
            <div class="ec-prod-row"><div class="ec-prod-row-head"><label for="lpNeg">负面词汇</label></div><textarea id="lpNeg" class="ec-prod-control" style="min-height:64px" data-lp-draft="negatives" placeholder="需要避免的负面词汇，用逗号分隔">${esc(d.negatives)}</textarea></div>
          </div>
        </section>
        <section class="ec-prod-form-section">
          <header><b><i>2</i>联网爬取</b><small class="ec-prod-hint">按商品名称 / 类目爬取快手 · 抖音同类型素材</small></header>
          <div class="ec-prod-form-section-body">
            ${crawlPanel(d.crawl, d.pool, { name: d.name, cat: d.cat })}
            <p class="ec-prod-crawl-hint" style="padding:12px 0 0">本地上传不再是录入渠道：入库后如需补齐素材，到商品详情子页用「替换」走本地上传（文件不出本机）。</p>
          </div>
        </section>
      </div></div>
      <footer>
        <div class="ec-prod-tally"><span>▶ 视频: <b>${d.pool.video.length}</b></span><span>⛰ 图片: <b>${d.pool.image.length + d.pool.main.length}</b></span></div>
        <span class="is-spacer"></span>
        <button type="button" class="ec-prod-btn" data-lp="dismiss-entry">取消</button>
        <button type="button" class="ec-prod-btn ec-prod-btn--primary" data-lp="submit-entry" ${entryValid(d) ? '' : 'disabled'}>✓ 确认添加</button>
      </footer>
    </div></div>`;
  };

  /* ---------- 商品详情子页（PRD §4.4-②） ---------- */
  const mediaFiles = (item, kind) => {
    const real = item?.materialDetails?.[kind];
    if (Array.isArray(real) && real.length) {
      return real.map((r, i) => ({
        name: r.name || `${kind === 'video' ? '视频' : '图片'}素材 ${i + 1}`,
        duration: r.duration ?? (kind === 'video' ? 10 : null),
        src: r.src || '', pageUrl: r.pageUrl || '', playUrl: r.playUrl || '',
        videoId: r.videoId || '', platform: r.platform || '', from: r.from || '联网爬取', local: r.local || '',
      }));
    }
    return Array.from({ length: kind === 'video' ? item.materials.video : item.materials.image }, (_, i) => ({
      name: `${kind === 'video' ? '视频素材' : '图片素材'} ${i + 1}`, duration: kind === 'video' ? 10 : null,
      src: imgOf(`${item.id}-${kind}-${i}`),
    }));
  };

  const detailView = () => {
    const item = find(state.detailId);
    if (!item) return '';
    const videos = mediaFiles(item, 'video');
    const images = mediaFiles(item, 'image');
    const missing = missingSlots(item);
    return `<div class="ec-prod-detail">
      <div class="ec-prod-detail-top">
        <section class="ec-prod-hero">
          <div class="ec-prod-hero-media"><span class="ec-prod-thumb" style="width:100%;height:100%;border:0;border-radius:0">${productImage(item, item.materials.main ? '商品主图' : '暂无主图')}</span>${window.EcommerceVideoProductImages?.get(item) ? '<em>相似商品示意图</em>' : item.materials.main ? '<em>商品主图</em>' : ''}</div>
          <div class="ec-prod-hero-actions">
            <button type="button" class="ec-prod-btn ec-prod-btn--sm" data-lp="sync" data-id="${item.id}">⟳ 同步商品</button>
            ${['crawlFailed', 'pending'].includes(item.status) ? `<button type="button" class="ec-prod-btn ec-prod-btn--sm ec-prod-btn--primary" data-lp="recrawl" data-id="${item.id}">↓ 重新爬取</button>` : ''}
          </div>
          <p class="ec-prod-hint" style="margin-top:10px;line-height:1.7">同步只按 id 重爬价格 / 标题 / 主图并覆盖本地缓存，素材不覆盖。</p>
        </section>
        <section>
          <div class="ec-prod-split-label"><i>1</i>商品资料</div>
          <dl class="ec-prod-info">
            <div class="ec-prod-info-row"><dt>商品名称</dt><dd>${esc(item.name)}</dd></div>
            <div class="ec-prod-info-row"><dt>价格 · 规格</dt><dd><span class="ec-prod-price is-num">${money(item.price)}</span> · ${esc(item.spec || '—')}</dd></div>
            <div class="ec-prod-info-row"><dt>佣金 · 类目</dt><dd class="is-num">${pct(item.comm)}（预估 ${money(item.cma)}） · <span class="ec-prod-cat">${esc(item.cat || '未分类')}</span></dd></div>
            <div class="ec-prod-info-row"><dt>快手商品ID</dt><dd class="is-num">${esc(item.kuaishouId || '—')} · ${esc(item.platform)}</dd></div>
            <div class="ec-prod-info-row"><dt>团队</dt><dd>${esc(item.team || '—')}</dd></div>
            <div class="ec-prod-info-row"><dt>素材状态</dt><dd>${badge(item.status)} <span class="ec-prod-hint is-num">生成 ${item.gen} 次 · 更新 ${esc(item.updated)}</span></dd></div>
          </dl>
          <div class="ec-prod-split-label" style="margin-top:16px"><i>✦</i>商品亮点</div>
          <p class="ec-prod-highlight">${item.highlight ? esc(item.highlight) : '尚未填写商品亮点，生成时黑段缺少卖点依据。'}</p>
          ${item.negatives ? `<div class="ec-prod-split-label" style="margin-top:14px"><i>!</i>负面词汇（生成时规避）</div><p class="ec-prod-highlight">${esc(item.negatives)}</p>` : ''}
          ${item.status === 'ready' && missing.length ? `<div class="ec-prod-gap"><strong>黑段素材缺失清单</strong><ul>${missing.map(s => `<li>${esc(s.label)}</li>`).join('')}</ul></div>` : ''}
        </section>
      </div>
      ${['video', 'image'].map(kind => {
        const list = kind === 'video' ? videos : images;
        return `<section class="ec-prod-media-group">
        <header><i>${kind === 'video' ? '▶' : '⛰'}</i><b>${kind === 'video' ? '视频素材' : '图片素材'} <span>(${list.length})</span></b><span class="is-tail"><label class="ec-prod-btn ec-prod-btn--sm">＋ 上传补充<input type="file" accept="${kind === 'video' ? 'video/*' : 'image/*'}" multiple data-lp-append="${kind}" data-id="${item.id}" hidden></label></span></header>
        ${list.length ? `<div class="ec-prod-media-grid${kind === 'video' ? ' ec-prod-media-grid--video' : ''}">${list.map((row, index) => `<article class="ec-prod-media"><div class="ec-prod-media-frame">${row.src ? `<img src="${esc(mediaSrc(row))}" alt="">` : ''}<span class="ec-prod-tag">${kind === 'video' ? '常规' : '图片'}</span>${kind === 'video' ? '<span class="ec-prod-play">▶</span>' : ''}${row.duration ? `<span class="ec-prod-dur is-num">00:${String(row.duration).padStart(2, '0')}</span>` : ''}</div><div class="ec-prod-media-body"><strong>${esc(row.name)}</strong><small>来源：${esc(row.from || '联网爬取')} · ${esc(item.team || '未分配团队')}</small></div><div class="ec-prod-media-ops"><button type="button" data-lp="media-preview" data-id="${item.id}" data-kind="${kind}" data-index="${index}">预览</button><label class="ec-prod-media-replace">替换<input type="file" accept="${kind === 'video' ? 'video/*' : 'image/*'}" data-lp-replace="${kind}" data-id="${item.id}" data-index="${index}" hidden></label><button type="button" class="is-danger" data-lp="media-disable" data-id="${item.id}" data-kind="${kind}" data-index="${index}">禁用</button></div></article>`).join('')}</div>` : `<div class="ec-prod-hint" style="padding:18px 0">还没有${kind === 'video' ? '视频' : '图片'}素材${kind === 'video' ? '，黑段将回退默认组合' : ''}；可用右上「＋ 上传补充」本地补齐。</div>`}
      </section>`;
      }).join('')}
      <div class="ec-prod-detail-footer">
        <button type="button" class="ec-prod-btn ec-prod-btn--primary" data-lp="add-to-assets" data-id="${item.id}">⇪ 加入素材中心</button>
        ${(() => {
          const vs = item.materialDetails?.video || [];
          const left = vs.filter(v => !v.workbench && pushable(v)).length;
          const busy = pushing.has(item.id);
          return `<button type="button" class="ec-prod-btn${left ? ' ec-prod-btn--primary' : ''}" data-lp="push-workbench" data-id="${item.id}" ${busy ? 'disabled' : ''} title="把该商品的已入池视频素材下载并导入视频工作台素材库">${busy ? '导入中…' : `⇨ 导入视频工作台${vs.length ? `（${left}/${vs.length} 条）` : ''}`}</button>`;
        })()}
        <button type="button" class="ec-prod-btn" data-lp="close-detail">关闭</button>
      </div>
    </div>`;
  };

  /* ---------- 二次确认 ---------- */
  const confirmDialog = () => {
    const c = state.confirm;
    return `<div class="ec-prod-backdrop" role="presentation"><div class="ec-prod-dialog ec-prod-dialog--narrow" role="dialog" aria-modal="true" aria-labelledby="lpConfirmTitle">
      <header><div><h2 id="lpConfirmTitle">${esc(c.title)}</h2></div><button type="button" data-lp="dismiss-confirm" aria-label="关闭">×</button></header>
      <div class="ec-prod-confirm-body">
        <p>${esc(c.body)}</p>
        ${c.list ? `<ul class="ec-prod-confirm-list">${c.list.map(row => `<li><span>${esc(row.k)}</span><b>${esc(row.v)}</b></li>`).join('')}</ul>` : ''}
      </div>
      <footer><span class="is-spacer"></span><button type="button" class="ec-prod-btn" data-lp="dismiss-confirm">取消</button><button type="button" class="ec-prod-btn ${c.danger ? 'ec-prod-btn--solid-danger' : 'ec-prod-btn--primary'}" data-lp="do-confirm">${esc(c.okLabel || '确认')}</button></footer>
    </div></div>`;
  };

  /* ---------- 主渲染 ---------- */
  const head = () => `<div class="ec-prod-head"><div><h1>商品获取</h1><p>工作流第 1 步：录入商品资料 + 联网爬取素材；点击商品行进入详情查看资料与素材。</p></div>
    <div class="ec-prod-head-actions"><span class="ec-prod-count is-num">共 ${state.items.length} 个商品 · 素材就绪 ${state.items.filter(i => i.status === 'ready').length}</span></div></div>`;

  const body = () => {
    const rows = filtered();
    return `<div class="ec-video-products-scroll"><div class="ec-video-products-inner">
      ${state.detailId ? detailView() : `${head()}${filterCard()}
      <div class="ec-prod-card"><div class="ec-prod-card-body">${rows.length ? table(rows) : emptyState()}${gapNotice()}</div></div>`}
    </div></div>
    ${state.dialog === 'entry' ? entryDialog() : ''}
    ${state.confirm ? confirmDialog() : ''}`;
  };

  const html = () => `<main class="ec-video-products" aria-label="商品获取${state.detailId ? ' · 商品详情' : ''}">${body()}</main>`;

  const bind = root => {
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKeyDown);
  };

  /* 由 app.js 在渲染整块外壳后调用；只接管 .ec-video-products 子树，不碰左侧导航 */
  const mount = (root, options = {}) => {
    api = options;
    const el = root?.querySelector?.('.ec-video-products');
    if (!el) return false;
    bind(el);
    return true;
  };

  const paint = () => {
    const current = document.querySelector('.ec-video-products');
    if (!current) return;
    const next = document.createElement('div');
    next.innerHTML = html();
    const replacement = next.firstElementChild;
    current.replaceWith(replacement);
    bind(replacement);
  };

  const dismissTop = () => {
    if (state.confirm) { state.confirm = null; return paint(); }
    if (state.dialog) { state.dialog = null; state.draft = null; return paint(); }
    if (state.detailId) { state.detailId = null; return paint(); }
  };

  /* ---------- 爬取行为（PRD §4.7） ---------- */
  const newDraft = () => ({
    kuaishouId: '', name: '', platform: 'Kuaishou', price: '', spec: '', comm: '', cat: '', team: '', highlight: '', negatives: '',
    pool: { main: [], video: [], image: [] }, crawl: newCrawl(), collecting: false, generating: false, collectState: null,
  });

  const crawlBasis = () => ({ name: state.draft?.name || '', cat: state.draft?.cat || '' });

  /* 素材池里已有的文件名：命中即打「素材池已有」重复标识 */
  const poolNames = () => new Set(['main', 'video', 'image'].flatMap(key => (state.draft?.pool[key] || []).map(file => file.name)));

  /* 勾选不重绘：仅同步分区“已选 N”徽标与底部“归入素材池”按钮 */
  const syncCrawlPicked = () => {
    const crawl = state.draft?.crawl;
    if (!crawl) return;
    CRAWL_ZONES.forEach(zone => {
      const zoneEl = document.querySelector(`.ec-prod-zone--${zone.key}`);
      if (!zoneEl) return;
      const n = crawlPickedByZone(crawl, zone.key).length;
      let badge = zoneEl.querySelector('.ec-prod-zone-picked');
      if (n && !badge) {
        badge = document.createElement('span');
        badge.className = 'ec-prod-zone-picked';
        zoneEl.querySelector('header')?.appendChild(badge);
      }
      if (badge) {
        badge.textContent = `已选 ${n}`;
        badge.style.display = n ? '' : 'none';
      }
    });
    const btn = document.querySelector('[data-lp="commit-crawl"]');
    if (btn) {
      const n = crawlPicked(crawl);
      btn.disabled = !n;
      btn.textContent = `↓ 归入素材池${n ? ` (${n})` : ''}`;
    }
  };

  /* 底栏「视频 / 图片」计数局部同步 */
  const syncPoolTally = () => {
    const d = state.draft;
    const tally = document.querySelector('.ec-prod-tally');
    if (!d || !tally) return;
    tally.innerHTML = `<span>▶ 视频: <b>${d.pool.video.length}</b></span><span>⛰ 图片: <b>${d.pool.image.length + d.pool.main.length}</b></span>`;
  };

  /* ---------- 弹窗原位更新工具：候选流式回填 / 校验态 / 提示语都不重绘 ---------- */
  const zoneMetaOf = key => CRAWL_ZONES.find(z => z.key === key);
  const zoneElOf = key => document.querySelector(`.ec-prod-zone--${key}`);
  const zoneBodyOf = key => zoneElOf(key)?.querySelector('.ec-prod-zone-body');

  const zoneEmptyText = (zone, meta) => meta.key === 'image'
    ? '商品图随「采集」从详情页自动回填到本分区，无需联网爬取；勾选后归入素材池。'
    : Object.keys(zone.attempts).length && !zone.results.length
      ? `${meta.label}分区已重试仍未取到候选，可完善商品名称 / 类目后再爬，或入库后在详情页替换补齐。`
      : `选渠道后点「开始爬取」，${meta.label}候选只回填到这个分区。`;

  const syncZoneCount = key => {
    const zone = state.draft?.crawl?.zones[key];
    const el = zoneElOf(key)?.querySelector('.ec-prod-zone-count');
    if (zone && el) {
      el.textContent = `${zone.results.length} 条候选`;
      el.classList.toggle('is-zero', !zone.results.length);
    }
  };

  const syncZoneRunning = key => {
    const zone = state.draft?.crawl?.zones[key];
    const el = zoneElOf(key);
    if (!zone || !el) return;
    const header = el.querySelector('header');
    let badge = header?.querySelector('.ec-prod-badge--working');
    if (zone.running && !badge) {
      badge = document.createElement('span');
      badge.className = 'ec-prod-badge ec-prod-badge--working ec-prod-badge--plain';
      badge.textContent = '爬取中';
      header.insertBefore(badge, header.querySelector('.ec-prod-zone-count'));
    } else if (!zone.running && badge) {
      badge.remove();
    }
    const body = zoneBodyOf(key);
    const meta = zoneMetaOf(key);
    if (!body || !meta) return;
    if (zone.running && !zone.results.length) {
      body.classList.add('is-loading');
      body.innerHTML = `<span class="ec-prod-spinner"></span><span>正在检索同类${meta.label}素材…</span>`;
    } else if (!zone.running) {
      body.classList.remove('is-loading');
      if (!zone.results.length) {
        body.innerHTML = `<div class="ec-prod-zone-empty">${esc(zoneEmptyText(zone, meta))}</div>`;
      }
    }
  };

  const syncZoneFail = key => {
    const zone = state.draft?.crawl?.zones[key];
    const el = zoneElOf(key);
    if (!zone || !el) return;
    el.querySelector('.ec-prod-zone-fail')?.remove();
    if (!zone.failed.length) return;
    const meta = zoneMetaOf(key);
    const div = document.createElement('div');
    div.className = 'ec-prod-zone-fail';
    div.innerHTML = `<span><b>${esc(zone.failed.join('、'))} 渠道未返回${meta.label}候选</b>${esc(zone.failed.map(ch => zone.errors[ch] || `${ch} 未返回候选`).join('；'))}；本分区已按「可用即通过」跳过，可完善信息后重试本分区。</span><button type="button" class="ec-prod-btn ec-prod-btn--sm" data-lp="retry-zone" data-zone="${key}" ${zone.running ? 'disabled' : ''}>⟳ 重试该分区</button>`;
    el.appendChild(div);
  };

  /* 新候选只追加瓷砖，不重建分区 */
  const appendZoneRows = (key, rows) => {
    const zone = state.draft?.crawl?.zones[key];
    const body = zoneBodyOf(key);
    const meta = zoneMetaOf(key);
    if (!zone || !body || !meta || !rows.length) return;
    body.classList.remove('is-loading');
    [...body.children].forEach(c => { if (!c.classList.contains('ec-prod-zone-grid')) c.remove(); });
    let grid = body.querySelector('.ec-prod-zone-grid');
    if (!grid) {
      grid = document.createElement('div');
      grid.className = 'ec-prod-zone-grid';
      body.appendChild(grid);
    }
    rows.forEach(row => grid.insertAdjacentHTML('beforeend', candidateTile(row, zone.results.indexOf(row), meta)));
    syncZoneCount(key);
  };

  /* 表单输入不触发重绘：只同步按钮可用态与爬取提示语 */
  const syncEntryActions = () => {
    const d = state.draft;
    if (!d) return;
    const busy = crawlBusy(d.crawl);
    const noName = !d.name.trim();
    const runBtn = document.querySelector('[data-lp="run-crawl"]');
    if (runBtn) {
      const canRun = !noName && d.crawl.channels.length > 0 && !busy;
      runBtn.disabled = !canRun;
      runBtn.title = noName ? '请先填写商品名称，爬取按名称 / 类目发起'
        : !d.crawl.channels.length ? '请先至少选择一个渠道'
        : busy ? '候选正在流式回填中' : '';
      runBtn.textContent = busy ? '爬取中…' : '↓ 开始爬取';
    }
    const note = document.querySelector('.ec-prod-crawl-note');
    if (note) {
      if (noName) {
        note.className = 'ec-prod-crawl-note is-warn';
        note.textContent = '⚠ 未填商品名称，暂不可发起爬取';
      } else {
        note.className = 'ec-prod-crawl-note';
        note.innerHTML = `依据 <b>${esc(d.name.trim().slice(0, 14))}</b>${d.cat ? ` · <b>${esc(d.cat)}</b>` : ''} 检索同类型素材`;
      }
    }
    const submit = document.querySelector('[data-lp="submit-entry"]');
    if (submit) submit.disabled = !entryValid(d);
  };

  const setCollectState = (d, tone, text) => {
    d.collectState = { tone, text };
    const row = document.getElementById('lpKsId')?.closest('.ec-prod-row');
    if (!row) return;
    let box = row.querySelector('.ec-prod-collect-state');
    if (!box) {
      box = document.createElement('div');
      row.appendChild(box);
    }
    box.className = `ec-prod-collect-state is-${tone}`;
    box.textContent = text;
  };

  const setDraftValue = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  const setCollecting = (d, on) => {
    d.collecting = on;
    const btn = document.querySelector('[data-lp="collect"]');
    if (btn) {
      btn.disabled = on;
      btn.innerHTML = on ? '<span class="ec-prod-spinner" style="width:14px;height:14px;border-width:2px"></span> 采集中' : '↓ 采集';
    }
  };

  const poolChipHtml = (file, index, zoneKey) =>
    `<span class="ec-prod-chip">${file.src ? `<img src="${esc(mediaSrc(file))}" alt="">` : `<i>${zoneKey === 'video' ? '▶' : '图'}</i>`}<span title="${esc(file.name)}">${esc(file.from ? `${file.from} · ${file.name}` : file.name)}</span><button type="button" data-lp="remove-pool" data-zone="${zoneKey}" data-index="${index}" aria-label="移出 ${esc(file.name)}">×</button></span>`;

  /* 真实候选行：保留来源链接 / 播放地址 / 封面，供入库与预览使用 */
  const videoRow = (it, channel) => ({
    name: (it.title || `视频 ${it.id}`).slice(0, 60), channel,
    duration: it.durationMs ? Math.round(it.durationMs / 1000) : null,
    size: '—', src: it.cover || '', videoId: it.id || '', pageUrl: it.pageUrl || '',
    playUrl: it.playUrl || '', platform: it.platform || '', author: it.author || '', like: it.like ?? null,
  });
  const imageRow = (it, channel) => ({
    name: `${(it.title || '素材').slice(0, 50)} 封面.jpg`, channel,
    duration: null, size: '—', src: it.cover || '', videoId: it.id || '',
    pageUrl: it.pageUrl || '', playUrl: '', platform: it.platform || '', author: it.author || '', like: it.like ?? null,
  });

  const runZone = (crawl, zoneKey, channels, reset) => {
    const zone = crawl.zones[zoneKey];
    if (zone.running || !channels.length) return;
    if (reset) { zone.results = []; zone.failed = []; zone.errors = {}; }
    else { zone.failed = zone.failed.filter(ch => !channels.includes(ch)); channels.forEach(ch => { delete zone.errors[ch]; }); }
    const keyword = crawlBasis().name.trim();
    zone.running = true;
    if (reset) {
      /* 清空旧候选网格与失败条，原位重置 */
      const body = zoneBodyOf(zoneKey);
      body?.querySelector('.ec-prod-zone-grid')?.remove();
      zoneElOf(zoneKey)?.querySelector('.ec-prod-zone-fail')?.remove();
      syncZoneCount(zoneKey);
      syncCrawlPicked();
    } else {
      syncZoneFail(zoneKey);
    }
    syncZoneRunning(zoneKey);
    syncEntryActions();
    let pending = channels.length;
    const settle = () => {
      pending -= 1;
      if (!pending && state.draft?.crawl === crawl) {
        zone.running = false;
        syncZoneRunning(zoneKey);
      }
      syncEntryActions();
    };
    channels.forEach(channel => {
      zone.attempts[channel] = (zone.attempts[channel] || 0) + 1;
      serviceSearch(channelPlatform(channel), keyword).then(res => {
        if (state.draft?.crawl !== crawl) return;
        if (!res.ok || !(res.items || []).length) {
          if (!zone.failed.includes(channel)) zone.failed.push(channel);
          zone.errors[channel] = res.ok ? '该渠道搜索无结果' : (res.message || '未返回候选');
          syncZoneFail(zoneKey);
          return settle();
        }
        const batch = [];
        res.items.forEach(it => {
          if (zoneKey === 'image' && !it.cover) return;
          const row = zoneKey === 'video' ? videoRow(it, channel) : imageRow(it, channel);
          const dup = crawl.taken.has(row.name) ? 'pool'
            : zone.results.some(old => (row.videoId && old.videoId === row.videoId) || old.name === row.name) ? 'seen'
            : false;
          row.picked = false;
          row.dup = dup;
          zone.results.push(row);
          batch.push(row);
        });
        appendZoneRows(zoneKey, batch);
        settle();
      }).catch(() => {
        if (state.draft?.crawl !== crawl) return;
        if (!zone.failed.includes(channel)) zone.failed.push(channel);
        zone.errors[channel] = '采集服务未响应';
        syncZoneFail(zoneKey);
        settle();
      });
    });
  };

  const startCrawl = () => {
    const crawl = state.draft?.crawl;
    if (!crawl || crawlBusy(crawl) || !crawl.channels.length || !crawlBasis().name.trim()) return;
    crawl.taken = poolNames();
    /* 图片分区素材由「采集」从详情页带回，联网爬取只跑视频分区 */
    runZone(crawl, 'video', [...crawl.channels], true);
    syncEntryActions();
  };

  const retryZone = zoneKey => {
    const crawl = state.draft?.crawl;
    const zone = crawl?.zones[zoneKey];
    if (!zone || zone.running || !zone.failed.length) return;
    const channels = [...zone.failed];
    runZone(crawl, zoneKey, channels, false);
    toast(`正在重试 ${channels.join('、')} 的${zoneKey === 'video' ? '视频' : '图片'}候选…`);
  };

  /* 归入素材池：勾选的候选进入对应分区，随商品一同入库 */
  const commitCrawl = () => {
    const draft = state.draft;
    const crawl = draft?.crawl;
    if (!crawl) return;
    const moved = { video: 0, image: 0 };
    CRAWL_ZONES.forEach(zone => {
      const rows = crawlPickedByZone(crawl, zone.key);
      rows.forEach(row => draft.pool[zone.card].push({
        name: row.name, src: row.src || imgOf(row.name), from: row.channel, size: row.size, duration: row.duration,
        videoId: row.videoId || '', pageUrl: row.pageUrl || '', playUrl: row.playUrl || '', platform: row.platform || '',
      }));
      moved[zone.key] = rows.length;
      /* 原位更新：移除被归入的瓷砖、素材池追加 chip、剩余瓷砖重排索引 */
      const zres = crawl.zones[zone.key];
      const pickedIdx = new Set(zres.results.map((r, i) => (r.picked && !r.dup ? i : -1)).filter(i => i >= 0));
      const el = zoneElOf(zone.key);
      const grid = el?.querySelector('.ec-prod-zone-grid');
      if (grid) {
        [...grid.querySelectorAll('.ec-prod-cand')].forEach((t, i) => { if (pickedIdx.has(i)) t.remove(); });
        [...grid.querySelectorAll('.ec-prod-cand')].forEach((t, i) => { t.dataset.index = String(i); });
      }
      zres.results = zres.results.filter(row => !(row.picked && !row.dup));
      const poolEl = el?.querySelector('.ec-prod-pool');
      if (poolEl) {
        poolEl.querySelector('.ec-prod-hint')?.remove();
        const label = poolEl.querySelector('.ec-prod-pool-label');
        if (label) label.textContent = `已归入 ${draft.pool[zone.key].length}`;
        const startIdx = draft.pool[zone.key].length - rows.length;
        rows.forEach((row, i) => {
          poolEl.insertAdjacentHTML('beforeend', poolChipHtml(draft.pool[zone.key][startIdx + i], startIdx + i, zone.key));
        });
      }
      syncZoneCount(zone.key);
    });
    syncCrawlPicked();
    syncPoolTally();
    toast(`已归入素材池：视频 +${moved.video} · 图片 +${moved.image}`);
  };

  /* 加入素材中心（PRD §4.4-②）：按 productId 归集，重复加入去重不产生副本 */
  const addToAssets = item => {
    const bridge = window.EcommerceVideoAssets;
    if (!bridge?.ingestProduct) { toast('素材中心模块未就绪，无法归集'); return; }
    const result = bridge.ingestProduct({
      productId: item.id, name: item.name, price: item.price, cat: item.cat, main: item.materials.main ? '主图' : '无图',
      videos: mediaFiles(item, 'video').map(row => ({ name: row.name, duration: row.duration ? `00:${String(row.duration).padStart(2, '0')}` : null, size: '—', from: row.from || '商品获取', src: row.src || '', pageUrl: row.pageUrl || '', playUrl: row.playUrl || '', videoId: row.videoId || '', platform: row.platform || '' })),
      images: mediaFiles(item, 'image').map(row => ({ name: row.name, size: '—', from: row.from || '商品获取', src: row.src || '', pageUrl: row.pageUrl || '', videoId: row.videoId || '', platform: row.platform || '' })),
    });
    toast(result.added
      ? `已归入素材中心：新增 ${result.added} 项${result.duplicates ? `，${result.duplicates} 项重复已去重` : ''}`
      : `该商品素材已全部在素材中心（${result.duplicates} 项重复，未产生副本）`);
  };

  /* 推送视频素材到视频工作台：商品资料 upsert + 未导入素材经采集服务落盘后入库；
     manual=false（录入后自动同步）时即使素材为空也会推送商品资料，失败仅提示不阻塞 */
  const pushToWorkbench = (item, manual) => {
    if (!item || pushing.has(item.id)) return;
    const videos = item.materialDetails?.video || [];
    const pendingIdx = videos.map((v, i) => (!v.workbench && pushable(v) ? i : -1)).filter(i => i >= 0);
    const unpushable = videos.filter(v => !v.workbench && !pushable(v)).length;
    if (manual && videos.length && !pendingIdx.length) {
      toast(unpushable ? `剩余 ${unpushable} 条为本地上传素材，没有可推送的来源地址` : '视频素材已全部导入过工作台');
      return;
    }
    pushing.add(item.id); paint();
    fetch('./api/workbench-import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          productId: String(item.kuaishouId || item.id), name: String(item.name || ''),
          price: String(item.price ?? ''), specification: String(item.spec || ''),
          sellingPoints: String(item.highlight || ''),
        },
        materials: pendingIdx.map(i => ({ key: i, name: videos[i].name, platform: videos[i].platform || '', playUrl: videos[i].playUrl || '', pageUrl: videos[i].pageUrl || '', local: videos[i].local || '' })),
      }),
    }).then(r => r.json()).then(res => {
      pushing.delete(item.id);
      const target = find(item.id);
      if (!target) return;
      if (!res || !res.ok) {
        paint();
        toast(manual ? `导入工作台失败：${res?.message || '服务无响应'}` : '商品已入库；视频工作台未连接，可到详情页手动导入');
        return;
      }
      const tvideos = target.materialDetails?.video || [];
      let ok = 0, fail = 0;
      (res.imported || []).forEach(r => {
        const v = tvideos[r.key];
        if (r.status === 'ready' && v) { v.workbench = true; if (r.local) v.local = r.local; ok += 1; }
        else fail += 1;
      });
      const skipped = (res.skipped || []).length + unpushable;
      persist(); paint();
      toast(`已${manual ? '推送' : '同步'}到视频工作台：素材入库 ${ok} 条` + (fail ? `，失败 ${fail} 条` : '') + (skipped ? `，跳过 ${skipped} 条` : ''));
    }).catch(err => {
      pushing.delete(item.id); paint();
      toast(manual ? '导入工作台失败：' + (err?.message || '网络错误') : '商品已入库；视频工作台未连接，可到详情页手动导入');
    });
  };

  const onClick = event => {
    /* 只有点在遮罩本体上才关闭；弹窗内部点击不得冒泡成关闭 */
    const backdrop = event.target.closest('.ec-prod-backdrop');
    if (backdrop && event.target === backdrop) { dismissTop(); return; }

    /* 渠道开关只带 data-lp-channel，必须在 [data-lp] 兜底之前拦截；原位切换不重绘 */
    const channelBtn = event.target.closest('[data-lp-channel]');
    if (channelBtn) {
      const crawl = state.draft?.crawl;
      if (!crawl) return;
      const name = channelBtn.dataset.lpChannel;
      const on = !crawl.channels.includes(name);
      crawl.channels = on ? [...crawl.channels, name] : crawl.channels.filter(c => c !== name);
      channelBtn.classList.toggle('active', on);
      channelBtn.setAttribute('aria-pressed', String(on));
      syncEntryActions();
      return;
    }

    /* 平台分段按钮：button 上的 data-lp-draft 不触发表单 input 事件，原位切换 */
    const draftBtn = event.target.closest('button[data-lp-draft]');
    if (draftBtn && state.draft && draftBtn.dataset.value !== undefined) {
      state.draft[draftBtn.dataset.lpDraft] = draftBtn.dataset.value;
      draftBtn.parentElement?.querySelectorAll('button').forEach(b => {
        const on = b === draftBtn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      return;
    }

    const trigger = event.target.closest('[data-lp]');
    if (!trigger) return;
    const action = trigger.dataset.lp;
    const id = trigger.dataset.id;
    const item = id ? find(id) : null;

    if (action === 'pick') {
      const row = state.draft?.crawl?.zones[trigger.dataset.zone]?.results[Number(trigger.dataset.index)];
      if (!row || row.dup) return;
      row.picked = !row.picked;
      /* 局部更新卡片态，不做整窗重绘 */
      trigger.classList.toggle('is-picked', row.picked);
      trigger.setAttribute('aria-pressed', String(Boolean(row.picked)));
      const cap = trigger.querySelector('.ec-prod-cand-preview');
      if (cap) cap.textContent = row.picked ? '已选 · 再点取消' : '点击勾选';
      syncCrawlPicked();
      return;
    }
    if (action === 'remove-pool') {
      const zoneKey = trigger.dataset.zone;
      const pool = state.draft?.pool?.[zoneKey];
      if (!pool) return;
      pool.splice(Number(trigger.dataset.index), 1);
      /* 局部更新：移除该 chip、刷新“已归入”与底栏计数，剩余 chip 重排索引 */
      const poolEl = trigger.closest('.ec-prod-pool');
      trigger.closest('.ec-prod-chip')?.remove();
      if (poolEl) {
        const label = poolEl.querySelector('.ec-prod-pool-label');
        if (label) label.textContent = `已归入 ${pool.length}`;
        poolEl.querySelectorAll('[data-lp="remove-pool"]').forEach((b, i) => { b.dataset.index = String(i); });
        if (!pool.length) {
          const hint = document.createElement('span');
          hint.className = 'ec-prod-hint';
          hint.textContent = '勾选候选后点「归入素材池」';
          poolEl.appendChild(hint);
        }
      }
      syncPoolTally();
      return;
    }
    if (action === 'run-crawl') { startCrawl(); return; }
    if (action === 'retry-zone') { retryZone(trigger.dataset.zone); return; }
    if (action === 'commit-crawl') { commitCrawl(); return; }

    if (action === 'reset-filters') { state.filters = blankFilters(); paint(); return; }
    if (action === 'open-entry') { state.draft = newDraft(); state.dialog = 'entry'; paint(); return; }
    if (action === 'dismiss-entry') { state.dialog = null; state.draft = null; paint(); return; }
    if (action === 'dismiss-confirm') { state.confirm = null; paint(); return; }
    if (action === 'do-confirm') { const c = state.confirm; state.confirm = null; c?.run?.(); return paint(); }
    if (action === 'open-detail') { state.detailId = id; paint(); return; }
    if (action === 'close-detail') { state.detailId = null; paint(); return; }
    if (action === 'ext-id') {
      extPing().then(m => toast(m
        ? `✓ 采集插件已连接（接入版 v${m.version || '1.1'}）`
        : '未检测到采集插件：请安装「快手商品信息采集器-接入版」扩展后刷新本页'));
      return;
    }
    if (action === 'ext-help') {
      toast('安装：chrome://extensions 开启开发者模式 → 加载已解压 → 选择「快手商品信息采集器-接入版」目录');
      return;
    }

    if (action === 'collect') {
      const d = state.draft;
      const ksId = d.kuaishouId.trim();
      if (!ksId) { setCollectState(d, 'fail', '请先填写快手商品ID'); return; }
      setCollecting(d, true);
      setCollectState(d, 'ok', '正在通过浏览器插件打开快分销详情页读取，请勿关闭浏览器…');
      extLookup(ksId).then(res => {
        if (state.draft !== d) return;
        setCollecting(d, false);
        if (!res) {
          setCollectState(d, 'fail', '未检测到采集插件：请安装「快手商品信息采集器-接入版」扩展，并通过采集服务地址打开本页');
          return;
        }
        if (!res.ok) {
          setCollectState(d, 'fail', `采集失败：${res.error || '插件未返回结果'}（请确认浏览器已登录快分销达人账号）`);
          return;
        }
        const record = res.record || {};
        if (record.productName) { d.name = record.productName; setDraftValue('lpName', d.name); }
        if (record.price?.min != null) { d.price = String(record.price.min); setDraftValue('lpPrice', d.price); }
        if (record.commission?.percent != null) { d.comm = String(record.commission.percent); setDraftValue('lpComm', d.comm); }
        if (record.specification) { d.spec = record.specification; setDraftValue('lpSpec', d.spec); }
        d.cat = mapCategory(record, d.name);
        setDraftValue('lpCatSel', d.cat);
        d.platform = 'Kuaishou';
        /* 平台分段按钮原位同步 */
        document.querySelectorAll('button[data-lp-draft="platform"]').forEach(b => {
          const on = b.dataset.value === 'Kuaishou';
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
        d.collectRaw = record;
        if (record.mainImageUrl) {
          d.pool.main = [{ name: '采集主图.jpg', src: record.mainImageUrl, from: '采集', platform: 'kuaishou' }];
          syncPoolTally();
        }
        /* 商品图集 → 图片分区候选，与视频一样人工勾选归入 */
        const imgs = Array.isArray(record.imageUrls) ? record.imageUrls.filter(u => /^https:\/\//.test(u)).slice(0, 12) : [];
        const taken = poolNames();
        d.crawl.zones.image.results = imgs.map((url, i) => ({
          name: `商品图 ${i + 1}`, src: url, channel: '采集', platform: 'kuaishou',
          pageUrl: record.sourceUrl || '', videoId: '', playUrl: '', author: '', size: '详情图',
          picked: false, dup: taken.has(`商品图 ${i + 1}`) ? 'pool' : false,
        }));
        zoneBodyOf('image')?.querySelector('.ec-prod-zone-grid')?.remove();
        appendZoneRows('image', d.crawl.zones.image.results);
        const missing = [];
        if (!record.productName) missing.push('名称');
        if (record.price?.min == null) missing.push('价格');
        if (record.commission?.percent == null) missing.push('佣金');
        const warns = (res.warnings || []).filter(Boolean).join('；');
        setCollectState(d, missing.length ? 'warn' : 'ok',
          (missing.length ? `已回填可读字段，但${missing.join('、')}未在详情页明确标注` : '✓ 商品资料已回填')
          + (imgs.length ? `；${imgs.length} 张商品图已进入图片分区` : '；详情页未读取到商品图集')
          + (warns ? `；${warns}` : '') + '；视频请在右列联网爬取');
        syncEntryActions();
      });
      return;
    }
    if (action === 'recognize') {
      const d = state.draft;
      if (!d.name.trim()) { toast('请先填写商品名称'); return; }
      const guessed = CATEGORIES.find(c => d.name.includes(c.slice(0, 2))) || (d.name.includes('头盔') || d.name.includes('充电') || d.name.includes('插排') ? '数码家电' : d.name.includes('袋') || d.name.includes('锅') ? '家居百货' : d.name.includes('鞋垫') || d.name.includes('护膝') ? '服饰鞋包' : '食品饮料');
      d.cat = guessed;
      setDraftValue('lpCatSel', guessed);
      if (!d.highlight.trim()) {
        d.highlight = `已按商品名称识别类目为「${guessed}」，并生成卖点草稿：${d.name.slice(0, 22)}，${d.spec || '规格见详情'}，${d.price ? `到手价 ${d.price} 元` : '价格以商品页为准'}，日常使用方便省心。`;
        setDraftValue('lpHi', d.highlight);
      }
      syncEntryActions();
      toast('已补全类目与卖点草稿');
      return;
    }
    if (action === 'ai-highlight') {
      const d = state.draft;
      if (d.generating) return;
      d.generating = true;
      trigger.disabled = true;
      later(() => {
        if (state.draft !== d) return;
        d.generating = false;
        trigger.disabled = false;
        d.highlight = `${d.name.slice(0, 20)}，${d.spec || '标准规格'}。${d.cat || '日常'}场景实测：用料厚实、做工规整，收纳与使用都不占地方；${d.price ? `到手价 ${d.price} 元，` : ''}同价位里性价比突出，老葛直播间的粉丝可以放心拍。`;
        setDraftValue('lpHi', d.highlight);
        syncEntryActions();
      }, 1000);
      return;
    }
    if (action === 'submit-entry') {
      const d = state.draft;
      if (!entryValid(d)) return;
      /* 已勾选但未点「归入素材池」的候选在提交时一并归入，避免勾选被静默丢弃 */
      if (crawlPicked(d.crawl)) commitCrawl();
      const existed = state.items.find(row => row.kuaishouId === d.kuaishouId.trim());
      if (existed) { toast('该快手商品ID 已录入，已为你定位到详情'); state.dialog = null; state.draft = null; state.detailId = existed.id; return paint(); }
      const materials = { main: d.pool.main.length, video: d.pool.video.length, image: d.pool.image.length };
      /* 真实素材明细随商品一同入库：视频 ID / 平台 / 来源链接 / 封面 / 播放地址 / 文件位置 */
      const materialDetails = {
        main: d.pool.main.map(f => ({ name: f.name, src: f.src || '', from: f.from || '采集', platform: f.platform || '' })),
        video: d.pool.video.map(f => ({ name: f.name, src: f.src || '', from: f.from || '', size: f.size || '', duration: f.duration ?? null, videoId: f.videoId || '', pageUrl: f.pageUrl || '', playUrl: f.playUrl || '', platform: f.platform || '', local: f.local || '' })),
        image: d.pool.image.map(f => ({ name: f.name, src: f.src || '', from: f.from || '', size: f.size || '', videoId: f.videoId || '', pageUrl: f.pageUrl || '', platform: f.platform || '', local: f.local || '' })),
      };
      state.items.unshift({
        id: uid('p'), kuaishouId: d.kuaishouId.trim(), name: d.name.trim(), cat: d.cat, price: Number(d.price), spec: d.spec.trim(),
        comm: Number(d.comm), cma: Number((Number(d.price) * Number(d.comm) / 100).toFixed(2)), gen: 0, platform: d.platform === 'TikTok' ? 'TikTok' : '快手',
        status: materialTotal({ materials }) ? 'ready' : 'pending', updated: today(), highlight: d.highlight.trim(), negatives: d.negatives.trim(), team: d.team.trim(),
        materials, materialDetails, collectSource: d.collectRaw?.sourceUrl || '',
      });
      state.dialog = null; state.draft = null;
      persist(); paint();
      toast(materialTotal(state.items[0]) ? '已入库，素材状态「素材就绪」，正在同步视频工作台…' : '已入库；素材池为空（未勾选归入候选），状态「待爬取」，可重新录入或在详情页补齐');
      pushToWorkbench(state.items[0], false);
      return;
    }
    if (action === 'sync') {
      if (!item) return;
      const ksId = (item.kuaishouId || '').trim();
      if (!/^\d{8,30}$/.test(ksId)) { toast('该商品没有可用的快手商品ID，无法同步'); return; }
      const prevStatus = item.status;
      item.status = 'crawling'; paint();
      extLookup(ksId).then(res => {
        const target = find(item.id);
        if (!target) return;
        if (!res || !res.ok) {
          target.status = prevStatus; persist(); paint();
          toast(!res ? '未检测到采集插件，无法同步' : `同步失败：${res.error || '插件未返回结果'}`);
          return;
        }
        const r = res.record || {};
        if (r.productName) target.name = r.productName;
        if (r.commission?.percent != null) target.comm = r.commission.percent;
        if (r.price?.min != null) target.price = r.price.min;
        target.cma = Number((Number(target.price) * Number(target.comm) / 100).toFixed(2));
        if (r.specification) target.spec = r.specification;
        target.cat = mapCategory(r, target.name);
        if (r.mainImageUrl) {
          const det = target.materialDetails || (target.materialDetails = { main: [], video: [], image: [] });
          det.main = [{ name: '采集主图.jpg', src: r.mainImageUrl, from: '采集', platform: 'kuaishou' }];
          target.materials.main = 1;
        }
        if (r.sourceUrl) target.collectSource = r.sourceUrl;
        target.status = 'ready';
        target.updated = today();
        persist(); paint();
        toast('已按 id 重爬价格 / 标题 / 主图并覆盖缓存，素材未覆盖');
      });
      return;
    }
    if (action === 'recrawl') {
      if (!item || !item.name.trim()) return;
      item.status = 'crawling'; paint();
      const channels = ['kuaishou', 'douyin'];
      const settled = [];
      channels.forEach(platform => {
        serviceSearch(platform, item.name.trim()).then(res => {
          settled.push({ platform, res });
          if (settled.length < channels.length) return;
          const target = find(item.id);
          if (!target) return;
          const det = target.materialDetails || (target.materialDetails = { main: [], video: [], image: [] });
          const seen = new Set(det.video.map(v => v.videoId).filter(Boolean));
          let added = 0;
          const failed = [];
          settled.forEach(({ platform: pf, res }) => {
            const channel = pf === 'douyin' ? '抖音' : '快手';
            if (!res.ok) { failed.push(channel); return; }
            (res.items || []).forEach(it => {
              if (it.id && seen.has(it.id)) return;
              if (it.id) seen.add(it.id);
              det.video.push({
                name: (it.title || `视频 ${it.id}`).slice(0, 60), src: it.cover || '', from: channel,
                duration: it.durationMs ? Math.round(it.durationMs / 1000) : null,
                videoId: it.id || '', pageUrl: it.pageUrl || '', playUrl: it.playUrl || '', platform: pf,
              });
              if (it.cover) {
                det.image.push({
                  name: `${(it.title || '素材').slice(0, 50)} 封面.jpg`, src: it.cover, from: channel,
                  videoId: it.id || '', pageUrl: it.pageUrl || '', platform: pf,
                });
              }
              added += 1;
            });
          });
          target.materials.video = det.video.length;
          target.materials.image = det.image.length;
          target.status = (added || det.video.length) ? 'ready' : 'crawlFailed';
          target.updated = today();
          persist(); paint();
          toast(added ? `重新爬取完成，新增 ${added} 条素材`
            : failed.length ? `爬取未成功：${failed.join('、')} 渠道未返回候选`
            : '没有新的素材');
        });
      });
      return;
    }
    if (action === 'add-to-assets') { if (item) addToAssets(item); return; }
    if (action === 'push-workbench') { if (item) pushToWorkbench(item, true); return; }
    if (action === 'media-preview') {
      if (!item) return;
      const row = mediaFiles(item, trigger.dataset.kind)[Number(trigger.dataset.index)];
      /* HLS(m3u8) 直链浏览器无法原生播放，退到来源页 */
      if (row?.playUrl && !/\.m3u8(\?|$)/i.test(row.playUrl)) { window.open(proxyOf(row.playUrl, row.platform), '_blank'); return; }
      if (row?.pageUrl) { window.open(row.pageUrl, '_blank'); return; }
      if (row?.src) { window.open(mediaSrc(row), '_blank'); return; }
      toast('该素材没有可预览的来源地址');
      return;
    }
    if (action === 'media-disable') {
      if (!item) return;
      const kind = trigger.dataset.kind;
      state.confirm = {
        title: '禁用该素材？', danger: true, okLabel: '禁用',
        body: '禁用后不再参与生成装配。若因此导致黑段缺料，「素材就绪」会显示缺失清单。',
        list: [{ k: '素材', v: `${kind === 'video' ? '视频' : '图片'}素材` }, { k: '商品', v: item.name.slice(0, 16) + '…' }],
        run: () => {
          const det = item.materialDetails?.[kind];
          const idx = Number(trigger.dataset.index);
          if (Array.isArray(det) && Number.isInteger(idx) && det[idx]) det.splice(idx, 1);
          if (kind === 'video') item.materials.video = Array.isArray(det) ? det.length : Math.max(0, item.materials.video - 1);
          else item.materials.image = Array.isArray(det) ? det.length : Math.max(0, item.materials.image - 1);
          persist(); paint(); toast('素材已禁用，不参与生成装配');
        },
      };
      return paint();
    }
  };

  /* 整行可点：键盘 Tab 聚焦后回车 / 空格进入详情（PRD §4.4-①） */
  const onKeyDown = event => {
    if (event.key === 'Escape') { dismissTop(); return; }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest?.('.ec-prod-rowlink');
    if (!row) return;
    event.preventDefault();
    state.detailId = row.dataset.id;
    paint();
  };

  const onInput = event => {
    const filterKey = event.target.dataset.lpFilter;
    if (filterKey) { state.filters[filterKey] = event.target.value; return paintDebounced(); }
    const draftKey = event.target.dataset.lpDraft;
    if (draftKey && state.draft) {
      /* 弹窗表单输入不重绘：只写状态 + 同步按钮可用态与爬取提示 */
      if (event.target.id === 'lpKsId' && state.draft.collectState) {
        state.draft.collectState = null;
        document.querySelector('.ec-prod-collect-state')?.remove();
      }
      state.draft[draftKey] = event.target.value;
      syncEntryActions();
      return;
    }
  };

  let debounce = null;
  const paintDebounced = () => {
    const focusKey = document.activeElement?.id || null;
    clearTimeout(debounce);
    debounce = later(() => {
      paint();
      if (focusKey) {
        const next = document.getElementById(focusKey);
        if (next) { next.focus(); const len = next.value?.length; if (len !== undefined && next.setSelectionRange) next.setSelectionRange(len, len); }
      }
    }, 180);
  };

  const onChange = event => {
    const filterKey = event.target.dataset?.lpFilter;
    if (filterKey) { state.filters[filterKey] = event.target.value; return paint(); }
    /* 详情页「替换」：走本地上传，文件不出本机（PRD §4.4-②） */
    const replace = event.target.dataset?.lpReplace;
    if (replace) {
      const item = find(event.target.dataset.id);
      const file = event.target.files?.[0];
      if (!item || !file) return;
      const kind = replace;
      if (kind === 'video') item.materials.video = Math.max(item.materials.video, Number(event.target.dataset.index) + 1);
      else item.materials.image = Math.max(item.materials.image, Number(event.target.dataset.index) + 1);
      item.updated = today();
      persist(); paint();
      toast(`已用本地文件替换：${file.name}`);
      return;
    }
    const append = event.target.dataset?.lpAppend;
    if (append) {
      const item = find(event.target.dataset.id);
      const files = [...(event.target.files || [])].slice(0, 5);
      if (!item || !files.length) return;
      if (append === 'video') item.materials.video += files.length;
      else item.materials.image += files.length;
      item.updated = today();
      persist(); paint();
      toast(`已上传补充 ${files.length} 个${append === 'video' ? '视频' : '图片'}素材`);
      return;
    }
  };

  window.EcommerceVideoProducts = {
    setAccount: accountScope.setAccount,
    html,
    mount,
    items: () => state.items,
    reset: () => { clearTimers(); state = blank(); persist(); },
    statusLabel: status => STATUS[status]?.label || status,
  };
})();
