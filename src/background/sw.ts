// Service worker entry. Chrome only wakes a stopped worker for listeners registered synchronously
// during the first evaluation of this module, so every listener is added at top level, before any
// await. Handlers that need initialized state await `ready`.

import { BADGE_BACKGROUND_COLOR, BADGE_TEXT_COLOR } from '../shared/constants';
import { createLogger } from '../shared/log';
import type { Envelope } from '../shared/messages';
import { createBadgeRenderer } from './badge';
import { openOrFocusOptions } from './options-tab';

const log = createLogger('sw');

// No job registry yet: the badge renders from an empty job list.
const badge = createBadgeRenderer(() => []);

function isSwMessage(message: unknown): message is Envelope<'sw'> {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Partial<Envelope>).target === 'sw' &&
    typeof (message as Partial<Envelope>).type === 'string'
  );
}

function onMessage(message: unknown): undefined {
  // Messages for other contexts (offscreen, tab) also reach this listener: ignore them without
  // holding the channel open.
  if (!isSwMessage(message)) return undefined;
  log.debug('no handler for', message.type);
  return undefined;
}

function onActionClicked(tab: chrome.tabs.Tab): void {
  openOrFocusOptions(tab).catch((error: unknown) => {
    log.warn('could not open the settings tab', error);
  });
}

chrome.runtime.onMessage.addListener(onMessage);
chrome.action.onClicked.addListener(onActionClicked);

async function boot(): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND_COLOR });
  await chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
  await badge.render();
}

/** Resolves once boot-time initialization is done. */
export const ready: Promise<void> = boot();
