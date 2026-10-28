import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from './store.ts';
import { Media, fileHash } from './media.ts';
import { AppError } from './types.ts';
import type { Asset, MediaInfo, Product } from './types.ts';
import { productFacts, signature } from './templates.ts';

export function validateProduct(input: unknown): Product {
  if (!input || typeof input !== 'object') throw new AppError('商品资料必须为对象');
  const value = input as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const field of ['productId', 'name', 'price', 'specification', 'sellingPoints']) {
    if (typeof value[field] !== 'string' || value[field].length > (field === 'sellingPoints' ? 12000 : 300)) throw new AppError(`商品字段 ${field} 格式不正确`);
    result[field] = value[field].trim();
  }
  if (!result.productId || !result.name) throw new AppError('商品ID和名称不能为空');
  return result as unknown as Product;
}

function assetMediaInfo(kind: Asset['kind'], info: MediaInfo): MediaInfo {
  if (kind !== 'product' && kind !== 'presenter') return info;
  if (!info.videoDuration) throw new Error('无法读取视频画面时长，请先转换成标准MP4');
  return { ...info, duration: info.videoDuration };
}

export class Library {
  store: Store; media: Media; isProtected: (id: string) => boolean;
  busy = false;
  message = '';
  constructor(store: Store, media: Media, isProtected: (id: string) => boolean) { this.store = store; this.media = media; this.isProtected = isProtected; }
  available(asset: Asset) { return asset.status === 'ready' && !!asset.relativePath && fs.existsSync(this.store.path(asset.relativePath)); }
  publicAsset(asset: Asset): Asset {
    const available = this.available(asset);
    const status = asset.status === 'ready' && !available && !asset.cleaned ? 'unavailable' : asset.status;
    return { ...asset, status, available, url: asset.relativePath ? `/media/asset/${asset.id}` : undefined, posterUrl: asset.posterPath ? `/poster/${asset.id}` : undefined };
  }
  ready(productId: string): Asset[] { return this.store.assets(productId).filter(asset => asset.kind === 'product' && this.available(asset)); }
  async importOne(source: string, productId?: string, kind: Asset['kind'] = 'product', binding?: string): Promise<Asset> {
    if (!path.isAbsolute(source)) throw new AppError('请选择本地视频文件的绝对路径');
    const id = Store.id();
    const relativeDir = kind === 'product' || kind === 'source' ? path.join('商品素材', 'product-' + signature(productId).slice(0, 16), id) : path.join('固定素材', id);
    const dir = this.store.path(relativeDir);
    const asset: Asset = { id, productId, kind, title: path.basename(source), status: 'pending', duration: 0, sourcePath: source, binding, processed: true, createdAt: new Date().toISOString() };
    this.store.putAsset(asset);
    try {
      const isImage = /\.(png|jpe?g|webp|avif|gif|bmp|tiff?)$/i.test(source);
      const info = isImage ? {} as MediaInfo : assetMediaInfo(kind, await this.media.probe(source));
      if (!isImage && kind !== 'bgm' && !info.hasVideo) throw new Error('所选文件没有可用视频画面');
      if (!isImage && kind === 'host' && !info.hasAudio) throw new Error('主播原片没有原声音轨');
      if (!isImage && kind === 'bgm' && !info.hasAudio) throw new Error('配乐文件没有声音');
      await fsp.mkdir(dir, { recursive: true });
      const ext = path.extname(source).toLowerCase();
      const target = path.join(dir, 'original' + ext);
      await fsp.copyFile(source, target + '.part', fs.constants.COPYFILE_EXCL);
      const hash = await fileHash(source);
      if (await fileHash(target + '.part') !== hash) throw new Error('素材复制校验失败，原文件未改变');
      await fsp.rename(target + '.part', target);
      Object.assign(asset, info, { sourceHash: hash, relativePath: path.relative(this.store.root, target), status: 'ready' });
      this.store.putAsset(asset);
      if (info.hasVideo) {
        try {
          const poster = this.store.path(path.join('缓存', `${id}.jpg`));
          await this.media.poster(target, poster);
          asset.posterPath = path.relative(this.store.root, poster);
        } catch (error) { asset.error = `视频已入库，缩略图生成失败：${(error as Error).message}`; }
      }
    } catch (error) { asset.status = 'failed'; asset.error = (error as Error).message; }
    return this.store.putAsset(asset);
  }
  async importFiles(productId: string, files: string[], processed: boolean) {
    if (!this.store.product(productId)) throw new AppError('商品不存在', 404);
    if (this.busy) throw new AppError('正在导入素材，请等待当前批次完成', 409);
    this.busy = true;
    const results: Asset[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        this.message = `正在处理第 ${i + 1}/${files.length} 个文件`;
        const asset = await this.importOne(files[i], productId, processed ? 'product' : 'source');
        asset.processed = processed; this.store.putAsset(asset);
        if (!processed && asset.status === 'ready' && asset.hasVideo) await this.split(asset);
        results.push(this.store.asset(asset.id)!);
      }
      return results;
    } finally { this.busy = false; this.message = ''; }
  }
  async split(source: Asset) {
    if (!source.relativePath) throw new AppError('原视频尚未可靠保存');
    const input = this.store.path(source.relativePath), dir = path.dirname(input);
    source.status = 'pending'; this.store.putAsset(source);
    try {
      if (!source.cuts) {
        await this.media.ff(['-i', input, '-an', '-vf', 'scdet=t=10,metadata=mode=print:file=scenes.txt', '-f', 'null', '-'], { cwd: dir });
        const info = await fsp.readFile(path.join(dir, 'scenes.txt'), 'utf8');
        const changes = [...info.matchAll(/lavfi\.scd\.time=([\d.]+)/g)].map(match => Number(match[1]));
        const cuts = [0];
        for (const at of changes) if (at - cuts.at(-1)! >= 1 && source.duration - at >= 1) cuts.push(at);
        cuts.push(source.duration); source.cuts = cuts; source.outputs = {}; this.store.putAsset(source);
      }
      for (let i = 0; i < source.cuts.length - 1; i++) {
        const key = `${source.cuts[i]}:${source.cuts[i + 1]}`;
        const oldId = source.outputs?.[key];
        const old = oldId ? this.store.asset(oldId) : null;
        if (old?.status === 'ready' || old?.status === 'deleted') continue;
        const temp = path.join(dir, `cut-${i}-${Store.id()}.mp4`);
        await this.media.ff(['-n', '-ss', String(source.cuts[i]), '-i', input, '-t', String(source.cuts[i + 1] - source.cuts[i]), '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', temp]);
        const child = await this.importOne(temp, source.productId);
        if (child.status !== 'ready') throw new Error(child.error || '片段入库失败');
        child.title = `${path.parse(source.title).name} · 片段 ${i + 1}`; child.sourcePath = source.sourcePath; child.parentId = source.id; child.sourceRange = { start: source.cuts[i], end: source.cuts[i+1] };
        this.store.putAsset(child); source.outputs![key] = child.id; this.store.putAsset(source);
        await fsp.unlink(temp);
      }
      source.status = 'ready'; source.error = '';
      this.store.putAsset(source);
      try { await fsp.unlink(input); source.cleaned = true; } catch (error) { source.cleanupError = (error as Error).message; }
    } catch (error) { source.status = source.outputs && Object.keys(source.outputs).length ? 'partial' : 'failed'; source.error = (error as Error).message; }
    this.store.putAsset(source);
  }
  async retry(id: string): Promise<Asset> {
    const asset = this.store.asset(id);
    if (!asset || asset.status === 'deleted') throw new AppError('该素材不存在或已删除', 404);
    if (this.busy) throw new AppError('正在导入其他素材，请稍后重试', 409);
    this.busy = true;
    try {
    if (asset.kind === 'source' && asset.relativePath && fs.existsSync(this.store.path(asset.relativePath))) { await this.split(asset); return this.store.asset(id)!; }
    if (asset.relativePath && fs.existsSync(this.store.path(asset.relativePath))) {
      Object.assign(asset, assetMediaInfo(asset.kind, await this.media.probe(this.store.path(asset.relativePath))), { status: 'ready', error: '' });
      return this.store.putAsset(asset);
    }
    if (!asset.sourcePath) throw new AppError('请重新提供本地来源文件');
    let input = asset.sourcePath;
    let temporary: string | undefined;
    if (asset.parentId) {
      if (!asset.sourceRange) throw new AppError('缺少原切分范围，请重新导入该片段');
      const parent = this.store.asset(asset.parentId);
      const original = parent?.relativePath && fs.existsSync(this.store.path(parent.relativePath)) ? this.store.path(parent.relativePath) : asset.sourcePath;
      temporary = this.store.path(path.join('缓存', `retry-${Store.id()}.mp4`));
      await this.media.ff(['-n', '-ss', String(asset.sourceRange.start), '-i', original, '-t', String(asset.sourceRange.end - asset.sourceRange.start), '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-c:a', 'aac', temporary]);
      input = temporary;
    }
    const replacement = await this.importOne(input, asset.productId, asset.kind, asset.binding);
    // Keep the failed entry identity so drafts and the retry row continue referring to it.
    const newId = replacement.id;
    Object.assign(asset, replacement, { id, sourcePath: asset.sourcePath }); this.store.putAsset(asset);
    this.store.db.prepare('DELETE FROM assets WHERE id=?').run(newId);
    if (temporary && fs.existsSync(temporary)) await fsp.unlink(temporary);
    if (asset.kind === 'source' && asset.status === 'ready') await this.split(asset);
    return this.store.asset(id)!;
    } finally { this.busy = false; this.message = ''; }
  }
  async remove(id: string) {
    const asset = this.store.asset(id);
    if (!asset || asset.kind !== 'product') throw new AppError('只能删除商品的独立视频片段');
    if (this.isProtected(id)) throw new AppError('该片段正在用于生成视频，请完成后再删除', 409);
    asset.status = 'deleted'; this.store.putAsset(asset);
    for (const relative of [asset.relativePath, asset.posterPath].filter((value): value is string => !!value)) {
      const target = this.store.path(relative);
      if (!fs.existsSync(target)) continue;
      try { await fsp.unlink(target); } catch (error) { asset.cleanupError = (error as Error).message; }
    }
    return this.store.putAsset(asset);
  }
}

const originalRoot = () => path.join(os.homedir(), 'Desktop', 'mvp用');
export function seedAvailable() { return fs.existsSync(originalRoot()); }
async function videosUnder(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const item of await fsp.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, item.name);
    if (item.isDirectory()) result.push(...await videosUnder(file));
    else if (/\.mp4$/i.test(item.name) && !/^案例/.test(item.name)) result.push(file);
  }
  return result;
}
export async function seedLibrary(library: Library, seedRoot = originalRoot()) {
  if (library.busy) throw new AppError('素材正在处理中，请稍后再试', 409);
  const roots = [path.join(seedRoot, '鞋垫素材', '鞋垫素材'), path.join(seedRoot, '拉链素材', '拉链素材')];
  if (!roots.every(root => fs.existsSync(root))) throw new AppError('未找到用户提供的鞋垫、拉链素材目录；请在素材库手动导入');
  for (let i = 0; i < roots.length; i++) {
    const product = productFacts[i];
    if (!library.store.product(product.productId)) library.store.putProduct({ ...product, createdAt: new Date().toISOString() });
    const existing = new Set(library.store.assets(product.productId).map(asset => asset.sourcePath));
    const files = (await videosUnder(path.join(roots[i], '产品素材'))).filter(file => !existing.has(file));
    if (files.length) await library.importFiles(product.productId, files, true);
  }
  const bindings: [number, string, Asset['kind'], string][] = [
    [0, '今天太原老葛给你们送个礼物来，整个互联网复购第一名.mp4', 'host', 't1-r1'],
    [0, '不用担心我赔钱，没有关系，需要你就拍.mp4', 'host', 't1-r2'],
    [0, '推荐给所有人，必须拍一单.mp4', 'host', 't1-r3'],
    [0, '拼好手速再加最后1万.mp4', 'host', 't1-r4'],
    [0, '就只有这一次了，最过3秒钟.mp4', 'host', 't1-r5'],
    [1, '不担心赔钱，需要就拍-1_用过就太好用了-1.mp4', 'host', 't2-r1'],
    [1, '这价格是真的买不到，我今天这个价格只有这一次.mp4', 'host', 't2-r2'],
    [1, '我今天就给你们上了，纯纯的捡漏.mp4', 'host', 't2-r3'],
    [1, '以后再要，这个价格可真上不了了，真没有了.mp4', 'host', 't2-r4'],
    [0, '老葛真实宠粉宠到家了.mp4', 'presenter', 't1-b1'],
    [0, '原本和厂商谈好卖[自定义文本]的.mp4', 'presenter', 't1-b2'],
    [0, '想趁便宜多屯一点,老哥听完瞬间感动哭了.mp4', 'presenter', 't1-b3'],
    [1, '1.mp4', 'presenter', 't2-b1'], [1, '99.mp4', 'presenter', 't2-b2'],
  ];
  library.busy = true;
  try {
    for (const [rootIndex, file, kind, binding] of bindings) {
      if (library.store.assets().some(asset => asset.binding === binding && asset.status === 'ready')) continue;
      library.message = `正在导入固定画面 ${binding}`;
      await library.importOne(path.join(roots[rootIndex], '老葛素材', ...(kind === 'host' ? ['5s'] : []), file), undefined, kind, binding);
    }
    for (const file of ['Carefree.mp3', 'Carefree-10s-48k.wav']) {
      const bgm = path.resolve(import.meta.dirname, '../../../video-agent/experiments/ecommerce-bgm-swap-20261013/assets', file);
      if (fs.existsSync(bgm) && !library.store.assets().some(asset => asset.kind === 'bgm' && asset.sourcePath === bgm)) await library.importOne(bgm, undefined, 'bgm');
    }
  } finally { library.busy = false; library.message = ''; }
  library.store.setting('seededAt', new Date().toISOString());
}
