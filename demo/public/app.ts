import { icon, workbenchShell, productionFlow, architectureView, copyView, voicePreparationView, generationView, renderBlocker, recordsView, libraryView, recordDetailsView, materialPickerView } from './prototype-views.js';
import { bindSortableList } from './sortable.js';
import { bindParagraphSort } from './prototype-sort.js';
import { bindHostImageEditor, hostImageEditorView } from './host-image-editor.js';
import type { ImageDraft } from './host-image-editor.js';

type Stage = 'copy' | 'voice' | 'visual' | 'preview';
type TaskStatus = 'running' | 'done' | 'failed' | 'stopped' | 'interrupted';
export interface Template { id: string; name: string; title: string; summary: string; nodes: ScriptNode[]; variableNodeId?: string; }
export interface ScriptNode { id: string; type: 'host_clip' | 'fixed_narration' | 'generated_narration'; text: string; label?: string; }
export interface Product { productId: string; name: string; price: string; specification: string; sellingPoints: string; createdAt?: string; }
export interface Asset { id: string; productId?: string; kind: 'product' | 'source' | 'host' | 'presenter' | 'bgm'; title: string; description?: string; processing?: { stage: 'queued' | 'scanning' | 'splitting' | 'naming' | 'ready' | 'failed' | 'interrupted'; progress: number; message: string; error?: string }; naming?: { status: 'pending' | 'running' | 'ready' | 'failed' | 'uncertain'; error?: string }; status: 'ready' | 'pending' | 'failed' | 'partial' | 'deleted' | 'unavailable'; duration: number; hasVideo?: boolean; videoDuration?: number; width?: number; height?: number; size?: number; videoStart?: number; binding?: string; processed?: boolean; parentId?: string; error?: string; cuts?: number[]; cleaned?: boolean; url?: string; posterUrl?: string; available?: boolean; }
export interface FixedNarrationVisual { nodeId: string; matchedText: string; placement: 'start' | 'end'; assetId: string | null; duration: number; status: 'ready' | 'missing' | 'unassigned'; }
export interface Cue { text: string; begin: number; end: number; nodeId?: string; }
export interface Interval { id: string; nodeIds: string[]; text: string; signature: string; status: 'missing' | 'ready' | 'failed'; confirmed: boolean; audioUrl?: string; duration?: number; cues?: Cue[]; nodeTimes?: { id: string; begin: number; end: number }[]; error?: string; }
export interface QueueEntry { entryId: string; assetId: string; title: string; duration: number; url?: string; posterUrl?: string; available: boolean; }
export interface PicturePiece { mode: 'product' | 'host' | 'presenter'; start: number; duration: number; assetId?: string; productAssetId?: string; sourceStart?: number; productStart?: number; }
export interface Plan { mode: 'auto' | 'manual'; entries: QueueEntry[]; requiredDuration: number; availableDuration: number; valid: boolean; repeated: boolean; warnings: string[]; events: PicturePiece[]; pieces: PicturePiece[]; signature: string; duration: number; }
export interface Preview { relativePath: string; duration: number; width: number; height: number; fps: number; size: number; signature: string; createdAt: string; url: string; }
export interface HostImage { relativePath: string; title: string; width: number; height: number; x: number; y: number; scale: number; url?: string; }
export interface Execution { id: string; kind: 'copy' | 'voice' | 'render' | 'selection'; status: TaskStatus; progress: number; message: string; startedAt: string; finishedAt?: string; }
export interface ShotSelection {
  signature: string; slots: { id: string; nodeId: string; intervalId: string; begin: number; end: number; duration: number; text: string }[];
  fixedVisuals: { nodeId: string; intervalId: string; assetId: string; begin: number; end: number; duration: number; sourceStart: number }[];
  choices: { slotId: string; nodeId: string; assetIds: string[]; duration: number }[];
  candidateIds: string[]; warnings: string[]; requiredDuration: number; model?: string; stale?: boolean;
}
export interface Task { id: string; name: string; productId: string; templateId: string; productSnapshot: Product; templateSnapshot: Template; variable: string; example: string; black: Record<string, string>; nodes: ScriptNode[]; confirmedNodes?: ScriptNode[]; stage: Stage; copyConfirmed: boolean; audioConfirmed: boolean; intervals: Interval[]; plan: Plan | null; settings: { subtitles: boolean; bgmId: string | null; bgmVolume: number }; preview: Preview | null; previewStale: boolean; previewChanges?: string[]; completed: boolean; videoSubmittedAt?: string | null; hostImage?: HostImage; shotSelection?: ShotSelection; execution: Execution | null; error: string; notice?: string; createdAt: string; updatedAt: string; }
export interface AppState { configured: boolean; dataRoot: string; defaultDataRoot: string; defaultExportDirectory: string; modelReady: boolean; toolsReady: boolean; templates: Template[]; products: Product[]; assets: Asset[]; tasks: Task[]; bgms: Asset[]; seedAvailable: boolean; activeExecution: ({ taskId: string } & Execution) | null; fixedNarrationVisuals?: FixedNarrationVisual[]; libraryBusy?: boolean; libraryMessage?: string; materialProcessing?: { settings: { threshold: number; minDurationSec: number }; namingReady: boolean; namingModel: string }; }
interface ApiError { error?: string; message?: string; }
type Page = 'production' | 'library' | 'records' | 'task' | 'products' | 'publishing';
interface PrototypeIsland { html(): string; mount(root: HTMLElement, options: {toast:(message:string)=>void;goto:(page:string,productId?:string)=>void}): void; setAccount(value:string): void; }
declare global { interface Window { EcommerceVideoProducts: PrototypeIsland; EcommerceVideoPublishing: PrototypeIsland; CollectApi: {migrateLegacyStorage(): Promise<void>}; } }
interface PendingTaskSwitch { taskId: string; productId: string; templateId: string; origin: 'architecture' | 'copy'; }
let pendingTaskSwitch: PendingTaskSwitch | null = null;
let taskSwitchBusy = false;
let workbenchTemplateId = '';
let workbenchSetupStep: 'architecture' | 'copy' | 'generation' = 'architecture';
let workbenchGenerationOpen = false;
let prototypeSelectionTaskId = '';
let prototypeMatchRound = 0;
let selectionStamp = '';
let selectionDirty = false;
let selectionSaving = false;
const selectionSubmitting = new Set<string>();
const renderSubmitting = new Set<string>();
let prototypeClipId = '';
const submittingCopyConfirmation = new Set<string>();
const hostImageRequests = new Map<string, Promise<void>>();
const hostImageAttempts = new Set<string>();
let disposeHostImageEditor: (() => void) | null = null;
let libraryBoard: 'anchor' | 'product' = 'anchor';
let librarySelectedSources = new Set<string>();
let libraryProductQuery = '';
let libraryAssetQuery = '';
let prototypePicker: {nodeId: string; ids: string[]; mask: boolean} | null = null;
let modalDecision: ((accepted: boolean) => void) | null = null;
let anchorFolder = 'all';
let workbenchNode = '';
let prototypeEditingRenderId = '';
const prototypeSelection = new Map<string,string[]>();

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('页面容器缺失');
let state: AppState | null = null;
interface ProductionPointer { page: 'production' | 'task'; taskId: string; templateId: string; step: 'architecture' | 'copy' | 'generation'; generationOpen: boolean; nodeId: string; clipId: string; selectionTaskId: string; selections: [string, string[]][]; matchRound: number; }
interface UiPointer { page: Page; taskId: string; dataRoot?: string; production?: ProductionPointer; }
const UI_POINTER_KEY = 'video-workbench-ui-v1';
let savedPointer: UiPointer | null = null;
try {
  const saved: unknown = JSON.parse(localStorage.getItem(UI_POINTER_KEY) || 'null');
  if (saved && typeof saved === 'object' && 'page' in saved && ['production','task','library','records','products','publishing'].includes(String(saved.page)) && 'taskId' in saved && typeof saved.taskId === 'string') {
    savedPointer = { page: saved.page as Page, taskId: saved.taskId };
    if ('dataRoot' in saved && typeof saved.dataRoot === 'string') savedPointer.dataRoot = saved.dataRoot;
    const production = 'production' in saved ? saved.production : null;
    if (production && typeof production === 'object' &&
      'page' in production && ['production','task'].includes(String(production.page)) &&
      ['taskId','templateId','nodeId','clipId','selectionTaskId'].every(key => typeof (production as Record<string, unknown>)[key] === 'string') &&
      'step' in production && ['architecture','copy','generation'].includes(String(production.step)) &&
      'generationOpen' in production && typeof production.generationOpen === 'boolean' &&
      'matchRound' in production && Number.isSafeInteger(production.matchRound) && Number(production.matchRound) >= 0 &&
      'selections' in production && Array.isArray(production.selections) && production.selections.every(row => Array.isArray(row) && row.length === 2 && typeof row[0] === 'string' && Array.isArray(row[1]) && row[1].every(id => typeof id === 'string'))) savedPointer.production = production as ProductionPointer;
  }
} catch { savedPointer = null; }
let page: Page = savedPointer?.page || 'production';
const entryParams = new URLSearchParams(location.search);
if (['products','collection','library'].includes(entryParams.get('page') || '')) {
  page = entryParams.get('page') === 'collection' ? 'products' : entryParams.get('page') as Page;
}
let selectedTaskId = savedPointer?.production?.taskId || savedPointer?.taskId || '';
let productionPage: ProductionPointer['page'] = savedPointer?.production?.page || (selectedTaskId ? 'task' : 'production');
let workspaceInitialized = false;
if (savedPointer?.production) {
  const workspace = savedPointer.production;
  workbenchTemplateId = workspace.templateId; workbenchSetupStep = workspace.step; workbenchGenerationOpen = workspace.generationOpen;
  workbenchNode = workspace.nodeId; prototypeClipId = workspace.clipId; prototypeSelectionTaskId = workspace.selectionTaskId; prototypeMatchRound = workspace.matchRound;
  // Real selection choices are restored from the server.
}
let libraryTab = 'product';
let libraryMediaType: 'all' | 'video' | 'source' | 'image' | 'sound' = 'all';
let libraryProductId = entryParams.get('page') === 'library' ? entryParams.get('productId') || 'all' : 'all';
if (page === 'library' && entryParams.get('page') === 'library') libraryBoard = 'product';
let libraryPickerListeners: AbortController | undefined;
let libraryPickerElement: HTMLElement | undefined;
const boundElements = new WeakSet<HTMLElement>();
const renderedNodes = new WeakMap<Node, Node>();
interface RecordFilters { keyword: string; taskId: string; productId: string; status: string; from: string; to: string; }
let recordFilters: RecordFilters = { keyword: '', taskId: '', productId: '', status: '', from: '', to: '' };
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
const productIcon = icon('product');

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
const money = (value: string): string => value ? (value.includes('¥') ? value : `¥${value}`) : '未填写';
const duration = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const dateText = (value: string): string => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const statusName = (value: string): string => ({ ready: '可使用', pending: '待处理', failed: '处理失败', partial: '部分完成', deleted: '已删除', unavailable: '暂不可用', missing: '待生成', running: '进行中', done: '已完成', stopped: '已停止', interrupted: '已中断', copy: '文案', voice: '配音', render: '合成' })[value] ?? value;
const stageName = (value: Stage): string => ({ copy: '文案', voice: '配音', visual: '画面', preview: '成片' })[value];
const isImageAsset = (asset: Asset): boolean => /\.(png|jpe?g|webp|avif|gif|bmp|tiff?)$/i.test(asset.title);
const productAssets = (productId: string): Asset[] => (state?.assets ?? []).filter(asset => asset.productId === productId);
const readyProductAssets = (productId: string): Asset[] => productAssets(productId).filter(asset => asset.kind === 'product' && asset.status === 'ready' && asset.available && asset.processed !== false && !asset.cleaned && !isImageAsset(asset));
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
  const previousRoot = state?.dataRoot || savedPointer?.dataRoot;
  state = await api<AppState>('/api/state');
  if (previousRoot && previousRoot !== state.dataRoot) {
    selectedTaskId = ''; productionPage = 'production'; workbenchTemplateId = ''; workbenchSetupStep = 'architecture'; workbenchGenerationOpen = false;
    prototypeSelectionTaskId = ''; prototypeSelection.clear(); workbenchNode = ''; prototypeClipId = ''; prototypeMatchRound = 0;
    if (page === 'task') page = 'production';
    workspaceInitialized = true; rememberPointer();
  }
  for(const id of librarySelectedSources){const asset=state.assets.find(item=>item.id===id);if(!asset||asset.processed===true||asset.processing?.stage==='ready')librarySelectedSources.delete(id);}
  for (const asset of state.assets) {
    if (asset.url?.startsWith('/media/asset/') && asset.kind !== 'bgm' && !/\.(png|jpe?g|webp|avif|gif|bmp|tiff?)$/i.test(asset.title)) asset.url += '?browser=1';
  }
  if (selectedTaskId && !state.tasks.some(task => task.id === selectedTaskId)) selectedTaskId = '';
  if (!workspaceInitialized) {
    if (!savedPointer?.production && !selectedTaskId) {
      const draft = state.tasks.find(task => !task.completed && !task.videoSubmittedAt);
      if (draft) { selectedTaskId = draft.id; productionPage = 'task'; }
    }
    if (page === 'production' && productionPage === 'task' && selectedTask()) page = 'task';
    workspaceInitialized = true;
  }
  if (!keepPage && page === 'task' && !selectedTaskId) page = 'production';
  if (pendingTaskPatches.size === 0 && draftFlushes.size === 0) render();
  if (state.activeExecution || state.libraryBusy) startPolling(); else stopPolling();
}
function rememberPointer(): void {
  if (page === 'production' || page === 'task') productionPage = page;
  const production: ProductionPointer = { page: productionPage, taskId: selectedTaskId, templateId: workbenchTemplateId, step: workbenchSetupStep, generationOpen: workbenchGenerationOpen, nodeId: workbenchNode, clipId: prototypeClipId, selectionTaskId: prototypeSelectionTaskId, selections: [], matchRound: prototypeMatchRound };
  try { localStorage.setItem(UI_POINTER_KEY, JSON.stringify({ page, taskId: selectedTaskId, dataRoot: state?.dataRoot, production } satisfies UiPointer)); } catch { /* storage may be unavailable */ }
}
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
function navButton(id: Page, icon: string, label: string): string { return `<button class="${page === id || (id === 'production' && page === 'task') ? 'active' : ''}" data-page="${id}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`; }
function shell(content: string): string {
  return workbenchShell(page, content, state?.dataRoot || '');
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
    const previous = renderedNodes.get(live);
    if (previous?.isEqualNode(next)) return;
    if (live instanceof Element && next instanceof Element) {
      const before = previous instanceof Element ? previous : live;
      for (const attr of [...before.attributes]) if (!next.hasAttribute(attr.name)) live.removeAttribute(attr.name);
      for (const attr of next.attributes) if (before.getAttribute(attr.name) !== attr.value) live.setAttribute(attr.name, attr.value);
      if (live instanceof HTMLTextAreaElement && next instanceof HTMLTextAreaElement) {
        if (document.activeElement !== live && live.value !== next.value) live.value = next.value;
      } else if (live instanceof HTMLElement && live.isContentEditable && document.activeElement === live) {
        // Saving a draft must not replace the text node holding the current caret.
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
let collectionLoadError = '';
try {
  if (!window.EcommerceVideoProducts || !window.CollectApi) throw new Error('商品获取组件未加载，请重启工作台服务后刷新页面。');
  await window.CollectApi.migrateLegacyStorage();
} catch (error) { collectionLoadError = error instanceof Error ? error.message : String(error); }
function render(): void {
  if (!state || !root || manualSortBusy) return;
  const completedRecord = page === 'task' && selectedTask()?.completed ? selectedTask() : undefined;
  if (completedRecord) { page = 'records'; selectedTaskId = ''; }
  const island = page === 'products' ? window.EcommerceVideoProducts : page === 'publishing' ? window.EcommerceVideoPublishing : undefined;
  if (island && root.querySelector(`[data-ui-key="prototype:${page}"]`)) return;
  const auditionTask = page === 'task' ? selectedTask() : undefined;
  if (bgmAudition && (!auditionTask || auditionTask.id !== bgmAuditionTaskId || auditionTask.settings.bgmId !== bgmAuditionAssetId || auditionTask.execution?.status === 'running' || auditionTask.completed)) stopBgmAudition();
  if (!state.configured) { patchView(root, renderSetup()); bind(); return; }
  island?.setAccount(page === 'products' ? 'local' : 'local-prototype-ui');
  let content = island ? `<div class="workbench-island" data-ui-key="prototype:${page}">${page === 'products' && collectionLoadError ? `<div class="notice">${esc(collectionLoadError)}</div>` : island.html()}</div>` : page === 'library' ? renderLibrary() : page === 'records' ? renderRecords() : page === 'task' && selectedTask() ? renderTask(selectedTask()!) : renderProduction();
  if (page === 'task' && !selectedTask()) page = 'production';
  patchView(root, shell(content));
  bind();
  if (!(page === 'products' && collectionLoadError)) island?.mount(root, {toast:showToast,goto:(target,productId)=>{
    if (target === 'library' || target === 'materials') {
      libraryBoard = 'product'; libraryProductId = productId || 'all';
      void refresh().then(() => navigate('library')).catch(showError);
    } else void navigate(target as Page).catch(showError);
  }});
  updateBgmAuditionButton();
  rememberPointer();
  const imageTask = page === 'task' ? selectedTask() : undefined;
  if (imageTask && !imageTask.completed && !imageTask.hostImage && !state.activeExecution && root.querySelector('.ec-generation')) {
    const key = `${state.dataRoot}:${imageTask.id}`;
    if (!hostImageAttempts.has(key)) { hostImageAttempts.add(key); void prepareHostImage(imageTask).catch(showError); }
  }
  if (completedRecord) showModal(recordDetailsView(completedRecord));
}
async function prepareHostImage(task: Task): Promise<void> {
  const key = `${state!.dataRoot}:${task.id}`, existing = hostImageRequests.get(key);
  if (existing) return existing;
  const job = (async () => { await api(`/api/tasks/${encodeURIComponent(task.id)}/host-image/default`, 'POST', {}); await refresh(); })();
  hostImageRequests.set(key, job);
  try { await job; } finally { hostImageRequests.delete(key); }
}
async function openHostImageEditor(task: Task): Promise<void> {
  if (task.completed || task.execution?.status === 'running' || renderSubmitting.has(task.id)) return;
  await flushTaskDraft(task.id);
  const pending = hostImageRequests.get(`${state!.dataRoot}:${task.id}`);
  if (pending) await pending;
  const current = state!.tasks.find(item=>item.id===task.id);
  if (!current || selectedTask()?.id!==task.id) return;
  const images=state!.assets.filter(asset=>asset.kind==='product' && asset.productId===task.productId && asset.available && isImageAsset(asset));
  const node=current.nodes.find(item=>item.id===workbenchNode && item.type==='host_clip') || current.nodes.find(item=>item.type==='host_clip');
  const host=state!.assets.find(asset=>asset.available && asset.kind==='host' && asset.binding===node?.id);
  const image=current.hostImage || {relativePath:'',title:'请选择商品图片',width:1080,height:960,x:.5,y:.5,scale:1,url:''};
  showModal(hostImageEditorView(image,host,images));
  const dialog=document.querySelector<HTMLElement>('.host-image-dialog')!;
  disposeHostImageEditor=bindHostImageEditor(dialog,image,images,async(draft:ImageDraft)=>{
    let assetId=draft.assetId;
    if(draft.file){
      const result=await fetch(`/api/products/${encodeURIComponent(current.productId)}/upload?processed=true&name=${encodeURIComponent(draft.file.name)}`,{method:'POST',body:draft.file});
      const body=await result.json() as {assets?:Asset[];message?:string};
      if(!result.ok)throw new Error(body.message || '图片上传失败');
      const asset=body.assets?.find(item=>item.status==='ready');
      if(!asset)throw new Error('图片导入失败，请重新选择');
      assetId=asset.id;
    }
    await api(`/api/tasks/${encodeURIComponent(current.id)}/host-image`,'PUT',{...(assetId?{assetId}:{}),x:draft.x,y:draft.y,scale:draft.scale});
    await refresh();
  },()=>{closeModal();showToast('已应用于全部主播原声片段');});
}
function renderSetup(): string {
  return `<div class="shell"><main class="main" style="grid-column:1/-1"><div class="page" style="max-width:600px;padding-top:15vh"><h1>设置本地工作目录</h1><p class="subhead">素材、文案与生成记录将保存在你选择的目录中，原视频不会被移动或覆盖。</p><div class="card" style="margin-top:24px"><label class="field-label" for="data-root">数据目录</label><input id="data-root" class="input" value="${esc(state!.defaultDataRoot)}"><div class="row" style="justify-content:space-between;margin-top:14px"><span class="section-hint">使用 Videos 下的独立目录</span><button class="button" data-action="choose-folder" data-target="data-root">选择文件夹</button></div><div class="modal-footer"><button class="button primary" data-action="setup">开始使用</button></div></div></div></main></div>`;
}
function renderProduction(): string {
  if (!workbenchTemplateId) workbenchTemplateId = state!.templates[0]?.id || '';
  return architectureView(state!.templates, workbenchTemplateId, workbenchSetupStep, state!.products, {pending:!!pendingTaskSwitch,busy:taskSwitchBusy});
}
function renderRecords(): string {
  const filters = appliedRecordFilters;
  const records = state!.tasks.filter(task => !!task.videoSubmittedAt);
  const tasks = records.filter(task => matchesSearch(filters.keyword, task.name, task.id, task.productId, task.productSnapshot.name, task.templateSnapshot.name)
    && matchesSearch(filters.taskId, task.id) && matchesSearch(filters.productId, task.productId)
    && (!filters.status || (filters.status === 'incomplete' ? !task.completed : taskFilterStatus(task) === filters.status))
    && (!filters.from || localDay(task.videoSubmittedAt!) >= filters.from)
    && (!filters.to || localDay(task.videoSubmittedAt!) <= filters.to)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  return recordsView(tasks, recordFilters, records.length);
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
function renderLibrary(): string {
  return libraryView(state!, {board:libraryBoard,folder:anchorFolder,productId:libraryProductId,productQuery:libraryProductQuery,assetQuery:libraryAssetQuery,mediaType:libraryMediaType,selectedSourceIds:librarySelectedSources});
}
function renderProductLibrary(): string {
  const products = state!.products;
  if (!libraryProductId || (libraryProductId !== 'all' && !products.some(product => product.productId === libraryProductId))) libraryProductId = products[0]?.productId || 'all';
  const selectedProduct = products.find(product => product.productId === libraryProductId);
  const processed = state!.assets.filter(asset => asset.kind === 'product' && asset.status === 'ready' && asset.processed !== false && !asset.cleaned);
  const unfinished = state!.assets.filter(asset => !asset.cleaned && !(asset.kind === 'product' && asset.parentId && asset.processed === false) && (asset.kind === 'source' || ['failed','partial','unavailable'].includes(asset.status)) && asset.status !== 'deleted');
  const statusList = (libraryTab === 'product' ? processed : unfinished).filter(asset => libraryProductId === 'all' || asset.productId === libraryProductId);
  const imageCount = statusList.filter(isImageAsset).length;
  const list = statusList.filter(asset => libraryMediaType === 'all' || isImageAsset(asset) === (libraryMediaType === 'image'));
  const openSearch = root?.querySelector<HTMLInputElement>('[data-product-picker-popup]:not([hidden]) [data-product-search]')?.value || '';
  const emptyTitle = libraryMediaType === 'image' ? '暂无图片' : libraryMediaType === 'video' ? '暂无视频' : libraryTab === 'product' ? '暂无可用素材' : '暂无未处理素材';
  return `<div class="page-head workbench-product-toolbar" data-ui-key="page-heading"><div class="row"><button class="button" data-action="seed" ${state!.seedAvailable ? '' : 'disabled'}>导入示例素材</button><button class="button primary" data-action="add-product">＋ 添加商品</button></div></div>
  ${state!.libraryBusy ? `<div class="busy-bar" data-ui-key="execution-progress"><span class="spinner"></span>${esc(state!.libraryMessage || '素材处理中…')}</div>` : ''}
  <div class="library-product-bar" data-ui-key="library-product-picker"><div class="product-picker" data-product-picker><button type="button" class="select product-picker-trigger" data-product-picker-trigger aria-labelledby="library-product-value" aria-haspopup="listbox" aria-expanded="false" aria-controls="library-product-options" title="选择商品"><span id="library-product-value">${selectedProduct ? `${esc(selectedProduct.name)} · ${readyProductAssets(selectedProduct.productId).length} 段` : `全部商品 · ${products.length} 个`}</span><span aria-hidden="true">⌄</span></button><div class="product-picker-popup" data-product-picker-popup hidden><input type="search" class="input" data-product-search role="combobox" aria-label="搜索商品" aria-expanded="false" aria-autocomplete="list" aria-controls="library-product-options" placeholder="输入商品名称或 ID 搜索" autocomplete="off"><div id="library-product-options" role="listbox" aria-label="商品" class="product-picker-options">${libraryProductOptions(openSearch)}</div><div class="product-picker-hint" aria-live="polite" data-product-search-count>共 ${products.length} 个商品</div></div></div></div>
  ${selectedProduct ? `<div class="card library-product-info" data-ui-key="product-info:${esc(selectedProduct.productId)}"><div><strong>${esc(selectedProduct.name)}</strong><span class="section-hint">商品ID ${esc(selectedProduct.productId)}</span><p>${esc(money(selectedProduct.price))} · ${esc(selectedProduct.specification)}</p></div><div class="row"><button class="button" data-action="edit-product" data-id="${esc(selectedProduct.productId)}">编辑资料</button><button class="button primary" data-action="import-videos" data-id="${esc(selectedProduct.productId)}">添加视频</button></div></div>` : ''}
  <div class="card" data-ui-key="library-files"><div class="table-head library-files-head"><div class="section-title">素材文件 <span class="library-file-count" data-library-count>${list.length}</span></div><div class="library-tabs" role="group" aria-label="处理状态"><button data-library-tab="product" class="${libraryTab === 'product' ? 'active' : ''}" aria-pressed="${libraryTab === 'product'}">已处理</button><button data-library-tab="source" class="${libraryTab === 'source' ? 'active' : ''}" aria-pressed="${libraryTab === 'source'}">未处理与异常</button></div></div>
  <div class="library-media-tabs" role="group" aria-label="素材类型">${([['all','全部',statusList.length],['video','视频',statusList.length-imageCount],['image','图片',imageCount]] as const).map(([type,label,count]) => `<button class="${libraryMediaType === type ? 'active' : ''}" data-library-media="${type}" aria-pressed="${libraryMediaType === type}">${label}<span>${count}</span></button>`).join('')}</div>
  <div class="library-asset-grid">${list.length ? list.map(libraryAsset).join('') : `<div class="empty" style="grid-column:1/-1"><strong>${emptyTitle}</strong></div>`}</div></div>`;
}
function libraryAsset(asset: Asset): string {
  const image = isImageAsset(asset);
  const thumbnail = image ? asset.url : asset.posterUrl;
  return `<article class="library-asset" data-ui-key="asset:${esc(asset.id)}"><button class="asset-preview-button" data-action="preview-asset" data-id="${esc(asset.id)}" aria-label="预览 ${esc(asset.title)}" ${asset.available ? '' : 'disabled'}>${thumbnail ? `<img loading="lazy" src="${esc(thumbnail)}" alt="">` : '<span class="asset-poster-empty">暂无画面</span>'}${image ? '' : '<span class="asset-preview-mark">▶</span>'}</button><div class="library-asset-body"><div class="library-asset-title" title="${esc(asset.title)}">${esc(asset.title)}</div>${asset.error ? `<div class="section-hint" style="margin-top:5px;color:var(--red)">${esc(asset.error)}</div>` : ''}<div class="library-asset-actions">${['failed','partial','unavailable'].includes(asset.status) ? `<button class="button" data-action="retry-asset" data-id="${esc(asset.id)}">重试</button>` : ''}${asset.kind === 'product' ? `<button class="button danger" data-action="delete-asset" data-id="${esc(asset.id)}">移除</button>` : ''}</div></div></article>`;
}

function renderTask(task: Task): string {
  const voicePreparing = !task.completed && (submittingCopyConfirmation.has(task.id) || (task.copyConfirmed && !task.audioConfirmed && task.stage === 'voice'));
  const step = voicePreparing ? 'copy' : !workbenchGenerationOpen && task.stage==='copy'?'copy':'generation';
  const renderStatus = step === 'generation' && task.execution?.kind === 'render' && prototypeEditingRenderId !== task.execution.id;
  return `<main class="ec-video-production" data-ui-key="task:${esc(task.id)}" aria-label="视频制作">${productionFlow(step,task.completed || voicePreparing || task.execution?.status === 'running')}<div class="ec-video-production-content"><section class="ec-video-production-panel" id="ecommerceProductionStage" data-ui-key="stage:${step}:${task.completed}">${voicePreparing ? voicePreparationView(task, submittingCopyConfirmation.has(task.id)) : `${!renderStatus&&task.execution?.status==='running'?`<div class="ec-generation-task workbench-execution" data-ui-key="execution-progress"><strong>${esc(task.execution.message)}</strong><progress max="100" value="${task.execution.progress}" aria-label="生成进度"></progress><span>${Math.floor(task.execution.progress)}%</span></div>`:''}${!renderStatus&&task.error?`<div class="ec-generation-readiness workbench-error" role="alert">${esc(task.error)}</div>`:''}${task.completed?renderPreviewStage(task):renderStage(task)}`}</section></div></main>`;
}
function renderStage(task: Task): string {
  if (!workbenchGenerationOpen && task.stage === 'copy') return copyView(task, state!, {pending:!!pendingTaskSwitch,busy:taskSwitchBusy,productId:pendingTaskSwitch?.productId});
  preparePrototypeSelection(task);
  if (!task.nodes.some(node => node.id === workbenchNode)) workbenchNode = task.nodes[0]?.id || '';
  return generationView(task, state!, workbenchNode, prototypeSelection, prototypeClipId, prototypeEditingRenderId !== task.execution?.id, { busy: selectionSaving || selectionSubmitting.has(task.id) || renderSubmitting.has(task.id), dirty: selectionDirty });
}
function preparePrototypeSelection(task: Task): void {
  const stamp = JSON.stringify([task.id, task.shotSelection]);
  if (prototypeSelectionTaskId !== task.id || selectionStamp !== stamp) {
    prototypeSelectionTaskId = task.id; selectionStamp = stamp; selectionDirty = false;
    prototypeSelection.clear();
    for (const choice of task.shotSelection?.choices || []) prototypeSelection.set(choice.slotId, [...choice.assetIds]);
  }
}
async function saveShotChoices(task: Task): Promise<void> {
  const selection = task.shotSelection;
  if (!selection || selection.stale || selectionSaving || task.execution?.status === 'running' || renderSubmitting.has(task.id)) return;
  selectionDirty = true;
  const choices = selection.slots.map(slot => ({slotId: slot.id, assetIds: [...(prototypeSelection.get(slot.id) || [])]}));
  const short = selection.slots.find((slot, index) => choices[index].assetIds.reduce((sum, id) => { const asset = state!.assets.find(asset => asset.id === id); return sum + (asset?.videoDuration ?? asset?.duration ?? 0); }, 0) + 1e-6 < slot.duration);
  if (short) { render(); showToast('区间 ' + short.id + ' 时长不足，需要 ' + short.duration.toFixed(1) + ' 秒；调整尚未保存', true); return; }
  selectionSaving = true; render();
  try {
    await api<Task>('/api/tasks/' + task.id + '/selection', 'PUT', {choices});
    selectionDirty = false; selectionStamp = ''; await refresh(); showToast('素材调整已保存');
  } finally { selectionSaving = false; render(); }
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
  const script = task.nodes.map(node => {
    if (node.type === 'generated_narration') return `<div class="script-line" data-ui-key="script:${esc(node.id)}"><div class="script-label">待填写文案</div><textarea class="textarea" data-black-node="${esc(node.id)}" placeholder="AI生成后可手动修改" ${running ? 'disabled' : ''}>${esc(task.black[node.id] ?? node.text)}</textarea></div>`;
    const host = node.type === 'host_clip' ? state!.assets.find(asset => asset.kind === 'host' && asset.binding === node.id && asset.available) : undefined;
    return `<div class="script-line fixed ${node.type}" data-ui-key="script:${esc(node.id)}"><div class="script-label">${node.type === 'host_clip' ? '主播原声' : '固定口播'}</div><div class="script-text">${host ? `<button class="script-resource" data-action="preview-asset" data-id="${esc(host.id)}" title="预览对应主播片段">${esc(node.text)} <span aria-hidden="true">▷</span></button>` : esc(node.text)}</div></div>`;
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
  newElements<HTMLSelectElement>('[data-architecture-template]').forEach(select => select.addEventListener('change', () => { const templateId=select.value;workbenchTemplateId=templateId;const task=selectedTask();if(task)void requestTaskSwitch(task.productId,templateId,'architecture').catch(showError);else render(); }));
  newElements<HTMLSelectElement>('[data-create-product]').forEach(select => select.addEventListener('change', () => {
    if (!select.value) return; select.disabled = true;
    void api<Task>('/api/tasks', 'POST', {productId:select.value,templateId:workbenchTemplateId}).then(async task=>{selectedTaskId=task.id;workbenchGenerationOpen=false;workbenchNode='';prototypeSelection.clear();page='task';await refresh();window.scrollTo(0,0);}).catch(error=>{select.disabled=false;showError(error);});
  }));
  newElements<HTMLSelectElement>('[data-switch-product]').forEach(select => select.addEventListener('change', () => { const task=selectedTask();if(task)void requestTaskSwitch(select.value,task.templateId,'copy').catch(showError); }));
  newElements<HTMLButtonElement>('[data-library-board]').forEach(button => button.addEventListener('click', () => { libraryBoard=button.dataset.libraryBoard as typeof libraryBoard; render(); }));
  newElements<HTMLButtonElement>('[data-library-folder]').forEach(button => button.addEventListener('click', () => { if(libraryBoard==='anchor')anchorFolder=button.dataset.libraryFolder!;else {if(libraryProductId!==button.dataset.libraryFolder)librarySelectedSources.clear();libraryProductId=button.dataset.libraryFolder!;}render(); }));
  newElements<HTMLInputElement>('[data-source-select]').forEach(input=>input.addEventListener('change',()=>{if(input.checked)librarySelectedSources.add(input.value);else librarySelectedSources.delete(input.value);render();}));
  newElements<HTMLInputElement>('[data-source-select-all]').forEach(input=>input.addEventListener('change',()=>{const ids=input.dataset.ids?.split(',').filter(Boolean)||[];ids.forEach(id=>input.checked?librarySelectedSources.add(id):librarySelectedSources.delete(id));render();}));
  newElements<HTMLElement>('[data-black-edit]').forEach(editor => {
    const save = async () => { const proxy=document.createElement('textarea');proxy.dataset.blackNode=editor.dataset.blackEdit;proxy.value=editor.innerText;await queueDraftFromInput(proxy);if(proxy.value!==editor.innerText)editor.textContent=proxy.value; };
    editor.addEventListener('input', event=>{if(!(event as InputEvent).isComposing)void save().catch(showError);});editor.addEventListener('compositionend',()=>{void save().catch(showError);});
  });
  newElements<HTMLInputElement>('[data-library-product-search],[data-library-asset-search]').forEach(input=>{const save=()=>{if(input.hasAttribute('data-library-product-search'))libraryProductQuery=input.value;else libraryAssetQuery=input.value;render();};input.addEventListener('input',event=>{if(!(event as InputEvent).isComposing)save();});input.addEventListener('compositionend',save);});
  newElements<HTMLElement>('[data-record-detail-row]').forEach(row=>{row.addEventListener('click',event=>{if((event.target as Element).closest('button,input,a'))return;const record=state!.tasks.find(t=>t.id===row.dataset.recordDetailRow);if(record)showModal(recordDetailsView(record));});row.addEventListener('keydown',event=>{if(event.target!==row||!['Enter',' '].includes(event.key))return;event.preventDefault();const record=state!.tasks.find(t=>t.id===row.dataset.recordDetailRow);if(record)showModal(recordDetailsView(record));});});
  newElements<HTMLElement>('[data-open-task]').forEach(element => element.addEventListener('click', () => { void openTask(element.dataset.openTask || '').catch(showError); }));
  newElements<HTMLButtonElement>('[data-stage]').forEach(button => button.addEventListener('click', () => { const target = button.dataset.stage as Stage; void goStage(target).catch(showError); }));
  newElements<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => { void handleAction(button).catch(showError); }));
  newElements<HTMLButtonElement>('[data-library-tab]').forEach(button => button.addEventListener('click', () => { libraryTab = button.dataset.libraryTab || 'product'; render(); }));
  newElements<HTMLButtonElement>('[data-library-media]').forEach(button => button.addEventListener('click', () => { libraryMediaType = button.dataset.libraryMedia as typeof libraryMediaType; render(); }));
  const productPicker = root.querySelector<HTMLElement>('[data-product-picker]');
  if (productPicker !== libraryPickerElement) {
    libraryPickerListeners?.abort(); libraryPickerListeners = undefined; libraryPickerElement = productPicker ?? undefined;
    if (productPicker) bindLibraryProductPicker(productPicker);
  }
  const recordForm = newElements<HTMLFormElement>('[data-record-search]')[0];
  if (recordForm) {
    const readFilters = () => { const data = new FormData(recordForm); recordFilters = { keyword: String(data.get('keyword') || ''), taskId: String(data.get('taskId') || ''), productId: String(data.get('productId') || ''), status: String(data.get('status') || ''), from: String(data.get('from') || ''), to: String(data.get('to') || '') }; };
    recordForm.addEventListener('input', readFilters); recordForm.addEventListener('change', readFilters);
    recordForm.addEventListener('submit', event => {
      event.preventDefault(); readFilters();
      if (recordFilters.from && recordFilters.to && recordFilters.from > recordFilters.to) { showToast('开始日期不能晚于结束日期', true); return; }
      appliedRecordFilters = { ...recordFilters }; render();
    });
    recordForm.querySelector('[data-reset-record-search]')?.addEventListener('click', () => { recordFilters = { keyword: '', taskId: '', productId: '', status: '', from: '', to: '' }; appliedRecordFilters = { ...recordFilters }; render(); });
  }
  newElements<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach(input => input.addEventListener(input instanceof HTMLInputElement && input.type === 'range' ? 'input' : 'change', () => saveSettings(input)));
  newElements<HTMLInputElement | HTMLTextAreaElement>('[data-field], [data-black-node]').forEach(input => { const save=()=>{void queueDraftFromInput(input).catch(showError);};input.addEventListener('input',event=>{if(!(event as InputEvent).isComposing)save();});input.addEventListener('compositionend',save); });
  newElements<HTMLFormElement>('form[data-form]').forEach(form => form.addEventListener('submit', event => { event.preventDefault(); void submitForm(form).catch(() => undefined); }));
  const manualList = newElements<HTMLElement>('.manual-list')[0];
  if (manualList) bindSortableList(manualList, {
    canSort: () => selectedTask()?.execution?.status !== 'running',
    onBusy: busy => { manualSortBusy = busy; },
    onMove: (from, to) => { const [asset] = manualSelection.splice(from, 1); manualSelection.splice(to, 0, asset); render(); },
  });
  newElements<HTMLElement>('[data-paragraph-sort]').forEach(list => bindParagraphSort(list, {
    canSort: () => selectedTask()?.execution?.status !== 'running' && !renderSubmitting.has(selectedTaskId) && !taskSwitchBusy && !selectionSaving && !selectedTask()?.shotSelection?.stale,
    onBusy: busy => { manualSortBusy = busy; },
    onMove: (nodeId, from, to) => {
      const task = selectedTask();
      const slot = task?.shotSelection?.slots.find(slot => slot.id === nodeId);
      const ids = prototypeSelection.get(nodeId);
      if (!task || !slot || task.shotSelection?.stale || !ids || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return;
      const [asset] = ids.splice(from, 1); ids.splice(to, 0, asset);
      void saveShotChoices(task).catch(showError);
    },
  }));
}
async function navigate(target: Page): Promise<void> {
  if(taskSwitchBusy)return;
  pendingTaskSwitch=null;
  workbenchTemplateId=selectedTask()?.templateId || workbenchTemplateId;
  const task = selectedTask(); if (task) await flushTaskDraft(task.id);
  if (page === 'production' || page === 'task') productionPage = page;
  page = target === 'production' && productionPage === 'task' && selectedTask() && !selectedTask()!.completed ? 'task' : target;
  render();
  window.scrollTo(0,0);
}
async function openTask(id: string): Promise<void> {
  const current = selectedTask(); if (current) await flushTaskDraft(current.id);
  selectedTaskId = id; page = 'task'; workbenchGenerationOpen=false; resetManualSelection(id); previewPrompts.delete(id); render();
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
  if (originalTask.execution?.status === 'running' || submittingCopyConfirmation.has(originalTask.id)) { showToast('任务运行中，请稍候'); return; }
  await flushTaskDraft(originalTask.id);
  const task = selectedTask(); if (!task) return;
  if (target === 'preview' && manualPlanChanged(task)) { showToast('请先保存手动方案，再生成预览', true); return; }
  const valid: Record<Stage, boolean> = { copy: true, voice: task.copyConfirmed, visual: task.audioConfirmed, preview: !!task.plan?.valid };
  if (!valid[target]) { showToast(target === 'voice' ? '请先确认商品文案' : target === 'visual' ? '请先确认所有必需配音区间' : '请先建立有效的画面方案', true); return; }
  if (target === 'preview') previewPrompts.delete(task.id);
  workbenchGenerationOpen=false;
  await mutate(`/api/tasks/${encodeURIComponent(task.id)}`, 'PATCH', { stage: target });
  root?.querySelector('.ec-video-production-content')?.scrollTo(0,0);
}
async function queueDraftFromInput(input: HTMLInputElement | HTMLTextAreaElement): Promise<void> {
  const task = selectedTask(); if (!task || !input.dataset.field && !input.dataset.blackNode) return;
  const fieldKey = input.dataset.blackNode ? `black:${input.dataset.blackNode}` : input.dataset.field || '';
  const warningKey = `${task.id}:${fieldKey}`;
  const needsAudioWarning = !!input.dataset.blackNode || input.dataset.field === 'variable';
  const relatedAudio = needsAudioWarning && task.intervals.some(interval => interval.status === 'ready' && (!input.dataset.blackNode || interval.nodeIds.includes(input.dataset.blackNode)));
  const previous = input.dataset.blackNode ? task.black[input.dataset.blackNode] ?? '' : input.dataset.field === 'variable' ? task.variable : '';
  if (input.value !== previous && relatedAudio && !draftWarnings.has(warningKey)) {
    const subject = input.dataset.blackNode ? '这段文案' : '口播变量';
    if (!await askConfirmation('修改已配音的文案', `${subject}已有配音。保存修改后，需要重做受影响的连续口播配音。`, '继续修改')) { input.value = previous; return; }
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
  const task = selectedTask(); if (!task || task.completed || task.execution?.status === 'running' || renderSubmitting.has(task.id)) return;
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
  if (!Object.entries(settings).some(([key, value]) => task.settings[key as keyof Task['settings']] !== value)) return;
  task.settings = {...task.settings, ...settings};
  if (task.preview) task.previewStale = true;
  queueTaskPatch(task.id, { settings });
  if (!(input instanceof HTMLInputElement && input.type === 'range')) render();
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
  if(taskSwitchBusy)return;
  if(pendingTaskSwitch && ['workbench-stage','new-task','generate-copy','confirm-copy'].includes(action || '')){showToast('请先应用或取消当前切换');return;}
  if (action === 'confirm-copy' && task) {
    const candidate = task;
    if (submittingCopyConfirmation.has(candidate.id)) return;
    const complete = candidate.nodes.every(node => node.type !== 'generated_narration' || (candidate.black[node.id] || '').trim());
    if (!complete || candidate.execution?.status === 'running') return showToast('请先完成所有文案并等待当前任务结束', true);
    submittingCopyConfirmation.add(candidate.id);
    render();
    try {
      await flushTaskDraft(candidate.id);
      const currentTask = selectedTask();
      if (!currentTask || currentTask.id !== candidate.id) return;
      if (currentTask.execution?.status === 'running') return showToast('请等待当前任务结束', true);
      await mutate(`/api/tasks/${encodeURIComponent(candidate.id)}/copy/confirm`, 'POST', {generateVoice:true}, '文案已确认，正在准备配音');
      root?.querySelector('.ec-video-production-content')?.scrollTo(0,0);
    } finally {
      submittingCopyConfirmation.delete(candidate.id);
      render();
    }
    return;
  }
  const voiceRunning = !!task && task.execution?.kind === 'voice' && task.execution.status === 'running';
  if (action === 'workbench-stage' && (voiceRunning || (!!task && submittingCopyConfirmation.has(task.id)))) return showToast('配音准备中，请稍候');
  if (['prototype-remove', 'prototype-materials', 'confirm-prototype-materials'].includes(action || '') && (selectionSaving || renderSubmitting.has(selectedTaskId) || task?.execution?.status === 'running' || task?.shotSelection?.stale)) return;
  if(action==='confirm-switch-task' && pendingTaskSwitch){
    const choice=pendingTaskSwitch;if(choice.taskId!==task?.id)return;
    const mode=button.dataset.mode;if(mode!=='new'&&mode!=='overwrite')return;
    taskSwitchBusy=true;render();
    const controls=[...document.querySelectorAll<HTMLButtonElement>('.task-switch-choice-modal button')];controls.forEach(button=>{button.disabled=true;});
    try{await flushTaskDraft(choice.taskId);await applyTaskSwitch(choice,mode);}finally{taskSwitchBusy=false;controls.forEach(button=>{button.disabled=false;});render();}
    return;
  }
  if(action==='confirm-modal'){const resolve=modalDecision;modalDecision=null;closeModal();resolve?.(true);return;}
  if (action === 'audition-bgm') return toggleBgmAudition();
  if (task) { await flushTaskDraft(task.id); task = selectedTask(); }
  if (action === 'refresh' || action === 'task-refresh') return refresh();
  if (action === 'home') { page = 'production'; selectedTaskId = ''; return render(); }
  if (action === 'new-task') { selectedTaskId='';workbenchGenerationOpen=false;page='production';workbenchSetupStep='architecture';return render(); }
  if (action === 'workbench-stage') {
    if (state!.activeExecution) return showToast('配音正在生成，请稍候');
    const step=button.dataset.step;
    if (step==='architecture') { workbenchGenerationOpen=false;workbenchTemplateId=task?.templateId || workbenchTemplateId;page='production';workbenchSetupStep='architecture';return render(); }
    if (step==='copy') { if(task) { page='task';return goStage('copy'); } workbenchSetupStep='copy';return render(); }
    if (task && (page==='task'||task.templateId===workbenchTemplateId)) {page='task';workbenchGenerationOpen=true;render();root?.querySelector('.ec-video-production-content')?.scrollTo(0,0);return;}
    workbenchSetupStep='generation';return render();
  }
  if (action === 'select-shot') { workbenchNode=button.dataset.id!;prototypeClipId='';return render(); }
  if (action === 'edit-host-image' && task) return openHostImageEditor(task);
  if (action === 'prototype-edit' && task) { prototypeEditingRenderId=task.execution?.id || '';return render(); }
  if (action === 'prototype-rematch' && task) {
    if (selectionDirty) return showToast('请先补齐时长并保存手动调整', true);
    if (!task.copyConfirmed || !task.audioConfirmed || state!.activeExecution || task.execution?.status === 'running' || selectionSubmitting.has(task.id) || selectionSaving || renderSubmitting.has(task.id)) return;
    selectionSubmitting.add(task.id); render();
    try { await api<Task>('/api/tasks/' + task.id + '/selection', 'POST'); await refresh(); startPolling(); }
    finally { selectionSubmitting.delete(task.id); render(); }
    return;
  }
  if (action === 'save-shot-choices' && task) return saveShotChoices(task);
  if (action === 'prototype-clip') {if(button.dataset.nodeId)workbenchNode=task?.shotSelection?.slots.find(slot => slot.id === button.dataset.nodeId)?.nodeId || button.dataset.nodeId;prototypeClipId=button.dataset.id!;return render();}
  if (action === 'prototype-play') {const videos=[...root!.querySelectorAll<HTMLVideoElement>('.ec-generation-player video')];if(videos.every(v=>v.paused))await Promise.all(videos.map(v=>v.play()));else videos.forEach(v=>v.pause());return;}
  if (action === 'prototype-remove' && task) {
    const slotId = button.dataset.slotId!;
    if (!task.shotSelection?.slots.some(slot => slot.id === slotId)) return;
    const ids = [...(prototypeSelection.get(slotId) || [])]; ids.splice(Number(button.dataset.index), 1);
    prototypeSelection.set(slotId, ids); return saveShotChoices(task);
  }
  if (action === 'prototype-materials' && task) {
    const slotId = button.dataset.slotId!;
    const slot = task.shotSelection?.slots.find(slot => slot.id === slotId);
    if (!slot || task.shotSelection?.stale) return;
    const next = { nodeId: slotId, mask: false, ids: [...(prototypeSelection.get(slotId) || [])] };
    showModal(materialPickerView(task, state!, slotId, next.ids, false)); prototypePicker = next; return;
  }
  if(action==='toggle-prototype-material'&&prototypePicker){const id=button.dataset.id!,index=prototypePicker.ids.indexOf(id);if(index>=0)prototypePicker.ids.splice(index,1);else prototypePicker.ids.push(id);const selected=prototypePicker.ids.includes(id);button.textContent=selected?'✓ 已选择':'＋ 选择';button.setAttribute('aria-pressed',String(selected));button.closest('article')?.classList.toggle('is-selected',selected);const count=document.querySelector('[data-picker-count]');if(count)count.textContent=`已选 ${prototypePicker.ids.length} 项`;return;}
  if (action === 'confirm-prototype-materials' && prototypePicker && task) {
    const slot = task.shotSelection?.slots.find(slot => slot.id === prototypePicker!.nodeId);
    if (!slot || task.shotSelection?.stale) return;
    prototypeSelection.set(slot.id, [...prototypePicker.ids]); workbenchNode = slot.nodeId; prototypeClipId = '';
    closeModal(); return saveShotChoices(task);
  }
  if(action==='preview-picker-asset'){const asset=state!.assets.find(a=>a.id===button.dataset.id);if(!asset?.url)return;const dialog=document.createElement('dialog');dialog.className='ec-library-dialog';dialog.innerHTML=`<header><h3>${esc(asset.title)}</h3><button aria-label="关闭预览">×</button></header><video controls playsinline preload="metadata" src="${esc(asset.url)}"></video>`;dialog.querySelector('button')!.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});document.body.append(dialog);dialog.showModal();return;}
  if (action === 'record-details') { const record=state!.tasks.find(item=>item.id===button.dataset.id);if(record)showModal(recordDetailsView(record));return; }
  if (action === 'choose-product-import') {libraryBoard='product';showModal(`<div class="modal"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>选择商品</h2><p class="modal-intro">将视频添加到对应商品的素材目录。</p>${state!.products.map(p=>`<button class="button" data-action="import-videos" data-id="${esc(p.productId)}">${esc(p.name)}</button>`).join('')}</div>`);return;}

  if (action === 'add-product') return showModal(productModal());
  if (action === 'edit-product') { const product = state!.products.find(item => item.productId === button.dataset.id); if (product) showModal(productModal(product)); return; }
  if (action === 'choose-folder') {
    const label = button.textContent; button.disabled = true; button.textContent = '选择中…';
    try {
      const result = await api<{ paths: string[] }>('/api/dialog', 'POST', { kind: 'folder' });
      const target = document.getElementById(button.dataset.target || '') as HTMLInputElement | null;
      if (target && result.paths[0]) target.value = result.paths[0];
    } finally { button.disabled = false; button.textContent = label; }
    return;
  }
  if (action === 'change-root') return showModal(dataRootModal());
  if (action === 'setup') { const input = document.querySelector<HTMLInputElement>('#data-root'); await mutate('/api/setup', 'POST', { dataRoot: input?.value.trim() || undefined }, '工作目录已保存'); return; }
  if (action === 'seed') { startPolling(); await mutate('/api/seed', 'POST', {}, '示例素材导入完成'); return; }
  if (action === 'import-videos') return showModal(importModal(button.dataset.id || ''));
  if (action === 'preview-asset') {
    const asset = state!.assets.find(item => item.id === button.dataset.id);
    if (!asset?.url || !asset.available) return showToast('该素材暂不可用，请检查来源文件', true);
    if (isImageAsset(asset)) return showModal(`<div class="modal asset-image-modal"><button class="modal-close" data-close-modal aria-label="关闭预览">×</button><h2>${esc(asset.title)}</h2><img src="${esc(asset.url)}" alt="${esc(asset.title)}"></div>`);
    if (asset.kind === 'bgm') return showModal(`<div class="modal"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>${esc(asset.title)}</h2><audio controls preload="metadata" src="${esc(asset.url)}" style="width:100%;margin-top:20px"></audio></div>`);
    return showVideoPreview(asset.title, asset.url, 0, undefined, `${duration(asset.duration)} · ${asset.width || ''}×${asset.height || ''}`);
  }
  if (action === 'process-assets') { const ids=(button.dataset.ids || button.dataset.id || '').split(',').filter(Boolean); await processSources(ids); return; }
  if (action === 'retry-asset') { const asset=state!.assets.find(item=>item.id===button.dataset.id); if(asset?.kind==='source'){await processSources([asset.id]);return;} await mutate(`/api/assets/${encodeURIComponent(button.dataset.id || '')}/retry`, 'POST', {}, '已完成重试'); return; }
  if (action === 'delete-asset') { if (!await askConfirmation('移除商品素材', '确认从素材库移除此商品片段？正在合成使用的素材不能删除。', '移除')) return; await mutate(`/api/assets/${encodeURIComponent(button.dataset.id || '')}`, 'DELETE', undefined, '素材记录已更新'); return; }
  if (action === 'record-open') { closeModal(); const id = button.dataset.id || ''; if (prototypeSelectionTaskId !== id) {workbenchNode='';prototypeSelectionTaskId='';prototypeSelection.clear();} selectedTaskId = id; workbenchGenerationOpen=false;page = 'task'; resetManualSelection(selectedTaskId); previewPrompts.delete(selectedTaskId); const record = selectedTask(); if (record?.completed) record.stage = 'preview'; render(); return; }
  if (action === 'record-export') { showModal(exportModal(button.dataset.id || '')); return; }
  if (!task) return;
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
    if (existingCopy && !await askConfirmation('重新生成文案', '将重新生成全部待填内容。生成失败时保留现有文案。', '重新生成')) return;
    await mutate(`/api/tasks/${encodeURIComponent(task.id)}/copy`, 'POST', {}, '已提交商品文案生成');
    root?.querySelector('[data-copy-preview]')?.scrollIntoView({ block: 'nearest' }); return;
  }
  if (action === 'generate-voice') {
    if (submittingCopyConfirmation.has(task.id) || task.execution?.status === 'running') return;
    const id = button.dataset.id;
    submittingCopyConfirmation.add(task.id); render();
    try { await mutate(`/api/tasks/${encodeURIComponent(task.id)}/voice`, 'POST', {autoConfirm:true,...(id?{intervalId:id}:{})}, '已提交配音生成'); }
    finally { submittingCopyConfirmation.delete(task.id); render(); }
    return;
  }
  if (action === 'confirm-voice') { if (task.audioConfirmed) await goStage('visual'); else await mutate(`/api/tasks/${encodeURIComponent(task.id)}/voice/confirm`, 'POST', {}, '配音已确认'); return; }
  if (action === 'auto-plan') { const updated = await api<Task>(`/api/tasks/${encodeURIComponent(task.id)}/plan`, 'POST', {}); state!.tasks = state!.tasks.map(item => item.id === task.id ? updated : item); resetManualSelection(task.id); showToast('随机画面方案已生成'); render(); return; }
  if (action === 'add-manual-asset') { manualSelection.push(button.dataset.id || ''); render(); return; }
  if (action === 'remove-manual-asset') { const index = Number(button.dataset.index); if (index >= 0 && index < manualSelection.length) manualSelection.splice(index, 1); render(); return; }
  if (action === 'clear-manual-plan') { manualSelection = []; render(); return; }
  if (action === 'save-manual-plan') { await mutate(`/api/tasks/${encodeURIComponent(task.id)}/plan`, 'PUT', { assetIds: manualSelection }, '手动方案已保存'); return; }
  if (action === 'go-preview') return goStage('preview');
  if (action === 'back-visual') { await mutate(`/api/tasks/${encodeURIComponent(task.id)}`, 'PATCH', { stage: 'visual' }); return; }
  if (action === 'render-task' || action === 'confirm-render') {
    const blocker = renderBlocker(task, state!, {busy: selectionSaving || selectionSubmitting.has(task.id) || renderSubmitting.has(task.id), dirty: selectionDirty && prototypeSelectionTaskId === task.id}, prototypeSelectionTaskId === task.id ? prototypeSelection : undefined);
    if (blocker) return showToast(blocker, true);
    if (action === 'render-task' && task.preview) return showRegenerationDialog(task);
    if (action === 'confirm-render') closeModal();
    renderSubmitting.add(task.id); prototypeEditingRenderId = ''; render();
    try { await mutate(`/api/tasks/${encodeURIComponent(task.id)}/render`, 'POST', {}, '已提交本地视频合成'); }
    finally { renderSubmitting.delete(task.id); render(); }
    return;
  }
  if (action === 'stop-task') { await mutate(`/api/tasks/${encodeURIComponent(task.id)}/stop`, 'POST', {}, '已请求停止本地合成'); return; }
  if (action === 'complete-task') {
    if (task.completed || task.previewStale || !task.preview || task.execution?.status === 'running' || selectionDirty || renderSubmitting.has(task.id)) return showToast('请先生成并查看当前有效预览', true);
    showModal(`<div class="modal completion-dialog"><button class="modal-close" data-close-modal aria-label="关闭确认窗口">×</button><h2>确认完成</h2><p class="modal-intro">确认当前有效预览为最终成片？</p><div class="modal-footer"><button class="button" data-close-modal>取消</button><button class="button primary" data-action="confirm-complete-task" data-id="${esc(task.id)}">确认完成</button></div></div>`);
    document.querySelector<HTMLButtonElement>('.completion-dialog .modal-footer [data-close-modal]')?.focus(); return;
  }
  if (action === 'confirm-complete-task') {
    if (button.disabled || button.dataset.id !== task.id || task.previewStale || !task.preview || task.execution?.status === 'running' || selectionDirty) return;
    button.disabled = true;
    try { await mutate(`/api/tasks/${encodeURIComponent(task.id)}/complete`, 'POST', {}, '成片已确认完成'); closeModal(); }
    catch (error) { button.disabled = false; throw error; }
    return;
  }
  if (action === 'export-preview') { showModal(exportModal(task.id)); return; }
}
function showModal(content: string): void {
  closeModal();
  const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'; backdrop.innerHTML = content; document.body.append(backdrop);
  if(backdrop.querySelector('.ec-led-dialog'))backdrop.classList.add('ec-video-ledger','workbench-prototype-backdrop');
  if(backdrop.querySelector('.ec-material-picker'))backdrop.classList.add('ecommerce-video-workspace','workbench-prototype-backdrop');
  const dialog = backdrop.querySelector('.modal,.ec-led-dialog,.ec-material-picker'); dialog?.setAttribute('role', 'dialog'); dialog?.setAttribute('aria-modal', 'true');
  const title = backdrop.querySelector('h2'); if (title) { title.id = 'dialog-title'; dialog?.setAttribute('aria-labelledby', title.id); }
  backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(); });
  backdrop.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
  backdrop.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(button => button.addEventListener('click', () => { void handleAction(button).catch(showError); }));
  backdrop.querySelectorAll<HTMLFormElement>('form[data-form]').forEach(form => form.addEventListener('submit', event => { event.preventDefault(); void submitForm(form).catch(showError); }));
  backdrop.querySelector<HTMLInputElement>('[data-picker-search]')?.addEventListener('input', event => { const query = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase(); backdrop.querySelectorAll<HTMLElement>('[data-material-name]').forEach(card => { card.hidden = !card.dataset.materialName!.includes(query); }); });
}
function closeModal(): void {
  if (document.querySelector('.host-image-dialog[aria-busy="true"]')) return;
  disposeHostImageEditor?.(); disposeHostImageEditor=null;
  const cancellingSwitch=!!pendingTaskSwitch && !!document.querySelector('.task-switch-choice-modal');
  if(cancellingSwitch && taskSwitchBusy)return;
  const resolve=modalDecision;modalDecision=null;resolve?.(false);
  prototypePicker=null;document.querySelectorAll<HTMLDialogElement>('.ec-library-dialog').forEach(dialog=>dialog.close());
  const completion = document.querySelector('.completion-dialog');
  document.querySelectorAll<HTMLMediaElement>('.modal-backdrop video,.modal-backdrop audio').forEach(media => media.pause()); document.querySelector('.modal-backdrop')?.remove();
  if(cancellingSwitch){pendingTaskSwitch=null;workbenchTemplateId=selectedTask()?.templateId || workbenchTemplateId;render();}
  if (completion) root?.querySelector<HTMLButtonElement>('[data-action="complete-task"]')?.focus({ preventScroll: true });
}
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.querySelector('.ec-library-dialog[open]')) closeModal(); });

function askConfirmation(title: string, message: string, action: string): Promise<boolean> {
  showModal(`<div class="ec-led-dialog ec-led-dialog--narrow"><header><div><h2>${esc(title)}</h2></div><button type="button" data-close-modal aria-label="关闭">×</button></header><div class="ec-led-dialog-body"><p class="ec-led-hint">${esc(message)}</p></div><footer><span class="is-spacer"></span><button type="button" class="ec-led-btn" data-close-modal>取消</button><button type="button" class="ec-led-btn ec-led-btn--primary" data-action="confirm-modal">${esc(action)}</button></footer></div>`);
  return new Promise(resolve=>{modalDecision=resolve;});
}

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
  const blocker = renderBlocker(task, state!, {busy: selectionSaving || selectionSubmitting.has(task.id) || renderSubmitting.has(task.id), dirty: selectionDirty});
  showModal(`<div class="modal regeneration-dialog"><button class="modal-close" data-close-modal aria-label="关闭重新生成提示">×</button><h2>${stale ? '预览需要重新生成' : '重新生成预览'}</h2>${stale ? `<p class="modal-intro">旧预览尚未包含以下修改：</p><ul class="preview-changes">${changes.map(change => `<li>${esc(change)}</li>`).join('')}</ul>` : '<p class="modal-intro">沿用当前已保存的画面重新合成。</p>'}<p class="section-hint">保留当前素材顺序和配音，仅执行本地合成。需要更换选片时，请返回编辑并单独点击重新匹配。</p>${blocker ? `<div class="warning">${esc(blocker)}</div>` : ''}<div class="modal-footer"><button class="button" data-close-modal>暂不生成</button><button class="button primary" data-action="confirm-render" ${blocker ? 'disabled' : ''}>确认重新生成</button></div></div>`);
}
function newTaskModal(): string {
  return `<div class="modal"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>新建视频任务</h2><p class="modal-intro">每个任务会保存商品与模板快照，之后修改商品资料不会影响已有任务。</p><form data-form="new-task"><label class="field-label">选择商品</label><select class="select" name="productId" required>${state!.products.map(product => `<option value="${esc(product.productId)}">${esc(product.name)} · ${readyProductAssets(product.productId).length} 段可用素材</option>`).join('')}</select><label class="field-label">选择模板</label><select class="select" name="templateId" required>${state!.templates.map(template => `<option value="${esc(template.id)}">${esc(template.name)} — ${esc(template.title)}</option>`).join('')}</select>${!state!.products.length ? `<div class="warning">请先添加商品资料并导入素材，再创建视频任务。</div>` : ''}<div class="modal-footer"><button type="button" class="button" data-close-modal>取消</button><button class="button primary" ${!state!.products.length || !state!.templates.length ? 'disabled' : ''}>创建任务</button></div></form></div>`;
}
function productModal(product?: Product): string {
  return `<div class="modal"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>${product ? '编辑商品资料' : '添加商品'}</h2><form data-form="product" data-id="${esc(product?.productId || '')}"><label class="field-label">商品名称</label><input class="input" name="name" required value="${esc(product?.name || '')}" placeholder="例如：轻便随行杯"><div class="grid" style="grid-template-columns:1fr 1fr;gap:10px"><div><label class="field-label">价格</label><input class="input" name="price" value="${esc(product?.price || '')}" placeholder="如 129"></div><div><label class="field-label">规格</label><input class="input" name="specification" value="${esc(product?.specification || '')}" placeholder="容量、颜色等"></div></div><label class="field-label">商品卖点</label><textarea class="textarea" name="sellingPoints" placeholder="填写可用于生成口播的商品特点">${esc(product?.sellingPoints || '')}</textarea><div class="modal-footer"><button type="button" class="button" data-close-modal>取消</button><button class="button primary">${product ? '保存资料' : '添加商品'}</button></div></form></div>`;
}
function importModal(productId: string): string {
  const product = state!.products.find(item => item.productId === productId);
  return `<div class="modal"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>导入商品视频</h2><p class="modal-intro">添加到「${esc(product?.name || '')}」。原始视频导入后可切分并命名。</p><form data-form="import" data-id="${esc(productId)}"><label class="field-label">素材类型</label><select class="select" name="processed"><option value="false">原始视频</option><option value="true">视频切片 · 直接入库</option></select><label class="field-label">选择视频</label><input class="input" type="file" name="videos" accept="video/*,.mp4,.mov,.mkv,.webm,.avi" multiple><div class="section-hint" data-video-count>尚未选择</div><div class="section-hint" data-video-names style="margin-top:7px"></div><div class="modal-footer"><button type="button" class="button" data-close-modal>取消</button><button class="button primary">开始导入</button></div></form></div>`;
}
async function requestTaskSwitch(productId: string, templateId: string, origin: PendingTaskSwitch['origin']): Promise<void> {
  const task=selectedTask();
  if(!task || taskSwitchBusy || task.completed || state!.activeExecution)return;
  if(task.productId===productId && task.templateId===templateId)return;
  const choice={taskId:task.id,productId,templateId,origin};
  taskSwitchBusy=true;render();
  try{
    await flushTaskDraft(task.id);
    const current=selectedTask()!,submitted=!!current.videoSubmittedAt;
    if(submitted || Object.values(current.black).some(text=>text.trim())){
      showModal(`<div class="modal task-switch-choice-modal"><button type="button" class="modal-close" data-close-modal aria-label="关闭">×</button><h2>${submitted ? '选择创建方式' : '确认切换'}</h2><p class="modal-intro">${submitted ? '覆盖会清空当前进度；保留并新建后，原任务可从生成记录继续。' : '切换将覆盖当前草稿，清空已有文案、配音与画面设置。'}</p><div class="modal-footer"><button type="button" class="button" data-close-modal>取消</button><button type="button" class="button ${submitted ? '' : 'primary'}" data-action="confirm-switch-task" data-mode="overwrite">${submitted ? '覆盖当前任务' : '确认覆盖'}</button>${submitted ? '<button type="button" class="button primary" data-action="confirm-switch-task" data-mode="new">保留并新建</button>' : ''}</div></div>`);
      pendingTaskSwitch=choice;document.querySelector<HTMLButtonElement>('.task-switch-choice-modal .modal-footer [data-close-modal]')?.focus();
    }
    else await applyTaskSwitch(choice,'overwrite');
  }catch(error){workbenchTemplateId=task.templateId;throw error;}
  finally{taskSwitchBusy=false;render();}
}
async function applyTaskSwitch(choice: PendingTaskSwitch, mode: 'new' | 'overwrite'): Promise<void> {
  const task=await api<Task>(`/api/tasks/${encodeURIComponent(choice.taskId)}/switch`,'POST',{productId:choice.productId,templateId:choice.templateId,mode});
  state!.tasks=[...state!.tasks.filter(item=>item.id!==task.id),task];
  pendingTaskSwitch=null;closeModal();selectedTaskId=task.id;workbenchNode='';prototypeClipId='';prototypeSelectionTaskId='';prototypeSelection.clear();
  workbenchTemplateId=task.templateId;workbenchGenerationOpen=false;manualSelectionTaskId='';manualSelection=[];
  page=choice.origin==='architecture'?'production':'task';workbenchSetupStep=choice.origin==='architecture'?'architecture':'copy';
  await refresh();
}
function dataRootModal(): string {
  return `<div class="modal"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>更换数据目录</h2><p class="modal-intro">已有数据不会自动搬迁。切换后将使用新目录中的工作数据；切换期间不能有任务执行或素材导入。</p><form data-form="change-root"><label class="field-label">当前数据目录</label><div class="path-picker"><input class="input" id="new-data-root" name="dataRoot" value="${esc(state!.dataRoot)}"><button type="button" class="button" data-action="choose-folder" data-target="new-data-root">选择</button></div><div class="modal-footer"><button type="button" class="button" data-close-modal>取消</button><button class="button primary">更换目录</button></div></form></div>`;
}
function exportModal(taskId: string): string {
  return `<div class="modal export-dialog"><button class="modal-close" data-close-modal aria-label="关闭">×</button><h2>导出副本</h2><form data-form="export" data-id="${esc(taskId)}"><label class="field-label" for="export-directory">保存到</label><div class="path-picker"><input class="input" id="export-directory" name="directory" value="${esc(state!.defaultExportDirectory)}" required><button type="button" class="button" data-action="choose-folder" data-target="export-directory">选择</button></div><p data-export-result role="status" style="overflow-wrap:anywhere"></p><div class="modal-footer"><button type="button" class="button" data-close-modal>取消</button><button type="submit" class="button primary">导出副本</button></div></form></div>`;
}
async function submitForm(form: HTMLFormElement): Promise<void> {
  const formName = form.dataset.form || ''; const data = new FormData(form); const value = (name: string): string => String(data.get(name) || '');
  if (formName === 'export') {
    if (form.dataset.exporting === 'true') return;
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const result = form.querySelector<HTMLElement>('[data-export-result]')!;
    form.dataset.exporting = 'true'; submit.disabled = true; submit.textContent = '正在导出…'; result.textContent = '';
    try {
      const saved = await api<{path: string}>(`/api/tasks/${encodeURIComponent(form.dataset.id || '')}/export`, 'POST', { directory: value('directory').trim() });
      result.textContent = `已导出：${saved.path}`; result.className = 'notice';
      showToast('成片副本已导出');
    } catch (error) { result.textContent = error instanceof Error ? error.message : '导出失败，请重试'; result.className = 'warning'; }
    finally { delete form.dataset.exporting; submit.disabled = false; submit.textContent = '导出副本'; }
    return;
  }
  if (formName === 'new-task') {
    const task = await api<Task>('/api/tasks', 'POST', { productId: value('productId'), templateId: value('templateId') });
    document.querySelector('.modal-backdrop')?.remove(); selectedTaskId = task.id; page = 'task'; await refresh(); return;
  }
  if (formName === 'product') {
    const productId = form.dataset.id;
    const payload = { name: value('name').trim(), price: value('price').trim(), specification: value('specification').trim(), sellingPoints: value('sellingPoints').trim() };
    if (productId) await api(`/api/products/${encodeURIComponent(productId)}`, 'PATCH', payload);
    else await api('/api/products', 'POST', { ...payload, productId: `product-${Date.now()}` });
    document.querySelector('.modal-backdrop')?.remove(); showToast(productId ? '商品资料已保存' : '商品已添加'); await refresh(); return;
  }
  if (formName === 'import') {
    const productId = form.dataset.id || ''; const processed = value('processed') === 'true'; const files=[...(form.querySelector<HTMLInputElement>('input[name="videos"]')?.files||[])];
    if(!files.length){showToast('请先选择视频文件',true);return;}
    if(form.dataset.uploading==='true')return;
    form.dataset.uploading='true';
    const submit=form.querySelector<HTMLButtonElement>('button.primary');if(submit){submit.disabled=true;submit.textContent='正在导入…';}
    try {
      startPolling();
      for(const file of files){const response=await fetch(`/api/products/${encodeURIComponent(productId)}/upload?name=${encodeURIComponent(file.name)}&processed=${processed}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});let payload:unknown;try{payload=await response.json();}catch{throw new Error(`上传失败 (${response.status})`);}if(!response.ok)throw new Error((payload as ApiError).message||`上传失败 (${response.status})`);}
      document.querySelector('.modal-backdrop')?.remove(); showToast('素材已导入'); await refresh();
    } finally { delete form.dataset.uploading;if(submit){submit.disabled=false;submit.textContent='开始导入';} }
    return;
  }
  if(formName==='processing-settings'){
    const threshold=Number(value('threshold')),minDurationSec=Number(value('minDurationSec'));
    if(!Number.isFinite(threshold)||threshold<0.1||threshold>100||!Number.isFinite(minDurationSec)||minDurationSec<0.1||minDurationSec>10){showToast('请检查切分阈值和最短时长范围',true);return;}
    try{await api('/api/library/processing-settings','PUT',{threshold,minDurationSec});await refresh();showToast('切分设置已保存');}catch(error){showToast(error instanceof Error?error.message:'保存切分设置失败',true);}return;
  }
  if (formName === 'change-root') {
    if (state!.activeExecution || state!.libraryBusy) { showToast('任务或素材正在处理中，暂不能更换目录。', true); return; }
    if (!await askConfirmation('更换数据目录', '更换后使用所选目录中的数据，已有数据不会自动搬迁。', '更换目录')) return;
    await api('/api/setup', 'POST', { dataRoot: value('dataRoot').trim() });
    document.querySelector('.modal-backdrop')?.remove(); showToast('数据目录已更换'); await refresh(); return;
  }
}
async function processSources(assetIds:string[]):Promise<void>{
  if(!assetIds.length)return;
  if(libraryProductId==='all'){showToast('请先选择一个商品目录',true);return;}
  const selected=assetIds.map(id=>state!.assets.find(asset=>asset.id===id)).filter((asset):asset is Asset=>!!asset&&asset.kind==='source'&&asset.productId===libraryProductId&&asset.processed!==true);
  if(!selected.length)return;
  const uncertain=selected.some(asset=>asset.naming?.status==='uncertain');
  if(uncertain&&!await askConfirmation('重新发起命名','上次命名结果不确定，继续将重新发起命名请求，可能再次计费','继续处理'))return;
  await api(`/api/products/${encodeURIComponent(libraryProductId)}/process`,'POST',{assetIds:selected.map(asset=>asset.id),...(uncertain?{confirmUncertain:true}:{})});
  selected.forEach(asset=>librarySelectedSources.add(asset.id));startPolling();await refresh();showToast('素材已加入切分与命名队列');
}

window.addEventListener('beforeunload', event => {
  if (state?.activeExecution || pendingTaskPatches.size || draftFlushes.size) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', stopBgmAudition);

document.addEventListener('change', event => {
  const input=(event.target as HTMLElement).closest<HTMLInputElement>('input[name="videos"]');
  if(input){const files=[...(input.files||[])],backdrop=document.querySelector('.modal-backdrop');const count=backdrop?.querySelector<HTMLElement>('[data-video-count]'),names=backdrop?.querySelector<HTMLElement>('[data-video-names]');if(count)count.textContent=files.length?`已选择 ${files.length} 个文件`:'尚未选择';if(names)names.textContent=files.map(file=>file.name).join('、');}
});

void refresh().catch(error => { if (root) root.innerHTML = `<div class="empty" style="margin:20vh auto;max-width:480px"><strong>无法连接本地工作台</strong>${esc(error instanceof Error ? error.message : String(error))}<div style="margin-top:15px"><button class="button" onclick="location.reload()">重新连接</button></div></div>`; });
