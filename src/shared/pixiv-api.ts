// pixiv AJAX: URL builders, allowlists (system.md §11.1) and response parsing
// (design-download-engine.md "Resolving"). Pure: no fetch, no chrome.* access.

import type { UgoiraState } from '../background/types';
import { FILE_BASENAME_RE, PIXIV_API_URL_RE, PIXIV_ORIGIN, PXIMG_URL_PREFIX } from './constants';
import type { RetryResult, WorkInfo } from './types';

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
