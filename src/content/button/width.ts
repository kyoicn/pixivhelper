// Fixed button width (PRD §4.7.2; design-artwork-button.md "Fixed width (button/width.ts)"): the
// widest face this artwork's button can show in the active locale, locked at first render.

import { UGOIRA_OUTPUTS } from '../../shared/constants';
import { t, type LocaleTag } from '../../shared/i18n';
import type { WorkInfo } from '../../shared/types';
import {
  busyFace,
  cancelFace,
  downloadFace,
  type Face,
  formatHint,
  loginFace,
  pagesHint,
  retryFace,
  savedFace,
  unavailableFace,
} from './labels';

/**
 * Minimum width per resolved locale. English is pinned to the 164 px of AC CUJ-1 because OS
 * system fonts differ; other locales use the measured value alone.
 */
export const LOCALE_FLOOR_PX: Readonly<Record<LocaleTag, number>> = {
  en: 164,
  ja: 0,
  'zh-CN': 0,
  'zh-TW': 0,
};

/** Page count assumed before the metadata arrives: the 2-digit width (PRD §4.7.2). */
const UNKNOWN_PAGE_COUNT = 99;
const FULL_RING = { fraction: 1, indeterminate: false };

/** Returns the rendered width in px of `face` on the button. */
export type Measure = (face: Face) => number;

/** Every face the button can show for `work` (null: metadata not known yet). */
export function candidates(work: WorkInfo | null): Face[] {
  if (work === null) return [...pageCandidates(UNKNOWN_PAGE_COUNT), ...ugoiraCandidates()];
  return work.illustType === 2 ? ugoiraCandidates() : pageCandidates(work.pageCount);
}

function pageCandidates(pages: number): Face[] {
  const hint = pagesHint(pages);
  return [
    downloadFace(hint),
    busyFace(t('btn_progress_pages', [pages, pages]), FULL_RING),
    cancelFace(),
    savedFace(hint),
    loginFace(),
    // A partial failure leaves at least one page saved, so at most pages − 1 can fail.
    ...(pages > 1 ? [retryFace(t('hint_failed', pages - 1))] : []),
    retryFace(),
    unavailableFace(),
  ];
}

function ugoiraCandidates(): Face[] {
  return [
    ...UGOIRA_OUTPUTS.map((format) => downloadFace(formatHint(format))),
    busyFace(t('btn_progress_percent', 100), FULL_RING),
    cancelFace(),
    ...UGOIRA_OUTPUTS.map((format) => savedFace(formatHint(format))),
    loginFace(),
    retryFace(),
    retryFace(formatHint('mp4')),
    retryFace(formatHint('webm')),
    unavailableFace(),
  ];
}

/** max(ceil(measure(c)) for every candidate, LOCALE_FLOOR_PX[locale]). */
export function computeWidth(work: WorkInfo | null, locale: LocaleTag, measure: Measure): number {
  const measured = candidates(work).map((face) => Math.ceil(measure(face)));
  return Math.max(LOCALE_FLOOR_PX[locale], ...measured);
}

/**
 * The width to keep after a (re)computation: the first value locks; a larger value widens only
 * before any interaction (metadata arriving after first render); the width never shrinks.
 */
export function settleWidth(locked: number | null, computed: number, interacted: boolean): number {
  if (locked === null) return computed;
  return !interacted && computed > locked ? computed : locked;
}
