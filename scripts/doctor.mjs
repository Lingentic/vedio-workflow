import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--json')) {
  console.error('Usage: node scripts/doctor.mjs [--json]'); process.exit(2);
}
const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });
record('Node.js', Number(process.versions.node.split('.')[0]) >= 24, process.versions.node);
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || (path.isAbsolute(ffmpeg) ? path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : 'ffprobe');
const run = (program, flags) => spawnSync(program, flags, { encoding: 'utf8', windowsHide: true, timeout: 8000, maxBuffer: 2_000_000 });
for (const [name, program] of [['FFmpeg', ffmpeg], ['FFprobe', ffprobe]]) {
  const result = run(program, ['-version']);
  record(name, !result.error && result.status === 0, result.error ? result.error.code : (result.stdout || result.stderr).split(/\r?\n/)[0]);
}
const encoders = run(ffmpeg, ['-hide_banner', '-encoders']);
record('H.264 encoder', !encoders.error && encoders.status === 0 && /\blibx264\b/.test(encoders.stdout), 'requires libx264');
const filters = run(ffmpeg, ['-hide_banner', '-filters']);
record('ASS subtitles', !filters.error && filters.status === 0 && /^\s*\S+\s+ass\s/m.test(filters.stdout), 'requires ass filter');
if (process.platform === 'win32') {
  const ps = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']);
  record('Windows PowerShell', !ps.error && ps.status === 0, ps.error ? ps.error.code : ps.stdout.trim());
}
const report = { ok: results.every(item => item.ok), checks: results, scope: 'Read-only tool checks. No server, account, user data, model request or package install.' };
if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`);
  console.log(report.scope);
  if (!report.ok) console.log('Install/configure missing tools, then rerun. FFMPEG_PATH and FFPROBE_PATH override PATH; local app settings are not read.');
}
if (!report.ok) process.exitCode = 1;
