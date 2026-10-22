// L4 live smoke (design-test-harness.md "L4: Live smoke"): the dev build (dist/) against the real
// pixiv over the real network, logged out. Opt-in: `HFP_LIVE=1 npm run test:e2e -- --grep @live`
// (playwright.config.ts ignores e2e/live/** otherwise). Run before every release and after any
// src/content/pixiv-dom.ts change.
//
// Checks:
// - the button is placed in pixiv's real action row (validates pixiv-dom.ts), left of Like;
// - one click saves every page, each file the size of the Content-Length i.pximg.net sends to a
//   HEAD request with `Referer: https://www.pixiv.net/` (validates the DNR Referer rule);
// - metadata.json has the 12 keys of PRD §4.3 in order;
// - the extension's service worker and offscreen document log no errors.

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PIXIV_REFERER } from '../fixtures/works';
import { buttonView, clickButton, exposeButton, waitForText } from '../harness/hfp-button';
import { launch, REPO_ROOT, type Harness } from '../harness/launch';

const PIXIV = 'https://www.pixiv.net';
const RANKING_URL = `${PIXIV}/ranking.php?mode=daily&content=illust&format=json`;
/** Ranking entries checked for an all-ages illustration. */
const MAX_CANDIDATES = 20;
/** Keeps the smoke quick: the first all-ages illustration with at most this many pages. */
const MAX_PAGES = 5;
const SAVE_TIMEOUT_MS = 120_000;
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

interface Ranking {
  contents: { illust_id: number }[];
}

interface Ajax<T> {
  error: boolean;
  body: T;
}

interface IllustBody {
  illustType: number;
  xRestrict: number;
  pageCount: number;
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.goto(url);
  if (!response?.ok()) throw new Error(`${url} → HTTP ${response?.status()}`);
  return (await response.json()) as T;
}

/** The first all-ages illustration (≤ MAX_PAGES pages) of today's daily ranking. */
async function pickWork(page: Page): Promise<{ id: string; pageCount: number }> {
  const ranking = await getJson<Ranking>(page, RANKING_URL);
  for (const entry of ranking.contents.slice(0, MAX_CANDIDATES)) {
    const id = String(entry.illust_id);
    const ajax = await getJson<Ajax<IllustBody>>(page, `${PIXIV}/ajax/illust/${id}`);
    const work = ajax.body;
    if (
      !ajax.error &&
      work.xRestrict === 0 &&
      work.illustType === 0 &&
      work.pageCount <= MAX_PAGES
    ) {
      return { id, pageCount: work.pageCount };
    }
  }
  throw new Error(`no all-ages illustration in the first ${MAX_CANDIDATES} of ${RANKING_URL}`);
}

/** What i.pximg.net says the original weighs when asked the way the extension asks. */
async function contentLength(url: string): Promise<number> {
  const response = await fetch(url, { method: 'HEAD', headers: { Referer: PIXIV_REFERER } });
  expect(response.status).toBe(200);
  return Number(response.headers.get('content-length'));
}

test.describe('L4 live smoke against the real pixiv', { tag: '@live' }, () => {
  let harness: Harness | undefined;

  test.beforeAll(() => {
    // The dev build, fresh: `npm run test:e2e` only builds dist-e2e/.
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: REPO_ROOT, stdio: 'inherit' });
  });

  test.afterEach(async () => {
    await harness?.close();
  });

  test('logged out, one click saves an all-ages illustration with its metadata', async () => {
    test.setTimeout(SAVE_TIMEOUT_MS + 60_000);
    harness = await launch();
    const page = await harness.newPage();
    const work = await pickWork(page);
    const pages = await getJson<Ajax<{ urls: { original: string } }[]>>(
      page,
      `${PIXIV}/ajax/illust/${work.id}/pages`,
    );
    const originals = pages.body.map((entry) => entry.urls.original);
    expect(originals).toHaveLength(work.pageCount);
    console.log(`live work ${work.id} (${work.pageCount} page${work.pageCount > 1 ? 's' : ''})`);

    await page.goto(`${PIXIV}/artworks/${work.id}`);
    await exposeButton(page, { timeout: 15_000 });
    const hint = work.pageCount > 1 ? ` · ${work.pageCount}P` : '';
    const idle = await waitForText(page, `Download${hint}`, { timeout: 15_000 });
    expect(idle.mode).toBe('row');
    expect(idle.hosts).toBe(1);
    const placement = await page.evaluate(() => {
      const host = document.querySelector('hfp-download');
      const row = host?.parentElement;
      if (!host || !row) return null;
      const hostRect = host.getBoundingClientRect();
      // The control right of the host on screen: pixiv's Like (an icon plus a text label).
      const right = Array.from(row.children)
        .filter((child) => child !== host)
        .map((child) => ({ child, left: child.getBoundingClientRect().left }))
        .filter(({ left }) => left >= hostRect.right - 0.5)
        .sort((a, b) => a.left - b.left)[0]?.child;
      const like = right?.querySelector(':scope > button');
      return {
        rowTag: row.localName,
        inMain: row.closest('main') !== null,
        rightIsLike:
          like?.querySelector(':scope > svg') !== null &&
          (like?.querySelector(':scope > span')?.textContent ?? '').trim() !== '',
      };
    });
    expect(placement).toEqual({ rowTag: 'section', inMain: true, rightIsLike: true });

    await clickButton(page);
    const saved = await waitForText(page, /^Saved/, { timeout: SAVE_TIMEOUT_MS });
    const folder = (saved.title ?? '').replace(/^Saved to Downloads\//, '');
    expect(folder).toMatch(new RegExp(`^pixiv/.+-${work.id}$`));

    const listing = await harness.downloads.files();
    const names = originals.map((url) => url.slice(url.lastIndexOf('/') + 1));
    expect(listing.map((file) => file.path).sort()).toEqual(
      [...names, 'metadata.json'].map((name) => `${folder}/${name}`).sort(),
    );
    for (const [index, url] of originals.entries()) {
      const file = listing.find((entry) => entry.path === `${folder}/${names[index]}`);
      expect(file?.size).toBe(await contentLength(url));
    }

    const metadata = JSON.parse(
      await readFile(path.join(harness.downloads.dir, folder, 'metadata.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(metadata)).toEqual(METADATA_KEYS);
    expect(metadata.id).toBe(work.id);
    expect(metadata.pageCount).toBe(work.pageCount);

    expect((await buttonView(page)).ariaBusy).toBeNull();
    expect(await harness.swEval(() => chrome.action.getBadgeText({}))).toBe('');
    const extensionErrors = harness
      .consoleErrors()
      .filter((entry) => entry.source === 'sw' || entry.source === 'offscreen');
    expect(extensionErrors).toEqual([]);
  });
});
