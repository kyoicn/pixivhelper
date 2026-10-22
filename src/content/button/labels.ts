// Presentation of a button Entry (design-artwork-button.md "Presentation (button/labels.ts)",
// PRD §4.7.3, Appendix A): variant, glyph, label, hint, title and accessible name, plus the
// live-region announcement for a state change. Pure apart from t().

import { t, type MessageKey } from '../../shared/i18n';
import type { ErrorCause, JobProgress, Settings, UgoiraOutput } from '../../shared/types';
import type { IconName } from './icons';
import type { Announcement } from './live-region';
import {
  type ButtonError,
  type ButtonState,
  type BusyState,
  type Entry,
  initialProgress,
  type SavedState,
} from './model';

export type Variant = 'primary' | 'saved' | 'neutral' | 'error' | 'disabled' | 'cancel';

/** Progress ring: `fraction` of the circle, or the rotating 25 % arc when indeterminate. */
export interface Ring {
  fraction: number;
  indeterminate: boolean;
}

/** What the pill draws: also the unit the width measurement works on. */
export interface Face {
  variant: Variant;
  icon: IconName | null; // ignored when `ring` is set
  ring?: Ring;
  label: string;
  hint?: string; // shown after a `·`
}

export interface Presentation extends Face {
  title?: string;
  ariaLabel: string;
  ariaBusy: boolean;
  ariaDisabled: boolean;
  /** Busy only: the face swapped in on hover once armed (PRD §4.7.5). */
  cancelFace?: Face;
  /** Busy only: true when the cancel face may show without a pointerleave first. */
  armed?: boolean;
}

/** The literal format names `hint_format` and the aria strings take (Appendix A). */
export const FORMAT_LABEL: Readonly<Record<UgoiraOutput, string>> = {
  mp4: 'MP4',
  webm: 'WebM',
  zip: 'ZIP',
};

const CAUSE_TIP: Readonly<Record<ErrorCause, MessageKey>> = {
  offline: 'tip_offline',
  refused: 'tip_refused',
  server: 'tip_server',
  disk: 'tip_disk',
};

const NOT_BUSY = { ariaBusy: false, ariaDisabled: false } as const;

function face(variant: Variant, icon: IconName | null, label: string, hint?: string): Face {
  return hint === undefined ? { variant, icon, label } : { variant, icon, label, hint };
}

export function downloadFace(hint?: string): Face {
  return face('primary', 'download', t('btn_download'), hint);
}
export function busyFace(label: string, ring: Ring): Face {
  return { variant: 'primary', icon: null, ring, label };
}
export function cancelFace(): Face {
  return face('cancel', 'x', t('btn_cancel'));
}
export function savedFace(hint?: string): Face {
  return face('saved', 'check', t('btn_saved'), hint);
}
export function loginFace(): Face {
  return face('neutral', null, t('btn_login'));
}
export function retryFace(hint?: string): Face {
  return face('error', 'warning', t('btn_retry'), hint);
}
export function unavailableFace(): Face {
  return face('disabled', null, t('btn_unavailable'));
}

/** `12P`; none for a single page (PRD §4.7.3: `Download`, `Saved`). */
export function pagesHint(pages: number): string | undefined {
  return pages > 1 ? t('hint_pages', pages) : undefined;
}
export function formatHint(format: UgoiraOutput): string {
  return t('hint_format', FORMAT_LABEL[format]);
}

/** The presentation-table row for `entry` (design "Presentation"). */
export function present(entry: Entry, settings: Pick<Settings, 'saveMetadata'>): Presentation {
  const { state } = entry;
  switch (state.s) {
    case 'pending':
      return presentPending();
    case 'idle':
      return presentIdle(entry, settings);
    case 'busy':
      return presentBusy(entry, state);
    case 'saved':
      return presentSaved(entry, state);
    case 'error':
      return presentError(state.err);
    case 'needsLogin':
      return { ...loginFace(), title: t('tip_login'), ariaLabel: t('aria_login'), ...NOT_BUSY };
    case 'unavailable': {
      const tip = t('tip_unavailable');
      return {
        ...unavailableFace(),
        title: tip,
        ariaLabel: tip,
        ariaBusy: false,
        ariaDisabled: true,
      };
    }
  }
}

function presentPending(): Presentation {
  return { ...downloadFace(), ariaLabel: t('btn_download'), ...NOT_BUSY };
}

function presentIdle(entry: Entry, settings: Pick<Settings, 'saveMetadata'>): Presentation {
  const { work, format } = entry;
  // Metadata (or the ugoira's effective format) not known yet: plain "Download" (PRD §4.7.1).
  if (work === null) return presentPending();
  if (work.illustType === 2) {
    if (format === null) return presentPending();
    return {
      ...downloadFace(formatHint(format)),
      ariaLabel: idleUgoiraAria(format, settings),
      ...NOT_BUSY,
    };
  }
  const n = work.pageCount;
  const ariaLabel = n > 1 ? t('aria_idle_pages', n) : t('aria_idle_single');
  return { ...downloadFace(pagesHint(n)), ariaLabel, ...NOT_BUSY };
}

function idleUgoiraAria(format: UgoiraOutput, settings: Pick<Settings, 'saveMetadata'>): string {
  if (format === 'zip') return t('aria_idle_ugoira_zip');
  const key = settings.saveMetadata ? 'aria_idle_ugoira' : 'aria_idle_ugoira_nometa';
  return t(key, FORMAT_LABEL[format]);
}

function presentBusy(entry: Entry, state: BusyState): Presentation {
  const busy = {
    title: t('tip_cancel'),
    ariaBusy: true,
    ariaDisabled: false,
    cancelFace: cancelFace(),
    armed: state.armed,
  };
  // Before the first progress report the counter starts at zero when the work is known.
  const progress = state.progress ?? initialProgress(entry.work);
  if (progress === null) {
    // Kind unknown (clicked before the metadata arrived): spinning arc, no number yet.
    const ring = { fraction: 0, indeterminate: true };
    return { ...busyFace(t('btn_download'), ring), ...busy, ariaLabel: t('tip_cancel') };
  }
  if (progress.kind === 'pages') {
    const { done, total } = progress;
    const ring = { fraction: total > 0 ? done / total : 0, indeterminate: false };
    const ariaLabel =
      total === 1 ? t('aria_busy_pages_one', done) : t('aria_busy_pages', [done, total]);
    return { ...busyFace(t('btn_progress_pages', [done, total]), ring), ...busy, ariaLabel };
  }
  const { percent, phase, indeterminate } = progress;
  const ring = { fraction: percent / 100, indeterminate };
  const video = entry.format === 'mp4' || entry.format === 'webm' ? entry.format : null;
  const ariaLabel =
    phase === 'encode' && video !== null
      ? t('aria_busy_encode', [FORMAT_LABEL[video], percent])
      : t('aria_busy_frames', percent);
  return { ...busyFace(t('btn_progress_percent', percent), ring), ...busy, ariaLabel };
}

function presentSaved(entry: Entry, state: SavedState): Presentation {
  const tip = t('tip_saved', state.folder);
  const saved = { title: tip, ...NOT_BUSY };
  if (state.kind === 'ugoira') {
    const format = state.format ?? entry.format;
    if (format === null) return { ...savedFace(), ...saved, ariaLabel: tip };
    const ariaLabel = t('aria_saved_ugoira', [FORMAT_LABEL[format], state.folder]);
    return { ...savedFace(formatHint(format)), ...saved, ariaLabel };
  }
  const n = state.pages ?? entry.work?.pageCount;
  if (n === undefined) return { ...savedFace(), ...saved, ariaLabel: tip };
  const ariaLabel =
    n === 1 ? t('aria_saved_pages_one', state.folder) : t('aria_saved_pages', [n, state.folder]);
  return { ...savedFace(pagesHint(n)), ...saved, ariaLabel };
}

function presentError(err: ButtonError): Presentation {
  switch (err.t) {
    case 'partial': {
      const { saved, total } = err;
      const failed = err.failedPages.length;
      const title =
        failed === 1
          ? t('tip_partial_one', [saved, total])
          : t('tip_partial', [saved, total, failed]);
      const ariaLabel = t('aria_partial', [saved, total, failed]);
      return { ...retryFace(t('hint_failed', failed)), title, ariaLabel, ...NOT_BUSY };
    }
    case 'cause': {
      const tip = errorTip(err);
      return { ...retryFace(), title: tip, ariaLabel: t('aria_failed', tip), ...NOT_BUSY };
    }
    case 'metadataOnly': {
      // The tooltip already ends with the action, so it doubles as the accessible name.
      const tip = errorTip(err);
      return { ...retryFace(), title: tip, ariaLabel: tip, ...NOT_BUSY };
    }
    case 'encodeFailed': {
      const tip = errorTip(err);
      return { ...retryFace(formatHint(err.format)), title: tip, ariaLabel: tip, ...NOT_BUSY };
    }
  }
}

function errorTip(err: Exclude<ButtonError, { t: 'partial' }>): string {
  switch (err.t) {
    case 'cause':
      return t(CAUSE_TIP[err.cause]);
    case 'metadataOnly':
      return t('tip_metadata_only', err.total);
    case 'encodeFailed':
      return t('tip_encode_failed');
  }
}

/**
 * What the live region should say when the displayed entry moves from `prev` to `next.state`
 * (design "Live region"): the start, progress (throttled by the region), and the end state.
 * Returns null when nothing should be announced.
 */
export function announcementFor(prev: ButtonState, next: Entry): Announcement | null {
  const { state } = next;
  if (state.s === 'busy') {
    const progress = state.progress;
    if (progress === null) return null;
    if (prev.s !== 'busy' || prev.progress === null) return startAnnouncement(progress);
    if (sameProgress(prev.progress, progress)) return null;
    const text =
      progress.kind === 'pages'
        ? t('live_progress_pages', [progress.done, progress.total])
        : t('live_progress_percent', progress.percent);
    return { kind: 'progress', text };
  }
  if (prev.s !== 'busy') return null;
  return { kind: 'status', text: endText(next, state) };
}

function startAnnouncement(progress: JobProgress): Announcement | null {
  if (progress.kind === 'percent') return { kind: 'status', text: t('live_start_ugoira') };
  // Pages still to fetch: all of them for a new job, only the failed ones for a retry.
  const pages = progress.total - progress.done;
  if (pages <= 0) return null;
  return { kind: 'status', text: pages === 1 ? t('live_start_one') : t('live_start', pages) };
}

function sameProgress(a: JobProgress, b: JobProgress): boolean {
  if (a.kind === 'pages' && b.kind === 'pages') return a.done === b.done && a.total === b.total;
  if (a.kind === 'percent' && b.kind === 'percent') return a.percent === b.percent;
  return false;
}

function endText(entry: Entry, state: Exclude<ButtonState, { s: 'busy' }>): string {
  switch (state.s) {
    case 'pending':
    case 'idle':
      return t('live_cancelled');
    case 'saved': {
      if (state.kind === 'ugoira') {
        const format = state.format ?? entry.format;
        return format === null ? t('btn_saved') : t('live_saved_ugoira', FORMAT_LABEL[format]);
      }
      const n = state.pages ?? entry.work?.pageCount;
      if (n === undefined) return t('btn_saved');
      return n === 1 ? t('live_saved_one') : t('live_saved', n);
    }
    case 'error': {
      const { err } = state;
      if (err.t === 'partial') {
        const failed = err.failedPages.length;
        return failed === 1 ? t('live_failed_one') : t('live_failed', failed);
      }
      return errorTip(err);
    }
    case 'needsLogin':
      return t('aria_login');
    case 'unavailable':
      return t('tip_unavailable');
  }
}
