import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from '../../src/shared/retry';

const URL_ = 'https://i.pximg.net/img-original/img/2025/10/02/03/00/00/135882741_p0.jpg';
const API_URL = 'https://www.pixiv.net/ajax/illust/135882741';

const fetchMock = vi.fn<typeof fetch>();
/** Sleeps resolve at once and record the requested delay. */
const sleep = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(() => Promise.resolve());
const delays = (): number[] => sleep.mock.calls.map(([ms]) => ms);

function bytes(n: number, fill = 7): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

interface StreamOptions {
  hangAfter?: number; // stop producing (without closing) after this many chunks
  gapMs?: number; // wait this long before each chunk
}

function stream(chunks: Uint8Array[], opts: StreamOptions = {}): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (opts.hangAfter !== undefined && i >= opts.hangAfter) {
        return new Promise<void>(() => undefined);
      }
      if (opts.gapMs !== undefined) await new Promise((r) => setTimeout(r, opts.gapMs));
      const chunk = chunks[i++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
}

function bodyResponse(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
  opts: StreamOptions = {},
): Response {
  return new Response(stream(chunks, opts), { status: 200, headers });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function statusResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(`status ${status}`, { status, headers });
}

/** Every call gets a fresh Response (bodies are single-use). */
function respondAlways(make: () => Response): void {
  fetchMock.mockImplementation(() => Promise.resolve(make()));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  fetchMock.mockReset();
  sleep.mockClear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fetchWithRetry: status matrix', () => {
  it('fetchWithRetry: 200 succeeds on the first attempt', async () => {
    respondAlways(() => jsonResponse({ error: false, body: { id: '1' } }));
    const result = await fetchWithRetry(API_URL, { responseType: 'json', sleep });
    expect(result).toEqual({
      ok: true,
      value: { error: false, body: { id: '1' } },
      status: 200,
      attempts: 1,
    });
  });

  it.each([403, 404, 400, 401, 410])('fetchWithRetry: %i fails at once as http', async (status) => {
    respondAlways(() => statusResponse(status));
    const result = await fetchWithRetry(URL_, { responseType: 'bytes', sleep });
    expect(result).toEqual({ ok: false, failure: { kind: 'http', status, attempts: 1 } });
  });

  it.each([403, 404])('fetchWithRetry: %i is never retried', async (status) => {
    respondAlways(() => statusResponse(status));
    await fetchWithRetry(URL_, { responseType: 'bytes', sleep });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetchWithRetry: 403 ignores Retry-After and does not sleep', async () => {
    respondAlways(() => statusResponse(403, { 'retry-after': '5' }));
    await fetchWithRetry(URL_, { responseType: 'bytes', sleep });
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([429, 500, 502, 503, 504])(
    'fetchWithRetry: %i is retried up to 4 attempts',
    async (status) => {
      respondAlways(() => statusResponse(status));
      const result = await fetchWithRetry(URL_, { responseType: 'bytes', sleep });
      expect(result).toEqual({ ok: false, failure: { kind: 'http', status, attempts: 4 } });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    },
  );

  it.each([429, 500, 502, 503, 504])('fetchWithRetry: %i then 200 succeeds', async (status) => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(status))
      .mockResolvedValueOnce(bodyResponse([bytes(4)]));
    const result = await fetchWithRetry(URL_, { responseType: 'rawBytes', sleep });
    expect(result).toMatchObject({ ok: true, status: 200, attempts: 2 });
  });

  it('fetchWithRetry: a retried status followed by 403 stops at the 403', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(503)).mockResolvedValueOnce(statusResponse(403));
    const result = await fetchWithRetry(URL_, { responseType: 'bytes', sleep });
    expect(result).toEqual({ ok: false, failure: { kind: 'http', status: 403, attempts: 2 } });
  });

  it('fetchWithRetry: passes init through with its own abort signal', async () => {
    respondAlways(() => jsonResponse({ error: false, body: {} }));
    await fetchWithRetry(API_URL, {
      responseType: 'json',
      init: { credentials: 'include', cache: 'no-store' },
    });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toMatchObject({ credentials: 'include', cache: 'no-store' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('fetchWithRetry: network errors', () => {
  it('fetchWithRetry: a network TypeError is retried up to 4 attempts', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await fetchWithRetry(URL_, { responseType: 'bytes', sleep });
    expect(result).toEqual({ ok: false, failure: { kind: 'network', attempts: 4 } });
  });

  it('fetchWithRetry: a network TypeError then 200 succeeds on attempt 2', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(bodyResponse([bytes(3)]));
    const result = await fetchWithRetry(URL_, { responseType: 'rawBytes', sleep });
    expect(result).toMatchObject({ ok: true, attempts: 2 });
  });

  it('fetchWithRetry: a body stream error is a network failure', async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError('connection reset'));
      },
    });
    fetchMock
      .mockResolvedValueOnce(new Response(broken, { status: 200 }))
      .mockResolvedValueOnce(bodyResponse([bytes(2)]));
    const result = await fetchWithRetry(URL_, { responseType: 'rawBytes', sleep });
    expect(result).toMatchObject({ ok: true, attempts: 2 });
  });
});

describe('fetchWithRetry: delays', () => {
  it('fetchWithRetry: backoff is 1.5·2ⁿ s with zero jitter', async () => {
    respondAlways(() => statusResponse(500));
    await fetchWithRetry(URL_, { responseType: 'bytes', sleep, random: () => 0 });
    expect(delays()).toEqual([1500, 3000, 6000]);
  });

  it('fetchWithRetry: jitter adds U(0, 0.5) s to each delay', async () => {
    respondAlways(() => statusResponse(500));
    await fetchWithRetry(URL_, { responseType: 'bytes', sleep, random: () => 0.5 });
    expect(delays()).toEqual([1750, 3250, 6250]);
  });

  it('fetchWithRetry: each delay doubles the base of the previous one', async () => {
    respondAlways(() => statusResponse(502));
    await fetchWithRetry(URL_, { responseType: 'bytes', sleep, random: () => 0 });
    const [d0 = 0, d1 = 0, d2 = 0] = delays();
    expect([d1 / d0, d2 / d1]).toEqual([2, 2]);
  });

  it('fetchWithRetry: there is no sleep after the last attempt', async () => {
    respondAlways(() => statusResponse(503));
    await fetchWithRetry(URL_, { responseType: 'bytes', sleep });
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('fetchWithRetry: a network error uses the backoff', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await fetchWithRetry(URL_, { responseType: 'bytes', sleep, random: () => 0.2 });
    expect(delays()).toEqual([1600, 3100, 6100]);
  });

  it('fetchWithRetry: delays are scaled by __RETRY_TIME_SCALE__', async () => {
    vi.stubGlobal('__RETRY_TIME_SCALE__', 0.01);
    respondAlways(() => statusResponse(500));
    await fetchWithRetry(URL_, { responseType: 'bytes', sleep, random: () => 0 });
    expect(delays()).toEqual([15, 30, 60]);
  });

  it('fetchWithRetry: the default sleep waits the delay on the clock', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(statusResponse(500))
      .mockResolvedValueOnce(bodyResponse([bytes(1)]));
    const pending = fetchWithRetry(URL_, { responseType: 'rawBytes', random: () => 0 });
    await vi.advanceTimersByTimeAsync(1499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toMatchObject({ ok: true, attempts: 2 });
  });
});

describe('fetchWithRetry: Retry-After', () => {
  async function delayFor(retryAfter: string, status = 503): Promise<number | undefined> {
    fetchMock
      .mockResolvedValueOnce(statusResponse(status, { 'retry-after': retryAfter }))
      .mockResolvedValueOnce(bodyResponse([bytes(1)]));
    await fetchWithRetry(URL_, { responseType: 'rawBytes', sleep, random: () => 0 });
    return delays()[0];
  }

  it('fetchWithRetry: positive seconds are honored', async () => {
    expect(await delayFor('5')).toBe(5000);
  });

  it('fetchWithRetry: fractional seconds are honored', async () => {
    expect(await delayFor('2.5')).toBe(2500);
  });

  it('fetchWithRetry: Retry-After is capped at 30 s', async () => {
    expect(await delayFor('120', 429)).toBe(30_000);
  });

  it('fetchWithRetry: Retry-After 0 falls through to the backoff', async () => {
    expect(await delayFor('0')).toBe(1500);
  });

  it('fetchWithRetry: a negative Retry-After falls through to the backoff', async () => {
    expect(await delayFor('-3')).toBe(1500);
  });

  it('fetchWithRetry: an HTTP-date Retry-After falls through to the backoff', async () => {
    expect(await delayFor('Wed, 21 Oct 2026 07:28:00 GMT')).toBe(1500);
  });

  it('fetchWithRetry: a non-numeric Retry-After falls through to the backoff', async () => {
    expect(await delayFor('soon')).toBe(1500);
  });

  it('fetchWithRetry: the capped Retry-After is scaled by __RETRY_TIME_SCALE__', async () => {
    vi.stubGlobal('__RETRY_TIME_SCALE__', 0.01);
    expect(await delayFor('120', 429)).toBe(300);
  });

  it('fetchWithRetry: Retry-After applies per failed response', async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(429, { 'retry-after': '7' }))
      .mockResolvedValueOnce(statusResponse(503))
      .mockResolvedValueOnce(bodyResponse([bytes(1)]));
    await fetchWithRetry(URL_, { responseType: 'rawBytes', sleep, random: () => 0 });
    expect(delays()).toEqual([7000, 3000]);
  });
});

describe('fetchWithRetry: inactivity timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('fetchWithRetry: no response headers within 30 s is a timeout', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    const pending = fetchWithRetry(URL_, { responseType: 'bytes', sleep });
    await vi.advanceTimersByTimeAsync(4 * 30_000);
    await expect(pending).resolves.toEqual({
      ok: false,
      failure: { kind: 'timeout', attempts: 4 },
    });
  });

  it('fetchWithRetry: a body that stalls for 30 s is retried', async () => {
    fetchMock
      .mockResolvedValueOnce(bodyResponse([bytes(2), bytes(2)], {}, { hangAfter: 1 }))
      .mockResolvedValueOnce(bodyResponse([bytes(4)]));
    const pending = fetchWithRetry(URL_, { responseType: 'rawBytes', sleep });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ ok: true, attempts: 2 });
  });

  it('fetchWithRetry: the timer is re-armed per chunk, so slow progress never times out', async () => {
    fetchMock.mockResolvedValueOnce(
      bodyResponse([bytes(1), bytes(1), bytes(1)], {}, { gapMs: 20_000 }),
    );
    const pending = fetchWithRetry(URL_, { responseType: 'rawBytes', sleep });
    await vi.advanceTimersByTimeAsync(100_000);
    await expect(pending).resolves.toMatchObject({ ok: true, attempts: 1 });
  });

  it('fetchWithRetry: the stall timeout is scaled by __RETRY_TIME_SCALE__', async () => {
    vi.stubGlobal('__RETRY_TIME_SCALE__', 0.01);
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(bodyResponse([bytes(1)]));
    const pending = fetchWithRetry(URL_, { responseType: 'rawBytes', sleep });
    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toMatchObject({ ok: true, attempts: 2 });
  });
});

describe('fetchWithRetry: abort', () => {
  it('fetchWithRetry: an already-aborted signal makes no request', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await fetchWithRetry(URL_, {
      responseType: 'bytes',
      signal: controller.signal,
      sleep,
    });
    expect(result).toEqual({ ok: false, failure: { kind: 'aborted', attempts: 0 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetchWithRetry: abort during the request is final, never retried', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    const pending = fetchWithRetry(URL_, {
      responseType: 'bytes',
      signal: controller.signal,
      sleep,
    });
    controller.abort();
    await expect(pending).resolves.toEqual({
      ok: false,
      failure: { kind: 'aborted', attempts: 1 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetchWithRetry: abort while the body streams is final', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(bodyResponse([bytes(1), bytes(1)], {}, { hangAfter: 1 }));
    const pending = fetchWithRetry(URL_, {
      responseType: 'rawBytes',
      signal: controller.signal,
      onProgress: () => controller.abort(),
      sleep,
    });
    await expect(pending).resolves.toEqual({
      ok: false,
      failure: { kind: 'aborted', attempts: 1 },
    });
  });

  it('fetchWithRetry: abort during the backoff sleep ends without another attempt', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    respondAlways(() => statusResponse(503));
    const pending = fetchWithRetry(URL_, { responseType: 'bytes', signal: controller.signal });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await expect(pending).resolves.toEqual({
      ok: false,
      failure: { kind: 'aborted', attempts: 1 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchWithRetry: response types', () => {
  it('fetchWithRetry: bytes resolves to a Blob with the response Content-Type', async () => {
    respondAlways(() => bodyResponse([bytes(3), bytes(2)], { 'content-type': 'image/png' }));
    const result = await fetchWithRetry(URL_, { responseType: 'bytes', sleep });
    expect(result.ok && [result.value.size, result.value.type]).toEqual([5, 'image/png']);
  });

  it('fetchWithRetry: bytes keeps the body byte for byte', async () => {
    const body = new Uint8Array([0, 1, 2, 250, 255]);
    respondAlways(() => bodyResponse([body.slice(0, 2), body.slice(2)]));
    const result = await fetchWithRetry(URL_, { responseType: 'bytes', sleep });
    const read = result.ok ? new Uint8Array(await result.value.arrayBuffer()) : null;
    expect(read).toEqual(body);
  });

  it('fetchWithRetry: rawBytes with Content-Length returns the exact bytes', async () => {
    respondAlways(() =>
      bodyResponse([new Uint8Array([1, 2]), new Uint8Array([3])], { 'content-length': '3' }),
    );
    const result = await fetchWithRetry(URL_, { responseType: 'rawBytes', sleep });
    expect(result.ok && result.value).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('fetchWithRetry: rawBytes without Content-Length concatenates the chunks', async () => {
    respondAlways(() => bodyResponse([new Uint8Array([1]), new Uint8Array([2, 3])]));
    const result = await fetchWithRetry(URL_, { responseType: 'rawBytes', sleep });
    expect(result.ok && result.value).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('fetchWithRetry: onProgress reports loaded bytes and the Content-Length total', async () => {
    const onProgress = vi.fn();
    respondAlways(() => bodyResponse([bytes(4), bytes(6)], { 'content-length': '10' }));
    await fetchWithRetry(URL_, { responseType: 'rawBytes', onProgress, sleep });
    expect(onProgress.mock.calls).toEqual([
      [4, 10],
      [10, 10],
    ]);
  });

  it('fetchWithRetry: onProgress reports a null total without Content-Length', async () => {
    const onProgress = vi.fn();
    respondAlways(() => bodyResponse([bytes(4)]));
    await fetchWithRetry(URL_, { responseType: 'bytes', onProgress, sleep });
    expect(onProgress.mock.calls).toEqual([[4, null]]);
  });

  it('fetchWithRetry: a content-encoded body ignores Content-Length', async () => {
    const onProgress = vi.fn();
    respondAlways(() =>
      bodyResponse([bytes(10)], { 'content-length': '3', 'content-encoding': 'gzip' }),
    );
    const result = await fetchWithRetry(URL_, { responseType: 'rawBytes', onProgress, sleep });
    expect([result.ok, onProgress.mock.calls]).toEqual([true, [[10, null]]]);
  });

  it('fetchWithRetry: json with error: true is a pixivError, not retried', async () => {
    respondAlways(() => jsonResponse({ error: true, message: 'gone', body: [] }));
    const result = await fetchWithRetry(API_URL, { responseType: 'json', sleep });
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'pixivError', status: 200, attempts: 1 },
    });
  });

  it('fetchWithRetry: an unparsable json body is a pixivError', async () => {
    respondAlways(() => new Response('<html>maintenance</html>', { status: 200 }));
    const result = await fetchWithRetry(API_URL, { responseType: 'json', sleep });
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'pixivError', status: 200, detail: 'invalid-json', attempts: 1 },
    });
  });

  it('fetchWithRetry: a 404 with an error body stays an http 404', async () => {
    respondAlways(() => jsonResponse({ error: true, message: 'gone', body: [] }, 404));
    const result = await fetchWithRetry(API_URL, { responseType: 'json', sleep });
    expect(result).toEqual({ ok: false, failure: { kind: 'http', status: 404, attempts: 1 } });
  });
});

describe('fetchWithRetry: body length', () => {
  it('fetchWithRetry: a short body is a network failure and is retried', async () => {
    fetchMock
      .mockResolvedValueOnce(bodyResponse([bytes(6)], { 'content-length': '10' }))
      .mockResolvedValueOnce(bodyResponse([bytes(10)], { 'content-length': '10' }));
    const result = await fetchWithRetry(URL_, { responseType: 'rawBytes', sleep });
    expect(result).toMatchObject({ ok: true, attempts: 2 });
  });

  it('fetchWithRetry: a body that stays short fails as network short-body', async () => {
    respondAlways(() => bodyResponse([bytes(6)], { 'content-length': '10' }));
    const result = await fetchWithRetry(URL_, { responseType: 'rawBytes', sleep });
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'network', detail: 'short-body', attempts: 4 },
    });
  });

  it('fetchWithRetry: a short body also fails the bytes mode', async () => {
    respondAlways(() => bodyResponse([bytes(6)], { 'content-length': '10' }));
    const result = await fetchWithRetry(URL_, { responseType: 'bytes', sleep });
    expect(result.ok ? null : result.failure.detail).toBe('short-body');
  });

  it('fetchWithRetry: a body longer than Content-Length fails as network long-body', async () => {
    respondAlways(() => bodyResponse([bytes(6), bytes(6)], { 'content-length': '10' }));
    const result = await fetchWithRetry(URL_, { responseType: 'rawBytes', sleep });
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'network', detail: 'long-body', attempts: 4 },
    });
  });
});

describe('fetchWithRetry: logging', () => {
  it('fetchWithRetry: debug logs carry host and path, never query strings or headers', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    fetchMock
      .mockResolvedValueOnce(statusResponse(503))
      .mockResolvedValueOnce(jsonResponse({ error: false, body: {} }));
    await fetchWithRetry(`${API_URL}?lang=ja&token=s3cret`, {
      responseType: 'json',
      init: { headers: { Cookie: 'PHPSESSID=abc123' } },
      sleep,
      random: () => 0,
    });
    const lines = debug.mock.calls.map((args) => args.join(' '));
    expect(lines).toEqual([
      '[hfp:retry] www.pixiv.net/ajax/illust/135882741 attempt 1/4: 503, retry in 1500 ms',
      '[hfp:retry] www.pixiv.net/ajax/illust/135882741 attempt 2/4: 200',
    ]);
  });
});
