// ENG-002 spike content script: same-origin pixiv ajax from the isolated world.
// It never touches the page DOM, so the DOM captures stay clean. Never shipped.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.cmd !== 'ajax') return false;
  (async () => {
    const res = await fetch(msg.path);
    const json = await res.json();
    return {
      status: res.status,
      error: json.error,
      message: json.message,
      illustType: json.body?.illustType ?? null,
      xRestrict: json.body?.xRestrict ?? null,
    };
  })().then(sendResponse, (e) => sendResponse({ exception: String(e) }));
  return true;
});
