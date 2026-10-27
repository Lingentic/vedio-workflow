import type { Cue, NodeTime, ScriptNode, WordTime } from './types.ts';

const numeral = '零一二三四五六七八九';
function chineseNumber(value: string): string {
  if (value.includes('.')) return value.split('.').map((part, i) => i ? [...part].map(char => numeral[Number(char)]).join('') : chineseNumber(part)).join('点');
  if (value.length > 8 || (value.length > 1 && value[0] === '0')) return [...value].map(char => numeral[Number(char)]).join('');
  const n = Number(value);
  if (n === 0) return '零';
  const small = (number: number): string => {
    let result = '', zero = false;
    for (let power = 3; power >= 0; power--) {
      const digit = Math.floor(number / 10 ** power) % 10;
      if (digit) { if (zero) result += '零'; result += numeral[digit] + ['','十','百','千'][power]; zero = false; }
      else if (result && number % 10 ** power) zero = true;
    }
    return result.replace(/^一十/, '十');
  };
  if (n < 10000) return small(n);
  return small(Math.floor(n / 10000)) + '万' + (n % 10000 ? (n % 10000 < 1000 ? '零' : '') + small(n % 10000) : '');
}

interface Character { char: string; start: number; end: number; word?: WordTime; }
function normalize(text: string): Character[] {
  const result: Character[] = [];
  for (const match of text.matchAll(/\d+(?:\.\d+)?|[\s\S]/gu)) {
    const start = match.index!, end = start + match[0].length;
    const value = /^\d/.test(match[0]) ? chineseNumber(match[0]) : match[0].normalize('NFKC').toLowerCase().replaceAll('两', '二').replaceAll('〇', '零');
    for (const char of value) if (!/[\p{P}\p{Z}\p{S}\s]/u.test(char)) result.push({ char, start, end });
  }
  return result;
}

export function alignAudio(text: string, nodes: ScriptNode[], words: WordTime[], duration: number): { cues: Cue[]; sentences: Cue[]; nodeTimes: NodeTime[] } {
  let prior = -1;
  const usable = words.filter(word => {
    if (typeof word.text !== 'string' || !Number.isFinite(word.begin_time) || !Number.isFinite(word.end_time) || word.begin_time < 0 || word.end_time <= word.begin_time || word.begin_time < prior - 1 || word.end_time > duration * 1000 + 200) throw new Error('配音时间戳无效，保留音频等待重试，不使用估算字幕');
    prior = word.begin_time;
    return normalize(word.text).length > 0;
  });
  const source = normalize(text);
  const spoken = usable.flatMap(word => normalize(word.text).map(character => ({ ...character, word })));
  if (!source.length || source.map(c => c.char).join('') !== spoken.map(c => c.char).join('')) throw new Error('配音返回文字与确认文案无法完整对应，音频已保留；请检查数字或发音后重新配音');
  const range = (start: number, end: number): { begin: number; end: number } => {
    const indices: number[] = [];
    source.forEach((char, index) => { if (char.end > start && char.start < end) indices.push(index); });
    if (!indices.length) throw new Error('字幕片段没有可对应的语音单元');
    return { begin: spoken[indices[0]].word.begin_time / 1000, end: Math.min(duration, spoken[indices.at(-1)!].word.end_time / 1000) };
  };
  const make = (sentence: boolean): Cue[] => {
    const result: Cue[] = [];
    // Decimal points belong to their number (6.90), not to a caption boundary.
    const boundaries = sentence ? /[。！？!?]+/gu : /(?:[，。！？、；：,!?;:]|(?<!\d)\.|\.(?!\d))+/gu;
    let from = 0;
    const ends = [...text.matchAll(boundaries)].map(match => match.index! + match[0].length);
    if (ends.at(-1) !== text.length) ends.push(text.length);
    for (const end of ends) {
      const piece = text.slice(from, end), start = from; from = end;
      if (!normalize(piece).length) continue;
      // A long natural phrase may wrap visually. Its time still uses whole returned words.
      const cue = { text: piece, ...range(start, end) };
      const previous = result.at(-1);
      // A provider word may span punctuation; retain that whole real time unit.
      if (previous && cue.begin < previous.end - .000001) { previous.text += cue.text; previous.end = Math.max(previous.end, cue.end); }
      else result.push(cue);
    }
    return result;
  };
  let offset = 0;
  const nodeTimes = nodes.map(node => {
    const from = offset; offset += node.text.length;
    return { id: node.id, ...range(from, offset) };
  });
  if (offset !== text.length) throw new Error('口播节点与配音文本不一致');
  return { cues: make(false), sentences: make(true), nodeTimes };
}
