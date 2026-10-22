import { resolveObjectURL } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EncodeUgoiraOptions } from '../../../src/offscreen/ugoira/encode';
import { EXTENSION_ORIGIN, FAKE_EXTENSION_ID } from '../../fakes/chrome';

// ── 2.8 encoder modules, mocked: the router only wires them ──

const ugoira = vi.hoisted(() => {
  class EncodeError extends Error {
    readonly detail: string;
    constructor(detail: string) {
      super(`ugoira encode failed: ${detail}`);
      this.name = 'EncodeError';
      this.detail = detail;
    }
  }
  return {
    EncodeError,
    encodeUgoira: vi.fn<typeof import('../../../src/offscreen/ugoira/encode').encodeUgoira>(),
    probe: vi.fn<typeof import('../../../src/offscreen/ugoira/codec').probe>(),
  };
});

vi.mock('../../../src/offscreen/ugoira/encode', () => ({
  EncodeError: ugoira.EncodeError,
  encodeUgoira: ugoira.encodeUgoira,
}));
vi.mock('../../../src/offscreen/ugoira/codec', () => ({ probe: ugoira.probe }));

// ── A minimal chrome.runtime for the offscreen document ──

type Sender = chrome.runtime.MessageSender;
type Listener = (
  message: unknown,
  sender: Sender,
  sendResponse: (response?: unknown) => void,
) => unknown;

const SW_SENDER: Sender = {
  id: FAKE_EXTENSION_ID,
  url: `${EXTENSION_ORIGIN}/sw.js`,
  origin: EXTENSION_ORIGIN,
};
const TAB_SENDER: Sender = {
  id: FAKE_EXTENSION_ID,
  url: 'https://www.pixiv.net/artworks/135882741',
  origin: 'https://www.pixiv.net',
  tab: { id: 7 } as chrome.tabs.Tab,
  frameId: 0,
};

const ORIGINAL_URL = 'https://i.pximg.net/img-original/img/2025/10/02/03/00/00/135882741_p0.jpg';
const ZIP_URL =
  'https://i.pximg.net/img-zip-ugoira/img/2025/10/03/00/00/00/136004512_ugoira600x600.zip';
const API_URL = 'https://www.pixiv.net/ajax/illust/135882741';
const ZIP_BYTES = Uint8Array.from({ length: 120 }, (_, i) => (i * 7) % 256);
const VIDEO = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);
const FRAMES = [
  { file: '000000.jpg', delay: 40 },
  { file: '000001.jpg', delay: 500 },
];

const fetchMock = vi.fn<typeof fetch>();
const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>(() => Promise.resolve(undefined));
let listeners: Listener[];
/** What performance.now() returns: the progress throttle's clock. */
let clock: number;

async function loadOffscreen(): Promise<void> {
  listeners = [];
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
      sendMessage,
    },
  });
  vi.resetModules();
  await import('../../../src/offscreen/offscreen');
}

interface Delivery {
  returned: unknown;
  response: Promise<unknown>;
}

/** Calls the listener as Chrome does; `response` is `undefined` if the listener answers nothing. */
function deliver(message: unknown, sender: Sender = SW_SENDER): Delivery {
  const listener = listeners[0];
  if (!listener) throw new Error('no listener registered');
  let resolve: (value: unknown) => void = () => undefined;
  const response = new Promise<unknown>((r) => (resolve = r));
  let responded = false;
  const sendResponse = (value?: unknown): void => {
    if (responded) return;
    responded = true;
    resolve(value);
  };
  const returned = listener(JSON.parse(JSON.stringify(message)), sender, sendResponse);
  if (returned !== true && !responded) resolve(undefined);
  return { returned, response };
}

function request(message: unknown, sender?: Sender): Promise<unknown> {
  return deliver(message, sender).response;
}

const off = (type: string, payload: object = {}): object => ({
  target: 'offscreen',
  type,
  ...payload,
});
const fetchBytes = (taskId = 't1', url = ORIGINAL_URL): object =>
  off('off/fetchBytes', { taskId, url });
const fetchZip = (taskId = 'z', save = false): object =>
  off('off/fetchZip', { taskId, url: ZIP_URL, save });
const encode = (taskId = 'v', frames: object[] = FRAMES): object =>
  off('off/encode', {
    taskId,
    zipTaskId: 'z',
    frames,
    format: 'mp4',
    avcCodec: 'avc1.64001e',
    artworkId: '136004512',
  });

const events = (): unknown[] => sendMessage.mock.calls.map(([message]) => message);
const eventsFor = (taskId: string): unknown[] =>
  events().filter((e) => (e as { taskId?: unknown }).taskId === taskId);

function lastEventFor(taskId: string): { blobUrl?: string } {
  return eventsFor(taskId).at(-1) as { blobUrl?: string };
}

async function blobAt(blobUrl: string | undefined): Promise<{ type: string; bytes: Uint8Array }> {
  const blob = resolveObjectURL(blobUrl ?? '');
  if (!blob) throw new Error(`no Blob behind ${blobUrl}`);
  return { type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

/** vi.waitFor, polling every millisecond instead of every 50. */
function until(check: () => void): Promise<void> {
  return vi.waitFor(check, { interval: 1 });
}

/** Lets pending promise chains and zero-delay timers run, for "nothing happened" assertions. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

/** A fetch that never answers, but rejects as soon as its request is aborted. */
function hangingFetch(): void {
  fetchMock.mockImplementationOnce(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
}

/** A fetch answered only when the test calls the returned function. */
function deferredFetch(): (response: Response) => void {
  let answer: (response: Response) => void = () => undefined;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
  return (response) => answer(response);
}

/** A body that advances the clock by `stepMs` before handing out each chunk. */
function clockedBody(chunks: Uint8Array[], stepMs: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[i++];
        if (!chunk) {
          controller.close();
          return;
        }
        clock += stepMs;
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 0 },
  );
}

function jpeg(bytes: Uint8Array<ArrayBuffer>): Response {
  return new Response(bytes, {
    headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) },
  });
}

/** Fetches ZIP_BYTES as task `taskId` and waits for its off/ready. */
async function loadZip(taskId = 'z', save = false): Promise<void> {
  fetchMock.mockResolvedValueOnce(new Response(ZIP_BYTES));
  deliver(fetchZip(taskId, save));
  await until(() => expect(eventsFor(taskId).at(-1)).toMatchObject({ type: 'off/ready' }));
}

function encodeOptions(call = 0): EncodeUgoiraOptions {
  const options = ugoira.encodeUgoira.mock.calls[call]?.[0];
  if (!options) throw new Error(`encodeUgoira call ${call} missing`);
  return options;
}

beforeEach(async () => {
  clock = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await loadOffscreen();
});

afterEach(() => {
  fetchMock.mockReset();
  sendMessage.mockClear();
  ugoira.encodeUgoira.mockReset();
  ugoira.probe.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('offscreen router', () => {
  it('offscreen: registers its message listener when the module loads', () => {
    expect(listeners).toHaveLength(1);
  });

  it.each([
    ['an SW event', { target: 'sw', type: 'off/ready', taskId: 't1' }],
    ['a tab message', { target: 'tab', type: 'job/update', view: {} }],
    ['an untargeted message', { type: 'off/fetchBytes', taskId: 't1', url: ORIGINAL_URL }],
    ['a non-object', 'off/tasks'],
  ])('offscreen: ignores %s without holding the channel open', async (_label, message) => {
    const { returned, response } = deliver(message);
    expect([returned, await response]).toEqual([undefined, undefined]);
  });

  it('offscreen: messages for other targets start no work', async () => {
    deliver({ target: 'sw', type: 'off/fetchBytes', taskId: 't1', url: ORIGINAL_URL });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offscreen: refuses a command sent from a tab', async () => {
    await expect(request(fetchBytes(), TAB_SENDER)).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  it('offscreen: a command from a tab starts no work', async () => {
    await request(fetchBytes(), TAB_SENDER);
    await settle();
    expect([fetchMock.mock.calls.length, events()]).toEqual([0, []]);
  });

  it('offscreen: a refused tab message is logged as a warning', async () => {
    await request(fetchBytes(), TAB_SENDER);
    expect(console.warn).toHaveBeenCalledWith(
      '[hfp:offscreen]',
      'refused',
      'off/fetchBytes',
      'from a tab',
    );
  });

  it.each([
    ['a byte URL off i.pximg.net', fetchBytes('t1', 'https://example.com/a.jpg')],
    ['a missing taskId', off('off/fetchBytes', { url: ORIGINAL_URL })],
    [
      'a non-API fetchJson URL',
      off('off/fetchJson', { url: 'https://example.com/', credentials: 'include' }),
    ],
    ['an unknown type', off('off/nope')],
    ['a probe size of 0', off('off/probe', { width: 0, height: 600 })],
  ])('offscreen: answers BAD_REQUEST to %s', async (_label, message) => {
    await expect(request(message)).resolves.toEqual({ ok: false, error: 'BAD_REQUEST' });
  });

  it('offscreen: an invalid command starts no work', async () => {
    await request(fetchBytes('t1', 'https://example.com/a.jpg'));
    await settle();
    expect([fetchMock.mock.calls.length, events()]).toEqual([0, []]);
  });

  it('offscreen: a command is acknowledged before its work finishes', async () => {
    hangingFetch();
    await expect(request(fetchBytes())).resolves.toEqual({ ok: true });
    await request(off('off/abort', { taskIds: ['t1'] }));
  });

  it('offscreen: a command acknowledgement does not hold the channel open', async () => {
    hangingFetch();
    expect(deliver(fetchBytes()).returned).toBeUndefined();
    await request(off('off/abort', { taskIds: ['t1'] }));
  });

  it('offscreen: an event the SW cannot receive is logged as a warning', async () => {
    sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    deliver(off('off/makeText', { taskId: 'm', text: '{}', mime: 'application/json' }));
    await until(() =>
      expect(console.warn).toHaveBeenCalledWith(
        '[hfp:offscreen]',
        'off/ready',
        'not delivered to the service worker',
        expect.any(Error),
      ),
    );
  });
});

describe('off/fetchBytes', () => {
  it('off/fetchBytes: success emits one off/ready with a Blob URL and the size', async () => {
    fetchMock.mockResolvedValueOnce(jpeg(new Uint8Array(1000).fill(9)));
    deliver(fetchBytes());
    await until(() => expect(events()).toHaveLength(1));
    expect(events()).toEqual([
      {
        target: 'sw',
        type: 'off/ready',
        taskId: 't1',
        blobUrl: expect.stringMatching(/^blob:/) as unknown,
        size: 1000,
      },
    ]);
  });

  it('off/fetchBytes: the Blob holds exactly the served bytes with their Content-Type', async () => {
    const body = Uint8Array.from({ length: 2048 }, (_, i) => (i * 13) % 256);
    fetchMock.mockResolvedValueOnce(jpeg(body));
    deliver(fetchBytes());
    await until(() => expect(events()).toHaveLength(1));
    await expect(blobAt(lastEventFor('t1').blobUrl)).resolves.toEqual({
      type: 'image/jpeg',
      bytes: body,
    });
  });

  it('off/fetchBytes: fetches without credentials and bypassing the HTTP cache', async () => {
    fetchMock.mockResolvedValueOnce(jpeg(new Uint8Array(4)));
    deliver(fetchBytes());
    await until(() => expect(events()).toHaveLength(1));
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', cache: 'no-store' });
  });

  it('off/fetchBytes: 403 emits one off/failed with the status', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('', { status: 403 })));
    deliver(fetchBytes());
    await until(() => expect(events()).toHaveLength(1));
    expect(events()).toEqual([
      {
        target: 'sw',
        type: 'off/failed',
        taskId: 't1',
        failure: { kind: 'http', status: 403, attempts: 1 },
      },
    ]);
  });

  it('off/fetchBytes: 403 is not retried', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('', { status: 403 })));
    deliver(fetchBytes());
    await until(() => expect(events()).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('off/fetchBytes: 503 is retried, then the success is reported', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jpeg(new Uint8Array(4)));
    deliver(fetchBytes());
    await vi.advanceTimersByTimeAsync(2000);
    expect([fetchMock.mock.calls.length, events()]).toEqual([
      2,
      [expect.objectContaining({ type: 'off/ready', taskId: 't1', size: 4 })],
    ]);
  });

  it('off/fetchBytes: an exception at the task boundary becomes an off/failed', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementationOnce(() => {
      throw new Error('out of memory');
    });
    fetchMock.mockResolvedValueOnce(jpeg(new Uint8Array(4)));
    deliver(fetchBytes());
    await until(() => expect(events()).toHaveLength(1));
    expect(events()).toEqual([
      {
        target: 'sw',
        type: 'off/failed',
        taskId: 't1',
        failure: { kind: 'network', detail: 'exception', attempts: 1 },
      },
    ]);
  });
});

describe('off/makeText', () => {
  const TEXT = '{"userName":"みずき"}';

  it('off/makeText: emits one off/ready with the UTF-8 byte size', async () => {
    deliver(off('off/makeText', { taskId: 'm', text: TEXT, mime: 'application/json' }));
    await until(() => expect(events()).toHaveLength(1));
    expect(events()).toEqual([
      {
        target: 'sw',
        type: 'off/ready',
        taskId: 'm',
        blobUrl: expect.stringMatching(/^blob:/) as unknown,
        size: new TextEncoder().encode(TEXT).length,
      },
    ]);
  });

  it('off/makeText: the Blob is the text in UTF-8, typed with charset=utf-8', async () => {
    deliver(off('off/makeText', { taskId: 'm', text: TEXT, mime: 'application/json' }));
    await until(() => expect(events()).toHaveLength(1));
    await expect(blobAt(lastEventFor('m').blobUrl)).resolves.toEqual({
      type: 'application/json;charset=utf-8',
      bytes: new TextEncoder().encode(TEXT),
    });
  });
});

describe('off/fetchZip', () => {
  it('off/fetchZip: without save, off/ready carries the size but no Blob URL', async () => {
    await loadZip('z', false);
    expect(eventsFor('z').at(-1)).toEqual({
      target: 'sw',
      type: 'off/ready',
      taskId: 'z',
      size: 120,
    });
  });

  it('off/fetchZip: without Content-Length, progress has a null total', async () => {
    await loadZip('z', false);
    expect(eventsFor('z')[0]).toEqual({
      target: 'sw',
      type: 'off/progress',
      taskId: 'z',
      phase: 'zip',
      loaded: 120,
      total: null,
    });
  });

  it('off/fetchZip: without save, the bytes are retained', async () => {
    await loadZip('z', false);
    await expect(request(off('off/tasks'))).resolves.toEqual({
      ok: true,
      tasks: [{ taskId: 'z', state: 'retained' }],
    });
  });

  it('off/fetchZip: with save, off/ready carries a Blob URL of the exact zip bytes', async () => {
    fetchMock.mockResolvedValueOnce(new Response(ZIP_BYTES));
    deliver(fetchZip('z', true));
    await until(() =>
      expect(eventsFor('z').at(-1)).toMatchObject({ type: 'off/ready', size: 120 }),
    );
    await expect(blobAt(lastEventFor('z').blobUrl)).resolves.toEqual({
      type: 'application/zip',
      bytes: ZIP_BYTES,
    });
  });

  it('off/fetchZip: progress is sent at most every 250 ms, then a final one before off/ready', async () => {
    const chunks = Array.from({ length: 12 }, (_, i) => ZIP_BYTES.subarray(i * 10, i * 10 + 10));
    fetchMock.mockResolvedValueOnce(
      new Response(clockedBody(chunks, 100), { headers: { 'content-length': '120' } }),
    );
    deliver(fetchZip('z', false));
    await until(() => expect(eventsFor('z').at(-1)).toMatchObject({ type: 'off/ready' }));
    expect(eventsFor('z')).toEqual([
      ...[10, 40, 70, 100, 120].map((loaded) => ({
        target: 'sw',
        type: 'off/progress',
        taskId: 'z',
        phase: 'zip',
        loaded,
        total: 120,
      })),
      { target: 'sw', type: 'off/ready', taskId: 'z', size: 120 },
    ]);
  });

  it('off/fetchZip: a failed fetch sends no final progress, only off/failed', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('', { status: 404 })));
    deliver(fetchZip('z', true));
    await until(() => expect(eventsFor('z')).toHaveLength(1));
    expect(eventsFor('z')).toEqual([
      {
        target: 'sw',
        type: 'off/failed',
        taskId: 'z',
        failure: { kind: 'http', status: 404, attempts: 1 },
      },
    ]);
  });
});

describe('off/release', () => {
  it('off/release: revokes the Blob URL', async () => {
    fetchMock.mockResolvedValueOnce(jpeg(new Uint8Array(4)));
    deliver(fetchBytes());
    await until(() => expect(events()).toHaveLength(1));
    const { blobUrl } = lastEventFor('t1');
    await request(off('off/release', { taskIds: ['t1'] }));
    expect(resolveObjectURL(blobUrl ?? '')).toBeUndefined();
  });

  it('off/release: the released task leaves the task table', async () => {
    fetchMock.mockResolvedValueOnce(jpeg(new Uint8Array(4)));
    deliver(fetchBytes());
    await until(() => expect(events()).toHaveLength(1));
    await request(off('off/release', { taskIds: ['t1'] }));
    await expect(request(off('off/tasks'))).resolves.toEqual({ ok: true, tasks: [] });
  });

  it('off/release: is acknowledged', async () => {
    await expect(request(off('off/release', { taskIds: ['nope'] }))).resolves.toEqual({
      ok: true,
    });
  });

  it('off/release: keepRetained revokes the zip Blob URL but keeps the task retained', async () => {
    await loadZip('z', true);
    const { blobUrl } = lastEventFor('z');
    await request(off('off/release', { taskIds: ['z'], keepRetained: true }));
    expect([resolveObjectURL(blobUrl ?? ''), await request(off('off/tasks'))]).toEqual([
      undefined,
      { ok: true, tasks: [{ taskId: 'z', state: 'retained' }] },
    ]);
  });

  it('off/release: after a keepRetained release, an encode still gets the zip bytes', async () => {
    await loadZip('z', true);
    await request(off('off/release', { taskIds: ['z'], keepRetained: true }));
    ugoira.encodeUgoira.mockResolvedValueOnce(new Blob([VIDEO], { type: 'video/mp4' }));
    deliver(encode());
    expect(encodeOptions().zip).toEqual(ZIP_BYTES);
  });

  it('off/release: a full release drops the retained zip bytes', async () => {
    await loadZip('z', false);
    await request(off('off/release', { taskIds: ['z'] }));
    ugoira.encodeUgoira.mockRejectedValueOnce(new ugoira.EncodeError('no-zip'));
    deliver(encode());
    expect(encodeOptions().zip).toBeUndefined();
  });

  it('off/release: a task released while running reports nothing', async () => {
    const answer = deferredFetch();
    deliver(fetchBytes());
    await request(off('off/release', { taskIds: ['t1'] }));
    answer(jpeg(new Uint8Array(4)));
    await settle();
    expect(events()).toEqual([]);
  });
});

describe('off/abort', () => {
  it('off/abort: a fetch answered after the abort reports nothing', async () => {
    const answer = deferredFetch();
    deliver(fetchBytes());
    await request(off('off/abort', { taskIds: ['t1'] }));
    answer(jpeg(new Uint8Array(4)));
    await settle();
    expect(events()).toEqual([]);
  });

  it('off/abort: cancels the request', async () => {
    hangingFetch();
    deliver(fetchBytes());
    await request(off('off/abort', { taskIds: ['t1'] }));
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('off/abort: an encode that still resolves after the abort reports nothing', async () => {
    await loadZip();
    let finish: (blob: Blob) => void = () => undefined;
    ugoira.encodeUgoira.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    deliver(encode());
    await request(off('off/abort', { taskIds: ['v'] }));
    finish(new Blob([VIDEO], { type: 'video/mp4' }));
    await settle();
    expect(eventsFor('v')).toEqual([]);
  });

  it('off/abort: aborts the encoder signal', async () => {
    await loadZip();
    ugoira.encodeUgoira.mockImplementationOnce(({ signal }) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason as Error));
      });
    });
    deliver(encode());
    await request(off('off/abort', { taskIds: ['v'] }));
    await settle();
    expect([encodeOptions().signal.aborted, eventsFor('v')]).toEqual([true, []]);
  });

  it('off/abort: progress after the abort is swallowed', async () => {
    await loadZip();
    let progress: ((done: number, total: number) => void) | undefined;
    ugoira.encodeUgoira.mockImplementationOnce(({ onProgress }) => {
      progress = onProgress;
      return new Promise(() => undefined);
    });
    deliver(encode());
    await request(off('off/abort', { taskIds: ['v'] }));
    clock += 1000;
    progress?.(1, 2);
    await settle();
    expect(eventsFor('v')).toEqual([]);
  });

  it('off/abort: revokes the Blob URL of a ready task', async () => {
    fetchMock.mockResolvedValueOnce(jpeg(new Uint8Array(4)));
    deliver(fetchBytes());
    await until(() => expect(events()).toHaveLength(1));
    const { blobUrl } = lastEventFor('t1');
    await request(off('off/abort', { taskIds: ['t1'] }));
    expect(resolveObjectURL(blobUrl ?? '')).toBeUndefined();
  });
});

describe('off/tasks', () => {
  it('off/tasks: snapshots running, ready and retained tasks, leaving out failed ones', async () => {
    hangingFetch();
    deliver(fetchBytes('run'));
    deliver(off('off/makeText', { taskId: 'txt', text: '[]', mime: 'application/json' }));
    await until(() => expect(eventsFor('txt')).toHaveLength(1));
    await loadZip('z', false);
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('', { status: 404 })));
    deliver(fetchBytes('bad'));
    await until(() => expect(eventsFor('bad')).toHaveLength(1));
    const response = await request(off('off/tasks'));
    await request(off('off/abort', { taskIds: ['run'] }));
    expect(response).toEqual({
      ok: true,
      tasks: [
        { taskId: 'run', state: 'running' },
        { taskId: 'txt', state: 'ready', blobUrl: lastEventFor('txt').blobUrl },
        { taskId: 'z', state: 'retained' },
      ],
    });
  });

  it('off/tasks: answers through the open channel synchronously', () => {
    expect(deliver(off('off/tasks')).returned).toBeUndefined();
  });
});

describe('off/encode', () => {
  it('off/encode: hands the retained zip bytes and the command to encodeUgoira', async () => {
    await loadZip();
    ugoira.encodeUgoira.mockResolvedValueOnce(new Blob([VIDEO], { type: 'video/mp4' }));
    deliver(encode());
    expect(encodeOptions()).toMatchObject({
      zip: ZIP_BYTES,
      frames: FRAMES,
      format: 'mp4',
      avcCodec: 'avc1.64001e',
      signal: expect.objectContaining({ aborted: false }) as unknown,
    });
  });

  it('off/encode: success emits one off/ready with the video Blob URL and size', async () => {
    await loadZip();
    ugoira.encodeUgoira.mockResolvedValueOnce(new Blob([VIDEO], { type: 'video/mp4' }));
    deliver(encode());
    await until(() => expect(eventsFor('v')).toHaveLength(1));
    expect(eventsFor('v')).toEqual([
      {
        target: 'sw',
        type: 'off/ready',
        taskId: 'v',
        blobUrl: expect.stringMatching(/^blob:/) as unknown,
        size: VIDEO.length,
      },
    ]);
  });

  it('off/encode: the ready Blob URL serves the encoded video', async () => {
    await loadZip();
    ugoira.encodeUgoira.mockResolvedValueOnce(new Blob([VIDEO], { type: 'video/mp4' }));
    deliver(encode());
    await until(() => expect(eventsFor('v')).toHaveLength(1));
    await expect(blobAt(lastEventFor('v').blobUrl)).resolves.toEqual({
      type: 'video/mp4',
      bytes: VIDEO,
    });
  });

  it.each(['no-zip', 'bad-frames', 'zip', 'encoder'])(
    'off/encode: EncodeError %s becomes an encode failure with that detail',
    async (detail) => {
      await loadZip();
      ugoira.encodeUgoira.mockRejectedValueOnce(new ugoira.EncodeError(detail));
      deliver(encode());
      await until(() => expect(eventsFor('v')).toHaveLength(1));
      expect(eventsFor('v')).toEqual([
        {
          target: 'sw',
          type: 'off/failed',
          taskId: 'v',
          failure: { kind: 'encode', detail, attempts: 1 },
        },
      ]);
    },
  );

  it('off/encode: without a retained zip, encodeUgoira gets no bytes', () => {
    ugoira.encodeUgoira.mockRejectedValueOnce(new ugoira.EncodeError('no-zip'));
    deliver(encode());
    expect(encodeOptions().zip).toBeUndefined();
  });

  it('off/encode: an unexpected exception becomes an encoder failure', async () => {
    await loadZip();
    ugoira.encodeUgoira.mockRejectedValueOnce(new TypeError('boom'));
    deliver(encode());
    await until(() => expect(eventsFor('v')).toHaveLength(1));
    expect(eventsFor('v')).toEqual([
      {
        target: 'sw',
        type: 'off/failed',
        taskId: 'v',
        failure: { kind: 'encode', detail: 'encoder', attempts: 1 },
      },
    ]);
  });

  it('off/encode: progress for fast frames is sent at most every 250 ms', async () => {
    await loadZip();
    const frames = Array.from({ length: 48 }, (_, i) => ({ file: `${i}.jpg`, delay: 40 }));
    ugoira.encodeUgoira.mockImplementationOnce(({ onProgress }) => {
      for (let done = 1; done <= frames.length; done++) {
        clock += 50;
        onProgress?.(done, frames.length);
      }
      return Promise.resolve(new Blob([VIDEO], { type: 'video/mp4' }));
    });
    deliver(encode('v', frames));
    await until(() => expect(eventsFor('v').at(-1)).toMatchObject({ type: 'off/ready' }));
    expect(eventsFor('v').slice(0, -1)).toEqual(
      [1, 6, 11, 16, 21, 26, 31, 36, 41, 46].map((done) => ({
        target: 'sw',
        type: 'off/progress',
        taskId: 'v',
        phase: 'encode',
        done,
        total: 48,
      })),
    );
  });

  it('off/encode: every frame of a slow encode sends progress, so at least 1/s', async () => {
    await loadZip();
    ugoira.encodeUgoira.mockImplementationOnce(({ onProgress }) => {
      for (let done = 1; done <= 4; done++) {
        clock += 900;
        onProgress?.(done, 4);
      }
      return Promise.resolve(new Blob([VIDEO], { type: 'video/mp4' }));
    });
    deliver(encode());
    await until(() => expect(eventsFor('v').at(-1)).toMatchObject({ type: 'off/ready' }));
    expect(eventsFor('v').map((e) => (e as { done?: number }).done)).toEqual([
      1,
      2,
      3,
      4,
      undefined,
    ]);
  });
});

describe('off/probe', () => {
  it('off/probe: answers with the caps probed for the size', async () => {
    const caps = { avc: 'avc1.64001e', vp9: true };
    ugoira.probe.mockResolvedValueOnce(caps);
    await expect(request(off('off/probe', { width: 600, height: 600 }))).resolves.toEqual({
      ok: true,
      caps,
    });
    expect(ugoira.probe).toHaveBeenCalledWith(600, 600);
  });

  it('off/probe: holds the channel open for the answer', () => {
    ugoira.probe.mockResolvedValueOnce({ avc: null, vp9: false });
    expect(deliver(off('off/probe', { width: 600, height: 600 })).returned).toBe(true);
  });

  it('off/probe: a probe that throws answers INTERNAL', async () => {
    ugoira.probe.mockRejectedValueOnce(new Error('VideoEncoder unavailable'));
    await expect(request(off('off/probe', { width: 600, height: 600 }))).resolves.toEqual({
      ok: false,
      error: 'INTERNAL',
    });
  });
});

describe('off/fetchJson', () => {
  const fetchJson = off('off/fetchJson', { url: API_URL, credentials: 'include' });

  it('off/fetchJson: answers with the retry result', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: false, body: { illustId: '1' } }));
    await expect(request(fetchJson)).resolves.toEqual({
      ok: true,
      result: {
        ok: true,
        value: { error: false, body: { illustId: '1' } },
        status: 200,
        attempts: 1,
      },
    });
  });

  it('off/fetchJson: sends first-party cookies', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: false, body: {} }));
    await request(fetchJson);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

  it('off/fetchJson: a failed call is answered as a failed result', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(request(fetchJson)).resolves.toEqual({
      ok: true,
      result: { ok: false, failure: { kind: 'http', status: 404, attempts: 1 } },
    });
  });

  it('off/fetchJson: emits no event', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: false, body: {} }));
    await request(fetchJson);
    expect(events()).toEqual([]);
  });
});
