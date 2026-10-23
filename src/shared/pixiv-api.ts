// pixiv AJAX: URL builders, allowlists (system.md §11.1) and response parsing
// (design-download-engine.md "Resolving"). Pure: no fetch, no chrome.* access.

import type { UgoiraState } from './job';
import {
  FILE_BASENAME_RE,
  PIXIV_API_URL_RE,
  PIXIV_ORIGIN,
  PXIMG_URL_PREFIX,
  WITHHELD_MIN_SANITY_LEVEL,
} from './constants';
import { createLogger } from './log';
import type { RetryResult, WorkInfo } from './types';

const log = createLogger('pixiv-api');

const ARTWORK_ID_RE = /^\d{1,12}$/;

export interface UgoiraMeta {
  originalSrc: string; // allowlisted i.pximg.net zip URL
  frames: UgoiraState['frames']; // ugoira_meta.body.frames, unmodified (same array, extra keys kept)
}

type Parsed<T> = { ok: true; value: T } | { ok: false; detail: string };

export function isArtworkId(v: unknown): v is string {
  return typeof v === 'string' && ARTWORK_ID_RE.test(v);
}

export function illustUrl(artworkId: string): string {
  return `${PIXIV_ORIGIN}/ajax/illust/${artworkId}`;
}

export function pagesUrl(artworkId: string): string {
  return `${illustUrl(artworkId)}/pages`;
}

export function ugoiraMetaUrl(artworkId: string): string {
  return `${illustUrl(artworkId)}/ugoira_meta`;
}

/** `https://www.pixiv.net/ajax/illust/<digits>(/pages|/ugoira_meta)?`, nothing else. */
export function isApiUrl(v: unknown): v is string {
  return typeof v === 'string' && PIXIV_API_URL_RE.test(v);
}

/** Byte requests (originals, ugoira zip) go to `https://i.pximg.net/` only. */
export function isBytesUrl(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(PXIMG_URL_PREFIX);
}

/** `basename(new URL(url).pathname)` if it is a safe file name, else null. */
export function basenameOf(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const name = path.slice(path.lastIndexOf('/') + 1);
  return FILE_BASENAME_RE.test(name) ? name : null;
}

/** The raw `body` object of an `/ajax/illust/{id}` response (kept for metadata.json). */
export function illustBody(json: unknown): Record<string, unknown> | null {
  return isRecord(json) && isRecord(json.body) ? json.body : null;
}

/** `/ajax/illust/{id}` → WorkInfo. Missing id or illustType (or a ugoira's size) → `pixivError`. */
export function parseIllust(result: RetryResult<unknown>): RetryResult<WorkInfo> {
  return parseResponse(result, (body): Parsed<WorkInfo> => {
    if (!isRecord(body)) return { ok: false, detail: 'body' };
    const id = idString(body.illustId) ?? idString(body.id);
    if (id === null) return { ok: false, detail: 'illustId' };
    const illustType = toInt(body.illustType);
    if (illustType !== 0 && illustType !== 1 && illustType !== 2) {
      return { ok: false, detail: 'illustType' };
    }
    const xRestrict = toInt(body.xRestrict);
    const pageCount = toInt(body.pageCount);
    const width = toInt(body.width);
    const height = toInt(body.height);
    const hasSize = width !== null && width > 0 && height !== null && height > 0;
    // The frame size keys the codec probe, so a ugoira cannot do without it.
    if (illustType === 2 && !hasSize) return { ok: false, detail: 'size' };
    return {
      ok: true,
      value: {
        id,
        illustType,
        xRestrict: xRestrict === 1 || xRestrict === 2 ? xRestrict : 0,
        withheld: isWithheld(body, id),
        pageCount: pageCount !== null && pageCount > 0 ? pageCount : 1,
        width: hasSize ? width : 0,
        height: hasSize ? height : 0,
        userName: stringOrNull(body.userName),
        userId: typeof body.userId === 'number' ? idString(body.userId) : stringOrNull(body.userId),
        title: stringOrNull(body.illustTitle) ?? stringOrNull(body.title),
      },
    };
  });
}

/**
 * Whether pixiv withholds the work's images from this viewer (system.md §8.5, D10): pixiv's own
 * per-viewer decision, `urls.original === null`. Only when the `urls` shape is missing or
 * unrecognized does pixiv's sanity level stand in, so a shape drift degrades to today's threshold
 * instead of silently downloading walled works.
 */
function isWithheld(body: Record<string, unknown>, id: string): boolean {
  const urls = body.urls;
  if (isRecord(urls) && 'original' in urls) {
    if (urls.original === null) return true;
    if (typeof urls.original === 'string') return false;
  }
  const sl = toInt(body.sl);
  log.warn(`illust ${id}: no recognizable urls.original, falling back to sl ${String(sl)}`);
  return sl !== null && sl >= WITHHELD_MIN_SANITY_LEVEL;
}

/**
 * Needs login (R-003): the page is logged out and the work is R-18/R-18G or withheld behind
 * pixiv's login wall. An unknown login state (`null`) never needs login.
 */
export function requiresLogin(work: WorkInfo, loggedIn: boolean | null): boolean {
  return loggedIn === false && (work.xRestrict >= 1 || work.withheld);
}

/** `/ajax/illust/{id}/pages` → `urls.original` per page, in page order, each allowlisted. */
export function parsePages(result: RetryResult<unknown>): RetryResult<string[]> {
  return parseResponse(result, (body): Parsed<string[]> => {
    if (!Array.isArray(body) || body.length === 0) return { ok: false, detail: 'pages' };
    const urls: string[] = [];
    for (const page of body) {
      const original = isRecord(page) && isRecord(page.urls) ? page.urls.original : undefined;
      if (typeof original !== 'string') return { ok: false, detail: 'urls.original' };
      if (!isBytesUrl(original) || basenameOf(original) === null) {
        return { ok: false, detail: 'allowlist' };
      }
      urls.push(original);
    }
    return { ok: true, value: urls };
  });
}

/** `/ajax/illust/{id}/ugoira_meta` → zip URL and frames (non-empty). */
export function parseUgoiraMeta(result: RetryResult<unknown>): RetryResult<UgoiraMeta> {
  return parseResponse(result, (body): Parsed<UgoiraMeta> => {
    if (!isRecord(body)) return { ok: false, detail: 'body' };
    const { originalSrc, frames } = body;
    if (typeof originalSrc !== 'string') return { ok: false, detail: 'originalSrc' };
    if (!isBytesUrl(originalSrc)) return { ok: false, detail: 'allowlist' };
    if (!Array.isArray(frames) || frames.length === 0 || !frames.every(isFrame)) {
      return { ok: false, detail: 'frames' };
    }
    return { ok: true, value: { originalSrc, frames } };
  });
}

/** Passes failures through; an `error: true` envelope or a missing field becomes `pixivError`. */
function parseResponse<T>(
  result: RetryResult<unknown>,
  read: (body: unknown) => Parsed<T>,
): RetryResult<T> {
  if (!result.ok) return result;
  const { value, status, attempts } = result;
  let parsed: Parsed<T>;
  if (!isRecord(value)) parsed = { ok: false, detail: 'envelope' };
  else if (value.error === true) parsed = { ok: false, detail: 'error' };
  else parsed = read(value.body);
  if (parsed.ok) return { ok: true, value: parsed.value, status, attempts };
  return { ok: false, failure: { kind: 'pixivError', status, detail: parsed.detail, attempts } };
}

function isFrame(v: unknown): v is UgoiraState['frames'][number] {
  return isRecord(v) && typeof v.file === 'string' && typeof v.delay === 'number';
}

/** A digit-string id; pixiv sends strings, a bare integer is tolerated. */
function idString(v: unknown): string | null {
  const s = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : v;
  return isArtworkId(s) ? s : null;
}

/** A non-negative integer from a number or a digit string; anything else is null. */
function toInt(v: unknown): number | null {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
