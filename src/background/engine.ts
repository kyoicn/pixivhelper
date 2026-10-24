// The job engine (design-download-engine.md): the registry, the runner for the effects its
// mutations return, and the job operations behind the SW's message and download handlers. Every
// await may be the SW's last, so state changes are persisted before they are acted on and
// reconcile() repairs whatever a restart interrupted.

import {
  HANDOFF_TARGET_WAIT_MS,
  MAX_PAGES_PER_WORK,
  OFFSCREEN_DOCUMENT_PATH,
} from '../shared/constants';
import { createLogger } from '../shared/log';
import type { JobCancelResponse, OffscreenToSwEvent, OffTaskSnapshot } from '../shared/messages';
import { classifyOutcome } from '../shared/outcome';
import { readSettings } from '../shared/settings';
import { __testHook } from '../shared/test-hooks';
import type { JobOutcome, JobView } from '../shared/types';
import { createBadgeRenderer, type BadgeRenderer } from './badge';
import { getCaps, probePending } from './caps';
import { createDownloadUi, type DownloadUi } from './download-ui';
import {
  downloadOptions,
  onDownloadComplete,
  onDownloadInterrupted,
  onDownloadStarted,
  onHandOffFailed,
  onOffFailed,
  onOffProgress,
  onOffReady,
} from './downloads';
import { scheduleClose, send, type OffscreenCommand } from './offscreen-client';
import { createPusher } from './pusher';
import { reconcileJob } from './reconcile';
import { createRegistry, type Effect, type FileRef, type Registry } from './registry';
import { applyResolution, resolve } from './resolver';
import { cancel, commandFor, fileAt, handOffKey, isLastHandOff } from './scheduler';
import { apiFetchJson, pushView } from './tab-client';
import type { JobRecord, StartRequest } from '../shared/job';
import { toView } from './view';

const log = createLogger('engine');

export interface Engine {
  readonly registry: Registry;
  readonly badge: BadgeRenderer;
  /** job/start: snapshots the settings and persists a `resolving` job. Call resolve() next. */
  start(request: StartRequest, tabId: number): Promise<JobRecord>;
  /** Builds the job's plan and starts its files; an API failure ends the job. Never rejects. */
  resolve(jobId: string): Promise<void>;
  /** job/cancel from tab `tabId`. */
  cancel(jobId: string, tabId: number): Promise<JobCancelResponse>;
  /** job/listForTab: the running jobs started by tab `tabId`. */
  listForTab(tabId: number): JobView[];
  onOffscreenEvent(event: OffscreenToSwEvent): Promise<void>;
  onDownloadChanged(delta: chrome.downloads.DownloadDelta): Promise<void>;
  /** SW start: loads the job records into memory. */
  hydrate(): Promise<void>;
  /** SW start, after hydrate(): repairs what a restart interrupted, then pumps every job. */
  reconcile(): Promise<void>;
  /**
   * SW start, after hydrate(): with no job running, turns Chrome's download UI back on (R-005,
   * R-006), in case an earlier instance died before its busy period's last hand-off or its end.
   * Never rejects.
   */
  restoreDownloadUiIfIdle(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function expectedFiles(request: StartRequest): number {
  switch (request.mode) {
    case 'full':
      // The badge count a `full` job shows while resolving comes from the tab.
      return Math.min(Math.max(request.expectedFiles, 0), MAX_PAGES_PER_WORK);
    case 'retryPages':
      return request.pages.length;
    case 'retryEncode':
      return 1;
    case 'retryMetadata':
      return 0;
  }
}

function summary(job: JobRecord, outcome: JobOutcome): Record<string, unknown> {
  return {
    jobId: job.jobId,
    artworkId: job.artworkId,
    mode: job.mode,
    kind: job.kind,
    outcome: outcome.type,
    done: job.files.filter((file) => file.state === 'done').length,
    failed: job.files.filter((file) => file.state === 'failed').length,
    ms: Date.now() - job.createdAt,
  };
}

/** `downloadUi` is injectable for tests. */
export function createEngine(downloadUi: DownloadUi = createDownloadUi()): Engine {
  const registry = createRegistry({ storage: chrome.storage.session, run: runEffects });
  const badge = createBadgeRenderer(() => registry.list());
  /** Jobs whose final view is being pushed; they take no more running-view pushes. */
  const finalizing = new Set<string>();
  const pusher = createPusher({
    send: pushView,
    getJob: (jobId) => (finalizing.has(jobId) ? undefined : registry.get(jobId)),
    view: (job) => toView(job, null),
  });
  /**
   * Downloads whose id is not yet stored on their file: a completion event that arrives first
   * still finds its file (its mutation queues behind the one storing the id).
   */
  const pendingDownloads = new Map<number, FileRef>();
  /**
   * Hand-offs past the last-hand-off decision, by handOffKey; each settles with its download id,
   * or null (R-006). In memory only, like pendingDownloads: after a restart it is empty, and that
   * is exact, since reconcile adopts or re-issues every interrupted hand-off.
   */
  const decided = new Map<string, Promise<number | null>>();
  /** Called with every downloads.onChanged delta, before onDownloadChanged filters it (R-006). */
  const deltaWatchers = new Set<(delta: chrome.downloads.DownloadDelta) => void>();

  async function runEffects(job: JobRecord, effects: Effect[]): Promise<void> {
    for (const effect of effects) {
      try {
        await runEffect(job, effect);
      } catch (error) {
        log.warn('effect failed', effect.type, error);
      }
    }
  }

  async function runEffect(job: JobRecord, effect: Effect): Promise<void> {
    switch (effect.type) {
      case 'dispatch':
        return dispatch(job, effect.idx);
      case 'download':
        return handOff(job, effect.idx);
      case 'abort':
        return sendQuietly({ type: 'off/abort', taskIds: effect.taskIds });
      case 'release':
        return sendQuietly({
          type: 'off/release',
          taskIds: effect.taskIds,
          ...(effect.keepRetained ? { keepRetained: true } : {}),
        });
      case 'cancelDownload':
        return cancelDownloads(effect.downloadIds);
      case 'push':
        pusher.push(job, effect.throttle);
        return;
      case 'badge':
        void badge.render();
        return;
      case 'finalize':
        return finalize(job);
    }
  }

  /** Commands whose loss is harmless (abort, release): a failure is only logged. */
  async function sendQuietly(command: OffscreenCommand): Promise<void> {
    try {
      await send(command);
    } catch (error) {
      log.warn(command.type, 'not delivered', error);
    }
  }

  async function cancelDownloads(downloadIds: number[]): Promise<void> {
    for (const downloadId of downloadIds) {
      try {
        await chrome.downloads.cancel(downloadId);
      } catch (error) {
        log.warn('downloads.cancel failed', downloadId, error);
      }
    }
  }

  /** Sends the file's offscreen command; a refused or undeliverable one fails the file. */
  async function dispatch(job: JobRecord, idx: number): Promise<void> {
    const file = fileAt(job, idx);
    if (file?.state !== 'fetching' || file.taskId === undefined) return;
    const { taskId, role } = file;
    let detail: string;
    try {
      const ack = await send(commandFor(job, file));
      if (ack.ok) return;
      detail = ack.error;
    } catch (error) {
      detail = errorMessage(error);
    }
    log.warn('offscreen did not take', role, detail);
    // The extension's own plumbing failed, not the network (system.md §10). A video keeps
    // `encode`: its zip landed, so `Retry · MP4` is the right next action.
    const failure = {
      kind: role === 'video' ? 'encode' : 'internal',
      detail,
      attempts: 0,
    } as const;
    await registry.mutate(job.jobId, (record) =>
      onOffFailed(record, idx, { target: 'sw', type: 'off/failed', taskId, failure }),
    );
  }

  /**
   * Resolves once Chrome has determined the target path of each download in `ids` (or the download
   * left `in_progress`, or Chrome no longer knows it), or after HANDOFF_TARGET_WAIT_MS. Never
   * rejects.
   */
  async function targetsKnown(ids: readonly number[]): Promise<void> {
    const pending = new Set(ids);
    if (pending.size === 0) return;
    let release!: () => void;
    const settled = new Promise<void>((resolve) => (release = resolve));
    const watch = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.filename?.current || (delta.state && delta.state.current !== 'in_progress')) {
        pending.delete(delta.id);
      }
      if (pending.size === 0) release();
    };
    // Before the search, so no delta falls between the two.
    deltaWatchers.add(watch);
    const timer = setTimeout(release, HANDOFF_TARGET_WAIT_MS);
    try {
      const found = await Promise.all(
        [...pending].map(async (id) => [id, (await chrome.downloads.search({ id }))[0]] as const),
      );
      for (const [id, item] of found) {
        if (!item || item.filename !== '' || item.state !== 'in_progress') pending.delete(id);
      }
      if (pending.size > 0) await settled;
    } catch (error) {
      // Go on: at worst one extra animation.
      log.warn('downloads.search failed', error);
    } finally {
      deltaWatchers.delete(watch);
      clearTimeout(timer);
    }
  }

  /** downloadIds of the `saving` files of running jobs, other than `self`. */
  function otherSavingIds(self: FileRef): number[] {
    return registry
      .list()
      .flatMap((job) =>
        job.files.flatMap((file) =>
          file.state === 'saving' &&
          file.downloadId !== undefined &&
          !(job.jobId === self.jobId && file.idx === self.idx)
            ? [file.downloadId]
            : [],
        ),
      );
  }

  /**
   * Hands a `saving` file's blob URL to Chrome and stores the download id. Every hand-off but the
   * busy period's last hides Chrome's download UI first (R-005), so not even the job's first file
   * plays Chrome's animation. The last one turns the UI back on first instead (R-006), once Chrome
   * has created and named every earlier file, so its own download brings the downloads button back
   * with one animation.
   */
  async function handOff(job: JobRecord, idx: number): Promise<void> {
    const file = fileAt(job, idx);
    if (file?.state !== 'saving' || file.blobUrl === undefined || file.downloadId !== undefined) {
      return;
    }
    const { blobUrl } = file;
    const self: FileRef = { jobId: job.jobId, idx };
    const key = handOffKey(job.jobId, idx);
    // No await between the snapshot, the decision and the claim: of two racing hand-offs, the
    // later one sees the earlier as handed off, so exactly one is last.
    const earlier = new Map(decided);
    let last = isLastHandOff(registry.list(), self, earlier);
    let markIssued!: (downloadId: number | null) => void;
    decided.set(key, new Promise<number | null>((resolve) => (markIssued = resolve)));
    try {
      if (last) {
        // Chrome creates and names every earlier file while the UI is still off, so none of them
        // animates after the enable.
        const earlierIds = await Promise.all(earlier.values());
        await targetsKnown([
          ...earlierIds.filter((id): id is number => id !== null),
          ...otherSavingIds(self),
        ]);
        // A job created, or a hand-off decided, during the waits makes this file not last.
        last = isLastHandOff(registry.list(), self, earlier);
      }
      if (last) {
        await downloadUi.restore();
        if (__TEST_HOOKS__) await __testHook('await:handoff.restoreUi');
      } else {
        await downloadUi.hideForHandOff();
        if (__TEST_HOOKS__) await __testHook('await:handoff.hideUi');
      }
      // Cancelled while the UI call was in flight: the file never reaches Chrome, so it leaves no
      // "Canceled" entry. The cancel itself fails the file before finalize drops the record.
      const live = registry.get(job.jobId);
      if (!live || fileAt(live, idx)?.state !== 'saving') return;
      if (__TEST_HOOKS__) await __testHook('await:handoff.download');
      let downloadId: number;
      try {
        downloadId = await chrome.downloads.download(downloadOptions(job, file));
      } catch (error) {
        markIssued(null);
        await registry.mutate(job.jobId, (record) =>
          onHandOffFailed(record, idx, blobUrl, errorMessage(error)),
        );
        return;
      }
      markIssued(downloadId);
      pendingDownloads.set(downloadId, { jobId: job.jobId, idx });
      try {
        const running = await registry.mutate(job.jobId, (record) =>
          onDownloadStarted(record, idx, downloadId),
        );
        // The job was cancelled while Chrome started the download.
        if (!running) await cancelDownloads([downloadId]);
      } finally {
        pendingDownloads.delete(downloadId);
      }
    } finally {
      // markIssued is a no-op once settled and covers the early return. The entry goes only once
      // the id is stored, the file failed or the hand-off gave up, so a `saving` file without a
      // downloadId is always either in `decided` or still to be handed off.
      markIssued(null);
      decided.delete(key);
    }
  }

  /**
   * Classifies the job, pushes its final view, then deletes its record (in that order, so a
   * restart in between finalizes again rather than losing the push), frees its offscreen tasks
   * and updates the badge. Once no job is left (a job still finalizing is still listed), Chrome's
   * download UI is turned back on and the offscreen document closes after a grace. The restore is
   * the safety net for a busy period that ended without a final hand-off (cancel, failure, needs
   * login, Unavailable); after one, which already restored the UI, it makes no Chrome call (R-006).
   */
  async function finalize(job: JobRecord): Promise<void> {
    if (finalizing.has(job.jobId) || !registry.get(job.jobId)) return;
    finalizing.add(job.jobId);
    pusher.cancel(job.jobId);
    try {
      const outcome = classifyOutcome(job, navigator.onLine !== false);
      await pushView(job.originTabId, toView(job, outcome));
      const taskIds = job.files.flatMap((file) => (file.taskId === undefined ? [] : [file.taskId]));
      await registry.mutate(job.jobId, (record) => {
        record.phase = 'ended';
        const effects: Effect[] = [{ type: 'badge' }];
        if (taskIds.length > 0) effects.unshift({ type: 'release', taskIds });
        return effects;
      });
      log.info('job end', summary(job, outcome));
      if (registry.list().length === 0) {
        await downloadUi.restore();
        if (!probePending()) scheduleClose();
      }
    } finally {
      finalizing.delete(job.jobId);
    }
  }

  async function resolveJob(jobId: string): Promise<void> {
    const job = registry.get(jobId);
    if (job?.phase !== 'resolving') return;
    try {
      const resolution = await resolve(job, { apiFetchJson, getCaps });
      await registry.mutate(jobId, (record) => applyResolution(record, resolution));
    } catch (error) {
      log.warn('resolve failed', jobId, error);
    }
  }

  /** The offscreen task table, or an empty one when there is no document to ask. */
  async function liveTasks(): Promise<Map<string, OffTaskSnapshot>> {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
    });
    if (contexts.length === 0) return new Map();
    try {
      const response = await send({ type: 'off/tasks' });
      if (response.ok) return new Map(response.tasks.map((task) => [task.taskId, task]));
      log.warn('off/tasks refused', response.error);
    } catch (error) {
      log.warn('off/tasks failed', error);
    }
    return new Map();
  }

  /** Chrome's view of the job's `saving` files: by id, or by blob URL when the id was lost. */
  async function searchDownloads(job: JobRecord) {
    const byId = new Map<number, chrome.downloads.DownloadItem>();
    const byUrl = new Map<string, chrome.downloads.DownloadItem>();
    for (const file of job.files) {
      if (file.state !== 'saving') continue;
      if (file.downloadId !== undefined) {
        const [item] = await chrome.downloads.search({ id: file.downloadId });
        if (item) byId.set(item.id, item);
      } else if (file.blobUrl !== undefined) {
        const [item] = await chrome.downloads.search({ url: file.blobUrl });
        if (item) byUrl.set(file.blobUrl, item);
      }
    }
    return { byId, byUrl };
  }

  return {
    registry,
    badge,

    async start(request, tabId) {
      const settings = await readSettings();
      const job: JobRecord = {
        v: 1,
        jobId: crypto.randomUUID(),
        artworkId: request.artworkId,
        originTabId: tabId,
        createdAt: Date.now(),
        mode: request.mode,
        request,
        kind: 'unknown',
        phase: 'resolving',
        snapshot: {
          folderPattern: settings.folderPattern,
          ugoiraOutput: settings.ugoiraOutput,
          saveMetadata: settings.saveMetadata,
          effectiveFormat: request.mode === 'retryEncode' ? request.format : null,
        },
        expectedFiles: expectedFiles(request),
        metaBody: null,
        folder: request.mode === 'full' ? null : request.folder,
        pagesTotal: 0,
        pagesOffset: 0,
        files: [],
        ugoira: null,
        stopReason: null,
        apiFailure: null,
      };
      await registry.create(job);
      log.info('job start', { jobId: job.jobId, artworkId: job.artworkId, mode: job.mode });
      void badge.render();
      return job;
    },

    resolve: resolveJob,

    async cancel(jobId, tabId) {
      const job = registry.get(jobId);
      if (!job) return { ok: false, error: 'NOT_FOUND' };
      if (job.originTabId !== tabId) return { ok: false, error: 'FORBIDDEN' };
      const ran = await registry.mutate(jobId, cancel);
      return ran ? { ok: true } : { ok: false, error: 'NOT_FOUND' };
    },

    listForTab(tabId) {
      return registry
        .list()
        .filter((job) => job.originTabId === tabId && !finalizing.has(job.jobId))
        .map((job) => toView(job, null));
    },

    async onOffscreenEvent(event) {
      const ref = registry.findByTaskId(event.taskId);
      const handled =
        ref !== undefined &&
        (await registry.mutate(
          ref.jobId,
          (job) => {
            switch (event.type) {
              case 'off/ready':
                return onOffReady(job, ref.idx, event);
              case 'off/failed':
                return onOffFailed(job, ref.idx, event);
              case 'off/progress':
                return onOffProgress(job, ref.idx, event);
            }
          },
          { displayOnly: event.type === 'off/progress' },
        ));
      // A task of an ended (e.g. cancelled) job: only its Blob needs freeing.
      if (!handled && event.type !== 'off/progress') {
        await sendQuietly({ type: 'off/release', taskIds: [event.taskId] });
      }
    },

    async onDownloadChanged(delta) {
      for (const watch of deltaWatchers) watch(delta);
      const state = delta.state?.current;
      if (state !== 'complete' && state !== 'interrupted') return;
      const ref = registry.findByDownloadId(delta.id) ?? pendingDownloads.get(delta.id);
      if (!ref) return;
      await registry.mutate(ref.jobId, (job) =>
        state === 'complete'
          ? onDownloadComplete(job, ref.idx, delta.id)
          : onDownloadInterrupted(job, ref.idx, delta.id, delta.error?.current),
      );
    },

    hydrate: () => registry.hydrate(),

    async reconcile() {
      const jobs = registry.list();
      if (jobs.length === 0) return;
      const tasks = await liveTasks();
      for (const job of jobs) {
        if (job.phase === 'resolving') {
          if (job.stopReason === null && job.apiFailure === null) void resolveJob(job.jobId);
          else await registry.mutate(job.jobId, () => [{ type: 'finalize' }]);
          continue;
        }
        const { byId, byUrl } = await searchDownloads(job);
        await registry.mutate(job.jobId, (record) => reconcileJob(record, { tasks, byId, byUrl }));
      }
    },

    restoreDownloadUiIfIdle() {
      return registry.list().length === 0 ? downloadUi.restore() : Promise.resolve();
    },
  };
}
