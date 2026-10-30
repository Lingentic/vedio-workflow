import fs from 'node:fs';
import path from 'node:path';
import { fileHash } from './media.ts';
import { AppError } from './types.ts';
import type { FixedNarrationVisual } from './types.ts';
import type { Library } from './library.ts';

interface Definition {
  nodeId: string; templateId: string; matchedText: string; placement: 'start' | 'end';
  fileName: string | null; sha256?: string;
}
export const fixedNarrationDefinitions: Definition[] = JSON.parse(fs.readFileSync(new URL('../data/fixed-narration-visuals.json', import.meta.url), 'utf8'));

export function fixedNarrationVisuals(library: Library): FixedNarrationVisual[] {
  const assets = library.store.assets();
  return fixedNarrationDefinitions.map(definition => {
    const asset = definition.fileName ? assets.find(item => item.kind === 'presenter' && item.binding === definition.nodeId && item.sourceHash === definition.sha256 && library.available(item)) : undefined;
    return { nodeId: definition.nodeId, matchedText: definition.matchedText, placement: definition.placement,
      assetId: asset?.id || null, duration: asset?.duration || 0,
      status: asset ? 'ready' : definition.fileName ? 'missing' : 'unassigned' };
  });
}

export async function importFixedNarrationVisuals(library: Library, sourceFolder: string): Promise<FixedNarrationVisual[]> {
  if (!path.isAbsolute(sourceFolder) || !fs.statSync(sourceFolder).isDirectory()) throw new AppError('请选择固定口播画面文件夹的绝对路径');
  const definitions = fixedNarrationDefinitions.filter((definition): definition is Definition & { fileName: string; sha256: string } => !!definition.fileName);
  for (const definition of definitions) {
    const file = path.join(sourceFolder, definition.fileName);
    if (await fileHash(file) !== definition.sha256) throw new AppError(`固定口播画面与已核对版本不一致：${definition.fileName}`);
  }
  for (const definition of definitions) {
    const current = library.store.assets().find(asset => asset.kind === 'presenter' && asset.binding === definition.nodeId && asset.sourceHash === definition.sha256 && library.available(asset));
    if (current) continue;
    const asset = await library.importOne(path.join(sourceFolder, definition.fileName), undefined, 'presenter', definition.nodeId);
    if (asset.status !== 'ready') throw new AppError(`固定口播画面导入失败：${asset.title}：${asset.error}`);
  }
  return fixedNarrationVisuals(library);
}
