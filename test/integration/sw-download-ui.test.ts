// Chrome's download UI while jobs run (PRD §4.1 #3, R-005; design-test-harness.md "R-005
// assertions (L2)"). Chrome has no getter for the UI state, so every check reads the fake's call
// log, which records each applied setUiOptions and each download() call in order.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const GONE = '199999999';
const UGOIRA = '136004512';

let fake: ChromeFake;

beforeEach(() => {
  fake = setUp();
});

afterEach(tearDown);

function api(): ApiTable {
  return new Map<string, Record<string, unknown> | number>([
    [`${API}/${ID}`, illustJson({ pageCount: 3 })],
    [`${API}/${ID}/pages`, pagesJson(ID, 3)],
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

function artworkTab(artworkId: string = ID): ContentTab {
  return new ContentTab(fake, `https://www.pixiv.net/artworks/${artworkId}`, api());
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

/** `ui` entries before and after `jobId`'s record was deleted (after boot). */
function aroundEnd(deletes: Map<string, number>, jobId: string, afterBoot: number) {
  const deletedAt = deletes.get(jobId);
  if (deletedAt === undefined) throw new Error(`job ${jobId} was not deleted`);
  return { before: ui(afterBoot, deletedAt), after: ui(deletedAt) };
}

describe('sw: download UI around a job (R-005)', () => {
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
    const whileHiding = fake.api.downloads.download.mock.calls.length;
    gate.resolve();
    await driveToEnd(tab);
    expect([whileHiding, savedFiles(fake).length]).toEqual([0, 4]);
  });

  it('sw: every file is handed to Chrome while the UI is hidden', async () => {
    await bootIdle();
    const tab = artworkTab();
    await start(tab);
    await driveToEnd(tab);
    expect([downloadsWhileShown(), savedFiles(fake).length]).toEqual([[], 4]);
  });

  it('sw: each busy period starts with its own hide', async () => {
    const { afterBoot } = await bootIdle();
    const first = artworkTab();
    await start(first);
    await driveToEnd(first);
    const second = artworkTab();
    await start(second);
    await driveToEnd(second);
    expect([ui(afterBoot), downloadsWhileShown()]).toEqual([[false, true, false, true], []]);
  });
});

describe('sw: the UI returns once, after the last job ends, whatever the reason (R-005)', () => {
  it('sw: saved → one restore, after the record is deleted', async () => {
    const { deletes, afterBoot } = await bootIdle();
    const tab = artworkTab();
    const jobId = await start(tab);
    await driveToEnd(tab);
    expect([tab.ended()?.outcome?.type, aroundEnd(deletes, jobId, afterBoot)]).toEqual([
      'saved',
      { before: [false], after: [true] },
    ]);
  });

  it('sw: partial → one restore, after the record is deleted', async () => {
    const failures = new Map([
      [pageUrl(ID, 1), { kind: 'http' as const, status: 503, attempts: 4 }],
    ]);
    const { deletes, afterBoot } = await bootIdle({ failures });
    const tab = artworkTab();
    const jobId = await start(tab);
    await driveToEnd(tab);
    expect([tab.ended()?.outcome?.type, aroundEnd(deletes, jobId, afterBoot)]).toEqual([
      'partial',
      { before: [false], after: [true] },
    ]);
  });

  it('sw: needs login after a 403 → one restore, after the record is deleted', async () => {
    const failures = new Map([
      [pageUrl(ID, 0), { kind: 'http' as const, status: 403, attempts: 1 }],
    ]);
    const { deletes, afterBoot } = await bootIdle({ failures });
    const tab = artworkTab();
    const jobId = await start(tab);
    await driveToEnd(tab);
    expect([tab.ended()?.outcome?.type, aroundEnd(deletes, jobId, afterBoot)]).toEqual([
      'needsLogin',
      { before: [false], after: [true] },
    ]);
  });

  it('sw: unavailable, as the last job to end → one restore, after its record is deleted', async () => {
    const { deletes, afterBoot } = await bootIdle();
    const running = artworkTab();
    await start(running);
    await until(() => fake.downloads.inProgress().length > 0, 'a file in Chrome');
    const gone = artworkTab(GONE);
    const gate = deferred();
    gone.apiGate = gate.promise;
    const goneJob = await start(gone, GONE, 1);
    await driveToEnd(running);
    gate.resolve();
    await until(() => gone.ended() !== undefined, 'unavailable');
    await advance(100);
    expect([gone.ended()?.outcome?.type, aroundEnd(deletes, goneJob, afterBoot)]).toEqual([
      'unavailable',
      { before: [false], after: [true] },
    ]);
  });

  it('sw: cancel → one restore, after the record is deleted', async () => {
    const { deletes, afterBoot } = await bootIdle();
    const tab = artworkTab();
    const jobId = await start(tab);
    await until(() => fake.downloads.inProgress().length > 0, 'a file in Chrome');
    await settle(tab.send({ type: 'job/cancel', jobId }));
    await advance(100);
    expect([tab.ended()?.outcome?.type, aroundEnd(deletes, jobId, afterBoot)]).toEqual([
      'cancelled',
      { before: [false], after: [true] },
    ]);
  });

  it('sw: a job that never hid the UI ends without a UI call', async () => {
    const { afterBoot } = await bootIdle();
    const tab = artworkTab(GONE);
    await start(tab, GONE, 1);
    await until(() => tab.ended() !== undefined, 'unavailable');
    await advance(100);
    expect(ui(afterBoot)).toEqual([]);
  });
});

describe('sw: two jobs keep the UI hidden until both end (CUJ-4, R-005)', () => {
  async function twoJobs() {
    const { offscreen, afterBoot } = await bootIdle({ auto: false });
    const tabA = artworkTab(ID);
    const tabB = artworkTab(B);
    await start(tabA, ID);
    await start(tabB, B);
    await until(() => offscreen.tasks.size === 8, 'both jobs fetching');
    return { offscreen, tabA, tabB, afterBoot };
  }

  /** Lands every file of job B while job A's files stay in Chrome's downloader. */
  async function finishB(offscreen: ScriptedOffscreen, tabB: ContentTab): Promise<void> {
    await until(() => {
      offscreen.finish();
      for (const item of fake.downloads.inProgress()) {
        if (item.filename.includes(`/pixiv/そら-${B}/`)) fake.downloads.complete(item.id);
      }
      return tabB.ended() !== undefined;
    }, 'job B end');
    await advance(100);
  }

  it('sw: job B ending while job A runs makes no UI call', async () => {
    const { offscreen, tabB, afterBoot } = await twoJobs();
    await finishB(offscreen, tabB);
    expect([tabB.ended()?.outcome?.type, ui(afterBoot)]).toEqual(['saved', [false]]);
  });

  it('sw: the UI returns once job A ends too', async () => {
    const { offscreen, tabA, tabB, afterBoot } = await twoJobs();
    await finishB(offscreen, tabB);
    await driveToEnd(tabA);
    expect([ui(afterBoot), fake.downloads.uiEnabled]).toEqual([[false, true], true]);
  });

  it('sw: the hand-offs of both jobs share one hide', async () => {
    const { offscreen, tabA, tabB, afterBoot } = await twoJobs();
    await finishB(offscreen, tabB);
    await driveToEnd(tabA);
    expect([downloadsWhileShown(), savedFiles(fake).length, ui(afterBoot).length]).toEqual([
      [],
      8,
      2,
    ]);
  });
});

describe('sw: an ugoira job (CUJ-2 step 4, R-005)', () => {
  it('sw: the UI stays hidden through the encode and returns at the job’s end', async () => {
    const { deletes, afterBoot } = await bootIdle();
    const tab = artworkTab(UGOIRA);
    const jobId = await start(tab, UGOIRA, 1);
    await driveToEnd(tab);
    const log = fake.downloads.callLog.slice(afterBoot);
    expect([
      log.map((call) => (call.op === 'ui' ? `ui:${call.enabled}` : call.filename.split('/')[2])),
      aroundEnd(deletes, jobId, afterBoot),
    ]).toEqual([
      [
        'ui:false',
        'metadata.json',
        `${UGOIRA}_ugoira.zip`,
        'frames.json',
        `${UGOIRA}.mp4`,
        'ui:true',
      ],
      { before: [false], after: [true] },
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

  it('sw: the hydrated job’s next hand-off hides the UI again before its download', async () => {
    const offscreen = new ScriptedOffscreen(fake, { auto: false });
    const tab = artworkTab();
    seedJob(tab.id, [page(0, { state: 'fetching', taskId: 'gone-0' }), page(1, {}), page(2, {})]);
    await bootSw();
    await until(() => offscreen.tasks.size === 3, 'refetching');
    offscreen.finish();
    await driveToEnd(tab);
    expect([ui(), downloadsWhileShown(), savedFiles(fake).length]).toEqual([[false, true], [], 3]);
  });
});

describe('sw: a refused setUiOptions never fails a job (R-005)', () => {
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

  it('sw: a refused restore still ends the job saved', async () => {
    const { afterBoot } = await bootIdle();
    const tab = artworkTab();
    await start(tab);
    await until(() => fake.downloads.inProgress().length > 0, 'a file in Chrome');
    fake.downloads.failNextSetUiOptions(UI_DISABLED_ERROR);
    await driveToEnd(tab);
    expect([tab.ended()?.outcome, ui(afterBoot)]).toEqual([
      { type: 'saved', folder: FOLDER, pages: 3 },
      [false],
    ]);
  });
});
