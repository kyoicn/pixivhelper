// First-party API proxy for the SW's jobs (design-artwork-button.md "API proxy"; system.md §8.3):
// the tab fetches allowlisted pixiv API URLs with its own cookies, so a job resolves under every
// cookie setting. Independent of the displayed artwork, it serves any job this tab started.

import { createLogger } from '../shared/log';
import { type ApiFetchJsonResponse, isApiFetchJsonMessage } from '../shared/messages';
import { fetchWithRetry } from '../shared/retry';

const log = createLogger('api-proxy');

/** Answers an `api/fetchJson` message. Never rejects; a URL off the allowlist is a BAD_REQUEST. */
export async function proxyFetchJson(message: unknown): Promise<ApiFetchJsonResponse> {
  if (!isApiFetchJsonMessage(message)) {
    log.warn('api/fetchJson refused: URL not on the API allowlist');
    return { ok: false, error: 'BAD_REQUEST' };
  }
  const result = await fetchWithRetry(message.url, {
    responseType: 'json',
    init: { credentials: 'same-origin' },
  });
  return { ok: true, result };
}
