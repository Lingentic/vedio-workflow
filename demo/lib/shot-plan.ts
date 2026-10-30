import { AppError } from './types.ts';
import type { MaterialProcessingSettings } from './types.ts';

export const DEFAULT_PROCESSING_SETTINGS: Readonly<MaterialProcessingSettings> = { threshold: 15.2, minDurationSec: 1.9 };
export interface FixedShot { shotId: string; startSec: number; endSec: number; durationSec: number; }
export interface SceneCut { timeSec: number; score: number; }

export function validateProcessingSettings(value: unknown): MaterialProcessingSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('切分设置格式错误');
  const { threshold, minDurationSec } = value as Record<string, unknown>;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0.1 || threshold > 100) throw new AppError('变化分数阈值需要在 0.1～100 之间');
  if (typeof minDurationSec !== 'number' || !Number.isFinite(minDurationSec) || minDurationSec < 0.1 || minDurationSec > 10) throw new AppError('最短片段需要在 0.1～10 秒之间');
  return { threshold, minDurationSec };
}

/** Port of the existing client's chronological cut filter, verified in the split lab. */
export function planFixedShots(events: SceneCut[], duration: number, settings: MaterialProcessingSettings): FixedShot[] {
  const boundaries = [0];
  for (const event of [...events].sort((a, b) => a.timeSec - b.timeSec)) {
    if (event.score < settings.threshold || event.timeSec <= 0 || event.timeSec >= duration) continue;
    if (event.timeSec - boundaries.at(-1)! + 1e-8 < settings.minDurationSec || duration - event.timeSec + 1e-8 < settings.minDurationSec) continue;
    boundaries.push(event.timeSec);
  }
  boundaries.push(duration);
  return boundaries.slice(0, -1).map((startSec, i) => ({ shotId: `shot_${String(i + 1).padStart(3, '0')}`, startSec, endSec: boundaries[i + 1], durationSec: boundaries[i + 1] - startSec }));
}

export function savedShots(cuts: number[]): FixedShot[] {
  return cuts.slice(0, -1).map((startSec, i) => ({ shotId: `shot_${String(i + 1).padStart(3, '0')}`, startSec, endSec: cuts[i + 1], durationSec: cuts[i + 1] - startSec }));
}
