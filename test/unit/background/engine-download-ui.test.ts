// The engine's three download-UI call sites (design-download-engine.md "Chrome's download UI
// (download-ui.ts, R-005, R-006)"): every hand-off but the busy period's last waits for the hide,
// the last one waits for the restore (after Chrome has created and named every earlier file), and
// both re-check the job; finalize restores once no job is left, and restoreDownloadUiIfIdle()
// (boot) restores only with no job.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadUi } from '../../../src/background/download-ui';
import { createEngine, type Engine } from '../../../src/background/engine';
import { HANDOFF_TARGET_WAIT_MS } from '../../../src/shared/constants';
import type { FileTask, JobRecord } from '../../../src/shared/job';
import {
  DOWNLOADS_DIR,
  UI_PERMISSION_ERROR,
  installChromeFake,
  type ChromeFake,
} from '../../fakes/chrome';

const ID = '135882741';
const FOLDER = 'pixiv/みずき-135882741';
const TAB_ID = 7;

let fake: ChromeFake;

function blob(idx: number): string {
  return `blob:chrome-extension://abcdefghijklmnopabcdefghijklmnop/${idx + 1}`;
}

function page(idx: number, extra: Partial<FileTask>): FileTask {
  return {
    idx,
    role: 'page',
    page: idx,
    name: `${ID}_p${idx}.jpg`,
    url: `https://i.pximg.net/img-original/img/${ID}_p${idx}.jpg`,
    save: true,
    dependsOn: [],
    state: 'queued',
    ...extra,
  };
}

/** Page `idx` with its offscreen task `t<idx>` running. */
function fetching(idx: number): FileTask {
  return page(idx, { state: 'fetching', taskId: `t${idx}` });
}

/** A running pages job, as storage.session holds it, for engine.hydrate(). */
function seedJob(jobId: string, files: FileTask[], extra: Partial<JobRecord> = {}): void {
  const job: JobRecord = {
    v: 1,
    jobId,
    artworkId: ID,
    originTabId: TAB_ID,
    createdAt: 0,
    mode: 'full',
    request: { mode: 'full', artworkId: ID, expectedFiles: files.length, loggedIn: null },
    kind: 'pages',
    phase: 'transferring',
    snapshot: {
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput: 'mp4',
      saveMetadata: false,
      effectiveFormat: null,
    },
    expectedFiles: files.length,
    metaBody: null,
    folder: FOLDER,
    pagesTotal: files.length,
    pagesOffset: 0,
    files,
    ugoira: null,
    stopReason: null,
    apiFailure: null,
    ...extra,
  };
  fake.storage.session.seed({ [`job:${jobId}`]: job });
}

/** A DownloadUi whose hide and restore can be held in flight; `events` records the calls in order. */
function stubUi() {
  const events: string[] = [];
  let hide: Promise<void> = Promise.resolve();
  let restore: Promise<void> = Promise.resolve();
  let releaseHide: () => void = () => undefined;
  let releaseRestore: () => void = () => undefined;
  const ui = {
    hideForHandOff: vi.fn(() => {
      events.push('hide');
      return hide;
    }),
    restore: vi.fn(() => {
      events.push('restore');
      return restore;
    }),
  } satisfies DownloadUi;
  return {
    ui,
    events,
    holdHide(): void {
      hide = new Promise<void>((resolve) => (releaseHide = resolve));
    },
    releaseHide: () => releaseHide(),
    holdRestore(): void {
      restore = new Promise<void>((resolve) => (releaseRestore = resolve));
    },
    releaseRestore: () => releaseRestore(),
  };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1);
}

/** off/ready for page `idx`'s task: the file goes `saving`, and its hand-off starts. */
function land(engine: Engine, idx: number): void {
  void engine.onOffscreenEvent({
    target: 'sw',
    type: 'off/ready',
    taskId: `t${idx}`,
    blobUrl: blob(idx),
    size: 10,
  });
}

/** off/ready for the one file of the second seeded job (task `u0`). */
function landOther(engine: Engine): void {
  void engine.onOffscreenEvent({
    target: 'sw',
    type: 'off/ready',
    taskId: 'u0',
    blobUrl: blob(9),
    size: 10,
  });
}

/** An engine over the seeded jobs, with Chrome's download events delivered to it like sw.ts does. */
async function hydrated(ui?: DownloadUi): Promise<Engine> {
  const engine = createEngine(ui);
  await engine.hydrate();
  chrome.downloads.onChanged.addListener((delta) => void engine.onDownloadChanged(delta));
  return engine;
}

/** Page `idx` already in Chrome (download id 1), its target path not determined yet. */
async function unnamedInChrome(idx: number): Promise<FileTask> {
  fake.downloads.deferNaming(true);
  const downloadId = await chrome.downloads.download({
    url: blob(idx),
    filename: `${FOLDER}/${ID}_p${idx}.jpg`,
    conflictAction: 'uniquify',
    saveAs: false,
  });
  return page(idx, { state: 'saving', taskId: `t${idx}`, blobUrl: blob(idx), downloadId });
}

function downloadsOf(): string[] {
  return fake.downloads.callLog.flatMap((call) => (call.op === 'download' ? [call.filename] : []));
}

const p = (idx: number): string => `${FOLDER}/${ID}_p${idx}.jpg`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  fake = installChromeFake();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('engine: hand-off before the last hides the UI (R-005)', () => {
  it('handOff: a hand-off with another file still to come calls hideForHandOff() only', async () => {
    const stub = stubUi();
    seedJob('job-1', [fetching(0), fetching(1)]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    expect(stub.events).toEqual(['hide']);
  });

  it('handOff: no download is asked for while the hide is in flight', async () => {
    const stub = stubUi();
    stub.holdHide();
    seedJob('job-1', [fetching(0), page(1, {})]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    expect([stub.events, fake.api.downloads.download.mock.calls.length]).toEqual([['hide'], 0]);
  });

  it('handOff: the download follows once the hide has resolved', async () => {
    const stub = stubUi();
    stub.holdHide();
    seedJob('job-1', [fetching(0), page(1, {})]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    stub.releaseHide();
    await flush();
    expect(fake.downloads.callLog).toEqual([{ op: 'download', filename: p(0) }]);
  });

  it('handOff: a job cancelled while the hide was in flight hands nothing to Chrome', async () => {
    const stub = stubUi();
    stub.holdHide();
    seedJob('job-1', [fetching(0), page(1, {})]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    await engine.cancel('job-1', TAB_ID);
    stub.releaseHide();
    await flush();
    expect(fake.api.downloads.download).not.toHaveBeenCalled();
  });

  it('handOff: a cancel whose final push is still pending also hands nothing to Chrome', async () => {
    const stub = stubUi();
    stub.holdHide();
    seedJob('job-1', [fetching(0), page(1, {})]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    // The cancel has failed the file, but finalize has not deleted the record yet.
    fake.api.tabs.sendMessage.mockImplementation(() => new Promise(() => undefined));
    void engine.cancel('job-1', TAB_ID);
    await flush();
    stub.releaseHide();
    await flush();
    expect([
      engine.registry.get('job-1')?.stopReason,
      fake.api.downloads.download.mock.calls,
    ]).toEqual(['cancelled', []]);
  });

  it('handOff: a refused hide (resolved by DownloadUi) still saves the file', async () => {
    seedJob('job-1', [fetching(0), page(1, {})]);
    fake.downloads.failNextSetUiOptions(UI_PERMISSION_ERROR);
    const engine = await hydrated();
    land(engine, 0);
    await flush();
    expect(fake.downloads.callLog).toEqual([{ op: 'download', filename: p(0) }]);
  });

  it('handOff: a job listed as resolving makes another job’s last file hide', async () => {
    const stub = stubUi();
    seedJob('job-1', [fetching(0)]);
    seedJob('job-2', [], { phase: 'resolving', kind: 'unknown', folder: null });
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    expect(stub.events).toEqual(['hide']);
  });
});

describe('engine: the last hand-off restores the UI first (R-006)', () => {
  it('handOff: the last hand-off calls restore() and never hideForHandOff()', async () => {
    const stub = stubUi();
    seedJob('job-1', [fetching(0)]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    expect([stub.events, downloadsOf()]).toEqual([['restore'], [p(0)]]);
  });

  it('handOff: the last hand-off asks for no download while the restore is in flight', async () => {
    const stub = stubUi();
    stub.holdRestore();
    seedJob('job-1', [fetching(0)]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    expect([stub.events, fake.api.downloads.download.mock.calls.length]).toEqual([['restore'], 0]);
  });

  it('handOff: the last file is handed to Chrome once the restore has resolved', async () => {
    const stub = stubUi();
    stub.holdRestore();
    seedJob('job-1', [fetching(0)]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    stub.releaseRestore();
    await flush();
    expect(fake.downloads.callLog).toEqual([{ op: 'download', filename: p(0) }]);
  });

  it('handOff: with no other file in Chrome, the last hand-off makes no downloads.search call', async () => {
    const stub = stubUi();
    seedJob('job-1', [fetching(0)]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    expect([stub.events, fake.api.downloads.search.mock.calls]).toEqual([['restore'], []]);
  });

  it('handOff: the last two files landing together make one restore, from the second, after Chrome created and named the first', async () => {
    const stub = stubUi();
    seedJob('job-1', [fetching(0), fetching(1)]);
    const engine = await hydrated(stub.ui);
    fake.downloads.deferNaming(true);
    const atRestore: unknown[] = [];
    stub.ui.restore.mockImplementation(() => {
      atRestore.push({ downloads: downloadsOf(), first: fake.downloads.items()[0]?.filename });
      return Promise.resolve();
    });
    land(engine, 0);
    land(engine, 1);
    await flush();
    const beforeNaming = [...atRestore];
    fake.downloads.name(1);
    await flush();
    expect([beforeNaming, atRestore, stub.ui.hideForHandOff.mock.calls.length]).toEqual([
      [],
      [{ downloads: [p(0)], first: `${DOWNLOADS_DIR}/${p(0)}` }],
      1,
    ]);
  });

  it('handOff: the last two files landing together hand the second to Chrome after the restore', async () => {
    seedJob('job-1', [fetching(0), fetching(1)]);
    const engine = await hydrated();
    fake.downloads.deferNaming(true);
    land(engine, 0);
    land(engine, 1);
    await flush();
    fake.downloads.name(1);
    await flush();
    expect(fake.downloads.callLog).toEqual([
      { op: 'ui', enabled: false },
      { op: 'download', filename: p(0) },
      { op: 'ui', enabled: true },
      { op: 'download', filename: p(1) },
    ]);
  });

  it('handOff: an earlier file Chrome has not named holds the restore back', async () => {
    const stub = stubUi();
    const inChrome = await unnamedInChrome(0);
    seedJob('job-1', [inChrome, fetching(1)]);
    const engine = await hydrated(stub.ui);
    land(engine, 1);
    await vi.advanceTimersByTimeAsync(HANDOFF_TARGET_WAIT_MS - 2);
    expect([stub.events, downloadsOf()]).toEqual([[], [p(0)]]);
  });

  it('handOff: the earlier file’s filename delta lets the restore go ahead', async () => {
    const stub = stubUi();
    const inChrome = await unnamedInChrome(0);
    seedJob('job-1', [inChrome, fetching(1)]);
    const engine = await hydrated(stub.ui);
    land(engine, 1);
    await flush();
    fake.downloads.name(1);
    await flush();
    expect([stub.events, downloadsOf()]).toEqual([['restore'], [p(0), p(1)]]);
  });

  it('handOff: the earlier file leaving in_progress unnamed lets the restore go ahead', async () => {
    const stub = stubUi();
    const inChrome = await unnamedInChrome(0);
    seedJob('job-1', [inChrome, fetching(1)]);
    const engine = await hydrated(stub.ui);
    land(engine, 1);
    await flush();
    await engine.onDownloadChanged({
      id: 1,
      state: { previous: 'in_progress', current: 'complete' },
    });
    await flush();
    expect([stub.events, downloadsOf()]).toEqual([['restore'], [p(0), p(1)]]);
  });

  it(`handOff: without a name the restore goes ahead after ${HANDOFF_TARGET_WAIT_MS} ms`, async () => {
    const stub = stubUi();
    const inChrome = await unnamedInChrome(0);
    seedJob('job-1', [inChrome, fetching(1)]);
    const engine = await hydrated(stub.ui);
    land(engine, 1);
    await vi.advanceTimersByTimeAsync(HANDOFF_TARGET_WAIT_MS + 1);
    expect([stub.events, downloadsOf()]).toEqual([['restore'], [p(0), p(1)]]);
  });

  it('handOff: a downloads.search failure does not hold the restore back', async () => {
    const stub = stubUi();
    const inChrome = await unnamedInChrome(0);
    seedJob('job-1', [inChrome, fetching(1)]);
    const engine = await hydrated(stub.ui);
    fake.api.downloads.search.mockRejectedValueOnce(new Error('boom'));
    land(engine, 1);
    await flush();
    expect([stub.events, downloadsOf()]).toEqual([['restore'], [p(0), p(1)]]);
  });

  it('handOff: once Chrome named the file, the wait leaves no timer behind', async () => {
    const stub = stubUi();
    const inChrome = await unnamedInChrome(0);
    seedJob('job-1', [inChrome, fetching(1)]);
    const engine = await hydrated(stub.ui);
    land(engine, 1);
    await flush();
    const waiting = vi.getTimerCount();
    fake.downloads.name(1);
    await flush();
    expect([waiting, vi.getTimerCount(), stub.events]).toEqual([1, 0, ['restore']]);
  });

  it('handOff: a job created while the last hand-off waits makes the re-check hide instead', async () => {
    const stub = stubUi();
    const inChrome = await unnamedInChrome(0);
    seedJob('job-1', [inChrome, fetching(1)]);
    const engine = await hydrated(stub.ui);
    land(engine, 1);
    await flush();
    await engine.start(
      { mode: 'full', artworkId: '136120877', expectedFiles: 8, loggedIn: null },
      TAB_ID,
    );
    fake.downloads.name(1);
    await flush();
    expect([stub.events, downloadsOf()]).toEqual([['hide'], [p(0), p(1)]]);
  });

  it('handOff: a cancel while the restore is in flight hands nothing to Chrome and never hides', async () => {
    const stub = stubUi();
    stub.holdRestore();
    seedJob('job-1', [fetching(0)]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    void engine.cancel('job-1', TAB_ID);
    await flush();
    stub.releaseRestore();
    await flush();
    expect([
      fake.api.downloads.download.mock.calls.length,
      stub.ui.hideForHandOff.mock.calls.length,
    ]).toEqual([0, 0]);
  });
});

describe('engine: a hand-off leaves the last-hand-off decision once it is settled (R-006)', () => {
  it('handOff: after the id is stored, a later last hand-off waits for nothing', async () => {
    const stub = stubUi();
    seedJob('job-1', [fetching(0), fetching(1)]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    fake.downloads.complete(1);
    await flush();
    land(engine, 1);
    await flush();
    expect([stub.events, fake.api.downloads.search.mock.calls]).toEqual([['hide', 'restore'], []]);
  });

  it('handOff: after a download() that threw, a later hand-off can be last', async () => {
    const stub = stubUi();
    seedJob('job-1', [fetching(0), fetching(1)]);
    const engine = await hydrated(stub.ui);
    fake.downloads.failNextDownload();
    land(engine, 0);
    await flush();
    land(engine, 1);
    await flush();
    expect([stub.events, engine.registry.get('job-1')?.files.map((f) => f.state)]).toEqual([
      ['hide', 'restore'],
      ['failed', 'saving'],
    ]);
  });

  it('handOff: after a hand-off gave up (its job was cancelled), another job’s hand-off can be last', async () => {
    const stub = stubUi();
    stub.holdHide();
    seedJob('job-1', [fetching(0), page(1, {})]);
    seedJob('job-2', [page(0, { state: 'fetching', taskId: 'u0' })]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    await engine.cancel('job-1', TAB_ID);
    stub.releaseHide();
    await flush();
    landOther(engine);
    await flush();
    expect([stub.events, downloadsOf()]).toEqual([['hide', 'restore'], [p(0)]]);
  });

  it('handOff: a last hand-off decided while an earlier one is still in flight goes on once that one gives up', async () => {
    const stub = stubUi();
    stub.holdHide();
    seedJob('job-1', [fetching(0), page(1, {})]);
    seedJob('job-2', [page(0, { state: 'fetching', taskId: 'u0' })]);
    const engine = await hydrated(stub.ui);
    land(engine, 0);
    await flush();
    await engine.cancel('job-1', TAB_ID);
    // job-2's file is last, but waits for job-1's hand-off, which is still in its hide.
    landOther(engine);
    await flush();
    const waiting = [...stub.events];
    stub.releaseHide();
    await flush();
    expect([waiting, stub.events, downloadsOf()]).toEqual([['hide'], ['hide', 'restore'], [p(0)]]);
  });
});

describe('engine: finalize restores (R-005, R-006)', () => {
  it('finalize: restores once the last job ends, after its record is deleted', async () => {
    const stub = stubUi();
    seedJob('job-1', [fetching(0)]);
    const engine = await hydrated(stub.ui);
    let recordAtRestore: unknown = 'not restored';
    stub.ui.restore.mockImplementation(() => {
      recordAtRestore = fake.storage.session.snapshot()['job:job-1'];
      return Promise.resolve();
    });
    await engine.cancel('job-1', TAB_ID);
    expect([stub.ui.restore.mock.calls.length, recordAtRestore]).toEqual([1, undefined]);
  });

  it('finalize: no restore while another job still runs', async () => {
    const stub = stubUi();
    seedJob('job-1', [fetching(0)]);
    seedJob('job-2', [page(0, { state: 'fetching', taskId: 't2' })]);
    const engine = await hydrated(stub.ui);
    await engine.cancel('job-1', TAB_ID);
    expect(stub.ui.restore).not.toHaveBeenCalled();
  });

  it('finalize: the last of two jobs restores', async () => {
    const stub = stubUi();
    seedJob('job-1', [fetching(0)]);
    seedJob('job-2', [page(0, { state: 'fetching', taskId: 't2' })]);
    const engine = await hydrated(stub.ui);
    await engine.cancel('job-1', TAB_ID);
    await engine.cancel('job-2', TAB_ID);
    expect(stub.events).toEqual(['restore']);
  });

  it('finalize: after a final hand-off, Chrome gets no second restore', async () => {
    seedJob('job-1', [fetching(0)]);
    const engine = await hydrated();
    land(engine, 0);
    await flush();
    fake.downloads.complete(1);
    await vi.advanceTimersByTimeAsync(100);
    expect([engine.registry.list(), fake.downloads.callLog]).toEqual([
      [],
      [
        { op: 'ui', enabled: true },
        { op: 'download', filename: p(0) },
      ],
    ]);
  });
});

describe('engine: restoreDownloadUiIfIdle (boot)', () => {
  it('restoreDownloadUiIfIdle: restores when no job is running', async () => {
    const stub = stubUi();
    const engine = await hydrated(stub.ui);
    await engine.restoreDownloadUiIfIdle();
    expect(stub.events).toEqual(['restore']);
  });

  it('restoreDownloadUiIfIdle: leaves the UI alone while a hydrated job runs', async () => {
    const stub = stubUi();
    seedJob('job-1', [fetching(0)]);
    const engine = await hydrated(stub.ui);
    await engine.restoreDownloadUiIfIdle();
    expect(stub.events).toEqual([]);
  });

  it('restoreDownloadUiIfIdle: calls Chrome by default', async () => {
    fake.downloads.uiEnabled = false;
    const engine = await hydrated();
    await engine.restoreDownloadUiIfIdle();
    expect(fake.downloads.callLog).toEqual([{ op: 'ui', enabled: true }]);
  });
});
