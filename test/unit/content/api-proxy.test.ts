import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxyFetchJson } from '../../../src/content/api-proxy';

const ILLUST_URL = 'https://www.pixiv.net/ajax/illust/135882741';
const BODY = { error: false, message: '', body: { illustId: '135882741' } };

let fetchMock: ReturnType<typeof vi.fn>;

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function message(url: unknown, overrides: Record<string, unknown> = {}): unknown {
  return { target: 'tab', type: 'api/fetchJson', url, ...overrides };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(json(200, BODY)));
  vi.stubGlobal('fetch', fetchMock);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('proxyFetchJson', () => {
  it.each([ILLUST_URL, `${ILLUST_URL}/pages`, `${ILLUST_URL}/ugoira_meta`])(
    'proxyFetchJson: fetches allowlisted %s',
    async (url) => {
      await proxyFetchJson(message(url));
      expect(fetchMock.mock.calls[0]?.[0]).toBe(url);
    },
  );

  it('proxyFetchJson: fetches with first-party (same-origin) credentials', async () => {
    await proxyFetchJson(message(ILLUST_URL));
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBe('same-origin');
  });

  it('proxyFetchJson: answers ok with the retry result', async () => {
    expect(await proxyFetchJson(message(ILLUST_URL))).toEqual({
      ok: true,
      result: { ok: true, value: BODY, status: 200, attempts: 1 },
    });
  });

  it('proxyFetchJson: passes a final failure through for the SW to classify', async () => {
    fetchMock.mockResolvedValue(json(404, { error: true, message: 'gone', body: [] }));
    expect(await proxyFetchJson(message(ILLUST_URL))).toEqual({
      ok: true,
      result: { ok: false, failure: { kind: 'http', status: 404, attempts: 1 } },
    });
  });

  it.each([
    'https://i.pximg.net/img-original/img/2026/09/28/21/14/00/135882741_p0.jpg',
    'https://www.pixiv.net/ajax/user/40285173',
    'https://www.pixiv.net/ajax/illust/135882741?lang=en',
    'http://www.pixiv.net/ajax/illust/135882741',
    'https://evil.example/ajax/illust/135882741',
    'https://www.pixiv.net/ajax/illust/abc',
    42,
  ])('proxyFetchJson: refuses %s with BAD_REQUEST, without fetching', async (url) => {
    const response = await proxyFetchJson(message(url));
    expect([response, fetchMock.mock.calls.length]).toEqual([
      { ok: false, error: 'BAD_REQUEST' },
      0,
    ]);
  });

  it('proxyFetchJson: logs a warning for a refused URL', async () => {
    await proxyFetchJson(message('https://evil.example/ajax/illust/1'));
    expect(warn).toHaveBeenCalledOnce();
  });

  it('proxyFetchJson: refuses a message for another context', async () => {
    expect(await proxyFetchJson(message(ILLUST_URL, { target: 'sw' }))).toEqual({
      ok: false,
      error: 'BAD_REQUEST',
    });
  });
});
