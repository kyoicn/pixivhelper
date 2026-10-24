import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobRecord } from '../../src/shared/job';
import { buildMetadata, serializeJson } from '../../src/shared/metadata';
import type { JobStartResponse } from '../../src/shared/messages';
import type { ChromeFake } from '../fakes/chrome';
import {
  API,
  ContentTab,
  DownloadDriver,
  ScriptedOffscreen,
  bootSw,
  illustJson,
  pageUrl,
  pagesJson,
  savedFiles,
  settle,
  setUp,
  tearDown,
  until,
  type ApiTable,
  type OffscreenOptions,
} from './harness';

const ID = '135882741';
const FOLDER = 'pixiv/みずき-135882741';
const ARTWORK_URL = `https://www.pixiv.net/artworks/${ID}`;

let fake: ChromeFake;

beforeEach(() => {
  fake = setUp();
});

afterEach(tearDown);

function api12(): ApiTable {
  return new Map<string, Record<string, unknown> | number>([
    [`${API}/${ID}`, illustJson({ pageCount: 12 })],
    [`${API}/${ID}/pages`, pagesJson(ID, 12)],
  ]);
}

/** Copies of every job record the SW writes to storage.session, in write order. */
function recordWrites(): JobRecord[] {
  const records: JobRecord[] = [];
  fake.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    for (const [key, change] of Object.entries(changes)) {
      if (key.startsWith('job:') && change.newValue) records.push(change.newValue as JobRecord);
    }
  });
  return records;
}

interface Run {
  tab: ContentTab;
  offscreen: ScriptedOffscreen;
  response: JobStartResponse;
  badges: string[];
}

/** Starts a full job on a fresh SW and drives Chrome until the job's final view arrives. */
async function runJob(
  api: ApiTable = api12(),
  options: OffscreenOptions = {},
  start: Record<string, unknown> = {
    mode: 'full',
    artworkId: ID,
    expectedFiles: 12,
    loggedIn: false,
  },
): Promise<Run> {
  const offscreen = new ScriptedOffscreen(fake, options);
  await bootSw();
  const tab = new ContentTab(fake, ARTWORK_URL, api);
  const badges: string[] = [];
  fake.api.action.setBadgeText.mockImplementation(async ({ text }) => {
    badges.push(text ?? '');
    fake.action.badgeText = text ?? '';
    await Promise.resolve();
  });
  const response = (await settle(tab.send({ type: 'job/start', ...start }))) as JobStartResponse;
  const driver = new DownloadDriver(fake);
  await until(() => {
    driver.step();
    return tab.ended() !== undefined;
  }, 'job end');
  await settle(new Promise((resolve) => setTimeout(resolve, 100)));
  return { tab, offscreen, response, badges };
}

describe('sw: a 12-page job (CUJ-1)', () => {
  it('sw: lands metadata.json and 135882741_p0…p11 under pixiv/みずき-135882741', async () => {
    await runJob();
    const expected = [
      `${FOLDER}/metadata.json`,
      ...Array.from({ length: 12 }, (_, page) => `${FOLDER}/${ID}_p${page}.jpg`),
    ];
    expect(savedFiles(fake).sort()).toEqual(expected.sort());
  });

  it('sw: hands every file to Chrome with uniquify and no Save As prompt', async () => {
    await runJob();
    const options = fake.api.downloads.download.mock.calls.map(([o]) => [
      o.conflictAction,
      o.saveAs,
    ]);
    expect(options).toEqual(Array.from({ length: 13 }, () => ['uniquify', false]));
  });

  it('sw: hands Chrome the offscreen blob URL of each file', async () => {
    await runJob();
    expect(fake.downloads.items().every((item) => item.url.startsWith('blob:'))).toBe(true);
  });

  it('sw: never has more than 5 files in flight in the persisted job', async () => {
    const records = recordWrites();
    await runJob();
    const inFlight = records.map(
      (job) => job.files.filter((f) => ['fetching', 'ready', 'saving'].includes(f.state)).length,
    );
    expect(Math.max(...inFlight)).toBe(5);
  });

  it('sw: never has more than 5 live offscreen tasks', async () => {
    const { offscreen } = await runJob();
    expect(offscreen.maxLive).toBe(5);
  });

  it('sw: dispatches the originals in ascending page order', async () => {
    const { offscreen } = await runJob();
    expect(offscreen.commandsOf('off/fetchBytes').map((c) => c.url)).toEqual(
      Array.from({ length: 12 }, (_, page) => pageUrl(ID, page)),
    );
  });

  it('sw: dispatches metadata.json first, built from the illust body', async () => {
    const { offscreen } = await runJob();
    const body = illustJson({ pageCount: 12 }).body as Record<string, unknown>;
    expect(offscreen.commands[0]).toMatchObject({
      type: 'off/makeText',
      text: serializeJson(buildMetadata(body, ID)),
      mime: 'application/json',
    });
  });

  it('sw: drops the illust body from the record once metadata.json is dispatched', async () => {
    const records = recordWrites();
    await runJob();
    const afterDispatch = records.filter((job) =>
      job.files.some((f) => f.role === 'metadata' && f.state !== 'queued'),
    );
    expect(afterDispatch.every((job) => job.metaBody === null)).toBe(true);
  });

  it('sw: job/start answers with a running view before resolving', async () => {
    const { response } = await runJob();
    expect(response).toMatchObject({
      ok: true,
      view: { artworkId: ID, kind: 'unknown', status: 'running', progress: null, outcome: null },
    });
  });

  it('sw: pushes k / 12 progress as pages land, and the last page ends the job', async () => {
    const { tab } = await runJob();
    const done = tab.views
      .filter((v) => v.status === 'running' && v.progress?.kind === 'pages')
      .map((v) => (v.progress?.kind === 'pages' ? v.progress.done : -1));
    // The last page is handed to Chrome only after every other file has finished (R-006 rev. 3),
    // so its landing ends the job: the running views climb to 11 / 12 and Saved follows directly.
    expect([
      done.at(-1),
      done.every((d, i) => i === 0 || d >= done[i - 1]!),
      tab.ended()?.outcome,
    ]).toEqual([11, true, { type: 'saved', folder: FOLDER, pages: 12 }]);
  });

  it('sw: ends saved with the resolved folder and page count', async () => {
    const { tab } = await runJob();
    expect(tab.ended()?.outcome).toEqual({ type: 'saved', folder: FOLDER, pages: 12 });
  });

  it('sw: removes the job record when the job ends', async () => {
    await runJob();
    expect(Object.keys(fake.storage.session.snapshot()).some((k) => k.startsWith('job:'))).toBe(
      false,
    );
  });

  it('sw: the badge shows 12 while resolving and is hidden at the end', async () => {
    const { badges } = await runJob(api12(), { delayMs: 100 });
    expect([badges[0], badges.at(-1)]).toEqual(['12', '']);
  });

  it('sw: the badge counts down as pages land', async () => {
    const { badges } = await runJob(api12(), { delayMs: 100 });
    // metadata.json and p0–p3 take the first 5 slots, then 5 pages, then the last 3.
    expect(badges).toEqual(['12', '8', '3', '']);
  });

  it('sw: the title returns to idle at the end', async () => {
    await runJob();
    expect(fake.action.title).toBe('Helper for Pixiv — click to open settings');
  });

  it('sw: uses the folder pattern from the settings snapshot', async () => {
    fake.storage.sync.seed({
      settings: {
        v: 1,
        folderPattern: '{userId}/{title}',
        ugoiraOutput: 'mp4',
        saveMetadata: false,
        updatedAt: 1,
      },
    });
    const { tab } = await runJob();
    expect(tab.ended()?.folder).toBe('40285173/雨上がりの渋谷');
  });

  it('sw: writes no metadata.json when the setting is off', async () => {
    fake.storage.sync.seed({
      settings: {
        v: 1,
        folderPattern: 'pixiv/{artist}-{id}',
        ugoiraOutput: 'mp4',
        saveMetadata: false,
        updatedAt: 1,
      },
    });
    await runJob();
    expect(savedFiles(fake).some((f) => f.endsWith('metadata.json'))).toBe(false);
  });

  it('sw: a second run of the same artwork gets uniquified names', async () => {
    await runJob();
    const tab = new ContentTab(fake, ARTWORK_URL, api12());
    await settle(
      tab.send({
        type: 'job/start',
        mode: 'full',
        artworkId: ID,
        expectedFiles: 12,
        loggedIn: true,
      }),
    );
    const driver = new DownloadDriver(fake);
    await until(() => {
      driver.step();
      return tab.ended() !== undefined;
    }, 'second job end');
    expect(savedFiles(fake)).toContain(`${FOLDER}/${ID}_p0 (1).jpg`);
  });
});

describe('sw: failures in a pages job (CUJ-5)', () => {
  function api3(): ApiTable {
    return new Map<string, Record<string, unknown> | number>([
      [`${API}/${ID}`, illustJson()],
      [`${API}/${ID}/pages`, pagesJson(ID, 3)],
    ]);
  }

  it('sw: a page that fails after its retries ends partial', async () => {
    const failures = new Map([
      [pageUrl(ID, 1), { kind: 'http' as const, status: 503, attempts: 4 }],
    ]);
    const { tab } = await runJob(
      api3(),
      { failures },
      {
        mode: 'full',
        artworkId: ID,
        expectedFiles: 3,
        loggedIn: false,
      },
    );
    expect(tab.ended()?.outcome).toEqual({
      type: 'partial',
      folder: FOLDER,
      total: 3,
      saved: 2,
      failedPages: [1],
    });
  });

  it('sw: a 403 on an original stops new dispatches and ends needs-login', async () => {
    const pages = new Map<string, Record<string, unknown> | number>([
      [`${API}/${ID}`, illustJson({ pageCount: 12 })],
      [`${API}/${ID}/pages`, pagesJson(ID, 12)],
    ]);
    const failures = new Map([
      [pageUrl(ID, 0), { kind: 'http' as const, status: 403, attempts: 1 }],
    ]);
    const { tab, offscreen } = await runJob(pages, { failures });
    expect([tab.ended()?.outcome, offscreen.commandsOf('off/fetchBytes').length]).toEqual([
      { type: 'needsLogin' },
      4,
    ]);
  });

  // R-003: pixiv serves /pages of a walled all-ages work to logged-out sessions, so the SW must
  // stop a click made before the render-time metadata arrived.
  function walledApi(): ApiTable {
    const urls = { mini: null, thumb: null, small: null, regular: null, original: null };
    return new Map<string, Record<string, unknown> | number>([
      [`${API}/${ID}`, illustJson({ pageCount: 12, sl: 4, urls })],
      [`${API}/${ID}/pages`, pagesJson(ID, 12)],
    ]);
  }

  /** URLs the SW asked the tab to fetch from pixiv's API. */
  function apiRequests(): string[] {
    return fake.api.tabs.sendMessage.mock.calls.flatMap(([, message]) => {
      const m = message as { type?: unknown; url?: unknown };
      return m.type === 'api/fetchJson' && typeof m.url === 'string' ? [m.url] : [];
    });
  }

  it('sw: a logged-out pending click on a walled work ends needs-login before /pages or any byte', async () => {
    const start = { mode: 'full', artworkId: ID, expectedFiles: 0, loggedIn: false };
    const { tab, offscreen } = await runJob(walledApi(), {}, start);
    expect([tab.ended()?.outcome, apiRequests(), offscreen.commands, savedFiles(fake)]).toEqual([
      { type: 'needsLogin' },
      [`${API}/${ID}`],
      [],
      [],
    ]);
  });

  it('sw: the login-wall stop leaves no badge and no job record', async () => {
    const start = { mode: 'full', artworkId: ID, expectedFiles: 0, loggedIn: false };
    await runJob(walledApi(), {}, start);
    expect([
      fake.action.badgeText,
      Object.keys(fake.storage.session.snapshot()).filter((key) => key.startsWith('job:')),
    ]).toEqual(['', []]);
  });

  it('sw: a logged-in click on the same walled body downloads normally', async () => {
    const start = { mode: 'full', artworkId: ID, expectedFiles: 12, loggedIn: true };
    const { tab } = await runJob(walledApi(), {}, start);
    expect(tab.ended()?.outcome).toEqual({ type: 'saved', folder: FOLDER, pages: 12 });
  });

  it('sw: a deleted work (illust 404) ends unavailable', async () => {
    const api = new Map<string, Record<string, unknown> | number>([[`${API}/${ID}`, 404]]);
    const { tab } = await runJob(api);
    expect(tab.ended()?.outcome).toEqual({ type: 'unavailable' });
  });

  it('sw: a refused /pages (403) ends error refused', async () => {
    const api = new Map<string, Record<string, unknown> | number>([
      [`${API}/${ID}`, illustJson()],
      [`${API}/${ID}/pages`, 403],
    ]);
    const { tab } = await runJob(api);
    expect(tab.ended()?.outcome).toEqual({ type: 'error', cause: 'refused' });
  });

  it('sw: a download Chrome refuses ("Invalid filename") fails with disk', async () => {
    fake.downloads.failNextDownload('Invalid filename', 4);
    const { tab } = await runJob(
      api3(),
      {},
      {
        mode: 'full',
        artworkId: ID,
        expectedFiles: 3,
        loggedIn: false,
      },
    );
    expect(tab.ended()?.outcome).toEqual({ type: 'error', cause: 'disk' });
  });

  it('sw: a dismissed Save As dialog (USER_CANCELED) counts as a failed page', async () => {
    new ScriptedOffscreen(fake);
    await bootSw();
    const tab = new ContentTab(fake, ARTWORK_URL, api3());
    await settle(
      tab.send({
        type: 'job/start',
        mode: 'full',
        artworkId: ID,
        expectedFiles: 3,
        loggedIn: true,
      }),
    );
    await until(() => {
      for (const item of fake.downloads.inProgress()) {
        if (item.filename.endsWith('_p2.jpg')) fake.downloads.interrupt(item.id, 'USER_CANCELED');
        else fake.downloads.complete(item.id);
      }
      return tab.ended() !== undefined;
    }, 'job end');
    expect(tab.ended()?.outcome).toEqual({
      type: 'partial',
      folder: FOLDER,
      total: 3,
      saved: 2,
      failedPages: [2],
    });
  });
});

describe('sw: retries (CUJ-5)', () => {
  const RETRY_FOLDER = 'pixiv/old-folder';

  it('sw: retryPages fetches only the requested pages into the echoed folder', async () => {
    await runJob(
      api12(),
      {},
      {
        mode: 'retryPages',
        artworkId: ID,
        folder: RETRY_FOLDER,
        pages: [9, 4, 11],
        total: 12,
      },
    );
    expect(savedFiles(fake)).toEqual([
      `${RETRY_FOLDER}/${ID}_p4.jpg`,
      `${RETRY_FOLDER}/${ID}_p9.jpg`,
      `${RETRY_FOLDER}/${ID}_p11.jpg`,
    ]);
  });

  it('sw: retryPages continues the count from the earlier run', async () => {
    const { tab } = await runJob(
      api12(),
      {},
      {
        mode: 'retryPages',
        artworkId: ID,
        folder: RETRY_FOLDER,
        pages: [4, 9, 11],
        total: 12,
      },
    );
    const first = tab.views.find((v) => v.progress?.kind === 'pages');
    expect([first?.progress, tab.ended()?.outcome]).toEqual([
      { kind: 'pages', done: 9, total: 12 },
      { type: 'saved', folder: RETRY_FOLDER, pages: 12 },
    ]);
  });

  it('sw: retryMetadata writes only metadata.json and ends saved', async () => {
    const { tab } = await runJob(
      api12(),
      {},
      {
        mode: 'retryMetadata',
        artworkId: ID,
        folder: RETRY_FOLDER,
      },
    );
    expect([savedFiles(fake), tab.ended()?.outcome]).toEqual([
      [`${RETRY_FOLDER}/metadata.json`],
      { type: 'saved', folder: RETRY_FOLDER, pages: 12 },
    ]);
  });

  it('sw: a retry with an unsafe echoed folder is refused', async () => {
    new ScriptedOffscreen(fake);
    await bootSw();
    const tab = new ContentTab(fake, ARTWORK_URL, api12());
    const response = await settle(
      tab.send({ type: 'job/start', mode: 'retryMetadata', artworkId: ID, folder: 'a/../b' }),
    );
    expect(response).toEqual({ ok: false, error: 'BAD_REQUEST' });
  });
});

describe('sw: API proxy fallback', () => {
  it('sw: resolves through the offscreen document once the tab is gone', async () => {
    const offscreen = new ScriptedOffscreen(fake, { api: api12() });
    await bootSw();
    const tab = new ContentTab(fake, ARTWORK_URL, api12());
    const started = tab.send({
      type: 'job/start',
      mode: 'full',
      artworkId: ID,
      expectedFiles: 12,
      loggedIn: true,
    });
    tab.tab.close();
    await settle(started);
    const driver = new DownloadDriver(fake);
    await until(() => {
      driver.step();
      return !Object.keys(fake.storage.session.snapshot()).some((key) => key.startsWith('job:'));
    }, 'job end');
    expect([offscreen.commandsOf('off/fetchJson').length, savedFiles(fake).length]).toEqual([
      2, 13,
    ]);
  });
});
