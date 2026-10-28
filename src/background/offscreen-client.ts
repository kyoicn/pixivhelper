// The SW's side of the offscreen document (design-offscreen-worker.md "Lifecycle", D16): one
// document for the whole extension, created on demand and closed after a grace period once idle.

import {
  OFFSCREEN_CLOSE_GRACE_MS,
  OFFSCREEN_DOCUMENT_PATH,
  OFFSCREEN_READY_WAIT_MS,
  OFFSCREEN_RESEND_DELAY_MS,
} from '../shared/constants';
import { createLogger } from '../shared/log';
import type { ResponseMap, SwToOffscreenMessage } from '../shared/messages';

const log = createLogger('offscreen-client');

const JUSTIFICATION =
  'Fetch pixiv originals into Blob URLs for chrome.downloads and encode ugoira videos with WebCodecs.';
/** Chrome's rejection of sendMessage when the document has no listener (yet, or any more). */
const RECEIVING_END_GONE = 'Receiving end does not exist';
/** Chrome's rejection of createDocument when a document already exists. */
const ALREADY_CREATED = 'Only a single offscreen document may be created';

/** An offscreen command without its envelope target; `send` adds `target: 'offscreen'`. */
export type OffscreenCommand = SwToOffscreenMessage extends infer M
  ? M extends SwToOffscreenMessage
    ? Omit<M, 'target'>
    : never
  : never;

/** createDocument in flight, this SW instance. */
let creating: Promise<void> | null = null;
/** closeDocument in flight, this SW instance. */
let closing: Promise<void> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Creates the offscreen document unless it exists; concurrent callers share one creation. Never
 * creates over a closing one.
 */
export async function ensureOffscreen(): Promise<void> {
  cancelScheduledClose();
  if (closing) await closing;
  // getContexts lists a document before its script has run, so an in-flight creation must be
  // awaited before the lookup is consulted (the iteration-4 race).
  if (creating) return creating;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });
  if (contexts.length > 0) return;
  if (creating) return creating;
  // BLOBS truthfully covers the Blob URL work; no reason exists for WebCodecs. Chrome imposes no
  // lifetime limit with it.
  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['BLOBS'],
      justification: JUSTIFICATION,
    })
    .catch((error: unknown) => {
      if (!isAlreadyCreated(error)) throw error;
    })
    .finally(() => {
      creating = null;
    });
  return creating;
}

/**
 * Closes the document after OFFSCREEN_CLOSE_GRACE_MS, freeing retained zips and encoder memory.
 * Call when the job registry is empty and no caps probe is pending; any ensureOffscreen() (so any
 * new command) cancels it, or awaits the close if it has already started.
 */
export function scheduleClose(): void {
  cancelScheduledClose();
  closeTimer = setTimeout(() => {
    closeTimer = null;
    closing = chrome.offscreen
      .closeDocument()
      .catch((error: unknown) => {
        log.debug('offscreen document already closed', error);
      })
      .finally(() => {
        closing = null;
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

function isAlreadyCreated(error: unknown): boolean {
  return error instanceof Error && error.message.includes(ALREADY_CREATED);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends `cmd` to the offscreen document, creating it first if needed. "Receiving end does not
 * exist" means the document has no listener yet (its script has not run) or no longer (it is
 * unloading): the command was not delivered, so it is safe to resend. It is resent every
 * OFFSCREEN_RESEND_DELAY_MS for at most OFFSCREEN_READY_WAIT_MS from the first such rejection;
 * then the error propagates and the caller fails the file as `internal`. Any other rejection
 * propagates at once.
 */
export async function send<C extends OffscreenCommand>(cmd: C): Promise<ResponseMap[C['type']]> {
  const message = { ...cmd, target: 'offscreen' } as SwToOffscreenMessage;
  let deadline: number | null = null;
  for (;;) {
    await ensureOffscreen();
    try {
      return await chrome.runtime.sendMessage<SwToOffscreenMessage, ResponseMap[C['type']]>(
        message,
      );
    } catch (error) {
      if (!isReceivingEndGone(error)) throw error;
      deadline ??= Date.now() + OFFSCREEN_READY_WAIT_MS;
      if (Date.now() + OFFSCREEN_RESEND_DELAY_MS > deadline) throw error;
      log.debug('offscreen document not listening yet, resending', cmd.type);
      await sleep(OFFSCREEN_RESEND_DELAY_MS);
    }
  }
}
