// Every row of design-download-engine.md "Offscreen events → file transitions", the hand-off, and
// "Hydration and reconciliation".

import { describe, expect, it } from 'vitest';
import {
  downloadOptions,
  interruptFailure,
  onDownloadComplete,
  onDownloadInterrupted,
  onDownloadStarted,
  onHandOffFailed,
  onOffFailed,
  onOffProgress,
  onOffReady,
} from '../../../src/background/downloads';
import { reconcileJob, type ReconcileFacts } from '../../../src/background/reconcile';
import type { Effect } from '../../../src/background/registry';
import type {
  FileRole,
  FileState,
  FileTask,
  JobRecord,
  UgoiraState,
} from '../../../src/background/types';
import type { OffTaskSnapshot } from '../../../src/shared/messages';
import type { Failure } from '../../../src/shared/types';

const ID = '135882741';
const FOLDER = 'pixiv/みずき-135882741';
const BLOB = 'blob:chrome-extension://abc/1';

function file(
  idx: number,
  role: FileRole,
  state: FileState,
  extra: Partial<FileTask> = {},
): FileTask {
  return { idx, role, name: `f${idx}`, save: true, dependsOn: [], state, ...extra };
}

function page(idx: number, state: FileState, extra: Partial<FileTask> = {}): FileTask {
  return file(idx, 'page', state, { page: idx, name: `${ID}_p${idx}.jpg`, ...extra });
}

function job(files: FileTask[], extra: Partial<JobRecord> = {}): JobRecord {
  return {
    v: 1,
    jobId: 'job-1',
    artworkId: ID,
    originTabId: 7,
    createdAt: 0,
    mode: 'full',
    request: { mode: 'full', artworkId: ID, expectedFiles: 3 },
    kind: 'pages',
    phase: 'transferring',
    snapshot: {
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput: 'mp4',
      saveMetadata: true,
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
    ...extra,
  };
}

const ugoiraState = (extra: Partial<UgoiraState> = {}): UgoiraState => ({
  frames: [
    { file: '000000.jpg', delay: 40 },
    { file: '000001.jpg', delay: 40 },
    { file: '000002.jpg', delay: 500 },
    { file: '000003.jpg', delay: 40 },
  ],
  format: 'mp4',
  avcCodec: 'avc1.64001e',
  width: 600,
  height: 600,
  zipLoaded: 0,
  zipTotal: null,
  encDone: 0,
  percent: 0,
  ...extra,
});

/** zip (idx 0), frames.json (1, after the zip), video (2, after both). */
function ugoiraJob(zip: FileState, framesJson: FileState, video: FileState, zipSave = true) {
  return job(
    [
      file(0, 'zip', zip, { taskId: 'tz', save: zipSave, url: 'https://i.pximg.net/z.zip' }),
      file(1, 'framesJson', framesJson, { taskId: 'tf', dependsOn: [0] }),
      file(2, 'video', video, { taskId: 'tv', dependsOn: [0, 1] }),
    ],
    { kind: 'ugoira', ugoira: ugoiraState() },
  );
}

const ready = (taskId: string, blobUrl?: string) => ({
  target: 'sw' as const,
  type: 'off/ready' as const,
  taskId,
  ...(blobUrl === undefined ? {} : { blobUrl, size: 10 }),
});
const failed = (taskId: string, failure: Failure) => ({
  target: 'sw' as const,
  type: 'off/failed' as const,
  taskId,
  failure,
});
const types = (effects: Effect[]) => effects.map((e) => e.type);

describe('transitions: off/ready', () => {
  it('off/ready: fetching → saving with the blob URL', () => {
    const record = job([page(0, 'fetching', { taskId: 't0' })]);
    onOffReady(record, 0, ready('t0', BLOB));
    expect(record.files[0]).toMatchObject({ state: 'saving', blobUrl: BLOB });
  });

  it('off/ready: asks for the Chrome hand-off (after the record is persisted)', () => {
    const record = job([page(0, 'fetching', { taskId: 't0' })]);
    expect(onOffReady(record, 0, ready('t0', BLOB))).toEqual([{ type: 'download', idx: 0 }]);
  });

  it('off/ready: a zip fetched into memory (save: false) is done at once and the video starts', () => {
    const record = ugoiraJob('fetching', 'done', 'queued', false);
    const effects = onOffReady(record, 0, ready('tz'));
    expect([record.files[0]?.state, effects.filter((e) => e.type === 'dispatch')]).toEqual([
      'done',
      [{ type: 'dispatch', idx: 2 }],
    ]);
  });

  it('off/ready: a file to save without a blob URL fails', () => {
    const record = job([page(0, 'fetching', { taskId: 't0' })]);
    onOffReady(record, 0, ready('t0'));
    expect(record.files[0]?.state).toBe('failed');
  });

  it('off/ready: an event for a file that already failed only releases the task', () => {
    const record = job([page(0, 'failed', { taskId: 't0' })]);
    expect(onOffReady(record, 0, ready('t0', BLOB))).toEqual([
      { type: 'release', taskIds: ['t0'] },
    ]);
  });

  it('off/ready: an event for a replaced task only releases that task', () => {
    const record = job([page(0, 'fetching', { taskId: 'new' })]);
    expect([onOffReady(record, 0, ready('old', BLOB)), record.files[0]?.state]).toEqual([
      [{ type: 'release', taskIds: ['old'] }],
      'fetching',
    ]);
  });

  it('off/ready: a duplicate event for a file already saving changes nothing', () => {
    const record = job([page(0, 'saving', { taskId: 't0', blobUrl: BLOB })]);
    expect(onOffReady(record, 0, ready('t0', BLOB))).toEqual([]);
  });
});

describe('transitions: off/progress', () => {
  it('off/progress: zip bytes update the ugoira state and the percent', () => {
    const record = ugoiraJob('fetching', 'queued', 'queued');
    onOffProgress(record, 0, {
      target: 'sw',
      type: 'off/progress',
      taskId: 'tz',
      phase: 'zip',
      loaded: 50,
      total: 100,
    });
    expect(record.ugoira).toMatchObject({ zipLoaded: 50, zipTotal: 100, percent: 20 });
  });

  it('off/progress: encoded frames update the ugoira state and the percent', () => {
    const record = ugoiraJob('done', 'done', 'fetching');
    onOffProgress(record, 2, {
      target: 'sw',
      type: 'off/progress',
      taskId: 'tv',
      phase: 'encode',
      done: 2,
      total: 4,
    });
    expect(record.ugoira).toMatchObject({ encDone: 2, percent: 70 });
  });

  it('off/progress: the percent never goes down', () => {
    const record = ugoiraJob('fetching', 'queued', 'queued');
    record.ugoira = ugoiraState({ percent: 30 });
    onOffProgress(record, 0, {
      target: 'sw',
      type: 'off/progress',
      taskId: 'tz',
      phase: 'zip',
      loaded: 10,
      total: 100,
    });
    expect(record.ugoira.percent).toBe(30);
  });

  it('off/progress: asks for a throttled push', () => {
    const record = ugoiraJob('fetching', 'queued', 'queued');
    const event = {
      target: 'sw' as const,
      type: 'off/progress' as const,
      taskId: 'tz',
      phase: 'zip' as const,
      loaded: 1,
      total: null,
    };
    expect(onOffProgress(record, 0, event)).toEqual([{ type: 'push', throttle: true }]);
  });

  it('off/progress: ignored for a file that is not fetching', () => {
    const record = ugoiraJob('done', 'queued', 'queued');
    const event = {
      target: 'sw' as const,
      type: 'off/progress' as const,
      taskId: 'tz',
      phase: 'zip' as const,
      loaded: 1,
      total: 2,
    };
    expect(onOffProgress(record, 0, event)).toEqual([]);
  });
});

describe('transitions: off/failed', () => {
  const http = (status: number): Failure => ({ kind: 'http', status, attempts: 4 });

  it('off/failed: fetching → failed with the failure', () => {
    const record = job([page(0, 'fetching', { taskId: 't0' }), page(1, 'done')]);
    onOffFailed(record, 0, failed('t0', http(503)));
    expect(record.files[0]).toMatchObject({ state: 'failed', failure: http(503) });
  });

  it('off/failed: releases the task, then pumps', () => {
    const record = job([page(0, 'fetching', { taskId: 't0' }), page(1, 'queued')]);
    expect(types(onOffFailed(record, 0, failed('t0', http(503))))).toEqual([
      'release',
      'badge',
      'push',
      'dispatch',
    ]);
  });

  it('off/failed: a 403 on an original sets the forbidden stop reason', () => {
    const record = job([page(0, 'fetching', { taskId: 't0' })]);
    onOffFailed(record, 0, failed('t0', http(403)));
    expect(record.stopReason).toBe('forbidden');
  });

  it('off/failed: a 403 on the zip sets the forbidden stop reason', () => {
    const record = ugoiraJob('fetching', 'queued', 'queued');
    onOffFailed(record, 0, failed('tz', http(403)));
    expect(record.stopReason).toBe('forbidden');
  });

  it('off/failed: other failures do not stop the job', () => {
    const record = job([page(0, 'fetching', { taskId: 't0' })]);
    onOffFailed(record, 0, failed('t0', { kind: 'network', attempts: 4 }));
    expect(record.stopReason).toBeNull();
  });

  it('off/failed: an encode failure does not stop the job', () => {
    const record = ugoiraJob('done', 'done', 'fetching');
    onOffFailed(record, 2, failed('tv', { kind: 'encode', detail: 'encoder', attempts: 1 }));
    expect(record.stopReason).toBeNull();
  });

  it('off/failed: the last failure finalizes the job', () => {
    const record = job([page(0, 'fetching', { taskId: 't0' }), page(1, 'done')]);
    expect(onOffFailed(record, 0, failed('t0', http(503)))).toEqual([
      { type: 'release', taskIds: ['t0'] },
      { type: 'finalize' },
    ]);
  });
});

describe('transitions: the Chrome hand-off', () => {
  it('downloadOptions: blob URL, folder/name, uniquify, no Save As', () => {
    const p = page(0, 'saving', { blobUrl: BLOB });
    expect(downloadOptions(job([p]), p)).toEqual({
      url: BLOB,
      filename: `${FOLDER}/${ID}_p0.jpg`,
      conflictAction: 'uniquify',
      saveAs: false,
    });
  });

  it('download started: stores the download id', () => {
    const record = job([page(0, 'saving', { taskId: 't0', blobUrl: BLOB })]);
    onDownloadStarted(record, 0, 41);
    expect(record.files[0]?.downloadId).toBe(41);
  });

  it('download started: a file cancelled meanwhile cancels the new download', () => {
    const record = job([page(0, 'failed', { taskId: 't0', blobUrl: BLOB })]);
    expect(onDownloadStarted(record, 0, 41)).toEqual([
      { type: 'cancelDownload', downloadIds: [41] },
    ]);
  });

  it('download threw ("Invalid filename"): saving → failed with disk', () => {
    const record = job([page(0, 'saving', { taskId: 't0', blobUrl: BLOB }), page(1, 'done')]);
    onHandOffFailed(record, 0, BLOB, 'Invalid filename');
    expect(record.files[0]?.failure).toEqual({
      kind: 'disk',
      detail: 'Invalid filename',
      attempts: 1,
    });
  });

  it('download threw: releases the task and pumps', () => {
    const record = job([page(0, 'saving', { taskId: 't0', blobUrl: BLOB }), page(1, 'queued')]);
    expect(types(onHandOffFailed(record, 0, BLOB, 'Invalid filename'))).toEqual([
      'release',
      'badge',
      'push',
      'dispatch',
    ]);
  });
});

describe('transitions: downloads.onChanged', () => {
  it('complete: saving → done', () => {
    const record = job([page(0, 'saving', { taskId: 't0', downloadId: 41 }), page(1, 'saving')]);
    onDownloadComplete(record, 0, 41);
    expect(record.files[0]?.state).toBe('done');
  });

  it('complete: releases the task, re-renders the badge, pushes and pumps', () => {
    const record = job([page(0, 'saving', { taskId: 't0', downloadId: 41 }), page(1, 'queued')]);
    expect(types(onDownloadComplete(record, 0, 41))).toEqual([
      'release',
      'badge',
      'push',
      'dispatch',
    ]);
  });

  it('complete: the zip keeps its bytes while the video is still to be encoded', () => {
    const record = ugoiraJob('saving', 'queued', 'queued');
    expect(onDownloadComplete(record, 0, 41)[0]).toEqual({
      type: 'release',
      taskIds: ['tz'],
      keepRetained: true,
    });
  });

  it('complete: the zip is released fully when no video is pending', () => {
    const record = ugoiraJob('saving', 'done', 'failed');
    expect(onDownloadComplete(record, 0, 41)[0]).toEqual({ type: 'release', taskIds: ['tz'] });
  });

  it('complete: the last file finalizes the job', () => {
    const record = job([page(0, 'saving', { taskId: 't0', downloadId: 41 }), page(1, 'done')]);
    expect(onDownloadComplete(record, 0, 41)).toEqual([
      { type: 'release', taskIds: ['t0'] },
      { type: 'finalize' },
    ]);
  });

  it('complete: ignored for a file that is not saving', () => {
    const record = job([page(0, 'done', { downloadId: 41 })]);
    expect(onDownloadComplete(record, 0, 41)).toEqual([]);
  });

  it('complete: ignored for another download of the file', () => {
    const record = job([page(0, 'saving', { downloadId: 40 })]);
    expect(onDownloadComplete(record, 0, 41)).toEqual([]);
  });

  it('interrupted USER_CANCELED: saving → failed{dismissed}', () => {
    const record = job([page(0, 'saving', { taskId: 't0', downloadId: 41 }), page(1, 'saving')]);
    onDownloadInterrupted(record, 0, 41, 'USER_CANCELED');
    expect(record.files[0]?.failure).toEqual({
      kind: 'dismissed',
      detail: 'USER_CANCELED',
      attempts: 1,
    });
  });

  it.each(['FILE_NO_SPACE', 'FILE_ACCESS_DENIED', 'FILE_NAME_TOO_LONG', 'CRASH', 'NETWORK_FAILED'])(
    'interrupted %s: saving → failed{disk}',
    (reason) => {
      const record = job([page(0, 'saving', { downloadId: 41 }), page(1, 'saving')]);
      onDownloadInterrupted(record, 0, 41, reason);
      expect(record.files[0]?.failure?.kind).toBe('disk');
    },
  );

  it('interrupted: releases the task and pumps', () => {
    const record = job([page(0, 'saving', { taskId: 't0', downloadId: 41 }), page(1, 'queued')]);
    expect(types(onDownloadInterrupted(record, 0, 41, 'FILE_FAILED'))).toEqual([
      'release',
      'badge',
      'push',
      'dispatch',
    ]);
  });

  it('interruptFailure: no reason is a disk failure', () => {
    expect(interruptFailure(undefined)).toEqual({ kind: 'disk', attempts: 1 });
  });
});

describe('reconcile: offscreen tasks', () => {
  const facts = (
    tasks: OffTaskSnapshot[] = [],
    items: chrome.downloads.DownloadItem[] = [],
  ): ReconcileFacts => ({
    tasks: new Map(tasks.map((t) => [t.taskId, t])),
    byId: new Map(items.map((i) => [i.id, i])),
    byUrl: new Map(items.map((i) => [i.url, i])),
  });

  function item(id: number, state: chrome.downloads.DownloadItem['state'], error?: string) {
    return {
      id,
      url: BLOB,
      state,
      ...(error === undefined ? {} : { error }),
    } as chrome.downloads.DownloadItem;
  }

  it('reconcile: a fetching file whose task still runs keeps waiting', () => {
    const record = job([page(0, 'fetching', { taskId: 't0' })]);
    reconcileJob(record, facts([{ taskId: 't0', state: 'running' }]));
    expect(record.files[0]).toMatchObject({ state: 'fetching', taskId: 't0' });
  });

  it('reconcile: a fetching file whose task finished is handed to Chrome now', () => {
    const record = job([page(0, 'fetching', { taskId: 't0' })]);
    const effects = reconcileJob(record, facts([{ taskId: 't0', state: 'ready', blobUrl: BLOB }]));
    expect([record.files[0]?.state, record.files[0]?.blobUrl, effects[0]]).toEqual([
      'saving',
      BLOB,
      { type: 'download', idx: 0 },
    ]);
  });

  it('reconcile: a fetching file whose task is gone is fetched again under a new task', () => {
    const record = job([page(0, 'fetching', { taskId: 't0' })]);
    const effects = reconcileJob(record, facts());
    expect([record.files[0]?.state, record.files[0]?.taskId === 't0', types(effects)]).toEqual([
      'fetching',
      false,
      ['badge', 'push', 'dispatch'],
    ]);
  });

  it('reconcile: a zip held in memory (save: false) whose task is retained is done', () => {
    const record = ugoiraJob('fetching', 'done', 'queued', false);
    reconcileJob(record, facts([{ taskId: 'tz', state: 'retained' }]));
    expect(record.files[0]?.state).toBe('done');
  });

  it('reconcile: a saving file whose download completed is done', () => {
    const record = job([
      page(0, 'saving', { taskId: 't0', downloadId: 41 }),
      page(1, 'saving', { downloadId: 42 }),
    ]);
    reconcileJob(record, facts([], [item(41, 'complete'), item(42, 'in_progress')]));
    expect(record.files.map((f) => f.state)).toEqual(['done', 'saving']);
  });

  it('reconcile: a saving file whose download was interrupted fails', () => {
    const record = job([
      page(0, 'saving', { downloadId: 41 }),
      page(1, 'saving', { downloadId: 42 }),
    ]);
    reconcileJob(
      record,
      facts([], [item(41, 'interrupted', 'FILE_NO_SPACE'), item(42, 'in_progress')]),
    );
    expect(record.files[0]?.failure?.kind).toBe('disk');
  });

  it('reconcile: a saving file whose download Chrome no longer knows fails with disk', () => {
    const record = job([
      page(0, 'saving', { downloadId: 41 }),
      page(1, 'saving', { downloadId: 42 }),
    ]);
    reconcileJob(record, facts([], [item(42, 'in_progress')]));
    expect(record.files[0]).toMatchObject({ state: 'failed', failure: { kind: 'disk' } });
  });

  it('reconcile: a saving file without an id adopts the download Chrome has for its blob', () => {
    const record = job([
      page(0, 'saving', { blobUrl: BLOB }),
      page(1, 'saving', { downloadId: 42 }),
    ]);
    reconcileJob(record, {
      ...facts([], [item(42, 'in_progress')]),
      byUrl: new Map([[BLOB, item(41, 'in_progress')]]),
    });
    expect(record.files[0]).toMatchObject({ state: 'saving', downloadId: 41 });
  });

  it('reconcile: a saving file without a download is handed to Chrome again', () => {
    const record = job([page(0, 'saving', { taskId: 't0', blobUrl: BLOB })]);
    const effects = reconcileJob(record, facts([{ taskId: 't0', state: 'ready', blobUrl: BLOB }]));
    expect(effects[0]).toEqual({ type: 'download', idx: 0 });
  });

  it('reconcile: a saving file whose download and Blob are both gone is fetched again', () => {
    const record = job([page(0, 'saving', { taskId: 't0', blobUrl: BLOB })]);
    reconcileJob(record, facts());
    expect([record.files[0]?.state, record.files[0]?.blobUrl]).toEqual(['fetching', undefined]);
  });

  it('reconcile: a job whose files all landed finalizes', () => {
    const record = job([page(0, 'saving', { taskId: 't0', downloadId: 41 }), page(1, 'done')]);
    expect(reconcileJob(record, facts([], [item(41, 'complete')]))).toEqual([
      { type: 'release', taskIds: ['t0'] },
      { type: 'finalize' },
    ]);
  });

  it('reconcile: a job still resolving is left to the resolver', () => {
    expect(reconcileJob(job([], { phase: 'resolving' }), facts())).toEqual([]);
  });
});
