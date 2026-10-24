// Chrome's download UI while jobs run (PRD §4.1 #3, R-005, R-006; design-test-harness.md
// "R-005/R-006 assertions (L2)"). Chrome has no getter for the UI state, so every check reads the
// fake's call log, which records each applied setUiOptions and each download() call in order: the
// UI goes off before a busy period's first file and back on right before its last one, or at its
// end when it has no final hand-off.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDOFF_SETTLE_WAIT_MS } from '../../src/shared/constants';
import type { FileTask, JobRecord } from '../../src/shared/job';
import type { JobStartResponse } from '../../src/shared/messages';
import { UI_DISABLED_ERROR, UI_PERMISSION_ERROR, type ChromeFake } from '../fakes/chrome';
import {
  API,
  ContentTab,
  DownloadDriver,
  ScriptedOffscreen,
  advance,
  bootSw,
  deferred,
  illustJson,
  pageUrl,
  pagesJson,
  savedFiles,
  settle,
  setUp,
  tearDown,
  ugoiraIllustJson,
  ugoiraMetaJson,
  until,
  type ApiTable,
  type OffscreenOptions,
} from './harness';

const ID = '135882741';
const FOLDER = 'pixiv/みずき-135882741';
const B = '136120877';
const B_FOLDER = `pixiv/そら-${B}`;
const GONE = '199999999';
const UGOIRA = '136004512';

let fake: ChromeFake;

beforeEach(() => {
  fake = setUp();
});

afterEach(tearDown);

/** The pixiv API; artwork ID has `pages` pages (3 unless a test needs the 12-page example). */
function api(pages = 3): ApiTable {
  return new Map<string, Record<string, unknown> | number>([
    [`${API}/${ID}`, illustJson({ pageCount: pages })],
    [`${API}/${ID}/pages`, pagesJson(ID, pages)],
    [
      `${API}/${B}`,
      illustJson({
        illustId: B,
        id: B,
        illustTitle: '夏祭りの帰り',
        userName: 'そら',
        pageCount: 3,
      }),
    ],
    [`${API}/${B}/pages`, pagesJson(B, 3)],
    [`${API}/${GONE}`, 404],
    [`${API}/${UGOIRA}`, ugoiraIllustJson()],
    [`${API}/${UGOIRA}/ugoira_meta`, ugoiraMetaJson()],
  ]);
}

function artworkTab(artworkId: string = ID, pages = 3): ContentTab {
  return new ContentTab(fake, `https://www.pixiv.net/artworks/${artworkId}`, api(pages));
}

async function start(tab: ContentTab, artworkId: string = ID, expectedFiles = 3): Promise<string> {
  const response = (await settle(
    tab.send({ type: 'job/start', mode: 'full', artworkId, expectedFiles, loggedIn: true }),
  )) as JobStartResponse;
  if (!response.ok) throw new Error('job/start failed');
  return response.view.jobId;
}

/** Completes Chrome's downloads as they appear until `tab`'s job has ended. */
async function driveToEnd(tab: ContentTab, jobId?: string): Promise<void> {
  const driver = new DownloadDriver(fake);
  await until(() => {
    driver.step();
    return tab.ended(jobId) !== undefined;
  }, 'job end');
  await advance(100);
}

/** The `enabled` values of the call log's `ui` entries in `from`…`to`. */
function ui(from = 0, to?: number): boolean[] {
  return fake.downloads.callLog
    .slice(from, to)
    .flatMap((call) => (call.op === 'ui' ? [call.enabled] : []));
}

/** The call log in `from`…`to`: `ui:<enabled>` for a UI call, the base name for a download. */
function names(from = 0, to?: number): string[] {
  return fake.downloads.callLog
    .slice(from, to)
    .map((call) =>
      call.op === 'ui' ? `ui:${call.enabled}` : (call.filename.split('/').pop() ?? ''),
    );
}

function downloads(): string[] {
  return fake.downloads.callLog.flatMap((call) => (call.op === 'download' ? [call.filename] : []));
}

/** download() calls made while Chrome's UI was on (a fresh profile starts with it on). */
function downloadsWhileShown(): string[] {
  const calls: string[] = [];
  let enabled = true;
  for (const call of fake.downloads.callLog) {
    if (call.op === 'ui') enabled = call.enabled;
    else if (enabled) calls.push(call.filename);
  }
  return calls;
}

/** The call-log length when each job's record was deleted from storage.session. */
function watchDeletes(): Map<string, number> {
  const at = new Map<string, number>();
  fake.storage.session.onChanged.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (key.startsWith('job:') && change.newValue === undefined) {
        at.set(key.slice('job:'.length), fake.downloads.callLog.length);
      }
    }
  });
  return at;
}

/** Boots with no job (the boot restore is the log's first entry), then watches record deletes. */
async function bootIdle(options: OffscreenOptions = {}) {
  const offscreen = new ScriptedOffscreen(fake, options);
  await bootSw();
  return { offscreen, deletes: watchDeletes(), afterBoot: fake.downloads.callLog.length };
}

function deletedAt(deletes: Map<string, number>, jobId: string): number {
  const at = deletes.get(jobId);
  if (at === undefined) throw new Error(`job ${jobId} was not deleted`);
  return at;
}

/** `ui` entries before and after `jobId`'s record was deleted (after boot). */
function aroundEnd(deletes: Map<string, number>, jobId: string, afterBoot: number) {
  const at = deletedAt(deletes, jobId);
  return { before: ui(afterBoot, at), after: ui(at) };
}

/** The offscreen task of page `page` of the main artwork. */
const pageTask =
  (page: number) =>
  (task: { url?: string }): boolean =>
    task.url === pageUrl(ID, page);
const not =
  <T>(match: (task: T) => boolean) =>
  (task: T): boolean =>
    !match(task);

describe('sw: download UI around a job (R-005, R-006)', () => {
  it('sw: no UI call while a job only resolves', async () => {
    const { afterBoot } = await bootIdle();
    const tab = artworkTab();
    const gate = deferred();
    tab.apiGate = gate.promise;
    await start(tab);
    await advance(100);
    const whileResolving = ui(afterBoot);
    gate.resolve();
    await driveToEnd(tab);
    expect(whileResolving).toEqual([]);
  });

  it('sw: no UI call while a job only fetches', async () => {
    const { offscreen, afterBoot } = await bootIdle({ auto: false });
    await start(artworkTab());
    await until(() => offscreen.tasks.size === 4, 'four tasks');
    await advance(100);
    expect(ui(afterBoot)).toEqual([]);
  });

  it('sw: the hide is applied before the job’s first file is handed to Chrome', async () => {
    const { afterBoot } = await bootIdle();
    const tab = artworkTab();
    await start(tab);
    await driveToEnd(tab);
    const log = fake.downloads.callLog.slice(afterBoot);
    expect(log.slice(0, 2)).toEqual([
      { op: 'ui', enabled: false },
      { op: 'download', filename: `${FOLDER}/metadata.json` },
    ]);
  });

  it('sw: no file is handed to Chrome until Chrome has applied the hide', async () => {
    await bootIdle();
    const setUiOptions = fake.api.downloads.setUiOptions;
    const apply = setUiOptions.getMockImplementation();
    if (!apply) throw new Error('no setUiOptions implementation');
    const gate = deferred();
    setUiOptions.mockImplementationOnce(async (options) => {
      await gate.promise;
      return apply(options);
    });
    const tab = artworkTab();
    await start(tab);
    await until(() => setUiOptions.mock.calls.length === 2, 'the hide');
    await advance(100);
    const whileHiding = downloads().length;
    gate.resolve();
    await driveToEnd(tab);
    expect([whileHiding, savedFiles(fake).length]).toEqual([0, 4]);
  });

  it('sw: only the job’s last file is handed to Chrome while the UI is on', async () => {
    await bootIdle();
    const tab = artworkTab();
    await start(tab);
    await driveToEnd(tab);
    expect([downloadsWhileShown(), downloads().length]).toEqual([[downloads().at(-1)], 4]);
  });

  it('sw: each busy period hides once and restores once, before its last file', async () => {
    const { afterBoot } = await bootIdle();
    const first = artworkTab();
    await start(first);
    await driveToEnd(first);
    const second = artworkTab();
    await start(second);
    await driveToEnd(second);
    expect([ui(afterBoot), downloadsWhileShown().length]).toEqual([[false, true, false, true], 2]);
  });
});

describe('sw: a job that ends with a final hand-off turns the UI on right before it (R-006)', () => {
  it('sw: 12 pages: ui:false, metadata.json and 11 pages, ui:true, then 135882741_p11.jpg', async () => {
    const { afterBoot } = await bootIdle();
    const tab = artworkTab(ID, 12);
    await start(tab, ID, 12);
    await driveToEnd(tab);
    // Only the last file may finish while the UI is on: an earlier file finishing after the enable
    // would open Chrome's bubble before the last file exists (QA iteration 3, retry 1).
    const settledWhileShown = fake.downloads.settledWhileShown.map((f) => f.split('/').pop());
    expect([tab.ended()?.outcome?.type, names(afterBoot), settledWhileShown]).toEqual([
      'saved',
      [
        'ui:false',
        'metadata.json',
        ...Array.from({ length: 11 }, (_, page) => `${ID}_p${page}.jpg`),
        'ui:true',
        `${ID}_p11.jpg`,
      ],
      [`${ID}_p11.jpg`],
    ]);
  });

  it('sw: 12 pages: nothing reaches the call log after the record is deleted', async () => {
    const { deletes, afterBoot } = await bootIdle();
    const tab = artworkTab(ID, 12);
    const jobId = await start(tab, ID, 12);
    await driveToEnd(tab);
    expect(names(deletedAt(deletes, jobId))).toEqual([]);
    expect(aroundEnd(deletes, jobId, afterBoot)).toEqual({ before: [false, true], after: [] });
  });

  it('sw: saved → the restore comes before the last file, none after the record is deleted', async () => {
    const { deletes, afterBoot } = await bootIdle();
    const tab = artworkTab();
    const jobId = await start(tab);
    await driveToEnd(tab);
    expect([tab.ended()?.outcome?.type, aroundEnd(deletes, jobId, afterBoot)]).toEqual([
      'saved',
      { before: [false, true], after: [] },
    ]);
  });

  it('sw: partial whose last-settling file succeeds → the restore comes right before that file', async () => {
    const failures = new Map([
      [pageUrl(ID, 1), { kind: 'http' as const, status: 503, attempts: 4 }],
    ]);
    const { offscreen, deletes, afterBoot } = await bootIdle({ auto: false, failures });
    const tab = artworkTab();
    const jobId = await start(tab);
    await until(() => offscreen.tasks.size === 4, 'four tasks');
    offscreen.finish(not(pageTask(2)));
    await until(() => downloads().length === 2, 'metadata.json and p0 in Chrome');
    offscreen.finish();
    await driveToEnd(tab);
    expect([
      tab.ended()?.outcome?.type,
      names(afterBoot),
      names(deletedAt(deletes, jobId)),
    ]).toEqual([
      'partial',
      ['ui:false', 'metadata.json', `${ID}_p0.jpg`, 'ui:true', `${ID}_p2.jpg`],
      [],
    ]);
  });

  it('sw: ugoira → the UI stays hidden through the encode and returns right before the video', async () => {
    const { deletes, afterBoot } = await bootIdle();
    const tab = artworkTab(UGOIRA);
    const jobId = await start(tab, UGOIRA, 1);
    await driveToEnd(tab);
    expect([names(afterBoot), aroundEnd(deletes, jobId, afterBoot)]).toEqual([
      [
        'ui:false',
        'metadata.json',
        `${UGOIRA}_ugoira.zip`,
        'frames.json',
        'ui:true',
        `${UGOIRA}.mp4`,
      ],
      { before: [false, true], after: [] },
    ]);
  });
});

describe('sw: a job that ends without a final hand-off turns the UI on after its end (R-006)', () => {
  it('sw: cancel → ui:true after the record is deleted, no download after it', async () => {
    const { offscreen, deletes, afterBoot } = await bootIdle({ auto: false });
    const tab = artworkTab();
    const jobId = await start(tab);
    await until(() => offscreen.tasks.size === 4, 'four tasks');
    offscreen.finish((task) => task.kind === 'text');
    await until(() => fake.downloads.inProgress().length > 0, 'metadata.json in Chrome');
    await settle(tab.send({ type: 'job/cancel', jobId }));
    await advance(100);
    expect([
      tab.ended()?.outcome?.type,
      names(afterBoot, deletedAt(deletes, jobId)),
      names(deletedAt(deletes, jobId)),
    ]).toEqual(['cancelled', ['ui:false', 'metadata.json'], ['ui:true']]);
  });

  it('sw: partial whose failing page settles last → ui:true after the record is deleted', async () => {
    const failures = new Map([
      [pageUrl(ID, 2), { kind: 'http' as const, status: 503, attempts: 4 }],
    ]);
    const { offscreen, deletes, afterBoot } = await bootIdle({ auto: false, failures });
    const tab = artworkTab();
    const jobId = await start(tab);
    await until(() => offscreen.tasks.size === 4, 'four tasks');
    offscreen.finish(not(pageTask(2)));
    const driver = new DownloadDriver(fake);
    await until(() => {
      driver.step();
      return savedFiles(fake).length === 3;
    }, 'three files saved');
    offscreen.finish();
    await driveToEnd(tab);
    expect([
      tab.ended()?.outcome?.type,
      names(afterBoot, deletedAt(deletes, jobId)),
      names(deletedAt(deletes, jobId)),
    ]).toEqual([
      'partial',
      ['ui:false', 'metadata.json', `${ID}_p0.jpg`, `${ID}_p1.jpg`],
      ['ui:true'],
    ]);
  });

  it('sw: needs login after a 403 with nothing else in flight → ui:true after the record is deleted', async () => {
    const failures = new Map([
      [pageUrl(ID, 2), { kind: 'http' as const, status: 403, attempts: 1 }],
    ]);
    const { offscreen, deletes, afterBoot } = await bootIdle({ auto: false, failures });
    const tab = artworkTab();
    const jobId = await start(tab);
    await until(() => offscreen.tasks.size === 4, 'four tasks');
    offscreen.finish(not(pageTask(2)));
    const driver = new DownloadDriver(fake);
    await until(() => {
      driver.step();
      return savedFiles(fake).length === 3;
    }, 'three files saved');
    offscreen.finish();
    await driveToEnd(tab);
    expect([
      tab.ended()?.outcome?.type,
      names(afterBoot, deletedAt(deletes, jobId)),
      names(deletedAt(deletes, jobId)),
    ]).toEqual([
      'needsLogin',
      ['ui:false', 'metadata.json', `${ID}_p0.jpg`, `${ID}_p1.jpg`],
      ['ui:true'],
    ]);
  });

  it('sw: unavailable, as the last job to end → the other job’s last file hid, ui:true after this record is deleted', async () => {
    const { offscreen, deletes, afterBoot } = await bootIdle({ auto: false });
    const running = artworkTab();
    await start(running);
    await until(() => offscreen.tasks.size === 4, 'four tasks');
    offscreen.finish((task) => task.kind === 'text');
    await until(() => fake.downloads.inProgress().length > 0, 'a file in Chrome');
    const gone = artworkTab(GONE);
    const gate = deferred();
    gone.apiGate = gate.promise;
    const goneJob = await start(gone, GONE, 1);
    offscreen.finish();
    await driveToEnd(running);
    gate.resolve();
    await until(() => gone.ended() !== undefined, 'unavailable');
    await advance(100);
    expect([
      gone.ended()?.outcome?.type,
      aroundEnd(deletes, goneJob, afterBoot),
      names(deletedAt(deletes, goneJob)),
      downloadsWhileShown(),
    ]).toEqual(['unavailable', { before: [false], after: [true] }, ['ui:true'], []]);
  });

  it('sw: a job that never hands a file to Chrome (no file) ends without a UI call', async () => {
    const { afterBoot } = await bootIdle();
    const tab = artworkTab(GONE);
    await start(tab, GONE, 1);
    await until(() => tab.ended() !== undefined, 'unavailable');
    await advance(100);
    expect(ui(afterBoot)).toEqual([]);
  });
});

describe('sw: a single-file busy period makes no UI call (R-006)', () => {
  it('sw: a one-page retry after an idle boot → its file reaches Chrome with no UI entry', async () => {
    const { afterBoot } = await bootIdle();
    const tab = artworkTab();
    const response = (await settle(
      tab.send({
        type: 'job/start',
        mode: 'retryPages',
        artworkId: ID,
        folder: FOLDER,
        pages: [1],
        total: 3,
      }),
    )) as JobStartResponse;
    if (!response.ok) throw new Error('job/start failed');
    await driveToEnd(tab);
    expect([tab.ended()?.outcome?.type, names(afterBoot)]).toEqual(['saved', [`${ID}_p1.jpg`]]);
  });
});

describe('sw: two jobs share one busy period (CUJ-4, R-006)', () => {
  async function twoJobs() {
    const { offscreen, afterBoot } = await bootIdle({ auto: false });
    const tabA = artworkTab(ID);
    const tabB = artworkTab(B);
    await start(tabA, ID);
    await until(() => offscreen.tasks.size === 4, 'job A fetching');
    const tasksA = new Set(offscreen.tasks.keys());
    await start(tabB, B);
    await until(() => offscreen.tasks.size === 8, 'both jobs fetching');
    return { offscreen, tabA, tabB, afterBoot, tasksA };
  }

  /** Lands every file of job B and completes its downloads while job A's files still fetch. */
  async function finishB(
    offscreen: ScriptedOffscreen,
    tabB: ContentTab,
    tasksA: Set<string>,
  ): Promise<void> {
    offscreen.finish((task) => !tasksA.has(task.taskId));
    await until(() => {
      for (const item of fake.downloads.inProgress()) {
        if (item.filename.includes(`/${B_FOLDER}/`)) fake.downloads.complete(item.id);
      }
      return tabB.ended() !== undefined;
    }, 'job B end');
    await advance(100);
  }

  it('sw: job B ending while job A runs makes no UI call', async () => {
    const { offscreen, tabB, afterBoot, tasksA } = await twoJobs();
    await finishB(offscreen, tabB, tasksA);
    expect([tabB.ended()?.outcome?.type, ui(afterBoot)]).toEqual(['saved', [false]]);
  });

  it('sw: A’s ui:true sits right before A’s last download, after every other download', async () => {
    const { offscreen, tabA, tabB, afterBoot, tasksA } = await twoJobs();
    await finishB(offscreen, tabB, tasksA);
    offscreen.finish();
    await driveToEnd(tabA);
    const [on, last] = fake.downloads.callLog.slice(-2);
    expect([
      ui(afterBoot),
      on,
      last?.op === 'download' && last.filename.startsWith(`${FOLDER}/`),
      fake.downloads.uiEnabled,
    ]).toEqual([[false, true], { op: 'ui', enabled: true }, true, true]);
  });

  it('sw: the hand-offs of both jobs share one hide; only A’s last file is handed off while the UI is on', async () => {
    const { offscreen, tabA, tabB, afterBoot, tasksA } = await twoJobs();
    await finishB(offscreen, tabB, tasksA);
    offscreen.finish();
    await driveToEnd(tabA);
    expect([downloadsWhileShown(), savedFiles(fake).length, ui(afterBoot).length]).toEqual([
      [downloads().at(-1)],
      8,
      2,
    ]);
  });

  it('sw: a job started after the restore was requested gets a fresh ui:false before its first download', async () => {
    const { afterBoot } = await bootIdle();
    const tabA = artworkTab(ID);
    await start(tabA, ID);
    // Job A's last file is in Chrome (not complete yet) with the UI back on.
    await until(() => ui(afterBoot).includes(true) && downloads().length === 4, 'A’s restore');
    const tabB = artworkTab(B);
    await start(tabB, B);
    const driver = new DownloadDriver(fake);
    await until(() => {
      driver.step();
      return tabA.ended() !== undefined && tabB.ended() !== undefined;
    }, 'both ends');
    await advance(100);
    const log = names(afterBoot);
    const firstOfB = fake.downloads.callLog
      .slice(afterBoot)
      .findIndex((call) => call.op === 'download' && call.filename.startsWith(`${B_FOLDER}/`));
    expect([ui(afterBoot), log.lastIndexOf('ui:false') < firstOfB, log.at(-2)]).toEqual([
      [false, true, false, true],
      true,
      'ui:true',
    ]);
  });
});

describe('sw: the last hand-off waits for the files before it to finish (R-006)', () => {
  /** A 3-page job whose metadata.json and p0 are saved, then p1 and p2 land together. */
  async function lastTwoTogether() {
    const { offscreen, afterBoot } = await bootIdle({ auto: false });
    fake.downloads.deferNaming(true);
    const tab = artworkTab();
    await start(tab);
    await until(() => offscreen.tasks.size === 4, 'four tasks');
    offscreen.finish((task) => task.kind === 'text' || pageTask(0)(task));
    const driver = new DownloadDriver(fake);
    await until(() => {
      driver.step();
      return savedFiles(fake).length === 2;
    }, 'metadata.json and p0 saved');
    offscreen.finish();
    await until(() => downloads().length === 3, 'p1 in Chrome');
    await advance(10);
    const p1 = fake.downloads.inProgress()[0]?.id;
    if (p1 === undefined) throw new Error('p1 is not in Chrome');
    return { tab, afterBoot, p1 };
  }

  it('sw: deferred naming: no ui:true until the earlier of the last two has finished (being named is not enough)', async () => {
    const { afterBoot, p1 } = await lastTwoTogether();
    const beforeNaming = names(afterBoot);
    fake.downloads.name(p1);
    await advance(10);
    const afterNaming = names(afterBoot);
    fake.downloads.complete(p1);
    await advance(10);
    const partial = ['ui:false', 'metadata.json', `${ID}_p0.jpg`, `${ID}_p1.jpg`];
    expect([beforeNaming, afterNaming, names(afterBoot), fake.downloads.settledWhileShown]).toEqual(
      [partial, partial, [...partial, 'ui:true', `${ID}_p2.jpg`], []],
    );
  });

  it(`sw: a file still in progress holds the restore back for at most ${HANDOFF_SETTLE_WAIT_MS} ms`, async () => {
    const { afterBoot } = await lastTwoTogether();
    await advance(HANDOFF_SETTLE_WAIT_MS);
    expect(names(afterBoot)).toEqual([
      'ui:false',
      'metadata.json',
      `${ID}_p0.jpg`,
      `${ID}_p1.jpg`,
      'ui:true',
      `${ID}_p2.jpg`,
    ]);
  });
});

describe('sw: a cancel while the restore is in flight (R-006)', () => {
  it('sw: the last file never reaches Chrome', async () => {
    const { offscreen, afterBoot } = await bootIdle({ auto: false });
    const tab = artworkTab();
    const jobId = await start(tab);
    await until(() => offscreen.tasks.size === 4, 'four tasks');
    offscreen.finish(not(pageTask(2)));
    await until(() => downloads().length === 3, 'three files in Chrome');
    const setUiOptions = fake.api.downloads.setUiOptions;
    const apply = setUiOptions.getMockImplementation();
    if (!apply) throw new Error('no setUiOptions implementation');
    const gate = deferred();
    setUiOptions.mockImplementationOnce(async (options) => {
      await gate.promise;
      return apply(options);
    });
    const calls = setUiOptions.mock.calls.length;
    offscreen.finish();
    await until(() => setUiOptions.mock.calls.length > calls, 'the restore');
    const cancelled = tab.send({ type: 'job/cancel', jobId });
    await advance(10);
    gate.resolve();
    await settle(cancelled);
    await advance(100);
    expect([tab.ended()?.outcome?.type, names(afterBoot)]).toEqual([
      'cancelled',
      ['ui:false', 'metadata.json', `${ID}_p0.jpg`, `${ID}_p1.jpg`, 'ui:true'],
    ]);
  });
});

describe('sw: boot (R-005)', () => {
  function page(idx: number, extra: Partial<FileTask>): FileTask {
    return {
      idx,
      role: 'page',
      page: idx,
      name: `${ID}_p${idx}.jpg`,
      url: pageUrl(ID, idx),
      save: true,
      dependsOn: [],
      state: 'queued',
      ...extra,
    };
  }

  function seedJob(tabId: number, files: FileTask[]): void {
    const job: JobRecord = {
      v: 1,
      jobId: 'job-1',
      artworkId: ID,
      originTabId: tabId,
      createdAt: 0,
      mode: 'full',
      request: { mode: 'full', artworkId: ID, expectedFiles: 3, loggedIn: null },
      kind: 'pages',
      phase: 'transferring',
      snapshot: {
        folderPattern: 'pixiv/{artist}-{id}',
        ugoiraOutput: 'mp4',
        saveMetadata: false,
        effectiveFormat: null,
      },
      expectedFiles: 3,
      metaBody: null,
      folder: FOLDER,
      pagesTotal: 3,
      pagesOffset: 0,
      files,
      ugoira: null,
      stopReason: null,
      apiFailure: null,
    };
    fake.storage.session.seed({ [`job:${job.jobId}`]: job });
  }

  it('sw: boot with no job record turns the UI on first', async () => {
    fake.downloads.uiEnabled = false;
    await bootSw();
    expect([fake.downloads.callLog, fake.downloads.uiEnabled]).toEqual([
      [{ op: 'ui', enabled: true }],
      true,
    ]);
  });

  it('sw: boot with a hydrated running job makes no UI call', async () => {
    new ScriptedOffscreen(fake, { auto: false });
    const tab = artworkTab();
    seedJob(tab.id, [page(0, { state: 'fetching', taskId: 'gone-0' }), page(1, {}), page(2, {})]);
    fake.downloads.uiEnabled = false;
    await bootSw();
    await advance(100);
    expect([fake.downloads.callLog, fake.downloads.uiEnabled]).toEqual([[], false]);
  });

  it('sw: the hydrated job’s next hand-off hides the UI again, and its last one restores it', async () => {
    const offscreen = new ScriptedOffscreen(fake, { auto: false });
    const tab = artworkTab();
    seedJob(tab.id, [page(0, { state: 'fetching', taskId: 'gone-0' }), page(1, {}), page(2, {})]);
    await bootSw();
    await until(() => offscreen.tasks.size === 3, 'refetching');
    offscreen.finish();
    await driveToEnd(tab);
    expect([ui(), downloadsWhileShown(), savedFiles(fake).length]).toEqual([
      [false, true],
      [downloads().at(-1)],
      3,
    ]);
  });
});

describe('sw: a refused setUiOptions never fails a job (R-005, R-006)', () => {
  it('sw: a refused hide still saves every file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await bootIdle();
    fake.downloads.failNextSetUiOptions(UI_PERMISSION_ERROR);
    const tab = artworkTab();
    await start(tab);
    await driveToEnd(tab);
    expect([tab.ended()?.outcome, savedFiles(fake).length, warn.mock.calls.length]).toEqual([
      { type: 'saved', folder: FOLDER, pages: 3 },
      4,
      1,
    ]);
  });

  it('sw: a refused restore still ends the job saved, its last file handed to Chrome', async () => {
    const { offscreen, afterBoot } = await bootIdle({ auto: false });
    const tab = artworkTab();
    await start(tab);
    await until(() => offscreen.tasks.size === 4, 'four tasks');
    offscreen.finish((task) => task.kind === 'text');
    await until(() => fake.downloads.inProgress().length > 0, 'a file in Chrome');
    fake.downloads.failNextSetUiOptions(UI_DISABLED_ERROR);
    offscreen.finish();
    await driveToEnd(tab);
    expect([tab.ended()?.outcome, ui(afterBoot), savedFiles(fake).length]).toEqual([
      { type: 'saved', folder: FOLDER, pages: 3 },
      [false],
      4,
    ]);
  });
});
