import { describe, expect, it } from 'vitest';
import type { FileRole, FileState, FileTask, JobRecord } from '../../src/shared/job';
import { classifyOutcome } from '../../src/shared/outcome';
import type { Failure, FailureKind, UgoiraOutput } from '../../src/shared/types';

const FOLDER = 'pixiv/みずき-135882741';
const ONLINE = true;
const OFFLINE = false;

function fail(kind: FailureKind, status?: number): Failure {
  return status === undefined ? { kind, attempts: 4 } : { kind, status, attempts: 4 };
}

/** A file in `state`, or failed with the given failure. */
function file(
  idx: number,
  role: FileRole,
  end: FileState | Failure,
  extra: Partial<FileTask> = {},
): FileTask {
  const base: FileTask = {
    idx,
    role,
    name: `file${idx}`,
    save: true,
    dependsOn: [],
    state: 'done',
  };
  return typeof end === 'string'
    ? { ...base, ...extra, state: end }
    : { ...base, ...extra, state: 'failed' as const, failure: end };
}

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    v: 1,
    jobId: 'job-1',
    artworkId: '135882741',
    originTabId: 7,
    createdAt: 0,
    mode: 'full',
    request: { mode: 'full', artworkId: '135882741', expectedFiles: 12 },
    kind: 'pages',
    phase: 'ended',
    snapshot: {
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput: 'mp4',
      saveMetadata: true,
      effectiveFormat: null,
    },
    expectedFiles: 12,
    metaBody: null,
    folder: FOLDER,
    pagesTotal: 12,
    pagesOffset: 0,
    files: [],
    ugoira: null,
    stopReason: null,
    apiFailure: null,
    ...overrides,
  };
}

/** A full 12-page job: metadata.json, then pages 0–11; pages not listed in `pages` landed. */
function pagesJob(
  pages: Record<number, FileState | Failure> = {},
  metadata: FileState | Failure = 'done',
  overrides: Partial<JobRecord> = {},
): JobRecord {
  const files = [file(0, 'metadata', metadata)];
  for (let page = 0; page < 12; page++)
    files.push(file(page + 1, 'page', pages[page] ?? 'done', { page }));
  return job({ files, ...overrides });
}

/** A retryPages run over `requested` of 12 pages; the other pages were saved earlier. */
function retryPagesJob(requested: Record<number, FileState | Failure>): JobRecord {
  const pages = Object.keys(requested).map(Number);
  const files = pages.map((page, i) => file(i, 'page', requested[page] ?? 'done', { page }));
  return job({
    mode: 'retryPages',
    request: { mode: 'retryPages', artworkId: '135882741', folder: FOLDER, pages, total: 12 },
    pagesOffset: 12 - pages.length,
    files,
  });
}

interface UgoiraEnds {
  metadata?: FileState | Failure;
  zip?: FileState | Failure;
  framesJson?: FileState | Failure;
  video?: FileState | Failure;
}

/** A full ugoira job: metadata.json, zip, frames.json and (unless ZIP only) the video. */
function ugoiraJob(ends: UgoiraEnds = {}, format: UgoiraOutput = 'mp4'): JobRecord {
  const files = [
    file(0, 'metadata', ends.metadata ?? 'done'),
    file(1, 'zip', ends.zip ?? 'done'),
    file(2, 'framesJson', ends.framesJson ?? 'done', { dependsOn: [1] }),
  ];
  if (format !== 'zip') files.push(file(3, 'video', ends.video ?? 'done', { dependsOn: [1, 2] }));
  return job({
    artworkId: '136004512',
    kind: 'ugoira',
    folder: 'pixiv/ヨル-136004512',
    pagesTotal: 1,
    files,
    ugoira: {
      frames: [{ file: '000000.jpg', delay: 100 }],
      format,
      avcCodec: format === 'mp4' ? 'avc1.64001e' : null,
      width: 600,
      height: 600,
      zipLoaded: 0,
      zipTotal: null,
      encDone: 0,
      percent: 0,
    },
  });
}

describe('classifyOutcome', () => {
  describe('row 1: cancelled', () => {
    it('classifyOutcome: a job the user cancelled is cancelled', () => {
      const cancelled = pagesJob({ 7: 'skipped', 8: 'skipped' }, 'done', {
        stopReason: 'cancelled',
      });
      expect(classifyOutcome(cancelled, ONLINE)).toEqual({ type: 'cancelled' });
    });

    it('classifyOutcome: cancel beats an API failure', () => {
      const cancelled = job({
        kind: 'unknown',
        stopReason: 'cancelled',
        apiFailure: { endpoint: 'illust', failure: fail('http', 404) },
      });
      expect(classifyOutcome(cancelled, ONLINE)).toEqual({ type: 'cancelled' });
    });

    it('classifyOutcome: cancel beats a 403 on an original', () => {
      const cancelled = pagesJob({ 3: fail('http', 403), 4: 'skipped' }, 'done', {
        stopReason: 'cancelled',
      });
      expect(classifyOutcome(cancelled, ONLINE)).toEqual({ type: 'cancelled' });
    });

    it('classifyOutcome: cancel beats a failed encode', () => {
      const cancelled = {
        ...ugoiraJob({ video: fail('encode') }),
        stopReason: 'cancelled' as const,
      };
      expect(classifyOutcome(cancelled, ONLINE)).toEqual({ type: 'cancelled' });
    });
  });

  describe('row 2: unavailable', () => {
    it.each([
      ['/ajax/illust 404', 'illust', fail('http', 404)],
      ['/ajax/illust pixiv error body', 'illust', fail('pixivError', 200)],
      ['/pages 404', 'pages', fail('http', 404)],
      ['/ugoira_meta 404', 'ugoira_meta', fail('pixivError', 404)],
    ] as const)('classifyOutcome: %s is unavailable', (_name, endpoint, failure) => {
      const deleted = job({ kind: 'unknown', apiFailure: { endpoint, failure } });
      expect(classifyOutcome(deleted, ONLINE)).toEqual({ type: 'unavailable' });
    });
  });

  describe('row 3: error refused', () => {
    it.each([
      ['/ajax/illust 401', 'illust', fail('http', 401)],
      ['/pages 403', 'pages', fail('http', 403)],
      ['/pages pixiv error body', 'pages', fail('pixivError', 200)],
      ['/ugoira_meta pixiv error body', 'ugoira_meta', fail('pixivError', 400)],
    ] as const)('classifyOutcome: %s is refused', (_name, endpoint, failure) => {
      const refused = job({ apiFailure: { endpoint, failure } });
      expect(classifyOutcome(refused, ONLINE)).toEqual({ type: 'error', cause: 'refused' });
    });
  });

  describe('row 4: needsLogin', () => {
    it('classifyOutcome: a 403 on an original mid-job needs login', () => {
      const expired = pagesJob({ 5: fail('http', 403), 6: 'skipped', 7: 'skipped' }, 'done', {
        stopReason: 'forbidden',
      });
      expect(classifyOutcome(expired, ONLINE)).toEqual({ type: 'needsLogin' });
    });

    it('classifyOutcome: a 403 on the ugoira zip needs login', () => {
      const expired = ugoiraJob({
        zip: fail('http', 403),
        framesJson: 'skipped',
        video: 'skipped',
      });
      expect(classifyOutcome(expired, ONLINE)).toEqual({ type: 'needsLogin' });
    });

    it('classifyOutcome: a 403 on an original beats partial', () => {
      const mixed = pagesJob({ 2: fail('network'), 5: fail('http', 403) }, 'done', {
        stopReason: 'forbidden',
      });
      expect(classifyOutcome(mixed, ONLINE)).toEqual({ type: 'needsLogin' });
    });
  });

  describe('row 5: encodeFailed', () => {
    it('classifyOutcome: zip and frames.json saved, encode failed', () => {
      const broken = ugoiraJob({ video: fail('encode') });
      expect(classifyOutcome(broken, ONLINE)).toEqual({
        type: 'encodeFailed',
        folder: 'pixiv/ヨル-136004512',
        format: 'mp4',
      });
    });

    it('classifyOutcome: a retryEncode whose encode fails again is encodeFailed', () => {
      const retry = ugoiraJob({}, 'webm');
      retry.mode = 'retryEncode';
      retry.files = [
        file(0, 'zip', 'done', { save: false }),
        file(1, 'video', fail('encode'), { dependsOn: [0] }),
      ];
      expect(classifyOutcome(retry, ONLINE)).toMatchObject({
        type: 'encodeFailed',
        format: 'webm',
      });
    });
  });

  describe('row 6: partial', () => {
    it('classifyOutcome: 3 of 12 pages failed is partial with the failed page indexes', () => {
      const broken = pagesJob({ 4: fail('network'), 9: fail('http', 503), 11: fail('timeout') });
      expect(classifyOutcome(broken, ONLINE)).toEqual({
        type: 'partial',
        folder: FOLDER,
        total: 12,
        saved: 9,
        failedPages: [4, 9, 11],
      });
    });

    it('classifyOutcome: a retryPages run counts the pages saved earlier', () => {
      const retry = retryPagesJob({ 4: 'done', 9: fail('network'), 11: 'done' });
      expect(classifyOutcome(retry, ONLINE)).toMatchObject({
        type: 'partial',
        total: 12,
        saved: 11,
        failedPages: [9],
      });
    });

    it('classifyOutcome: a retryPages run where every page fails again stays partial', () => {
      const retry = retryPagesJob({ 4: fail('network'), 9: fail('network'), 11: fail('network') });
      expect(classifyOutcome(retry, OFFLINE)).toMatchObject({
        type: 'partial',
        saved: 9,
        failedPages: [4, 9, 11],
      });
    });
  });

  describe('row 7: metadataOnly', () => {
    it('classifyOutcome: every page saved but metadata.json failed', () => {
      const noMeta = pagesJob({}, fail('disk'));
      expect(classifyOutcome(noMeta, ONLINE)).toEqual({
        type: 'metadataOnly',
        folder: FOLDER,
        total: 12,
      });
    });

    it('classifyOutcome: a retryMetadata run that fails again is metadataOnly', () => {
      const retry = job({
        mode: 'retryMetadata',
        request: { mode: 'retryMetadata', artworkId: '135882741', folder: FOLDER },
        pagesOffset: 12,
        files: [file(0, 'metadata', fail('disk'))],
      });
      expect(classifyOutcome(retry, ONLINE)).toMatchObject({ type: 'metadataOnly', total: 12 });
    });
  });

  describe('row 8: error with a cause, nothing saved', () => {
    const allPages = (end: FileState | Failure) =>
      Object.fromEntries(Array.from({ length: 12 }, (_, page) => [page, end]));

    it('classifyOutcome: every page failed with network errors is offline', () => {
      const dropped = pagesJob(allPages(fail('network')));
      expect(classifyOutcome(dropped, ONLINE)).toEqual({ type: 'error', cause: 'offline' });
    });

    it('classifyOutcome: navigator offline beats 5xx failures (offline vs server)', () => {
      const dropped = pagesJob(allPages(fail('http', 503)));
      expect(classifyOutcome(dropped, OFFLINE)).toEqual({ type: 'error', cause: 'offline' });
    });

    it('classifyOutcome: 5xx failures while online are server', () => {
      const down = pagesJob(allPages(fail('http', 503)));
      expect(classifyOutcome(down, ONLINE)).toEqual({ type: 'error', cause: 'server' });
    });

    it('classifyOutcome: network mixed with 5xx while online is server', () => {
      const mixed = pagesJob({ ...allPages(fail('network')), 0: fail('http', 502) });
      expect(classifyOutcome(mixed, ONLINE)).toEqual({ type: 'error', cause: 'server' });
    });

    it.each([
      ['429', fail('http', 429)],
      ['timeout', fail('timeout')],
      ['another 4xx', fail('http', 404)],
    ])('classifyOutcome: %s on every page is server', (_name, failure) => {
      const down = pagesJob(allPages(failure));
      expect(classifyOutcome(down, ONLINE)).toEqual({ type: 'error', cause: 'server' });
    });

    it('classifyOutcome: all disk or dismissed failures are disk, even offline', () => {
      const unwritable = pagesJob(
        { ...allPages(fail('disk')), 3: fail('dismissed') },
        fail('disk'),
      );
      expect(classifyOutcome(unwritable, OFFLINE)).toEqual({ type: 'error', cause: 'disk' });
    });

    it('classifyOutcome: metadata.json alone does not count as saved', () => {
      const dropped = pagesJob(allPages(fail('network')), 'done');
      expect(classifyOutcome(dropped, ONLINE)).toMatchObject({ type: 'error' });
    });

    it('classifyOutcome: an ugoira whose zip failed is an error', () => {
      const dropped = ugoiraJob({ zip: fail('network'), framesJson: 'skipped', video: 'skipped' });
      expect(classifyOutcome(dropped, ONLINE)).toEqual({ type: 'error', cause: 'offline' });
    });

    it('classifyOutcome: an API 5xx is server', () => {
      const down = job({
        kind: 'unknown',
        apiFailure: { endpoint: 'illust', failure: fail('http', 500) },
      });
      expect(classifyOutcome(down, ONLINE)).toEqual({ type: 'error', cause: 'server' });
    });

    it('classifyOutcome: an API network failure is offline', () => {
      const dropped = job({ apiFailure: { endpoint: 'pages', failure: fail('network') } });
      expect(classifyOutcome(dropped, ONLINE)).toEqual({ type: 'error', cause: 'offline' });
    });

    // QA iteration 1 (CUJ-5): Chromium throttled the later attempts during a sustained 503.
    it('classifyOutcome: network failures after a 503 on every page (lastStatus) are server', () => {
      const throttled: Failure = { kind: 'network', lastStatus: 503, attempts: 4 };
      const down = pagesJob(allPages(throttled));
      expect(classifyOutcome(down, ONLINE)).toEqual({ type: 'error', cause: 'server' });
    });

    it('classifyOutcome: one throttled network failure among plain ones is server', () => {
      const throttled: Failure = { kind: 'network', lastStatus: 503, attempts: 4 };
      const mixed = pagesJob({ ...allPages(fail('network')), 0: throttled });
      expect(classifyOutcome(mixed, ONLINE)).toEqual({ type: 'error', cause: 'server' });
    });

    it('classifyOutcome: a timeout after a 429 (lastStatus) is server', () => {
      const throttled: Failure = { kind: 'timeout', lastStatus: 429, attempts: 4 };
      const down = pagesJob(allPages(throttled));
      expect(classifyOutcome(down, ONLINE)).toEqual({ type: 'error', cause: 'server' });
    });

    it('classifyOutcome: navigator offline beats throttled network failures', () => {
      const throttled: Failure = { kind: 'network', lastStatus: 503, attempts: 4 };
      const down = pagesJob(allPages(throttled));
      expect(classifyOutcome(down, OFFLINE)).toEqual({ type: 'error', cause: 'offline' });
    });

    it('classifyOutcome: internal failures on every page are server', () => {
      const broken = pagesJob(allPages(fail('internal')));
      expect(classifyOutcome(broken, ONLINE)).toEqual({ type: 'error', cause: 'server' });
    });

    it('classifyOutcome: any internal failure among network failures is server', () => {
      const mixed = pagesJob({ ...allPages(fail('network')), 6: fail('internal') });
      expect(classifyOutcome(mixed, ONLINE)).toEqual({ type: 'error', cause: 'server' });
    });

    it('classifyOutcome: an API internal failure (no context answered) is server', () => {
      const broken = job({
        kind: 'unknown',
        apiFailure: { endpoint: 'illust', failure: fail('internal') },
      });
      expect(classifyOutcome(broken, ONLINE)).toEqual({ type: 'error', cause: 'server' });
    });

    it('classifyOutcome: an ugoira whose zip failed internally is server', () => {
      const broken = ugoiraJob({
        zip: fail('internal'),
        framesJson: 'skipped',
        video: 'skipped',
      });
      expect(classifyOutcome(broken, ONLINE)).toEqual({ type: 'error', cause: 'server' });
    });
  });

  describe('row 9: ugoira error disk', () => {
    it('classifyOutcome: the video encoded but its save failed', () => {
      const unwritable = ugoiraJob({ video: fail('disk') });
      expect(classifyOutcome(unwritable, ONLINE)).toEqual({ type: 'error', cause: 'disk' });
    });

    it('classifyOutcome: an ugoira whose only failure is metadata.json is disk', () => {
      const noMeta = ugoiraJob({ metadata: fail('disk') });
      expect(classifyOutcome(noMeta, ONLINE)).toEqual({ type: 'error', cause: 'disk' });
    });

    it('classifyOutcome: a dismissed video save is disk', () => {
      const dismissed = ugoiraJob({ video: fail('dismissed') });
      expect(classifyOutcome(dismissed, ONLINE)).toEqual({ type: 'error', cause: 'disk' });
    });
  });

  describe('row 10: saved', () => {
    it('classifyOutcome: every page and metadata.json landed', () => {
      expect(classifyOutcome(pagesJob(), ONLINE)).toEqual({
        type: 'saved',
        folder: FOLDER,
        pages: 12,
      });
    });

    it('classifyOutcome: an ugoira with its video landed is saved with the format', () => {
      expect(classifyOutcome(ugoiraJob({}, 'webm'), ONLINE)).toEqual({
        type: 'saved',
        folder: 'pixiv/ヨル-136004512',
        format: 'webm',
      });
    });

    it('classifyOutcome: a ZIP-only ugoira is saved as zip', () => {
      expect(classifyOutcome(ugoiraJob({}, 'zip'), ONLINE)).toMatchObject({
        type: 'saved',
        format: 'zip',
      });
    });

    it('classifyOutcome: a retryPages run that lands every page is saved with all pages', () => {
      const retry = retryPagesJob({ 4: 'done', 9: 'done', 11: 'done' });
      expect(classifyOutcome(retry, ONLINE)).toMatchObject({ type: 'saved', pages: 12 });
    });
  });
});
