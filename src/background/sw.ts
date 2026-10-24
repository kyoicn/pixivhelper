// Service worker entry (design-download-engine.md "Boot sequence"). Chrome only wakes a stopped
// worker for listeners registered synchronously during the first evaluation of this module, so
// every listener is added at top level, before any await. Handlers that need initialized state
// await `ready`.

import { BADGE_BACKGROUND_COLOR, BADGE_TEXT_COLOR } from '../shared/constants';
import { createLogger } from '../shared/log';
import { installRefererRule } from './dnr';
import { createEngine } from './engine';
import { createMessageRouter } from './handlers';
import { openOrFocusOptions } from './options-tab';

const log = createLogger('sw');

const engine = createEngine();

function onActionClicked(tab: chrome.tabs.Tab): void {
  openOrFocusOptions(tab).catch((error: unknown) => {
    log.warn('could not open the settings tab', error);
  });
}

/**
 * Referer rule, badge colors, job records, then the badge (correct within 1 s of a restart, PRD
 * §4.8), then Chrome's download UI back on if no job runs (R-005; before reconciliation, so a job
 * reconcile finishes restores through finalize like any other), then reconciliation and a pump of
 * every job, and the badge again for what that changed.
 */
async function boot(): Promise<void> {
  try {
    await installRefererRule();
  } catch (error) {
    // Jobs still run: without the Referer, originals answer 403 and the job ends in needs-login.
    log.error('could not install the Referer rule', error);
  }
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND_COLOR });
  await chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
  await engine.hydrate();
  await engine.badge.render();
  await engine.restoreDownloadUiIfIdle();
  await engine.reconcile();
  await engine.badge.render();
}

/** Resolves once boot-time initialization is done. Starts before the listeners below are added,
 * which is still within this synchronous first evaluation. */
export const ready: Promise<void> = boot();

chrome.runtime.onMessage.addListener(createMessageRouter(engine, ready));
chrome.downloads.onChanged.addListener((delta) => {
  ready
    .then(() => engine.onDownloadChanged(delta))
    .catch((error: unknown) => log.warn('download change not handled', delta.id, error));
});
chrome.action.onClicked.addListener(onActionClicked);
