// Offscreen document entry and command router (design-offscreen-worker.md "Lifecycle", "API /
// Interface Contract"). The listener is registered synchronously at top level, so commands sent
// right after chrome.offscreen.createDocument() resolves are never lost.
//
// Task commands are acknowledged at once with { ok: true }. Each task then reports exactly one
// off/ready or off/failed event, possibly preceded by off/progress events, and nothing at all once
// it was aborted or released. off/fetchJson, off/probe and off/tasks are request/response.

import { createLogger } from '../shared/log';
import {
  isForTarget,
  isNonTabSender,
  isSwToOffscreenMessage,
  type ErrorResponse,
  type OffEncodeCommand,
  type OffFetchJsonResponse,
  type OffFetchZipCommand,
  type OffProbeResponse,
  type OffProgressEvent,
  type OffscreenMessage,
  type OffscreenToSwEvent,
  type ResponseMap,
} from '../shared/messages';
import type { Failure } from '../shared/types';
import { fetchApiJson, fetchOriginal, fetchZip } from './fetch-bytes';
import { TaskTable, type Task, type TaskKind, type ZipBytes } from './tasks';
import { probe } from './ugoira/codec';
import { EncodeError, encodeUgoira } from './ugoira/encode';

const log = createLogger('offscreen');

/** Progress events of one task: at most one per interval, i.e. 4/s. */
const PROGRESS_INTERVAL_MS = 250;
/** The zip Blob's type; the downloaded file's name comes from the SW. */
const ZIP_MIME = 'application/zip';

type OffscreenResponse = ResponseMap[OffscreenMessage['type']];
type SendResponse = (response: OffscreenResponse) => void;

/** A Blob to expose (a saved zip keeps its bytes as well), retained zip bytes only, or a failure. */
type TaskOutcome =
  | { ok: true; blob: Blob; zipBytes?: ZipBytes }
  | { ok: true; zipBytes: ZipBytes }
  | { ok: false; failure: Failure };

const ACK: OffscreenResponse = { ok: true };

const tasks = new TaskTable();

function onMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): true | undefined {
  // runtime.sendMessage from content scripts and SW-bound events also reach this document: ignore
  // everything not addressed to it without holding the channel open.
  if (!isForTarget(message, 'offscreen')) return undefined;
  if (!isNonTabSender(sender)) {
    log.warn('refused', message.type, 'from a tab');
    sendResponse(refusal('FORBIDDEN'));
    return undefined;
  }
  if (!isSwToOffscreenMessage(message)) {
    log.warn('invalid', message.type);
    sendResponse(refusal('BAD_REQUEST'));
    return undefined;
  }
  let reply: OffscreenResponse | Promise<OffscreenResponse>;
  try {
    reply = handle(message);
  } catch (error) {
    log.error(message.type, 'failed:', error);
    reply = refusal('INTERNAL');
  }
  if (!(reply instanceof Promise)) {
    sendResponse(reply);
    return undefined;
  }
  reply.then(sendResponse, (error: unknown) => {
    log.error(message.type, 'failed:', error);
    sendResponse(refusal('INTERNAL'));
  });
  return true;
}

function handle(message: OffscreenMessage): OffscreenResponse | Promise<OffscreenResponse> {
  switch (message.type) {
    case 'off/fetchBytes': {
      const { url } = message;
      void runTask(message.taskId, 'bytes', async (task) => {
        const result = await fetchOriginal(url, task.abort.signal);
        return result.ok ? { ok: true, blob: result.value } : result;
      });
      return ACK;
    }
    case 'off/makeText': {
      const { text, mime } = message;
      // A string Blob part is always encoded as UTF-8.
      void runTask(message.taskId, 'text', () => ({
        ok: true,
        blob: new Blob([text], { type: `${mime};charset=utf-8` }),
      }));
      return ACK;
    }
    case 'off/fetchZip':
      void runTask(message.taskId, 'zip', (task) => zipTask(message, task));
      return ACK;
    case 'off/encode':
      void runTask(message.taskId, 'encode', (task) => encodeTask(message, task));
      return ACK;
    case 'off/abort':
      for (const taskId of message.taskIds) tasks.abort(taskId);
      return ACK;
    case 'off/release':
      for (const taskId of message.taskIds) tasks.release(taskId, message.keepRetained ?? false);
      return ACK;
    case 'off/fetchJson':
      return fetchApiJson(message.url).then((result): OffFetchJsonResponse => ({
        ok: true,
        result,
      }));
    case 'off/probe':
      return probe(message.width, message.height).then((caps): OffProbeResponse => ({
        ok: true,
        caps,
      }));
    case 'off/tasks':
      return { ok: true, tasks: tasks.snapshot() };
  }
}

/**
 * Runs `work` as task `taskId` and reports its outcome once, as off/ready or off/failed; an
 * exception becomes the Failure. Nothing is reported once the task was aborted or released.
 */
async function runTask(
  taskId: string,
  kind: TaskKind,
  work: (task: Task) => TaskOutcome | Promise<TaskOutcome>,
): Promise<void> {
  const task = tasks.start(taskId, kind);
  try {
    const outcome = await work(task);
    if (!tasks.isLive(task)) return;
    if (outcome.ok) reportReady(task, outcome);
    else reportFailed(task, outcome.failure);
  } catch (error) {
    if (!tasks.isLive(task)) return;
    // encodeUgoira already logged its own failures.
    if (!(error instanceof EncodeError)) log.error(`${kind} task failed:`, error);
    reportFailed(task, failureOf(kind, error));
  }
}

async function zipTask(cmd: OffFetchZipCommand, task: Task): Promise<TaskOutcome> {
  const progress = throttledProgress(task);
  const result = await fetchZip(cmd.url, task.abort.signal, (loaded, total) => {
    progress.push({
      target: 'sw',
      type: 'off/progress',
      taskId: cmd.taskId,
      phase: 'zip',
      loaded,
      total,
    });
  });
  if (!result.ok) return result;
  progress.flush();
  const zipBytes = result.value;
  // The Blob is a second copy for the download only; the SW releases it with keepRetained once the
  // zip landed, keeping the bytes for the encode.
  return cmd.save
    ? { ok: true, blob: new Blob([zipBytes], { type: ZIP_MIME }), zipBytes }
    : { ok: true, zipBytes };
}

async function encodeTask(cmd: OffEncodeCommand, task: Task): Promise<TaskOutcome> {
  const progress = throttledProgress(task);
  const blob = await encodeUgoira({
    zip: tasks.get(cmd.zipTaskId)?.zipBytes,
    frames: cmd.frames,
    format: cmd.format,
    avcCodec: cmd.avcCodec,
    signal: task.abort.signal,
    onProgress: (done, total) => {
      progress.push({
        target: 'sw',
        type: 'off/progress',
        taskId: cmd.taskId,
        phase: 'encode',
        done,
        total,
      });
    },
  });
  return { ok: true, blob };
}

function reportReady(task: Task, outcome: Exclude<TaskOutcome, { ok: false }>): void {
  const { taskId } = task;
  if ('blob' in outcome) {
    const blobUrl = tasks.markReady(task, outcome.blob, outcome.zipBytes);
    emit({ target: 'sw', type: 'off/ready', taskId, blobUrl, size: outcome.blob.size });
  } else {
    tasks.markRetained(task, outcome.zipBytes);
    emit({ target: 'sw', type: 'off/ready', taskId, size: outcome.zipBytes.byteLength });
  }
}

function reportFailed(task: Task, failure: Failure): void {
  tasks.markFailed(task);
  emit({ target: 'sw', type: 'off/failed', taskId: task.taskId, failure });
}

/**
 * The Failure for an exception at the task boundary; encode errors carry their own detail. Any
 * other task's exception is a bug, not a fetch outcome (fetchWithRetry never throws): `internal`.
 */
function failureOf(kind: TaskKind, error: unknown): Failure {
  if (kind === 'encode') {
    const detail = error instanceof EncodeError ? error.detail : 'encoder';
    return { kind: 'encode', detail, attempts: 1 };
  }
  return { kind: 'internal', detail: 'exception', attempts: 1 };
}

/**
 * Sends the first progress event at once, then at most one per PROGRESS_INTERVAL_MS; a frame or
 * chunk arriving later than that is always sent, so a steady flow yields at least 1/s. `flush`
 * sends the latest event held back. Nothing is sent once the task is no longer live.
 */
function throttledProgress(task: Task): { push(event: OffProgressEvent): void; flush(): void } {
  let sentAt = -Infinity;
  let held: OffProgressEvent | null = null;
  const send = (event: OffProgressEvent): void => {
    held = null;
    if (tasks.isLive(task)) emit(event);
  };
  return {
    push(event) {
      const now = performance.now();
      if (now - sentAt < PROGRESS_INTERVAL_MS) {
        held = event;
        return;
      }
      sentAt = now;
      send(event);
    },
    flush() {
      if (held) send(held);
    },
  };
}

function emit(event: OffscreenToSwEvent): void {
  chrome.runtime.sendMessage(event).catch((error: unknown) => {
    log.warn(event.type, 'not delivered to the service worker', error);
  });
}

function refusal(error: ErrorResponse['error']): ErrorResponse {
  return { ok: false, error };
}

chrome.runtime.onMessage.addListener(onMessage);
