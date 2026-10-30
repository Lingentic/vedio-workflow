export interface SceneEvent { timeSec: number; score: number; }
export interface CutParameters { threshold: number; minDurationSec: number; }
export interface Shot { id: string; index: number; startSec: number; endSec: number; durationSec: number; }
export interface RejectedCut extends SceneEvent { reason: 'threshold' | 'minimum' | 'tail'; }

/** Same chronological minimum-duration filter as the client's planShots, before naming/export. */
export function planShots(events: SceneEvent[], duration: number, parameters: CutParameters) {
  const accepted: number[] = [], rejected: RejectedCut[] = [];
  for (const event of [...events].sort((a, b) => a.timeSec - b.timeSec)) {
    if (event.timeSec <= 0 || event.timeSec >= duration) continue;
    if (event.score < parameters.threshold) { rejected.push({ ...event, reason: 'threshold' }); continue; }
    const previous = accepted.at(-1) ?? 0;
    if (event.timeSec - previous + 1e-8 < parameters.minDurationSec) {
      rejected.push({ ...event, reason: 'minimum' }); continue;
    }
    if (duration - event.timeSec + 1e-8 < parameters.minDurationSec) {
      rejected.push({ ...event, reason: 'tail' }); continue;
    }
    accepted.push(event.timeSec);
  }
  const boundaries = [0, ...accepted, duration];
  const shots: Shot[] = boundaries.slice(0, -1).map((startSec, i) => ({
    id: `shot_${String(i + 1).padStart(3, '0')}`, index: i + 1,
    startSec, endSec: boundaries[i + 1], durationSec: boundaries[i + 1] - startSec,
  }));
  return { shots, rejected };
}
