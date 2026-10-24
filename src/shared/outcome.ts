// The only place a job's end state is decided (system.md §10). Rows are tried top to bottom and
// the first match wins; the row numbers below are the table's.

import type { FileTask, JobRecord } from './job';
import type { ErrorCause, Failure, JobOutcome } from './types';

const landed = (file: FileTask): boolean => file.state === 'done';

/** 0-based indexes of this run's pages that did not land, in page order. */
function failedPages(job: JobRecord): number[] {
  return job.files.flatMap((file) =>
    file.role === 'page' && !landed(file) && file.page !== undefined ? [file.page] : [],
  );
}

function failures(job: JobRecord): Failure[] {
  const list = job.files.flatMap((file) =>
    file.state === 'failed' && file.failure ? [file.failure] : [],
  );
  return job.apiFailure ? [job.apiFailure.failure, ...list] : list;
}

/** The failed request got an HTTP response on some attempt (system.md §10 row 8, D13). */
export const gotAnswer = (f: Failure): boolean =>
  f.kind === 'http' || f.kind === 'pixivError' || f.answered === true;

// Row 8: the cause of a job that saved nothing. "No connection" is judged per click: only when no
// request of this job got an HTTP response (`job.answered` records the successful API calls, a
// failed request carries its own answer) and every failure is a network error (R-004 S3).
// `internal`, `timeout` and every HTTP status read as `server` (system.md §10).
function errorCause(job: JobRecord, list: Failure[], navigatorOnLine: boolean): ErrorCause {
  if (list.length > 0 && list.every((f) => f.kind === 'disk' || f.kind === 'dismissed')) {
    return 'disk';
  }
  const answered = job.answered === true || list.some(gotAnswer);
  if (
    !navigatorOnLine ||
    (!answered && list.length > 0 && list.every((f) => f.kind === 'network'))
  ) {
    return 'offline';
  }
  return 'server';
}

const isBytes = (file: FileTask): boolean => file.role === 'page' || file.role === 'zip';

const isBytesForbidden = (file: FileTask): boolean =>
  isBytes(file) && file.state === 'failed' && file.failure?.status === 403;

/** The resolver's login-wall stop (R-003): `forbidden` before any byte request was made. */
const isLoginWallStop = (job: JobRecord): boolean =>
  job.stopReason === 'forbidden' &&
  !job.files.some((file) => isBytes(file) && file.state === 'failed');

export function classifyOutcome(job: JobRecord, navigatorOnLine: boolean): JobOutcome {
  // 1
  if (job.stopReason === 'cancelled') return { type: 'cancelled' };

  const api = job.apiFailure;
  if (api) {
    const { kind, status } = api.failure;
    // 2
    if (status === 404 || (api.endpoint === 'illust' && kind === 'pixivError')) {
      return { type: 'unavailable' };
    }
    // 3
    if (status === 401 || status === 403 || kind === 'pixivError') {
      return { type: 'error', cause: 'refused' };
    }
  }

  // 4
  if (job.files.some(isBytesForbidden) || isLoginWallStop(job)) return { type: 'needsLogin' };

  const folder = job.folder ?? '';

  // A failed resolve saved nothing (row 8), so rows 5–7, 9 and 10 need a resolved plan.
  if (!api && job.kind === 'ugoira' && job.ugoira) {
    const { format } = job.ugoira;
    const zip = job.files.find((file) => file.role === 'zip');
    if (zip && landed(zip)) {
      const framesJson = job.files.find((file) => file.role === 'framesJson');
      const video = job.files.find((file) => file.role === 'video');
      // 5
      if (
        format !== 'zip' &&
        video?.failure?.kind === 'encode' &&
        (!framesJson || landed(framesJson))
      ) {
        return { type: 'encodeFailed', folder, format };
      }
      // 9: a save failed after the zip landed (the video, frames.json, or only metadata.json)
      if (!job.files.every(landed)) return { type: 'error', cause: 'disk' };
      // 10
      return { type: 'saved', folder, format };
    }
  } else if (!api && job.kind === 'pages') {
    const failed = failedPages(job);
    const saved = job.pagesTotal - failed.length;
    const metadata = job.files.find((file) => file.role === 'metadata');
    const metadataFailed = metadata !== undefined && !landed(metadata);
    if (saved > 0) {
      // 6: the flag makes the Retry write metadata.json again with the pages (R-007)
      if (failed.length > 0) {
        return {
          type: 'partial',
          folder,
          total: job.pagesTotal,
          saved,
          failedPages: failed,
          ...(metadataFailed ? { metadataFailed: true } : {}),
        };
      }
      // 7
      if (metadataFailed) {
        return { type: 'metadataOnly', folder, total: job.pagesTotal };
      }
      // 10
      return { type: 'saved', folder, pages: job.pagesTotal };
    }
  }

  // 8: no page, or no ugoira zip, was saved
  return { type: 'error', cause: errorCause(job, failures(job), navigatorOnLine) };
}
