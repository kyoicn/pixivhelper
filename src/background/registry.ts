// In-memory job store with write-through to storage.session (design-download-engine.md
// "Mutations: persist intent, then act", "Persistence", "Indexes"). The SW may die at any await,
// so a change is persisted before any effect it implies runs, and hydrate() rebuilds memory from
// storage after a restart.

import { JOB_KEY_PREFIX } from '../shared/constants';
// Imported under another name: the unminified prod bundle keeps the dead `if (false)` call text,
// and it must not mention __testHook (design-test-harness.md).
import { __testHook as testHook } from '../shared/test-hooks';
import type { JobRecord } from '../shared/job';

/**
 * Byte-progress fields (`ugoira.zipLoaded/zipTotal/encDone/percent`) are display-only, so a
 * mutation that touches only them is written at most this often.
 */
const DISPLAY_PERSIST_INTERVAL_MS = 1000;

/** Work a mutation asks for. The runner receives it only after the record is persisted. */
export type Effect =
  | { type: 'dispatch'; idx: number } // send the file's offscreen command
  | { type: 'download'; idx: number } // hand the file's blob URL to chrome.downloads
  | { type: 'abort'; taskIds: string[] } // off/abort
  | { type: 'release'; taskIds: string[]; keepRetained?: boolean } // off/release
  | { type: 'cancelDownload'; downloadIds: number[] } // chrome.downloads.cancel (removes the partial file)
  | { type: 'push'; throttle?: boolean } // job/update to the origin tab; `throttle` for byte progress
  | { type: 'badge' } // re-render the toolbar badge and title
  | { type: 'finalize' }; // classify, push the final view, release the job's tasks

/**
 * Changes the record synchronously and returns the effects to run once it is persisted.
 * Setting `phase = 'ended'` ends the job: its record is deleted instead of written.
 */
export type Mutator = (job: JobRecord) => Effect[];

/**
 * Runs a mutation's effects. It runs outside the serialization lock, so it may call `mutate`;
 * runners still start in mutation order. `job` stays readable after the job has ended.
 */
export type EffectRunner = (job: JobRecord, effects: Effect[]) => Promise<void>;

export interface MutateOptions {
  /** The mutation changed only byte-progress fields: persist at most once per second. */
  displayOnly?: boolean;
}

/** Locates a file: `idx` is `FileTask.idx`. */
export interface FileRef {
  jobId: string;
  idx: number;
}

/** The part of `chrome.storage.session` the registry uses. */
export interface SessionStore {
  get(keys: null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string): Promise<void>;
}

export interface Registry {
  /** Adds a running job; resolves once its record is in storage.session. */
  create(job: JobRecord): Promise<void>;
  /** Running jobs only: ended jobs are dropped. Read-only: change records through `mutate`. */
  get(jobId: string): JobRecord | undefined;
  list(): JobRecord[];
  findByTaskId(taskId: string): FileRef | undefined;
  findByDownloadId(downloadId: number): FileRef | undefined;
  /**
   * Serialized with every other registry call: runs `fn` on the record, persists it (or deletes
   * it when the job has ended), then hands the effects to the runner. Resolves to false, without
   * calling `fn`, when the job is not running; otherwise to true once the runner has finished.
   */
  mutate(jobId: string, fn: Mutator, options?: MutateOptions): Promise<boolean>;
  /** Replaces memory with the `job:*` records in storage.session (SW start). */
  hydrate(): Promise<void>;
}

export interface RegistryOptions {
  storage: SessionStore;
  run: EffectRunner;
}

const jobKey = (jobId: string): string => JOB_KEY_PREFIX + jobId;

export function createRegistry({ storage, run }: RegistryOptions): Registry {
  const jobs = new Map<string, JobRecord>();
  const byTaskId = new Map<string, FileRef>();
  const byDownloadId = new Map<number, FileRef>();
  const indexedKeys = new Map<string, { taskIds: string[]; downloadIds: number[] }>();
  const lastWriteAt = new Map<string, number>();

  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.catch(() => undefined);
    return result;
  }

  function unindex(jobId: string): void {
    const keys = indexedKeys.get(jobId);
    if (!keys) return;
    for (const taskId of keys.taskIds) byTaskId.delete(taskId);
    for (const downloadId of keys.downloadIds) byDownloadId.delete(downloadId);
    indexedKeys.delete(jobId);
  }

  function index(job: JobRecord): void {
    unindex(job.jobId);
    const keys = { taskIds: [] as string[], downloadIds: [] as number[] };
    for (const file of job.files) {
      const ref: FileRef = { jobId: job.jobId, idx: file.idx };
      if (file.taskId !== undefined) {
        byTaskId.set(file.taskId, ref);
        keys.taskIds.push(file.taskId);
      }
      if (file.downloadId !== undefined) {
        byDownloadId.set(file.downloadId, ref);
        keys.downloadIds.push(file.downloadId);
      }
    }
    indexedKeys.set(job.jobId, keys);
  }

  function forget(jobId: string): void {
    jobs.delete(jobId);
    unindex(jobId);
    lastWriteAt.delete(jobId);
  }

  async function write(job: JobRecord): Promise<void> {
    lastWriteAt.set(job.jobId, Date.now());
    await storage.set({ [jobKey(job.jobId)]: job });
  }

  function persist(job: JobRecord, options: MutateOptions): Promise<void> {
    if (job.phase === 'ended') return storage.remove(jobKey(job.jobId));
    const sinceWrite = Date.now() - (lastWriteAt.get(job.jobId) ?? -Infinity);
    if (options.displayOnly && sinceWrite < DISPLAY_PERSIST_INTERVAL_MS) return Promise.resolve();
    return write(job);
  }

  return {
    create(job) {
      return enqueue(async () => {
        jobs.set(job.jobId, job);
        index(job);
        if (__TEST_HOOKS__) await testHook('await:registry.create');
        await write(job);
      });
    },

    get: (jobId) => jobs.get(jobId),
    list: () => [...jobs.values()],
    findByTaskId: (taskId) => byTaskId.get(taskId),
    findByDownloadId: (downloadId) => byDownloadId.get(downloadId),

    async mutate(jobId, fn, options = {}) {
      const step = await enqueue(async () => {
        const job = jobs.get(jobId);
        if (!job) return null;
        const effects = fn(job);
        if (job.phase === 'ended') forget(jobId);
        else index(job);
        if (__TEST_HOOKS__) await testHook('await:registry.persist');
        await persist(job, options);
        if (__TEST_HOOKS__) await testHook('await:registry.effects');
        // Started under the lock, so runners start in mutation order; awaited outside it, so a
        // runner can call mutate without deadlocking.
        return { effectsDone: run(job, effects) };
      });
      if (!step) return false;
      await step.effectsDone;
      return true;
    },

    hydrate() {
      return enqueue(async () => {
        const items = await storage.get(null);
        for (const jobId of [...jobs.keys()]) forget(jobId);
        for (const [key, value] of Object.entries(items)) {
          if (!key.startsWith(JOB_KEY_PREFIX)) continue;
          const job = value as JobRecord;
          jobs.set(job.jobId, job);
          index(job);
        }
      });
    },
  };
}
