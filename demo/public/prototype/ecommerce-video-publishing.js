/* 发布中心模块（PRD v2.3 §7 + §3.2 / §3.4 状态×按钮矩阵）。
 * 工作流第 4 步：多账号隔离环境批量发布 + 定时无人值守 + 发布任务台账。
 * A 账号环境（本模块子区）+ B 发布任务台账；布局字段按 UUclip 实测口径复刻（§7.4 字段取舍决策）。
 * 自包含：状态、渲染、事件委托都在本文件内，通过 window.EcommerceVideoPublishing 暴露给 app.js。
 */
(() => {
  'use strict';

  const STORE_KEY = 'laogge-publishing-v1';
  const GLOBAL_CONCURRENCY = 3;
  const ACCOUNT_CONCURRENCY = 1;
  const MAX_RETRY = 2;
  const TICK = 1200;
  const BANNED = ['最好', '第一', '绝对', '国家级', '史上最'];

  /* ---------- 状态字典（PRD §3.2 / §3.4 / §7.3-B） ---------- */
  const STATUS = {
    queued: { label: '排队中', tone: 'info' },
    publishing: { label: '发布中', tone: 'working' },
    published: { label: '发布成功', tone: 'ok' },
    reviewing: { label: '发布待审', tone: 'warn' },
    failed: { label: '失败-待重试', tone: 'danger' },
    precheck: { label: '预检未过', tone: 'danger' },
    blocked: { label: '阻塞', tone: 'warn' },
    missed: { label: '错失', tone: 'neutral' },
  };
  const PRECHECK_ITEMS = [
    { key: 'words', label: '违禁词扫描', hard: true, desc: '标题 / 口播文案命中平台违禁词库即拦截' },
    { key: 'visual', label: '画面合规', hard: true, desc: '红段原片复用、画面无违规贴片与二维码' },
    { key: 'ratio', label: '时长比例', hard: false, desc: '成片时长与 13 段装配时长偏差 ≤10%' },
    { key: 'dup', label: '同素材重复度', hard: false, desc: '同商品多号发布需错开素材顺序与封面帧' },
    { key: 'weight', label: '账号权重匹配', hard: true, desc: '账号环境异常或登录态失效时不入队' },
  ];
  const PLATFORM_MARK = { 快手: '快', 抖音: '抖', TikTok: 'T' };

  const seedAccounts = () => [
    { id: 'acc-01', platform: '快手', name: '老葛严选01', uid: 'laoge_xs01', status: 'ok', fingerprint: '独立设备指纹 · 已启用', proxy: '112.65.**.18:8123', speed: 186, cookie: '本地加密 Cookie · 有效', note: '独立环境已启用', checked: '2026-10-22 08:30' },
    { id: 'acc-02', platform: '快手', name: '老葛严选02', uid: 'laoge_xs02', status: 'ok', fingerprint: '独立设备指纹 · 已启用', proxy: '112.65.**.44:8123', speed: 204, cookie: '本地加密 Cookie · 有效', note: '独立环境已启用', checked: '2026-10-22 08:30' },
    { id: 'acc-03', platform: '抖音', name: '老葛严选03', uid: 'laoge_xs03', status: 'warn', fingerprint: '独立设备指纹 · 已启用', proxy: '未配置', speed: 820, cookie: '本地加密 Cookie · 有效', note: 'IP弱：代理未配置，测速 820ms 高于阈值', checked: '2026-10-22 08:30' },
    { id: 'acc-04', platform: '快手', name: '老葛严选04', uid: 'laoge_xs04', status: 'danger', fingerprint: '独立设备指纹 · 已启用', proxy: '112.65.**.77:8123', speed: 240, cookie: '本地加密 Cookie · 已过期', note: '异常：登录态失效，发布选号列表中该账号置灰', checked: '2026-10-22 08:30' },
  ];

  const seedTasks = () => [
    { id: 'P0001', recordId: 'T202610220912', accountId: 'acc-01', status: 'published', progress: 100, actual: '2026-10-22 09:31', planned: '立即发布', created: '2026-10-22 09:28', product: { name: '家用立体收纳压缩袋抽两用棉季衣服棉被真空防尘袋', price: 9.99, productId: 'p-58096', platformId: 'KS-38908', cat: '家居百货' }, duration: '01:24', title: '换季收纳就靠它，抽压两用薄薄一摞 #老葛严选', attempts: 0, resubmits: 0, raw: '{"code":200,"message":"publish success","data":{"video_id":"3.1415e18","audit":"pass"}}', precheck: { words: 'pass', visual: 'pass', ratio: 'pass', dup: 'pass', weight: 'pass' } },
    { id: 'P0002', recordId: 'T202610211508', accountId: 'acc-03', status: 'reviewing', progress: 100, actual: '2026-10-22 09:20', planned: '立即发布', created: '2026-10-22 09:18', product: { name: '家用立体收纳压缩袋抽两用棉季衣服棉被真空防尘袋', price: 9.99, productId: 'p-58096', platformId: 'KS-38908', cat: '家居百货' }, duration: '01:23', title: '衣柜腾出大半空间，防尘防潮来年没霉味', attempts: 1, resubmits: 0, raw: '{"code":200,"message":"submitted","data":{"audit":"pending","reason":"内容审核中，预计 2 小时"}}', precheck: { words: 'pass', visual: 'pass', ratio: 'warn', dup: 'warn', weight: 'pass' } },
    { id: 'P0003', recordId: 'T202610211620', accountId: 'acc-01', status: 'failed', progress: 42, actual: null, planned: '立即发布', created: '2026-10-21 16:40', product: { name: '【到手5斤】原味生核腰果皮核桃话梅味休闲零食', price: 15.9, productId: 'p-36090', platformId: 'KS-36090', cat: '食品饮料' }, duration: '01:22', title: '咸甜回甘追剧零嘴，到手5斤一次吃个够', attempts: 1, resubmits: 0, reason: '当前暂停发布，请重新登录', raw: '{"code":40001,"message":"当前暂停发布，请重新登录","data":null}', precheck: { words: 'pass', visual: 'pass', ratio: 'pass', dup: 'pass', weight: 'pass' } },
    { id: 'P0004', recordId: 'T202610211322', accountId: 'acc-02', status: 'queued', progress: 0, actual: null, planned: '2026-10-22 18:30', created: '2026-10-22 09:05', product: { name: '加厚锁腰孩子肩背服饰高弹力秋冬季衣保暖护腰披肩A20', price: 7.99, productId: 'p-58005', platformId: 'KS-58005', cat: '家居百货' }, duration: '01:20', title: '高弹针织不勒肩，孩子写作业披着不凉背', attempts: 0, resubmits: 0, timed: true, plannedAt: '2026-10-22T18:30', raw: null, precheck: { words: 'pass', visual: 'pass', ratio: 'pass', dup: 'pass', weight: 'pass' } },
    { id: 'P0005', recordId: 'T202610220845', accountId: 'acc-04', status: 'precheck', progress: 0, actual: null, planned: '立即发布', created: '2026-10-22 09:40', product: { name: '加厚锁腰孩子肩背服饰高弹力秋冬季衣保暖护腰披肩A20', price: 7.99, productId: 'p-58005', platformId: 'KS-58005', cat: '家居百货' }, duration: '01:21', title: '秋冬打底外披都行，绝对不勒肩', attempts: 0, resubmits: 0, reason: '硬性项未过：违禁词「绝对」命中；账号权重匹配失败（登录态失效）', raw: null, precheck: { words: 'fail', visual: 'pass', ratio: 'pass', dup: 'pass', weight: 'fail' } },
    { id: 'P0006', recordId: 'T202610201145', accountId: 'acc-02', status: 'missed', progress: 0, actual: null, planned: '2026-10-21 07:30', created: '2026-10-20 22:10', product: { name: '【特惠49.9】黑土玉米胚芽油5升 非转基因物理压榨', price: 49.9, productId: 'p-34349', platformId: 'KS-34349', cat: '食品饮料' }, duration: '01:19', title: '黑土地玉米胚芽物理压榨，5升装吃一季', attempts: 0, resubmits: 0, timed: true, plannedAt: '2026-10-21T07:30', reason: '定时到点时客户端进程已退出，任务错失；重启后可立即补发', raw: null, precheck: { words: 'pass', visual: 'pass', ratio: 'pass', dup: 'pass', weight: 'pass' } },
    { id: 'P0007', recordId: 'T202610221003', accountId: 'acc-01', status: 'queued', progress: 0, actual: null, planned: '立即发布', created: '2026-10-22 10:12', product: { name: '【到手5斤】原切牛肋排2500g*1碗 顺丰+云仓发货JY', price: 99.9, productId: 'p-34337', platformId: 'KS-34337', cat: '食品饮料' }, duration: '01:26', title: '原切不拼接肥瘦相间，顺丰冷链到手5斤', attempts: 0, resubmits: 0, raw: null, precheck: { words: 'pass', visual: 'pass', ratio: 'pass', dup: 'pass', weight: 'pass' } },
  ];

  /* ---------- 状态 ---------- */
  const blankFilters = () => ({ account: '', from: '', to: '', status: '', q: '' });
  const blank = () => ({ accounts: seedAccounts(), tasks: seedTasks(), filters: blankFilters(), applied: blankFilters(), selected: [], dialog: null, confirm: null, menu: null, offline: false, checking: false, adding: null, report: null, timedDraft: null, publishDraft: null });

  let state = blank();
  let timers = [];
  let ticker = null;
  let api = {};
  let currentAccountId = '';

  const accountScope = window.EcommerceVideoAccountScope.create({
    storeKey: STORE_KEY, createState: blank, getState: () => state,
    setState: next => { state = next; api = {}; },
    serialize: current => ({ tasks: current.tasks, accounts: current.accounts }),
    restore: (fresh, saved) => {
      if (Array.isArray(saved?.tasks)) fresh.tasks = saved.tasks;
      if (Array.isArray(saved?.accounts)) fresh.accounts = saved.accounts;
      return fresh;
    },
    suspend: () => { clearTimers(); ticker = null; },
  });
  const persist = accountScope.persist;

  /* ---------- 工具 ---------- */
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => `¥${Number(value || 0).toFixed(2)}`;
  const later = (fn, ms) => { const t = setTimeout(accountScope.guard(fn), ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(id => { clearTimeout(id); clearInterval(id); }); timers = []; };
  const now = () => { const d = new Date(); return `${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const find = id => state.tasks.find(task => task.id === id) || null;
  const account = id => state.accounts.find(item => item.id === id) || null;
  const toast = message => api.toast?.(message);
  const canResubmit = task => ['failed', 'reviewing', 'precheck', 'blocked', 'missed'].includes(task.status);

  const filtered = () => {
    const f = state.applied;
    return state.tasks.filter(task => {
      if (f.account && task.accountId !== f.account) return false;
      if (f.status && task.status !== f.status) return false;
      if (f.q && !`${task.id} ${task.recordId} ${task.product.name} ${task.title}`.toLowerCase().includes(f.q.trim().toLowerCase())) return false;
      const stamp = (task.actual || task.created).slice(0, 10);
      if (f.from && stamp < f.from) return false;
      if (f.to && stamp > f.to) return false;
      return true;
    });
  };

  /* ---------- 片段 ---------- */
  const badge = (status, extra) => {
    const meta = STATUS[status] || { label: status, tone: 'neutral' };
    return `<span class="ec-led-badge ec-led-badge--${meta.tone}">${meta.label}${extra || ''}</span>`;
  };
  const statusTone = status => STATUS[status]?.tone || 'neutral';

  const accountTag = acc => acc.status === 'danger'
    ? '<span class="ec-led-badge ec-led-badge--danger">异常</span>'
    : acc.status === 'warn' ? '<span class="ec-led-badge ec-led-badge--warn">IP弱</span>' : '<span class="ec-led-badge ec-led-badge--ok">独立环境已启用</span>';

  const accountCard = acc => {
    const tasks = state.tasks.filter(task => task.accountId === acc.id);
    const counts = { queued: tasks.filter(t => t.status === 'queued' || t.status === 'publishing').length, ok: tasks.filter(t => t.status === 'published' || t.status === 'reviewing').length, bad: tasks.filter(t => t.status === 'failed' || t.status === 'precheck' || t.status === 'blocked' || t.status === 'missed').length };
    return `<article class="ec-led-account${acc.status === 'warn' ? ' is-warn' : ''}${acc.status === 'danger' ? ' is-danger' : ''}">
      <header><i>${PLATFORM_MARK[acc.platform] || '账'}</i><div><strong title="${esc(acc.name)}">${esc(acc.name)}</strong><small>${esc(acc.platform)} · @${esc(acc.uid)}</small></div><span class="is-tail">${accountTag(acc)}</span></header>
      <div class="ec-led-env">
        <div><span>设备指纹</span><b class="${acc.status === 'danger' ? 'is-danger' : 'is-ok'}">${esc(acc.fingerprint)}</b></div>
        <div><span>代理 IP</span><b class="${acc.proxy === '未配置' || acc.speed > 500 ? 'is-warn' : 'is-ok'}">${esc(acc.proxy)} · <span class="is-num">${acc.speed}ms</span></b></div>
        <div><span>Cookie</span><b class="${acc.cookie.includes('过期') ? 'is-danger' : 'is-ok'}">${esc(acc.cookie)}</b></div>
        <div><span>任务</span><b class="is-num">待发布 ${counts.queued} · 成功 ${counts.ok} · 失败 ${counts.bad}</b></div>
      </div>
      <p class="ec-led-hint" style="line-height:1.6">${esc(acc.note)}</p>
      <footer>
        <button type="button" class="ec-led-btn ec-led-btn--sm" data-pub="check-account" data-id="${acc.id}">单项体检</button>
        ${acc.status === 'danger' ? `<button type="button" class="ec-led-btn ec-led-btn--sm ec-led-btn--primary" data-pub="rescan" data-id="${acc.id}">重新扫码</button>` : ''}
        ${acc.status === 'warn' ? `<button type="button" class="ec-led-btn ec-led-btn--sm" data-pub="proxy" data-id="${acc.id}">配置代理</button>` : ''}
        <span class="ec-led-hint is-num" style="margin-left:auto">体检 ${esc(acc.checked)}</span>
      </footer>
    </article>`;
  };

  const accountsSection = () => `<div class="ec-led-card">
      <header><b><i>环</i>账号环境</b><small>每账号独立设备指纹 + 代理 IP + 本地加密 Cookie，异常项标色；异常账号在发布选号中置灰</small>
        <span class="is-tail"><button type="button" class="ec-led-btn ec-led-btn--sm" data-pub="check-all" ${state.checking || !state.accounts.length ? 'disabled' : ''}>${state.checking ? '<span class="ec-led-spinner" style="width:13px;height:13px;border-width:2px"></span> 体检中…' : '♥ 批量体检'}</button><button type="button" class="ec-led-btn ec-led-btn--sm ec-led-btn--primary" data-pub="add-account">＋ 添加账号</button></span>
      </header>
      <div class="ec-led-card-body"><div class="ec-led-accounts">
        ${state.accounts.map(accountCard).join('')}
        <button type="button" class="ec-led-account-add" data-pub="add-account"><i>＋</i><span>添加账号<br><small>扫码绑定后本地创建独立隔离环境</small></span></button>
      </div></div>
    </div>`;

  const filterCard = () => {
    const f = state.filters;
    const option = (value, label, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
    return `<div class="ec-led-card"><div class="ec-led-card-body"><div class="ec-led-filters">
      <div class="ec-led-field ec-led-field--search"><label for="pubQ">搜索</label><input id="pubQ" class="ec-led-control" data-pub-filter="q" value="${esc(f.q)}" placeholder="ID / 任务ID / 商品名称 / 发布标题" autocomplete="off"></div>
      <div class="ec-led-field"><label for="pubAcc">发布账号</label><select id="pubAcc" class="ec-led-control" data-pub-filter="account">${option('', '全部账号', f.account)}${state.accounts.map(acc => option(acc.id, `${acc.name}（${acc.platform}）`, f.account)).join('')}</select></div>
      <div class="ec-led-field"><label for="pubSt">任务状态</label><select id="pubSt" class="ec-led-control" data-pub-filter="status">${option('', '全部状态', f.status)}${Object.entries(STATUS).map(([k, v]) => option(k, v.label, f.status)).join('')}</select></div>
      <div class="ec-led-field ec-led-field--range"><label for="pubFrom">发布时间</label><div class="ec-led-range"><input id="pubFrom" class="ec-led-control" type="date" data-pub-filter="from" value="${esc(f.from)}"><span>–</span><input class="ec-led-control" type="date" data-pub-filter="to" value="${esc(f.to)}" aria-label="发布时间结束"></div></div>
      <div class="ec-led-filter-actions"><button type="button" class="ec-led-btn ec-led-btn--text" data-pub="reset-filters">重置</button><button type="button" class="ec-led-btn ec-led-btn--primary" data-pub="search">搜索</button></div>
    </div></div></div>`;
  };

  const infoCell = task => `<div>${badge(task.status)}${task.timed ? '<span class="ec-led-badge ec-led-badge--plain" style="margin-left:5px">定时</span>' : ''}${task.reason ? `<span class="ec-led-reason">${esc(task.reason)}</span>` : ''}</div>`;

  const progressCell = task => `<div class="ec-led-log"><span class="ec-led-log-bar${task.status === 'published' || task.status === 'reviewing' ? ' is-ok' : ''}${['failed', 'precheck', 'blocked'].includes(task.status) ? ' is-fail' : ''}"><i style="width:${task.progress}%"></i></span><span class="is-num">${task.progress}%${task.status === 'publishing' ? ' · 上传中' : ''}</span></div>`;

  const productImage = product => {
    const image = window.EcommerceVideoProductImages?.get(product);
    return image ? `<img src="${esc(image.src)}" alt="${esc(image.alt || product.name)}" title="${esc(image.label || '相似商品示意图')}" width="40" height="40" loading="lazy" decoding="async">` : esc((product.cat || '').slice(0, 2));
  };
  const productCell = task => `<div class="ec-led-cell-product"><span class="ec-led-thumb">${productImage(task.product)}</span><span><strong title="${esc(task.product.name)}">${esc(task.product.name)}</strong><small><span class="ec-led-price is-num">${money(task.product.price)}</span> · 商品ID ${esc(task.product.productId)}</small></span></div>`;

  /* 状态×按钮矩阵（PRD §3.4） */
  const rowOps = task => {
    const ops = [{ lp: 'detail', label: '详情' }];
    if (task.status === 'failed') ops.push({ lp: 'resubmit', label: '重新提交', kind: 'primary' });
    if (task.status === 'precheck') ops.push({ lp: 'force', label: '强制发布', kind: 'danger' });
    if (task.status === 'missed') ops.push({ lp: 'makeup', label: '立即补发', kind: 'primary' });
    if (task.status === 'blocked') ops.push({ lp: 'rescan', label: '重新扫码', kind: 'primary', id: task.accountId });
    ops.push({ lp: 'menu', label: '更多' });
    return ops;
  };

  const menuPopup = task => `<div class="ec-led-menu" role="menu">
      <button type="button" role="menuitem" data-pub="copy-params" data-id="${task.id}">复制发布参数</button>
      <button type="button" role="menuitem" data-pub="raw" data-id="${task.id}">查看平台返回原文</button>
      <button type="button" role="menuitem" data-pub="cancel" data-id="${task.id}" ${['published', 'publishing'].includes(task.status) ? 'disabled' : ''}>取消任务</button>
    </div>`;

  const table = rows => `<div class="ec-led-table-wrap"><table class="ec-led-table"><thead><tr>
      <th class="is-check"><input type="checkbox" data-pub="toggle-all" aria-label="全选可重提任务" ${rows.length && rows.every(task => state.selected.includes(task.id)) ? 'checked' : ''}></th>
      <th>ID</th><th>任务ID</th><th>发布账号</th><th>发布信息</th><th>发布进度</th><th class="is-num">实际发布时间</th><th>商品信息</th><th class="is-num">计划发布时间</th><th class="is-num">创建时间</th><th class="is-right">操作</th>
    </tr></thead><tbody>${rows.map(task => {
      const acc = account(task.accountId);
      return `<tr class="${state.selected.includes(task.id) ? 'is-selected' : ''}">
      <td class="is-check"><input type="checkbox" data-pub="select" data-id="${task.id}" ${state.selected.includes(task.id) ? 'checked' : ''} ${canResubmit(task) ? '' : 'disabled title="发布成功 / 发布中的任务不可重新提交"'} aria-label="选择 ${esc(task.id)}"></td>
      <td class="is-num"><b>${esc(task.id)}</b></td>
      <td class="is-num">${esc(task.recordId)}<small class="ec-led-hint" style="display:block;margin-top:3px">${esc(task.duration)}${task.resultKind === 'demo' ? ' · 飞书成片示例' : ''}</small></td>
      <td><div class="ec-led-cell-product"><span class="ec-led-thumb">${PLATFORM_MARK[acc?.platform] || '账'}</span><span><strong>${esc(acc?.name || '—')}</strong><small>${esc(acc?.platform || '')} · ${acc?.status === 'danger' ? '环境异常' : acc?.status === 'warn' ? 'IP弱' : '环境就绪'}</small></span></div></td>
      <td>${infoCell(task)}<small class="ec-led-hint" style="display:block;margin-top:4px" title="${esc(task.title)}">${esc(task.title)}</small></td>
      <td>${progressCell(task)}</td>
      <td class="is-num">${task.actual ? esc(task.actual) : '<span class="ec-led-hint">—</span>'}</td>
      <td>${productCell(task)}</td>
      <td class="is-num">${esc(task.planned)}</td>
      <td class="is-num">${esc(task.created)}</td>
      <td><div class="ec-led-ops">${rowOps(task).map(op => `<button type="button" class="ec-led-btn ec-led-btn--sm${op.kind === 'primary' ? ' ec-led-btn--primary' : ''}${op.kind === 'danger' ? ' ec-led-btn--danger' : ''}" data-pub="${op.lp}" data-id="${op.id || task.id}">${op.label}</button>`).join('')}${state.menu === task.id ? menuPopup(task) : ''}</div></td>
    </tr>`;
    }).join('')}</tbody></table></div>`;

  const emptyState = () => `<div class="ec-led-empty"><i>发</i><h3>暂无发布任务</h3><p>从「生成记录」勾选「已完成」的成片点「批量提交发布」，任务会在这里执行过审预检后入队；也可以在此新建定时发布任务。</p><div><button type="button" class="ec-led-btn ec-led-btn--primary" data-pub="goto-records">去生成记录挑成片</button><button type="button" class="ec-led-btn" data-pub="new-timed">＋ 新建定时任务</button></div></div>`;

  /* ---------- 弹窗 ---------- */
  const precheckReport = () => {
    const report = state.report;
    return `<div class="ec-led-backdrop" role="presentation"><div class="ec-led-dialog ec-led-dialog--mid" role="dialog" aria-modal="true" aria-labelledby="pubReportTitle">
      <header><div><h2 id="pubReportTitle">过审预检报告</h2><p>${report.created} · 本批 ${report.items.length} 条成片，五项扫描结果如下（硬性项不过不入队）</p></div><button type="button" data-pub="dismiss" aria-label="关闭">×</button></header>
      <div class="ec-led-dialog-body"><div class="ec-led-stack">
        ${report.items.map((item, index) => `<section>
          <div class="ec-led-split-label"><i>${index + 1}</i>${esc(item.id)} · ${esc(item.account)}<small>${item.hardFailed ? '硬性项未过 → 预检未过' : item.softWarn ? '软性提醒 → 已入队' : '全部通过 → 已入队'}</small></div>
          <div class="ec-led-precheck">${PRECHECK_ITEMS.map(check => {
            const result = item.checks[check.key];
            const cls = result === 'fail' ? ' is-hard' : result === 'warn' ? ' is-soft' : '';
            const tag = result === 'fail' ? '<span class="ec-led-badge ec-led-badge--danger">不通过</span>' : result === 'warn' ? '<span class="ec-led-badge ec-led-badge--warn">提醒</span>' : '<span class="ec-led-badge ec-led-badge--ok">通过</span>';
            return `<div class="${cls.trim()}"><b>${check.label}</b><small>${esc(check.desc)}${check.hard ? ' · 硬性' : ' · 软性'}</small><span class="is-tail">${tag}</span></div>`;
          }).join('')}</div>
          ${item.note ? `<p class="ec-led-hint" style="margin-top:8px;line-height:1.7">${esc(item.note)}</p>` : ''}
        </section>`).join('')}
      </div></div>
      <footer><span class="ec-led-hint">入队 ${report.enqueued} 条 · 拦截 ${report.blocked} 条</span><span class="is-spacer"></span><button type="button" class="ec-led-btn ec-led-btn--primary" data-pub="dismiss">知道了</button></footer>
    </div></div>`;
  };

  const detailDialog = () => {
    const task = find(state.dialog.id);
    if (!task) return '';
    const acc = account(task.accountId);
    return `<div class="ec-led-backdrop" role="presentation"><div class="ec-led-dialog" role="dialog" aria-modal="true" aria-labelledby="pubDetailTitle">
      <header><div><h2 id="pubDetailTitle">发布详情 · ${esc(task.id)}</h2><p>${esc(task.title)}</p></div><button type="button" data-pub="dismiss" aria-label="关闭">×</button></header>
      <div class="ec-led-dialog-body"><div class="ec-led-stack">
        <section>
          <div class="ec-led-split-label"><i>1</i>发布参数<small>${badge(task.status)}</small></div>
          <dl class="ec-led-info">
            <div class="ec-led-info-row"><dt>发布标题</dt><dd>${esc(task.title)}</dd></div>
            <div class="ec-led-info-row"><dt>任务ID / 记录</dt><dd class="is-num">${esc(task.id)} ← 生成记录 ${esc(task.recordId)}</dd></div>
            <div class="ec-led-info-row"><dt>商品</dt><dd>${esc(task.product.name)}（<span class="is-num">${money(task.product.price)}</span> · ${esc(task.product.platformId)}）</dd></div>
            <div class="ec-led-info-row"><dt>成片时长</dt><dd class="is-num">${esc(task.duration)}</dd></div>
            ${task.resultKind === 'demo' ? '<div class="ec-led-info-row"><dt>视频类型</dt><dd>飞书成片示例，保留原文案与配音</dd></div>' : ''}
            <div class="ec-led-info-row"><dt>计划 / 实际</dt><dd class="is-num">${esc(task.planned)}${task.actual ? ` → ${esc(task.actual)}` : ' → 未发布'}</dd></div>
            <div class="ec-led-info-row"><dt>重提次数</dt><dd class="is-num">${task.resubmits} 次（尝试 ${task.attempts} 次，连续失败 ≥${MAX_RETRY} 次自动出队）</dd></div>
          </dl>
        </section>
        <section>
          <div class="ec-led-split-label"><i>2</i>所用账号环境</div>
          <div class="ec-led-env">
            <div><span>账号</span><b>${esc(acc?.name || '—')} · ${esc(acc?.platform || '')} · @${esc(acc?.uid || '')}</b></div>
            <div><span>设备指纹</span><b class="${acc?.status === 'danger' ? 'is-danger' : 'is-ok'}">${esc(acc?.fingerprint || '—')}</b></div>
            <div><span>代理 IP</span><b class="${acc?.proxy === '未配置' ? 'is-warn' : 'is-ok'}">${esc(acc?.proxy || '—')} · <span class="is-num">${acc?.speed || 0}ms</span></b></div>
            <div><span>Cookie</span><b class="${acc?.cookie.includes('过期') ? 'is-danger' : 'is-ok'}">${esc(acc?.cookie || '—')}</b></div>
          </div>
        </section>
        <section>
          <div class="ec-led-split-label"><i>3</i>过审预检<small>硬性项不过不入队</small></div>
          <div class="ec-led-precheck">${PRECHECK_ITEMS.map(check => {
            const result = task.precheck?.[check.key] || 'pass';
            const cls = result === 'fail' ? ' is-hard' : result === 'warn' ? ' is-soft' : '';
            const tag = result === 'fail' ? '<span class="ec-led-badge ec-led-badge--danger">不通过</span>' : result === 'warn' ? '<span class="ec-led-badge ec-led-badge--warn">提醒</span>' : '<span class="ec-led-badge ec-led-badge--ok">通过</span>';
            return `<div class="${cls.trim()}"><b>${check.label}</b><small>${esc(check.desc)}</small><span class="is-tail">${tag}</span></div>`;
          }).join('')}</div>
        </section>
        <section>
          <div class="ec-led-split-label"><i>4</i>平台返回原文</div>
          <div class="ec-led-raw">${esc(task.raw || '（尚未提交到平台，无返回内容）')}</div>
        </section>
      </div></div>
      <footer><span class="is-spacer"></span><button type="button" class="ec-led-btn" data-pub="dismiss">关闭</button>${task.status === 'failed' ? `<button type="button" class="ec-led-btn ec-led-btn--primary" data-pub="resubmit" data-id="${task.id}">重新提交</button>` : ''}${task.status === 'precheck' ? `<button type="button" class="ec-led-btn ec-led-btn--danger" data-pub="force" data-id="${task.id}">强制发布</button>` : ''}${task.status === 'missed' ? `<button type="button" class="ec-led-btn ec-led-btn--primary" data-pub="makeup" data-id="${task.id}">立即补发</button>` : ''}</footer>
    </div></div>`;
  };

  const addAccountDialog = () => {
    const draft = state.adding;
    return `<div class="ec-led-backdrop" role="presentation"><div class="ec-led-dialog ec-led-dialog--narrow" role="dialog" aria-modal="true" aria-labelledby="pubAddTitle">
      <header><div><h2 id="pubAddTitle">添加账号</h2><p>选择平台后扫码绑定，成功后在本地创建独立隔离环境（独立设备指纹 + 代理 IP + 本地加密 Cookie）。</p></div><button type="button" data-pub="dismiss" aria-label="关闭">×</button></header>
      <div class="ec-led-dialog-body">
        <div class="ec-led-split-label"><i>1</i>选择平台</div>
        <div class="ec-led-accounts" style="grid-template-columns:repeat(3,minmax(0,1fr))">${['快手', '抖音', 'TikTok'].map(p => `<button type="button" class="ec-led-btn${draft.platform === p ? ' ec-led-btn--primary' : ''}" data-pub="pick-platform" data-value="${p}">${PLATFORM_MARK[p]} ${p}</button>`).join('')}</div>
        <div class="ec-led-split-label" style="margin-top:18px"><i>2</i>扫码绑定<small>${draft.scanning ? '等待手机确认…' : '点击下方按钮模拟扫码结果'}</small></div>
        <div class="ec-led-qr"><div class="ec-led-qr-frame">${draft.scanning ? '<span class="ec-led-spinner" style="border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>' : `<span>${esc(draft.platform)} 扫码登录</span>`}</div>
          <p class="ec-led-hint" style="line-height:1.7;text-align:center">${esc(draft.note || '扫码成功后账号卡片标注「独立环境已启用」；扫码失败可重试，不影响已有账号。')}</p>
          <div class="ec-led-ops" style="justify-content:center"><button type="button" class="ec-led-btn ec-led-btn--sm ec-led-btn--primary" data-pub="scan-ok" ${draft.scanning ? 'disabled' : ''}>模拟扫码成功</button><button type="button" class="ec-led-btn ec-led-btn--sm" data-pub="scan-fail" ${draft.scanning ? 'disabled' : ''}>模拟扫码失败</button></div>
        </div>
      </div>
      <footer><span class="is-spacer"></span><button type="button" class="ec-led-btn" data-pub="dismiss">取消</button></footer>
    </div></div>`;
  };

  /* 新建定时任务：账号 / 成片 / 排期。可提交的成片＝已完成且还没提交过的 */
  const publishableRecords = () => {
    const rows = window.EcommerceVideoRecords?.rows?.() || [];
    const ready = rows.filter(row => row.taskStatus === 'done');
    if (ready.length) return ready.map(row => ({ id: row.id, label: `${row.id} · ${row.name.slice(0, 16)}…`, row }));
    return state.tasks.filter(task => task.recordId).map(task => ({ id: task.recordId, label: `${task.recordId} · ${task.product.name.slice(0, 16)}…`, row: null, task }));
  };

  const timedDialog = () => {
    const draft = state.timedDraft;
    const records = publishableRecords();
    const chosen = records.find(item => item.id === draft.recordId);
    const whenValid = Boolean(draft.when) && Date.parse(draft.when) > Date.now();
    return `<div class="ec-led-backdrop" role="presentation"><div class="ec-led-dialog ec-led-dialog--mid" role="dialog" aria-modal="true" aria-labelledby="pubTimedTitle">
      <header><div><h2 id="pubTimedTitle">新建定时任务</h2><p>选账号 → 选成片 → 定排期。客户端托盘常驻执行，偏差 ≤60 秒；到点时进程已退出则记为「错失」，可立即补发。</p></div><button type="button" data-pub="dismiss" aria-label="关闭">×</button></header>
      <div class="ec-led-dialog-body"><div class="ec-led-filters">
        <div class="ec-led-field"><label for="pubTimedAcc">发布账号</label><select id="pubTimedAcc" class="ec-led-control" data-pub="pick-account">${state.accounts.map(acc => `<option value="${esc(acc.id)}"${acc.id === draft.accountId ? ' selected' : ''}${acc.status === 'danger' ? ' disabled' : ''}>${esc(acc.name)}（${esc(acc.platform)}）${acc.status === 'danger' ? ' · 异常不可选' : acc.status === 'warn' ? ' · IP弱' : ''}</option>`).join('')}</select></div>
        <div class="ec-led-field"><label for="pubTimedRec">成片（生成记录）</label><select id="pubTimedRec" class="ec-led-control" data-pub="pick-record"><option value="">请选择已完成且已提交的成片</option>${records.map(item => `<option value="${esc(item.id)}"${item.id === draft.recordId ? ' selected' : ''}>${esc(item.label)}</option>`).join('')}</select></div>
        <div class="ec-led-field"><label for="pubTimedWhen">排期</label><input id="pubTimedWhen" class="ec-led-control" type="datetime-local" data-pub="pick-when" value="${esc(draft.when)}"></div>
        <div class="ec-led-field"><label>并发约束</label><p class="ec-led-hint" style="line-height:1.7">同账号并发 ${ACCOUNT_CONCURRENCY} · 全局并发 ${GLOBAL_CONCURRENCY}；到点后自动进入常规队列排队，不占用人工操作。</p></div>
      </div>
      ${chosen ? `<div class="ec-led-env" style="margin-top:14px"><div><span>成片</span><b>${esc(chosen.label)}</b></div><div><span>商品</span><b>${esc(chosen.row ? `${chosen.row.name}（${money(chosen.row.price)}）` : chosen.task.product.name)}</b></div><div><span>成片时长</span><b>${esc(chosen.row ? chosen.row.duration : chosen.task.duration)}</b></div></div>` : ''}
      ${draft.when && !whenValid ? '<p class="ec-led-hint" style="margin-top:12px;color:var(--led-danger)">排期需晚于当前时间</p>' : ''}
      </div>
      <footer><span class="is-spacer"></span><button type="button" class="ec-led-btn" data-pub="dismiss">取消</button><button type="button" class="ec-led-btn ec-led-btn--primary" data-pub="create-timed" ${draft.accountId && draft.recordId && whenValid ? '' : 'disabled'}>创建定时任务</button></footer>
    </div></div>`;
  };

  const preparedRecord = id => (window.EcommerceVideoRecords?.rows?.() || []).find(row => row.id === id && row.taskStatus === 'done' && typeof row.url === 'string' && row.url.trim()) || null;
  const publishDraftValid = draft => Boolean(draft && preparedRecord(draft.recordId) && account(draft.accountId) && account(draft.accountId).status !== 'danger' && draft.title.trim() && draft.title.length <= 120 && (draft.mode === 'now' || draft.mode === 'timed' && Date.parse(draft.when) > Date.now()));

  const publishDialog = () => {
    const draft = state.publishDraft;
    const row = preparedRecord(draft.recordId);
    return `<div class="ec-led-backdrop" role="presentation"><section class="ec-led-dialog ec-led-dialog--mid" role="dialog" aria-modal="true" aria-labelledby="pubPrepareTitle">
      <header><div><h2 id="pubPrepareTitle">发布设置</h2><p>确认发布账号、标题与发布时间。</p></div><button type="button" data-pub="dismiss" aria-label="关闭发布设置">×</button></header>
      <div class="ec-led-dialog-body">${row ? `<div class="ec-led-env" style="margin-bottom:18px"><div><span>本次成片</span><b>${esc(row.name)}</b></div><div><span>生成记录</span><b>${esc(row.id)}</b></div><div><span>时长</span><b>${esc(row.duration)}</b></div>${row.resultKind === 'demo' ? '<div><span>视频类型</span><b>飞书成片示例，保留原文案与配音</b></div>' : ''}</div>` : '<p class="ec-led-hint" role="alert">本次成片暂不可用，请返回视频制作重新生成。</p>'}
      <div class="ec-led-filters">
        <div class="ec-led-field"><label for="pubPrepareAccount">发布账号</label><select id="pubPrepareAccount" class="ec-led-control" data-pub="prepare-account"><option value="">请选择发布账号</option>${state.accounts.map(acc => `<option value="${esc(acc.id)}"${draft.accountId === acc.id ? ' selected' : ''}${acc.status === 'danger' ? ' disabled' : ''}>${esc(acc.name)}（${esc(acc.platform)}）${acc.status === 'danger' ? ' · 异常不可选' : acc.status === 'warn' ? ' · IP弱' : ''}</option>`).join('')}</select></div>
        <div class="ec-led-field ec-led-field--search"><label for="pubPrepareTitleInput">发布标题</label><input id="pubPrepareTitleInput" class="ec-led-control" data-pub="prepare-title" maxlength="120" value="${esc(draft.title)}" placeholder="填写发布标题"></div>
        <div class="ec-led-field"><label for="pubPrepareMode">发布时间</label><select id="pubPrepareMode" class="ec-led-control" data-pub="prepare-mode"><option value="now"${draft.mode === 'now' ? ' selected' : ''}>立即发布</option><option value="timed"${draft.mode === 'timed' ? ' selected' : ''}>定时发布</option></select></div>
        ${draft.mode === 'timed' ? `<div class="ec-led-field"><label for="pubPrepareWhen">选择时间</label><input id="pubPrepareWhen" class="ec-led-control" type="datetime-local" data-pub="prepare-when" value="${esc(draft.when)}"></div>` : ''}
      </div>${draft.mode === 'timed' && !(Date.parse(draft.when) > Date.now()) ? '<p class="ec-led-hint" style="margin-top:12px;color:var(--led-danger)">发布时间需晚于当前时间。</p>' : ''}</div>
      <footer><button type="button" class="ec-led-btn" data-pub="dismiss">取消</button><span class="is-spacer"></span><button type="button" class="ec-led-btn ec-led-btn--primary" data-pub="prepare-submit"${publishDraftValid(draft) ? '' : ' disabled'}>确认提交发布</button></footer>
    </section></div>`;
  };

  const confirmDialog = () => {
    const c = state.confirm;
    return `<div class="ec-led-backdrop" role="presentation"><div class="ec-led-dialog ec-led-dialog--narrow" role="dialog" aria-modal="true" aria-labelledby="pubConfirmTitle">
      <header><div><h2 id="pubConfirmTitle">${esc(c.title)}</h2></div><button type="button" data-pub="dismiss-confirm" aria-label="关闭">×</button></header>
      <div class="ec-led-dialog-body">
        <p style="color:var(--led-ink-soft);font-size:12.5px;line-height:1.8">${esc(c.body)}</p>
        ${c.list ? `<ul class="ec-led-confirm-list">${c.list.map(item => `<li><span>${esc(item.k)}</span><b>${esc(item.v)}</b></li>`).join('')}</ul>` : ''}
      </div>
      <footer><span class="is-spacer"></span><button type="button" class="ec-led-btn" data-pub="dismiss-confirm">取消</button><button type="button" class="ec-led-btn ${c.danger ? 'ec-led-btn--solid-danger' : 'ec-led-btn--primary'}" data-pub="do-confirm">${esc(c.okLabel || '确认')}</button></footer>
    </div></div>`;
  };

  /* ---------- 主渲染 ---------- */
  const body = () => {
    const rows = filtered();
    const counts = { queued: state.tasks.filter(t => t.status === 'queued').length, publishing: state.tasks.filter(t => t.status === 'publishing').length, failed: state.tasks.filter(t => ['failed', 'precheck', 'blocked', 'missed'].includes(t.status)).length };
    return `<div class="ec-led-scroll"><div class="ec-led-inner">
      ${head(rows.length, counts)}
      ${state.offline ? '<div class="ec-led-banner"><i>⚠</i><span>网络已断开，任务已暂停；恢复后排队中的任务继续自动流转（PRD §3.4 顶栏网络横幅）。</span><button type="button" class="ec-led-btn ec-led-btn--sm" data-pub="online">我已恢复网络</button></div>' : ''}
      ${accountsSection()}
      ${filterCard()}
      <div class="ec-led-card">
        <header><b><i>发</i>发布任务列表</b><small>共 ${rows.length} 条记录 · 同账号并发 ${ACCOUNT_CONCURRENCY} / 全局并发 ${GLOBAL_CONCURRENCY}</small>
          <span class="is-tail">
            <button type="button" class="ec-led-btn ec-led-btn--sm ec-led-btn--primary" data-pub="batch-resubmit" ${state.selected.length ? '' : 'disabled'} title="${state.selected.length ? '按原参数批量重新提交并记录重提次数' : '勾选失败 / 待审 / 预检未过 / 阻塞 / 错失的记录后可点'}">批量重新提交 (${state.selected.length})</button>
            <button type="button" class="ec-led-btn ec-led-btn--sm" data-pub="refresh">⟳ 刷新</button>
          </span>
        </header>
        <div class="ec-led-card-body ec-led-card-body--flush">${rows.length ? table(rows) : emptyState()}</div>
      </div>
    </div></div>
    ${state.report ? precheckReport() : ''}
    ${state.dialog?.kind === 'detail' ? detailDialog() : ''}
    ${state.adding ? addAccountDialog() : ''}
    ${state.timedDraft ? timedDialog() : ''}
    ${state.publishDraft ? publishDialog() : ''}
    ${state.confirm ? confirmDialog() : ''}`;
  };

  const head = (count, counts) => `<div class="ec-led-head"><div><h1><i>发</i>发布中心</h1><p>工作流第 4 步：多账号隔离环境批量发布 + 定时无人值守 + 发布台账。账号环境在本模块内维护。</p></div>
    <div class="ec-led-head-actions">
      <span class="ec-led-count is-num">共 ${count} 条 · 排队 ${counts.queued} · 发布中 ${counts.publishing} · 待处理 ${counts.failed}</span>
      <button type="button" class="ec-led-btn" data-pub="new-timed">＋ 新建定时任务</button>
      <button type="button" class="ec-led-btn ec-led-btn--quiet" data-pub="offline" title="演示用：模拟断网触发顶栏横幅与任务暂停">${state.offline ? '恢复网络' : '模拟断网'}</button>
    </div></div>`;

  const html = () => `<main class="ec-video-ledger ec-video-publishing" aria-label="发布中心">${body()}</main>`;

  const bind = root => {
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', event => { if (event.key === 'Escape') dismissTop(); });
  };

  const mount = (root, options = {}) => {
    api = options;
    const el = root?.querySelector?.('.ec-video-publishing');
    if (!el) return false;
    bind(el);
    startTicker();
    return true;
  };

  const paint = () => {
    const current = document.querySelector('.ec-video-publishing');
    if (!current) return;
    const next = document.createElement('div');
    next.innerHTML = html();
    const replacement = next.firstElementChild;
    current.replaceWith(replacement);
    bind(replacement);
  };

  /* 弹窗内输入需要即时校验反馈（如排期时间），重绘后把焦点还给原控件 */
  const paintKeepingFocus = () => {
    const focusId = document.activeElement?.id || null;
    paint();
    if (!focusId) return;
    const next = document.getElementById(focusId);
    if (!next) return;
    next.focus();
    try { const len = next.value?.length ?? 0; next.setSelectionRange?.(len, len); } catch { /* datetime-local 等控件不支持选区 */ }
  };

  const dismissTop = () => {
    if (state.confirm) { state.confirm = null; return paint(); }
    if (state.publishDraft) { state.publishDraft = null; return paint(); }
    if (state.timedDraft) { state.timedDraft = null; return paint(); }
    if (state.adding) { state.adding = null; return paint(); }
    if (state.report) { state.report = null; return paint(); }
    if (state.dialog) { state.dialog = null; return paint(); }
    if (state.menu) { state.menu = null; return paint(); }
  };

  /* ---------- 并发调度（PRD §3.2：同账号并发 1、全局并发 3，任务自动流转至终态） ---------- */
  const startTicker = () => {
    if (ticker) return;
    ticker = setInterval(accountScope.guard(() => {
      if (state.offline) return;
      let dirty = false;
      state.tasks.forEach(task => {
        if (task.status !== 'publishing') return;
        task.progress = Math.min(100, task.progress + 12);
        if (task.progress >= 100) finish(task);
        dirty = true;
      });
      const publishing = state.tasks.filter(task => task.status === 'publishing');
      const busyAccounts = new Set(publishing.map(task => task.accountId));
      state.tasks.forEach(task => {
        /* 定时任务到点自动转入常规队列（托盘常驻执行，PRD §3.2） */
        if (task.timed && task.plannedAt && Date.parse(task.plannedAt) <= Date.now()) { task.timed = false; dirty = true; }
        if (task.status !== 'queued' || task.timed) return;
        const acc = account(task.accountId);
        if (!acc) return;
        /* 排队中 + 账号登录态失效 → 阻塞（PRD §3.2），重新扫码后回到排队中 */
        if (acc.status === 'danger') {
          task.status = 'blocked';
          task.reason = `账号「${acc.name}」登录态失效，重新扫码绑定后自动回到排队中`;
          dirty = true;
          return;
        }
        if (publishing.length >= GLOBAL_CONCURRENCY) return;
        if (busyAccounts.has(task.accountId)) return;
        task.status = 'publishing';
        task.progress = 6;
        task.attempts += 1;
        busyAccounts.add(task.accountId);
        publishing.push(task);
        dirty = true;
      });
      // Keep the form DOM and focus intact while the user is configuring this result.
      if (dirty) { persist(); if (!state.publishDraft && document.querySelector('.ec-video-publishing')) paint(); }
    }), TICK);
    timers.push(ticker);
  };

  /* 终态判定走固定规则（不随机）：账号环境异常 → 失败；IP弱 → 平台待审；就绪 → 发布成功 */
  const finish = task => {
    const acc = account(task.accountId);
    task.progress = 100;
    task.actual = now();
    if (acc?.status === 'danger') {
      task.status = task.attempts >= MAX_RETRY ? 'blocked' : 'failed';
      task.reason = task.status === 'blocked' ? `连续失败 ${task.attempts} 次已出队：账号登录态失效，重新扫码后回到排队中` : '当前暂停发布，请重新登录';
      task.raw = '{"code":40001,"message":"当前暂停发布，请重新登录","data":null}';
    } else if (acc?.status === 'warn') {
      task.status = 'reviewing';
      task.reason = '平台返回：内容审核中（IP弱账号命中人工复审）';
      task.raw = '{"code":200,"message":"submitted","data":{"audit":"pending"}}';
    } else {
      task.status = 'published';
      task.reason = null;
      task.raw = '{"code":200,"message":"publish success","data":{"video_id":"3.1416e18","audit":"pass"}}';
    }
  };

  /* ---------- 过审预检（PRD §7.3-B 五项扫描） ---------- */
  const runPrecheck = (payload, acc) => {
    const checks = { words: 'pass', visual: 'pass', ratio: 'pass', dup: 'pass', weight: 'pass' };
    const notes = [];
    const hit = BANNED.find(word => `${payload.name}${payload.title || ''}`.includes(word));
    if (hit) { checks.words = 'fail'; notes.push(`违禁词「${hit}」命中（硬性）`); }
    if (acc?.status === 'danger') { checks.weight = 'fail'; notes.push(`账号「${acc.name}」环境异常：${acc.note}（硬性）`); }
    if (acc?.status === 'warn') { checks.weight = 'warn'; notes.push(`账号「${acc.name}」IP弱，可能触发平台人工复审`); }
    const sameProduct = state.tasks.filter(task => task.product.productId === payload.productId && ['published', 'reviewing'].includes(task.status)).length;
    if (sameProduct) { checks.dup = 'warn'; notes.push(`同商品已有 ${sameProduct} 条成片在发，建议错开素材顺序与封面帧`); }
    const seconds = toSeconds(payload.duration);
    if (seconds > 180) { checks.ratio = 'warn'; notes.push(`成片 ${payload.duration} 偏长，建议控制在 3 分钟内`); }
    return { checks, notes, hardFailed: Object.values(checks).some(value => value === 'fail'), softWarn: Object.values(checks).some(value => value === 'warn') };
  };
  const toSeconds = text => { const [m, s] = String(text || '0:0').split(':').map(Number); return (m || 0) * 60 + (s || 0); };

  /* ---------- 行为 ---------- */
  const resubmit = task => {
    const acc = account(task.accountId);
    if (acc?.status === 'danger') {
      task.status = 'blocked';
      task.reason = `账号「${acc.name}」登录态失效，重新扫码后自动回到排队中`;
      persist(); paint();
      toast(`${task.id} 已阻塞：账号登录态失效，请重新扫码`);
      return;
    }
    task.status = 'queued';
    task.progress = 0;
    task.reason = null;
    task.actual = null;
    task.resubmits += 1;
    task.timed = false;
    persist(); paint();
    toast(`${task.id} 已按原参数重新提交，重提 ${task.resubmits} 次`);
  };

  const checkAccount = acc => {
    /* 固定规则：抖音账号未配代理 → IP弱；Cookie 过期 → 异常；其余就绪 */
    acc.status = acc.cookie.includes('过期') ? 'danger' : acc.proxy === '未配置' || acc.speed > 500 ? 'warn' : 'ok';
    acc.note = acc.status === 'danger' ? '异常：登录态失效，发布选号列表中该账号置灰'
      : acc.status === 'warn' ? `IP弱：代理${acc.proxy === '未配置' ? '未配置' : '测速偏高'}，测速 ${acc.speed}ms 高于阈值`
      : '独立环境已启用';
    acc.checked = now();
  };

  const onClick = event => {
    const backdrop = event.target.closest('.ec-led-backdrop');
    if (backdrop && event.target === backdrop) { dismissTop(); return; }
    const trigger = event.target.closest('[data-pub]');
    if (!trigger) { if (state.menu) { state.menu = null; paint(); } return; }
    const action = trigger.dataset.pub;
    const id = trigger.dataset.id;
    const task = id ? find(id) : null;

    if (action === 'menu') { state.menu = state.menu === id ? null : id; return paint(); }
    if (action === 'search') { state.applied = { ...state.filters }; paint(); return; }
    if (action === 'reset-filters') { state.filters = blankFilters(); state.applied = blankFilters(); paint(); return; }
    if (action === 'refresh') { paint(); toast(`已刷新 ${filtered().length} 条发布任务`); return; }
    if (action === 'dismiss') { state.dialog = null; state.adding = null; state.report = null; state.timedDraft = null; state.publishDraft = null; paint(); return; }
    if (action === 'prepare-submit') { submitPrepared(); return; }
    if (action === 'dismiss-confirm') { state.confirm = null; paint(); return; }
    if (action === 'do-confirm') { const c = state.confirm; state.confirm = null; c?.run?.(); return paint(); }
    if (action === 'detail') { state.menu = null; state.dialog = { kind: 'detail', id }; paint(); return; }
    if (action === 'goto-records') { api.goto?.('records'); return; }
    if (action === 'offline') { state.offline = !state.offline; paint(); toast(state.offline ? '已模拟断网：任务暂停' : '网络已恢复：任务继续流转'); return; }
    if (action === 'online') { state.offline = false; paint(); toast('网络已恢复，排队中的任务继续自动流转'); return; }

    if (action === 'resubmit') { if (task) resubmit(task); return; }
    if (action === 'batch-resubmit') {
      const tasks = state.selected.map(find).filter(canResubmit);
      if (!tasks.length) return;
      tasks.forEach(item => resubmit(item));
      state.selected = [];
      paint();
      toast(`已批量重新提交 ${tasks.length} 条任务`);
      return;
    }
    if (action === 'force') {
      if (!task) return;
      state.confirm = {
        title: '预检未过，仍要强制发布？', danger: true, okLabel: '强制发布',
        body: '硬性项未通过将直接提交到平台，可能被限流或驳回。此操作会记入任务日志，并在台账标注强制发布。',
        list: [{ k: '任务', v: task.id }, { k: '未过项', v: PRECHECK_ITEMS.filter(item => task.precheck?.[item.key] === 'fail').map(item => item.label).join('、') || '—' }, { k: '账号', v: account(task.accountId)?.name || '—' }],
        run: () => {
          task.status = 'queued';
          task.progress = 0;
          task.forced = true;
          task.reason = '强制发布：跳过预检硬性项，已记入日志';
          task.precheck = { ...task.precheck, words: 'warn', weight: 'warn' };
          persist(); paint();
          toast(`${task.id} 已强制入队，日志已记录`);
        },
      };
      return paint();
    }
    if (action === 'makeup') {
      if (!task) return;
      task.status = 'queued';
      task.timed = false;
      task.reason = null;
      task.planned = '立即发布（补发）';
      persist(); paint();
      toast(`${task.id} 已立即补发，重新入队`);
      return;
    }
    if (action === 'cancel') {
      if (!task) return;
      state.confirm = { title: '取消该发布任务？', danger: true, okLabel: '取消任务', body: '任务将从队列中移除，台账保留记录以便追溯；已发布成功的任务不可取消。', list: [{ k: '任务', v: task.id }, { k: '当前状态', v: STATUS[task.status].label }], run: () => { state.tasks = state.tasks.filter(item => item.id !== task.id); state.selected = state.selected.filter(item => item !== task.id); state.menu = null; persist(); paint(); toast(`${task.id} 已取消并移出队列`); } };
      return paint();
    }
    if (action === 'copy-params') { state.menu = null; paint(); toast('发布参数已复制到剪贴板（原型演示）'); return; }
    if (action === 'raw') { state.menu = null; state.dialog = { kind: 'detail', id }; paint(); return; }

    if (action === 'check-all') {
      state.checking = true; paint();
      later(() => {
        state.accounts.forEach(checkAccount);
        state.checking = false;
        persist(); paint();
        const bad = state.accounts.filter(acc => acc.status !== 'ok').length;
        toast(bad ? `批量体检完成：${bad} 个账号存在异常项，已标色` : '批量体检完成：全部账号环境就绪');
      }, 1400);
      return;
    }
    if (action === 'check-account') {
      const acc = account(id);
      if (!acc) return;
      checkAccount(acc);
      persist(); paint();
      toast(`${acc.name} 体检完成：${acc.note}`);
      return;
    }
    if (action === 'proxy') { toast('原型演示：代理配置面板未接入，可先手动填写代理地址'); return; }
    if (action === 'rescan') {
      const acc = account(id);
      if (!acc) return;
      acc.cookie = '本地加密 Cookie · 有效';
      acc.status = 'ok';
      acc.note = '独立环境已启用（重新扫码绑定成功）';
      acc.checked = now();
      state.tasks.filter(task => task.accountId === acc.id && task.status === 'blocked').forEach(task => { task.status = 'queued'; task.reason = null; task.progress = 0; });
      persist(); paint();
      toast(`${acc.name} 重新扫码成功，阻塞任务已回到排队中`);
      return;
    }
    if (action === 'add-account') { state.adding = { platform: '快手', scanning: false, note: null }; paint(); return; }
    if (action === 'pick-platform') { state.adding.platform = trigger.dataset.value; state.adding.note = null; paint(); return; }
    if (action === 'scan-ok') {
      state.adding.scanning = true;
      state.adding.note = '正在创建独立隔离环境…';
      paint();
      later(() => {
        const index = state.accounts.length + 1;
        state.accounts.push({ id: `acc-${String(index).padStart(2, '0')}-${Date.now().toString(36)}`, platform: state.adding.platform, name: `老葛严选${String(index).padStart(2, '0')}`, uid: `laoge_xs${String(index).padStart(2, '0')}`, status: 'ok', fingerprint: '独立设备指纹 · 已启用', proxy: `112.65.**.${20 + index}:8123`, speed: 150 + index * 12, cookie: '本地加密 Cookie · 有效', note: '独立环境已启用', checked: now() });
        state.adding = null;
        persist(); paint();
        toast('账号绑定成功，独立隔离环境已创建');
      }, 1300);
      return;
    }
    if (action === 'scan-fail') { state.adding.scanning = false; state.adding.note = '扫码失败：未收到手机端确认，可重试；已有账号与环境不受影响。'; paint(); return; }
    if (action === 'new-timed') {
      const soon = new Date(Date.now() + 5 * 60000);
      state.publishDraft = null;
      state.timedDraft = { accountId: (state.accounts.find(acc => acc.status === 'ok') || state.accounts[0])?.id || '', recordId: '', when: localStamp(soon) };
      paint();
      return;
    }
    if (action === 'create-timed') { createTimed(); return; }
  };

  /* 定时任务 ID 取现有最大值 +1，避免取消任务后与新任务撞号 */
  const nextTaskId = () => `P${String(Math.max(0, ...state.tasks.map(task => Number(String(task.id).slice(1)) || 0)) + 1).padStart(4, '0')}`;
  const pad = value => String(value).padStart(2, '0');
  const localStamp = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

  const createTimed = () => {
    const draft = state.timedDraft;
    if (!draft?.accountId || !draft.recordId) return;
    const when = Date.parse(draft.when);
    if (!(when > Date.now())) { toast('排期需晚于当前时间'); return; }
    const acc = account(draft.accountId);
    const source = publishableRecords().find(item => item.id === draft.recordId);
    if (!acc || !source) return;
    const base = source.row || source.task;
    const product = source.row
      ? { name: base.name, price: base.price, productId: base.productId, platformId: base.platformId, cat: base.cat }
      : base.product;
    const id = nextTaskId();
    const stamp = new Date(when);
    const planned = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
    state.tasks.unshift({
      id, recordId: source.id, accountId: acc.id, status: 'queued', progress: 0, actual: null, planned, plannedAt: draft.when,
      created: now(), product, duration: base.duration,
      title: `${product.name.slice(0, 18)} #老葛严选`, attempts: 0, resubmits: 0, timed: true, raw: null,
      precheck: runPrecheck({ ...product, title: '' }, acc).checks,
    });
    state.timedDraft = null;
    persist(); paint();
    toast(`已创建定时任务 ${id}（${planned}），托盘常驻执行，偏差 ≤60 秒`);
  };

  const onInput = event => {
    const key = event.target.dataset?.pubFilter;
    if (key) state.filters[key] = event.target.value;
    if (event.target.dataset?.pub === 'pick-when' && state.timedDraft) { state.timedDraft.when = event.target.value; return paintKeepingFocus(); }
    if (event.target.dataset?.pub === 'prepare-title' && state.publishDraft) {
      state.publishDraft.title = String(event.target.value || '').slice(0, 120);
      const submit = document.querySelector('[data-pub="prepare-submit"]');
      if (submit) submit.disabled = !publishDraftValid(state.publishDraft);
      return;
    }
  };

  const onChange = event => {
    const key = event.target.dataset?.pubFilter;
    if (key) { state.filters[key] = event.target.value; return paint(); }
    if (event.target.dataset?.pub === 'pick-account' && state.timedDraft) { state.timedDraft.accountId = event.target.value; return paint(); }
    if (event.target.dataset?.pub === 'pick-record' && state.timedDraft) { state.timedDraft.recordId = event.target.value; return paint(); }
    if (state.publishDraft) {
      const field = { 'prepare-account': 'accountId', 'prepare-mode': 'mode', 'prepare-when': 'when' }[event.target.dataset?.pub];
      if (field) { state.publishDraft[field] = event.target.value; return paint(); }
    }
    if (event.target.dataset?.pub === 'select') {
      const id = event.target.dataset.id;
      const task = find(id);
      if (!task || !canResubmit(task)) return;
      state.selected = event.target.checked ? [...state.selected, id] : state.selected.filter(item => item !== id);
      return paint();
    }
    if (event.target.dataset?.pub === 'toggle-all') {
      const rows = filtered().filter(canResubmit);
      state.selected = event.target.checked ? rows.map(task => task.id) : [];
      return paint();
    }
  };

  /* ---------- 跨模块入口：生成记录「批量发布」交接（PRD §6.3） ---------- */
  const ingest = records => {
    const report = { created: now(), items: [], enqueued: 0, blocked: 0 };
    records.forEach((record, index) => {
      const acc = state.accounts.find(item => item.name === record.account) || state.accounts[index % state.accounts.length] || state.accounts[0];
      const payload = { ...record, title: String(record.title || `${record.name.slice(0, 18)} #老葛严选`).trim().slice(0, 120) };
      const result = runPrecheck(payload, acc);
      const id = nextTaskId();
      const plannedAt = Date.parse(record.plannedAt) > Date.now() ? record.plannedAt : null;
      const task = {
        id, recordId: record.recordId, accountId: acc.id, status: result.hardFailed ? 'precheck' : 'queued', progress: 0,
        actual: null, planned: plannedAt ? localStamp(new Date(plannedAt)).replace('T', ' ') : '立即发布', created: now(),
        product: { name: record.name, price: record.price, productId: record.productId, platformId: record.platformId, cat: record.cat },
        duration: record.duration, resultKind: record.resultKind || '', title: payload.title, attempts: 0, resubmits: 0, timed: Boolean(plannedAt), ...(plannedAt ? { plannedAt } : {}),
        reason: result.hardFailed ? `硬性项未过：${result.notes.filter(note => note.includes('硬性')).join('；')}` : (result.softWarn ? result.notes.join('；') : null),
        raw: null, precheck: result.checks,
      };
      state.tasks.unshift(task);
      if (result.hardFailed) report.blocked += 1; else report.enqueued += 1;
      report.items.push({ id, account: acc.name, checks: result.checks, note: result.notes.join('；') || '五项扫描全部通过，已入队等待并发位。', hardFailed: result.hardFailed, softWarn: result.softWarn });
    });
    state.report = report;
    persist();
    if (document.querySelector('.ec-video-publishing')) paint();
    return records.length;
  };

  const prepare = value => {
    if (!currentAccountId) return false;
    const id = typeof value === 'string' ? value : value?.id || value?.recordId;
    const row = preparedRecord(id);
    if (!row) return false;
    if (state.publishDraft?.recordId !== id) state.publishDraft = {
      recordId: id,
      accountId: state.accounts.find(acc => acc.status === 'ok')?.id || state.accounts.find(acc => acc.status !== 'danger')?.id || '',
      title: `${row.name.slice(0, 18)} #老葛严选`, mode: 'now', when: localStamp(new Date(Date.now() + 5 * 60000)),
    };
    state.dialog = null; state.confirm = null; state.report = null; state.timedDraft = null; state.adding = null; state.menu = null;
    if (document.querySelector('.ec-video-publishing')) paint();
    return true;
  };

  const submitPrepared = () => {
    const draft = state.publishDraft;
    if (!publishDraftValid(draft)) { toast('请确认成片、发布账号、标题与发布时间'); return; }
    const row = preparedRecord(draft.recordId);
    const acc = account(draft.accountId);
    state.publishDraft = null;
    const created = ingest([{ ...row, recordId: row.id, account: acc.name, title: draft.title, ...(draft.mode === 'timed' ? { plannedAt: draft.when } : {}) }]);
    if (created) window.EcommerceVideoRecords?.markSubmitted?.(row.id);
    toast('已提交发布设置，进入发布预检流程');
  };

  const setAccount = value => {
    const id = typeof value === 'string' ? value : '';
    const changed = accountScope.setAccount(id);
    currentAccountId = id;
    return changed;
  };

  window.EcommerceVideoPublishing = {
    setAccount,
    html,
    mount,
    ingest,
    prepare,
    setOffline: value => { state.offline = Boolean(value); if (document.querySelector('.ec-video-publishing')) paint(); },
    tasks: () => state.tasks,
    accounts: () => state.accounts,
    /* 从生成记录「查看发布任务」跳进来：按生成记录ID筛，只看这一条的发布台账 */
    focusRecord: recordId => {
      if (!recordId) return false;
      state.filters = { ...blankFilters(), q: recordId };
      state.applied = { ...state.filters };
      if (document.querySelector('.ec-video-publishing')) paint();
      return state.tasks.some(task => task.recordId === recordId);
    },
    reset: () => { clearTimers(); ticker = null; state = blank(); persist(); },
    statusLabel: status => STATUS[status]?.label || status,
  };
})();
