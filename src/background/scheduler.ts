// Per-job scheduling (design-download-engine.md "Scheduler (scheduler.ts)", "Cancel"): which
// queued files start, in what order, and what each one asks the offscreen document to do. Pure
// mutators over a JobRecord; the registry persists the record before any returned effect runs.

import { MAX_IN_FLIGHT_PER_JOB } from '../shared/constants';
import { buildMetadata, serializeJson } from '../shared/metadata';
import type { Failure } from '../shared/types';
import type { OffscreenCommand } from './offscreen-client';
import type { Effect } from './registry';
import type { FileState, FileTask, JobRecord } from './types';

const JSON_MIME = 'application/json';

/** A file holds one of the job's MAX_IN_FLIGHT_PER_JOB slots from `fetching` until terminal. */
export const IN_FLIGHT: ReadonlySet<FileState> = new Set(['fetching', 'ready', 'saving']);
const TERMINAL: ReadonlySet<FileState> = new Set(['done', 'failed', 'skipped']);
const ABORTED: Failure = { kind: 'aborted', attempts: 0 };

export function isTerminal(file: FileTask): boolean {
  return TERMINAL.has(file.state);
}

export function fileAt(job: JobRecord, idx: number): FileTask | undefined {
  return job.files.find((file) => file.idx === idx);
}

/** Moves `file` to a terminal state and drops what only an in-flight file needs. */
export function settleFile(file: FileTask, state: 'done' | 'failed', failure?: Failure): void {
  file.state = state;
  if (failure) file.failure = failure;
  delete file.text;
}

/**
 * Starts queued files in ascending idx while the job has a free slot. A queued file is skipped
 * once the job has a stop reason or one of its dependencies failed or was skipped; it waits while
 * a dependency is still running. Returns a dispatch effect per started file, and `finalize` when
 * no file is queued or in flight any more.
 */
export function pump(job: JobRecord): Effect[] {
  if (job.phase !== 'transferring') return [];
  const effects: Effect[] = [];
  let inFlight = job.files.filter((file) => IN_FLIGHT.has(file.state)).length;
  for (const file of [...job.files].sort((a, b) => a.idx - b.idx)) {
    if (file.state !== 'queued') continue;
    if (job.stopReason !== null) {
      file.state = 'skipped';
      continue;
    }
    const deps = file.dependsOn.map((idx) => fileAt(job, idx));
    if (deps.some((dep) => !dep || dep.state === 'failed' || dep.state === 'skipped')) {
      file.state = 'skipped';
      continue;
    }
    if (!deps.every((dep) => dep?.state === 'done')) continue;
    if (inFlight >= MAX_IN_FLIGHT_PER_JOB) break;
    file.state = 'fetching';
    file.taskId = crypto.randomUUID();
    if (file.role === 'metadata') {
      file.text ??= serializeJson(buildMetadata(job.metaBody ?? {}, job.artworkId));
      job.metaBody = null;
    }
    effects.push({ type: 'dispatch', idx: file.idx });
    inFlight++;
  }
  if (!job.files.some((file) => file.state === 'queued' || IN_FLIGHT.has(file.state))) {
    effects.push({ type: 'finalize' });
  }
  return effects;
}

/**
 * Pumps after a transition. `leading` effects (releases, hand-offs) run first, so a freed slot is
 * released before the next file starts. A running job also re-renders the badge and pushes its
 * view; a finished one gets `finalize` instead, which does both.
 */
export function settle(job: JobRecord, leading: Effect[] = []): Effect[] {
  const pumped = pump(job);
  if (pumped.some((effect) => effect.type === 'finalize')) return [...leading, ...pumped];
  return [...leading, { type: 'badge' }, { type: 'push' }, ...pumped];
}

/**
 * The offscreen command that produces `file`'s bytes. metadata.json and frames.json text is
 * built here from the record; the SW never holds file bytes.
 */
export function commandFor(job: JobRecord, file: FileTask): OffscreenCommand {
  const taskId = file.taskId ?? '';
  switch (file.role) {
    case 'page':
      return { type: 'off/fetchBytes', taskId, url: file.url ?? '' };
    case 'metadata':
      return { type: 'off/makeText', taskId, text: file.text ?? '', mime: JSON_MIME };
    case 'framesJson':
      return {
        type: 'off/makeText',
        taskId,
        text: serializeJson(job.ugoira?.frames ?? []),
        mime: JSON_MIME,
      };
    case 'zip':
      return { type: 'off/fetchZip', taskId, url: file.url ?? '', save: file.save };
    case 'video': {
      const zip = job.files.find((other) => other.role === 'zip');
      return {
        type: 'off/encode',
        taskId,
        zipTaskId: zip?.taskId ?? '',
        frames: job.ugoira?.frames ?? [],
        format: job.ugoira?.format === 'webm' ? 'webm' : 'mp4',
        avcCodec: job.ugoira?.avcCodec ?? null,
        artworkId: job.artworkId,
      };
    }
  }
}

/**
 * job/cancel, in one mutation: nothing new starts, running offscreen tasks are aborted, Chrome
 * cancels downloads it has started (removing their partial files), and the job finalizes at once
 * with outcome `cancelled`. Files that already landed stay on disk.
 */
export function cancel(job: JobRecord): Effect[] {
  job.stopReason = 'cancelled';
  const taskIds: string[] = [];
  const downloadIds: number[] = [];
  for (const file of job.files) {
    if (file.state === 'queued') {
      file.state = 'skipped';
    } else if (IN_FLIGHT.has(file.state)) {
      if (file.state === 'saving') {
        if (file.downloadId !== undefined) downloadIds.push(file.downloadId);
      } else if (file.taskId !== undefined) {
        taskIds.push(file.taskId);
      }
      settleFile(file, 'failed', ABORTED);
    }
  }
  const effects: Effect[] = [];
  if (taskIds.length > 0) effects.push({ type: 'abort', taskIds });
  if (downloadIds.length > 0) effects.push({ type: 'cancelDownload', downloadIds });
  effects.push({ type: 'finalize' });
  return effects;
}
