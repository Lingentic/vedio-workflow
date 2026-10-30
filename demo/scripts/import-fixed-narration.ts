import path from 'node:path';
import { Store } from '../lib/store.ts';
import { Media } from '../lib/media.ts';
import { Library } from '../lib/library.ts';
import { importFixedNarrationVisuals } from '../lib/fixed-narration-visuals.ts';

const [folder, root, ...extra] = process.argv.slice(2);
if (extra.length || !folder || !root || !path.isAbsolute(folder) || !path.isAbsolute(root)) throw new Error('用法：node demo/scripts/import-fixed-narration.ts <固定口播文件夹绝对路径> <数据根目录绝对路径>');
const store = new Store(root);
try {
  if (store.tasks().some(task => task.execution?.status === 'running') || store.assets().some(asset => asset.processing && ['queued', 'scanning', 'splitting', 'naming'].includes(asset.processing.stage))) throw new Error('数据目录有执行中的任务，请结束后再导入固定口播画面');
  const library = new Library(store, new Media(), () => false);
  const bindings = await importFixedNarrationVisuals(library, folder);
  console.log(JSON.stringify({ root: store.root, bindings }, null, 2));
} finally { store.close(); }
