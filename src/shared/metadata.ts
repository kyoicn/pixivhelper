// metadata.json construction (design-download-engine.md "`metadata.json` construction"). Byte
// parity with write_metadata in ref/pixiv-dl, pinned by test/golden/{plain_text,write_metadata}.json,
// except where PRD §4.3 differs: a missing description is null (the script wrote ""), and a body
// with no id builds the url from the requested artwork id (the script wrote ".../None").

import { PIXIV_ORIGIN } from './constants';
import { HTML5_ENTITIES, INVALID_CHARREFS, INVALID_CODEPOINTS } from './html-entities';

/** PRD §4.3: exactly these 12 keys, in this order. Fields copied from pixiv keep pixiv's value. */
export interface ArtworkMetadata {
  id: string | null;
  title: unknown;
  description: string | null;
  userName: unknown;
  userId: unknown;
  createDate: unknown;
  uploadDate: unknown;
  pageCount: unknown;
  illustType: unknown;
  xRestrict: unknown;
  tags: unknown[];
  url: string;
}

// Python's str.isspace set, which str.strip() and re's \s use. JS \s and trim() differ: they
// include U+FEFF and lack U+001C–U+001F and U+0085.
const PY_SPACE = String.raw`\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000`;
const PY_SPACE_RE = new RegExp(`[${PY_SPACE}]`);
// plain_text's pattern under Python's re.I, where `i` also matches U+0130 and U+0131.
const LINE_BREAK_RE = new RegExp(
  `<[bB][rR][${PY_SPACE}]*/?>|</[pP]>|</[dD][iI\\u0130\\u0131][vV]>`,
  'g',
);
const TAG_RE = /<[^>]+>/g;
// html._charref. The `u` flag makes {1,32} count code points, as Python does.
const CHARREF_RE = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu;

/** The `metadata.json` object for an `/ajax/illust/{id}` body; `artworkId` is the requested id. */
export function buildMetadata(body: Record<string, unknown>, artworkId: string): ArtworkMetadata {
  // Python `or` semantics: an empty illustId falls through to id.
  const id = str(body.illustId) || str(body.id) || null;
  return {
    id,
    title: body.illustTitle ?? null,
    description: typeof body.description === 'string' ? plainText(body.description) : null,
    userName: body.userName ?? null,
    userId: body.userId ?? null,
    createDate: body.createDate ?? null,
    uploadDate: body.uploadDate ?? null,
    pageCount: body.pageCount ?? null,
    illustType: body.illustType ?? null,
    xRestrict: body.xRestrict ?? null,
    tags: tagNames(body.tags),
    url: `${PIXIV_ORIGIN}/artworks/${id ?? artworkId}`,
  };
}

/** pixiv description HTML → plain text, as `plain_text` in ref/pixiv-dl. */
export function plainText(s: string): string {
  return stripPy(unescapeHtml(s.replace(LINE_BREAK_RE, '\n').replace(TAG_RE, '')));
}

/** Python's `html.unescape`: HTML5 named references (legacy names without ';'), numeric ones. */
export function unescapeHtml(s: string): string {
  return s.replace(CHARREF_RE, (_match, ref: string) => replaceCharref(ref));
}

/** Python's `str.strip()` with no arguments. */
export function stripPy(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && PY_SPACE_RE.test(s.charAt(start))) start++;
  while (end > start && PY_SPACE_RE.test(s.charAt(end - 1))) end--;
  return s.slice(start, end);
}

/**
 * The bytes of Python's `json.dump(v, ensure_ascii=False, indent=2)`: literal non-ASCII, no
 * trailing newline. Used for `metadata.json` and `frames.json`.
 */
export function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** html._replace_charref. */
function replaceCharref(ref: string): string {
  if (ref.startsWith('#')) {
    const hex = ref[1] === 'x' || ref[1] === 'X';
    // parseInt stops at the optional ';'.
    const num = parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
    const remapped = INVALID_CHARREFS.get(num);
    if (remapped !== undefined) return remapped;
    if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) return '\ufffd';
    if (INVALID_CODEPOINTS.has(num)) return '';
    return String.fromCodePoint(num);
  }
  const whole = HTML5_ENTITIES.get(ref);
  if (whole !== undefined) return whole;
  // Otherwise the longest legacy name that prefixes the reference wins; the rest stays literal.
  const chars = Array.from(ref);
  for (let x = chars.length - 1; x > 1; x--) {
    const value = HTML5_ENTITIES.get(chars.slice(0, x).join(''));
    if (value !== undefined) return value + chars.slice(x).join('');
  }
  return '&' + ref;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function tagNames(tags: unknown): unknown[] {
  const list = isRecord(tags) ? tags.tags : undefined;
  if (!Array.isArray(list)) return [];
  return list.map((tag: unknown) => (isRecord(tag) ? (tag.tag ?? null) : null));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
