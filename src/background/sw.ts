// Service worker entry. Chrome only wakes a stopped worker for listeners registered synchronously
// during the first evaluation of this module, so every listener is added at top level, before any
// await. Handlers that need initialized state await `ready`.

import { createLogger } from '../shared/log';
import type { Envelope } from '../shared/messages';

const log = createLogger('sw');

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

chrome.runtime.onMessage.addListener(onMessage);

/** Resolves once boot-time initialization is done. */
export const ready: Promise<void> = Promise.resolve();
