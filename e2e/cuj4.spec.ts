// CUJ-4 end to end on the fake pixiv: follow several downloads at once from the toolbar badge.
//
// AC → test (docs/prd/prd-000-mvp.md, CUJ-4 "Acceptance Criteria"):
// | AC                                                                          | Test                  |
// | --------------------------------------------------------------------------- | --------------------- |
// | 1  Two jobs (18 + 5 remaining): badge `23`, #1f1f1f / white, tooltip        | 'two jobs'            |
// |    `Helper for Pixiv — 23 files remaining across 2 downloads`               |                       |
// | 2  One job: `… — 5 files remaining` / `… — 1 file remaining`                | 'cancel one job'      |
// | 3  Each tab's button shows only its own artwork's progress                  | 'two jobs', 'cancel   |
// |                                                                             | one job'              |
// | 4  Badge decreases within 1 s of any file landing, from any job             | 'two jobs'            |
// | 5  A second artwork starts at once; neither job waits for the other         | 'two jobs'            |
// | 6  Cancelling one job stops only its files; badge drops by its remainder    | 'cancel one job'      |
// | 7  Last file lands / last job cancelled or fails → badge gone, idle title   | lands: 'two jobs',    |
// |                                                                             | 'cancel one job';     |
// |                                                                             | cancelled: cuj1       |
// |                                                                             | 'cancel'; 'failed'    |
// | 8  ≥ 1000 shows `999+`                                                      | L1: test/unit/        |
// |                                                                             | background/badge.test |
// | 9  SW stopped mid-job: badge correct within 1 s of the restart, jobs finish | 'service worker'      |
// | 10 Toolbar click while jobs run opens settings, jobs unaffected             | 'toolbar' (needs the  |
// |                                                                             | 4.2 e2e hook)         |
// | Edge case: same artwork in two tabs → 24, "across 2 downloads", ` (1)`      | 'same artwork in two  |
// |                                                                             | tabs'                 |
//
// The PRD's 30-page manga has no fixture: tab A runs the 200-page manga 135882743 with its last 18
// originals held in flight (server.hold), tab B runs 136120877 (8 pages) with its last 5 held,
// which gives exactly the PRD's 18 + 5 = 23.

import type { Page } from '@playwright/test';
import { requireWork, type IllustWork } from './fixtures/works';
import {
  actionTitle,
  artworkFiles,
  badgeText,
  CLICK_GUARD_MS,
  downloadedPaths,
  expectBadge,
  fileName,
  IDLE_TITLE,
  openArtwork,
  pagesOf,
  range,
  TRANSITION_MS,
  waitForDownload,
} from './harness/flows';
import {
  buttonView,
  clickButton,
  hoverButton,
  waitForText,
  type ButtonView,
} from './harness/hfp-button';
import type { Harness } from './harness/launch';
import { expect, test } from './harness/test';
import type { FakePixiv, Hold } from './server/server';

const MANGA = requireWork('135882743') as IllustWork;
const TAB_B = requireWork('136120877') as IllustWork;
const EXAMPLE = requireWork('135882741') as IllustWork;
const SINGLE = requireWork('135882742') as IllustWork;
const MANGA_FOLDER = 'pixiv/まんが家-135882743';
const TAB_B_FOLDER = 'pixiv/そら-136120877';
const EXAMPLE_FOLDER = 'pixiv/みずき-135882741';
/** chrome.action colors as [r, g, b, a]: #1f1f1f and #FFFFFF (PRD §4.8). */
const BADGE_BACKGROUND = [31, 31, 31, 255];
const BADGE_TEXT = [255, 255, 255, 255];

function manyTitle(files: number, jobs: number): string {
  return `Helper for Pixiv — ${files} files remaining across ${jobs} downloads`;
}

function oneTitle(files: number): string {
  return files === 1
    ? 'Helper for Pixiv — 1 file remaining'
    : `Helper for Pixiv — ${files} files remaining`;
}

/** One hold per page, so files can be let through one at a time. */
function holdEach(
  server: FakePixiv,
  work: IllustWork,
  pages: readonly number[],
): Map<number, Hold> {
  return new Map(pages.map((page) => [page, server.hold(pagesOf(work, [page]))]));
}

function held(holds: Map<number, Hold>): number {
  return [...holds.values()].reduce((sum, hold) => sum + hold.held, 0);
}

/** Releases page `page`'s hold and waits for its file on disk. */
async function land(
  harness: Harness,
  holds: Map<number, Hold>,
  work: IllustWork,
  folder: string,
  page: number,
): Promise<void> {
  holds.get(page)?.release();
  await waitForDownload(harness, `${folder}/${fileName(work, page)}`);
}

/** Cancels the busy job in `page` with the mouse: leave, hover (Cancel face), click. */
async function cancelWithMouse(page: Page, startedAt: number): Promise<ButtonView> {
  await page.bringToFront();
  await hoverButton(page, false);
  await hoverButton(page, true);
  await page.waitForTimeout(TRANSITION_MS);
  const face = await waitForText(page, 'Cancel');
  await page.waitForTimeout(Math.max(0, startedAt + CLICK_GUARD_MS - Date.now()));
  await clickButton(page);
  await hoverButton(page, false);
  return face;
}

test.describe('CUJ-4: follow several downloads from the toolbar badge', { tag: '@cuj4' }, () => {
  test('two jobs: badge 23 across 2 downloads, per-tab progress, immediate start, per-file countdown', async ({
    harness,
    server,
  }) => {
    test.setTimeout(120_000);
    const holdA = holdEach(server, MANGA, range(182, 199));
    const holdB = holdEach(server, TAB_B, range(3, 7));

    const tabA = await openArtwork(harness, MANGA.id);
    await waitForText(tabA, 'Download · 200P');
    await clickButton(tabA);
    await waitForText(tabA, /^\d+ \/ 200$/);

    const tabB = await openArtwork(harness, TAB_B.id);
    await waitForText(tabB, 'Download · 8P');
    const clickedB = Date.now();
    await clickButton(tabB);
    // Job B does not wait for job A, which cannot finish while its last pages are held.
    const firstB = await server.waitForRequest(pagesOf(TAB_B, [0]));
    expect(firstB.at - clickedB).toBeLessThan(2_000);
    await waitForText(tabB, '3 / 8');
    expect((await buttonView(tabA)).ariaBusy).toBe('true');

    await waitForText(tabA, '182 / 200', { timeout: 60_000 });
    await expect.poll(() => held(holdA)).toBe(5);
    await expect.poll(() => held(holdB)).toBe(5);
    // Both jobs had files in flight at the same moment.
    expect(server.maxInFlight(MANGA.id)).toBe(5);
    expect(server.maxInFlight(TAB_B.id)).toBe(5);

    await expectBadge(harness, '23', manyTitle(23, 2));
    expect(await harness.swEval(() => chrome.action.getBadgeBackgroundColor({}))).toEqual(
      BADGE_BACKGROUND,
    );
    expect(await harness.swEval(() => chrome.action.getBadgeTextColor({}))).toEqual(BADGE_TEXT);
    expect((await buttonView(tabA)).text).toBe('182 / 200');
    expect((await buttonView(tabB)).text).toBe('3 / 8');

    // A file landing from either job takes the badge down within 1 s; the other tab is unmoved.
    await land(harness, holdB, TAB_B, TAB_B_FOLDER, 3);
    await expectBadge(harness, '22', manyTitle(22, 2));
    await waitForText(tabB, '4 / 8');
    expect((await buttonView(tabA)).text).toBe('182 / 200');

    await land(harness, holdA, MANGA, MANGA_FOLDER, 182);
    await expectBadge(harness, '21', manyTitle(21, 2));
    await waitForText(tabA, '183 / 200');
    expect((await buttonView(tabB)).text).toBe('4 / 8');

    // Job B ends: the one-job form takes over, counting job A's remainder.
    for (const page of range(4, 7)) await land(harness, holdB, TAB_B, TAB_B_FOLDER, page);
    await waitForText(tabB, 'Saved · 8P');
    await expectBadge(harness, '17', oneTitle(17));
    expect((await buttonView(tabA)).text).toBe('183 / 200');

    for (const hold of holdA.values()) hold.release();
    await waitForText(tabA, 'Saved · 200P', { timeout: 30_000 });
    await expectBadge(harness, '', IDLE_TITLE);
    const paths = await downloadedPaths(harness);
    expect(paths.filter((file) => file.startsWith(`${TAB_B_FOLDER}/`))).toEqual(
      artworkFiles(TAB_B, TAB_B_FOLDER, range(0, 7), true),
    );
    expect(paths.filter((file) => file.startsWith(`${MANGA_FOLDER}/`))).toEqual(
      artworkFiles(MANGA, MANGA_FOLDER, range(0, 199), true),
    );
  });

  test('cancel one job: only its files stop, the badge drops by its remainder, one-job titles', async ({
    harness,
    server,
  }) => {
    const holdA = server.hold(pagesOf(EXAMPLE, range(4, 11)));
    const holdB = holdEach(server, TAB_B, range(3, 7));

    const tabA = await openArtwork(harness, EXAMPLE.id);
    await waitForText(tabA, 'Download · 12P');
    const startedA = Date.now();
    await clickButton(tabA);
    await waitForText(tabA, '4 / 12');

    const tabB = await openArtwork(harness, TAB_B.id);
    await waitForText(tabB, 'Download · 8P');
    await clickButton(tabB);
    await waitForText(tabB, '3 / 8');
    await expect.poll(() => holdA.held).toBe(5);
    await expect.poll(() => held(holdB)).toBe(5);
    await expectBadge(harness, '13', manyTitle(13, 2));
    expect((await buttonView(tabA)).text).toBe('4 / 12');

    const cancelFace = await cancelWithMouse(tabA, startedA);
    expect(cancelFace.title).toBe('Cancel download');
    const cancelledAt = Date.now();
    const idle = await waitForText(tabA, 'Download · 12P');
    expect(idle.classes).not.toContain('error');
    // Dropped by job A's 8 remaining pages at once; job B keeps running untouched.
    await expectBadge(harness, '5', oneTitle(5));
    expect((await buttonView(tabB)).text).toBe('3 / 8');
    expect(held(holdB)).toBe(5);

    await land(harness, holdB, TAB_B, TAB_B_FOLDER, 3);
    await expectBadge(harness, '4', oneTitle(4));
    for (const page of range(4, 6)) await land(harness, holdB, TAB_B, TAB_B_FOLDER, page);
    await expectBadge(harness, '1', oneTitle(1));
    await waitForText(tabB, '7 / 8');
    await land(harness, holdB, TAB_B, TAB_B_FOLDER, 7);
    await waitForText(tabB, 'Saved · 8P');
    await expectBadge(harness, '', IDLE_TITLE);

    expect(
      server.requests(pagesOf(EXAMPLE, range(0, 11))).filter((r) => r.at > cancelledAt),
    ).toEqual([]);
    const paths = await downloadedPaths(harness);
    expect(paths.filter((file) => file.startsWith(`${EXAMPLE_FOLDER}/`))).toEqual(
      artworkFiles(EXAMPLE, EXAMPLE_FOLDER, range(0, 3), true),
    );
    expect(paths.filter((file) => file.startsWith(`${TAB_B_FOLDER}/`))).toEqual(
      artworkFiles(TAB_B, TAB_B_FOLDER, range(0, 7), true),
    );
  });

  test('same artwork in two tabs: two jobs, both counted, the second run uniquified', async ({
    harness,
    server,
  }) => {
    const hold = server.hold(pagesOf(EXAMPLE, range(0, 11)));
    const tabA = await openArtwork(harness, EXAMPLE.id);
    await waitForText(tabA, 'Download · 12P');
    await clickButton(tabA);
    await waitForText(tabA, '0 / 12');
    const tabB = await openArtwork(harness, EXAMPLE.id);
    await waitForText(tabB, 'Download · 12P');
    await clickButton(tabB);
    await waitForText(tabB, '0 / 12');
    await expect.poll(() => hold.held).toBe(10);
    await expectBadge(harness, '24', manyTitle(24, 2));

    hold.release();
    await waitForText(tabA, 'Saved · 12P');
    await waitForText(tabB, 'Saved · 12P');
    await expectBadge(harness, '', IDLE_TITLE);
    const firstRun = artworkFiles(EXAMPLE, EXAMPLE_FOLDER, range(0, 11), true);
    const secondRun = firstRun.map((file) => file.replace(/(\.\w+)$/, ' (1)$1'));
    expect(await downloadedPaths(harness)).toEqual([...firstRun, ...secondRun].sort());
  });

  test('failed: when the last job fails the badge disappears and the idle title returns', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(/status of 404/);
    server.fault({ match: `/${fileName(SINGLE, 0)}`, responses: 404 });
    const page = await openArtwork(harness, SINGLE.id);
    await waitForText(page, 'Download');
    await clickButton(page);
    await expect.poll(async () => (await buttonView(page)).classes).toContain('error');
    await expectBadge(harness, '', IDLE_TITLE);
  });

  test('service worker: stopped mid-job, the badge is right within 1 s of the restart and both jobs finish', async ({
    harness,
    server,
  }) => {
    const holdA = holdEach(server, EXAMPLE, range(5, 11));
    const holdB = server.hold(pagesOf(TAB_B, range(3, 7)));

    const tabA = await openArtwork(harness, EXAMPLE.id);
    await waitForText(tabA, 'Download · 12P');
    await clickButton(tabA);
    await waitForText(tabA, '5 / 12');
    const tabB = await openArtwork(harness, TAB_B.id);
    await waitForText(tabB, 'Download · 8P');
    await clickButton(tabB);
    await waitForText(tabB, '3 / 8');
    await expect.poll(() => held(holdA)).toBe(5);
    await expect.poll(() => holdB.held).toBe(5);
    await expectBadge(harness, '12', manyTitle(12, 2));

    await harness.stopServiceWorker();
    expect(await harness.isServiceWorkerRunning()).toBe(false);
    // The offscreen document finishing page 5 wakes the worker, which must pick the jobs up.
    await land(harness, holdA, EXAMPLE, EXAMPLE_FOLDER, 5);
    await expectBadge(harness, '11', manyTitle(11, 2));
    await waitForText(tabA, '6 / 12');

    await harness.stopServiceWorker();
    expect(await harness.isServiceWorkerRunning()).toBe(false);
    for (const hold of holdA.values()) hold.release();
    holdB.release();
    await waitForText(tabA, 'Saved · 12P');
    await waitForText(tabB, 'Saved · 8P');
    await expectBadge(harness, '', IDLE_TITLE);
    const paths = await downloadedPaths(harness);
    expect(paths.filter((file) => file.startsWith(`${EXAMPLE_FOLDER}/`))).toEqual(
      artworkFiles(EXAMPLE, EXAMPLE_FOLDER, range(0, 11), true),
    );
    expect(paths.filter((file) => file.startsWith(`${TAB_B_FOLDER}/`))).toEqual(
      artworkFiles(TAB_B, TAB_B_FOLDER, range(0, 7), true),
    );
  });

  test('toolbar: clicking the icon while jobs run opens settings and leaves the jobs alone', async ({
    harness,
    server,
  }) => {
    const hasHook = await harness.swEval(
      () => typeof (self as unknown as { __hfpTest?: unknown }).__hfpTest !== 'undefined',
    );
    if (!hasHook) {
      const reason =
        'no e2e toolbar trigger (self.__hfpTest.clickAction from task 4.2) in this build; Playwright cannot click the toolbar icon';
      console.log(`skipped: ${reason}`);
      test.skip(true, reason);
    }

    const hold = server.hold(pagesOf(EXAMPLE, range(3, 11)));
    const tab = await openArtwork(harness, EXAMPLE.id);
    await waitForText(tab, 'Download · 12P');
    await clickButton(tab);
    await waitForText(tab, '3 / 12');
    await expectBadge(harness, '9', oneTitle(9));

    const optionsUrl = `chrome-extension://${harness.extensionId}/options.html`;
    const opened = harness.context.waitForEvent('page', {
      predicate: (page) => page.url().startsWith(optionsUrl),
    });
    await harness.swEval(async () => {
      const hook = (self as unknown as { __hfpTest: { clickAction(tabId: number): unknown } })
        .__hfpTest;
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active?.id === undefined) throw new Error('no active tab');
      await hook.clickAction(active.id);
    });
    const options = await opened;
    await expect(options).toHaveTitle('Helper for Pixiv — Settings');

    expect(await badgeText(harness)).toBe('9');
    expect(await actionTitle(harness)).toBe(oneTitle(9));
    expect((await buttonView(tab)).text).toBe('3 / 12');
    hold.release();
    await waitForText(tab, 'Saved · 12P');
    await expectBadge(harness, '', IDLE_TITLE);
    expect(
      (await downloadedPaths(harness)).filter((file) => file.startsWith(`${EXAMPLE_FOLDER}/`)),
    ).toEqual(artworkFiles(EXAMPLE, EXAMPLE_FOLDER, range(0, 11), true));
  });
});
