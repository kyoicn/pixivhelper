// Toolbar click → settings tab (design-download-engine.md "Toolbar click → settings tab
// (options-tab.ts)"; PRD CUJ-3 step 1). runtime.openOptionsPage() is not used: its tab placement
// and cross-window focus are unspecified, and the PRD requires both.

const OPTIONS_PAGE = 'options.html';

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
