// Busy-state progress (PRD §4.7.5; design-offscreen-worker.md "Progress").

import type { FileTask, JobRecord } from './job';
import type { JobProgress } from './types';

/** Share of the whole-job percent covered by the frame zip when a video follows it. */
const ZIP_SHARE = 40;
const FULL = 100;
/** Highest percent shown until every file of the job has landed. */
const RUNNING_CAP = 99;

const landed = (file: FileTask): boolean => file.state === 'done';

/** `k / N`: pages landed in this run plus pages saved by an earlier run, of all pages. */
export function pagesProgress(job: JobRecord): JobProgress {
  const done = job.files.filter((file) => file.role === 'page' && landed(file)).length;
  return { kind: 'pages', done: job.pagesOffset + done, total: job.pagesTotal };
}

function encodeStarted(job: JobRecord): boolean {
  const video = job.files.find((file) => file.role === 'video');
  return video !== undefined && video.state !== 'queued' && video.state !== 'skipped';
}

function rawPercent(job: JobRecord): number {
  const u = job.ugoira;
  if (!u) return 0;
  if (encodeStarted(job)) {
    const total = u.frames.length;
    if (total <= 0) return ZIP_SHARE;
    return ZIP_SHARE + Math.floor(((FULL - ZIP_SHARE) * Math.min(u.encDone, total)) / total);
  }
  if (u.zipTotal === null || u.zipTotal <= 0) return 0;
  const share = u.format === 'zip' ? FULL : ZIP_SHARE;
  return Math.floor((share * Math.min(u.zipLoaded, u.zipTotal)) / u.zipTotal);
}

/**
 * Whole-job ugoira percent: zip bytes map to 0–40 (0–100 for ZIP only), encoded frames to
 * 40–99. Never below the last emitted `ugoira.percent`, and never 100: the last file's landing
 * ends the job, and the view pushed between that landing and the end is still a busy one, so
 * `100%` would show for a frame (PRD §4.7.5). Store the result back in `ugoira.percent` to keep
 * later values monotonic.
 */
export function ugoiraPercent(job: JobRecord): number {
  return Math.max(job.ugoira?.percent ?? 0, Math.min(rawPercent(job), RUNNING_CAP));
}

export function ugoiraProgress(job: JobRecord): JobProgress {
  const encoding = encodeStarted(job);
  const zipTotal = job.ugoira?.zipTotal ?? null;
  return {
    kind: 'percent',
    percent: ugoiraPercent(job),
    phase: encoding ? 'encode' : 'frames',
    // Unknown zip size (no Content-Length): the ring spins until the encode phase starts.
    indeterminate: !encoding && zipTotal === null,
  };
}

/** Progress for the job's JobView: null while resolving or while the work type is unknown. */
export function jobProgress(job: JobRecord): JobProgress | null {
  if (job.phase === 'resolving') return null;
  if (job.kind === 'pages') return pagesProgress(job);
  if (job.kind === 'ugoira' && job.ugoira) return ugoiraProgress(job);
  return null;
}
