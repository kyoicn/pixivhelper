// The engine's three download-UI call sites (design-download-engine.md "Chrome's download UI
// (download-ui.ts, R-005)"): every hand-off waits for the hide and re-checks the job, finalize
// restores once no job is left, and restoreDownloadUiIfIdle() (boot) restores only with no job.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadUi } from '../../../src/background/download-ui';
import { createEngine, type Engine } from '../../../src/background/engine';
import type { FileTask, JobRecord } from '../../../src/shared/job';
import { UI_PERMISSION_ERROR, installChromeFake, type ChromeFake } from '../../fakes/chrome';

const ID = '135882741';
const FOLDER = 'pixiv/みずき-135882741';
const BLOB = 'blob:chrome-extension://abcdefghijklmnopabcdefghijklmnop/1';
const TAB_ID = 7;

let fake: ChromeFake;

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

/** A running pages job, as storage.session holds it, for engine.hydrate(). */
function seedJob(jobId: string, files: FileTask[]): void {
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
  };
  fake.storage.session.seed({ [`job:${jobId}`]: job });
}

/** A DownloadUi whose hide can be held in flight; `events` records the calls in order. */
function stubUi() {
  const events: string[] = [];
  let hide: Promise<void> = Promise.resolve();
  let releaseHide: () => void = () => undefined;
  const ui = {
    hideForHandOff: vi.fn(() => {
      events.push('hide');
      return hide;
    }),
    restore: vi.fn(() => {
      events.push('restore');
      return Promise.resolve();
    }),
  } satisfies DownloadUi;
  return {
    ui,
    events,
    holdHide(): void {
      hide = new Promise<void>((resolve) => (releaseHide = resolve));
    },
    releaseHide: () => releaseHide(),
  };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1);
}

/** off/ready for page 0's task: the file goes `saving`, and its hand-off starts. */
function landPage0(engine: Engine): void {
  void engine.onOffscreenEvent({
    target: 'sw',
    type: 'off/ready',
    taskId: 't0',
    blobUrl: BLOB,
    size: 10,
  });
}

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

describe('engine: hand-off (R-005)', () => {
  it('handOff: no download is asked for while the hide is in flight', async () => {
    const stub = stubUi();
    stub.holdHide();
    seedJob('job-1', [page(0, { state: 'fetching', taskId: 't0' })]);
    const engine = createEngine(stub.ui);
    await engine.hydrate();
    landPage0(engine);
    await flush();
    expect([stub.events, fake.api.downloads.download.mock.calls.length]).toEqual([['hide'], 0]);
  });

  it('handOff: the download follows once the hide has resolved', async () => {
    const stub = stubUi();
    stub.holdHide();
    seedJob('job-1', [page(0, { state: 'fetching', taskId: 't0' })]);
    const engine = createEngine(stub.ui);
    await engine.hydrate();
    landPage0(engine);
    await flush();
    stub.releaseHide();
    await flush();
    expect(fake.downloads.callLog).toEqual([
      { op: 'download', filename: `${FOLDER}/${ID}_p0.jpg` },
    ]);
  });

  it('handOff: a job cancelled while the hide was in flight hands nothing to Chrome', async () => {
    const stub = stubUi();
    stub.holdHide();
    seedJob('job-1', [page(0, { state: 'fetching', taskId: 't0' }), page(1, {})]);
    const engine = createEngine(stub.ui);
    await engine.hydrate();
    landPage0(engine);
    await flush();
    await engine.cancel('job-1', TAB_ID);
    stub.releaseHide();
    await flush();
    expect(fake.api.downloads.download).not.toHaveBeenCalled();
  });

  it('handOff: a cancel whose final push is still pending also hands nothing to Chrome', async () => {
    const stub = stubUi();
    stub.holdHide();
    seedJob('job-1', [page(0, { state: 'fetching', taskId: 't0' }), page(1, {})]);
    const engine = createEngine(stub.ui);
    await engine.hydrate();
    landPage0(engine);
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
    seedJob('job-1', [page(0, { state: 'fetching', taskId: 't0' })]);
    fake.downloads.failNextSetUiOptions(UI_PERMISSION_ERROR);
    const engine = createEngine();
    await engine.hydrate();
    landPage0(engine);
    await flush();
    expect(fake.downloads.callLog).toEqual([
      { op: 'download', filename: `${FOLDER}/${ID}_p0.jpg` },
    ]);
  });
});

describe('engine: finalize restores (R-005)', () => {
  it('finalize: restores once the last job ends, after its record is deleted', async () => {
    const stub = stubUi();
    seedJob('job-1', [page(0, { state: 'fetching', taskId: 't0' })]);
    const engine = createEngine(stub.ui);
    await engine.hydrate();
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
    seedJob('job-1', [page(0, { state: 'fetching', taskId: 't0' })]);
    seedJob('job-2', [page(0, { state: 'fetching', taskId: 't2' })]);
    const engine = createEngine(stub.ui);
    await engine.hydrate();
    await engine.cancel('job-1', TAB_ID);
    expect(stub.ui.restore).not.toHaveBeenCalled();
  });

  it('finalize: the last of two jobs restores', async () => {
    const stub = stubUi();
    seedJob('job-1', [page(0, { state: 'fetching', taskId: 't0' })]);
    seedJob('job-2', [page(0, { state: 'fetching', taskId: 't2' })]);
    const engine = createEngine(stub.ui);
    await engine.hydrate();
    await engine.cancel('job-1', TAB_ID);
    await engine.cancel('job-2', TAB_ID);
    expect(stub.events).toEqual(['restore']);
  });
});

describe('engine: restoreDownloadUiIfIdle (boot)', () => {
  it('restoreDownloadUiIfIdle: restores when no job is running', async () => {
    const stub = stubUi();
    const engine = createEngine(stub.ui);
    await engine.hydrate();
    await engine.restoreDownloadUiIfIdle();
    expect(stub.events).toEqual(['restore']);
  });

  it('restoreDownloadUiIfIdle: leaves the UI alone while a hydrated job runs', async () => {
    const stub = stubUi();
    seedJob('job-1', [page(0, { state: 'fetching', taskId: 't0' })]);
    const engine = createEngine(stub.ui);
    await engine.hydrate();
    await engine.restoreDownloadUiIfIdle();
    expect(stub.events).toEqual([]);
  });

  it('restoreDownloadUiIfIdle: calls Chrome by default', async () => {
    fake.downloads.uiEnabled = false;
    const engine = createEngine();
    await engine.hydrate();
    await engine.restoreDownloadUiIfIdle();
    expect(fake.downloads.callLog).toEqual([{ op: 'ui', enabled: true }]);
  });
});
