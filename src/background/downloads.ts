// File transitions driven by offscreen events and chrome.downloads (design-download-engine.md
// "Offscreen events → file transitions"). Each function is a registry mutator for the file at
// `idx`; an event that no longer matches the file (stale task, duplicate, already ended) changes
// nothing.

import { ugoiraPercent } from '../shared/progress';
import type { Failure } from '../shared/types';
import type { OffFailedEvent, OffProgressEvent, OffReadyEvent } from '../shared/messages';
import type { Effect } from './registry';
import { fileAt, isTerminal, settle, settleFile } from './scheduler';
import type { FileTask, JobRecord } from '../shared/job';

/** chrome.downloads InterruptReason for a dismissed Save As dialog. */
const USER_CANCELED = 'USER_CANCELED';
const FORBIDDEN = 403;

/** The Chrome download that writes `file`, `uniquify` so an earlier copy is never overwritten. */
export function downloadOptions(job: JobRecord, file: FileTask): chrome.downloads.DownloadOptions {
  return {
    url: file.blobUrl ?? '',
    filename: `${job.folder ?? ''}/${file.name}`,
    conflictAction: 'uniquify',
    saveAs: false,
  };
}

/** `USER_CANCELED` (the Save As dialog was dismissed) → dismissed; every other reason → disk. */
export function interruptFailure(reason: string | undefined): Failure {
  return {
    kind: reason === USER_CANCELED ? 'dismissed' : 'disk',
    ...(reason === undefined ? {} : { detail: reason }),
    attempts: 1,
  };
}

function isRunning(file: FileTask | undefined, taskId: string): file is FileTask {
  return file?.state === 'fetching' && file.taskId === taskId;
}

/** A stale task (failed, skipped or replaced since) only needs its Blob freed. */
function staleTask(file: FileTask | undefined, taskId: string): Effect[] {
  const replaced = file?.taskId !== taskId;
  const ended = file?.state === 'failed' || file?.state === 'skipped';
  return replaced || ended ? [{ type: 'release', taskIds: [taskId] }] : [];
}

/** Release a landed file's task; a zip keeps its bytes while its video is still to be encoded. */
export function releaseLanded(job: JobRecord, file: FileTask): Effect[] {
  if (file.taskId === undefined) return [];
  const videoPending = job.files.some((f) => f.role === 'video' && !isTerminal(f));
  const keepRetained = file.role === 'zip' && videoPending;
  return [{ type: 'release', taskIds: [file.taskId], ...(keepRetained ? { keepRetained } : {}) }];
}

/**
 * off/ready: a file to save goes `fetching → saving` with its blob URL, persisted before the
 * download call; the zip of a retryEncode (save: false) is held in memory and is done.
 */
export function onOffReady(job: JobRecord, idx: number, event: OffReadyEvent): Effect[] {
  const file = fileAt(job, idx);
  if (!isRunning(file, event.taskId)) return staleTask(file, event.taskId);
  if (!file.save) {
    settleFile(file, 'done');
    return settle(job);
  }
  if (event.blobUrl === undefined) {
    settleFile(file, 'failed', { kind: 'internal', detail: 'no blob', attempts: 1 });
    return settle(job, [{ type: 'release', taskIds: [event.taskId] }]);
  }
  file.state = 'saving';
  file.blobUrl = event.blobUrl;
  return [{ type: 'download', idx }];
}

/**
 * off/failed: the file failed. A 403 on an original or the zip stops the job dispatching new files
 * (PRD CUJ-5 step 9); files already in flight finish.
 */
export function onOffFailed(job: JobRecord, idx: number, event: OffFailedEvent): Effect[] {
  const file = fileAt(job, idx);
  if (!isRunning(file, event.taskId)) return staleTask(file, event.taskId);
  settleFile(file, 'failed', event.failure);
  if (event.failure.status === FORBIDDEN && (file.role === 'page' || file.role === 'zip')) {
    job.stopReason ??= 'forbidden';
  }
  return settle(job, [{ type: 'release', taskIds: [event.taskId] }]);
}

/** off/progress: zip bytes or encoded frames; the percent shown never goes down. Display only. */
export function onOffProgress(job: JobRecord, idx: number, event: OffProgressEvent): Effect[] {
  const file = fileAt(job, idx);
  const ugoira = job.ugoira;
  if (!isRunning(file, event.taskId) || !ugoira) return [];
  if (event.phase === 'zip') {
    ugoira.zipLoaded = event.loaded;
    ugoira.zipTotal = event.total;
  } else {
    ugoira.encDone = event.done;
  }
  ugoira.percent = ugoiraPercent(job);
  return [{ type: 'push', throttle: true }];
}

/** downloads.download resolved: remember the id. A file cancelled meanwhile cancels it again. */
export function onDownloadStarted(job: JobRecord, idx: number, downloadId: number): Effect[] {
  const file = fileAt(job, idx);
  if (file?.downloadId === downloadId) return [];
  if (file?.state !== 'saving' || file.downloadId !== undefined) {
    return [{ type: 'cancelDownload', downloadIds: [downloadId] }];
  }
  file.downloadId = downloadId;
  return [];
}

/** downloads.download threw (e.g. "Invalid filename"): the file failed with `disk`. */
export function onHandOffFailed(
  job: JobRecord,
  idx: number,
  blobUrl: string,
  detail: string,
): Effect[] {
  const file = fileAt(job, idx);
  if (file?.state !== 'saving' || file.blobUrl !== blobUrl || file.downloadId !== undefined) {
    return [];
  }
  settleFile(file, 'failed', { kind: 'disk', detail, attempts: 1 });
  return settle(
    job,
    file.taskId === undefined ? [] : [{ type: 'release', taskIds: [file.taskId] }],
  );
}

function isSavingAs(file: FileTask | undefined, downloadId: number): file is FileTask {
  return (
    file?.state === 'saving' && (file.downloadId === undefined || file.downloadId === downloadId)
  );
}

/** downloads.onChanged `complete`: `saving → done`. */
export function onDownloadComplete(job: JobRecord, idx: number, downloadId: number): Effect[] {
  const file = fileAt(job, idx);
  if (!isSavingAs(file, downloadId)) return [];
  file.downloadId = downloadId;
  settleFile(file, 'done');
  return settle(job, releaseLanded(job, file));
}

/** downloads.onChanged `interrupted`: `saving → failed` (dismissed or disk). */
export function onDownloadInterrupted(
  job: JobRecord,
  idx: number,
  downloadId: number,
  reason: string | undefined,
): Effect[] {
  const file = fileAt(job, idx);
  if (!isSavingAs(file, downloadId)) return [];
  file.downloadId = downloadId;
  settleFile(file, 'failed', interruptFailure(reason));
  return settle(
    job,
    file.taskId === undefined ? [] : [{ type: 'release', taskIds: [file.taskId] }],
  );
}
