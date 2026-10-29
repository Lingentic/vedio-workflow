/* UI adapted from Lingentic/pm@21704c8; collection/import use the real local API.
 * 商品获取模块（PRD v2.4 §4，原「商品素材」）。
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

  const newZone = () => ({ running: false, paused: false, errors: {}, pending: 0, queue: [], requestId: 0, results: [], failed: [], attempts: {}, plan: [], cursor: 0, epoch: 0, pace: null, record: null });
  const newCrawl = () => ({ channels: [CRAWL_CHANNELS[0]], zones: { video: newZone(), image: newZone() }, taken: new Set(), epoch: 0, open: new Set() });
  const crawlBusy = crawl => Object.values(crawl.zones).some(zone => zone.running);
  /* ---------- 种子数据（单一列表，不区分我的 / 全部） ---------- */
  const seedItems = () => [];
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
      if (Array.isArray(saved?.items)) fresh.items = saved.items.map(item => {
        const assets = item.assets || item.materialDetails || { main: [], video: [], image: [] };
        for (const kind of ['main','video','image']) assets[kind] = (Array.isArray(assets[kind]) ? assets[kind] : []).map(row => ({ ...row, kind: kind === 'video' ? 'video' : 'image' }));
        const materials = { main: assets.main.length, video: assets.video.filter(row => !row.disabled).length, image: assets.image.filter(row => !row.disabled).length };
        const status = ['crawling','ready'].includes(item.status) ? (materials.video + materials.image + materials.main ? 'ready' : 'pending') : item.status;
        return { ...item, assets, materials, status, collectedImages: item.collectedImages || [], crawls: (item.crawls || []).map(record => ['running','paused'].includes(record.status) ? { ...record, status: 'interrupted', pending: 0 } : record) };
      });
      return fresh;
    },
    suspend: () => clearTimers(),
  });
  const persist = accountScope.persist;
  const pushing = new Map();
  const draftDomValues = new WeakMap();
  const mediaKey = row => row.videoId ? `${row.platform || row.channel}:${row.videoId}:${row.kind || 'video'}` : row.src || row.local || row.name;
  const openWorkbench = item => {
    const productId = item.kuaishouId || item.id;
    if (api.goto) api.goto('library', productId);
    else location.href = window.CollectApi.workbenchUrl + '/?page=library&productId=' + encodeURIComponent(productId);
  };
  const mediaSrc = row => window.CollectApi.thumbnail(row);
  const syncDraftFromDom = () => {
    if (!state.draft || state.dialog !== 'entry') return;
    const current = document.querySelector('.ec-video-products');
    if (current?.dataset.draftOwner !== state.draft.id) return;
    current.querySelectorAll('[data-lp-draft]:not(button)').forEach(el => {
      if (draftDomValues.has(el) && draftDomValues.get(el) !== el.value) state.draft[el.dataset.lpDraft] = el.value;
      draftDomValues.set(el, el.value);
    });
  };
  /* ---------- 工具 ---------- */
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const productImage = (item, fallback) => {
    const own = item.assets?.main?.[0] || item.assets?.image?.find(row => !row.disabled) || item.collectedImages?.[0] || item.assets?.video?.find(row => row.src);
    return own?.src || own?.local ? `<img src="${esc(mediaSrc(own))}" alt="${esc(item.name)}" title="采集主图" width="46" height="46" loading="lazy">` : esc(fallback);
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
  const candidateTile = (row, index, zone) => `<article data-ui-key="${esc(zone.key + ':' + mediaKey(row) + ':' + index)}" class="ec-prod-cand${row.picked ? ' is-picked' : ''}${row.dup ? ' is-dup' : ''}">
      <button type="button" class="ec-prod-cand-ck" data-lp="pick" data-zone="${zone.key}" data-index="${index}" aria-pressed="${row.picked}"${row.dup ? ' disabled' : ''} title="${row.dup ? esc(dupText(row.dup)) : row.picked ? '已勾选，点一下取消' : '勾选'}"></button>
      <button type="button" class="ec-prod-cand-media" data-lp="preview" data-zone="${zone.key}" data-index="${index}" title="放大查看">
        ${row.src ? `<img src="${esc(mediaSrc(row))}" alt="">` : imgTag(row.name) || `<i class="ec-prod-cand-mark">${zone.mark}</i>`}
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
      ${files.length ? files.map(file => `<span class="ec-prod-chip">${file.src ? `<img src="${esc(mediaSrc(file))}" alt="">` : `<i>${file.kind === 'video' ? '▶' : '图'}</i>`}<em>${file.kind === 'video' ? '视频' : '图片'}</em><span title="${esc(file.name)}">${esc(file.from ? `${file.from} · ${file.name}` : file.name)}</span>${locked ? '' : `<button type="button" data-lp="remove-pool" data-zone="${file.kind}" data-index="${file.at}" aria-label="移出 ${esc(file.name)}">×</button>`}</span>`).join('') : `<span class="ec-prod-hint">${draft ? '勾选左上角复选框先攒着，点「确认」才归档' : '勾选候选后点下面的「归入素材中心」'}</span>`}
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
        <button type="button" class="ec-prod-btn ec-prod-btn--sm${data.running ? '' : ' ec-prod-btn--collect'}" data-lp="run-zone" data-zone="${zone.key}"${canRun ? '' : ' aria-disabled="true" title="先填商品名称并至少选一个渠道"'}>${runLabel}</button>
      </header>
      <div class="ec-prod-zone-body${data.running && !data.results.length ? ' is-loading' : ''}">
        ${data.running && !data.results.length ? `<span class="ec-prod-spinner"></span><span>正在检索同类${zone.label}素材…</span>` : ''}
        ${!data.results.length && !data.running ? `<div class="ec-prod-zone-empty">${esc(emptyText)}</div>` : ''}
        ${data.results.length ? `<div class="ec-prod-zone-grid">${data.results.map((row, index) => candidateTile(row, index, zone)).join('')}</div>` : ''}
      </div>
      ${data.failed.length ? `<div class="ec-prod-zone-fail"><span><b>${esc(data.failed.join('、'))} 渠道未返回${zone.label}候选</b>${esc(data.failed.map(channel => data.errors[channel] || '未返回候选').join('；'))}</span><button type="button" class="ec-prod-btn ec-prod-btn--sm" data-lp="retry-zone" data-zone="${zone.key}" ${data.running || data.paused ? 'disabled' : ''}>⟳ 重试本区</button></div>` : ''}
    </div>`;
  };
  /* 同一套面板，两种结构：录入弹窗＝勾选暂存，确认才归档入库；
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
      <p class="ec-prod-crawl-top">素材正在爬取时，切换工作区不会中断，会继续在后台接收候选。刷新或关闭页面会结束接收。</p>
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
  const clock = seconds => `${Math.floor((Number(seconds) || 0) / 60)}:${String(Math.floor((Number(seconds) || 0) % 60)).padStart(2, '0')}`;
  const onlineControls = p => `<div class="ec-prod-online-controls"><button type="button" data-lp="stream-play">${p.streamPaused ? '播放' : '暂停'}</button><input type="range" data-stream-seek aria-label="在线播放进度" min="0" max="${Math.max(0, (p.duration || 0) - .5)}" step="0.1" value="${p.streamOffset || 0}" ${p.duration ? '' : 'disabled'}><span data-stream-clock>${clock(p.streamOffset)} / ${clock(p.duration)}</span><button type="button" data-lp="stream-mute">${p.streamMuted === false ? '静音' : '开启声音'}</button><button type="button" data-lp="stream-fullscreen">全屏</button></div>`;
  const previewVideoTag = p => `<video ${p.streamUrl ? '' : 'controls'} ${p.streamPaused ? '' : 'autoplay'} ${p.streamMuted === false ? '' : 'muted'} playsinline preload="metadata" src="${esc(p.streamUrl || window.CollectApi.mediaUrl(p.previewLocal || p.local))}" poster="${esc(p.streamFrozen ? '' : mediaSrc(p))}"></video>`;
  const lightbox = () => {
    const p = state.preview;
    if (!p) return '';
    const online = p.streamUrl ? `<div class="ec-prod-online-stage${p.streamFrozen && !p.streamReady ? ' is-holding' : ''}" data-ui-key="online-stage:${esc(p.previewId)}" style="--online-aspect:${p.streamAspect || 9 / 16}">${previewVideoTag(p)}<canvas class="ec-prod-held-frame" aria-hidden="true" data-ui-key="held-frame"></canvas></div>${onlineControls(p)}<small class="ec-prod-stream-status" data-stream-status style="visibility:${p.streamReady ? 'hidden' : 'visible'}">${p.streamFrozen ? '正在定位视频流…' : '正在连接视频流…关闭预览即停止接收'}</small>` : '';
    return `<div class="ec-prod-backdrop" data-ui-key="preview" role="presentation"><div class="ec-prod-lightbox" role="dialog" aria-modal="true" aria-label="素材预览"><button type="button" data-lp="close-preview" aria-label="关闭">×</button>${p.loading ? `<div class="ec-prod-preview-loading"><span class="ec-prod-spinner"></span>${esc(p.stage || '正在准备可播放的预览…')}</div>` : p.error ? `<div class="ec-prod-preview-error">${esc(p.error)}</div>` : p.kind === 'video' && (p.local || p.streamUrl) ? p.streamUrl ? online : previewVideoTag(p) : p.local || p.src ? `<img src="${esc(p.local ? window.CollectApi.mediaUrl(p.local) : mediaSrc(p))}" alt="${esc(p.name)}">` : '<div class="ec-prod-lightbox-empty">这条素材没有可用的预览地址</div>'}<p><b>${esc(p.name)}</b><span>${p.streamUrl ? '在线播放 · 可拖动进度' : p.kind === 'video' ? '视频预览' : '图片'} · ${esc(p.channel || p.from || '')}</span></p></div></div>`;
  };
  /* ---------- 爬取记录（只出现在「联网爬取」tab；带时间，详情只列已归入的素材） ---------- */
  const RECORD_STATUS = {
    interrupted: { label: '已中断', tone: 'warn' },
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
        ${kept.length ? `<div class="ec-prod-media-grid">${kept.map(row => `<article class="ec-prod-media"><div class="ec-prod-media-frame">${row.src ? `<img src="${esc(mediaSrc(row))}" alt="">` : ''}<span class="ec-prod-tag">${row.kind === 'video' ? '视频' : '图片'}</span>${row.kind === 'video' ? '<span class="ec-prod-play">▶</span>' : ''}${row.duration ? `<span class="ec-prod-dur is-num">00:${String(row.duration).padStart(2, '0')}</span>` : ''}</div><div class="ec-prod-media-body"><strong>${esc(row.name)}</strong><small>来源 ${esc(row.channel)} · 已归入素材中心</small></div></article>`).join('')}</div>` : '<p class="ec-prod-hint" style="padding:18px 0">这次抓到了素材，但还没勾选归入素材中心。</p>'}
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
      <header><b><i>2</i>联网爬取</b><small class="ec-prod-hint">${isDraft(host) ? '视频、图片分开爬，各自一个按钮；勾左上角复选框即攒入已勾选' : '每次爬取都留记录，可回看这次归入了哪些素材'}</small></header>
      <div class="ec-prod-form-section-body">
        ${crawlPanel(host)}
        ${isDraft(host) ? '' : crawlRecords(host)}
      </div>
    </section>`;
  const entryDialog = () => {
    const d = state.draft;
    return `<div class="ec-prod-backdrop" data-ui-key="entry" role="presentation"><div class="ec-prod-dialog" role="dialog" aria-modal="true" aria-labelledby="lpEntryTitle">
      <header><div><h2 id="lpEntryTitle">录入商品</h2><p>第一步点「采集」：拉回资料并爬回商品图片；第二步点各区按钮爬视频 / 图片。勾选的才进「已勾选」，点「确认」才归档入库，没爬完也接着爬。</p></div><button type="button" data-lp="leave-entry" aria-label="关闭">×</button></header>
      <div class="ec-prod-dialog-body"><div class="ec-prod-form-grid">${entryForm()}${crawlTab(d)}</div></div>
      <footer>
        <div class="ec-prod-tally"><span>▶ 视频: <b>${d.pool.video.length}</b></span><span>⛰ 图片: <b>${d.pool.image.length + d.pool.main.length}</b></span></div>
        <span class="is-spacer"></span>
        <button type="button" class="ec-prod-btn" data-lp="leave-entry">取消</button>
        <button type="button" class="ec-prod-btn ec-prod-btn--primary" data-lp="submit-entry">✓ 确认</button>
      </footer>
    </div></div>`;
  };
  /* ---------- 商品详情子页（PRD §4.4-②） ---------- */
  const mediaFiles = (item, kind) => (item.assets?.[kind] || []).map(file => ({ ...file, duration: file.duration ? Math.round(Number(file.duration)) : null, disabled: Boolean(file.disabled) }));
  /* 基本信息里的素材墙 = 爬到的全部（含没归入的）＋ 详情页增补进来的本地素材；归入过的才谈得上禁用 */
  const crawledOf = (item, kind) => {
    const rows = new Map();
    for (const record of item.crawls || []) for (const row of record[kind] || []) {
      const full = { ...row, kind, origin: row.channel || row.from || record.channel || "联网爬取", inPool: false, assetIndex: -1 };
      rows.set(mediaKey(full), full);
    }
    (item.assets?.[kind] || []).forEach((row, assetIndex) => {
      const full = { ...row, kind, origin: row.from || row.channel || "归档素材", inPool: true, assetIndex, disabled: Boolean(row.disabled) };
      rows.set(mediaKey(full), { ...rows.get(mediaKey(full)), ...full });
    });
    return [...rows.values()];
  };
  /* 素材墙上的单张卡：禁用是真实开关（灰显、可恢复、计入黑段缺料） */
  const mediaCard = (item, kind, row) => `<article class="ec-prod-media${row.disabled ? ' is-off' : ''}"><button type="button" class="ec-prod-media-frame" data-lp="stored-preview" data-id="${esc(item.id)}" data-kind="${kind}" data-media-key="${esc(mediaKey(row))}">${row.src ? `<img src="${esc(mediaSrc(row))}" alt="">` : ''}<span class="ec-prod-tag">${kind === 'video' ? '视频' : '图片'}</span>${kind === 'video' ? '<span class="ec-prod-play">▶</span>' : ''}${row.duration ? `<span class="ec-prod-dur">${row.duration}s</span>` : ''}</button><div class="ec-prod-media-body"><strong>${esc(row.name)}</strong><small>来源 ${esc(row.origin || row.from || row.channel || '采集')} · ${row.workbench ? '已同步工作台' : row.inPool ? '待同步工作台' : '候选素材'}</small></div><div class="ec-prod-media-ops"><button type="button" data-lp="stored-preview" data-id="${esc(item.id)}" data-kind="${kind}" data-media-key="${esc(mediaKey(row))}">预览</button>${row.inPool ? `<button type="button" data-lp="${row.disabled ? 'media-enable' : 'media-disable'}" data-id="${esc(item.id)}" data-kind="${kind}" data-index="${row.assetIndex ?? 0}">${row.disabled ? '恢复同步' : '暂停同步'}</button>` : ''}</div></article>`;
  const ingestFiles = (kind, item) => {
    if (item) openWorkbench(item);
    toast("请在工作台素材库中使用“添加视频”增补本地素材");
  };
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
          <div class="ec-prod-hero-media"><span class="ec-prod-thumb" style="width:100%;height:100%;border:0;border-radius:0">${productImage(item, '暂无主图')}</span>${item.assets?.main?.[0]?.src ? '<em>采集主图</em>' : item.assets?.image?.some(row => !row.disabled) ? '<em>商品图片</em>' : item.collectedImages?.length ? '<em>采集图片</em>' : item.assets?.video?.some(row => row.src) ? '<em>视频封面</em>' : ''}</div>
        </section>
        <section>
          <div class="ec-prod-split-label"><i>1</i>商品资料</div>
          <dl class="ec-prod-info">
            <div class="ec-prod-info-row"><dt>商品名称</dt><dd>${esc(item.name)}</dd></div>
            <div class="ec-prod-info-row"><dt>价格 · 规格</dt><dd><span class="ec-prod-price is-num">${money(item.price)}</span> · ${esc(item.spec || '—')}</dd></div>
            <div class="ec-prod-info-row"><dt>佣金 · 类目</dt><dd class="is-num">${pct(item.comm)}（预估 ${money(item.cma)}） · <span class="ec-prod-cat">${esc(item.cat || '未分类')}</span></dd></div>
            <div class="ec-prod-info-row"><dt>快手商品ID</dt><dd class="is-num">${esc(item.kuaishouId || '—')} · ${esc(item.platform)}</dd></div>
            <div class="ec-prod-info-row"><dt>素材状态</dt><dd>${badge(item.status)} <span class="ec-prod-hint is-num">更新 ${esc(item.updated)}</span></dd></div>
          </dl>
          <div class="ec-prod-split-label" style="margin-top:16px"><i>✦</i>商品亮点</div>
          <p class="ec-prod-highlight">${item.highlight ? esc(item.highlight) : '尚未填写商品亮点，生成时黑段缺少卖点依据。'}</p>
          ${item.negatives ? `<div class="ec-prod-split-label" style="margin-top:14px"><i>!</i>负面词汇（生成时规避）</div><p class="ec-prod-highlight">${esc(item.negatives)}</p>` : ''}

        </section>
      </div>
      ${['video', 'image'].map(kind => {
        const list = crawledOf(item, kind);
        return `<section class="ec-prod-media-group">
        <header><i>${kind === 'video' ? '▶' : '⛰'}</i><b>${kind === 'video' ? '视频素材' : '图片素材'} <span>(${list.length})</span></b><small class="ec-prod-hint">联网爬到的都在这 · 已归入 ${list.filter(row => row.inPool).length}</small></header>
        ${list.length ? `<div class="ec-prod-media-grid${kind === 'video' ? ' ec-prod-media-grid--video' : ''}">${list.map(row => mediaCard(item, kind, row)).join('')}</div>` : `<div class="ec-prod-hint" style="padding:18px 0">还没有${kind === 'video' ? '视频' : '图片'}素材${kind === 'video' ? '' : ''}；到「联网爬取」tab 再爬一次补齐。</div>`}
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
        <div class="ec-prod-sync-status" role="status">${item.lastSync ? `${esc(item.lastSync.at)} · 已同步 ${item.lastSync.ready} 项${item.lastSync.failed ? `，未同步 ${item.lastSync.failed} 项：${esc(item.lastSync.error)}` : ''}` : '归档素材后，点击同步即可导入真实素材库。'}</div><button type="button" class="ec-prod-btn" data-lp="open-workbench" data-id="${esc(item.id)}">查看素材库 ↗</button><button type="button" class="ec-prod-btn ec-prod-btn--primary" data-lp="push-workbench" data-id="${esc(item.id)}" ${pushing.has(item.id) ? 'disabled' : ''}>${pushing.has(item.id) ? '同步中…' : '同步到素材库'}</button><button type="button" class="ec-prod-btn" data-lp="close-detail">关闭</button>
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
      <div class="ec-prod-card"><div class="ec-prod-card-body">${rows.length ? table(rows) : emptyState()}</div></div>`}
    </div></div>
    ${state.dialog === 'entry' ? entryDialog() : ''}
    ${leaveDialog()}
    ${state.supplementId ? supplementView() : ''}
    ${state.preview ? lightbox() : ''}
    ${state.recordOpen ? recordView() : ''}`;
  };
  const html = () => { syncDraftFromDom(); return `<main class="ec-video-products" aria-label="商品获取${state.detailId ? ' · 商品详情' : ''}">${body()}</main>`; };
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
    root.dataset.draftOwner = state.draft?.id || '';
    if (root.dataset.eventsBound) return;
    root.dataset.eventsBound = '1';
    root.querySelectorAll('[data-lp-draft]:not(button)').forEach(el => draftDomValues.set(el, el.value));
    root.addEventListener('compositionend', onInput);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', onDragLeave);
    root.addEventListener('drop', onDrop);
    root.addEventListener('error', onPreviewMediaError, true);
    root.addEventListener('loadeddata', onPreviewReady, true);
    root.addEventListener('timeupdate', onStreamTime, true);
    root.addEventListener('ended', onStreamEnded, true);
  };
  /* 由 app.js 在渲染整块外壳后调用；只接管 .ec-video-products 子树，不碰左侧导航 */
  const mount = (root, options = {}) => {
    api = options;
    const el = root?.querySelector?.('.ec-video-products');
    if (!el) return false;
    bind(el);
    return true;
  };
  // Reconcile existing nodes: keep scroll containers, input focus, images and players alive.
  const stopMedia = node => {
    const media = node instanceof Element ? [...node.querySelectorAll('video,audio'), ...(node.matches('video,audio') ? [node] : [])] : [];
    media.forEach(player => { player.pause(); player.removeAttribute('src'); player.load(); });
  };
  const patchNode = (live, next) => {
    if (live.nodeType !== next.nodeType || live.nodeName !== next.nodeName) {
      stopMedia(live); live.replaceWith(next.cloneNode(true)); return;
    }
    if (live.nodeType === Node.TEXT_NODE) { if (live.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue; return; }
    if (!(live instanceof Element)) return;
    // Canvas pixels and backing dimensions are managed by freezeStreamFrame, not HTML.
    if (live instanceof HTMLCanvasElement) return;
    for (const attr of [...live.attributes]) if (!next.hasAttribute(attr.name) && attr.name !== 'data-events-bound') live.removeAttribute(attr.name);
    for (const attr of next.attributes) if (live.getAttribute(attr.name) !== attr.value) live.setAttribute(attr.name, attr.value);
    if (live instanceof HTMLTextAreaElement) {
      if (document.activeElement !== live) live.value = next.value;
      return;
    }
    const key = node => node instanceof Element ? node.id || node.getAttribute('data-ui-key') || null : null;
    const keyed = new Map([...live.childNodes].filter(key).map(node => [key(node), node]));
    let cursor = live.firstChild;
    for (const desired of [...next.childNodes]) {
      let current = key(desired) ? keyed.get(key(desired)) : cursor && !key(cursor) ? cursor : null;
      if (current && (current.nodeType !== desired.nodeType || current.nodeName !== desired.nodeName)) current = null;
      if (!current) { current = desired.cloneNode(true); live.insertBefore(current, cursor); }
      else { if (current !== cursor) live.insertBefore(current, cursor); patchNode(current, desired); }
      cursor = current.nextSibling;
    }
    while (cursor) { const old = cursor; cursor = cursor.nextSibling; stopMedia(old); old.remove(); }
    if ((live instanceof HTMLInputElement || live instanceof HTMLSelectElement) && document.activeElement !== live && live.type !== 'file') live.value = next.value;
  };
  const paint = () => {
    const current = document.querySelector('.ec-video-products');
    if (!current) return;
    const next = document.createElement('div'); next.innerHTML = html();
    patchNode(current, next.firstElementChild);
    current.querySelectorAll('[data-lp-draft]:not(button)').forEach(el => draftDomValues.set(el, el.value));
    current.dataset.draftOwner = state.draft?.id || '';
  };
  /* 重绘但保住焦点与光标位置（输入框下方的建议列表需要即时展开/收起） */
  const paintKeepingFocus = () => {
    const focusKey = document.activeElement?.id || null;
    const caret = focusKey ? document.getElementById(focusKey)?.selectionStart ?? null : null;
    paint();
    if (!focusKey) return;
    const next = document.getElementById(focusKey);
    if (!next) return;
    if (document.activeElement !== next) next.focus({ preventScroll: true });
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
    pool: { main: [], video: [], image: [] }, crawls: [], collectedImages: [],
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
    const usable = key => item.assets[key].filter(file => !file.disabled).length;
    item.materials = { ...item.materials, video: usable('video'), image: usable('image') };
  };
  const crawlBasis = host => ({ name: host?.name || '', cat: host?.cat || '' });
  const poolNames = host => new Set(['main', 'video', 'image'].flatMap(key => (poolFor(host)[key] || []).map(mediaKey)));
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
      zone.errors[entry.channel] = entry.message || '该渠道未返回结果';
      if (record && !record.failed.includes(entry.channel)) record.failed.push(entry.channel);
      refreshCrawlView(crawl);
      return;
    }
    if (crawl.taken.has(mediaKey(entry.row))) return;
    const dup = zone.results.some(item => mediaKey(item) === mediaKey(entry.row)) ? 'seen' : false;
    const row = { ...entry.row, channel: entry.channel, picked: false, dup };
    zone.results.push(row);
    record?.[zoneKey].push({ ...row, kind: zoneKey, channel: entry.channel, dup, picked: false });
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
  const pumpZone = (host, crawl, zoneKey) => {
    const zone = crawl.zones[zoneKey];
    if (!crawlAlive(crawl) || zone.paused || !zone.running) return;
    while (zone.queue.length) applyEntry(ownerOf(crawl) || host, crawl, zoneKey, zone.queue.shift());
    if (!zone.pending) finishZone(host, crawl, zoneKey);
    else refreshCrawlView(crawl);
  };
  const resultRow = (item, channel, kind) => ({
    name: `${(item.title || '素材').slice(0,55)}${item.id ? '_' + item.id.slice(-6) : ''}${kind === 'image' ? ' 封面' : ''}`,
    kind, channel, platform: item.platform || window.CollectApi.platformOf(channel), videoId: item.id || '',
    src: item.cover || '', pageUrl: item.pageUrl || '', playUrl: kind === 'video' ? item.playUrl || '' : '',
    playUrls: kind === 'video' ? item.playUrls || [] : [], duration: kind === 'video' && item.durationMs ? Math.round(item.durationMs / 1000) : null, size: '',
  });
  const startZone = (host, crawl, zoneKey, channels, record, append) => {
    const zone = crawl.zones[zoneKey];
    zone.requestId += 1;
    const requestId = zone.requestId;
    zone.queue = []; zone.pending = channels.length; zone.paused = false; zone.running = true;
    if (!append) zone.errors = {};
    if (record) { zone.record = record; crawl.open.add(record); }
    channels.forEach(channel => { zone.attempts[channel] = (zone.attempts[channel] || 0) + 1; });
    if (zoneKey === 'image' && host.collectedImages?.length) {
      zone.pending = 0;
      zone.queue = host.collectedImages.map(row => ({ channel: '商品图集', row: { ...row, kind: 'image', channel: '商品图集' } }));
      pumpZone(host, crawl, zoneKey); return;
    }
    channels.forEach(async channel => {
      let entries;
      try {
        const response = await window.CollectApi.search(channel, host.name.trim());
        const items = (response.items || []).filter(item => zoneKey !== 'image' || item.cover);
        entries = items.length ? items.map(item => ({ channel, row: resultRow(item, channel, zoneKey) })) : [{ channel, failed: true, message: '搜索没有返回候选，请调整商品名称后重试' }];
      } catch (error) { entries = [{ channel, failed: true, message: error.message }]; }
      if (!crawlAlive(crawl) || zone.requestId !== requestId) return;
      zone.queue.push(...entries); zone.pending -= 1;
      pumpZone(host, crawl, zoneKey);
    });
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
    if (!crawl.channels.length || !crawlBasis(host).name.trim()) { toast(!crawl.channels.length ? '请至少选择一个爬取渠道' : '请先填写商品名称'); return; }
    const kept = poolTotal(host);
    zone.results = [];
    zone.failed = [];
    crawl.taken = poolNames(host);
    startZone(host, crawl, zoneKey, [...crawl.channels], openRecord(host, crawl.channels, [zoneKey]), false);
    paintKeepingFocus();
    if (kept) toast(`重新爬取：只刷新候选区，${isDraft(host) ? '已勾选' : '已归入'}的 ${kept} 个不动`);
  };
  /* 勾选即归入：一条候选进/出素材中心只认这两个动作；「全部归入」是同一动作的批量版 */
  const takeRow = (host, pool, zoneKey, row) => {
    if (!pool[zoneMeta(zoneKey).card].some(file => mediaKey(file) === mediaKey(row))) pool[zoneMeta(zoneKey).card].push({ ...row, kind: zoneKey, from: row.channel });
    row.picked = true;
    markPicked(host, new Set([row.name]));
  };
  const dropRow = (host, pool, zoneKey, row) => {
    const card = zoneMeta(zoneKey).card;
    const at = pool[card].findIndex(file => mediaKey(file) === mediaKey(row));
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
        if (!row.picked || row.dup || pool[card].some(file => mediaKey(file) === mediaKey(row))) return;
        takeRow(host, pool, zone.key, row);
        moved[zone.key] += 1;
      });
    });
    syncMaterials(host);
    host.updated = today();
    persist(); paint();
    if (moved.video || moved.image) pushToWorkbench(host, false); else toast('勾选的候选已经归档');
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
  const pushToWorkbench = async (item, manual) => {
    if (!item || pushing.has(item.id)) return;
    const rows = [];
    for (const group of ['main','video','image']) (item.assets?.[group] || []).forEach((row, index) => {
      if (!row.disabled && !row.workbench) rows.push({ row, key: `${group}:${index}`, kind: group === 'video' ? 'video' : 'image' });
    });
    if (manual && !rows.length) { toast('归档素材已同步，可到工作台素材库查看'); return; }
    pushing.set(item.id, true); paint();
    try {
      const result = await window.CollectApi.importProduct({
        product: { productId: String(item.kuaishouId || item.id), name: item.name || '', price: String(item.price ?? ''), specification: item.spec || '', sellingPoints: item.highlight || '' },
        materials: rows.map(({ row, key, kind }) => ({ ...row, key, kind, assetId: row.workbenchAssetId || '' })),
      });
      let ready = 0;
      for (const imported of result.imported || []) {
        const original = rows.find(row => row.key === imported.key)?.row;
        if (!original) continue;
        if (imported.status === 'ready') { original.workbench = true; original.workbenchAssetId = imported.assetId; original.local = imported.local || original.local; delete original.workbenchError; ready += 1; }
        else { original.workbench = false; original.workbenchError = imported.error || '入库未成功'; }
      }
      const failed = rows.length - ready;
      const error = result.skipped?.[0]?.reason || result.imported?.find(row => row.status !== 'ready')?.error || '';
      item.lastSync = { at: stamp(), ready, failed, error };
      persist(); toast(`素材库同步：成功 ${ready} 项${failed ? `，未同步 ${failed} 项：${error}` : ''}`);
    } catch (error) {
      item.lastSync = { at: stamp(), ready: 0, failed: rows.length, error: error.message };
      persist(); toast(`同步失败：${error.message}；商品与归档素材已保留，可重试`);
    } finally { pushing.delete(item.id); paint(); }
  };
  const previewRow = async (row, kind, host) => {
    const previewId = uid('preview');
    const hasLocal = /^\/?media\//.test(row.local || '');
    if (!hasLocal) {
      if (kind === 'image') {
        state.preview = { ...row, kind, previewId }; paint(); return;
      }
      const urls = [...new Set([row.playUrl, ...(row.playUrls || []).map(entry => entry?.url)].filter(url => /^https?:\/\//.test(url || '')))]
        .sort((a, b) => Number(!a.includes('.mp4')) - Number(!b.includes('.mp4'))).slice(0, 3);
      state.preview = urls.length ? { ...row, kind, previewId, streamUrls: urls, streamIndex: 0,
        streamUrl: window.CollectApi.onlineUrl(urls[0], row.platform || row.channel || row.from, 0, previewId) }
        : { ...row, kind, previewId, error: '这条记录没有视频地址，请重新爬取' };
      paint(); return;
    }
    state.preview = { ...row, kind, loading: true, stage: kind === 'video' ? '正在读取本地视频…' : '正在读取本地图片…', previewId }; paint();
    try {
      const result = { path: '/' + row.local.replace(/^\//, '') };
      row.local = result.path;
      const owner = ownerOf(crawlFor(host)) || (isDraft(host) ? host : find(host.id));
      const key = mediaKey(row);
      for (const entry of (owner && poolFor(owner)[kind]) || []) if (mediaKey(entry) === key) entry.local = result.path;
      for (const record of owner?.crawls || []) for (const entry of record[kind] || []) if (mediaKey(entry) === key) entry.local = result.path;
      if (!isDraft(owner)) persist();
      if (state.preview?.previewId === previewId) { state.preview.stage = '正在检查本地播放格式…'; paint(); }
      const preview = kind === 'video' ? await window.CollectApi.previewVideo(result.path) : result;
      if (state.preview?.previewId === previewId) state.preview = { ...row, kind, local: result.path, previewLocal: preview.path, previewId };
    } catch (error) { if (state.preview?.previewId === previewId) state.preview = { ...row, kind, error: error.message, previewId }; }
    paint();
  };
  const freezeStreamFrame = () => {
    const stage = document.querySelector('.ec-prod-online-stage');
    const video = stage?.querySelector('video');
    const canvas = stage?.querySelector('canvas');
    if (!video || !canvas) return false;
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      try {
        const context = canvas.getContext('2d');
        if (!context) return canvas.dataset.hasFrame === '1';
        canvas.width = width; canvas.height = height;
        context.drawImage(video, 0, 0, width, height);
        canvas.dataset.hasFrame = '1';
      } catch { /* Keep the previous held frame during a rapid second seek. */ }
    }
    return canvas.dataset.hasFrame === '1';
  };
  const seekStream = value => {
    const p = state.preview;
    if (!p?.streamUrl) return;
    const start = Math.max(0, Math.min(Number(value) || 0, Math.max(0, (p.duration || 0) - .5)));
    state.preview = { ...p, streamOffset: start, seeking: false, streamReady: false, streamFrozen: freezeStreamFrame(),
      streamUrl: window.CollectApi.onlineUrl(p.streamUrls[p.streamIndex], p.platform || p.channel || p.from, start, p.previewId) };
    paint();
  };
  const onStreamEnded = event => {
    if (!event.target?.matches?.('.ec-prod-lightbox video') || !state.preview?.streamUrl) return;
    state.preview.streamPaused = true;
    const button = document.querySelector('[data-lp="stream-play"]');
    if (button) button.textContent = '播放';
  };
  const onStreamTime = event => {
    if (!event.target?.matches?.('.ec-prod-lightbox video') || !state.preview?.streamUrl || state.preview.seeking) return;
    const p = state.preview;
    const time = Math.min(p.duration || Infinity, (p.streamOffset || 0) + event.target.currentTime);
    const slider = document.querySelector('[data-stream-seek]');
    if (slider) slider.value = String(time);
    const label = document.querySelector('[data-stream-clock]');
    if (label) label.textContent = `${clock(time)} / ${clock(p.duration)}`;
  };
  const onPreviewReady = event => {
    const video = event.target;
    if (!video?.matches?.('.ec-prod-lightbox video') || !state.preview?.streamUrl) return;
    const source = video.getAttribute('src');
    const reveal = () => {
      const p = state.preview;
      if (!video.isConnected || !p?.streamUrl || p.streamUrl !== source || video.getAttribute('src') !== source) return;
      p.streamReady = true; p.streamFrozen = false;
      if (video.videoWidth && video.videoHeight) p.streamAspect = video.videoWidth / video.videoHeight;
      const stage = video.closest('.ec-prod-online-stage');
      stage?.style.setProperty('--online-aspect', String(p.streamAspect || 9 / 16));
      stage?.classList.remove('is-holding');
      if (p.streamPaused) video.pause();
      const status = document.querySelector('[data-stream-status]');
      if (status) status.style.visibility = 'hidden';
    };
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(reveal);
    else requestAnimationFrame(reveal);
  };
  const onPreviewMediaError = async event => {
    if (!event.target?.matches?.('.ec-prod-lightbox video')) return;
    const current = state.preview;
    if (!current || current.kind !== 'video' || current.loading) return;
    if (current.streamUrl) {
      const index = current.streamIndex + 1;
      if (index < current.streamUrls.length) {
        state.preview = { ...current, streamIndex: index, streamReady: false, streamFrozen: freezeStreamFrame(),
          streamUrl: window.CollectApi.onlineUrl(current.streamUrls[index], current.platform || current.channel || current.from, current.streamOffset || 0, current.previewId) };
      } else state.preview = { ...current, error: '在线播放失败：候选地址可能已过期，请重新爬取或选择其他视频' };
      paint(); return;
    }
    if (current.retried) {
      state.preview = { ...current, error: '视频已下载，但浏览器仍无法播放。请尝试重新爬取这条视频。' };
      paint(); return;
    }
    const previewId = current.previewId;
    state.preview = { ...current, loading: true, retried: true };
    paint();
    try {
      const result = await window.CollectApi.previewVideo(current.local, true);
      if (state.preview?.previewId === previewId) state.preview = { ...current, previewLocal: result.path, retried: true };
    } catch (error) {
      if (state.preview?.previewId === previewId) state.preview = { ...current, error: `自动转码失败：${error.message}`, retried: true };
    }
    if (state.preview?.previewId === previewId) paint();
  };
  const onClick = event => {
    syncDraftFromDom();
    const draftButton = event.target.closest('button[data-lp-draft]');
    if (draftButton && state.draft) { state.draft[draftButton.dataset.lpDraft] = draftButton.dataset.value; paintKeepingFocus(); return; }
    /* 只有点在遮罩本体上才关闭；弹窗内部点击不得冒泡成关闭 */
    const backdrop = event.target.closest('.ec-prod-backdrop');
    if (backdrop && event.target === backdrop) { dismissTop(); return; }
    /* 点到输入框区域之外，收起 ID 建议列表 */
    if (state.draft?.suggestField && !event.target.closest('.ec-prod-ksbox')) { state.draft.suggestField = null; document.querySelectorAll('.ec-prod-suggest').forEach(node => node.remove()); }
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
    if (action === 'stream-play' || action === 'stream-mute' || action === 'stream-fullscreen') {
      const video = document.querySelector('.ec-prod-lightbox video');
      if (!video) return;
      if (action === 'stream-play') { if (video.paused) { state.preview.streamPaused = false; if (video.ended) seekStream(0); else video.play().catch(() => {}); trigger.textContent = '暂停'; } else { state.preview.streamPaused = true; video.pause(); trigger.textContent = '播放'; } }
      if (action === 'stream-mute') { video.muted = !video.muted; state.preview.streamMuted = video.muted; trigger.textContent = video.muted ? '开启声音' : '静音'; }
      if (action === 'stream-fullscreen') video.closest('.ec-prod-lightbox')?.requestFullscreen?.().catch(() => {});
      return;
    }
    if (action === 'ext-help') { toast('Chrome 扩展管理：开启开发者模式 → 加载已解压的扩展 → 选择 ecom-video-collect/extension，并登录快分销。'); return; }
    if (action === 'push-workbench') { pushToWorkbench(item, true); return; }
    if (action === 'open-workbench') { openWorkbench(item); return; }
    if (action === 'stored-preview') {
      const kind = trigger.dataset.kind;
      const row = crawledOf(item, kind).find(row => mediaKey(row) === trigger.dataset.mediaKey);
      if (row) previewRow(row, kind, item);
      return;
    }
    /* 详情的两 tab 切换 */
    if (action === 'panel') {
      state.detailPanel = trigger.dataset.panel;
      return paint();
    }
    if (action === 'toggle-record') { state.recordOpen = trigger.dataset.record; return paint(); }
    if (action === 'close-record') { state.recordOpen = null; return paint(); }
    if (action === 'open-supplement') { ingestFiles('video', item); return; }
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
      /* 弹窗 pool 只是暂存的已勾选清单，确认之前不会同步素材库。详情里须点「归入素材中心」。 */
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
      const pool = poolFor(host);
      const removed = pool[zoneKey][Number(trigger.dataset.index)];
      if (!removed) return;
      dropRow(host, pool, zoneKey, removed);
      const crawl = crawlFor(host); crawl.taken.delete(mediaKey(removed));
      crawl.zones[zoneKey].results.forEach(row => { if (mediaKey(row) === mediaKey(removed)) row.picked = false; });
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
      previewRow(row, trigger.dataset.zone, host); return;
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
      paint(); toast('已放弃本次未提交的录入');
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
      syncDraftFromDom(); d.collecting = true; paint();
      window.CollectApi.collectProduct(d.kuaishouId.trim()).then(response => {
        if (state.draft !== d) return;
        const record = response.record || {};
        if (record.productName) d.name = record.productName;
        if (record.price?.min != null) d.price = String(record.price.min);
        if (record.commission?.percent != null) d.comm = String(record.commission.percent);
        if (!d.spec.trim() && record.specification) d.spec = record.specification;
        if (!d.cat) d.cat = window.CollectApi.categoryOf(record);
        d.collectSource = record.sourceUrl || '';
        const imageUrls = [record.mainImageUrl, ...(record.imageUrls || [])].filter(url => /^https?:\/\//.test(url || ''));
        d.collectedImages = [...new Set(imageUrls)].map((src, index) => ({ name: src === record.mainImageUrl ? '商品主图' : `商品图 ${index + 1}`, src, kind: 'image', platform: 'kuaishou', from: '商品详情', channel: '商品详情' }));
        const crawl = crawlFor(d);
        const zone = crawl.zones.image;
        // A new product collection replaces image candidates, never the user's selection.
        zone.requestId += 1;
        if (zone.record) { zone.record.status = 'interrupted'; zone.record.pending = 0; crawl.open.delete(zone.record); }
        zone.record = null; zone.running = false; zone.paused = false; zone.pending = 0; zone.queue = []; zone.failed = []; zone.errors = {};
        const selected = poolNames(d);
        zone.results = d.collectedImages.filter(row => !selected.has(mediaKey(row))).map(row => ({ ...row, picked: false, dup: false }));
        const recordOfImages = openRecord(d, ['商品详情'], ['image']);
        recordOfImages.image = zone.results.map(row => ({ ...row }));
        settleRecord(recordOfImages);
        zone.attempts['商品详情'] = (zone.attempts['商品详情'] || 0) + 1;
        toast(`已采集商品资料，${zone.results.length} 张图片进入候选区，请勾选后确认入库`);
      }).catch(error => toast(error.message)).finally(() => { if (state.draft === d) { d.collecting = false; paintKeepingFocus(); } });
      return;
    }
    if (action === 'submit-entry') {
      const d = state.draft;
      if (d.collecting) { toast('商品资料正在采集，请等待完成后确认'); return; }
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
        status: running && crawlBusy(running) ? 'crawling' : (materialTotal({ materials }) ? 'ready' : 'pending'),
        updated: today(), highlight: d.highlight.trim(), negatives: d.negatives.trim(),
        collectedImages: d.collectedImages || [], collectSource: d.collectSource || '', materials, assets: { main: [...d.pool.main], video: [...d.pool.video], image: [...d.pool.image] }, crawls: [...d.crawls],
      };
      state.items.unshift(created);
      /* 没爬完的那一次过户给新商品：定时器继续跑，结果写进它的爬取记录 */
      liveCrawls.delete(d.id);
      if (running) liveCrawls.set(created.id, running);
      state.dialog = null; state.draft = null;
      persist(); paint();
      toast(running && crawlBusy(running)
        ? `已入库；这次爬取还在跑，「联网爬取」tab 上的徽标停了就是跑完`
        : materialTotal(created) ? '商品已保存，正在同步工作台素材库…' : '商品已保存；可在详情中继续爬取素材');
      pushToWorkbench(created, false);
      return;
    }
    /* 禁用 / 恢复：落在具体那份素材上，计数与黑段缺料随之变 */
    if (action === 'media-disable' || action === 'media-enable') {
      if (!item) return;
      const kind = trigger.dataset.kind;
      const file = ensureAssets(item)[kind][Number(trigger.dataset.index)];
      if (!file) return;
      file.disabled = action === 'media-disable';
      syncMaterials(item);
      item.updated = today();
      persist(); paint();
      toast(file.disabled ? '已暂停后续同步；已入工作台的素材请在素材库管理' : '已恢复后续同步');
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
    if (event.target.matches?.('[data-stream-seek]') && state.preview) {
      state.preview.seeking = true;
      const label = document.querySelector('[data-stream-clock]');
      if (label) label.textContent = `${clock(event.target.value)} / ${clock(state.preview.duration)}`;
      return;
    }
    const filterKey = event.target.dataset.lpFilter;
    if (filterKey) { state.filters[filterKey] = event.target.value; if (!event.isComposing) paintDebounced(); return; }
    const draftKey = event.target.dataset.lpDraft;
    if (draftKey && state.draft) {
      if (event.target.id === 'lpKsId' || event.target.id === 'lpName') state.draft.suggestField = event.target.id === 'lpName' ? 'name' : 'kuaishouId';
      state.draft[draftKey] = event.target.value;
      draftDomValues.set(event.target, event.target.value);
      syncDraftControls(event.target);
      return;
    }
  };
  /* 聚焦快手商品ID 即展开建议（不需要单独的历史按钮） */
  const syncDraftControls = input => {
    const draft = state.draft;
    if (!draft) return;
    const crawl = crawlFor(draft);
    const canRun = Boolean(draft.name.trim() && crawl.channels.length);
    document.querySelectorAll("[data-lp=run-zone]").forEach(button => {
      if (canRun) { button.removeAttribute("aria-disabled"); button.removeAttribute("title"); }
      else { button.setAttribute("aria-disabled","true"); button.title = "请先填写商品名称并选择渠道"; }
    });
    const note = document.querySelector(".ec-prod-crawl-note");
    if (note) { note.textContent = draft.name.trim() ? `依据 ${draft.name.trim().slice(0,14)} 检索同类素材` : "先填商品名称，爬取按名称 / 类目发起"; note.classList.toggle("is-warn",!draft.name.trim()); }
    const box = input?.closest(".ec-prod-ksbox");
    if (box && draft.suggestField) { box.querySelector(".ec-prod-suggest")?.remove(); box.insertAdjacentHTML("beforeend",historyList()); }
  };
  const onFocusIn = event => {
    const field = { lpKsId: "kuaishouId", lpName: "name" }[event.target?.id];
    if (!field || !state.draft) return;
    state.draft.suggestField = field;
    syncDraftControls(event.target);
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
    if (event.target.matches?.('[data-stream-seek]')) { seekStream(event.target.value); return; }
    if (event.target.dataset?.lpDraft && state.draft) { onInput(event); return; }
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
