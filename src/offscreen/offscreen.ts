// Offscreen document entry. The listener is registered synchronously at top level, so commands sent
// right after chrome.offscreen.createDocument() resolves are never lost.

import { createLogger } from '../shared/log';
import type { Envelope } from '../shared/messages';

const log = createLogger('offscreen');

function isOffscreenMessage(message: unknown): message is Envelope<'offscreen'> {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Partial<Envelope>).target === 'offscreen' &&
    typeof (message as Partial<Envelope>).type === 'string'
  );
}

function onMessage(message: unknown): undefined {
  // runtime.sendMessage from content scripts and SW-bound events also reach this document: ignore
  // everything not addressed to it without holding the channel open.
  if (!isOffscreenMessage(message)) return undefined;
  log.debug('no handler for', message.type);
  return undefined;
}

chrome.runtime.onMessage.addListener(onMessage);
