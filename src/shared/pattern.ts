// Folder-pattern grammar, token sanitization and the Chrome path-safety pass
// (design-settings-model.md). Pure: no chrome.* access.

import { MAX_FOLDER_CHARS, PATTERN_MAX_CHARS, TOKEN_MAX_BYTES } from './constants';

export type PatternError =
  | { code: 'empty' }
  | { code: 'absolute' }
  | { code: 'backslash' }
  | { code: 'dotdot' }
  | { code: 'unknownToken'; token: string }
  | { code: 'illegalChars' }
  // Defensive only: the field's maxlength keeps user input within PATTERN_MAX_CHARS.
  | { code: 'tooLong' };

export interface TokenValues {
  artist: string | null;
  id: string;
  title: string | null;
  userId: string | null;
}

/** The fixed preview artwork (PRD CUJ-3 step 2). */
export const SAMPLE: TokenValues = {
  artist: 'みずき',
  id: '135882741',
  title: '雨上がりの渋谷',
  userId: '40285173',
};

/**
 * ICU White_Space, as used by Chrome's `IsFilenameLegal` for leading/trailing characters. Pinned
 * rather than `\p{White_Space}` so a JS engine's Unicode update cannot drift from Chrome.
 */
export const ICU_WHITE_SPACE: readonly number[] = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f,
  0x3000,
];

type TokenName = keyof TokenValues;
const KNOWN_TOKENS: ReadonlySet<string> = new Set(['{artist}', '{id}', '{title}', '{userId}']);
const KNOWN_TOKEN_RE = /\{(artist|id|title|userId)\}/g;
const BRACED_RE = /\{[^{}]*\}/g;
const ILLEGAL_LITERAL_RE = /[:*?"<>|]/;

// safe_component in ref/pixiv-dl. The whitespace class is Python's str.isspace set, not JS \s.
const SCRIPT_REMOVED_RE = /[\x00-\x1f\x7f/:\\]/g;
const PY_WHITESPACE_RUN_RE =
  /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;
const SCRIPT_EDGE_RE = /^[._ ]+|[._ ]+$/g;
// PRD §4.4.2 extension.
const PRD_REMOVED_RE = /[*?"<>|]/g;
// D8 step 4+: Chrome refuses an edge '~', so a value of only '~'/'.' must become 'unknown' here
// rather than an empty segment that the segment pass drops.
const TOKEN_EDGE_RE = /^[._ ~]+|[._ ~]+$/g;

// Chrome's IsFilenameLegal: characters refused anywhere in a path component.
const CHROME_ILLEGAL_RE = /["*/:<>?\\|\p{Cc}\p{Cf}\p{Noncharacter_Code_Point}]/gu;
const WHITE_SPACE_CLASS = ICU_WHITE_SPACE.map((cp) => `\\u{${cp.toString(16)}}`).join('');
const SEGMENT_EDGE_RE = new RegExp(`^[${WHITE_SPACE_CLASS}.~]+|[${WHITE_SPACE_CLASS}.~]+$`, 'gu');
// Characters that rule out a VFAT 8.3 short name (Chrome's illegal_in_short_filenames_).
const SHORT_NAME_EXCLUDED_RE = new RegExp(`[${WHITE_SPACE_CLASS}"\\\\/\\[\\]:+|<>=;?,*]`, 'u');

const WINDOWS_DEVICE_NAMES: ReadonlySet<string> = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
  'clock$',
]);
const WINDOWS_MAGIC_NAMES: ReadonlySet<string> = new Set([
  'desktop.ini',
  'thumbs.db',
  'conin$',
  'conout$',
]);
const SHELL_INTEGRATED_EXTENSIONS: ReadonlySet<string> = new Set(['local', 'lnk', 'scf', 'url']);

/** CUJ-3 step 5: the first failing rule, in the PRD's order, or null when the pattern is valid. */
export function validatePattern(p: string): PatternError | null {
  if (p.trim() === '') return { code: 'empty' };
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || /^~(\/|$)/.test(p) || p.startsWith('\\\\')) {
    return { code: 'absolute' };
  }
  if (p.includes('\\')) return { code: 'backslash' };
  if (p.split('/').some((seg) => seg.trim() === '..')) return { code: 'dotdot' };
  for (const [token] of p.matchAll(BRACED_RE)) {
    if (!KNOWN_TOKENS.has(token)) return { code: 'unknownToken', token };
  }
  if (ILLEGAL_LITERAL_RE.test(p.replace(KNOWN_TOKEN_RE, ''))) return { code: 'illegalChars' };
  if (p.length > PATTERN_MAX_CHARS) return { code: 'tooLong' };
  return null;
}

/** PRD §4.4 "Resolution at job start". Precondition: `validatePattern(pattern) === null`. */
export function resolveFolder(pattern: string, v: TokenValues): string {
  // One pass, so a token value that itself reads "{id}" is never substituted again.
  const resolved = pattern.replace(KNOWN_TOKEN_RE, (_match, name: TokenName) =>
    sanitizeToken(v[name] ?? ''),
  );
  const segments = resolved
    .split('/')
    .map(chromeSafeSegment)
    .filter((seg) => seg !== '');
  return segments.length > 0 ? segments.join('/') : 'unknown';
}

/**
 * `safe_component` from ref/pixiv-dl plus the PRD §4.4.2 and Chrome (D8) removals.
 * `parityOnly` skips the additions; it exists for the golden parity test.
 */
export function sanitizeToken(s: string, opts: { parityOnly?: boolean } = {}): string {
  const parityOnly = opts.parityOnly === true;
  let out = s.normalize('NFC').replace(SCRIPT_REMOVED_RE, '');
  if (!parityOnly) out = out.replace(PRD_REMOVED_RE, '');
  out = out.replace(PY_WHITESPACE_RUN_RE, '_');
  // After the whitespace step, so whitespace-class controls such as U+0085 still become '_'.
  if (!parityOnly) out = out.replace(CHROME_ILLEGAL_RE, '');
  const edgeRe = parityOnly ? SCRIPT_EDGE_RE : TOKEN_EDGE_RE;
  out = out.replace(edgeRe, '');
  out = truncateUtf8(out, TOKEN_MAX_BYTES).replace(edgeRe, '');
  return out === '' ? 'unknown' : out;
}

/**
 * D8: makes one path segment pass Chrome's `IsSafePortablePathComponent` on every platform.
 * Returns '' when nothing is left, meaning "drop this segment".
 */
export function chromeSafeSegment(seg: string): string {
  let out = seg.replace(CHROME_ILLEGAL_RE, '').replace(SEGMENT_EDGE_RE, '');
  if (out === '') return '';
  // Prefix rather than replace, as Chrome's own GenerateSafeFileName does.
  if (isReservedNameOnWindows(out)) out = `_${out}`;
  if (hasShellIntegratedExtension(out)) out = `${out}_`;
  // Applied on every platform so a synced archive gets the same folder names everywhere.
  if (couldBeShortNameWithTilde(out)) out = out.replaceAll('~', '_');
  return out;
}

/** Re-validates a folder echoed back by a tab (retry requests) before it reaches chrome.downloads. */
export function isSafeRelativeFolder(folder: string): boolean {
  if (folder === '' || folder.length > MAX_FOLDER_CHARS || folder.startsWith('/')) return false;
  return folder
    .split('/')
    .every((seg) => seg !== '' && seg !== '.' && seg !== '..' && chromeSafeSegment(seg) === seg);
}

/** Cuts on a code-point boundary; lone surrogates count 3 bytes, as TextEncoder writes U+FFFD. */
function truncateUtf8(s: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += ch.length;
  }
  return s.slice(0, end);
}

// Chrome lowercases ASCII only.
function toLowerAscii(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function isReservedNameOnWindows(seg: string): boolean {
  const trimmed = toLowerAscii(seg).replace(/[ .]+$/, '');
  const dot = trimmed.indexOf('.');
  const prefix = dot === -1 ? trimmed : trimmed.slice(0, dot);
  return WINDOWS_DEVICE_NAMES.has(prefix) || WINDOWS_MAGIC_NAMES.has(trimmed);
}

function hasShellIntegratedExtension(seg: string): boolean {
  const dot = seg.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = toLowerAscii(seg.slice(dot + 1));
  return SHELL_INTEGRATED_EXTENSIONS.has(ext) || (ext.startsWith('{') && ext.endsWith('}'));
}

// Chrome (Windows) refuses a '~' in anything that could be a VFAT 8.3 name, e.g. `PROGRA~1`.
function couldBeShortNameWithTilde(seg: string): boolean {
  if (seg.length > 12 || !seg.includes('~') || SHORT_NAME_EXCLUDED_RE.test(seg)) return false;
  const firstDot = seg.indexOf('.');
  if (firstDot === -1) return seg.length <= 8;
  if (firstDot !== seg.lastIndexOf('.')) return false;
  return firstDot > 0 && firstDot <= 8 && firstDot + 4 >= seg.length;
}
