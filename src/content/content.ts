// Content script entry (classic script, top frame of every www.pixiv.net page).

import { createLogger } from '../shared/log';

declare global {
  interface Window {
    __hfpInit?: boolean;
  }
}

const log = createLogger('content');

function init(): void {
  // The script can be injected twice into one document (e.g. after an extension reload).
  if (window.__hfpInit) return;
  window.__hfpInit = true;
  log.debug('init');
}

init();
