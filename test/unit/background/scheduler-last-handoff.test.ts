// design-download-engine.md "The last hand-off (R-006)": which files will still be handed to Chrome
// (awaitsHandOff, the state table) and when a hand-off is the busy period's last (isLastHandOff,
// the rule and its examples table). Pure: plain records, no engine.

import { describe, expect, it } from 'vitest';
import { awaitsHandOff, handOffKey, isLastHandOff } from '../../../src/background/scheduler';
import type { FileRole, FileState, FileTask, JobRecord } from '../../../src/shared/job';

const ID = '135882741';
const UGOIRA_ID = '136004512';
const ALL_STATES: FileState[] = [
  'queued',
  'fetching',
  'ready',
  'saving',
  'done',
  'failed',
  'skipped',
];

function file(
  idx: number,
  role: FileRole,
  state: FileState,
  extra: Partial<FileTask> = {},
): FileTask {
  return { idx, role, name: `f${idx}`, save: true, dependsOn: [], state, ...extra };
}

/** A page whose download is in Chrome (`saving` with an id). */
const inChrome = (idx: number): FileTask => file(idx, 'page', 'saving', { downloadId: 100 + idx });
/** A page past `off/ready` whose `download()` has not been issued (no id yet). */
const unclaimed = (idx: number): FileTask =>
  file(idx, 'page', 'saving', { blobUrl: `blob:${idx}` });

function job(jobId: string, files: FileTask[], extra: Partial<JobRecord> = {}): JobRecord {
  return {
    v: 1,
    jobId,
    artworkId: ID,
    originTabId: 7,
    createdAt: 0,
    mode: 'full',
    request: { mode: 'full', artworkId: ID, expectedFiles: files.length, loggedIn: null },
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

function resolving(jobId: string, extra: Partial<JobRecord> = {}): JobRecord {
  return job(jobId, [], { phase: 'resolving', kind: 'unknown', folder: null, ...extra });
}

/** metadata.json (idx 0) and pages p0…p(n-1) (idx 1…n), each in `states[idx]`. */
function pagesJob(jobId: string, states: FileState[]): JobRecord {
  return job(
    jobId,
    states.map((state, idx) =>
      idx === 0
        ? file(0, 'metadata', state)
        : file(idx, 'page', state, { page: idx - 1, name: `${ID}_p${idx - 1}.jpg` }),
    ),
  );
}

/** An ugoira plan: metadata.json, the zip, frames.json (needs the zip), the video (needs both). */
function ugoiraJob(states: FileState[], extra: Partial<JobRecord> = {}): JobRecord {
  const roles: FileRole[] = ['metadata', 'zip', 'framesJson', 'video'];
  const deps = [[], [], [1], [1, 2]];
  return job(
    'ugoira',
    states.map((state, idx) =>
      file(idx, roles[idx] ?? 'video', state, { dependsOn: deps[idx] ?? [] }),
    ),
    { artworkId: UGOIRA_ID, kind: 'ugoira', ...extra },
  );
}

const self = (jobId: string, idx: number) => ({ jobId, idx });
const none = new Set<string>();

describe('handOffKey', () => {
  it('handOffKey: the job id and the file index joined by #', () => {
    expect(handOffKey('job-1', 12)).toBe('job-1#12');
  });
});

describe('awaitsHandOff: the state table', () => {
  it.each([
    ['queued', true],
    ['fetching', true],
    ['ready', true],
    ['done', false],
    ['failed', false],
    ['skipped', false],
  ] as const)('awaitsHandOff: a file to save that is %s → %s', (state, expected) => {
    expect(awaitsHandOff(file(0, 'page', state), false)).toBe(expected);
  });

  it('awaitsHandOff: saving with a downloadId → false (Chrome has it)', () => {
    expect(awaitsHandOff(inChrome(0), false)).toBe(false);
  });

  it('awaitsHandOff: saving with a downloadId and decided → false', () => {
    expect(awaitsHandOff(inChrome(0), true)).toBe(false);
  });

  it('awaitsHandOff: saving without a downloadId, not decided → true (its download effect has not run)', () => {
    expect(awaitsHandOff(unclaimed(0), false)).toBe(true);
  });

  it('awaitsHandOff: saving without a downloadId, decided → false (its download() follows)', () => {
    expect(awaitsHandOff(unclaimed(0), true)).toBe(false);
  });

  it.each(ALL_STATES)(
    'awaitsHandOff: a file never saved (save: false) that is %s → false',
    (state) => {
      expect(awaitsHandOff(file(0, 'zip', state, { save: false }), false)).toBe(false);
    },
  );

  it('awaitsHandOff: a file never saved, saving without an id and not decided → false', () => {
    expect(awaitsHandOff(file(0, 'zip', 'saving', { save: false }), false)).toBe(false);
  });
});

describe('isLastHandOff: the rule', () => {
  it('isLastHandOff: the file itself is ignored, whatever its state', () => {
    const jobs = [job('a', [unclaimed(0)])];
    expect(isLastHandOff(jobs, self('a', 0), none)).toBe(true);
  });

  it('isLastHandOff: the same idx in another job is not the file itself', () => {
    const jobs = [job('a', [unclaimed(0)]), job('b', [unclaimed(0)])];
    expect(isLastHandOff(jobs, self('a', 0), none)).toBe(false);
  });

  it('isLastHandOff: another file of the job still fetching blocks', () => {
    const jobs = [job('a', [unclaimed(0), file(1, 'page', 'fetching')])];
    expect(isLastHandOff(jobs, self('a', 0), none)).toBe(false);
  });

  it('isLastHandOff: a job still resolving blocks', () => {
    const jobs = [job('a', [unclaimed(0)]), resolving('b')];
    expect(isLastHandOff(jobs, self('a', 0), none)).toBe(false);
  });

  it('isLastHandOff: a resolving job with a stop reason (cancelled) does not block', () => {
    const jobs = [job('a', [unclaimed(0)]), resolving('b', { stopReason: 'cancelled' })];
    expect(isLastHandOff(jobs, self('a', 0), none)).toBe(true);
  });

  it('isLastHandOff: a resolving job with an API failure does not block', () => {
    const apiFailure = {
      endpoint: 'illust' as const,
      failure: { kind: 'http' as const, status: 404, attempts: 1 },
    };
    const jobs = [job('a', [unclaimed(0)]), resolving('b', { apiFailure })];
    expect(isLastHandOff(jobs, self('a', 0), none)).toBe(true);
  });

  it('isLastHandOff: another job’s pending file blocks', () => {
    const jobs = [job('a', [unclaimed(0)]), job('b', [file(0, 'page', 'queued')])];
    expect(isLastHandOff(jobs, self('a', 0), none)).toBe(false);
  });

  it('isLastHandOff: another job’s unclaimed saving file blocks', () => {
    const jobs = [job('a', [unclaimed(0)]), job('b', [unclaimed(0)])];
    expect(isLastHandOff(jobs, self('a', 0), none)).toBe(false);
  });

  it('isLastHandOff: another job’s saving file decided earlier does not block', () => {
    const jobs = [job('a', [unclaimed(0)]), job('b', [unclaimed(0)])];
    expect(isLastHandOff(jobs, self('a', 0), new Set([handOffKey('b', 0)]))).toBe(true);
  });

  it('isLastHandOff: a job still finalizing (every file terminal) does not block', () => {
    const jobs = [job('a', [unclaimed(0)]), job('b', [file(0, 'page', 'done')])];
    expect(isLastHandOff(jobs, self('a', 0), none)).toBe(true);
  });

  it('isLastHandOff: accepts the engine’s Map of decided hand-offs', () => {
    const decided = new Map([[handOffKey('a', 0), Promise.resolve<number | null>(1)]]);
    const jobs = [job('a', [unclaimed(0), unclaimed(1)])];
    expect(isLastHandOff(jobs, self('a', 1), decided)).toBe(true);
  });
});

describe('isLastHandOff: the examples table', () => {
  // 12 pages + metadata.json: idx 0 is metadata.json, idx 1…12 are p0…p11.
  const twelve = (states: Partial<Record<number, FileState>>, fallback: FileState): JobRecord =>
    pagesJob(
      'a',
      Array.from({ length: 13 }, (_, idx) => states[idx] ?? fallback),
    );

  it('12 pages + metadata: metadata.json, handed off first while the pages fetch, is not last', () => {
    const jobs = [twelve({ 0: 'saving', 1: 'fetching', 2: 'fetching' }, 'queued')];
    expect(isLastHandOff(jobs, self('a', 0), none)).toBe(false);
  });

  it('12 pages + metadata: a page landing mid-job is not last', () => {
    const jobs = [twelve({ 0: 'done', 6: 'saving', 7: 'fetching', 8: 'ready' }, 'done')];
    expect(isLastHandOff(jobs, self('a', 6), none)).toBe(false);
  });

  it('12 pages + metadata: the 13th file, with the 12 others done, is last', () => {
    const jobs = [twelve({ 12: 'saving' }, 'done')];
    expect(isLastHandOff(jobs, self('a', 12), none)).toBe(true);
  });

  it('12 pages + metadata: the 13th file, while an earlier one is still in Chrome, is last', () => {
    const jobs = [twelve({ 12: 'saving' }, 'done')];
    jobs[0]?.files.splice(11, 1, inChrome(11));
    expect(isLastHandOff(jobs, self('a', 12), none)).toBe(true);
  });

  it('12 pages + metadata: the last two landing together: the first to decide is not last', () => {
    const jobs = [twelve({ 11: 'saving', 12: 'saving' }, 'done')];
    expect(isLastHandOff(jobs, self('a', 11), none)).toBe(false);
  });

  it('12 pages + metadata: the last two landing together: the second, seeing the first decided, is last', () => {
    const jobs = [twelve({ 11: 'saving', 12: 'saving' }, 'done')];
    expect(isLastHandOff(jobs, self('a', 12), new Set([handOffKey('a', 11)]))).toBe(true);
  });

  it('12 pages + metadata: the last page with a failed page and nothing else pending is last', () => {
    const jobs = [twelve({ 5: 'failed', 12: 'saving' }, 'done')];
    expect(isLastHandOff(jobs, self('a', 12), none)).toBe(true);
  });

  it('1 page + metadata: metadata.json, with the page still fetching, is not last', () => {
    const jobs = [pagesJob('a', ['saving', 'fetching'])];
    expect(isLastHandOff(jobs, self('a', 0), none)).toBe(false);
  });

  it('1 page + metadata: the page, after metadata.json, is last', () => {
    const jobs = [pagesJob('a', ['done', 'saving'])];
    expect(isLastHandOff(jobs, self('a', 1), none)).toBe(true);
  });

  it('ugoira MP4: metadata.json, with the zip fetching and the video queued, is not last', () => {
    const jobs = [ugoiraJob(['saving', 'fetching', 'queued', 'queued'])];
    expect(isLastHandOff(jobs, self('ugoira', 0), none)).toBe(false);
  });

  it('ugoira MP4: the zip, with the video queued, is not last', () => {
    const jobs = [ugoiraJob(['done', 'saving', 'queued', 'queued'])];
    expect(isLastHandOff(jobs, self('ugoira', 1), none)).toBe(false);
  });

  it('ugoira MP4: frames.json, with the video queued (it counts), is not last', () => {
    const jobs = [ugoiraJob(['done', 'done', 'saving', 'queued'])];
    expect(isLastHandOff(jobs, self('ugoira', 2), none)).toBe(false);
  });

  it('ugoira MP4: the video, after the encode, is last', () => {
    const jobs = [ugoiraJob(['done', 'done', 'done', 'saving'])];
    expect(isLastHandOff(jobs, self('ugoira', 3), none)).toBe(true);
  });

  it('ugoira ZIP only: frames.json, landing last, is last', () => {
    const jobs = [ugoiraJob(['done', 'done', 'saving'])];
    expect(isLastHandOff(jobs, self('ugoira', 2), none)).toBe(true);
  });

  it('ugoira ZIP only: the zip, with frames.json still queued, is not last', () => {
    const jobs = [ugoiraJob(['done', 'saving', 'queued'])];
    expect(isLastHandOff(jobs, self('ugoira', 1), none)).toBe(false);
  });

  it('retryEncode: the video is last, its zip (save: false) never counts', () => {
    const jobs = [
      job(
        'retry',
        [
          file(0, 'zip', 'fetching', { save: false }),
          file(1, 'video', 'saving', { dependsOn: [0] }),
        ],
        { mode: 'retryEncode', kind: 'ugoira' },
      ),
    ];
    expect(isLastHandOff(jobs, self('retry', 1), none)).toBe(true);
  });

  it('retryMetadata: its one file is last', () => {
    const jobs = [job('retry', [file(0, 'metadata', 'saving')], { mode: 'retryMetadata' })];
    expect(isLastHandOff(jobs, self('retry', 0), none)).toBe(true);
  });

  it('two jobs: B’s last file, while A’s pages still fetch, is not last', () => {
    const jobs = [
      twelve({ 1: 'fetching', 2: 'fetching' }, 'queued'),
      pagesJob('b', ['done', 'done', 'saving']),
    ];
    expect(isLastHandOff(jobs, self('b', 2), none)).toBe(false);
  });

  it('two jobs: A’s last file, once B has ended, is last', () => {
    const jobs = [twelve({ 12: 'saving' }, 'done')];
    expect(isLastHandOff(jobs, self('a', 12), none)).toBe(true);
  });

  it('two jobs: A’s last file, while B is still resolving, is not last', () => {
    const jobs = [twelve({ 12: 'saving' }, 'done'), resolving('b')];
    expect(isLastHandOff(jobs, self('a', 12), none)).toBe(false);
  });
});
