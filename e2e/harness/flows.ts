// Steps shared by the CUJ specs: opening an artwork tab, holding originals in flight, and reading
// the toolbar badge and title through the extension service worker.

import { expect, type Page } from '@playwright/test';
import { artworkUrl, originalUrl, type IllustWork } from '../fixtures/works';
import type { LoggedRequest } from '../server/server';
import { buttonView, exposeButton, hoverButton, type ButtonView } from './hfp-button';
import type { Harness } from './launch';

/** PRD §4.8: the badge updates within 1 s of any change. */
export const BADGE_WITHIN = { timeout: 1_000, intervals: [50] };
/** Leaves room for the pill's 120 ms background transition. */
export const TRANSITION_MS = 200;
/** Clicks on a busy button this soon after the starting click are ignored (PRD §4.7.5). */
export const CLICK_GUARD_MS = 500;
export const IDLE_TITLE = 'Helper for Pixiv — click to open settings';

/** `from`…`to`, inclusive. */
export function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** The original's file name, e.g. `135882741_p0.jpg`. */
export function fileName(work: IllustWork, page: number): string {
  return `${work.id}_p${page}.${work.pages[page] ?? 'jpg'}`;
}

/** Matches the original requests of `work` for `pages` (for server.hold() and server.requests()). */
export function pagesOf(
  work: IllustWork,
  pages: readonly number[],
): (request: LoggedRequest) => boolean {
  const urls = new Set(pages.map((page) => originalUrl(work, page)));
  return (request) => urls.has(request.url);
}

/** A new tab on the artwork page, with the button exposed to buttonView(). */
export async function openArtwork(harness: Harness, id: string): Promise<Page> {
  const page = await harness.newPage();
  await page.goto(artworkUrl(id));
  await exposeButton(page);
  return page;
}

export function badgeText(harness: Harness): Promise<string> {
  return harness.swEval(() => chrome.action.getBadgeText({}));
}

export function actionTitle(harness: Harness): Promise<string> {
  return harness.swEval(() => chrome.action.getTitle({}));
}

/** Badge text and action title reach these values within 1 s. */
export async function expectBadge(harness: Harness, text: string, title: string): Promise<void> {
  await expect.poll(() => badgeText(harness), BADGE_WITHIN).toBe(text);
  await expect.poll(() => actionTitle(harness), BADGE_WITHIN).toBe(title);
}

/** The view once the pointer is away from the pill and its transition has finished. */
export async function restingView(page: Page): Promise<ButtonView> {
  await hoverButton(page, false);
  await page.waitForTimeout(TRANSITION_MS);
  return buttonView(page);
}

/** Every path under the downloads directory. */
export async function downloadedPaths(harness: Harness): Promise<string[]> {
  return (await harness.downloads.files()).map((file) => file.path);
}

/** `folder/<page file>` for each page, plus `folder/metadata.json` when `metadata`, sorted. */
export function artworkFiles(
  work: IllustWork,
  folder: string,
  pages: readonly number[],
  metadata: boolean,
): string[] {
  const names = pages.map((page) => fileName(work, page));
  if (metadata) names.push('metadata.json');
  return names.map((name) => `${folder}/${name}`).sort();
}
