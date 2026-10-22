import { describe, expect, it } from 'vitest';
import { buildTimeline, isValidFrames } from '../../../src/offscreen/ugoira/timeline';

const MIXED = [
  { file: '000000.jpg', delay: 40 },
  { file: '000001.jpg', delay: 40 },
  { file: '000002.jpg', delay: 500 },
  { file: '000003.jpg', delay: 40 },
];

describe('buildTimeline', () => {
  it('buildTimeline: frame i starts at the sum of the earlier delays (40/40/500/40 → 0/40/80/580 ms)', () => {
    expect(buildTimeline(MIXED).frames.map((f) => f.timestampUs)).toEqual([
      0, 40_000, 80_000, 580_000,
    ]);
  });

  it('buildTimeline: each frame lasts its own delay', () => {
    expect(buildTimeline(MIXED).frames.map((f) => f.durationUs)).toEqual([
      40_000, 40_000, 500_000, 40_000,
    ]);
  });

  it('buildTimeline: total is the sum of all delays (620 ms)', () => {
    expect(buildTimeline(MIXED).totalUs).toBe(620_000);
  });

  it('buildTimeline: every timestamp and duration is an integer number of µs', () => {
    const { frames } = buildTimeline([
      { file: 'a.jpg', delay: 33 },
      { file: 'b.jpg', delay: 17 },
      { file: 'c.jpg', delay: 1 },
    ]);
    expect(frames.flatMap((f) => [f.timestampUs, f.durationUs]).every(Number.isInteger)).toBe(true);
  });

  it('buildTimeline: keeps the frame order and file names of frames.json', () => {
    expect(buildTimeline(MIXED).frames.map((f) => f.file)).toEqual(MIXED.map((f) => f.file));
  });
});

describe('isValidFrames', () => {
  it('isValidFrames: accepts frames with names and integer delays ≥ 1', () => {
    expect(isValidFrames(MIXED)).toBe(true);
  });

  it('isValidFrames: rejects an empty list', () => {
    expect(isValidFrames([])).toBe(false);
  });

  it('isValidFrames: rejects a non-array', () => {
    expect(isValidFrames({ file: 'a.jpg', delay: 40 })).toBe(false);
  });

  it.each([
    ['zero delay', { file: 'a.jpg', delay: 0 }],
    ['negative delay', { file: 'a.jpg', delay: -40 }],
    ['fractional delay', { file: 'a.jpg', delay: 40.5 }],
    ['string delay', { file: 'a.jpg', delay: '40' }],
    ['NaN delay', { file: 'a.jpg', delay: Number.NaN }],
    ['missing delay', { file: 'a.jpg' }],
    ['empty file name', { file: '', delay: 40 }],
    ['non-string file', { file: 0, delay: 40 }],
    ['null frame', null],
  ])('isValidFrames: rejects a list containing a frame with %s', (_label, bad) => {
    expect(isValidFrames([MIXED[0], bad])).toBe(false);
  });
});
