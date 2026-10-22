import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from '../../../src/background/engine';
import { createMessageRouter, startRequest } from '../../../src/background/handlers';
import type { JobRecord, StartRequest } from '../../../src/background/types';
import type { JobStartMessage } from '../../../src/shared/messages';
import {
  EXTENSION_ORIGIN,
  FAKE_EXTENSION_ID,
  installChromeFake,
  type ChromeFake,
} from '../../fakes/chrome';

const ID = '135882741';
const TAB_ID = 7;
const CONTENT: chrome.runtime.MessageSender = {
  id: FAKE_EXTENSION_ID,
  url: `https://www.pixiv.net/artworks/${ID}`,
  tab: { id: TAB_ID } as chrome.tabs.Tab,
};
const OFFSCREEN: chrome.runtime.MessageSender = {
  id: FAKE_EXTENSION_ID,
  url: `${EXTENSION_ORIGIN}/offscreen.html`,
};
const START = { target: 'sw', type: 'job/start', mode: 'full', artworkId: ID, expectedFiles: 12 };

let fake: ChromeFake;

beforeEach(() => {
  fake = installChromeFake();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function record(request: StartRequest, tabId: number): JobRecord {
  return {
    v: 1,
    jobId: 'job-1',
    artworkId: request.artworkId,
    originTabId: tabId,
    createdAt: 0,
    mode: request.mode,
    request,
    kind: 'unknown',
    phase: 'resolving',
    snapshot: {
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput: 'mp4',
      saveMetadata: true,
      effectiveFormat: null,
    },
    expectedFiles: 12,
    metaBody: null,
    folder: null,
    pagesTotal: 0,
    pagesOffset: 0,
    files: [],
    ugoira: null,
    stopReason: null,
    apiFailure: null,
  };
}

function stubEngine() {
  return {
    registry: {} as Engine['registry'],
    badge: { render: vi.fn(() => Promise.resolve()) },
    start: vi.fn((request: StartRequest, tabId: number) => Promise.resolve(record(request, tabId))),
    resolve: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve({ ok: true as const })),
    listForTab: vi.fn(() => []),
    onOffscreenEvent: vi.fn(() => Promise.resolve()),
    onDownloadChanged: vi.fn(() => Promise.resolve()),
    hydrate: vi.fn(() => Promise.resolve()),
    reconcile: vi.fn(() => Promise.resolve()),
  } satisfies Engine;
}

/** Sends `message` through a router and resolves with its response (undefined if none). */
async function route(
  message: unknown,
  sender: chrome.runtime.MessageSender = CONTENT,
  engine = stubEngine(),
  ready: Promise<void> = Promise.resolve(),
): Promise<{ kept: unknown; response: unknown }> {
  const respond = vi.fn();
  const kept = createMessageRouter(engine, ready)(message, sender, respond);
  await vi.waitFor(() => {
    if (kept === true) expect(respond).toHaveBeenCalled();
  });
  return { kept, response: respond.mock.calls[0]?.[0] };
}

describe('handlers: routing', () => {
  it('router: ignores messages for other contexts without holding the channel', async () => {
    expect(await route({ target: 'offscreen', type: 'off/tasks' })).toEqual({
      kept: undefined,
      response: undefined,
    });
  });

  it('router: ignores unknown SW message types', async () => {
    expect(await route({ target: 'sw', type: 'job/unknown' })).toEqual({
      kept: undefined,
      response: undefined,
    });
  });

  it('router: keeps the channel open for a request', async () => {
    expect((await route(START)).kept).toBe(true);
  });
});

describe('handlers: sender checks (system.md §7)', () => {
  it('router: refuses a content request from a sender without a tab', async () => {
    expect((await route(START, OFFSCREEN)).response).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('router: refuses a content request from another extension', async () => {
    const other = { ...CONTENT, id: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' };
    expect((await route(START, other)).response).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('router: hands offscreen events from the offscreen document to the engine', async () => {
    const engine = stubEngine();
    await route({ target: 'sw', type: 'off/ready', taskId: 't1' }, OFFSCREEN, engine);
    await vi.waitFor(() => expect(engine.onOffscreenEvent).toHaveBeenCalled());
  });

  it('router: ignores offscreen events sent by a tab', async () => {
    const engine = stubEngine();
    await route(
      { target: 'sw', type: 'off/ready', taskId: 't1', blobUrl: 'blob:x' },
      CONTENT,
      engine,
    );
    await Promise.resolve();
    expect(engine.onOffscreenEvent).not.toHaveBeenCalled();
  });

  it('router: ignores malformed offscreen events', async () => {
    const engine = stubEngine();
    await route({ target: 'sw', type: 'off/failed', taskId: 't1' }, OFFSCREEN, engine);
    await Promise.resolve();
    expect(engine.onOffscreenEvent).not.toHaveBeenCalled();
  });
});

describe('handlers: validation', () => {
  it('router: job/start with a malformed artwork id is a bad request', async () => {
    expect((await route({ ...START, artworkId: '../1' })).response).toEqual({
      ok: false,
      error: 'BAD_REQUEST',
    });
  });

  it('router: a retry whose echoed folder is not safe is a bad request', async () => {
    const engine = stubEngine();
    const message = {
      target: 'sw',
      type: 'job/start',
      mode: 'retryMetadata',
      artworkId: ID,
      folder: 'a/./b',
    };
    expect([(await route(message, CONTENT, engine)).response, engine.start.mock.calls]).toEqual([
      { ok: false, error: 'BAD_REQUEST' },
      [],
    ]);
  });

  it('router: caps/get outside 1..16384 is a bad request', async () => {
    const message = { target: 'sw', type: 'caps/get', width: 0, height: 600 };
    expect((await route(message)).response).toEqual({ ok: false, error: 'BAD_REQUEST' });
  });
});

describe('handlers: job/start', () => {
  it('job/start: answers with the new job’s running view', async () => {
    expect((await route(START)).response).toMatchObject({
      ok: true,
      view: { jobId: 'job-1', artworkId: ID, status: 'running', outcome: null },
    });
  });

  it('job/start: creates the job for the sender tab, without the envelope', async () => {
    const engine = stubEngine();
    await route(START, CONTENT, engine);
    expect(engine.start.mock.calls).toEqual([
      [{ mode: 'full', artworkId: ID, expectedFiles: 12 }, TAB_ID],
    ]);
  });

  it('job/start: resolving starts after the answer', async () => {
    const engine = stubEngine();
    const order: string[] = [];
    engine.resolve.mockImplementation(() => {
      order.push('resolve');
      return Promise.resolve();
    });
    const respond = vi.fn(() => order.push('respond'));
    createMessageRouter(engine, Promise.resolve())(START, CONTENT, respond);
    await vi.waitFor(() => expect(order).toEqual(['respond', 'resolve']));
  });

  it('job/start: waits for the SW to be ready', async () => {
    const engine = stubEngine();
    createMessageRouter(engine, new Promise(() => undefined))(START, CONTENT, vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(engine.start).not.toHaveBeenCalled();
  });

  it('job/start: an internal failure answers INTERNAL', async () => {
    const engine = stubEngine();
    engine.start.mockRejectedValueOnce(new Error('storage.session full'));
    expect((await route(START, CONTENT, engine)).response).toEqual({
      ok: false,
      error: 'INTERNAL',
    });
  });
});

describe('handlers: job/cancel, job/listForTab, caps/get', () => {
  it('job/cancel: passes the job id and sender tab to the engine', async () => {
    const engine = stubEngine();
    await route({ target: 'sw', type: 'job/cancel', jobId: 'job-1' }, CONTENT, engine);
    expect(engine.cancel.mock.calls).toEqual([['job-1', TAB_ID]]);
  });

  it('job/cancel: answers with the engine’s result', async () => {
    const engine = stubEngine();
    engine.cancel.mockResolvedValueOnce({ ok: false, error: 'FORBIDDEN' } as never);
    const { response } = await route(
      { target: 'sw', type: 'job/cancel', jobId: 'job-1' },
      CONTENT,
      engine,
    );
    expect(response).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('job/listForTab: answers with the sender tab’s running jobs', async () => {
    const engine = stubEngine();
    const { response } = await route({ target: 'sw', type: 'job/listForTab' }, CONTENT, engine);
    expect([response, engine.listForTab.mock.calls]).toEqual([{ ok: true, views: [] }, [[TAB_ID]]]);
  });

  it('caps/get: answers with the cached codec support for the size', async () => {
    fake.storage.session.seed({ 'caps:600x600': { avc: 'avc1.64001e', vp9: true } });
    const { response } = await route({ target: 'sw', type: 'caps/get', width: 601, height: 600 });
    expect(response).toEqual({ ok: true, caps: { avc: 'avc1.64001e', vp9: true } });
  });
});

describe('handlers: startRequest', () => {
  it.each<[string, Record<string, unknown>, StartRequest]>([
    [
      'full',
      { mode: 'full', artworkId: ID, expectedFiles: 3 },
      { mode: 'full', artworkId: ID, expectedFiles: 3 },
    ],
    [
      'retryPages',
      { mode: 'retryPages', artworkId: ID, folder: 'a', pages: [1], total: 3, extra: 1 },
      { mode: 'retryPages', artworkId: ID, folder: 'a', pages: [1], total: 3 },
    ],
    [
      'retryEncode',
      { mode: 'retryEncode', artworkId: ID, folder: 'a', format: 'webm' },
      { mode: 'retryEncode', artworkId: ID, folder: 'a', format: 'webm' },
    ],
    [
      'retryMetadata',
      { mode: 'retryMetadata', artworkId: ID, folder: 'a' },
      { mode: 'retryMetadata', artworkId: ID, folder: 'a' },
    ],
  ])('startRequest: %s keeps only the request fields', (_mode, payload, expected) => {
    const message = { target: 'sw', type: 'job/start', ...payload } as unknown as JobStartMessage;
    expect(startRequest(message)).toEqual(expected);
  });
});
