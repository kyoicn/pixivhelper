import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyResolution,
  resolve,
  type Plan,
  type Resolution,
  type ResolverDeps,
} from '../../../src/background/resolver';
import type { JobRecord, StartRequest } from '../../../src/shared/job';
import type { CodecCaps } from '../../../src/shared/messages';
import type { Failure, RetryResult, UgoiraOutput } from '../../../src/shared/types';

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/api/${name}`, import.meta.url), 'utf8'),
  ) as Json;
}

const API = 'https://www.pixiv.net/ajax/illust';
const MANGA = '135882741';
const UGOIRA = '136004512';
/** Live 151107515: all-ages, behind pixiv's sensitive-content wall (all `urls` null logged out). */
const WALLED = '151107515';
/** Live 151061734: all-ages, shown to logged-out visitors. */
const VISIBLE = '151061734';
const TAB = 7;
const MANGA_FOLDER = 'pixiv/みずき-135882741';
const UGOIRA_FOLDER = 'pixiv/Sora_空-136004512';
const ZIP_URL =
  'https://i.pximg.net/img-zip-ugoira/img/2025/10/05/21/00/00/136004512_ugoira1920x1080.zip';
const ORIGINALS = 'https://i.pximg.net/img-original/img/2025/10/02/03/00/00';
const MP4_CAPS: CodecCaps = { avc: 'avc1.64001e', vp9: true };

const illustManga = fixture('illust-manga.json');
const illustUgoira = fixture('illust-ugoira.json');
const illustWalled = fixture('illust-walled.json');
const illustVisible = fixture('illust-visible.json');
const pages = fixture('pages.json');
const ugoiraMeta = fixture('ugoira-meta.json');
const frames = (ugoiraMeta.body as Json).frames;

const ok = (value: unknown): RetryResult<unknown> => ({
  ok: true,
  value,
  status: 200,
  attempts: 1,
});
const httpError = (status: number): RetryResult<unknown> => ({
  ok: false,
  failure: { kind: 'http', status, attempts: 1 },
});
/** Every attempt failed before any response (offline, refused or throttled). */
const UNANSWERED: Failure = { kind: 'network', attempts: 4 };
/** 503, 503, then attempts Chromium refused locally: the request did get an answer. */
const ANSWERED: Failure = { kind: 'network', answered: true, attempts: 4 };
const failedWith = (failure: Failure): RetryResult<unknown> => ({ ok: false, failure });

const STANDARD_API: Record<string, RetryResult<unknown>> = {
  [`${API}/${MANGA}`]: ok(illustManga),
  [`${API}/${MANGA}/pages`]: ok(pages),
  [`${API}/${UGOIRA}`]: ok(illustUgoira),
  [`${API}/${UGOIRA}/ugoira_meta`]: ok(ugoiraMeta),
  // pixiv serves /pages of a walled all-ages work to logged-out sessions (system.md §8.5).
  [`${API}/${WALLED}`]: ok(illustWalled),
  [`${API}/${WALLED}/pages`]: ok(pages),
  [`${API}/${VISIBLE}`]: ok(illustVisible),
  [`${API}/${VISIBLE}/pages`]: ok(pages),
};

function deps(
  api: Record<string, RetryResult<unknown>> = STANDARD_API,
  caps: CodecCaps | Error = MP4_CAPS,
) {
  return {
    apiFetchJson: vi.fn((_tabId: number, url: string) =>
      Promise.resolve(api[url] ?? httpError(404)),
    ),
    getCaps: vi.fn(() => (caps instanceof Error ? Promise.reject(caps) : Promise.resolve(caps))),
  } satisfies ResolverDeps;
}

function job(
  request: StartRequest,
  settings: { ugoiraOutput?: UgoiraOutput; saveMetadata?: boolean; folderPattern?: string } = {},
): JobRecord {
  return {
    v: 1,
    jobId: 'job-1',
    artworkId: request.artworkId,
    originTabId: TAB,
    createdAt: 0,
    mode: request.mode,
    request,
    kind: 'unknown',
    phase: 'resolving',
    snapshot: {
      folderPattern: settings.folderPattern ?? 'pixiv/{artist}-{id}',
      ugoiraOutput: settings.ugoiraOutput ?? 'mp4',
      saveMetadata: settings.saveMetadata ?? true,
      effectiveFormat: null,
    },
    expectedFiles: 3,
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

const full = (artworkId: string, loggedIn: boolean | null = true): StartRequest => ({
  mode: 'full',
  artworkId,
  expectedFiles: 3,
  loggedIn,
});

async function plan(record: JobRecord, d: ResolverDeps = deps()): Promise<Plan> {
  const resolution = await resolve(record, d);
  if (!resolution.ok) throw new Error(`resolve failed: ${JSON.stringify(resolution)}`);
  return resolution.plan;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const summary = (p: Plan) => p.files.map((f) => [f.idx, f.role, f.name, f.dependsOn, f.save]);

describe('resolver: full, illustration/manga', () => {
  it('resolve: queues metadata.json, then every page under its URL basename', async () => {
    expect(summary(await plan(job(full(MANGA))))).toEqual([
      [0, 'metadata', 'metadata.json', [], true],
      [1, 'page', `${MANGA}_p0.jpg`, [], true],
      [2, 'page', `${MANGA}_p1.png`, [], true],
      [3, 'page', `${MANGA}_p2.jpg`, [], true],
    ]);
  });

  it('resolve: pages keep their source URL and 0-based page index', async () => {
    const { files } = await plan(job(full(MANGA)));
    expect(files[2]).toMatchObject({
      page: 1,
      url: `${ORIGINALS}/${MANGA}_p1.png`,
      state: 'queued',
    });
  });

  it('resolve: resolves the folder pattern from the work', async () => {
    expect((await plan(job(full(MANGA)))).folder).toBe(MANGA_FOLDER);
  });

  it('resolve: uses the click-time folder pattern', async () => {
    const record = job(full(MANGA), { folderPattern: '{userId}/{title}' });
    expect((await plan(record)).folder).toBe('40285173/雨上がりの渋谷');
  });

  it('resolve: a pages work counts every page and keeps the illust body for metadata.json', async () => {
    const p = await plan(job(full(MANGA)));
    expect([p.kind, p.pagesTotal, p.pagesOffset, p.metaBody]).toEqual([
      'pages',
      3,
      0,
      illustManga.body,
    ]);
  });

  it('resolve: with metadata off, queues only the pages and keeps no body', async () => {
    const p = await plan(job(full(MANGA), { saveMetadata: false }));
    expect([p.files.map((f) => f.role), p.metaBody]).toEqual([['page', 'page', 'page'], null]);
  });

  it('resolve: calls /ajax/illust then /pages through the origin tab', async () => {
    const d = deps();
    await plan(job(full(MANGA)), d);
    expect(d.apiFetchJson.mock.calls).toEqual([
      [TAB, `${API}/${MANGA}`],
      [TAB, `${API}/${MANGA}/pages`],
    ]);
  });
});

describe('resolver: full, ugoira', () => {
  it('resolve: queues metadata.json, the zip, frames.json after it, the video after both', async () => {
    expect(summary(await plan(job(full(UGOIRA))))).toEqual([
      [0, 'metadata', 'metadata.json', [], true],
      [1, 'zip', `${UGOIRA}_ugoira.zip`, [], true],
      [2, 'framesJson', 'frames.json', [1], true],
      [3, 'video', `${UGOIRA}.mp4`, [1, 2], true],
    ]);
  });

  it('resolve: fetches the original-size zip', async () => {
    const { files } = await plan(job(full(UGOIRA)));
    expect(files[1]?.url).toBe(ZIP_URL);
  });

  it('resolve: probes codecs at the work’s size', async () => {
    const d = deps();
    await plan(job(full(UGOIRA)), d);
    expect(d.getCaps).toHaveBeenCalledWith(600, 600);
  });

  it('resolve: records the frames, format, codec and size for the encoder', async () => {
    const p = await plan(job(full(UGOIRA)));
    expect([p.kind, p.folder, p.effectiveFormat, p.ugoira]).toEqual([
      'ugoira',
      UGOIRA_FOLDER,
      'mp4',
      {
        frames,
        format: 'mp4',
        avcCodec: 'avc1.64001e',
        width: 600,
        height: 600,
        zipLoaded: 0,
        zipTotal: null,
        encDone: 0,
        percent: 0,
      },
    ]);
  });

  it('resolve: mp4 falls back to WebM without H.264', async () => {
    const p = await plan(job(full(UGOIRA)), deps(STANDARD_API, { avc: null, vp9: true }));
    expect([p.effectiveFormat, p.files.at(-1)?.name, p.ugoira?.avcCodec]).toEqual([
      'webm',
      `${UGOIRA}.webm`,
      null,
    ]);
  });

  it('resolve: webm uses VP9 when available', async () => {
    const p = await plan(job(full(UGOIRA), { ugoiraOutput: 'webm' }));
    expect([p.effectiveFormat, p.ugoira?.avcCodec]).toEqual(['webm', null]);
  });

  it('resolve: webm falls back to MP4 without VP9', async () => {
    const d = deps(STANDARD_API, { avc: 'avc1.42e01e', vp9: false });
    const p = await plan(job(full(UGOIRA), { ugoiraOutput: 'webm' }), d);
    expect([p.effectiveFormat, p.ugoira?.avcCodec]).toEqual(['mp4', 'avc1.42e01e']);
  });

  it('resolve: with no encodable codec, saves the zip and frames.json only', async () => {
    const p = await plan(job(full(UGOIRA)), deps(STANDARD_API, { avc: null, vp9: false }));
    expect([p.effectiveFormat, p.files.map((f) => f.role)]).toEqual([
      'zip',
      ['metadata', 'zip', 'framesJson'],
    ]);
  });

  it('resolve: the ZIP only setting queues no video', async () => {
    const p = await plan(job(full(UGOIRA), { ugoiraOutput: 'zip' }));
    expect(p.files.map((f) => f.role)).toEqual(['metadata', 'zip', 'framesJson']);
  });

  it('resolve: a failed codec probe saves the zip only', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = await plan(job(full(UGOIRA)), deps(STANDARD_API, new Error('probe')));
    expect(p.effectiveFormat).toBe('zip');
  });
});

describe('resolver: retryPages', () => {
  const request: StartRequest = {
    mode: 'retryPages',
    artworkId: MANGA,
    folder: 'pixiv/old',
    pages: [2, 0],
    total: 3,
  };

  it('resolve: queues only the requested pages, in page order, with no metadata', async () => {
    expect(summary(await plan(job(request)))).toEqual([
      [0, 'page', `${MANGA}_p0.jpg`, [], true],
      [1, 'page', `${MANGA}_p2.jpg`, [], true],
    ]);
  });

  it('resolve: writes into the echoed folder and counts on from the earlier run', async () => {
    const p = await plan(job(request));
    expect([p.folder, p.pagesTotal, p.pagesOffset]).toEqual(['pixiv/old', 3, 1]);
  });

  it('resolve: calls only /pages', async () => {
    const d = deps();
    await plan(job(request), d);
    expect(d.apiFetchJson.mock.calls).toEqual([[TAB, `${API}/${MANGA}/pages`]]);
  });

  it('resolve: a requested page pixiv no longer lists is a pixivError on /pages', async () => {
    const resolution = await resolve(job({ ...request, pages: [5], total: 6 }), deps());
    expect(resolution).toMatchObject({
      ok: false,
      apiFailure: { endpoint: 'pages', failure: { kind: 'pixivError' } },
    });
  });
});

describe('resolver: retryEncode', () => {
  const request: StartRequest = {
    mode: 'retryEncode',
    artworkId: UGOIRA,
    folder: 'pixiv/old',
    format: 'mp4',
  };

  it('resolve: fetches the zip into memory only, then the video', async () => {
    expect(summary(await plan(job(request)))).toEqual([
      [0, 'zip', `${UGOIRA}_ugoira.zip`, [], false],
      [1, 'video', `${UGOIRA}.mp4`, [0], true],
    ]);
  });

  it('resolve: encodes in the requested format with the probed codec, into the echoed folder', async () => {
    const p = await plan(job(request));
    expect([p.folder, p.effectiveFormat, p.ugoira?.format, p.ugoira?.avcCodec]).toEqual([
      'pixiv/old',
      'mp4',
      'mp4',
      'avc1.64001e',
    ]);
  });

  it('resolve: reads the frame size from /ajax/illust for the codec probe', async () => {
    const d = deps();
    await plan(job(request), d);
    expect([d.apiFetchJson.mock.calls.map(([, url]) => url), d.getCaps.mock.calls]).toEqual([
      [`${API}/${UGOIRA}`, `${API}/${UGOIRA}/ugoira_meta`],
      [[600, 600]],
    ]);
  });
});

describe('resolver: retryMetadata', () => {
  const request: StartRequest = { mode: 'retryMetadata', artworkId: MANGA, folder: 'pixiv/old' };

  it('resolve: queues only metadata.json, into the echoed folder', async () => {
    const p = await plan(job(request));
    expect([summary(p), p.folder]).toEqual([
      [[0, 'metadata', 'metadata.json', [], true]],
      'pixiv/old',
    ]);
  });

  it('resolve: counts every page as saved by the earlier run', async () => {
    const p = await plan(job(request));
    expect([p.kind, p.pagesTotal, p.pagesOffset, p.metaBody]).toEqual([
      'pages',
      3,
      3,
      illustManga.body,
    ]);
  });
});

describe('resolver: API failures', () => {
  it('resolve: /ajax/illust 404 fails on the illust endpoint', async () => {
    const resolution = await resolve(job(full(MANGA)), deps({}));
    expect(resolution).toEqual({
      ok: false,
      apiFailure: { endpoint: 'illust', failure: { kind: 'http', status: 404, attempts: 1 } },
      answered: true,
    });
  });

  it('resolve: an error body is a pixivError', async () => {
    const api = { [`${API}/${MANGA}`]: ok(fixture('error-deleted.json')) };
    expect(await resolve(job(full(MANGA)), deps(api))).toMatchObject({
      ok: false,
      apiFailure: { endpoint: 'illust', failure: { kind: 'pixivError' } },
    });
  });

  it('resolve: a refused /pages fails on the pages endpoint', async () => {
    const api = { ...STANDARD_API, [`${API}/${MANGA}/pages`]: httpError(403) };
    expect(await resolve(job(full(MANGA)), deps(api))).toMatchObject({
      ok: false,
      apiFailure: { endpoint: 'pages', failure: { status: 403 } },
    });
  });

  it('resolve: a failed /ugoira_meta fails on the ugoira_meta endpoint', async () => {
    const api = { ...STANDARD_API, [`${API}/${UGOIRA}/ugoira_meta`]: httpError(503) };
    expect(await resolve(job(full(UGOIRA)), deps(api))).toMatchObject({
      ok: false,
      apiFailure: { endpoint: 'ugoira_meta', failure: { status: 503 } },
    });
  });

  it('resolve: no tab and no offscreen answer is an internal failure, not network', async () => {
    const d = { ...deps(), apiFetchJson: () => Promise.reject(new Error('off/fetchJson failed')) };
    expect(await resolve(job(full(MANGA)), d)).toEqual({
      ok: false,
      apiFailure: {
        endpoint: 'illust',
        failure: { kind: 'internal', detail: 'off/fetchJson failed', attempts: 1 },
      },
      answered: false,
    });
  });
});

describe('resolver: answered (R-004 S3, D13)', () => {
  const answeredOf = async (record: JobRecord, api: Record<string, RetryResult<unknown>>) => {
    const resolution = await resolve(record, deps(api));
    return 'answered' in resolution ? resolution.answered : null;
  };
  const retryPages: StartRequest = {
    mode: 'retryPages',
    artworkId: MANGA,
    folder: 'pixiv/old',
    pages: [0],
    total: 3,
  };

  it('resolve: /ajax/illust 200, then an unanswered /pages network failure is answered', async () => {
    const api = { ...STANDARD_API, [`${API}/${MANGA}/pages`]: failedWith(UNANSWERED) };
    expect(await answeredOf(job(full(MANGA)), api)).toBe(true);
  });

  it('resolve: an unanswered /ajax/illust network failure is not answered', async () => {
    const api = { ...STANDARD_API, [`${API}/${MANGA}`]: failedWith(UNANSWERED) };
    expect(await answeredOf(job(full(MANGA)), api)).toBe(false);
  });

  it('resolve: /ajax/illust 200, then an unanswered ugoira_meta network failure is answered', async () => {
    const api = { ...STANDARD_API, [`${API}/${UGOIRA}/ugoira_meta`]: failedWith(UNANSWERED) };
    expect(await answeredOf(job(full(UGOIRA)), api)).toBe(true);
  });

  it('resolve: a retryPages /pages failure that got a 503 first is answered', async () => {
    const api = { ...STANDARD_API, [`${API}/${MANGA}/pages`]: failedWith(ANSWERED) };
    expect(await answeredOf(job(retryPages), api)).toBe(true);
  });

  it('resolve: an unanswered retryPages /pages network failure is not answered', async () => {
    const api = { ...STANDARD_API, [`${API}/${MANGA}/pages`]: failedWith(UNANSWERED) };
    expect(await answeredOf(job(retryPages), api)).toBe(false);
  });

  it('resolve: /ajax/illust 200, then a transport failure of both proxies is answered', async () => {
    const d = deps();
    d.apiFetchJson.mockImplementation((_tabId: number, url: string) =>
      url.endsWith('/pages')
        ? Promise.reject(new Error('off/fetchJson failed'))
        : Promise.resolve(STANDARD_API[url] ?? httpError(404)),
    );
    expect(await resolve(job(full(MANGA)), d)).toMatchObject({
      apiFailure: { endpoint: 'pages', failure: { kind: 'internal' } },
      answered: true,
    });
  });

  it('applyResolution: a plan marks the job answered', async () => {
    const record = job(full(MANGA));
    applyResolution(record, await resolve(record, deps()));
    expect(record.answered).toBe(true);
  });

  it('applyResolution: the login-wall stop marks the job answered', () => {
    const record = job(full(WALLED, false));
    applyResolution(record, { ok: false, loginRequired: true });
    expect(record.answered).toBe(true);
  });

  it('applyResolution: an answered failure marks the job answered', () => {
    const record = job(full(MANGA));
    const apiFailure = { endpoint: 'pages' as const, failure: ANSWERED };
    applyResolution(record, { ok: false, apiFailure, answered: true });
    expect(record.answered).toBe(true);
  });

  it('applyResolution: an unanswered failure leaves answered absent', () => {
    const record = job(full(MANGA));
    const apiFailure = { endpoint: 'illust' as const, failure: UNANSWERED };
    applyResolution(record, { ok: false, apiFailure, answered: false });
    expect([record.apiFailure, 'answered' in record]).toEqual([apiFailure, false]);
  });

  it('applyResolution: a resolution ignored for a cancelled job leaves answered absent', async () => {
    const record = job(full(MANGA));
    const resolution = await resolve(record, deps());
    record.stopReason = 'cancelled';
    applyResolution(record, resolution);
    expect('answered' in record).toBe(false);
  });
});

describe('resolver: login wall (R-003)', () => {
  const urls = (d: ReturnType<typeof deps>) => d.apiFetchJson.mock.calls.map(([, url]) => url);

  it('resolve: logged out on a withheld work requires login before /pages is called', async () => {
    const d = deps();
    const resolution = await resolve(job(full(WALLED, false)), d);
    expect([resolution, urls(d)]).toEqual([
      { ok: false, loginRequired: true },
      [`${API}/${WALLED}`],
    ]);
  });

  it('resolve: logged out on an R-18 ugoira requires login before ugoira_meta or caps', async () => {
    const d = deps();
    const resolution = await resolve(job(full(UGOIRA, false)), d);
    expect([resolution, urls(d), d.getCaps.mock.calls]).toEqual([
      { ok: false, loginRequired: true },
      [`${API}/${UGOIRA}`],
      [],
    ]);
  });

  it('resolve: logged in on a withheld work proceeds to /pages', async () => {
    const d = deps();
    const resolution = await resolve(job(full(WALLED, true)), d);
    expect([resolution.ok, urls(d)]).toEqual([
      true,
      [`${API}/${WALLED}`, `${API}/${WALLED}/pages`],
    ]);
  });

  it('resolve: an unknown login state (null) on a withheld work proceeds', async () => {
    const resolution = await resolve(job(full(WALLED, null)), deps());
    expect(resolution.ok).toBe(true);
  });

  it('resolve: logged out on a work pixiv shows proceeds', async () => {
    const resolution = await resolve(job(full(VISIBLE, false)), deps());
    expect(resolution.ok).toBe(true);
  });

  it('resolve: a hydrated full request without loggedIn skips the check', async () => {
    const legacy = { mode: 'full', artworkId: WALLED, expectedFiles: 3 } as unknown as StartRequest;
    const resolution = await resolve(job(legacy), deps());
    expect(resolution.ok).toBe(true);
  });

  it('resolve: retryMetadata skips the check on a withheld work', async () => {
    const request: StartRequest = { mode: 'retryMetadata', artworkId: WALLED, folder: 'pixiv/old' };
    const resolution = await resolve(job(request), deps());
    expect(resolution.ok).toBe(true);
  });

  it('resolve: retryEncode skips the check on an R-18 ugoira', async () => {
    const request: StartRequest = {
      mode: 'retryEncode',
      artworkId: UGOIRA,
      folder: 'pixiv/old',
      format: 'mp4',
    };
    const resolution = await resolve(job(request), deps());
    expect(resolution.ok).toBe(true);
  });

  it('resolve: retryPages skips the check (it never reads /ajax/illust)', async () => {
    const request: StartRequest = {
      mode: 'retryPages',
      artworkId: WALLED,
      folder: 'pixiv/old',
      pages: [0],
      total: 3,
    };
    const resolution = await resolve(job(request), deps());
    expect(resolution.ok).toBe(true);
  });

  it('applyResolution: a login-wall stop sets stopReason forbidden and finalizes', () => {
    const record = job(full(WALLED, false));
    const effects = applyResolution(record, { ok: false, loginRequired: true });
    expect([record.stopReason, record.apiFailure, record.phase, record.files, effects]).toEqual([
      'forbidden',
      null,
      'resolving',
      [],
      [{ type: 'finalize' }],
    ]);
  });
});

describe('resolver: applyResolution', () => {
  async function resolved(record: JobRecord): Promise<Resolution> {
    return resolve(record, deps());
  }

  it('applyResolution: moves the job to transferring with its plan and starts files', async () => {
    const record = job(full(MANGA));
    const effects = applyResolution(record, await resolved(record));
    expect([
      record.phase,
      record.kind,
      record.folder,
      record.files.length,
      effects.filter((e) => e.type === 'dispatch').length,
    ]).toEqual(['transferring', 'pages', MANGA_FOLDER, 4, 4]);
  });

  it('applyResolution: re-renders the badge and pushes the view', async () => {
    const record = job(full(MANGA));
    const types = applyResolution(record, await resolved(record)).map((e) => e.type);
    expect(types.slice(0, 2)).toEqual(['badge', 'push']);
  });

  it('applyResolution: stores the effective ugoira format in the snapshot', async () => {
    const record = job(full(UGOIRA));
    applyResolution(record, await resolved(record));
    expect(record.snapshot.effectiveFormat).toBe('mp4');
  });

  it('applyResolution: a failure records apiFailure and finalizes', () => {
    const record = job(full(MANGA));
    const failure = {
      endpoint: 'illust' as const,
      failure: { kind: 'http' as const, status: 404, attempts: 1 },
    };
    const effects = applyResolution(record, { ok: false, apiFailure: failure, answered: true });
    expect([record.apiFailure, record.phase, effects]).toEqual([
      failure,
      'resolving',
      [{ type: 'finalize' }],
    ]);
  });

  it('applyResolution: ignores a resolution for a job cancelled meanwhile', async () => {
    const record = job(full(MANGA));
    const resolution = await resolved(record);
    record.stopReason = 'cancelled';
    expect([applyResolution(record, resolution), record.phase]).toEqual([[], 'resolving']);
  });

  it('applyResolution: ignores a second resolution', async () => {
    const record = job(full(MANGA));
    const resolution = await resolved(record);
    applyResolution(record, resolution);
    expect(applyResolution(record, resolution)).toEqual([]);
  });
});
