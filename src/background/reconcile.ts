// SW restart reconciliation (design-download-engine.md "Hydration and reconciliation"). A hydrated
// record may lag behind reality: the offscreen document kept working and Chrome kept downloading
// while the SW was stopped, and the SW may have died between persisting an intent and acting on
// it. This mutator compares each in-flight file with the offscreen task table and Chrome's
// download list, then pumps.

import type { OffTaskSnapshot } from '../shared/messages';
import { interruptFailure, releaseLanded } from './downloads';
import type { Effect } from './registry';
import { settle, settleFile } from './scheduler';
import type { FileTask, JobRecord } from '../shared/job';

export interface ReconcileFacts {
  /** The offscreen task table by taskId; empty when no offscreen document exists. */
  tasks: ReadonlyMap<string, OffTaskSnapshot>;
  /** downloads.search results by id, for saving files that have a downloadId. */
  byId: ReadonlyMap<number, chrome.downloads.DownloadItem>;
  /** downloads.search results by blob URL, for saving files that died before storing the id. */
  byUrl: ReadonlyMap<string, chrome.downloads.DownloadItem>;
}

function requeue(file: FileTask): void {
  file.state = 'queued';
  delete file.taskId;
  delete file.blobUrl;
  delete file.downloadId;
}

function release(file: FileTask): Effect[] {
  return file.taskId === undefined ? [] : [{ type: 'release', taskIds: [file.taskId] }];
}

/**
 * `fetching`/`ready`: a running task is kept; a finished one is handed to Chrome now (or is done,
 * for a zip held in memory); a task the document does not know is fetched again.
 */
function reconcileTask(file: FileTask, facts: ReconcileFacts): Effect[] {
  const task = file.taskId === undefined ? undefined : facts.tasks.get(file.taskId);
  if (!task) {
    requeue(file);
    return [];
  }
  if (task.state === 'running') {
    file.state = 'fetching';
    return [];
  }
  if (!file.save) {
    settleFile(file, 'done');
    return [];
  }
  if (task.state === 'ready' && task.blobUrl !== undefined) {
    file.state = 'saving';
    file.blobUrl = task.blobUrl;
    return [{ type: 'download', idx: file.idx }];
  }
  const stale = release(file);
  requeue(file);
  return stale;
}

/**
 * `saving` with a downloadId: Chrome's state decides (complete → done, interrupted → failed,
 * in progress → keep, missing → failed{disk}). Without one, the SW died around the download
 * call: adopt the download Chrome has for the blob URL, else issue it now (or fetch again when
 * the Blob is gone too).
 */
function reconcileDownload(job: JobRecord, file: FileTask, facts: ReconcileFacts): Effect[] {
  const item =
    file.downloadId !== undefined
      ? facts.byId.get(file.downloadId)
      : file.blobUrl === undefined
        ? undefined
        : facts.byUrl.get(file.blobUrl);
  if (!item) {
    if (file.downloadId !== undefined) {
      settleFile(file, 'failed', { kind: 'disk', detail: 'download missing', attempts: 1 });
      return release(file);
    }
    const task = file.taskId === undefined ? undefined : facts.tasks.get(file.taskId);
    if (task?.blobUrl !== undefined && task.blobUrl === file.blobUrl) {
      return [{ type: 'download', idx: file.idx }];
    }
    requeue(file);
    return [];
  }
  file.downloadId = item.id;
  if (item.state === 'complete') {
    settleFile(file, 'done');
    return releaseLanded(job, file);
  }
  if (item.state === 'interrupted') {
    settleFile(file, 'failed', interruptFailure(item.error));
    return release(file);
  }
  return [];
}

/** Mutator for one hydrated `transferring` job. */
export function reconcileJob(job: JobRecord, facts: ReconcileFacts): Effect[] {
  if (job.phase !== 'transferring') return [];
  const leading: Effect[] = [];
  for (const file of job.files) {
    if (file.state === 'fetching' || file.state === 'ready') {
      leading.push(...reconcileTask(file, facts));
    } else if (file.state === 'saving') {
      leading.push(...reconcileDownload(job, file, facts));
    }
  }
  return settle(job, leading);
}
