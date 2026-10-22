// Property test for design-settings-model.md "Totality": whatever pixiv sends, every folder segment
// passes a JS port of Chrome's net::IsSafePortablePathComponent, so chrome.downloads never fails with
// "Invalid filename". The port is independent of src/shared/pattern.ts and takes the strictest
// platform (Windows) wherever Chromium's checks differ by platform.

import { describe, expect, it } from 'vitest';
import { chromeSafeSegment, isSafeRelativeFolder, resolveFolder } from '../../src/shared/pattern';

const RUNS = 10_000;
const SEED = 0x5eed_2026;

// ── Port of Chromium (net/base/filename_util_icu.cc, base/i18n/file_util_icu.cc,
//    net/base/filename_util_internal.cc, base/files/file_util.cc, base/files/file_path.cc) ──

const ILLEGAL_ANYWHERE = /["*/:<>?\\|\p{Cc}\p{Cf}\p{Noncharacter_Code_Point}]/u;
const WSPACE = /\p{White_Space}/u;
const ILLEGAL_IN_SHORT_NAMES = /[\p{White_Space}"\\/[\]:+|<>=;?,*]/u;
const DOUBLE_EXTENSION_SUFFIXES = ['bz', 'bz2', 'gz', 'lz', 'lzma', 'lzo', 'xz', 'z', 'zst'];
const KNOWN_DEVICES = [
  'con',
  'prn',
  'aux',
  'nul',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`com${n}`, `lpt${n}`]),
  'clock$',
];
const MAGIC_NAMES = ['desktop.ini', 'thumbs.db', 'conin$', 'conout$'];

const lowerAscii = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

function illegalAtEnds(unit: string | undefined): boolean {
  return unit !== undefined && (WSPACE.test(unit) || unit === '.' || unit === '~');
}

function hasValidDotPositionForShortName(s: string): boolean {
  const first = s.indexOf('.');
  if (first === -1) return s.length <= 8;
  if (first !== s.lastIndexOf('.')) return false;
  return first > 0 && first <= 8 && first + 4 >= s.length;
}

function isFilenameLegal(s: string): boolean {
  if (s === '') return true;
  const couldBeInvalidShortName =
    s.length <= 12 &&
    s.includes('~') &&
    !ILLEGAL_IN_SHORT_NAMES.test(s) &&
    hasValidDotPositionForShortName(s);
  // Chromium checks the first and last UTF-16 code unit.
  return (
    !ILLEGAL_ANYWHERE.test(s) &&
    !illegalAtEnds(s[0]) &&
    !illegalAtEnds(s[s.length - 1]) &&
    !couldBeInvalidShortName
  );
}

function sanitizeGeneratedFileName(name: string): string {
  if (name === '') return name;
  let out = name.replace(/[ .]+$/, '').replace(/\p{White_Space}+$/u, '');
  if (out === '') return out;
  out += '_'.repeat(name.length - out.length);
  out = out.replace(/^\.+|\.+$/g, '');
  if (out === '') return out;
  return out.replaceAll('/', '_').replaceAll('\\', '_');
}

function extension(s: string): string {
  if (s === '.' || s === '..') return '';
  const last = s.lastIndexOf('.');
  if (last === -1) return '';
  if (last === 0) return s.slice(1);
  const penultimate = s.lastIndexOf('.', last - 1);
  if (penultimate === -1) return s.slice(last + 1);
  if (lowerAscii(s.slice(penultimate + 1)) === 'user.js') return s.slice(penultimate + 1);
  const gap = last - penultimate;
  if (DOUBLE_EXTENSION_SUFFIXES.includes(lowerAscii(s.slice(last + 1))) && gap <= 5 && gap > 1) {
    return s.slice(penultimate + 1);
  }
  return s.slice(last + 1);
}

function isShellIntegratedExtension(ext: string): boolean {
  const lower = lowerAscii(ext);
  return (
    ['local', 'lnk', 'scf', 'url'].includes(lower) ||
    (lower !== '' && lower.startsWith('{') && lower.endsWith('}'))
  );
}

function isReservedNameOnWindows(name: string): boolean {
  const trimmed = lowerAscii(name).replace(/[ .]+$/, '');
  const dot = trimmed.indexOf('.');
  const prefix = dot === -1 ? trimmed : trimmed.slice(0, dot);
  return (
    KNOWN_DEVICES.some((device) => trimmed === device || prefix === device) ||
    MAGIC_NAMES.includes(trimmed)
  );
}

function isSafePortablePathComponent(component: string): boolean {
  // Chrome receives the string as UTF-8, so a lone surrogate arrives as U+FFFD.
  const s = new TextDecoder().decode(new TextEncoder().encode(component));
  return (
    s !== '' &&
    !s.includes('/') &&
    !s.includes('\\') &&
    isFilenameLegal(s) &&
    !isShellIntegratedExtension(extension(s)) &&
    sanitizeGeneratedFileName(s) === s &&
    !isReservedNameOnWindows(s)
  );
}

// ── Seeded random Unicode strings, biased toward what Chrome cares about ──

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x20, 0x7e],
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0xa0, 0xff],
  [0x300, 0x36f],
  [0x1680, 0x1680],
  [0x2000, 0x206f],
  [0x3000, 0x30ff],
  [0x4e00, 0x9fff],
  [0xd800, 0xdfff],
  [0xfdd0, 0xfdef],
  [0xfe00, 0xfeff],
  [0xfff0, 0xffff],
  [0x1f300, 0x1faff],
  [0xe0000, 0xe007f],
  [0x10000, 0x10ffff],
];
const FRAGMENTS = [
  'CON',
  'nul',
  'Aux',
  'com1',
  'LPT9',
  'clock$',
  'desktop.ini',
  'Thumbs.db',
  'conin$',
  'CONOUT$',
  '.lnk',
  '.URL',
  '.local',
  '.scf',
  '.{x}',
  '.tar.gz',
  '.user.js',
  '~',
  '~1',
  '.',
  '..',
  ' ',
  '_',
  '{id}',
  'みずき',
  '👩\u{200d}🎨',
  'e\u{301}',
];
const WHITESPACE = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x200a, 0x2028,
  0x2029, 0x202f, 0x205f, 0x3000, 0xfeff, 0x180e,
];

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)] as T;
}

function randomString(rand: () => number): string {
  const parts: string[] = [];
  const length = Math.floor(rand() * 24);
  for (let i = 0; i < length; i++) {
    const r = rand();
    if (r < 0.2) parts.push(pick(rand, FRAGMENTS));
    else if (r < 0.35) parts.push(String.fromCodePoint(pick(rand, WHITESPACE)));
    else {
      const [lo, hi] = pick(rand, RANGES);
      parts.push(String.fromCodePoint(lo + Math.floor(rand() * (hi - lo + 1))));
    }
  }
  return parts.join('');
}

describe('isSafePortablePathComponent (test port)', () => {
  it.each([
    'CON',
    'a.lnk',
    ' a',
    'a~',
    'ab~c',
    'a\u{200d}b',
    '',
    'a/b',
    '.a',
    'a.',
    'a\u{fdd0}',
    'x.{y}',
  ])('port: rejects %j, as Chrome does', (s) => {
    expect(isSafePortablePathComponent(s)).toBe(false);
  });

  it.each(['みずき-135882741', '_CON', 'sora~-123', 'a.url_', 'archive.tar.gz'])(
    'port: accepts %j, as Chrome does',
    (s) => {
      expect(isSafePortablePathComponent(s)).toBe(true);
    },
  );
});

describe('resolveFolder (property)', () => {
  it(`resolveFolder: ${RUNS} random artists and titles always give Chrome-safe segments`, () => {
    const rand = mulberry32(SEED);
    const failures: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const artist = randomString(rand);
      const title = randomString(rand);
      const id = String(Math.floor(rand() * 1e9));
      const folder = resolveFolder('{artist}/{title}', { artist, id, title, userId: id });
      if (!folder.split('/').every(isSafePortablePathComponent)) {
        failures.push(JSON.stringify({ artist, title, folder }));
      }
    }
    expect(failures).toEqual([]);
  });

  it(`resolveFolder: ${RUNS} random folders all pass isSafeRelativeFolder`, () => {
    const rand = mulberry32(SEED + 1);
    const failures: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const artist = randomString(rand);
      const title = randomString(rand);
      const folder = resolveFolder('pixiv/{artist}-{id}/{title}', {
        artist,
        id: '135882741',
        title,
        userId: null,
      });
      if (!isSafeRelativeFolder(folder)) failures.push(JSON.stringify({ artist, title, folder }));
    }
    expect(failures).toEqual([]);
  });
});

describe('chromeSafeSegment (property)', () => {
  it(`chromeSafeSegment: ${RUNS} random strings give '' or a Chrome-safe, stable segment`, () => {
    const rand = mulberry32(SEED + 2);
    const failures: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const input = randomString(rand);
      const seg = chromeSafeSegment(input);
      if (seg === '') continue;
      if (!isSafePortablePathComponent(seg) || chromeSafeSegment(seg) !== seg) {
        failures.push(JSON.stringify({ input, seg }));
      }
    }
    expect(failures).toEqual([]);
  });
});
