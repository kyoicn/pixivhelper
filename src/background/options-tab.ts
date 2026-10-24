// Toolbar click → settings tab (design-download-engine.md "Toolbar click → settings tab
// (options-tab.ts)"; PRD CUJ-3 step 1). runtime.openOptionsPage() is not used: its tab placement
// and cross-window focus are unspecified, and the PRD requires both.

import { exposeTestApi } from '../shared/test-hooks';

const OPTIONS_PAGE = 'options.html';

/**
 * The toolbar trigger e2e specs reach through `swEval` as `self.__hfpTest`, since Playwright cannot
 * click the toolbar icon (design-test-harness.md). Only `--e2e` builds and unit tests install it.
 */
export interface ActionTestApi {
  /** Runs the toolbar-click handler as if the icon were clicked while tab `tabId` was active. */
  clickAction(tabId: number): Promise<void>;
}

/**
 * Focuses the existing settings tab and its window, or opens one to the right of `tab` (the active
 * tab when the toolbar icon was clicked). getContexts finds the extension's own tabs without the
 * "tabs" permission.
 */
export async function openOrFocusOptions(tab: chrome.tabs.Tab): Promise<void> {
  const url = chrome.runtime.getURL(OPTIONS_PAGE);
  const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
  if (ctx && ctx.tabId !== -1) {
    await chrome.tabs.update(ctx.tabId, { active: true });
    await chrome.windows.update(ctx.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({
    url,
    index: tab.index + 1,
    windowId: tab.windowId,
    openerTabId: tab.id,
    active: true,
  });
}

// A function rather than an inline `if (__TEST_HOOKS__) { … }` block: unminified builds keep the
// text of a dead block, but drop a declaration referenced only from one, so prod sw.js carries no
// trace of the hook.
function installTestApi(): void {
  const api: ActionTestApi = {
    async clickAction(tabId) {
      await openOrFocusOptions(await chrome.tabs.get(tabId));
    },
  };
  exposeTestApi({ ...api });
}

if (__TEST_HOOKS__) installTestApi();
