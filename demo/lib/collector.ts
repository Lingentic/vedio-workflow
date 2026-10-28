import http from 'node:http';
import { AppError } from './types.ts';

// The browser only talks to the workbench origin; Python remains a local worker.
export async function forwardCollection(request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<void> {
  const base = new URL(process.env.COLLECT_SERVICE_URL || 'http://127.0.0.1:8765');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.username || base.password) throw new AppError('采集服务必须使用本机 HTTP 地址');
  const method = request.method || 'GET';
  const media = url.pathname.startsWith('/collect-media/');
  const targetPath = media ? url.pathname.replace('/collect-media/', '/media/') : url.pathname.replace('/api/collect/', '/api/');
  const allowed = media ? ['GET', 'HEAD'].includes(method) :
    (method === 'GET' && ['/api/health', '/api/search', '/api/proxy'].includes(targetPath)) ||
    (method === 'POST' && ['/api/download', '/api/preview', '/api/workbench-import'].includes(targetPath));
  if (!allowed) throw new AppError('采集接口不存在', 404);
  if (Number(request.headers['content-length'] || 0) > 2 * 1024 * 1024) throw new AppError('请求内容过大', 413);
  const headers: http.OutgoingHttpHeaders = {};
  for (const name of ['content-type', 'content-length', 'range', 'accept']) if (request.headers[name]) headers[name] = request.headers[name];
  await new Promise<void>(resolve => {
    const upstream = http.request(new URL(targetPath + url.search, base), { method: method === 'HEAD' ? 'GET' : method, headers }, incoming => {
      const outgoing: http.OutgoingHttpHeaders = { 'Cache-Control': 'no-store' };
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition']) if (incoming.headers[name]) outgoing[name] = incoming.headers[name];
      response.writeHead(incoming.statusCode || 502, outgoing);
      incoming.on('error', error => response.destroy(error));
      response.on('close', () => incoming.destroy());
      if (method === 'HEAD') { incoming.resume(); response.end(); }
      else incoming.pipe(response);
    });
    upstream.setTimeout(10 * 60 * 1000, () => upstream.destroy(new Error('采集请求超时')));
    upstream.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ok: false, message: '采集服务未响应，请使用一键启动脚本启动服务后重试' }));
      } else response.destroy();
      resolve();
    });
    response.on('finish', resolve);
    response.on('close', () => { upstream.destroy(); resolve(); });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
}
