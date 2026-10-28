// In-memory chrome.* fakes for SW integration tests (design-test-harness.md "L2: SW integration
// with chrome fakes"). Covers exactly the APIs the extension uses.
//
//   const fake = installChromeFake();   // fresh state, installed as globalThis.chrome
//   fake.reset();                       // back to the freshly installed state, same objects
//   fake.restartWorker();               // drop the SW's listeners, keep every other state
//   vi.unstubAllGlobals();              // uninstall
//
// The code under test is the service worker: it talks to the global `chrome`. Every other context
// is driven from the test: the offscreen document (`fake.offscreen`) and pages in tabs
// (`fake.tabs.add`: content scripts and extension pages alike). Messages are JSON round-tripped and
// delivered asynchronously, with Chrome's routing rules and sender info. Every API function is a
// vi.fn, so tests can assert calls or queue failures with `mockRejectedValueOnce`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { createGetMessage, type GetMessage, type Locale } from '../helpers/i18n-stub';

export const FAKE_EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
export const EXTENSION_ORIGIN = `chrome-extension://${FAKE_EXTENSION_ID}`;
export const SW_URL = `${EXTENSION_ORIGIN}/sw.js`;
/** Directory the fake resolves download filenames against (DownloadItem.filename is absolute). */
export const DOWNLOADS_DIR = '/fake/Downloads';

/** Rejection of runtime/tabs.sendMessage when no listener exists in any receiving context. */
export const RECEIVING_END_ERROR = 'Could not establish connection. Receiving end does not exist.';
/** chrome.storage.sync quota errors, for `failNextSet`. */
export const SYNC_QUOTA_ERRORS = {
  bytes: 'QUOTA_BYTES quota exceeded',
  bytesPerItem: 'QUOTA_BYTES_PER_ITEM quota exceeded',
  maxItems: 'MAX_ITEMS quota exceeded',
  writesPerHour: 'MAX_WRITE_OPERATIONS_PER_HOUR quota exceeded',
  writesPerMinute: 'MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded',
} as const;
export const INVALID_FILENAME_ERROR = 'Invalid filename';
/** chrome.downloads.setUiOptions without the "downloads.ui" permission, as Chromium 156 words it. */
export const UI_PERMISSION_ERROR = 'downloads.setUiOptions requires the "downloads.ui" permission';
/**
 * chrome.downloads.setUiOptions({ enabled: true }) while another extension keeps the UI off
 * (Chromium downloads_api.cc; the e2e harness loads one extension, so this one is not observed).
 */
export const UI_DISABLED_ERROR = 'Another extension has disabled the download UI';

type Sender = chrome.runtime.MessageSender;
type ColorArray = chrome.extensionTypes.ColorArray;
export type SendResponse = (response?: unknown) => void;
/** A simplified message listener: return a value (or a promise) to respond, `undefined` to pass. */
export type MessageHandler = (message: unknown, sender: Sender) => unknown;

const tick = (): Promise<void> => Promise.resolve();

/** Extension messages and storage values cross a JSON boundary. */
function serialize<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Surfaces an exception thrown by a fake context's listener as an unhandled test error. */
function reportListenerError(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

export class FakeEvent<Args extends unknown[]> {
  #listeners: Array<(...args: Args) => unknown> = [];

  readonly addListener = (listener: (...args: Args) => unknown): void => {
    if (!this.#listeners.includes(listener)) this.#listeners.push(listener);
  };
  readonly removeListener = (listener: (...args: Args) => unknown): void => {
    this.#listeners = this.#listeners.filter((l) => l !== listener);
  };
  readonly hasListener = (listener: (...args: Args) => unknown): boolean =>
    this.#listeners.includes(listener);
  readonly hasListeners = (): boolean => this.#listeners.length > 0;

  get listeners(): Array<(...args: Args) => unknown> {
    return [...this.#listeners];
  }

  /** Calls every listener synchronously, in registration order; returns their return values. */
  dispatch(...args: Args): unknown[] {
    return this.listeners.map((listener) => listener(...args));
  }

  clear(): void {
    this.#listeners = [];
  }
}

export type MessageEvent = FakeEvent<
  [message: unknown, sender: Sender, sendResponse: SendResponse]
>;

/**
 * Chrome's one-time message semantics: every listener of every receiver gets its own copy; the
 * first sendResponse wins; a listener returning `true` keeps the channel open; with no listener at
 * all the send rejects, and when nobody responds it resolves `undefined`.
 */
function deliver(receivers: MessageEvent[], message: unknown, sender: Sender): Promise<unknown> {
  const listeners = receivers.flatMap((event) => event.listeners);
  if (listeners.length === 0) return Promise.reject(new Error(RECEIVING_END_ERROR));
  const payload = serialize(message);
  return new Promise((resolve) => {
    let settled = false;
    const sendResponse: SendResponse = (response) => {
      if (settled) return;
      settled = true;
      resolve(serialize(response));
    };
    queueMicrotask(() => {
      let open = false;
      for (const listener of listeners) {
        try {
          if (listener(serialize(payload), { ...sender }, sendResponse) === true) open = true;
        } catch (error) {
          reportListenerError(error);
        }
      }
      if (!open) sendResponse(undefined);
    });
  });
}

function respondWith(handler: MessageHandler) {
  return (message: unknown, sender: Sender, sendResponse: SendResponse): true | undefined => {
    const result = handler(message, sender);
    if (result === undefined) return undefined;
    Promise.resolve(result).then(sendResponse, reportListenerError);
    return true;
  };
}

function parseColor(color: string | ColorArray): ColorArray {
  if (Array.isArray(color)) return [...color];
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!match?.[1]) throw new Error(`Invalid color ${color}`);
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255) as ColorArray;
}

// ── Contexts other than the SW ──

abstract class FakeEndpoint {
  /** Listeners of this context (what its own code registers on runtime.onMessage). */
  readonly onMessage: MessageEvent = new FakeEvent();

  constructor(protected readonly fake: ChromeFake) {}

  abstract sender(): Sender;

  /** Registers `handler` as a listener that responds with its (awaited) non-undefined result. */
  handle(handler: MessageHandler): void {
    this.onMessage.addListener(respondWith(handler));
  }

  /** runtime.sendMessage from this context. */
  sendMessage(message: unknown): Promise<unknown> {
    return this.fake.sendRuntimeMessage(this, message);
  }
}

export class FakeOffscreenDocument extends FakeEndpoint {
  constructor(
    fake: ChromeFake,
    readonly url: string,
    readonly documentId: string,
  ) {
    super(fake);
  }

  get contextId(): string {
    return `ctx-${this.documentId}`;
  }

  sender(): Sender {
    return {
      id: FAKE_EXTENSION_ID,
      url: this.url,
      origin: EXTENSION_ORIGIN,
      documentId: this.documentId,
    };
  }
}

/** A tab: a web page with the content script, or an extension page (e.g. options.html). */
export class FakeTab extends FakeEndpoint {
  constructor(
    fake: ChromeFake,
    readonly tab: chrome.tabs.Tab & { id: number },
  ) {
    super(fake);
  }

  get id(): number {
    return this.tab.id;
  }

  get isExtensionPage(): boolean {
    return this.tab.url?.startsWith(`${EXTENSION_ORIGIN}/`) ?? false;
  }

  sender(): Sender {
    const url = this.tab.url ?? '';
    return {
      id: FAKE_EXTENSION_ID,
      url,
      origin: this.isExtensionPage ? EXTENSION_ORIGIN : new URL(url).origin,
      tab: { ...this.tab },
      frameId: 0,
      documentId: `doc-tab-${this.id}`,
    };
  }

  close(): void {
    this.fake.tabs.remove(this.id);
  }
}

// ── Storage ──

type StorageAreaName = 'sync' | 'local' | 'session';
type StorageChanges = Record<string, chrome.storage.StorageChange>;
type StorageKeys = string | string[] | Record<string, unknown> | null | undefined;
type GlobalStorageEvent = FakeEvent<[changes: StorageChanges, areaName: string]>;

export class FakeStorageArea {
  readonly onChanged = new FakeEvent<[changes: StorageChanges]>();
  #data = new Map<string, string>(); // JSON text, like Chrome's serialized store
  #setErrors: string[] = [];

  constructor(
    readonly areaName: StorageAreaName,
    private readonly globalOnChanged: GlobalStorageEvent,
  ) {}

  readonly get = vi.fn(async (keys?: StorageKeys): Promise<Record<string, unknown>> => {
    await tick();
    const all = keys === null || keys === undefined;
    const defaults = !all && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
    const wanted = all
      ? [...this.#data.keys()]
      : typeof keys === 'string'
        ? [keys]
        : Array.isArray(keys)
          ? keys
          : Object.keys(keys);
    const result: Record<string, unknown> = {};
    for (const key of wanted) {
      const text = this.#data.get(key);
      if (text !== undefined) result[key] = JSON.parse(text) as unknown;
      else if (key in defaults) result[key] = serialize(defaults[key]);
    }
    return result;
  });

  readonly set = vi.fn(async (items: Record<string, unknown>): Promise<void> => {
    await tick();
    const error = this.#setErrors.shift();
    if (error !== undefined) throw new Error(error);
    this.write(items, true);
  });

  readonly remove = vi.fn(async (keys: string | string[]): Promise<void> => {
    await tick();
    const changes: StorageChanges = {};
    for (const key of typeof keys === 'string' ? [keys] : keys) {
      const old = this.#data.get(key);
      if (old === undefined) continue;
      this.#data.delete(key);
      changes[key] = { oldValue: JSON.parse(old) as unknown };
    }
    this.emit(changes);
  });

  readonly clear = vi.fn(async (): Promise<void> => {
    await tick();
    const changes: StorageChanges = {};
    for (const [key, old] of this.#data) changes[key] = { oldValue: JSON.parse(old) as unknown };
    this.#data.clear();
    this.emit(changes);
  });

  readonly getKeys = vi.fn(async (): Promise<string[]> => {
    await tick();
    return [...this.#data.keys()];
  });

  /** Makes the next `times` set() calls reject with `message` (a sync quota error by default). */
  failNextSet(message: string = SYNC_QUOTA_ERRORS.bytesPerItem, times = 1): void {
    for (let i = 0; i < times; i++) this.#setErrors.push(message);
  }

  /** Test setup: writes items synchronously, without onChanged events. */
  seed(items: Record<string, unknown>): void {
    this.write(items, false);
  }

  /** Synchronous view of the stored items, for assertions. */
  snapshot(): Record<string, unknown> {
    return Object.fromEntries(
      [...this.#data].map(([key, text]) => [key, JSON.parse(text) as unknown]),
    );
  }

  api() {
    return {
      get: this.get,
      set: this.set,
      remove: this.remove,
      clear: this.clear,
      getKeys: this.getKeys,
      onChanged: this.onChanged,
    };
  }

  reset(): void {
    this.#data.clear();
    this.#setErrors = [];
    this.onChanged.clear();
  }

  private write(items: Record<string, unknown>, notify: boolean): void {
    const changes: StorageChanges = {};
    for (const [key, value] of Object.entries(items)) {
      const text = JSON.stringify(value) as string | undefined;
      if (text === undefined) continue;
      const old = this.#data.get(key);
      this.#data.set(key, text);
      if (old === text) continue;
      changes[key] = {
        newValue: JSON.parse(text) as unknown,
        ...(old === undefined ? {} : { oldValue: JSON.parse(old) as unknown }),
      };
    }
    if (notify) this.emit(changes);
  }

  private emit(changes: StorageChanges): void {
    if (Object.keys(changes).length === 0) return;
    this.onChanged.dispatch(serialize(changes));
    this.globalOnChanged.dispatch(serialize(changes), this.areaName);
  }
}

export class FakeStorage {
  readonly onChanged: GlobalStorageEvent = new FakeEvent();
  readonly sync = new FakeStorageArea('sync', this.onChanged);
  readonly local = new FakeStorageArea('local', this.onChanged);
  readonly session = new FakeStorageArea('session', this.onChanged);

  get areas(): FakeStorageArea[] {
    return [this.sync, this.local, this.session];
  }

  reset(): void {
    for (const area of this.areas) area.reset();
    this.onChanged.clear();
  }
}

// ── Downloads ──

type DownloadItem = chrome.downloads.DownloadItem;
type InterruptReason = `${chrome.downloads.InterruptReason}`;
/** An entry of FakeDownloads.callLog. */
export type DownloadsCall = { op: 'ui'; enabled: boolean } | { op: 'download'; filename: string };

/** Query keys that are not plain equality filters on a DownloadItem field. */
const NON_FIELD_QUERY_KEYS = new Set([
  'limit',
  'orderBy',
  'query',
  'urlRegex',
  'filenameRegex',
  'finalUrlRegex',
]);

function isSafeDownloadPath(filename: string): boolean {
  if (filename === '' || filename.startsWith('/') || filename.includes('\\')) return false;
  return filename.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** conflictAction 'uniquify': `name (1).ext`, `name (2).ext`, … */
function uniquified(path: string, taken: (path: string) => boolean): string {
  if (!taken(path)) return path;
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const split = dot > slash + 1 ? dot : path.length;
  for (let n = 1; ; n++) {
    const candidate = `${path.slice(0, split)} (${n})${path.slice(split)}`;
    if (!taken(candidate)) return candidate;
  }
}

export class FakeDownloads {
  readonly onChanged = new FakeEvent<[delta: chrome.downloads.DownloadDelta]>();
  /** Chrome's download UI (bubble, toolbar button, per-file animation); on until an extension turns it off. */
  uiEnabled = true;
  /**
   * setUiOptions and download() in order, for ordering assertions, since Chrome has no getter for
   * the UI state (R-005): a `ui` entry once Chrome has applied a setUiOptions call (it resolves
   * right after), a `download` entry the moment download() is called. A `ui` entry before a
   * `download` entry therefore means the setting was in effect when the download was asked for.
   */
  readonly callLog: DownloadsCall[] = [];
  #items = new Map<number, DownloadItem>();
  #nextId = 1;
  #downloadErrors: string[] = [];
  #uiErrors: string[] = [];
  /** Files that finished or were interrupted while Chrome's download UI was on (R-006: only the busy period's last). */
  settledWhileShown: string[] = [];
  #deferNaming = false;
  /** Targets of items created while naming was deferred, by id, until name() sets them. */
  #reserved = new Map<number, string>();
  /** The disk model (D15): ids of completed downloads whose file is no longer on disk. */
  #gone = new Set<number>();
  #existenceCheckDelay = 0;
  /** Bumped by reset(), so a re-check scheduled before it lands on nothing. */
  #epoch = 0;

  /** `uiPermission`: whether the manifest grants "downloads.ui", without which setUiOptions rejects. */
  constructor(private readonly uiPermission: boolean) {}

  readonly download = vi.fn(async (options: chrome.downloads.DownloadOptions): Promise<number> => {
    this.callLog.push({ op: 'download', filename: options.filename ?? '' });
    await tick();
    const error = this.#downloadErrors.shift();
    if (error !== undefined) throw new Error(error);
    const relative = options.filename ?? new URL(options.url).pathname.split('/').pop() ?? '';
    if (!isSafeDownloadPath(relative)) throw new Error(INVALID_FILENAME_ERROR);
    const onDisk = (path: string): boolean =>
      [...this.#items.values()].some(
        (item) =>
          item.state !== 'interrupted' &&
          !this.#gone.has(item.id) &&
          (item.filename || this.#reserved.get(item.id)) === `${DOWNLOADS_DIR}/${path}`,
      );
    const target = options.conflictAction === 'uniquify' ? uniquified(relative, onDisk) : relative;
    const id = this.#nextId++;
    if (this.#deferNaming) this.#reserved.set(id, `${DOWNLOADS_DIR}/${target}`);
    this.#items.set(id, {
      id,
      url: options.url,
      finalUrl: options.url,
      referrer: '',
      filename: this.#deferNaming ? '' : `${DOWNLOADS_DIR}/${target}`,
      mime: '',
      state: 'in_progress',
      danger: 'safe',
      paused: false,
      canResume: false,
      exists: true,
      incognito: false,
      bytesReceived: 0,
      totalBytes: -1,
      fileSize: -1,
      startTime: new Date().toISOString(),
      byExtensionId: FAKE_EXTENSION_ID,
    });
    return id;
  });

  readonly search = vi.fn(
    async (query: chrome.downloads.DownloadQuery): Promise<DownloadItem[]> => {
      await tick();
      const fields = Object.entries(query).filter(
        ([key, value]) => value !== undefined && !NON_FIELD_QUERY_KEYS.has(key),
      );
      const matches = [...this.#items.values()].filter(
        (item) =>
          fields.every(([key, value]) => item[key as keyof DownloadItem] === value) &&
          (query.urlRegex === undefined || new RegExp(query.urlRegex).test(item.url)) &&
          (query.filenameRegex === undefined ||
            new RegExp(query.filenameRegex).test(item.filename)),
      );
      this.scheduleExistenceCheck();
      return serialize(query.limit ? matches.slice(0, query.limit) : matches);
    },
  );

  readonly cancel = vi.fn(async (downloadId: number): Promise<void> => {
    await tick();
    const item = this.#items.get(downloadId);
    if (!item) throw new Error(`Invalid download id ${downloadId}`);
    if (item.state === 'in_progress') this.interrupt(downloadId, 'USER_CANCELED');
  });

  readonly setUiOptions = vi.fn(async (options: chrome.downloads.UiOptions): Promise<void> => {
    await tick();
    if (!this.uiPermission) throw new Error(UI_PERMISSION_ERROR);
    const error = this.#uiErrors.shift();
    if (error !== undefined) throw new Error(error);
    this.uiEnabled = options.enabled;
    this.callLog.push({ op: 'ui', enabled: options.enabled });
  });

  /** Makes the next `times` download() calls reject with `message` (Chrome's "Invalid filename"). */
  failNextDownload(message: string = INVALID_FILENAME_ERROR, times = 1): void {
    for (let i = 0; i < times; i++) this.#downloadErrors.push(message);
  }

  /** Makes the next `times` setUiOptions() calls reject with `message`, changing nothing. */
  failNextSetUiOptions(message: string = UI_DISABLED_ERROR, times = 1): void {
    for (let i = 0; i < times; i++) this.#uiErrors.push(message);
  }

  /**
   * While on, download() creates its item with `filename: ''` and only reserves the target (so a
   * second download of the same path still gets ` (1)`), like Chrome determining a download's
   * target path a few milliseconds after creating it (R-006). name(id) then sets it. Off by
   * default: items are named at creation.
   */
  deferNaming(on: boolean): void {
    this.#deferNaming = on;
  }

  /** Chrome determined download `id`'s target path: sets the reserved filename, fires onChanged. */
  name(id: number): DownloadItem {
    const item = this.#items.get(id);
    const current = this.#reserved.get(id);
    if (!item || current === undefined) throw new Error(`no unnamed download (id ${id})`);
    this.#reserved.delete(id);
    item.filename = current;
    this.onChanged.dispatch({ id, filename: { previous: '', current } });
    return serialize(item);
  }

  /**
   * The user moved or deleted download `id`'s file (D15). The record is untouched: `exists` stays
   * `true` until a search() makes Chrome re-check (platform fact 2).
   */
  removeFile(id: number): void {
    const item = this.#items.get(id);
    if (item?.state !== 'complete') throw new Error(`no completed download (id ${id})`);
    this.#gone.add(id);
  }

  /** removeFile() for every completed download matching `predicate`. */
  removeFiles(predicate: (item: DownloadItem) => boolean): void {
    for (const item of this.#items.values()) {
      if (item.state === 'complete' && predicate(serialize(item))) this.#gone.add(item.id);
    }
  }

  /**
   * How long after a search() Chrome's existence re-check lands (default 0: the next macrotask).
   * Chrome's 10 s rate limit is not modelled (design-test-harness.md L2).
   */
  existenceCheckDelay(ms: number): void {
    this.#existenceCheckDelay = ms;
  }

  /**
   * Seeds a finished download at exactly `relativePath` (no uniquify, no call-log entry): an
   * earlier browser session's download, or another extension's. `exists: false` is a record
   * Chrome already flagged, its file gone.
   */
  addCompleted(
    relativePath: string,
    options: { exists?: boolean; byExtensionId?: string } = {},
  ): DownloadItem {
    const id = this.#nextId++;
    const now = new Date().toISOString();
    const exists = options.exists ?? true;
    const item: DownloadItem = {
      id,
      url: `blob:${EXTENSION_ORIGIN}/seeded-${id}`,
      finalUrl: `blob:${EXTENSION_ORIGIN}/seeded-${id}`,
      referrer: '',
      filename: `${DOWNLOADS_DIR}/${relativePath}`,
      mime: '',
      state: 'complete',
      danger: 'safe',
      paused: false,
      canResume: false,
      exists,
      incognito: false,
      bytesReceived: 0,
      totalBytes: -1,
      fileSize: -1,
      startTime: now,
      endTime: now,
      byExtensionId: options.byExtensionId ?? FAKE_EXTENSION_ID,
    };
    this.#items.set(id, item);
    if (!exists) this.#gone.add(id);
    return serialize(item);
  }

  /** The `ui` entries of the call log: every setting Chrome applied, oldest first. */
  uiCalls(): boolean[] {
    return this.callLog.flatMap((call) => (call.op === 'ui' ? [call.enabled] : []));
  }

  /** Every download so far, oldest first. */
  items(): DownloadItem[] {
    return serialize([...this.#items.values()]);
  }

  /** The completion queue: downloads still in progress, oldest first. */
  inProgress(): DownloadItem[] {
    return this.items().filter((item) => item.state === 'in_progress');
  }

  /**
   * Completes download `id` (default: the oldest in progress) and fires onChanged; an item not
   * named yet is named first, with its own `filename` delta.
   */
  complete(id?: number): DownloadItem {
    const item = this.pending(id);
    if (this.#reserved.has(item.id)) this.name(item.id);
    item.state = 'complete';
    if (this.uiEnabled) this.settledWhileShown.push(item.filename);
    item.endTime = new Date().toISOString();
    this.onChanged.dispatch({
      id: item.id,
      state: { previous: 'in_progress', current: 'complete' },
      endTime: { current: item.endTime },
    });
    return serialize(item);
  }

  /**
   * Interrupts download `id` (default: the oldest in progress) with `reason`; fires onChanged. An
   * item not named yet is named first, with its own `filename` delta.
   */
  interrupt(id: number | undefined, reason: InterruptReason): DownloadItem {
    const item = this.pending(id);
    if (this.#reserved.has(item.id)) this.name(item.id);
    item.state = 'interrupted';
    if (this.uiEnabled) this.settledWhileShown.push(item.filename);
    item.error = reason;
    item.exists = false;
    this.onChanged.dispatch({
      id: item.id,
      state: { previous: 'in_progress', current: 'interrupted' },
      error: { current: reason },
    });
    return serialize(item);
  }

  /** Completes every download in progress, oldest first. */
  completeAll(): void {
    for (const item of this.inProgress()) this.complete(item.id);
  }

  reset(): void {
    this.#items.clear();
    this.#nextId = 1;
    this.#downloadErrors = [];
    this.#uiErrors = [];
    this.#deferNaming = false;
    this.#reserved.clear();
    this.#gone.clear();
    this.#existenceCheckDelay = 0;
    this.#epoch++;
    this.uiEnabled = true;
    this.callLog.length = 0;
    this.settledWhileShown.length = 0;
    this.onChanged.clear();
  }

  /**
   * Chrome's re-check on search() (platform fact 2): every complete, not-yet-flagged item whose
   * file is gone gets `exists: false` and one `exists` delta, after the delay. No timer when no
   * file is gone, so tests that never remove a file see no extra timer.
   */
  private scheduleExistenceCheck(): void {
    const gone = [...this.#items.values()].filter(
      (item) => item.state === 'complete' && item.exists && this.#gone.has(item.id),
    );
    if (gone.length === 0) return;
    const epoch = this.#epoch;
    setTimeout(() => {
      if (epoch !== this.#epoch) return;
      for (const item of gone) {
        if (!item.exists) continue;
        item.exists = false;
        this.onChanged.dispatch({ id: item.id, exists: { previous: true, current: false } });
      }
    }, this.#existenceCheckDelay);
  }

  private pending(id: number | undefined): DownloadItem {
    const item =
      id === undefined
        ? [...this.#items.values()].find((i) => i.state === 'in_progress')
        : this.#items.get(id);
    if (item?.state !== 'in_progress') throw new Error(`no download in progress (id ${id})`);
    return item;
  }
}

// ── Action ──

const UNSET_COLOR: ColorArray = [0, 0, 0, 0];

export class FakeAction {
  readonly onClicked = new FakeEvent<[tab: chrome.tabs.Tab]>();
  badgeText = '';
  badgeBackgroundColor: ColorArray = [...UNSET_COLOR];
  badgeTextColor: ColorArray = [...UNSET_COLOR];
  title: string;

  constructor(private readonly defaultTitle: string) {
    this.title = defaultTitle;
  }

  readonly setBadgeText = vi.fn(async (details: chrome.action.BadgeTextDetails): Promise<void> => {
    await tick();
    this.badgeText = details.text ?? '';
  });
  readonly getBadgeText = vi.fn(async (): Promise<string> => {
    await tick();
    return this.badgeText;
  });
  readonly setBadgeBackgroundColor = vi.fn(
    async (details: chrome.action.BadgeColorDetails): Promise<void> => {
      await tick();
      this.badgeBackgroundColor = parseColor(details.color);
    },
  );
  readonly getBadgeBackgroundColor = vi.fn(async (): Promise<ColorArray> => {
    await tick();
    return [...this.badgeBackgroundColor];
  });
  readonly setBadgeTextColor = vi.fn(
    async (details: chrome.action.BadgeColorDetails): Promise<void> => {
      await tick();
      this.badgeTextColor = parseColor(details.color);
    },
  );
  readonly getBadgeTextColor = vi.fn(async (): Promise<ColorArray> => {
    await tick();
    return [...this.badgeTextColor];
  });
  readonly setTitle = vi.fn(async (details: chrome.action.TitleDetails): Promise<void> => {
    await tick();
    this.title = details.title;
  });
  readonly getTitle = vi.fn(async (): Promise<string> => {
    await tick();
    return this.title;
  });

  /** A toolbar click while `tab` is the active tab: fires action.onClicked. */
  click(tab: chrome.tabs.Tab): void {
    this.onClicked.dispatch({ ...tab });
  }

  reset(): void {
    this.badgeText = '';
    this.badgeBackgroundColor = [...UNSET_COLOR];
    this.badgeTextColor = [...UNSET_COLOR];
    this.title = this.defaultTitle;
    this.onClicked.clear();
  }
}

// ── Tabs and windows ──

export interface AddTabOptions {
  url: string;
  /** Defaults to the focused window. */
  windowId?: number;
  /** Defaults to the end of the window's tab strip. */
  index?: number;
  /** Defaults to true for the first tab of a window. */
  active?: boolean;
  openerTabId?: number;
}

export class FakeTabs {
  #tabs = new Map<number, FakeTab>();
  #windows = new Map<number, { focused: boolean }>();
  #nextTabId = 1;
  #nextWindowId = 1;

  constructor(private readonly fake: ChromeFake) {
    this.addWindow();
  }

  readonly create = vi.fn(
    async (properties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> => {
      await tick();
      const windowId = properties.windowId ?? this.focusedWindowId();
      if (!this.#windows.has(windowId)) throw new Error(`No window with id: ${windowId}.`);
      const tab = this.add({
        url: properties.url ?? 'chrome://newtab/',
        windowId,
        active: properties.active ?? true,
        ...(properties.index === undefined ? {} : { index: properties.index }),
        ...(properties.openerTabId === undefined ? {} : { openerTabId: properties.openerTabId }),
      });
      return { ...tab.tab };
    },
  );

  readonly update = vi.fn(
    async (tabId: number, properties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab> => {
      await tick();
      const tab = this.#tabs.get(tabId);
      if (!tab) throw new Error(`No tab with id: ${tabId}.`);
      if (properties.url !== undefined) tab.tab.url = properties.url;
      if (properties.active) this.activate(tab);
      return { ...tab.tab };
    },
  );

  readonly sendMessage = vi.fn(
    async (
      tabId: number,
      message: unknown,
      options?: chrome.tabs.MessageSendOptions,
    ): Promise<unknown> => {
      await tick();
      const tab = this.#tabs.get(tabId);
      if (!tab || (options?.frameId ?? 0) !== 0) throw new Error(RECEIVING_END_ERROR);
      return deliver([tab.onMessage], message, this.fake.workerSender());
    },
  );

  readonly updateWindow = vi.fn(
    async (windowId: number, info: chrome.windows.UpdateInfo): Promise<chrome.windows.Window> => {
      await tick();
      const window = this.#windows.get(windowId);
      if (!window) throw new Error(`No window with id: ${windowId}.`);
      if (info.focused) for (const [id, w] of this.#windows) w.focused = id === windowId;
      return { id: windowId, focused: window.focused, alwaysOnTop: false, incognito: false };
    },
  );

  /** Opens a window (the fake starts with window 1, focused) and returns its id. */
  addWindow(options: { focused?: boolean } = {}): number {
    const id = this.#nextWindowId++;
    const focused = options.focused ?? this.#windows.size === 0;
    if (focused) for (const w of this.#windows.values()) w.focused = false;
    this.#windows.set(id, { focused });
    return id;
  }

  focusedWindowId(): number {
    for (const [id, w] of this.#windows) if (w.focused) return id;
    return [...this.#windows.keys()].at(-1) ?? -1;
  }

  isFocused(windowId: number): boolean {
    return this.#windows.get(windowId)?.focused ?? false;
  }

  /** Opens a tab (test setup); tabs.create goes through here as well. */
  add(options: AddTabOptions): FakeTab {
    const windowId = options.windowId ?? this.focusedWindowId();
    const strip = this.inWindow(windowId);
    const index = Math.min(Math.max(options.index ?? strip.length, 0), strip.length);
    for (const other of strip) if (other.tab.index >= index) other.tab.index++;
    const id = this.#nextTabId++;
    const tab = new FakeTab(this.fake, {
      id,
      index,
      windowId,
      url: options.url,
      active: false,
      highlighted: false,
      selected: false,
      pinned: false,
      incognito: false,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      groupId: -1,
      lastAccessed: Date.now(),
      ...(options.openerTabId === undefined ? {} : { openerTabId: options.openerTabId }),
    });
    this.#tabs.set(id, tab);
    if (options.active ?? strip.length === 0) this.activate(tab);
    return tab;
  }

  get(tabId: number): FakeTab | undefined {
    return this.#tabs.get(tabId);
  }

  all(): FakeTab[] {
    return [...this.#tabs.values()];
  }

  /** Tabs of `windowId` in tab-strip order. */
  inWindow(windowId: number): FakeTab[] {
    return this.all()
      .filter((t) => t.tab.windowId === windowId)
      .sort((a, b) => a.tab.index - b.tab.index);
  }

  remove(tabId: number): void {
    const tab = this.#tabs.get(tabId);
    if (!tab) return;
    this.#tabs.delete(tabId);
    for (const other of this.inWindow(tab.tab.windowId)) {
      if (other.tab.index > tab.tab.index) other.tab.index--;
    }
  }

  reset(): void {
    this.#tabs.clear();
    this.#windows.clear();
    this.#nextTabId = 1;
    this.#nextWindowId = 1;
    this.addWindow();
  }

  private activate(tab: FakeTab): void {
    for (const other of this.inWindow(tab.tab.windowId)) {
      other.tab.active = other === tab;
      other.tab.highlighted = other === tab;
      other.tab.selected = other === tab;
    }
  }
}

// ── Offscreen document ──

/** A lifecycle hold (D16): the held step completes at `release()`. */
export interface Hold {
  readonly release: () => void;
}

interface PendingHold extends Hold {
  readonly released: Promise<void>;
}

function createHold(onRelease: () => void): PendingHold {
  let resolve!: () => void;
  const released = new Promise<void>((r) => (resolve = r));
  return {
    released,
    release: () => {
      onRelease();
      resolve();
    },
  };
}

export class FakeOffscreen {
  document: FakeOffscreenDocument | null = null;
  #creating = false;
  #handler: MessageHandler | null = null;
  #nextDocument = 1;
  #creationHold: PendingHold | null = null;
  #closeHold: PendingHold | null = null;
  /** The document a hold keeps listed without listeners; setHandler leaves it deaf. */
  #deaf: FakeOffscreenDocument | null = null;

  constructor(private readonly fake: ChromeFake) {}

  readonly createDocument = vi.fn(
    async (parameters: chrome.offscreen.CreateParameters): Promise<void> => {
      if (this.document || this.#creating) {
        throw new Error('Only a single offscreen document may be created.');
      }
      if (parameters.reasons.length === 0) throw new Error('A reason must be provided.');
      if (!parameters.justification) throw new Error('A justification must be provided.');
      const hold = this.#creationHold;
      this.#creating = true;
      await tick();
      this.#creating = false;
      const doc = new FakeOffscreenDocument(
        this.fake,
        this.fake.getURL(parameters.url),
        `offscreen-${this.#nextDocument++}`,
      );
      if (hold) {
        this.#deaf = doc;
        this.document = doc;
        await hold.released;
        if (this.#deaf === doc) this.#deaf = null;
        if (this.#handler && this.document === doc) doc.handle(this.#handler);
        return;
      }
      if (this.#handler) doc.handle(this.#handler);
      this.document = doc;
    },
  );

  readonly closeDocument = vi.fn(async (): Promise<void> => {
    const hold = this.#closeHold;
    const doc = this.document;
    if (hold && doc) {
      doc.onMessage.clear();
      this.#deaf = doc;
      await hold.released;
      if (this.#deaf === doc) this.#deaf = null;
      if (this.document === doc) this.document = null;
      return;
    }
    await tick();
    if (!this.document) throw new Error('No current offscreen document.');
    this.document = null;
  });

  /**
   * Until `release()`, createDocument() stops in Chrome's window between creating the context and
   * running its script: the document is listed by runtime.getContexts but has no listener, so sends to it
   * reject with RECEIVING_END_ERROR. `release()` installs the scripted handler and resolves the
   * createDocument promise.
   */
  holdCreation(): Hold {
    const hold = createHold(() => {
      if (this.#creationHold === hold) this.#creationHold = null;
    });
    this.#creationHold = hold;
    return { release: hold.release };
  }

  /**
   * Holds closeDocument(): the document loses its listeners at once but stays listed by
   * runtime.getContexts until `release()`, which removes it and resolves the closeDocument promise.
   */
  holdClose(): Hold {
    const hold = createHold(() => {
      if (this.#closeHold === hold) this.#closeHold = null;
    });
    this.#closeHold = hold;
    return { release: hold.release };
  }

  /**
   * The scripted behavior of the offscreen document: the current document and every one created
   * later answer messages with `handler`. Without a handler a document has no listener, so sends
   * to it reject with RECEIVING_END_ERROR.
   */
  setHandler(handler: MessageHandler): void {
    this.#handler = handler;
    if (this.document && this.document !== this.#deaf) {
      this.document.onMessage.clear();
      this.document.handle(handler);
    }
  }

  /** The document goes away without closeDocument() (a crash). */
  destroy(): void {
    this.document = null;
  }

  reset(): void {
    this.document = null;
    this.#creating = false;
    this.#handler = null;
    this.#nextDocument = 1;
    this.#creationHold = null;
    this.#closeHold = null;
    this.#deaf = null;
  }
}

// ── declarativeNetRequest ──

export class FakeDnr {
  rules: chrome.declarativeNetRequest.Rule[] = [];

  readonly updateSessionRules = vi.fn(
    async (options: chrome.declarativeNetRequest.UpdateRuleOptions): Promise<void> => {
      await tick();
      const removed = new Set(options.removeRuleIds ?? []);
      const kept = this.rules.filter((rule) => !removed.has(rule.id));
      for (const rule of options.addRules ?? []) {
        if (kept.some((other) => other.id === rule.id)) {
          throw new Error(`Rule with id ${rule.id} does not have a unique ID.`);
        }
        kept.push(serialize(rule));
      }
      this.rules = kept;
    },
  );

  readonly getSessionRules = vi.fn(
    async (
      filter?: chrome.declarativeNetRequest.GetRulesFilter,
    ): Promise<chrome.declarativeNetRequest.Rule[]> => {
      await tick();
      const ids = filter?.ruleIds;
      return serialize(ids ? this.rules.filter((rule) => ids.includes(rule.id)) : this.rules);
    },
  );

  reset(): void {
    this.rules = [];
  }
}

// ── The fake ──

export interface InstallOptions {
  /** UI locale for i18n.getMessage (default `en`). */
  locale?: Locale;
}

// Not `new URL(…, import.meta.url)`: under happy-dom, Vite rewrites that to a server URL.
const MANIFEST = JSON.parse(
  readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/manifest.json'),
    'utf8',
  ),
) as chrome.runtime.Manifest;

function createApi(fake: ChromeFake, getMessage: GetMessage) {
  const { storage, downloads, action, tabs, offscreen, dnr } = fake;
  return {
    storage: {
      sync: storage.sync.api(),
      local: storage.local.api(),
      session: storage.session.api(),
      onChanged: storage.onChanged,
    },
    downloads: {
      download: downloads.download,
      search: downloads.search,
      cancel: downloads.cancel,
      setUiOptions: downloads.setUiOptions,
      onChanged: downloads.onChanged,
    },
    action: {
      setBadgeText: action.setBadgeText,
      getBadgeText: action.getBadgeText,
      setBadgeBackgroundColor: action.setBadgeBackgroundColor,
      getBadgeBackgroundColor: action.getBadgeBackgroundColor,
      setBadgeTextColor: action.setBadgeTextColor,
      getBadgeTextColor: action.getBadgeTextColor,
      setTitle: action.setTitle,
      getTitle: action.getTitle,
      onClicked: action.onClicked,
    },
    runtime: {
      id: FAKE_EXTENSION_ID,
      onMessage: fake.workerOnMessage,
      sendMessage: vi.fn((message: unknown): Promise<unknown> =>
        fake.sendRuntimeMessage('worker', message),
      ),
      getContexts: vi.fn(
        async (
          filter: chrome.runtime.ContextFilter,
        ): Promise<chrome.runtime.ExtensionContext[]> => {
          await tick();
          return fake.contexts(filter);
        },
      ),
      getURL: vi.fn((path: string): string => fake.getURL(path)),
      getManifest: vi.fn((): chrome.runtime.Manifest => serialize(MANIFEST)),
    },
    tabs: {
      create: tabs.create,
      update: tabs.update,
      sendMessage: tabs.sendMessage,
    },
    windows: { update: tabs.updateWindow },
    offscreen: {
      createDocument: offscreen.createDocument,
      closeDocument: offscreen.closeDocument,
    },
    declarativeNetRequest: {
      updateSessionRules: dnr.updateSessionRules,
      getSessionRules: dnr.getSessionRules,
    },
    i18n: { getMessage: vi.fn(getMessage) },
  };
}

export type FakeChromeApi = ReturnType<typeof createApi>;

export class ChromeFake {
  readonly storage = new FakeStorage();
  readonly downloads = new FakeDownloads(MANIFEST.permissions?.includes('downloads.ui') ?? false);
  readonly action: FakeAction;
  readonly tabs: FakeTabs = new FakeTabs(this);
  readonly offscreen: FakeOffscreen = new FakeOffscreen(this);
  readonly dnr = new FakeDnr();
  /** The SW's chrome.runtime.onMessage. */
  readonly workerOnMessage: MessageEvent = new FakeEvent();
  /** The object installed as globalThis.chrome. */
  readonly api: FakeChromeApi;

  constructor(options: InstallOptions = {}) {
    const getMessage = createGetMessage(options.locale ?? 'en');
    this.action = new FakeAction(getMessage('action_title_idle'));
    this.api = createApi(this, getMessage);
  }

  getURL(path: string): string {
    return `${EXTENSION_ORIGIN}/${path.replace(/^\//, '')}`;
  }

  /** Sender info of messages from the SW. */
  workerSender(): Sender {
    return { id: FAKE_EXTENSION_ID, url: SW_URL, origin: EXTENSION_ORIGIN };
  }

  /**
   * runtime.sendMessage routing: every extension context except the sender receives it (the SW,
   * the offscreen document, extension pages in tabs). Content scripts never do; they only receive
   * tabs.sendMessage.
   */
  sendRuntimeMessage(from: FakeEndpoint | 'worker', message: unknown): Promise<unknown> {
    const receivers: MessageEvent[] = [];
    if (from !== 'worker') receivers.push(this.workerOnMessage);
    const doc = this.offscreen.document;
    if (doc && doc !== from) receivers.push(doc.onMessage);
    for (const tab of this.tabs.all()) {
      if (tab.isExtensionPage && tab !== from) receivers.push(tab.onMessage);
    }
    const sender = from === 'worker' ? this.workerSender() : from.sender();
    return tick().then(() => deliver(receivers, message, sender));
  }

  /** runtime.getContexts over the SW, the offscreen document and extension pages in tabs. */
  contexts(filter: chrome.runtime.ContextFilter): chrome.runtime.ExtensionContext[] {
    const all: chrome.runtime.ExtensionContext[] = [
      {
        contextId: 'ctx-worker',
        contextType: 'BACKGROUND',
        frameId: -1,
        tabId: -1,
        windowId: -1,
        incognito: false,
      },
    ];
    const doc = this.offscreen.document;
    if (doc) {
      all.push({
        contextId: doc.contextId,
        contextType: 'OFFSCREEN_DOCUMENT',
        documentId: doc.documentId,
        documentOrigin: EXTENSION_ORIGIN,
        documentUrl: doc.url,
        frameId: 0,
        tabId: -1,
        windowId: -1,
        incognito: false,
      });
    }
    for (const tab of this.tabs.all()) {
      if (!tab.isExtensionPage) continue;
      all.push({
        contextId: `ctx-tab-${tab.id}`,
        contextType: 'TAB',
        documentId: `doc-tab-${tab.id}`,
        documentOrigin: EXTENSION_ORIGIN,
        documentUrl: tab.tab.url ?? '',
        frameId: 0,
        tabId: tab.id,
        windowId: tab.tab.windowId,
        incognito: false,
      });
    }
    const matches = <T>(wanted: T[] | undefined, value: T): boolean =>
      wanted === undefined || wanted.includes(value);
    return all.filter(
      (ctx) =>
        matches(filter.contextIds, ctx.contextId) &&
        matches(filter.contextTypes, ctx.contextType) &&
        matches(filter.documentUrls, ctx.documentUrl ?? '') &&
        matches(filter.documentOrigins, ctx.documentOrigin ?? '') &&
        matches(filter.tabIds, ctx.tabId) &&
        matches(filter.windowIds, ctx.windowId) &&
        matches(filter.frameIds, ctx.frameId),
    );
  }

  /**
   * Simulates Chrome stopping the service worker: drops every listener registered on the global
   * chrome object and keeps all other state (storage, downloads and the download UI setting, badge,
   * tabs, offscreen document, DNR rules). Follow with `vi.resetModules()` and a re-import of sw.ts.
   */
  restartWorker(): void {
    this.workerOnMessage.clear();
    this.downloads.onChanged.clear();
    this.action.onClicked.clear();
    this.storage.onChanged.clear();
    for (const area of this.storage.areas) area.onChanged.clear();
  }

  /** Back to the freshly installed state; the installed objects stay the same. */
  reset(): void {
    this.storage.reset();
    this.downloads.reset();
    this.action.reset();
    this.tabs.reset();
    this.offscreen.reset();
    this.dnr.reset();
    this.workerOnMessage.clear();
    resetMocks(this.api);
  }
}

function resetMocks(value: unknown): void {
  if (vi.isMockFunction(value)) {
    value.mockReset();
  } else if (typeof value === 'object' && value !== null && !(value instanceof FakeEvent)) {
    for (const child of Object.values(value)) resetMocks(child);
  }
}

/** Creates a fresh fake and installs it as globalThis.chrome (undo with vi.unstubAllGlobals()). */
export function installChromeFake(options: InstallOptions = {}): ChromeFake {
  const fake = new ChromeFake(options);
  vi.stubGlobal('chrome', fake.api);
  return fake;
}
