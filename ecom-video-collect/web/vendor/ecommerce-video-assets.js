/* 素材中心模块（PRD v2.4 §8）。
 * 顶部两大板块：主播素材（红段源片 + 蓝段通用素材，按段位分组）/ 商品素材（按商品归集，图片与视频分开展示）。
 * 原「素材库 / 素材分割 / 产品替换 / 音频处理」四页签在电商工作流内不再作为一级页签（§8.3 结构变更说明）。
 * 令牌与基础控件复用 ecommerce-video-ledger.css 的 .ec-video-ledger 作用域，本模块只加 .ec-asset-* 规则。
 */
(() => {
  'use strict';

  const STORE_KEY = 'laogge-assets-v1';

  /* 主播素材分组：段位与模板蓝段一一对应，红段单独成组（PRD §8.3） */
  const ANCHOR_GROUPS = [
    { key: 'fixed', mark: '红', tone: 'red', label: '固定段库（红段）', slot: '段1 / 段13', voice: '真人原声', locked: true, note: '黄金5秒原片：替换需二次确认并自动归档旧版，历史成片不受影响' },
    { key: 'seg2', mark: '2', tone: 'orange', label: '段2 · 聚会宠粉', slot: '段2', voice: '机器口播', note: 'IP 通用素材，跨商品复用' },
    { key: 'seg4', mark: '4', tone: 'orange', label: '段4 · 外出谈判', slot: '段4', voice: '机器口播', note: 'IP 通用素材，跨商品复用' },
    { key: 'seg5', mark: '5', tone: 'orange', label: '段5 · 直播过程', slot: '段5', voice: '机器口播', note: 'IP 通用素材，跨商品复用' },
    { key: 'seg10', mark: '10', tone: 'orange', label: '段10 · 通用可变', slot: '段10', voice: '机器口播', note: '通用可变段，可按商品调整顺序' },
  ];

  const seedAnchor = () => ({
    fixed: [
      { id: 'as-r1', name: 'laoge-hook-01.mp4', kind: 'video', duration: '00:05', size: '8.4 MB', voice: '真人原声', slot: '段1', version: 'v3', addedAt: '2026-09-18' },
      { id: 'as-r2', name: 'laoge-ending-02.mp4', kind: 'video', duration: '00:05', size: '7.9 MB', voice: '真人原声', slot: '段13', version: 'v2', addedAt: '2026-09-18' },
    ],
    seg2: [
      { id: 'as-21', name: 'generic-candidate-party-01.mp4', kind: 'video', duration: '00:07', size: '11.2 MB', voice: '机器口播', slot: '段2', version: 'v1', addedAt: '2026-09-20' },
      { id: 'as-22', name: 'generic-candidate-party-02.mp4', kind: 'video', duration: '00:06', size: '9.6 MB', voice: '机器口播', slot: '段2', version: 'v1', addedAt: '2026-09-20' },
    ],
    seg4: [
      { id: 'as-41', name: 'generic-candidate-talk-01.mp4', kind: 'video', duration: '00:08', size: '12.7 MB', voice: '机器口播', slot: '段4', version: 'v1', addedAt: '2026-09-21' },
      { id: 'as-42', name: 'generic-candidate-talk-02.jpg', kind: 'image', size: '2.2 MB', voice: '机器口播', slot: '段4', version: 'v1', addedAt: '2026-09-21' },
    ],
    seg5: [
      { id: 'as-51', name: 'generic-candidate-live-01.mp4', kind: 'video', duration: '00:09', size: '14.1 MB', voice: '机器口播', slot: '段5', version: 'v1', addedAt: '2026-09-22' },
    ],
    seg10: [
      { id: 'as-101', name: 'generic-candidate-common-01.mp4', kind: 'video', duration: '00:06', size: '10.3 MB', voice: '机器口播', slot: '段10', version: 'v1', addedAt: '2026-09-24' },
      { id: 'as-102', name: 'generic-candidate-common-02.jpg', kind: 'image', size: '1.8 MB', voice: '机器口播', slot: '段10', version: 'v1', addedAt: '2026-09-24' },
    ],
  });

  const seedProducts = () => [
    {
      productId: 'p-58096', name: '家用立体收纳压缩袋抽两用棉季衣服棉被真空防尘袋', main: '主图', price: 9.99, cat: '家居百货',
      videos: [{ id: 'pd-1', name: '开箱展示.mp4', kind: 'video', duration: '00:12', size: '18.2 MB', from: '快手', enabled: true }],
      images: [{ id: 'pd-2', name: '白底主图.jpg', kind: 'image', size: '1.8 MB', from: '快手', enabled: true }],
    },
    {
      productId: 'p-34337', name: '【到手5斤】原切牛肋排2500g*1碗 顺丰+云仓发货JY', main: '主图', price: 99.9, cat: '食品饮料',
      videos: [], images: [{ id: 'pd-3', name: '规格对比.jpg', kind: 'image', size: '1.1 MB', from: '快手', enabled: true }],
    },
  ];

  /* ---------- 状态 ---------- */
  const blank = () => ({ board: 'anchor', anchor: seedAnchor(), products: seedProducts(), versions: [], dialog: null, confirm: null });

  let state = blank();
  let api = {};

  const accountScope = window.EcommerceVideoAccountScope.create({
    storeKey: STORE_KEY, createState: blank, getState: () => state,
    setState: next => { state = next; api = {}; },
    serialize: current => ({ anchor: current.anchor, products: current.products, versions: current.versions }),
    restore: (fresh, saved) => {
      if (saved?.anchor && typeof saved.anchor === 'object' && !Array.isArray(saved.anchor)) fresh.anchor = saved.anchor;
      if (Array.isArray(saved?.products)) fresh.products = saved.products;
      if (Array.isArray(saved?.versions)) fresh.versions = saved.versions;
      return fresh;
    },
  });
  const persist = accountScope.persist;

  /* ---------- 工具 ---------- */
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => `¥${Number(value || 0).toFixed(2)}`;
  const uid = prefix => `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const toast = message => api.toast?.(message);
  const today = () => new Date().toISOString().slice(0, 10);
  const anchorCount = () => Object.values(state.anchor).reduce((sum, list) => sum + list.length, 0);
  const productCount = () => state.products.reduce((sum, group) => sum + group.videos.length + group.images.length, 0);

  /* 已生成成片引用：红段素材被所有成片引用，商品素材按 productId 匹配（PRD §8.3 删除规则） */
  const doneRecords = () => (window.EcommerceVideoRecords?.rows?.() || []).filter(row => row.taskStatus === 'done');
  const referencesOf = item => {
    const done = doneRecords();
    const hits = item.group === 'fixed' ? done : done.filter(row => row.productId === item.productId);
    return hits.map(row => ({ id: row.id, name: row.name, at: row.finished || row.created }));
  };

  /* ---------- 片段 ---------- */
  const boards = () => `<div class="ec-asset-boards">
    ${[['anchor', '播', '主播素材', '红段源片 + 蓝段通用素材，按段位分组，跨商品复用', anchorCount()],
       ['product', '商', '商品素材', '按商品归集（商品获取的录入爬取 / 详情页替换 / 加入素材中心汇入）', productCount()]]
      .map(([key, mark, label, desc, count]) => `<button type="button" class="ec-asset-board${state.board === key ? ' active' : ''}" data-as="board" data-value="${key}" aria-pressed="${state.board === key}"><i>${mark}</i><div><strong>${label}</strong><small>${esc(desc)}</small></div><span class="is-tail is-num">${count} 项</span></button>`).join('')}
  </div>`;

  const card = (item, scope, meta) => {
    const probe = { ...item, group: meta.group, productId: meta.productId };
    const refs = referencesOf(probe);
    const red = meta.group === 'fixed';
    return `<article class="ec-asset-card ec-asset-card--${item.kind}${red ? ' is-red' : ''}${item.enabled === false ? ' is-off' : ''}">
      <div class="ec-asset-media">${item.src ? `<img src="${esc(item.src)}" alt="">` : `<i>${item.kind === 'video' ? '▶' : '⛰'}</i>`}
        ${red ? '<span class="ec-asset-lock">🔒 红段固定</span>' : ''}
        ${item.duration ? `<span class="ec-asset-dur is-num">${esc(item.duration)}</span>` : ''}
        <span class="ec-asset-hover">悬停预览 · ${esc(item.size || '')}</span>
      </div>
      <div class="ec-asset-body">
        <strong title="${esc(item.name)}">${esc(item.name)}</strong>
        <small>${red ? `适用 ${esc(item.slot)} · ${esc(item.voice)} · ${esc(item.version)}` : `${esc(item.from ? item.from + ' · ' : '')}${esc(item.size || '')}${item.enabled === false ? ' · 已禁用' : ''}`}</small>
      </div>
      <div class="ec-asset-ops">
        <button type="button" data-as="preview" data-scope="${scope}" data-id="${item.id}">预览</button>
        ${red ? `<button type="button" data-as="replace-red" data-id="${item.id}">替换</button>` : `<button type="button" data-as="toggle" data-scope="${scope}" data-id="${item.id}">${item.enabled === false ? '启用' : '禁用'}</button>`}
        <button type="button" class="is-danger" data-as="ask-delete" data-scope="${scope}" data-id="${item.id}" title="${refs.length ? `被 ${refs.length} 条已生成成片引用，禁止删除` : '未被任何已生成成片引用，可删除'}">删除</button>
      </div>
    </article>`;
  };

  const uploadButton = (scope, groupKey, kind, label) => `<label class="ec-led-btn ec-led-btn--sm"><input type="file" accept="${kind === 'video' ? 'video/*' : 'image/*'}" multiple data-as-upload="${scope}" data-group="${groupKey}" data-kind="${kind}" hidden>＋ ${label}</label>`;

  const anchorBoard = () => `<div class="ec-asset-groups">${ANCHOR_GROUPS.map(group => {
    const items = state.anchor[group.key] || [];
    return `<section class="ec-asset-group ec-asset-group--${group.tone}">
      <header><i>${group.mark}</i><b>${esc(group.label)}</b><small>${esc(group.slot)} · ${esc(group.voice)} · ${esc(group.note)}</small>
        <span class="is-tail">
          <span class="ec-led-badge ec-led-badge--plain is-num">${items.length} 项</span>
          ${group.locked ? `<button type="button" class="ec-led-btn ec-led-btn--sm" data-as="versions" data-group="${group.key}">版本归档 (${state.versions.filter(v => v.group === group.key).length})</button>` : ''}
          ${uploadButton('anchor', group.key, 'video', '上传素材')}
        </span>
      </header>
      <div class="ec-asset-group-body">${items.length ? `<div class="ec-asset-grid">${items.map(item => card(item, 'anchor', { group: group.key })).join('')}</div>` : `<p class="ec-led-hint" style="padding:14px 0">该分组还没有素材，点右上「＋ 上传素材」补齐${group.locked ? '（红段上传需二次确认）' : ''}。</p>`}</div>
    </section>`;
  }).join('')}</div>`;

  const productBoard = () => `<div class="ec-asset-groups">${state.products.map(group => `<section class="ec-asset-group">
      <header>
        <div class="ec-asset-product"><span class="ec-led-thumb">${esc(group.main || '主图')}</span><span><strong title="${esc(group.name)}">${esc(group.name)}</strong><small>${esc(group.cat || '未分类')} · <span class="is-num">${money(group.price)}</span> · 商品ID ${esc(group.productId)}</small></span></div>
        <span class="is-tail">
          <span class="ec-led-badge ec-led-badge--plain is-num">视频 ${group.videos.length} · 图片 ${group.images.length}</span>
          ${uploadButton('product', group.productId, 'video', '上传视频')}
          ${uploadButton('product', group.productId, 'image', '上传图片')}
        </span>
      </header>
      <div class="ec-asset-group-body">
        <div class="ec-asset-subhead">视频素材<span>${group.videos.length}</span></div>
        ${group.videos.length ? `<div class="ec-asset-grid">${group.videos.map(item => card(item, 'product', { group: group.productId, productId: group.productId })).join('')}</div>` : '<p class="ec-led-hint" style="padding:6px 0 14px">暂无视频素材，黑段匹配将回退默认组合。</p>'}
        <div class="ec-asset-subhead">图片素材<span>${group.images.length}</span></div>
        ${group.images.length ? `<div class="ec-asset-grid">${group.images.map(item => card(item, 'product', { group: group.productId, productId: group.productId })).join('')}</div>` : '<p class="ec-led-hint" style="padding:6px 0">暂无图片素材。</p>'}
      </div>
    </section>`).join('')}
    ${state.products.length ? '' : '<div class="ec-led-empty"><i>商</i><h3>还没有归集任何商品素材</h3><p>到「商品获取」录入商品并联网爬取素材，然后在商品详情页点「加入素材中心」归集到这里。</p><div><button type="button" class="ec-led-btn ec-led-btn--primary" data-as="goto-products">去商品获取</button></div></div>'}
  </div>`;

  /* ---------- 弹窗 ---------- */
  const versionsDialog = () => {
    const list = state.versions.filter(v => v.group === (state.dialog.group || 'fixed'));
    return `<div class="ec-led-backdrop" role="presentation"><div class="ec-led-dialog ec-led-dialog--mid" role="dialog" aria-modal="true" aria-labelledby="asVersionsTitle">
      <header><div><h2 id="asVersionsTitle">红段版本归档</h2><p>替换黄金5秒后旧版自动归档，可随时恢复；历史成片始终使用其生成时的版本。</p></div><button type="button" data-as="dismiss" aria-label="关闭">×</button></header>
      <div class="ec-led-dialog-body">
        ${list.length ? `<div class="ec-asset-versions">${list.map(v => `<div><b>${esc(v.name)}</b><small>${esc(v.version)} · 归档于 ${esc(v.archivedAt)} · ${esc(v.slot)}</small><span class="is-tail"><button type="button" class="ec-led-btn ec-led-btn--sm" data-as="restore" data-id="${esc(v.id)}">恢复此版本</button></span></div>`).join('')}</div>` : '<p class="ec-led-hint">暂无归档版本：红段素材还未被替换过。</p>'}
      </div>
      <footer><span class="is-spacer"></span><button type="button" class="ec-led-btn" data-as="dismiss">关闭</button></footer>
    </div></div>`;
  };

  const refsDialog = () => {
    const refs = state.dialog.refs || [];
    return `<div class="ec-led-backdrop" role="presentation"><div class="ec-led-dialog ec-led-dialog--narrow" role="dialog" aria-modal="true" aria-labelledby="asRefsTitle">
      <header><div><h2 id="asRefsTitle">该素材禁止删除</h2><p>${esc(state.dialog.name || '')}</p></div><button type="button" data-as="dismiss" aria-label="关闭">×</button></header>
      <div class="ec-led-dialog-body">
        <p style="color:var(--led-ink-soft);font-size:12.5px;line-height:1.8">素材已被下列「已生成」成片引用，删除会导致历史成片无法复现装配。可先在成片侧替换素材，再回来删除。</p>
        <ul class="ec-asset-refs">${refs.map(ref => `<li><span>${esc(ref.id)}</span><b>${esc(ref.at || '')}</b></li>`).join('')}</ul>
        <div class="ec-asset-note">共 ${refs.length} 条引用。引用清单只读，不提供强制删除。</div>
      </div>
      <footer><span class="is-spacer"></span><button type="button" class="ec-led-btn ec-led-btn--primary" data-as="dismiss">知道了</button></footer>
    </div></div>`;
  };

  const confirmDialog = () => {
    const c = state.confirm;
    const okEnabled = !c.typeTo || c.typed === c.typeTo;
    return `<div class="ec-led-backdrop" role="presentation"><div class="ec-led-dialog ec-led-dialog--narrow" role="dialog" aria-modal="true" aria-labelledby="asConfirmTitle">
      <header><div><h2 id="asConfirmTitle">${esc(c.title)}</h2></div><button type="button" data-as="dismiss-confirm" aria-label="关闭">×</button></header>
      <div class="ec-led-dialog-body">
        <p style="color:var(--led-ink-soft);font-size:12.5px;line-height:1.8">${esc(c.body)}</p>
        ${c.list ? `<ul class="ec-led-confirm-list">${c.list.map(item => `<li><span>${esc(item.k)}</span><b>${esc(item.v)}</b></li>`).join('')}</ul>` : ''}
        ${c.typeTo ? `<div class="ec-led-typecheck"><label for="asType">请输入 <b>「${esc(c.typeTo)}」</b> 以确认</label><input id="asType" class="ec-led-control" data-as="confirm-type" value="${esc(c.typed || '')}" autocomplete="off" placeholder="${esc(c.typeTo)}"><p class="${okEnabled ? 'is-ok' : ''}">${okEnabled ? '✓ 已确认，可以执行' : '文字完全一致后按钮才会启用'}</p></div>` : ''}
      </div>
      <footer><span class="is-spacer"></span><button type="button" class="ec-led-btn" data-as="dismiss-confirm">取消</button><button type="button" class="ec-led-btn ${c.danger ? 'ec-led-btn--solid-danger' : 'ec-led-btn--primary'}" data-as="do-confirm" ${okEnabled ? '' : 'disabled'}>${esc(c.okLabel || '确认')}</button></footer>
    </div></div>`;
  };

  /* ---------- 主渲染 ---------- */
  const body = () => `<div class="ec-led-scroll"><div class="ec-led-inner">
      <div class="ec-led-head"><div><h1><i>材</i>素材中心</h1><p>全局素材库：主播素材（红段源片 + 蓝段通用素材，跨商品复用）与商品素材（按商品归集，供视频制作黑段匹配）。</p></div>
        <div class="ec-led-head-actions"><span class="ec-led-count is-num">主播素材 ${anchorCount()} 项 · 商品素材 ${productCount()} 项 · 商品分组 ${state.products.length}</span></div>
      </div>
      ${boards()}
      ${state.board === 'anchor' ? anchorBoard() : productBoard()}
    </div></div>
    ${state.dialog?.kind === 'versions' ? versionsDialog() : ''}
    ${state.dialog?.kind === 'refs' ? refsDialog() : ''}
    ${state.confirm ? confirmDialog() : ''}`;

  const html = () => `<main class="ec-video-ledger ec-video-assets" aria-label="素材中心">${body()}</main>`;

  const bind = root => {
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', event => { if (event.key === 'Escape') dismissTop(); });
  };

  const mount = (root, options = {}) => {
    api = options;
    const el = root?.querySelector?.('.ec-video-assets');
    if (!el) return false;
    bind(el);
    return true;
  };

  const paint = () => {
    const current = document.querySelector('.ec-video-assets');
    if (!current) return;
    const next = document.createElement('div');
    next.innerHTML = html();
    const replacement = next.firstElementChild;
    current.replaceWith(replacement);
    bind(replacement);
  };

  const dismissTop = () => {
    if (state.confirm) { state.confirm = null; return paint(); }
    if (state.dialog) { state.dialog = null; return paint(); }
  };

  /* ---------- 查找 ---------- */
  const locate = (scope, id) => {
    if (scope === 'anchor') {
      for (const group of ANCHOR_GROUPS) {
        const index = (state.anchor[group.key] || []).findIndex(item => item.id === id);
        if (index >= 0) return { group: group.key, list: state.anchor[group.key], index, item: state.anchor[group.key][index], locked: group.locked };
      }
      return null;
    }
    for (const product of state.products) {
      for (const kind of ['videos', 'images']) {
        const index = product[kind].findIndex(item => item.id === id);
        if (index >= 0) return { group: product.productId, list: product[kind], index, item: product[kind][index], productId: product.productId, productName: product.name };
      }
    }
    return null;
  };

  /* ---------- 行为 ---------- */
  const askDelete = (scope, id) => {
    const found = locate(scope, id);
    if (!found) return;
    const refs = referencesOf({ ...found.item, group: found.group, productId: found.productId });
    if (refs.length) {
      state.dialog = { kind: 'refs', name: found.item.name, refs };
      return paint();
    }
    state.confirm = {
      title: '删除该素材？', danger: true, okLabel: '删除',
      body: '素材未被任何「已生成」成片引用，删除后不可恢复；如需保留请先归档。',
      list: [{ k: '素材', v: found.item.name }, { k: '所属', v: scope === 'anchor' ? (ANCHOR_GROUPS.find(g => g.key === found.group)?.label || found.group) : found.productName }],
      run: () => { found.list.splice(found.index, 1); persist(); paint(); toast('素材已删除'); },
    };
    return paint();
  };

  const replaceRed = id => {
    const found = locate('anchor', id);
    if (!found) return;
    state.confirm = {
      title: '替换黄金5秒原片？', danger: true, okLabel: '确认替换', typeTo: '替换黄金5秒', typed: '',
      body: '红段是固定不可改的黄金5秒原片。替换后所有新生成任务使用新版，历史成片保持其生成时的版本；旧版会自动进入版本归档，可恢复。',
      list: [{ k: '当前素材', v: `${found.item.name}（${found.item.version}）` }, { k: '适用段位', v: found.item.slot }, { k: '引用成片', v: `${referencesOf({ ...found.item, group: 'fixed' }).length} 条（历史成片不受影响）` }],
      run: () => {
        const versionNo = Number(String(found.item.version || 'v1').replace('v', '')) + 1;
        state.versions.unshift({ ...found.item, group: 'fixed', archivedAt: today(), replacedBy: `v${versionNo}` });
        found.list[found.index] = { ...found.item, name: `laoge-${found.item.slot === '段1' ? 'hook' : 'ending'}-0${versionNo}.mp4`, version: `v${versionNo}`, addedAt: today(), size: `${(7 + versionNo).toFixed(1)} MB` };
        persist(); paint();
        toast(`红段已替换为 ${versionNo} 版，旧版已归档`);
      },
    };
    return paint();
  };

  const restoreVersion = id => {
    const index = state.versions.findIndex(v => v.id === id);
    if (index < 0) return;
    const version = state.versions[index];
    const list = state.anchor[version.group] || [];
    const slot = list.find(item => item.slot === version.slot);
    state.confirm = {
      title: '恢复该归档版本？', danger: true, okLabel: '恢复',
      body: '当前版本会被替换为归档版本，并作为新的归档记录保留，历史成片不受影响。',
      list: [{ k: '恢复素材', v: `${version.name}（${version.version}）` }, { k: '当前版本', v: slot ? `${slot.name}（${slot.version}）` : '—' }],
      run: () => {
        if (slot) {
          state.versions.push({ ...slot, group: version.group, archivedAt: today(), replacedBy: version.version });
          Object.assign(slot, { name: version.name, version: version.version, size: version.size, addedAt: today() });
        }
        state.versions.splice(state.versions.findIndex(v => v.id === id), 1);
        state.dialog = null;
        persist(); paint();
        toast(`已恢复 ${version.name}（${version.version}）`);
      },
    };
    return paint();
  };

  const addFiles = (scope, groupKey, kind, files) => {
    const list = [...files].slice(0, 10).map(file => ({
      id: uid(kind === 'video' ? 'vd' : 'im'), name: file.name, kind,
      duration: kind === 'video' ? '00:10' : null, size: `${Math.max(0.4, file.size / 1048576).toFixed(1)} MB`,
      voice: scope === 'anchor' ? (groupKey === 'fixed' ? '真人原声' : '机器口播') : null,
      slot: scope === 'anchor' ? (ANCHOR_GROUPS.find(g => g.key === groupKey)?.slot || groupKey) : null,
      version: 'v1', addedAt: today(), from: '本地上传', enabled: true,
    }));
    if (!list.length) return;
    if (scope === 'anchor') {
      if (groupKey === 'fixed') {
        state.confirm = {
          title: '向固定段库（红段）上传素材？', danger: true, okLabel: '确认上传', typeTo: '替换黄金5秒', typed: '',
          body: '红段素材直接决定成片开头的黄金5秒。上传后新生成任务使用新素材，同名旧版自动归档，历史成片不变。',
          list: [{ k: '新增', v: `${list.length} 个文件` }, { k: '分组', v: '固定段库（红段）' }],
          run: () => {
            state.anchor.fixed.forEach(item => state.versions.unshift({ ...item, group: 'fixed', archivedAt: today(), replacedBy: '新上传' }));
            state.anchor.fixed = list.map((item, index) => ({ ...item, version: `v${index + 2}`, slot: index === 0 ? '段1' : '段13' }));
            persist(); paint(); toast(`红段素材已更新（${list.length} 个），旧版已归档`);
          },
        };
        return paint();
      }
      state.anchor[groupKey] = [...(state.anchor[groupKey] || []), ...list];
    } else {
      const group = state.products.find(item => item.productId === groupKey);
      if (!group) return;
      const target = group[kind === 'video' ? 'videos' : 'images'];
      const fresh = list.filter(item => !target.some(old => old.name === item.name));
      const dup = list.length - fresh.length;
      target.push(...fresh);
      if (dup) toast(`${dup} 个同名素材已存在，未产生副本`);
    }
    persist(); paint();
    toast(`已上传 ${list.length} 个${kind === 'video' ? '视频' : '图片'}素材`);
  };

  /* 商品获取「加入素材中心」的归集入口：按 productId 合并，重复项去重不产生副本 */
  const ingestProduct = payload => {
    let group = state.products.find(item => item.productId === payload.productId);
    if (!group) {
      group = { productId: payload.productId, name: payload.name, main: payload.main || '主图', price: payload.price, cat: payload.cat, videos: [], images: [] };
      state.products.unshift(group);
    } else {
      group.name = payload.name || group.name;
      group.price = payload.price ?? group.price;
      group.cat = payload.cat || group.cat;
    }
    let added = 0;
    let duplicates = 0;
    (payload.videos || []).forEach(item => {
      if (group.videos.some(old => old.name === item.name)) { duplicates += 1; return; }
      group.videos.push({ id: uid('vd'), kind: 'video', enabled: true, version: 'v1', addedAt: today(), from: item.from || '联网爬取', ...item });
      added += 1;
    });
    (payload.images || []).forEach(item => {
      if (group.images.some(old => old.name === item.name)) { duplicates += 1; return; }
      group.images.push({ id: uid('im'), kind: 'image', enabled: true, version: 'v1', addedAt: today(), from: item.from || '联网爬取', ...item });
      added += 1;
    });
    persist();
    if (document.querySelector('.ec-video-assets')) paint();
    return { added, duplicates, productName: group.name };
  };

  const onClick = event => {
    const backdrop = event.target.closest('.ec-led-backdrop');
    if (backdrop && event.target === backdrop) { dismissTop(); return; }
    const trigger = event.target.closest('[data-as]');
    if (!trigger) return;
    const action = trigger.dataset.as;
    const id = trigger.dataset.id;

    if (action === 'board') { state.board = trigger.dataset.value; return paint(); }
    if (action === 'dismiss') { state.dialog = null; return paint(); }
    if (action === 'dismiss-confirm') { state.confirm = null; return paint(); }
    if (action === 'do-confirm') { const c = state.confirm; state.confirm = null; c?.run?.(); return paint(); }
    if (action === 'versions') { state.dialog = { kind: 'versions', group: trigger.dataset.group }; return paint(); }
    if (action === 'restore') { restoreVersion(id); return; }
    if (action === 'ask-delete') { askDelete(trigger.dataset.scope, id); return; }
    if (action === 'replace-red') { replaceRed(id); return; }
    if (action === 'toggle') {
      const found = locate(trigger.dataset.scope, id);
      if (!found) return;
      found.item.enabled = found.item.enabled === false;
      persist(); paint();
      toast(found.item.enabled ? `${found.item.name} 已启用` : `${found.item.name} 已禁用，不参与生成装配`);
      return;
    }
    if (action === 'preview') { toast('原型演示：播放器未接入素材文件'); return; }
    if (action === 'goto-products') { api.goto?.('products'); return; }
  };

  const onInput = event => {
    if (event.target.dataset?.as === 'confirm-type' && state.confirm) { state.confirm.typed = event.target.value; return paint(); }
  };

  const onChange = event => {
    const scope = event.target.dataset?.asUpload;
    if (!scope) return;
    addFiles(scope, event.target.dataset.group, event.target.dataset.kind, event.target.files);
  };

  window.EcommerceVideoAssets = {
    setAccount: accountScope.setAccount,
    html,
    mount,
    ingestProduct,
    groups: () => state.products,
    anchor: () => state.anchor,
    reset: () => { state = blank(); persist(); },
  };
})();
