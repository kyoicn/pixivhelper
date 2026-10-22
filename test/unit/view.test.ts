import { describe, expect, it } from 'vitest';
import type { FileRole, FileState, FileTask, JobRecord } from '../../src/background/types';
import { toView } from '../../src/background/view';

function file(
  idx: number,
  role: FileRole,
  state: FileState,
  extra: Partial<FileTask> = {},
): FileTask {
  return { idx, role, name: `file${idx}`, save: true, dependsOn: [], state, ...extra };
}

/** A full 12-page job that is still resolving. */
function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    v: 1,
    jobId: 'job-1',
    artworkId: '135882741',
    originTabId: 7,
    createdAt: 0,
    mode: 'full',
    request: { mode: 'full', artworkId: '135882741', expectedFiles: 12 },
    kind: 'unknown',
    phase: 'resolving',
    snapshot: {
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput: 'mp4',
      saveMetadata: true,
      effectiveFormat: null,
    },
    expectedFiles: 12,
    metaBody: null,
    folder: null,
    pagesTotal: 0,
    pagesOffset: 0,
    files: [],
    ugoira: null,
    stopReason: null,
    apiFailure: null,
    ...overrides,
  };
}

const transferring: Partial<JobRecord> = {
  kind: 'pages',
  phase: 'transferring',
  folder: 'pixiv/みずき-135882741',
  pagesTotal: 12,
  files: Array.from({ length: 12 }, (_, page) =>
    file(page, 'page', page < 7 ? 'done' : 'fetching', { page }),
  ),
};

describe('toView', () => {
  it('toView: a resolving job is running with unknown kind and no progress', () => {
    expect(toView(job(), null)).toEqual({
      jobId: 'job-1',
      artworkId: '135882741',
      kind: 'unknown',
      status: 'running',
      progress: null,
      format: null,
      folder: null,
      outcome: null,
    });
  });

  it('toView: a transferring pages job carries k / N progress and its folder', () => {
    expect(toView(job(transferring), null)).toMatchObject({
      kind: 'pages',
      status: 'running',
      progress: { kind: 'pages', done: 7, total: 12 },
      format: null,
      folder: 'pixiv/みずき-135882741',
    });
  });

  it('toView: an ugoira job carries its effective format and percent progress', () => {
    const ugoira = job({
      artworkId: '136004512',
      kind: 'ugoira',
      phase: 'transferring',
      folder: 'pixiv/ヨル-136004512',
      pagesTotal: 1,
      files: [file(0, 'zip', 'fetching'), file(1, 'video', 'queued', { dependsOn: [0] })],
      ugoira: {
        frames: [{ file: '000000.jpg', delay: 100 }],
        format: 'webm',
        avcCodec: null,
        width: 600,
        height: 600,
        zipLoaded: 300,
        zipTotal: 1000,
        encDone: 0,
        percent: 0,
      },
    });
    expect(toView(ugoira, null)).toMatchObject({
      kind: 'ugoira',
      format: 'webm',
      progress: { kind: 'percent', percent: 12, phase: 'frames', indeterminate: false },
    });
  });

  it('toView: an ended job carries its outcome', () => {
    const outcome = { type: 'saved', folder: 'pixiv/みずき-135882741', pages: 12 } as const;
    expect(toView(job({ ...transferring, phase: 'ended' }), outcome)).toMatchObject({
      status: 'ended',
      outcome,
    });
  });

  it('toView: a job that ended while resolving has no progress', () => {
    expect(toView(job({ phase: 'ended' }), { type: 'unavailable' })).toMatchObject({
      status: 'ended',
      progress: null,
      outcome: { type: 'unavailable' },
    });
  });
});
