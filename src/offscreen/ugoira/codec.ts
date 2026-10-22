// Encoder support probe and H.264 codec strings (design-offscreen-worker.md "Codec probe").

import { Quality, canEncodeVideo } from 'mediabunny';
import type { CodecCaps } from '../../shared/messages';

export const QUALITY = new Quality('very-high');

/** H.264 and VP9 4:2:0 need even dimensions and at least 2×2 pixels. */
export const MIN_SIDE_PX = 2;

const MACROBLOCK_PX = 16;

// High → Main → Constrained Baseline. mediabunny's own default is always High, but some software paths
// (OpenH264 without a hardware encoder) accept only Baseline.
const AVC_PROFILE_PREFIXES = ['avc1.6400', 'avc1.4D00', 'avc1.42E0'];

// [MaxFS in macroblocks, level_idc], smallest level first (H.264 Table A-1).
const AVC_LEVELS: ReadonlyArray<readonly [maxFrameMbs: number, levelIdc: number]> = [
  [1620, 0x1e], // 3.0
  [3600, 0x1f], // 3.1
  [5120, 0x20], // 3.2
  [8192, 0x28], // 4.0
  [8704, 0x2a], // 4.2
  [22080, 0x32], // 5.0
  [36864, 0x33], // 5.1
  [36864, 0x34], // 5.2
];

/** Floors to an even number: 601 → 600. */
export function even(n: number): number {
  return Math.floor(n / 2) * 2;
}

/**
 * H.264 codec strings to try for a frame size, best profile first, at the smallest level whose MaxFS
 * holds the frame. Empty when no level in the table does: such a size is reported as no H.264.
 */
export function avcCandidates(width: number, height: number): string[] {
  const frameMbs = Math.ceil(width / MACROBLOCK_PX) * Math.ceil(height / MACROBLOCK_PX);
  const level = AVC_LEVELS.find(([maxFrameMbs]) => frameMbs <= maxFrameMbs);
  if (!level) return [];
  const levelHex = level[1].toString(16).padStart(2, '0');
  return AVC_PROFILE_PREFIXES.map((prefix) => prefix + levelHex);
}

export async function probe(width: number, height: number): Promise<CodecCaps> {
  const w = even(width);
  const h = even(height);
  if (w < MIN_SIDE_PX || h < MIN_SIDE_PX) return { avc: null, vp9: false };
  let avc: string | null = null;
  for (const fullCodecString of avcCandidates(w, h)) {
    if (await canEncodeVideo('avc', { width: w, height: h, quality: QUALITY, fullCodecString })) {
      avc = fullCodecString;
      break;
    }
  }
  const vp9 = await canEncodeVideo('vp9', { width: w, height: h, quality: QUALITY });
  return { avc, vp9 };
}
