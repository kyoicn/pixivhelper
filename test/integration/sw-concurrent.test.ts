import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobListForTabResponse, JobStartResponse } from '../../src/shared/messages';
import type { ChromeFake } from '../fakes/chrome';
import {
  API,
  ContentTab,
  ScriptedOffscreen,
  advance,
  bootSw,
  illustJson,
  pagesJson,
  settle,
  setUp,
  tearDown,
  until,
} from './harness';

const A = '135882741';
const B = '136120877';

let fake: ChromeFake;

beforeEach(() => {
  fake = setUp();
});

afterEach(tearDown);

function api() {
  return new Map<string, Record<string, unknown> | number>([
    [`${API}/${A}`, illustJson({ pageCount: 12 })],
    [`${API}/${A}/pages`, pagesJson(A, 12)],
    [
      `${API}/${B}`,
      illustJson({
        illustId: B,
        id: B,
        illustTitle: '夏祭りの帰り',
        userName: 'そら',
        pageCount: 8,
      }),
    ],
    [`${API}/${B}/pages`, pagesJson(B, 8)],
  ]);
}

async function start(tab: ContentTab, artworkId: string, pages: number): Promise<string> {
  const response = (await settle(
    tab.send({ type: 'job/start', mode: 'full', artworkId, expectedFiles: pages }),
  )) as JobStartResponse;
  if (!response.ok) throw new Error('job/start failed');
  return response.view.jobId;
}

/** Tab A runs a 12-page job and tab B an 8-page job; the offscreen document holds every file. */
async function twoJobs() {
  const offscreen = new ScriptedOffscreen(fake, { auto: false });
  await bootSw();
  const tabA = new ContentTab(fake, `https://www.pixiv.net/artworks/${A}`, api());
  const tabB = new ContentTab(fake, `https://www.pixiv.net/artworks/${B}`, api());
  const jobA = await start(tabA, A, 12);
  const jobB = await start(tabB, B, 8);
  await until(() => offscreen.tasks.size === 10, 'both jobs fetching');
  await advance(100);
  return { offscreen, tabA, tabB, jobA, jobB };
}

/** Lands every file of job B while job A's files stay in Chrome's downloader. */
async function finishB(offscreen: ScriptedOffscreen, tabB: ContentTab): Promise<void> {
  await until(() => {
    offscreen.finish();
    for (const item of fake.downloads.inProgress()) {
      if (item.filename.includes(`/pixiv/そら-${B}/`)) fake.downloads.complete(item.id);
    }
    return tabB.ended() !== undefined;
  }, 'job B end');
  await advance(100);
}

describe('sw: two jobs at once (CUJ-4)', () => {
  it('sw: the badge shows the sum of both jobs', async () => {
    await twoJobs();
    expect(fake.action.badgeText).toBe('20');
  });

  it('sw: the title counts files across both downloads', async () => {
    await twoJobs();
    expect(fake.action.title).toBe('Helper for Pixiv — 20 files remaining across 2 downloads');
  });

  it('sw: both jobs fetch at once, five files each', async () => {
    const { offscreen } = await twoJobs();
    const pages = offscreen.commandsOf('off/fetchBytes').map((c) => String(c.url));
    expect([
      pages.filter((u) => u.includes(`/${A}_p`)).length,
      pages.filter((u) => u.includes(`/${B}_p`)).length,
    ]).toEqual([4, 4]);
  });

  it('sw: when one job ends the badge keeps counting the other', async () => {
    const { offscreen, tabB } = await twoJobs();
    await finishB(offscreen, tabB);
    expect([fake.action.badgeText, fake.action.title]).toEqual([
      '12',
      'Helper for Pixiv — 12 files remaining',
    ]);
  });

  it('sw: job B ends saved into its own folder', async () => {
    const { offscreen, tabB } = await twoJobs();
    await finishB(offscreen, tabB);
    expect(tabB.ended()?.outcome).toEqual({
      type: 'saved',
      folder: `pixiv/そら-${B}`,
      pages: 8,
    });
  });

  it('sw: each tab gets only its own job’s views', async () => {
    const { tabA, jobA } = await twoJobs();
    expect(tabA.views.every((view) => view.jobId === jobA)).toBe(true);
  });

  it('sw: job/listForTab lists only the jobs that tab started', async () => {
    const { tabA, jobA } = await twoJobs();
    const response = (await settle(tabA.send({ type: 'job/listForTab' }))) as JobListForTabResponse;
    expect(response.ok ? response.views.map((v) => v.jobId) : null).toEqual([jobA]);
  });

  it('sw: cancelling one job drops the badge by its remaining count only', async () => {
    const { tabA, jobA } = await twoJobs();
    await settle(tabA.send({ type: 'job/cancel', jobId: jobA }));
    await advance(100);
    expect([fake.action.badgeText, fake.action.title]).toEqual([
      '8',
      'Helper for Pixiv — 8 files remaining',
    ]);
  });

  it('sw: with the last job cancelled the badge hides and the title is idle', async () => {
    const { offscreen, tabA, tabB, jobA } = await twoJobs();
    await finishB(offscreen, tabB);
    await settle(tabA.send({ type: 'job/cancel', jobId: jobA }));
    await advance(100);
    expect([fake.action.badgeText, fake.action.title]).toEqual([
      '',
      'Helper for Pixiv — click to open settings',
    ]);
  });

  it('sw: the same artwork in two tabs counts twice', async () => {
    new ScriptedOffscreen(fake, { auto: false });
    await bootSw();
    const first = new ContentTab(fake, `https://www.pixiv.net/artworks/${A}`, api());
    const second = new ContentTab(fake, `https://www.pixiv.net/artworks/${A}`, api());
    await start(first, A, 12);
    await start(second, A, 12);
    await advance(100);
    expect([fake.action.badgeText, fake.action.title]).toEqual([
      '24',
      'Helper for Pixiv — 24 files remaining across 2 downloads',
    ]);
  });
});
