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

// Row 8: the cause of a job that saved nothing.
function errorCause(list: Failure[], navigatorOnLine: boolean): ErrorCause {
  if (list.length > 0 && list.every((f) => f.kind === 'disk' || f.kind === 'dismissed')) {
    return 'disk';
  }
  if (!navigatorOnLine || (list.length > 0 && list.every((f) => f.kind === 'network'))) {
    return 'offline';
  }
  return 'server';
}

const isBytesForbidden = (file: FileTask): boolean =>
  (file.role === 'page' || file.role === 'zip') &&
  file.state === 'failed' &&
  file.failure?.status === 403;

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
  if (job.files.some(isBytesForbidden)) return { type: 'needsLogin' };

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
    if (saved > 0) {
      // 6
      if (failed.length > 0) {
        return { type: 'partial', folder, total: job.pagesTotal, saved, failedPages: failed };
      }
      // 7
      const metadata = job.files.find((file) => file.role === 'metadata');
      if (metadata && !landed(metadata)) {
        return { type: 'metadataOnly', folder, total: job.pagesTotal };
      }
      // 10
      return { type: 'saved', folder, pages: job.pagesTotal };
    }
  }

  // 8: no page, or no ugoira zip, was saved
  return { type: 'error', cause: errorCause(failures(job), navigatorOnLine) };
}
