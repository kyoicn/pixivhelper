// SW restart at every instrumented await point (design-test-harness.md "Restart simulation"; PRD
// CUJ-4 "Service-worker restart mid-job"). A dry run lists the await points a job passes; each test
// then kills the SW at one of them, re-imports sw.ts against the same fake state and drives the
// job to its end. Chrome's download UI (R-005) must stay consistent too: every file is handed to
// Chrome while the UI is hidden, and the UI is back on at the end.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobRecord } from '../../src/shared/job';
import type { JobOutcome } from '../../src/shared/types';
import type { ChromeFake } from '../fakes/chrome';
import {
  API,
  ContentTab,
  DownloadDriver,
  HookRecorder,
  ScriptedOffscreen,
  advance,
  bootSw,
  illustJson,
  pagesJson,
  savedFiles,
  setUp,
  tearDown,
  ugoiraIllustJson,
  ugoiraMetaJson,
  type ApiTable,
} from './harness';

interface Scenario {
  artworkId: string;
  api: ApiTable;
  expectedFiles: number;
  files: string[];
  outcome: JobOutcome;
  /** Files the badge counts that Chrome has not completed yet (ugoira: 1 for the whole job). */
  badgeCount(job: JobRecord, completed: string[]): number;
}

const PAGES_ID = '135882741';
const PAGES_FOLDER = 'pixiv/みずき-135882741';
const PAGES: Scenario = {
  artworkId: PAGES_ID,
  api: new Map([
    [`${API}/${PAGES_ID}`, illustJson()],
    [`${API}/${PAGES_ID}/pages`, pagesJson(PAGES_ID, 3)],
  ]),
  expectedFiles: 3,
  files: [
    `${PAGES_FOLDER}/metadata.json`,
    `${PAGES_FOLDER}/${PAGES_ID}_p0.jpg`,
    `${PAGES_FOLDER}/${PAGES_ID}_p1.jpg`,
    `${PAGES_FOLDER}/${PAGES_ID}_p2.jpg`,
  ],
  outcome: { type: 'saved', folder: PAGES_FOLDER, pages: 3 },
  badgeCount: (_job, completed) => 3 - completed.filter((f) => /_p\d+\.jpg$/.test(f)).length,
};

const UGOIRA_ID = '136004512';
const UGOIRA_FOLDER = 'pixiv/Sora_空-136004512';
const UGOIRA: Scenario = {
  artworkId: UGOIRA_ID,
  api: new Map([
    [`${API}/${UGOIRA_ID}`, ugoiraIllustJson()],
    [`${API}/${UGOIRA_ID}/ugoira_meta`, ugoiraMetaJson()],
  ]),
  expectedFiles: 1,
  files: [
    `${UGOIRA_FOLDER}/metadata.json`,
    `${UGOIRA_FOLDER}/${UGOIRA_ID}_ugoira.zip`,
    `${UGOIRA_FOLDER}/frames.json`,
    `${UGOIRA_FOLDER}/${UGOIRA_ID}.mp4`,
  ],
  outcome: { type: 'saved', folder: UGOIRA_FOLDER, format: 'mp4' },
  badgeCount: () => 1,
};

interface RunResult {
  hits: string[];
  restarts: number;
  downloadCalls: number;
  files: string[];
  outcome: JobOutcome | undefined;
  /** Badge text right after the restarted SW's `ready`, and what it should be then. */
  badgeAfterReady: string | null;
  expectedBadge: string | null;
  /** Chrome's download UI at the end, and the files handed to Chrome while it was on. */
  uiEnabled: boolean;
  downloadsWhileShown: string[];
}

function jobRecord(fake: ChromeFake): JobRecord | undefined {
  const entry = Object.entries(fake.storage.session.snapshot()).find(([key]) =>
    key.startsWith('job:'),
  );
  return entry?.[1] as JobRecord | undefined;
}

/** The badge the job should show now, from Chrome's completed downloads (ground truth). */
function expectedBadge(fake: ChromeFake, scenario: Scenario): string {
  const job = jobRecord(fake);
  if (!job) return '';
  if (job.phase === 'resolving') return String(job.expectedFiles);
  const count = scenario.badgeCount(job, savedFiles(fake));
  return count === 0 ? '' : String(count);
}

/** download() calls made while Chrome's UI was on (a fresh profile starts with it on). */
function downloadsWhileShown(fake: ChromeFake): string[] {
  const calls: string[] = [];
  let enabled = true;
  for (const call of fake.downloads.callLog) {
    if (call.op === 'ui') enabled = call.enabled;
    else if (enabled) calls.push(call.filename);
  }
  return calls;
}

/** Runs the scenario's job, killing the SW at await point `killAt` (none when null). */
async function run(
  fake: ChromeFake,
  scenario: Scenario,
  killAt: number | null,
): Promise<RunResult> {
  const recorder = new HookRecorder(fake, killAt);
  new ScriptedOffscreen(fake);
  await bootSw();
  const tab = new ContentTab(
    fake,
    `https://www.pixiv.net/artworks/${scenario.artworkId}`,
    scenario.api,
  );
  // Never answered when the SW dies before the job is persisted.
  void tab.send({
    type: 'job/start',
    mode: 'full',
    artworkId: scenario.artworkId,
    expectedFiles: scenario.expectedFiles,
    loggedIn: true,
  });
  const driver = new DownloadDriver(fake);
  let badgeAfterReady: string | null = null;
  let expected: string | null = null;
  let restarts = 0;
  for (let ms = 0; ms < 10_000; ms++) {
    if (recorder.dead) {
      await recorder.restart();
      restarts++;
      badgeAfterReady = fake.action.badgeText;
      expected = expectedBadge(fake, scenario);
      // Killed before the job was persisted: there is nothing left to finish.
      if (!jobRecord(fake) && !tab.ended()) break;
      continue;
    }
    driver.step();
    if (tab.ended()) break;
    await advance(1);
  }
  await advance(100);
  return {
    hits: recorder.hits,
    restarts,
    downloadCalls: fake.api.downloads.download.mock.calls.length,
    files: savedFiles(fake).sort(),
    outcome: tab.ended()?.outcome ?? undefined,
    badgeAfterReady,
    expectedBadge: expected,
    uiEnabled: fake.downloads.uiEnabled,
    downloadsWhileShown: downloadsWhileShown(fake),
  };
}

async function dryRun(scenario: Scenario): Promise<RunResult> {
  const fake = setUp();
  try {
    return await run(fake, scenario, null);
  } finally {
    tearDown();
  }
}

const pagesDry = await dryRun(PAGES);
const ugoiraDry = await dryRun(UGOIRA);

let fake: ChromeFake;

beforeEach(() => {
  fake = setUp();
});

afterEach(tearDown);

describe('sw: restart dry runs', () => {
  it('sw: a pages job passes the registry, resolver and hand-off await points', () => {
    expect([...new Set(pagesDry.hits)].sort()).toEqual([
      'await:handoff.download',
      'await:handoff.hideUi',
      'await:registry.create',
      'await:registry.effects',
      'await:registry.persist',
      'await:resolver.illust',
      'await:resolver.pages',
    ]);
  });

  it('sw: an ugoira job also passes the ugoira_meta and caps await points', () => {
    expect([...new Set(ugoiraDry.hits)].sort()).toEqual([
      'await:handoff.download',
      'await:handoff.hideUi',
      'await:registry.create',
      'await:registry.effects',
      'await:registry.persist',
      'await:resolver.caps',
      'await:resolver.illust',
      'await:resolver.ugoiraMeta',
    ]);
  });
});

function expectation(scenario: Scenario, result: RunResult, killedAt: string): RunResult {
  // Dying inside registry.create loses a job that was never persisted nor acknowledged.
  if (killedAt === 'await:registry.create') {
    return {
      hits: result.hits,
      restarts: 1,
      downloadCalls: 0,
      files: [],
      outcome: undefined,
      badgeAfterReady: '',
      expectedBadge: result.expectedBadge,
      uiEnabled: true,
      downloadsWhileShown: [],
    };
  }
  return {
    hits: result.hits,
    restarts: 1,
    downloadCalls: scenario.files.length,
    files: [...scenario.files].sort(),
    outcome: scenario.outcome,
    badgeAfterReady: result.expectedBadge,
    expectedBadge: result.expectedBadge,
    uiEnabled: true,
    downloadsWhileShown: [],
  };
}

describe('sw: a pages job survives a restart at every await point', () => {
  it.each(pagesDry.hits.map((name, at) => ({ at, name })))(
    'sw: restart at await #$at ($name): no duplicate, no lost file, badge right after ready, UI hidden for every hand-off and back at the end',
    async ({ at, name }) => {
      const result = await run(fake, PAGES, at);
      expect(result).toEqual(expectation(PAGES, result, name));
    },
  );
});

describe('sw: an ugoira job survives a restart at every await point', () => {
  it.each(ugoiraDry.hits.map((name, at) => ({ at, name })))(
    'sw: restart at await #$at ($name): no duplicate, no lost file, badge right after ready, UI hidden for every hand-off and back at the end',
    async ({ at, name }) => {
      const result = await run(fake, UGOIRA, at);
      expect(result).toEqual(expectation(UGOIRA, result, name));
    },
  );
});
