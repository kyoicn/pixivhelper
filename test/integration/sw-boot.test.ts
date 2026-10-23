import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileTask, JobRecord } from '../../src/shared/job';
import { isForTarget, type CapsGetResponse } from '../../src/shared/messages';
import type { Failure } from '../../src/shared/types';
import type { ChromeFake } from '../fakes/chrome';
import {
  API,
  ContentTab,
  DownloadDriver,
  ScriptedOffscreen,
  advance,
  bootSw,
  illustJson,
  pageUrl,
  pagesJson,
  savedFiles,
  settle,
  setUp,
  tearDown,
  until,
} from './harness';

const ID = '135882741';
const FOLDER = 'pixiv/みずき-135882741';
const ARTWORK_URL = `https://www.pixiv.net/artworks/${ID}`;

let fake: ChromeFake;

beforeEach(() => {
  fake = setUp();
});

afterEach(tearDown);

function api() {
  return new Map<string, Record<string, unknown> | number>([
    [`${API}/${ID}`, illustJson({ pageCount: 3 })],
    [`${API}/${ID}/pages`, pagesJson(ID, 3)],
  ]);
}

function page(idx: number, extra: Partial<FileTask>): FileTask {
  return {
    idx,
    role: 'page',
    page: idx,
    name: `${ID}_p${idx}.jpg`,
    url: pageUrl(ID, idx),
    save: true,
    dependsOn: [],
    state: 'queued',
    ...extra,
  };
}

/** A job record as an earlier SW instance left it in storage.session. */
function seedJob(tabId: number, extra: Partial<JobRecord>): void {
  const job: JobRecord = {
    v: 1,
    jobId: 'job-1',
    artworkId: ID,
    originTabId: tabId,
    createdAt: 0,
    mode: 'full',
    request: { mode: 'full', artworkId: ID, expectedFiles: 3 },
    kind: 'pages',
    phase: 'transferring',
    snapshot: {
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput: 'mp4',
      saveMetadata: false,
      effectiveFormat: null,
    },
    expectedFiles: 3,
    metaBody: null,
    folder: FOLDER,
    pagesTotal: 3,
    pagesOffset: 0,
    files: [],
    ugoira: null,
    stopReason: null,
    apiFailure: null,
    ...extra,
  };
  fake.storage.session.seed({ [`job:${job.jobId}`]: job });
}

/** Every distinct file failure the SW writes to a job record in storage.session, in order. */
function recordFailures(): Failure[] {
  const seen = new Set<string>();
  const failures: Failure[] = [];
  fake.storage.session.onChanged.addListener((changes) => {
    for (const change of Object.values(changes)) {
      const record = change.newValue as JobRecord | undefined;
      for (const file of record?.files ?? []) {
        const key = `${record?.jobId}:${file.idx}`;
        if (!file.failure || seen.has(key)) continue;
        seen.add(key);
        failures.push(file.failure);
      }
    }
  });
  return failures;
}

async function driveToEnd(tab: ContentTab): Promise<void> {
  const driver = new DownloadDriver(fake);
  await until(() => {
    driver.step();
    return tab.ended() !== undefined;
  }, 'job end');
}

describe('sw: boot', () => {
  it('sw: ready installs the Referer session rule', async () => {
    await bootSw();
    expect(fake.dnr.rules.map((rule) => rule.condition.requestDomains)).toEqual([['i.pximg.net']]);
  });

  it('sw: right after ready the badge counts the jobs found in storage.session', async () => {
    new ScriptedOffscreen(fake, { auto: false });
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    seedJob(tab.id, {
      files: [
        page(0, { state: 'done' }),
        page(1, { state: 'fetching', taskId: 'gone-1' }),
        page(2, { state: 'queued' }),
      ],
    });
    await bootSw();
    expect([fake.action.badgeText, fake.action.title]).toEqual([
      '2',
      'Helper for Pixiv — 2 files remaining',
    ]);
  });

  it('sw: files whose offscreen task died with the document are fetched again', async () => {
    const offscreen = new ScriptedOffscreen(fake);
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    seedJob(tab.id, {
      files: [
        page(0, { state: 'done' }),
        page(1, { state: 'fetching', taskId: 'gone-1' }),
        page(2, { state: 'fetching', taskId: 'gone-2' }),
      ],
    });
    await bootSw();
    await driveToEnd(tab);
    expect([offscreen.commandsOf('off/fetchBytes').length, savedFiles(fake)]).toEqual([
      2,
      [`${FOLDER}/${ID}_p1.jpg`, `${FOLDER}/${ID}_p2.jpg`],
    ]);
  });

  it('sw: a job that was still resolving is resolved again', async () => {
    new ScriptedOffscreen(fake);
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    seedJob(tab.id, { phase: 'resolving', kind: 'unknown', folder: null, pagesTotal: 0 });
    await bootSw();
    await driveToEnd(tab);
    expect(tab.ended()?.outcome).toEqual({ type: 'saved', folder: FOLDER, pages: 3 });
  });

  it('sw: a job cancelled while resolving is finalized, not resolved again', async () => {
    const offscreen = new ScriptedOffscreen(fake);
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    seedJob(tab.id, { phase: 'resolving', kind: 'unknown', folder: null, stopReason: 'cancelled' });
    await bootSw();
    await advance(100);
    expect([tab.ended()?.outcome, offscreen.commands.length]).toEqual([{ type: 'cancelled' }, 0]);
  });
});

describe('sw: handlers end to end', () => {
  it('sw: caps/get probes once per size and then answers from the session cache', async () => {
    const offscreen = new ScriptedOffscreen(fake, { caps: { avc: 'avc1.42e01e', vp9: false } });
    await bootSw();
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    await settle(tab.send({ type: 'caps/get', width: 600, height: 600 }));
    const second = (await settle(
      tab.send({ type: 'caps/get', width: 601, height: 601 }),
    )) as CapsGetResponse;
    expect([second, offscreen.commandsOf('off/probe').length]).toEqual([
      { ok: true, caps: { avc: 'avc1.42e01e', vp9: false } },
      1,
    ]);
  });

  it('sw: job/listForTab reattaches a reloaded tab to its running job', async () => {
    new ScriptedOffscreen(fake, { auto: false });
    await bootSw();
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    await settle(tab.send({ type: 'job/start', mode: 'full', artworkId: ID, expectedFiles: 3 }));
    const response = await settle(tab.send({ type: 'job/listForTab' }));
    expect(response).toMatchObject({
      ok: true,
      views: [{ artworkId: ID, status: 'running', kind: 'pages' }],
    });
  });

  it('sw: a command the offscreen document refuses fails that file instead of hanging', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    new ScriptedOffscreen(fake, { refuse: ['off/fetchBytes'] });
    await bootSw();
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    await settle(tab.send({ type: 'job/start', mode: 'full', artworkId: ID, expectedFiles: 3 }));
    await driveToEnd(tab);
    expect(tab.ended()?.outcome?.type).toBe('error');
  });

  it('sw: a refused offscreen command fails its file internal, and the job reads server, not offline', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    new ScriptedOffscreen(fake, { refuse: ['off/fetchBytes'] });
    const failures = recordFailures();
    await bootSw();
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    await settle(tab.send({ type: 'job/start', mode: 'full', artworkId: ID, expectedFiles: 3 }));
    await driveToEnd(tab);
    expect([failures.map((f) => f.kind), tab.ended()?.outcome]).toEqual([
      ['internal', 'internal', 'internal'],
      { type: 'error', cause: 'server' },
    ]);
  });

  it('sw: an undeliverable offscreen command fails its file internal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    new ScriptedOffscreen(fake);
    const sendMessage = fake.api.runtime.sendMessage;
    const deliver = sendMessage.getMockImplementation();
    sendMessage.mockImplementation((message: unknown) =>
      isForTarget(message, 'offscreen') && message.type === 'off/fetchBytes'
        ? Promise.reject(new Error('The message port closed before a response was received.'))
        : (deliver?.(message) ?? Promise.resolve(undefined)),
    );
    const failures = recordFailures();
    await bootSw();
    const tab = new ContentTab(fake, ARTWORK_URL, api());
    await settle(tab.send({ type: 'job/start', mode: 'full', artworkId: ID, expectedFiles: 3 }));
    await driveToEnd(tab);
    expect([new Set(failures.map((f) => f.kind)), tab.ended()?.outcome]).toEqual([
      new Set(['internal']),
      { type: 'error', cause: 'server' },
    ]);
  });
});
