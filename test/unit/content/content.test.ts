// @vitest-environment happy-dom
// content.ts end to end inside happy-dom: the e2e fake page (rendered by its own page script),
// a stubbed chrome.* and fetch, and the button read through its closed shadow root.
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { masterUrl, pageCount, requireWork, WORKS } from '../../../e2e/fixtures/works';
import { failure, illustBody, isWalled, MESSAGE_NOT_FOUND, ok } from '../../../e2e/server/ajax';
import {
  artworkPageTitle,
  type CatalogEntry,
  fakePixivApp,
  type FakeWindow,
  ROW_DELAY_MS,
  ROW_MARK,
  wwwPage,
} from '../../../e2e/server/page';
import { FLOAT_FALLBACK_MS, PIXIV_LOGIN_URL, SETTINGS_KEY } from '../../../src/shared/constants';
import type { JobView } from '../../../src/shared/types';

const ILLUST = '135882741'; // 12 pages
const SINGLE = '135882742'; // 1 page
const R18 = '145892669'; // xRestrict 1
const WALLED = '135882745'; // xRestrict 0, behind pixiv's sensitive-content wall (R-003)
const UGOIRA = '136004512'; // 600 × 600
const DELETED = '199999999';
const UNUSED = '135882743'; // shown only to tear an instance down

type Listener = (...args: unknown[]) => unknown;
type SwAnswer = (message: Record<string, unknown>) => unknown;

let messageListeners: Listener[];
let storageListeners: Listener[];
let stored: Record<'sync' | 'local', Record<string, unknown>>;
let sendMessage: ReturnType<typeof vi.fn<SwAnswer>>;
let fetchMock: ReturnType<typeof vi.fn>;
let navigation: EventTarget;
let attachShadow: MockInstance<Element['attachShadow']>;
/** Removes the fake page script's document/window listeners (the document outlives each test). */
let removePageListeners: (() => void)[] = [];

/** Echoes the key and its substitutions, e.g. `hint_pages(12)` (see button/view.test.ts). */
function echoMessage(key: string, subs?: string | string[]): string {
  const list = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
  return list.length === 0 ? key : `${key}(${list.join(',')})`;
}

function listenerSet(list: Listener[]) {
  return {
    addListener: vi.fn((listener: Listener) => list.push(listener)),
    removeListener: vi.fn((listener: Listener) => list.splice(list.indexOf(listener) >>> 0, 1)),
  };
}

function view(overrides: Partial<JobView> = {}): JobView {
  return {
    jobId: 'job-1',
    artworkId: ILLUST,
    kind: 'pages',
    status: 'running',
    progress: null,
    format: null,
    folder: null,
    outcome: null,
    ...overrides,
  };
}

/** What the SW (task 3.2) answers, per the src/shared/messages.ts catalog. */
const SW: SwAnswer = (message) => {
  switch (message.type) {
    case 'job/listForTab':
      return { ok: true, views: [] };
    case 'job/start':
      return { ok: true, view: view({ artworkId: String(message.artworkId) }) };
    case 'job/cancel':
      return { ok: true };
    case 'caps/get':
      return { ok: true, caps: { avc: 'avc1.64001e', vp9: true } };
    default:
      return undefined;
  }
};

function installChrome(): void {
  messageListeners = [];
  storageListeners = [];
  stored = { sync: {}, local: {} };
  sendMessage = vi.fn<SwAnswer>((message) => Promise.resolve(SW(message)));
  const area = (name: 'sync' | 'local') => ({
    get: vi.fn((key: string) =>
      Promise.resolve(key in stored[name] ? { [key]: stored[name][key] } : {}),
    ),
  });
  vi.stubGlobal('chrome', {
    i18n: { getMessage: echoMessage },
    runtime: { sendMessage, onMessage: listenerSet(messageListeners) },
    storage: {
      sync: area('sync'),
      local: area('local'),
      onChanged: listenerSet(storageListeners),
    },
  });
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The fake server's /ajax/illust/{id}, logged out. */
function installFetch(): void {
  fetchMock = vi.fn((input: string) => {
    const id = /\/ajax\/illust\/(\d+)$/.exec(input)?.[1] ?? '';
    const work = WORKS.find((candidate) => candidate.id === id);
    if (!work || work.deleted) return Promise.resolve(json(404, failure(MESSAGE_NOT_FOUND)));
    return Promise.resolve(json(200, ok(illustBody(work, isWalled(work, false)))));
  });
  vi.stubGlobal('fetch', fetchMock);
}

function catalog(): Record<string, CatalogEntry> {
  return Object.fromEntries(
    WORKS.map((work) => [
      work.id,
      {
        id: work.id,
        title: work.title,
        userName: work.userName,
        userId: work.userId,
        xRestrict: work.xRestrict,
        sensitiveWall: work.sensitiveWall === true,
        pageCount: pageCount(work),
        description: work.description,
        tags: work.tags,
        master: masterUrl(work),
        width: work.width,
        height: work.height,
        pageTitle: artworkPageTitle(work),
      },
    ]),
  );
}

function loadDocument(parsed: Document): void {
  const root = document.documentElement;
  for (const attr of Array.from(root.attributes)) root.removeAttribute(attr.name);
  for (const attr of Array.from(parsed.documentElement.attributes)) {
    root.setAttribute(attr.name, attr.value);
  }
  root.replaceChildren(
    ...Array.from(parsed.documentElement.childNodes, (node) => document.importNode(node, true)),
  );
}

/** The fake pixiv page for `path`, logged out, rendered by its own page script. */
function loadFakePage(path: string): void {
  const works = catalog();
  const illustId = /artworks\/(\d+)/.exec(path)?.[1] ?? null;
  const html = wwwPage({ title: 'pixiv', loggedIn: false, illustId, works });
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelector('script:not([type])')?.remove();
  loadDocument(parsed);
  history.replaceState(null, '', path);
  const onDocument = vi.spyOn(document, 'addEventListener');
  const onWindow = vi.spyOn(window, 'addEventListener');
  fakePixivApp({ loggedIn: false, works, rowDelayMs: ROW_DELAY_MS, rowMark: ROW_MARK });
  for (const [target, spy] of [
    [document, onDocument],
    [window, onWindow],
  ] as const) {
    for (const [type, listener] of spy.mock.calls) {
      if (listener) removePageListeners.push(() => target.removeEventListener(type, listener));
    }
    spy.mockRestore();
  }
}

async function startContent(): Promise<void> {
  vi.resetModules();
  await import('../../../src/content/content');
}

/** Lets fetches, messages, the MutationObserver and the next animation frame settle. */
async function settle(ms = 20): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Loads `path`, starts the content script, and waits until pixiv's row has rendered. */
async function open(path: string): Promise<void> {
  loadFakePage(path);
  await startContent();
  await settle(ROW_DELAY_MS + 20);
}

function fake(): FakeWindow['__fake'] {
  return (window as unknown as FakeWindow).__fake;
}

function hosts(): Element[] {
  return Array.from(document.getElementsByTagName('hfp-download'));
}

function shadowRoot(): ShadowRoot | undefined {
  return attachShadow.mock.results[0]?.value as ShadowRoot | undefined;
}

function pill(): HTMLButtonElement {
  const found = shadowRoot()?.querySelector<HTMLButtonElement>('.pill:not(.measure)');
  if (!found) throw new Error('no button rendered');
  return found;
}

/** `label · hint` of the main face, e.g. `btn_download · hint_pages(12)`. */
function text(): string {
  const face = pill().querySelector('.face-main');
  const label = face?.querySelector('.label')?.textContent ?? '';
  const hint = face?.querySelector<HTMLElement>('.hint');
  return hint && !hint.hidden ? `${label} · ${hint.textContent}` : label;
}

function swMessages(type: string): Record<string, unknown>[] {
  return sendMessage.mock.calls.map(([m]) => m).filter((m) => m.type === type);
}

function dispatchToTab(message: unknown): { returned: unknown; sendResponse: Listener } {
  const sendResponse = vi.fn();
  const returned = messageListeners.map((listener) => listener(message, {}, sendResponse))[0];
  return { returned, sendResponse };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Boxes for pixiv's row; the measurement pill is narrower than the English 164 px floor.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.classList.contains('measure')
      ? new DOMRect(0, 0, 150, 40)
      : new DOMRect(0, 0, 704, 48);
  });
  // The button's shadow root is closed: keep a handle on it as it is attached.
  attachShadow = vi.spyOn(Element.prototype, 'attachShadow');
  navigation = new EventTarget();
  vi.stubGlobal('navigation', navigation);
  Object.defineProperty(document, 'fonts', {
    value: { ready: Promise.resolve() },
    configurable: true,
  });
  // The fake page script schedules its row on `load` until the document is complete.
  Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
  installChrome();
  installFetch();
  delete window.__hfpInit;
});

afterEach(() => {
  // Tear the instance down, or it keeps listening to this window in later tests: show a fresh
  // artwork, whose click sends job/start, and let that send fail as after an extension update.
  sendMessage.mockImplementation(() => {
    throw new Error('Extension context invalidated.');
  });
  history.pushState(null, '', `/artworks/${UNUSED}`);
  navigation.dispatchEvent(new Event('currententrychange'));
  shadowRoot()?.querySelector<HTMLElement>('.pill:not(.measure)')?.click();
  for (const remove of removePageListeners) remove();
  removePageListeners = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'fonts');
  Reflect.deleteProperty(document, 'readyState');
  history.replaceState(null, '', '/');
});

describe('content: routes', () => {
  it('content: no button on a non-artwork route', async () => {
    await open('/users/40285173');
    await settle(FLOAT_FALLBACK_MS);
    expect(hosts()).toEqual([]);
  });

  it('content: exactly one button on an artwork route, right after the like wrapper', async () => {
    await open(`/artworks/${ILLUST}`);
    const like = document.querySelector('section.row > .like');
    expect([hosts().length, hosts()[0]?.previousElementSibling]).toEqual([1, like]);
  });

  it('content: also on a locale-prefixed route (/en/artworks/<id>)', async () => {
    await open(`/en/artworks/${ILLUST}`);
    expect(hosts()).toHaveLength(1);
  });

  it('content: the window.__hfpInit guard keeps a second injection out', async () => {
    await open(`/artworks/${ILLUST}`);
    await startContent();
    await settle();
    expect([hosts().length, messageListeners.length]).toEqual([1, 1]);
  });

  it('content: SPA navigation to another artwork moves the one button there', async () => {
    await open(`/artworks/${ILLUST}`);
    document.querySelector<HTMLElement>(`a[href="/artworks/${SINGLE}"]`)?.click();
    await settle(ROW_DELAY_MS + 20);
    expect([hosts().length, text()]).toEqual([1, 'btn_download']);
  });

  it('content: SPA navigation off artworks removes the button', async () => {
    await open(`/artworks/${ILLUST}`);
    document.querySelector<HTMLElement>('a[href="/users/40285173"]')?.click();
    await settle(FLOAT_FALLBACK_MS);
    expect(hosts()).toEqual([]);
  });

  it('content: the Navigation API event triggers the route check', async () => {
    await open(`/artworks/${ILLUST}`);
    history.pushState(null, '', '/users/40285173');
    navigation.dispatchEvent(new Event('currententrychange'));
    expect(hosts()).toEqual([]);
  });
});

describe('content: render-time metadata', () => {
  it('content: idle shows the page count from /ajax/illust (Download · 12P)', async () => {
    await open(`/artworks/${ILLUST}`);
    expect(text()).toBe('btn_download · hint_pages(12)');
  });

  it('content: fetches /ajax/illust/{id} first-party, once per artwork', async () => {
    await open(`/artworks/${ILLUST}`);
    expect(fetchMock.mock.calls.map(([url]) => url as string)).toEqual([
      `https://www.pixiv.net/ajax/illust/${ILLUST}`,
    ]);
  });

  it('content: an R-18 work on a logged-out page shows needs-login', async () => {
    await open(`/artworks/${R18}`);
    expect(text()).toBe('btn_login');
  });

  it('content: an all-ages work behind pixiv’s login wall on a logged-out page shows needs-login', async () => {
    await open(`/artworks/${WALLED}`);
    expect(text()).toBe('btn_login');
  });

  it('content: each needs-login decision is logged at debug with its reason', async () => {
    await open(`/artworks/${WALLED}`);
    document.querySelector<HTMLElement>(`a[href="/artworks/${ILLUST}"]`)?.click();
    await settle(ROW_DELAY_MS + 20);
    history.pushState(null, '', `/artworks/${R18}`);
    navigation.dispatchEvent(new Event('currententrychange'));
    await settle(ROW_DELAY_MS + 20);
    const decisions = vi
      .mocked(console.debug)
      .mock.calls.filter((args) => args[1] === 'needs login')
      .map((args: unknown[]) => args.slice(2));
    expect(decisions).toEqual([
      [WALLED, 'withheld'],
      [R18, 'xRestrict'],
    ]);
  });

  it('content: a 404 at render time shows Unavailable', async () => {
    await open(`/artworks/${DELETED}`);
    expect(text()).toBe('btn_unavailable');
  });

  it('content: a network failure stays pending (plain Download)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    loadFakePage(`/artworks/${ILLUST}`);
    await startContent();
    await settle(30_000);
    expect(text()).toBe('btn_download');
  });

  it('content: an ugoira asks caps/get for its frame size', async () => {
    await open(`/artworks/${UGOIRA}`);
    expect(swMessages('caps/get')).toEqual([
      { target: 'sw', type: 'caps/get', width: 600, height: 600 },
    ]);
  });

  it('content: an ugoira shows the effective format (Download · MP4)', async () => {
    await open(`/artworks/${UGOIRA}`);
    expect(text()).toBe('btn_download · hint_format(MP4)');
  });

  it('content: locks the English width at 164 px once placed', async () => {
    await open(`/artworks/${ILLUST}`);
    expect(pill().style.getPropertyValue('--hfp-width')).toBe('164px');
  });

  it('content: follows the page theme', async () => {
    await open(`/artworks/${ILLUST}`);
    fake().setTheme('dark');
    await settle();
    expect(hosts()[0]?.getAttribute('data-theme')).toBe('dark');
  });
});

describe('content: settings reactivity', () => {
  function changeOutput(ugoiraOutput: string): void {
    const record = {
      v: 1,
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput,
      saveMetadata: true,
      updatedAt: Date.now() + 1,
    };
    stored.sync[SETTINGS_KEY] = record;
    stored.local[SETTINGS_KEY] = record;
    for (const listener of storageListeners)
      listener({ [SETTINGS_KEY]: { newValue: record } }, 'sync');
  }

  it('content: an idle ugoira re-presents a new output format within 1 s', async () => {
    await open(`/artworks/${UGOIRA}`);
    changeOutput('webm');
    await settle(1000);
    expect(text()).toBe('btn_download · hint_format(WebM)');
  });

  it('content: a busy ugoira keeps its job’s format', async () => {
    await open(`/artworks/${UGOIRA}`);
    pill().click();
    await settle();
    changeOutput('zip');
    await settle(1000);
    dispatchToTab({
      target: 'tab',
      type: 'job/update',
      view: view({
        artworkId: UGOIRA,
        kind: 'ugoira',
        status: 'ended',
        format: 'mp4',
        folder: 'pixiv/ひなた-136004512',
        outcome: { type: 'saved', folder: 'pixiv/ひなた-136004512', format: 'mp4' },
      }),
    });
    expect(text()).toBe('btn_saved · hint_format(MP4)');
  });
});

describe('content: clicks', () => {
  it('content: a click shows busy synchronously, before job/start answers', async () => {
    await open(`/artworks/${ILLUST}`);
    sendMessage.mockImplementation(() => new Promise(() => undefined));
    pill().click();
    expect([pill().getAttribute('aria-busy'), text()]).toEqual([
      'true',
      'btn_progress_pages(0,12)',
    ]);
  });

  it('content: a click sends job/start with the page count and the page’s login marker', async () => {
    await open(`/artworks/${ILLUST}`);
    pill().click();
    await settle();
    expect(swMessages('job/start')).toEqual([
      {
        target: 'sw',
        type: 'job/start',
        mode: 'full',
        artworkId: ILLUST,
        expectedFiles: 12,
        loggedIn: false,
      },
    ]);
  });

  it('content: a click before the metadata arrived sends loggedIn, so the SW can re-check (R-003)', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    await open(`/artworks/${WALLED}`);
    pill().click();
    await settle();
    expect(swMessages('job/start')).toEqual([
      {
        target: 'sw',
        type: 'job/start',
        mode: 'full',
        artworkId: WALLED,
        expectedFiles: 0,
        loggedIn: false,
      },
    ]);
  });

  it('content: a failed job/start shows Retry with the server cause', async () => {
    await open(`/artworks/${ILLUST}`);
    sendMessage.mockRejectedValue(new Error('Could not establish connection.'));
    pill().click();
    await settle();
    expect([text(), pill().getAttribute('title')]).toEqual(['btn_retry', 'tip_server']);
  });

  it('content: a job/start error answer shows Retry too', async () => {
    await open(`/artworks/${ILLUST}`);
    sendMessage.mockResolvedValue({ ok: false, error: 'INTERNAL' });
    pill().click();
    await settle();
    expect(text()).toBe('btn_retry');
  });

  it('content: a click on busy after the guard sends job/cancel and shows idle', async () => {
    await open(`/artworks/${ILLUST}`);
    pill().click();
    await settle(600);
    pill().click();
    await settle();
    expect([swMessages('job/cancel'), text()]).toEqual([
      [{ target: 'sw', type: 'job/cancel', jobId: 'job-1' }],
      'btn_download · hint_pages(12)',
    ]);
  });

  it('content: a second click within the guard does nothing', async () => {
    await open(`/artworks/${ILLUST}`);
    pill().click();
    await settle(100);
    pill().click();
    await settle();
    expect(swMessages('job/cancel')).toEqual([]);
  });

  it('content: needs-login goes to pixiv login with return_to', async () => {
    const assign = vi.spyOn(location, 'assign').mockImplementation(() => undefined);
    await open(`/artworks/${R18}`);
    pill().click();
    expect(assign).toHaveBeenCalledWith(
      `${PIXIV_LOGIN_URL}?return_to=${encodeURIComponent(location.href)}`,
    );
  });

  it('content: Unavailable ignores clicks', async () => {
    await open(`/artworks/${DELETED}`);
    pill().click();
    await settle();
    expect(swMessages('job/start')).toEqual([]);
  });
});

describe('content: job/update and reattach', () => {
  it('content: job/update progress renders on the displayed artwork', async () => {
    await open(`/artworks/${ILLUST}`);
    pill().click();
    await settle();
    dispatchToTab({
      target: 'tab',
      type: 'job/update',
      view: view({ progress: { kind: 'pages', done: 7, total: 12 } }),
    });
    expect(text()).toBe('btn_progress_pages(7,12)');
  });

  it('content: an ended job/update shows Saved', async () => {
    await open(`/artworks/${ILLUST}`);
    pill().click();
    await settle();
    const folder = 'pixiv/みずき-135882741';
    dispatchToTab({
      target: 'tab',
      type: 'job/update',
      view: view({ status: 'ended', folder, outcome: { type: 'saved', folder, pages: 12 } }),
    });
    expect([text(), pill().getAttribute('title')]).toEqual([
      'btn_saved · hint_pages(12)',
      `tip_saved(${folder})`,
    ]);
  });

  it('content: an invalid job/update is ignored', async () => {
    await open(`/artworks/${ILLUST}`);
    dispatchToTab({ target: 'tab', type: 'job/update', view: { jobId: 'x' } });
    expect(text()).toBe('btn_download · hint_pages(12)');
  });

  it('content: job/listForTab views reattach a running job after a reload', async () => {
    sendMessage.mockImplementation((message) =>
      Promise.resolve(
        message.type === 'job/listForTab'
          ? { ok: true, views: [view({ progress: { kind: 'pages', done: 9, total: 12 } })] }
          : SW(message),
      ),
    );
    await open(`/artworks/${ILLUST}`);
    expect(text()).toBe('btn_progress_pages(9,12)');
  });

  it('content: progress for an artwork navigated away from shows on return', async () => {
    await open(`/artworks/${ILLUST}`);
    pill().click();
    await settle();
    document.querySelector<HTMLElement>(`a[href="/artworks/${SINGLE}"]`)?.click();
    await settle(ROW_DELAY_MS + 20);
    dispatchToTab({
      target: 'tab',
      type: 'job/update',
      view: view({ progress: { kind: 'pages', done: 4, total: 12 } }),
    });
    history.back();
    await settle(ROW_DELAY_MS + 20);
    expect(text()).toBe('btn_progress_pages(4,12)');
  });
});

describe('content: API proxy', () => {
  it('content: api/fetchJson keeps the channel open (returns true)', async () => {
    await open(`/artworks/${ILLUST}`);
    const message = {
      target: 'tab',
      type: 'api/fetchJson',
      url: `https://www.pixiv.net/ajax/illust/${SINGLE}/pages`,
    };
    expect(dispatchToTab(message).returned).toBe(true);
  });

  it('content: api/fetchJson answers with the first-party result', async () => {
    await open(`/artworks/${ILLUST}`);
    const url = `https://www.pixiv.net/ajax/illust/${SINGLE}`;
    const { sendResponse } = dispatchToTab({ target: 'tab', type: 'api/fetchJson', url });
    await settle();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      result: {
        ok: true,
        value: ok(illustBody(requireWork(SINGLE), false)),
        status: 200,
        attempts: 1,
      },
    });
  });

  it('content: messages for other contexts are not answered', async () => {
    await open(`/artworks/${ILLUST}`);
    expect(dispatchToTab({ target: 'sw', type: 'job/start' }).returned).toBeUndefined();
  });
});

describe('content: teardown (extension context invalidated)', () => {
  async function invalidate(): Promise<void> {
    sendMessage.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    pill().click();
    await settle();
  }

  it('content: removes the button', async () => {
    await open(`/artworks/${ILLUST}`);
    await invalidate();
    expect(hosts()).toEqual([]);
  });

  it('content: stops placing after pixiv re-renders', async () => {
    await open(`/artworks/${ILLUST}`);
    await invalidate();
    fake().rerenderRow();
    await settle(FLOAT_FALLBACK_MS);
    expect(hosts()).toEqual([]);
  });

  it('content: removes its runtime.onMessage listener', async () => {
    await open(`/artworks/${ILLUST}`);
    await invalidate();
    expect(messageListeners).toEqual([]);
  });

  it('content: removes its storage.onChanged listener', async () => {
    await open(`/artworks/${ILLUST}`);
    await invalidate();
    expect(storageListeners).toEqual([]);
  });
});
