// SW integration harness (design-test-harness.md "L2"): the real sw.ts against test/fakes/chrome.ts,
// a scripted offscreen document, content-script tabs that proxy the pixiv API, and fake timers so
// every run is deterministic. Restarts discard the module instance and re-import sw.ts against the
// same fake state.

import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { isForTarget, type CodecCaps } from '../../src/shared/messages';
import { setTestHookHandler } from '../../src/shared/test-hooks';
import type { Failure, JobView, RetryResult } from '../../src/shared/types';
import {
  EXTENSION_ORIGIN,
  RECEIVING_END_ERROR,
  installChromeFake,
  type ChromeFake,
  type FakeTab,
} from '../fakes/chrome';

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/api/${name}`, import.meta.url), 'utf8'),
  ) as Json;
}

const PXIMG_IMG = 'https://i.pximg.net/img-original/img/2025/10/02/03/00/00';
export const API = 'https://www.pixiv.net/ajax/illust';

/** /ajax/illust/{id} for a pages work (fixture illust-manga.json with the given fields). */
export function illustJson(fields: Json = {}): Json {
  const json = fixture('illust-manga.json');
  return { ...json, body: { ...(json.body as Json), ...fields } };
}

export function ugoiraIllustJson(): Json {
  return fixture('illust-ugoira.json');
}

export function ugoiraMetaJson(): Json {
  return fixture('ugoira-meta.json');
}

export function pageUrl(artworkId: string, page: number): string {
  return `${PXIMG_IMG}/${artworkId}_p${page}.jpg`;
}

/** /ajax/illust/{id}/pages with `count` originals named `<id>_p<n>.jpg`. */
export function pagesJson(artworkId: string, count: number): Json {
  return {
    error: false,
    message: '',
    body: Array.from({ length: count }, (_, page) => ({
      urls: { original: pageUrl(artworkId, page) },
      width: 1200,
      height: 1697,
    })),
  };
}

/** API answers by URL: a JSON body (200) or an HTTP status for a failed request. */
export type ApiTable = Map<string, Json | number>;

export function apiResult(api: ApiTable, url: string): RetryResult<unknown> {
  const entry = api.get(url);
  if (entry === undefined)
    return { ok: false, failure: { kind: 'http', status: 404, attempts: 1 } };
  if (typeof entry === 'number') {
    return { ok: false, failure: { kind: 'http', status: entry, attempts: 1 } };
  }
  return { ok: true, value: structuredClone(entry), status: 200, attempts: 1 };
}

/** A promise and the function that resolves it. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

// ── Time ──

export async function advance(ms = 1): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Advances fake time in 1 ms steps until `condition` holds. */
export async function until(
  condition: () => boolean,
  label: string,
  maxMs = 20_000,
): Promise<void> {
  for (let elapsed = 0; elapsed < maxMs; elapsed++) {
    if (condition()) return;
    await advance(1);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Awaits `promise` while advancing fake time (the SW waits on coalescing timers). */
export async function settle<T>(promise: Promise<T>, label = 'promise'): Promise<T> {
  let result: { value: T } | null = null;
  let failure: { error: unknown } | null = null;
  promise.then(
    (value) => (result = { value }),
    (error: unknown) => (failure = { error }),
  );
  await until(() => result !== null || failure !== null, label);
  if (failure) throw (failure as { error: unknown }).error;
  return (result as unknown as { value: T }).value;
}

// ── Contexts ──

/** A pixiv tab with the content script: answers api/fetchJson, records job/update views. */
export class ContentTab {
  readonly tab: FakeTab;
  readonly views: JobView[] = [];
  /** While set, API answers wait for it (a slow pixiv API). */
  apiGate: Promise<void> | null = null;

  constructor(fake: ChromeFake, url: string, api: ApiTable) {
    this.tab = fake.tabs.add({ url });
    this.tab.handle((message) => {
      if (!isForTarget(message, 'tab')) return undefined;
      if (message.type === 'job/update') {
        this.views.push((message as unknown as { view: JobView }).view);
        return undefined;
      }
      if (message.type === 'api/fetchJson') {
        const answer = {
          ok: true,
          result: apiResult(api, (message as unknown as { url: string }).url),
        };
        return this.apiGate ? this.apiGate.then(() => answer) : answer;
      }
      return undefined;
    });
  }

  get id(): number {
    return this.tab.id;
  }

  send(message: Json): Promise<unknown> {
    return this.tab.sendMessage({ target: 'sw', ...message });
  }

  /** The last view pushed for `jobId` (any job when omitted). */
  last(jobId?: string): JobView | undefined {
    return this.views.filter((view) => jobId === undefined || view.jobId === jobId).at(-1);
  }

  ended(jobId?: string): JobView | undefined {
    return this.views.find(
      (view) => view.status === 'ended' && (jobId === undefined || view.jobId === jobId),
    );
  }
}

interface FakeTask {
  taskId: string;
  kind: 'bytes' | 'text' | 'zip' | 'encode';
  state: 'running' | 'ready' | 'retained' | 'failed';
  url?: string;
  save?: boolean;
  blobUrl?: string;
  zipBytes?: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export interface OffscreenOptions {
  /** Emit each task's result this many ms after its command (fake time). */
  delayMs?: number;
  /** When false, results wait for finish(). */
  auto?: boolean;
  caps?: CodecCaps;
  /** Byte requests that fail, by URL. */
  failures?: Map<string, Failure>;
  encodeFailure?: Failure;
  /** Answers off/fetchJson (the API fallback when the tab is gone). */
  api?: ApiTable;
  /** Command types answered `{ ok: false, error: 'BAD_REQUEST' }`. */
  refuse?: string[];
}

/** The offscreen document, scripted: a task table and off/* events, like design-offscreen-worker.md. */
export class ScriptedOffscreen {
  readonly commands: Json[] = [];
  readonly tasks = new Map<string, FakeTask>();
  readonly released: Array<{ taskIds: string[]; keepRetained?: boolean }> = [];
  readonly aborted: string[] = [];
  /** The largest number of live (not yet released) byte/text/encode tasks seen. */
  maxLive = 0;
  auto: boolean;
  private nextBlob = 1;

  constructor(
    private readonly fake: ChromeFake,
    private readonly options: OffscreenOptions = {},
  ) {
    this.auto = options.auto ?? true;
    fake.offscreen.setHandler((message) => this.handle(message));
  }

  commandsOf(type: string): Json[] {
    return this.commands.filter((command) => command.type === type);
  }

  /** Emits the result of every running task now. */
  finish(): void {
    for (const task of this.tasks.values()) if (task.state === 'running') this.complete(task);
  }

  private handle(message: unknown): unknown {
    if (!isForTarget(message, 'offscreen')) return undefined;
    const m = message as unknown as Json & { type: string; taskId: string };
    this.commands.push(m);
    if (this.options.refuse?.includes(m.type)) return { ok: false, error: 'BAD_REQUEST' };
    switch (m.type) {
      case 'off/fetchBytes':
        return this.start({
          taskId: m.taskId,
          kind: 'bytes',
          state: 'running',
          url: m.url as string,
        });
      case 'off/makeText':
        return this.start({ taskId: m.taskId, kind: 'text', state: 'running' });
      case 'off/fetchZip':
        return this.start({
          taskId: m.taskId,
          kind: 'zip',
          state: 'running',
          url: m.url as string,
          save: m.save as boolean,
        });
      case 'off/encode':
        return this.start({
          taskId: m.taskId,
          kind: 'encode',
          state: 'running',
          url: m.zipTaskId as string,
        });
      case 'off/abort':
        for (const taskId of m.taskIds as string[]) {
          this.aborted.push(taskId);
          clearTimeout(this.tasks.get(taskId)?.timer);
          this.tasks.delete(taskId);
        }
        return { ok: true };
      case 'off/release':
        this.release(m.taskIds as string[], m.keepRetained === true);
        return { ok: true };
      case 'off/tasks':
        return {
          ok: true,
          tasks: [...this.tasks.values()]
            .filter((task) => task.state !== 'failed')
            .map((task) => ({
              taskId: task.taskId,
              state: task.state,
              ...(task.blobUrl ? { blobUrl: task.blobUrl } : {}),
            })),
        };
      case 'off/fetchJson':
        return {
          ok: true,
          result: apiResult(this.options.api ?? new Map<string, Json | number>(), m.url as string),
        };
      case 'off/probe':
        return { ok: true, caps: this.options.caps ?? { avc: 'avc1.64001e', vp9: true } };
      default:
        return { ok: false, error: 'BAD_REQUEST' };
    }
  }

  private start(task: FakeTask): { ok: true } {
    this.tasks.set(task.taskId, task);
    const live = [...this.tasks.values()].filter((t) => t.state !== 'retained').length;
    this.maxLive = Math.max(this.maxLive, live);
    if (this.auto) {
      task.timer = setTimeout(() => this.complete(task), this.options.delayMs ?? 1);
    }
    return { ok: true };
  }

  private release(taskIds: string[], keepRetained: boolean): void {
    this.released.push({ taskIds, ...(keepRetained ? { keepRetained } : {}) });
    for (const taskId of taskIds) {
      const task = this.tasks.get(taskId);
      if (!task) continue;
      if (keepRetained && task.zipBytes) {
        task.state = 'retained';
        delete task.blobUrl;
      } else {
        this.tasks.delete(taskId);
      }
    }
  }

  private blobUrl(): string {
    return `blob:${EXTENSION_ORIGIN}/blob-${this.nextBlob++}`;
  }

  private complete(task: FakeTask): void {
    if (this.tasks.get(task.taskId) !== task || task.state !== 'running') return;
    const failure = this.failureFor(task);
    if (failure) {
      task.state = 'failed';
      this.emit({ type: 'off/failed', taskId: task.taskId, failure });
      return;
    }
    if (task.kind === 'zip') {
      this.emit({
        type: 'off/progress',
        taskId: task.taskId,
        phase: 'zip',
        loaded: 100,
        total: 100,
      });
      task.zipBytes = true;
    }
    if (task.kind === 'encode') {
      this.emit({ type: 'off/progress', taskId: task.taskId, phase: 'encode', done: 4, total: 4 });
    }
    if (task.kind === 'zip' && !task.save) {
      task.state = 'retained';
      this.emit({ type: 'off/ready', taskId: task.taskId });
      return;
    }
    task.state = 'ready';
    task.blobUrl = this.blobUrl();
    this.emit({ type: 'off/ready', taskId: task.taskId, blobUrl: task.blobUrl, size: 1000 });
  }

  private failureFor(task: FakeTask): Failure | undefined {
    if (task.kind === 'encode') {
      const zip = task.url === undefined ? undefined : this.tasks.get(task.url);
      if (!zip?.zipBytes) return { kind: 'encode', detail: 'no-zip', attempts: 1 };
      return this.options.encodeFailure;
    }
    return task.url === undefined ? undefined : this.options.failures?.get(task.url);
  }

  /** Like Chrome waking a stopped SW for the event: delivery is retried until a listener exists. */
  emit(event: Json, attempt = 0): void {
    const doc = this.fake.offscreen.document;
    if (!doc) return;
    doc.sendMessage({ target: 'sw', ...event }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== RECEIVING_END_ERROR || attempt > 1000) {
        throw error;
      }
      setTimeout(() => this.emit(event, attempt + 1), 5);
    });
  }
}

// ── The service worker ──

/** Imports a fresh sw.ts instance (listeners registered at import) and waits for `ready`. */
export async function bootSw(): Promise<void> {
  vi.resetModules();
  const sw = await import('../../src/background/sw');
  await settle(sw.ready, 'sw ready');
}

const NEVER = new Promise<void>(() => undefined);

/**
 * Records every `__testHook` await point; at hit number `killAt` the SW "dies": that await and
 * every later one of the old instance never resolve, and Chrome drops the SW's listeners.
 */
export class HookRecorder {
  readonly hits: string[] = [];
  dead = false;

  constructor(
    private readonly fake: ChromeFake,
    private killAt: number | null = null,
  ) {
    setTestHookHandler((name) => this.onHook(name));
  }

  private onHook(name: string): Promise<void> | undefined {
    if (this.dead) return NEVER;
    if (this.killAt === this.hits.length) {
      this.hits.push(name);
      this.killAt = null;
      this.dead = true;
      this.fake.restartWorker();
      return NEVER;
    }
    this.hits.push(name);
    return undefined;
  }

  /**
   * Lets the old instance's other chains run into the frozen registry, then starts a new SW
   * instance against the same fake state.
   */
  async restart(): Promise<void> {
    await advance(60);
    this.dead = false;
    await bootSw();
  }
}

/** A fresh fake with fake timers; returns the fake. */
export function setUp(): ChromeFake {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  const fake = installChromeFake();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  return fake;
}

export function tearDown(): void {
  setTestHookHandler(null);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

/** Files Chrome has written, relative to the Downloads folder, oldest first. */
export function savedFiles(fake: ChromeFake): string[] {
  return fake.downloads
    .items()
    .filter((item) => item.state === 'complete')
    .map((item) => item.filename.replace(/^\/fake\/Downloads\//, ''));
}

/** Completes every download that was already in progress at the previous call. */
export class DownloadDriver {
  private seen = new Set<number>();

  constructor(private readonly fake: ChromeFake) {}

  step(): void {
    for (const item of this.fake.downloads.inProgress()) {
      if (this.seen.has(item.id)) this.fake.downloads.complete(item.id);
      else this.seen.add(item.id);
    }
  }
}
