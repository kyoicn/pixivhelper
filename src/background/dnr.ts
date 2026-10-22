// Referer for the offscreen document's i.pximg.net fetches (system.md §8.2). chrome.downloads and
// extension fetch() cannot set Referer, and i.pximg.net answers 403 without one. The variant is
// the one ENG-002 verified (scripts/spike/FINDINGS.md §2): initiatorDomains matches the offscreen
// document's fetches (tabId −1, xmlhttprequest) and never tab traffic.

import { PIXIV_REFERER } from '../shared/constants';

export const REFERER_RULE_ID = 1;
const PXIMG_HOST = 'i.pximg.net';
/** chrome.tabs.TAB_ID_NONE: requests not made by a tab. */
const TAB_ID_NONE = -1;

/**
 * Installs the session rule, replacing any earlier copy, so it is safe on every SW start. A
 * session rule (not static) because initiatorDomains needs this install's extension id; it
 * survives SW restarts and ends with the browser session, like the jobs that need it.
 */
export async function installRefererRule(): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [REFERER_RULE_ID],
    addRules: [
      {
        id: REFERER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Referer', operation: 'set', value: PIXIV_REFERER }],
        },
        condition: {
          requestDomains: [PXIMG_HOST],
          initiatorDomains: [chrome.runtime.id],
          tabIds: [TAB_ID_NONE],
          resourceTypes: ['xmlhttprequest'],
        },
      },
    ],
  });
}
