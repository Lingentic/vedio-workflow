import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

export const appRoot = path.resolve(import.meta.dirname, '..');
export const profileDir = process.env.DEMO_PROFILE_DIR || path.join(appRoot, '.local');
export const profileFile = path.join(profileDir, 'settings.json');

export interface Profile { dataRoot?: string; seedRoot?: string; credentialsFile?: string; namingCredentialsFile?: string; namingModel?: string; namingBaseUrl?: string; ffmpeg?: string; ffprobe?: string; }

export function videosDirectory() {
  if (process.platform === 'win32') {
    const folder = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); [Environment]::GetFolderPath('MyVideos')"], { encoding: 'utf8', windowsHide: true }).trim();
    if (folder) return folder;
  }
  return path.join(os.homedir(), 'Videos');
}

export function defaultDataRoot() {
  return path.join(videosDirectory(), '电商视频工作台Demo');
}

export function loadProfile(): Profile {
  if (!fs.existsSync(profileFile)) return {};
  return JSON.parse(fs.readFileSync(profileFile, 'utf8'));
}

export function saveProfile(value: Profile) {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(profileFile + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(profileFile + '.tmp', profileFile);
}

export function inside(root: string, candidate: string) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}

export function managedPath(root: string, relative: string) {
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('文件位置超出当前数据目录');
  return target;
}

export function nativeDialog(kind: 'folder' | 'videos'): Promise<string[]> {
  if (process.platform !== 'win32') throw new Error('当前系统请直接填写本地文件夹或文件路径');
  const script = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; ${kind === 'folder'
    ? "$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='选择数据或导出文件夹'; $d.ShowNewFolderButton=$true; if ($d.ShowDialog() -eq 'OK') { ConvertTo-Json -InputObject @($d.SelectedPath) -Compress } else { '[]' }"
    : "$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title='选择商品视频'; $d.Multiselect=$true; $d.Filter='视频文件|*.mp4;*.mov;*.webm;*.mkv'; if ($d.ShowDialog() -eq 'OK') { ConvertTo-Json -InputObject @($d.FileNames) -Compress } else { '[]' }"}`;
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
    let out = '', err = '';
    proc.stdout.setEncoding('utf8').on('data', data => { out += data; });
    proc.stderr.setEncoding('utf8').on('data', data => { err += data; });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error('无法打开系统选择窗口：' + err.slice(-300)));
      try { resolve(JSON.parse(out.trim() || '[]')); } catch (error) { reject(error); }
    });
  });
}
