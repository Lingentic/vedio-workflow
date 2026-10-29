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
  const PLATFORMS = ['快手', '抖音'];
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
  /* 两个演示案例（商品不同、素材图各自独立，都在 assets/ 下有真实文件）：
   * 76351842 鞋垫 = 秒完（约 1 秒流式回填完，assets/ecommerce-insole-demo/）
   * 76351900 榨汁杯 = 慢速（第 15 / 32 / 49 秒各出一条，约 52 秒，assets/ecommerce-juicer-demo/）
   * 慢速案例用来演示「确认时还没爬完 → 列表素材状态挂爬取中」。两渠道共用同一批图 → 双选渠道自动演示「与其他渠道重复」。 */
  const DEMO_KS_ID = '76351842';
  const SLOW_KS_ID = '76351900';
  const DEMO_PROFILE = {
    platform: '快手', name: '足弓支撑运动鞋垫 减震回弹透气吸汗 男女同款', price: '19.90', spec: '41-46码 / 双（可裁剪）', comm: '30', cat: '服饰鞋包',
    highlight: '踩下去软、回弹快，足弓处有支撑片，走一天脚底不酸。网面透气不闷汗，剪开能看三层料。运动鞋、休闲鞋、皮鞋都能垫，41 到 46 码按鞋码剪一下就行。',
  };
  const SLOW_PROFILE = {
    platform: '快手', name: '迷你电动榨汁杯 便携果汁机 Type-C 充电 双杯装', price: '49.90', spec: '380ml × 2杯（薄荷绿 · 奶白）', comm: '25', cat: '家居百货',
    highlight: '拧开杯盖就是刀头，橙子苹果丢进去按两下打成汁，Type-C 充一次电榨 8 杯。380ml 双杯换着装，出门塞包里不占地方，喝完冲一下就行。',
  };
  const DEMO_BANK = {
    video: [
      { name: '鞋垫回弹实测.mp4', duration: 11.2, size: '16.4 MB', src: '/prototype/assets/ecommerce-insole-demo/video-01.png' },
      { name: '上脚踩压演示.mp4', duration: 9.6, size: '13.8 MB', src: '/prototype/assets/ecommerce-insole-demo/video-02.png' },
      { name: '老葛口播讲卖点.mp4', duration: 14.3, size: '21.7 MB', src: '/prototype/assets/ecommerce-insole-demo/video-03.png' },
    ],
    image: [
      { name: '白底主图.jpg', size: '1.9 MB', src: '/prototype/assets/ecommerce-insole-demo/image-01.png' },
      { name: '剖面细节特写.jpg', size: '2.3 MB', src: '/prototype/assets/ecommerce-insole-demo/image-02.png' },
      { name: '四色规格对比.jpg', size: '2.0 MB', src: '/prototype/assets/ecommerce-insole-demo/image-03.png' },
    ],
  };
  const SLOW_BANK = {
    video: [
      { name: '鲜橙现榨全过程.mp4', duration: 18.6, size: '27.3 MB', src: '/prototype/assets/ecommerce-juicer-demo/video-01.png' },
      { name: '办公室下午茶实测.mp4', duration: 22.4, size: '33.1 MB', src: '/prototype/assets/ecommerce-juicer-demo/video-02.png' },
      { name: '拆机讲刀头与充电.mp4', duration: 15.8, size: '23.6 MB', src: '/prototype/assets/ecommerce-juicer-demo/video-03.png' },
    ],
    image: [
      { name: '双杯白底主图.jpg', size: '0.9 MB', src: '/prototype/assets/ecommerce-juicer-demo/image-01.png' },
      { name: '不锈钢刀头特写.jpg', size: '1.2 MB', src: '/prototype/assets/ecommerce-juicer-demo/image-02.png' },
      { name: '车载充电场景.jpg', size: '1.3 MB', src: '/prototype/assets/ecommerce-juicer-demo/image-03.png' },
    ],
  };
  const DEMO_PROFILES = { [DEMO_KS_ID]: DEMO_PROFILE, [SLOW_KS_ID]: SLOW_PROFILE };
  const DEMO_MAIN = { [DEMO_KS_ID]: { name: '鞋垫白底主图.jpg', src: DEMO_BANK.image[0].src }, [SLOW_KS_ID]: { name: '榨汁杯双杯白底.jpg', src: SLOW_BANK.image[0].src } };
  const zoneBank = (zoneKey, channel, kuaishouId) => (DEMO_PROFILES[kuaishouId] ? { [DEMO_KS_ID]: DEMO_BANK, [SLOW_KS_ID]: SLOW_BANK }[kuaishouId][zoneKey] : CRAWL_BANK[zoneKey][channel]);
  /* 流式节奏：慢速案例约 1 分钟，用来演示「确认时还没爬完 → 列表挂爬取中」 */
  const paceOf = kuaishouId => (kuaishouId === SLOW_KS_ID
    ? index => [15000, 32000, 49000][index] ?? 56000
    : index => 260 * (index + 1));
  /* 第一步「采集」顺带爬回来的同类商品图片（演示案例用各自那批真图，其余按渠道给通用图） */
  const imageBank = (channel, kuaishouId) => {
    const bank = { [DEMO_KS_ID]: DEMO_BANK, [SLOW_KS_ID]: SLOW_BANK }[kuaishouId];
    return (bank ? bank.image : CRAWL_BANK.image[channel] || CRAWL_BANK.image['快手']).map(row => ({ ...row, channel }));
  };
  /* 演示用的固定失败规则（刻意不随机）：抖音反爬最重 → 视频首轮只挂抖音这一个渠道，
   * 「重试该分区」即放行。图片已改由第一步采集带回，不再走爬取，所以不参与失败。 */
  const crawlFails = (zoneKey, channel, attempts) => zoneKey === 'video' && channel === '抖音' && attempts === 0;
  const newZone = () => ({ running: false, paused: false, results: [], failed: [], attempts: {}, plan: [], cursor: 0, epoch: 0, pace: null, record: null });
  const newCrawl = () => ({ channels: [CRAWL_CHANNELS[0]], zones: { video: newZone(), image: newZone() }, taken: new Set(), epoch: 0, open: new Set() });
  const crawlBusy = crawl => Object.values(crawl.zones).some(zone => zone.running);
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
  const blankFilters = () => ({ q: '', cat: '', platform: '', status: '' });
  const blank = () => ({ filters: blankFilters(), items: seedItems(), dialog: null, detailId: null, detailPanel: 'info', recordOpen: null, supplementId: null, preview: null, leaveConfirm: null, draft: null });
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
  /* ---------- 工具 ---------- */
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const productImage = (item, fallback) => {
    const own = item.assets?.main?.[0]?.src;
    if (own) return `<img src="${esc(own)}" alt="${esc(item.name)}" title="采集主图" width="46" height="46" loading="lazy" decoding="async">`;
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
      <div class="ec-prod-field ec-prod-field--search"><label for="lpQ">搜索商品名称 / 款式 / 快手商品ID</label>
        <div class="ec-prod-searchbox"><input id="lpQ" class="ec-prod-control" value="${esc(f.q)}" data-lp-filter="q" placeholder="搜索商品名称/款式/快手商品ID" autocomplete="off">
          <button type="button" class="ec-prod-btn ec-prod-btn--primary" data-lp="run-search">搜索</button>
          <button type="button" class="ec-prod-btn" data-lp="reset-filters">⟳ 重置</button>
        </div>
      </div>
      <div class="ec-prod-field"><label for="lpCat">类目</label><select id="lpCat" class="ec-prod-control" data-lp-filter="cat">${option('', '全部类目', f.cat)}${CATEGORIES.map(c => option(c, c, f.cat)).join('')}</select></div>
      <div class="ec-prod-field"><label for="lpPf">平台</label><select id="lpPf" class="ec-prod-control" data-lp-filter="platform">${option('', '全部平台', f.platform)}${PLATFORMS.map(p => option(p, p, f.platform)).join('')}</select></div>
      <div class="ec-prod-field"><label for="lpSt">素材状态</label><select id="lpSt" class="ec-prod-control" data-lp-filter="status">${option('', '全部状态', f.status)}${Object.entries(STATUS).map(([k, v]) => option(k, v.label, f.status)).join('')}</select></div>
      <div class="ec-prod-filter-actions"><span class="ec-prod-hint is-num">匹配 ${filtered().length} / ${state.items.length} 个商品</span></div>
    </div></div></div>`;
  };
  /* 单一列表：整行可点，行内不放任何操作按钮（PRD §4.4-①）。类目并进商品行小字、平台用徽标，商品ID 只在详情里看 */
  const table = rows => `<div class="ec-prod-table-wrap"><table class="ec-prod-table ec-prod-table--rows"><thead><tr>
      <th>商品</th><th>素材</th><th>素材状态</th><th class="is-num">更新时间</th><th class="is-right">操作</th>
    </tr></thead><tbody>${rows.map(item => `<tr class="ec-prod-rowlink" tabindex="0" role="link" data-lp="open-detail" data-id="${item.id}" aria-label="查看商品详情：${esc(item.name)}">
      <td><div class="ec-prod-cell-product"><span class="ec-prod-thumb">${productImage(item, item.materials.main ? '主图' : '无图')}${item.status === 'crawlFailed' ? '<em class="ec-prod-flag" title="爬取失败，进入详情可重新爬取">!</em>' : ''}</span><span><strong>${esc(item.name)}</strong><small>${esc(item.platform)} · ${money(item.price)} · ${esc(item.spec || '—')} · ID ${esc(item.kuaishouId || '—')}</small></span></div></td>
      <td><span class="is-num">${item.materials.video} 视 / ${item.materials.image + item.materials.main} 图</span></td>
      <td>${badge(item.status)}</td>
      <td class="is-num">${esc(item.updated)}</td>
      <td class="is-right"><a class="ec-prod-link" role="button" data-lp="open-supplement" data-id="${item.id}" title="给这个商品增补本地素材">增补素材</a></td>
    </tr>`).join('')}</tbody></table></div>`;
  const emptyState = () => `<div class="ec-prod-empty"><i>商</i><h3>${state.items.length ? '没有匹配的商品' : '还没有录入任何商品'}</h3><p>${state.items.length ? '换个关键词，或放宽价格、佣金区间再试。' : '点「录入商品」填写快手商品ID 并采集资料，右列联网爬取素材，点确认即入库。'}</p><div>${state.items.length ? '<button type="button" class="ec-prod-btn" data-lp="reset-filters">⟳ 清空筛选</button>' : '<button type="button" class="ec-prod-btn ec-prod-btn--primary" data-lp="open-entry">＋ 录入第一个商品</button>'}</div></div>`;
  const gapNotice = () => {
    const rows = state.items.filter(item => item.status === 'ready' && missingSlots(item).length);
    if (!rows.length) return '';
    return `<div class="ec-prod-gap"><strong>${rows.length} 个商品已「素材就绪」，但黑段素材位仍缺料，进视频制作生成时会逐项提示：</strong><ul>${rows.map(item => `<li>${esc(item.name.slice(0, 18))}… 缺 ${missingSlots(item).map(s => s.label).join('、')}</li>`).join('')}</ul></div>`;
  };
  /* ---------- 联网爬取面板：两个候选区（视频 / 图片）＋ 一个合并的归档区 ---------- */
  const dupText = dup => dup === 'seen' ? '与其他渠道重复' : '';
  /* 候选卡：左上角复选框＝唯一的勾选开关，点图/封面＝放大；不做单条删除、不做归入按钮 */
  const candidateTile = (row, index, zone) => `<article class="ec-prod-cand${row.picked ? ' is-picked' : ''}${row.dup ? ' is-dup' : ''}">
      <button type="button" class="ec-prod-cand-ck" data-lp="pick" data-zone="${zone.key}" data-index="${index}" aria-pressed="${row.picked}"${row.dup ? ' disabled' : ''} title="${row.dup ? esc(dupText(row.dup)) : row.picked ? '已勾选，点一下取消' : '勾选'}"></button>
      <button type="button" class="ec-prod-cand-media" data-lp="preview" data-zone="${zone.key}" data-index="${index}" title="放大查看">
        ${row.src ? `<img src="${esc(row.src)}" alt="">` : imgTag(row.name) || `<i class="ec-prod-cand-mark">${zone.mark}</i>`}
        <span class="ec-prod-cand-src">${esc(row.channel)}</span>
        <span class="ec-prod-cand-dur is-num">${row.duration ? `${row.duration}s` : esc(row.size)}</span>
        ${row.dup ? `<span class="ec-prod-cand-dup">${esc(dupText(row.dup))}</span>` : ''}
      </button>
      ${zone.key === 'video' ? `<span class="ec-prod-cand-cap"><strong title="${esc(row.name)}">${esc(row.name)}</strong></span>` : ''}
    </article>`;
  /* 归档区：视频与图片合在同一个块里，靠角标区分类型；索引仍按各自分区算 */
  const archiveStrip = (pool, locked, draft) => {
    const files = [
      ...pool.video.map((file, at) => ({ ...file, kind: 'video', at })),
      ...pool.image.map((file, at) => ({ ...file, kind: 'image', at })),
    ];
    return `<div class="ec-prod-pool">
      <span class="ec-prod-pool-label">${draft ? '已勾选' : '已归入'} ${files.length}</span>
      ${files.length ? files.map(file => `<span class="ec-prod-chip">${file.src ? `<img src="${esc(file.src)}" alt="">` : `<i>${file.kind === 'video' ? '▶' : '图'}</i>`}<em>${file.kind === 'video' ? '视频' : '图片'}</em><span title="${esc(file.name)}">${esc(file.from ? `${file.from} · ${file.name}` : file.name)}</span>${locked ? '' : `<button type="button" data-lp="remove-pool" data-zone="${file.kind}" data-index="${file.at}" aria-label="${draft ? '取消勾选' : '移出'} ${esc(file.name)}">×</button>`}</span>`).join('') : `<span class="ec-prod-hint">${draft ? '勾选左上角复选框先攒着，点「确认」才归档' : '勾选候选后点下面的「归入素材中心」'}</span>`}
    </div>`;
  };
  const crawlZone = (host, crawl, zone, locked) => {
    const data = crawl.zones[zone.key];
    const tried = Object.keys(data.attempts).length;
    const idle = !data.running && !data.paused;
    const canRun = !idle || (crawl.channels.length > 0 && Boolean(crawlBasis(host).name.trim()));
    /* 一个按钮走完状态循环 */
    const runLabel = data.running ? '■ 暂停爬取' : data.paused ? '▶ 继续爬取' : tried ? '⟳ 重新爬取' : '↓ 开始爬取';
    const emptyText = tried && !data.results.length
      ? `已重试仍未取到${zone.label}候选，可完善商品名称 / 类目后重试本区。`
      : `点右上按钮按所选渠道爬${zone.label}，候选只回填到这个区。`;
    return `<div class="ec-prod-zone ec-prod-zone--${zone.key}">
      <header><i>${zone.mark}</i><b>${zone.label}候选</b>${data.paused ? '<span class="ec-prod-badge ec-prod-badge--warn ec-prod-badge--plain">已暂停</span>' : ''}<span class="ec-prod-zone-count${data.results.length ? '' : ' is-zero'}">${data.results.length} 条</span>
        <button type="button" class="ec-prod-btn ec-prod-btn--sm${data.running ? '' : ' ec-prod-btn--collect'}" data-lp="run-zone" data-zone="${zone.key}"${canRun ? '' : ' disabled title="先填商品名称并至少选一个渠道"'}>${runLabel}</button>
      </header>
      <div class="ec-prod-zone-body${data.running && !data.results.length ? ' is-loading' : ''}">
        ${data.running && !data.results.length ? `<span class="ec-prod-spinner"></span><span>正在检索同类${zone.label}素材…</span>` : ''}
        ${!data.results.length && !data.running ? `<div class="ec-prod-zone-empty">${esc(emptyText)}</div>` : ''}
        ${data.results.length ? `<div class="ec-prod-zone-grid">${data.results.map((row, index) => candidateTile(row, index, zone)).join('')}</div>` : ''}
      </div>
      ${data.failed.length ? `<div class="ec-prod-zone-fail"><span><b>${esc(data.failed.join('、'))} 渠道未返回${zone.label}候选</b>${esc(data.failed.join('、'))} 反爬较重，本区已按「可用即通过」跳过；另一区不受影响。</span><button type="button" class="ec-prod-btn ec-prod-btn--sm" data-lp="retry-zone" data-zone="${zone.key}" ${data.running || data.paused ? 'disabled' : ''}>⟳ 重试本区</button></div>` : ''}
    </div>`;
  };
  /* 同一套面板，两种结构：录入弹窗＝勾选即归档（确认即入库，不放归入按钮）；
   * 商品详情＝勾选只是选中，必须点「↓ 归入素材中心」才入档 */
  const crawlPanel = host => {
    const crawl = crawlFor(host);
    const pool = poolFor(host);
    const locked = poolLocked(host);
    const basis = crawlBasis(host);
    const draft = isDraft(host);
    const kept = poolTotal(host);
    const picked = CRAWL_ZONES.reduce((sum, zone) => sum + crawl.zones[zone.key].results.filter(row => row.picked && !row.dup).length, 0);
    return `<div class="ec-prod-crawl" data-crawl-owner="${esc(host.id)}">
      <p class="ec-prod-crawl-top">素材正在爬取时，切走或关掉这个页面都不会中断，它会自己在后台跑完。</p>
      <div class="ec-prod-crawl-bar">
        <div class="ec-prod-channel" role="group" aria-label="爬取渠道"><span>渠道</span>${CRAWL_CHANNELS.map(ch => `<button type="button" class="${crawl.channels.includes(ch) ? 'active' : ''}" data-lp-channel="${ch}" aria-pressed="${crawl.channels.includes(ch)}">${ch}</button>`).join('')}</div>
        ${!basis.name.trim() ? '<span class="ec-prod-crawl-note is-warn">先填商品名称，爬取按名称 / 类目发起</span>' : `<span class="ec-prod-crawl-note">依据 <b>${esc(basis.name.trim().slice(0, 14))}</b>${basis.cat ? ` · <b>${esc(basis.cat)}</b>` : ''} 检索同类素材</span>`}
      </div>
      ${CRAWL_ZONES.map(zone => crawlZone(host, crawl, zone, locked)).join('')}
      ${archiveStrip(pool, locked, draft)}
      <div class="ec-prod-crawl-actions"><small>${locked ? '下面是在库素材，来自记录导入、暂无逐条留痕。' : draft ? '勾选＝先攒在下面这条「已勾选」里，点「确认」才真正归档进素材中心。重新爬取只刷新候选区，<b>已勾选的不会丢</b>。' : '重新爬取只刷新候选区，<b>已归入的不会丢</b>。'}</small>${!draft && picked ? `<button type="button" class="ec-prod-btn ec-prod-btn--sm ec-prod-btn--primary" data-lp="commit-crawl">↓ 归入素材中心 (${picked})</button>` : ''}</div>
    </div>`;
  };
  /* 放大查看：点候选卡的图/封面进来 */
  const lightbox = () => {
    const p = state.preview;
    if (!p) return '';
    return `<div class="ec-prod-backdrop" role="presentation"><div class="ec-prod-lightbox" role="dialog" aria-modal="true" aria-label="素材预览">
      <button type="button" data-lp="close-preview" aria-label="关闭">×</button>
      ${p.src ? `<img src="${esc(p.src)}" alt="${esc(p.name)}">` : '<div class="ec-prod-lightbox-empty">这条素材没有可显示的封面图</div>'}
      <p><b>${esc(p.name)}</b><span class="is-num">${esc(p.kind === 'video' ? '视频封面' : '图片')} · ${esc(p.channel || '')}${p.duration ? ` · ${p.duration}s` : ''}${p.size ? ` · ${esc(p.size)}` : ''} · ${p.picked ? '已归入素材中心' : '未归入'}</span></p>
    </div></div>`;
  };
  /* ---------- 爬取记录（只出现在「联网爬取」tab；带时间，详情只列已归入的素材） ---------- */
  const RECORD_STATUS = {
    running: { label: '进行中', tone: 'working' },
    paused: { label: '已暂停', tone: 'warn' },
    done: { label: '成功', tone: 'ok' },
    partial: { label: '部分成功', tone: 'warn' },
    failed: { label: '没抓到', tone: 'danger' },
  };
  const crawlRecords = host => {
    const rows = [...(host.crawls || [])].reverse();
    const head = `<header><b><i>⛰</i>爬取记录</b><small class="ec-prod-hint">${rows.length ? `共 ${rows.length} 次 · 详情只列勾选归入过的素材` : '每次联网爬取留一条，按时间倒排'}</small></header>`;
    if (!rows.length) {
      const legacy = poolTotal(host) || (host.materials?.video || 0) + (host.materials?.image || 0);
      return `<section class="ec-prod-records">${head}<p class="ec-prod-records-empty">${legacy
        ? '这条商品的素材是在「爬取记录」上线前入库的，没有留痕；下方候选区照常可以继续爬，新爬的每一次都会记录在这里。'
        : '还没有爬取过。选好渠道点「开始爬取」，这里会记下每次抓了多少、归入了哪些素材。'}</p></section>`;
    }
    return `<section class="ec-prod-records">${head}<ul>${rows.map(record => {
      const kept = [...record.video, ...record.image].filter(row => row.picked);
      const got = record.video.length + record.image.length;
      const meta = RECORD_STATUS[record.status] || RECORD_STATUS.running;
      return `<li class="ec-prod-record${open ? ' is-open' : ''}">
        <div class="ec-prod-record-head">
          <span class="ec-prod-record-when"><b>${esc(cnStamp(record.at))}</b>${record.status === 'running' ? '<span class="ec-prod-spinner" style="width:12px;height:12px;border-width:2px"></span>' : ''}</span>
          <span class="ec-prod-badge ec-prod-badge--${meta.tone} ec-prod-badge--plain">${meta.label}</span>
          <span class="ec-prod-record-note">渠道 ${esc(record.channel)} · 视频 ${record.video.length} / 图片 ${record.image.length}${record.failed.length ? ` · ${esc(record.failed.join('、'))} 未返回` : ''}</span>
          <span class="ec-prod-record-kept is-num">已归入 ${kept.length}</span>
          ${got ? `<a class="ec-prod-link" role="button" data-lp="toggle-record" data-record="${record.id}">查看详情</a>` : '<small class="ec-prod-hint">无素材</small>'}
        </div>
      </li>`;
    }).join('')}</ul></section>`;
  };
  /* 爬取详情的二级页：只铺这次勾选归入过的素材，样式跟基本信息的素材墙一致 */
  const recordView = () => {
    const item = find(state.detailId);
    const record = (item?.crawls || []).find(row => row.id === state.recordOpen);
    if (!record) return '';
    const kept = [...record.video.map(row => ({ ...row, kind: 'video' })), ...record.image.map(row => ({ ...row, kind: 'image' }))].filter(row => row.picked);
    return `<div class="ec-prod-backdrop" role="presentation"><div class="ec-prod-dialog ec-prod-dialog--slim" role="dialog" aria-modal="true" aria-label="爬取详情">
      <header><div><h2>爬取详情</h2><p>${esc(cnStamp(record.at))} · 渠道 ${esc(record.channel)} · 抓到 视频 ${record.video.length} / 图片 ${record.image.length} · 已归入 ${kept.length}${record.failed.length ? ` · ${esc(record.failed.join('、'))} 未返回` : ''}</p></div><button type="button" data-lp="close-record" aria-label="关闭">×</button></header>
      <div class="ec-prod-dialog-body">
        ${kept.length ? `<div class="ec-prod-media-grid">${kept.map(row => `<article class="ec-prod-media"><div class="ec-prod-media-frame">${row.src ? `<img src="${esc(row.src)}" alt="">` : ''}<span class="ec-prod-tag">${row.kind === 'video' ? '视频' : '图片'}</span>${row.kind === 'video' ? '<span class="ec-prod-play">▶</span>' : ''}${row.duration ? `<span class="ec-prod-dur is-num">00:${String(row.duration).padStart(2, '0')}</span>` : ''}</div><div class="ec-prod-media-body"><strong>${esc(row.name)}</strong><small>来源 ${esc(row.channel)} · 已归入素材中心</small></div></article>`).join('')}</div>` : '<p class="ec-prod-hint" style="padding:18px 0">这次抓到了素材，但还没勾选归入素材中心。</p>'}
      </div>
      <footer><span class="is-spacer"></span><button type="button" class="ec-prod-btn" data-lp="close-record">关闭</button></footer>
    </div></div>`;
  };
  /* ---------- 商品详情的两 tab 导航：爬取在跑时徽标挂在「联网爬取」上，切过去就能看到进度 ---------- */
  const panelTabs = item => {
    const running = crawlBusy(crawlFor(item));
    const tab = (key, label) => `<button type="button" role="tab" class="ec-prod-tab${state.detailPanel === key ? ' is-active' : ''}${key === 'crawl' && running ? ' is-running' : ''}" data-lp="panel" data-panel="${key}" aria-selected="${state.detailPanel === key}">${label}</button>`;
    return `<nav class="ec-prod-tabs" role="tablist">${tab('info', '基本信息')}${tab('crawl', '联网爬取')}</nav>`;
  };
  /* 只有「采集带回」那组必填；「自行设定」可以空着，缺的信息在详情里显示为 — */
  const missingField = d => [['快手商品ID', d.kuaishouId], ['商品名称', d.name], ['价格', d.price], ['佣金比例', d.comm]]
    .find(([, value]) => !String(value ?? '').trim())?.[0] || '';
  /* 输入框下方的自动建议（对齐淘宝搜索框习惯）：聚焦即出，边打边筛，点一条填进 ID */
  const historyRows = term => {
    const rows = [
      { ks: DEMO_KS_ID, label: DEMO_PROFILE.name },
      { ks: SLOW_KS_ID, label: SLOW_PROFILE.name },
      ...state.items.slice(0, 8).map(item => ({ ks: item.kuaishouId, label: item.name, price: item.price, materials: item.materials })),
    ];
    const q = String(term ?? '').trim().toLowerCase();
    return q ? rows.filter(row => `${row.ks} ${row.label}`.toLowerCase().includes(q)) : rows;
  };
  const historyList = () => {
    const field = state.draft.suggestField || 'kuaishouId';
    const rows = historyRows(state.draft[field]);
    if (!rows.length) return `<div class="ec-prod-suggest"><p class="ec-prod-suggest-empty">没有匹配的商品，直接填新 ID 后点「采集」。</p></div>`;
    return `<div class="ec-prod-suggest">
      <header><b>可选商品</b><small>点一条填进上方输入框</small></header>
      <ul>${rows.map(row => `<li><button type="button" data-lp="pick-history" data-ks="${esc(row.ks)}" data-label="${esc(row.label)}">
        <strong title="${esc(row.label)}">${esc(row.label)}</strong>
        <small>快手ID ${esc(row.ks)}${row.price != null ? ` · 到手 ${money(row.price)}` : ''}${row.materials ? ` · ${row.materials.video}视 / ${row.materials.image}图` : ''}</small>
      </button></li>`).join('')}</ul>
    </div>`;
  };
  /* 基本信息表单 = 录入弹窗的「基本信息」tab */
  const entryForm = () => {
    const d = state.draft;
    const option = (value, label) => `<option value="${esc(value)}"${value === d.cat ? ' selected' : ''}>${esc(label)}</option>`;
    return `<section class="ec-prod-form-section">
          <header><b><i>1</i>基本信息</b></header>
          <div class="ec-prod-form-section-body">
            <div class="ec-prod-group">
              <header><b>采集带回</b></header>
              <div class="ec-prod-group-body">
                <div class="ec-prod-row"><div class="ec-prod-row-head"><label for="lpKsId">快手商品ID</label></div>
                  <div class="ec-prod-ksbox">
                    <div class="ec-prod-inline"><input id="lpKsId" class="ec-prod-control is-num" value="${esc(d.kuaishouId)}" data-lp-draft="kuaishouId" placeholder="输入或点选快手商品ID" autocomplete="off"><button type="button" class="ec-prod-btn ec-prod-btn--collect" data-lp="collect"${d.collecting ? ' disabled' : ''}>${d.collecting ? '<span class="ec-prod-spinner" style="width:14px;height:14px;border-width:2px"></span> 采集中' : '↓ 采集'}</button></div>
                    ${d.suggestField === 'kuaishouId' ? historyList() : ''}
                  </div>
                </div>
                <div class="ec-prod-row"><div class="ec-prod-row-head"><label for="lpName">商品名称</label></div>
                  <div class="ec-prod-ksbox">
                    <input id="lpName" class="ec-prod-control" value="${esc(d.name)}" data-lp-draft="name" placeholder="商品名称，爬取按它检索同类素材" autocomplete="off">
                    ${d.suggestField === 'name' ? historyList() : ''}
                  </div>
                </div>
                <div class="ec-prod-row ec-prod-row--split">
                  <div><div class="ec-prod-row-head"><label for="lpPrice">价格（元）</label></div><input id="lpPrice" class="ec-prod-control is-num" type="number" min="0" max="99999" step="0.01" value="${esc(d.price)}" data-lp-draft="price" placeholder="0.00"></div>
                  <div><div class="ec-prod-row-head"><label for="lpComm">佣金比例（%）</label></div><input id="lpComm" class="ec-prod-control is-num" type="number" min="0" max="100" value="${esc(d.comm)}" data-lp-draft="comm" placeholder="如 15"></div>
                </div>
              </div>
            </div>
            <div class="ec-prod-group ec-prod-group--own">
              <header><b>自行设定</b></header>
              <div class="ec-prod-group-body">
                <div class="ec-prod-row"><div class="ec-prod-row-head"><label>所属平台</label></div><div class="ec-prod-seg" role="group" aria-label="所属平台">${PLATFORMS.map(p => `<button type="button" class="${d.platform === p ? 'active' : ''}" data-lp-draft="platform" data-value="${p}" aria-pressed="${d.platform === p}">${p}</button>`).join('')}</div></div>
                <div class="ec-prod-row ec-prod-row--split">
                  <div><div class="ec-prod-row-head"><label for="lpSpec">规格</label></div><input id="lpSpec" class="ec-prod-control" value="${esc(d.spec)}" data-lp-draft="spec" placeholder="如 41-46码 / 双"></div>
                  <div><div class="ec-prod-row-head"><label for="lpCatSel">类目</label></div><select id="lpCatSel" class="ec-prod-control" data-lp-draft="cat"><option value="">请选择类目</option>${CATEGORIES.map(c => option(c, c)).join('')}</select></div>
                </div>
                <div class="ec-prod-row"><div class="ec-prod-row-head"><label for="lpNeg">负面词汇</label></div><textarea id="lpNeg" class="ec-prod-control" style="min-height:64px" data-lp-draft="negatives" placeholder="生成时要规避的词，用逗号分隔">${esc(d.negatives)}</textarea></div>
              </div>
            </div>
          </div>
        </section>`;
  };
  /* 联网爬取：录入弹窗里是右列，详情页里是「联网爬取」tab（多一块爬取记录） */
  const crawlTab = host => `<section class="ec-prod-form-section">
      <header><b><i>2</i>联网爬取</b><small class="ec-prod-hint">${isDraft(host) ? '视频、图片分开爬，各自一个按钮；勾左上角复选框即归档' : '每次爬取都留记录，可回看这次归入了哪些素材'}</small></header>
      <div class="ec-prod-form-section-body">
        ${crawlPanel(host)}
        ${isDraft(host) ? '' : crawlRecords(host)}
      </div>
    </section>`;
  const entryDialog = () => {
    const d = state.draft;
    return `<div class="ec-prod-backdrop" role="presentation"><div class="ec-prod-dialog" role="dialog" aria-modal="true" aria-labelledby="lpEntryTitle">
      <header><div><h2 id="lpEntryTitle">录入商品</h2><p>第一步点「采集」：拉回资料并爬回同类商品图片；第二步点各区按钮爬视频 / 图片。勾选的才进「已勾选」，点「确认」才归档入库，没爬完也接着爬。</p></div><button type="button" data-lp="leave-entry" aria-label="关闭">×</button></header>
      <div class="ec-prod-dialog-body"><div class="ec-prod-form-grid">${entryForm()}${crawlTab(d)}</div></div>
      <footer>
        <div class="ec-prod-tally"><span>▶ 视频: <b>${d.pool.video.length}</b></span><span>⛰ 图片: <b>${d.pool.image.length}</b></span></div>
        <span class="is-spacer"></span>
        <button type="button" class="ec-prod-btn" data-lp="leave-entry">取消</button>
        <button type="button" class="ec-prod-btn ec-prod-btn--primary" data-lp="submit-entry">✓ 确认</button>
      </footer>
    </div></div>`;
  };
  /* ---------- 商品详情子页（PRD §4.4-②） ---------- */
  const mediaFiles = (item, kind) => {
    const stored = item.assets?.[kind];
    if (stored?.length) return stored.map(file => ({ name: file.name, duration: file.duration ? Math.round(Number(file.duration)) : null, size: file.size, src: file.src || imgOf(file.name), from: file.from }));
    return Array.from({ length: kind === 'video' ? item.materials.video : item.materials.image }, (_, i) => ({
      name: `${kind === 'video' ? '视频素材' : '图片素材'} ${i + 1}`, duration: kind === 'video' ? 10 : null,
      src: imgOf(`${item.id}-${kind}-${i}`),
    }));
  };
  /* 基本信息里的素材墙 = 爬到的全部（含没归入的）＋ 详情页增补进来的本地素材 */
  const crawledOf = (item, kind) => {
    const stored = item.assets?.[kind] || [];
    const pooled = new Set(stored.map(file => file.name));
    const seen = new Map();
    (item.crawls || []).forEach(record => (record[kind] || []).forEach(row => { if (!seen.has(row.name)) seen.set(row.name, row); }));
    (liveCrawls.get(item.id)?.zones?.[kind]?.results || []).forEach(row => { if (!seen.has(row.name)) seen.set(row.name, row); });
    stored.forEach(file => { if (!seen.has(file.name)) seen.set(file.name, file); });
    const rows = [...seen.values()].map(row => ({
      name: row.name, src: row.src || imgOf(row.name), duration: row.duration || null,
      origin: row.channel || row.from || '联网爬取', inPool: pooled.has(row.name) || Boolean(row.picked),
    }));
    return rows.length ? rows : mediaFiles(item, kind).map(file => ({ ...file, origin: file.from || '联网爬取', inPool: true }));
  };
  const mediaCard = (kind, row) => `<article class="ec-prod-media">
      <div class="ec-prod-media-frame">${row.src ? `<img src="${esc(row.src)}" alt="">` : ''}<span class="ec-prod-tag">${!row.inPool ? '未归入' : kind === 'video' ? '常规' : '图片'}</span>${kind === 'video' ? '<span class="ec-prod-play">▶</span>' : ''}${row.duration ? `<span class="ec-prod-dur is-num">00:${String(row.duration).padStart(2, '0')}</span>` : ''}</div>
      <div class="ec-prod-media-body"><strong>${esc(row.name)}</strong><small>来源 ${esc(row.origin)} · ${row.inPool ? '已归入素材中心' : '未归入，只在候选区'}</small></div>
    </article>`;
  /* 增补本地素材：列表行右侧蓝链进来的二级窗口，与联网爬取彻底分开 */
  const supplementView = () => {
    const item = find(state.supplementId);
    if (!item) return '';
    const zone = (kind, mark, title, hint, accept) => `<label class="ec-prod-upzone ec-prod-upzone--${kind}" data-drop="${kind}" data-id="${item.id}">
        <i aria-hidden="true">${mark}</i><b>上传${title}</b>
        <span>${hint}</span><small>点击选择，或把文件拖到这里</small>
        <input type="file" accept="${accept}" multiple data-lp-append="${kind}" hidden>
      </label>`;
    const local = key => (item.assets?.[key] || []).map((file, at) => ({ ...file, key, at })).filter(file => file.from === '本地增补');
    return `<div class="ec-prod-backdrop" role="presentation"><div class="ec-prod-dialog ec-prod-dialog--slim" role="dialog" aria-modal="true" aria-labelledby="lpUpTitle">
      <header><div><h2 id="lpUpTitle">增补本地素材</h2><p>${esc(item.name)} · 文件只在本机读取，不发往任何服务端；增补进来的标「本地增补」，参与生成装配</p></div><button type="button" data-lp="close-supplement" aria-label="关闭">×</button></header>
      <div class="ec-prod-dialog-body">
        <div class="ec-prod-up-grid">
          ${zone('video', '▶', '视频', `支持 MP4、MOV · 单个不超过 1GB · 已增补 ${local('video').length} 个`, 'video/*')}
          ${zone('image', '⛰', '图片', `支持 JPG、PNG、GIF · 单个不超过 50MB · 已增补 ${local('image').length} 个`, 'image/*')}
        </div>
        ${[...local('video'), ...local('image')].length ? `<div class="ec-prod-local"><b>已增补 ${[...local('video'), ...local('image')].length} 个</b><ul>${[...local('video'), ...local('image')].map(row => `<li><i>${row.key === 'video' ? '▶' : '图'}</i><span><strong title="${esc(row.name)}">${esc(row.name)}</strong><small class="is-num">${esc(row.size || '')} · 本地增补</small></span><button type="button" data-lp="remove-local" data-id="${item.id}" data-kind="${row.key}" data-index="${row.at}" aria-label="移出 ${esc(row.name)}">×</button></li>`).join('')}</ul></div>` : '<p class="ec-prod-hint" style="padding:14px 0 0">还没有增补过本地素材。</p>'}
      </div>
      <footer><span class="is-spacer"></span><button type="button" class="ec-prod-btn" data-lp="close-supplement">关闭</button></footer>
    </div></div>`;
  };
  /* 基本信息 tab（详情侧）：已获取的资料留存不动 ＋ 联网爬到的素材全铺在这（不标归入时间） */
  const detailInfo = (item, missing) => `<div class="ec-prod-detail-top">
        <section class="ec-prod-hero">
          <div class="ec-prod-hero-media"><span class="ec-prod-thumb" style="width:100%;height:100%;border:0;border-radius:0">${productImage(item, item.materials.main ? '商品主图' : '暂无主图')}</span>${item.assets?.main?.[0]?.src ? '<em>采集主图</em>' : window.EcommerceVideoProductImages?.get(item) ? '<em>相似商品示意图</em>' : item.materials.main ? '<em>商品主图</em>' : ''}</div>
        </section>
        <section>
          <div class="ec-prod-split-label"><i>1</i>商品资料</div>
          <dl class="ec-prod-info">
            <div class="ec-prod-info-row"><dt>商品名称</dt><dd>${esc(item.name)}</dd></div>
            <div class="ec-prod-info-row"><dt>价格 · 规格</dt><dd><span class="ec-prod-price is-num">${money(item.price)}</span> · ${esc(item.spec || '—')}</dd></div>
            <div class="ec-prod-info-row"><dt>佣金 · 类目</dt><dd class="is-num">${pct(item.comm)}（预估 ${money(item.cma)}） · <span class="ec-prod-cat">${esc(item.cat || '未分类')}</span></dd></div>
            <div class="ec-prod-info-row"><dt>快手商品ID</dt><dd class="is-num">${esc(item.kuaishouId || '—')} · ${esc(item.platform)}</dd></div>
            <div class="ec-prod-info-row"><dt>素材状态</dt><dd>${badge(item.status)} <span class="ec-prod-hint is-num">生成 ${item.gen} 次 · 更新 ${esc(item.updated)}</span></dd></div>
          </dl>
          <div class="ec-prod-split-label" style="margin-top:16px"><i>✦</i>商品亮点</div>
          <p class="ec-prod-highlight">${item.highlight ? esc(item.highlight) : '尚未填写商品亮点，生成时黑段缺少卖点依据。'}</p>
          ${item.negatives ? `<div class="ec-prod-split-label" style="margin-top:14px"><i>!</i>负面词汇（生成时规避）</div><p class="ec-prod-highlight">${esc(item.negatives)}</p>` : ''}
          ${item.status === 'ready' && missing.length ? `<div class="ec-prod-gap"><strong>黑段素材缺失清单</strong><ul>${missing.map(s => `<li>${esc(s.label)}</li>`).join('')}</ul></div>` : ''}
        </section>
      </div>
      ${['video', 'image'].map(kind => {
        const list = crawledOf(item, kind);
        return `<section class="ec-prod-media-group">
        <header><i>${kind === 'video' ? '▶' : '⛰'}</i><b>${kind === 'video' ? '视频素材' : '图片素材'} <span>(${list.length})</span></b><small class="ec-prod-hint">联网爬到的都在这 · 已归入 ${list.filter(row => row.inPool).length}</small></header>
        ${list.length ? `<div class="ec-prod-media-grid${kind === 'video' ? ' ec-prod-media-grid--video' : ''}">${list.map(row => mediaCard(kind, row)).join('')}</div>` : `<div class="ec-prod-hint" style="padding:18px 0">还没有${kind === 'video' ? '视频' : '图片'}素材${kind === 'video' ? '，黑段将回退默认组合' : ''}；到「联网爬取」tab 再爬一次补齐。</div>`}
      </section>`;
      }).join('')}`;
  /* 离开录入前的确认：文案照产品要求，确认后就关页面 + 提示保存成功 */
  const leaveDialog = () => (state.leaveConfirm ? `<div class="ec-prod-backdrop" role="presentation"><div class="ec-prod-dialog ec-prod-dialog--slim" role="alertdialog" aria-modal="true" aria-labelledby="lpLeaveTitle">
      <header><div><h2 id="lpLeaveTitle">离开录入</h2></div><button type="button" data-lp="stay" aria-label="关闭">×</button></header>
      <div class="ec-prod-leave-body"><p>您确定离开此页面吗？您所有操作将不被保存</p>${state.leaveConfirm.running ? '<p class="ec-prod-hint">还有素材正在爬，离开后这次爬到的不会保留。</p>' : ''}</div>
      <footer><span class="is-spacer"></span><button type="button" class="ec-prod-btn" data-lp="stay">继续编辑</button><button type="button" class="ec-prod-btn ec-prod-btn--primary" data-lp="leave-yes">确认</button></footer>
    </div></div>` : '');
  /* 商品详情：两 tab（基本信息 / 联网爬取），联网爬取这侧只给重新爬取 ＋ 爬取记录 */
  const detailView = () => {
    const item = find(state.detailId);
    if (!item) return '';
    return `<div class="ec-prod-detail">
      ${panelTabs(item)}
      ${state.detailPanel === 'info' ? detailInfo(item, missingSlots(item)) : crawlTab(item)}
      <div class="ec-prod-detail-footer">
        <button type="button" class="ec-prod-btn" data-lp="close-detail">关闭</button>
      </div>
    </div>`;
  };
  /* ---------- 主渲染 ---------- */
  const head = () => `<div class="ec-prod-head"><div><h1>商品获取</h1><p>工作流第 1 步：录入商品资料 + 联网爬取素材；点击商品行进入详情查看资料与素材。</p></div>
    <div class="ec-prod-head-actions"><span class="ec-prod-count is-num">共 ${state.items.length} 个商品 · 素材就绪 ${state.items.filter(i => i.status === 'ready').length}</span><button type="button" class="ec-prod-btn ec-prod-btn--primary" data-lp="open-entry">＋ 录入商品</button></div></div>`;
  const body = () => {
    const rows = filtered();
    return `<div class="ec-video-products-scroll"><div class="ec-video-products-inner">
      ${state.detailId ? detailView() : `${head()}${filterCard()}
      <div class="ec-prod-card"><div class="ec-prod-card-body">${rows.length ? table(rows) : emptyState()}${gapNotice()}</div></div>`}
    </div></div>
    ${state.dialog === 'entry' ? entryDialog() : ''}
    ${leaveDialog()}
    ${state.supplementId ? supplementView() : ''}
    ${state.preview ? lightbox() : ''}
    ${state.recordOpen ? recordView() : ''}`;
  };
  const html = () => `<main class="ec-video-products" aria-label="商品获取${state.detailId ? ' · 商品详情' : ''}">${body()}</main>`;
  const onDragOver = event => {
    const zone = event.target.closest?.('[data-drop]');
    if (!zone) return;
    event.preventDefault();
    zone.classList.add('is-drag');
  };
  const onDragLeave = event => { event.target.closest?.('[data-drop]')?.classList.remove('is-drag'); };
  const onDrop = event => {
    const zone = event.target.closest?.('[data-drop]');
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove('is-drag');
    ingestFiles(zone.dataset.drop, find(zone.dataset.id), event.dataTransfer?.files);
  };
  const bind = root => {
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', onDragLeave);
    root.addEventListener('drop', onDrop);
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
  /* 重绘但保住焦点与光标位置（输入框下方的建议列表需要即时展开/收起） */
  const paintKeepingFocus = () => {
    const focusKey = document.activeElement?.id || null;
    const caret = focusKey ? document.getElementById(focusKey)?.selectionStart ?? null : null;
    paint();
    if (!focusKey) return;
    const next = document.getElementById(focusKey);
    if (!next) return;
    next.focus();
    if (caret !== null && next.setSelectionRange) { try { next.setSelectionRange(caret, caret); } catch { /* 部分输入类型不支持光标定位 */ } }
  };
  const dismissTop = () => {
    if (state.leaveConfirm) { state.leaveConfirm = null; return paint(); }
    if (state.preview) { state.preview = null; return paint(); }
    if (state.supplementId) { state.supplementId = null; return paint(); }
    if (state.recordOpen) { state.recordOpen = null; return paint(); }
    if (state.dialog) { const dropped = state.draft; state.dialog = null; state.draft = null; if (dropped) liveCrawls.delete(dropped.id); return paint(); }
    if (state.detailId) { state.detailId = null; return paint(); }
  };
  /* ---------- 爬取行为（PRD §4.7）：录入弹窗与商品详情共用同一套面板，只是宿主不同 ---------- */
  const newDraft = () => ({
    id: uid('draft'),
    kuaishouId: '', name: '', platform: '快手', price: '', spec: '', comm: '', cat: '', highlight: '', negatives: '',
    pool: { main: [], video: [], image: [] }, crawls: [],
    collecting: false, suggestField: null,
  });
  const isDraft = host => host === state.draft;
  /* 弹窗草稿与已入库商品都能发起爬取；爬取运行时（含 Set）只活在内存，确认入库时从草稿过户到商品 */
  const liveCrawls = new Map();
  const crawlHost = () => state.draft || (state.detailId ? find(state.detailId) : null);
  const crawlFor = host => {
    if (!host) return null;
    if (!liveCrawls.has(host.id)) liveCrawls.set(host.id, newCrawl());
    return liveCrawls.get(host.id);
  };
  const crawlAlive = crawl => [...liveCrawls.values()].includes(crawl);
  /* 确认后爬取过户给商品：按 crawl 对象找现在的宿主，谁在跑就写谁的记录 */
  const ownerOf = crawl => state.items.find(row => liveCrawls.get(row.id) === crawl) || null;
  /* 素材中心（原「素材池」）：草稿用 pool，商品用 assets；老商品没有 assets 时按材料数给只读占位 */
  const poolFor = host => (isDraft(host)
    ? host.pool
    : host.assets || { main: [], video: mediaFiles(host, 'video'), image: mediaFiles(host, 'image') });
  const poolLocked = host => !isDraft(host) && !host.assets;
  /* 商品第一次真正归入素材时，把老的「按数量合成」素材落成实名文件，保证前后连续、计数不再造假 */
  const ensureAssets = item => {
    if (!item.assets) item.assets = { main: [], video: mediaFiles(item, 'video'), image: mediaFiles(item, 'image') };
    return item.assets;
  };
  const syncMaterials = item => {
    const usable = key => item.assets[key].length;
    item.materials = { ...item.materials, video: usable('video'), image: usable('image') };
  };
  const crawlBasis = host => ({ name: host?.name || '', cat: host?.cat || '' });
  const poolNames = host => new Set(['main', 'video', 'image'].flatMap(key => (poolFor(host)[key] || []).map(file => file.name)));
  /* 「已归入」只数两个素材分区（采集主图不算爬取归入），避免与分区计数对不上 */
  const poolTotal = host => {
    const source = host ? poolFor(host) : {};
    return (source.video?.length || 0) + (source.image?.length || 0);
  };
  const stamp = () => {
    const d = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const cnStamp = at => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})(\s.*)?$/.exec(String(at || '')) || [];
    return `${Number(parts[2]) || parts[2]}月${Number(parts[3]) || parts[3]}日${(parts[4] || '').trim()}`;
  };
  /* 一次爬取 = 一条记录：视频/图片各记自己抓到的条目，归入时回写 picked，随商品持久化 */
  const openRecord = (host, channels, zoneKeys) => {
    const record = { id: uid('cr'), at: stamp(), channel: channels.join(' · '), status: 'running', pending: zoneKeys.length, video: [], image: [], failed: [] };
    if (!host.crawls) host.crawls = [];
    host.crawls.push(record);
    return record;
  };
  const settleRecord = record => {
    record.pending = Math.max(0, record.pending - 1);
    if (record.pending) return;
    record.status = !record.video.length && !record.image.length ? 'failed' : record.failed.length ? 'partial' : 'done';
  };
  const markPicked = (host, names, value = true) => (host.crawls || []).forEach(record => ['video', 'image']
    .forEach(key => record[key].forEach(row => { if (names.has(row.name)) row.picked = value; })));
  const zoneMeta = key => CRAWL_ZONES.find(item => item.key === key);
  /* 流式回填只往分区里追加新卡片，不整块重绘 —— 整块重绘会让弹窗一闪一闪
     宿主 id 决定作用范围：弹窗草稿与某个商品的爬取同时在跑时，不能把卡片插进对方的分区 */
  const idOf = crawl => [...liveCrawls.entries()].find(([, value]) => value === crawl)?.[0] || '';
  const panelRoot = crawl => document.querySelector(`[data-crawl-owner="${idOf(crawl)}"]`);
  const appendCandidate = (crawl, zoneKey) => {
    const data = crawl.zones[zoneKey];
    const root = panelRoot(crawl);
    const host = root?.querySelector(`.ec-prod-zone--${zoneKey} .ec-prod-zone-body`);
    if (!data?.results.length || !host) return false;
    let grid = host.querySelector('.ec-prod-zone-grid');
    if (!grid) {
      host.querySelector('.ec-prod-zone-empty')?.remove();
      grid = document.createElement('div');
      grid.className = 'ec-prod-zone-grid';
      host.append(grid);
    }
    const index = data.results.length - 1;
    grid.insertAdjacentHTML('beforeend', candidateTile(data.results[index], index, zoneMeta(zoneKey)));
    const count = host.parentElement.querySelector('.ec-prod-zone-count');
    if (count) { count.textContent = `${data.results.length} 条候选`; count.classList.remove('is-zero'); }
    return true;
  };
  /* 爬取面板不在屏上（切走 tab、或已确认入库回到列表）时不整屏重绘，只把 tab 上的「爬取中」徽标摘掉 */
  const refreshCrawlView = crawl => {
    if (panelRoot(crawl)) { paintKeepingFocus(); return; }
    const tab = document.querySelector('.ec-prod-tab[data-panel="crawl"]');
    if (tab) tab.classList.toggle('is-running', crawlBusy(crawl));
  };
  /* 一条候选落地：失败渠道记一笔，或进候选区（已归档过的直接跳过，不摆进候选） */
  const applyEntry = (host, crawl, zoneKey, entry) => {
    const zone = crawl.zones[zoneKey];
    const record = zone.record;
    if (entry.failed) {
      if (!zone.failed.includes(entry.channel)) zone.failed.push(entry.channel);
      if (record && !record.failed.includes(entry.channel)) record.failed.push(entry.channel);
      refreshCrawlView(crawl);
      return;
    }
    if (crawl.taken.has(entry.row.name)) return;
    const dup = zone.results.some(item => item.name === entry.row.name) ? 'seen' : false;
    const row = { ...entry.row, channel: entry.channel, picked: false, dup };
    zone.results.push(row);
    record?.[zoneKey].push({ name: row.name, kind: zoneKey, channel: entry.channel, src: row.src || '', size: row.size, duration: row.duration || null, dup, picked: false });
    if (!appendCandidate(crawl, zoneKey)) refreshCrawlView(crawl);
  };
  const finishZone = (host, crawl, zoneKey) => {
    const zone = crawl.zones[zoneKey];
    if (!zone.running) return;
    zone.running = false;
    zone.plan = [];
    zone.cursor = 0;
    if (zone.record) {
      crawl.open.delete(zone.record);
      settleRecord(zone.record);
      zone.record = null;
      const owner = ownerOf(crawl);
      if (owner) {
        owner.updated = today();
        if (!crawlBusy(crawl)) owner.status = poolTotal(owner) ? 'ready' : 'pending';
        persist();
      }
    }
    refreshCrawlView(crawl);
  };
  /* 排队式推进：一次只排下一条。暂停＝不再排下一条，继续＝从断点接着排；已回填的候选一律不动 */
  const pumpZone = (host, crawl, zoneKey) => {
    const zone = crawl.zones[zoneKey];
    if (!crawlAlive(crawl) || crawl.epoch !== zone.epoch || zone.paused || !zone.running) return;
    if (zone.cursor >= zone.plan.length) { later(() => finishZone(host, crawl, zoneKey), 600); return; }
    const entry = zone.plan[zone.cursor];
    const wait = zone.pace(zone.cursor);
    zone.cursor += 1;
    later(() => {
      if (!crawlAlive(crawl) || crawl.epoch !== zone.epoch || zone.paused || !zone.running) return;
      applyEntry(host, crawl, zoneKey, entry);
      pumpZone(host, crawl, zoneKey);
    }, wait);
  };
  const startZone = (host, crawl, zoneKey, channels, record, append) => {
    const zone = crawl.zones[zoneKey];
    const plan = [];
    channels.forEach(channel => {
      const tried = zone.attempts[channel] || 0;
      zone.attempts[channel] = tried + 1;
      if (crawlFails(zoneKey, channel, tried)) { plan.push({ channel, failed: true }); return; }
      zoneBank(zoneKey, channel, host.kuaishouId?.trim()).forEach(row => plan.push({ channel, row }));
    });
    zone.plan = append ? [...zone.plan, ...plan] : plan;
    if (!append) zone.cursor = 0;
    zone.paused = false;
    zone.running = true;
    zone.epoch = crawl.epoch || 0;
    zone.pace = paceOf(host.kuaishouId?.trim());
    if (record) { zone.record = record; crawl.open.add(record); }
    pumpZone(host, crawl, zoneKey);
  };
  /* 区头那一个按钮走完整个循环：开始爬取 → 暂停爬取 → 继续爬取 →（跑完）重新爬取 */
  const tapZone = (host, zoneKey) => {
    const crawl = crawlFor(host);
    const zone = crawl?.zones[zoneKey];
    if (!zone) return;
    if (zone.running) {
      zone.running = false;
      zone.paused = true;
      if (zone.record) zone.record.status = 'paused';
      paintKeepingFocus();
      toast(`已暂停爬取${zoneMeta(zoneKey).label}：已回来的 ${zone.results.length} 条候选还在，点「继续爬取」接着跑`);
      return;
    }
    if (zone.paused) {
      zone.paused = false;
      zone.running = true;
      if (zone.record) zone.record.status = 'running';
      pumpZone(host, crawl, zoneKey);
      paintKeepingFocus();
      return;
    }
    if (!crawl.channels.length || !crawlBasis(host).name.trim()) return;
    const kept = poolTotal(host);
    zone.results = [];
    zone.failed = [];
    crawl.taken = poolNames(host);
    startZone(host, crawl, zoneKey, [...crawl.channels], openRecord(host, crawl.channels, [zoneKey]), false);
    paintKeepingFocus();
    if (kept) toast(`重新爬取：只刷新候选区，${isDraft(host) ? '已勾选' : '已归档'}的 ${kept} 个不动`);
  };
  /* 勾选＝把候选放进下面这条篮子（弹窗＝已勾选，详情＝待归入）；取消勾选是同一个动作的反向 */
  const takeRow = (host, pool, zoneKey, row) => {
    pool[zoneMeta(zoneKey).card].push({ name: row.name, src: row.src || imgOf(row.name), from: row.channel, size: row.size, duration: row.duration });
    row.picked = true;
    markPicked(host, new Set([row.name]));
  };
  const dropRow = (host, pool, zoneKey, row) => {
    const card = zoneMeta(zoneKey).card;
    const at = pool[card].findIndex(file => file.name === row.name);
    if (at >= 0) pool[card].splice(at, 1);
    row.picked = false;
    markPicked(host, new Set([row.name]), false);
  };
  /* 商品详情那侧专用：把勾选的候选归入素材中心（弹窗那侧勾了就算，不走这里） */
  const commitPicked = host => {
    const crawl = crawlFor(host);
    const pool = ensureAssets(host);
    const moved = { video: 0, image: 0 };
    CRAWL_ZONES.forEach(zone => {
      const card = zoneMeta(zone.key).card;
      crawl.zones[zone.key].results.forEach(row => {
        if (!row.picked || row.dup || pool[card].some(file => file.name === row.name)) return;
        takeRow(host, pool, zone.key, row);
        moved[zone.key] += 1;
      });
    });
    syncMaterials(host);
    host.updated = today();
    persist(); paint();
    toast(moved.video || moved.image ? `已归入素材中心 ✓ 视频 +${moved.video} · 图片 +${moved.image}` : '勾选的候选都已经在素材中心了');
  };
  const retryZone = (host, zoneKey) => {
    const crawl = crawlFor(host);
    const zone = crawl?.zones[zoneKey];
    if (!zone || zone.running || zone.paused || !zone.failed.length) return;
    const channels = [...zone.failed];
    startZone(host, crawl, zoneKey, channels, openRecord(host, channels, [zoneKey]), true);
    paintKeepingFocus();
    toast(`正在重试 ${channels.join('、')} 的${zoneKey === 'video' ? '视频' : '图片'}候选…`);
  };
  const onClick = event => {
    /* 只有点在遮罩本体上才关闭；弹窗内部点击不得冒泡成关闭 */
    const backdrop = event.target.closest('.ec-prod-backdrop');
    if (backdrop && event.target === backdrop) { dismissTop(); return; }
    /* 点到输入框区域之外，收起 ID 建议列表 */
    if (state.draft?.suggestField && !event.target.closest('.ec-prod-ksbox')) { state.draft.suggestField = null; paint(); }
    /* 渠道开关只带 data-lp-channel，必须在 [data-lp] 兜底之前拦截 */
    const channelBtn = event.target.closest('[data-lp-channel]');
    if (channelBtn) {
      const host = crawlHost();
      const crawl = crawlFor(host);
      if (!host) return;
      const name = channelBtn.dataset.lpChannel;
      crawl.channels = crawl.channels.includes(name) ? crawl.channels.filter(c => c !== name) : [...crawl.channels, name];
      return paint();
    }
    const trigger = event.target.closest('[data-lp]');
    if (!trigger) return;
    const action = trigger.dataset.lp;
    const id = trigger.dataset.id;
    const item = id ? find(id) : null;
    const host = crawlHost();
    /* 详情的两 tab 切换 */
    if (action === 'panel') {
      state.detailPanel = trigger.dataset.panel;
      return paint();
    }
    if (action === 'toggle-record') { state.recordOpen = trigger.dataset.record; return paint(); }
    if (action === 'close-record') { state.recordOpen = null; return paint(); }
    if (action === 'open-supplement') { state.supplementId = id; return paint(); }
    if (action === 'close-supplement') { state.supplementId = null; return paint(); }
    if (action === 'remove-local') {
      if (!item) return;
      const kind = trigger.dataset.kind;
      const at = Number(trigger.dataset.index);
      if (item.assets?.[kind]?.[at]?.from !== '本地增补') return;
      item.assets[kind].splice(at, 1);
      syncMaterials(item);
      item.updated = today();
      persist(); paint();
      toast('已移出这个本地增补素材');
      return;
    }
    if (action === 'pick') {
      const crawl = crawlFor(host);
      const zoneKey = trigger.dataset.zone;
      const row = crawl?.zones[zoneKey]?.results[Number(trigger.dataset.index)];
      if (!row || row.dup) return;
      row.picked = !row.picked;
      /* 弹窗里勾选＝攒进「已勾选」，点确认才归档入库；详情里勾选只是选中，要点「归入素材中心」才算 */
      if (isDraft(host)) {
        if (row.picked) takeRow(host, host.pool, zoneKey, row); else dropRow(host, host.pool, zoneKey, row);
      } else {
        markPicked(host, new Set([row.name]), row.picked);
      }
      return paint();
    }
    if (action === 'commit-crawl') { commitPicked(host); return; }
    if (action === 'remove-pool') {
      const zoneKey = trigger.dataset.zone;
      poolFor(host)[zoneKey].splice(Number(trigger.dataset.index), 1);
      if (!isDraft(host)) { syncMaterials(host); host.updated = today(); persist(); }
      return paint();
    }
    if (action === 'pick-history') {
      const draft = state.draft;
      if (draft.suggestField === 'name') draft.name = trigger.dataset.label; else draft.kuaishouId = trigger.dataset.ks;
      draft.suggestField = null;
      return paint();
    }
    if (action === 'run-zone') { tapZone(host, trigger.dataset.zone); return; }
    if (action === 'retry-zone') { retryZone(host, trigger.dataset.zone); return; }
    if (action === 'preview') {
      const row = crawlFor(host)?.zones[trigger.dataset.zone]?.results[Number(trigger.dataset.index)];
      if (!row) return;
      state.preview = { name: row.name, src: row.src || '', kind: trigger.dataset.zone, channel: row.channel, duration: row.duration, size: row.size, picked: row.picked };
      return paint();
    }
    if (action === 'close-preview') { state.preview = null; return paint(); }
    if (action === 'reset-filters') { state.filters = blankFilters(); paint(); return; }
    if (action === 'run-search') { paint(); toast(`匹配 ${filtered().length} / ${state.items.length} 个商品`); return; }
    if (action === 'open-entry') { state.draft = newDraft(); state.dialog = 'entry'; paint(); return; }
    if (action === 'leave-entry') { state.leaveConfirm = { running: crawlBusy(crawlFor(state.draft)) }; return paint(); }
    if (action === 'stay') { state.leaveConfirm = null; return paint(); }
    if (action === 'leave-yes') {
      const dropped = state.draft;
      state.leaveConfirm = null; state.dialog = null; state.draft = null;
      if (dropped) liveCrawls.delete(dropped.id);
      paint(); toast('保存成功');
      return;
    }
    if (action === 'dismiss-entry') {
      const dropped = state.draft;
      const had = dropped && (poolTotal(dropped) || dropped.crawls.length || crawlBusy(crawlFor(dropped)));
      state.dialog = null; state.draft = null;
      if (dropped) liveCrawls.delete(dropped.id); /* 取消 = 放弃这次爬取，定时器随之失效 */
      paint();
      if (had) toast('已取消：这次填的资料和爬到的素材都没有保留');
      return;
    }
    if (action === 'open-detail') { state.detailId = id; state.detailPanel = 'info'; state.recordOpen = null; paint(); return; }
    if (action === 'close-detail') { state.detailId = null; state.recordOpen = null; paint(); return; }
    if (action === 'collect') {
      const d = state.draft;
      if (!d.kuaishouId.trim()) { toast('请先填写快手商品ID'); return; }
      d.collecting = true; paint();
      later(() => {
        const ks = d.kuaishouId.trim();
        const demo = DEMO_PROFILES[ks];
        const known = state.items.find(row => row.kuaishouId === ks);
        const filled = demo || (known
          ? { platform: known.platform, name: known.name, price: String(known.price), spec: known.spec, comm: String(known.comm), cat: known.cat, highlight: known.highlight }
          : { name: `${ks} 采集到的商品标题`, price: '9.90', spec: '包邮到家', comm: '20', cat: '家居百货' });
        Object.assign(d, { collecting: false }, filled);
        const main = DEMO_MAIN[ks] || { name: '采集主图.jpg', src: imgOf(`collect-${ks}`) };
        d.pool.main = [{ ...main, from: '采集' }];
        /* 第一步：采集顺带把同类商品图片爬回候选区；进「已勾选」要他亲手勾，入库要他亲手点确认 */
        const shots = imageBank(d.platform, ks);
        const live = crawlFor(d);
        live.channels.forEach(ch => { live.zones.image.attempts[ch] = (live.zones.image.attempts[ch] || 0) + 1; });
        live.zones.image.results = shots.map(row => ({ name: row.name, channel: row.channel, src: row.src || imgOf(row.name), size: row.size, duration: null, picked: false, dup: false }));
        d.crawls.push({
          id: uid('cr'), at: stamp(), channel: `采集 · ${d.platform}`, status: 'done', pending: 0, failed: [], video: [],
          image: shots.map(row => ({ name: row.name, kind: 'image', channel: row.channel, src: row.src || imgOf(row.name), size: row.size, duration: null, dup: false, picked: false })),
        });
        toast(`已采集：资料回填，同类图片 ${shots.length} 张已进候选区，勾选后点「确认」才归档`);
        paint();
      }, 1100);
      return;
    }
    if (action === 'submit-entry') {
      const d = state.draft;
      const miss = missingField(d);
      if (miss) { toast(`「${miss}」还没填`); return; }
      const existed = state.items.find(row => row.kuaishouId === d.kuaishouId.trim());
      if (existed) { toast('该快手商品ID 已录入，已为你定位到详情'); state.dialog = null; state.draft = null; state.detailId = existed.id; state.detailPanel = 'info'; return paint(); }
      const materials = { main: d.pool.main.length, video: d.pool.video.length, image: d.pool.image.length };
      const running = liveCrawls.get(d.id);
      const created = {
        id: uid('p'), kuaishouId: d.kuaishouId.trim(), name: d.name.trim(), cat: d.cat, price: Number(d.price), spec: d.spec.trim(),
        comm: Number(d.comm), cma: Number((Number(d.price) * Number(d.comm) / 100).toFixed(2)), gen: 0, platform: PLATFORMS.includes(d.platform) ? d.platform : '快手',
        /* 没爬完就确认 → 列表状态栏直接显示「爬取中」，跑完再自动落定 */
        status: running ? 'crawling' : (materialTotal({ materials }) ? 'ready' : 'pending'),
        updated: today(), highlight: d.highlight.trim(), negatives: d.negatives.trim(),
        materials, assets: { main: [...d.pool.main], video: [...d.pool.video], image: [...d.pool.image] }, crawls: [...d.crawls],
      };
      state.items.unshift(created);
      /* 没爬完的那一次过户给新商品：定时器继续跑，结果写进它的爬取记录 */
      liveCrawls.delete(d.id);
      if (running) liveCrawls.set(created.id, running);
      state.dialog = null; state.draft = null;
      persist(); paint();
      toast(running
        ? `已入库；这次爬取还在跑，「联网爬取」tab 上的徽标停了就是跑完`
        : materialTotal(created) ? '已入库，素材状态「素材就绪」' : '已入库；未爬到素材，状态「待爬取」，可在详情「联网爬取」再爬');
      return;
    }
  };
  /* 整行可点：键盘 Tab 聚焦后回车 / 空格进入详情（PRD §4.4-①） */
  const onKeyDown = event => {
    if (event.key === 'Escape') { dismissTop(); return; }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.key === 'Enter' && event.target?.id === 'lpQ') { paint(); toast(`匹配 ${filtered().length} / ${state.items.length} 个商品`); return; }
    const row = event.target.closest?.('.ec-prod-rowlink');
    if (!row) return;
    event.preventDefault();
    state.detailId = row.dataset.id;
    state.detailPanel = 'info';
    state.recordOpen = null;
    paint();
  };
  const onInput = event => {
    const filterKey = event.target.dataset.lpFilter;
    if (filterKey) { state.filters[filterKey] = event.target.value; return paintDebounced(); }
    const draftKey = event.target.dataset.lpDraft;
    if (draftKey && state.draft) {
      if (event.target.id === 'lpKsId' || event.target.id === 'lpName') state.draft.suggestField = event.target.id === 'lpName' ? 'name' : 'kuaishouId';
      state.draft[draftKey] = event.target.value;
      return paintDebounced();
    }
  };
  /* 聚焦快手商品ID 即展开建议（不需要单独的历史按钮） */
  const onFocusIn = event => {
    const field = { lpKsId: 'kuaishouId', lpName: 'name' }[event.target?.id];
    if (!field || !state.draft || state.draft.suggestField === field) return;
    state.draft.suggestField = field;
    paintKeepingFocus();
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
    /* 唯一的本地通道：详情页「增补素材」两块拖拽区 */
    const appended = event.target.dataset?.lpAppend;
    if (appended) ingestFiles(appended, find(event.target.closest('[data-drop]')?.dataset.id), event.target.files);
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