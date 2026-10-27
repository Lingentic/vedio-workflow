import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length && (args[0] !== '--tool-root' || args.length !== 2)) {
  console.error('Usage: node scripts/check-types.mjs [--tool-root <temporary tooling directory>]'); process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tools = path.resolve(args[1] || process.env.HARNESS_TOOL_ROOT || path.join(os.tmpdir(), 'vedio-workflow-agent-tools'));
const compiler = path.join(tools, 'node_modules/typescript/bin/tsc');
const types = path.join(tools, 'node_modules/@types');
if (!fs.existsSync(compiler) || !fs.existsSync(path.join(types, 'node/package.json'))) {
  console.error('Type tooling is missing. This command never installs packages automatically.');
  console.error(`Run: npm install --prefix "${tools}" --no-save --package-lock=false typescript@5 @types/node@24`);
  process.exit(1);
}
const result = spawnSync(process.execPath, [compiler, '--project', path.join(root, 'demo/tsconfig.json'), '--typeRoots', types], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
