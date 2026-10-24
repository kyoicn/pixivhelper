// Shared retry policy (system.md §9), with parity to Fetcher.__call__ in ref/pixiv-dl. Used by the
// content script (render fetch, API proxy) and the offscreen document (bytes, zip, fallback API).

import {
  MAX_ATTEMPTS,
  RETRY_AFTER_CAP_MS,
  RETRY_BASE_MS,
  RETRY_JITTER_MS,
  STALL_TIMEOUT_MS,
} from './constants';
import { createLogger } from './log';
import type { Failure, RetryResult } from './types';

const log = createLogger('retry');

const RETRY_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);
/** A decimal number of seconds, as Python's float() reads it (HTTP-dates do not match). */
const RETRY_AFTER_SECONDS_RE = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

/** What each response type resolves to. */
export interface ResponseValues {
  json: unknown; // parsed body; a 2xx body with `error: true` is a `pixivError` failure instead
  bytes: Blob; // typed with the response Content-Type
  rawBytes: Uint8Array; // preallocated when Content-Length is known (zip bytes held once)
}
export type ResponseType = keyof ResponseValues;

export interface RetryOptions<R extends ResponseType = ResponseType> {
  responseType: R;
  signal?: AbortSignal; // cancel → Failure{kind:'aborted'}
  onProgress?: (loaded: number, total: number | null) => void; // body bytes of the current attempt
  init?: RequestInit; // credentials etc.; its signal is replaced
  random?: () => number; // injectable for tests
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

type AttemptFailure = Omit<Failure, 'attempts'>;
type AttemptResult<T> =
  | { ok: true; value: T; status: number }
  // answered: fetch() resolved with a response (status line and headers) before this attempt failed
  | { ok: false; failure: AttemptFailure; retryAfterMs: number | null; answered: boolean };
type Bytes = Uint8Array<ArrayBuffer>;
type BodyResult = { ok: true; parts: Bytes[]; loaded: number } | { ok: false; detail: string };

/**
 * Fetches `url` with up to MAX_ATTEMPTS attempts. 429/500/502/503/504, network errors and 30 s
 * inactivity are retried after `Retry-After` (positive seconds, capped at 30 s) or a jittered
 * exponential backoff; every other outcome is final. A final network or timeout failure of a
 * request that got any HTTP response on some attempt carries `answered: true` (system.md §9).
 * Never throws.
 */
export async function fetchWithRetry<R extends ResponseType>(
  url: string,
  opts: RetryOptions<R>,
): Promise<RetryResult<ResponseValues[R]>> {
  const random = opts.random ?? Math.random;
  const sleep = opts.sleep ?? abortableSleep;
  const label = logLabel(url);
  let answered = false;
  for (let n = 0; ; n++) {
    if (opts.signal?.aborted) return { ok: false, failure: { kind: 'aborted', attempts: n } };
    const attempts = n + 1;
    const result = await attempt(url, opts);
    if (result.ok) {
      log.debug(`${label} attempt ${attempts}/${MAX_ATTEMPTS}: ${result.status}`);
      return { ok: true, value: result.value, status: result.status, attempts };
    }
    const failure: Failure = { ...result.failure, attempts };
    if (result.answered) answered = true;
    const outcome = failure.kind === 'http' ? String(failure.status) : failure.kind;
    if (!isRetryable(failure) || attempts === MAX_ATTEMPTS) {
      log.debug(`${label} attempt ${attempts}/${MAX_ATTEMPTS}: ${outcome}, giving up`);
      return { ok: false, failure: withAnswered(failure, answered) };
    }
    const delayMs = (result.retryAfterMs ?? backoffMs(n, random)) * __RETRY_TIME_SCALE__;
    log.debug(
      `${label} attempt ${attempts}/${MAX_ATTEMPTS}: ${outcome}, retry in ${Math.round(delayMs)} ms`,
    );
    try {
      await sleep(delayMs, opts.signal);
    } catch {
      return { ok: false, failure: { kind: 'aborted', attempts } };
    }
  }
}

async function attempt<R extends ResponseType>(
  url: string,
  opts: RetryOptions<R>,
): Promise<AttemptResult<ResponseValues[R]>> {
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  opts.signal?.addEventListener('abort', forwardAbort);
  let timedOut = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const armStallTimer = (): void => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, STALL_TIMEOUT_MS * __RETRY_TIME_SCALE__);
  };
  let answered = false;
  try {
    armStallTimer();
    const res = await abortable(
      fetch(url, { ...opts.init, signal: controller.signal }),
      controller,
    );
    answered = true;
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined);
      const retryAfter = RETRY_STATUSES.has(res.status)
        ? retryAfterMs(res.headers.get('retry-after'))
        : null;
      return {
        ok: false,
        failure: { kind: 'http', status: res.status },
        retryAfterMs: retryAfter,
        answered,
      };
    }
    const total = contentLength(res.headers);
    const preallocate = opts.responseType === 'rawBytes';
    const body = await readBody(
      res,
      total,
      preallocate,
      controller,
      armStallTimer,
      opts.onProgress,
    );
    if (!body.ok) {
      return {
        ok: false,
        failure: { kind: 'network', detail: body.detail },
        retryAfterMs: null,
        answered,
      };
    }
    return decode(res, body.parts, body.loaded, opts.responseType);
  } catch {
    const kind = opts.signal?.aborted ? 'aborted' : timedOut ? 'timeout' : 'network';
    return { ok: false, failure: { kind }, retryAfterMs: null, answered };
  } finally {
    clearTimeout(stallTimer);
    opts.signal?.removeEventListener('abort', forwardAbort);
  }
}

/** Streams the body, re-arming the stall timer before every chunk. */
async function readBody(
  res: Response,
  total: number | null,
  preallocate: boolean,
  controller: AbortController,
  onChunk: () => void,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<BodyResult> {
  const buffer = preallocate && total !== null ? new Uint8Array(total) : null;
  const chunks: Bytes[] = [];
  let loaded = 0;
  if (res.body) {
    const reader = res.body.getReader();
    try {
      for (;;) {
        onChunk();
        const { done, value } = await abortable(reader.read(), controller);
        if (done) break;
        if (buffer) {
          if (loaded + value.length > buffer.length) {
            void reader.cancel().catch(() => undefined);
            return { ok: false, detail: 'long-body' };
          }
          buffer.set(value, loaded);
        } else {
          chunks.push(value);
        }
        loaded += value.length;
        onProgress?.(loaded, total);
      }
    } catch (err) {
      void reader.cancel().catch(() => undefined);
      throw err;
    }
  }
  if (total !== null && loaded !== total) {
    return { ok: false, detail: loaded < total ? 'short-body' : 'long-body' };
  }
  return { ok: true, parts: buffer ? [buffer] : chunks, loaded };
}

function decode<R extends ResponseType>(
  res: Response,
  parts: Bytes[],
  loaded: number,
  responseType: R,
): AttemptResult<ResponseValues[R]> {
  const status = res.status;
  // Each branch builds the value for its own response type; TypeScript cannot narrow R itself.
  if (responseType === 'bytes') {
    const type = res.headers.get('content-type') ?? '';
    const value = new Blob(parts, { type }) as ResponseValues[R];
    return { ok: true, value, status };
  }
  const bytes = parts.length === 1 && parts[0] ? parts[0] : concat(parts, loaded);
  if (responseType === 'rawBytes') return { ok: true, value: bytes as ResponseValues[R], status };
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {
      ok: false,
      failure: { kind: 'pixivError', status, detail: 'invalid-json' },
      retryAfterMs: null,
      answered: true,
    };
  }
  if (isRecord(json) && json.error === true) {
    return {
      ok: false,
      failure: { kind: 'pixivError', status },
      retryAfterMs: null,
      answered: true,
    };
  }
  return { ok: true, value: json as ResponseValues[R], status };
}

/**
 * Chromium refuses an extension's repeated requests to a URL that keeps answering 5xx, and fetch
 * reports that as a plain TypeError; a body that breaks off fails the same way after the headers
 * arrived. The flag tells "pixiv answered, then the request failed" from "nothing answered" for
 * the job-level "No connection" rule (system.md §9, §10 row 8). `http` and `pixivError` are
 * answered by definition and never carry it.
 */
function withAnswered(failure: Failure, answered: boolean): Failure {
  const transport = failure.kind === 'network' || failure.kind === 'timeout';
  return transport && answered ? { ...failure, answered: true } : failure;
}

function isRetryable(failure: Failure): boolean {
  switch (failure.kind) {
    case 'network':
    case 'timeout':
      return true;
    case 'http':
      return failure.status !== undefined && RETRY_STATUSES.has(failure.status);
    default:
      return false;
  }
}

function backoffMs(n: number, random: () => number): number {
  return RETRY_BASE_MS * 2 ** n + random() * RETRY_JITTER_MS;
}

/** Positive seconds → min(value, 30 s). `0`, negative and HTTP-date values fall through (parity). */
function retryAfterMs(raw: string | null): number | null {
  if (raw === null || !RETRY_AFTER_SECONDS_RE.test(raw)) return null;
  const seconds = Number(raw);
  return seconds > 0 ? Math.min(seconds * 1000, RETRY_AFTER_CAP_MS) : null;
}

/** Content-Length of the decoded body, or null when absent, invalid or content-encoded. */
function contentLength(headers: Headers): number | null {
  const encoding = headers.get('content-encoding');
  if (encoding !== null && encoding.trim().toLowerCase() !== 'identity') return null;
  const raw = headers.get('content-length')?.trim();
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const length = Number(raw);
  return Number.isSafeInteger(length) ? length : null;
}

function concat(parts: Bytes[], length: number): Bytes {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Rejects as soon as `controller` aborts, even if `promise` ignores the signal. */
function abortable<T>(promise: Promise<T>, controller: AbortController): Promise<T> {
  const { signal } = controller;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('aborted'));
    if (signal.aborted) onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Host + path only: query strings may carry tokens and are never logged. */
function logLabel(url: string): string {
  return (url.split(/[?#]/, 1)[0] ?? '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
