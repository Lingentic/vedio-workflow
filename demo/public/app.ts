import { bindSortableList } from './sortable.js';

type Stage = 'copy' | 'voice' | 'visual' | 'preview';
type TaskStatus = 'running' | 'done' | 'failed' | 'stopped' | 'interrupted';
interface Template { id: string; name: string; title: string; summary: string; nodes: ScriptNode[]; variableNodeId?: string; }
interface ScriptNode { id: string; type: 'host_clip' | 'fixed_narration' | 'generated_narration'; text: string; label?: string; }
interface Product { productId: string; name: string; price: string; specification: string; sellingPoints: string; createdAt?: string; }
interface Asset { id: string; createdAt?: string; productId?: string; kind: 'product' | 'source' | 'host' | 'presenter' | 'bgm'; title: string; status: 'ready' | 'pending' | 'failed' | 'partial' | 'deleted' | 'unavailable'; duration: number; width?: number; height?: number; size?: number; videoStart?: number; binding?: string; processed?: boolean; parentId?: string; error?: string; cuts?: number[]; cleaned?: boolean; url?: string; posterUrl?: string; available?: boolean; }
interface Cue { text: string; begin: number; end: number; nodeId?: string; }
interface Interval { id: string; nodeIds: string[]; text: string; signature: string; status: 'missing' | 'ready' | 'failed'; confirmed: boolean; audioUrl?: string; duration?: number; cues?: Cue[]; nodeTimes?: { id: string; begin: number; end: number }[]; error?: string; }
interface QueueEntry { entryId: string; assetId: string; title: string; duration: number; url?: string; posterUrl?: string; available: boolean; }
interface PicturePiece { mode: 'product' | 'host' | 'presenter'; start: number; duration: number; assetId?: string; productAssetId?: string; sourceStart?: number; productStart?: number; }
interface Plan { mode: 'auto' | 'manual'; entries: QueueEntry[]; requiredDuration: number; availableDuration: number; valid: boolean; repeated: boolean; warnings: string[]; events: PicturePiece[]; pieces: PicturePiece[]; signature: string; duration: number; }
interface Preview { relativePath: string; duration: number; width: number; height: number; fps: number; size: number; signature: string; createdAt: string; url: string; }
interface Execution { id: string; kind: 'copy' | 'voice' | 'render'; status: TaskStatus; progress: number; message: string; startedAt: string; finishedAt?: string; }
interface Task { id: string; name: string; productId: string; templateId: string; productSnapshot: Product; templateSnapshot: Template; variable: string; example: string; black: Record<string, string>; nodes: ScriptNode[]; confirmedNodes?: ScriptNode[]; stage: Stage; copyConfirmed: boolean; audioConfirmed: boolean; intervals: Interval[]; plan: Plan | null; settings: { subtitles: boolean; bgmId: string | null; bgmVolume: number }; preview: Preview | null; previewStale: boolean; previewChanges?: string[]; completed: boolean; execution: Execution | null; error: string; notice?: string; createdAt: string; updatedAt: string; }
interface AppState { configured: boolean; dataRoot: string; defaultDataRoot: string; modelReady: boolean; toolsReady: boolean; templates: Template[]; products: Product[]; assets: Asset[]; tasks: Task[]; bgms: Asset[]; seedAvailable: boolean; activeExecution: ({ taskId: string } & Execution) | null; libraryBusy?: boolean; libraryMessage?: string; }
interface ApiError { error?: string; message?: string; }
type Page = 'collection' | 'production' | 'library' | 'records' | 'task';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('页面容器缺失');
let state: AppState | null = null;
interface UiPointer { page: Page; taskId: string; }
const UI_POINTER_KEY = 'video-workbench-ui-v1';
let savedPointer: UiPointer | null = null;
try { savedPointer = JSON.parse(localStorage.getItem(UI_POINTER_KEY) || 'null') as UiPointer | null; } catch { savedPointer = null; }
const entryParams = new URLSearchParams(location.search);
const entryPage = entryParams.get('page');
let page: Page = savedPointer?.page === 'collection' || savedPointer?.page === 'task' || savedPointer?.page === 'library' || savedPointer?.page === 'records' ? savedPointer.page : 'production';
if (entryPage === 'collection' || entryPage === 'library' || entryPage === 'production' || entryPage === 'records') page = entryPage;
let selectedTaskId = savedPointer?.taskId || '';
let libraryTab = 'product';
let libraryMediaType: 'all' | 'video' | 'image' | 'audio' = 'all';
let libraryGroup: 'product' | 'presenter' = entryParams.has('productId') ? 'product' : 'presenter';
let libraryFolder = 'all';
let librarySearch = '';
let libraryProductQuery = '';
let productionTemplateId = '';
let productionProductId = '';
let libraryProductId = entryParams.get('productId') || 'all';
let libraryPickerListeners: AbortController | undefined;
let libraryPickerElement: HTMLElement | undefined;
const boundElements = new WeakSet<HTMLElement>();
const renderedNodes = new WeakMap<Node, Node>();
interface RecordFilters { keyword: string; status: string; from: string; to: string; }
let recordFilters: RecordFilters = { keyword: '', status: '', from: '', to: '' };
let appliedRecordFilters = { ...recordFilters };
let toastTimer = 0;
let taskPoll: number | undefined;
const pendingTaskPatches = new Map<string, Record<string, unknown>>();
const draftTimers = new Map<string, number>();
const draftFlushes = new Map<string, Promise<void>>();
const draftWarnings = new Set<string>();
let manualSelection: string[] = [];
let manualSelectionTaskId = '';
let manualSelectionBaseline: string[] = [];
let manualSortBusy = false;
let bgmAudition: HTMLAudioElement | undefined;
let bgmAuditionTaskId = '';
let bgmAuditionAssetId = '';
const recordCovers = new Map<string, string>();
const previewPrompts = new Map<string, string>();
const productIcon = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m24 5 17 9v20l-17 9-17-9V14Z"/><path d="m7 14 17 10 17-10M24 24v19M16 10l17 10v8"/></svg>';

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
const money = (value: string): string => value ? (value.includes('¥') ? value : `¥${value}`) : '未填写';
const duration = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const dateText = (value: string): string => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const statusName = (value: string): string => ({ ready: '可使用', pending: '待处理', failed: '处理失败', partial: '部分完成', deleted: '已删除', unavailable: '暂不可用', missing: '待生成', running: '进行中', done: '已完成', stopped: '已停止', interrupted: '已中断', copy: '文案', voice: '配音', render: '合成' })[value] ?? value;
const stageName = (value: Stage): string => ({ copy: '文案', voice: '配音', visual: '画面', preview: '成片' })[value];
const isImageAsset = (asset: Asset): boolean => /\.(png|jpe?g|webp|avif|gif|bmp|tiff?)$/i.test(asset.title);
const productAssets = (productId: string): Asset[] => (state?.assets ?? []).filter(asset => asset.productId === productId);
const readyProductAssets = (productId: string): Asset[] => productAssets(productId).filter(asset => asset.kind === 'product' && asset.status === 'ready' && !asset.cleaned && !isImageAsset(asset));
const selectedTask = (): Task | undefined => state?.tasks.find(task => task.id === selectedTaskId);
const matchesSearch = (query: string, ...values: string[]): boolean => {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
  const text = normalize(values.join(' '));
  return normalize(query).trim().split(/\s+/).every(word => text.includes(word));
};
const taskFilterStatus = (task: Task): string => task.completed ? 'completed' : task.execution?.status === 'running' ? 'running' : task.error ? 'error' : 'incomplete';
const localDay = (value: string): string => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };

async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error(`本地服务返回了无法读取的响应（HTTP ${response.status}），请检查服务状态`); }
  if (!response.ok) throw new Error((payload as ApiError).message || `请求失败 (${response.status})`);
  return payload as T;
}
async function refresh(keepPage = true): Promise<void> {
  state = await api<AppState>('/api/state');
  if (selectedTaskId && !state.tasks.some(task => task.id === selectedTaskId)) selectedTaskId = '';
  if (!keepPage && page === 'task' && !selectedTaskId) page = 'production';
  if (pendingTaskPatches.size === 0 && draftFlushes.size === 0) render();
  if (state.activeExecution || state.libraryBusy) startPolling(); else stopPolling();
}
function rememberPointer(): void { try { localStorage.setItem(UI_POINTER_KEY, JSON.stringify({ page, taskId: selectedTaskId } satisfies UiPointer)); } catch { /* storage may be unavailable */ } }
function startPolling(): void { if (taskPoll !== undefined) return; taskPoll = window.setInterval(() => { void refresh().catch(showError); }, 1100); }
function stopPolling(): void { if (taskPoll !== undefined) window.clearInterval(taskPoll); taskPoll = undefined; }
function showToast(message: string, error = false): void {
  document.querySelector('.toast')?.remove();
  const element = document.createElement('div'); element.className = `toast${error ? ' error' : ''}`; element.textContent = message; document.body.append(element);
  window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => element.remove(), 3600);
}
function showError(error: unknown): void { showToast(error instanceof Error ? error.message : String(error), true); }
async function mutate(url: string, method = 'POST', body?: unknown, success?: string): Promise<unknown> {
  try { const result = await api<unknown>(url, method, body); if (success) showToast(success); await refresh(); return result; }
  catch (error) { showError(error); throw error; }
}
function navButton(id: Page, icon: string, label: string, description = ''): string {
  const active = page === id || (id === 'production' && page === 'task');
  return `<button class="${active ? 'active' : ''}" data-page="${id}" aria-pressed="${active}" title="${label}"><i class="nav-icon" aria-hidden="true">${icon}</i><span><strong>${label}</strong><small>${description}</small></span></button>`;
}
const collector = (window as unknown as { EcommerceVideoProducts: {
  setAccount(id: string): void; html(): string; mount(root: HTMLElement, options: { toast: typeof showToast; goto: (page: string, productId?: string) => void }): void;
} }).EcommerceVideoProducts;
let collectionLoadError = '';
try {
  const collectApi = (window as unknown as { CollectApi?: { migrateLegacyStorage(): Promise<void> } }).CollectApi;
  if (!collector || !collectApi) throw new Error('商品获取组件未加载，请重启工作台服务后刷新页面。');
  await collectApi.migrateLegacyStorage();
  collector.setAccount('local');
} catch (error) { collectionLoadError = error instanceof Error ? error.message : String(error); }
let collectorMounted: HTMLElement | null = null;
function mountCollection(): void {
  const container = document.querySelector<HTMLElement>('[data-collection-root]');
  if (!container || container === collectorMounted) return;
  if (collectionLoadError) { container.innerHTML = `<div class="notice">${esc(collectionLoadError)}</div>`; return; }
  container.innerHTML = collector.html();
  collector.mount(container, { toast: showToast, goto: (_target, productId) => {
    libraryGroup = 'product'; libraryProductId = productId || 'all'; libraryFolder = 'all';
    void refresh().then(() => navigate('library')).catch(showError);
  } });
  collectorMounted = container;
}
function shell(content: string): string {
  return `<div class="shell pm-workflow"><header class="workspace-header"><div class="workspace-brand"><img src="/brand.png" alt="" width="34" height="34"><div><strong>电商AI视频工作流</strong><span>本地视频工作台</span></div></div><div class="top-actions"><span class="connection"><i class="dot"></i>本地服务已连接</span><button class="icon-button" data-action="refresh" title="刷新工作区" aria-label="刷新工作区">↻</button></div></header><aside class="sidebar"><div class="workflow-nav-title">工作流程</div><nav class="nav" aria-label="电商视频工作流模块">${navButton('collection','商','商品获取','商品资料录入与联网爬取')}${navButton('production','制','视频制作','脚本编排与视频生成')}${navButton('records','记','生成记录','制作进度与成片台账')}${navButton('library','材','素材中心','素材管理与处理')}</nav><div class="side-spacer"></div><div class="sidebar-footer"><span class="local-mode"><i class="dot"></i>本地工作区</span><button class="button folder-setting" data-action="change-root">管理数据目录</button><div class="local-note" title="${esc(state?.dataRoot ?? '')}">${esc(state?.dataRoot ?? '')}</div></div></aside><main class="main" data-ui-key="workspace:${page}:${page === 'task' ? esc(selectedTaskId) : ''}"><div class="page" data-ui-key="page:${page}:${page === 'task' ? esc(selectedTaskId) : ''}">${content}</div></main></div>`;
}
function patchView(container: HTMLElement, markup: string): void {
  const template = document.createElement('template'); template.innerHTML = markup;
  const key = (node: Node): string | null => node instanceof Element ? node.getAttribute('data-ui-key') || node.id || null : null;
  const remember = (live: Node, next: Node): void => {
    renderedNodes.set(live, next);
    [...live.childNodes].forEach((child, index) => remember(child, next.childNodes[index]));
  };
  const children = (live: Node, next: Node): void => {
    const keyed = new Map([...live.childNodes].filter(node => key(node)).map(node => [key(node), node]));
    let cursor: Node | null = live.firstChild;
    for (const desired of next.childNodes) {
      const desiredKey = key(desired);
      let current: Node | undefined = desiredKey ? keyed.get(desiredKey) : cursor && !key(cursor) ? cursor : undefined;
      if (current && (current.nodeType !== desired.nodeType || current.nodeName !== desired.nodeName)) current = undefined;
      if (!current) { current = desired.cloneNode(true); remember(current, desired); live.insertBefore(current, cursor); }
      else {
        if (current !== cursor) live.insertBefore(current, cursor);
        update(current, desired);
      }
      cursor = current.nextSibling;
    }
    while (cursor) { const obsolete = cursor; cursor = cursor.nextSibling; live.removeChild(obsolete); }
  };
  const update = (live: Node, next: Node): void => {
    if (live instanceof HTMLElement && live.hasAttribute('data-collection-root')) return;
    const previous = renderedNodes.get(live);
    if (previous?.isEqualNode(next)) return;
    if (live instanceof Element && next instanceof Element) {
      const before = previous instanceof Element ? previous : live;
      for (const attr of [...before.attributes]) if (!next.hasAttribute(attr.name)) live.removeAttribute(attr.name);
      for (const attr of next.attributes) if (before.getAttribute(attr.name) !== attr.value) live.setAttribute(attr.name, attr.value);
      if (live instanceof HTMLTextAreaElement && next instanceof HTMLTextAreaElement) {
        if (document.activeElement !== live && live.value !== next.value) live.value = next.value;
      } else {
        children(live, next);
        if (live instanceof HTMLInputElement && next instanceof HTMLInputElement && document.activeElement !== live) {
          if (live.type !== 'file' && live.value !== next.value) live.value = next.value;
          if (live.checked !== next.checked) live.checked = next.checked;
        }
        if (live instanceof HTMLSelectElement && next instanceof HTMLSelectElement && document.activeElement !== live && live.value !== next.value) live.value = next.value;
      }
    } else if (live.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue;
    renderedNodes.set(live, next);
  };
  children(container, template.content);
}
function render(): void {
  if (!state || !root || manualSortBusy) return;
  const auditionTask = page === 'task' ? selectedTask() : undefined;
  if (bgmAudition && (!auditionTask || auditionTask.stage !== 'visual' || auditionTask.id !== bgmAuditionTaskId || auditionTask.settings.bgmId !== bgmAuditionAssetId)) stopBgmAudition();
  rememberPointer();
  if (!state.configured) { patchView(root, renderSetup()); bind(); return; }
  let content = page === 'collection' ? '<section data-collection-root></section>' : page === 'library' ? renderLibrary() : page === 'records' ? renderRecords() : page === 'task' && selectedTask() ? renderTask(selectedTask()!) : renderProduction();
  if (page === 'task' && !selectedTask()) page = 'production';
  const url = new URL(location.href); url.searchParams.set('page', page);
  if (page === 'library' && libraryProductId !== 'all') url.searchParams.set('productId', libraryProductId);
  else url.searchParams.delete('productId');
  history.replaceState(null, '', url);
  patchView(root, shell(content));
  bind();
  mountCollection();
  updateBgmAuditionButton();
  const task = page === 'task' ? selectedTask() : undefined;
  if (task?.stage === 'preview' && task.previewStale && !task.completed && task.execution?.status !== 'running' && !document.querySelector('.modal-backdrop')) {
    const key = JSON.stringify([task.preview?.url, task.settings, task.black, task.variable, task.plan?.signature, task.intervals.map(interval => [interval.signature, interval.duration, interval.audioUrl]), task.previewChanges]);
    if (previewPrompts.get(task.id) !== key) { previewPrompts.set(task.id, key); showRegenerationDialog(task); }
  }
}
function renderSetup(): string {
  return `<div class="shell"><main class="main" style="grid-column:1/-1"><div class="page" style="max-width:600px;padding-top:15vh"><h1>设置本地工作目录</h1><p class="subhead">素材、文案与生成记录将保存在你选择的目录中，原视频不会被移动或覆盖。</p><div class="card" style="margin-top:24px"><label class="field-label" for="data-root">数据目录</label><input id="data-root" class="input" value="${esc(state!.defaultDataRoot)}"><div class="row" style="justify-content:space-between;margin-top:14px"><span class="section-hint">使用 Videos 下的独立目录</span><button class="button" data-action="choose-folder" data-target="data-root">选择文件夹</button></div><div class="modal-footer"><button class="button primary" data-action="setup">开始使用</button></div></div></div></main></div>`;
}
function productionSteps(task?: Task): string {
  const index = !task ? 0 : task.stage === 'copy' ? 1 : 2;
  return `<nav class="production-steps" aria-label="视频制作流程"><ol>${['架构模版','文案','视频生成'].map((label, at) => `<li><button type="button" class="${at === index ? 'active' : ''}" ${at === index ? 'aria-current="step"' : ''} ${task ? at === 0 ? 'data-action="switch-task"' : `data-stage="${at === 1 ? 'copy' : task.audioConfirmed ? 'visual' : 'voice'}"` : 'disabled'} ${task?.completed ? 'disabled' : ''}><i>${at + 1}</i><strong>${label}</strong></button></li>`).join('')}</ol></nav>`;
}
function templateArchitecture(template: Template): string {
  const groups: ScriptNode[][] = [];
  for (const node of template.nodes) {
    if (node.type === "host_clip" || !groups.length || groups.at(-1)![0].type === "host_clip") groups.push([node]);
    else groups.at(-1)!.push(node);
  }
  return `<ol class="architecture-rows">${groups.map((nodes,index) => {
    const host = nodes[0].type === "host_clip";
    const title = nodes[0].label || (host ? "固定主播原片" : nodes.some(node => node.type === "fixed_narration") ? "连续口播 · 固定与商品文案" : "商品文案");
    return `<li class="architecture-row"><i>${String(index + 1).padStart(2,"0")}</i><div><h3>${esc(title)}</h3><p>${nodes.map(node => `<span class="architecture-copy ${node.type}">${node.type === "generated_narration" ? `<span class="architecture-placeholder">〔待填充〕</span>` : esc(node.text)}</span>`).join("")}</p></div><span class="node-kind">${host ? "主播原声" : "AI口播"}</span></li>`;
  }).join("")}</ol>`;
}
function renderProduction(): string {
  const drafts = state!.tasks.filter(task => !task.completed).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!state!.templates.some(item => item.id === productionTemplateId)) productionTemplateId = state!.templates[0]?.id || '';
  if (!state!.products.some(item => item.productId === productionProductId)) productionProductId = state!.products[0]?.productId || '';
  const template = state!.templates.find(item => item.id === productionTemplateId);
  return `${productionSteps()}<div class="page-head"><div><h1>选择架构模版</h1><p class="subhead">选择商品与固定架构，开始一条新视频。</p></div><button class="button" data-page="records">查看生成记录</button></div>${state!.libraryBusy ? `<div class="busy-bar"><span class="spinner"></span>${esc(state!.libraryMessage || '正在整理素材…')}</div>` : ''}<section class="architecture-layout"><form class="card production-config" data-form="new-task"><span class="section-kicker">新建制作</span><h2>商品与架构</h2><label class="field-label" for="production-product">选择商品</label><select id="production-product" class="select" name="productId" data-production-product ${state!.products.length ? '' : 'disabled'}><option value="" ${productionProductId ? 'hidden' : ''}>请选择商品</option>${state!.products.map(product => `<option value="${esc(product.productId)}" ${product.productId === productionProductId ? 'selected' : ''}>${esc(product.name)}</option>`).join('')}</select><label class="field-label" for="production-template">架构模版</label><select id="production-template" class="select" name="templateId" data-production-template>${state!.templates.map(item => `<option value="${esc(item.id)}" ${item.id === productionTemplateId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select><p class="production-template-note">${esc(template?.summary || '')}</p>${!state!.products.length ? '<div class="notice">先录入商品，或从素材中心添加商品资料。</div><button type="button" class="button" data-action="open-collect">前往商品获取</button>' : ''}<button class="button primary production-next" ${!productionProductId || !productionTemplateId || state!.activeExecution ? 'disabled' : ''}>下一步：文案 →</button></form><section class="card architecture-preview" aria-label="架构模版内容"><header><h2>${esc(template?.title || '架构预览')}</h2><div class="architecture-legend"><span class="host-legend">主播原声</span><span class="fixed-legend">固定口播</span><span>商品文案</span></div></header>${template ? templateArchitecture(template) : '<div class="empty">暂无可用模版</div>'}</section></section><div class="section-head"><h2 class="section-title">继续已有任务 <span class="section-count">${drafts.length}</span></h2></div><div class="task-list">${drafts.length ? drafts.map(taskRow).join('') : '<div class="card empty"><strong>暂无可继续的任务</strong>开始制作后，未完成的编辑会保存在这里。</div>'}</div>`;
}
function renderRecords(): string {
  const filters = appliedRecordFilters;
  const tasks = state!.tasks.filter(task => matchesSearch(filters.keyword, task.name, task.id, task.productId, task.productSnapshot.name, task.templateSnapshot.name)
    && (!filters.status || (filters.status === 'incomplete' ? !task.completed : taskFilterStatus(task) === filters.status))
    && (!filters.from || localDay(task.createdAt) >= filters.from)
    && (!filters.to || localDay(task.createdAt) <= filters.to)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  return `<div class="page-head" data-ui-key="page-heading"><div><h1>生成记录</h1><p class="subhead">查看制作进度、继续编辑与导出已完成的视频。</p></div><div class="record-summary"><span>共 ${state!.tasks.length} 条</span><span class="summary-complete">已完成 ${state!.tasks.filter(task => task.completed).length}</span><button class="button primary" data-page="production">＋ 去视频制作</button></div></div>
  <form class="card record-filters" data-record-search>
    <label class="record-keyword">关键词<input type="search" class="input" name="keyword" placeholder="搜索任务、商品名称或 ID" value="${esc(recordFilters.keyword)}"></label>
    <label>任务状态<select class="select" name="status">${[['','全部状态'],['incomplete','未完成'],['running','进行中'],['error','有错误'],['completed','已完成']].map(([value,label]) => `<option value="${value}" ${recordFilters.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label>创建日期起<input type="date" class="input" name="from" value="${esc(recordFilters.from)}"></label><label>创建日期止<input type="date" class="input" name="to" value="${esc(recordFilters.to)}"></label>
    <div class="row record-filter-actions"><button class="button primary" type="submit">搜索</button><button class="button" type="button" data-reset-record-search>重置</button></div>
  </form><p class="section-hint" data-record-count>找到 ${tasks.length} 条记录 · 共 ${state!.tasks.length} 条</p>
  <div class="card records-card"><div class="records-head"><span>任务 ID</span><span>视频任务</span><span>任务状态</span><span>制作进度</span><span>最近更新</span><span>操作</span></div>${tasks.length ? tasks.map(task => {
    const previewValid = !!task.preview && !task.previewStale;
    const status = task.completed ? '已完成' : task.execution?.status === 'running' ? `${statusName(task.execution.kind)}中 ${task.execution.progress}%` : task.error ? '有错误' : '未完成';
    const images = state!.assets.filter(asset => asset.productId === task.productId && asset.available && isImageAsset(asset));
    let cover = images.find(asset => asset.id === recordCovers.get(task.productId));
    if (!cover && images.length) { cover = images[Math.floor(Math.random() * images.length)]; recordCovers.set(task.productId, cover.id); }
    return `<div class="record-row" data-ui-key="record:${esc(task.id)}"><span class="record-id" title="${esc(task.id)}">${esc(task.id.slice(0,8))}</span><div class="record-overview"><div class="record-cover">${cover ? `<img src="${esc(cover.url)}" alt="${esc(task.productSnapshot.name)}">` : productIcon}</div><div><div class="task-name">${esc(task.name)}</div></div></div><span class="badge ${task.completed ? 'green' : task.error ? 'red' : task.execution?.status === 'running' ? 'amber' : ''}">${status}</span><div class="record-stage"><span>${task.completed ? '成片已确认' : stageName(task.stage)}</span>${task.execution?.status === 'running' ? `<progress max="100" value="${task.execution.progress}"></progress>` : ''}</div><span class="section-hint">${dateText(task.updatedAt)}</span><div class="row record-actions">${task.completed ? `<button class="button small" data-action="record-open" data-id="${esc(task.id)}">查看成片</button><button class="button small" data-action="record-export" data-id="${esc(task.id)}" ${previewValid ? '' : 'disabled'}>导出副本</button>` : `<button class="button small primary" data-action="record-open" data-id="${esc(task.id)}">继续</button>`}</div></div>`;
  }).join('') : `<div class="empty"><strong>${state!.tasks.length ? '没有匹配的记录' : '还没有生成记录'}</strong>${state!.tasks.length ? '试试其他关键词，或重置筛选条件。' : '创建任务后，草稿与成片都会保存在这里。'}</div>`}</div>`;
}
function taskRow(task: Task): string {
  const running = task.execution?.status === 'running';
  const progress = running ? task.execution!.progress : task.completed ? 100 : Math.round(({ copy: 14, voice: 38, visual: 63, preview: 88 }[task.stage]));
  const badge = task.completed ? 'green' : task.error ? 'red' : running ? 'amber' : '';
  return `<div class="task-row" data-ui-key="task:${esc(task.id)}" data-open-task="${esc(task.id)}"><div><div class="task-name">${esc(task.name)}</div><div class="task-meta">${dateText(task.updatedAt)}</div></div><div class="task-progress"><div class="progress"><i style="width:${progress}%"></i></div><span class="stage-text">${running ? statusName(task.execution!.kind) + '中' : task.completed ? '已完成' : stageName(task.stage)}</span></div><span class="badge ${badge}">${task.completed ? '成片已完成' : task.error ? '有错误' : running ? task.execution!.progress + '%' : '继续编辑'}</span><span style="color:#9da39a">›</span></div>`;
}
function productCard(product: Product): string {
  const assets = readyProductAssets(product.productId); const poster = assets.find(asset => asset.posterUrl)?.posterUrl;
  return `<article class="card product-card"><div class="product-cover">${poster ? `<img src="${esc(poster)}" alt="">` : `<span class="placeholder">▧</span>`}<span class="cover-count">${assets.length} 段素材</span></div><div class="product-info"><div class="product-title">${esc(product.name)}</div><div class="product-detail">${esc(money(product.price))} · ${esc(product.specification || '规格待补充')}</div></div></article>`;
}
function libraryProductOptions(query: string): string {
  const products = state!.products.filter(product => matchesSearch(query, product.name, product.productId));
  const options = products.map(product => ({ id: product.productId, title: product.name, detail: `ID ${product.productId}`, count: `${readyProductAssets(product.productId).length} 段素材` }));
  if (!query.trim()) options.unshift({ id: 'all', title: '全部商品', detail: '查看所有商品的素材', count: `${state!.products.length} 个商品` });
  return options.length ? options.map((option, index) => `<button type="button" role="option" tabindex="-1" id="library-product-option-${index}" class="product-picker-option" data-product-option="${esc(option.id)}" aria-selected="${libraryProductId === option.id}"><span><strong>${esc(option.title)}</strong><small>${esc(option.detail)}</small></span><span class="product-picker-count">${esc(option.count)}${libraryProductId === option.id ? ' ✓' : ''}</span></button>`).join('') : '<div class="product-picker-empty">没有匹配的商品</div>';
}
function assetMediaKind(asset: Asset): 'video' | 'image' | 'audio' {
  return isImageAsset(asset) ? 'image' : asset.kind === 'bgm' ? 'audio' : 'video';
}
function renderLibrary(): string {
  const products = state!.products;
  if (libraryProductId !== 'all' && !products.some(product => product.productId === libraryProductId)) libraryProductId = 'all';
  const all = state!.assets.filter(asset => asset.status !== 'deleted' && !asset.cleaned);
  const isProduct = (asset: Asset) => asset.kind === 'product' || asset.kind === 'source';
  const scope = all.filter(asset => libraryGroup === 'product' ? isProduct(asset) : !isProduct(asset));
  const selectedProduct = libraryGroup === 'product' ? products.find(product => product.productId === libraryProductId) : undefined;
  const folderNames: Record<string,string> = { all:'全部素材', host:'固定主播原片', presenter:'通用主播画面', bgm:'背景音乐' };
  const folderList = scope.filter(asset => libraryGroup === 'product' ? libraryProductId === 'all' || asset.productId === libraryProductId : libraryFolder === 'all' || asset.kind === libraryFolder);
  const statusList = folderList.filter(asset => libraryTab === 'product' ? asset.status === 'ready' && asset.available : asset.kind === 'source' || asset.status !== 'ready' || !asset.available);
  const list = statusList.filter(asset => (libraryMediaType === 'all' || assetMediaKind(asset) === libraryMediaType) && matchesSearch(librarySearch, asset.title, asset.id, asset.binding || '')).sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const directoryButton = (id: string, label: string, count: number, active: boolean, detail = '') => `<button class="directory-button ${active ? 'active' : ''}" data-library-directory="${esc(id)}" aria-pressed="${active}" title="${esc(label)}"><i aria-hidden="true">${id === 'all' ? '库' : '夹'}</i><span><strong>${esc(label)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span><em>${count}</em></button>`;
  const directories = libraryGroup === 'product' ? directoryButton('all','全部产品素材',scope.length,libraryProductId === 'all') + products.filter(product => matchesSearch(libraryProductQuery,product.name,product.productId)).map(product => directoryButton(product.productId,product.name,scope.filter(asset => asset.productId === product.productId).length,libraryProductId === product.productId,`ID ${product.productId}`)).join('') : Object.entries(folderNames).map(([id,label]) => directoryButton(id,label,id === 'all' ? scope.length : scope.filter(asset => asset.kind === id).length,libraryFolder === id)).join('');
  const folderTitle = libraryGroup === 'product' ? selectedProduct?.name || '全部产品素材' : folderNames[libraryFolder] || '全部素材';
  return `<div class="page-head"><div><h1>素材库</h1><p class="subhead">${libraryGroup === 'product' ? '按商品目录管理视频与图片素材。' : '集中管理固定主播原片、通用画面与背景音乐。'}</p></div><div class="row"><button class="button" data-action="seed" ${state!.seedAvailable ? '' : 'disabled'}>导入示例素材</button><button class="button primary" data-action="add-product">＋ 添加商品</button></div></div>${state!.libraryBusy ? `<div class="busy-bar" data-ui-key="execution-progress"><span class="spinner"></span>${esc(state!.libraryMessage || '素材处理中…')}</div>` : ''}<nav class="material-groups" aria-label="素材大类">${([['presenter','播','IP主播素材','主播原片、通用画面与背景音乐'],['product','商','产品素材','商品视频、图片与原始素材']] as const).map(([id,mark,label,note]) => `<button class="material-group ${libraryGroup === id ? 'active' : ''}" data-library-group="${id}" aria-pressed="${libraryGroup === id}"><i>${mark}</i><span><strong>${label}</strong><small>${note}</small></span><em>${all.filter(asset => id === 'product' ? isProduct(asset) : !isProduct(asset)).length}</em></button>`).join('')}</nav><section class="card material-browser"><aside class="material-directories"><header><i>夹</i><div><strong>素材目录</strong><small>${libraryGroup === 'product' ? products.length + ' 个商品目录' : '按素材用途归档'}</small></div></header>${libraryGroup === 'product' ? `<input class="input directory-search" data-library-product-search aria-label="搜索商品目录" placeholder="搜索商品名称或 ID" value="${esc(libraryProductQuery)}">` : ''}<nav aria-label="素材目录">${directories || '<p class="section-hint">没有匹配的商品目录</p>'}</nav></aside><div class="material-content"><div class="material-breadcrumb">素材库 / ${libraryGroup === 'product' ? '产品素材' : 'IP主播素材'}</div><header class="material-folder-head"><div><h2>${esc(folderTitle)}</h2><span class="section-hint">${selectedProduct ? `${esc(money(selectedProduct.price))} · ${esc(selectedProduct.specification || '规格待补充')}` : `${folderList.length} 项素材`}</span></div><label class="material-search"><span aria-hidden="true">⌕</span><input class="input" data-library-search aria-label="搜索当前目录素材" placeholder="搜索当前目录的素材" value="${esc(librarySearch)}"></label></header>${selectedProduct ? `<div class="library-product-info"><span class="section-hint">商品 ID ${esc(selectedProduct.productId)}</span><div class="row"><button class="button small" data-action="edit-product" data-id="${esc(selectedProduct.productId)}">编辑资料</button><button class="button small primary" data-action="import-videos" data-id="${esc(selectedProduct.productId)}">＋ 添加视频</button></div></div>` : ''}<div class="library-media-tabs" role="group" aria-label="素材类型">${([['all','全部'],['video','视频'],['image','图片'],['audio','声音']] as const).map(([type,label]) => `<button class="${libraryMediaType === type ? 'active' : ''}" data-library-media="${type}" aria-pressed="${libraryMediaType === type}">${label}<span>${statusList.filter(asset => type === 'all' || assetMediaKind(asset) === type).length}</span></button>`).join('')}</div><div class="material-results"><span data-library-count>当前显示 ${list.length} 项素材</span><div class="library-tabs" role="group" aria-label="处理状态"><button data-library-tab="product" class="${libraryTab === 'product' ? 'active' : ''}" aria-pressed="${libraryTab === 'product'}">${libraryGroup === 'product' ? '已处理' : '可用素材'}</button><button data-library-tab="source" class="${libraryTab === 'source' ? 'active' : ''}" aria-pressed="${libraryTab === 'source'}">未处理与异常</button></div></div><div class="library-asset-grid">${list.length ? list.map(libraryAsset).join('') : '<div class="empty" style="grid-column:1/-1"><span class="empty-mark">◇</span><strong>暂无匹配的素材</strong><span>切换目录、素材类型或处理状态查看。</span></div>'}</div></div></section>`;
}
function libraryAsset(asset: Asset): string {
  const type = assetMediaKind(asset);
  const thumbnail = type === 'image' ? asset.url : asset.posterUrl;
  const kind = type === 'image' ? '图片' : type === 'audio' ? '声音' : asset.kind === 'source' ? '原始视频' : '视频素材';
  return `<article class="library-asset" data-ui-key="asset:${esc(asset.id)}"><button class="asset-preview-button" data-action="preview-asset" data-id="${esc(asset.id)}" aria-label="预览 ${esc(asset.title)}" ${asset.available ? '' : 'disabled'}>${thumbnail ? `<img loading="lazy" src="${esc(thumbnail)}" alt="">` : `<span class="asset-poster-empty">${type === 'audio' ? '♫' : '暂无画面'}</span>`}${type !== 'image' ? `<span class="asset-preview-mark">${type === 'audio' ? '♫' : '▶'}</span><span class="asset-duration">${duration(asset.duration)}</span>` : ''}<span class="asset-kind">${kind}</span></button><div class="library-asset-body"><div class="library-asset-title" title="${esc(asset.title)}">${esc(asset.title)}</div><div class="asset-card-meta"><span>${asset.kind === 'host' ? '固定主播原片' : asset.kind === 'presenter' ? '通用主播画面' : asset.kind === 'bgm' ? '背景音乐' : asset.kind === 'source' ? '待处理源素材' : '产品素材'}</span><span>${asset.size ? (asset.size / 1048576).toFixed(1) + ' MB' : ''}</span></div>${asset.error ? `<div class="asset-error">${esc(asset.error)}</div>` : ''}<div class="library-asset-actions">${['failed','partial','unavailable'].includes(asset.status) ? `<button class="button small" data-action="retry-asset" data-id="${esc(asset.id)}">重试</button>` : ''}${asset.kind === 'product' ? `<button class="button small danger" data-action="delete-asset" data-id="${esc(asset.id)}">移除</button>` : ''}</div></div></article>`;
}
function renderTask(task: Task): string {
  const statuses: Stage[] = ['copy','voice','visual','preview']; const index = statuses.indexOf(task.stage);
  return `${productionSteps(task)}<div class="page-head" data-ui-key="page-heading"><div><h1>${esc(task.name)}</h1><p class="subhead">${esc(task.productSnapshot.name)} · ${esc(task.templateSnapshot.name)}${task.completed ? ' · 已完成' : ''}</p></div><div class="row">${!task.completed ? `<button class="button" data-action="switch-task" ${state!.activeExecution ? 'disabled' : ''}>切换商品或模板</button>` : ''}<button class="button" data-page="records">返回记录</button></div></div>
  ${task.error ? `<div class="status-box error" data-ui-key="task-error">${esc(task.error)}</div>` : ''}${task.notice ? `<div class="notice" data-ui-key="task-notice">${esc(task.notice)}</div>` : ''}${task.execution?.status === 'running' ? `<div class="busy-bar" data-ui-key="execution-progress"><span class="spinner"></span><span style="flex:1">${esc(task.execution.message || statusName(task.execution.kind))}</span><strong>${task.execution.progress}%</strong><button class="button small danger" data-action="stop-task" ${task.execution.kind === 'render' ? '' : 'disabled'}>停止合成</button></div>` : ''}
  <div class="task-workspace" data-ui-key="task-workspace"><section><div class="stage-tabs" aria-label="制作编辑步骤" data-ui-key="stage-tabs">${statuses.map((stage,i) => `<button class="stage-tab ${stage === task.stage ? 'active' : i < index ? 'done' : ''}" data-stage="${stage}" ${task.completed ? 'disabled' : ''}>${i < index ? '✓ ' : `${String(i+1).padStart(2,'0')} `}${stageName(stage)}</button>`).join('')}</div><div class="card stage-panel" data-ui-key="stage:${task.stage}">${renderStage(task)}</div>${task.completed ? `<details class="card frozen-parameters" data-ui-key="completed-parameters"><summary>查看制作参数与完整文案</summary><dl><dt>商品ID</dt><dd>${esc(task.productId)}</dd><dt>商品资料快照</dt><dd>${esc(task.productSnapshot.name)} · ${esc(money(task.productSnapshot.price))} · ${esc(task.productSnapshot.specification)}</dd><dt>卖点</dt><dd>${esc(task.productSnapshot.sellingPoints)}</dd><dt>配音</dt><dd>Qwen 3.1 Plus · 小帅复刻音色 · 1.1倍语速</dd><dt>成片规格</dt><dd>1080×1920 · 30 FPS · MP4</dd><dt>输出设置</dt><dd>${task.settings.subtitles ? '开启黄色字幕' : '不添加字幕'} · ${esc(state!.bgms.find(asset => asset.id === task.settings.bgmId)?.title || '不使用BGM')}</dd></dl><div class="frozen-script">${task.nodes.map(node => `<p class="frozen-${node.type}">${esc(node.text)}</p>`).join('')}</div><p class="section-hint">商品素材顺序（参数快照）</p><ol>${task.plan?.entries.map(entry => `<li>${esc(entry.title)} · ${duration(entry.duration)}</li>`).join('') || ''}</ol></details>` : ''}</section><aside class="card side-card" data-ui-key="task-summary">${renderTaskAside(task)}</aside></div>`;
}
function renderStage(task: Task): string {
  if (task.stage === 'copy') return renderCopyStage(task);
  if (task.stage === 'voice') return renderVoiceStage(task);
  if (task.stage === 'visual') return renderVisualStage(task);
  return renderPreviewStage(task);
}
function renderCopyPreview(task: Task, nodes = task.nodes): string {
  const loading = task.execution?.status === 'running' && task.execution.kind === 'copy';
  const missing = nodes.some(node => node.type === 'generated_narration' && !node.text.trim());
  return `<div class="section-title">完整文案</div>${loading ? '<div class="copy-preview-loading" role="status"><span class="spinner"></span><span>正在生成完整文案…</span></div>' : missing ? '<p class="section-hint copy-preview-empty">生成或填写文案后，在这里查看完整口播。</p>' : `<div class="copy-preview-text">${nodes.map(node => `<span class="copy-part-${node.type}">${esc(node.text)}</span>`).join('')}</div>`}`;
}
function renderCopyStage(task: Task): string {
  const template = task.templateSnapshot; const running = task.execution?.status === 'running';
  const hasCopy = Object.values(task.black).some(text => text.trim());
  const complete = task.nodes.every(node => node.type !== 'generated_narration' || (task.black[node.id] || '').trim());
  const script = task.nodes.map((node, index) => {
    if (node.type === 'generated_narration') return `<div class="script-line" data-ui-key="script:${esc(node.id)}"><div class="script-label"><i>${String(index + 1).padStart(2,'0')}</i>商品文案</div><textarea class="textarea" data-black-node="${esc(node.id)}" placeholder="AI生成后可手动修改" ${running ? 'disabled' : ''}>${esc(task.black[node.id] ?? node.text)}</textarea></div>`;
    const host = node.type === 'host_clip' ? state!.assets.find(asset => asset.kind === 'host' && asset.binding === node.id && asset.available) : undefined;
    return `<div class="script-line fixed ${node.type}" data-ui-key="script:${esc(node.id)}"><div class="script-label"><i>${String(index + 1).padStart(2,'0')}</i>${node.type === 'host_clip' ? '主播原声' : '固定口播'}</div><div class="script-text">${host ? `<button class="script-resource" data-action="preview-asset" data-id="${esc(host.id)}" title="预览对应主播片段">${esc(node.text)} <span aria-hidden="true">▷</span></button>` : esc(node.text)}</div></div>`;
  }).join('');
  return `<div class="panel-title">文案创作</div>
  <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px"><label class="field-label">价格参考<input class="input" readonly value="${esc(money(task.productSnapshot.price))}"></label><label class="field-label">规格参考<input class="input" readonly value="${esc(task.productSnapshot.specification)}"></label></div>
  ${template.variableNodeId ? `<label class="field-label">原本和厂家谈好卖【以下内容】的</label><input class="input" data-field="variable" value="${esc(task.variable)}" placeholder="例如：三块多一双" ${running ? 'disabled' : ''}><p class="section-hint">建议用中文描述价格和规格，例如“五块九两双”。自动填充仅供参考，可自行修改。</p>` : ''}
  <label class="field-label">文案范例（可选）</label><textarea class="textarea" data-field="example" placeholder="粘贴完整文案范例，供AI参考表达与长度" ${running ? 'disabled' : ''}>${esc(task.example)}</textarea>
  <div style="margin-top:20px"><div class="section-title">口播脚本</div><div class="section-hint" style="margin-top:5px">${esc(template.title)} · ${esc(template.summary)}</div>${script}</div>
  <div class="row stage-footer copy-actions"><span class="section-hint">${task.copyConfirmed ? '文案已确认' : '填写完成后确认文案进入配音'}</span><div class="row"><button class="button ${hasCopy ? '' : 'primary'}" data-action="generate-copy" ${running ? 'disabled' : ''}>${running && task.execution?.kind === 'copy' ? '正在生成…' : hasCopy ? '重新生成文案' : '生成商品文案'}</button>${hasCopy ? `<button class="button primary" data-action="confirm-copy" ${running || !complete ? 'disabled' : ''}>确认文案</button>` : ''}</div></div>
  <section class="copy-preview" data-copy-preview aria-busy="${running && task.execution?.kind === 'copy'}">${renderCopyPreview(task)}</section>`;
}
function renderVoiceStage(task: Task): string {
  const intervals = task.intervals;
  const readyCount = intervals.filter(item => item.status === 'ready').length;
  const missingCount = intervals.length - readyCount;
  const running = task.execution?.status === 'running';
  return `<div class="panel-title">连续口播配音</div>
  ${intervals.length ? intervals.map(interval => `<article class="interval-card" data-ui-key="interval:${esc(interval.id)}"><div class="interval-top"><div class="interval-name">口播区间 ${esc(interval.id)}</div><span class="badge ${interval.status === 'ready' ? 'green' : interval.status === 'failed' ? 'red' : ''}">${statusName(interval.status)}${interval.confirmed ? ' · 已确认' : ''}</span></div><div class="interval-copy">${esc(interval.text)}</div>${interval.error ? `<div class="section-hint" style="color:var(--red)">${esc(interval.error)}</div>` : ''}${interval.audioUrl && interval.status === 'ready' ? `<audio controls preload="none" src="${esc(interval.audioUrl)}" style="width:100%;height:34px"></audio><div class="section-hint">${interval.duration ? duration(interval.duration) : ''} · 音频与字幕时间已关联</div>` : ''}<div class="row" style="justify-content:flex-end;margin-top:9px"><button class="button small" data-action="generate-voice" data-id="${esc(interval.id)}" ${running ? 'disabled' : ''}>${interval.status === 'ready' ? '重配此区间' : '生成此区间'}</button></div></article>`).join('') : `<div class="empty"><strong>暂无口播区间</strong>请先完成并确认商品文案。</div>`}
  <div class="row stage-footer"><span class="section-hint">${readyCount}/${intervals.length} 段配音已就绪${missingCount ? '，可一次补齐缺失配音' : ''}</span><div class="row">${missingCount ? `<button class="button" data-action="generate-voice" ${running ? 'disabled' : ''}>生成缺失配音（${missingCount}段）</button>` : ''}<button class="button primary" data-action="confirm-voice" ${!intervals.length || missingCount || running ? 'disabled' : ''}>${task.audioConfirmed ? '画面设置 →' : '确认配音'}</button></div></div>`;
}
function renderVisualStage(task: Task): string {
  const assets = readyProductAssets(task.productId);
  const plan = task.plan;
  // Server-created plans fill an untouched list; unsaved local edits remain intact.
  if (manualSelectionTaskId !== task.id || JSON.stringify(manualSelection) === JSON.stringify(manualSelectionBaseline) || !manualPlanChanged(task)) resetManualSelection(task.id);
  const selected = manualSelection;
  const running = task.execution?.status === 'running';
  const dirty = manualPlanChanged(task);
  const available = selected.reduce((sum, id) => sum + (assets.find(asset => asset.id === id && asset.available)?.duration || 0), 0);
  const unavailable = selected.some(id => !assets.find(asset => asset.id === id && asset.available));
  const enough = !unavailable && available >= (plan?.requiredDuration || 0);
  const listMarkup = selected.map((assetId, index) => {
    const asset = assets.find(item => item.id === assetId);
    return `<div class="manual-row" data-manual-row="${index}"><button type="button" class="manual-grip" data-sort-handle title="拖动排序；也可按 Alt + ↑ / ↓" aria-label="调整第 ${index + 1} 个片段的顺序" ${running ? 'disabled' : ''}>⠿</button><span class="manual-number">${index + 1}</span><button class="manual-thumb" data-action="preview-asset" data-id="${esc(assetId)}" aria-label="预览 ${esc(asset?.title || '不可用片段')}" ${asset ? '' : 'disabled'}>${asset?.posterUrl ? `<img draggable="false" src="${esc(asset.posterUrl)}" alt="">` : '▷'}</button><div class="manual-details"><strong title="${esc(asset?.title || assetId)}">${esc(asset?.title || '片段已删除或暂不可用')}</strong><small>${asset ? duration(asset.duration) : '不可用'}</small></div><button class="button small danger" data-action="remove-manual-asset" data-index="${index}" ${running ? 'disabled' : ''}>移除</button></div>`;
  }).join('');
  const issue = unavailable ? '请移除或替换不可用片段' : !enough ? '素材时长不足，请添加片段' : '';
  return `<div class="panel-title">画面与输出</div>
  <section class="visual-section" data-ui-key="visual-selection"><div class="visual-section-head"><h3>商品片段 <span class="visual-count">${selected.length}</span></h3><div class="visual-toolbar"><button class="button small" data-action="auto-plan" ${running ? 'disabled' : ''}>重新随机</button><button class="button small" data-action="pick-materials" ${running ? 'disabled' : ''}>添加素材</button><button class="button small" data-action="clear-manual-plan" ${!selected.length || running ? 'disabled' : ''}>清空</button></div></div>
  <div class="manual-list" data-ui-key="selection:${esc(JSON.stringify(selected))}">${listMarkup || '<div class="empty"><strong>尚未选择片段</strong></div>'}</div>
  <div class="selection-footer"><div class="selection-coverage ${enough ? '' : 'insufficient'}"><span>${duration(available)} / 需要 ${duration(plan?.requiredDuration || 0)}</span>${issue ? `<span>${issue}</span>` : dirty ? '<span>有修改，待保存</span>' : '<span>已保存</span>'}</div><button class="button small primary" data-action="save-manual-plan" ${running || !dirty ? 'disabled' : ''}>保存修改</button></div>
  ${!dirty && plan?.warnings.length ? `<div class="warning">${esc(plan.warnings.join('；'))}</div>` : ''}</section>
  <section class="visual-section" data-ui-key="visual-timeline"><div class="visual-section-head"><h3>画面时间线</h3></div>${dirty ? '<div class="timeline-placeholder">保存修改后更新时间线</div>' : plan ? renderTimeline(plan) : '<div class="timeline-placeholder">选好片段后显示时间线</div>'}</section>
  <section class="visual-section" data-ui-key="visual-output"><div class="visual-section-head"><h3>字幕与音乐</h3></div><div class="sound-settings">
  <div class="visual-setting-row"><span>字幕</span><label class="row"><input type="checkbox" data-setting="subtitles" ${running ? 'disabled' : ''} ${task.settings.subtitles ? 'checked' : ''}>显示字幕</label></div>
  <div class="visual-setting-row"><label for="visual-bgm">背景音乐</label><div class="bgm-choice"><select id="visual-bgm" class="select" data-setting="bgmId" ${running ? 'disabled' : ''}><option value="">不使用 BGM</option>${state!.bgms.map(bgm => `<option value="${esc(bgm.id)}" ${task.settings.bgmId === bgm.id ? 'selected' : ''}>${esc(bgm.title)}</option>`).join('')}</select><button class="button" data-action="audition-bgm" aria-pressed="false" ${!task.settings.bgmId ? 'disabled' : ''}>试听</button></div></div>
  <div class="visual-setting-row"><label for="visual-volume" data-bgm-volume-label>音乐音量 · ${Math.round(task.settings.bgmVolume * 100)}%</label><input id="visual-volume" type="range" min="0" max="0.5" step="0.01" value="${task.settings.bgmVolume}" data-setting="bgmVolume" ${running ? 'disabled' : ''}></div></div></section>
  <div class="visual-footer"><button class="button primary" data-action="go-preview" ${!plan?.valid || dirty || running ? 'disabled' : ''}>前往预览 →</button></div>`;
}
function renderTimeline(plan: Plan): string {
  if (!plan.pieces.length) return '';
  return `<div class="timeline-wrap"><div class="timeline">${plan.pieces.map((piece, index) => {
    const label = piece.mode === 'product' ? '商品' : piece.mode === 'host' ? '主播' : '通用主播';
    const asset = state!.assets.find(item => item.id === (piece.mode === 'product' ? piece.productAssetId : piece.assetId));
    return `<button class="timeline-piece ${piece.mode}" data-action="preview-timeline" data-index="${index}" title="${esc(asset?.title || label)} · ${piece.duration.toFixed(2)}秒"><span>${label}</span><span>${piece.duration.toFixed(1)}秒 ▷</span></button>`;
  }).join('')}</div></div>`;
}
function renderPreviewStage(task: Task): string {
  const preview = task.preview; const valid = !!preview && !task.previewStale;
  return `<div class="panel-title">预览与成片</div><div class="preview-box">${preview ? `<video controls playsinline preload="metadata" src="${esc(task.preview!.url)}"></video>` : `<div class="preview-empty">生成预览后，视频会在这里播放</div>`}</div>${preview ? `<div class="row" style="justify-content:space-between;margin-top:10px"><span class="badge ${valid ? 'green' : 'amber'}">${valid ? '当前预览有效' : '预览已过期，请重新合成'}</span><span class="section-hint">${duration(preview.duration)} · ${preview.width}×${preview.height} · ${preview.fps} FPS</span></div>` : ''}${task.previewStale ? `<div class="warning">文案、画面方案或输出设置已变化，当前视频不再代表最新任务，请重新生成。</div>` : ''}<div class="row" style="justify-content:space-between;margin-top:19px">${task.completed ? `<span class="badge">已完成，参数只读</span>` : `<button class="button" data-action="back-visual">返回画面设置</button>`}<div class="row">${valid ? `<button class="button" data-action="export-preview">导出副本</button>` : ''}${task.completed ? `<span class="badge green">已完成</span>` : `<button class="button primary" data-action="render-task" ${task.execution?.status === 'running' || !task.plan?.valid ? 'disabled' : ''}>${task.execution?.kind === 'render' && task.execution.status === 'running' ? '正在合成…' : preview ? '重新生成预览' : '生成预览'}</button>`}${valid && !task.completed ? `<button class="button primary" data-action="complete-task">确认完成</button>` : ''}</div></div>`;
}
function renderTaskAside(task: Task): string {
  const count = readyProductAssets(task.productId).length; const readyIntervals = task.intervals.filter(interval => interval.status === 'ready').length;
  return `<div class="section-title">任务摘要</div><div class="summary-row"><span>商品</span><strong>${esc(task.productSnapshot.name)}</strong></div><div class="summary-row"><span>模板</span><strong>${esc(task.templateSnapshot.name)}</strong></div><div class="summary-row"><span>商品素材</span><strong>${count} 段可用</strong></div><div class="summary-row"><span>文案</span><strong>${task.copyConfirmed ? '已确认' : '编辑中'}</strong></div><div class="summary-row"><span>配音</span><strong>${task.audioConfirmed ? '已确认' : `${readyIntervals}/${task.intervals.length} 区间`}</strong></div><div class="summary-row"><span>视觉方案</span><strong>${task.plan ? (task.plan.valid ? `${task.plan.mode === 'auto' ? '随机' : '手动'} · ${duration(task.plan.duration)}` : '时长不足') : '未生成'}</strong></div><div class="summary-row"><span>输出设置</span><strong>${task.settings.subtitles ? '字幕' : '无字幕'} · ${task.settings.bgmId ? '含 BGM' : '无 BGM'}</strong></div>${task.completed ? `<div class="notice">成片已确认完成。商品源素材的后续删除不会使该成片失效。</div>` : ''}<div style="margin-top:14px"><button class="button small" data-action="task-refresh">刷新任务状态</button></div>`;
}

function bindLibraryProductPicker(picker: HTMLElement): void {
  const trigger = picker.querySelector<HTMLButtonElement>('[data-product-picker-trigger]')!;
  const popup = picker.querySelector<HTMLElement>('[data-product-picker-popup]')!;
  const input = picker.querySelector<HTMLInputElement>('[data-product-search]')!;
  const list = picker.querySelector<HTMLElement>('[role="listbox"]')!;
  let activeIndex = -1;
  const options = () => [...list.querySelectorAll<HTMLButtonElement>('[data-product-option]')];
  const highlight = (index: number) => {
    const items = options(); activeIndex = items.length ? Math.max(0, Math.min(index, items.length - 1)) : -1;
    items.forEach((item, i) => item.classList.toggle('is-active', i === activeIndex));
    const active = items[activeIndex];
    if (active) input.setAttribute('aria-activedescendant', active.id); else input.removeAttribute('aria-activedescendant');
    active?.scrollIntoView({ block: 'nearest' });
  };
  const close = (restoreFocus = false) => {
    popup.hidden = true; trigger.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
  };
  const open = () => {
    input.value = ''; list.innerHTML = libraryProductOptions('');
    picker.querySelector('[data-product-search-count]')!.textContent = `共 ${state!.products.length} 个商品`;
    popup.hidden = false; trigger.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-expanded', 'true');
    input.focus({ preventScroll: true }); highlight(options().findIndex(item => item.dataset.productOption === libraryProductId));
  };
  const select = (option: HTMLButtonElement) => {
    libraryProductId = option.dataset.productOption!; close(); render();
    root?.querySelector<HTMLButtonElement>('[data-product-picker-trigger]')?.focus({ preventScroll: true });
  };
  const search = () => {
    list.innerHTML = libraryProductOptions(input.value); highlight(0);
    const count = options().filter(option => option.dataset.productOption !== 'all').length;
    picker.querySelector('[data-product-search-count]')!.textContent = input.value.trim() ? `找到 ${count} 个商品` : `共 ${state!.products.length} 个商品`;
  };
  trigger.addEventListener('click', () => { if (popup.hidden) open(); else close(); });
  trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); } });
  input.addEventListener('input', event => { if (!(event as InputEvent).isComposing) search(); });
  input.addEventListener('compositionend', search);
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); highlight(activeIndex + (event.key === 'ArrowDown' ? 1 : -1)); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); highlight(event.key === 'Home' ? 0 : options().length - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); const option = options()[activeIndex]; if (option) select(option); }
  });
  list.addEventListener('click', event => { const option = (event.target as Element).closest<HTMLButtonElement>('[data-product-option]'); if (option) select(option); });
  const controller = new AbortController(); libraryPickerListeners = controller;
  document.addEventListener('pointerdown', event => { if (!picker.contains(event.target as Node)) close(); }, { signal: controller.signal });
  picker.addEventListener('focusout', event => { if (!picker.contains(event.relatedTarget as Node | null)) close(); });
}
function newElements<T extends HTMLElement>(selector: string): T[] {
  return [...root!.querySelectorAll<T>(selector)].filter(element => {
    if (boundElements.has(element)) return false;
    boundElements.add(element); return true;
  });
}
function bind(): void {
  if (!root) return;
  newElements<HTMLElement>('[data-page]').forEach(element => element.addEventListener('click', () => { void navigate(element.dataset.page as Page).catch(showError); }));
  newElements<HTMLElement>('[data-open-task]').forEach(element => element.addEventListener('click', () => { void openTask(element.dataset.openTask || '').catch(showError); }));
  newElements<HTMLButtonElement>('[data-stage]').forEach(button => button.addEventListener('click', () => { const target = button.dataset.stage as Stage; void goStage(target).catch(showError); }));
  newElements<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => { void handleAction(button).catch(showError); }));
  newElements<HTMLButtonElement>('[data-library-tab]').forEach(button => button.addEventListener('click', () => { libraryTab = button.dataset.libraryTab || 'product'; render(); }));
  newElements<HTMLButtonElement>('[data-library-media]').forEach(button => button.addEventListener('click', () => { libraryMediaType = button.dataset.libraryMedia as typeof libraryMediaType; render(); }));
  newElements<HTMLButtonElement>('[data-library-group]').forEach(button => button.addEventListener('click', () => { libraryGroup = button.dataset.libraryGroup as typeof libraryGroup; librarySearch = ''; libraryMediaType = 'all'; render(); }));
  newElements<HTMLButtonElement>('[data-library-directory]').forEach(button => button.addEventListener('click', () => { if (libraryGroup === 'product') libraryProductId = button.dataset.libraryDirectory || 'all'; else libraryFolder = button.dataset.libraryDirectory || 'all'; librarySearch = ''; render(); }));
  newElements<HTMLInputElement>('[data-library-search], [data-library-product-search]').forEach(input => {
    const update = () => { if (input.hasAttribute('data-library-search')) librarySearch = input.value; else libraryProductQuery = input.value; render(); };
    input.addEventListener('input', event => { if (!(event as InputEvent).isComposing) update(); }); input.addEventListener('compositionend', update);
  });
  newElements<HTMLSelectElement>('[data-production-template]').forEach(input => input.addEventListener('change', () => { productionTemplateId = input.value; render(); }));
  newElements<HTMLSelectElement>('[data-production-product]').forEach(input => input.addEventListener('change', () => { productionProductId = input.value; }));
  const productPicker = root.querySelector<HTMLElement>('[data-product-picker]');
  if (productPicker !== libraryPickerElement) {
    libraryPickerListeners?.abort(); libraryPickerListeners = undefined; libraryPickerElement = productPicker ?? undefined;
    if (productPicker) bindLibraryProductPicker(productPicker);
  }
  const recordForm = newElements<HTMLFormElement>('[data-record-search]')[0];
  if (recordForm) {
    const readFilters = () => { const data = new FormData(recordForm); recordFilters = { keyword: String(data.get('keyword') || ''), status: String(data.get('status') || ''), from: String(data.get('from') || ''), to: String(data.get('to') || '') }; };
    recordForm.addEventListener('input', readFilters); recordForm.addEventListener('change', readFilters);
    recordForm.addEventListener('submit', event => {
      event.preventDefault(); readFilters();
      if (recordFilters.from && recordFilters.to && recordFilters.from > recordFilters.to) { showToast('开始日期不能晚于结束日期', true); return; }
      appliedRecordFilters = { ...recordFilters }; render();
    });
    recordForm.querySelector('[data-reset-record-search]')?.addEventListener('click', () => { recordFilters = { keyword: '', status: '', from: '', to: '' }; appliedRecordFilters = { ...recordFilters }; render(); });
  }
  newElements<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach(input => input.addEventListener(input instanceof HTMLInputElement && input.type === 'range' ? 'input' : 'change', () => saveSettings(input)));
  newElements<HTMLInputElement | HTMLTextAreaElement>('[data-field], [data-black-node]').forEach(input => input.addEventListener('input', () => queueDraftFromInput(input)));
  newElements<HTMLFormElement>('form[data-form]').forEach(form => form.addEventListener('submit', event => { event.preventDefault(); void submitForm(form).catch(() => undefined); }));
  const manualList = newElements<HTMLElement>('.manual-list')[0];
  if (manualList) bindSortableList(manualList, {
    canSort: () => selectedTask()?.execution?.status !== 'running',
    onBusy: busy => { manualSortBusy = busy; },
    onMove: (from, to) => { const [asset] = manualSelection.splice(from, 1); manualSelection.splice(to, 0, asset); render(); },
  });
}
async function navigate(target: Page): Promise<void> {
  if (page === 'collection' && !collectionLoadError) collector.html();
  const task = selectedTask(); if (task) await flushTaskDraft(task.id);
  if (target !== 'task') { page = target; selectedTaskId = ''; }
  else page = target;
  render();
}
async function openTask(id: string): Promise<void> {
  const current = selectedTask(); if (current) await flushTaskDraft(current.id);
  selectedTaskId = id; page = 'task'; resetManualSelection(id); previewPrompts.delete(id); render();
}
function resetManualSelection(taskId: string): void {
  const task = state?.tasks.find(item => item.id === taskId);
  manualSelectionTaskId = task?.plan ? taskId : '';
  manualSelection = task?.plan?.entries.map(entry => entry.assetId) ?? [];
  manualSelectionBaseline = [...manualSelection];
}
function manualPlanChanged(task: Task): boolean {
  return manualSelectionTaskId === task.id && JSON.stringify(manualSelection) !== JSON.stringify(task.plan?.entries.map(entry => entry.assetId) ?? []);
}
async function goStage(target: Stage): Promise<void> {
  const originalTask = selectedTask(); if (!originalTask) return;
  await flushTaskDraft(originalTask.id);
  const task = selectedTask(); if (!task) return;
  if (target === 'preview' && manualPlanChanged(task)) { showToast('请先保存手动方案，再生成预览', true); return; }
  const valid: Record<Stage, boolean> = { copy: true, voice: task.copyConfirmed, visual: task.audioConfirmed, preview: !!task.plan?.valid };
  if (!valid[target]) { showToast(target === 'voice' ? '请先确认商品文案' : target === 'visual' ? '请先确认所有必需配音区间' : '请先建立有效的画面方案', true); return; }
  if (target === 'preview') previewPrompts.delete(task.id);
  await mutate(`/api/tasks/${encodeURIComponent(task.id)}`, 'PATCH', { stage: target });
}
function queueDraftFromInput(input: HTMLInputElement | HTMLTextAreaElement): void {
  const task = selectedTask(); if (!task || !input.dataset.field && !input.dataset.blackNode) return;
  const fieldKey = input.dataset.blackNode ? `black:${input.dataset.blackNode}` : input.dataset.field || '';
  const warningKey = `${task.id}:${fieldKey}`;
  const needsAudioWarning = !!input.dataset.blackNode || input.dataset.field === 'variable';
  const relatedAudio = needsAudioWarning && task.intervals.some(interval => interval.status === 'ready' && (!input.dataset.blackNode || interval.nodeIds.includes(input.dataset.blackNode)));
  const previous = input.dataset.blackNode ? task.black[input.dataset.blackNode] ?? '' : input.dataset.field === 'variable' ? task.variable : '';
  if (input.value !== previous && relatedAudio && !draftWarnings.has(warningKey)) {
    const subject = input.dataset.blackNode ? '這段文案' : '藍色變量';
    if (!confirm(`${subject}已有可用配音。保存實際修改後，需要重新生成並確認受影響的配音區間。繼續嗎？`)) { input.value = previous; return; }
    draftWarnings.add(warningKey);
  }
  const patch: Record<string, unknown> = {};
  if (input.dataset.field === 'variable') patch.variable = input.value;
  if (input.dataset.field === 'example') patch.example = input.value;
  if (input.dataset.blackNode) patch.black = { [input.dataset.blackNode]: input.value };
  queueTaskPatch(task.id, patch);
  const preview = root?.querySelector<HTMLElement>('[data-copy-preview]');
  if (preview && needsAudioWarning) {
    const edits = new Map([...root!.querySelectorAll<HTMLTextAreaElement>('[data-black-node]')].map(field => [field.dataset.blackNode!, field.value]));
    const variable = root!.querySelector<HTMLInputElement>('[data-field="variable"]')?.value ?? task.variable;
    const nodes = task.nodes.map(node => ({ ...node, text: node.type === 'generated_narration' ? edits.get(node.id) ?? node.text : node.id === task.templateSnapshot.variableNodeId ? `原本和厂家谈好卖${variable}的，` : node.text }));
    preview.innerHTML = renderCopyPreview(task, nodes);
  }
}
function mergePatch(taskId: string, patch: Record<string, unknown>): void {
  const previous = pendingTaskPatches.get(taskId) ?? {};
  const merged = { ...previous, ...patch };
  if (patch.black && typeof patch.black === 'object') merged.black = { ...(previous.black as Record<string, string> | undefined), ...(patch.black as Record<string, string>) };
  if (patch.settings) merged.settings = { ...(previous.settings as Partial<Task['settings']> | undefined), ...(patch.settings as Partial<Task['settings']>) };
  pendingTaskPatches.set(taskId, merged);
}
function queueTaskPatch(taskId: string, patch: Record<string, unknown>): void {
  mergePatch(taskId, patch);
  const oldTimer = draftTimers.get(taskId); if (oldTimer !== undefined) window.clearTimeout(oldTimer);
  draftTimers.set(taskId, window.setTimeout(() => { draftTimers.delete(taskId); void flushTaskDraft(taskId).catch(showError); }, 450));
}
async function flushTaskDraft(taskId: string): Promise<void> {
  const timer = draftTimers.get(taskId); if (timer !== undefined) { window.clearTimeout(timer); draftTimers.delete(taskId); }
  const inFlight = draftFlushes.get(taskId);
  if (inFlight) { await inFlight; if (pendingTaskPatches.has(taskId)) await flushTaskDraft(taskId); return; }
  const patch = pendingTaskPatches.get(taskId); if (!patch) return;
  pendingTaskPatches.delete(taskId);
  const request = api<Task>(`/api/tasks/${encodeURIComponent(taskId)}`, 'PATCH', patch).then(updated => {
    if (state) state.tasks = state.tasks.map(task => task.id === taskId ? updated : task);
  }).catch(error => {
    const newer = pendingTaskPatches.get(taskId) ?? {};
    const restored = { ...patch, ...newer };
    if (patch.black || newer.black) restored.black = { ...(patch.black as Record<string, string> | undefined), ...(newer.black as Record<string, string> | undefined) };
    if (patch.settings || newer.settings) restored.settings = { ...(patch.settings as Partial<Task['settings']> | undefined), ...(newer.settings as Partial<Task['settings']> | undefined) };
    pendingTaskPatches.set(taskId, restored);
    throw error;
  }).finally(() => { draftFlushes.delete(taskId); });
  draftFlushes.set(taskId, request);
  await request;
  if (pendingTaskPatches.has(taskId)) await flushTaskDraft(taskId);
  else if (selectedTaskId === taskId) render();
}
function saveSettings(input: HTMLInputElement | HTMLSelectElement): void {
  const task = selectedTask(); if (!task) return;
  const settings: Partial<Task['settings']> = {};
  if (input.dataset.setting === 'subtitles' && input instanceof HTMLInputElement) settings.subtitles = input.checked;
  else if (input.dataset.setting === 'bgmId') {
    settings.bgmId = input.value || null; stopBgmAudition();
    const auditionButton = root?.querySelector<HTMLButtonElement>('[data-action="audition-bgm"]');
    if (auditionButton) auditionButton.disabled = !settings.bgmId;
  }
  else if (input.dataset.setting === 'bgmVolume' && input instanceof HTMLInputElement) {
    settings.bgmVolume = Number(input.value);
    const label = root?.querySelector('[data-bgm-volume-label]');
    if (label) label.textContent = `音乐音量 · ${Math.round(settings.bgmVolume * 100)}%`;
    if (bgmAudition) bgmAudition.volume = settings.bgmVolume;
  }
  queueTaskPatch(task.id, { settings });
}
function updateBgmAuditionButton(): void {
  const button = root?.querySelector<HTMLButtonElement>('[data-action="audition-bgm"]');
  if (button) { const playing = !!bgmAudition && !bgmAudition.paused; button.textContent = playing ? '暂停试听' : '试听'; button.setAttribute('aria-pressed', String(playing)); }
}
function stopBgmAudition(): void {
  if (bgmAudition) { bgmAudition.pause(); bgmAudition.removeAttribute('src'); bgmAudition.load(); bgmAudition.remove(); }
  bgmAudition = undefined; bgmAuditionTaskId = ''; bgmAuditionAssetId = ''; updateBgmAuditionButton();
}
async function toggleBgmAudition(): Promise<void> {
  const task = selectedTask();
  const id = root?.querySelector<HTMLSelectElement>('[data-setting="bgmId"]')?.value;
  const asset = state?.bgms.find(item => item.id === id);
  if (!task || !asset?.url) return;
  if (bgmAudition && bgmAuditionAssetId === id && !bgmAudition.paused) { bgmAudition.pause(); return; }
  if (!bgmAudition || bgmAuditionAssetId !== id || bgmAuditionTaskId !== task.id) {
    stopBgmAudition();
    bgmAudition = document.createElement('audio'); bgmAudition.hidden = true; bgmAudition.dataset.bgmAudition = ''; bgmAudition.src = asset.url;
    bgmAuditionTaskId = task.id; bgmAuditionAssetId = asset.id; document.body.append(bgmAudition);
    for (const event of ['play', 'pause', 'ended']) bgmAudition.addEventListener(event, updateBgmAuditionButton);
  }
  bgmAudition.volume = Number(root?.querySelector<HTMLInputElement>('[data-setting="bgmVolume"]')?.value ?? task.settings.bgmVolume);
  await bgmAudition.play(); updateBgmAuditionButton();
}
async function handleAction(button: HTMLButtonElement): Promise<void> {
  const action = button.dataset.action; let task = selectedTask();
  if (action === 'open-collect') { await navigate('collection'); return; }
  if (action === 'audition-bgm') return toggleBgmAudition();
  if (task) { await flushTaskDraft(task.id); task = selectedTask(); }
  if (action === 'refresh' || action === 'task-refresh') return refresh();
  if (action === 'home') { page = 'production'; selectedTaskId = ''; return render(); }
  if (action === 'new-task') return showModal(newTaskModal());
  if (action === 'add-product') return showModal(productModal());
  if (action === 'edit-product') { const product = state!.products.find(item => item.productId === button.dataset.id); if (product) showModal(productModal(product)); return; }
  if (action === 'choose-folder') { const kind = 'folder'; const result = await api<{ paths: string[] }>('/api/dialog', 'POST', { kind }); const target = document.getElementById(button.dataset.target || '') as HTMLInputElement | null; if (target && result.paths[0]) target.value = result.paths[0]; return; }
  if (action === 'change-root') return showModal(dataRootModal());
  if (action === 'setup') { const input = document.querySelector<HTMLInputElement>('#data-root'); await mutate('/api/setup', 'POST', { dataRoot: input?.value.trim() || undefined }, '工作目录已保存'); return; }
  if (action === 'seed') { startPolling(); await mutate('/api/seed', 'POST', {}, '示例素材导入完成'); return; }
  if (action === 'import-videos') return showModal(importModal(button.dataset.id || ''));
  if (action === 'preview-asset') {
    const asset = state!.assets.find(item => item.id === button.dataset.id);
    if (!asset?.url || !asset.available) return showToast('该素材暂不可用，请检查来源文件', true);
    if (asset.kind === 'bgm') return showModal(`<div class="modal"><button class="modal-close" data-close-modal aria-label="关闭预览">×</button><h2>${esc(asset.title)}</h2><audio controls preload="metadata" src="${esc(asset.url)}" style="width:100%"></audio></div>`);
    if (isImageAsset(asset)) return showModal(`<div class="modal asset-image-modal"><button class="modal-close" data-close-modal aria-label="关闭预览">×</button><h2>${esc(asset.title)}</h2><img src="${esc(asset.url)}" alt="${esc(asset.title)}"></div>`);
    return showVideoPreview(asset.title, asset.url, 0, undefined, `${duration(asset.duration)} · ${asset.width || ''}×${asset.height || ''}`);
  }
  if (action === 'retry-asset') { await mutate(`/api/assets/${encodeURIComponent(button.dataset.id || '')}/retry`, 'POST', {}, '已完成重试'); return; }
  if (action === 'delete-asset') { if (!confirm('从素材库移除此商品片段？正在被合成使用的素材会由服务端拒绝删除。')) return; await mutate(`/api/assets/${encodeURIComponent(button.dataset.id || '')}`, 'DELETE', undefined, '素材记录已更新'); return; }
  if (action === 'record-open') { selectedTaskId = button.dataset.id || ''; page = 'task'; resetManualSelection(selectedTaskId); previewPrompts.delete(selectedTaskId); const record = selectedTask(); if (record?.completed) record.stage = 'preview'; render(); return; }
  if (action === 'record-export') { const result = await api<{ paths: string[] }>('/api/dialog', 'POST', { kind: 'folder' }); if (!result.paths[0]) return; await mutate(`/api/tasks/${encodeURIComponent(button.dataset.id || '')}/export`, 'POST', { directory: result.paths[0] }, '成片副本已导出'); return; }
  if (action === 'switch-task' && task) return showModal(switchModal(task, button.dataset.productId, button.dataset.templateId));
  if (!task) return;
  if (action === 'confirm-switch-task') {
    if (button.disabled || button.dataset.id !== task.id) return;
    await applyTaskSwitch(task.id, button.dataset.productId!, button.dataset.templateId!, button.dataset.mode as 'new' | 'overwrite'); return;
  }
  if (action === 'pick-materials') return showModal(materialPickerModal(task));
  if (action === 'picker-preview') {
    const asset = readyProductAssets(task.productId).find(item => item.id === button.dataset.id);
    const player = document.querySelector<HTMLVideoElement>('[data-picker-player]');
    if (!asset?.url || !player) return;
    player.hidden = false; player.src = asset.url; player.load();
    document.querySelector('[data-picker-preview-title]')!.textContent = asset.title;
    return;
  }
  if (action === 'add-picker-asset') {
    const asset = readyProductAssets(task.productId).find(item => item.id === button.dataset.id);
    if (!asset) throw new Error('该商品片段已不可用');
    manualSelection.push(asset.id); render();
    document.querySelectorAll<HTMLButtonElement>('[data-action="add-picker-asset"]').forEach(item => { const count = manualSelection.filter(id => id === item.dataset.id).length; item.textContent = count ? `＋ 加入 · 已选 ${count}` : '＋ 加入'; });
    const count = document.querySelector('[data-picker-count]'); if (count) count.textContent = `当前已选 ${manualSelection.length} 段，关闭后保存方案生效`;
    return;
  }
  if (action === 'preview-timeline') return showTimelinePreview(task, Number(button.dataset.index));
  if (action === 'generate-copy') {
    const existingCopy = Object.values(task.black).some(text => text.trim());
    if (existingCopy && !confirm('重新生成会尝试覆盖当前全部商品文案。为避免覆盖手工修改，请确认继续；如果生成失败，现有文案仍会保留。')) return;
    await mutate(`/api/tasks/${encodeURIComponent(task.id)}/copy`, 'POST', {}, '已提交商品文案生成');
    root?.querySelector('[data-copy-preview]')?.scrollIntoView({ block: 'nearest' }); return;
  }
  if (action === 'confirm-copy') { await mutate(`/api/tasks/${encodeURIComponent(task.id)}/copy/confirm`, 'POST', {}, '文案已确认'); return; }
  if (action === 'generate-voice') { const id = button.dataset.id; await mutate(`/api/tasks/${encodeURIComponent(task.id)}/voice`, 'POST', id ? { intervalId: id } : {}, '已提交配音生成'); return; }
  if (action === 'confirm-voice') { if (task.audioConfirmed) await goStage('visual'); else await mutate(`/api/tasks/${encodeURIComponent(task.id)}/voice/confirm`, 'POST', {}, '配音已确认'); return; }
  if (action === 'auto-plan') { const updated = await api<Task>(`/api/tasks/${encodeURIComponent(task.id)}/plan`, 'POST', {}); state!.tasks = state!.tasks.map(item => item.id === task.id ? updated : item); resetManualSelection(task.id); showToast('随机画面方案已生成'); render(); return; }
  if (action === 'add-manual-asset') { manualSelection.push(button.dataset.id || ''); render(); return; }
  if (action === 'remove-manual-asset') { const index = Number(button.dataset.index); if (index >= 0 && index < manualSelection.length) manualSelection.splice(index, 1); render(); return; }
  if (action === 'clear-manual-plan') { manualSelection = []; render(); return; }
  if (action === 'save-manual-plan') { await mutate(`/api/tasks/${encodeURIComponent(task.id)}/plan`, 'PUT', { assetIds: manualSelection }, '手动方案已保存'); return; }
  if (action === 'go-preview') return goStage('preview');
  if (action === 'back-visual') { await mutate(`/api/tasks/${encodeURIComponent(task.id)}`, 'PATCH', { stage: 'visual' }); return; }
  if (action === 'render-task') {
    if (task.preview) return showRegenerationDialog(task);
    await mutate(`/api/tasks/${encodeURIComponent(task.id)}/render`, 'POST', {}, '已提交本地视频合成'); return;
  }
  if (action === 'confirm-render') {
    const refill = button.dataset.refill === 'true'; closeModal();
    await mutate(`/api/tasks/${encodeURIComponent(task.id)}/render`, 'POST', { refill }, '已提交本地视频合成');
    if (refill) resetManualSelection(task.id);
    return;
  }
  if (action === 'stop-task') { await mutate(`/api/tasks/${encodeURIComponent(task.id)}/stop`, 'POST', {}, '已请求停止本地合成'); return; }
  if (action === 'complete-task') {
    showModal(`<div class="modal completion-dialog"><button class="modal-close" data-close-modal aria-label="关闭确认窗口">×</button><h2>确认完成</h2><p class="modal-intro">确认当前有效预览为最终成片？</p><div class="modal-footer"><button class="button" data-close-modal>取消</button><button class="button primary" data-action="confirm-complete-task" data-id="${esc(task.id)}">确认完成</button></div></div>`);
    document.querySelector<HTMLButtonElement>('.completion-dialog .modal-footer [data-close-modal]')?.focus(); return;
  }
  if (action === 'confirm-complete-task') {
    if (button.disabled || button.dataset.id !== task.id) return;
    button.disabled = true;
    try { await mutate(`/api/tasks/${encodeURIComponent(task.id)}/complete`, 'POST', {}, '成片已确认完成'); closeModal(); }
    catch (error) { button.disabled = false; throw error; }
    return;
  }
  if (action === 'export-preview') { const result = await api<{ paths: string[] }>('/api/dialog', 'POST', { kind: 'folder' }); if (!result.paths[0]) return; await mutate(`/api/tasks/${encodeURIComponent(task.id)}/export`, 'POST', { directory: result.paths[0] }, '成片副本已导出'); return; }
}
function showModal(content: string): void {
  chosenPaths = [];
  closeModal();
  const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'; backdrop.innerHTML = content; document.body.append(backdrop);
  const dialog = backdrop.querySelector('.modal'); dialog?.setAttribute('role', 'dialog'); dialog?.setAttribute('aria-modal', 'true');
  const title = backdrop.querySelector('h2'); if (title) { title.id = 'dialog-title'; dialog?.setAttribute('aria-labelledby', title.id); }
  backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(); });
  backdrop.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
  backdrop.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(button => button.addEventListener('click', () => { void handleAction(button).catch(showError); }));
  backdrop.querySelectorAll<HTMLFormElement>('form[data-form]').forEach(form => form.addEventListener('submit', event => { event.preventDefault(); void submitForm(form).catch(showError); }));
  backdrop.querySelector<HTMLInputElement>('[data-picker-search]')?.addEventListener('input', event => { const query = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase(); backdrop.querySelectorAll<HTMLElement>('[data-material-name]').forEach(card => { card.hidden = !card.dataset.materialName!.includes(query); }); });
}
function closeModal(): void {
  const completion = document.querySelector('.completion-dialog');
  document.querySelectorAll<HTMLMediaElement>('.modal-backdrop video,.modal-backdrop audio').forEach(media => media.pause()); document.querySelector('.modal-backdrop')?.remove();
  if (completion) root?.querySelector<HTMLButtonElement>('[data-action="complete-task"]')?.focus({ preventScroll: true });
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });

function materialPickerModal(task: Task): string {
  const assets = readyProductAssets(task.productId);
  return `<div class="modal material-picker"><button class="modal-close" data-close-modal aria-label="关闭素材选择">×</button><h2>引入商品素材</h2><p class="modal-intro">${esc(task.productSnapshot.name)} · ${assets.length} 个可用视频片段</p><input class="input" data-picker-search aria-label="搜索商品素材" placeholder="按文件名搜索素材"><p class="section-hint" data-picker-preview-title>点击“预览”查看原片</p><video data-picker-player controls autoplay muted playsinline hidden></video><div class="asset-grid picker-grid">${assets.map(asset => `<article class="asset-card" data-material-name="${esc(asset.title.toLocaleLowerCase())}">${asset.posterUrl ? `<img src="${esc(asset.posterUrl)}" loading="lazy" alt="">` : ''}<div class="asset-caption"><strong title="${esc(asset.title)}">${esc(asset.title)}</strong><div class="asset-meta">${duration(asset.duration)}</div><div class="row"><button class="button small" data-action="picker-preview" data-id="${esc(asset.id)}">预览</button><button class="button small primary" data-action="add-picker-asset" data-id="${esc(asset.id)}">＋ 加入${manualSelection.includes(asset.id) ? ` · 已选 ${manualSelection.filter(id => id === asset.id).length}` : ''}</button></div></div></article>`).join('')}</div><div class="modal-footer"><span class="section-hint" data-picker-count>当前已选 ${manualSelection.length} 段，关闭后保存方案生效</span><button class="button primary" data-close-modal>完成选择</button></div></div>`;
}
function showVideoPreview(title: string, url: string, start = 0, seconds?: number, description = ''): void {
  showModal(`<div class="modal asset-video-modal"><button class="modal-close" data-close-modal aria-label="关闭预览">×</button><h2>${esc(title)}</h2><video controls autoplay muted playsinline src="${esc(url)}"></video><p class="section-hint">${esc(description)}</p></div>`);
  const video = document.querySelector<HTMLVideoElement>('.asset-video-modal video')!;
  const end = seconds === undefined ? undefined : start + seconds;
  video.addEventListener('loadedmetadata', () => { video.currentTime = start; }, { once: true });
  video.addEventListener('play', () => { if (end !== undefined && (video.currentTime < start || video.currentTime >= end)) video.currentTime = start; });
  if (end !== undefined) video.addEventListener('timeupdate', () => { if (video.currentTime >= end) { video.pause(); if (video.currentTime > end + .04) video.currentTime = end; } });
}
function showTimelinePreview(task: Task, index: number): void {
  const piece = task.plan?.pieces[index]; if (!piece) return;
  const label = piece.mode === 'product' ? '商品画面' : piece.mode === 'host' ? '主播画面' : '通用主播画面';
  if (task.preview && !task.previewStale) return showVideoPreview(`时间线片段 ${index + 1} · ${label}`, task.preview.url, piece.start, piece.duration, `成片 ${piece.start.toFixed(2)}～${(piece.start + piece.duration).toFixed(2)} 秒`);
  const asset = state!.assets.find(item => item.id === (piece.mode === 'product' ? piece.productAssetId : piece.assetId));
  if (!asset?.available || !asset.url) throw new Error('此片段的原素材已不可用');
  const start = piece.mode === 'product' ? (piece.productStart || 0) + (asset.videoStart || 0) : (piece.sourceStart || 0) + (piece.mode === 'presenter' ? asset.videoStart || 0 : 0);
  showVideoPreview(`原素材片段 · ${label}`, asset.url, start, piece.duration, '当前方案尚未生成有效成片，这里预览对应原视频范围。');
}
function showRegenerationDialog(task: Task): void {
  const stale = task.previewStale;
  const changes = task.previewChanges?.length ? task.previewChanges : ['制作内容或输出设置已修改'];
  const ready = task.copyConfirmed && task.audioConfirmed && task.plan?.valid && task.execution?.status !== 'running';
  showModal(`<div class="modal regeneration-dialog"><button class="modal-close" data-close-modal aria-label="关闭重新生成提示">×</button><h2>${stale ? '预览需要重新生成' : '重新生成预览'}</h2>${stale ? `<p class="modal-intro">旧预览尚未包含以下修改：</p><ul class="preview-changes">${changes.map(change => `<li>${esc(change)}</li>`).join('')}</ul>` : '<p class="modal-intro">可以沿用当前画面重新合成，也可以重新随机填充商品片段。</p>'}<p class="section-hint">沿用当前画面会保留素材顺序和配音。重新随机填充会替换当前商品画面方案。</p>${!ready ? '<div class="warning">请先确认文案、配音并补齐画面时长。</div>' : ''}<div class="modal-footer"><button class="button" data-close-modal>暂不生成</button><button class="button" data-action="confirm-render" data-refill="true" ${ready ? '' : 'disabled'}>重新随机填充</button><button class="button primary" data-action="confirm-render" data-refill="false" ${ready ? '' : 'disabled'}>${stale ? '确认重新生成' : '沿用画面重生成'}</button></div></div>`);
}
function newTaskModal(): string {
  return `<div class="modal"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>新建视频任务</h2><p class="modal-intro">每个任务会保存商品与模板快照，之后修改商品资料不会影响已有任务。</p><form data-form="new-task"><label class="field-label">选择商品</label><select class="select" name="productId" required>${state!.products.map(product => `<option value="${esc(product.productId)}">${esc(product.name)} · ${readyProductAssets(product.productId).length} 段可用素材</option>`).join('')}</select><label class="field-label">选择模板</label><select class="select" name="templateId" required>${state!.templates.map(template => `<option value="${esc(template.id)}">${esc(template.name)} — ${esc(template.title)}</option>`).join('')}</select>${!state!.products.length ? `<div class="warning">请先添加商品资料并导入素材，再创建视频任务。</div>` : ''}<div class="modal-footer"><button type="button" class="button" data-close-modal>取消</button><button class="button primary" ${!state!.products.length || !state!.templates.length ? 'disabled' : ''}>创建任务</button></div></form></div>`;
}
function productModal(product?: Product): string {
  return `<div class="modal"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>${product ? '编辑商品资料' : '添加商品'}</h2><p class="modal-intro">先保存商品资料，再从素材库选择原始视频或已处理片段导入。导入不会移动或覆盖原文件。</p><form data-form="product" data-id="${esc(product?.productId || '')}"><label class="field-label">商品名称</label><input class="input" name="name" required value="${esc(product?.name || '')}" placeholder="例如：轻便随行杯"><div class="grid" style="grid-template-columns:1fr 1fr;gap:10px"><div><label class="field-label">价格</label><input class="input" name="price" value="${esc(product?.price || '')}" placeholder="如 129"></div><div><label class="field-label">规格</label><input class="input" name="specification" value="${esc(product?.specification || '')}" placeholder="容量、颜色等"></div></div><label class="field-label">商品卖点</label><textarea class="textarea" name="sellingPoints" placeholder="填写可用于生成口播的商品特点">${esc(product?.sellingPoints || '')}</textarea><div class="modal-footer"><button type="button" class="button" data-close-modal>取消</button><button class="button primary">${product ? '保存资料' : '添加商品'}</button></div></form></div>`;
}
function importModal(productId: string): string {
  const product = state!.products.find(item => item.productId === productId);
  return `<div class="modal"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>导入商品视频</h2><p class="modal-intro">添加到「${esc(product?.name || '')}」。原始视频进入本地切分流程，已处理片段会直接校验入库。</p><form data-form="import" data-id="${esc(productId)}"><label class="field-label">素材类型</label><select class="select" name="processed"><option value="false">原始视频 · 待处理</option><option value="true">已处理片段 · 直接入库</option></select><label class="field-label">选择视频</label><div class="row"><button type="button" class="button" data-action="choose-videos">选择视频文件</button><span class="section-hint" data-video-count>尚未选择</span></div><div class="section-hint" data-video-names style="margin-top:7px"></div><input type="hidden" name="videoPaths" value=""><div class="modal-footer"><button type="button" class="button" data-close-modal>取消</button><button class="button primary">开始导入</button></div></form></div>`;
}
function switchModal(task: Task, productId = task.productId, templateId = task.templateId): string {
  return `<div class="modal"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>切换商品或模板</h2><form data-form="switch-task" data-id="${esc(task.id)}"><label class="field-label">商品</label><select class="select" name="productId">${state!.products.map(item => `<option value="${esc(item.productId)}" ${item.productId === productId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select><label class="field-label">模板</label><select class="select" name="templateId">${state!.templates.map(item => `<option value="${esc(item.id)}" ${item.id === templateId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select><div class="modal-footer"><button type="button" class="button" data-close-modal>取消</button><button type="submit" class="button primary">应用</button></div></form></div>`;
}
async function applyTaskSwitch(taskId: string, productId: string, templateId: string, mode: 'new' | 'overwrite'): Promise<void> {
  const controls = [...document.querySelectorAll<HTMLButtonElement>('.modal-footer button')];
  controls.forEach(button => { button.disabled = true; });
  try {
    const task = await api<Task>(`/api/tasks/${encodeURIComponent(taskId)}/switch`, 'POST', { productId, templateId, mode });
    closeModal(); selectedTaskId = task.id; manualSelectionTaskId = ''; manualSelection = []; page = 'task'; await refresh();
  } catch (error) { controls.forEach(button => { button.disabled = false; }); throw error; }
}
function dataRootModal(): string {
  return `<div class="modal"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>更换数据目录</h2><p class="modal-intro">已有数据不会自动搬迁。切换后将使用新目录中的工作数据；切换期间不能有任务执行或素材导入。</p><form data-form="change-root"><label class="field-label">当前数据目录</label><div class="path-picker"><input class="input" id="new-data-root" name="dataRoot" value="${esc(state!.dataRoot)}"><button type="button" class="button" data-action="choose-folder" data-target="new-data-root">选择</button></div><div class="modal-footer"><button type="button" class="button" data-close-modal>取消</button><button class="button primary">更换目录</button></div></form></div>`;
}
let chosenPaths: string[] = [];
async function submitForm(form: HTMLFormElement): Promise<void> {
  const formName = form.dataset.form || ''; const data = new FormData(form); const value = (name: string): string => String(data.get(name) || '');
  if (formName === 'new-task') {
    const task = await api<Task>('/api/tasks', 'POST', { productId: value('productId'), templateId: value('templateId') });
    document.querySelector('.modal-backdrop')?.remove(); selectedTaskId = task.id; page = 'task'; await refresh(); return;
  }
  if (formName === 'product') {
    const productId = form.dataset.id;
    const payload = { name: value('name').trim(), price: value('price').trim(), specification: value('specification').trim(), sellingPoints: value('sellingPoints').trim() };
    if (productId) await api(`/api/products/${encodeURIComponent(productId)}`, 'PATCH', payload);
    else await api('/api/products', 'POST', { ...payload, productId: `product-${Date.now()}` });
    chosenPaths = []; document.querySelector('.modal-backdrop')?.remove(); showToast(productId ? '商品资料已保存' : '商品已添加'); await refresh(); return;
  }
  if (formName === 'import') {
    const productId = form.dataset.id || ''; const processed = value('processed') === 'true';
    startPolling();
    await api(`/api/products/${encodeURIComponent(productId)}/import`, 'POST', { paths: chosenPaths, processed }); chosenPaths = []; document.querySelector('.modal-backdrop')?.remove(); showToast('素材已提交导入'); await refresh(); return;
  }
  if (formName === 'switch-task') {
    const taskId = form.dataset.id!; await flushTaskDraft(taskId);
    const current = state!.tasks.find(item => item.id === taskId)!;
    const productId = value('productId'), templateId = value('templateId');
    if (productId === current.productId && templateId === current.templateId) { closeModal(); return; }
    if (Object.values(current.black).some(text => text.trim())) {
      const attributes = `data-id="${esc(taskId)}" data-product-id="${esc(productId)}" data-template-id="${esc(templateId)}"`;
      showModal(`<div class="modal switch-choice"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>选择创建方式</h2><p class="modal-intro">当前任务已有文案。新建会保留当前任务，覆盖会清空当前进度。</p><div class="modal-footer"><button class="button" data-action="switch-task" ${attributes}>返回</button><button class="button danger" data-action="confirm-switch-task" data-mode="overwrite" ${attributes}>覆盖当前任务</button><button class="button primary" data-action="confirm-switch-task" data-mode="new" ${attributes}>新建任务</button></div></div>`); return;
    }
    await applyTaskSwitch(taskId, productId, templateId, 'overwrite'); return;
  }
  if (formName === 'change-root') {
    if (state!.activeExecution || state!.libraryBusy) { showToast('任务或素材正在处理中，暂不能更换目录。', true); return; }
    if (!confirm('更换后将使用所选目录中的工作数据，旧目录数据不会自动搬迁。确认更换吗？')) return;
    await api('/api/setup', 'POST', { dataRoot: value('dataRoot').trim() });
    document.querySelector('.modal-backdrop')?.remove(); showToast('数据目录已更换'); await refresh(); return;
  }
}

window.addEventListener('beforeunload', event => {
  if (state?.activeExecution || pendingTaskPatches.size || draftFlushes.size) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', stopBgmAudition);

// Dialog picks are bound separately because the chooser lives inside a modal.
document.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action="choose-videos"]');
  if (!target) return;
  void api<{ paths: string[] }>('/api/dialog', 'POST', { kind: 'videos' }).then(result => {
    chosenPaths = result.paths; const backdrop = document.querySelector('.modal-backdrop');
    const count = backdrop?.querySelector<HTMLElement>('[data-video-count]'); const names = backdrop?.querySelector<HTMLElement>('[data-video-names]'); const paths = backdrop?.querySelector<HTMLInputElement>('input[name="videoPaths"]');
    if (count) count.textContent = chosenPaths.length ? `已选择 ${chosenPaths.length} 个文件` : '尚未选择';
    if (names) names.textContent = chosenPaths.map(path => path.split(/[\\/]/).pop()).join('、');
    if (paths) paths.value = chosenPaths.join('\n');
  }).catch(showError);
});

void refresh().catch(error => { if (root) root.innerHTML = `<div class="empty" style="margin:20vh auto;max-width:480px"><strong>无法连接本地工作台</strong>${esc(error instanceof Error ? error.message : String(error))}<div style="margin-top:15px"><button class="button" onclick="location.reload()">重新连接</button></div></div>`; });
