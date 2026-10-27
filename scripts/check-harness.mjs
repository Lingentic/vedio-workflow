import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [], visited = new Set(), queue = ['AGENTS.md', 'README.md'];
let linkCount = 0;
while (queue.length) {
  const file = queue.shift();
  if (visited.has(file)) continue;
  if (!fs.existsSync(path.join(root, file))) { problems.push(`Missing entry document: ${file}`); continue; }
  visited.add(file);
  const markdown = fs.readFileSync(path.join(root, file), 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:|^#/i.test(url)) continue;
    linkCount++;
    const target = path.resolve(root, path.dirname(file), decodeURIComponent(url.split('#')[0]));
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) { problems.push(`${file}: link escapes repo: ${url}`); continue; }
    if (!fs.existsSync(target)) { problems.push(`${file}: missing link target: ${url}`); continue; }
    if (target.endsWith('.md') && fs.statSync(target).isFile()) queue.push(relative.replaceAll(path.sep, '/'));
  }
}
console.log(JSON.stringify({ ok: problems.length === 0, documents: visited.size, relativeLinks: linkCount, problems, scope: 'Local navigation only; external URLs and live services are not requested.' }, null, 2));
if (problems.length) process.exitCode = 1;
