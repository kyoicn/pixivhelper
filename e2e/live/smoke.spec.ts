// L4 live smoke (design-test-harness.md "L4: Live smoke"): the dev build (dist/) against the real
// pixiv over the real network, logged out. Opt-in: `HFP_LIVE=1 npm run test:e2e -- --grep @live`
// (playwright.config.ts ignores e2e/live/** otherwise). Run before every release and after any
// src/content/pixiv-dom.ts or src/shared/pixiv-api.ts change.
//
// Every navigation waits for `domcontentloaded`, never `load`: pixiv's `load` waits on ads and
// trackers (43–119 s measured) while the extension saves within seconds of the button appearing.
// Works come from today's daily rankings, judged by their logged-out `/ajax/illust` body: pixiv
// sends `urls.original: null` for a work it withholds from logged-out visitors (system.md §8.5).
//
// Checks:
// - an all-ages illustration pixiv shows logged out:
//   - the button is placed in pixiv's real action row (validates pixiv-dom.ts), left of Like;
//   - one click saves every page, each file the size of the Content-Length i.pximg.net sends to a
//     HEAD request with `Referer: https://www.pixiv.net/` (validates the DNR Referer rule);
//   - metadata.json has the 12 keys of PRD §4.3 in order;
// - an all-ages work behind pixiv's login wall (R-003): `Log in to download` before any click, and
//   the click opens pixiv login with the page as return_to. This is the drift alarm for the §8.5
//   signal; skipped with a logged reason when no walled all-ages work can be found;
// - an all-ages ugoira pixiv shows logged out, saved as MP4 (WebM without H.264) and as ZIP only:
//   the zip at its Content-Length, frames.json = ugoira_meta's frames, the video unless ZIP only
//   (codec and frame count checked when ffprobe is installed), metadata.json; skipped with a
//   logged reason when the ugoira ranking has no candidate;
// - the extension's service worker and offscreen document log no errors.

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CAPS_KEY_PREFIX, SETTINGS_KEY } from '../../src/shared/constants';
import type { CodecCaps } from '../../src/shared/messages';
import { DEFAULT_SETTINGS, type StoredSettings } from '../../src/shared/settings';
import type { UgoiraOutput } from '../../src/shared/types';
import { ACCOUNTS_ORIGIN, PIXIV_REFERER } from '../fixtures/works';
import {
  buttonView,
  clickButton,
  exposeButton,
  waitForText,
  type ButtonView,
} from '../harness/hfp-button';
import { launch, REPO_ROOT, type DownloadedFile, type Harness } from '../harness/launch';
import { ffprobe, hasMediaTool } from '../harness/media';

const PIXIV = 'https://www.pixiv.net';
const LOGIN_URL = `${ACCOUNTS_ORIGIN}/login`;
/** pixiv's `load` waits on ads and trackers; the extension needs only the DOM. */
const NAVIGATION = { waitUntil: 'domcontentloaded' } as const;
/** Ranking entries checked per ranking. */
const MAX_CANDIDATES = 20;
/** Keeps the smoke quick: the first all-ages illustration with at most this many pages. */
const MAX_PAGES = 5;
/** All-ages, behind pixiv's login wall on 2026-10-23: the walled case's last fallback. */
const KNOWN_WALLED_ID = '151107515';
const BUTTON_TIMEOUT_MS = 15_000;
const SAVE_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = SAVE_TIMEOUT_MS + 60_000;
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
const LOGIN_TEXT = 'Log in to download';
const LOGIN_ARIA = 'Log in to pixiv to download this work.';
const LOGIN_TITLE = 'Opens pixiv login and returns you here';
type VideoFormat = Exclude<UgoiraOutput, 'zip'>;

const FORMAT_LABEL: Readonly<Record<UgoiraOutput, string>> = {
  mp4: 'MP4',
  webm: 'WebM',
  zip: 'ZIP',
};
const CODEC_NAME: Readonly<Record<VideoFormat, string>> = {
  mp4: 'h264',
  webm: 'vp9',
};

type RankingContent = 'illust' | 'manga' | 'ugoira';

interface RankingEntry {
  illust_id: number;
  /** pixiv's own mark for a work it hides from logged-out visitors. */
  is_masked: boolean;
}

interface Ranking {
  contents: RankingEntry[];
}

interface Ajax<T> {
  error: boolean;
  body: T;
}

interface IllustBody {
  illustType: number;
  xRestrict: number;
  pageCount: number;
  width: number;
  height: number;
  urls: { original: string | null };
}

interface UgoiraMeta {
  originalSrc: string;
  frames: { file: string; delay: number }[];
}

interface LiveWork {
  id: string;
  body: IllustBody;
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.goto(url, NAVIGATION);
  if (!response?.ok()) throw new Error(`${url} → HTTP ${response?.status()}`);
  return (await response.json()) as T;
}

function rankingUrl(content: RankingContent): string {
  return `${PIXIV}/ranking.php?mode=daily&content=${content}&format=json`;
}

async function rankingEntries(page: Page, content: RankingContent): Promise<RankingEntry[]> {
  const ranking = await getJson<Ranking>(page, rankingUrl(content));
  return ranking.contents.slice(0, MAX_CANDIDATES);
}

/** The work's `/ajax/illust` body as a logged-out visitor gets it; null on a pixiv error. */
async function illustBody(page: Page, id: string): Promise<IllustBody | null> {
  const ajax = await getJson<Ajax<IllustBody>>(page, `${PIXIV}/ajax/illust/${id}`);
  return ajax.error ? null : ajax.body;
}

/** pixiv shows the images to a logged-out visitor. */
function isVisible(work: IllustBody): boolean {
  return typeof work.urls.original === 'string';
}

/** All-ages, but withheld from a logged-out visitor (R-003). */
function isWalled(work: IllustBody): boolean {
  return work.xRestrict === 0 && work.urls.original === null;
}

async function firstWork(
  page: Page,
  entries: readonly RankingEntry[],
  accept: (work: IllustBody) => boolean,
): Promise<LiveWork | null> {
  for (const entry of entries) {
    const id = String(entry.illust_id);
    const body = await illustBody(page, id);
    if (body && accept(body)) return { id, body };
  }
  return null;
}

/** Today's first all-ages illustration (≤ MAX_PAGES pages) that pixiv shows logged out. */
async function pickIllustration(page: Page): Promise<LiveWork> {
  const work = await firstWork(
    page,
    await rankingEntries(page, 'illust'),
    (body) =>
      body.xRestrict === 0 &&
      body.illustType === 0 &&
      body.pageCount <= MAX_PAGES &&
      isVisible(body),
  );
  if (!work) {
    throw new Error(
      `no all-ages illustration shown logged out in the first ${MAX_CANDIDATES} of ${rankingUrl('illust')}`,
    );
  }
  return work;
}

/**
 * The first walled all-ages work of today's illust ranking, then manga ranking, else
 * KNOWN_WALLED_ID while it is still walled; null when there is none. Throws when the rankings mark
 * works `is_masked` but pixiv sends all of them image URLs: pixiv changed how it hides walled works,
 * the drift this case exists to catch (system.md §8.5), so it must not pass as a skip.
 */
async function pickWalled(page: Page): Promise<LiveWork | null> {
  const maskedButVisible: string[] = [];
  for (const content of ['illust', 'manga'] as const) {
    for (const entry of await rankingEntries(page, content)) {
      const id = String(entry.illust_id);
      const body = await illustBody(page, id);
      if (!body) continue;
      if (isWalled(body)) return { id, body };
      if (entry.is_masked) maskedButVisible.push(id);
    }
  }
  if (maskedButVisible.length > 0) {
    throw new Error(
      `the rankings mask ${maskedButVisible.join(', ')}, but pixiv sends their image URLs to a logged-out visitor: urls.original === null no longer marks pixiv's login wall (system.md §8.5)`,
    );
  }
  const known = await illustBody(page, KNOWN_WALLED_ID);
  return known && isWalled(known) ? { id: KNOWN_WALLED_ID, body: known } : null;
}

/** The first all-ages ugoira of today's ugoira ranking that pixiv shows logged out, or null. */
async function pickUgoira(page: Page): Promise<LiveWork | null> {
  return firstWork(
    page,
    await rankingEntries(page, 'ugoira'),
    (body) => body.xRestrict === 0 && body.illustType === 2 && isVisible(body),
  );
}

function skipWith(reason: string): void {
  console.log(`skipped: ${reason}`);
  test.skip(true, reason);
}

/** What i.pximg.net says the file weighs when asked the way the extension asks. */
async function contentLength(url: string): Promise<number> {
  const response = await fetch(url, { method: 'HEAD', headers: { Referer: PIXIV_REFERER } });
  expect(response.status).toBe(200);
  return Number(response.headers.get('content-length'));
}

/** `pixiv/<artist>-<id>`, from the Saved tooltip. */
function savedFolder(saved: ButtonView, id: string): string {
  const folder = (saved.title ?? '').replace(/^Saved to Downloads\//, '');
  expect(folder).toMatch(new RegExp(`^pixiv/.+-${id}$`));
  return folder;
}

async function readDownload(harness: Harness, relative: string): Promise<string> {
  return readFile(path.join(harness.downloads.dir, relative), 'utf8');
}

async function expectMetadata(
  harness: Harness,
  folder: string,
  id: string,
  pageCount: number,
): Promise<void> {
  const metadata = JSON.parse(await readDownload(harness, `${folder}/metadata.json`)) as Record<
    string,
    unknown
  >;
  expect(Object.keys(metadata)).toEqual(METADATA_KEYS);
  expect(metadata.id).toBe(id);
  expect(metadata.pageCount).toBe(pageCount);
}

function expectNoExtensionErrors(harness: Harness): void {
  const extensionErrors = harness
    .consoleErrors()
    .filter((entry) => entry.source === 'sw' || entry.source === 'offscreen');
  expect(extensionErrors).toEqual([]);
}

/** As the options page saves it: the same record in storage.sync and storage.local. */
async function setUgoiraOutput(harness: Harness, ugoiraOutput: UgoiraOutput): Promise<void> {
  const record: StoredSettings = { v: 1, ...DEFAULT_SETTINGS, ugoiraOutput, updatedAt: Date.now() };
  await harness.swEval(
    async ({ key, value }) => {
      await chrome.storage.sync.set({ [key]: value });
      await chrome.storage.local.set({ [key]: value });
    },
    { key: SETTINGS_KEY, value: record },
  );
}

/** The offscreen codec probe's answer for the work's frame size, once the SW has cached it. */
async function codecCaps(harness: Harness, work: IllustBody): Promise<CodecCaps> {
  const even = (n: number) => n - (n % 2);
  const key = `${CAPS_KEY_PREFIX}${even(work.width)}x${even(work.height)}`;
  const read = () =>
    harness.swEval(
      async (k) => (await chrome.storage.session.get(k))[k] as CodecCaps | undefined,
      key,
    );
  await expect
    .poll(read, { message: `codec probe for ${key}`, timeout: BUTTON_TIMEOUT_MS })
    .toBeDefined();
  const caps = (await read()) as CodecCaps;
  console.log(`codec probe ${key}: avc ${caps.avc ?? 'null'}, vp9 ${String(caps.vp9)}`);
  return caps;
}

/**
 * Opens the ugoira and saves it with one click under Ugoira output `setting`: `Download · <format>`
 * before the click, `Saved · <format>` after it, where MP4 becomes WebM when the browser's H.264
 * probe fails. Checks the folder: the zip at its Content-Length, frames.json equal to
 * ugoira_meta's frames, the video unless ZIP only, and metadata.json.
 */
async function saveUgoira(
  harness: Harness,
  page: Page,
  work: LiveWork,
  setting: UgoiraOutput,
): Promise<void> {
  const meta = await getJson<Ajax<UgoiraMeta>>(page, `${PIXIV}/ajax/illust/${work.id}/ugoira_meta`);
  expect(meta.error).toBe(false);
  console.log(`live ugoira ${work.id} (${meta.body.frames.length} frames), output ${setting}`);

  await page.goto(`${PIXIV}/artworks/${work.id}`, NAVIGATION);
  await exposeButton(page, { timeout: BUTTON_TIMEOUT_MS });
  const format: UgoiraOutput =
    setting === 'mp4' && (await codecCaps(harness, work.body)).avc === null ? 'webm' : setting;
  const label = FORMAT_LABEL[format];
  const idle = await waitForText(page, `Download · ${label}`, { timeout: BUTTON_TIMEOUT_MS });
  expect(idle.mode).toBe('row');

  await clickButton(page);
  const saved = await waitForText(page, /^Saved/, { timeout: SAVE_TIMEOUT_MS });
  expect(saved.text).toBe(`Saved · ${label}`);
  const folder = savedFolder(saved, work.id);

  const zip = `${folder}/${work.id}_ugoira.zip`;
  const video = format === 'zip' ? null : { format, path: `${folder}/${work.id}.${format}` };
  const listing = await harness.downloads.files();
  expect(listing.map((file) => file.path)).toEqual(
    [
      zip,
      `${folder}/frames.json`,
      `${folder}/metadata.json`,
      ...(video ? [video.path] : []),
    ].sort(),
  );
  expect(listing.find((file) => file.path === zip)?.size).toBe(
    await contentLength(meta.body.originalSrc),
  );
  expect(JSON.parse(await readDownload(harness, `${folder}/frames.json`))).toEqual(
    meta.body.frames,
  );
  await expectMetadata(harness, folder, work.id, 1);
  if (video) await expectVideo(harness, listing, video, meta.body.frames.length);
}

/**
 * Non-empty; with ffprobe installed, also one video stream of the format's codec and one video
 * frame per ugoira frame.
 */
async function expectVideo(
  harness: Harness,
  listing: readonly DownloadedFile[],
  video: { format: VideoFormat; path: string },
  frameCount: number,
): Promise<void> {
  expect(listing.find((file) => file.path === video.path)?.size).toBeGreaterThan(0);
  if (!hasMediaTool('ffprobe')) {
    console.log('ffprobe is not installed: the video is checked for a non-zero size only');
    return;
  }
  const probe = await ffprobe(path.join(harness.downloads.dir, video.path));
  const streams = probe.streams.filter((stream) => stream.codec_type === 'video');
  expect(streams.map((stream) => stream.codec_name)).toEqual([CODEC_NAME[video.format]]);
  expect(
    probe.frames.filter((frame) => frame.media_type === 'video'),
    'one video frame per ugoira frame',
  ).toHaveLength(frameCount);
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
    test.setTimeout(TEST_TIMEOUT_MS);
    harness = await launch();
    const page = await harness.newPage();
    const work = await pickIllustration(page);
    const { pageCount } = work.body;
    const pages = await getJson<Ajax<{ urls: { original: string } }[]>>(
      page,
      `${PIXIV}/ajax/illust/${work.id}/pages`,
    );
    const originals = pages.body.map((entry) => entry.urls.original);
    expect(originals).toHaveLength(pageCount);
    console.log(`live work ${work.id} (${pageCount} page${pageCount > 1 ? 's' : ''})`);

    await page.goto(`${PIXIV}/artworks/${work.id}`, NAVIGATION);
    await exposeButton(page, { timeout: BUTTON_TIMEOUT_MS });
    const hint = pageCount > 1 ? ` · ${pageCount}P` : '';
    const idle = await waitForText(page, `Download${hint}`, { timeout: BUTTON_TIMEOUT_MS });
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
    const folder = savedFolder(saved, work.id);

    const listing = await harness.downloads.files();
    const names = originals.map((url) => url.slice(url.lastIndexOf('/') + 1));
    expect(listing.map((file) => file.path).sort()).toEqual(
      [...names, 'metadata.json'].map((name) => `${folder}/${name}`).sort(),
    );
    for (const [index, url] of originals.entries()) {
      const file = listing.find((entry) => entry.path === `${folder}/${names[index]}`);
      expect(file?.size).toBe(await contentLength(url));
    }
    await expectMetadata(harness, folder, work.id, pageCount);

    expect((await buttonView(page)).ariaBusy).toBeNull();
    expect(await harness.swEval(() => chrome.action.getBadgeText({}))).toBe('');
    expectNoExtensionErrors(harness);
  });

  test('logged out, an all-ages work behind pixiv’s login wall shows Log in to download; the click opens pixiv login (R-003)', async () => {
    test.setTimeout(TEST_TIMEOUT_MS);
    harness = await launch();
    const page = await harness.newPage();
    const work = await pickWalled(page);
    if (!work) {
      return skipWith(
        `no walled all-ages work in the first ${MAX_CANDIDATES} of today's illust and manga rankings, and ${KNOWN_WALLED_ID} is no longer walled`,
      );
    }
    console.log(`live walled work ${work.id}`);

    await page.goto(`${PIXIV}/artworks/${work.id}`, NAVIGATION);
    await exposeButton(page, { timeout: BUTTON_TIMEOUT_MS });
    const view = await waitForText(page, LOGIN_TEXT, { timeout: BUTTON_TIMEOUT_MS });
    expect({ ariaLabel: view.ariaLabel, title: view.title }).toEqual({
      ariaLabel: LOGIN_ARIA,
      title: LOGIN_TITLE,
    });

    // As it was before the click: pixiv may have redirected to a locale path such as /en/artworks/.
    const artworkPage = page.url();
    const login = page.waitForRequest(
      (request) =>
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame() &&
        new URL(request.url()).origin === ACCOUNTS_ORIGIN,
      { timeout: BUTTON_TIMEOUT_MS },
    );
    await clickButton(page);
    const loginUrl = (await login).url();
    console.log(`click → ${loginUrl}`);
    const expected = `${LOGIN_URL}?return_to=${encodeURIComponent(artworkPage)}`;
    expect(loginUrl.startsWith(expected), `${loginUrl} starts with ${expected}`).toBe(true);
    expectNoExtensionErrors(harness);
  });

  test('logged out, an all-ages ugoira saves as MP4 (WebM without H.264) with its zip, frames.json and metadata', async () => {
    test.setTimeout(TEST_TIMEOUT_MS);
    harness = await launch();
    const page = await harness.newPage();
    const work = await pickUgoira(page);
    if (!work) {
      return skipWith(
        `no all-ages ugoira shown logged out in the first ${MAX_CANDIDATES} of ${rankingUrl('ugoira')}`,
      );
    }
    await saveUgoira(harness, page, work, DEFAULT_SETTINGS.ugoiraOutput);
    expectNoExtensionErrors(harness);
  });

  test('logged out, Ugoira output ZIP only saves an all-ages ugoira’s zip, frames.json and metadata, no video', async () => {
    test.setTimeout(TEST_TIMEOUT_MS);
    harness = await launch();
    await setUgoiraOutput(harness, 'zip');
    const page = await harness.newPage();
    const work = await pickUgoira(page);
    if (!work) {
      return skipWith(
        `no all-ages ugoira shown logged out in the first ${MAX_CANDIDATES} of ${rankingUrl('ugoira')}`,
      );
    }
    await saveUgoira(harness, page, work, 'zip');
    expectNoExtensionErrors(harness);
  });
});
