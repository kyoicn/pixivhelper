// SW → content script messaging (design-download-engine.md "API / Interface Contract"; system.md
// §8.3). Messages go to the top frame only.

import { createLogger } from '../shared/log';
import type {
  ApiFetchJsonMessage,
  ApiFetchJsonResponse,
  JobUpdateMessage,
} from '../shared/messages';
import type { JobView, RetryResult } from '../shared/types';
import { send } from './offscreen-client';

const log = createLogger('tab-client');

const TOP_FRAME = { frameId: 0 };

/**
 * Pushes a full JobView snapshot to the job's tab. Never rejects: a failed push is expected (the
 * tab closed or navigated off pixiv) and only logged.
 */
export async function pushView(tabId: number, view: JobView): Promise<void> {
  const message: JobUpdateMessage = { target: 'tab', type: 'job/update', view };
  try {
    await chrome.tabs.sendMessage(tabId, message, TOP_FRAME);
  } catch (error) {
    log.debug('job/update not delivered to tab', tabId, error);
  }
}

/**
 * Fetches a pixiv API URL through the originating tab, which carries first-party cookies under
 * every cookie setting. Falls back to the offscreen document when the tab cannot answer (closed,
 * navigated off pixiv, or no valid response).
 */
export async function apiFetchJson(tabId: number, url: string): Promise<RetryResult<unknown>> {
  const message: ApiFetchJsonMessage = { target: 'tab', type: 'api/fetchJson', url };
  try {
    const response = await chrome.tabs.sendMessage<
      ApiFetchJsonMessage,
      ApiFetchJsonResponse | undefined
    >(tabId, message, TOP_FRAME);
    if (response?.ok) return response.result;
    log.debug('tab gave no API result, using offscreen', tabId, response);
  } catch (error) {
    log.debug('tab unreachable for API call, using offscreen', tabId, error);
  }
  const response = await send({ type: 'off/fetchJson', url, credentials: 'include' });
  if (!response.ok) throw new Error(`off/fetchJson failed: ${response.error}`);
  return response.result;
}
