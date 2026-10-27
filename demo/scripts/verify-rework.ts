import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileHash } from '../lib/media.ts';
import { inside } from '../lib/paths.ts';
import type { Task } from '../lib/types.ts';

const base='http://127.0.0.1:4186';
async function api(route:string,method='GET',body?:unknown){const r=await fetch(base+route,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const value=await r.json();if(!r.ok)throw new Error(value.message);return value;}
const state=await api('/api/state');
let task=state.tasks.find((item:Task)=>item.productId==='thermal-insoles'&&item.name.startsWith('本地链路验收')&&!item.completed) as Task;
assert.ok(task?.preview);
const id=task.id, root=state.dataRoot, entries=task.plan!.entries.map(entry=>entry.assetId), beforePicture=task.renderBase!.relativePath, oldPreview=task.preview!.relativePath;
const audioHashes=await Promise.all(task.intervals.map(async interval=>({path:interval.relativePath!,hash:await fileHash(path.join(root,interval.relativePath!))})));
const bgm=state.bgms.find((item:{duration:number})=>item.duration<15);assert.ok(bgm,'A short BGM is required to verify looping');
task=await api('/api/tasks/'+id,'PATCH',{settings:{subtitles:true,bgmId:bgm.id,bgmVolume:.12}});
assert.deepEqual(task.plan!.entries.map(entry=>entry.assetId),entries);assert.equal(task.previewStale,true);
await api('/api/tasks/'+id+'/render','POST');
let last='';
for(let attempts=0;attempts<600;attempts++){
  task=await api('/api/tasks/'+id);
  const message=task.execution?.message||'';if(message!==last){console.log(message);last=message;}
  if(task.execution?.status!=='running')break;
  await new Promise(resolve=>setTimeout(resolve,1000));
}
assert.equal(task.execution?.status,'done',task.error);
assert.equal(task.renderBase!.relativePath,beforePicture,'Only BGM changed: reuse the same picture');
assert.deepEqual(task.plan!.entries.map(entry=>entry.assetId),entries);
await fs.access(path.join(root,oldPreview));
for(const audio of audioHashes)assert.equal(await fileHash(path.join(root,audio.path)),audio.hash);
const exportDir=await fs.mkdtemp(path.join(os.tmpdir(),'ecommerce-demo-export-'));
assert.ok(inside(os.tmpdir(),exportDir));
const exported=await api('/api/tasks/'+id+'/export','POST',{directory:exportDir});
assert.equal(await fileHash(exported.path),await fileHash(path.join(root,task.preview!.relativePath)));
assert.equal((await api('/api/tasks/'+id)).completed,false,'Export must not mark the task completed');
await api('/api/tasks/'+id+'/complete','POST');
for(let attempts=0;attempts<100;attempts++){task=await api('/api/tasks/'+id);if(task.cleanup?.status!=='pending')break;await new Promise(resolve=>setTimeout(resolve,100));}
assert.equal(task.completed,true);assert.equal(task.cleanup?.status,'done');
await fs.access(path.join(root,task.preview!.relativePath));
assert.equal((await fetch(base+'/api/tasks/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({example:'只读不能修改'})})).status,409);
const record=await api('/api/tasks/'+id);assert.equal(record.id,id);
await fs.mkdir(path.resolve(import.meta.dirname,'../verification'),{recursive:true});
await fs.writeFile(path.resolve(import.meta.dirname,'../verification/rework.json'),JSON.stringify({taskId:id,passed:['short BGM loop covers complete narration','BGM-only reuse picture and queue','speech recordings unchanged','old preview retained until replacement','optional export independent of completion','confirm complete readonly','owned intermediate cleanup keeps final'],final:path.join(root,task.preview!.relativePath),exported:exported.path},null,2));
console.log(JSON.stringify({finished:true,taskId:id,completed:task.completed,cleanup:task.cleanup,output:path.join(root,task.preview!.relativePath)}));
