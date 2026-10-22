// The SW's side of the offscreen document (design-offscreen-worker.md "Lifecycle"): one document
// for the whole extension, created on demand and closed after a grace period once idle.

import { OFFSCREEN_CLOSE_GRACE_MS, OFFSCREEN_DOCUMENT_PATH } from '../shared/constants';
import { createLogger } from '../shared/log';
import type { ResponseMap, SwToOffscreenMessage } from '../shared/messages';

const log = createLogger('offscreen-client');

const JUSTIFICATION =
  'Fetch pixiv originals into Blob URLs for chrome.downloads and encode ugoira videos with WebCodecs.';
/** Chrome's rejection of sendMessage when the document has no listener (yet, or any more). */
const RECEIVING_END_GONE = 'Receiving end does not exist';

/** An offscreen command without its envelope target; `send` adds `target: 'offscreen'`. */
export type OffscreenCommand = SwToOffscreenMessage extends infer M
  ? M extends SwToOffscreenMessage
    ? Omit<M, 'target'>
    : never
  : never;

let creating: Promise<void> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

/** Creates the offscreen document unless it exists; concurrent callers share one creation. */
export async function ensureOffscreen(): Promise<void> {
  cancelScheduledClose();
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });
  if (contexts.length > 0) return;
  // BLOBS truthfully covers the Blob URL work; no reason exists for WebCodecs. Chrome imposes no
  // lifetime limit with it.
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['BLOBS'],
      justification: JUSTIFICATION,
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

/**
 * Closes the document after OFFSCREEN_CLOSE_GRACE_MS, freeing retained zips and encoder memory.
 * Call when the job registry is empty and no caps probe is pending; any ensureOffscreen() (so any
 * new command) cancels it.
 */
export function scheduleClose(): void {
  cancelScheduledClose();
  closeTimer = setTimeout(() => {
    closeTimer = null;
    chrome.offscreen.closeDocument().catch((error: unknown) => {
      log.debug('offscreen document already closed', error);
    });
  }, OFFSCREEN_CLOSE_GRACE_MS);
}

export function cancelScheduledClose(): void {
  if (closeTimer === null) return;
  clearTimeout(closeTimer);
  closeTimer = null;
}

function isReceivingEndGone(error: unknown): boolean {
  return error instanceof Error && error.message.includes(RECEIVING_END_GONE);
}

/**
 * Sends `cmd` to the offscreen document, creating it first if needed. If the document turns out
 * to have no listener, it is re-ensured and the command resent once.
 */
export async function send<C extends OffscreenCommand>(cmd: C): Promise<ResponseMap[C['type']]> {
  const message = { ...cmd, target: 'offscreen' } as SwToOffscreenMessage;
  await ensureOffscreen();
  try {
    return await chrome.runtime.sendMessage<SwToOffscreenMessage, ResponseMap[C['type']]>(message);
  } catch (error) {
    if (!isReceivingEndGone(error)) throw error;
    log.debug('offscreen document unreachable, re-ensuring', cmd.type);
    await ensureOffscreen();
    return await chrome.runtime.sendMessage<SwToOffscreenMessage, ResponseMap[C['type']]>(message);
  }
}
