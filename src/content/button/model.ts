// Button state model (design-artwork-button.md "Button state model", "Click actions"): the per-
// artwork Entry, the pure transition function and the click → action mapping. No DOM and no
// chrome.* here: the content script (task 3.4) performs the actions and feeds results back as
// events.

import type { StartRequest } from '../../shared/job';
import { CLICK_GUARD_MS, PIXIV_LOGIN_URL } from '../../shared/constants';
import { requiresLogin } from '../../shared/pixiv-api';
import type {
  ErrorCause,
  JobOutcome,
  JobProgress,
  JobView,
  UgoiraOutput,
  WorkInfo,
} from '../../shared/types';

export type ButtonError =
  | { t: 'partial'; folder: string; total: number; saved: number; failedPages: number[] }
  | { t: 'metadataOnly'; folder: string; total: number }
  | { t: 'encodeFailed'; folder: string; format: 'mp4' | 'webm' }
  | { t: 'cause'; cause: ErrorCause };

export type ButtonState =
  | { s: 'pending' } // no metadata yet: "Download", no hint
  | { s: 'idle' } // presentation derives from entry.work + settings + entry.format
  | {
      s: 'busy';
      jobId: string; // AWAITING_JOB_ID until the job/start response arrives
      progress: JobProgress | null;
      startedAt: number; // performance.now() of the starting click (click guard)
      armed: boolean; // whether the cancel face may show on hover before any pointerleave
    }
  | { s: 'saved'; folder: string; kind: 'pages' | 'ugoira'; pages?: number; format?: UgoiraOutput }
  | { s: 'error'; err: ButtonError }
  | { s: 'needsLogin' }
  | { s: 'unavailable' };

export type BusyState = Extract<ButtonState, { s: 'busy' }>;
export type SavedState = Extract<ButtonState, { s: 'saved' }>;

export interface Entry {
  artworkId: string;
  work: WorkInfo | null;
  format: UgoiraOutput | null; // effective output, ugoira only
  state: ButtonState;
  width: number | null; // locked px
  interacted: boolean; // blocks the one-time widen after the first click
  cancelledJobs: ReadonlySet<string>; // jobs cancelled locally; their late 'running' updates are ignored
}

/** `busy.jobId` between the optimistic busy state and the job/start response. */
export const AWAITING_JOB_ID = '';

export type ButtonEvent =
  /** Render-time `/ajax/illust/{id}` succeeded. `loggedIn` is the page's marker (null = unknown). */
  | { type: 'metadata'; work: WorkInfo; loggedIn: boolean | null }
  /** Render-time `/ajax/illust/{id}` answered 404 or a pixiv error body. */
  | { type: 'unavailable' }
  /**
   * The effective ugoira output: the render-time caps/get answer, and settings changes for idle
   * entries only (design "Settings and codec reactivity"; a running job keeps its snapshot).
   */
  | { type: 'format'; format: UgoiraOutput | null }
  /** The user activated the button; `now` is the same clock value passed to clickAction(). */
  | { type: 'click'; now: number }
  /** job/start answered with the new job. */
  | { type: 'started'; jobId: string }
  /** job/start failed (SW error, message rejected). */
  | { type: 'startFailed' }
  /** A job/update push (or a job/listForTab view on reload). */
  | { type: 'update'; view: JobView };

export type ClickAction =
  | { type: 'start'; request: StartRequest }
  | { type: 'cancel'; jobId: string }
  | { type: 'login'; url: string }
  | { type: 'ignore' };

export function createEntry(artworkId: string): Entry {
  return {
    artworkId,
    work: null,
    format: null,
    state: { s: 'pending' },
    width: null,
    interacted: false,
    cancelledJobs: new Set(),
  };
}

/**
 * The action a click on `entry` asks for. Call it with the entry as it was before the click, and
 * reduce the same click (with the same `now`) to get the optimistic next state. `loggedIn` is the
 * page's login marker: every `full` job carries it, so the SW can repeat the needs-login check for
 * a click made before the metadata arrived (R-003).
 */
export function clickAction(
  entry: Entry,
  now: number,
  href: string,
  loggedIn: boolean | null,
): ClickAction {
  const { state } = entry;
  switch (state.s) {
    case 'pending':
    case 'idle':
    case 'saved':
    case 'error':
      return { type: 'start', request: startRequest(entry, loggedIn) };
    case 'busy':
      return canCancel(state, now) ? { type: 'cancel', jobId: state.jobId } : { type: 'ignore' };
    case 'needsLogin':
      return { type: 'login', url: loginUrl(href) };
    case 'unavailable':
      return { type: 'ignore' };
  }
}

/** `https://accounts.pixiv.net/login?return_to=<href>` (PRD CUJ-5 step 2). */
export function loginUrl(href: string): string {
  return `${PIXIV_LOGIN_URL}?return_to=${encodeURIComponent(href)}`;
}

/** Pure transition. Never mutates `entry`; returns it as is when the event does not apply. */
export function reduce(entry: Entry, event: ButtonEvent): Entry {
  const { state } = entry;
  switch (event.type) {
    case 'metadata': {
      const next = { ...entry, work: event.work };
      if (state.s !== 'pending') return next;
      const needsLogin = requiresLogin(event.work, event.loggedIn);
      return { ...next, state: needsLogin ? { s: 'needsLogin' } : { s: 'idle' } };
    }
    case 'unavailable':
      return state.s === 'pending' || state.s === 'idle'
        ? { ...entry, state: { s: 'unavailable' } }
        : entry;
    case 'format':
      return { ...entry, format: event.format };
    case 'click':
      return reduceClick({ ...entry, interacted: true }, event.now);
    case 'started':
      return isAwaiting(state) ? { ...entry, state: { ...state, jobId: event.jobId } } : entry;
    case 'startFailed':
      return isAwaiting(state)
        ? { ...entry, state: { s: 'error', err: { t: 'cause', cause: 'server' } } }
        : entry;
    case 'update':
      return reduceUpdate(entry, event.view);
  }
}

function reduceClick(entry: Entry, now: number): Entry {
  const { state } = entry;
  switch (state.s) {
    case 'pending':
    case 'idle':
    case 'saved':
    case 'error':
      return {
        ...entry,
        state: {
          s: 'busy',
          jobId: AWAITING_JOB_ID,
          progress: optimisticProgress(entry),
          startedAt: now,
          armed: false,
        },
      };
    case 'busy': {
      if (!canCancel(state, now)) return entry;
      const cancelledJobs = new Set(entry.cancelledJobs).add(state.jobId);
      return { ...entry, state: restingState(entry), cancelledJobs };
    }
    case 'needsLogin':
    case 'unavailable':
      return entry;
  }
}

function reduceUpdate(entry: Entry, view: JobView): Entry {
  const { state } = entry;
  const base =
    entry.format === null && view.format !== null ? { ...entry, format: view.format } : entry;

  if (view.status === 'running' || view.outcome === null) {
    if (entry.cancelledJobs.has(view.jobId)) return entry;
    if (state.s === 'busy') {
      if (state.jobId !== view.jobId) return entry;
      return { ...base, state: { ...state, progress: view.progress ?? state.progress } };
    }
    // A running job this tab started but is not showing: reattach after a reload (PRD §4.7.6).
    // There was no starting click here, so neither the click guard nor arming applies.
    return {
      ...base,
      state: {
        s: 'busy',
        jobId: view.jobId,
        progress: view.progress,
        startedAt: Number.NEGATIVE_INFINITY,
        armed: true,
      },
    };
  }

  const cancelledLocally = entry.cancelledJobs.has(view.jobId);
  const settled = cancelledLocally ? { ...base, cancelledJobs: without(entry, view.jobId) } : base;
  // Another job (or one awaiting its job/start response) owns the button.
  if (state.s === 'busy' && state.jobId !== view.jobId) return settled;
  // Already shown as idle by the optimistic cancel.
  if (cancelledLocally && view.outcome.type === 'cancelled') return settled;
  // Truth wins, even for a job cancelled locally that completed before the cancel landed.
  return { ...settled, state: outcomeState(view.outcome, view, entry) };
}

function outcomeState(outcome: JobOutcome, view: JobView, entry: Entry): ButtonState {
  switch (outcome.type) {
    case 'saved': {
      const kind = outcome.format !== undefined || view.kind === 'ugoira' ? 'ugoira' : 'pages';
      const saved: SavedState = { s: 'saved', folder: outcome.folder, kind };
      if (outcome.pages !== undefined) saved.pages = outcome.pages;
      if (outcome.format !== undefined) saved.format = outcome.format;
      return saved;
    }
    case 'partial':
      return {
        s: 'error',
        err: {
          t: 'partial',
          folder: outcome.folder,
          total: outcome.total,
          saved: outcome.saved,
          failedPages: outcome.failedPages,
        },
      };
    case 'metadataOnly':
      return {
        s: 'error',
        err: { t: 'metadataOnly', folder: outcome.folder, total: outcome.total },
      };
    case 'encodeFailed':
      return {
        s: 'error',
        err: { t: 'encodeFailed', folder: outcome.folder, format: outcome.format },
      };
    case 'error':
      return { s: 'error', err: { t: 'cause', cause: outcome.cause } };
    case 'needsLogin':
      return { s: 'needsLogin' };
    case 'unavailable':
      return { s: 'unavailable' };
    case 'cancelled':
      return restingState(entry);
  }
}

/** The job/start payload for a click on a startable state (design "Click actions"). */
function startRequest(entry: Entry, loggedIn: boolean | null): StartRequest {
  const { artworkId, state, work } = entry;
  if (state.s === 'error') {
    const { err } = state;
    switch (err.t) {
      case 'partial':
        return {
          mode: 'retryPages',
          artworkId,
          folder: err.folder,
          pages: err.failedPages,
          total: err.total,
        };
      case 'metadataOnly':
        return { mode: 'retryMetadata', artworkId, folder: err.folder };
      case 'encodeFailed':
        return { mode: 'retryEncode', artworkId, folder: err.folder, format: err.format };
      case 'cause':
        break; // the whole job again with the current settings (CUJ-5 step 6)
    }
  }
  const expectedFiles = work === null ? 0 : work.illustType === 2 ? 1 : work.pageCount;
  return { mode: 'full', artworkId, expectedFiles, loggedIn };
}

/** Shown synchronously on click, before job/start answers (PRD NFR: busy within 100 ms). */
function optimisticProgress(entry: Entry): JobProgress | null {
  const { state } = entry;
  if (state.s === 'error') {
    const { err } = state;
    switch (err.t) {
      case 'partial':
        return { kind: 'pages', done: err.saved, total: err.total };
      case 'metadataOnly':
        return { kind: 'pages', done: err.total, total: err.total };
      case 'encodeFailed':
        return ZERO_PERCENT;
      case 'cause':
        break;
    }
  }
  return initialProgress(entry.work);
}

const ZERO_PERCENT: JobProgress = {
  kind: 'percent',
  percent: 0,
  phase: 'frames',
  indeterminate: false,
};

/** Progress at the start of a full job: `0 / pageCount`, `0%` for an ugoira, null if unknown. */
export function initialProgress(work: WorkInfo | null): JobProgress | null {
  if (work === null) return null;
  return work.illustType === 2 ? ZERO_PERCENT : { kind: 'pages', done: 0, total: work.pageCount };
}

/** Where a cancelled job leaves the button: idle, or pending while the metadata is still out. */
function restingState(entry: Entry): ButtonState {
  return entry.work === null ? { s: 'pending' } : { s: 'idle' };
}

function canCancel(state: BusyState, now: number): boolean {
  return state.jobId !== AWAITING_JOB_ID && now - state.startedAt >= CLICK_GUARD_MS;
}

function isAwaiting(state: ButtonState): state is BusyState {
  return state.s === 'busy' && state.jobId === AWAITING_JOB_ID;
}

function without(entry: Entry, jobId: string): Set<string> {
  const next = new Set(entry.cancelledJobs);
  next.delete(jobId);
  return next;
}
