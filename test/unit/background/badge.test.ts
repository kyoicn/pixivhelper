import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  actionTitle,
  badgeText,
  createBadgeRenderer,
  remaining,
} from '../../../src/background/badge';
import type { FileRole, FileState, FileTask, JobRecord } from '../../../src/shared/job';
import { BADGE_COALESCE_MS } from '../../../src/shared/constants';
import { installChromeFake, type ChromeFake } from '../../fakes/chrome';

function file(idx: number, role: FileRole, state: FileState): FileTask {
  return { idx, role, name: `f${idx}`, save: true, dependsOn: [], state };
}

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    v: 1,
    jobId: 'job-1',
    artworkId: '135882741',
    originTabId: 1,
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

/** A pages job: metadata.json at idx 0, then one page per state. */
function pagesJob(pageStates: FileState[], overrides: Partial<JobRecord> = {}): JobRecord {
  const files = [
    file(0, 'metadata', 'queued'),
    ...pageStates.map((s, i) => file(i + 1, 'page', s)),
  ];
  return job({ files, ...overrides });
}

function ugoiraJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return job({
    artworkId: '136004512',
    kind: 'ugoira',
    expectedFiles: 1,
    files: [
      file(0, 'metadata', 'done'),
      file(1, 'zip', 'fetching'),
      file(2, 'framesJson', 'queued'),
      file(3, 'video', 'queued'),
    ],
    ...overrides,
  });
}

let fake: ChromeFake;

beforeEach(() => {
  fake = installChromeFake();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('remaining', () => {
  it('remaining: counts pages queued, fetching, ready or saving', () => {
    expect(remaining(pagesJob(['queued', 'fetching', 'ready', 'saving']))).toBe(4);
  });

  it('remaining: does not count done, failed or skipped pages', () => {
    expect(remaining(pagesJob(['done', 'failed', 'skipped', 'queued']))).toBe(1);
  });

  it('remaining: never counts metadata.json', () => {
    expect(remaining(pagesJob([]))).toBe(0);
  });

  it('remaining: an ugoira job counts 1 while transferring', () => {
    expect(remaining(ugoiraJob())).toBe(1);
  });

  it('remaining: an ugoira job counts 1 while only its video is left', () => {
    const files = ugoiraJob().files.map((f) => ({
      ...f,
      state: f.role === 'video' ? 'fetching' : 'done',
    }));
    expect(remaining(ugoiraJob({ files: files as FileTask[] }))).toBe(1);
  });

  it('remaining: a resolving job counts expectedFiles', () => {
    expect(remaining(job({ phase: 'resolving', kind: 'unknown', expectedFiles: 30 }))).toBe(30);
  });

  it('remaining: a retryMetadata job counts 0 while resolving', () => {
    const request = { mode: 'retryMetadata', artworkId: '136004512', folder: 'pixiv/x' } as const;
    expect(
      remaining(job({ mode: 'retryMetadata', request, phase: 'resolving', expectedFiles: 0 })),
    ).toBe(0);
  });

  it('remaining: a retryMetadata job of an ugoira counts 0 while transferring', () => {
    const request = { mode: 'retryMetadata', artworkId: '136004512', folder: 'pixiv/x' } as const;
    expect(
      remaining(
        ugoiraJob({ mode: 'retryMetadata', request, files: [file(0, 'metadata', 'queued')] }),
      ),
    ).toBe(0);
  });

  it('remaining: a job of unknown kind counts 0 once resolved', () => {
    expect(remaining(job({ kind: 'unknown', files: [file(0, 'page', 'queued')] }))).toBe(0);
  });

  it('remaining: an ended job counts 0', () => {
    expect(remaining(ugoiraJob({ phase: 'ended' }))).toBe(0);
  });
});

describe('badgeText', () => {
  it.each([
    [0, ''],
    [1, '1'],
    [23, '23'],
    [999, '999'],
    [1000, '999+'],
    [1204, '999+'],
  ])('badgeText: %i files show %j', (total, text) => {
    expect(badgeText(total)).toBe(text);
  });
});

describe('actionTitle', () => {
  it('actionTitle: nothing in flight shows the idle title', () => {
    expect(actionTitle(0, 0)).toBe('Helper for Pixiv — click to open settings');
  });

  it('actionTitle: one job with one file uses the singular', () => {
    expect(actionTitle(1, 1)).toBe('Helper for Pixiv — 1 file remaining');
  });

  it('actionTitle: one job with several files uses the plural', () => {
    expect(actionTitle(5, 1)).toBe('Helper for Pixiv — 5 files remaining');
  });

  it('actionTitle: several jobs say across N downloads', () => {
    expect(actionTitle(23, 2)).toBe('Helper for Pixiv — 23 files remaining across 2 downloads');
  });

  it('actionTitle: shows the exact total beyond 999', () => {
    expect(actionTitle(1204, 7)).toBe('Helper for Pixiv — 1204 files remaining across 7 downloads');
  });
});

describe('createBadgeRenderer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  async function rendered(render: Promise<void>): Promise<void> {
    await vi.advanceTimersByTimeAsync(BADGE_COALESCE_MS);
    await render;
  }

  it('render: with no jobs hides the badge and shows the idle title', async () => {
    fake.action.badgeText = 'stale';
    fake.action.title = 'stale';
    await rendered(createBadgeRenderer(() => []).render());
    expect([fake.action.badgeText, fake.action.title]).toEqual([
      '',
      'Helper for Pixiv — click to open settings',
    ]);
  });

  it('render: sums remaining files across running jobs', async () => {
    const jobs = [
      pagesJob(Array<FileState>(18).fill('queued')),
      pagesJob(['saving', 'queued']),
      ugoiraJob(),
    ];
    await rendered(createBadgeRenderer(() => jobs).render());
    expect([fake.action.badgeText, fake.action.title]).toEqual([
      '21',
      'Helper for Pixiv — 21 files remaining across 3 downloads',
    ]);
  });

  it('render: does not count ended jobs', async () => {
    const jobs = [pagesJob(['queued', 'queued']), ugoiraJob({ phase: 'ended' })];
    await rendered(createBadgeRenderer(() => jobs).render());
    expect(fake.action.title).toBe('Helper for Pixiv — 2 files remaining');
  });

  it('render: a lone retryMetadata job hides the badge and shows the idle title', async () => {
    fake.action.badgeText = 'stale';
    fake.action.title = 'stale';
    const request = { mode: 'retryMetadata', artworkId: '136004512', folder: 'pixiv/x' } as const;
    const jobs = [job({ mode: 'retryMetadata', request, phase: 'resolving', expectedFiles: 0 })];
    await rendered(createBadgeRenderer(() => jobs).render());
    expect([fake.action.badgeText, fake.action.title]).toEqual([
      '',
      'Helper for Pixiv — click to open settings',
    ]);
  });

  it('render: a full job resolving with expectedFiles 0 shows the idle title', async () => {
    fake.action.title = 'stale';
    const request = { mode: 'full', artworkId: '135882741', expectedFiles: 0 } as const;
    const jobs = [job({ request, phase: 'resolving', kind: 'unknown', expectedFiles: 0 })];
    await rendered(createBadgeRenderer(() => jobs).render());
    expect(fake.action.title).toBe('Helper for Pixiv — click to open settings');
  });

  it('render: a job that counts 0 is not one of the downloads in the title', async () => {
    const request = { mode: 'retryMetadata', artworkId: '136004512', folder: 'pixiv/x' } as const;
    const jobs = [
      pagesJob(Array<FileState>(5).fill('queued')),
      job({ mode: 'retryMetadata', request, phase: 'resolving', expectedFiles: 0 }),
    ];
    await rendered(createBadgeRenderer(() => jobs).render());
    expect(fake.action.title).toBe('Helper for Pixiv — 5 files remaining');
  });

  it('render: waits the 50 ms trailing delay before applying', async () => {
    void createBadgeRenderer(() => [ugoiraJob()]).render();
    await vi.advanceTimersByTimeAsync(BADGE_COALESCE_MS - 1);
    expect(fake.api.action.setBadgeText).not.toHaveBeenCalled();
  });

  it('render: coalesces calls within 50 ms into one render', async () => {
    const renderer = createBadgeRenderer(() => [ugoiraJob()]);
    const first = renderer.render();
    await vi.advanceTimersByTimeAsync(20);
    const second = renderer.render();
    await rendered(Promise.all([first, second]).then(() => undefined));
    expect(fake.api.action.setBadgeText).toHaveBeenCalledTimes(1);
  });

  it('render: reads the jobs at render time, not at call time', async () => {
    let jobs: JobRecord[] = [];
    const render = createBadgeRenderer(() => jobs).render();
    jobs = [pagesJob(['queued', 'queued', 'queued'])];
    await rendered(render);
    expect(fake.action.badgeText).toBe('3');
  });

  it('render: skips setBadgeText and setTitle when nothing changed', async () => {
    const renderer = createBadgeRenderer(() => [ugoiraJob()]);
    await rendered(renderer.render());
    await rendered(renderer.render());
    expect([
      fake.api.action.setBadgeText.mock.calls.length,
      fake.api.action.setTitle.mock.calls.length,
    ]).toEqual([1, 1]);
  });

  it('render: updates only the title when only the job count changed', async () => {
    let jobs = [pagesJob(['queued', 'queued'])];
    const renderer = createBadgeRenderer(() => jobs);
    await rendered(renderer.render());
    jobs = [pagesJob(['queued']), ugoiraJob()];
    await rendered(renderer.render());
    expect([
      fake.api.action.setBadgeText.mock.calls.length,
      fake.api.action.setTitle.mock.calls.length,
    ]).toEqual([1, 2]);
  });

  it('render: a failed setBadgeText is logged and retried by the next render', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fake.api.action.setBadgeText.mockRejectedValueOnce(new Error('boom'));
    const renderer = createBadgeRenderer(() => [ugoiraJob()]);
    await rendered(renderer.render());
    await rendered(renderer.render());
    expect([warn.mock.calls.length, fake.action.badgeText]).toEqual([1, '1']);
  });

  it('render: a failed setTitle is logged and retried by the next render', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fake.api.action.setTitle.mockRejectedValueOnce(new Error('boom'));
    const renderer = createBadgeRenderer(() => [ugoiraJob()]);
    await rendered(renderer.render());
    await rendered(renderer.render());
    expect([warn.mock.calls.length, fake.action.title]).toEqual([
      1,
      'Helper for Pixiv — 1 file remaining',
    ]);
  });
});
