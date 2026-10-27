import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { Product, ScriptNode, Task, Template, Interval } from './types.ts';
import { AppError } from './types.ts';

export const templates: Template[] = JSON.parse(fs.readFileSync(new URL('../data/templates.json', import.meta.url), 'utf8'));
export const productFacts: Product[] = JSON.parse(fs.readFileSync(new URL('../data/product-facts.json', import.meta.url), 'utf8'));
export const copyPrompt = fs.readFileSync(new URL('../data/copy-prompt.txt', import.meta.url), 'utf8');
export const voiceConfig: { model: string; input: Record<string, unknown> } = JSON.parse(fs.readFileSync(new URL('../data/voice-config.json', import.meta.url), 'utf8'));
export const signature = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const voiceSignature = signature(voiceConfig);

export function templateById(id: string): Template {
  const template = templates.find(item => item.id === id);
  if (!template) throw new AppError('固定模板不存在', 404);
  return structuredClone(template);
}

export function assembledNodes(task: Pick<Task, 'templateSnapshot' | 'variable' | 'black'>): ScriptNode[] {
  return task.templateSnapshot.nodes.map(node => ({ ...node, text: node.type === 'generated_narration'
    ? task.black[node.id] || '' : node.id === task.templateSnapshot.variableNodeId ? `原本和厂家谈好卖${task.variable}的，` : node.text }));
}

export function intervalsFromNodes(nodes: ScriptNode[]): Interval[] {
  const result: Interval[] = [];
  let current: Interval | null = null;
  for (const node of nodes) {
    if (node.type === 'host_clip') { current = null; continue; }
    if (!current) {
      current = { id: `ai-${result.length + 1}`, nodeIds: [], text: '', signature: '', status: 'missing', confirmed: false };
      result.push(current);
    }
    current.nodeIds.push(node.id); current.text += node.text;
  }
  return result.map(interval => ({ ...interval, signature: signature({ text: interval.text, configuration: voiceSignature }) }));
}

export function validateGenerated(nodes: ScriptNode[], value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || !('generated_nodes' in value) || !Array.isArray(value.generated_nodes)) throw new AppError('文案模型返回格式错误，请重试');
  const expected = nodes.filter(node => node.type === 'generated_narration').map(node => node.id);
  const result: Record<string, string> = {};
  if (value.generated_nodes.length !== expected.length) throw new AppError('文案模型返回的待填节点数量不正确');
  value.generated_nodes.forEach((row: unknown, i: number) => {
    if (!row || typeof row !== 'object' || !('id' in row) || !('text' in row) || row.id !== expected[i] || typeof row.text !== 'string' || !row.text.trim() || Object.keys(row).some(key => !['id', 'text'].includes(key))) throw new AppError('文案节点ID、顺序或文字不符合约定，原稿已保留');
    result[expected[i]] = row.text;
  });
  return result;
}
