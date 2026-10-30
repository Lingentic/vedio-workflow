import { planShots, type RejectedCut, type Shot as PlannedShot } from '../cutting.ts';

type Job = {
  id: string; name: string; duration: number; fps: number;
  phase: 'scanning' | 'previewing' | 'ready' | 'failed' | 'cancelled';
  progress: number; error?: string; events: { timeSec: number; score: number }[]; previewReady: boolean;
};
type State = { job: Job | null; busy: boolean };
type Shot = PlannedShot;
type Plan = { shots: Shot[]; rejected: RejectedCut[] };
type SavedGroup = { id: string; name: string; source: string; threshold: number; minDurationSec: number; shots: number; median: number; savedAt: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const selectedFile = $('selected-file');
const fileInput = $('video-file') as HTMLInputElement;
const pickButton = $('pick-source') as HTMLButtonElement;
const analyzeButton = $('analyze') as HTMLButtonElement;
const thresholdInput = $('threshold') as HTMLInputElement;
const minInput = $('min-duration') as HTMLInputElement;
const thresholdNumber = $('threshold-number') as HTMLInputElement;
const minNumber = $('min-number') as HTMLInputElement;
const sourceVideo = $('source-video') as HTMLVideoElement;
const clipVideo = $('clip-video') as HTMLVideoElement;
const clipList = $('clip-list');
const LIMIT = 48;
const SAVED_KEY = 'split-lab-groups-v1';
let job: Job | null = null;
let busy = false;
let plan: Plan = { shots: [], rejected: [] };
let shown = LIMIT;
let selectedShot = '';
let lastAnalyzedSource = '';
let selectedSource = '';
let selectedFileKey = '';
let picking = false;
let clipRequest = 0;
let segmentStopListener: (() => void) | null = null;
let polling = false;
let lastPollMs = 0;
let renderedPlanKey = '';
const fmt = (seconds: number, centiseconds = true) => {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const rounded = centiseconds ? Math.round(safe * 100) / 100 : Math.round(safe);
  const mm = Math.floor(rounded / 60).toString().padStart(2, '0');
  const ss = (rounded % 60).toFixed(centiseconds ? 2 : 0).padStart(centiseconds ? 5 : 2, '0');
  return `${mm}:${ss}`;
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const setText = (id: string, value: string) => { $(id).textContent = value; };
const api = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error ?? ''; } catch { /* use status below */ }
    throw new Error(detail || `请求失败（${response.status}）`);
  }
  return response.json() as Promise<T>;
};
const currentSource = () => selectedSource;
const ready = () => Boolean(job?.phase === 'ready' && job.events && job.duration > 0);
const readGroups = (): SavedGroup[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    return Array.isArray(raw) ? raw.slice(0, 6) : [];
  } catch { return []; }
};

function calculatePlan(): Plan {
  if (!ready() || !job) return { shots: [], rejected: [] };
  return planShots(job.events, job.duration, {
    threshold: Number(thresholdInput.value),
    minDurationSec: Number(minInput.value),
  });
}

function renderParams(): void {
  if (document.activeElement !== thresholdNumber) thresholdNumber.value = Number(thresholdInput.value).toFixed(1);
  if (document.activeElement !== minNumber) minNumber.value = Number(minInput.value).toFixed(1);
  if (!ready()) return;
  const key = `${job!.id}|${thresholdInput.value}|${minInput.value}|${lastAnalyzedSource === currentSource()}`;
  if (key === renderedPlanKey) return;
  renderedPlanKey = key;
  clearSegmentStop();
  selectedShot = '';
  clipRequest++;
  clipVideo.pause(); clipVideo.removeAttribute('src'); clipVideo.load(); $('clip-player-card').hidden = true;
  plan = calculatePlan();
  shown = Math.max(LIMIT, shown);
  renderStats(); renderTimeline(); renderShots();
  const canUsePlan = lastAnalyzedSource === currentSource() && !picking;
  $('record').toggleAttribute('disabled', plan.shots.length === 0 || !canUsePlan);
  $('export').toggleAttribute('disabled', plan.shots.length === 0 || !canUsePlan);
}

function renderStats(): void {
  const durations = plan.shots.map((shot) => shot.durationSec).sort((a, b) => a - b);
  const median = durations.length ? (durations.length % 2 ? durations[(durations.length - 1) / 2] : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2) : 0;
  setText('shot-count', String(durations.length));
  setText('stat-min', durations.length ? `${durations[0].toFixed(2)}s` : '—');
  setText('stat-median', durations.length ? `${median.toFixed(2)}s` : '—');
  setText('stat-max', durations.length ? `${durations[durations.length - 1].toFixed(2)}s` : '—');
  setText('stat-short', String(durations.filter((value) => value < 1).length));
  setText('list-count', String(durations.length));
  setText('stats-state', durations.length ? '实时预览' : '无片段');
}

function renderTimeline(): void {
  if (!job) return;
  const duration = job.duration;
  const cuts = $('timeline-cuts');
  const blocks = $('timeline-shots');
  cuts.replaceChildren(); blocks.replaceChildren();
  const labels = $('ruler-labels'); labels.replaceChildren();
  for (let i = 0; i <= 4; i++) {
    const label = document.createElement('span');
    label.textContent = fmt(duration * i / 4, false);
    labels.append(label);
  }
  for (const shot of plan.shots) {
    const segment = document.createElement('span');
    segment.className = 'shot-block';
    segment.style.width = `${(shot.durationSec / duration) * 100}%`;
    segment.title = `片段 ${shot.index} · ${fmt(shot.startSec)}—${fmt(shot.endSec)}`;
    blocks.append(segment);
  }
  // Only minimum-duration rejections are useful to show; threshold misses can be numerous.
  for (const cut of plan.rejected.filter((item) => item.reason !== 'threshold')) {
    const marker = document.createElement('i'); marker.className = 'cut-mark filtered';
    marker.style.left = `${Math.min(100, Math.max(0, cut.timeSec / duration * 100))}%`;
    marker.title = `${cut.reason === 'tail' ? '尾段不足最短时长' : '最短时长过滤'} · ${fmt(cut.timeSec)} · ${cut.score.toFixed(1)}`; cuts.append(marker);
  }
  const starts = new Set(plan.shots.slice(1).map(shot => shot.startSec));
  for (const event of job.events) {
    if (!starts.has(event.timeSec)) continue;
    const marker = document.createElement('i'); marker.className = 'cut-mark';
    marker.style.left = `${Math.min(100, Math.max(0, event.timeSec / duration * 100))}%`;
    marker.title = `切点 ${fmt(event.timeSec)} · ${event.score.toFixed(1)}`; cuts.append(marker);
  }
  $('timeline-empty').toggleAttribute('hidden', false);
  $('timeline-empty').textContent = plan.shots.length ? '' : '当前参数下没有片段';
  updateVideoPosition();
}

function renderShots(): void {
  const empty = $('clips-empty');
  empty.hidden = plan.shots.length > 0;
  clipList.replaceChildren();
  const visible = plan.shots.slice(0, shown);
  for (const shot of visible) {
    const row = document.createElement('article');
    row.className = `clip-row${selectedShot === shot.id ? ' selected' : ''}`;
    row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', `片段 ${shot.index}，${fmt(shot.startSec)} 到 ${fmt(shot.endSec)}`);
    const thumb = document.createElement('span'); thumb.className = 'clip-thumb'; thumb.textContent = '◫';
    const info = document.createElement('span'); info.className = 'clip-info';
    const title = document.createElement('span'); title.className = 'clip-title'; title.textContent = `片段 ${String(shot.index).padStart(2, '0')}`;
    const range = document.createElement('span'); range.className = 'clip-range'; range.textContent = `${fmt(shot.startSec)} — ${fmt(shot.endSec)}`;
    info.append(title, range);
    const dur = document.createElement('span'); dur.className = 'clip-duration'; dur.textContent = `${shot.durationSec.toFixed(2)}s`;
    const actions = document.createElement('span'); actions.className = 'clip-actions';
    const play = document.createElement('button'); play.className = 'clip-action'; play.type = 'button'; play.title = '播放真实切分片段'; play.setAttribute('aria-label', `播放片段 ${shot.index}`); play.textContent = '▶';
    const save = document.createElement('button'); save.className = 'clip-action'; save.type = 'button'; save.title = '生成并保存片段'; save.setAttribute('aria-label', `保存片段 ${shot.index}`); save.textContent = '↓';
    play.addEventListener('click', (event) => { event.stopPropagation(); void createClip(shot, false); });
    save.addEventListener('click', (event) => { event.stopPropagation(); void createClip(shot, true); });
    actions.append(play, save); row.append(thumb, info, dur, actions);
    const choose = () => selectShot(shot);
    row.addEventListener('click', choose);
    row.addEventListener('keydown', (event) => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); choose(); } });
    clipList.append(row);
  }
  const more = $('load-more') as HTMLButtonElement;
  more.hidden = shown >= plan.shots.length;
  more.textContent = `显示更多片段（${plan.shots.length - shown}）`;
}

function updateVideoPosition(): void {
  const duration = job?.duration || sourceVideo.duration || 0;
  const current = sourceVideo.currentTime || 0;
  const percent = duration ? Math.min(100, current / duration * 100) : 0;
  $('timeline-cursor').setAttribute('style', `left:${percent}%`);
  $('scrub-fill').setAttribute('style', `width:${percent}%`);
  $('scrub-marker').setAttribute('style', `left:${percent}%`);
  setText('video-time', fmt(current));
  const scrub = $('scrub-track'); scrub.setAttribute('aria-valuemax', String(duration)); scrub.setAttribute('aria-valuenow', String(current));
}

function selectShot(shot: Shot): void {
  clipRequest++;
  clipVideo.pause(); clipVideo.removeAttribute('src'); clipVideo.load(); $('clip-player-card').hidden = true;
  selectedShot = shot.id;
  renderShots();
  sourceVideo.pause();
  sourceVideo.currentTime = shot.startSec;
  if (segmentStopListener) sourceVideo.removeEventListener('timeupdate', segmentStopListener);
  segmentStopListener = () => {
    if (sourceVideo.currentTime >= shot.endSec) sourceVideo.pause();
  };
  sourceVideo.addEventListener('timeupdate', segmentStopListener);
}

function clearSegmentStop(): void {
  if (segmentStopListener) sourceVideo.removeEventListener('timeupdate', segmentStopListener);
  segmentStopListener = null;
}

async function createClip(shot: Shot, download: boolean): Promise<void> {
  if (!job) return;
  selectShot(shot);
  const request = ++clipRequest;
  const buttons = [...clipList.querySelectorAll<HTMLButtonElement>('.clip-action')];
  buttons.forEach((button) => { button.disabled = true; });
  const title = $('clip-title'); title.textContent = `正在生成片段 ${shot.index}…`;
  const card = $('clip-player-card'); card.hidden = false;
  const link = $('clip-download') as HTMLAnchorElement; link.hidden = true;
  try {
    const result = await api<{ url: string; name: string }>('/api/jobs/' + encodeURIComponent(job.id) + `/clip?start=${encodeURIComponent(shot.startSec)}&end=${encodeURIComponent(shot.endSec)}`);
    if (request !== clipRequest) return;
    clipVideo.pause(); clipVideo.src = result.url; clipVideo.load();
    title.textContent = `片段 ${String(shot.index).padStart(2, '0')} · ${fmt(shot.startSec)}—${fmt(shot.endSec)}`;
    link.href = result.url; link.download = result.name; link.hidden = false;
    if (download) link.click();
    else {
      clipVideo.play().catch((error: unknown) => {
        if (request === clipRequest) title.textContent = `片段已生成，但无法播放：${message(error)}`;
      });
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      card.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
  } catch (error) {
    if (request === clipRequest) title.textContent = `生成失败：${message(error)}`;
  } finally {
    if (request === clipRequest) clipList.querySelectorAll<HTMLButtonElement>('.clip-action').forEach((button) => { button.disabled = false; });
  }
}

function renderJob(next: Job | null, nextBusy: boolean): void {
  job = next; busy = nextBusy;
  pickButton.disabled = busy || picking;
  const phaseText: Record<string, string> = { scanning: '正在扫描', previewing: '正在准备预览', ready: '扫描完成', failed: '扫描失败', cancelled: '已取消' };
  setText('job-status', job ? phaseText[job.phase] : '等待视频');
  const isScanning = Boolean(job && (job.phase === 'scanning' || job.phase === 'previewing'));
  const progress = $('scan-progress'); progress.hidden = !isScanning;
  if (job && isScanning) {
    setText('progress-label', job.phase === 'previewing' ? '准备播放预览' : '正在分析画面');
    setText('progress-value', `${Math.round(job.progress)}%`);
    $('progress-bar').setAttribute('style', `width:${Math.max(0, Math.min(100, job.progress))}%`);
    analyzeButton.textContent = '取消扫描'; analyzeButton.disabled = false;
  } else {
    const sameReadySource = Boolean(ready() && currentSource() && currentSource() === lastAnalyzedSource);
    analyzeButton.textContent = sameReadySource ? '扫描完成' : '扫描视频';
    const canCancel = Boolean(job && (job.phase === 'scanning' || job.phase === 'previewing'));
    analyzeButton.disabled = picking || !currentSource() || (busy && !canCancel) || sameReadySource;
  }
  const analyzeError = $('source-error');
  if (job?.phase === 'failed' || job?.phase === 'cancelled') {
    analyzeError.hidden = false;
    analyzeError.textContent = job.error || (job.phase === 'cancelled' ? '扫描已取消，可以重新开始。' : '扫描失败，请检查视频路径后重试。');
  }
  if (job) {
    setText('video-name', job.name || '未命名视频');
    setText('video-duration', fmt(job.duration, false));
    if (job.previewReady) {
      const expected = `/media/${encodeURIComponent(job.id)}/source`;
      if (sourceVideo.getAttribute('src') !== expected) { sourceVideo.src = expected; sourceVideo.hidden = false; $('video-stage').querySelector('.empty-video')?.setAttribute('hidden', ''); }
    }
  }
  const hasPreview = Boolean(job?.previewReady && sourceVideo.hasAttribute('src'));
  ($('play-toggle') as HTMLButtonElement).disabled = !hasPreview;
  const actionable = !picking && ready() && Boolean(job?.id) && lastAnalyzedSource === currentSource();
  ($('record') as HTMLButtonElement).disabled = !actionable || plan.shots.length === 0;
  ($('export') as HTMLButtonElement).disabled = !actionable || plan.shots.length === 0;
  if (!ready()) {
    setText('stats-state', job?.phase === 'failed' ? '扫描失败' : '待分析');
    setText('shot-count', '—'); setText('stat-min', '—'); setText('stat-median', '—'); setText('stat-max', '—'); setText('stat-short', '—');
  }
  if (ready()) renderParams();
}

async function pollState(): Promise<void> {
  if (polling || Date.now() - lastPollMs < 730) return;
  polling = true; lastPollMs = Date.now();
  try {
    const state = await api<State>('/api/state');
    const previousId = job?.id;
    if (state.job?.id !== previousId && state.job) {
      plan = { shots: [], rejected: [] }; selectedShot = ''; shown = LIMIT; renderedPlanKey = '';
      clearSegmentStop();
      lastAnalyzedSource = currentSource();
      if (sourceVideo.getAttribute('src') !== `/media/${encodeURIComponent(state.job.id)}/source`) {
        sourceVideo.pause(); sourceVideo.removeAttribute('src'); sourceVideo.hidden = true;
        $('video-stage').querySelector('.empty-video')?.removeAttribute('hidden');
      }
      clipRequest++; clipVideo.pause(); clipVideo.removeAttribute('src'); clipVideo.load(); $('clip-player-card').hidden = true;
    }
    renderJob(state.job, state.busy);
  } catch (error) {
    setText('job-status', '连接失败');
    $('source-error').hidden = false; $('source-error').textContent = `无法读取本机服务状态：${message(error)}`;
  } finally { polling = false; }
}

function pickSource(): void {
  if (busy || picking) return;
  fileInput.value = '';
  fileInput.click();
}

async function receiveFile(): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file) return;
  picking = true; pickButton.disabled = true; analyzeButton.disabled = true;
  ($('record') as HTMLButtonElement).disabled = true; ($('export') as HTMLButtonElement).disabled = true;
  setText('pick-label', '正在读取视频…'); $('source-error').hidden = true;
  try {
    const result = await api<{ source: string }>('/api/upload?name=' + encodeURIComponent(file.name), {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    });
    selectedSource = result.source;
    selectedFileKey = `${file.name}|${file.size}|${file.lastModified}`;
    selectedFile.textContent = file.name; selectedFile.title = file.name;
  } catch (error) { $('source-error').hidden = false; $('source-error').textContent = `无法选择视频：${message(error)}`; }
  finally {
    picking = false; pickButton.disabled = busy; setText('pick-label', selectedSource ? '更换视频' : '选择视频');
    sourceChanged(false);
  }
}

async function analyze(): Promise<void> {
  $('source-error').hidden = true;
  if (job && (job.phase === 'scanning' || job.phase === 'previewing')) {
    analyzeButton.disabled = true;
    try { await api('/api/cancel', { method: 'POST' }); }
    catch (error) { $('source-error').hidden = false; $('source-error').textContent = `取消失败：${message(error)}`; }
    return;
  }
  const source = currentSource();
  if (!source) { $('source-error').hidden = false; $('source-error').textContent = '请先选择一个视频。'; return; }
  analyzeButton.disabled = true; analyzeButton.textContent = '开始扫描…';
  try {
    const result = await api<{ job: Job }>('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }) });
    lastAnalyzedSource = source; plan = { shots: [], rejected: [] }; shown = LIMIT; selectedShot = '';
    renderJob(result.job, true);
    await pollState();
  } catch (error) {
    $('source-error').hidden = false; $('source-error').textContent = `无法开始扫描：${message(error)}`;
    analyzeButton.disabled = false; analyzeButton.textContent = '扫描视频';
  }
}

function renderSavedGroups(): void {
  const groups = readGroups(); const container = $('saved-groups'); container.replaceChildren();
  const currentGroups = groups.filter((group) => group.source === selectedFileKey);
  setText('saved-count', `${currentGroups.length} / 6`);
  currentGroups.forEach((group) => {
    const button = document.createElement('button'); button.className = 'saved-group'; button.type = 'button';
    const params = document.createElement('span'); params.textContent = `${group.threshold.toFixed(1)} / ${group.minDurationSec.toFixed(1)}s`;
    const summary = document.createElement('small'); summary.textContent = `${group.shots} 段 · ${group.median.toFixed(2)}s`; button.append(params, summary);
    button.title = `恢复记录于 ${group.savedAt}`;
    button.addEventListener('click', () => {
      thresholdInput.value = String(group.threshold); minInput.value = String(group.minDurationSec); renderParams();
    });
    container.append(button);
  });
}

function recordGroup(): void {
  if (!ready() || !plan.shots.length || !job) return;
  const durations = plan.shots.map((shot) => shot.durationSec).sort((a, b) => a - b);
  const median = durations.length % 2 ? durations[(durations.length - 1) / 2] : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2;
  const groups = readGroups().filter((group) => group.source !== selectedFileKey || group.threshold !== Number(thresholdInput.value) || group.minDurationSec !== Number(minInput.value));
  groups.unshift({ id: crypto.randomUUID(), name: job.name, source: selectedFileKey, threshold: Number(thresholdInput.value), minDurationSec: Number(minInput.value), shots: plan.shots.length, median, savedAt: new Date().toISOString() });
  localStorage.setItem(SAVED_KEY, JSON.stringify(groups.slice(0, 6))); renderSavedGroups();
}

function exportPlan(): void {
  if (!ready() || !job) return;
  const data = { sourceName: job.name, threshold: Number(thresholdInput.value), minDurationSec: Number(minInput.value), shots: plan.shots };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `${job.name.replace(/\.[^.]+$/, '') || 'video'}-split-list.json`; link.click(); URL.revokeObjectURL(url);
}

function seekFromPointer(event: PointerEvent): void {
  if (!job?.duration) return;
  const rect = $('scrub-track').getBoundingClientRect();
  sourceVideo.currentTime = Math.max(0, Math.min(job.duration, (event.clientX - rect.left) / rect.width * job.duration));
}

function sourceChanged(clearError = true): void {
  if (clearError) $('source-error').hidden = true;
  clearSegmentStop(); selectedShot = ''; clipRequest++;
  clipVideo.pause(); clipVideo.removeAttribute('src'); clipVideo.load(); $('clip-player-card').hidden = true;
  renderSavedGroups();
  if (ready()) renderParams();
  const sameReadySource = Boolean(ready() && currentSource() === lastAnalyzedSource);
  const canCancel = Boolean(job && (job.phase === 'scanning' || job.phase === 'previewing'));
  analyzeButton.disabled = !currentSource() || (busy && !canCancel) || sameReadySource;
  analyzeButton.textContent = sameReadySource ? '扫描完成' : '扫描视频';
}

function syncNumericInput(input: HTMLInputElement, slider: HTMLInputElement): void {
  const value = Number(input.value);
  if (input.value === '' || !Number.isFinite(value)) return;
  const bounded = Math.max(Number(slider.min), Math.min(Number(slider.max), value));
  slider.value = String(bounded);
  renderParams();
}

function commitNumericInput(input: HTMLInputElement, slider: HTMLInputElement): void {
  const parsed = input.value === '' ? Number(slider.value) : Number(input.value);
  const value = Number.isFinite(parsed) ? parsed : Number(slider.value);
  const bounded = Math.max(Number(slider.min), Math.min(Number(slider.max), value));
  input.value = bounded.toFixed(1); slider.value = String(bounded); renderParams();
}

thresholdInput.addEventListener('input', renderParams);
minInput.addEventListener('input', renderParams);
thresholdNumber.addEventListener('input', () => syncNumericInput(thresholdNumber, thresholdInput));
minNumber.addEventListener('input', () => syncNumericInput(minNumber, minInput));
thresholdNumber.addEventListener('change', () => commitNumericInput(thresholdNumber, thresholdInput));
minNumber.addEventListener('change', () => commitNumericInput(minNumber, minInput));
pickButton.addEventListener('click', pickSource);
fileInput.addEventListener('change', () => void receiveFile());
analyzeButton.addEventListener('click', () => void analyze());
$('preset-original').addEventListener('click', () => { thresholdInput.value = '12'; minInput.value = '0.2'; renderParams(); });
$('preset-current').addEventListener('click', () => { thresholdInput.value = '15.2'; minInput.value = '1.9'; renderParams(); });
$('record').addEventListener('click', recordGroup);
$('export').addEventListener('click', exportPlan);
$('load-more').addEventListener('click', () => { shown += LIMIT; renderShots(); });
$('play-toggle').addEventListener('click', () => {
  if (sourceVideo.paused) { clipVideo.pause(); sourceVideo.play().then(() => { $('source-error').hidden = true; }).catch((error: unknown) => {
    $('source-error').hidden = false; $('source-error').textContent = `原视频无法播放：${message(error)}`;
  }); } else sourceVideo.pause();
});
sourceVideo.addEventListener('timeupdate', updateVideoPosition);
sourceVideo.addEventListener('loadedmetadata', () => { setText('video-duration', fmt(sourceVideo.duration, false)); updateVideoPosition(); });
sourceVideo.addEventListener('play', () => { $('play-toggle').innerHTML = '<span class="play-icon">Ⅱ</span>'; $('play-toggle').setAttribute('aria-label', '暂停'); });
sourceVideo.addEventListener('pause', () => { $('play-toggle').innerHTML = '<span class="play-icon">▶</span>'; $('play-toggle').setAttribute('aria-label', '播放'); });
$('scrub-track').addEventListener('pointerdown', (event) => seekFromPointer(event as PointerEvent));
$('scrub-track').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); sourceVideo.currentTime = Math.max(0, sourceVideo.currentTime + (event.key === 'ArrowRight' ? 1 : -1)); }
});
renderSavedGroups();
void pollState();
window.setInterval(() => void pollState(), 800);
