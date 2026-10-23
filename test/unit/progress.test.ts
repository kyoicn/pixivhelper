import { describe, expect, it } from 'vitest';
import type { FileRole, FileState, FileTask, JobRecord, UgoiraState } from '../../src/shared/job';
import {
  jobProgress,
  pagesProgress,
  ugoiraPercent,
  ugoiraProgress,
} from '../../src/shared/progress';
import type { UgoiraOutput } from '../../src/shared/types';

function file(
  idx: number,
  role: FileRole,
  state: FileState,
  extra: Partial<FileTask> = {},
): FileTask {
  return { idx, role, name: `file${idx}`, save: true, dependsOn: [], state, ...extra };
}

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    v: 1,
    jobId: 'job-1',
    artworkId: '135882741',
    originTabId: 7,
    createdAt: 0,
    mode: 'full',
    request: { mode: 'full', artworkId: '135882741', expectedFiles: 12, loggedIn: null },
    kind: 'pages',
    phase: 'transferring',
    snapshot: {
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput: 'mp4',
      saveMetadata: true,
      effectiveFormat: null,
    },
    expectedFiles: 12,
    metaBody: null,
    folder: 'pixiv/みずき-135882741',
    pagesTotal: 12,
    pagesOffset: 0,
    files: [],
    ugoira: null,
    stopReason: null,
    apiFailure: null,
    ...overrides,
  };
}

interface UgoiraStates {
  metadata?: FileState;
  zip?: FileState;
  framesJson?: FileState;
  video?: FileState;
}

/** A 10-frame ugoira job; files default to queued. */
function ugoiraJob(
  states: UgoiraStates = {},
  counters: Partial<UgoiraState> = {},
  format: UgoiraOutput = 'mp4',
): JobRecord {
  const files = [
    file(0, 'metadata', states.metadata ?? 'queued'),
    file(1, 'zip', states.zip ?? 'queued'),
    file(2, 'framesJson', states.framesJson ?? 'queued', { dependsOn: [1] }),
  ];
  if (format !== 'zip') {
    files.push(file(3, 'video', states.video ?? 'queued', { dependsOn: [1, 2] }));
  }
  return job({
    kind: 'ugoira',
    pagesTotal: 1,
    files,
    ugoira: {
      frames: Array.from({ length: 10 }, (_, i) => ({ file: `00000${i}.jpg`, delay: 100 })),
      format,
      avcCodec: format === 'mp4' ? 'avc1.64001e' : null,
      width: 600,
      height: 600,
      zipLoaded: 0,
      zipTotal: null,
      encDone: 0,
      percent: 0,
      ...counters,
    },
  });
}

const ZIP_PHASE: UgoiraStates = { metadata: 'done', zip: 'fetching' };
const ENCODING: UgoiraStates = {
  metadata: 'done',
  zip: 'done',
  framesJson: 'done',
  video: 'fetching',
};

describe('pagesProgress', () => {
  it('pagesProgress: counts landed pages, not metadata.json', () => {
    const files = [
      file(0, 'metadata', 'done'),
      ...Array.from({ length: 12 }, (_, page) =>
        file(page + 1, 'page', page < 7 ? 'done' : 'saving', { page }),
      ),
    ];
    expect(pagesProgress(job({ files }))).toEqual({ kind: 'pages', done: 7, total: 12 });
  });

  it('pagesProgress: a retryPages run continues from the pages saved earlier', () => {
    const files = [file(0, 'page', 'done', { page: 4 }), file(1, 'page', 'fetching', { page: 9 })];
    expect(pagesProgress(job({ mode: 'retryPages', pagesOffset: 10, files }))).toEqual({
      kind: 'pages',
      done: 11,
      total: 12,
    });
  });
});

describe('ugoiraPercent', () => {
  it('ugoiraPercent: the zip maps to 0–40 by bytes', () => {
    expect(ugoiraPercent(ugoiraJob(ZIP_PHASE, { zipLoaded: 500, zipTotal: 1000 }))).toBe(20);
  });

  it('ugoiraPercent: rounds down', () => {
    expect(ugoiraPercent(ugoiraJob(ZIP_PHASE, { zipLoaded: 999, zipTotal: 1000 }))).toBe(39);
  });

  it('ugoiraPercent: with ZIP only, the zip maps to 0–100', () => {
    const zipOnly = ugoiraJob(ZIP_PHASE, { zipLoaded: 500, zipTotal: 1000 }, 'zip');
    expect(ugoiraPercent(zipOnly)).toBe(50);
  });

  it('ugoiraPercent: with ZIP only, a fully fetched zip that has not landed stays at 99', () => {
    const zipOnly = ugoiraJob(ZIP_PHASE, { zipLoaded: 1000, zipTotal: 1000 }, 'zip');
    expect(ugoiraPercent(zipOnly)).toBe(99);
  });

  it('ugoiraPercent: the encode maps to 40 + floor(60 · done / total)', () => {
    expect(ugoiraPercent(ugoiraJob(ENCODING, { zipTotal: 1000, encDone: 3 }))).toBe(58);
  });

  it('ugoiraPercent: the encode starts at 40', () => {
    expect(ugoiraPercent(ugoiraJob(ENCODING, { zipTotal: 1000, encDone: 0 }))).toBe(40);
  });

  it('ugoiraPercent: every frame encoded but the video not landed stays at 99', () => {
    const saving = { ...ENCODING, video: 'saving' as const };
    expect(ugoiraPercent(ugoiraJob(saving, { zipTotal: 1000, encDone: 10 }))).toBe(99);
  });

  it('ugoiraPercent: 100 once every file has landed', () => {
    const all = { metadata: 'done', zip: 'done', framesJson: 'done', video: 'done' } as const;
    expect(ugoiraPercent(ugoiraJob(all, { zipTotal: 1000, encDone: 10 }))).toBe(100);
  });

  it('ugoiraPercent: never drops below the last emitted percent', () => {
    expect(ugoiraPercent(ugoiraJob(ZIP_PHASE, { zipLoaded: 0, zipTotal: 1000, percent: 30 }))).toBe(
      30,
    );
  });

  it('ugoiraPercent: holds at 0 while the zip size is unknown', () => {
    expect(ugoiraPercent(ugoiraJob(ZIP_PHASE, { zipLoaded: 4096, zipTotal: null }))).toBe(0);
  });

  it('ugoiraPercent: is monotonic and below 100 until the end, across a whole job', () => {
    const run = ugoiraJob();
    const u = run.ugoira as UgoiraState;
    const byIdx = (idx: number) => run.files[idx] as FileTask;
    const seen: number[] = [];
    const emit = () => {
      u.percent = ugoiraPercent(run);
      seen.push(u.percent);
    };
    byIdx(0).state = 'fetching';
    emit();
    byIdx(1).state = 'fetching';
    emit();
    for (const loaded of [0, 250, 600, 1000]) {
      u.zipLoaded = loaded;
      u.zipTotal = 1000;
      emit();
    }
    byIdx(0).state = 'done';
    byIdx(1).state = 'done';
    byIdx(2).state = 'fetching';
    emit();
    byIdx(2).state = 'done';
    byIdx(3).state = 'fetching';
    emit();
    for (let done = 1; done <= 10; done++) {
      u.encDone = done;
      emit();
    }
    byIdx(3).state = 'saving';
    emit();
    const beforeEnd = [...seen];
    byIdx(3).state = 'done';
    emit();
    expect({
      monotonic: seen.every((p, i) => i === 0 || p >= (seen[i - 1] as number)),
      maxBeforeEnd: Math.max(...beforeEnd),
      last: seen.at(-1),
    }).toEqual({ monotonic: true, maxBeforeEnd: 99, last: 100 });
  });
});

describe('ugoiraProgress', () => {
  it('ugoiraProgress: indeterminate in the zip phase while the zip size is unknown', () => {
    expect(ugoiraProgress(ugoiraJob(ZIP_PHASE, { zipLoaded: 4096 }))).toEqual({
      kind: 'percent',
      percent: 0,
      phase: 'frames',
      indeterminate: true,
    });
  });

  it('ugoiraProgress: determinate once the zip size is known', () => {
    const known = ugoiraJob(ZIP_PHASE, { zipLoaded: 500, zipTotal: 1000 });
    expect(ugoiraProgress(known)).toMatchObject({ indeterminate: false, percent: 20 });
  });

  it('ugoiraProgress: the encode phase is determinate even without a zip size', () => {
    expect(ugoiraProgress(ugoiraJob(ENCODING, { encDone: 5 }))).toEqual({
      kind: 'percent',
      percent: 70,
      phase: 'encode',
      indeterminate: false,
    });
  });
});

describe('jobProgress', () => {
  it('jobProgress: null while resolving', () => {
    expect(jobProgress(job({ phase: 'resolving' }))).toBeNull();
  });

  it('jobProgress: null for a job whose work type never resolved', () => {
    expect(jobProgress(job({ phase: 'ended', kind: 'unknown' }))).toBeNull();
  });

  it('jobProgress: pages progress for an illustration job', () => {
    expect(jobProgress(job({ pagesOffset: 2 }))).toEqual({ kind: 'pages', done: 2, total: 12 });
  });

  it('jobProgress: percent progress for an ugoira job', () => {
    expect(jobProgress(ugoiraJob(ZIP_PHASE, { zipLoaded: 500, zipTotal: 1000 }))).toMatchObject({
      kind: 'percent',
      percent: 20,
    });
  });
});
