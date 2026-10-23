import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  basenameOf,
  illustBody,
  illustUrl,
  isApiUrl,
  isArtworkId,
  isBytesUrl,
  pagesUrl,
  parseIllust,
  parsePages,
  parseUgoiraMeta,
  requiresLogin,
  ugoiraMetaUrl,
} from '../../src/shared/pixiv-api';
import type { RetryResult, WorkInfo } from '../../src/shared/types';
import errorDeleted from '../fixtures/api/error-deleted.json';
import illustManga from '../fixtures/api/illust-manga.json';
import illustUgoira from '../fixtures/api/illust-ugoira.json';
import illustVisible from '../fixtures/api/illust-visible.json';
import illustWalled from '../fixtures/api/illust-walled.json';
import pages from '../fixtures/api/pages.json';
import ugoiraMeta from '../fixtures/api/ugoira-meta.json';

const ORIGINAL = 'https://i.pximg.net/img-original/img/2025/10/02/03/00/00/135882741_p0.jpg';

function ok(value: unknown, attempts = 1): RetryResult<unknown> {
  return { ok: true, value, status: 200, attempts };
}

function withBody(body: unknown): RetryResult<unknown> {
  return ok({ error: false, message: '', body });
}

function detailOf(result: RetryResult<unknown>): string | undefined {
  return result.ok ? undefined : result.failure.kind + ':' + (result.failure.detail ?? '');
}

/** parseIllust warns whenever it has to fall back to `sl` (a body without `urls.original`). */
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('URL builders', () => {
  it('illustUrl: builds the illust endpoint', () => {
    expect(illustUrl('135882741')).toBe('https://www.pixiv.net/ajax/illust/135882741');
  });

  it('pagesUrl: builds the pages endpoint', () => {
    expect(pagesUrl('135882741')).toBe('https://www.pixiv.net/ajax/illust/135882741/pages');
  });

  it('ugoiraMetaUrl: builds the ugoira_meta endpoint', () => {
    expect(ugoiraMetaUrl('136004512')).toBe(
      'https://www.pixiv.net/ajax/illust/136004512/ugoira_meta',
    );
  });

  it.each([illustUrl('1'), pagesUrl('1'), ugoiraMetaUrl('123456789012')])(
    'isApiUrl: built URL %s passes the allowlist',
    (url) => {
      expect(isApiUrl(url)).toBe(true);
    },
  );
});

describe('allowlists', () => {
  it.each([
    'https://www.pixiv.net/ajax/illust/1234567890123',
    'https://www.pixiv.net/ajax/illust/abc',
    'https://www.pixiv.net/ajax/illust/1/bookmarks',
    'https://www.pixiv.net/ajax/illust/1?lang=ja',
    'http://www.pixiv.net/ajax/illust/1',
    'https://www.pixiv.net.evil.com/ajax/illust/1',
    'https://evil.com/https://www.pixiv.net/ajax/illust/1',
    'https://www.pixiv.net/ajax/user/1',
    42,
    null,
  ])('isApiUrl: rejects %s', (url) => {
    expect(isApiUrl(url)).toBe(false);
  });

  it('isBytesUrl: accepts an i.pximg.net original', () => {
    expect(isBytesUrl(ORIGINAL)).toBe(true);
  });

  it.each([
    'http://i.pximg.net/img-original/a.jpg',
    'https://i.pximg.net.evil.com/a.jpg',
    'https://i.pximg.net@evil.com/a.jpg',
    'https://i.pximg.net:8443/a.jpg',
    'https://www.pixiv.net/a.jpg',
    'https://i.pximg.net',
    undefined,
  ])('isBytesUrl: rejects %s', (url) => {
    expect(isBytesUrl(url)).toBe(false);
  });

  it.each(['1', '135882741', '123456789012'])('isArtworkId: accepts %s', (id) => {
    expect(isArtworkId(id)).toBe(true);
  });

  it.each(['', '1234567890123', '12a', ' 1', '1/2', 135882741])('isArtworkId: rejects %s', (id) => {
    expect(isArtworkId(id)).toBe(false);
  });
});

describe('basenameOf', () => {
  it('basenameOf: returns the last path segment', () => {
    expect(basenameOf(ORIGINAL)).toBe('135882741_p0.jpg');
  });

  it('basenameOf: ignores the query string', () => {
    expect(basenameOf('https://i.pximg.net/a/135882741_p1.png?x=1')).toBe('135882741_p1.png');
  });

  it.each([
    ['an empty name', 'https://i.pximg.net/a/'],
    ['a percent-encoded name', 'https://i.pximg.net/a/%E3%81%82.jpg'],
    ['a name with a space', 'https://i.pximg.net/a/b%20c.jpg'],
    ['a name over 128 chars', `https://i.pximg.net/a/${'x'.repeat(129)}`],
    ['an unparsable URL', 'not a url'],
  ])('basenameOf: rejects %s', (_label, url) => {
    expect(basenameOf(url)).toBeNull();
  });
});

describe('parseIllust', () => {
  it('parseIllust: parses a manga body into WorkInfo', () => {
    expect(parseIllust(ok(illustManga))).toEqual({
      ok: true,
      value: {
        id: '135882741',
        illustType: 1,
        xRestrict: 0,
        withheld: false,
        pageCount: 3,
        width: 1200,
        height: 1697,
        userName: 'みずき',
        userId: '40285173',
        title: '雨上がりの渋谷',
      },
      status: 200,
      attempts: 1,
    });
  });

  it('parseIllust: parses a ugoira body with its frame size', () => {
    const result = parseIllust(ok(illustUgoira));
    expect(result.ok && result.value).toMatchObject({
      id: '136004512',
      illustType: 2,
      xRestrict: 1,
      width: 600,
      height: 600,
    });
  });

  it('parseIllust: keeps the attempts and status of the fetch', () => {
    const result = parseIllust({ ok: true, value: illustManga, status: 200, attempts: 3 });
    expect(result.ok && result.attempts).toBe(3);
  });

  it('parseIllust: prefers illustId over id', () => {
    const result = parseIllust(withBody({ illustId: '11', id: '22', illustType: 0 }));
    expect(result.ok && result.value.id).toBe('11');
  });

  it('parseIllust: falls back to id without illustId', () => {
    const result = parseIllust(withBody({ id: '22', illustType: 0 }));
    expect(result.ok && result.value.id).toBe('22');
  });

  it('parseIllust: tolerates numeric ids and digit-string numbers', () => {
    const result = parseIllust(
      withBody({ illustId: 33, illustType: '0', pageCount: '4', userId: 77 }),
    );
    expect(result.ok && result.value).toMatchObject({
      id: '33',
      illustType: 0,
      pageCount: 4,
      userId: '77',
    });
  });

  it('parseIllust: missing optional fields get tolerant defaults', () => {
    const result = parseIllust(withBody({ illustId: '5', illustType: 0 }));
    expect(result.ok && result.value).toEqual({
      id: '5',
      illustType: 0,
      xRestrict: 0,
      withheld: false,
      pageCount: 1,
      width: 0,
      height: 0,
      userName: null,
      userId: null,
      title: null,
    });
  });

  it('parseIllust: null text fields stay null', () => {
    const result = parseIllust(
      withBody({ illustId: '5', illustType: 0, userName: null, illustTitle: null, title: null }),
    );
    expect(result.ok && [result.value.userName, result.value.title]).toEqual([null, null]);
  });

  it('parseIllust: falls back to title without illustTitle', () => {
    const result = parseIllust(withBody({ illustId: '5', illustType: 0, title: 'T' }));
    expect(result.ok && result.value.title).toBe('T');
  });

  it('parseIllust: an out-of-range xRestrict defaults to 0', () => {
    const result = parseIllust(withBody({ illustId: '5', illustType: 0, xRestrict: 7 }));
    expect(result.ok && result.value.xRestrict).toBe(0);
  });

  it.each([
    ['no id', { illustType: 0 }, 'illustId'],
    ['a non-digit id', { illustId: 'abc', illustType: 0 }, 'illustId'],
    ['no illustType', { illustId: '5' }, 'illustType'],
    ['an unknown illustType', { illustId: '5', illustType: 3 }, 'illustType'],
    ['a ugoira without size', { illustId: '5', illustType: 2 }, 'size'],
    ['a ugoira with a zero width', { illustId: '5', illustType: 2, width: 0, height: 9 }, 'size'],
  ])('parseIllust: %s is a pixivError', (_label, body, detail) => {
    expect(detailOf(parseIllust(withBody(body)))).toBe(`pixivError:${detail}`);
  });

  it('parseIllust: a non-object body is a pixivError', () => {
    expect(detailOf(parseIllust(withBody([])))).toBe('pixivError:body');
  });

  it('parseIllust: an error envelope is a pixivError', () => {
    expect(detailOf(parseIllust(ok(errorDeleted)))).toBe('pixivError:error');
  });

  it('parseIllust: a non-object response is a pixivError', () => {
    expect(detailOf(parseIllust(ok('nope')))).toBe('pixivError:envelope');
  });

  it('parseIllust: a pixivError keeps the response status and attempts', () => {
    const result = parseIllust({ ok: true, value: {}, status: 200, attempts: 2 });
    expect(result.ok ? null : result.failure).toEqual({
      kind: 'pixivError',
      status: 200,
      detail: 'body',
      attempts: 2,
    });
  });

  it('parseIllust: passes a fetch failure through unchanged', () => {
    const failed: RetryResult<unknown> = {
      ok: false,
      failure: { kind: 'http', status: 404, attempts: 1 },
    };
    expect(parseIllust(failed)).toBe(failed);
  });
});

describe('parseIllust: withheld (R-003, system.md §8.5)', () => {
  const withheldOf = (body: Record<string, unknown>): boolean | null => {
    const result = parseIllust(withBody({ illustId: '5', illustType: 0, ...body }));
    return result.ok ? result.value.withheld : null;
  };

  it('parseIllust: the walled live body (151107515, all urls null) is withheld', () => {
    expect(parseIllust(ok(illustWalled))).toEqual({
      ok: true,
      value: {
        id: '151107515',
        illustType: 0,
        xRestrict: 0,
        withheld: true,
        pageCount: 4,
        width: 6000,
        height: 6000,
        userName: '鬼针草',
        userId: '6049901',
        title: '蓝黄梅鲷',
      },
      status: 200,
      attempts: 1,
    });
  });

  it('parseIllust: the visible live body (151061734, urls.original a URL) is not withheld', () => {
    const result = parseIllust(ok(illustVisible));
    expect(result.ok && [result.value.xRestrict, result.value.withheld]).toEqual([0, false]);
  });

  it('parseIllust: neither live body needs the sl fallback', () => {
    parseIllust(ok(illustWalled));
    parseIllust(ok(illustVisible));
    expect(warn).not.toHaveBeenCalled();
  });

  it('parseIllust: urls.original null is withheld even at sl 2', () => {
    expect(withheldOf({ sl: 2, urls: { original: null } })).toBe(true);
  });

  it('parseIllust: urls.original a string is not withheld even at sl 6', () => {
    expect(withheldOf({ sl: 6, urls: { original: ORIGINAL } })).toBe(false);
  });

  it('parseIllust: without urls, sl 4 falls back to withheld', () => {
    expect(withheldOf({ sl: 4 })).toBe(true);
  });

  it('parseIllust: without urls, sl 2 falls back to not withheld', () => {
    expect(withheldOf({ sl: 2 })).toBe(false);
  });

  it('parseIllust: without urls or sl, the work is not withheld', () => {
    expect(withheldOf({})).toBe(false);
  });

  it.each([
    ['urls without an original key', { urls: { regular: null } }],
    ['urls.original a number', { urls: { original: 0 } }],
    ['urls not an object', { urls: 'none' }],
  ])('parseIllust: %s is unrecognized and falls back to sl', (_label, body) => {
    expect([withheldOf({ ...body, sl: 4 }), withheldOf({ ...body, sl: 2 })]).toEqual([true, false]);
  });

  it('parseIllust: the sl fallback logs a warn', () => {
    withheldOf({ sl: 4 });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('requiresLogin (system.md §8.5)', () => {
  const work = (xRestrict: 0 | 1 | 2, withheld: boolean): WorkInfo => ({
    id: '5',
    illustType: 0,
    xRestrict,
    withheld,
    pageCount: 1,
    width: 0,
    height: 0,
    userName: null,
    userId: null,
    title: null,
  });

  it.each([
    // logged out: R-18/R-18G or withheld needs login
    [false, 0, false, false],
    [false, 0, true, true],
    [false, 1, false, true],
    [false, 1, true, true],
    [false, 2, false, true],
    [false, 2, true, true],
    // logged in: pixiv's answers to the job decide
    [true, 0, false, false],
    [true, 0, true, false],
    [true, 1, true, false],
    [true, 2, true, false],
    // login marker not found: never needs login
    [null, 0, true, false],
    [null, 1, true, false],
    [null, 2, false, false],
  ] as const)(
    'requiresLogin: loggedIn %s, xRestrict %i, withheld %s → %s',
    (loggedIn, xRestrict, withheld, expected) => {
      expect(requiresLogin(work(xRestrict, withheld), loggedIn)).toBe(expected);
    },
  );
});

describe('illustBody', () => {
  it('illustBody: returns the raw body object', () => {
    expect(illustBody(illustManga)).toBe(illustManga.body);
  });

  it.each([
    ['an array body', { body: [] }],
    ['a missing body', {}],
    ['a non-object response', 'x'],
  ])('illustBody: returns null for %s', (_label, json) => {
    expect(illustBody(json)).toBeNull();
  });
});

describe('parsePages', () => {
  it('parsePages: returns urls.original in page order', () => {
    expect(parsePages(ok(pages))).toEqual({
      ok: true,
      value: [
        'https://i.pximg.net/img-original/img/2025/10/02/03/00/00/135882741_p0.jpg',
        'https://i.pximg.net/img-original/img/2025/10/02/03/00/00/135882741_p1.png',
        'https://i.pximg.net/img-original/img/2025/10/02/03/00/00/135882741_p2.jpg',
      ],
      status: 200,
      attempts: 1,
    });
  });

  it('parsePages: ignores extra page fields', () => {
    const result = parsePages(withBody([{ urls: { original: ORIGINAL }, extra: { a: 1 } }]));
    expect(result.ok && result.value).toEqual([ORIGINAL]);
  });

  it.each([
    ['an empty page list', [], 'pages'],
    ['a non-array body', {}, 'pages'],
    ['a page without urls', [{ width: 1 }], 'urls.original'],
    ['a null original', [{ urls: { original: null } }], 'urls.original'],
    [
      'an original off the allowlist',
      [{ urls: { original: 'https://evil.com/a.jpg' } }],
      'allowlist',
    ],
    [
      'an original without a safe basename',
      [{ urls: { original: 'https://i.pximg.net/a/%E3%81%82.jpg' } }],
      'allowlist',
    ],
  ])('parsePages: %s is a pixivError', (_label, body, detail) => {
    expect(detailOf(parsePages(withBody(body)))).toBe(`pixivError:${detail}`);
  });

  it('parsePages: a later page missing its original fails the whole list', () => {
    const body = [{ urls: { original: ORIGINAL } }, { urls: {} }];
    expect(detailOf(parsePages(withBody(body)))).toBe('pixivError:urls.original');
  });

  it('parsePages: an error envelope is a pixivError', () => {
    expect(detailOf(parsePages(ok(errorDeleted)))).toBe('pixivError:error');
  });
});

describe('parseUgoiraMeta', () => {
  it('parseUgoiraMeta: returns originalSrc and the frames', () => {
    expect(parseUgoiraMeta(ok(ugoiraMeta))).toEqual({
      ok: true,
      value: {
        originalSrc:
          'https://i.pximg.net/img-zip-ugoira/img/2025/10/05/21/00/00/136004512_ugoira1920x1080.zip',
        frames: [
          { file: '000000.jpg', delay: 40 },
          { file: '000001.jpg', delay: 40 },
          { file: '000002.jpg', delay: 500 },
          { file: '000003.jpg', delay: 40 },
        ],
      },
      status: 200,
      attempts: 1,
    });
  });

  it('parseUgoiraMeta: keeps the frames array unmodified, extra keys included', () => {
    const frames = [{ file: '0.jpg', delay: 10, extra: true }];
    const result = parseUgoiraMeta(withBody({ originalSrc: ORIGINAL, frames }));
    expect(result.ok && result.value.frames).toBe(frames);
  });

  it.each([
    ['no originalSrc', { frames: [{ file: 'a', delay: 1 }] }, 'originalSrc'],
    [
      'an originalSrc off the allowlist',
      { originalSrc: 'https://evil.com/a.zip', frames: [{ file: 'a', delay: 1 }] },
      'allowlist',
    ],
    ['no frames', { originalSrc: ORIGINAL }, 'frames'],
    ['empty frames', { originalSrc: ORIGINAL, frames: [] }, 'frames'],
    ['a frame without delay', { originalSrc: ORIGINAL, frames: [{ file: 'a' }] }, 'frames'],
    [
      'a frame with a string file',
      { originalSrc: ORIGINAL, frames: [{ file: 1, delay: 1 }] },
      'frames',
    ],
    ['a non-object body', [], 'body'],
  ])('parseUgoiraMeta: %s is a pixivError', (_label, body, detail) => {
    expect(detailOf(parseUgoiraMeta(withBody(body)))).toBe(`pixivError:${detail}`);
  });

  it('parseUgoiraMeta: an error envelope is a pixivError', () => {
    expect(detailOf(parseUgoiraMeta(ok(errorDeleted)))).toBe('pixivError:error');
  });
});
