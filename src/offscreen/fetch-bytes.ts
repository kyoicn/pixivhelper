// Byte and fallback-API fetches of the offscreen document (design-offscreen-worker.md "Byte fetch
// (fetch-bytes.ts)") on the shared retry policy (system.md §9). The allowlists are re-checked here as
// defense in depth (system.md §11.1): the router's guards already refuse every other URL.

import { isApiUrl, isBytesUrl } from '../shared/pixiv-api';
import { fetchWithRetry } from '../shared/retry';
import type { RetryResult } from '../shared/types';
import type { ZipBytes } from './tasks';

// i.pximg.net needs no cookies, only the Referer the DNR rule adds. no-store keeps a 200 MB manga
// out of the HTTP cache as well, since the bytes are held here anyway.
const BYTES_INIT: RequestInit = { credentials: 'omit', cache: 'no-store' };
// First-party cookies, for the fallback path when the originating tab is gone (system.md §8.3).
const API_INIT: RequestInit = { credentials: 'include' };

/** An original, byte for byte as served, in a Blob typed with the response Content-Type. */
export function fetchOriginal(url: string, signal: AbortSignal): Promise<RetryResult<Blob>> {
  assertAllowed(isBytesUrl(url));
  return fetchWithRetry(url, { responseType: 'bytes', init: BYTES_INIT, signal });
}

/** The ugoira zip, streamed into one buffer (preallocated when Content-Length is known). */
export function fetchZip(
  url: string,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number | null) => void,
): Promise<RetryResult<ZipBytes>> {
  assertAllowed(isBytesUrl(url));
  // fetchWithRetry allocates the bytes in a plain ArrayBuffer, never in shared memory.
  return fetchWithRetry(url, {
    responseType: 'rawBytes',
    init: BYTES_INIT,
    signal,
    onProgress,
  }) as Promise<RetryResult<ZipBytes>>;
}

/** A pixiv API call: the parsed body or the failure, as the tab proxy would return it. */
export function fetchApiJson(url: string): Promise<RetryResult<unknown>> {
  assertAllowed(isApiUrl(url));
  return fetchWithRetry(url, { responseType: 'json', init: API_INIT });
}

function assertAllowed(allowed: boolean): void {
  if (!allowed) throw new Error('URL is not allowlisted');
}
