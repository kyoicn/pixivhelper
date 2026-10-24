import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobStartResponse } from '../../src/shared/messages';
import type { ChromeFake } from '../fakes/chrome';
import {
  API,
  ContentTab,
  ScriptedOffscreen,
  advance,
  bootSw,
  deferred,
  illustJson,
  pagesJson,
  savedFiles,
  settle,
  setUp,
  tearDown,
  until,
  type ApiTable,
} from './harness';

const ID = '135882741';
const ARTWORK_URL = `https://www.pixiv.net/artworks/${ID}`;
const IDLE_TITLE = 'Helper for Pixiv — click to open settings';

let fake: ChromeFake;

beforeEach(() => {
  fake = setUp();
});

afterEach(tearDown);

function api(): ApiTable {
  return new Map<string, Record<string, unknown> | number>([
    [`${API}/${ID}`, illustJson({ pageCount: 12 })],
    [`${API}/${ID}/pages`, pagesJson(ID, 12)],
  ]);
}

async function start(tab: ContentTab): Promise<string> {
  const response = (await settle(
    tab.send({ type: 'job/start', mode: 'full', artworkId: ID, expectedFiles: 12, loggedIn: true }),
  )) as JobStartResponse;
  if (!response.ok) throw new Error('job/start failed');
  return response.view.jobId;
}

/** A job with metadata.json and p0–p3 fetching in the offscreen document, nothing landed. */
async function fetchingJob() {
  const offscreen = new ScriptedOffscreen(fake, { auto: false });
  await bootSw();
  const tab = new ContentTab(fake, ARTWORK_URL, api());
  const jobId = await start(tab);
  await until(() => offscreen.tasks.size === 5, 'five tasks');
  return { offscreen, tab, jobId };
}

describe('sw: cancel (CUJ-1 step 5, CUJ-4 step 4)', () => {
  it('sw: cancel answers ok', async () => {
    const { tab, jobId } = await fetchingJob();
    expect(await settle(tab.send({ type: 'job/cancel', jobId }))).toEqual({ ok: true });
  });

  it('sw: the cancelled view is pushed before cancel answers', async () => {
    const { tab, jobId } = await fetchingJob();
    await settle(tab.send({ type: 'job/cancel', jobId }));
    expect(tab.ended(jobId)?.outcome).toEqual({ type: 'cancelled' });
  });

  it('sw: cancel aborts every running offscreen task', async () => {
    const { tab, jobId, offscreen } = await fetchingJob();
    const running = [...offscreen.tasks.keys()];
    await settle(tab.send({ type: 'job/cancel', jobId }));
    expect(offscreen.aborted.sort()).toEqual(running.sort());
  });

  it('sw: cancel hides the badge and restores the idle title', async () => {
    const { tab, jobId } = await fetchingJob();
    await settle(tab.send({ type: 'job/cancel', jobId }));
    await advance(100);
    expect([fake.action.badgeText, fake.action.title]).toEqual(['', IDLE_TITLE]);
  });

  it('sw: cancel deletes the job record', async () => {
    const { tab, jobId } = await fetchingJob();
    await settle(tab.send({ type: 'job/cancel', jobId }));
    expect(fake.storage.session.snapshot()).not.toHaveProperty(`job:${jobId}`);
  });

  it('sw: off/ready after cancel only releases the task', async () => {
    const { tab, jobId, offscreen } = await fetchingJob();
    const late = offscreen.commandsOf('off/fetchBytes')[0]?.taskId as string;
    await settle(tab.send({ type: 'job/cancel', jobId }));
    const releasedBefore = offscreen.released.length;
    offscreen.emit({ type: 'off/ready', taskId: late, blobUrl: 'blob:late', size: 1 });
    await advance(20);
    expect([
      offscreen.released.slice(releasedBefore),
      fake.api.downloads.download.mock.calls,
    ]).toEqual([[{ taskIds: [late] }], []]);
  });

  it('sw: cancel stops downloads Chrome is writing and keeps landed files', async () => {
    const offscreen = new ScriptedOffscreen(fake);
    await bootSw();
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    const jobId = await start(tab);
    await until(() => fake.downloads.inProgress().length === 5, 'five downloads');
    const [first, second] = fake.downloads.inProgress();
    fake.downloads.complete(first?.id);
    fake.downloads.complete(second?.id);
    // The two freed slots start p4 and p5, which reach Chrome as well.
    await until(() => fake.downloads.inProgress().length === 5, 'refilled slots');
    const writing = fake.downloads.inProgress();
    await settle(tab.send({ type: 'job/cancel', jobId }));
    expect([
      fake.api.downloads.cancel.mock.calls.map(([id]) => id).sort(),
      savedFiles(fake).length,
      offscreen.commandsOf('off/fetchBytes').length,
    ]).toEqual([writing.map((item) => item.id).sort(), 2, 6]);
  });

  it('sw: a download Chrome starts after the cancel is cancelled too', async () => {
    new ScriptedOffscreen(fake);
    await bootSw();
    const gate = deferred();
    const download = fake.api.downloads.download;
    const original = download.getMockImplementation();
    if (!original) throw new Error('no download implementation');
    download.mockImplementationOnce(async (options) => {
      await gate.promise;
      return original(options);
    });
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    const jobId = await start(tab);
    await until(() => download.mock.calls.length >= 1, 'first download call');
    await settle(tab.send({ type: 'job/cancel', jobId }));
    gate.resolve();
    await until(() => fake.api.downloads.cancel.mock.calls.length > 0, 'download cancel');
    const firstId = fake.downloads.items()[0]?.id;
    expect(fake.api.downloads.cancel.mock.calls.map(([id]) => id)).toContain(firstId);
  });

  it('sw: a cancel while Chrome applies the hide hands no file to Chrome (R-005)', async () => {
    new ScriptedOffscreen(fake);
    await bootSw();
    const setUiOptions = fake.api.downloads.setUiOptions;
    const apply = setUiOptions.getMockImplementation();
    if (!apply) throw new Error('no setUiOptions implementation');
    const gate = deferred();
    setUiOptions.mockImplementationOnce(async (options) => {
      await gate.promise;
      return apply(options);
    });
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    const jobId = await start(tab);
    await until(() => setUiOptions.mock.calls.length === 2, 'the hide');
    // The final view is pushed at once; the answer follows finalize's restore, queued behind the hide.
    const answered = tab.send({ type: 'job/cancel', jobId });
    await until(() => tab.ended(jobId) !== undefined, 'the cancelled view');
    gate.resolve();
    await settle(answered);
    await advance(100);
    expect([
      fake.api.downloads.download.mock.calls.length,
      fake.downloads.uiCalls(),
      fake.downloads.uiEnabled,
    ]).toEqual([0, [true, false, true], true]);
  });

  it('sw: cancel while resolving ends the job before any file starts', async () => {
    const offscreen = new ScriptedOffscreen(fake);
    await bootSw();
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    const gate = deferred();
    tab.apiGate = gate.promise;
    const jobId = await start(tab);
    await settle(tab.send({ type: 'job/cancel', jobId }));
    gate.resolve();
    await advance(50);
    expect([tab.ended(jobId)?.outcome, offscreen.commands.length]).toEqual([
      { type: 'cancelled' },
      0,
    ]);
  });

  it('sw: only the tab that started a job may cancel it', async () => {
    const { jobId } = await fetchingJob();
    const other = new ContentTab(fake, ARTWORK_URL, api());
    expect(await settle(other.send({ type: 'job/cancel', jobId }))).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  it('sw: cancelling an ended job answers NOT_FOUND', async () => {
    const { tab, jobId } = await fetchingJob();
    await settle(tab.send({ type: 'job/cancel', jobId }));
    expect(await settle(tab.send({ type: 'job/cancel', jobId }))).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });
});
