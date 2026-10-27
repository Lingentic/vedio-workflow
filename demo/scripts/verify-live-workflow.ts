// This script performs exactly one explicitly authorized new copy request and
// the four required insole speech requests. It never retries provider failures.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { Task } from '../lib/types.ts';

const base='http://127.0.0.1:4186';
const report=path.resolve(import.meta.dirname,'../verification/live-workflow.json');
async function api(route:string,method='GET',body?:unknown){const response=await fetch(base+route,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw new Error(value.message);return value;}
async function wait(id:string):Promise<Task>{
  let previous='';
  for(let attempt=0;attempt<1200;attempt++){
    const task=await api('/api/tasks/'+id) as Task;
    const label=`${task.execution?.kind} ${task.execution?.status} ${Math.round(task.execution?.progress||0)} ${task.execution?.message}`;
    if(label!==previous){console.log(label);previous=label;}
    if(task.execution?.status!=='running')return task;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('Execution did not settle within the bounded wait');
}
await fs.mkdir(path.dirname(report),{recursive:true});
let exists=false;try{await fs.access(report);exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
if(exists)throw new Error('Real workflow report already exists; refusing accidental paid rerun');
let task=await api('/api/tasks','POST',{productId:'thermal-insoles',templateId:'template-01-insoles'}) as Task;
const result:{createdAt:string;taskId:string;authorization:string;copySubmissions:number;voiceBatchSubmissions:number;status:string;error?:string;output?:unknown}={createdAt:new Date().toISOString(),taskId:task.id,authorization:'User explicitly approved one new insole copy + four speech intervals + local composition',copySubmissions:0,voiceBatchSubmissions:0,status:'created'};
const save=()=>fs.writeFile(report,JSON.stringify(result,null,2));await save();
try {
  result.copySubmissions=1;result.status='copy_submitting';await save();
  await api('/api/tasks/'+task.id+'/copy','POST');task=await wait(task.id);
  assert.equal(task.execution?.status,'done',task.error);
  await api('/api/tasks/'+task.id+'/copy/confirm','POST');
  result.voiceBatchSubmissions=1;result.status='voice_submitting';await save();
  await api('/api/tasks/'+task.id+'/voice','POST');task=await wait(task.id);
  assert.equal(task.execution?.status,'done',task.error);
  assert.equal(task.intervals.length,4);assert.ok(task.intervals.every(interval=>interval.status==='ready'));
  await api('/api/tasks/'+task.id+'/voice/confirm','POST');
  result.status='rendering';await save();
  await api('/api/tasks/'+task.id+'/render','POST');task=await wait(task.id);
  assert.equal(task.execution?.status,'done',task.error);
  assert.equal(task.preview?.width,1080);assert.equal(task.preview?.height,1920);assert.equal(task.preview?.fps,30);
  result.status='preview_ready';result.output=task.preview;await save();
  console.log(JSON.stringify({finished:true,taskId:task.id,preview:task.preview,voiceIntervals:task.intervals.map(interval=>({id:interval.id,duration:interval.duration,words:interval.words?.length,billedCharacters:interval.billedCharacters,requestId:interval.requestId}))}));
}catch(error){result.status='failed_no_retry';result.error=(error as Error).message;await save();console.error(JSON.stringify(result));process.exitCode=1;}
