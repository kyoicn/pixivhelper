import { describe, expect, it } from 'vitest';
import { onOffFailed } from '../../../src/background/downloads';
import type { Effect } from '../../../src/background/registry';
import { cancel, commandFor, pump, settle } from '../../../src/background/scheduler';
import type {
  FileRole,
  FileState,
  FileTask,
  JobRecord,
  UgoiraState,
} from '../../../src/background/types';
import { buildMetadata, serializeJson } from '../../../src/shared/metadata';

const ID = '135882741';

function file(
  idx: number,
  role: FileRole,
  state: FileState,
  extra: Partial<FileTask> = {},
): FileTask {
  return { idx, role, name: `f${idx}`, save: true, dependsOn: [], state, ...extra };
}

function page(idx: number, state: FileState = 'queued', extra: Partial<FileTask> = {}): FileTask {
  return file(idx, 'page', state, {
    page: idx,
    name: `${ID}_p${idx}.jpg`,
    url: `https://i.pximg.net/img-original/img/${ID}_p${idx}.jpg`,
    ...extra,
  });
}

function job(files: FileTask[], extra: Partial<JobRecord> = {}): JobRecord {
  return {
    v: 1,
    jobId: 'job-1',
    artworkId: ID,
    originTabId: 7,
    createdAt: 0,
    mode: 'full',
    request: { mode: 'full', artworkId: ID, expectedFiles: files.length },
    kind: 'pages',
    phase: 'transferring',
    snapshot: {
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput: 'mp4',
      saveMetadata: true,
      effectiveFormat: null,
    },
    expectedFiles: files.length,
    metaBody: null,
    folder: 'pixiv/みずき-135882741',
    pagesTotal: files.filter((f) => f.role === 'page').length,
    pagesOffset: 0,
    files,
    ugoira: null,
    stopReason: null,
    apiFailure: null,
    ...extra,
  };
}

const pages = (n: number, state: FileState = 'queued') =>
  Array.from({ length: n }, (_, i) => page(i, state));

const dispatched = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'dispatch' ? [e.idx] : []));

const UGOIRA: UgoiraState = {
  frames: [
    { file: '000000.jpg', delay: 40 },
    { file: '000001.jpg', delay: 500 },
  ],
  format: 'mp4',
  avcCodec: 'avc1.64001e',
  width: 600,
  height: 600,
  zipLoaded: 0,
  zipTotal: null,
  encDone: 0,
  percent: 0,
};

function ugoiraFiles(zip: FileState, framesJson: FileState = 'queued'): FileTask[] {
  return [
    file(0, 'zip', zip, {
      url: 'https://i.pximg.net/z.zip',
      ...(zip === 'queued' ? {} : { taskId: 'zip-task' }),
    }),
    file(1, 'framesJson', framesJson, { dependsOn: [0], name: 'frames.json' }),
    file(2, 'video', 'queued', { dependsOn: [0, 1], name: `${ID}.mp4` }),
  ];
}

describe('scheduler: pump', () => {
  it('pump: starts at most 5 files of a job', () => {
    expect(dispatched(pump(job(pages(12))))).toHaveLength(5);
  });

  it('pump: counts fetching, ready and saving files against the cap', () => {
    const files = [
      page(0, 'fetching'),
      page(1, 'ready'),
      page(2, 'saving'),
      page(3, 'fetching'),
      page(4),
      page(5),
    ];
    expect(dispatched(pump(job(files)))).toEqual([4]);
  });

  it('pump: done, failed and skipped files free their slot', () => {
    const files = [page(0, 'done'), page(1, 'failed'), page(2, 'skipped'), ...pages(8).slice(3)];
    expect(dispatched(pump(job(files)))).toEqual([3, 4, 5, 6, 7]);
  });

  it('pump: starts files in ascending idx whatever their order in the record', () => {
    const files = [page(3), page(1), page(0), page(2)];
    expect(dispatched(pump(job(files)))).toEqual([0, 1, 2, 3]);
  });

  it('pump: moves started files to fetching with a task id', () => {
    const record = job(pages(1));
    pump(record);
    expect([record.files[0]?.state, typeof record.files[0]?.taskId]).toEqual([
      'fetching',
      'string',
    ]);
  });

  it('pump: gives every started file its own task id', () => {
    const record = job(pages(5));
    pump(record);
    expect(new Set(record.files.map((f) => f.taskId)).size).toBe(5);
  });

  it('pump: does nothing while the job is resolving', () => {
    expect(pump(job(pages(3), { phase: 'resolving' }))).toEqual([]);
  });

  it('pump: a file waits while a dependency is still running', () => {
    const record = job(ugoiraFiles('fetching'), { kind: 'ugoira', ugoira: UGOIRA });
    pump(record);
    expect(record.files.map((f) => f.state)).toEqual(['fetching', 'queued', 'queued']);
  });

  it('pump: a file starts once its dependencies are done', () => {
    const record = job(ugoiraFiles('done'), { kind: 'ugoira', ugoira: UGOIRA });
    expect(dispatched(pump(record))).toEqual([1]);
  });

  it('pump: the video starts after both the zip and frames.json are done', () => {
    const record = job(ugoiraFiles('done', 'done'), { kind: 'ugoira', ugoira: UGOIRA });
    expect(dispatched(pump(record))).toEqual([2]);
  });

  it('pump: a file whose dependency failed is skipped, and so are its dependents', () => {
    const record = job(ugoiraFiles('failed'), { kind: 'ugoira', ugoira: UGOIRA });
    pump(record);
    expect(record.files.map((f) => f.state)).toEqual(['failed', 'skipped', 'skipped']);
  });

  it('pump: keeps scanning past a file that waits on a dependency', () => {
    const files = [...ugoiraFiles('fetching'), page(3)];
    expect(dispatched(pump(job(files, { kind: 'ugoira', ugoira: UGOIRA })))).toEqual([3]);
  });

  it('pump: with a stop reason, skips every queued file and starts none', () => {
    const record = job([page(0, 'fetching'), page(1), page(2)], { stopReason: 'forbidden' });
    expect([dispatched(pump(record)), record.files.map((f) => f.state)]).toEqual([
      [],
      ['fetching', 'skipped', 'skipped'],
    ]);
  });

  it('pump: finalizes when no file is queued or in flight', () => {
    expect(pump(job([page(0, 'done'), page(1, 'failed')]))).toEqual([{ type: 'finalize' }]);
  });

  it('pump: does not finalize while a file is in flight', () => {
    expect(pump(job([page(0, 'done'), page(1, 'saving')]))).toEqual([]);
  });

  it('pump: finalizes once a stop reason has skipped the rest', () => {
    expect(pump(job([page(0, 'failed'), page(1)], { stopReason: 'forbidden' }))).toEqual([
      { type: 'finalize' },
    ]);
  });

  it('pump: builds metadata.json at dispatch and drops the illust body', () => {
    const body = { illustId: ID, illustTitle: '雨上がりの渋谷', userName: 'みずき' };
    const record = job([file(0, 'metadata', 'queued', { name: 'metadata.json' })], {
      metaBody: body,
    });
    pump(record);
    expect([record.files[0]?.text, record.metaBody]).toEqual([
      serializeJson(buildMetadata(body, ID)),
      null,
    ]);
  });

  it('pump: a re-queued metadata.json keeps the text built at its first dispatch', () => {
    const record = job([file(0, 'metadata', 'queued', { text: '{"kept":true}' })]);
    pump(record);
    expect(record.files[0]?.text).toBe('{"kept":true}');
  });
});

describe('scheduler: a 403 stops the job', () => {
  it('scheduler: a 403 on an original stops new dispatches; in-flight files finish', () => {
    const files = [
      page(0, 'fetching', { taskId: 't0' }),
      page(1, 'fetching'),
      ...pages(5).slice(2),
    ];
    const record = job(files);
    const effects = onOffFailed(record, 0, {
      target: 'sw',
      type: 'off/failed',
      taskId: 't0',
      failure: { kind: 'http', status: 403, attempts: 1 },
    });
    expect([dispatched(effects), record.files.map((f) => f.state)]).toEqual([
      [],
      ['failed', 'fetching', 'skipped', 'skipped', 'skipped'],
    ]);
  });
});

describe('scheduler: settle', () => {
  it('settle: leading effects first, then badge and push, then dispatches', () => {
    const record = job(pages(1));
    const release: Effect = { type: 'release', taskIds: ['old'] };
    expect(settle(record, [release]).map((e) => e.type)).toEqual([
      'release',
      'badge',
      'push',
      'dispatch',
    ]);
  });

  it('settle: a finished job gets finalize instead of badge and push', () => {
    expect(settle(job([page(0, 'done')]))).toEqual([{ type: 'finalize' }]);
  });
});

describe('scheduler: commandFor', () => {
  it('commandFor: a page is fetched as bytes from its original URL', () => {
    const p = page(0, 'fetching', { taskId: 't0' });
    expect(commandFor(job([p]), p)).toEqual({
      type: 'off/fetchBytes',
      taskId: 't0',
      url: `https://i.pximg.net/img-original/img/${ID}_p0.jpg`,
    });
  });

  it('commandFor: metadata.json is made from its built text', () => {
    const m = file(0, 'metadata', 'fetching', { taskId: 't0', text: '{}' });
    expect(commandFor(job([m]), m)).toEqual({
      type: 'off/makeText',
      taskId: 't0',
      text: '{}',
      mime: 'application/json',
    });
  });

  it('commandFor: frames.json is the frames as pixiv sent them', () => {
    const record = job(ugoiraFiles('done', 'fetching'), { kind: 'ugoira', ugoira: UGOIRA });
    const framesJson = record.files[1] as FileTask;
    framesJson.taskId = 't1';
    expect(commandFor(record, framesJson)).toEqual({
      type: 'off/makeText',
      taskId: 't1',
      text: serializeJson(UGOIRA.frames),
      mime: 'application/json',
    });
  });

  it('commandFor: the zip is fetched with its save flag', () => {
    const zip = file(0, 'zip', 'fetching', {
      taskId: 't0',
      url: 'https://i.pximg.net/z.zip',
      save: false,
    });
    expect(commandFor(job([zip]), zip)).toEqual({
      type: 'off/fetchZip',
      taskId: 't0',
      url: 'https://i.pximg.net/z.zip',
      save: false,
    });
  });

  it('commandFor: the video encodes the retained zip with the job’s format and codec', () => {
    const record = job(ugoiraFiles('done', 'done'), { kind: 'ugoira', ugoira: UGOIRA });
    const video = record.files[2] as FileTask;
    video.taskId = 't2';
    expect(commandFor(record, video)).toEqual({
      type: 'off/encode',
      taskId: 't2',
      zipTaskId: 'zip-task',
      frames: UGOIRA.frames,
      format: 'mp4',
      avcCodec: 'avc1.64001e',
      artworkId: ID,
    });
  });
});

describe('scheduler: cancel', () => {
  function running(): JobRecord {
    return job([
      page(0, 'done', { taskId: 't0', downloadId: 1 }),
      page(1, 'saving', { taskId: 't1', downloadId: 2 }),
      page(2, 'saving', { taskId: 't2' }),
      page(3, 'fetching', { taskId: 't3' }),
      page(4, 'ready', { taskId: 't4' }),
      page(5),
    ]);
  }

  it('cancel: sets the stop reason', () => {
    const record = running();
    cancel(record);
    expect(record.stopReason).toBe('cancelled');
  });

  it('cancel: skips queued files, aborts in-flight ones and keeps landed ones', () => {
    const record = running();
    cancel(record);
    expect(record.files.map((f) => f.state)).toEqual([
      'done',
      'failed',
      'failed',
      'failed',
      'failed',
      'skipped',
    ]);
  });

  it('cancel: in-flight files fail as aborted', () => {
    const record = running();
    cancel(record);
    expect(record.files[3]?.failure).toEqual({ kind: 'aborted', attempts: 0 });
  });

  it('cancel: aborts offscreen tasks, cancels Chrome downloads, then finalizes', () => {
    expect(cancel(running())).toEqual([
      { type: 'abort', taskIds: ['t3', 't4'] },
      { type: 'cancelDownload', downloadIds: [2] },
      { type: 'finalize' },
    ]);
  });

  it('cancel: a job still resolving just finalizes', () => {
    expect(cancel(job([], { phase: 'resolving' }))).toEqual([{ type: 'finalize' }]);
  });
});
