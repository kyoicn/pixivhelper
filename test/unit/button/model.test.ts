import { describe, expect, it } from 'vitest';
import {
  AWAITING_JOB_ID,
  type ButtonState,
  clickAction,
  createEntry,
  type Entry,
  loginUrl,
  reduce,
} from '../../../src/content/button/model';
import type { JobOutcome, JobProgress, JobView, WorkInfo } from '../../../src/shared/types';

const ARTWORK = '135882741';
const HREF = 'https://www.pixiv.net/artworks/135882741';
const FOLDER = 'pixiv/みずき-135882741';
/** The page's login marker passed to clickAction (read once per document). */
const LOGGED_OUT = false;

function work(overrides: Partial<WorkInfo> = {}): WorkInfo {
  return {
    id: ARTWORK,
    illustType: 0,
    xRestrict: 0,
    withheld: false,
    pageCount: 12,
    width: 1200,
    height: 1697,
    userName: 'みずき',
    userId: '40285173',
    title: '雨上がりの渋谷',
    ...overrides,
  };
}

const UGOIRA = work({ id: '136004512', illustType: 2, pageCount: 1, width: 600, height: 600 });

function entry(state: ButtonState, overrides: Partial<Entry> = {}): Entry {
  return { ...createEntry(ARTWORK), work: work(), state, ...overrides };
}

function busy(overrides: Partial<Extract<ButtonState, { s: 'busy' }>> = {}): ButtonState {
  return {
    s: 'busy',
    jobId: 'job-1',
    progress: { kind: 'pages', done: 3, total: 12 },
    startedAt: 1000,
    armed: false,
    ...overrides,
  };
}

function running(progress: JobProgress | null, jobId = 'job-1'): JobView {
  return {
    jobId,
    artworkId: ARTWORK,
    kind: 'pages',
    status: 'running',
    progress,
    format: null,
    folder: FOLDER,
    outcome: null,
  };
}

function ended(outcome: JobOutcome, jobId = 'job-1', kind: JobView['kind'] = 'pages'): JobView {
  return {
    jobId,
    artworkId: ARTWORK,
    kind,
    status: 'ended',
    progress: null,
    format: null,
    folder: FOLDER,
    outcome,
  };
}

describe('createEntry', () => {
  it('createEntry: starts pending, unmeasured and untouched', () => {
    expect(createEntry(ARTWORK)).toEqual({
      artworkId: ARTWORK,
      work: null,
      format: null,
      state: { s: 'pending' },
      width: null,
      interacted: false,
      cancelledJobs: new Set(),
    });
  });
});

describe('reduce: render-time metadata', () => {
  it('reduce: metadata turns pending into idle for an all-ages work', () => {
    const next = reduce(createEntry(ARTWORK), { type: 'metadata', work: work(), loggedIn: false });
    expect(next.state).toEqual({ s: 'idle' });
  });

  it('reduce: metadata records the work', () => {
    const next = reduce(createEntry(ARTWORK), { type: 'metadata', work: work(), loggedIn: true });
    expect(next.work).toEqual(work());
  });

  it.each([1, 2] as const)(
    'reduce: metadata turns pending into needsLogin for xRestrict %i while logged out',
    (xRestrict) => {
      const next = reduce(createEntry(ARTWORK), {
        type: 'metadata',
        work: work({ xRestrict }),
        loggedIn: false,
      });
      expect(next.state).toEqual({ s: 'needsLogin' });
    },
  );

  it('reduce: metadata turns pending into needsLogin for a withheld all-ages work while logged out', () => {
    const next = reduce(createEntry(ARTWORK), {
      type: 'metadata',
      work: work({ xRestrict: 0, withheld: true }),
      loggedIn: false,
    });
    expect(next.state).toEqual({ s: 'needsLogin' });
  });

  it.each([true, null])(
    'reduce: metadata for a withheld all-ages work with loggedIn %s is idle',
    (loggedIn) => {
      const next = reduce(createEntry(ARTWORK), {
        type: 'metadata',
        work: work({ xRestrict: 0, withheld: true }),
        loggedIn,
      });
      expect(next.state).toEqual({ s: 'idle' });
    },
  );

  it('reduce: an unknown login state never produces needsLogin', () => {
    const next = reduce(createEntry(ARTWORK), {
      type: 'metadata',
      work: work({ xRestrict: 1 }),
      loggedIn: null,
    });
    expect(next.state).toEqual({ s: 'idle' });
  });

  it('reduce: metadata arriving while busy keeps the busy state', () => {
    const start = { ...createEntry(ARTWORK), state: busy() };
    const next = reduce(start, { type: 'metadata', work: work(), loggedIn: true });
    expect(next.state).toBe(start.state);
  });

  it('reduce: a render-time 404 turns pending into unavailable', () => {
    expect(reduce(createEntry(ARTWORK), { type: 'unavailable' }).state).toEqual({
      s: 'unavailable',
    });
  });

  it('reduce: a render-time 404 is ignored once a job runs', () => {
    const start = entry(busy());
    expect(reduce(start, { type: 'unavailable' })).toBe(start);
  });

  it('reduce: format records the effective ugoira output', () => {
    const next = reduce(entry({ s: 'idle' }, { work: UGOIRA }), { type: 'format', format: 'webm' });
    expect(next.format).toBe('webm');
  });
});

describe('reduce: click', () => {
  it('reduce: a click on idle pages shows busy 0 / N, unarmed, awaiting the job id', () => {
    const next = reduce(entry({ s: 'idle' }), { type: 'click', now: 2000 });
    expect(next.state).toEqual({
      s: 'busy',
      jobId: AWAITING_JOB_ID,
      progress: { kind: 'pages', done: 0, total: 12 },
      startedAt: 2000,
      armed: false,
    });
  });

  it('reduce: a click marks the entry as interacted', () => {
    expect(reduce(entry({ s: 'idle' }), { type: 'click', now: 2000 }).interacted).toBe(true);
  });

  it('reduce: a click on an idle ugoira shows busy 0% downloading frames', () => {
    const next = reduce(entry({ s: 'idle' }, { work: UGOIRA }), { type: 'click', now: 2000 });
    expect(next.state).toMatchObject({
      s: 'busy',
      progress: { kind: 'percent', percent: 0, phase: 'frames', indeterminate: false },
    });
  });

  it('reduce: a click while pending shows busy with no progress yet', () => {
    const next = reduce(createEntry(ARTWORK), { type: 'click', now: 2000 });
    expect(next.state).toMatchObject({ s: 'busy', progress: null });
  });

  it('reduce: a click on Saved starts again from 0 / N', () => {
    const saved: ButtonState = { s: 'saved', folder: FOLDER, kind: 'pages', pages: 12 };
    const next = reduce(entry(saved), { type: 'click', now: 2000 });
    expect(next.state).toMatchObject({ s: 'busy', progress: { done: 0, total: 12 } });
  });

  it('reduce: retrying a partial failure continues from the saved count', () => {
    const state: ButtonState = {
      s: 'error',
      err: { t: 'partial', folder: FOLDER, total: 12, saved: 9, failedPages: [3, 8, 10] },
    };
    const next = reduce(entry(state), { type: 'click', now: 2000 });
    expect(next.state).toMatchObject({
      s: 'busy',
      progress: { kind: 'pages', done: 9, total: 12 },
    });
  });

  it('reduce: retrying metadata.json shows every page as already saved', () => {
    const state: ButtonState = {
      s: 'error',
      err: { t: 'metadataOnly', folder: FOLDER, total: 12 },
    };
    const next = reduce(entry(state), { type: 'click', now: 2000 });
    expect(next.state).toMatchObject({ progress: { kind: 'pages', done: 12, total: 12 } });
  });

  it('reduce: retrying an encode starts at 0%', () => {
    const state: ButtonState = {
      s: 'error',
      err: { t: 'encodeFailed', folder: FOLDER, format: 'mp4' },
    };
    const next = reduce(entry(state, { work: UGOIRA }), { type: 'click', now: 2000 });
    expect(next.state).toMatchObject({ progress: { kind: 'percent', percent: 0 } });
  });

  it('reduce: a click on busy within the 500 ms guard changes nothing', () => {
    const start = entry(busy({ startedAt: 1000 }));
    expect(reduce(start, { type: 'click', now: 1499 }).state).toBe(start.state);
  });

  it('reduce: a click on busy after the guard cancels to idle at once', () => {
    const next = reduce(entry(busy({ startedAt: 1000 })), { type: 'click', now: 1500 });
    expect(next.state).toEqual({ s: 'idle' });
  });

  it('reduce: a cancel remembers the job as cancelled locally', () => {
    const next = reduce(entry(busy({ startedAt: 1000 })), { type: 'click', now: 1500 });
    expect([...next.cancelledJobs]).toEqual(['job-1']);
  });

  it('reduce: a cancel before the metadata arrived goes back to pending', () => {
    const start = { ...createEntry(ARTWORK), state: busy({ progress: null }) };
    expect(reduce(start, { type: 'click', now: 5000 }).state).toEqual({ s: 'pending' });
  });

  it('reduce: a busy click is ignored until job/start has answered', () => {
    const start = entry(busy({ jobId: AWAITING_JOB_ID, startedAt: 0 }));
    expect(reduce(start, { type: 'click', now: 9000 }).state).toBe(start.state);
  });

  it.each<ButtonState>([{ s: 'needsLogin' }, { s: 'unavailable' }])(
    'reduce: a click on $s keeps the state',
    (state) => {
      const start = entry(state);
      expect(reduce(start, { type: 'click', now: 2000 }).state).toBe(state);
    },
  );

  it('reduce: never mutates the entry it is given', () => {
    const start = entry(busy({ startedAt: 1000 }));
    const snapshot = structuredClone(start);
    reduce(start, { type: 'click', now: 5000 });
    expect(start).toEqual(snapshot);
  });
});

describe('reduce: job/start response', () => {
  it('reduce: started attaches the job id to the optimistic busy state', () => {
    const start = entry(busy({ jobId: AWAITING_JOB_ID }));
    expect(reduce(start, { type: 'started', jobId: 'job-9' }).state).toMatchObject({
      s: 'busy',
      jobId: 'job-9',
    });
  });

  it('reduce: started is ignored when no start is awaited', () => {
    const start = entry(busy({ jobId: 'job-1' }));
    expect(reduce(start, { type: 'started', jobId: 'job-9' })).toBe(start);
  });

  it('reduce: a failed job/start ends in Retry with the server cause', () => {
    const next = reduce(entry(busy({ jobId: AWAITING_JOB_ID })), { type: 'startFailed' });
    expect(next.state).toEqual({ s: 'error', err: { t: 'cause', cause: 'server' } });
  });
});

describe('reduce: job/update while running', () => {
  it('reduce: a running update replaces the progress', () => {
    const next = reduce(entry(busy()), {
      type: 'update',
      view: running({ kind: 'pages', done: 7, total: 12 }),
    });
    expect(next.state).toMatchObject({ progress: { done: 7, total: 12 } });
  });

  it('reduce: a running update without progress keeps the optimistic progress', () => {
    const next = reduce(entry(busy()), { type: 'update', view: running(null) });
    expect(next.state).toMatchObject({ progress: { done: 3, total: 12 } });
  });

  it('reduce: late running updates of a locally cancelled job are ignored', () => {
    const start = entry({ s: 'idle' }, { cancelledJobs: new Set(['job-1']) });
    const next = reduce(start, {
      type: 'update',
      view: running({ kind: 'pages', done: 8, total: 12 }),
    });
    expect(next).toBe(start);
  });

  it('reduce: a running job shown nowhere is reattached as busy (reload)', () => {
    const next = reduce(entry({ s: 'idle' }), {
      type: 'update',
      view: running({ kind: 'pages', done: 9, total: 12 }, 'job-7'),
    });
    expect(next.state).toEqual({
      s: 'busy',
      jobId: 'job-7',
      progress: { kind: 'pages', done: 9, total: 12 },
      startedAt: Number.NEGATIVE_INFINITY,
      armed: true,
    });
  });

  it('reduce: running updates are ignored while job/start is awaited', () => {
    const start = entry(busy({ jobId: AWAITING_JOB_ID }));
    expect(reduce(start, { type: 'update', view: running(null, 'job-old') })).toBe(start);
  });

  it("reduce: another job's running update does not take over a busy button", () => {
    const start = entry(busy({ jobId: 'job-1' }));
    expect(reduce(start, { type: 'update', view: running(null, 'job-2') })).toBe(start);
  });

  it('reduce: the view fills in the ugoira format when the entry has none', () => {
    const view = { ...running(null), kind: 'ugoira' as const, format: 'mp4' as const };
    const next = reduce(entry(busy(), { work: UGOIRA }), { type: 'update', view });
    expect(next.format).toBe('mp4');
  });

  it("reduce: the view never overrides the entry's own format", () => {
    const view = { ...running(null), kind: 'ugoira' as const, format: 'mp4' as const };
    const next = reduce(entry(busy(), { work: UGOIRA, format: 'zip' }), { type: 'update', view });
    expect(next.format).toBe('zip');
  });
});

describe('reduce: job/update when the job ends', () => {
  it('reduce: saved (pages) shows Saved with the folder and page count', () => {
    const next = reduce(entry(busy()), {
      type: 'update',
      view: ended({ type: 'saved', folder: FOLDER, pages: 12 }),
    });
    expect(next.state).toEqual({ s: 'saved', folder: FOLDER, kind: 'pages', pages: 12 });
  });

  it('reduce: saved (ugoira) shows Saved with the format', () => {
    const next = reduce(entry(busy(), { work: UGOIRA }), {
      type: 'update',
      view: ended({ type: 'saved', folder: FOLDER, format: 'webm' }, 'job-1', 'ugoira'),
    });
    expect(next.state).toEqual({ s: 'saved', folder: FOLDER, kind: 'ugoira', format: 'webm' });
  });

  it('reduce: cancelled returns to idle', () => {
    const next = reduce(entry(busy()), { type: 'update', view: ended({ type: 'cancelled' }) });
    expect(next.state).toEqual({ s: 'idle' });
  });

  it('reduce: partial shows Retry with the failed pages', () => {
    const outcome: JobOutcome = {
      type: 'partial',
      folder: FOLDER,
      total: 12,
      saved: 9,
      failedPages: [3, 8, 10],
    };
    const next = reduce(entry(busy()), { type: 'update', view: ended(outcome) });
    expect(next.state).toEqual({
      s: 'error',
      err: { t: 'partial', folder: FOLDER, total: 12, saved: 9, failedPages: [3, 8, 10] },
    });
  });

  it('reduce: metadataOnly shows Retry for metadata.json', () => {
    const next = reduce(entry(busy()), {
      type: 'update',
      view: ended({ type: 'metadataOnly', folder: FOLDER, total: 12 }),
    });
    expect(next.state).toEqual({
      s: 'error',
      err: { t: 'metadataOnly', folder: FOLDER, total: 12 },
    });
  });

  it('reduce: encodeFailed shows Retry for the encode', () => {
    const next = reduce(entry(busy(), { work: UGOIRA }), {
      type: 'update',
      view: ended({ type: 'encodeFailed', folder: FOLDER, format: 'mp4' }, 'job-1', 'ugoira'),
    });
    expect(next.state).toEqual({
      s: 'error',
      err: { t: 'encodeFailed', folder: FOLDER, format: 'mp4' },
    });
  });

  it.each(['offline', 'refused', 'server', 'disk'] as const)(
    'reduce: error %s shows Retry with that cause',
    (cause) => {
      const next = reduce(entry(busy()), { type: 'update', view: ended({ type: 'error', cause }) });
      expect(next.state).toEqual({ s: 'error', err: { t: 'cause', cause } });
    },
  );

  it('reduce: needsLogin (403 on bytes) shows Log in to download', () => {
    const next = reduce(entry(busy()), { type: 'update', view: ended({ type: 'needsLogin' }) });
    expect(next.state).toEqual({ s: 'needsLogin' });
  });

  it('reduce: unavailable shows Unavailable', () => {
    const next = reduce(entry(busy()), { type: 'update', view: ended({ type: 'unavailable' }) });
    expect(next.state).toEqual({ s: 'unavailable' });
  });

  it('reduce: truth wins when a locally cancelled job had already completed', () => {
    const start = entry({ s: 'idle' }, { cancelledJobs: new Set(['job-1']) });
    const next = reduce(start, {
      type: 'update',
      view: ended({ type: 'saved', folder: FOLDER, pages: 12 }),
    });
    expect(next.state).toMatchObject({ s: 'saved', folder: FOLDER });
  });

  it('reduce: the cancel confirmation of a locally cancelled job keeps the current state', () => {
    const start = entry({ s: 'needsLogin' }, { cancelledJobs: new Set(['job-1']) });
    const next = reduce(start, { type: 'update', view: ended({ type: 'cancelled' }) });
    expect(next.state).toEqual({ s: 'needsLogin' });
  });

  it('reduce: an ended job is forgotten from the cancelled set', () => {
    const start = entry({ s: 'idle' }, { cancelledJobs: new Set(['job-1']) });
    const next = reduce(start, { type: 'update', view: ended({ type: 'cancelled' }) });
    expect(next.cancelledJobs.size).toBe(0);
  });

  it('reduce: the end of a cancelled job does not end the job shown now', () => {
    const start = entry(busy({ jobId: 'job-2' }), { cancelledJobs: new Set(['job-1']) });
    const next = reduce(start, {
      type: 'update',
      view: ended({ type: 'saved', folder: FOLDER, pages: 12 }),
    });
    expect(next.state).toBe(start.state);
  });
});

describe('clickAction', () => {
  it('clickAction: pending starts a full job with no file estimate', () => {
    expect(clickAction(createEntry(ARTWORK), 0, HREF, LOGGED_OUT)).toEqual({
      type: 'start',
      request: { mode: 'full', artworkId: ARTWORK, expectedFiles: 0, loggedIn: false },
    });
  });

  it('clickAction: idle pages starts a full job expecting every page', () => {
    expect(clickAction(entry({ s: 'idle' }), 0, HREF, LOGGED_OUT)).toEqual({
      type: 'start',
      request: { mode: 'full', artworkId: ARTWORK, expectedFiles: 12, loggedIn: false },
    });
  });

  it('clickAction: idle ugoira starts a full job expecting one file', () => {
    expect(clickAction(entry({ s: 'idle' }, { work: UGOIRA }), 0, HREF, LOGGED_OUT)).toEqual({
      type: 'start',
      request: { mode: 'full', artworkId: ARTWORK, expectedFiles: 1, loggedIn: false },
    });
  });

  it('clickAction: Saved downloads the whole work again', () => {
    const saved: ButtonState = { s: 'saved', folder: FOLDER, kind: 'pages', pages: 12 };
    expect(clickAction(entry(saved), 0, HREF, LOGGED_OUT)).toEqual({
      type: 'start',
      request: { mode: 'full', artworkId: ARTWORK, expectedFiles: 12, loggedIn: false },
    });
  });

  it('clickAction: a partial failure retries only the failed pages into the same folder', () => {
    const state: ButtonState = {
      s: 'error',
      err: { t: 'partial', folder: FOLDER, total: 12, saved: 9, failedPages: [3, 8, 10] },
    };
    expect(clickAction(entry(state), 0, HREF, LOGGED_OUT)).toEqual({
      type: 'start',
      request: {
        mode: 'retryPages',
        artworkId: ARTWORK,
        folder: FOLDER,
        pages: [3, 8, 10],
        total: 12,
      },
    });
  });

  it('clickAction: metadataOnly retries metadata.json', () => {
    const state: ButtonState = {
      s: 'error',
      err: { t: 'metadataOnly', folder: FOLDER, total: 12 },
    };
    expect(clickAction(entry(state), 0, HREF, LOGGED_OUT)).toEqual({
      type: 'start',
      request: { mode: 'retryMetadata', artworkId: ARTWORK, folder: FOLDER },
    });
  });

  it('clickAction: encodeFailed retries the encode in the same format', () => {
    const state: ButtonState = {
      s: 'error',
      err: { t: 'encodeFailed', folder: FOLDER, format: 'webm' },
    };
    expect(clickAction(entry(state, { work: UGOIRA }), 0, HREF, LOGGED_OUT)).toEqual({
      type: 'start',
      request: { mode: 'retryEncode', artworkId: ARTWORK, folder: FOLDER, format: 'webm' },
    });
  });

  it('clickAction: a cause error runs the whole job again', () => {
    const state: ButtonState = { s: 'error', err: { t: 'cause', cause: 'offline' } };
    expect(clickAction(entry(state), 0, HREF, LOGGED_OUT)).toEqual({
      type: 'start',
      request: { mode: 'full', artworkId: ARTWORK, expectedFiles: 12, loggedIn: false },
    });
  });

  it.each([true, false, null])(
    'clickAction: a pending click carries the page’s loggedIn %s (the SW re-checks, R-003)',
    (loggedIn) => {
      expect(clickAction(createEntry(ARTWORK), 0, HREF, loggedIn)).toEqual({
        type: 'start',
        request: { mode: 'full', artworkId: ARTWORK, expectedFiles: 0, loggedIn },
      });
    },
  );

  it.each<[string, ButtonState]>([
    ['idle', { s: 'idle' }],
    ['saved', { s: 'saved', folder: FOLDER, kind: 'pages', pages: 12 }],
    ['error with a cause', { s: 'error', err: { t: 'cause', cause: 'server' } }],
  ])('clickAction: a full start from %s carries loggedIn', (_label, state) => {
    expect([
      clickAction(entry(state), 0, HREF, true),
      clickAction(entry(state), 0, HREF, null),
    ]).toEqual([
      {
        type: 'start',
        request: { mode: 'full', artworkId: ARTWORK, expectedFiles: 12, loggedIn: true },
      },
      {
        type: 'start',
        request: { mode: 'full', artworkId: ARTWORK, expectedFiles: 12, loggedIn: null },
      },
    ]);
  });

  it('clickAction: needsLogin opens pixiv login returning to this page', () => {
    expect(
      clickAction(
        entry({ s: 'needsLogin' }),
        0,
        'https://www.pixiv.net/artworks/145892669',
        LOGGED_OUT,
      ),
    ).toEqual({
      type: 'login',
      url: 'https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2Fartworks%2F145892669',
    });
  });

  it('clickAction: busy within the 500 ms guard is ignored', () => {
    expect(clickAction(entry(busy({ startedAt: 1000 })), 1499, HREF, LOGGED_OUT)).toEqual({
      type: 'ignore',
    });
  });

  it('clickAction: busy after the guard cancels the job', () => {
    expect(clickAction(entry(busy({ startedAt: 1000 })), 1500, HREF, LOGGED_OUT)).toEqual({
      type: 'cancel',
      jobId: 'job-1',
    });
  });

  it('clickAction: busy before job/start answered is ignored', () => {
    const state = busy({ jobId: AWAITING_JOB_ID, startedAt: 0 });
    expect(clickAction(entry(state), 9000, HREF, LOGGED_OUT)).toEqual({ type: 'ignore' });
  });

  it('clickAction: a reattached job can be cancelled at once', () => {
    const state = busy({ startedAt: Number.NEGATIVE_INFINITY, armed: true });
    expect(clickAction(entry(state), 10, HREF, LOGGED_OUT)).toEqual({
      type: 'cancel',
      jobId: 'job-1',
    });
  });

  it('clickAction: unavailable does nothing', () => {
    expect(clickAction(entry({ s: 'unavailable' }), 0, HREF, LOGGED_OUT)).toEqual({
      type: 'ignore',
    });
  });

  it('loginUrl: encodes locale-prefixed artwork URLs', () => {
    expect(loginUrl('https://www.pixiv.net/en/artworks/1?a=b')).toBe(
      'https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2Fen%2Fartworks%2F1%3Fa%3Db',
    );
  });
});
