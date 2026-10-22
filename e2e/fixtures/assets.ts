// Deterministic bytes for every fixture work, generated on first use and cached per process.

import { zipSync, type Zippable } from 'fflate';
import { encodeJpeg, encodePng, type Rgb, type TileColor } from './images';
import { frameFileName, type IllustWork, type UgoiraWork, type Work } from './works';

const PALETTE: readonly Rgb[] = [
  [0x3b, 0x4a, 0x6b],
  [0x5b, 0x6f, 0x97],
  [0xc9, 0xd3, 0xe3],
  [0xe8, 0x6a, 0x5c],
  [0xf2, 0xb6, 0x3d],
  [0x4c, 0xa6, 0x6b],
  [0x2f, 0x8f, 0xc9],
  [0x9b, 0x59, 0xb6],
  [0xff, 0xb8, 0x6b],
  [0x1f, 0x1f, 0x1f],
  [0xf5, 0xf5, 0xf5],
  [0x9a, 0xd1, 0xf5],
];

/** DOS timestamps are local wall-clock fields, so a local-time Date gives the same zip bytes in every time zone. */
const ZIP_MTIME = new Date(2026, 0, 1, 0, 0, 0);
/** Bytes that no image decoder accepts, for `corruptFrame`. */
const CORRUPT_FRAME = new TextEncoder().encode(
  'fake-pixiv: this frame is deliberately not an image\n',
);

function paletteColor(seed: number): Rgb {
  return PALETTE[((seed % PALETTE.length) + PALETTE.length) % PALETTE.length] ?? [0, 0, 0];
}

/** A two-color checkerboard, unique per work and page. */
function pageTiles(work: Work, page: number): TileColor {
  const seed = Number(work.id.slice(-4)) + page * 5;
  const a = paletteColor(seed);
  const b = paletteColor(seed + 7);
  return (tx, ty) => ((tx + ty) % 2 === 0 ? a : b);
}

/** A vertical gradient with a 4×4-tile square that moves one tile per frame. */
function frameTiles(work: UgoiraWork, frame: number): TileColor {
  const tilesX = Math.ceil(work.width / 16);
  const tilesY = Math.ceil(work.height / 16);
  const square = paletteColor(Number(work.id.slice(-2)) + 3);
  const left = frame % Math.max(1, tilesX - 3);
  const top = Math.floor(frame / Math.max(1, tilesX - 3)) % Math.max(1, tilesY - 3);
  return (tx, ty) => {
    if (tx >= left && tx < left + 4 && ty >= top && ty < top + 4) return square;
    const shade = Math.round((ty / Math.max(1, tilesY - 1)) * 160);
    return [40 + shade, 60 + Math.round(shade / 2), 200 - Math.round(shade / 2)];
  };
}

export interface UgoiraFrame {
  file: string;
  delay: number;
  bytes: Uint8Array;
}

const pageCache = new Map<string, Uint8Array>();
const frameCache = new Map<string, readonly UgoiraFrame[]>();
const zipCache = new Map<string, Uint8Array>();
const masterCache = new Map<string, Uint8Array>();

/** The original of one page, in the format its file extension names. */
export function pageBytes(work: IllustWork, page: number): Uint8Array {
  const key = `${work.id}:${page}`;
  let bytes = pageCache.get(key);
  if (!bytes) {
    const encode = work.pages[page] === 'png' ? encodePng : encodeJpeg;
    bytes = encode(work.width, work.height, pageTiles(work, page));
    pageCache.set(key, bytes);
  }
  return bytes;
}

/** The small JPEG the artwork page shows. */
export function masterBytes(work: Work): Uint8Array {
  let bytes = masterCache.get(work.id);
  if (!bytes) {
    bytes = encodeJpeg(Math.min(work.width, 240), Math.min(work.height, 240), pageTiles(work, 0));
    masterCache.set(work.id, bytes);
  }
  return bytes;
}

/** Every frame in order, with pixiv's file names (`000000.jpg` …) and delays. */
export function ugoiraFrames(work: UgoiraWork): readonly UgoiraFrame[] {
  let frames = frameCache.get(work.id);
  if (!frames) {
    frames = work.frameDelays.map((delay, index) => ({
      file: frameFileName(index),
      delay,
      bytes:
        index === work.corruptFrame
          ? CORRUPT_FRAME
          : encodeJpeg(work.width, work.height, frameTiles(work, index)),
    }));
    frameCache.set(work.id, frames);
  }
  return frames;
}

/** The frame zip (stored, like pixiv's), i.e. the bytes of `ugoira_meta.body.originalSrc`. */
export function ugoiraZip(work: UgoiraWork): Uint8Array {
  let bytes = zipCache.get(work.id);
  if (!bytes) {
    const entries: Zippable = {};
    for (const frame of ugoiraFrames(work)) entries[frame.file] = frame.bytes;
    bytes = zipSync(entries, { level: 0, mtime: ZIP_MTIME });
    zipCache.set(work.id, bytes);
  }
  return bytes;
}
