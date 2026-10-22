// ENG-002 spike service worker. Driven by scripts/spike/run.mjs through
// serviceWorker.evaluate(() => self.spike.<fn>(...)); never shipped.

const RULE_ID = 1;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const POLL_MS = 100;

// Every DNR match, for diagnostics (declarativeNetRequestFeedback, unpacked only).
const ruleMatches = [];
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
  ruleMatches.push({
    ruleId: info.rule.ruleId,
    tabId: info.request.tabId,
    type: info.request.type,
    initiator: info.request.initiator ?? null,
    url: info.request.url,
  });
});

// 'spec' is system.md §8.2 as written; 'fallback' omits initiatorDomains.
function refererRule(variant) {
  const condition = { requestDomains: ['i.pximg.net'] };
  if (variant === 'spec') condition.initiatorDomains = [chrome.runtime.id];
  condition.tabIds = [-1];
  condition.resourceTypes = ['xmlhttprequest'];
  return {
    id: RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://www.pixiv.net/' }],
    },
    condition,
  };
}

async function setRule(variant) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [RULE_ID],
    addRules: variant ? [refererRule(variant)] : [],
  });
  return chrome.declarativeNetRequest.getSessionRules();
}

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'ENG-002 spike: fetch i.pximg.net bytes and hand blob: URLs to downloads',
  });
}

async function offscreen(cmd) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'offscreen', ...cmd });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadAndWait(url, filename) {
  const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [item] = await chrome.downloads.search({ id });
    if (item && item.state !== 'in_progress') {
      return {
        id,
        state: item.state,
        error: item.error ?? null,
        filename: item.filename,
        fileSize: item.fileSize,
        bytesReceived: item.bytesReceived,
      };
    }
    await sleep(POLL_MS);
  }
  return { id, state: 'timeout', error: null, filename: null, fileSize: -1, bytesReceived: -1 };
}

async function tabAjax(urlPattern, path) {
  const tabs = await chrome.tabs.query({ url: urlPattern });
  if (tabs.length === 0) return { exception: 'no tab matching ' + urlPattern };
  return chrome.tabs.sendMessage(tabs[0].id, { cmd: 'ajax', path }, { frameId: 0 });
}

self.spike = {
  extensionId: () => chrome.runtime.id,
  setRule,
  clearMatches: () => {
    ruleMatches.length = 0;
  },
  matches: () => ruleMatches.slice(),
  offscreen,
  downloadAndWait,
  tabAjax,
};
