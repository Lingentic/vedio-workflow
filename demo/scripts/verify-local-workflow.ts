// Reuse the previously paid, accepted speech recordings to verify the local
// workflow without issuing model requests. New cloud generation is tested separately.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../lib/store.ts';
import { Media, fileHash } from '../lib/media.ts';
import { alignAudio } from '../lib/alignment.ts';
import { voiceSignature } from '../lib/templates.ts';
import type { ScriptNode, Task, WordTime } from '../lib/types.ts';

const base = 'http://127.0.0.1:4186';
async function api(route: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + route, { method, ...(body === undefined ? {} : { headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${route}: ${result.message}`);
  return result;
}
async function settled(id: string): Promise<Task> {
  let last = '', until = Date.now() + 20 * 60 * 1000;
  while (Date.now() < until) {
    const task = await api('/api/tasks/' + id) as Task;
    const line = `${task.execution?.status} ${Math.round(task.execution?.progress || 0)} ${task.execution?.message}`;
    if (line !== last) { console.log(task.id, line); last = line; }
    if (task.execution?.status !== 'running') return task;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error('Local verification exceeded the bounded wait');
}
const state = await api('/api/state');
assert.equal(state.activeExecution, null, 'Cannot run local verification while a user task is executing');
const store = new Store(state.dataRoot), media = new Media();
const experiments = path.resolve(import.meta.dirname, '../../..', 'video-agent/experiments');
const templateIds = ['template-01-insoles', 'template-02-zipper'];
const productIds = ['thermal-insoles', '25374866461794'];
const results: object[] = [];
for (let index = 0; index < templateIds.length; index++) {
  const templateId = templateIds[index];
  const accepted = JSON.parse(await fs.readFile(path.join(experiments, 'qwen38-flash-copy-20261023/runs/trial-02-official-qwen37-plus', templateId, 'assembled-nodes.json'), 'utf8')) as ScriptNode[];
  let task = await api('/api/tasks', 'POST', { productId: productIds[index], templateId }) as Task;
  const patch: Record<string, unknown> = { black: Object.fromEntries(accepted.filter(node => node.type === 'generated_narration').map(node => [node.id,node.text])) };
  if (index === 0) patch.variable = '三块多一双';
  await api('/api/tasks/' + task.id, 'PATCH', patch);
  await api('/api/tasks/' + task.id + '/copy/confirm', 'POST');
  task = store.task(task.id)!;
  assert.equal(task.intervals.length, index === 0 ? 4 : 3);
  for (let i = 0; i < task.intervals.length; i++) {
    const interval = task.intervals[i];
    const prior = path.join(experiments, 'qwen31-two-template-tts-20261023/runs/trial-01', `${templateId}-ai-${String(i+1).padStart(2,'0')}`);
    assert.equal((await fs.readFile(path.join(prior,'text.txt'),'utf8')), interval.text, 'Accepted copy must remain literal');
    const words = JSON.parse(await fs.readFile(path.join(prior,'word-timestamps.json'),'utf8')) as WordTime[];
    const folder = path.join(store.taskDir(task.id),'audio','historical-'+i); await fs.mkdir(folder,{recursive:true});
    const audio = path.join(folder,'voice.wav'); await fs.copyFile(path.join(prior,'audio.wav'),audio);
    const info = await media.probe(audio);
    Object.assign(interval, { relativePath:path.relative(store.root,audio), duration:info.duration, words, status:'ready', confirmed:false, configuration:voiceSignature }, alignAudio(interval.text, task.nodes.filter(node=>interval.nodeIds.includes(node.id)),words,info.duration));
  }
  task.name = `本地链路验收 · ${task.productSnapshot.name}`;
  task.notice = '复用2026-10-23已验证的真实文案和配音；本次本地验证没有调用模型。';
  store.putTask(task);
  task = await api('/api/tasks/'+task.id+'/voice/confirm','POST') as Task;
  assert.equal(task.plan?.valid,true);
  const sourceHashes = new Map<string,string>();
  for (const interval of task.intervals) sourceHashes.set(interval.relativePath!,await fileHash(store.path(interval.relativePath!)));
  // A manual list may repeat sources; it must never silently loop itself to fill a shortfall.
  const short = await api('/api/tasks/'+task.id+'/plan','PUT',{assetIds:[]}) as Task;
  assert.equal(short.plan?.valid,false);
  const refused = await fetch(base+'/api/tasks/'+task.id+'/render',{method:'POST'});
  assert.equal(refused.status,400);
  task = await api('/api/tasks/'+task.id+'/plan','POST') as Task;
  if(index===0) {
    await api('/api/tasks/'+task.id+'/render','POST');
    const protectedId = task.plan!.pieces.find(piece=>piece.productAssetId)!.productAssetId!;
    const blocked = await fetch(base+'/api/assets/'+protectedId,{method:'DELETE'});
    assert.equal(blocked.status,409,'Rendering source deletion must be blocked');
    await api('/api/tasks/'+task.id+'/stop','POST');
    task = await settled(task.id);
    assert.equal(task.execution!.status,'stopped');
    assert.equal(task.copyConfirmed,true); assert.equal(task.audioConfirmed,true);
  }
  await api('/api/tasks/'+task.id+'/render','POST');
  task = await settled(task.id);
  assert.equal(task.execution!.status,'done',task.error);
  assert.ok(task.preview);
  assert.equal(task.preview.width,1080); assert.equal(task.preview.height,1920); assert.equal(task.preview.fps,30);
  for(const [relative,hash] of sourceHashes) assert.equal(await fileHash(store.path(relative)),hash,'Local composition must not replace speech recordings');
  const range = await fetch(base+task.preview.url!,{headers:{Range:'bytes=0-99'}});
  assert.equal(range.status,206); assert.equal((await range.arrayBuffer()).byteLength,100);
  results.push({taskId:task.id,templateId,output:store.path(task.preview.relativePath),duration:task.preview.duration,intervals:task.intervals.length,subtitles:true,modelCalls:0});
}
await fs.mkdir(path.resolve(import.meta.dirname,'../verification'),{recursive:true});
await fs.writeFile(path.resolve(import.meta.dirname,'../verification/local-workflow.json'),JSON.stringify({createdAt:new Date().toISOString(),kind:'local end-to-end using previous paid audio, no new model calls',results},null,2));
console.log(JSON.stringify({finished:true,results}));
store.close();
