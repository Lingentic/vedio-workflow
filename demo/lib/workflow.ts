import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Store } from './store.ts';
import { AppError } from './types.ts';
import type { Asset, Execution, Task, Interval, PreviewInputs } from './types.ts';
import type { Library } from './library.ts';
import type { Media } from './media.ts';
import type { Models } from './models.ts';
import { assembledNodes, intervalsFromNodes, signature, templateById, voiceConfig, voiceSignature } from './templates.ts';
import { alignAudio } from './alignment.ts';
import { buildPlan, fullCues } from './plan.ts';
import { renderTask } from './renderer.ts';
import { inside } from './paths.ts';
import { prepareShotSelection, validateShotSelection } from './shot-selection.ts';
import { fixedNarrationVisuals } from './fixed-narration-visuals.ts';
import { compileSelectionPlan } from './render-plan.ts';

interface ActiveJob { task: Task; kind: Execution['kind']; controller: AbortController; inputIds: Set<string>; promise?: Promise<void>; }
export class Workflow {
  store: Store; library: Library; media: Media; models: Models;
  active: ActiveJob | null = null;
  completing = false;
  cleanupJobs = new Set<Promise<void>>();
  hostImageJob: Promise<Task> | null = null;
  constructor(store: Store, library: Library, media: Media, models: Models) {
    this.store = store; this.library = library; this.media = media; this.models = models;
    for (const task of store.tasks()) if (task.execution?.status === 'running') {
      task.execution.status = 'interrupted'; task.execution.message = '上次执行已中断，请检查已保存结果后继续'; task.error = '客户端上次执行未正常结束，没有自动重新提交付费请求';
      store.putTask(task);
    }
    for (const task of store.tasks()) if (task.completed && task.cleanup?.status !== 'done') this.startCleanup(task);
  }
  idle() { if (this.active || this.completing || this.hostImageJob) throw new AppError('当前任务正在执行，请等待结束后再操作', 409); }
  async waitForCleanup() { await Promise.all([...this.cleanupJobs]); }
  private startCleanup(task: Task) {
    const job = this.cleanup(task).catch(error => { console.error('后台清理状态保存失败：', (error as Error).message); }).finally(() => { this.cleanupJobs.delete(job); });
    this.cleanupJobs.add(job);
  }
  get(id: string) {
    const task = this.store.task(id); if (!task) throw new AppError('制作任务不存在', 404);
    if (task.videoSubmittedAt === undefined) task.videoSubmittedAt = this.inferVideoSubmittedAt(task);
    return task;
  }
  private inferVideoSubmittedAt(task: Task): string | null {
    if (!task.preview && !task.completed && task.execution?.kind !== 'render') return null;
    return task.preview?.createdAt || (task.execution?.kind === 'render' ? task.execution.startedAt : undefined) || task.updatedAt || task.createdAt;
  }
  writable(id: string) {
    this.idle(); const task = this.get(id);
    if (task.completed) throw new AppError('该任务已确认完成，参数只读；请新建任务制作另一版', 409);
    if (task.preview && !task.previewStale && !task.preview.inputs) task.preview.inputs = this.previewInputs(task);
    return task;
  }
  private previewInputs(task: Task): PreviewInputs {
    return {
      settings: structuredClone(task.settings), planSignature: task.plan?.signature || '',
      scriptSignature: signature(task.nodes),
      audioSignature: signature(task.intervals.map(interval => ({ id: interval.id, signature: interval.signature, configuration: interval.configuration, duration: interval.duration, file: interval.relativePath }))),
      hostImageSignature: task.hostImage ? signature(task.hostImage) : undefined,
      shotSelectionSignature: task.shotSelection ? signature({slots:task.shotSelection.slots,fixed:task.shotSelection.fixedVisuals,choices:task.shotSelection.choices}) : undefined,
    };
  }
  publicTask(task: Task): Task {
    const result = structuredClone(task);
    if(result.shotSelection) result.shotSelection.stale = !result.completed && (!result.copyConfirmed || !result.audioConfirmed || result.shotSelection.contextSignature !== this.shotContext(result));
    if (result.videoSubmittedAt === undefined) result.videoSubmittedAt = this.inferVideoSubmittedAt(result);
    result.previewChanges = [];
    if (result.previewStale && result.preview) {
      const before = result.preview.inputs;
      if (!before) result.previewChanges = ['预览配置已变化'];
      else {
        const now = this.previewInputs(result);
        if (before.settings.subtitles !== now.settings.subtitles) result.previewChanges.push('字幕设置已变化');
        if (before.settings.bgmId !== now.settings.bgmId) result.previewChanges.push('BGM已变化');
        if (before.settings.bgmVolume !== now.settings.bgmVolume) result.previewChanges.push('BGM音量已变化');
        if (before.planSignature !== now.planSignature) result.previewChanges.push('商品画面已变化');
        if (before.scriptSignature !== now.scriptSignature) result.previewChanges.push('文案已变化');
        if (before.audioSignature !== now.audioSignature) result.previewChanges.push('配音已变化');
        if (before.hostImageSignature !== now.hostImageSignature) result.previewChanges.push('主播下半屏图片已变化');
        if (before.shotSelectionSignature !== now.shotSelectionSignature) result.previewChanges.push('选片方案已变化');
        if (!result.previewChanges.length) result.previewChanges = ['预览配置已变化'];
      }
    }
    result.nodes = assembledNodes(task);
    if (result.hostImage) result.hostImage.url = `/media/task/${result.id}/host-image?v=${encodeURIComponent(result.hostImage.relativePath)}`;
    for (const interval of result.intervals) if (!result.completed && interval.relativePath && fs.existsSync(this.store.path(interval.relativePath))) interval.audioUrl = `/media/task/${result.id}/audio-${interval.id}`;
    if (result.preview) result.preview.url = `/media/task/${result.id}/preview?v=${encodeURIComponent(result.preview.createdAt)}`;
    if (result.plan) for (const entry of result.plan.entries) {
      const asset = this.store.asset(entry.assetId); entry.available = !!asset && this.library.available(asset);
      if (asset && entry.available) { entry.url = `/media/asset/${asset.id}`; if (asset.posterPath) entry.posterUrl = `/poster/${asset.id}`; }
    }
    if (result.plan && result.plan.entries.some(entry => !entry.available)) {
      result.plan.valid = false;
      result.plan.warnings = [...new Set([...result.plan.warnings, '选中的素材已删除或暂不可用，请检查画面方案'])];
    }
    return result;
  }
  create(productId: string, templateId: string) {
    this.idle();
    const product = this.store.product(productId); if (!product) throw new AppError('请先选择素材库中的商品');
    const template = templateById(templateId), now = new Date().toISOString();
    const task: Task = {
      id: Store.id(), name: `${product.name} · ${template.title}`, productId, templateId, productSnapshot: structuredClone(product), templateSnapshot: template,
      variable: template.variableNodeId ? `${product.price}${product.price ? '元' : ''}${product.specification}` : '', example: '', black: {}, nodes: [],
      stage: 'copy', copyConfirmed: false, audioConfirmed: false, intervals: [], plan: null,
      settings: { subtitles: true, bgmId: null, bgmVolume: .12 }, preview: null, previewStale: false,
      completed: false, execution: null, error: '', createdAt: now, updatedAt: now,
      videoSubmittedAt: null,
    };
    task.nodes = assembledNodes(task); return this.store.putTask(task);
  }
  private shotContext(task: Task): string {
    const ids=[...new Set(task.shotSelection?.choices.flatMap(choice=>choice.assetIds) || [])];
    return signature({nodes:assembledNodes(task),intervals:task.intervals.map(i=>({id:i.id,signature:i.signature,status:i.status,confirmed:i.confirmed,duration:i.duration,times:i.nodeTimes,file:i.relativePath,exists:!!i.relativePath&&fs.existsSync(this.store.path(i.relativePath))})),fixed:fixedNarrationVisuals(this.library),assets:ids.map(id=>{const a=this.store.asset(id);return a?{id:a.id,productId:a.productId,available:this.library.available(a),duration:a.videoDuration??a.duration,description:a.description,title:a.title}:null;})});
  }
  selectShots(id:string) {
    const task=this.writable(id),input=prepareShotSelection(task,this.library);
    if(!this.models.ready())throw new AppError('选片模型服务尚未配置');
    return this.start(task,'selection',async job=>{
      input.candidates.forEach(a=>job.inputIds.add(a.id));input.fixedVisuals.forEach(a=>job.inputIds.add(a.assetId));
      task.execution!.progress=15;task.execution!.message='正在选择商品视频，固定画面保持锁定';this.store.putTask(task);
      const result=input.slots.length?await this.models.selectShots(input):{response:{choices:[]},requestId:'',usage:undefined};
      const selection=validateShotSelection(input,result.response);
      // Model responses are data: check media again before committing a paid result.
      for(const assetId of selection.choices.flatMap(choice=>choice.assetIds)){const asset=this.store.asset(assetId);if(!asset || asset.productId!==task.productId || !this.library.available(asset))throw new AppError('选片期间素材已不可用，旧方案已保留');}
      const previous=task.shotSelection;
      task.shotSelection={...selection,model:this.models.selectionModel,requestId:result.requestId,usage:result.usage};
      task.shotSelection.contextSignature=this.shotContext(task);
      if(previous && JSON.stringify(previous.choices)===JSON.stringify(selection.choices))task.shotSelection.warnings.push('此次选片与上一方案相同');
      task.previewStale=!!task.preview;task.stage='visual';
    });
  }
  saveShotSelection(id:string,data:Record<string,unknown>) {
    const task=this.writable(id),input=prepareShotSelection(task,this.library);
    if(!task.shotSelection || task.shotSelection.contextSignature!==this.shotContext(task))throw new AppError('选片方案已失效，请先重新匹配');
    input.candidates=this.library.ready(task.productId).map(asset=>({id:asset.id,description:(asset.description||asset.title).slice(0,1200),duration:asset.videoDuration??asset.duration}));
    const selection=validateShotSelection(input,data);
    task.shotSelection={...selection,mode:'manual',model:task.shotSelection.model};task.shotSelection.contextSignature=this.shotContext(task);
    task.previewStale=!!task.preview;return this.store.putTask(task);
  }
  setHostImage(id: string, data: Record<string, unknown>, useDefault = false): Promise<Task> {
    const task = this.writable(id);
    if (useDefault && task.hostImage && fs.existsSync(this.store.path(task.hostImage.relativePath))) return Promise.resolve(task);
    const coordinates = { x: .5, y: .5, scale: 1 };
    for (const key of ['x','y','scale'] as const) {
      const value = key in data ? data[key] : coordinates[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < (key === 'scale' ? 1 : 0) || value > (key === 'scale' ? 4 : 1)) throw new AppError('图片位置或缩放参数无效');
      coordinates[key] = value;
    }
    let asset: Asset | undefined;
    if (useDefault) {
      asset = this.store.assets(task.productId).find(item => item.kind === 'product' && item.hasVideo === false && this.library.available(item)) || this.library.ready(task.productId)[0];
      if (!asset) throw new AppError('当前商品没有可用图片或视频，请先添加素材');
    } else if (data.assetId !== undefined) {
      if (typeof data.assetId !== 'string') throw new AppError('图片素材 ID 无效');
      asset = this.store.asset(data.assetId) || undefined;
      if (!asset || asset.productId !== task.productId || asset.kind !== 'product' || asset.hasVideo !== false || !this.library.available(asset)) throw new AppError('请选择当前商品的可用图片');
    }
    if (!asset) {
      if (!task.hostImage || !fs.existsSync(this.store.path(task.hostImage.relativePath))) throw new AppError('请先选择商品图片');
      task.hostImage = { ...task.hostImage, ...coordinates };
      task.previewStale = !!task.preview;
      return Promise.resolve(this.store.putTask(task));
    }
    const previousImage = task.hostImage?.relativePath;
    const source = asset, relative = path.join('制作任务', task.id, 'host-image', `${Store.id()}.jpg`), target = this.store.path(relative);
    const operation = (async () => {
      try {
        await fsp.mkdir(path.dirname(target), {recursive:true});
        const seek = source.hasVideo === false ? [] : ['-ss', String(Math.min(.5, source.duration / 2))];
        await this.media.ff(['-y', ...seek, '-i', this.store.path(source.relativePath!), '-frames:v', '1', '-vf', "scale=w='min(2160,iw)':h='min(2160,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-q:v', '2', '-threads', '1', target]);
        const info = await this.media.probe(target);
        if (!info.width || !info.height) throw new AppError('无法读取图片尺寸');
        task.hostImage = { relativePath:relative, title:source.hasVideo === false ? source.title : '商品视频截图', width:info.width, height:info.height, ...coordinates };
        task.previewStale = !!task.preview;
        this.store.putTask(task);
        if (previousImage) {
          const previous = this.store.path(previousImage);
          if (path.dirname(previous) === path.dirname(target) && previous !== target) {
            try { await fsp.rm(previous, {force:true}); }
            catch (error) { console.error('旧任务图片清理失败，当前图片已保存：', (error as Error).message); }
          }
        }
        return task;
      } catch (error) {
        await fsp.rm(target, {force:true});
        throw error;
      }
    })();
    this.hostImageJob = operation;
    return operation.finally(() => { this.hostImageJob = null; });
  }
  patch(id: string, body: Record<string, unknown>) {
    const task = this.writable(id), oldText = JSON.stringify(assembledNodes(task));
    if ('variable' in body) { if (typeof body.variable !== 'string' || body.variable.length > 300 || !task.templateSnapshot.variableNodeId) throw new AppError('蓝色变量格式错误'); task.variable = body.variable; }
    if ('example' in body) { if (typeof body.example !== 'string' || body.example.length > 20000) throw new AppError('范例内容过长或格式错误'); task.example = body.example; }
    if ('black' in body) {
      if (!body.black || typeof body.black !== 'object' || Array.isArray(body.black)) throw new AppError('黑色文案格式错误');
      const allowed = new Set(task.templateSnapshot.nodes.filter(node => node.type === 'generated_narration').map(node => node.id));
      for (const [key, value] of Object.entries(body.black)) { if (!allowed.has(key) || typeof value !== 'string' || value.length > 8000) throw new AppError('只能修改待填写的黑色节点'); task.black[key] = value; }
    }
    task.nodes = assembledNodes(task);
    if (JSON.stringify(task.nodes) !== oldText) { task.copyConfirmed = false; task.audioConfirmed = false; task.previewStale = !!task.preview; task.notice = '文案已修改，请确认文案后重做受影响的配音'; }
    if ('settings' in body) {
      if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) throw new AppError('输出设置格式错误');
      const settings = body.settings as Record<string, unknown>;
      if ('subtitles' in settings) { if (typeof settings.subtitles !== 'boolean') throw new AppError('字幕开关格式错误'); task.settings.subtitles = settings.subtitles; }
      if ('bgmId' in settings) { if (settings.bgmId !== null && (typeof settings.bgmId !== 'string' || this.store.asset(settings.bgmId)?.kind !== 'bgm' || !this.library.available(this.store.asset(settings.bgmId)!))) throw new AppError('所选配乐不可用'); task.settings.bgmId = settings.bgmId as string | null; }
      if ('bgmVolume' in settings) { if (typeof settings.bgmVolume !== 'number' || !Number.isFinite(settings.bgmVolume) || settings.bgmVolume < 0 || settings.bgmVolume > .5) throw new AppError('配乐音量需在0到0.5之间'); task.settings.bgmVolume = settings.bgmVolume; }
      if (task.preview) task.previewStale = !task.copyConfirmed || !task.audioConfirmed || task.preview.signature !== signature({ plan: task.plan?.signature, settings: task.settings }) || task.preview.inputs?.hostImageSignature !== (task.hostImage ? signature(task.hostImage) : undefined) || task.preview.inputs?.shotSelectionSignature !== this.previewInputs(task).shotSelectionSignature;
    }
    if ('stage' in body) {
      if (!['copy','voice','visual','preview'].includes(String(body.stage))) throw new AppError('制作阶段不存在');
      if (body.stage === 'voice' && !task.copyConfirmed) throw new AppError('请先确认当前文案');
      if (body.stage === 'visual' && (!task.copyConfirmed || !task.audioConfirmed)) throw new AppError('请先确认文案和配音');
      if (body.stage === 'preview' && (!task.copyConfirmed || !task.audioConfirmed || !task.plan?.valid)) throw new AppError('请先确认文案、配音并补齐画面方案');
      task.stage = body.stage as Task['stage'];
    }
    return this.store.putTask(task);
  }
  switch(id: string, productId: string, templateId: string, mode: string) {
    const task = this.writable(id);
    if (mode === 'new') {
      if (!task.videoSubmittedAt) throw new AppError('当前任务尚未提交生成视频，只能覆盖当前草稿', 409);
      return this.create(productId, templateId);
    }
    if (mode !== 'overwrite') throw new AppError('请选择有效的任务切换方式');
    const replacement = this.create(productId, templateId), temporaryId = replacement.id;
    replacement.id = task.id; replacement.createdAt = task.createdAt; replacement.videoSubmittedAt = task.videoSubmittedAt ?? null;
    this.store.db.prepare('DELETE FROM tasks WHERE id=?').run(temporaryId);
    return this.store.putTask(replacement);
  }
  confirmCopy(id: string) {
    const task = this.writable(id); task.nodes = assembledNodes(task);
    if (task.templateSnapshot.variableNodeId && !task.variable.trim()) throw new AppError('请填写蓝色变量');
    if (task.nodes.some(node => node.type === 'generated_narration' && !node.text.trim())) throw new AppError('请补齐全部黑色文案');
    const previous = task.intervals;
    task.intervals = intervalsFromNodes(task.nodes).map(interval => {
      const old = previous.find(item => item.id === interval.id && item.signature === interval.signature && item.status === 'ready' && item.relativePath && fs.existsSync(this.store.path(item.relativePath)));
      return old || interval;
    });
    task.copyConfirmed = true; task.confirmedNodes = structuredClone(task.nodes);
    task.audioConfirmed = task.intervals.length > 0 && task.intervals.every(interval => interval.status === 'ready' && interval.confirmed);
    task.stage = 'voice'; task.error = ''; task.notice = '';
    if (!task.audioConfirmed && task.plan) { task.plan.valid = false; task.plan.warnings = ['配音更新后将重新校验画面时长']; }
    return this.store.putTask(task);
  }
  private start(task: Task, kind: Execution['kind'], run: (job: ActiveJob) => Promise<void>) {
    this.idle();
    const executionId = Store.id();
    const startedAt = new Date().toISOString();
    if (kind === 'render' && !task.videoSubmittedAt) task.videoSubmittedAt = startedAt;
    task.execution = { id: executionId, kind, status: 'running', progress: 0, message: kind === 'copy' ? '正在生成全部黑色文案' : kind === 'voice' ? '正在生成配音' : kind === 'selection' ? '正在匹配商品视频' : '准备合成视频', startedAt };
    task.error = ''; this.store.putTask(task);
    const job: ActiveJob = { task, kind, controller: new AbortController(), inputIds: new Set() }; this.active = job;
    job.promise = (async () => {
      try {
        await run(job);
        task.execution!.status = 'done'; task.execution!.progress = 100; task.execution!.message = '已完成';
      } catch (error) {
        const stopped = error instanceof Error && error.name === 'AbortError';
        task.execution!.status = stopped ? 'stopped' : 'failed'; task.execution!.message = stopped ? '合成已停止，可以继续制作' : this.models.safe((error as Error).message);
        task.error = stopped ? '' : task.execution!.message;
      } finally {
        task.execution!.finishedAt = new Date().toISOString();
        const saved = this.store.task(task.id);
        if (saved?.execution?.id === executionId) this.store.putTask(task);
        if (this.active === job) this.active = null;
      }
    })();
    return task;
  }
  generateCopy(id: string) {
    const task = this.writable(id);
    if (!this.models.ready()) throw new AppError('未找到文案和配音接口配置，请检查本机服务配置');
    return this.start(task, 'copy', async () => {
      const before = JSON.stringify(assembledNodes(task));
      const result = await this.models.copy(assembledNodes(task), task.productSnapshot.sellingPoints, task.example);
      task.black = result.black; task.nodes = assembledNodes(task);
      if (JSON.stringify(task.nodes) !== before) { task.copyConfirmed = false; task.audioConfirmed = false; task.previewStale = !!task.preview; }
      task.stage = 'copy';
    });
  }
  confirmCopyAndVoice(id: string) {
    this.confirmCopy(id);
    return this.generateVoice(id, undefined, true);
  }
  generateVoice(id: string, intervalId?: string, autoConfirm = false) {
    const task = this.writable(id);
    if (!task.copyConfirmed) throw new AppError('请先确认文案');
    const selected = intervalId ? task.intervals.filter(interval => interval.id === intervalId) : task.intervals.filter(interval => interval.status !== 'ready');
    if (!selected.length && autoConfirm && !intervalId) return this.confirmVoice(id, false);
    if (!this.models.ready()) throw new AppError('未找到配音服务配置');
    if (!selected.length) throw new AppError(intervalId ? '指定口播区间不存在' : '所有配音已就绪，请试听并确认，或指定一段重新配音');
    return this.start(task, 'voice', async () => {
      for (let index = 0; index < selected.length; index++) {
        const interval = selected[index], old = structuredClone(interval);
        task.execution!.progress = index / selected.length * 100; task.execution!.message = `正在配音 ${index + 1}/${selected.length}，请稍候`; this.store.putTask(task);
        const folder = path.join(this.store.taskDir(task.id), 'audio', Store.id()); await fsp.mkdir(folder, { recursive: true });
        try {
          const result = await this.models.voice(interval.text);
          const audio = path.join(folder, 'voice.wav'); await fsp.writeFile(audio + '.part', result.audio); await fsp.rename(audio + '.part', audio);
          const info = await this.media.probe(audio);
          await this.media.ff(['-xerror', '-i', audio, '-f', 'null', '-']);
          interval.relativePath = path.relative(this.store.root, audio); interval.duration = info.duration; interval.words = result.words; interval.requestId = result.requestId; interval.billedCharacters = result.billedCharacters;
          const nodes = task.nodes.filter(node => interval.nodeIds.includes(node.id));
          Object.assign(interval, alignAudio(interval.text, nodes, result.words, info.duration), { status: 'ready', confirmed: false, configuration: voiceSignature, error: '' });
          await fsp.writeFile(path.join(folder, 'times.json'), JSON.stringify({ words: result.words, cues: interval.cues, sentences: interval.sentences, nodes: interval.nodeTimes }, null, 2));
          task.audioConfirmed = false; task.previewStale = !!task.preview; this.store.putTask(task);
        } catch (error) {
          if (old.status === 'ready') Object.assign(interval, old, { error: this.models.safe((error as Error).message) });
          else { interval.status = 'failed'; interval.error = this.models.safe((error as Error).message); }
          this.store.putTask(task); throw error;
        }
      }
      if (autoConfirm) this.acceptVoice(task, false);
      else {
        if (task.plan && task.intervals.every(interval => interval.status === 'ready')) this.rebuildPlan(task);
        task.stage = 'voice';
      }
    });
  }
  confirmVoice(id: string, preparePlan = true) {
    const task = this.writable(id);
    this.acceptVoice(task, preparePlan);
    return this.store.putTask(task);
  }
  private acceptVoice(task: Task, preparePlan: boolean) {
    if (!task.copyConfirmed || !task.intervals.length || task.intervals.some(interval => interval.status !== 'ready' || !interval.relativePath || !fs.existsSync(this.store.path(interval.relativePath)) || !interval.nodeTimes?.length || !interval.cues?.length)) throw new AppError('请先完成全部配音及时间戳检查');
    task.intervals.forEach(interval => { interval.confirmed = true; }); task.audioConfirmed = true; task.stage = 'visual'; task.error = '';
    if (preparePlan) { if (!task.plan) task.plan = buildPlan(task, this.library); else this.rebuildPlan(task); }
    else if (task.plan) task.plan.valid = false;
  }
  private rebuildPlan(task: Task) {
    const old = task.plan;
    if (!old) return;
    if(task.shotSelection){
      if(!task.copyConfirmed || !task.audioConfirmed || task.shotSelection.contextSignature!==this.shotContext(task))task.plan={...old,valid:false,warnings:['选片方案已失效，请重新匹配']};
      else task.plan=compileSelectionPlan(task,this.library);
      return;
    }
    task.plan = buildPlan(task, this.library, old.mode === 'manual' ? old.entries.map(entry => entry.assetId) : undefined, old.mode === 'auto' ? old.entries.map(entry => entry.assetId) : undefined);
  }
  plan(id: string, assetIds?: string[]) {
    const task = this.writable(id);
    if (!task.copyConfirmed || !task.audioConfirmed) throw new AppError('请先确认文案和配音');
    if (assetIds && (assetIds.length > 1000 || assetIds.some(value => typeof value !== 'string'))) throw new AppError('素材清单格式错误');
    task.plan = buildPlan(task, this.library, assetIds); task.previewStale = !!task.preview; task.stage = 'visual'; task.error = '';
    return this.store.putTask(task);
  }
  invalidateVisuals(productId: string) {
    for (const saved of this.store.tasks()) {
      if (saved.completed || saved.productId !== productId || !saved.plan) continue;
      const task = this.active?.task.id === saved.id ? this.active.task : saved;
      if (task.intervals.every(interval => interval.status === 'ready')) this.rebuildPlan(task);
      else { task.plan!.valid = false; task.plan!.warnings = ['素材已改变，配音就绪后重新检查画面']; }
      task.previewStale = !!task.preview; this.store.putTask(task);
    }
  }
  render(id: string, refill = false) {
    const task = this.writable(id);
    if(task.shotSelection){
      if(refill)throw new AppError('请先使用AI匹配素材更新选片，再生成视频');
      if(!task.copyConfirmed || !task.audioConfirmed || task.shotSelection.contextSignature!==this.shotContext(task))throw new AppError('选片方案已失效，请先重新匹配');
      task.plan=compileSelectionPlan(task,this.library);
    } else if (task.hostImage) throw new AppError('请先完成AI匹配素材，再生成视频',409);
    if (!task.copyConfirmed || !task.audioConfirmed || !task.plan?.valid) throw new AppError('请先确认文案、配音并补足画面时长');
    const previousAssetIds = task.plan.entries.map(entry => entry.assetId);
    if (refill) {
      task.plan = buildPlan(task, this.library);
      const candidates = this.library.ready(task.productId);
      const newIds = task.plan.entries.map(entry => entry.assetId);
      if (newIds.length && JSON.stringify(newIds) === JSON.stringify(previousAssetIds) && candidates.length > 1) {
        const alternate = candidates.find(asset => asset.id !== newIds[0]);
        if (alternate) task.plan = buildPlan(task, this.library, undefined, [alternate.id, ...newIds.slice(1)]);
      }
      if (task.preview && task.preview.inputs?.planSignature !== task.plan.signature) task.previewStale = true;
    } else this.rebuildPlan(task);
    if (!task.plan!.valid) { this.store.putTask(task); throw new AppError('当前素材不可用或时长不足，请检查画面'); }
    return this.start(task, 'render', async job => {
      if(!task.shotSelection){
      const videoAssets = this.store.assets().filter(asset => asset.hasVideo !== false && Number.isFinite(asset.duration) && asset.duration > 0 && this.library.available(asset) &&
        ((asset.kind === 'product' && asset.productId === task.productId) || (asset.kind === 'presenter' && task.nodes.some(node => node.id === asset.binding))));
      for (const asset of videoAssets) job.inputIds.add(asset.id);
      for (const asset of videoAssets) if (asset.videoDuration === undefined || asset.videoStart === undefined) {
        const info = await this.media.probe(this.store.path(asset.relativePath!));
        if (!info.videoDuration) throw new AppError(`无法读取素材的画面时长：${asset.title}`);
        Object.assign(asset, { duration: info.videoDuration, videoDuration: info.videoDuration, videoStart: info.videoStart, videoFrames: info.videoFrames });
        this.store.putAsset(asset);
      }
      this.rebuildPlan(task);
      if (!task.plan!.valid) throw new AppError('按实际视频画面时长检查后，素材不足，请返回画面设置补充');
      }
      job.inputIds.clear();
      for (const piece of task.plan!.pieces) for (const id of [piece.assetId, piece.productAssetId]) if (id) job.inputIds.add(id);
      if (task.settings.bgmId) job.inputIds.add(task.settings.bgmId);
      let last = 0;
      const result = await renderTask(task, this.library, this.media, job.controller.signal, (progress, message) => {
        task.execution!.progress = progress; task.execution!.message = message;
        if (Date.now() - last > 500) { this.store.putTask(task); last = Date.now(); }
      });
      task.preview = { ...result.preview, inputs: this.previewInputs(task) }; task.renderBase = result.base; task.previewStale = false; task.stage = 'preview'; task.lightTimeline = fullCues(task, this.library);
    });
  }
  stop(id: string) {
    if (this.active?.task.id !== id || this.active.kind !== 'render') throw new AppError('当前没有可停止的本地合成任务', 409);
    this.active.controller.abort(); return this.active.task;
  }
  async complete(id: string) {
    const task = this.writable(id);
    if (!task.preview || task.previewStale || !task.copyConfirmed || !task.audioConfirmed || !task.plan?.valid) throw new AppError('请先生成与当前配置一致的有效预览');
    this.completing = true;
    try {
    await this.media.probe(this.store.path(task.preview.relativePath));
    task.snapshot = { product: task.productSnapshot, template: task.templateSnapshot, variable: task.variable, nodes: task.nodes, settings: task.settings, picture: task.plan, shotSelection:task.shotSelection, hostImage: task.hostImage, voiceConfiguration: voiceConfig, copyModel: 'qwen3.7-plus', output: { width: 1080, height: 1920, fps: 30, format: 'mp4' } };
    const dir = this.store.taskDir(task.id); await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'parameters.json'), JSON.stringify(task.snapshot, null, 2));
    await fsp.writeFile(path.join(dir, 'timeline.json'), JSON.stringify({ cues: task.lightTimeline, intervals: task.intervals.map(({ relativePath, audioUrl, ...times }) => times) }, null, 2));
    task.completed = true; task.stage = 'preview'; task.cleanup = { status: 'pending' }; this.store.putTask(task);
    this.startCleanup(task); return task;
    } finally { this.completing = false; }
  }
  private async cleanup(task: Task) {
    const dir = this.store.taskDir(task.id), final = task.preview && this.store.path(task.preview.relativePath);
    if (!final || !fs.existsSync(final)) { task.cleanup = { status: 'failed', error: '正式成片不可用，未清理中间文件' }; this.store.putTask(task); return; }
    const pending = ['audio', 'work', 'host-image'].map(name => path.join(dir, name));
    const renders = path.join(dir, 'renders');
    if (fs.existsSync(renders)) for (const name of await fsp.readdir(renders)) { const target = path.join(renders, name); if (!inside(target, final) && target !== final) pending.push(target); }
    const errors: string[] = [];
    for (const target of pending) {
      if (!inside(dir, target) || inside(target, final) || target === final) { errors.push('清理范围校验失败'); continue; }
      try { await fsp.rm(target, { recursive: true, force: true }); } catch (error) { errors.push((error as Error).message); }
    }
    task.renderBase = undefined; task.cleanup = errors.length ? { status: 'failed', error: errors.join('; ') } : { status: 'done', at: new Date().toISOString() };
    this.store.putTask(task);
  }
  async export(id: string, directory: string) {
    const task = this.get(id);
    if (!task.preview) throw new AppError('还没有可导出的视频');
    if (!path.isAbsolute(directory) || !fs.existsSync(directory) || !(await fsp.stat(directory)).isDirectory()) throw new AppError('请选择有效的本地导出文件夹');
    const safeName = task.productSnapshot.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 60);
    const target = path.join(directory, `${safeName}-${new Date().toISOString().replace(/[:.]/g,'-')}-${Store.id().slice(0,6)}.mp4`);
    await fsp.copyFile(this.store.path(task.preview.relativePath), target, fs.constants.COPYFILE_EXCL);
    return { path: target };
  }
}
