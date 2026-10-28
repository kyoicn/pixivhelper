// L2: the folder choice of a `full` job against the fake's download history and disk model
// (design-download-engine.md "Folder choice", Testing "Integration"; D15).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clickAction, createEntry, reduce } from '../../src/content/button/model';
import { FOLDER_CHECK_RECHECK_WAIT_MS } from '../../src/shared/constants';
import type { StartRequest } from '../../src/shared/job';
import type { JobStartResponse } from '../../src/shared/messages';
import type { Failure, JobView } from '../../src/shared/types';
import type { ChromeFake } from '../fakes/chrome';
import {
  API,
  ContentTab,
  DownloadDriver,
  ScriptedOffscreen,
  bootSw,
  deferred,
  illustJson,
  pageUrl,
  pagesJson,
  savedFiles,
  settle,
  setUp,
  tearDown,
  until,
  type ApiTable,
} from './harness';

const ID = '135882741';
const FOLDER = 'pixiv/みずき-135882741';
const ARTWORK_URL = `https://www.pixiv.net/artworks/${ID}`;
const FULL = { mode: 'full', artworkId: ID, expectedFiles: 12, loggedIn: true };
/** system.md §11: the folder check's 250 ms wait plus slack for the searches. */
const RESOLVE_BUDGET_MS = 260;

let fake: ChromeFake;

beforeEach(() => {
  fake = setUp();
});

afterEach(tearDown);

function api12(): ApiTable {
  return new Map<string, Record<string, unknown> | number>([
    [`${API}/${ID}`, illustJson({ pageCount: 12 })],
    [`${API}/${ID}/pages`, pagesJson(ID, 12)],
  ]);
}

/** metadata.json and the 12 pages under `folder`, with clean names. */
function cleanNames(folder: string): string[] {
  return [
    `${folder}/metadata.json`,
    ...Array.from({ length: 12 }, (_, page) => `${folder}/${ID}_p${page}.jpg`),
  ];
}

/** cleanNames(folder) with Chrome's ` (1)` uniquify suffix before each extension. */
function uniquifiedNames(folder: string): string[] {
  return cleanNames(folder).map((name) => name.replace(/(\.[a-z]+)$/, ' (1)$1'));
}

async function startJob(tab: ContentTab, start: Record<string, unknown>): Promise<string> {
  const response = (await settle(tab.send({ type: 'job/start', ...start }))) as JobStartResponse;
  if (!response.ok) throw new Error(`job/start refused: ${response.error}`);
  return response.view.jobId;
}

/** Drives Chrome until every job in `jobs` (tab and job id) has its final view; returns them. */
async function driveToEnd(jobs: Array<[ContentTab, string]>): Promise<JobView[]> {
  const driver = new DownloadDriver(fake);
  await until(() => {
    driver.step();
    return jobs.every(([tab, jobId]) => tab.ended(jobId) !== undefined);
  }, 'jobs end');
  await settle(new Promise((resolve) => setTimeout(resolve, 100)));
  return jobs.map(([tab, jobId]) => {
    const ended = tab.ended(jobId);
    if (!ended) throw new Error('no final view');
    return ended;
  });
}

/** Starts a job and drives Chrome until its final view arrives. */
async function drive(tab: ContentTab, start: Record<string, unknown> = FULL): Promise<JobView> {
  const jobId = await startJob(tab, start);
  const [ended] = await driveToEnd([[tab, jobId]]);
  if (!ended) throw new Error('no final view');
  return ended;
}

/** What the content script sends when the user clicks the button that shows `view`'s outcome. */
function retryOf(view: JobView): StartRequest {
  const shown = reduce(createEntry(ID), { type: 'update', view });
  const action = clickAction(shown, 0, ARTWORK_URL, false);
  if (action.type !== 'start') throw new Error(`a click does not start a job: ${action.type}`);
  return action.request;
}

async function boot(failures?: Map<string, Failure>): Promise<ScriptedOffscreen> {
  const offscreen = new ScriptedOffscreen(fake, failures ? { failures } : {});
  await bootSw();
  return offscreen;
}

describe('sw: a repeat download goes to <folder> (n) (D15)', () => {
  it('sw: two runs land in the plain folder, then in (1), every name clean', async () => {
    await boot();
    const tab = new ContentTab(fake, ARTWORK_URL, api12());
    const first = await drive(tab);
    const second = await drive(tab);
    expect([first.folder, second.folder, savedFiles(fake).sort()]).toEqual([
      FOLDER,
      `${FOLDER} (1)`,
      [...cleanNames(FOLDER), ...cleanNames(`${FOLDER} (1)`)].sort(),
    ]);
  });

  it('sw: the second run’s ended view names the folder ending in “ (1)”', async () => {
    await boot();
    const tab = new ContentTab(fake, ARTWORK_URL, api12());
    await drive(tab);
    const second = await drive(tab);
    expect(second.folder?.endsWith(' (1)')).toBe(true);
  });

  it('sw: the first run’s files removed from disk → a third run uses the plain folder again, clean names', async () => {
    await boot();
    const tab = new ContentTab(fake, ARTWORK_URL, api12());
    await drive(tab);
    await drive(tab);
    fake.downloads.removeFiles((item) => item.filename.includes(`/${FOLDER}/`));
    const before = savedFiles(fake).length;
    const third = await drive(tab);
    expect([third.folder, savedFiles(fake).slice(before).sort()]).toEqual([
      FOLDER,
      cleanNames(FOLDER).sort(),
    ]);
  });

  it('sw: a retryPages of a (1) job writes into (1)', async () => {
    const failures = new Map<string, Failure>();
    await boot(failures);
    const tab = new ContentTab(fake, ARTWORK_URL, api12());
    await drive(tab);
    failures.set(pageUrl(ID, 4), { kind: 'http', status: 503, attempts: 4 });
    const partial = await drive(tab);
    failures.clear();
    const before = savedFiles(fake).length;
    const retried = await drive(tab, retryOf(partial));
    expect([partial.folder, retried.outcome, savedFiles(fake).slice(before)]).toEqual([
      `${FOLDER} (1)`,
      { type: 'saved', folder: `${FOLDER} (1)`, pages: 12 },
      [`${FOLDER} (1)/${ID}_p4.jpg`],
    ]);
  });
});

describe('sw: the same artwork in two tabs (D15, CUJ-1 edge)', () => {
  it('sw: the second start after the first job’s first originals landed → (1)', async () => {
    await boot();
    const tabA = new ContentTab(fake, ARTWORK_URL, api12());
    const tabB = new ContentTab(fake, ARTWORK_URL, api12());
    const jobA = await startJob(tabA, FULL);
    const driver = new DownloadDriver(fake);
    await until(() => {
      driver.step();
      return savedFiles(fake).some((file) => file.startsWith(`${FOLDER}/${ID}_p`));
    }, 'first original landed');
    const jobB = await startJob(tabB, FULL);
    const [endedA, endedB] = await driveToEnd([
      [tabA, jobA],
      [tabB, jobB],
    ]);
    expect([endedA?.folder, endedB?.folder]).toEqual([FOLDER, `${FOLDER} (1)`]);
  });

  it('sw: both starts in one tick → both in the plain folder, the second’s names uniquified', async () => {
    await boot();
    const tabA = new ContentTab(fake, ARTWORK_URL, api12());
    const tabB = new ContentTab(fake, ARTWORK_URL, api12());
    const [jobA, jobB] = await Promise.all([startJob(tabA, FULL), startJob(tabB, FULL)]);
    const [endedA, endedB] = await driveToEnd([
      [tabA, jobA],
      [tabB, jobB],
    ]);
    expect([endedA?.folder, endedB?.folder, savedFiles(fake).sort()]).toEqual([
      FOLDER,
      FOLDER,
      [...cleanNames(FOLDER), ...uniquifiedNames(FOLDER)].sort(),
    ]);
  });
});

describe('sw: folder choice timing (system.md §11)', () => {
  it('sw: a repeat job’s resolve ends within 260 ms of the API answers', async () => {
    const offscreen = await boot();
    const tab = new ContentTab(fake, ARTWORK_URL, api12());
    await drive(tab);
    const gate = deferred();
    tab.apiGate = gate.promise;
    const commands = offscreen.commands.length;
    await startJob(tab, FULL);
    const answeredAt = Date.now();
    gate.resolve();
    await until(() => offscreen.commands.length > commands, 'first command of the repeat job');
    const elapsed = Date.now() - answeredAt;
    expect([elapsed >= FOLDER_CHECK_RECHECK_WAIT_MS, elapsed <= RESOLVE_BUDGET_MS]).toEqual([
      true,
      true,
    ]);
  });
});
