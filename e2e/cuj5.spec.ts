// CUJ-5 end to end on the fake pixiv: recover when a download can't start or breaks.
// Written by the QA gate (iteration 1); failures here are findings, not test problems.
//
// AC → test (docs/prd/prd-000-mvp.md, CUJ-5 "Acceptance Criteria"):
// | AC                                                                          | Test                     |
// | --------------------------------------------------------------------------- | ------------------------ |
// | 1  Logged out, xRestrict ≥ 1: `Log in to download` (white, #c4c7c5 border,  | 'needs login'            |
// |    #3c4043 text, no icon) before any click, tooltip; no other text          |                          |
// | 2  Click → accounts.pixiv.net/login?return_to=<encoded URL>; after login    | 'login round-trip';      |
// |    `Download · 68P`                                                         | 'logged in elsewhere'    |
// | 3  Logged out, all-ages: normal idle `Download · NP`, download succeeds     | 'logged out all-ages'    |
// | 4  Logged out, all-ages behind pixiv's sensitive-content wall (R-003):      | 'needs login (R-003)'    |
// |    `Log in to download` before any click, same styling and tooltip, name    | (3 tests: walled work,   |
// |    `Log in to pixiv to download this work.`; login → `Download · 4P`        | pending click, logged    |
// |                                                                             | in)                      |
// | 5  Some pages fail after 4 attempts: `Retry · 3 failed`, red outline,       | 'partial'                |
// |    warning triangle, same width, exact tooltip                              |                          |
// | 6  `Retry · 3 failed` fetches only the 3 pages into the same folder, ends   | 'partial'                |
// |    `Saved · 12P`                                                            |                          |
// | 7  Network disconnected → `Retry` + "No connection…"                        | 'offline'; 'sustained    |
// |                                                                             | outage' (last click)     |
// | 8  Sustained outage (every image request 500/503): every click → `Retry` +  | 'sustained outage'       |
// |    "pixiv isn't responding…", including the 7th consecutive Retry; none     |                          |
// |    reads "No connection…" (R-004 S3)                                        |                          |
// | 9  Logged in, R-18 display off → `Retry` + "pixiv refused this work…"       | 'refused' (2 tests)      |
// | 10 Deleted after page load → gray `Unavailable`, click does nothing         | 'unavailable' (2 tests)  |
// | 11 Encode fails: zip + frames.json, no video, `Retry · MP4` + exact         | 'encode failure' (2      |
// |    tooltip; clicking it produces only the video                             | tests)                   |
// | 12 403 on originals mid-job: saved files stay, back to `Log in to download` | '403 mid-job'            |
// | 13 No error state shows a badge unless another job is in flight             | 'badge in error states'; |
// |                                                                             | also every error test    |
// | 14 Cancelling never produces red styling or any message                     | 'cancel a retry'         |
// | 15 Action row removed before navigation → floating pill at the artwork's    | 'floating fallback'      |
// |    bottom-right within 3 s of the page loading or of the in-app navigation, | (2 tests)                |
// |    measured to the pill appearing (R-004 S4); downloads normally            |                          |
// | 16 403 never retried; 429/500/502/503/504 and network errors retried up to  | 'retry policy';          |
// |    4 attempts                                                               | '403 mid-job'; 'partial' |
// | Edge: 5xx with 0 pages saved → `Retry` + "pixiv isn't responding…"          | 'server failure'         |
// | Edge (step 6, accepted cost): the API answered, then every original drops   | 'server failure: every   |
// |       its connection → `Retry` + "pixiv isn't responding…"                  | original drops'          |
// | Edge: exactly 1 failure → `Retry · 1 failed` + tip_partial_one; reload      | 'partial one'            |
// |       clears the failure memory and a click re-runs the whole job           |                          |
// | Edge: retry after the pattern changed still writes into the original folder | 'partial'                |
// | Edge: logged out in another tab after load → `Retry` + refused              | 'refused … logged out'   |
// | Edge: 429 with Retry-After: 120 waits min(RA, 30) s (×0.01 in dist-e2e)     | 'retry policy'           |
// | Edge: floating fallback on pixiv's dark theme: #5fb9fb focus ring           | 'floating fallback'      |
//
// "No connection" is judged per click (system.md §10 row 8, D13, R-004 S3): only when no request of
// the click's job got an HTTP response. A disconnected network, or a pixiv that answers nothing, is
// simulated by dropping every pixiv request (`reset`); once the job's API calls have answered,
// failed originals read "pixiv isn't responding".
//
// Chromium throttles an extension's requests to a URL after repeated 500/503 answers ("Request
// throttled", https://dev.chromium.org/throttling). dist-e2e scales the backoff ×0.01 (15/30/60 ms),
// so a later 500/503 attempt in quick succession may never reach the server and fails locally as a
// network error. Tests that count 4 server attempts therefore use 502/504, and their 500/503
// sequences fail at most twice. 'sustained outage' uses 503 on purpose: whatever the throttling
// refuses, the job's API calls answered, so every click reads "pixiv isn't responding". It records
// the server hits per click as an annotation instead of asserting them. 4 attempts on 500/503 under
// the real 1.5/3/6 s backoff, and a stopped server, are QA's dev-build checks (diagOutage.ts).
//
// "Only metadata.json failed" and "pages and metadata.json both failed" are in the QA gate additions
// (iteration 5) below: a wrapper around chrome.downloads.download in the SW refuses metadata.json's
// hand-off. R-18G (xRestrict 2) is in the QA gate additions (iteration 2) below.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { CAPS_KEY_PREFIX } from '../src/shared/constants';
import {
  ACCOUNTS_ORIGIN,
  artworkUrl,
  originalUrl,
  requireWork,
  type IllustWork,
  type UgoiraWork,
} from './fixtures/works';
import {
  actionTitle,
  artworkFiles,
  badgeText,
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
} from './harness/flows';
import {
  buttonHasFocus,
  buttonView,
  clickButton,
  counts,
  exposeButton,
  hoverButton,
  labelLog,
  waitForText,
  watchLabels,
  type ButtonView,
} from './harness/hfp-button';
import type { Harness } from './harness/launch';
import { expect, test } from './harness/test';
import type { FakeWindow } from './server/page';
import type { FakePixiv, FaultResponse, LoggedRequest } from './server/server';

const EXAMPLE = requireWork('135882741') as IllustWork;
const SINGLE = requireWork('135882742') as IllustWork;
const R18 = requireWork('145892669') as IllustWork;
/** All-ages, behind pixiv's sensitive-content login wall (R-003). */
const WALLED = requireWork('135882745') as IllustWork;
const TAB_B = requireWork('136120877') as IllustWork;
const UGOIRA = requireWork('136004512') as UgoiraWork;
const CORRUPT = requireWork('136004516') as UgoiraWork;
const DELETED_ID = '199999999';

const FOLDER = 'pixiv/みずき-135882741';
const R18_FOLDER = 'pixiv/ヨル-145892669';
const WALLED_FOLDER = 'pixiv/うみ-135882745';
const UGOIRA_FOLDER = 'pixiv/ひなた-136004512';
const CORRUPT_FOLDER = 'pixiv/ひなた-136004516';
const ALL_PAGES = EXAMPLE.pages.map((_, page) => page);

// ── PRD copy (Appendix A) ──
const TIP_LOGIN = 'Opens pixiv login and returns you here';
const ARIA_LOGIN = 'Log in to pixiv to download this work.';
const TIP_OFFLINE = "No connection. Retry when you're back online.";
const TIP_REFUSED =
  "pixiv refused this work. If you're logged in, check your R-18 setting on pixiv.";
const TIP_SERVER = "pixiv isn't responding. Retry in a few minutes.";
const TIP_UNAVAILABLE = 'This work is no longer available.';
const TIP_ENCODE =
  'Frames saved as ZIP. Video encoding failed. Click to retry the encode, or choose ZIP only in settings.';
const ariaFailed = (tip: string) => `Download failed. ${tip} Click to retry.`;

// ── PRD §4.7.3 colors as computed ──
const WHITE = 'rgb(255, 255, 255)';
const BLUE = 'rgb(0, 150, 250)';
const RED = 'rgb(217, 48, 37)';
const RED_TINT = 'rgb(253, 236, 235)';
const LOGIN_BORDER = 'rgb(196, 199, 197)';
const LOGIN_TEXT = 'rgb(60, 64, 67)';
const LOGIN_HOVER_FILL = 'rgb(245, 247, 249)';
const LOGIN_HOVER_BORDER = 'rgb(138, 143, 148)';
const GRAY_FILL = 'rgb(241, 243, 244)';
const GRAY_TEXT = 'rgb(95, 99, 104)';
const DARK_RING = 'rgb(95, 185, 251)';

/** Browser logs of the faults these tests inject on purpose. */
const FAULT_LOGS = [/status of (403|404|429|50[0-4])/, /net::ERR_/, /Failed to fetch/, /\[hfp:/];

const SESSION_COOKIE = {
  name: 'PHPSESSID',
  value: 'fake-session',
  domain: '.pixiv.net',
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'Lax' as const,
};

function esc(text: string): string {
  return text.replace(/[()]/g, '\\$&');
}

function loginUrlFor(id: string): string {
  return `${ACCOUNTS_ORIGIN}/login?return_to=${encodeURIComponent(artworkUrl(id))}`;
}

function failPages(
  harness: Harness,
  server: FakePixiv,
  work: IllustWork,
  pages: number[],
  attempts = 4,
): void {
  harness.allowConsoleErrors(...FAULT_LOGS);
  for (const page of pages) {
    server.fault({ match: `/${fileName(work, page)}`, responses: new Array(attempts).fill(504) });
  }
}

async function writeSettings(
  harness: Harness,
  settings: { folderPattern?: string; saveMetadata?: boolean; ugoiraOutput?: string },
): Promise<void> {
  await harness.swEval(async (next) => {
    const record = {
      v: 1,
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput: 'mp4',
      saveMetadata: true,
      ...next,
      updatedAt: Date.now(),
    };
    await chrome.storage.sync.set({ settings: record });
    await chrome.storage.local.set({ settings: record });
  }, settings);
}

function requestsAfter(
  server: FakePixiv,
  match: (r: LoggedRequest) => boolean,
  since: number,
): LoggedRequest[] {
  return server.requests(match).filter((request) => request.at >= since);
}

/** Chrome download file names (relative to the downloads dir) started after `since`. */
async function downloadsStartedAfter(harness: Harness, since: number): Promise<string[]> {
  const names = await harness.swEval(
    async (after) =>
      (await chrome.downloads.search({ startedAfter: new Date(after).toISOString() })).map(
        (item) => item.filename,
      ),
    since,
  );
  return names.map((name) => name.split(/[\\/]/).slice(-2).join('/')).sort();
}

function expectRedOutline(view: ButtonView, width = 164): void {
  expect(view.classes).toContain('error');
  expect(view.glyph).toBe('warning');
  expect(view.style.backgroundColor).toBe(WHITE);
  expect(view.style.color).toBe(RED);
  expect(view.style.borderTop).toMatch(/^[\d.]+px solid rgb\(217, 48, 37\)$/);
  expect(view.style.boxShadow).toBe('none');
  expect(view.ariaBusy).toBeNull();
  expect(view.width).toBe(width);
}

async function hoveredView(page: Page): Promise<ButtonView> {
  await hoverButton(page, true);
  await page.waitForTimeout(TRANSITION_MS);
  const view = await buttonView(page);
  await hoverButton(page, false);
  return view;
}

/** Waits for the pill to reach the given text, with a longer budget for retry-heavy jobs. */
function settle(page: Page, text: string | RegExp, timeout = 20_000): Promise<ButtonView> {
  return waitForText(page, text, { timeout });
}

test.describe('CUJ-5: recover when a download can’t start or breaks', { tag: '@cuj5' }, () => {
  // ── Part A: pre-emptive needs-login ──

  test('needs login: logged out on an R-18 work, Log in to download before any click', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, R18.id);
    const view = await waitForText(page, 'Log in to download');
    const resting = await restingView(page);
    expect(resting).toMatchObject({
      text: 'Log in to download',
      glyph: null,
      title: TIP_LOGIN,
      ariaLabel: ARIA_LOGIN,
      ariaBusy: null,
      ariaDisabled: null,
      mode: 'row',
      hosts: 1,
      width: 164,
    });
    expect(view.classes).toContain('neutral');
    expect(resting.style.backgroundColor).toBe(WHITE);
    expect(resting.style.color).toBe(LOGIN_TEXT);
    expect(resting.style.borderTop).toMatch(new RegExp(`^[\\d.]+px solid ${esc(LOGIN_BORDER)}$`));
    expect(resting.style.boxShadow).toBe('none');
    const hovered = await hoveredView(page);
    expect(hovered.style.backgroundColor).toBe(LOGIN_HOVER_FILL);
    expect(hovered.style.borderTop).toMatch(new RegExp(`solid ${esc(LOGIN_HOVER_BORDER)}$`));
    expect(hovered.text).toBe('Log in to download');

    // The extension adds nothing to the page but its one host.
    const added = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .filter((el) => el.localName.includes('-') || el.parentElement === document.body)
        .map((el) => el.localName),
    );
    expect(added.filter((name) => name.includes('-'))).toEqual(['hfp-download']);
    expect(added.filter((name) => !name.includes('-')).sort()).toEqual([
      'header',
      'main',
      'script',
      'script',
    ]);
    // Nothing was fetched beyond the render-time metadata, and nothing is in flight.
    expect(server.requests((r) => r.path.startsWith('/ajax/illust/145892669/'))).toEqual([]);
    expect(await badgeText(harness)).toBe('');
  });

  test('login round-trip: Log in to download → pixiv login with return_to → Download · 68P → saves', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, R18.id);
    await waitForText(page, 'Log in to download');
    await clickButton(page);
    await page.waitForURL((url) => url.host === 'accounts.pixiv.net');
    expect(page.url()).toBe(loginUrlFor(R18.id));
    expect(page.url()).toBe(
      'https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2Fartworks%2F145892669',
    );

    await page.click('button[type="submit"]');
    await page.waitForURL(artworkUrl(R18.id));
    await exposeButton(page);
    const idle = await waitForText(page, 'Download · 68P');
    expect(idle.classes).toContain('primary');
    expect(idle.ariaLabel).toBe('Download all 68 original images of this artwork');
    expect(idle.width).toBe(164);

    await clickButton(page);
    await settle(page, 'Saved · 68P', 30_000);
    const files = (await downloadedPaths(harness)).filter((p) => p.startsWith(`${R18_FOLDER}/`));
    expect(files).toEqual(artworkFiles(R18, R18_FOLDER, range(0, 67), true));
    expect(server.requests((r) => r.path === '/ajax/illust/145892669/pages')[0]?.loggedIn).toBe(
      true,
    );
  });

  test('logged in elsewhere after this page loaded: still Log in to download; login bounces straight back', async ({
    harness,
  }) => {
    const page = await openArtwork(harness, R18.id);
    await waitForText(page, 'Log in to download');
    await harness.context.addCookies([SESSION_COOKIE]);
    // This document still says logged out.
    await page.waitForTimeout(300);
    expect((await buttonView(page)).text).toBe('Log in to download');
    await clickButton(page);
    await page.waitForURL(artworkUrl(R18.id));
    await exposeButton(page);
    await waitForText(page, 'Download · 68P');
  });

  test('logged out all-ages: normal idle Download, and the download succeeds', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, SINGLE.id);
    const idle = await waitForText(page, 'Download');
    expect(idle.classes).toContain('primary');
    expect(idle.ariaLabel).toBe('Download the original image of this artwork');
    await clickButton(page);
    await waitForText(page, 'Saved');
    expect(await downloadedPaths(harness)).toEqual(
      artworkFiles(SINGLE, 'pixiv/みずき-135882742', [0], true),
    );
    expect(server.requests((r) => r.host === 'www.pixiv.net').every((r) => !r.loggedIn)).toBe(true);
  });

  test('needs login (R-003): logged out on an all-ages work behind pixiv’s login wall → Log in to download before any click; login → Download · 4P → saves', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, WALLED.id);
    // The fake shows pixiv's wall instead of the image, as pixiv does for a logged-out visitor.
    const figure = page.locator('figure.work-figure');
    await expect(figure).toContainText('This work may contain sensitive content.');
    await expect(figure).toContainText('Please log in to view this work.');
    const view = await waitForText(page, 'Log in to download');
    const resting = await restingView(page);
    expect(resting).toMatchObject({
      text: 'Log in to download',
      glyph: null,
      title: TIP_LOGIN,
      ariaLabel: ARIA_LOGIN,
      ariaBusy: null,
      ariaDisabled: null,
      mode: 'row',
      hosts: 1,
    });
    expect(view.classes).toContain('neutral');
    expect(resting.style.backgroundColor).toBe(WHITE);
    expect(resting.style.color).toBe(LOGIN_TEXT);
    expect(resting.style.borderTop).toMatch(new RegExp(`^[\\d.]+px solid ${esc(LOGIN_BORDER)}$`));
    expect(resting.style.boxShadow).toBe('none');
    // Decided from the render-time metadata alone: nothing else of the work was fetched.
    expect(server.requests((r) => r.path === '/ajax/illust/135882745').length).toBeGreaterThan(0);
    expect(server.requests((r) => r.path.startsWith('/ajax/illust/135882745/'))).toEqual([]);
    expect(await badgeText(harness)).toBe('');

    await clickButton(page);
    await page.waitForURL((url) => url.host === 'accounts.pixiv.net');
    expect(page.url()).toBe(loginUrlFor(WALLED.id));
    expect(page.url()).toBe(
      'https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2Fartworks%2F135882745',
    );

    await page.click('button[type="submit"]');
    await page.waitForURL(artworkUrl(WALLED.id));
    await exposeButton(page);
    const idle = await waitForText(page, 'Download · 4P');
    expect(idle.classes).toContain('primary');
    expect(idle.ariaLabel).toBe('Download all 4 original images of this artwork');

    await clickButton(page);
    await settle(page, 'Saved · 4P');
    expect(await downloadedPaths(harness)).toEqual(
      artworkFiles(WALLED, WALLED_FOLDER, range(0, 3), true),
    );
  });

  test('needs login (R-003): a click before the metadata arrived never reaches /pages or i.pximg.net and ends Log in to download', async ({
    harness,
    server,
  }) => {
    // Drip-fed, never stalled: the render-time fetch and the SW resolver's own call stay in flight.
    const hold = server.hold((r) => r.path === '/ajax/illust/135882745');
    const page = await openArtwork(harness, WALLED.id);
    const pending = await waitForText(page, 'Download');
    expect(pending.classes).toContain('primary');
    await expect.poll(() => hold.held).toBe(1);
    await clickButton(page);
    await expect.poll(() => hold.held).toBe(2);
    hold.release();

    const view = await settle(page, 'Log in to download');
    expect(view).toMatchObject({ title: TIP_LOGIN, ariaLabel: ARIA_LOGIN, glyph: null });
    expect(view.classes).toContain('neutral');
    expect(server.requests((r) => r.path === '/ajax/illust/135882745/pages')).toEqual([]);
    expect(server.requests((r) => r.path === '/ajax/illust/135882745/ugoira_meta')).toEqual([]);
    expect(
      server.requests((r) => r.host === 'i.pximg.net' && r.path.includes('135882745')),
    ).toEqual([]);
    expect(await downloadedPaths(harness)).toEqual([]);
    await expectBadge(harness, '', IDLE_TITLE);
  });

  test('needs login (R-003): logged in, the walled work is the normal idle Download · 4P and saves', async ({
    harness,
    server,
  }) => {
    await harness.context.addCookies([SESSION_COOKIE]);
    const page = await openArtwork(harness, WALLED.id);
    const idle = await waitForText(page, 'Download · 4P');
    expect(idle.classes).toContain('primary');
    await clickButton(page);
    await settle(page, 'Saved · 4P');
    expect(await downloadedPaths(harness)).toEqual(
      artworkFiles(WALLED, WALLED_FOLDER, range(0, 3), true),
    );
    expect(server.requests((r) => r.path === '/ajax/illust/135882745/pages')[0]?.loggedIn).toBe(
      true,
    );
  });

  // ── Part B: reactive error states ──

  test('partial: Retry · 3 failed with the exact tooltip; retry fetches only those 3 into the same folder → Saved · 12P', async ({
    harness,
    server,
  }) => {
    failPages(harness, server, EXAMPLE, [4, 9, 11]);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    await settle(page, 'Retry · 3 failed');
    const view = await restingView(page);
    expectRedOutline(view);
    expect(view.title).toBe(
      '9 of 12 pages saved. 3 failed after 4 attempts each. Click to retry just those 3.',
    );
    expect(view.ariaLabel).toBe('9 of 12 pages saved, 3 failed. Click to retry the failed pages.');
    expect(view.live).toBe('3 pages failed');
    const hovered = await hoveredView(page);
    expect(hovered.style.backgroundColor).toBe(RED_TINT);
    expect(hovered.text).toBe('Retry · 3 failed');
    await expectBadge(harness, '', IDLE_TITLE);

    // 4 attempts on each failing page, 1 on every other page.
    for (const p of ALL_PAGES) {
      expect(server.requests(pagesOf(EXAMPLE, [p])), `page ${p}`).toHaveLength(
        [4, 9, 11].includes(p) ? 4 : 1,
      );
    }
    const saved = ALL_PAGES.filter((p) => ![4, 9, 11].includes(p));
    expect(await downloadedPaths(harness)).toEqual(artworkFiles(EXAMPLE, FOLDER, saved, true));

    // The pattern changes before the retry: the retry still writes into the job's folder.
    await writeSettings(harness, { folderPattern: 'elsewhere/{id}' });
    const hold = server.hold(pagesOf(EXAMPLE, [4, 9, 11]));
    await watchLabels(page);
    const retriedAt = Date.now();
    await clickButton(page);
    const busy = await waitForText(page, '9 / 12');
    expect(busy.ariaBusy).toBe('true');
    expect(busy.classes).not.toContain('error');
    await expectBadge(harness, '3', 'Helper for Pixiv — 3 files remaining');
    await expect.poll(() => hold.held).toBe(3);
    expect(busy.live).toBe('Downloading 3 pages');
    hold.release();
    const done = await settle(page, 'Saved · 12P');
    expect(done.title).toBe(`Saved to Downloads/${FOLDER}`);
    await expectBadge(harness, '', IDLE_TITLE);
    // The count continues 9 / 12 → 11 / 12, then Saved · 12P directly (R-006 rev. 3).
    const log = await labelLog(page);
    expect(counts(log, 12).filter((n) => n < 9 || n > 11)).toEqual([]);
    expect(log.map(({ text }) => text)).not.toContain('12 / 12');
    expect(log.at(-1)?.text).toBe('Saved · 12P');

    // Only the 3 failed originals were fetched and handed to Chrome again.
    const refetched = requestsAfter(server, pagesOf(EXAMPLE, ALL_PAGES), retriedAt).map(
      (r) => r.url,
    );
    expect(refetched.sort()).toEqual([4, 9, 11].map((p) => originalUrl(EXAMPLE, p)).sort());
    expect(await downloadsStartedAfter(harness, retriedAt)).toEqual(
      [4, 9, 11].map((p) => `みずき-135882741/${fileName(EXAMPLE, p)}`).sort(),
    );
    expect(await downloadedPaths(harness)).toEqual(artworkFiles(EXAMPLE, FOLDER, ALL_PAGES, true));
  });

  test('partial one: Retry · 1 failed with the one-page tooltip; a 404 is not retried; reload clears the memory', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    server.fault({ match: `/${fileName(EXAMPLE, 7)}`, responses: [404] });
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    const view = await settle(page, 'Retry · 1 failed');
    expectRedOutline(await restingView(page));
    expect(view.title).toBe(
      '11 of 12 pages saved. 1 failed after 4 attempts. Click to retry just that one.',
    );
    expect(view.ariaLabel).toBe('11 of 12 pages saved, 1 failed. Click to retry the failed pages.');
    expect(view.live).toBe('1 page failed');
    // Other 4xx codes are not retried (PRD §4.5.2).
    expect(server.requests(pagesOf(EXAMPLE, [7]))).toHaveLength(1);

    // SPA away and back keeps the failure; a reload clears it.
    await page.click(`a[data-spa][href="/artworks/${SINGLE.id}"]`);
    await waitForText(page, 'Download');
    await page.goBack();
    await waitForText(page, 'Retry · 1 failed');
    await page.reload();
    await exposeButton(page);
    await waitForText(page, 'Download · 12P');
    const partial = await downloadedPaths(harness);
    expect(partial).toEqual(
      artworkFiles(
        EXAMPLE,
        FOLDER,
        ALL_PAGES.filter((p) => p !== 7),
        true,
      ),
    );
    await clickButton(page);
    const saved = await settle(page, 'Saved · 12P');
    // The new full job finds the 11 landed pages, so it saves everything into the sibling folder
    // with clean names and leaves the partial folder as it is (PRD CUJ-5 edge "Partial failure,
    // then reload").
    expect(saved.title).toBe(`Saved to Downloads/${FOLDER} (1)`);
    expect(await downloadedPaths(harness)).toEqual(
      [...partial, ...artworkFiles(EXAMPLE, `${FOLDER} (1)`, ALL_PAGES, true)].sort(),
    );
  });

  // PRD CUJ-5 step 6, accepted cost: the job's API calls answered, so this reads as a server
  // failure although no original got a response (R-004 S3).
  test('server failure: every original drops its connection while the API answered → Retry with "pixiv isn’t responding"; Retry re-runs the whole job', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    server.fault({ match: 'https://i.pximg.net/img-original/', responses: { reset: true } });
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    const view = await settle(page, 'Retry', 30_000);
    expectRedOutline(await restingView(page));
    expect(view.title).toBe(TIP_SERVER);
    expect(view.ariaLabel).toBe(ariaFailed(TIP_SERVER));
    expect(view.live).toBe(TIP_SERVER);
    await expectBadge(harness, '', IDLE_TITLE);
    for (const p of ALL_PAGES) {
      expect(server.requests(pagesOf(EXAMPLE, [p])), `page ${p}`).toHaveLength(4);
    }

    // Back online: Retry runs the whole job again with the current settings.
    server.clearFaults();
    await clickButton(page);
    await settle(page, 'Saved · 12P');
    // Only metadata.json had landed; the folder check never consults it (PRD §4.3 "Folder choice").
    expect(await downloadedPaths(harness)).toEqual(
      [...artworkFiles(EXAMPLE, FOLDER, ALL_PAGES, true), `${FOLDER}/metadata (1).json`].sort(),
    );
  });

  test('offline: pixiv unreachable after the page loaded (API and images) → Retry with "No connection"', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    server.fault({
      match: /^https:\/\/(www\.pixiv\.net\/ajax|i\.pximg\.net)\//,
      responses: { reset: true },
    });
    await clickButton(page);
    const view = await settle(page, 'Retry', 30_000);
    expect(view.title).toBe(TIP_OFFLINE);
    expect(view.ariaLabel).toBe(ariaFailed(TIP_OFFLINE));
    expect(await downloadedPaths(harness)).toEqual([]);
    await expectBadge(harness, '', IDLE_TITLE);
  });

  test('server failure: 5xx on every original after 4 attempts → Retry with "pixiv isn’t responding"', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    server.fault({ match: 'https://i.pximg.net/img-original/', responses: 504 });
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    const view = await settle(page, 'Retry', 30_000);
    expectRedOutline(await restingView(page));
    expect(view.title).toBe(TIP_SERVER);
    expect(view.ariaLabel).toBe(ariaFailed(TIP_SERVER));
    await expectBadge(harness, '', IDLE_TITLE);
    for (const p of ALL_PAGES) {
      expect(server.requests(pagesOf(EXAMPLE, [p])), `page ${p}`).toHaveLength(4);
    }
  });

  test('sustained outage: every original answers 503; 7 consecutive clicks each end Retry with "pixiv isn’t responding", never "No connection"', async ({
    harness,
    server,
  }) => {
    // Chromium refuses some later attempts locally; which ones is its call, so the server hits per
    // click are recorded, not asserted.
    harness.allowConsoleErrors(...FAULT_LOGS, /Request throttled/);
    const original = originalUrl(SINGLE, 0);
    const isOriginal = (r: LoggedRequest) => r.url.startsWith(original);
    const isJobPages = (r: LoggedRequest) => r.path === `/ajax/illust/${SINGLE.id}/pages`;
    server.fault({ match: original, responses: 503 });
    const page = await openArtwork(harness, SINGLE.id);
    await waitForText(page, 'Download');
    const hits: number[] = [];
    for (let click = 1; click <= 7; click++) {
      const since = Date.now();
      await clickButton(page);
      const view = await settle(page, 'Retry', 30_000);
      expect(requestsAfter(server, isJobPages, since), `click ${click} ran a job`).toHaveLength(1);
      expect(view.title, `click ${click}`).toBe(TIP_SERVER);
      expect(view.ariaLabel, `click ${click}`).toBe(ariaFailed(TIP_SERVER));
      hits.push(requestsAfter(server, isOriginal, since).length);
    }
    test.info().annotations.push({ type: 'server hits per click', description: hits.join(', ') });
    expectRedOutline(await restingView(page));
    await expectBadge(harness, '', IDLE_TITLE);

    // pixiv now answers nothing at all: this click's job got no response, so "No connection".
    server.clearFaults();
    server.fault({
      match: /^https:\/\/(www\.pixiv\.net\/ajax|i\.pximg\.net)\//,
      responses: { reset: true },
    });
    await clickButton(page);
    const offline = await settle(page, 'Retry', 30_000);
    expect(offline.title).toBe(TIP_OFFLINE);
    expect(offline.ariaLabel).toBe(ariaFailed(TIP_OFFLINE));
  });

  test('refused: logged in with R-18 display off → Retry with "pixiv refused this work"', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    await harness.context.addCookies([SESSION_COOKIE]);
    server.patchWork(R18.id, { r18Hidden: true });
    const page = await openArtwork(harness, R18.id);
    await waitForText(page, 'Download · 68P');
    await clickButton(page);
    const view = await settle(page, 'Retry');
    expectRedOutline(await restingView(page));
    expect(view.title).toBe(TIP_REFUSED);
    expect(view.ariaLabel).toBe(ariaFailed(TIP_REFUSED));
    expect(await downloadedPaths(harness)).toEqual([]);
    await expectBadge(harness, '', IDLE_TITLE);
    // A pixiv error body is an answer, not a transient fault: asked once.
    expect(server.requests((r) => r.path === '/ajax/illust/145892669/pages')).toHaveLength(1);
  });

  test('refused: logged out in another tab after this page loaded → Download, then Retry with the refused tooltip', async ({
    harness,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    await harness.context.addCookies([SESSION_COOKIE]);
    const page = await openArtwork(harness, R18.id);
    await waitForText(page, 'Download · 68P');
    await harness.context.clearCookies();
    await clickButton(page);
    const view = await settle(page, 'Retry');
    expect(view.title).toBe(TIP_REFUSED);
  });

  test('unavailable: deleted after the page loaded → gray Unavailable; clicking does nothing', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    const page = await openArtwork(harness, SINGLE.id);
    await waitForText(page, 'Download');
    server.patchWork(SINGLE.id, { deleted: true });
    await clickButton(page);
    await settle(page, 'Unavailable');
    const view = await restingView(page);
    expect(view).toMatchObject({
      text: 'Unavailable',
      glyph: null,
      title: TIP_UNAVAILABLE,
      ariaLabel: TIP_UNAVAILABLE,
      ariaDisabled: 'true',
      ariaBusy: null,
      width: 164,
    });
    expect(view.classes).toContain('disabled');
    expect(view.style.backgroundColor).toBe(GRAY_FILL);
    expect(view.style.color).toBe(GRAY_TEXT);
    expect(view.style.borderTop).toMatch(/^0px none/);
    expect(view.style.boxShadow).toBe('none');
    const hovered = await hoveredView(page);
    expect(hovered.style.backgroundColor).toBe(GRAY_FILL);
    const cursor = await page.evaluate(() => {
      const root = (window as unknown as Record<string, ShadowRoot>)['__hfpButtonRoot'];
      const pill = root?.querySelector('button.pill:not(.measure)');
      return pill ? getComputedStyle(pill).cursor : null;
    });
    expect(cursor).toBe('not-allowed');
    await expectBadge(harness, '', IDLE_TITLE);

    // Clicking (mouse or keyboard) does nothing.
    await page.waitForTimeout(CLICK_GUARD_MS);
    const before = Date.now();
    await clickButton(page);
    await page.waitForTimeout(500);
    expect((await buttonView(page)).text).toBe('Unavailable');
    for (let i = 0; i < 40 && !(await buttonHasFocus(page)); i++) await page.keyboard.press('Tab');
    expect(await buttonHasFocus(page)).toBe(true);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    expect((await buttonView(page)).text).toBe('Unavailable');
    expect(server.requests((r) => r.at >= before && r.path.includes('/ajax/'))).toEqual([]);
    expect(await downloadedPaths(harness)).toEqual([]);
  });

  test('unavailable: a work that 404s at render time shows Unavailable immediately', async ({
    harness,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    const page = await openArtwork(harness, DELETED_ID);
    const view = await waitForText(page, 'Unavailable');
    expect(view.ariaDisabled).toBe('true');
    expect(view.title).toBe(TIP_UNAVAILABLE);
    expect(view.style.backgroundColor).toBe(GRAY_FILL);
  });

  test('encode failure (136004516, corrupt frame): zip + frames.json, no video, Retry · MP4; its retry saves no second zip', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    const page = await openArtwork(harness, CORRUPT.id);
    const idle = await waitForText(page, /^Download · (MP4|WebM)$/);
    const format = idle.text.endsWith('MP4') ? 'MP4' : 'WebM';
    await clickButton(page);
    const view = await settle(page, `Retry · ${format}`, 30_000);
    // Same fixed width as the idle state (the ugoira width is a separate QA finding).
    expectRedOutline(await restingView(page), idle.width);
    expect(view.title).toBe(TIP_ENCODE);
    expect(view.ariaLabel).toBe(TIP_ENCODE);
    await expectBadge(harness, '', IDLE_TITLE);
    const expected = [
      `${CORRUPT_FOLDER}/136004516_ugoira.zip`,
      `${CORRUPT_FOLDER}/frames.json`,
      `${CORRUPT_FOLDER}/metadata.json`,
    ];
    expect(await downloadedPaths(harness)).toEqual(expected);

    // The retry fetches the zip into memory, encodes again (still corrupt), writes nothing.
    const zipRequests = () => server.requests((r) => r.path.includes('/img-zip-ugoira/')).length;
    const zipsBefore = zipRequests();
    const retriedAt = Date.now();
    await clickButton(page);
    await page.waitForTimeout(CLICK_GUARD_MS);
    await settle(page, `Retry · ${format}`, 30_000);
    expect(zipRequests()).toBe(zipsBefore + 1);
    expect(await downloadsStartedAfter(harness, retriedAt)).toEqual([]);
    expect(await downloadedPaths(harness)).toEqual(expected);
  });

  test('encode failure, then a working encoder: Retry · MP4 produces only the video', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    const key = `${CAPS_KEY_PREFIX}${UGOIRA.width}x${UGOIRA.height}`;
    const page = await openArtwork(harness, UGOIRA.id);
    await waitForText(page, /^Download · (MP4|WebM)$/);
    const real = await harness.swEval(
      async (k) => (await chrome.storage.session.get(k))[k] as { avc: string | null } | undefined,
      key,
    );
    if (!real?.avc) {
      test.skip(true, 'no H.264 encoder in this Chromium: MP4 encode failure cannot be staged');
    }
    // An H.264 codec string no encoder accepts: the encode fails at configure time.
    await harness.swEval(
      async (k) => chrome.storage.session.set({ [k]: { avc: 'avc1.FFFFFF', vp9: true } }),
      key,
    );
    await clickButton(page);
    const failed = await settle(page, 'Retry · MP4', 30_000);
    expect(failed.title).toBe(TIP_ENCODE);
    const before = [
      `${UGOIRA_FOLDER}/136004512_ugoira.zip`,
      `${UGOIRA_FOLDER}/frames.json`,
      `${UGOIRA_FOLDER}/metadata.json`,
    ];
    expect(await downloadedPaths(harness)).toEqual(before);

    // The encoder works again (the probe runs anew): the retry writes only the video.
    await harness.swEval(async (k) => chrome.storage.session.remove(k), key);
    const zipsBefore = server.requests((r) => r.path.includes('/img-zip-ugoira/')).length;
    const retriedAt = Date.now();
    await hoverButton(page, false);
    await clickButton(page);
    const busy = await waitForText(page, /^\d+%$/);
    expect(busy.classes).not.toContain('error');
    await settle(page, 'Saved · MP4', 30_000);
    expect(await downloadsStartedAfter(harness, retriedAt)).toEqual([
      'ひなた-136004512/136004512.mp4',
    ]);
    expect(server.requests((r) => r.path.includes('/img-zip-ugoira/')).length).toBe(zipsBefore + 1);
    expect(await downloadedPaths(harness)).toEqual(
      [...before, `${UGOIRA_FOLDER}/136004512.mp4`].sort(),
    );
  });

  test('403 mid-job: nothing retried or started after it, saved files stay, Log in to download; login then re-runs the job', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    server.fault({ match: `/${fileName(EXAMPLE, 5)}`, responses: { status: 403 } });
    const hold = server.hold(pagesOf(EXAMPLE, range(6, 11)));
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    await server.waitForRequest(pagesOf(EXAMPLE, [5]));
    await page.waitForTimeout(500);
    hold.release();
    const view = await settle(page, 'Log in to download');
    const resting = await restingView(page);
    expect(resting.classes).toContain('neutral');
    expect(resting.title).toBe(TIP_LOGIN);
    expect(resting.width).toBe(164);
    await expectBadge(harness, '', IDLE_TITLE);
    expect(view.glyph).toBeNull();

    // 403 is never retried; queued pages never start.
    expect(server.requests(pagesOf(EXAMPLE, [5]))).toHaveLength(1);
    expect(server.requests(pagesOf(EXAMPLE, [10, 11]))).toEqual([]);
    const landed = server
      .requests(pagesOf(EXAMPLE, ALL_PAGES))
      .filter((r) => r.status === 200)
      .map((r) => fileName(EXAMPLE, Number(/_p(\d+)\./.exec(r.url)?.[1])));
    const onDisk = await downloadedPaths(harness);
    expect(onDisk).toEqual(
      [`${FOLDER}/metadata.json`, ...landed.map((name) => `${FOLDER}/${name}`)].sort(),
    );
    expect(onDisk).not.toContain(`${FOLDER}/${fileName(EXAMPLE, 5)}`);

    // Steps 2–3: pixiv login and back; a click runs the whole job again.
    server.clearFaults();
    await clickButton(page);
    await page.waitForURL((url) => url.host === 'accounts.pixiv.net');
    expect(page.url()).toBe(loginUrlFor(EXAMPLE.id));
    await page.click('button[type="submit"]');
    await page.waitForURL(artworkUrl(EXAMPLE.id));
    await exposeButton(page);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    const saved = await settle(page, 'Saved · 12P');
    // The earlier files are still present, so the new job lands in the sibling folder with clean
    // names; the first folder keeps what it had (PRD CUJ-5 step 9, §4.3 "Folder choice").
    expect(saved.title).toBe(`Saved to Downloads/${FOLDER} (1)`);
    expect(await downloadedPaths(harness)).toEqual(
      [...onDisk, ...artworkFiles(EXAMPLE, `${FOLDER} (1)`, ALL_PAGES, true)].sort(),
    );
  });

  test('badge in error states: a failed job shows no badge, another running job keeps counting', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    const holdB = server.hold(pagesOf(TAB_B, range(3, 7)));
    const tabB = await openArtwork(harness, TAB_B.id);
    await waitForText(tabB, 'Download · 8P');
    await clickButton(tabB);
    await waitForText(tabB, '3 / 8');
    await expect.poll(() => holdB.held).toBe(5);

    server.fault({ match: `/${fileName(SINGLE, 0)}`, responses: 502 });
    const tabA = await openArtwork(harness, SINGLE.id);
    await waitForText(tabA, 'Download');
    await clickButton(tabA);
    const failed = await settle(tabA, 'Retry');
    expect(failed.title).toBe(TIP_SERVER);
    await expectBadge(harness, '5', 'Helper for Pixiv — 5 files remaining');
    holdB.release();
    await waitForText(tabB, 'Saved · 8P');
    await expectBadge(harness, '', IDLE_TITLE);
    expect(await actionTitle(harness)).toBe(IDLE_TITLE);
  });

  test('cancel a retry: cancelling never shows red or a message', async ({ harness, server }) => {
    failPages(harness, server, EXAMPLE, [11]);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    await settle(page, 'Retry · 1 failed');
    const hold = server.hold(pagesOf(EXAMPLE, [11]));
    await clickButton(page);
    // After the click, not before: the guard runs from the page's click, which lands after
    // buttonCenter's round trip; timed from before it, the cancel click can land at 480-499 ms.
    const startedAt = Date.now();
    await waitForText(page, '11 / 12');
    await expect.poll(() => hold.held).toBe(1);
    await hoverButton(page, false);
    await hoverButton(page, true);
    await waitForText(page, 'Cancel');
    await page.waitForTimeout(TRANSITION_MS);
    const face = await buttonView(page);
    expect(face.text).toBe('Cancel');
    expect(face.style.backgroundColor).toBe(LOGIN_TEXT);
    expect(face.classes).not.toContain('error');
    await page.waitForTimeout(Math.max(0, startedAt + CLICK_GUARD_MS - Date.now()));
    await clickButton(page);
    await hoverButton(page, false);
    const idle = await waitForText(page, 'Download · 12P');
    expect(idle.classes).toContain('primary');
    expect(idle.classes).not.toContain('error');
    expect(idle.title).toBeNull();
    expect((await restingView(page)).style.backgroundColor).toBe(BLUE);
    expect(idle.live).toBe('Download cancelled');
    await expectBadge(harness, '', IDLE_TITLE);
    hold.release();
  });

  test('retry policy: 429 (Retry-After capped), 500/502/503/504, resets, stalls and API 503s are retried to success; gaps follow the policy', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    const ra = { status: 429, retryAfter: 120 };
    const reset = { reset: true };
    const sequences: Record<number, FaultResponse[]> = {
      0: [ra, ra, ra, 200],
      1: [500, 500, 200],
      2: [502, 502, 502, 200],
      3: [503, 503, 200],
      4: [504, 504, 504, 200],
      5: [reset, reset, reset, 200],
      6: [{ stallAfterBytes: 40 }, 200],
    };
    for (const [p, responses] of Object.entries(sequences)) {
      server.fault({
        match: `/${fileName(EXAMPLE, Number(p))}`,
        responses,
      });
    }
    server.fault({ match: '/ajax/illust/135882741/pages', responses: [503, 503, 200] });
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    await settle(page, 'Saved · 12P', 30_000);
    expect(await downloadedPaths(harness)).toEqual(artworkFiles(EXAMPLE, FOLDER, ALL_PAGES, true));

    const times = (p: number) => server.requests(pagesOf(EXAMPLE, [p])).map((r) => r.at);
    for (const p of [0, 2, 4, 5]) expect(times(p), `page ${p}`).toHaveLength(4);
    for (const p of [1, 3]) expect(times(p), `page ${p}`).toHaveLength(3);
    expect(times(6)).toHaveLength(2);
    expect(server.requests((r) => r.path === '/ajax/illust/135882741/pages')).toHaveLength(3);

    const gaps = (p: number) => {
      const t = times(p);
      return t.slice(1).map((at, i) => at - (t[i] ?? at));
    };
    // Retry-After: 120 → min(120, 30) s, scaled ×0.01 in dist-e2e → 300 ms per wait.
    for (const gap of gaps(0)) expect(gap).toBeGreaterThanOrEqual(290);
    // Backoff 1.5·2ⁿ s (+0–0.5 s jitter), scaled ×0.01 → ~15, ~30, ~60 ms; each wait longer.
    for (const p of [1, 2, 3, 4]) {
      const [g0, g1, g2] = gaps(p);
      expect(g0, `page ${p} gap 0`).toBeGreaterThanOrEqual(14);
      expect(g1, `page ${p} gap 1`).toBeGreaterThanOrEqual(29);
      if (g2 !== undefined) {
        expect(g2, `page ${p} gap 2`).toBeGreaterThanOrEqual(59);
        expect(g2, `page ${p} gap 2`).toBeLessThan(290);
      }
    }
  });

  // ── Part C: page-redesign fallback ──

  /** PRD CUJ-5 step 11 (R-004 S4): the pill is on screen within 3 s of the anchor. */
  const FLOAT_WITHIN_MS = 3_000;

  /**
   * Page function: stamps `__pillPaintedAt` (performance.now()) in the first animation frame after
   * an <hfp-download> connects, the "pill appearing" end of the 3 s. Self-contained, because it
   * runs as an init script or through page.evaluate().
   */
  function stampPillPaint(): void {
    const w = window as unknown as { __pillPaintedAt?: number };
    const observer = new MutationObserver(() => {
      if (!document.querySelector('hfp-download')) return;
      observer.disconnect();
      requestAnimationFrame(() => {
        w.__pillPaintedAt = performance.now();
      });
    });
    observer.observe(document, { childList: true, subtree: true });
  }

  /** Waits for the stamp of stampPillPaint() and returns it. */
  async function pillPaintedAt(page: Page): Promise<number> {
    const handle = await page.waitForFunction(
      () => (window as unknown as { __pillPaintedAt?: number }).__pillPaintedAt,
      undefined,
      { timeout: 6_000 },
    );
    return (await handle.jsonValue()) as number;
  }

  test('floating fallback: row removed before a direct load → floating pill at the artwork’s bottom-right within 3 s; downloads; moves into the row when it appears', async ({
    harness,
  }) => {
    const page = await harness.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __fakeValue?: unknown };
      // pixiv "redesign": the action row never renders in this document.
      Object.defineProperty(window, '__fake', {
        configurable: true,
        get: () => w.__fakeValue,
        set(value: { removeRow(): void }) {
          value.removeRow();
          w.__fakeValue = value;
        },
      });
    });
    await page.addInitScript(stampPillPaint);
    await page.goto(artworkUrl(EXAMPLE.id));
    const paintedAt = await pillPaintedAt(page);
    // The page has loaded once its HTML is parsed (the content script starts right after).
    const loadedAt = await page.evaluate(
      () =>
        (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)
          .domInteractive,
    );
    const delay = paintedAt - loadedAt;
    test.info().annotations.push({ type: 'floating delay ms', description: delay.toFixed(0) });
    expect(delay).toBeLessThanOrEqual(FLOAT_WITHIN_MS);
    await exposeButton(page);

    const idle = await waitForText(page, 'Download · 12P');
    expect(idle.mode).toBe('floating');
    expect(idle.style.boxShadow).toBe('rgba(0, 0, 0, 0.24) 0px 2px 8px 0px');
    const geometry = await page.evaluate(() => {
      const host = document.querySelector('hfp-download');
      const figure = document.querySelector('figure.work-figure');
      if (!host || !figure) return null;
      const h = host.getBoundingClientRect();
      const f = figure.getBoundingClientRect();
      return {
        right: f.right - h.right,
        bottom: f.bottom - h.bottom,
        position: getComputedStyle(host).position,
      };
    });
    expect(geometry?.position).toBe('fixed');
    expect(Math.abs((geometry?.right ?? 0) - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs((geometry?.bottom ?? 0) - 16)).toBeLessThanOrEqual(1);
    expect(idle.width).toBe(164);

    await clickButton(page);
    await settle(page, 'Saved · 12P');
    expect(await downloadedPaths(harness)).toEqual(artworkFiles(EXAMPLE, FOLDER, ALL_PAGES, true));

    // The row appears later: the button moves into it and keeps its state.
    await page.evaluate(() => (window as unknown as FakeWindow).__fake.restoreRow());
    await expect.poll(async () => (await buttonView(page)).mode).toBe('row');
    expect((await buttonView(page)).text).toBe('Saved · 12P');
    expect(
      await page.evaluate(
        () =>
          document.querySelector('hfp-download')?.previousElementSibling ===
          document.querySelector('section.row > .like'),
      ),
    ).toBe(true);
  });

  test('floating fallback: SPA navigation with the row gone; dark theme ring; viewport fallback without the artwork area', async ({
    harness,
  }) => {
    const page = await harness.newPage();
    await page.goto('https://www.pixiv.net/');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.querySelectorAll('hfp-download').length)).toBe(0);
    await page.evaluate(() => (window as unknown as FakeWindow).__fake.removeRow());
    await page.evaluate(stampPillPaint);
    // The in-app navigation starts with the click on pixiv's link (capture phase, before pixiv's).
    await page.evaluate(() => {
      const w = window as unknown as { __clickAt?: number };
      document.addEventListener('click', () => (w.__clickAt ??= performance.now()), true);
    });
    await page.click(`a[data-spa][href="/artworks/${EXAMPLE.id}"]`);
    const paintedAt = await pillPaintedAt(page);
    const clickAt = await page.evaluate(
      () => (window as unknown as { __clickAt?: number }).__clickAt ?? Number.NaN,
    );
    const elapsed = paintedAt - clickAt;
    test.info().annotations.push({
      type: 'floating after SPA ms',
      description: elapsed.toFixed(0),
    });
    expect(elapsed).toBeLessThanOrEqual(FLOAT_WITHIN_MS);
    await exposeButton(page);
    expect((await waitForText(page, 'Download · 12P')).mode).toBe('floating');

    await page.evaluate(() => (window as unknown as FakeWindow).__fake.setTheme('dark'));
    for (let i = 0; i < 60 && !(await buttonHasFocus(page)); i++) await page.keyboard.press('Tab');
    expect(await buttonHasFocus(page)).toBe(true);
    const focused = await buttonView(page);
    expect(focused.style.outlineColor).toBe(DARK_RING);
    expect(focused.style.backgroundColor).toBe(BLUE);

    // No artwork area either: fixed 24 px from the viewport's bottom-right.
    await page.evaluate(() => document.querySelector('figure.work-figure')?.remove());
    await expect.poll(async () => (await buttonView(page)).mode).toBe('viewport');
    const inset = await page.evaluate(() => {
      const host = document.querySelector('hfp-download');
      if (!host) return null;
      const r = host.getBoundingClientRect();
      return { right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom };
    });
    expect(inset).toEqual({ right: 24, bottom: 24 });
  });
});

// Added by the QA gate (iteration 2): R-003 and outage-classification cases with no e2e check yet.
// | PRD                                                                           | Test                    |
// | ----------------------------------------------------------------------------- | ----------------------- |
// | AC 1 "xRestrict 1 or 2": logged out on an R-18G work → `Log in to download`   | 'needs login: R-18G'    |
// | AC 4 / CUJ-2 edge "logged out on an R-18 ugoira": a walled all-ages ugoira,   | 'needs login: walled    |
// |      incl. a click before the metadata: no ugoira_meta, no zip, no file      | ugoira'                 |
// | AC 4 + CUJ-1 step 7: SPA navigation into and out of a walled work             | 'needs login: SPA'      |
// | Step 6 detection: "pixiv server failure" when a 429/5xx answer precedes the   | 'server failure: an     |
// |      final dropped connections (system.md §10 row 8, `answered`)              | answer, then drops'     |
test.describe('CUJ-5: QA gate additions (iteration 2)', { tag: '@cuj5' }, () => {
  test('needs login: R-18G (xRestrict 2) logged out → Log in to download before any click; nothing fetched but the metadata', async ({
    harness,
    server,
  }) => {
    server.patchWork(R18.id, { xRestrict: 2 });
    const page = await openArtwork(harness, R18.id);
    await waitForText(page, 'Log in to download');
    const resting = await restingView(page);
    expect(resting).toMatchObject({
      text: 'Log in to download',
      glyph: null,
      title: TIP_LOGIN,
      ariaLabel: ARIA_LOGIN,
      mode: 'row',
      hosts: 1,
      width: 164,
    });
    expect(resting.style.backgroundColor).toBe(WHITE);
    expect(resting.style.color).toBe(LOGIN_TEXT);
    expect(resting.style.borderTop).toMatch(new RegExp(`solid ${esc(LOGIN_BORDER)}$`));
    expect(server.requests((r) => r.path.startsWith('/ajax/illust/145892669/'))).toEqual([]);
    expect(server.requests((r) => r.host === 'i.pximg.net')).toEqual([]);
    await clickButton(page);
    await page.waitForURL((url) => url.host === 'accounts.pixiv.net');
    expect(page.url()).toBe(loginUrlFor(R18.id));
  });

  test('needs login: a walled all-ages ugoira logged out → Log in to download; a click before the metadata reaches neither ugoira_meta nor the zip', async ({
    harness,
    server,
  }) => {
    server.patchWork(UGOIRA.id, { sensitiveWall: true });
    const page = await openArtwork(harness, UGOIRA.id);
    await expect(page.locator('figure.work-figure')).toContainText(
      'This work may contain sensitive content.',
    );
    const view = await waitForText(page, 'Log in to download');
    expect(view).toMatchObject({ title: TIP_LOGIN, ariaLabel: ARIA_LOGIN, glyph: null });
    // Stays put once the codec probe answers (the hint never replaces the needs-login state).
    await page.waitForTimeout(1_000);
    expect((await restingView(page)).text).toBe('Log in to download');
    await page.close();

    // The race: the click lands while both metadata requests are still in flight.
    const hold = server.hold((r) => r.path === '/ajax/illust/136004512');
    const racing = await openArtwork(harness, UGOIRA.id);
    expect((await waitForText(racing, 'Download')).classes).toContain('primary');
    await expect.poll(() => hold.held).toBe(1);
    await clickButton(racing);
    await expect.poll(() => hold.held).toBe(2);
    hold.release();
    const stopped = await settle(racing, 'Log in to download');
    expect(stopped.classes).toContain('neutral');

    expect(server.requests((r) => r.path === '/ajax/illust/136004512/ugoira_meta')).toEqual([]);
    expect(
      server.requests((r) => r.host === 'i.pximg.net' && r.path.includes('136004512')),
    ).toEqual([]);
    expect(await downloadedPaths(harness)).toEqual([]);
    await expectBadge(harness, '', IDLE_TITLE);
  });

  test('needs login: SPA navigation from a visible work into a walled work and back keeps each work’s own state', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await page.click('header a[data-spa][href="/"]');
    await page.click(`a[data-spa][href="/artworks/${WALLED.id}"]`);
    const walled = await waitForText(page, 'Log in to download');
    expect(walled).toMatchObject({ hosts: 1, mode: 'row', width: 164, ariaLabel: ARIA_LOGIN });
    await page.goBack();
    await page.goBack();
    expect((await waitForText(page, 'Download · 12P')).classes).toContain('primary');
    await page.goForward();
    await page.goForward();
    await waitForText(page, 'Log in to download');
    expect(server.requests((r) => r.path.startsWith('/ajax/illust/135882745/'))).toEqual([]);
    expect(
      server.requests((r) => r.host === 'i.pximg.net' && r.path.includes('135882745')),
    ).toEqual([]);
  });

  for (const first of [502, { status: 429, retryAfter: 1 }] as const) {
    const name = typeof first === 'number' ? String(first) : '429';
    test(`server failure: a ${name} answer, then dropped connections on every attempt left → Retry with "pixiv isn’t responding", not "No connection"`, async ({
      harness,
      server,
    }) => {
      harness.allowConsoleErrors(...FAULT_LOGS);
      const drop: FaultResponse = { reset: true };
      server.fault({
        match: originalUrl(SINGLE, 0),
        responses: [first, drop, drop, drop],
      });
      const page = await openArtwork(harness, SINGLE.id);
      await waitForText(page, 'Download');
      await clickButton(page);
      const view = await settle(page, 'Retry', 30_000);
      expectRedOutline(await restingView(page));
      expect(view.title).toBe(TIP_SERVER);
      expect(view.ariaLabel).toBe(ariaFailed(TIP_SERVER));
      expect(server.requests(originalUrl(SINGLE, 0))).toHaveLength(4);
      await expectBadge(harness, '', IDLE_TITLE);
    });
  }
});

// Added by the QA gate (iteration 3): R-005 at the ends CUJ-5 names, with no e2e check yet.
// | PRD                                                                            | Test                    |
// | ------------------------------------------------------------------------------ | ----------------------- |
// | Step 4 (R-005, R-006): the UI comes back whenever the last running job ends,   | 'download UI: 403 mid-  |
// |   for any reason (Saved, cancelled, failed, needs login after a mid-job 403,   |   job', 'partial',      |
// |   or Unavailable); with a final hand-off it is back on just before that file   |   'encode failure'      |
// | §4.1 #3 (R-005): the hidden window "never starts before the job's first file   | 'download UI: nothing   |
// |   is handed to Chrome" — a job that ends before any file reaches Chrome never  |   handed to Chrome'     |
// |   hides it (Unavailable, refused, no connection, needs login before metadata)  |                         |
test.describe('CUJ-5: QA gate additions (iteration 3)', { tag: '@cuj5' }, () => {
  test('download UI: 403 mid-job: Log in to download, and Chrome’s UI back on', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    server.fault({ match: `/${fileName(EXAMPLE, 5)}`, responses: { status: 403 } });
    const hold = server.hold(pagesOf(EXAMPLE, range(6, 11)));
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    await clickButton(page);
    await server.waitForRequest(pagesOf(EXAMPLE, [5]));
    await expect.poll(async () => (await downloadUi(harness)).requested).toBe(false);
    hold.release();
    const view = await settle(page, 'Log in to download');
    expect(view.title).toBe(TIP_LOGIN);
    const after = await downloadUiRestored(harness);
    expect(uiCalls(after.calls, base)).toEqual([
      { enabled: false, ok: true },
      { enabled: true, ok: true },
    ]);
  });

  test('download UI: partial: Retry · 3 failed turns it back on; the retry hides it again and restores it after Saved · 12P', async ({
    harness,
    server,
  }) => {
    failPages(harness, server, EXAMPLE, [4, 9, 11]);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    await clickButton(page);
    await settle(page, 'Retry · 3 failed');
    const failed = await downloadUiRestored(harness);
    expect(uiCalls(failed.calls, base)).toEqual([
      { enabled: false, ok: true },
      { enabled: true, ok: true },
    ]);
    const hold = server.hold(pagesOf(EXAMPLE, [4, 9, 11]));
    const retriedAt = Date.now();
    await clickButton(page);
    await waitForText(page, '9 / 12');
    await expect.poll(() => hold.held).toBe(3);
    // The retry writes no metadata.json, so nothing reaches Chrome until a page has been fetched,
    // and the hidden window never starts before that (§4.1 #3).
    expect((await downloadUi(harness)).requested).toBe(true);
    hold.release();
    await settle(page, 'Saved · 12P');
    await expect.poll(async () => (await downloadUi(harness)).calls.length).toBe(base + 4);
    const after = await downloadUiRestored(harness);
    expect(uiCalls(after.calls, base)).toEqual([
      { enabled: false, ok: true },
      { enabled: true, ok: true },
      { enabled: false, ok: true },
      { enabled: true, ok: true },
    ]);
    const retried = await harness.swEval(
      async (since) =>
        (await chrome.downloads.search({ startedAfter: new Date(since).toISOString() })).map(
          ({ startTime, endTime }) => ({
            startedAt: Date.parse(startTime),
            endedAt: endTime === undefined ? Number.NaN : Date.parse(endTime),
          }),
        ),
      retriedAt,
    );
    expect(retried).toHaveLength(3);
    const [, , hide, restore] = after.calls.slice(base);
    expect(Math.min(...retried.map((item) => item.startedAt))).toBeGreaterThanOrEqual(
      hide?.at ?? Number.POSITIVE_INFINITY,
    );
    // The retry's restore comes after Chrome created the two retried pages that started first,
    // and before the last one (R-006).
    const started = retried.map((item) => item.startedAt).sort((a, b) => a - b);
    const restoreAt = restore?.at ?? Number.NaN;
    expect(started[1]).toBeLessThanOrEqual(restoreAt);
    expect(restoreAt).toBeLessThanOrEqual(started[2] ?? Number.NEGATIVE_INFINITY);
  });

  test('download UI: encode failure: Retry · MP4 with Chrome’s UI back on', async ({ harness }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    const page = await openArtwork(harness, CORRUPT.id);
    await waitForText(page, /^Download · (MP4|WebM)$/);
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    await clickButton(page);
    await settle(page, /^Retry · (MP4|WebM)$/, 30_000);
    const after = await downloadUiRestored(harness);
    expect(uiCalls(after.calls, base)).toEqual([
      { enabled: false, ok: true },
      { enabled: true, ok: true },
    ]);
  });

  test('download UI: nothing handed to Chrome: Unavailable, refused, no connection and a needs-login click before the metadata never hide it', async ({
    harness,
    server,
  }) => {
    harness.allowConsoleErrors(...FAULT_LOGS);
    const base = (await downloadUiAfterBoot(harness)).calls.length;
    const noCalls = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const report = await downloadUi(harness);
      expect([report.requested, uiCalls(report.calls, base)]).toEqual([true, []]);
    };

    // Unavailable: deleted after the page loaded.
    const deleted = await openArtwork(harness, SINGLE.id);
    await waitForText(deleted, 'Download');
    server.patchWork(SINGLE.id, { deleted: true });
    await clickButton(deleted);
    await settle(deleted, 'Unavailable');
    await noCalls();
    await deleted.close();

    // A needs-login click made before the render-time metadata arrived (R-003).
    const hold = server.hold((r) => r.path === `/ajax/illust/${WALLED.id}`);
    const walled = await openArtwork(harness, WALLED.id);
    await waitForText(walled, 'Download');
    await expect.poll(() => hold.held).toBeGreaterThanOrEqual(1);
    await clickButton(walled);
    hold.release();
    await settle(walled, 'Log in to download');
    await noCalls();
    await walled.close();

    // No connection: pixiv answers nothing in this click.
    const offline = await openArtwork(harness, TAB_B.id);
    await waitForText(offline, 'Download · 8P');
    server.fault({
      match: /^https:\/\/(www\.pixiv\.net\/ajax|i\.pximg\.net)\//,
      responses: { reset: true },
    });
    await clickButton(offline);
    expect((await settle(offline, 'Retry', 30_000)).title).toBe(TIP_OFFLINE);
    await noCalls();
    server.clearFaults();
    await offline.close();

    // Refused: logged in with R-18 display off.
    await harness.context.addCookies([SESSION_COOKIE]);
    server.patchWork(R18.id, { r18Hidden: true });
    const refused = await openArtwork(harness, R18.id);
    await waitForText(refused, 'Download · 68P');
    await clickButton(refused);
    expect((await settle(refused, 'Retry')).title).toBe(TIP_REFUSED);
    await noCalls();
    expect(await downloadedPaths(harness)).toEqual([]);
  });
});

// Refuses the hand-off of every metadata.json while armed: a wrapper around the real
// chrome.downloads.download in the running SW (the engine looks the API up per call), standing in
// for a Chrome file-system refusal of that one file. Chrome's real API handles every other file.
async function refuseMetadataHandOff(harness: Harness, armed: boolean): Promise<void> {
  await harness.swEval((on) => {
    const qa = self as unknown as {
      __qaMeta?: { armed: boolean; refused: number };
    };
    if (!qa.__qaMeta) {
      qa.__qaMeta = { armed: on, refused: 0 };
      const state = qa.__qaMeta;
      const real = chrome.downloads.download.bind(chrome.downloads);
      chrome.downloads.download = (options: chrome.downloads.DownloadOptions) => {
        if (state.armed && /(^|[\\/])metadata\.json$/.test(options.filename ?? '')) {
          state.refused++;
          return Promise.reject(new Error('QA: metadata.json refused by the file system'));
        }
        return real(options);
      };
    }
    qa.__qaMeta.armed = on;
  }, armed);
}

function metadataRefusals(harness: Harness): Promise<number> {
  return harness.swEval(
    () => (self as unknown as { __qaMeta?: { refused: number } }).__qaMeta?.refused ?? 0,
  );
}

test.describe('CUJ-5: QA gate additions (iteration 5)', { tag: '@cuj5' }, () => {
  // PRD CUJ-5 step 5 (refined 2026-10-27): the Retry writes into the job's own folder, "suffix
  // included if it had one … and the folder check is not run again" (§4.3).
  test('partial in a sibling folder: a repeat run with 3 failing pages ends Retry · 3 failed in "(1)"; the Retry fetches only those 3 into "(1)", with no new folder check → Saved · 12P naming "(1)"', async ({
    harness,
    server,
  }) => {
    const log = recordSwLog(harness);
    const sibling = `${FOLDER} (1)`;
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    expect((await settle(page, 'Saved · 12P')).title).toBe(`Saved to Downloads/${FOLDER}`);
    const first = artworkFiles(EXAMPLE, FOLDER, ALL_PAGES, true);

    failPages(harness, server, EXAMPLE, [4, 9, 11]);
    await page.waitForTimeout(CLICK_GUARD_MS);
    await clickButton(page);
    await settle(page, 'Retry · 3 failed');
    const failed = await restingView(page);
    expectRedOutline(failed);
    expect(failed.title).toBe(
      '9 of 12 pages saved. 3 failed after 4 attempts each. Click to retry just those 3.',
    );
    const landed = ALL_PAGES.filter((p) => ![4, 9, 11].includes(p));
    expect(await downloadedPaths(harness)).toEqual(
      [...first, ...artworkFiles(EXAMPLE, sibling, landed, true)].sort(),
    );

    // A re-run of the folder check here would pick "(2)": plain and "(1)" both hold this artwork.
    server.clearFaults();
    const retriedAt = Date.now();
    await clickButton(page);
    const done = await settle(page, 'Saved · 12P');
    expect(done.title).toBe(`Saved to Downloads/${sibling}`);
    expect(done.ariaLabel).toBe(`Saved 12 pages to Downloads/${sibling}. Click to download again.`);
    expect(await downloadsStartedAfter(harness, retriedAt)).toEqual(
      [4, 9, 11].map((p) => `みずき-135882741 (1)/${fileName(EXAMPLE, p)}`).sort(),
    );
    expect(await downloadedPaths(harness)).toEqual(
      [...first, ...artworkFiles(EXAMPLE, sibling, ALL_PAGES, true)].sort(),
    );
    // One folder decision only, for the repeat run; the Retry made none.
    const choices = log.filter((line) => line.text.includes('folder choice'));
    expect(choices).toHaveLength(1);
    expect(choices[0]?.text).toContain(`chosen: ${sibling}}`);
  });

  // PRD CUJ-5 edge "Pages and metadata.json both failed" (R-007 item 6): the usual pages tooltip,
  // and the Retry re-writes the failed pages and metadata.json, so Saved · 12P means every file.
  test('pages and metadata.json both failed: Retry · 3 failed with the usual tooltip; the Retry writes metadata.json and the 3 pages → Saved · 12P with all 13 files', async ({
    harness,
    server,
  }) => {
    await refuseMetadataHandOff(harness, true);
    failPages(harness, server, EXAMPLE, [4, 9, 11]);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    await settle(page, 'Retry · 3 failed');
    expect(await metadataRefusals(harness)).toBe(1);
    const failed = await restingView(page);
    expectRedOutline(failed);
    expect(failed.title).toBe(
      '9 of 12 pages saved. 3 failed after 4 attempts each. Click to retry just those 3.',
    );
    const landed = ALL_PAGES.filter((p) => ![4, 9, 11].includes(p));
    expect(await downloadedPaths(harness)).toEqual(artworkFiles(EXAMPLE, FOLDER, landed, false));

    await refuseMetadataHandOff(harness, false);
    server.clearFaults();
    const retriedAt = Date.now();
    await clickButton(page);
    const done = await settle(page, 'Saved · 12P');
    expect(done.title).toBe(`Saved to Downloads/${FOLDER}`);
    expect(await downloadsStartedAfter(harness, retriedAt)).toEqual(
      ['metadata.json', ...[4, 9, 11].map((p) => fileName(EXAMPLE, p))]
        .map((name) => `みずき-135882741/${name}`)
        .sort(),
    );
    expect(await downloadedPaths(harness)).toEqual(artworkFiles(EXAMPLE, FOLDER, ALL_PAGES, true));
    const metadata = JSON.parse(
      await readFile(path.join(harness.downloads.dir, FOLDER, 'metadata.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(metadata.id).toBe(EXAMPLE.id);
    expect(metadata.pageCount).toBe(12);
  });

  // PRD CUJ-5 edge "Only metadata.json failed (pages all landed)" (R-004 S9).
  test('only metadata.json failed: Retry with "All 12 pages saved. metadata.json couldn’t be saved. Click to retry it."; the Retry writes only metadata.json → Saved · 12P', async ({
    harness,
    server,
  }) => {
    await refuseMetadataHandOff(harness, true);
    const page = await openArtwork(harness, EXAMPLE.id);
    await waitForText(page, 'Download · 12P');
    await clickButton(page);
    await settle(page, /^Retry/);
    const failed = await restingView(page);
    expectRedOutline(failed);
    expect(failed.text).toBe('Retry');
    const tip = "All 12 pages saved. metadata.json couldn't be saved. Click to retry it.";
    expect(failed.title).toBe(tip);
    // Not "Download failed. …": the pages did land; the name is the full cause (PRD edge "Screen
    // reader"; design-artwork-button.md "Presentation", error.metadataOnly).
    expect(failed.ariaLabel).toBe(tip);
    expect(await downloadedPaths(harness)).toEqual(artworkFiles(EXAMPLE, FOLDER, ALL_PAGES, false));

    await refuseMetadataHandOff(harness, false);
    const retriedAt = Date.now();
    await clickButton(page);
    const done = await settle(page, 'Saved · 12P');
    expect(done.title).toBe(`Saved to Downloads/${FOLDER}`);
    expect(await downloadsStartedAfter(harness, retriedAt)).toEqual([
      'みずき-135882741/metadata.json',
    ]);
    expect(requestsAfter(server, pagesOf(EXAMPLE, ALL_PAGES), retriedAt)).toEqual([]);
    expect(await downloadedPaths(harness)).toEqual(artworkFiles(EXAMPLE, FOLDER, ALL_PAGES, true));
  });
});
