// Ugoira frame timing (design-offscreen-worker.md "Ugoira encode", Timeline row): frame i starts at
// Σ delay₀…delayᵢ₋₁ and lasts delayᵢ. Values are integer microseconds, so nothing drifts.

import type { OffEncodeCommand } from '../../shared/messages';

export type UgoiraFrames = OffEncodeCommand['frames'];

export interface TimedFrame {
  file: string;
  timestampUs: number;
  durationUs: number;
}

export interface Timeline {
  frames: TimedFrame[];
  totalUs: number;
}

const US_PER_MS = 1000;

/** Non-empty; every `file` is a non-empty string and every `delay` an integer number of ms ≥ 1. */
export function isValidFrames(frames: unknown): frames is UgoiraFrames {
  return (
    Array.isArray(frames) &&
    frames.length > 0 &&
    frames.every((frame: unknown) => {
      if (typeof frame !== 'object' || frame === null) return false;
      const { file, delay } = frame as { file?: unknown; delay?: unknown };
      return (
        typeof file === 'string' && file.length > 0 && Number.isInteger(delay) && Number(delay) >= 1
      );
    })
  );
}

export function buildTimeline(frames: UgoiraFrames): Timeline {
  const timed: TimedFrame[] = [];
  let totalUs = 0;
  for (const { file, delay } of frames) {
    const durationUs = delay * US_PER_MS;
    timed.push({ file, timestampUs: totalUs, durationUs });
    totalUs += durationUs;
  }
  return { frames: timed, totalUs };
}
