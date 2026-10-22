// Toolbar badge and action title (design-download-engine.md "Badge and action title (badge.ts)";
// PRD §4.8, CUJ-4).

import { BADGE_COALESCE_MS } from '../shared/constants';
import { t } from '../shared/i18n';
import { createLogger } from '../shared/log';
import type { FileState, JobRecord } from './types';

const log = createLogger('badge');

/** Badge text is limited to 4 characters. */
const BADGE_MAX = 999;
const PENDING: ReadonlySet<FileState> = new Set(['queued', 'fetching', 'ready', 'saving']);

/**
 * Files still to land for one job. Only image pages count for a pages job (never metadata.json);
 * an ugoira job counts 1 for its whole life; a retryMetadata job counts 0.
 */
export function remaining(job: JobRecord): number {
  if (job.phase === 'ended' || job.mode === 'retryMetadata') return 0;
  if (job.phase === 'resolving') return job.expectedFiles;
  switch (job.kind) {
    case 'pages':
      return job.files.filter((f) => f.role === 'page' && PENDING.has(f.state)).length;
    case 'ugoira':
      return 1;
    case 'unknown':
      return 0;
  }
}

export function badgeText(total: number): string {
  if (total === 0) return '';
  return total > BADGE_MAX ? `${BADGE_MAX}+` : String(total);
}

/** `jobs` is the number of running jobs; the title always shows the exact total. */
export function actionTitle(total: number, jobs: number): string {
  if (jobs === 0) return t('action_title_idle');
  if (jobs === 1) return total === 1 ? t('action_title_one_single') : t('action_title_one', total);
  return t('action_title_many', [total, jobs]);
}

export interface BadgeRenderer {
  /**
   * Schedules a render of the badge and title from the current jobs. Calls within
   * BADGE_COALESCE_MS share one trailing render; the promise resolves once it is applied. Never
   * rejects: a failed chrome.action call is logged and retried by the next render.
   */
  render(): Promise<void>;
}

/** `jobs` supplies the jobs at render time; jobs in phase 'ended' are not counted. */
export function createBadgeRenderer(jobs: () => Iterable<JobRecord>): BadgeRenderer {
  let pending: Promise<void> | null = null;
  let shownText: string | null = null;
  let shownTitle: string | null = null;

  async function apply(): Promise<void> {
    const running = [...jobs()].filter((job) => job.phase !== 'ended');
    const total = running.reduce((sum, job) => sum + remaining(job), 0);
    const text = badgeText(total);
    const title = actionTitle(total, running.length);
    const updates: Array<Promise<void>> = [];
    if (text !== shownText) {
      shownText = text;
      updates.push(
        chrome.action.setBadgeText({ text }).catch((error: unknown) => {
          shownText = null;
          log.warn('setBadgeText failed', error);
        }),
      );
    }
    if (title !== shownTitle) {
      shownTitle = title;
      updates.push(
        chrome.action.setTitle({ title }).catch((error: unknown) => {
          shownTitle = null;
          log.warn('setTitle failed', error);
        }),
      );
    }
    await Promise.all(updates);
  }

  return {
    render() {
      pending ??= new Promise<void>((resolve) => {
        setTimeout(() => {
          pending = null;
          void apply().then(resolve);
        }, BADGE_COALESCE_MS);
      });
      return pending;
    },
  };
}
