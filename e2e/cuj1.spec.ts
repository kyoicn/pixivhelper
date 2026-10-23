// CUJ-1 end to end on the fake pixiv: download an illustration or manga from the artwork page.
//
// AC → test (docs/prd/prd-000-mvp.md, CUJ-1 "Acceptance Criteria"):
// | AC                                                                         | Test                    |
// | -------------------------------------------------------------------------- | ----------------------- |
// | 1  Exactly one button, immediately left of Like, ≤ 500 ms after the row    | 'placement'             |
// | 2  `Download · 12P` (12 pages) / `Download` (single page)                  | 'placement'             |
// | 3  164 px in idle, busy, Cancel-hover, Saved; width never changes          | 'width'                 |
// | 4  Folder: metadata.json + p0…p11, sizes = Content-Length                  | 'folder'                |
// | 5  metadata.json: 12 keys in order, literal non-ASCII, `\n` kept           | 'folder'                |
// | 6  Never more than 5 of this artwork's files in flight                     | 'in flight'             |
// | 7  `N / 12` only rises; 12 / 12 only after every original; metadata ≠ N    | 'counter and badge'     |
// | 8  Cancel face after leaving once; cancel stops, keeps files, idle again   | 'cancel'                |
// | 9  `Saved · 12P`, white/blue border/check, tooltip with the folder         | 'saved'                 |
// | 10 SPA away and back shows Saved; reload shows `Download · 12P`            | 'saved'; with a job     |
// |    (edge cases: SPA away and back, or a reload, mid-job show the live job) | running: 'mid-job       |
// |                                                                            | navigation'             |
// | 11 Clicking Saved downloads again as ` (1)` duplicates                     | 're-download'           |
// | 12 Closing the tab does not stop the job                                   | 'tab closed'            |
// | 13 Badge = pages not yet complete, gone at the end                         | 'counter and badge'     |
// | 14 Tab / Enter / Space, 2 px #0096FA focus ring, aria-busy while busy      | 'keyboard'              |
// | 15 Dark theme: identical fill, text, icon (focus ring #5fb9fb)             | 'dark theme'            |
// | 16 Pattern changed mid-job: running job keeps its folder (also CUJ-3 AC    | 'settings mid-job'      |
// |    "Changing a setting while a download runs …" for folder and metadata)   |                         |
//
// Files in flight are held with server.hold(): originals trickle until released, so a job can be
// stopped at any count without the e2e build's 300 ms stall timeout failing it.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pageBytes } from './fixtures/assets';
import { artworkUrl, originalUrl, requireWork, type IllustWork } from './fixtures/works';
import {
  artworkFiles,
  CLICK_GUARD_MS,
  downloadedPaths,
  expectBadge,
  fileName,
  IDLE_TITLE,
  openArtwork,
  pagesOf,
  range,
  restingView,
  TRANSITION_MS,
} from './harness/flows';
import {
  buttonCenter,
  buttonHasFocus,
  buttonRule,
  buttonView,
  clickButton,
  exposeButton,
  hostConnectedAt,
  hoverButton,
  labelLog,
  recordHostConnection,
  waitForText,
  watchLabels,
} from './harness/hfp-button';
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

function expectedFiles(folder: string, pages: readonly number[], metadata: boolean): string[] {
  return artworkFiles(EXAMPLE, folder, pages, metadata);
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

/** Pages counted by the label log's `N / total` entries, in order. */
function counts(log: { text: string }[], total: number): number[] {
  const re = new RegExp(`^(\\d+) / ${total}$`);
  return log.flatMap(({ text }) => {
    const match = re.exec(text);
    return match ? [Number(match[1])] : [];
  });
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
    // 12 / 12 needs the last original: it stays at 11 while page 11 is in flight.
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
    expect(seen.every((n) => n <= 12)).toBe(true);
    expect(log.at(-1)?.text).toBe('Saved · 12P');
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
    const clickedAt = Date.now();
    await clickButton(page);
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

  test('re-download: clicking Saved saves every file again as (1) duplicates', async ({
    harness,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    await waitForText(page, 'Saved · 12P');
    await hoverButton(page, false);

    await clickButton(page);
    await harness.downloads.waitForFile(`${FOLDER}/metadata (1).json`);
    await waitForText(page, 'Saved · 12P');
    await expect.poll(() => downloadedPaths(harness)).toHaveLength(26);
    const duplicates = [
      ...ALL_PAGES.map((page) => fileName(EXAMPLE, page).replace(/(\.\w+)$/, ' (1)$1')),
      'metadata (1).json',
    ].map((name) => `${FOLDER}/${name}`);
    expect(await downloadedPaths(harness)).toEqual(
      [...expectedFiles(FOLDER, ALL_PAGES, true), ...duplicates].sort(),
    );
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
