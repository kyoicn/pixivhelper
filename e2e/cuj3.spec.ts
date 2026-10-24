// CUJ-3 end to end: the settings page and the toolbar trigger in the real browser (task 4.2).
//
// AC → test, docs/prd/prd-000-mvp.md CUJ-3 "Acceptance Criteria" (test names in quotes):
// - Toolbar click opens a full tab titled `Helper for Pixiv — Settings`; clicking again focuses
//   that tab and opens no new one: "toolbar: …" (3 tests, incl. across windows).
// - No popup ever appears from the toolbar icon: "toolbar: opens a full settings tab …".
// - With no settings saved: `pixiv/{artist}-{id}`, MP4, metadata on: "defaults: …".
// - Each chip inserts its token at the caret; tooltips match step 2 exactly: "chips: …" (4 tests).
// - Default preview `Preview: Downloads/pixiv/みずき-135882741/135882741_p0.jpg`: "preview: …".
// - `pixiv/{artst}-{id}`: within ~400 ms a 2 px red border, the exact message and the exact
//   "Still using" line; a download started now uses the last valid pattern: "validation: …".
// - Each step-5 validation case shows its exact message: "validation: each step-5 case …".
// - Typing `pixiv/{user` and pausing shows `Unknown token {user. …` and saves nothing (no `Saved`;
//   a reload shows the last valid pattern); `pixiv/a}b` is valid and saved (R-004 S5):
//   "validation: typing pixiv/{user …", "validation: a } that closes no { …".
// - In the error state the `Still using:` label renders on one line in all four locales, and the
//   default pattern after it is not broken (R-004 S15): "locale: in … keeps "Still using:" …" (4).
// - A valid change saves without a Save button; `Saved` with a green check appears (~400 ms for
//   the pattern, at once otherwise) and fades after 2 s: "saved: …" (2 tests).
// - Reloading shows the most recently saved values: "persistence: …" (2 tests, incl. the edge
//   case "invalid pattern, then tab closed").
// - A change while a download runs leaves that download alone: covered by e2e/cuj1.spec.ts and
//   e2e/cuj2.spec.ts (tasks 4.1 and 4.3), not here.
// - `Reset to defaults` restores all three defaults immediately: "reset: …" (2 tests).
// - Footer: Reset, Report an issue, the version and the privacy line: "footer: …".
// - Dark OS → dark page; light → light: "theme: …" (2 tests), incl. the Saved, validation-message
//   and "Still using" text colours, which follow system.md §11.5 (WCAG AA) rather than the mocks.
// - Step 5 "No `Saved` appears": a Saved from a valid save made just before never shows beside
//   the error (QA iteration 1 regression): "saved: … invalid edit within 2 s …".
// - Chrome in Japanese, Simplified or Traditional Chinese → every string in that language:
//   "locale: …" (ja, zh_CN, zh_TW, plus en).
// - Every control reachable and operable by keyboard alone, in the PRD tab order: "keyboard: …".
// - (edge case) Two settings tabs: a saved change shows in the other within 1 s unless it holds
//   an unsaved invalid edit: "two tabs: …" (2 tests).
// - (edge case) Paste containing newlines: the field drops them and validation runs as usual:
//   "edge: newlines …" (QA gate block below) and "line breaks: …" (3 tests: QA's three-line paste
//   with its preview, a trailing newline, keyboard.insertText).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { ActionTestApi } from '../src/background/options-tab';
import { SETTINGS_KEY } from '../src/shared/constants';
import { artworkUrl } from './fixtures/works';
import { E2E_EXTENSION_DIR, type Harness } from './harness/launch';
import { expect, test } from './harness/test';

// ── PRD copy and values (CUJ-3) ──

const TAB_TITLE = 'Helper for Pixiv — Settings';
const DEFAULT_PATTERN = 'pixiv/{artist}-{id}';
const DEFAULT_PREVIEW = 'Preview: Downloads/pixiv/みずき-135882741/135882741_p0.jpg';
const ISSUES_URL = 'https://github.com/kyoicn/pixivhelper/issues';
const PRIVACY =
  'Only talks to pixiv.net and its image host. Nothing you download leaves your browser.';
const UNKNOWN_ARTST = 'Unknown token {artst}. Available tokens: {artist}, {id}, {title}, {userId}.';
const UNKNOWN_USER = 'Unknown token {user. Available tokens: {artist}, {id}, {title}, {userId}.';
const TOOLTIPS: ReadonlyArray<[token: string, tooltip: string]> = [
  ['{artist}', 'Artist display name, as shown on pixiv'],
  ['{id}', 'Artwork ID, the number in the page URL'],
  ['{title}', 'Artwork title, shortened to stay a safe folder name'],
  ['{userId}', "Artist's numeric pixiv account ID; stable if the artist renames"],
];

const stillUsing = (pattern: string): string =>
  `Still using: ${pattern} — your last valid pattern stays in effect until this one is fixed.`;

// ── Timing budgets ──

/** Pattern autosave debounce (PRD CUJ-3 step 3: "about 400 ms after the last keystroke"). */
const DEBOUNCE_MS = 400;
/** `Saved` stays 2 s, then fades over 300 ms (step 3). */
const SAVED_VISIBLE_MS = 2000;
const SAVED_FADE_MS = 300;
/** Scheduling allowance on top of a timer: timers never fire early, but may fire late. */
const LATE_MS = 250;
/** Timers measured from inside a listener may start a hair before the page's own. */
const EARLY_MS = 20;
/** Two settings tabs agree within this long (CUJ-3 edge case). */
const SYNC_MS = 1000;

// ── Fake pixiv pages that stand in for "the current tab" ──

const USER_PAGE_A = 'https://www.pixiv.net/users/40285173';
const USER_PAGE_B = 'https://www.pixiv.net/users/40285174';
const USER_PAGE_C = 'https://www.pixiv.net/users/40285175';

type Section = 'folder' | 'ugoira' | 'metadata';
type UgoiraValue = 'mp4' | 'webm' | 'zip';

interface StoredRecord {
  v: number;
  folderPattern: string;
  ugoiraOutput: UgoiraValue;
  saveMetadata: boolean;
  updatedAt: number;
}
interface Stored {
  sync: StoredRecord | null;
  local: StoredRecord | null;
}

interface SavedEvent {
  at: number;
  text: string;
  opacity: string;
  /** Computed `transition-property transition-duration`. */
  transition: string;
  icon: boolean;
}
interface Recorder {
  saved: Record<Section, SavedEvent[]>;
  lastInput: number;
  lastClick: number;
  errorShown: number;
}
/** A moment the folder Saved had content while the validation message was shown. */
interface Overlap {
  at: number;
  saved: string;
  opacity: string;
}

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** dist-e2e/manifest.json: what Chrome loaded. */
function builtManifest(): { version: string; action: Record<string, unknown> } {
  const file = path.join(E2E_EXTENSION_DIR, 'manifest.json');
  return JSON.parse(readFileSync(file, 'utf8')) as {
    version: string;
    action: Record<string, unknown>;
  };
}

function optionsUrl(harness: Harness): string {
  return `chrome-extension://${harness.extensionId}/options.html`;
}

/** Opens the settings page in a new tab and waits until options.ts has unhidden it. */
async function openOptions(harness: Harness): Promise<Page> {
  const page = await harness.newPage();
  await page.goto(optionsUrl(harness));
  await expect(page.locator('body')).toBeVisible();
  return page;
}

function controls(page: Page) {
  return {
    field: page.locator('#pattern'),
    chip: (token: string) => page.locator(`.chip[data-token="${token}"]`),
    segment: (value: UgoiraValue) => page.locator(`.seg [data-value="${value}"]`),
    metaSwitch: page.locator('#meta'),
    errorBox: page.locator('#pattern-error'),
    errorText: page.locator('#pattern-error .error-text'),
    preview: page.locator('#preview .preview-text'),
    saved: (section: Section) => page.locator(`#${section} .saved`),
    reset: page.locator('#reset'),
    report: page.locator('#report'),
    version: page.locator('#version'),
    privacy: page.locator('footer .privacy'),
  };
}

/** Exact textContent (Playwright's toHaveText normalizes whitespace). */
function textOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => el.textContent ?? '');
}

/**
 * The client rects of the element's box and of its text: one each means it renders on one line.
 * An inline-block has one box rect however its text wraps, hence the text's own rects.
 */
function lineCount(locator: Locator): Promise<{ box: number; text: number }> {
  return locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return { box: el.getClientRects().length, text: range.getClientRects().length };
  });
}

async function computed(locator: Locator, names: readonly string[]): Promise<string[]> {
  return locator.evaluate(
    (el, props) => props.map((name) => getComputedStyle(el).getPropertyValue(name)),
    [...names],
  );
}

async function stored(harness: Harness): Promise<Stored> {
  return harness.swEval(async (key) => {
    const [sync, local] = await Promise.all([
      chrome.storage.sync.get(key),
      chrome.storage.local.get(key),
    ]);
    return {
      sync: (sync[key] as StoredRecord | undefined) ?? null,
      local: (local[key] as StoredRecord | undefined) ?? null,
    };
  }, SETTINGS_KEY);
}

/** Stores settings as a previous session would have, before the page opens. */
async function seed(
  harness: Harness,
  settings: Pick<StoredRecord, 'folderPattern' | 'ugoiraOutput' | 'saveMetadata'>,
): Promise<StoredRecord> {
  const record: StoredRecord = { v: 1, ...settings, updatedAt: Date.now() };
  await harness.swEval(
    async ({ key, value }) => {
      await chrome.storage.sync.set({ [key]: value });
      await chrome.storage.local.set({ [key]: value });
    },
    { key: SETTINGS_KEY, value: record },
  );
  return record;
}

/** Records `Saved` indicator changes, the last field input, the last click and the first error. */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rec: Recorder = {
      saved: { folder: [], ugoira: [], metadata: [] },
      lastInput: 0,
      lastClick: 0,
      errorShown: 0,
    };
    (window as unknown as { __rec: Recorder }).__rec = rec;
    for (const section of ['folder', 'ugoira', 'metadata'] as const) {
      const el = document.querySelector<HTMLElement>(`#${section} .saved`);
      if (!el) throw new Error(`no Saved indicator in #${section}`);
      new MutationObserver(() => {
        const style = getComputedStyle(el);
        rec.saved[section].push({
          at: performance.now(),
          text: el.textContent ?? '',
          opacity: el.style.opacity,
          transition: `${style.transitionProperty} ${style.transitionDuration}`,
          icon: el.querySelector('svg') !== null,
        });
      }).observe(el, { childList: true, attributes: true, attributeFilter: ['style'] });
    }
    const errorBox = document.querySelector<HTMLElement>('#pattern-error');
    if (!errorBox) throw new Error('no #pattern-error');
    new MutationObserver(() => {
      if (!errorBox.hidden && rec.errorShown === 0) rec.errorShown = performance.now();
    }).observe(errorBox, { attributes: true, attributeFilter: ['hidden'] });
    document.querySelector('#pattern')?.addEventListener('input', () => {
      rec.lastInput = performance.now();
    });
    document.addEventListener('click', () => (rec.lastClick = performance.now()), true);
  });
}

function recorded(page: Page): Promise<Recorder> {
  return page.evaluate(() => (window as unknown as { __rec: Recorder }).__rec);
}

/**
 * Records each state in which the folder Saved has content while the validation message is shown.
 * Every change to either element is checked, so no such state can go unseen.
 */
async function watchSavedBesideError(page: Page): Promise<void> {
  await page.evaluate(() => {
    const saved = document.querySelector<HTMLElement>('#folder .saved');
    const errorBox = document.querySelector<HTMLElement>('#pattern-error');
    if (!saved || !errorBox) throw new Error('no folder Saved or #pattern-error');
    const overlaps: Overlap[] = [];
    (window as unknown as { __overlaps: Overlap[] }).__overlaps = overlaps;
    const observer = new MutationObserver(() => {
      if (!errorBox.hidden && saved.textContent !== '') {
        overlaps.push({
          at: performance.now(),
          saved: saved.textContent ?? '',
          opacity: saved.style.opacity,
        });
      }
    });
    observer.observe(saved, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    observer.observe(errorBox, { attributes: true, attributeFilter: ['hidden'] });
  });
}

function savedBesideError(page: Page): Promise<Overlap[]> {
  return page.evaluate(() => (window as unknown as { __overlaps: Overlap[] }).__overlaps);
}

/** Waits until `section`'s Saved has appeared, faded and cleared, and returns its events. */
async function savedCycle(page: Page, section: Section): Promise<SavedEvent[]> {
  const timeout = DEBOUNCE_MS + SAVED_VISIBLE_MS + SAVED_FADE_MS + 2_000;
  await expect
    .poll(async () => (await recorded(page)).saved[section].at(-1)?.text, { timeout })
    .toBe('');
  return (await recorded(page)).saved[section];
}

/** The ID of the one tab showing `url` (host permissions let the SW match pixiv URLs). */
async function tabIdOf(harness: Harness, url: string): Promise<number> {
  const tabs = await harness.swEval((match) => chrome.tabs.query({ url: match }), url);
  const id = tabs[0]?.id;
  if (tabs.length !== 1 || id === undefined) {
    throw new Error(`expected one tab at ${url}, found ${tabs.length}`);
  }
  return id;
}

function tabById(harness: Harness, tabId: number): Promise<chrome.tabs.Tab> {
  return harness.swEval((id) => chrome.tabs.get(id), tabId);
}

/** The toolbar click, through the e2e-only hook in src/background/options-tab.ts. */
async function clickToolbar(harness: Harness, tabId: number): Promise<void> {
  await harness.swEval(
    (id) => (self as unknown as { __hfpTest: ActionTestApi }).__hfpTest.clickAction(id),
    tabId,
  );
}

/** The settings page's tab contexts, as openOrFocusOptions finds them. */
function settingsTabs(harness: Harness): Promise<chrome.runtime.ExtensionContext[]> {
  return harness.swEval(
    (url) => chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] }),
    optionsUrl(harness),
  );
}

async function openPage(harness: Harness, url: string): Promise<Page> {
  const page = await harness.newPage();
  await page.goto(url);
  return page;
}

/** Serves the Report-an-issue target locally, so following the link needs no network. */
async function stubIssuesPage(harness: Harness): Promise<void> {
  await harness.context.route(`${ISSUES_URL}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Issues</title>' }),
  );
}

interface Deck {
  [key: string]: { message: string; placeholders?: Record<string, { content: string }> };
}

/** The locale's messages.json as loaded by the extension under test. */
function loadDeck(locale: string): Deck {
  const file = path.join(E2E_EXTENSION_DIR, '_locales', locale, 'messages.json');
  return JSON.parse(readFileSync(file, 'utf8')) as Deck;
}

/** `key` with its named placeholders filled from `subs` ($1, $2, … in placeholder content). */
function message(deck: Deck, key: string, ...subs: string[]): string {
  const entry = deck[key];
  if (!entry) throw new Error(`no message ${key}`);
  const placeholders = new Map(
    Object.entries(entry.placeholders ?? {}).map(([name, p]) => [name.toLowerCase(), p.content]),
  );
  return entry.message.replace(/\$([A-Za-z0-9_@]+)\$/g, (_, name: string) =>
    (placeholders.get(name.toLowerCase()) ?? '').replace(
      /\$([1-9])/g,
      (_m, n: string) => subs[Number(n) - 1] ?? '',
    ),
  );
}

test.describe('CUJ-3: configure the extension from the toolbar icon', { tag: '@cuj3' }, () => {
  test.describe('toolbar', () => {
    test('toolbar: opens a full settings tab right of the current tab and focuses it; no popup', async ({
      harness,
    }) => {
      const current = await openPage(harness, USER_PAGE_A);
      await openPage(harness, USER_PAGE_B);
      await current.bringToFront();
      const before = await tabById(harness, await tabIdOf(harness, USER_PAGE_A));
      const pagesBefore = harness.context.pages().length;

      const opened = harness.context.waitForEvent('page');
      await clickToolbar(harness, before.id ?? -1);
      const settings = await opened;

      await expect(settings).toHaveTitle(TAB_TITLE);
      expect(settings.url()).toBe(optionsUrl(harness));
      const [ctx, ...more] = await settingsTabs(harness);
      expect(more).toEqual([]);
      const tab = await tabById(harness, ctx?.tabId ?? -1);
      expect({
        title: tab.title,
        windowId: tab.windowId,
        index: tab.index,
        active: tab.active,
      }).toEqual({
        title: TAB_TITLE,
        windowId: before.windowId,
        index: before.index + 1,
        active: true,
      });
      // The tab that was right of the current one moved one place along.
      expect((await tabById(harness, await tabIdOf(harness, USER_PAGE_B))).index).toBe(
        before.index + 2,
      );
      // A full tab in a normal browser window, not a popup or the embedded options dialog.
      expect((await harness.swEval((id) => chrome.windows.get(id), tab.windowId)).type).toBe(
        'normal',
      );
      expect(await harness.swEval(() => chrome.action.getPopup({}))).toBe('');
      expect(builtManifest().action).not.toHaveProperty('default_popup');
      expect(harness.context.pages()).toHaveLength(pagesBefore + 1);
    });

    test('toolbar: a second click focuses the existing settings tab and opens no new one', async ({
      harness,
    }) => {
      const current = await openPage(harness, USER_PAGE_A);
      const currentId = await tabIdOf(harness, USER_PAGE_A);
      const opened = harness.context.waitForEvent('page');
      await clickToolbar(harness, currentId);
      await opened;
      const [ctx] = await settingsTabs(harness);
      const settingsId = ctx?.tabId ?? -1;
      await current.bringToFront();
      expect((await tabById(harness, settingsId)).active).toBe(false);
      const tabCount = (await harness.swEval(() => chrome.tabs.query({}))).length;
      let newPages = 0;
      harness.context.on('page', () => newPages++);

      await clickToolbar(harness, currentId);

      expect((await tabById(harness, settingsId)).active).toBe(true);
      expect((await settingsTabs(harness)).map((c) => c.tabId)).toEqual([settingsId]);
      expect((await harness.swEval(() => chrome.tabs.query({}))).length).toBe(tabCount);
      expect(newPages).toBe(0);
    });

    test('toolbar: a click in another window focuses the settings tab and its window', async ({
      harness,
    }) => {
      await openPage(harness, USER_PAGE_A);
      const opened = harness.context.waitForEvent('page');
      await clickToolbar(harness, await tabIdOf(harness, USER_PAGE_A));
      await opened;
      const [ctx] = await settingsTabs(harness);
      const settingsId = ctx?.tabId ?? -1;
      const settingsWindow = ctx?.windowId ?? -1;
      const other = await harness.swEval(
        (url) => chrome.windows.create({ url, focused: true }),
        USER_PAGE_C,
      );
      const otherTabId = other?.tabs?.[0]?.id ?? -1;
      // Headless Chromium reports every window as focused and ignores focus changes, so the focus
      // request itself is recorded too.
      await harness.swEval(() => {
        const calls: Array<[number, chrome.windows.UpdateInfo]> = [];
        (self as unknown as { __focusCalls: typeof calls }).__focusCalls = calls;
        const update = chrome.windows.update.bind(chrome.windows);
        chrome.windows.update = (windowId: number, info: chrome.windows.UpdateInfo) => {
          calls.push([windowId, info]);
          return update(windowId, info);
        };
      });
      const tabCount = (await harness.swEval(() => chrome.tabs.query({}))).length;

      await clickToolbar(harness, otherTabId);

      const tab = await tabById(harness, settingsId);
      expect({ active: tab.active, windowId: tab.windowId }).toEqual({
        active: true,
        windowId: settingsWindow,
      });
      expect((await harness.swEval(() => chrome.tabs.query({}))).length).toBe(tabCount);
      expect(
        await harness.swEval(
          () =>
            (self as unknown as { __focusCalls: Array<[number, chrome.windows.UpdateInfo]> })
              .__focusCalls,
        ),
      ).toEqual([[settingsWindow, { focused: true }]]);
      const windows = await harness.swEval(() => chrome.windows.getAll());
      if (windows.filter((w) => w.focused).length === 1) {
        expect(windows.find((w) => w.focused)?.id).toBe(settingsWindow);
      } else {
        const reason =
          'this Chromium does not track window focus (headless): the focus request was checked instead';
        console.log(`window focus not observable: ${reason}`);
        test.info().annotations.push({ type: 'note', description: reason });
      }
    });
  });

  test('defaults: with nothing saved the page shows pixiv/{artist}-{id}, MP4 and metadata on', async ({
    harness,
  }) => {
    expect(await stored(harness)).toEqual({ sync: null, local: null });
    const page = await openOptions(harness);
    const ui = controls(page);

    await expect(page).toHaveTitle(TAB_TITLE);
    await expect(page.getByRole('textbox', { name: 'Folder pattern' })).toHaveValue(
      DEFAULT_PATTERN,
    );
    const group = page.getByRole('group', { name: 'Ugoira output format' });
    await expect(group.getByRole('button', { name: 'MP4' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(group.getByRole('button', { name: 'WebM' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(group.getByRole('button', { name: 'ZIP only' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByRole('switch', { name: 'Save metadata.json' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(ui.field).toHaveAttribute('spellcheck', 'false');
    await expect(ui.errorBox).toBeHidden();
    expect(await textOf(ui.preview)).toBe(DEFAULT_PREVIEW);
    for (const section of ['folder', 'ugoira', 'metadata'] as const) {
      expect(await textOf(ui.saved(section))).toBe('');
    }
  });

  test.describe('chips', () => {
    test('chips: each chip inserts its token at the caret, keeps focus and puts the caret after it', async ({
      harness,
    }) => {
      const page = await openOptions(harness);
      const ui = controls(page);
      for (const [token] of TOOLTIPS) {
        await ui.field.fill('pixiv/x');
        await ui.field.focus();
        await page.keyboard.press('Home');
        for (let i = 0; i < 'pixiv/'.length; i++) await page.keyboard.press('ArrowRight');

        await ui.chip(token).click();

        const caret = 'pixiv/'.length + token.length;
        expect(
          await ui.field.evaluate((el: HTMLInputElement) => ({
            value: el.value,
            selection: [el.selectionStart, el.selectionEnd],
            focused: document.activeElement === el,
          })),
        ).toEqual({ value: `pixiv/${token}x`, selection: [caret, caret], focused: true });
      }
    });

    test('chips: a chip replaces the selected text', async ({ harness }) => {
      const page = await openOptions(harness);
      const ui = controls(page);
      await ui.field.focus();
      await page.keyboard.press('Home');
      for (let i = 0; i < 'pixiv/'.length; i++) await page.keyboard.press('ArrowRight');
      for (let i = 0; i < '{artist}'.length; i++) await page.keyboard.press('Shift+ArrowRight');

      await ui.chip('{userId}').click();

      await expect(ui.field).toHaveValue('pixiv/{userId}-{id}');
      await expect(ui.field).toBeFocused();
    });

    test('chips: with the field never focused a chip appends; the preview updates and Saved appears', async ({
      harness,
    }) => {
      const page = await openOptions(harness);
      const ui = controls(page);

      await ui.chip('{title}').click();

      await expect(ui.field).toHaveValue(`${DEFAULT_PATTERN}{title}`);
      await expect(ui.field).toBeFocused();
      await expect(ui.saved('folder')).toHaveText('Saved');
      expect(await textOf(ui.preview)).toBe(
        'Preview: Downloads/pixiv/みずき-135882741雨上がりの渋谷/135882741_p0.jpg',
      );
      expect((await stored(harness)).sync?.folderPattern).toBe(`${DEFAULT_PATTERN}{title}`);
    });

    test('chips: the four tooltips match the PRD copy', async ({ harness }) => {
      const page = await openOptions(harness);
      const ui = controls(page);
      for (const [token, tooltip] of TOOLTIPS) {
        await expect(ui.chip(token)).toHaveText(token);
        await expect(ui.chip(token)).toHaveAttribute('title', tooltip);
      }
    });
  });

  test('preview: reads the PRD path for the default pattern and follows a valid edit', async ({
    harness,
  }) => {
    const page = await openOptions(harness);
    const ui = controls(page);
    expect(await textOf(ui.preview)).toBe(DEFAULT_PREVIEW);
    const [family] = await computed(ui.preview.locator('.mono'), ['font-family']);
    expect(family).toContain('monospace');

    await ui.field.fill('pixiv/{artist}/{title}');

    await expect
      .poll(() => textOf(ui.preview))
      .toBe('Preview: Downloads/pixiv/みずき/雨上がりの渋谷/135882741_p0.jpg');
  });

  test.describe('validation', () => {
    test('validation: pixiv/{artst}-{id} shows the red border, the message and the Still using line ~400 ms after the last keystroke; nothing is stored', async ({
      harness,
    }) => {
      const page = await openOptions(harness);
      const ui = controls(page);
      await record(page);
      await ui.field.focus();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Delete');
      await ui.field.pressSequentially('pixiv/{artst}-{id}');

      await expect(ui.errorBox).toBeVisible();
      const rec = await recorded(page);
      expect(rec.errorShown - rec.lastInput).toBeGreaterThanOrEqual(DEBOUNCE_MS - EARLY_MS);
      expect(rec.errorShown - rec.lastInput).toBeLessThanOrEqual(DEBOUNCE_MS + LATE_MS);

      expect(await textOf(ui.errorText)).toBe(UNKNOWN_ARTST);
      await expect(ui.errorBox).toHaveAttribute('role', 'alert');
      await expect(ui.field).toHaveAttribute('aria-invalid', 'true');
      await expect(ui.field).toHaveAttribute('aria-describedby', 'pattern-error');
      expect(
        await computed(ui.field, [
          'border-top-width',
          'border-right-width',
          'border-bottom-width',
          'border-left-width',
          'border-top-color',
          'border-left-color',
        ]),
      ).toEqual(['2px', '2px', '2px', '2px', rgb('#d93025'), rgb('#d93025')]);
      // Exact text, with the token in place: Chrome cuts a substitution at U+0000, so a NUL
      // split marker in splitOnPlaceholder would move the pattern to the end of this line.
      expect(await textOf(ui.preview)).toBe(stillUsing(DEFAULT_PATTERN));
      expect(await textOf(ui.preview.locator('.mono'))).toBe(DEFAULT_PATTERN);
      expect(await textOf(ui.saved('folder'))).toBe('');
      expect(await stored(harness)).toEqual({ sync: null, local: null });
    });

    test('validation: a download started while the field holds an invalid edit uses the last valid pattern', async ({
      harness,
    }) => {
      await seed(harness, {
        folderPattern: 'pixiv/{artist}/{id}',
        ugoiraOutput: 'mp4',
        saveMetadata: true,
      });
      const settings = await openOptions(harness);
      const ui = controls(settings);
      await ui.field.fill('pixiv/{artst}-{id}');
      await expect(ui.errorBox).toBeVisible();
      expect(await textOf(ui.preview)).toBe(stillUsing('pixiv/{artist}/{id}'));

      const artwork = await openPage(harness, artworkUrl('135882742'));
      await artwork.locator('hfp-download').click();

      await harness.downloads.waitForFile('pixiv/みずき/135882742/135882742_p0.jpg');
      await harness.downloads.waitForFile('pixiv/みずき/135882742/metadata.json');
      expect((await harness.downloads.files()).map((f) => f.path)).toEqual([
        'pixiv/みずき/135882742/135882742_p0.jpg',
        'pixiv/みずき/135882742/metadata.json',
      ]);
    });

    test('validation: each step-5 case shows its exact message and keeps the last valid pattern', async ({
      harness,
    }) => {
      const saved = await seed(harness, {
        folderPattern: 'pixiv/{userId}',
        ugoiraOutput: 'mp4',
        saveMetadata: true,
      });
      const page = await openOptions(harness);
      const ui = controls(page);
      const cases: ReadonlyArray<[pattern: string, message: string]> = [
        ['', 'Enter a folder pattern.'],
        ['   ', 'Enter a folder pattern.'],
        ['/pixiv/{id}', 'Must be a relative path inside Downloads.'],
        ['C:/pixiv', 'Must be a relative path inside Downloads.'],
        ['~/pixiv', 'Must be a relative path inside Downloads.'],
        ['pixiv\\{id}', 'Use "/" between folders.'],
        ['pixiv/../{id}', `Can't contain "..".`],
        ['pixiv/{artst}-{id}', UNKNOWN_ARTST],
        ['pixiv/a:b', `Can't contain : * ? " < > |.`],
      ];
      for (const [pattern, expected] of cases) {
        await ui.field.fill(pattern);
        await expect
          .poll(() => textOf(ui.errorText), { message: pattern, intervals: [50] })
          .toBe(expected);
        await expect(ui.errorBox).toBeVisible();
        await expect(ui.field).toHaveAttribute('aria-invalid', 'true');
        expect(await computed(ui.field, ['border-top-width', 'border-top-color'])).toEqual([
          '2px',
          rgb('#d93025'),
        ]);
        expect(await textOf(ui.preview)).toBe(stillUsing('pixiv/{userId}'));
        expect(await textOf(ui.saved('folder'))).toBe('');
        // Switch away from the message before the next case, so each one is seen afresh.
        await ui.field.fill('pixiv/{userId}');
        await expect(ui.errorBox).toBeHidden();
      }
      expect(await stored(harness)).toEqual({ sync: saved, local: saved });
    });

    test('validation: typing pixiv/{user and pausing names the unclosed {user; no Saved, nothing stored, and a reload shows the last valid pattern', async ({
      harness,
    }) => {
      const saved = await seed(harness, {
        folderPattern: 'pixiv/{userId}',
        ugoiraOutput: 'mp4',
        saveMetadata: true,
      });
      const page = await openOptions(harness);
      const ui = controls(page);
      await record(page);
      await ui.field.focus();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Delete');
      await ui.field.pressSequentially('pixiv/{user');

      await expect(ui.errorBox).toBeVisible();
      expect(await textOf(ui.errorText)).toBe(UNKNOWN_USER);
      expect(await textOf(ui.errorText.locator('.strong'))).toBe('{user');
      expect(await textOf(ui.preview)).toBe(stillUsing('pixiv/{userId}'));
      // A pause well past the debounce still saves nothing.
      await page.waitForTimeout(DEBOUNCE_MS + LATE_MS);
      expect((await recorded(page)).saved.folder.filter((event) => event.text !== '')).toEqual([]);
      expect(await stored(harness)).toEqual({ sync: saved, local: saved });

      await page.reload();
      await expect(page.locator('body')).toBeVisible();
      await expect(ui.field).toHaveValue('pixiv/{userId}');
      await expect(ui.errorBox).toBeHidden();
      expect(await textOf(ui.preview)).toBe('Preview: Downloads/pixiv/40285173/135882741_p0.jpg');
    });

    test('validation: a } that closes no { is literal: pixiv/a}b is valid and saved', async ({
      harness,
    }) => {
      const page = await openOptions(harness);
      const ui = controls(page);
      await ui.field.fill('pixiv/a}b');
      await expect(ui.saved('folder')).toHaveText('Saved');
      await expect(ui.errorBox).toBeHidden();
      expect(await textOf(ui.preview)).toBe('Preview: Downloads/pixiv/a}b/135882741_p0.jpg');
      expect((await stored(harness)).sync?.folderPattern).toBe('pixiv/a}b');
    });
  });

  test.describe('line breaks', () => {
    const paste = async (page: Page, text: string): Promise<void> => {
      await page.evaluate((clip) => navigator.clipboard.writeText(clip), text);
      await page.keyboard.press('ControlOrMeta+V');
    };

    test('line breaks: QA repro: pasting pixiv/⏎{artist}⏎-{id} saves pixiv/{artist}-{id} with the PRD preview', async ({
      harness,
    }) => {
      await seed(harness, {
        folderPattern: 'pixiv/{userId}',
        ugoiraOutput: 'mp4',
        saveMetadata: true,
      });
      const page = await openOptions(harness);
      const ui = controls(page);
      await ui.field.fill('');
      await ui.field.focus();
      await paste(page, 'pixiv/\n{artist}\n-{id}');
      await expect(ui.field).toHaveValue(DEFAULT_PATTERN);
      await expect(ui.saved('folder')).toHaveText('Saved');
      expect(await textOf(ui.preview)).toBe(DEFAULT_PREVIEW);
      expect((await stored(harness)).sync?.folderPattern).toBe(DEFAULT_PATTERN);
    });

    test('line breaks: a one-line pattern copied with a trailing newline pastes with no trailing space; the caret follows it', async ({
      harness,
    }) => {
      const page = await openOptions(harness);
      const ui = controls(page);
      await ui.field.fill('');
      await ui.field.focus();
      await paste(page, 'pixiv/{artist}\r\n');
      await expect(ui.field).toHaveValue('pixiv/{artist}');
      await page.keyboard.type('/{id}');
      await expect(ui.field).toHaveValue('pixiv/{artist}/{id}');
      await expect
        .poll(async () => (await stored(harness)).sync?.folderPattern)
        .toBe('pixiv/{artist}/{id}');
    });

    test('line breaks: text inserted with a newline (keyboard.insertText) lands on one line without it', async ({
      harness,
    }) => {
      const page = await openOptions(harness);
      const ui = controls(page);
      await ui.field.fill('pixiv/');
      await ui.field.press('End');
      await page.keyboard.insertText('{artist}\n-{id}');
      await expect(ui.field).toHaveValue(DEFAULT_PATTERN);
      await expect(ui.errorBox).toBeHidden();
    });
  });

  test.describe('saved', () => {
    test('saved: a valid pattern saves ~400 ms after the last keystroke; Saved shows 2 s, then fades over 300 ms', async ({
      harness,
    }) => {
      const page = await openOptions(harness);
      const ui = controls(page);
      await record(page);
      await ui.field.focus();
      await page.keyboard.press('End');
      await page.keyboard.type('/{title}');

      const events = await savedCycle(page, 'folder');
      const { lastInput } = await recorded(page);
      const [shown, fading, cleared, ...rest] = events;
      expect(rest).toEqual([]);
      expect(shown).toMatchObject({ text: 'Saved', opacity: '1', icon: true });
      expect(fading).toMatchObject({ text: 'Saved', opacity: '0', transition: 'opacity 0.3s' });
      expect(cleared).toMatchObject({ text: '', opacity: '0' });
      const appear = (shown?.at ?? 0) - lastInput;
      expect(appear).toBeGreaterThanOrEqual(DEBOUNCE_MS - EARLY_MS);
      expect(appear).toBeLessThanOrEqual(DEBOUNCE_MS + LATE_MS);
      const visible = (fading?.at ?? 0) - (shown?.at ?? 0);
      expect(visible).toBeGreaterThanOrEqual(SAVED_VISIBLE_MS - EARLY_MS);
      expect(visible).toBeLessThanOrEqual(SAVED_VISIBLE_MS + LATE_MS);
      const fade = (cleared?.at ?? 0) - (fading?.at ?? 0);
      expect(fade).toBeGreaterThanOrEqual(SAVED_FADE_MS - EARLY_MS);
      expect(fade).toBeLessThanOrEqual(SAVED_FADE_MS + LATE_MS);
      expect((await stored(harness)).sync?.folderPattern).toBe(`${DEFAULT_PATTERN}/{title}`);
      expect(await textOf(ui.saved('ugoira'))).toBe('');
      expect(await textOf(ui.saved('metadata'))).toBe('');
    });

    test('saved: Ugoira output and the metadata switch save at once, each with a green Saved', async ({
      harness,
    }) => {
      const page = await openOptions(harness);
      // The Saved green differs by scheme (the "theme: …" tests check both).
      await page.emulateMedia({ colorScheme: 'light' });
      const ui = controls(page);
      await record(page);

      await ui.segment('webm').click();
      await expect(ui.saved('ugoira')).toHaveText('Saved');
      let rec = await recorded(page);
      expect((rec.saved.ugoira[0]?.at ?? Infinity) - rec.lastClick).toBeLessThanOrEqual(LATE_MS);
      expect(await computed(ui.saved('ugoira'), ['color', 'font-size'])).toEqual([
        rgb('#188038'),
        '12.5px',
      ]);
      await expect(ui.segment('webm')).toHaveAttribute('aria-pressed', 'true');
      expect((await stored(harness)).sync?.ugoiraOutput).toBe('webm');

      await ui.metaSwitch.click();
      await expect(ui.saved('metadata')).toHaveText('Saved');
      rec = await recorded(page);
      expect((rec.saved.metadata[0]?.at ?? Infinity) - rec.lastClick).toBeLessThanOrEqual(LATE_MS);
      await expect(ui.metaSwitch).toHaveAttribute('aria-checked', 'false');
      expect(await stored(harness)).toMatchObject({
        sync: { ugoiraOutput: 'webm', saveMetadata: false },
        local: { ugoiraOutput: 'webm', saveMetadata: false },
      });
      expect(await textOf(ui.saved('folder'))).toBe('');

      const ugoira = await savedCycle(page, 'ugoira');
      expect(ugoira.map((e) => e.opacity)).toEqual(['1', '0', '0']);
    });

    test('saved: a valid save, then an invalid edit within 2 s: no Saved beside Download folder while the error shows', async ({
      harness,
    }) => {
      // QA iteration 1, CUJ-3: the chip's Saved stayed up to 2 s beside the error (step 5: "No
      // `Saved` appears").
      const page = await openOptions(harness);
      const ui = controls(page);
      await record(page);
      await watchSavedBesideError(page);

      await ui.chip('{id}').click();
      await expect(ui.saved('folder')).toHaveText('Saved');
      await ui.field.fill('pixiv/{artst}-{id}');
      await expect(ui.errorBox).toBeVisible();

      expect(await textOf(ui.saved('folder'))).toBe('');
      // The error came while the chip's Saved would still have been on screen.
      const rec = await recorded(page);
      const shown = rec.saved.folder.find((e) => e.text === 'Saved');
      expect(shown).toBeDefined();
      expect(rec.errorShown - (shown?.at ?? 0)).toBeLessThan(SAVED_VISIBLE_MS);
      // Past the time the old Saved would have faded out and cleared.
      await page.waitForTimeout(SAVED_VISIBLE_MS + SAVED_FADE_MS + LATE_MS);
      await expect(ui.errorBox).toBeVisible();
      expect(await textOf(ui.errorText)).toBe(UNKNOWN_ARTST);
      expect(await textOf(ui.saved('folder'))).toBe('');
      expect(await savedBesideError(page)).toEqual([]);
      // The chip's valid pattern stays stored; the invalid edit never is.
      expect((await stored(harness)).sync?.folderPattern).toBe(`${DEFAULT_PATTERN}{id}`);
    });
  });

  test.describe('persistence', () => {
    test('persistence: reloading shows the most recently saved values', async ({ harness }) => {
      const page = await openOptions(harness);
      const ui = controls(page);
      await ui.field.fill('pixiv/{artist}/{title}');
      await expect(ui.saved('folder')).toHaveText('Saved');
      await ui.segment('zip').click();
      await ui.segment('webm').click();
      await ui.metaSwitch.click();
      await expect(ui.saved('metadata')).toHaveText('Saved');

      await page.reload();
      await expect(page.locator('body')).toBeVisible();

      await expect(ui.field).toHaveValue('pixiv/{artist}/{title}');
      await expect(ui.segment('webm')).toHaveAttribute('aria-pressed', 'true');
      await expect(ui.segment('mp4')).toHaveAttribute('aria-pressed', 'false');
      await expect(ui.segment('zip')).toHaveAttribute('aria-pressed', 'false');
      await expect(ui.metaSwitch).toHaveAttribute('aria-checked', 'false');
      expect(await textOf(ui.preview)).toBe(
        'Preview: Downloads/pixiv/みずき/雨上がりの渋谷/135882741_p0.jpg',
      );
      const { sync, local } = await stored(harness);
      expect(sync).toMatchObject({
        folderPattern: 'pixiv/{artist}/{title}',
        ugoiraOutput: 'webm',
        saveMetadata: false,
      });
      expect(local).toEqual(sync);
    });

    test('persistence: an invalid edit is never stored; reopening shows the last valid pattern with no error', async ({
      harness,
    }) => {
      const page = await openOptions(harness);
      const ui = controls(page);
      await ui.field.fill('pixiv/{userId}');
      await expect(ui.saved('folder')).toHaveText('Saved');
      const valid = await stored(harness);
      await ui.field.fill('pixiv/{artst}');
      await expect(ui.errorBox).toBeVisible();
      expect(await stored(harness)).toEqual(valid);

      await page.close();
      const reopened = await openOptions(harness);
      const again = controls(reopened);

      await expect(again.field).toHaveValue('pixiv/{userId}');
      await expect(again.errorBox).toBeHidden();
      expect(await again.field.getAttribute('aria-invalid')).toBeNull();
      expect(await textOf(again.preview)).toBe(
        'Preview: Downloads/pixiv/40285173/135882741_p0.jpg',
      );
    });
  });

  test.describe('reset', () => {
    test('reset: restores all three defaults at once, clears a validation error and saves them', async ({
      harness,
    }) => {
      await seed(harness, {
        folderPattern: 'pixiv/{title}',
        ugoiraOutput: 'webm',
        saveMetadata: false,
      });
      const page = await openOptions(harness);
      const ui = controls(page);
      await ui.field.fill('pixiv/{artst}');
      await expect(ui.errorBox).toBeVisible();

      await ui.reset.click();

      // Read synchronously after the click: "immediately", no waiting.
      expect(
        await page.evaluate(() => ({
          field: document.querySelector<HTMLInputElement>('#pattern')?.value,
          pressed: [...document.querySelectorAll('.seg button')].map((b) =>
            b.getAttribute('aria-pressed'),
          ),
          metadata: document.querySelector('#meta')?.getAttribute('aria-checked'),
          error: document.querySelector<HTMLElement>('#pattern-error')?.hidden,
          invalid: document.querySelector('#pattern')?.getAttribute('aria-invalid'),
          preview: document.querySelector('#preview .preview-text')?.textContent,
        })),
      ).toEqual({
        field: DEFAULT_PATTERN,
        pressed: ['true', 'false', 'false'],
        metadata: 'true',
        error: true,
        invalid: null,
        preview: DEFAULT_PREVIEW,
      });
      const defaults = { folderPattern: DEFAULT_PATTERN, ugoiraOutput: 'mp4', saveMetadata: true };
      await expect
        .poll(() => stored(harness), { timeout: SYNC_MS })
        .toMatchObject({ sync: defaults, local: defaults });
      for (const section of ['folder', 'ugoira', 'metadata'] as const) {
        await expect(ui.saved(section)).toHaveText('Saved');
      }
    });

    test('reset: shows Saved only beside the sections whose value changed', async ({ harness }) => {
      await seed(harness, {
        folderPattern: DEFAULT_PATTERN,
        ugoiraOutput: 'zip',
        saveMetadata: true,
      });
      const page = await openOptions(harness);
      const ui = controls(page);

      await ui.reset.click();

      await expect(ui.saved('ugoira')).toHaveText('Saved');
      await expect(ui.segment('mp4')).toHaveAttribute('aria-pressed', 'true');
      expect(await textOf(ui.saved('folder'))).toBe('');
      expect(await textOf(ui.saved('metadata'))).toBe('');
    });
  });

  test('footer: Reset to defaults, Report an issue → GitHub Issues, the version and the privacy line', async ({
    harness,
  }) => {
    await stubIssuesPage(harness);
    const page = await openOptions(harness);
    const ui = controls(page);

    await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeVisible();
    const report = page.getByRole('link', { name: 'Report an issue' });
    await expect(report).toHaveAttribute('href', ISSUES_URL);
    await expect(report).toHaveAttribute('target', '_blank');
    expect(await textOf(ui.version)).toBe(`v${builtManifest().version}`);
    expect(await textOf(ui.privacy)).toBe(PRIVACY);
    for (const link of [ui.reset, ui.report]) {
      expect(await computed(link, ['color'])).toEqual([rgb('#0096fa')]);
    }
    expect(await computed(page.locator('footer'), ['border-top-width', 'font-size'])).toEqual([
      '1px',
      '13px',
    ]);
    // The version sits at the right end of the footer row.
    const footerBox = await page.locator('footer').boundingBox();
    const versionBox = await ui.version.boundingBox();
    expect(
      Math.abs(
        (footerBox?.x ?? 0) +
          (footerBox?.width ?? 0) -
          ((versionBox?.x ?? 0) + (versionBox?.width ?? 0)),
      ),
    ).toBeLessThanOrEqual(1);

    const popup = page.waitForEvent('popup');
    await report.click();
    const issues = await popup;
    await issues.waitForLoadState();
    expect(issues.url()).toBe(ISSUES_URL);
  });

  test.describe('theme', () => {
    const THEMES = {
      light: {
        page: '#f6f7f9',
        text: '#1f1f1f',
        help: '#5c6166',
        surface: '#ffffff',
        border: '#d0d5db',
        chipHover: '#f0f8ff',
        segHover: '#f5f7f9',
        switchOff: '#bdc1c6',
        rule: '#e3e6ea',
        saved: '#188038',
        errorText: '#c5221f',
        stillUsing: '#5c6166',
      },
      dark: {
        page: '#121212',
        text: '#e8eaed',
        help: '#9aa0a6',
        surface: '#1f1f1f',
        border: '#3a3f45',
        chipHover: '#102a3f',
        segHover: '#2a2f35',
        switchOff: '#5f6368',
        rule: '#2a2f35',
        saved: '#1a9f5a',
        errorText: '#f28b82',
        stillUsing: '#8a8f94',
      },
    } as const;

    for (const scheme of ['light', 'dark'] as const) {
      test(`theme: with the OS in ${scheme} mode the page renders ${scheme}`, async ({
        harness,
      }) => {
        const colors = THEMES[scheme];
        const page = await harness.newPage();
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(optionsUrl(harness));
        await expect(page.locator('body')).toBeVisible();
        const ui = controls(page);

        expect(await computed(page.locator('body'), ['background-color', 'color'])).toEqual([
          rgb(colors.page),
          rgb(colors.text),
        ]);
        expect(await computed(page.locator('#folder-help'), ['color'])).toEqual([rgb(colors.help)]);
        for (const surface of [ui.field, ui.chip('{id}'), page.locator('.seg')]) {
          expect(
            await computed(surface, ['background-color', 'border-top-color', 'border-top-width']),
          ).toEqual([rgb(colors.surface), rgb(colors.border), '1px']);
        }
        expect(await computed(ui.segment('mp4'), ['background-color', 'color'])).toEqual([
          rgb('#0096fa'),
          rgb('#ffffff'),
        ]);
        expect(await computed(ui.metaSwitch, ['background-color'])).toEqual([rgb('#0096fa')]);
        expect(await computed(ui.report, ['color'])).toEqual([rgb('#0096fa')]);
        expect(await computed(page.locator('footer'), ['border-top-color'])).toEqual([
          rgb(colors.rule),
        ]);

        await ui.chip('{id}').hover();
        expect(
          await computed(ui.chip('{id}'), ['background-color', 'border-top-color', 'color']),
        ).toEqual([rgb(colors.chipHover), rgb('#0096fa'), rgb('#0096fa')]);
        await ui.segment('webm').hover();
        expect(await computed(ui.segment('webm'), ['background-color'])).toEqual([
          rgb(colors.segHover),
        ]);

        await ui.metaSwitch.click();
        await expect(ui.metaSwitch).toHaveAttribute('aria-checked', 'false');
        expect(await computed(ui.metaSwitch, ['background-color'])).toEqual([
          rgb(colors.switchOff),
        ]);
        await expect(ui.saved('metadata')).toHaveText('Saved');
        expect(await computed(ui.saved('metadata'), ['color'])).toEqual([rgb(colors.saved)]);

        await ui.field.fill('pixiv/{artst}-{id}');
        await expect(ui.errorBox).toBeVisible();
        // The message and its icon (currentColor) take the text colour; the border keeps the
        // PRD red in both schemes (a non-text component, 3:1).
        for (const part of [ui.errorText, ui.errorBox.locator('svg')]) {
          expect(await computed(part, ['color'])).toEqual([rgb(colors.errorText)]);
        }
        expect(await computed(ui.field, ['border-top-width', 'border-top-color'])).toEqual([
          '2px',
          rgb('#d93025'),
        ]);
        expect(await textOf(ui.preview)).toBe(stillUsing(DEFAULT_PATTERN));
        expect(await computed(ui.preview.locator('.muted'), ['color'])).toEqual([
          rgb(colors.stillUsing),
        ]);
      });
    }
  });

  test.describe('locale', () => {
    const LOCALES = [
      { locale: 'en', ui: /^en/ },
      { locale: 'ja', ui: /^ja/ },
      { locale: 'zh_CN', ui: /^zh-CN/ },
      { locale: 'zh_TW', ui: /^zh-TW/ },
    ] as const;

    for (const { locale, ui: uiLanguage } of LOCALES) {
      test.describe(`in ${locale}`, () => {
        test.use({ uiLocale: locale });

        const skipUnlessLocale = async (harness: Harness): Promise<void> => {
          const language = await harness.swEval(() => chrome.i18n.getUILanguage());
          if (!uiLanguage.test(language)) {
            const reason = `the platform ignored the ${locale} UI language (Chrome reports ${language}); locale checks run on Linux`;
            console.log(`skipped: ${reason}`);
            test.skip(true, reason);
          }
        };

        test(`locale: with Chrome in ${locale} every string on the page is in ${locale}`, async ({
          harness,
        }) => {
          await skipUnlessLocale(harness);
          const deck = loadDeck(locale);
          const page = await openOptions(harness);
          const ui = controls(page);

          await expect(page).toHaveTitle(message(deck, 'opt_tab_title'));
          expect(await page.evaluate(() => document.documentElement.lang)).toBe(
            message(deck, 'locale_tag'),
          );
          const strings = await page.evaluate(() =>
            [
              ...document.querySelectorAll<HTMLElement>(
                '[data-i18n], [data-i18n-title], [data-i18n-aria-label]',
              ),
            ].flatMap((el) => [
              ...(el.dataset.i18n ? [['text', el.dataset.i18n, el.textContent ?? '']] : []),
              ...(el.dataset.i18nTitle ? [['title', el.dataset.i18nTitle, el.title]] : []),
              ...(el.dataset.i18nAriaLabel
                ? [['aria-label', el.dataset.i18nAriaLabel, el.getAttribute('aria-label') ?? '']]
                : []),
            ]),
          );
          expect(strings.length).toBeGreaterThan(20);
          expect(strings).toEqual(
            strings.map(([kind = '', key = '']) => [kind, key, message(deck, key)]),
          );
          expect(await textOf(ui.preview)).toBe(
            `${message(deck, 'opt_preview')} Downloads/pixiv/みずき-135882741/135882741_p0.jpg`,
          );
          expect(await textOf(ui.version)).toBe(
            message(deck, 'opt_version', builtManifest().version),
          );

          await ui.segment('webm').click();
          await expect(ui.saved('ugoira')).toHaveText(message(deck, 'opt_saved'));

          await ui.field.fill('pixiv/{artst}-{id}');
          await expect
            .poll(() => textOf(ui.errorText))
            .toBe(message(deck, 'err_unknown_token', '{artst}'));
          expect(await textOf(ui.preview)).toBe(message(deck, 'opt_still_using', DEFAULT_PATTERN));
          await ui.field.fill('pixiv/a\\b');
          await expect.poll(() => textOf(ui.errorText)).toBe(message(deck, 'err_backslash'));
        });

        test(`locale: in ${locale} the error state keeps "Still using:" and the default pattern after it each on one line`, async ({
          harness,
        }) => {
          await skipUnlessLocale(harness);
          const line = message(loadDeck(locale), 'opt_still_using', DEFAULT_PATTERN);
          const page = await openOptions(harness);
          const ui = controls(page);
          await ui.field.fill('pixiv/{artst}-{id}');
          await expect(ui.errorBox).toBeVisible();
          expect(await textOf(ui.preview)).toBe(line);
          const label = ui.preview.locator('.label');
          const pattern = ui.preview.locator('.pattern');
          expect(await textOf(label)).toBe(line.slice(0, line.indexOf(DEFAULT_PATTERN)).trimEnd());
          expect(await textOf(pattern)).toBe(DEFAULT_PATTERN);
          expect(await lineCount(label)).toEqual({ box: 1, text: 1 });
          expect(await lineCount(pattern)).toEqual({ box: 1, text: 1 });
        });
      });
    }
  });

  test.describe('keyboard', () => {
    test('keyboard: Tab walks field → 4 chips → MP4 → WebM → ZIP only → switch → Reset → Report, each with a 2 px #0096FA ring', async ({
      harness,
    }) => {
      const page = await openOptions(harness);
      await page.bringToFront();
      const stops: Array<{ control: string; outline: string[] }> = [];
      for (let i = 0; i < 11; i++) {
        await page.keyboard.press('Tab');
        stops.push(
          await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            const style = el ? getComputedStyle(el) : null;
            return {
              control: el?.id || el?.dataset.token || el?.dataset.value || el?.tagName || '',
              outline: style ? [style.outlineStyle, style.outlineWidth, style.outlineColor] : [],
            };
          }),
        );
      }
      expect(stops.map((s) => s.control)).toEqual([
        'pattern',
        '{artist}',
        '{id}',
        '{title}',
        '{userId}',
        'mp4',
        'webm',
        'zip',
        'meta',
        'reset',
        'report',
      ]);
      for (const stop of stops) {
        expect(stop.outline, stop.control).toEqual(['solid', '2px', rgb('#0096fa')]);
      }
    });

    test('keyboard: every control operates by keyboard alone', async ({ harness }) => {
      await stubIssuesPage(harness);
      const page = await openOptions(harness);
      const ui = controls(page);
      await page.bringToFront();
      const tab = async (times = 1) => {
        for (let i = 0; i < times; i++) await page.keyboard.press('Tab');
      };

      await tab();
      await expect(ui.field).toBeFocused();
      await page.keyboard.press('End');
      await page.keyboard.type('/x');
      await expect(ui.saved('folder')).toHaveText('Saved');
      await expect(ui.field).toHaveValue(`${DEFAULT_PATTERN}/x`);

      await tab(2);
      await expect(ui.chip('{id}')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(ui.field).toHaveValue(`${DEFAULT_PATTERN}/x{id}`);
      await expect(ui.field).toBeFocused();

      await tab(3);
      await expect(ui.chip('{title}')).toBeFocused();
      await page.keyboard.press('Space');
      await expect(ui.field).toHaveValue(`${DEFAULT_PATTERN}/x{id}{title}`);
      await expect(ui.field).toBeFocused();
      await expect
        .poll(async () => (await stored(harness)).sync?.folderPattern)
        .toBe(`${DEFAULT_PATTERN}/x{id}{title}`);

      await tab(6);
      await expect(ui.segment('webm')).toBeFocused();
      await page.keyboard.press('Space');
      await expect(ui.segment('webm')).toHaveAttribute('aria-pressed', 'true');
      await tab();
      await expect(ui.segment('zip')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(ui.segment('zip')).toHaveAttribute('aria-pressed', 'true');

      await tab();
      await expect(ui.metaSwitch).toBeFocused();
      await page.keyboard.press('Space');
      await expect(ui.metaSwitch).toHaveAttribute('aria-checked', 'false');
      await expect
        .poll(async () => (await stored(harness)).sync)
        .toMatchObject({ ugoiraOutput: 'zip', saveMetadata: false });

      await tab();
      await expect(ui.reset).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(ui.field).toHaveValue(DEFAULT_PATTERN);
      await expect(ui.segment('mp4')).toHaveAttribute('aria-pressed', 'true');
      await expect(ui.metaSwitch).toHaveAttribute('aria-checked', 'true');

      await tab();
      await expect(ui.report).toBeFocused();
      const popup = page.waitForEvent('popup');
      await page.keyboard.press('Enter');
      expect((await popup).url()).toBe(ISSUES_URL);
    });
  });

  test.describe('two tabs', () => {
    test('two tabs: a change saved in one settings tab shows in the other within 1 s, without Saved', async ({
      harness,
    }) => {
      const a = await openOptions(harness);
      const b = await openOptions(harness);
      const ua = controls(a);
      const ub = controls(b);

      let started = Date.now();
      await ua.segment('webm').click();
      await expect(ub.segment('webm')).toHaveAttribute('aria-pressed', 'true', {
        timeout: SYNC_MS,
      });
      expect(Date.now() - started).toBeLessThanOrEqual(SYNC_MS);

      started = Date.now();
      await ua.metaSwitch.click();
      await expect(ub.metaSwitch).toHaveAttribute('aria-checked', 'false', { timeout: SYNC_MS });
      expect(Date.now() - started).toBeLessThanOrEqual(SYNC_MS);

      await ua.field.fill('pixiv/{artist}/{title}');
      await expect(ua.saved('folder')).toHaveText('Saved');
      started = Date.now();
      await expect(ub.field).toHaveValue('pixiv/{artist}/{title}', { timeout: SYNC_MS });
      expect(Date.now() - started).toBeLessThanOrEqual(SYNC_MS);
      expect(await textOf(ub.preview)).toBe(
        'Preview: Downloads/pixiv/みずき/雨上がりの渋谷/135882741_p0.jpg',
      );

      for (const section of ['folder', 'ugoira', 'metadata'] as const) {
        expect(await textOf(ub.saved(section))).toBe('');
      }
    });

    test('two tabs: an unsaved invalid edit is left alone when the other tab saves', async ({
      harness,
    }) => {
      const a = await openOptions(harness);
      const b = await openOptions(harness);
      const ua = controls(a);
      const ub = controls(b);
      await ub.field.fill('pixiv/{artst}-{id}');
      await expect(ub.errorBox).toBeVisible();

      await ua.field.fill('pixiv/{userId}');
      await expect(ua.saved('folder')).toHaveText('Saved');
      await expect
        .poll(() => textOf(ub.preview), { timeout: SYNC_MS })
        .toBe(stillUsing('pixiv/{userId}'));
      await expect(ub.field).toHaveValue('pixiv/{artst}-{id}');
      await expect(ub.field).toHaveAttribute('aria-invalid', 'true');
      expect(await textOf(ub.errorText)).toBe(UNKNOWN_ARTST);

      const started = Date.now();
      await ua.segment('zip').click();
      await expect(ub.segment('zip')).toHaveAttribute('aria-pressed', 'true', {
        timeout: SYNC_MS,
      });
      expect(Date.now() - started).toBeLessThanOrEqual(SYNC_MS);
      await expect(ub.field).toHaveValue('pixiv/{artst}-{id}');
      expect(await stored(harness)).toMatchObject({
        sync: { folderPattern: 'pixiv/{userId}', ugoiraOutput: 'zip' },
        local: { folderPattern: 'pixiv/{userId}', ugoiraOutput: 'zip' },
      });
    });
  });
});

// Added by the QA gate (iteration 2): CUJ-3 edge cases with no e2e check yet.
// | PRD                                                                            | Test               |
// | ------------------------------------------------------------------------------ | ------------------ |
// | Edge "Extremely long resulting path": the field accepts at most 200 characters | 'edge: 200 chars'  |
// |   and truncates further typing or pasting; chips never push it past 200        |                    |
// | Edge "Paste containing newlines": the single-line field drops the newlines     | 'edge: newlines'   |
test.describe('CUJ-3: QA gate additions (iteration 2)', { tag: '@cuj3' }, () => {
  test('edge: 200 chars: typing or pasting past 200 characters is truncated; a chip that would not fit inserts nothing', async ({
    harness,
  }) => {
    const page = await openOptions(harness);
    const ui = controls(page);
    const long = `pixiv/${'a'.repeat(190)}`;
    await ui.field.fill(long);
    await ui.field.press('End');
    await page.keyboard.type('bcd');
    await page.evaluate(() => navigator.clipboard.writeText('efghijklmnop'));
    await page.keyboard.press('ControlOrMeta+V');
    await page.keyboard.type('xyz');
    await expect(ui.field).toHaveValue(`${long}bcde`);
    const value = await ui.field.inputValue();
    expect(value).toHaveLength(200);
    await ui.chip('{userId}').click();
    await expect(ui.field).toHaveValue(value);
    await expect(ui.saved('folder')).toHaveText('Saved');
    await expect.poll(async () => (await stored(harness)).sync?.folderPattern).toBe(value);
  });

  test('edge: newlines: a pasted pattern with line breaks lands on one line without them and validates as usual', async ({
    harness,
  }) => {
    const page = await openOptions(harness);
    const ui = controls(page);
    const paste = async (text: string): Promise<void> => {
      await page.evaluate((clip) => navigator.clipboard.writeText(clip), text);
      await page.keyboard.press('ControlOrMeta+V');
    };
    await ui.field.fill('');
    await ui.field.focus();
    await paste('pixiv/\n{artist}\r\n-{id}\n');
    await expect(ui.field).toHaveValue('pixiv/{artist}-{id}');
    await paste('/{artst}\n');
    await expect(ui.field).toHaveValue('pixiv/{artist}-{id}/{artst}');
    await expect(ui.errorBox).toBeVisible();
    expect(await textOf(ui.errorText)).toBe(UNKNOWN_ARTST);
  });
});
