// The SW's runtime.onMessage router (system.md §7; design-download-engine.md "API / Interface
// Contract"). Routes by target and type, checks the sender and validates the payload before any
// handler runs; every handler waits for the SW's boot (`ready`).

import { createLogger } from '../shared/log';
import {
  isContentScriptSender,
  isContentToSwMessage,
  isForTarget,
  isOffscreenSender,
  isOffscreenToSwEvent,
  type ContentToSwMessage,
  type ErrorResponse,
  type JobStartMessage,
  type ResponseMap,
} from '../shared/messages';
import { isSafeRelativeFolder } from '../shared/pattern';
import { getCaps } from './caps';
import type { Engine } from './engine';
import type { ErrorCode, StartRequest } from '../shared/job';
import { toView } from './view';

const log = createLogger('sw');

const OFFSCREEN_EVENTS: ReadonlySet<string> = new Set(['off/ready', 'off/failed', 'off/progress']);
const CONTENT_REQUESTS: ReadonlySet<string> = new Set([
  'job/start',
  'job/cancel',
  'job/listForTab',
  'caps/get',
]);

type SendResponse = (response: unknown) => void;
type Respond<T extends keyof ResponseMap> = (response: ResponseMap[T]) => void;

const failure = (error: ErrorCode): ErrorResponse => ({ ok: false, error });

/** The validated start payload without its envelope. */
export function startRequest(m: JobStartMessage): StartRequest {
  switch (m.mode) {
    case 'full':
      return { mode: m.mode, artworkId: m.artworkId, expectedFiles: m.expectedFiles };
    case 'retryPages':
      return {
        mode: m.mode,
        artworkId: m.artworkId,
        folder: m.folder,
        pages: [...m.pages],
        total: m.total,
      };
    case 'retryEncode':
      return { mode: m.mode, artworkId: m.artworkId, folder: m.folder, format: m.format };
    case 'retryMetadata':
      return { mode: m.mode, artworkId: m.artworkId, folder: m.folder };
  }
}

/**
 * Responds once the job is persisted, then resolves it. A retry's folder comes from the tab, so
 * it must pass the same safety check as a resolved one before it can reach chrome.downloads.
 */
async function handleStart(
  engine: Engine,
  message: JobStartMessage,
  tabId: number,
  respond: Respond<'job/start'>,
): Promise<void> {
  const request = startRequest(message);
  if (request.mode !== 'full' && !isSafeRelativeFolder(request.folder)) {
    log.warn('job/start with an unsafe folder');
    respond(failure('BAD_REQUEST'));
    return;
  }
  const job = await engine.start(request, tabId);
  respond({ ok: true, view: toView(job, null) });
  void engine.resolve(job.jobId);
}

async function handleRequest(
  engine: Engine,
  ready: Promise<void>,
  message: ContentToSwMessage,
  tabId: number,
  sendResponse: SendResponse,
): Promise<void> {
  try {
    await ready;
    switch (message.type) {
      case 'job/start':
        return await handleStart(engine, message, tabId, sendResponse);
      case 'job/cancel':
        sendResponse(await engine.cancel(message.jobId, tabId));
        return;
      case 'job/listForTab':
        sendResponse({ ok: true, views: engine.listForTab(tabId) });
        return;
      case 'caps/get':
        sendResponse({ ok: true, caps: await getCaps(message.width, message.height) });
        return;
    }
  } catch (error) {
    log.warn(message.type, 'failed', error);
    sendResponse(failure('INTERNAL'));
  }
}

/** The runtime.onMessage listener: `true` keeps the channel open for an async response. */
export function createMessageRouter(engine: Engine, ready: Promise<void>) {
  return function onMessage(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: SendResponse,
  ): true | undefined {
    // Messages for the offscreen document and tabs reach this listener too.
    if (!isForTarget(message, 'sw')) return undefined;

    if (OFFSCREEN_EVENTS.has(message.type)) {
      if (!isOffscreenSender(sender)) {
        log.warn('ignored', message.type, 'from a sender other than the offscreen document');
      } else if (!isOffscreenToSwEvent(message)) {
        log.warn('ignored an invalid', message.type);
      } else {
        ready
          .then(() => engine.onOffscreenEvent(message))
          .catch((error: unknown) => log.warn(message.type, 'failed', error));
      }
      return undefined;
    }

    if (!CONTENT_REQUESTS.has(message.type)) {
      log.debug('no handler for', message.type);
      return undefined;
    }
    const tabId = sender.tab?.id;
    if (tabId === undefined || !isContentScriptSender(sender)) {
      log.warn('refused', message.type, 'from a sender that is not a content script');
      sendResponse(failure('FORBIDDEN'));
      return undefined;
    }
    if (!isContentToSwMessage(message)) {
      log.warn('refused an invalid', message.type);
      sendResponse(failure('BAD_REQUEST'));
      return undefined;
    }
    void handleRequest(engine, ready, message, tabId, sendResponse);
    return true;
  };
}
