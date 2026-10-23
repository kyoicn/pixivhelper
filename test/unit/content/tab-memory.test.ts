import { describe, expect, it } from 'vitest';
import { type ButtonState, createEntry, type Entry } from '../../../src/content/button/model';
import { createTabMemory } from '../../../src/content/tab-memory';
import type { JobOutcome, JobView, WorkInfo } from '../../../src/shared/types';

const ARTWORK = '135882741';
const FOLDER = 'pixiv/みずき-135882741';

const WORK: WorkInfo = {
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
};

function running(done: number, jobId = 'job-1'): JobView {
  return {
    jobId,
    artworkId: ARTWORK,
    kind: 'pages',
    status: 'running',
    progress: { kind: 'pages', done, total: 12 },
    format: null,
    folder: FOLDER,
    outcome: null,
  };
}

function ended(outcome: JobOutcome, jobId = 'job-1'): JobView {
  return { ...running(12, jobId), status: 'ended', outcome };
}

function busy(jobId = 'job-1'): ButtonState {
  return {
    s: 'busy',
    jobId,
    progress: { kind: 'pages', done: 0, total: 12 },
    startedAt: 0,
    armed: false,
  };
}

function shown(state: ButtonState, overrides: Partial<Entry> = {}): Entry {
  return { ...createEntry(ARTWORK), work: WORK, state, ...overrides };
}

describe('createTabMemory', () => {
  it('getOrCreate: a new artwork starts pending', () => {
    expect(createTabMemory().getOrCreate(ARTWORK).state).toEqual({ s: 'pending' });
  });

  it('getOrCreate: stores the new entry', () => {
    const memory = createTabMemory();
    const entry = memory.getOrCreate(ARTWORK);
    expect(memory.get(ARTWORK)).toBe(entry);
  });

  it('get: undefined for an artwork never shown', () => {
    expect(createTabMemory().get(ARTWORK)).toBeUndefined();
  });

  it('set: keeps the entry for its artwork (SPA back/forward memory)', () => {
    const memory = createTabMemory();
    const entry = shown({ s: 'saved', folder: FOLDER, kind: 'pages', pages: 12 }, { width: 164 });
    memory.set(entry);
    memory.getOrCreate('135882742');
    expect(memory.getOrCreate(ARTWORK)).toBe(entry);
  });

  it('entries: every artwork of the document', () => {
    const memory = createTabMemory();
    memory.getOrCreate(ARTWORK);
    memory.getOrCreate('135882742');
    expect(memory.entries().map((e) => e.artworkId)).toEqual([ARTWORK, '135882742']);
  });
});

describe('applyView (job/update mapping)', () => {
  it('applyView: a running job of an artwork not shown yet reattaches as busy (reload)', () => {
    const { next } = createTabMemory().applyView(running(7));
    expect(next.state).toEqual({
      s: 'busy',
      jobId: 'job-1',
      progress: { kind: 'pages', done: 7, total: 12 },
      startedAt: Number.NEGATIVE_INFINITY,
      armed: true,
    });
  });

  it('applyView: stores the next entry', () => {
    const memory = createTabMemory();
    const { next } = memory.applyView(running(7));
    expect(memory.get(ARTWORK)).toBe(next);
  });

  it('applyView: returns the entry before the update', () => {
    const memory = createTabMemory();
    const before = memory.getOrCreate(ARTWORK);
    expect(memory.applyView(running(1)).prev).toBe(before);
  });

  it('applyView: progress of the shown job', () => {
    const memory = createTabMemory();
    memory.set(shown(busy()));
    const { next } = memory.applyView(running(5));
    expect(next.state.s === 'busy' && next.state.progress).toEqual({
      kind: 'pages',
      done: 5,
      total: 12,
    });
  });

  it.each<[string, JobOutcome, ButtonState]>([
    [
      'saved → saved',
      { type: 'saved', folder: FOLDER, pages: 12 },
      { s: 'saved', folder: FOLDER, kind: 'pages', pages: 12 },
    ],
    [
      'partial → error',
      { type: 'partial', folder: FOLDER, total: 12, saved: 9, failedPages: [2, 5, 7] },
      {
        s: 'error',
        err: { t: 'partial', folder: FOLDER, total: 12, saved: 9, failedPages: [2, 5, 7] },
      },
    ],
    [
      'metadataOnly → error',
      { type: 'metadataOnly', folder: FOLDER, total: 12 },
      { s: 'error', err: { t: 'metadataOnly', folder: FOLDER, total: 12 } },
    ],
    [
      'encodeFailed → error',
      { type: 'encodeFailed', folder: FOLDER, format: 'mp4' },
      { s: 'error', err: { t: 'encodeFailed', folder: FOLDER, format: 'mp4' } },
    ],
    [
      'error → error with its cause',
      { type: 'error', cause: 'offline' },
      { s: 'error', err: { t: 'cause', cause: 'offline' } },
    ],
    ['needsLogin → needsLogin', { type: 'needsLogin' }, { s: 'needsLogin' }],
    ['unavailable → unavailable', { type: 'unavailable' }, { s: 'unavailable' }],
    ['cancelled → idle', { type: 'cancelled' }, { s: 'idle' }],
  ])('applyView: ended %s', (_, outcome, state) => {
    const memory = createTabMemory();
    memory.set(shown(busy()));
    expect(memory.applyView(ended(outcome)).next.state).toEqual(state);
  });

  it('applyView: a running update of a job cancelled locally is ignored', () => {
    const memory = createTabMemory();
    memory.set(shown({ s: 'idle' }, { cancelledJobs: new Set(['job-1']) }));
    expect(memory.applyView(running(8)).next.state).toEqual({ s: 'idle' });
  });

  it('applyView: an ended update wins over a local cancel (job finished first)', () => {
    const memory = createTabMemory();
    memory.set(shown({ s: 'idle' }, { cancelledJobs: new Set(['job-1']) }));
    const { next } = memory.applyView(ended({ type: 'saved', folder: FOLDER, pages: 12 }));
    expect(next.state.s).toBe('saved');
  });

  it('applyView: another job’s update does not take over the shown job', () => {
    const memory = createTabMemory();
    memory.set(shown(busy('job-2')));
    expect(memory.applyView(running(3, 'job-1')).next.state).toEqual(busy('job-2'));
  });

  it('applyView: updates an artwork the user navigated away from', () => {
    const memory = createTabMemory();
    memory.set(shown(busy()));
    memory.getOrCreate('135882742');
    memory.applyView(running(11));
    const state = memory.get(ARTWORK)?.state;
    expect(state?.s === 'busy' && state.progress).toEqual({ kind: 'pages', done: 11, total: 12 });
  });
});
