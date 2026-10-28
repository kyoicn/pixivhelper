// CUJ-1 end to end on the fake pixiv: download an illustration or manga from the artwork page.
//
// AC → test (docs/prd/prd-000-mvp.md, CUJ-1 "Acceptance Criteria"):
// | AC                                                                         | Test                    |
// | -------------------------------------------------------------------------- | ----------------------- |
// | 1  Exactly one button, immediately left of Like, ≤ 500 ms after the row    | 'placement'             |
// | 2  `Download · 12P` (12 pages) / `Download` (single page)                  | 'placement'             |
// | 3  164 px in idle, busy, Cancel-hover, Saved; width never changes          | 'width'                 |
// |    (also when the metadata arrives after the row, PRD §4.7.2)              | 'width' (late metadata) |
// | 4  Folder: metadata.json + p0…p11, sizes = Content-Length                  | 'folder'                |
// | 5  metadata.json: 12 keys in order, literal non-ASCII, `\n` kept           | 'folder'                |
// | 6  Never more than 5 of this artwork's files in flight                     | 'in flight'             |
// | 7  `N / 12` only rises, up to `11 / 12`, then `Saved` directly             | 'counter and badge'     |
// |    (`12 / 12` never shown); metadata ≠ N                                   |                         |
// | 8  Cancel face after leaving once; cancel stops, keeps files, idle again   | 'cancel'                |
// | 9  `Saved · 12P`, white/blue border/check, tooltip with the folder         | 'saved'                 |
// | 10 SPA away and back shows Saved; reload shows `Download · 12P`            | 'saved'; with a job     |
// |    (edge cases: SPA away and back, or a reload, mid-job show the live job) | running: 'mid-job       |
// |                                                                            | navigation'             |
// | 11 Clicking `Saved · 12P` saves every file again into `<folder> (1)/`      | 're-download' (second   |
// |    with clean names; the first folder unchanged; face `Saved · 12P`,       | click)                  |
// |    tooltip and aria-label name `(1)`                                       |                         |
// | 12 A third run lands in `<folder> (2)/`                                    | 're-download' (third)   |
// | 13 First folder moved or deleted → the plain folder again, no new `(n)`    | 're-download' (moved)   |
// | 14 No parent folder of the pattern ever gets a ` (n)` suffix               | 're-download' (third,   |
// |                                                                            | moved)                  |
// | 15 History erased, files on disk → the plain folder with `p0 (1).jpg` …    | 're-download' (history  |
// |    and `metadata (1).json` (accepted limitation)                           | erased)                 |
// | 16 Closing the tab does not stop the job                                   | 'tab closed'            |
// | 17 Badge = pages not yet complete, gone at the end                         | 'counter and badge'     |
// | 18 Tab / Enter / Space, 2 px #0096FA focus ring, aria-busy while busy      | 'keyboard'              |
// | 19 Dark theme: identical fill, text, icon (focus ring #5fb9fb)             | 'dark theme'            |
// | 20 Pattern changed mid-job: running job keeps its folder (also CUJ-3 AC    | 'settings mid-job'      |
// |    "Changing a setting while a download runs …" for folder and metadata)   |                         |
// | Edge: gaps in the suffix series → the lowest free n                        | 're-download' (gap)     |
// | Edge: token-free pattern `pixiv`: artworks share `pixiv/`; a repeat of     | 're-download'           |
// |       the same artwork → `pixiv (1)/`                                      | (token-free)            |
// | (design) one `folder choice` debug line per job that found files of the    | every 're-download'     |
// |          artwork; never `folder check failed`                              | test                    |
//
// Files in flight are held with server.hold(): originals trickle until released, so a job can be
// stopped at any count without the e2e build's 300 ms stall timeout failing it.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pageBytes } from './fixtures/assets';
import { artworkUrl, originalUrl, requireWork, type IllustWork } from './fixtures/works';
import {
  artworkFiles,
  CLICK_GUARD_MS,
  downloadedPaths,
  downloadUi,
  downloadUiAfterBoot,
  downloadUiRestored,
  expectBadge,
  fileName,
  IDLE_TITLE,
  openArtwork,
  pagesOf,
  range,
  recordSwLog,
  restingView,
  TRANSITION_MS,
  uiCalls,
  type SwLogLine,
} from './harness/flows';
import {
  buttonCenter,
  buttonHasFocus,
  buttonRule,
  buttonView,
  clickButton,
  counts,
  exposeButton,
  HOST_TAG,
  hostConnectedAt,
  hoverButton,
  labelLog,
  recordHostConnection,
  waitForText,
  watchLabels,
  type ButtonView,
} from './harness/hfp-button';
import type { Page } from '@playwright/test';
import type { Harness } from './harness/launch';
import { expect, test } from './harness/test';
import { ROW_MARK, type FakeWindow } from './server/page';

const EXAMPLE = requireWork('135882741') as IllustWork;
const SINGLE = requireWork('135882742') as IllustWork;
const FOLDER = 'pixiv/みずき-135882741';
const ALL_PAGES = EXAMPLE.pages.map((_, page) => page);
const METADATA_KEYS = [
  'id',
  'title',
  'description',
  'userName',
  'userId',
  'createDate',
  'uploadDate',
  'pageCount',
  'illustType',
  'xRestrict',
  'tags',
  'url',
];
const BLUE = 'rgb(0, 150, 250)';
const WHITE = 'rgb(255, 255, 255)';
const CANCEL_GRAY = 'rgb(60, 64, 67)';

/** A parent folder with a ` (n)` suffix, e.g. `pixiv (1)/…`: no run ever writes one (PRD CUJ-1 AC). */
const PARENT_SUFFIX = /^pixiv \(\d+\)\//;
/** Long enough for a 12-page job on the fake server, which takes about 1 s. */
const SAVE_TIMEOUT = { timeout: 10_000 };

function expectedFiles(folder: string, pages: readonly number[], metadata: boolean): string[] {
  return artworkFiles(EXAMPLE, folder, pages, metadata);
}

/** The example's 13 files in each run `ns` (0 = the plain folder, n = `<folder> (n)`), sorted. */
function runFiles(...ns: number[]): string[] {
  return ns
    .flatMap((n) => expectedFiles(n === 0 ? FOLDER : `${FOLDER} (${n})`, ALL_PAGES, true))
    .sort();
}

/**
 * Clicks the example's button (idle or Saved) and waits until the downloads directory holds
 * exactly `expected` and the button reads `Saved · 12P` with its tooltip naming `folder`. Returns
 * the resting view.
 */
async function saveExample(
  harness: Harness,
  page: Page,
  folder: string,
  expected: readonly string[],
): Promise<ButtonView> {
  await clickButton(page);
  await expect.poll(() => downloadedPaths(harness), SAVE_TIMEOUT).toEqual([...expected].sort());
  await expect
    .poll(async () => {
      const { text, title } = await buttonView(page);
      return { text, title };
    })
    .toEqual({ text: 'Saved · 12P', title: `Saved to Downloads/${folder}` });
  return restingView(page);
}

/** Size and modification time of every file under `folder`, by path. */
async function fileStats(
  harness: Harness,
  folder: string,
): Promise<Record<string, { size: number; mtimeMs: number }>> {
  const files = (await harness.downloads.files()).filter((file) =>
    file.path.startsWith(`${folder}/`),
  );
  const entries = await Promise.all(
    files.map(async (file) => {
      const { mtimeMs } = await stat(path.join(harness.downloads.dir, file.path));
      return [file.path, { size: file.size, mtimeMs }] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * The SW logged one `folder choice` line for each job whose history search found files of the
 * artwork, naming the folders `chosen` in order, and never `folder check failed`. A job with no
 * such record (a first run, or after the history was erased) takes the plain folder at once and
 * logs nothing (design-download-engine.md "Folder choice").
 */
function expectFolderChoices(log: readonly SwLogLine[], chosen: readonly string[]): void {
  const choices = log.filter((line) => line.text.includes('folder choice'));
  expect(choices.map((line) => line.type)).toEqual(chosen.map(() => 'debug'));
  for (const [index, folder] of chosen.entries()) {
    // The logged object ends with `chosen`: `{artworkId: …, records: …, surviving: …, chosen: …}`.
    expect(choices[index]?.text).toContain(`chosen: ${folder}}`);
  }
  expect(log.filter((line) => line.text.includes('folder check failed'))).toEqual([]);
}

async function writeSettings(
  harness: Harness,
  settings: { folderPattern: string; saveMetadata: boolean },
): Promise<void> {
  await harness.swEval(async (next) => {
    // The record writeSettings() (src/shared/settings.ts) stores in both areas.
    const record = { v: 1, ugoiraOutput: 'mp4', ...next, updatedAt: Date.now() };
    await chrome.storage.sync.set({ settings: record });
    await chrome.storage.local.set({ settings: record });
  }, settings);
}

/** Every item in chrome.downloads, oldest first, with Chrome's start time in ms. */
async function startedItems(harness: Harness): Promise<Array<{ filename: string; at: number }>> {
  const items = await harness.swEval(async () =>
    (await chrome.downloads.search({})).map(({ filename, startTime }) => ({ filename, startTime })),
  );
  return items
    .map(({ filename, startTime }) => ({ filename, at: Date.parse(startTime) }))
    .sort((a, b) => a.at - b.at);
}

test.describe('CUJ-1: download an illustration or manga', { tag: '@cuj1' }, () => {
  test('placement: one button immediately left of Like within 500 ms; idle labels', async ({
    harness,
  }) => {
    const page = await harness.newPage();
    await recordHostConnection(page);
    await page.goto(artworkUrl(EXAMPLE.id));
    await exposeButton(page);
    const idle = await waitForText(page, 'Download · 12P');
    expect(idle.glyph).toBe('download');
    expect(idle.ariaLabel).toBe('Download all 12 original images of this artwork');
    expect(idle.title).toBeNull();

    const rowAt = await page.evaluate(
      (mark) => performance.getEntriesByName(mark)[0]?.startTime ?? null,
      ROW_MARK,
    );
    const hostAt = await hostConnectedAt(page);
    expect(rowAt).not.toBeNull();
    expect(hostAt).not.toBeNull();
    expect((hostAt ?? 0) - (rowAt ?? 0)).toBeGreaterThanOrEqual(0);
    expect((hostAt ?? 0) - (rowAt ?? 0)).toBeLessThanOrEqual(500);

    const layout = () =>
      page.evaluate(() => {
        const hosts = Array.from(document.getElementsByTagName('hfp-download'));
        const host = hosts[0];
        const row = document.querySelector('main section.row');
        const like = row?.querySelector(':scope > .like');
        if (!host || !row || !like) return null;
        const hostRect = host.getBoundingClientRect();
        const likeRect = like.getBoundingClientRect();
        // Row controls whose box starts at or right of the host: the nearest one is pixiv's Like.
        const toTheRight = Array.from(row.children)
          .filter((child) => child !== host)
          .map((child) => ({ child, left: child.getBoundingClientRect().left }))
          .filter(({ left }) => left >= hostRect.right - 0.5)
          .sort((a, b) => a.left - b.left);
        return {
          hosts: hosts.length,
          inRow: host.parentElement === row,
          // pixiv's row is row-reverse: left of Like on screen is after it in the DOM.
          domNeighborIsLike: host.previousElementSibling === like,
          nearestRightIsLike: toTheRight[0]?.child === like,
          hostRight: hostRect.right,
          likeLeft: likeRect.left,
        };
      });
    const placed = await layout();
    expect(placed).toMatchObject({
      hosts: 1,
      inRow: true,
      domNeighborIsLike: true,
      nearestRightIsLike: true,
    });
    expect(placed?.hostRight).toBeLessThanOrEqual(placed?.likeLeft ?? 0);

    // A React-style re-render of the row: re-inserted at once, never duplicated, same state.
    expect(await page.evaluate(() => (window as unknown as FakeWindow).__fake.rerenderRow())).toBe(
      true,
    );
    await expect.poll(layout, { timeout: 500, intervals: [25] }).toMatchObject({
      hosts: 1,
      inRow: true,
      domNeighborIsLike: true,
    });
    expect((await buttonView(page)).text).toBe('Download · 12P');

    // Single page, reached by pixiv's in-app navigation.
    await page.click(`a[data-spa][href="/artworks/${SINGLE.id}"]`);
    await expect
      .poll(async () => (await buttonView(page)).ariaLabel)
      .toBe('Download the original image of this artwork');
    await waitForText(page, 'Download');
    await expect.poll(layout).toMatchObject({ hosts: 1, inRow: true, domNeighborIsLike: true });
  });

  test('width: 164 px in idle, busy, Cancel-hover and Saved, never changing', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await page.evaluate(() => {
      const host = document.querySelector('hfp-download');
      const w = window as unknown as { __hfpWidths: number[] };
      w.__hfpWidths = [];
      if (host) {
        new ResizeObserver(() => w.__hfpWidths.push(host.getBoundingClientRect().width)).observe(
          host,
        );
      }
    });
    expect((await restingView(page)).width).toBe(164);

    const hold = server.hold(pagesOf(EXAMPLE, range(3, 11)));
    await clickButton(page);
    expect((await buttonView(page)).width).toBe(164);
    await waitForText(page, '3 / 12');
    const busy = await restingView(page);
    expect(busy.glyph).toBe('ring');
    expect(busy.width).toBe(164);

    await hoverButton(page, true);
    const cancelFace = await waitForText(page, 'Cancel');
    expect(cancelFace.width).toBe(164);

    hold.release();
    await hoverButton(page, false);
    expect((await waitForText(page, 'Saved · 12P')).width).toBe(164);
    await hoverButton(page, true);
    await page.waitForTimeout(TRANSITION_MS);
    const savedHover = await buttonView(page);
    expect(savedHover.text).toBe('Saved · 12P');
    expect(savedHover.width).toBe(164);

    const widths = await page.evaluate(
      () => (window as unknown as { __hfpWidths: number[] }).__hfpWidths,
    );
    expect(widths.every((width) => width === 164)).toBe(true);
  });

  test('width: late metadata keeps a 12-page illustration at 164 px throughout', async ({
    harness,
    server,
  }) => {
    // The render-time metadata trickles until released, so the action row renders first.
    const hold = server.hold('/ajax/illust/135882741');
    const page = await harness.newPage();
    await page.addInitScript((hostTag) => {
      const w = window as unknown as { __hfpWidths: number[] };
      w.__hfpWidths = [];
      const found = new MutationObserver(() => {
        const host = document.querySelector(hostTag);
        if (!host) return;
        found.disconnect();
        new ResizeObserver(() => w.__hfpWidths.push(host.getBoundingClientRect().width)).observe(
          host,
        );
      });
      found.observe(document, { childList: true, subtree: true });
    }, HOST_TAG);
    await page.goto(artworkUrl(EXAMPLE.id));
    await exposeButton(page);
    await waitForText(page, 'Download');
    await expect.poll(() => hold.held).toBe(1);
    const before = await restingView(page);
    expect([before.mode, before.text, before.width]).toEqual(['row', 'Download', 164]);

    hold.release();
    expect((await waitForText(page, 'Download · 12P')).width).toBe(164);
    // Room for a late re-measure to show up in the record.
    await page.waitForTimeout(TRANSITION_MS);
    const widths = await page.evaluate(
      () => (window as unknown as { __hfpWidths: number[] }).__hfpWidths,
    );
    expect([...new Set(widths)]).toEqual([164]);
  });

  test('folder: metadata.json and the 12 originals at their served sizes', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    await waitForText(page, 'Saved · 12P');

    const listing = await harness.downloads.files();
    expect(listing.map((file) => file.path)).toEqual(expectedFiles(FOLDER, ALL_PAGES, true));
    for (const page of ALL_PAGES) {
      const served = server
        .requests(originalUrl(EXAMPLE, page))
        .filter((request) => request.status === 200);
      expect(served).toHaveLength(1);
      const size = listing.find((file) => file.path === `${FOLDER}/${fileName(EXAMPLE, page)}`);
      // The fake server sends Content-Length = body length (`bytes`).
      expect(size?.size).toBe(served[0]?.bytes);
      expect(size?.size).toBe(pageBytes(EXAMPLE, page).length);
    }

    const raw = await readFile(path.join(harness.downloads.dir, FOLDER, 'metadata.json'), 'utf8');
    const metadata = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(metadata)).toEqual(METADATA_KEYS);
    expect(metadata).toEqual({
      id: EXAMPLE.id,
      title: '雨上がりの渋谷',
      description:
        '久しぶりに渋谷で雨。帰り道のスケッチを12枚まとめました。\nSketches from a rainy walk home through Shibuya & Harajuku.',
      userName: 'みずき',
      userId: '40285173',
      createDate: EXAMPLE.createDate,
      uploadDate: EXAMPLE.createDate,
      pageCount: 12,
      illustType: 0,
      xRestrict: 0,
      tags: [...EXAMPLE.tags],
      url: `https://www.pixiv.net/artworks/${EXAMPLE.id}`,
    });
    expect(raw).toContain('"userName": "みずき"');
    expect(raw).toContain('雨上がりの渋谷');
    expect(raw).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    expect(raw).toContain('まとめました。\\nSketches');
    expect(raw.startsWith(`{\n  "id": "${EXAMPLE.id}",\n`)).toBe(true);
  });

  test('in flight: never more than 5 of the artwork’s files at once', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const hold = server.hold(pagesOf(EXAMPLE, ALL_PAGES));
    await clickButton(page);
    await expect.poll(() => hold.held).toBe(5);
    // Nothing else starts while 5 are in flight.
    await page.waitForTimeout(600);
    expect(hold.held).toBe(5);
    expect(server.requests(pagesOf(EXAMPLE, ALL_PAGES))).toHaveLength(5);
    expect(server.requests(pagesOf(EXAMPLE, range(0, 4)))).toHaveLength(5);

    const inProgress = async (): Promise<number> =>
      harness.swEval(
        async (folder) =>
          (await chrome.downloads.search({ state: 'in_progress' })).filter((item) =>
            item.filename.includes(folder),
          ).length,
        '135882741',
      );
    const samples: number[] = [await inProgress()];
    hold.release();
    while ((await buttonView(page)).text !== 'Saved · 12P') samples.push(await inProgress());
    expect(Math.max(...samples)).toBeLessThanOrEqual(5);
    expect(server.maxInFlight(EXAMPLE.id)).toBe(5);
    expect(await downloadedPaths(harness)).toEqual(expectedFiles(FOLDER, ALL_PAGES, true));
  });

  test('counter and badge: N / 12 only rises, metadata.json never counts, badge = pages left', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await expectBadge(harness, '', IDLE_TITLE);
    await watchLabels(page);
    await page.evaluate(() => {
      const w = window as unknown as { __clickAt?: number };
      document.addEventListener('click', () => (w.__clickAt ??= performance.now()), true);
    });
    const first = server.hold(pagesOf(EXAMPLE, range(0, 10)));
    const last = server.hold(pagesOf(EXAMPLE, [11]));
    await clickButton(page);

    // metadata.json lands first and does not move the counter.
    await harness.downloads.waitForFile(`${FOLDER}/metadata.json`);
    await expect.poll(() => first.held).toBe(5);
    expect((await buttonView(page)).text).toBe('0 / 12');
    expect((await buttonView(page)).ariaBusy).toBe('true');
    await expectBadge(harness, '12', 'Helper for Pixiv — 12 files remaining');
    expect((await buttonView(page)).live).toBe('Downloading 12 pages');

    first.release();
    await waitForText(page, '11 / 12');
    await expectBadge(harness, '1', 'Helper for Pixiv — 1 file remaining');
    // The count holds at 11 while page 11 is in flight; its landing shows Saved directly.
    await expect.poll(() => last.held).toBe(1);
    await page.waitForTimeout(500);
    expect((await buttonView(page)).text).toBe('11 / 12');
    expect(await downloadedPaths(harness)).toEqual(expectedFiles(FOLDER, range(0, 10), true));

    const releasedAt = await page.evaluate(() => performance.now());
    last.release();
    await waitForText(page, 'Saved · 12P');
    await expectBadge(harness, '', IDLE_TITLE);
    expect(await downloadedPaths(harness)).toEqual(expectedFiles(FOLDER, ALL_PAGES, true));

    const log = await labelLog(page);
    const seen = counts(log, 12);
    expect(seen[0]).toBe(0);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(log.map(({ text }) => text)).not.toContain('12 / 12');
    expect(seen.at(-1)).toBe(11);
    expect(log.at(-1)?.text).toBe('Saved · 12P');
    // Saved · 12P directly follows 11 / 12 (R-006 rev. 3).
    expect(log.at(-2)?.text).toBe('11 / 12');
    // 0 / 12 within 100 ms of the click (PRD §4.7.5).
    const clickAt = await page.evaluate(
      () => (window as unknown as { __clickAt: number }).__clickAt,
    );
    const zero = log.find(({ text }) => text === '0 / 12');
    expect((zero?.at ?? Infinity) - clickAt).toBeLessThanOrEqual(100);
    // Neither 12 / 12 nor Saved before page 11 was let through.
    const early = log.filter(({ at }) => at < releasedAt).map(({ text }) => text);
    expect(early.filter((text) => text === '12 / 12' || text.startsWith('Saved'))).toEqual([]);
    expect(
      counts(
        log.filter(({ at }) => at < releasedAt),
        12,
      ).at(-1),
    ).toBe(11);
    expect((await buttonView(page)).live).toBe('Saved 12 pages');
  });

  test('cancel: Cancel face only after leaving once; stops the job, keeps landed files', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const hold = server.hold(pagesOf(EXAMPLE, range(5, 11)));
    await clickButton(page);
    // After the click: the guard runs from the page's click, not from before its dispatch.
    const clickedAt = Date.now();
    await waitForText(page, '5 / 12');
    await expect.poll(() => hold.held).toBe(5);
    await harness.downloads.waitForFile(`${FOLDER}/${fileName(EXAMPLE, 4)}`);

    // The pointer is still on the button from the starting click: progress, not Cancel.
    await page.waitForTimeout(TRANSITION_MS);
    const stillOver = await buttonView(page);
    expect(stillOver.text).toBe('5 / 12');
    expect(stillOver.style.backgroundColor).not.toBe(CANCEL_GRAY);

    await hoverButton(page, false);
    await hoverButton(page, true);
    await page.waitForTimeout(TRANSITION_MS);
    const cancelFace = await buttonView(page);
    expect(cancelFace.text).toBe('Cancel');
    expect(cancelFace.glyph).toBe('x');
    expect(cancelFace.style.backgroundColor).toBe(CANCEL_GRAY);
    expect(cancelFace.title).toBe('Cancel download');
    expect(cancelFace.width).toBe(164);

    await page.waitForTimeout(Math.max(0, clickedAt + CLICK_GUARD_MS - Date.now()));
    await watchLabels(page);
    await page.evaluate(() => {
      const w = window as unknown as { __clickAt?: number };
      document.addEventListener('click', () => (w.__clickAt ??= performance.now()), true);
    });
    const { x, y } = await buttonCenter(page);
    const cancelledAt = Date.now();
    await page.mouse.click(x, y);
    await hoverButton(page, false);
    const idle = await waitForText(page, 'Download · 12P');
    // Back to idle within 300 ms of the click (page clock).
    const clickAt = await page.evaluate(
      () => (window as unknown as { __clickAt: number }).__clickAt,
    );
    const idleAt = (await labelLog(page)).find(({ text }) => text === 'Download · 12P')?.at;
    expect((idleAt ?? Infinity) - clickAt).toBeLessThanOrEqual(300);
    expect(idle.classes).toContain('primary');
    expect(idle.classes).not.toContain('error');
    expect(idle.ariaBusy).toBeNull();
    expect(idle.glyph).toBe('download');
    expect(idle.live).toBe('Download cancelled');
    await expectBadge(harness, '', IDLE_TITLE);

    // Nothing of this artwork starts after the cancel; pages 10 and 11 never started.
    await page.waitForTimeout(1_000);
    const later = server
      .requests(pagesOf(EXAMPLE, ALL_PAGES))
      .filter((request) => request.at > cancelledAt);
    expect(later).toEqual([]);
    expect(server.requests(pagesOf(EXAMPLE, [10, 11]))).toEqual([]);
    const startedInChrome = await harness.swEval(
      async (since) =>
        (await chrome.downloads.search({ startedAfter: new Date(since).toISOString() })).map(
          (item) => item.filename,
        ),
      cancelledAt,
    );
    expect(startedInChrome).toEqual([]);
    expect(await downloadedPaths(harness)).toEqual(expectedFiles(FOLDER, range(0, 4), true));
    expect(await harness.swEval(() => chrome.storage.session.get(null))).toEqual({});
  });

  test('saved: Saved · 12P with its tooltip; SPA away and back keeps it; reload shows idle', async ({
    harness,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    await waitForText(page, 'Saved · 12P');
    const saved = await restingView(page);
    expect(saved).toMatchObject({
      text: 'Saved · 12P',
      glyph: 'check',
      title: `Saved to Downloads/${FOLDER}`,
      ariaLabel: `Saved 12 pages to Downloads/${FOLDER}. Click to download again.`,
      ariaBusy: null,
      width: 164,
    });
    expect(saved.classes).toContain('saved');
    expect(saved.style.backgroundColor).toBe(WHITE);
    expect(saved.style.color).toBe(BLUE);
    expect(saved.style.borderTop).toMatch(/^[\d.]+px solid rgb\(0, 150, 250\)$/);
    expect(saved.style.boxShadow).toBe('none');
    // Computed border widths snap to device pixels; the declared one is 1.5 px.
    expect(await buttonRule(page, '.pill.saved')).toMatchObject({
      'border-top-width': '1.5px',
      'border-top-style': 'solid',
    });

    await page.click(`a[data-spa][href="/artworks/${SINGLE.id}"]`);
    await waitForText(page, 'Download');
    await page.goBack();
    await expect.poll(() => page.url()).toBe(artworkUrl(EXAMPLE.id));
    const back = await waitForText(page, 'Saved · 12P');
    expect(back.title).toBe(`Saved to Downloads/${FOLDER}`);

    await page.reload();
    await exposeButton(page);
    const reloaded = await waitForText(page, 'Download · 12P');
    expect(reloaded.classes).toContain('primary');
    expect(reloaded.title).toBeNull();
  });

  test('mid-job navigation: SPA away and back, and a reload, show the running job', async ({
    harness,
    server,
  }) => {
    const hold = server.hold(pagesOf(EXAMPLE, range(4, 11)));
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    await waitForText(page, '4 / 12');

    await page.click(`a[data-spa][href="/artworks/${SINGLE.id}"]`);
    expect((await waitForText(page, 'Download')).ariaBusy).toBeNull();
    await page.goBack();
    expect((await waitForText(page, '4 / 12')).ariaBusy).toBe('true');

    // The reloaded document reattaches to the job still running in the background.
    await page.reload();
    await exposeButton(page);
    expect((await waitForText(page, '4 / 12')).ariaBusy).toBe('true');
    hold.release();
    await waitForText(page, 'Saved · 12P');
    await page.reload();
    await exposeButton(page);
    await waitForText(page, 'Download · 12P');
  });

  // CUJ-1 step 8, ACs 11–15 and the folder-choice edge cases (refined 2026-10-27; D15). Each case
  // gets a fresh browser, so its first downloads.search() always re-checks file existence; only
  // the moved-folder and gap cases wait out Chrome's 10 s re-check rate limit.
  test('re-download: the second click on Saved · 12P saves every file again into "<folder> (1)" with clean names; the first folder is untouched', async ({
    harness,
    server,
  }) => {
    const log = recordSwLog(harness);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await saveExample(harness, page, FOLDER, runFiles(0));
    const first = await fileStats(harness, FOLDER);

    const saved = await saveExample(harness, page, `${FOLDER} (1)`, runFiles(0, 1));
    expect(saved).toMatchObject({
      text: 'Saved · 12P',
      glyph: 'check',
      title: `Saved to Downloads/${FOLDER} (1)`,
      ariaLabel: `Saved 12 pages to Downloads/${FOLDER} (1). Click to download again.`,
      width: 164,
    });
    const listing = await harness.downloads.files();
    for (const p of ALL_PAGES) {
      const served = server
        .requests(originalUrl(EXAMPLE, p))
        .filter((request) => request.status === 200);
      expect(served).toHaveLength(2);
      const file = listing.find((entry) => entry.path === `${FOLDER} (1)/${fileName(EXAMPLE, p)}`);
      // The fake server sends Content-Length = body length (`bytes`).
      expect(file?.size).toBe(served[1]?.bytes);
      expect(file?.size).toBe(pageBytes(EXAMPLE, p).length);
    }
    expect(await fileStats(harness, FOLDER)).toEqual(first);
    expectFolderChoices(log, [`${FOLDER} (1)`]);
  });

  test('re-download: a third click goes to "(2)"; no parent folder of the pattern ever gets a suffix', async ({
    harness,
  }) => {
    const log = recordSwLog(harness);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await saveExample(harness, page, FOLDER, runFiles(0));
    await saveExample(harness, page, `${FOLDER} (1)`, runFiles(0, 1));
    const third = await saveExample(harness, page, `${FOLDER} (2)`, runFiles(0, 1, 2));
    expect(third.ariaLabel).toBe(
      `Saved 12 pages to Downloads/${FOLDER} (2). Click to download again.`,
    );
    expect(await downloadedPaths(harness)).not.toContainEqual(expect.stringMatching(PARENT_SUFFIX));
    expectFolderChoices(log, [`${FOLDER} (1)`, `${FOLDER} (2)`]);
  });

  test('re-download: after the first folder is moved away the next click uses the plain folder again, no "(3)"', async ({
    harness,
  }) => {
    const log = recordSwLog(harness);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await saveExample(harness, page, FOLDER, runFiles(0));
    await saveExample(harness, page, `${FOLDER} (1)`, runFiles(0, 1));
    await saveExample(harness, page, `${FOLDER} (2)`, runFiles(0, 1, 2));

    await harness.downloads.move(FOLDER, 'moved-away');
    await harness.downloads.expireExistenceCheck();
    const moved = artworkFiles(EXAMPLE, 'moved-away', ALL_PAGES, true);
    await saveExample(harness, page, FOLDER, [...moved, ...runFiles(0, 1, 2)]);
    const paths = await downloadedPaths(harness);
    expect(paths).not.toContainEqual(expect.stringMatching(/^pixiv\/みずき-135882741 \(3\)\//));
    expect(paths).not.toContainEqual(expect.stringMatching(PARENT_SUFFIX));
    expectFolderChoices(log, [`${FOLDER} (1)`, `${FOLDER} (2)`, FOLDER]);
  });

  test('re-download: gap: with the plain folder and "(2)" kept and "(1)" deleted, the next click uses "(1)"', async ({
    harness,
  }) => {
    const log = recordSwLog(harness);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await saveExample(harness, page, FOLDER, runFiles(0));
    await saveExample(harness, page, `${FOLDER} (1)`, runFiles(0, 1));
    await saveExample(harness, page, `${FOLDER} (2)`, runFiles(0, 1, 2));

    await harness.downloads.remove(`${FOLDER} (1)`);
    await harness.downloads.expireExistenceCheck();
    await saveExample(harness, page, `${FOLDER} (1)`, runFiles(0, 1, 2));
    expectFolderChoices(log, [`${FOLDER} (1)`, `${FOLDER} (2)`, `${FOLDER} (1)`]);
  });

  test('re-download: after Chrome’s download history is erased, the next click writes into the plain folder with " (1)" file names (accepted limitation)', async ({
    harness,
  }) => {
    const log = recordSwLog(harness);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await saveExample(harness, page, FOLDER, runFiles(0));
    await harness.downloads.eraseHistory();

    const duplicates = [
      ...ALL_PAGES.map((p) => fileName(EXAMPLE, p).replace(/(\.\w+)$/, ' (1)$1')),
      'metadata (1).json',
    ].map((name) => `${FOLDER}/${name}`);
    await saveExample(harness, page, FOLDER, [...runFiles(0), ...duplicates]);
    expectFolderChoices(log, []);
  });

  test('re-download: token-free pattern "pixiv": two artworks share pixiv/; a repeat of the first goes to "pixiv (1)"', async ({
    harness,
  }) => {
    const log = recordSwLog(harness);
    await writeSettings(harness, { folderPattern: 'pixiv', saveMetadata: true });
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const exampleRun = (folder: string) => expectedFiles(folder, ALL_PAGES, true);
    await saveExample(harness, page, 'pixiv', exampleRun('pixiv'));

    const other = await openArtwork(harness, SINGLE.id);
    await waitForText(other, 'Download');
    await clickButton(other);
    const shared = [
      ...exampleRun('pixiv'),
      `pixiv/${fileName(SINGLE, 0)}`,
      'pixiv/metadata (1).json',
    ];
    await expect.poll(() => downloadedPaths(harness)).toEqual(shared.sort());
    expect((await waitForText(other, 'Saved')).title).toBe('Saved to Downloads/pixiv');

    await saveExample(harness, page, 'pixiv (1)', [...shared, ...exampleRun('pixiv (1)')]);
    expectFolderChoices(log, ['pixiv (1)']);
  });

  test('tab closed: the job still completes and the badge counts down to empty', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const hold = server.hold(pagesOf(EXAMPLE, range(3, 11)));
    await clickButton(page);
    await waitForText(page, '3 / 12');
    await expect.poll(() => hold.held).toBe(5);
    await page.close();

    await expectBadge(harness, '9', 'Helper for Pixiv — 9 files remaining');
    hold.release();
    await harness.downloads.waitForFile(`${FOLDER}/${fileName(EXAMPLE, 11)}`);
    await expect
      .poll(() => downloadedPaths(harness))
      .toEqual(expectedFiles(FOLDER, ALL_PAGES, true));
    await expectBadge(harness, '', IDLE_TITLE);
    const completed = await harness.swEval(async () =>
      (await chrome.downloads.search({ state: 'complete' })).map((item) => item.filename),
    );
    expect(completed).toHaveLength(13);
  });

  test('keyboard: Tab reaches the button; Enter and Space activate; focus ring; aria-busy', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    for (let i = 0; i < 40 && !(await buttonHasFocus(page)); i++) await page.keyboard.press('Tab');
    expect(await buttonHasFocus(page)).toBe(true);
    const focused = await buttonView(page);
    expect(focused.style).toMatchObject({
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: BLUE,
      outlineOffset: '3px',
    });

    const hold = server.hold(pagesOf(EXAMPLE, range(2, 11)));
    await page.keyboard.press('Enter');
    const busy = await waitForText(page, '2 / 12');
    expect(busy.ariaBusy).toBe('true');
    expect(busy.ariaLabel).toBe('Downloading, 2 of 12 pages saved. Click to cancel.');
    expect(await buttonHasFocus(page)).toBe(true);

    await page.waitForTimeout(CLICK_GUARD_MS + 100);
    await page.keyboard.press('Space');
    const cancelled = await waitForText(page, 'Download · 12P');
    expect(cancelled.ariaBusy).toBeNull();

    await page.keyboard.press('Space');
    expect((await buttonView(page)).ariaBusy).toBe('true');
    hold.release();
    const saved = await waitForText(page, 'Saved · 12P');
    expect(saved.ariaBusy).toBeNull();
    expect(await buttonHasFocus(page)).toBe(true);

    // The ring is for keyboard focus only (:focus-visible), not when a mouse click focuses it.
    server.hold(pagesOf(EXAMPLE, ALL_PAGES));
    await page.mouse.click(5, 5);
    expect(await buttonHasFocus(page)).toBe(false);
    await clickButton(page);
    expect(await buttonHasFocus(page)).toBe(true);
    const clicked = await buttonView(page);
    expect(clicked.ariaBusy).toBe('true');
    expect(clicked.style.outlineStyle).toBe('none');
  });

  test('dark theme: fill, text and icon identical in every state; lighter focus ring', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const setTheme = async (theme: 'light' | 'dark') => {
      await page.evaluate((next) => (window as unknown as FakeWindow).__fake.setTheme(next), theme);
      await expect
        .poll(() =>
          page.evaluate(() => document.querySelector('hfp-download')?.getAttribute('data-theme')),
        )
        .toBe(theme);
    };
    const looks = async () => {
      const view = await restingView(page);
      return {
        text: view.text,
        glyph: view.glyph,
        icon: view.iconMarkup,
        width: view.width,
        backgroundColor: view.style.backgroundColor,
        color: view.style.color,
        borderTop: view.style.borderTop,
        boxShadow: view.style.boxShadow,
      };
    };
    const compareThemes = async () => {
      await setTheme('light');
      const light = await looks();
      await setTheme('dark');
      expect(await looks()).toEqual(light);
      return light;
    };

    expect((await compareThemes()).text).toBe('Download · 12P');
    const hold = server.hold(pagesOf(EXAMPLE, range(6, 11)));
    await clickButton(page);
    await waitForText(page, '6 / 12');
    expect((await compareThemes()).glyph).toBe('ring');
    hold.release();
    await waitForText(page, 'Saved · 12P');
    expect((await compareThemes()).text).toBe('Saved · 12P');

    await setTheme('dark');
    // Away from the button (the mouse click focused it), then back by keyboard.
    await page.mouse.click(5, 5);
    expect(await buttonHasFocus(page)).toBe(false);
    for (let i = 0; i < 40 && !(await buttonHasFocus(page)); i++) await page.keyboard.press('Tab');
    expect(await buttonHasFocus(page)).toBe(true);
    expect((await buttonView(page)).style).toMatchObject({
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'rgb(95, 185, 251)',
    });
  });

  test('settings mid-job: the running job keeps its folder and metadata choice; the next uses the new ones', async ({
    harness,
    server,
  }) => {
    await writeSettings(harness, { folderPattern: 'before/{artist}-{id}', saveMetadata: false });
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const hold = server.hold(pagesOf(EXAMPLE, range(2, 11)));
    await clickButton(page);
    await waitForText(page, '2 / 12');

    await writeSettings(harness, { folderPattern: 'after/{id}', saveMetadata: true });
    hold.release();
    const saved = await waitForText(page, 'Saved · 12P');
    expect(saved.title).toBe('Saved to Downloads/before/みずき-135882741');
    expect(await downloadedPaths(harness)).toEqual(
      expectedFiles('before/みずき-135882741', ALL_PAGES, false),
    );

    await hoverButton(page, false);
    await clickButton(page);
    await harness.downloads.waitForFile(`after/${EXAMPLE.id}/metadata.json`);
    const next = await waitForText(page, 'Saved · 12P');
    expect(next.title).toBe(`Saved to Downloads/after/${EXAMPLE.id}`);
    expect((await downloadedPaths(harness)).filter((file) => file.startsWith('after/'))).toEqual(
      expectedFiles(`after/${EXAMPLE.id}`, ALL_PAGES, true),
    );
  });
});

// Added by the QA gate (iteration 1): PRD preconditions and edge cases with no e2e check yet.
// | PRD                                                                          | Test                    |
// | ---------------------------------------------------------------------------- | ----------------------- |
// | Preconditions / NFR "pixiv themes": locale-prefixed `/en/artworks/<id>`      | 'locale-prefixed URL'   |
// | Edge case: no button on non-artwork pages (home, user profile)               | 'non-artwork pages'     |
// | §4.7.4 prefers-reduced-motion: no ring or background transitions             | 'reduced motion'        |
test.describe('CUJ-1: QA gate additions', { tag: '@cuj1' }, () => {
  test('locale-prefixed URL: /en/artworks/<id> gets the same button, placement and download', async ({
    harness,
  }) => {
    const page = await harness.newPage();
    await page.goto(`https://www.pixiv.net/en/artworks/${EXAMPLE.id}`);
    await exposeButton(page);
    const idle = await waitForText(page, 'Download · 12P');
    expect(idle).toMatchObject({ hosts: 1, mode: 'row', width: 164 });
    await clickButton(page);
    const saved = await waitForText(page, 'Saved · 12P');
    expect(saved.title).toBe(`Saved to Downloads/${FOLDER}`);
    expect(await downloadedPaths(harness)).toEqual(expectedFiles(FOLDER, ALL_PAGES, true));
    const raw = await readFile(path.join(harness.downloads.dir, FOLDER, 'metadata.json'), 'utf8');
    expect((JSON.parse(raw) as { url: string }).url).toBe(artworkUrl(EXAMPLE.id));
  });

  test('non-artwork pages: no button on the home or a user page; leaving an artwork removes it', async ({
    harness,
  }) => {
    const hosts = (page: import('@playwright/test').Page) =>
      page.evaluate(() => document.getElementsByTagName('hfp-download').length);
    const page = await harness.newPage();
    await page.goto('https://www.pixiv.net/');
    await page.waitForTimeout(1_000);
    expect(await hosts(page)).toBe(0);
    await page.goto(`https://www.pixiv.net/users/${'40285173'}`);
    await page.waitForTimeout(1_000);
    expect(await hosts(page)).toBe(0);

    await page.goto(artworkUrl(EXAMPLE.id));
    await exposeButton(page);
    await waitForText(page, 'Download · 12P');
    await page.click('a[data-spa][href="/users/40285173"]');
    await expect.poll(() => hosts(page)).toBe(0);
    // Past the 3 s fallback: no floating button off artwork routes either.
    await page.waitForTimeout(3_500);
    expect(await hosts(page)).toBe(0);
    await page.goBack();
    await expect.poll(() => hosts(page)).toBe(1);
    await waitForText(page, 'Download · 12P');
  });

  test('reduced motion: the pill and the progress ring have no transitions', async ({
    harness,
    server,
  }) => {
    const page = await harness.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(artworkUrl(EXAMPLE.id));
    await exposeButton(page);
    await waitForText(page, 'Download · 12P');
    const hold = server.hold(pagesOf(EXAMPLE, range(3, 11)));
    await clickButton(page);
    await waitForText(page, '3 / 12');
    const motion = await page.evaluate(() => {
      const root = (window as unknown as Record<string, ShadowRoot>)['__hfpButtonRoot'];
      const pill = root?.querySelector('button.pill:not(.measure)');
      const bar = root?.querySelector('.ring .bar');
      return {
        pill: pill ? getComputedStyle(pill).transitionDuration : null,
        bar: bar ? getComputedStyle(bar).transitionDuration : null,
      };
    });
    expect(motion).toEqual({ pill: '0s', bar: '0s' });
    hold.release();
    await waitForText(page, 'Saved · 12P');
  });
});

// Added by the QA gate (iteration 2): CUJ-1 edge cases with no e2e check yet.
// | PRD                                                                          | Test                     |
// | ---------------------------------------------------------------------------- | ------------------------ |
// | Edge "Long or punctuation-heavy artist names" (§4.4): `  Sora / 空 :: 2nd  ` | 'sanitized folder'       |
// |   → `Sora_空_2nd`; a name that sanitizes to nothing becomes `unknown`; the   |                          |
// |   folder never gets an empty segment (also names of only `~` / `.`)          |                          |
// | Edge "200-page manga": one width in every state (may exceed 164 px)          | '200 pages'              |
test.describe('CUJ-1: QA gate additions (iteration 2)', { tag: '@cuj1' }, () => {
  const PUNCT = requireWork('135882744') as IllustWork;
  const MANGA = requireWork('135882743') as IllustWork;

  async function saveInto(harness: Harness, id: string): Promise<string> {
    const page = await openArtwork(harness, id);
    await waitForText(page, /^Download/);
    await clickButton(page);
    const saved = await waitForText(page, /^Saved/);
    await page.close();
    return (saved.title ?? '').replace(/^Saved to Downloads\//, '');
  }

  test('sanitized folder: a punctuation-heavy artist, and artists of only "~" or "." resolve to unknown without losing a folder level', async ({
    harness,
    server,
  }) => {
    expect(await saveInto(harness, PUNCT.id)).toBe('pixiv/Sora_空_2nd-135882744');
    await writeSettings(harness, { folderPattern: 'pixiv/{artist}/{title}', saveMetadata: true });
    const folders: string[] = [];
    for (const artist of ['~', '...', '~.~', ' . ']) {
      server.patchWork(PUNCT.id, { userName: artist });
      folders.push(await saveInto(harness, PUNCT.id));
    }
    // Four saves of one artwork under one resolved folder: each repeat goes to the next sibling
    // (PRD §4.3 "Folder choice", D15).
    const unknown = 'pixiv/unknown/Punctuation_テスト_2nd';
    const siblings = [unknown, `${unknown} (1)`, `${unknown} (2)`, `${unknown} (3)`];
    expect(folders).toEqual(siblings);
    const files = await downloadedPaths(harness);
    expect(files.filter((file) => file.startsWith('pixiv/Sora_空_2nd-135882744/'))).toEqual(
      artworkFiles(PUNCT, 'pixiv/Sora_空_2nd-135882744', [0, 1], true),
    );
    for (const folder of siblings) {
      expect(files.filter((file) => file.startsWith(`${folder}/`))).toEqual(
        artworkFiles(PUNCT, folder, [0, 1], true),
      );
    }
    expect(files.filter((file) => file.startsWith('pixiv/unknown/'))).toHaveLength(12);
    // Nothing lands a level up, and only the last segment carries a suffix.
    expect(files.filter((file) => file.startsWith('pixiv/Punctuation'))).toEqual([]);
    expect(files.filter((file) => file.startsWith('pixiv/unknown ('))).toEqual([]);
  });

  test('200 pages: one width from Download · 200P through 0 / 200 … and Cancel to Saved · 200P', async ({
    harness,
    server,
  }) => {
    test.setTimeout(120_000);
    const page = await openArtwork(harness, MANGA.id);
    await waitForText(page, 'Download · 200P');
    await page.evaluate(() => {
      const host = document.querySelector('hfp-download');
      const w = window as unknown as { __hfpWidths: number[] };
      w.__hfpWidths = [];
      if (host) {
        new ResizeObserver(() => w.__hfpWidths.push(host.getBoundingClientRect().width)).observe(
          host,
        );
      }
    });
    const idle = await restingView(page);
    expect(idle.width).toBeGreaterThanOrEqual(164);

    const hold = server.hold(pagesOf(MANGA, range(195, 199)));
    await clickButton(page);
    await waitForText(page, '195 / 200', { timeout: 60_000 });
    expect((await restingView(page)).width).toBe(idle.width);
    await hoverButton(page, true);
    expect((await waitForText(page, 'Cancel')).width).toBe(idle.width);
    await hoverButton(page, false);
    hold.release();
    const saved = await waitForText(page, 'Saved · 200P', { timeout: 60_000 });
    expect(saved.width).toBe(idle.width);
    const widths = await page.evaluate(
      () => (window as unknown as { __hfpWidths: number[] }).__hfpWidths,
    );
    expect([...new Set(widths)]).toEqual([idle.width]);
    test.info().annotations.push({ type: '200-page width px', description: String(idle.width) });
  });
});

// Chrome's download UI while the job runs (R-005, iteration 3; restore point per R-006).
// | PRD                                                                          | Test                     |
// | ---------------------------------------------------------------------------- | ------------------------ |
// | AC "During a 12-page download Chrome's download bubble does not appear or    | 'download UI: 12 pages'  |
// |   animate for the first 12 files; exactly one animation accompanies the last |                          |
// |   file" (§4.1 #3, R-006): the UI is off before metadata.json reaches Chrome  |                          |
// |   and back on just before the last original does                             |                          |
// | Step 5 / edge "Chrome's own download UI": a job that ends without a final    | 'download UI: cancelled',|
// |   hand-off (a cancel, a failure) turns the UI back on as it ends (R-006)     | 'download UI: failed'    |
// Playwright cannot see Chrome's toolbar or bubble: the tests read what the SW asked Chrome for and
// what the real Chrome answered (`self.__hfpTest.downloadUi()`). The visual effect is an L5 check
// (docs/release-checklist.md) and the headed-only 'Chrome toolbar' tests below.
test.describe("CUJ-1: Chrome's download UI (R-005, R-006)", { tag: '@cuj1' }, () => {
  test('download UI: 12 pages: hidden before metadata.json reaches Chrome, back on just before p11 is handed to Chrome', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    const hold = server.hold(pagesOf(EXAMPLE, [11]));
    await clickButton(page);
    for (const file of expectedFiles(FOLDER, range(0, 10), true)) {
      await harness.downloads.waitForFile(file);
    }
    await expect.poll(() => hold.held).toBe(1);

    const during = await downloadUi(harness);
    expect(during.requested).toBe(false);
    expect(uiCalls(during.calls, base)).toEqual([{ enabled: false, ok: true }]);
    const others = await startedItems(harness);
    expect(others).toHaveLength(12);
    expect(others[0]?.filename.endsWith(`${path.sep}metadata.json`)).toBe(true);
    expect(during.calls[base]?.at).toBeLessThanOrEqual(others[0]?.at ?? -Infinity);

    hold.release();
    await waitForText(page, 'Saved · 12P');
    const after = await downloadUiRestored(harness);
    expect(after.requested).toBe(true);
    expect(uiCalls(after.calls, base)).toEqual([
      { enabled: false, ok: true },
      { enabled: true, ok: true },
    ]);
    const items = await startedItems(harness);
    const last = `${path.sep}${fileName(EXAMPLE, 11)}`;
    const p11 = items.find((item) => item.filename.endsWith(last));
    const restoreAt = after.calls[base + 1]?.at ?? Number.NaN;
    // chrome.downloads times are whole milliseconds, like Date.now() in the SW.
    expect(
      Math.max(...items.filter((item) => item !== p11).map((item) => item.at)),
    ).toBeLessThanOrEqual(restoreAt);
    expect(restoreAt).toBeLessThanOrEqual(p11?.at ?? Number.NEGATIVE_INFINITY);
    expect(await downloadedPaths(harness)).toEqual(expectedFiles(FOLDER, ALL_PAGES, true));
  });

  test('download UI: cancelled: Chrome’s UI is back on after the cancel', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    server.hold(pagesOf(EXAMPLE, range(5, 11)));
    await clickButton(page);
    const clickedAt = Date.now();
    await waitForText(page, '5 / 12');
    expect(uiCalls((await downloadUi(harness)).calls, base)).toEqual([
      { enabled: false, ok: true },
    ]);

    await hoverButton(page, false);
    await hoverButton(page, true);
    await waitForText(page, 'Cancel');
    await page.waitForTimeout(Math.max(0, clickedAt + CLICK_GUARD_MS - Date.now()));
    await clickButton(page);
    await hoverButton(page, false);
    await waitForText(page, 'Download · 12P');
    const after = await downloadUiRestored(harness);
    expect(uiCalls(after.calls, base)).toEqual([
      { enabled: false, ok: true },
      { enabled: true, ok: true },
    ]);
  });

  test('download UI: failed: every original answering 504 ends with Chrome’s UI back on', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(/status of 504/, /net::ERR_/, /Failed to fetch/, /\[hfp:/);
    server.fault({ match: 'https://i.pximg.net/img-original/', responses: 504 });
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    await clickButton(page);
    await waitForText(page, 'Retry', { timeout: 30_000 });
    const after = await downloadUiRestored(harness);
    expect(uiCalls(after.calls, base)).toEqual([
      { enabled: false, ok: true },
      { enabled: true, ok: true },
    ]);
  });
});

// Added by the QA gate (iteration 3): R-005 and R-004 S6 checks with no e2e yet.
// | PRD                                                                            | Test                   |
// | ------------------------------------------------------------------------------ | ---------------------- |
// | Step 5 (R-004 S6, R-005): cancelled files never reach Chrome, so neither       | 'download UI: cancel   |
// |   chrome://downloads nor the bubble shows "Canceled" entries; the UI comes     |   ordering'            |
// |   back after the cancel and no file of the job reaches Chrome after it         |                        |
// | Edge "A download the user starts themselves while a job runs" (R-005): it      | 'download UI: the      |
// |   completes and appears in chrome://downloads while the UI stays hidden; the   |   user's own download' |
// |   window ends just before the final hand-off (R-006)                           |                        |
test.describe('CUJ-1: QA gate additions (iteration 3)', { tag: '@cuj1' }, () => {
  test('download UI: cancel ordering: no Canceled entry in chrome.downloads, the UI back on, and nothing handed to Chrome after the restore', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    const hold = server.hold(pagesOf(EXAMPLE, range(5, 11)));
    await clickButton(page);
    const clickedAt = Date.now();
    await waitForText(page, '5 / 12');
    await expect.poll(() => hold.held).toBe(5);
    await hoverButton(page, false);
    await hoverButton(page, true);
    await waitForText(page, 'Cancel');
    await page.waitForTimeout(Math.max(0, clickedAt + CLICK_GUARD_MS - Date.now()));
    await clickButton(page);
    await hoverButton(page, false);
    await waitForText(page, 'Download · 12P');
    const after = await downloadUiRestored(harness);
    expect(uiCalls(after.calls, base)).toEqual([
      { enabled: false, ok: true },
      { enabled: true, ok: true },
    ]);
    // The held originals finish on the wire after the cancel; none of them may reach Chrome.
    hold.release();
    await page.waitForTimeout(1_000);
    const items = await harness.swEval(async () =>
      (await chrome.downloads.search({})).map(({ filename, state, error, startTime }) => ({
        name: filename.split(/[\\/]/).pop(),
        state,
        error: error ?? null,
        startTime,
      })),
    );
    expect(items.filter((item) => item.state !== 'complete')).toEqual([]);
    expect(items.map((item) => item.name).sort()).toEqual(
      ['metadata.json', ...range(0, 4).map((p) => fileName(EXAMPLE, p))].sort(),
    );
    const restoredAt = after.calls.at(-1)?.at ?? 0;
    expect(items.filter((item) => Date.parse(item.startTime) > restoredAt)).toEqual([]);
    expect(await downloadedPaths(harness)).toEqual(expectedFiles(FOLDER, range(0, 4), true));
  });

  test("download UI: the user's own download while a job runs completes and is listed; the UI stays hidden until the job ends", async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    const hold = server.hold(pagesOf(EXAMPLE, range(6, 11)));
    await clickButton(page);
    await waitForText(page, '6 / 12');

    const other = await harness.newPage();
    await other.goto('https://www.pixiv.net/users/40285173');
    await other.evaluate(() => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob(['the user’s own file\n'], { type: 'text/plain' }));
      link.download = 'users-own-download.txt';
      document.body.append(link);
      link.click();
    });
    await harness.downloads.waitForFile('users-own-download.txt');
    const own = await harness.swEval(async () =>
      (await chrome.downloads.search({ filenameRegex: 'users-own-download' })).map((item) => ({
        state: item.state,
        byExtension: item.byExtensionId ?? null,
      })),
    );
    expect(own).toEqual([{ state: 'complete', byExtension: null }]);
    // Still hidden: the user's download neither ends nor extends the job's window.
    const during = await downloadUi(harness);
    expect([during.requested, uiCalls(during.calls, base)]).toEqual([
      false,
      [{ enabled: false, ok: true }],
    ]);

    hold.release();
    await waitForText(page, 'Saved · 12P');
    const after = await downloadUiRestored(harness);
    expect(uiCalls(after.calls, base)).toEqual([
      { enabled: false, ok: true },
      { enabled: true, ok: true },
    ]);
    expect(await downloadedPaths(harness)).toEqual(
      [...expectedFiles(FOLDER, ALL_PAGES, true), 'users-own-download.txt'].sort(),
    );
  });
});

// Added by the QA gate (iteration 3): what Chrome's toolbar really shows (R-005, R-006), read from
// Chrome's own native-UI accessibility tree (chrome://accessibility → "Chrome Native UI"), since
// Playwright cannot capture the toolbar. Headless Chromium has no download UI at all, so both tests
// run only in headed Chromium (`HFP_HEADLESS=0`, the local default) and skip with a reason
// otherwise: after the job each test makes one control download from a page and skips if even that
// shows no button.
// | PRD                                                                            | Test                   |
// | ------------------------------------------------------------------------------ | ---------------------- |
// | AC "During a 12-page download Chrome's download bubble does not appear or      | 'toolbar: hidden'      |
// |   animate for the first 12 files" (R-006)                                      |                        |
// | AC "… exactly one animation accompanies the last file, after which the         | 'toolbar: back after   |
// |   bubble lists metadata.json and the 12 originals" (R-006); step 6 "Chrome's   |   Saved'               |
// |   downloads button is back in its toolbar"                                     |                        |
test.describe('CUJ-1: QA gate additions (iteration 3), Chrome toolbar', { tag: '@cuj1' }, () => {
  interface Toolbar {
    /** Accessible name of Chrome's visible downloads toolbar button, or null when there is none. */
    button: string | null;
    bubbleOpen: boolean;
    bubbleRows: string[];
  }

  async function openNativeTree(harness: Harness): Promise<Page> {
    const page = await harness.newPage();
    await page.goto('chrome://accessibility');
    await page.locator('#native').check();
    return page;
  }

  async function toolbar(tree: Page): Promise<Toolbar> {
    await tree.locator('button[id^="browser_"][id$="-showOrRefreshTree"]').first().click();
    await tree.waitForTimeout(1_000);
    const lines = (await tree.evaluate(() => document.body.innerText)).split('\n');
    const name = (line: string): string => / name=(.*?) name_from/.exec(line)?.[1] ?? '';
    const visible = (line: string): boolean => !line.includes('INVISIBLE');
    const button = lines.find(
      (line) =>
        /class_name=(DownloadToolbarButtonView|PinnedActionToolbarButton)\b/.test(line) &&
        /download/i.test(name(line)) &&
        visible(line),
    );
    return {
      button: button === undefined ? null : name(button),
      bubbleOpen: lines.some(
        (line) =>
          /class_name=DownloadBubble(Contents|Partial|Primary)View\b/.test(line) && visible(line),
      ),
      bubbleRows: lines
        .filter((line) => line.includes('class_name=DownloadBubbleTransparentButton'))
        .map((line) => name(line).split(' ')[0] ?? ''),
    };
  }

  /** Skips the test when even a download the page starts shows no downloads button. */
  async function skipWithoutDownloadUi(harness: Harness, tree: Page): Promise<Toolbar> {
    const other = await harness.newPage();
    await other.goto('https://www.pixiv.net/users/40285173');
    await other.evaluate(() => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob(['control']));
      link.download = 'control-download.txt';
      document.body.append(link);
      link.click();
    });
    await harness.downloads.waitForFile('control-download.txt');
    await other.waitForTimeout(1_000);
    const control = await toolbar(tree);
    test.skip(
      control.button === null,
      'this Chromium shows no download UI at all (headless): run with HFP_HEADLESS=0',
    );
    return control;
  }

  test('toolbar: hidden: no downloads button and no bubble while a 12-page job runs', async ({
    harness,
    server,
  }) => {
    const tree = await openNativeTree(harness);
    const hold = server.hold(pagesOf(EXAMPLE, range(6, 11)));
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    await waitForText(page, '6 / 12');
    const during = await toolbar(tree);
    hold.release();
    await waitForText(page, 'Saved · 12P');
    await downloadUiRestored(harness);
    await skipWithoutDownloadUi(harness, tree);
    expect(during).toEqual({ button: null, bubbleOpen: false, bubbleRows: [] });
  });

  test('toolbar: back after Saved: Chrome’s downloads button is in the toolbar again once the job has ended', async ({
    harness,
  }) => {
    const tree = await openNativeTree(harness);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    await waitForText(page, 'Saved · 12P');
    await downloadUiRestored(harness);
    await page.waitForTimeout(3_000);
    const after = await toolbar(tree);
    if (after.button === null) await skipWithoutDownloadUi(harness, tree);
    expect(after.button, 'Chrome’s downloads button after Saved · 12P').not.toBeNull();
  });
});

// Added by the QA gate (iteration 3, retry 1): R-006 checks with no e2e yet.
// | PRD                                                                            | Test                   |
// | ------------------------------------------------------------------------------ | ---------------------- |
// | AC "… exactly one animation accompanies the last file" (R-006, §4.1 #3), when  | 'download UI: last     |
// |   the last files land together (no page held back): every earlier file is in  |   files land together' |
// |   Chrome before the UI comes back, and only the last file starts after it      |                        |
// | §4.1 #3 (R-006): a single-image work ends with exactly one animation, with its | 'download UI: single   |
// |   image; with metadata off the image is the job's only file, so the UI is      |   image' (2 tests)     |
// |   never turned off                                                             |                        |
// Whether Chrome had also named each earlier file (where it decides to animate) cannot be read
// reliably from here: its onChanged filename delta can reach a listener after the
// downloads.search answer the engine waits on. The headed 'Chrome toolbar' tests below check the
// visible result instead.
test.describe('CUJ-1: QA gate additions (iteration 3, retry 1)', { tag: '@cuj1' }, () => {
  interface Item {
    id: number;
    name: string;
    startedAt: number;
  }

  /** Chrome's download items in creation order (ids rise with creation). */
  async function items(harness: Harness): Promise<Item[]> {
    const list = await harness.swEval(async () =>
      (await chrome.downloads.search({})).map(({ id, filename, startTime }) => ({
        id,
        name: filename.split(/[\\/]/).pop() ?? '',
        startedAt: Date.parse(startTime),
      })),
    );
    return list.sort((a, b) => a.id - b.id);
  }

  test('download UI: last files land together: every earlier file is in Chrome before the UI comes back; only the last file starts after it', async ({
    harness,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    await clickButton(page);
    await waitForText(page, 'Saved · 12P');
    const after = await downloadUiRestored(harness);
    expect(uiCalls(after.calls, base)).toEqual([
      { enabled: false, ok: true },
      { enabled: true, ok: true },
    ]);
    const hideAt = after.calls[base]?.at ?? Number.POSITIVE_INFINITY;
    const restoreAt = after.calls[base + 1]?.at ?? Number.NaN;
    const all = await items(harness);
    expect(all).toHaveLength(13);
    const last = all.at(-1);
    // chrome.downloads and the SW's Date.now() share the clock, in whole milliseconds.
    expect(Math.min(...all.map((item) => item.startedAt))).toBeGreaterThanOrEqual(hideAt);
    expect(
      all
        .slice(0, -1)
        .filter((item) => item.startedAt > restoreAt)
        .map((item) => item.name),
      'files that reached Chrome only after the UI came back',
    ).toEqual([]);
    expect(restoreAt).toBeLessThanOrEqual(last?.startedAt ?? Number.NEGATIVE_INFINITY);
    expect(await downloadedPaths(harness)).toEqual(expectedFiles(FOLDER, ALL_PAGES, true));
  });

  test('download UI: single image: off before metadata.json, back on just before the image is handed to Chrome', async ({
    harness,
  }) => {
    const page = await openArtwork(harness, SINGLE.id);
    await waitForText(page, 'Download');
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    await clickButton(page);
    await waitForText(page, 'Saved');
    const after = await downloadUiRestored(harness);
    expect(uiCalls(after.calls, base)).toEqual([
      { enabled: false, ok: true },
      { enabled: true, ok: true },
    ]);
    const restoreAt = after.calls[base + 1]?.at ?? Number.NaN;
    const [metadata, image] = await items(harness);
    expect([metadata?.name, image?.name]).toEqual(['metadata.json', fileName(SINGLE, 0)]);
    expect(metadata?.startedAt).toBeGreaterThanOrEqual(after.calls[base]?.at ?? Infinity);
    expect(metadata?.startedAt).toBeLessThanOrEqual(restoreAt);
    expect(restoreAt).toBeLessThanOrEqual(image?.startedAt ?? Number.NEGATIVE_INFINITY);
  });

  test('download UI: single image, metadata off: the image is the only file, so Chrome’s UI is never turned off', async ({
    harness,
  }) => {
    await writeSettings(harness, { folderPattern: 'pixiv/{artist}-{id}', saveMetadata: false });
    const page = await openArtwork(harness, SINGLE.id);
    await waitForText(page, 'Download');
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    await clickButton(page);
    await waitForText(page, 'Saved');
    await expect
      .poll(async () => (await items(harness)).map((item) => item.name))
      .toEqual([fileName(SINGLE, 0)]);
    // Give a stray call time to show up before asserting there is none.
    await page.waitForTimeout(500);
    const after = await downloadUi(harness);
    expect([after.requested, uiCalls(after.calls, base)]).toEqual([true, []]);
  });
});

// Chrome's native-UI tree poller shared by the headed-only toolbar blocks below.
interface Sample {
  at: number;
  /** Accessible name of a visible downloads toolbar button, or null. */
  button: string | null;
  bubbleOpen: boolean;
  rows: string[];
}

/** Opens chrome://accessibility with the native tree on and starts the poller. */
async function startTree(harness: Harness): Promise<Page> {
  const tree = await harness.newPage();
  await tree.goto('chrome://accessibility');
  const native = tree.locator('#native');
  // Turning it on reloads the page; headed Chromium may have it on already.
  if (!(await native.isChecked())) {
    await Promise.all([tree.waitForEvent('load'), native.check()]);
  }
  await tree.locator('[id^="browser_"]').first().waitFor();
  await tree.evaluate(() => {
    const scope = window as unknown as {
      __qaSamples: Sample[];
      __qaPolling: boolean;
      chrome: { send(message: string, args: unknown[]): void };
    };
    const sessions = [...document.querySelectorAll('[id^="browser_"]')]
      .map((row) => row.id)
      .filter((id) => /^browser_\d+$/.test(id))
      .map((id) => Number(id.slice('browser_'.length)));
    const name = (line: string): string => / name=(.*?) name_from/.exec(line)?.[1] ?? '';
    const visible = (line: string): boolean => !line.includes('INVISIBLE');
    const read = (sessionId: number): Promise<string> =>
      new Promise((resolve) => {
        const row = document.getElementById(`browser_${sessionId}`);
        if (!row) return resolve('');
        const timer = setTimeout(() => {
          observer.disconnect();
          resolve('');
        }, 2_000);
        const observer = new MutationObserver(() => {
          const pre = document.getElementById(`browser_${sessionId}-tree`);
          if ((pre?.textContent ?? '').length > 100) {
            observer.disconnect();
            clearTimeout(timer);
            resolve(pre!.innerText);
          }
        });
        observer.observe(row, { childList: true, subtree: true });
        scope.chrome.send('requestNativeUITree', [
          {
            sessionId,
            requestType: 'showOrRefreshTree',
            filters: { allow: '*', allowEmpty: '', deny: '' },
          },
        ]);
      });
    scope.__qaSamples = [];
    scope.__qaPolling = true;
    void (async () => {
      while (scope.__qaPolling) {
        const at = Date.now();
        const lines = (await Promise.all(sessions.map(read))).join('\n').split('\n');
        const button = lines.find(
          (line) =>
            /class_name=(DownloadToolbarButtonView|PinnedActionToolbarButton)\b/.test(line) &&
            /download/i.test(name(line)) &&
            visible(line),
        );
        scope.__qaSamples.push({
          at,
          button: button === undefined ? null : name(button),
          bubbleOpen: lines.some(
            (line) =>
              /class_name=DownloadBubble(Contents|Partial|Primary)View\b/.test(line) &&
              visible(line),
          ),
          rows: lines
            .filter((line) => line.includes('class_name=DownloadBubbleTransparentButton'))
            .map((line) => name(line).split(' ')[0] ?? ''),
        });
      }
    })();
  });
  return tree;
}

function samples(tree: Page): Promise<Sample[]> {
  return tree.evaluate(() => (window as unknown as { __qaSamples: Sample[] }).__qaSamples);
}

const shown = (sample: Sample): boolean => sample.button !== null || sample.bubbleOpen;

/** Times at which the button or bubble went from hidden to shown, at or after `since`. */
function appearances(list: readonly Sample[], since: number): number[] {
  return list.flatMap((sample, index) =>
    sample.at >= since && shown(sample) && !(index > 0 && shown(list[index - 1]!))
      ? [sample.at]
      : [],
  );
}

/** A download from a page; resolves with the samples taken in the 1.5 s after it landed. */
async function controlDownload(harness: Harness, tree: Page, file: string): Promise<Sample[]> {
  const other = await harness.newPage();
  await other.goto('https://www.pixiv.net/users/40285173');
  const startedAt = Date.now();
  await other.evaluate((name) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['control']));
    link.download = name;
    document.body.append(link);
    link.click();
  }, file);
  await harness.downloads.waitForFile(file);
  await other.waitForTimeout(1_500);
  return (await samples(tree)).filter((sample) => sample.at >= startedAt);
}

// Added by the QA gate (iteration 3, retry 1): Chrome's toolbar under R-006, read from Chrome's
// native-UI accessibility tree polled every few milliseconds inside chrome://accessibility (the
// page's own 'requestNativeUITree' message), so an appearance of the downloads button between two
// files cannot fall between two reads. Headed only (`HFP_HEADLESS=0`): headless Chromium has no
// download UI, so each test skips when a control download from a page shows no button either.
// | PRD                                                                            | Test                   |
// | ------------------------------------------------------------------------------ | ---------------------- |
// | AC "… does not appear or animate for the first 12 files; exactly one           | 'toolbar: one          |
// |   animation accompanies the last file, after which the bubble lists            |   animation'           |
// |   metadata.json and the 12 originals" (R-006); step 6                          |                        |
// | Step 5 (R-006): after a cancel Chrome plays no animation and its downloads     | 'toolbar: cancel'      |
// |   button stays out of the toolbar until the next download                      |                        |
test.describe(
  'CUJ-1: QA gate additions (iteration 3, retry 1), Chrome toolbar',
  { tag: '@cuj1' },
  () => {
    test('toolbar: one animation: no downloads button until p11 is handed to Chrome, then it returns once, with a bubble listing metadata.json and the 12 originals', async ({
      harness,
      server,
    }) => {
      const tree = await startTree(harness);
      const hold = server.hold(pagesOf(EXAMPLE, [11]));
      const page = await openArtwork(harness, EXAMPLE.id);
      await waitForText(page, 'Download · 12P');
      const base = (await downloadUiAfterBoot(harness)).calls.length;
      const clickedAt = Date.now();
      await clickButton(page);
      await waitForText(page, '11 / 12');
      await expect.poll(() => hold.held).toBe(1);
      await page.waitForTimeout(500);
      hold.release();
      await waitForText(page, 'Saved · 12P');
      const after = await downloadUiRestored(harness);
      await page.waitForTimeout(2_000);
      const list = (await samples(tree)).filter((sample) => sample.at >= clickedAt);
      if (!list.some(shown)) {
        const control = await controlDownload(harness, tree, 'control-download.txt');
        test.skip(
          !control.some(shown),
          'this Chromium shows no download UI at all (headless): run with HFP_HEADLESS=0',
        );
      }
      const restoreAt = after.calls[base + 1]?.at ?? Number.NaN;
      // A read that starts a few ms before the change can still see it; one poll is ~5-10 ms.
      expect(
        list.filter((sample) => shown(sample) && sample.at < restoreAt - 20),
        'button or bubble before the UI came back',
      ).toEqual([]);
      expect(
        appearances(list, clickedAt),
        'times Chrome’s downloads button came back',
      ).toHaveLength(1);
      expect(list.at(-1)?.button, 'Chrome’s downloads button after Saved · 12P').not.toBeNull();
      const rows = new Set(list.flatMap((sample) => sample.rows));
      expect(
        ['metadata.json', ...ALL_PAGES.map((p) => fileName(EXAMPLE, p))].filter(
          (n) => !rows.has(n),
        ),
        'files missing from the bubble',
      ).toEqual([]);
    });

    test('toolbar: cancel: no animation, and Chrome’s downloads button stays out of the toolbar until the next download brings it back', async ({
      harness,
      server,
    }) => {
      const tree = await startTree(harness);
      const hold = server.hold(pagesOf(EXAMPLE, range(5, 11)));
      const page = await openArtwork(harness, EXAMPLE.id);
      await waitForText(page, 'Download · 12P');
      const since = Date.now();
      await clickButton(page);
      const clickedAt = Date.now();
      await waitForText(page, '5 / 12');
      await expect.poll(() => hold.held).toBe(5);
      await hoverButton(page, false);
      await hoverButton(page, true);
      await waitForText(page, 'Cancel');
      await page.waitForTimeout(Math.max(0, clickedAt + CLICK_GUARD_MS - Date.now()));
      await clickButton(page);
      await hoverButton(page, false);
      await waitForText(page, 'Download · 12P');
      await downloadUiRestored(harness);
      hold.release();
      await page.waitForTimeout(3_000);
      const sinceClick = (await samples(tree)).filter((sample) => sample.at >= since);
      const control = await controlDownload(harness, tree, 'next-download.txt');
      test.skip(
        !control.some(shown),
        'this Chromium shows no download UI at all (headless): run with HFP_HEADLESS=0',
      );
      expect(sinceClick.length).toBeGreaterThan(50);
      expect(sinceClick.filter(shown), 'button or bubble after the cancel').toEqual([]);
      expect(appearances(control, 0)).toHaveLength(1);
    });
  },
);

// Added by the QA gate (iteration 4): R-006 rev. 3 (quick-fix c2c9de0). The busy period's last
// hand-off now waits until every other in-progress file has FINISHED, not merely been named, so no
// earlier completion can open Chrome's bubble before the last file exists (the iteration-3 LOW).
// | PRD                                                                            | Test                   |
// | ------------------------------------------------------------------------------ | ---------------------- |
// | AC "… exactly one animation accompanies the last file, after which the bubble  | 'download UI: last     |
// |   lists metadata.json and the 12 originals" (R-006), with the last files       |   files land together, |
// |   landing together (no page held back)                                         |   finished'            |
// | AC "N / 12 … up to 11 / 12; the last original is handed to Chrome only after   | same test              |
// |   every other file has finished, so its landing turns the button to Saved      |                        |
// |   directly and 12 / 12 is never shown"; step 6 "Within 300 ms … Saved"         |                        |
/**
 * Wraps chrome.downloads.setUiOptions in the running worker to record when each call is ISSUED
 * (the test API's `at` is when Chrome answered, after the enable has taken effect). The engine
 * looks the API up at call time, so it goes through the wrapper; the real API still runs. Also
 * records when the worker heard each download complete (a listener added after the engine's, so
 * it runs in the same event dispatch, before any later task such as the restore's answer).
 */
async function recordUiIssues(harness: Harness): Promise<void> {
  await harness.swEval(() => {
    const scope = self as unknown as {
      __qaUiIssued?: Array<{ enabled: boolean; at: number }>;
      __qaHeardComplete?: Record<number, number>;
    };
    if (scope.__qaUiIssued) return;
    const issued: Array<{ enabled: boolean; at: number }> = [];
    scope.__qaUiIssued = issued;
    const heard: Record<number, number> = {};
    scope.__qaHeardComplete = heard;
    chrome.downloads.onChanged.addListener(({ id, state }) => {
      if (state?.current === 'complete') heard[id] ??= Date.now();
    });
    const downloads = chrome.downloads as unknown as {
      setUiOptions(options: chrome.downloads.UiOptions): Promise<void>;
    };
    const real = downloads.setUiOptions.bind(downloads);
    downloads.setUiOptions = (options) => {
      issued.push({ enabled: options.enabled, at: Date.now() });
      return real(options);
    };
  });
}

/** When the worker heard each download complete, by download id (recordUiIssues()). */
async function heardComplete(harness: Harness): Promise<Record<number, number>> {
  return harness.swEval(
    () =>
      (self as unknown as { __qaHeardComplete?: Record<number, number> }).__qaHeardComplete ?? {},
  );
}

/** When the last setUiOptions({ enabled: true }) recorded by recordUiIssues() was issued. */
async function restoreIssuedAt(harness: Harness): Promise<number> {
  const issued = await harness.swEval(
    () =>
      (self as unknown as { __qaUiIssued?: Array<{ enabled: boolean; at: number }> })
        .__qaUiIssued ?? [],
  );
  return issued.filter(({ enabled }) => enabled).at(-1)?.at ?? Number.NaN;
}

test.describe('CUJ-1: QA gate additions (iteration 4)', { tag: '@cuj1' }, () => {
  test('download UI: last files land together, finished: every earlier file has finished in Chrome before the UI comes back; the last file starts after it and its landing shows Saved · 12P within 300 ms, never 12 / 12', async ({
    harness,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await watchLabels(page);
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    await recordUiIssues(harness);
    await clickButton(page);
    await waitForText(page, 'Saved · 12P');
    const after = await downloadUiRestored(harness);
    expect(uiCalls(after.calls, base)).toEqual([
      { enabled: false, ok: true },
      { enabled: true, ok: true },
    ]);
    const restoreAt = after.calls[base + 1]?.at ?? Number.NaN;
    const issuedAt = await restoreIssuedAt(harness);
    expect(issuedAt).toBeLessThanOrEqual(restoreAt);
    const all = (
      await harness.swEval(async () =>
        (await chrome.downloads.search({})).map(({ id, filename, state, startTime, endTime }) => ({
          id,
          name: filename.split(/[\\/]/).pop() ?? '',
          state,
          startedAt: Date.parse(startTime),
          endedAt: endTime === undefined ? Number.NaN : Date.parse(endTime),
        })),
      )
    ).sort((a, b) => a.id - b.id);
    expect(all).toHaveLength(13);
    expect(all.filter((item) => item.state !== 'complete').map((item) => item.name)).toEqual([]);
    const last = all.at(-1)!;
    // chrome.downloads and the SW's Date.now() share the clock, in whole milliseconds. Chrome
    // stamps endTime before the worker hears of the completion, so <= the restore's issue time.
    expect(
      all
        .slice(0, -1)
        .filter((item) => !(item.endedAt <= issuedAt))
        .map((item) => item.name),
      'files still in progress when the UI restore was issued',
    ).toEqual([]);
    const heard = await heardComplete(harness);
    expect(
      all
        .slice(0, -1)
        .filter((item) => !((heard[item.id] ?? Infinity) <= restoreAt))
        .map((item) => item.name),
      'files the worker heard complete only after Chrome answered the restore',
    ).toEqual([]);
    expect(restoreAt).toBeLessThanOrEqual(last.startedAt);

    const origin = await page.evaluate(() => performance.timeOrigin);
    const log = await labelLog(page);
    const texts = log.map(({ text }) => text);
    expect(texts).not.toContain('12 / 12');
    expect(Math.max(...counts(log, 12))).toBeLessThanOrEqual(11);
    expect(texts.at(-1)).toBe('Saved · 12P');
    expect(texts.at(-2)).toMatch(/^\d+ \/ 12$/);
    const savedAt = origin + (log.at(-1)?.at ?? Number.NaN);
    // The page clock (timeOrigin + now) and the browser's can differ by a millisecond or two.
    expect(savedAt).toBeGreaterThanOrEqual(last.endedAt - 5);
    expect(
      savedAt - last.endedAt,
      'ms from the last file landing to Saved · 12P',
    ).toBeLessThanOrEqual(300);
  });
});

// Added by the QA gate (iteration 4): Chrome's toolbar under R-006 rev. 3, headed only (skips
// headless with a reason, like the retry-1 block).
// | PRD                                                                            | Test                   |
// | ------------------------------------------------------------------------------ | ---------------------- |
// | AC "… exactly one animation accompanies the last file, after which the bubble  | 'toolbar: last files   |
// |   lists metadata.json and the 12 originals" (R-006), no page held back: the    |   land together'       |
// |   iteration-3 LOW's repro (the bubble missed the last file in 5 of 8 runs)     |                        |
// | CUJ-4 edge "Two concurrent jobs therefore show one animation in total … Once   | 'toolbar: two jobs'    |
// |   the button returns, its bubble lists the files of both jobs" (R-006)         |   (@cuj4)              |
test.describe('CUJ-1: QA gate additions (iteration 4), Chrome toolbar', { tag: '@cuj1' }, () => {
  test('toolbar: last files land together: one animation, and the bubble that opens lists metadata.json and the 12 originals, the last file included', async ({
    harness,
  }) => {
    const tree = await startTree(harness);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    const clickedAt = Date.now();
    await clickButton(page);
    await waitForText(page, 'Saved · 12P');
    const after = await downloadUiRestored(harness);
    await page.waitForTimeout(2_000);
    const list = (await samples(tree)).filter((sample) => sample.at >= clickedAt);
    if (!list.some(shown)) {
      const control = await controlDownload(harness, tree, 'control-download.txt');
      test.skip(
        !control.some(shown),
        'this Chromium shows no download UI at all (headless): run with HFP_HEADLESS=0',
      );
    }
    const restoreAt = after.calls[base + 1]?.at ?? Number.NaN;
    expect(
      list.filter((sample) => shown(sample) && sample.at < restoreAt - 20),
      'button or bubble before the UI came back',
    ).toEqual([]);
    expect(appearances(list, clickedAt), 'times Chrome’s downloads button came back').toHaveLength(
      1,
    );
    expect(list.at(-1)?.button, 'Chrome’s downloads button after Saved · 12P').not.toBeNull();
    expect(
      list.some((sample) => sample.bubbleOpen),
      'the bubble opened with the animation',
    ).toBe(true);
    const rows = new Set(list.flatMap((sample) => sample.rows));
    expect(
      ['metadata.json', ...ALL_PAGES.map((p) => fileName(EXAMPLE, p))].filter((n) => !rows.has(n)),
      'files missing from the bubble',
    ).toEqual([]);
  });

  test(
    'toolbar: two jobs: B ends first with no animation; one animation in total, with A’s last file, and the bubble lists the files of both jobs',
    {
      tag: '@cuj4',
    },
    async ({ harness, server }) => {
      const tabB = requireWork('136120877') as IllustWork;
      const tree = await startTree(harness);
      const holdA = server.hold(pagesOf(EXAMPLE, range(4, 11)));
      const holdB = server.hold(pagesOf(tabB, range(3, 7)));
      const pageA = await openArtwork(harness, EXAMPLE.id);
      await waitForText(pageA, 'Download · 12P');
      const base = (await downloadUiAfterBoot(harness)).calls.length;
      const clickedAt = Date.now();
      await clickButton(pageA);
      await waitForText(pageA, '4 / 12');
      const pageB = await openArtwork(harness, tabB.id);
      await waitForText(pageB, 'Download · 8P');
      await clickButton(pageB);
      await waitForText(pageB, '3 / 8');
      holdB.release();
      await waitForText(pageB, 'Saved · 8P');
      await pageB.waitForTimeout(1_000);
      const bEndedAt = Date.now();
      holdA.release();
      await waitForText(pageA, 'Saved · 12P');
      const after = await downloadUiRestored(harness);
      await pageA.waitForTimeout(2_000);
      const list = (await samples(tree)).filter((sample) => sample.at >= clickedAt);
      if (!list.some(shown)) {
        const control = await controlDownload(harness, tree, 'control-download.txt');
        test.skip(
          !control.some(shown),
          'this Chromium shows no download UI at all (headless): run with HFP_HEADLESS=0',
        );
      }
      expect(uiCalls(after.calls, base)).toEqual([
        { enabled: false, ok: true },
        { enabled: true, ok: true },
      ]);
      const restoreAt = after.calls[base + 1]?.at ?? Number.NaN;
      expect(restoreAt).toBeGreaterThan(bEndedAt);
      expect(
        list.filter((sample) => shown(sample) && sample.at < restoreAt - 20),
        'button or bubble before the UI came back (B’s end included)',
      ).toEqual([]);
      expect(
        appearances(list, clickedAt),
        'times Chrome’s downloads button came back',
      ).toHaveLength(1);
      expect(list.at(-1)?.button, 'Chrome’s downloads button after both jobs').not.toBeNull();
      const rows = new Set(list.flatMap((sample) => sample.rows));
      expect(
        [
          'metadata.json',
          ...ALL_PAGES.map((p) => fileName(EXAMPLE, p)),
          ...range(0, 7).map((p) => fileName(tabB, p)),
        ].filter((n) => !rows.has(n)),
        'files missing from the bubble',
      ).toEqual([]);
    },
  );
});
