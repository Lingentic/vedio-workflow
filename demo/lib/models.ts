import fs from 'node:fs';
import path from 'node:path';
import type { Profile } from './paths.ts';
import { copyPrompt, validateGenerated, voiceConfig } from './templates.ts';
import { repairWav } from './media.ts';
import type { ScriptNode, WordTime } from './types.ts';

interface ProviderEvent { code?: string; message?: string; request_id?: string; usage?: { characters?: number }; output?: { type?: string; finish_reason?: string; audio?: { data?: string; url?: string }; sentence?: { words?: WordTime[] } }; }
export class Models {
  key: string;
  constructor(profile: Profile) {
    const envFile = profile.credentialsFile || path.resolve(import.meta.dirname, '../../../video-agent/Kling-H3路线B-Electron交付包-20260904/module/.env');
    const env = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
    const value = (name: string) => env.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`, 'm'))?.[1]?.replace(/^(['"])(.*)\1$/, '$2') || '';
    this.key = process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || value('DASHSCOPE_API_KEY') || value('BAILIAN_API_KEY');
  }
  ready() { return !!this.key; }
  safe(text: string) { return (this.key ? text.replaceAll(this.key, '[密钥已隐藏]') : text).replace(/https?:\/\/\S+/g, '[服务地址]'); }
  async copy(nodes: ScriptNode[], sellingPoints: string, example: string) {
    if (!this.key) throw new Error('未找到阿里云调用配置，请检查本机服务配置');
    const count = (text: string) => [...text].length;
    const fixed = nodes.filter(node => node.type !== 'generated_narration').reduce((sum, node) => sum + count(node.text), 0);
    const budget = example.trim() ? `有范例，整篇参考约 ${count(example)} 字；固定内容 ${fixed} 字，待生成内容围绕剩余篇幅安排。` : `无范例，整篇目标190～410字，固定内容 ${fixed} 字，待生成总预算约 ${Math.max(0,190-fixed)}～${Math.max(0,410-fixed)} 字。`;
    const prompt = copyPrompt.replace('{{template_nodes}}', JSON.stringify(nodes, null, 2)).replace('{{selling_points}}', sellingPoints).replace('{{reference_example}}', example || '（未提供）').replace('{{固定内容总字数及待生成内容的总字数预算}}', budget);
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(180000),
      body: JSON.stringify({ model: 'qwen3.7-plus', enable_thinking: false, response_format: { type: 'json_object' }, temperature: 0.8, messages: [{ role: 'user', content: prompt }] }),
    });
    const payload = await response.json() as { code?: string; message?: string; error?: { message?: string }; choices?: { message?: { content?: string } }[]; usage?: unknown; id?: string };
    if (!response.ok || payload.code || payload.error) throw new Error(this.safe(`文案生成失败（HTTP ${response.status}）：${payload.message || payload.error?.message || payload.code || '未知错误'}`));
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('模型没有返回文案正文，原稿已保留');
    return { black: validateGenerated(nodes, JSON.parse(content)), usage: payload.usage, requestId: payload.id || response.headers.get('x-request-id') || '' };
  }
  async voice(text: string): Promise<{ audio: Buffer; words: WordTime[]; requestId: string; billedCharacters?: number }> {
    if (!this.key) throw new Error('未找到阿里云调用配置，请检查本机服务配置');
    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer', {
      method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', 'X-DashScope-SSE': 'enable' },
      signal: AbortSignal.timeout(180000), body: JSON.stringify({ ...voiceConfig, input: { ...voiceConfig.input, text } }),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error(this.safe(`配音请求失败（HTTP ${response.status}）：${(await response.text()).slice(0,500)}`));
    const chunks: Buffer[] = [], words: WordTime[] = [];
    let completed = false, audioUrl = '', requestId = '', billedCharacters: number | undefined;
    let pending = '';
    const decoder = new TextDecoder();
    const frame = (block: string) => {
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') return;
      const event = JSON.parse(data) as ProviderEvent;
      if (event.code) throw new Error(this.safe(`配音服务拒绝：${event.code} ${event.message || ''}`));
      if (event.output?.audio?.data) chunks.push(Buffer.from(event.output.audio.data, 'base64'));
      if (event.output?.audio?.url) audioUrl = event.output.audio.url;
      if (event.output?.type === 'sentence-end') {
        if (!Array.isArray(event.output.sentence?.words)) throw new Error('配音服务缺少字级时间记录');
        words.push(...event.output.sentence.words);
      }
      if (event.output?.finish_reason === 'stop') completed = true;
      if (event.request_id) requestId = event.request_id;
      if (event.usage?.characters !== undefined) billedCharacters = event.usage.characters;
    };
    for await (const chunk of response.body!) {
      pending += decoder.decode(chunk, { stream: true }); pending = pending.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = pending.indexOf('\n\n')) >= 0) { frame(pending.slice(0, end)); pending = pending.slice(end + 2); }
    }
    pending += decoder.decode(); if (pending.trim()) frame(pending);
    if (!completed) throw new Error('配音连接提前结束，结果不确定；没有自动重发，请确认后手动重试');
    let raw: Buffer;
    if (chunks.length) raw = Buffer.concat(chunks);
    else if (audioUrl) {
      const url = new URL(audioUrl);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.aliyuncs.com')) throw new Error('配音返回了不受支持的结果地址');
      const download = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!download.ok) throw new Error('配音已完成，但音频下载失败，请检查网络');
      raw = Buffer.from(await download.arrayBuffer());
    } else throw new Error('配音服务没有返回音频');
    return { audio: repairWav(raw), words, requestId, billedCharacters };
  }
}
