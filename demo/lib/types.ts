export type NodeType = 'host_clip' | 'fixed_narration' | 'generated_narration';
export interface ScriptNode { id: string; type: NodeType; text: string; label?: string; }
export interface Template { id: string; name: string; title: string; summary: string; nodes: ScriptNode[]; variableNodeId?: string; }
export interface Product { productId: string; name: string; price: string; specification: string; sellingPoints: string; createdAt?: string; }
export interface Asset {
  id: string; productId?: string; kind: 'product' | 'source' | 'host' | 'presenter' | 'bgm';
  title: string; status: 'ready' | 'pending' | 'failed' | 'partial' | 'deleted' | 'unavailable';
  relativePath?: string; posterPath?: string; sourcePath?: string; sourceHash?: string;
  duration: number; width?: number; height?: number; hasAudio?: boolean; hasVideo?: boolean; size?: number;
  videoDuration?: number; videoStart?: number; videoFrames?: number;
  binding?: string; processed?: boolean; parentId?: string; error?: string;
  sourceRange?: { start: number; end: number };
  cuts?: number[]; outputs?: Record<string, string>; cleaned?: boolean; cleanupError?: string;
  url?: string; posterUrl?: string; available?: boolean; createdAt: string;
}
export interface WordTime { text: string; begin_time: number; end_time: number; begin_index?: number; end_index?: number; }
export interface Cue { text: string; begin: number; end: number; nodeId?: string; }
export interface NodeTime { id: string; begin: number; end: number; }
export interface Interval {
  id: string; nodeIds: string[]; text: string; signature: string;
  status: 'missing' | 'ready' | 'failed'; confirmed: boolean;
  relativePath?: string; audioUrl?: string; duration?: number; words?: WordTime[];
  cues?: Cue[]; sentences?: Cue[]; nodeTimes?: NodeTime[]; error?: string;
  requestId?: string; billedCharacters?: number; configuration?: string;
}
export interface QueueEntry { entryId: string; assetId: string; title: string; duration: number; url?: string; posterUrl?: string; available: boolean; }
export interface VisualEvent {
  mode: 'product' | 'host' | 'presenter'; start: number; duration: number;
  assetId?: string; sourceStart?: number; nodeId?: string; intervalId?: string;
}
export interface PicturePiece extends VisualEvent { productAssetId?: string; productStart?: number; }
export interface Plan {
  mode: 'auto' | 'manual'; entries: QueueEntry[]; requiredDuration: number; availableDuration: number;
  valid: boolean; repeated: boolean; warnings: string[]; events: VisualEvent[];
  pieces: PicturePiece[]; signature: string; duration: number;
}
export interface OutputSettings { subtitles: boolean; bgmId: string | null; bgmVolume: number; }
export interface PreviewInputs { settings: OutputSettings; planSignature: string; scriptSignature: string; audioSignature: string; }
export interface Preview { relativePath: string; duration: number; width: number; height: number; fps: number; size: number; signature: string; createdAt: string; inputs?: PreviewInputs; url?: string; }
export interface Execution { id: string; kind: 'copy' | 'voice' | 'render'; status: 'running' | 'done' | 'failed' | 'stopped' | 'interrupted'; progress: number; message: string; startedAt: string; finishedAt?: string; }
export interface Task {
  id: string; name: string; productId: string; templateId: string; productSnapshot: Product;
  templateSnapshot: Template; variable: string; example: string; black: Record<string, string>;
  nodes: ScriptNode[]; confirmedNodes?: ScriptNode[]; stage: 'copy' | 'voice' | 'visual' | 'preview';
  copyConfirmed: boolean; audioConfirmed: boolean; intervals: Interval[]; plan: Plan | null;
  settings: OutputSettings; preview: Preview | null; previewStale: boolean; completed: boolean;
  execution: Execution | null; error: string; notice?: string; createdAt: string; updatedAt: string;
  renderBase?: { relativePath: string; planSignature: string }; lightTimeline?: Cue[];
  cleanup?: { status: 'pending' | 'done' | 'failed'; error?: string; at?: string };
  snapshot?: Record<string, unknown>;
  previewChanges?: string[];
}
export interface MediaInfo { duration: number; width: number; height: number; fps: number; hasVideo: boolean; hasAudio: boolean; size: number; videoDuration?: number; videoStart?: number; videoFrames?: number; }

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
