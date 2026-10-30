import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.ts';
import { Media } from '../lib/media.ts';
import { Models } from '../lib/models.ts';
import { Library } from '../lib/library.ts';
import { Workflow } from '../lib/workflow.ts';
import { alignAudio } from '../lib/alignment.ts';
import { buildPlan } from '../lib/plan.ts';
import { intervalsFromNodes } from '../lib/templates.ts';
import { inside } from '../lib/paths.ts';
import type { Asset, MediaInfo, ScriptNode, Task, WordTime } from '../lib/types.ts';

function environment(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecommerce-demo-test-'));
  const store = new Store(root), media = new Media(), models = new Models({ credentialsFile: path.join(root,'absent.env') });
  let workflow: Workflow;
  const library = new Library(store, media, id => !!workflow?.active?.inputIds.has(id)); workflow = new Workflow(store,library,media,models);
  store.putProduct({productId:'test-product',name:'测试商品',price:'6.90',specification:'5双',sellingPoints:'柔软'});
  t.after(()=>{store.close();assert.ok(inside(os.tmpdir(),root));assert.ok(path.basename(root).startsWith('ecommerce-demo-test-'));fs.rmSync(root,{recursive:true,force:true});});
  return {root,store,media,models,library,workflow};
}
function localFile(store: Store, relative: string) {const file=store.path(relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture');return relative;}
function asset(store:Store,id:string,duration:number,kind:Asset['kind']='product',binding?:string) {
  const result:Asset={id,productId:kind==='product'?'test-product':undefined,kind,binding,title:id,status:'ready',duration,width:1080,height:1920,hasAudio:true,createdAt:new Date().toISOString(),relativePath:localFile(store,path.join(kind==='product'?'商品素材':'固定素材',id+'.mp4'))};
  store.putAsset(result);return result;
}
const spokenWords=(text:string):WordTime[]=>[...text].map((char,i)=>({text:char,begin_time:i*100,end_time:(i+1)*100}));

test('AI选片一次安排全片，失败保留旧方案，文案配音变更后失效且不新增生成记录',async t=>{
  const e=environment(t);asset(e.store,'candidate',8);
  const task=e.workflow.create('test-product','template-01-insoles');
  task.templateSnapshot.nodes=[{id:'g',type:'generated_narration',text:''}];task.templateSnapshot.variableNodeId=undefined;task.black={g:'保暖舒适。'};task.nodes=[{id:'g',type:'generated_narration',text:'保暖舒适。'}];task.copyConfirmed=true;task.audioConfirmed=true;
  task.intervals=[{id:'i',nodeIds:['g'],text:'保暖舒适。',signature:'audio',status:'ready',confirmed:true,duration:3,relativePath:localFile(e.store,path.join('制作任务',task.id,'audio','a.wav')),nodeTimes:[{id:'g',begin:.1,end:2.7}]}];e.store.putTask(task);
  e.models.ready=()=>true;let calls=0;
  e.models.selectShots=async input=>{calls++;return{response:{choices:input.slots.map(slot=>({slotId:slot.id,assetIds:[input.candidates[0].id]}))},requestId:'fixture'};};
  e.workflow.selectShots(task.id);await e.workflow.active!.promise;
  const saved=e.store.task(task.id)!;assert.equal(calls,1);assert.equal(saved.videoSubmittedAt,null);assert.deepEqual(saved.intervals,task.intervals);assert.equal(e.workflow.publicTask(saved).shotSelection?.stale,false);
  e.models.selectShots=async()=>{throw new Error('模拟模型失败');};
  e.workflow.selectShots(task.id);await e.workflow.active!.promise;
  assert.deepEqual(e.store.task(task.id)!.shotSelection,saved.shotSelection);assert.equal(e.store.task(task.id)!.execution?.status,'failed');
  const choices=saved.shotSelection!.choices.map(({slotId,assetIds})=>({slotId,assetIds}));
  const manual=e.workflow.saveShotSelection(task.id,{choices});assert.equal(manual.shotSelection?.mode,'manual');
  e.workflow.patch(task.id,{black:{g:'新的商品介绍。'}});
  assert.equal(e.workflow.publicTask(e.workflow.get(task.id)).shotSelection?.stale,true);
  assert.throws(()=>e.workflow.saveShotSelection(task.id,{choices}),/配音|确认/);
});

test('主播共用图片独立保存，调整位置保留配音，校验商品归属与完成只读',async t=>{
  const e=environment(t),video=asset(e.store,'product-video',5),task=e.workflow.create('test-product','template-01-insoles');
  task.copyConfirmed=true;task.audioConfirmed=true;task.intervals=[{id:'voice',nodeIds:['n'],text:'保暖',signature:'valid',status:'ready',confirmed:true,duration:2}];e.store.putTask(task);
  let captures=0;e.media.ff=async args=>{captures++;fs.writeFileSync(String(args.at(-1)),'image');return '';};
  e.media.probe=async()=>({duration:0,width:1080,height:1920,fps:0,hasVideo:true,hasAudio:false,size:5});
  const first=await e.workflow.setHostImage(task.id,{},true),relative=first.hostImage!.relativePath;
  assert.notEqual(relative,video.relativePath);assert.equal(captures,1);assert.equal(fs.readFileSync(e.store.path(video.relativePath!),'utf8'),'fixture');
  await e.workflow.setHostImage(task.id,{},true);assert.equal(captures,1,'再次进入不重复截图');
  const adjusted=await e.workflow.setHostImage(task.id,{x:.3,y:.8,scale:1.5});
  assert.equal(adjusted.hostImage!.relativePath,relative);assert.deepEqual(adjusted.intervals,task.intervals);assert.equal(adjusted.audioConfirmed,true);assert.equal(adjusted.videoSubmittedAt,null);
  assert.equal(e.store.task(task.id)?.hostImage?.y,.8);
  assert.throws(()=>e.workflow.setHostImage(task.id,{x:NaN}),/参数无效/);
  const foreign=asset(e.store,'foreign-image',0);foreign.productId='other';foreign.hasVideo=false;e.store.putAsset(foreign);
  assert.throws(()=>e.workflow.setHostImage(task.id,{assetId:foreign.id}),/当前商品/);
  assert.throws(()=>e.workflow.render(task.id),/先完成AI匹配/);
  const completed=e.workflow.get(task.id);completed.completed=true;e.store.putTask(completed);
  assert.throws(()=>e.workflow.setHostImage(task.id,{x:.2}),/只读/);
});

test('更换主播图片失败保留原配置，成功后独立于来源资源',async t=>{
  const e=environment(t),video=asset(e.store,'video',4),image=asset(e.store,'image',0),task=e.workflow.create('test-product','template-02-zipper');
  image.hasVideo=false;e.store.putAsset(image);
  e.media.ff=async args=>{fs.writeFileSync(String(args.at(-1)),'jpeg');return '';};
  e.media.probe=async()=>({duration:0,width:1080,height:1920,fps:0,hasVideo:true,hasAudio:false,size:4});
  const first=await e.workflow.setHostImage(task.id,{assetId:image.id,x:.2,y:.7,scale:2}),old=first.hostImage!;
  e.media.ff=async()=>{throw new Error('坏图片');};
  await assert.rejects(e.workflow.setHostImage(task.id,{assetId:image.id}),/坏图片/);
  assert.deepEqual(e.store.task(task.id)!.hostImage,old);assert.ok(fs.existsSync(e.store.path(old.relativePath)));
  e.media.ff=async args=>{fs.writeFileSync(String(args.at(-1)),'replacement');return '';};
  const next=await e.workflow.setHostImage(task.id,{assetId:image.id});
  assert.notEqual(next.hostImage!.relativePath,old.relativePath);assert.equal(fs.existsSync(e.store.path(old.relativePath)),false);
  await e.library.remove(image.id);assert.ok(fs.existsSync(e.store.path(next.hostImage!.relativePath)));assert.ok(fs.existsSync(e.store.path(video.relativePath!)));
});

test('确认文案后服务端配音，失败保留已成区间；重试仅补失败项，完成不接入旧选材队列',async t=>{
  const e=environment(t);
  const task=e.workflow.create('test-product','template-01-insoles');
  task.templateSnapshot.nodes=[{id:'a',type:'generated_narration',text:''},{id:'r',type:'host_clip',text:'主播'},{id:'b',type:'generated_narration',text:''}];
  task.templateSnapshot.variableNodeId=undefined;task.black={a:'柔软舒适。',b:'保暖耐用。'};e.store.putTask(task);
  e.models.ready=()=>true;
  const calls:string[]=[];let fail=true;
  e.models.voice=async text=>{calls.push(text);if(text==='保暖耐用。'&&fail)throw new Error('模拟配音断连');return {audio:Buffer.from('voice'),words:spokenWords(text),requestId:'test',billedCharacters:text.length};};
  e.media.probe=async()=>({duration:2,width:0,height:0,fps:0,hasVideo:false,hasAudio:true,size:5});
  e.media.ff=async()=>'';
  e.workflow.confirmCopyAndVoice(task.id);await e.workflow.active!.promise;
  const failed=e.workflow.get(task.id),firstFile=failed.intervals[0].relativePath;
  assert.equal(failed.execution?.status,'failed');assert.equal(failed.intervals[0].status,'ready');assert.equal(failed.intervals[1].status,'failed');assert.equal(failed.plan,null);assert.equal(failed.audioConfirmed,false);
  fail=false;e.workflow.generateVoice(task.id,undefined,true);await e.workflow.active!.promise;
  const ready=e.workflow.get(task.id);
  assert.deepEqual(calls,['柔软舒适。','保暖耐用。','保暖耐用。']);assert.equal(ready.intervals[0].relativePath,firstFile);
  assert.equal(ready.audioConfirmed,true);assert.equal(ready.stage,'visual');assert.equal(ready.plan,null);assert.ok(ready.intervals.every(i=>i.confirmed&&i.cues?.length&&i.nodeTimes?.length));
  e.workflow.confirmCopyAndVoice(task.id);assert.equal(calls.length,3,'再次确认相同文案直接复用全部配音');
});

test('金额6.90保持完整，前后字幕时间不重叠',()=>{
  const text='只要6.90元，马上拍。',nodes:ScriptNode[]=[{id:'n',type:'generated_narration',text}];
  const result=alignAudio(text,nodes,spokenWords('只要六点九零元马上拍'),5);
  assert.equal(result.cues[0].text,'只要6.90元，');
  assert.ok(result.cues[1].begin>=result.cues[0].end);
});
test('配音文字无法对应时拒绝伪造字幕时间',()=>{
  const text='只要六元。';
  assert.throws(()=>alignAudio(text,[{id:'n',type:'generated_narration',text}],spokenWords('只要九元'),5),/无法完整对应/);
});
test('红色下半屏和AI商品全屏共用游标，通用主播期间暂停；手动不足不循环，允许整条重复',t=>{
  const e=environment(t);asset(e.store,'A',4);asset(e.store,'B',7);asset(e.store,'host1',3,'host','r1');asset(e.store,'host2',2,'host','r2');asset(e.store,'generic',2,'presenter','b1');
  const task=e.workflow.create('test-product','template-01-insoles');
  task.nodes=[{id:'r1',type:'host_clip',text:'开场'},{id:'b1',type:'fixed_narration',text:'铺垫'},{id:'g1',type:'generated_narration',text:'卖点'},{id:'r2',type:'host_clip',text:'结尾'}];
  task.intervals=intervalsFromNodes(task.nodes);Object.assign(task.intervals[0],{status:'ready',duration:8,relativePath:localFile(e.store,path.join('制作任务',task.id,'audio','a.wav')),nodeTimes:[{id:'b1',begin:.073,end:3},{id:'g1',begin:3,end:8}]});
  const plan=buildPlan(task,e.library);assert.equal(plan.requiredDuration,11);assert.equal(plan.duration,13);assert.equal(plan.valid,true);
  assert.deepEqual(plan.events.map(event=>[event.mode,event.start,event.duration]),[['host',0,3],['presenter',3,2],['product',5,6],['host',11,2]]);
  const before=plan.pieces[0],after=plan.pieces.find(piece=>piece.mode==='product')!;
  assert.equal(after.productAssetId,before.productAssetId);assert.equal(after.productStart,3,'Presenter must not advance product cursor');
  assert.equal(buildPlan(task,e.library,['A']).valid,false);
  const manual=buildPlan(task,e.library,['A','A','A']);assert.equal(manual.valid,true);assert.equal(manual.entries.length,3);assert.equal(manual.warnings.length,0);
});
test('图片可预览但不能进入自动或手动画面队列，旧视频缺少 hasVideo 仍可用',t=>{
  const e=environment(t);
  const image=asset(e.store,'image',0);image.hasVideo=false;image.title='商品图.png';image.relativePath=localFile(e.store,path.join('商品素材','商品图.png'));e.store.putAsset(image);
  const positiveImage=asset(e.store,'image-with-duration',4);positiveImage.hasVideo=false;e.store.putAsset(positiveImage);
  const zeroVideo=asset(e.store,'zero-video',0);zeroVideo.hasVideo=true;e.store.putAsset(zeroVideo);
  const task=e.workflow.create('test-product','template-01-insoles');
  task.nodes=[{id:'n',type:'generated_narration',text:'商品介绍'}];task.intervals=intervalsFromNodes(task.nodes);
  Object.assign(task.intervals[0],{status:'ready',duration:3,relativePath:localFile(e.store,path.join('制作任务',task.id,'audio','a.wav'))});
  assert.equal(e.library.publicAsset(image).available,true,'图片保持预览可用');
  assert.deepEqual(e.library.ready('test-product'),[]);
  const empty=buildPlan(task,e.library);assert.equal(empty.valid,false);assert.equal(empty.entries.length,0);assert.match(empty.warnings[0],/没有可用片段/);
  const invalid=buildPlan(task,e.library,[image.id,positiveImage.id,zeroVideo.id]);assert.equal(invalid.valid,false);assert.ok(invalid.entries.every(entry=>!entry.available&&entry.duration===0));
  const video=asset(e.store,'legacy-video',4);assert.equal(video.hasVideo,undefined);
  assert.deepEqual(e.library.ready('test-product').map(item=>item.id),[video.id]);
  const mixed=buildPlan(task,e.library);assert.equal(mixed.valid,true);assert.ok(mixed.entries.every(entry=>entry.assetId===video.id));assert.ok(mixed.pieces.every(piece=>piece.productAssetId===video.id));
  assert.equal(buildPlan(task,e.library,[image.id,video.id]).valid,false);
  assert.equal(buildPlan(task,e.library,[video.id]).valid,true);
});

test('只改一个黑色节点，只使所属连续口播区间失效，其他音频继续复用',t=>{
  const e=environment(t);let task=e.workflow.create('test-product','template-01-insoles');
  const black=Object.fromEntries(task.templateSnapshot.nodes.filter(node=>node.type==='generated_narration').map(node=>[node.id,'这款柔软舒适。']));
  e.workflow.patch(task.id,{variable:'三块多一双',black});task=e.workflow.confirmCopy(task.id);
  task.intervals.forEach((interval,i)=>Object.assign(interval,{status:'ready',confirmed:true,duration:2,relativePath:localFile(e.store,path.join('制作任务',task.id,'audio',`${i}.wav`))}));
  task.audioConfirmed=true;e.store.putTask(task);
  const original=task.intervals.map(interval=>interval.relativePath);
  e.workflow.patch(task.id,{black:{'t1-g4':'换了一句台词。'}});task=e.workflow.confirmCopy(task.id);
  assert.deepEqual(task.intervals.map(interval=>interval.status),['ready','missing','ready','ready']);
  for(const i of [0,2,3])assert.equal(task.intervals[i].relativePath,original[i]);
  assert.ok(fs.existsSync(e.store.path(original[1]!)),'Invalidating a draft must not delete prior audio before replacement');
});
test('确认完成时锁编辑，完成后只读并清理本任务中间文件',async t=>{
  const e=environment(t);let task=e.workflow.create('test-product','template-01-insoles');
  const product=asset(e.store,'keep-product',10);
  task.copyConfirmed=true;task.audioConfirmed=true;task.previewStale=false;
  const final=localFile(e.store,path.join('制作任务',task.id,'renders','final','result.mp4'));
  localFile(e.store,path.join('制作任务',task.id,'work','middle.mp4'));localFile(e.store,path.join('制作任务',task.id,'audio','a.wav'));
  localFile(e.store,path.join('制作任务',task.id,'host-image','image.jpg'));
  task.preview={relativePath:final,duration:1,width:1080,height:1920,fps:30,size:7,signature:'x',createdAt:new Date().toISOString()};
  task.plan={mode:'auto',entries:[],requiredDuration:1,availableDuration:1,valid:true,repeated:false,warnings:[],events:[],pieces:[],signature:'x',duration:1};e.store.putTask(task);
  let release:(value:MediaInfo)=>void=()=>{};
  e.media.probe=()=>new Promise(resolve=>{release=resolve;});
  const completion=e.workflow.complete(task.id);
  assert.throws(()=>e.workflow.patch(task.id,{example:'不能在确认期间覆盖'}),/正在执行/);
  assert.throws(()=>e.workflow.create('test-product','template-01-insoles'),/正在执行/);
  release({duration:1,width:1080,height:1920,fps:30,hasAudio:true,hasVideo:true,size:7});
  await completion;await e.workflow.waitForCleanup();task=e.store.task(task.id)!;
  assert.equal(task.completed,true);assert.equal(task.cleanup?.status,'done');
  assert.ok(fs.existsSync(e.store.path(final)));assert.ok(fs.existsSync(e.store.path(product.relativePath!)));
  assert.equal(fs.existsSync(path.join(e.store.taskDir(task.id),'audio')),false);
  assert.equal(fs.existsSync(path.join(e.store.taskDir(task.id),'work')),false);
  assert.equal(fs.existsSync(path.join(e.store.taskDir(task.id),'host-image')),false);
  assert.throws(()=>e.workflow.patch(task.id,{example:'已完成不能改'}),/只读/);
  assert.throws(()=>e.workflow.render(task.id,true),/只读/);
});
