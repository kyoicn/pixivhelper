// The job engine (design-download-engine.md): the registry, the runner for the effects its
// mutations return, and the job operations behind the SW's message and download handlers. Every
// await may be the SW's last, so state changes are persisted before they are acted on and
// reconcile() repairs whatever a restart interrupted.

import { MAX_PAGES_PER_WORK, OFFSCREEN_DOCUMENT_PATH } from '../shared/constants';
import { createLogger } from '../shared/log';
import type { JobCancelResponse, OffscreenToSwEvent, OffTaskSnapshot } from '../shared/messages';
import { classifyOutcome } from '../shared/outcome';
import { readSettings } from '../shared/settings';
// Imported under another name: the prod bundle must not mention __testHook.
import { __testHook as testHook } from '../shared/test-hooks';
import type { JobOutcome, JobView } from '../shared/types';
import { createBadgeRenderer, type BadgeRenderer } from './badge';
import { getCaps, probePending } from './caps';
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
import { cancel, commandFor, fileAt } from './scheduler';
import { apiFetchJson, pushView } from './tab-client';
import type { JobRecord, StartRequest } from './types';
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

export function createEngine(): Engine {
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
    const failure = { kind: role === 'video' ? 'encode' : 'network', detail, attempts: 0 } as const;
    await registry.mutate(job.jobId, (record) =>
      onOffFailed(record, idx, { target: 'sw', type: 'off/failed', taskId, failure }),
    );
  }

  /** Hands a `saving` file's blob URL to Chrome and stores the download id. */
  async function handOff(job: JobRecord, idx: number): Promise<void> {
    const file = fileAt(job, idx);
    if (file?.state !== 'saving' || file.blobUrl === undefined || file.downloadId !== undefined) {
      return;
    }
    const { blobUrl } = file;
    if (__TEST_HOOKS__) await testHook('await:handoff.download');
    let downloadId: number;
    try {
      downloadId = await chrome.downloads.download(downloadOptions(job, file));
    } catch (error) {
      await registry.mutate(job.jobId, (record) =>
        onHandOffFailed(record, idx, blobUrl, errorMessage(error)),
      );
      return;
    }
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
  }

  /**
   * Classifies the job, pushes its final view, then deletes its record (in that order, so a
   * restart in between finalizes again rather than losing the push), frees its offscreen tasks
   * and updates the badge. The offscreen document closes after a grace once no job is left.
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
      if (registry.list().length === 0 && !probePending()) scheduleClose();
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
  };
}
