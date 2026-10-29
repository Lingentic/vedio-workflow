import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { appRoot, defaultDataRoot, inside, loadProfile, nativeDialog, saveProfile } from './lib/paths.ts';
import { Store } from './lib/store.ts';
import { Media } from './lib/media.ts';
import { Models } from './lib/models.ts';
import { Library, seedAvailable, seedLibrary, validateProduct } from './lib/library.ts';
import { Workflow } from './lib/workflow.ts';
import { templates } from './lib/templates.ts';
import { AppError } from './lib/types.ts';
import { forwardCollection } from './lib/collector.ts';

const port = Number(process.env.PORT || 4186);
const defaultRoot = defaultDataRoot();
const profile = loadProfile();
profile.dataRoot = process.env.DEMO_DATA_ROOT || profile.dataRoot || defaultRoot;
const media = new Media(profile.ffmpeg, profile.ffprobe);
const models = new Models(profile);
function createContext(root: string) {
  const store = new Store(root);
  let workflow: Workflow;
  const library = new Library(store, media, id => !!workflow?.active?.inputIds.has(id));
  try { workflow = new Workflow(store, library, media, models); return { store, library, workflow }; }
  catch (error) { store.close(); throw error; }
}
let { store, library, workflow } = createContext(profile.dataRoot);
saveProfile(profile);

function json(response: http.ServerResponse, data: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}
function string(value: unknown, label: string): string { if (typeof value !== 'string' || !value.trim()) throw new AppError(`${label}不能为空`); return value; }
function paths(value: unknown): string[] { if (!Array.isArray(value) || !value.length || value.length > 1000 || value.some(item => typeof item !== 'string' || !path.isAbsolute(item))) throw new AppError('请选择有效的本地视频路径'); return value; }
async function body(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) throw new AppError('请求内容过大', 413); chunks.push(chunk); }
  if (!bytes) return {};
  if (!request.headers['content-type']?.includes('application/json')) throw new AppError('请求需要使用 JSON', 415);
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('JSON 格式错误'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError('请求内容必须为对象');
  return data as Record<string, unknown>;
}

const mime: Record<string, string> = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4' };
async function sendFile(request: http.IncomingMessage, response: http.ServerResponse, file: string) {
  const info = await fsp.stat(file);
  if (!info.isFile()) throw new AppError('文件不存在', 404);
  let start = 0, end = info.size - 1, partial = false;
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!match || (!match[1] && !match[2])) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
    start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
    partial = true;
  }
  response.writeHead(partial ? 206 : 200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) });
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', error => response.destroy(error)); response.on('close', () => stream.destroy()); stream.pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const host = request.headers.host || '';
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) throw new AppError('仅允许本机访问', 403);
    if (request.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(request.headers.origin)) throw new AppError('请求来源不受支持', 403);
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`), parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const method = request.method || 'GET';
    if ((parts[0] === 'api' && parts[1] === 'collect') || parts[0] === 'collect-media') {
      await forwardCollection(request, response, url); return;
    }
    if (parts[0] === 'collect' && ['GET', 'HEAD'].includes(method)) {
      const webRoot = path.resolve(appRoot, '../ecom-video-collect/web');
      const file = path.resolve(webRoot, ...parts.slice(1));
      if (!inside(webRoot, file) || !['.js', '.css'].includes(path.extname(file))) throw new AppError('采集页面资源不存在', 404);
      return await sendFile(request, response, file);
    }
    if (parts[0] === 'api') {
      const data = ['POST','PATCH','PUT'].includes(method) ? await body(request) : {};
      if (parts[1] === 'runtime' && method === 'GET') return json(response, { app: 'vedio-workflow', interfaceVersion: 'library-browser-preview-v4' });
      if (parts[1] === 'state' && method === 'GET') {
        return json(response, { configured: true, dataRoot: store.root, defaultDataRoot: defaultRoot, modelReady: models.ready(), toolsReady: true, templates,
          products: store.products(), assets: store.assets().map(asset => library.publicAsset(asset)), tasks: store.tasks().map(task => workflow.publicTask(task)),
          bgms: store.assets().filter(asset => asset.kind === 'bgm' && library.available(asset)).map(asset => library.publicAsset(asset)), seedAvailable: seedAvailable(),
          activeExecution: workflow.active ? { taskId: workflow.active.task.id, ...workflow.active.task.execution } : null, libraryBusy: library.busy, libraryMessage: library.message });
      }
      if (parts[1] === 'setup' && method === 'POST') {
        workflow.idle(); if (library.busy) throw new AppError('素材处理中，暂不能更换数据目录', 409);
        const target = data.dataRoot === undefined ? defaultRoot : string(data.dataRoot, '数据目录');
        if (!path.isAbsolute(target) || target === appRoot || inside(appRoot, target)) throw new AppError('请选择独立于代码目录的绝对数据路径');
        await workflow.waitForCleanup(); workflow.idle();
        const next = createContext(target);
        try { saveProfile({ ...profile, dataRoot: target }); } catch (error) { await next.workflow.waitForCleanup(); next.store.close(); throw error; }
        const previous = store;
        ({ store, library, workflow } = next); profile.dataRoot = target; previous.close();
        return json(response, { dataRoot: store.root });
      }
      if (parts[1] === 'dialog' && method === 'POST') {
        if (data.kind !== 'folder' && data.kind !== 'videos') throw new AppError('选择窗口类型不存在');
        return json(response, { paths: await nativeDialog(data.kind) });
      }
      if (parts[1] === 'seed' && method === 'POST') { workflow.idle(); await seedLibrary(library, profile.seedRoot); return json(response, { imported: true }); }
      if (parts[1] === 'products') {
        const id = parts[2];
        if (!id && method === 'GET') return json(response, store.products());
        if (!id && method === 'POST') {
          const product = validateProduct(data); store.putProduct(product);
          if (data.localVideos !== undefined) {
            if (!Array.isArray(data.localVideos)) throw new AppError('本地视频清单格式错误');
            for (const item of data.localVideos as unknown[]) {
              if (!item || typeof item !== 'object' || !('path' in item) || typeof item.path !== 'string' || !('processed' in item) || typeof item.processed !== 'boolean') throw new AppError('视频需要包含路径及是否已处理');
              await library.importFiles(product.productId, [item.path], item.processed);
            }
          }
          return json(response, { ...product, assets: library.ready(product.productId).map(asset => library.publicAsset(asset)) }, 201);
        }
        const product = id && store.product(id); if (!product) throw new AppError('商品不存在', 404);
        if (parts[3] === 'import' && method === 'POST') {
          if (typeof data.processed !== 'boolean') throw new AppError('请选择原始视频或已处理片段');
          return json(response, { assets: await library.importFiles(id, paths(data.paths), data.processed) });
        }
        if (method === 'PATCH') {
          const next = validateProduct({ ...product, ...data, productId: product.productId }); store.putProduct(next); return json(response, next);
        }
        if (method === 'GET') return json(response, { ...product, assets: library.ready(id).map(asset => library.publicAsset(asset)) });
      }
      if (parts[1] === 'assets') {
        if (method === 'DELETE') { const asset = await library.remove(parts[2]); workflow.invalidateVisuals(asset.productId!); return json(response, library.publicAsset(asset)); }
        if (method === 'POST' && parts[3] === 'retry') { const asset = await library.retry(parts[2]); if (asset.productId) workflow.invalidateVisuals(asset.productId); return json(response, library.publicAsset(asset)); }
      }
      if (parts[1] === 'tasks') {
        const id = parts[2], operation = parts.slice(3).join('/');
        if (!id && method === 'POST') return json(response, workflow.publicTask(workflow.create(string(data.productId,'商品'), string(data.templateId,'模板'))), 201);
        if (!id && method === 'GET') return json(response, store.tasks().map(task => workflow.publicTask(task)));
        if (!operation && method === 'GET') return json(response, workflow.publicTask(workflow.get(id)));
        if (!operation && method === 'PATCH') return json(response, workflow.publicTask(workflow.patch(id, data)));
        if (method === 'PUT' && operation === 'plan') return json(response, workflow.publicTask(workflow.plan(id, pathsIds(data.assetIds))));
        if (method === 'POST') {
          if (operation === 'switch') return json(response, workflow.publicTask(workflow.switch(id,string(data.productId,'商品'),string(data.templateId,'模板'),string(data.mode,'切换方式'))));
          if (operation === 'copy') return json(response, workflow.publicTask(workflow.generateCopy(id)), 202);
          if (operation === 'copy/confirm') {
            if (data.generateVoice !== undefined && typeof data.generateVoice !== 'boolean') throw new AppError('generateVoice 必须为布尔值');
            return json(response, workflow.publicTask(data.generateVoice ? workflow.confirmCopyAndVoice(id) : workflow.confirmCopy(id)), data.generateVoice ? 202 : 200);
          }
          if (operation === 'voice') {
            if (data.autoConfirm !== undefined && typeof data.autoConfirm !== 'boolean') throw new AppError('autoConfirm 必须为布尔值');
            return json(response, workflow.publicTask(workflow.generateVoice(id, data.intervalId === undefined ? undefined : string(data.intervalId,'口播区间'), data.autoConfirm === true)), 202);
          }
          if (operation === 'voice/confirm') return json(response, workflow.publicTask(workflow.confirmVoice(id)));
          if (operation === 'plan') return json(response, workflow.publicTask(workflow.plan(id)));
          if (operation === 'render') {
            if (data.refill !== undefined && typeof data.refill !== 'boolean') throw new AppError('refill 必须为布尔值');
            return json(response, workflow.publicTask(workflow.render(id, data.refill === true)), 202);
          }
          if (operation === 'stop') return json(response, workflow.publicTask(workflow.stop(id)));
          if (operation === 'complete') return json(response, workflow.publicTask(await workflow.complete(id)));
          if (operation === 'export') return json(response, await workflow.export(id, string(data.directory,'导出文件夹')));
        }
      }
      throw new AppError('接口不存在', 404);
    }
    if (!['GET','HEAD'].includes(method)) throw new AppError('请求方式不受支持', 405);
    if (parts[0] === 'poster' || (parts[0] === 'media' && parts[1] === 'asset')) {
      const asset = store.asset(parts[0] === 'poster' ? parts[1] : parts[2]);
      if (!asset || asset.status === 'deleted') throw new AppError('素材不存在或已删除', 404);
      const relative = parts[0] === 'poster' ? asset.posterPath : asset.relativePath;
      if (!relative || !fs.existsSync(store.path(relative))) throw new AppError('素材文件暂不可用', 404);
      const source = store.path(relative);
      const file = parts[0] === 'media' && url.searchParams.get('browser') === '1'
        ? await media.browserPreview(source, store.path(path.join('缓存', '素材预览'))) : source;
      return await sendFile(request, response, file);
    }
    if (parts[0] === 'media' && parts[1] === 'task') {
      const task = workflow.get(parts[2]), kind = parts[3];
      const relative = kind === 'preview' ? task.preview?.relativePath : kind?.startsWith('audio-') && !task.completed ? task.intervals.find(interval => interval.id === kind.slice(6))?.relativePath : undefined;
      if (!relative || !fs.existsSync(store.path(relative))) throw new AppError('媒体文件不存在或已清理', 404);
      return await sendFile(request, response, store.path(relative));
    }
    const publicDir = path.join(appRoot, 'public');
    if (['/app.js','/sortable.js','/prototype-views.js'].includes(url.pathname)) {
      const sourceFile = url.pathname.slice(1).replace(/\.js$/, '.ts');
      const source = await fsp.readFile(path.join(publicDir, sourceFile), 'utf8');
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      response.end(stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: sourceFile })); return;
    }
    const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!inside(publicDir,file)) throw new AppError('文件路径不受支持', 403);
    await sendFile(request,response,file);
  } catch (error) {
    if (response.headersSent) { response.destroy(error as Error); return; }
    const status = error instanceof AppError ? error.status : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500;
    json(response, { error: status === 500 ? 'operation_failed' : 'invalid_request', message: models.safe((error as Error).message) }, status);
  }
});
function pathsIds(value: unknown): string[] { if (!Array.isArray(value) || value.length > 1000 || value.some(item => typeof item !== 'string')) throw new AppError('素材ID清单格式错误'); return value; }
server.requestTimeout = 20 * 60 * 1000;
server.listen(port, '127.0.0.1', () => { console.log(`电商视频工作台Demo：http://127.0.0.1:${port}/`); console.log(`数据目录：${store.root}`); });
async function shutdown() {
  if (workflow.active?.kind === 'render') workflow.active.controller.abort();
  if (workflow.active?.promise && workflow.active.kind === 'render') await workflow.active.promise;
  await workflow.waitForCleanup();
  server.close(); store.close(); process.exit(0);
}
process.once('SIGINT', () => { void shutdown(); }); process.once('SIGTERM', () => { void shutdown(); });
