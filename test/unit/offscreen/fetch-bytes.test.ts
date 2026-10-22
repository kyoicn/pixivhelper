import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchApiJson, fetchOriginal, fetchZip } from '../../../src/offscreen/fetch-bytes';

const ORIGINAL_URL = 'https://i.pximg.net/img-original/img/2025/10/02/03/00/00/135882741_p0.jpg';
const ZIP_URL =
  'https://i.pximg.net/img-zip-ugoira/img/2025/10/03/00/00/00/136004512_ugoira1920x1080.zip';
const API_URL = 'https://www.pixiv.net/ajax/illust/135882741';

const fetchMock = vi.fn<typeof fetch>();

function bytes(n: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: n }, (_, i) => (i * 31) % 256);
}

function chunked(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[i++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
}

function okResponse(body: Uint8Array<ArrayBuffer>, headers: Record<string, string>): Response {
  return new Response(body, { status: 200, headers });
}

function statusResponse(status: number): Response {
  return new Response(`status ${status}`, { status });
}

/** The RequestInit of the n-th fetch call. */
function initOf(n = 0): RequestInit | undefined {
  return fetchMock.mock.calls[n]?.[1];
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fetchOriginal', () => {
  it('fetchOriginal: resolves with a Blob holding exactly the served bytes', async () => {
    const body = bytes(1000);
    fetchMock.mockResolvedValueOnce(
      okResponse(body, { 'content-type': 'image/jpeg', 'content-length': '1000' }),
    );
    const result = await fetchOriginal(ORIGINAL_URL, new AbortController().signal);
    if (!result.ok) throw new Error('expected success');
    expect(new Uint8Array(await result.value.arrayBuffer())).toEqual(body);
  });

  it('fetchOriginal: the Blob keeps the response Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(bytes(4), { 'content-type': 'image/png' }));
    const result = await fetchOriginal(ORIGINAL_URL, new AbortController().signal);
    expect(result.ok && result.value.type).toBe('image/png');
  });

  it('fetchOriginal: requests without credentials and bypassing the HTTP cache', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(bytes(4), { 'content-type': 'image/jpeg' }));
    await fetchOriginal(ORIGINAL_URL, new AbortController().signal);
    expect(initOf()).toMatchObject({ credentials: 'omit', cache: 'no-store' });
  });

  it('fetchOriginal: 403 fails at once as http 403', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(statusResponse(403)));
    const result = await fetchOriginal(ORIGINAL_URL, new AbortController().signal);
    expect(result).toEqual({ ok: false, failure: { kind: 'http', status: 403, attempts: 1 } });
  });

  it('fetchOriginal: 403 is not retried', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(statusResponse(403)));
    await fetchOriginal(ORIGINAL_URL, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetchOriginal: 503 is retried after the backoff and then succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(statusResponse(503))
      .mockResolvedValueOnce(okResponse(bytes(4), { 'content-type': 'image/jpeg' }));
    const pending = fetchOriginal(ORIGINAL_URL, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toMatchObject({ ok: true, status: 200, attempts: 2 });
  });

  it('fetchOriginal: refuses a URL off i.pximg.net without fetching', () => {
    expect(() => fetchOriginal('https://example.com/a.jpg', new AbortController().signal)).toThrow(
      'URL is not allowlisted',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchZip', () => {
  it('fetchZip: resolves with exactly the served bytes', async () => {
    const body = bytes(300);
    fetchMock.mockResolvedValueOnce(
      new Response(chunked([body.subarray(0, 100), body.subarray(100)]), {
        headers: { 'content-length': '300' },
      }),
    );
    const result = await fetchZip(ZIP_URL, new AbortController().signal, () => undefined);
    expect(result).toMatchObject({ ok: true, value: body });
  });

  it('fetchZip: reports byte progress per chunk with the Content-Length total', async () => {
    const body = bytes(300);
    fetchMock.mockResolvedValueOnce(
      new Response(chunked([body.subarray(0, 100), body.subarray(100)]), {
        headers: { 'content-length': '300' },
      }),
    );
    const onProgress = vi.fn();
    await fetchZip(ZIP_URL, new AbortController().signal, onProgress);
    expect(onProgress.mock.calls).toEqual([
      [100, 300],
      [300, 300],
    ]);
  });

  it('fetchZip: reports a null total without Content-Length', async () => {
    fetchMock.mockResolvedValueOnce(new Response(chunked([bytes(10)])));
    const onProgress = vi.fn();
    await fetchZip(ZIP_URL, new AbortController().signal, onProgress);
    expect(onProgress).toHaveBeenCalledWith(10, null);
  });

  it('fetchZip: requests without credentials and bypassing the HTTP cache', async () => {
    fetchMock.mockResolvedValueOnce(new Response(bytes(4)));
    await fetchZip(ZIP_URL, new AbortController().signal, () => undefined);
    expect(initOf()).toMatchObject({ credentials: 'omit', cache: 'no-store' });
  });

  it('fetchZip: refuses a URL off i.pximg.net without fetching', () => {
    expect(() =>
      fetchZip('https://www.pixiv.net/x.zip', new AbortController().signal, () => undefined),
    ).toThrow('URL is not allowlisted');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchApiJson', () => {
  it('fetchApiJson: resolves with the parsed body', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: false, body: { illustId: '1' } }));
    await expect(fetchApiJson(API_URL)).resolves.toEqual({
      ok: true,
      value: { error: false, body: { illustId: '1' } },
      status: 200,
      attempts: 1,
    });
  });

  it('fetchApiJson: sends first-party cookies', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: false, body: {} }));
    await fetchApiJson(API_URL);
    expect(initOf()).toMatchObject({ credentials: 'include' });
  });

  it('fetchApiJson: an error body resolves as a pixivError failure', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: true, message: 'gone', body: [] }));
    await expect(fetchApiJson(API_URL)).resolves.toEqual({
      ok: false,
      failure: { kind: 'pixivError', status: 200, attempts: 1 },
    });
  });

  it('fetchApiJson: refuses a URL that is not an allowlisted API URL without fetching', () => {
    expect(() => fetchApiJson('https://www.pixiv.net/ajax/user/1')).toThrow(
      'URL is not allowlisted',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
