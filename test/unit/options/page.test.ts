// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initOptionsPage } from '../../../src/options/page';
import {
  REPORT_ISSUE_URL,
  SAVED_FADE_MS,
  SAVED_VISIBLE_MS,
  SETTINGS_DEBOUNCE_MS,
  SETTINGS_KEY,
} from '../../../src/shared/constants';
import { DEFAULT_SETTINGS, type StoredSettings, writeSettings } from '../../../src/shared/settings';
import type { Settings } from '../../../src/shared/types';
import { createGetMessage, type Locale } from '../../helpers/i18n-stub';

const OPTIONS_HTML = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/options/options.html',
);
const MANIFEST_VERSION = '9.8.7';

type Section = 'folder' | 'ugoira' | 'metadata';
type AreaName = 'sync' | 'local';
type Changes = Record<string, chrome.storage.StorageChange>;
type ChangeListener = (changes: Changes, area: AreaName) => void;

// Minimal chrome for the page: storage.sync and storage.local, with onChanged dispatched on a timer
// like Chrome's events; runtime.getManifest; i18n over the real locale files. test/fakes/chrome.ts
// cannot be used here: its manifest read goes through `new URL(…, import.meta.url)`, which Vite
// rewrites to a server URL under happy-dom.
function createArea(name: AreaName, listeners: Set<ChangeListener>) {
  const data = new Map<string, unknown>();
  const area = {
    data,
    refuseWrites: false,
    get: vi.fn((key: string): Promise<Record<string, unknown>> =>
      Promise.resolve(data.has(key) ? { [key]: structuredClone(data.get(key)) } : {}),
    ),
    set: vi.fn((items: Record<string, unknown>): Promise<void> => {
      if (area.refuseWrites) return Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
      const changes: Changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: data.get(key), newValue: structuredClone(value) };
        data.set(key, structuredClone(value));
      }
      setTimeout(() => {
        for (const listener of listeners) listener(changes, name);
      }, 0);
      return Promise.resolve();
    }),
  };
  return area;
}

function installChrome(locale: Locale = 'en') {
  const listeners = new Set<ChangeListener>();
  const storage = {
    sync: createArea('sync', listeners),
    local: createArea('local', listeners),
    onChanged: {
      addListener: (listener: ChangeListener) => listeners.add(listener),
      removeListener: (listener: ChangeListener) => listeners.delete(listener),
    },
  };
  vi.stubGlobal('chrome', {
    storage,
    runtime: { getManifest: () => ({ version: MANIFEST_VERSION }) },
    i18n: { getMessage: createGetMessage(locale) },
  });
  return storage;
}

let storage: ReturnType<typeof installChrome>;

/** Replaces the document's body with options.html's (its <head> is left out: happy-dom would load its files). */
function mountMarkup(): void {
  const html = readFileSync(OPTIONS_HTML, 'utf8').replace(/<head>[\s\S]*<\/head>/, '');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.documentElement.removeAttribute('lang');
  document.title = '';
  document.body.replaceWith(document.importNode(parsed.body, true));
}

function seed(settings: Partial<Settings>): void {
  const record: StoredSettings = { ...DEFAULT_SETTINGS, ...settings, v: 1, updatedAt: 1 };
  storage.sync.data.set(SETTINGS_KEY, structuredClone(record));
  storage.local.data.set(SETTINGS_KEY, structuredClone(record));
}

function stored(): StoredSettings | undefined {
  return storage.sync.data.get(SETTINGS_KEY) as StoredSettings | undefined;
}

function $<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`no ${selector}`);
  return el;
}

const field = (): HTMLInputElement => $<HTMLInputElement>('#pattern');
const errorBox = (): HTMLElement => $('#pattern-error');
const lineText = (selector: string): string =>
  ($(selector).textContent ?? '').replace(/\s+/g, ' ').trim();
const pressed = (): string[] =>
  [...document.querySelectorAll<HTMLButtonElement>('.seg button[aria-pressed="true"]')].map(
    (b) => b.dataset.value ?? '',
  );
const savedSections = (): Section[] =>
  (['folder', 'ugoira', 'metadata'] as const).filter(
    (section) => $(`#${section} .saved`).textContent === 'Saved',
  );

/** Holds `area`'s next write until the returned function is called; then it stores as usual. */
function holdNextWrite(area: ReturnType<typeof createArea>): () => void {
  const write = area.set.getMockImplementation();
  let release = (): void => {};
  area.set.mockImplementationOnce(
    (items: Record<string, unknown>) =>
      new Promise<void>((resolve) => {
        release = () => resolve(write?.(items));
      }),
  );
  return () => release();
}

/** The user edits the field: focus, new value, input event. */
function type(value: string): void {
  field().focus();
  field().value = value;
  field().dispatchEvent(new Event('input', { bubbles: true }));
}

/** The user selects the whole field and pastes `text`, as Chrome announces it before inserting. */
function pasteOverAll(text: string): void {
  field().focus();
  field().setSelectionRange(0, field().value.length);
  field().dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
      data: text,
    }),
  );
}

/** Advances fake time by `ms`, then lets storage events and pending promises run. */
async function advance(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.advanceTimersByTimeAsync(0);
}

/** Another settings tab saves: the same shared writeSettings, a later timestamp. */
async function otherTabSaves(change: Partial<Settings>): Promise<void> {
  vi.setSystemTime(Date.now() + 1);
  const current = stored() ?? { ...DEFAULT_SETTINGS };
  await writeSettings({
    folderPattern: current.folderPattern,
    ugoiraOutput: current.ugoiraOutput,
    saveMetadata: current.saveMetadata,
    ...change,
  });
  vi.setSystemTime(Date.now() + 1);
  await advance();
}

beforeEach(() => {
  vi.useFakeTimers();
  storage = installChrome();
  mountMarkup();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('options page: load', () => {
  it('load: titles the tab "Helper for Pixiv — Settings"', async () => {
    await initOptionsPage();
    expect(document.title).toBe('Helper for Pixiv — Settings');
  });

  it('load: sets <html lang> to the resolved locale', async () => {
    storage = installChrome('zh_TW');
    await initOptionsPage();
    expect(document.documentElement.lang).toBe('zh-TW');
  });

  it('load: the markup starts hidden', () => {
    expect(document.body.hidden).toBe(true);
  });

  it('load: stays hidden while the settings are read', async () => {
    let release = (): void => {};
    storage.sync.get.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({});
      }),
    );
    const loading = initOptionsPage();
    await advance();
    const hiddenWhileReading = document.body.hidden;
    release();
    await loading;
    expect(hiddenWhileReading).toBe(true);
  });

  it('load: shows the page with every string applied', async () => {
    await initOptionsPage();
    const empty = [...document.querySelectorAll('[data-i18n]')].filter((el) => !el.textContent);
    expect([document.body.hidden, empty.length]).toEqual([false, 0]);
  });

  it('load: with nothing saved, shows the default pattern, MP4 and metadata on', async () => {
    await initOptionsPage();
    expect([field().value, pressed(), $('#meta').getAttribute('aria-checked')]).toEqual([
      'pixiv/{artist}-{id}',
      ['mp4'],
      'true',
    ]);
  });

  it('load: the default preview reads the PRD path', async () => {
    await initOptionsPage();
    expect(lineText('#preview')).toBe('Preview: Downloads/pixiv/みずき-135882741/135882741_p0.jpg');
  });

  it('load: shows the saved settings', async () => {
    seed({ folderPattern: 'pixiv/{userId}', ugoiraOutput: 'zip', saveMetadata: false });
    await initOptionsPage();
    expect([field().value, pressed(), $('#meta').getAttribute('aria-checked')]).toEqual([
      'pixiv/{userId}',
      ['zip'],
      'false',
    ]);
  });

  it('load: shows no error and no Saved', async () => {
    await initOptionsPage();
    expect([errorBox().hidden, savedSections()]).toEqual([true, []]);
  });

  it('load: Report an issue opens GitHub Issues in a new tab', async () => {
    await initOptionsPage();
    const report = $<HTMLAnchorElement>('#report');
    expect([report.textContent, report.getAttribute('href'), report.target, report.rel]).toEqual([
      'Report an issue',
      REPORT_ISSUE_URL,
      '_blank',
      'noopener noreferrer',
    ]);
  });

  it('load: shows v + the manifest version', async () => {
    await initOptionsPage();
    expect($('#version').textContent).toBe(`v${MANIFEST_VERSION}`);
  });

  it('load: shows the privacy line', async () => {
    await initOptionsPage();
    expect($('footer p').textContent).toBe(
      'Only talks to pixiv.net and its image host. Nothing you download leaves your browser.',
    );
  });

  it('load: the controls appear in the PRD tab order', async () => {
    await initOptionsPage();
    const controls = [...document.querySelectorAll('input, button, a[href]')].map(
      (el) => el.getAttribute('aria-label') ?? el.textContent?.trim(),
    );
    expect(controls).toEqual([
      'Folder pattern',
      '{artist}',
      '{id}',
      '{title}',
      '{userId}',
      'MP4',
      'WebM',
      'ZIP only',
      'Save metadata.json',
      'Reset to defaults',
      'Report an issue',
    ]);
  });

  it('load: the chips carry the PRD tooltips', async () => {
    await initOptionsPage();
    const titles = [...document.querySelectorAll<HTMLElement>('.chip')].map((chip) => chip.title);
    expect(titles).toEqual([
      'Artist display name, as shown on pixiv',
      'Artwork ID, the number in the page URL',
      'Artwork title, shortened to stay a safe folder name',
      "Artist's numeric pixiv account ID; stable if the artist renames",
    ]);
  });
});

describe('options page: accessibility', () => {
  beforeEach(async () => {
    await initOptionsPage();
  });

  it('a11y: the field is labelled Folder pattern, without spellcheck, max 200 characters', () => {
    expect([
      field().getAttribute('aria-label'),
      field().getAttribute('spellcheck'),
      field().maxLength,
    ]).toEqual(['Folder pattern', 'false', 200]);
  });

  it('a11y: a valid field is described by its help text', () => {
    expect([
      field().getAttribute('aria-describedby'),
      field().hasAttribute('aria-invalid'),
    ]).toEqual(['folder-help', false]);
  });

  it('a11y: the segmented control is a group labelled Ugoira output format', () => {
    const group = $('.seg');
    expect([group.getAttribute('role'), group.getAttribute('aria-label')]).toEqual([
      'group',
      'Ugoira output format',
    ]);
  });

  it('a11y: every segment exposes aria-pressed', () => {
    const states = [...document.querySelectorAll('.seg button')].map((b) =>
      b.getAttribute('aria-pressed'),
    );
    expect(states).toEqual(['true', 'false', 'false']);
  });

  it('a11y: the metadata switch is role=switch labelled Save metadata.json', () => {
    const toggle = $('#meta');
    expect([toggle.getAttribute('role'), toggle.getAttribute('aria-label')]).toEqual([
      'switch',
      'Save metadata.json',
    ]);
  });

  it('a11y: every Saved indicator is a polite live region', () => {
    const live = [...document.querySelectorAll('.saved')].map((el) => el.getAttribute('aria-live'));
    expect(live).toEqual(['polite', 'polite', 'polite']);
  });

  it('a11y: the validation message is role=alert', () => {
    expect(errorBox().getAttribute('role')).toBe('alert');
  });

  it('a11y: Reset to defaults is a button', () => {
    expect($('#reset').tagName).toBe('BUTTON');
  });
});

describe('options page: folder pattern', () => {
  beforeEach(async () => {
    await initOptionsPage();
  });

  it('pattern: does not validate before 400 ms have passed', async () => {
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS - 1);
    expect(errorBox().hidden).toBe(true);
  });

  it('pattern: validates 400 ms after the last keystroke', async () => {
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect(errorBox().hidden).toBe(false);
  });

  it('pattern: each keystroke restarts the 400 ms', async () => {
    type('pixiv/{art');
    await advance(SETTINGS_DEBOUNCE_MS - 100);
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS - 100);
    expect(errorBox().hidden).toBe(true);
  });

  it.each([
    ['   ', 'Enter a folder pattern.'],
    ['/pixiv/{id}', 'Must be a relative path inside Downloads.'],
    ['pixiv\\{id}', 'Use "/" between folders.'],
    ['pixiv/../{id}', `Can't contain "..".`],
    [
      'pixiv/{artst}-{id}',
      'Unknown token {artst}. Available tokens: {artist}, {id}, {title}, {userId}.',
    ],
    ['pixiv/{id}?', `Can't contain : * ? " < > |.`],
  ])('pattern: %j shows "%s"', async (value, message) => {
    type(value);
    await advance(SETTINGS_DEBOUNCE_MS);
    expect(lineText('#pattern-error')).toBe(message);
  });

  it('pattern: invalid marks the field aria-invalid, described by the alert', async () => {
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect([
      field().getAttribute('aria-invalid'),
      field().getAttribute('aria-describedby'),
    ]).toEqual(['true', 'pattern-error']);
  });

  it('pattern: invalid replaces the preview with the Still using line', async () => {
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect(lineText('#preview')).toBe(
      'Still using: pixiv/{artist}-{id} — your last valid pattern stays in effect until this one is fixed.',
    );
  });

  it('pattern: invalid stores nothing', async () => {
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect(storage.sync.set).not.toHaveBeenCalled();
  });

  it('pattern: invalid shows no Saved', async () => {
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect(savedSections()).toEqual([]);
  });

  it('pattern: the unknown token is set in mono semibold', async () => {
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect($('#pattern-error .strong').textContent).toBe('{artst}');
  });

  it('pattern: valid updates the preview', async () => {
    type('pixiv/{artist}/{title}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect(lineText('#preview')).toBe(
      'Preview: Downloads/pixiv/みずき/雨上がりの渋谷/135882741_p0.jpg',
    );
  });

  it('pattern: valid is saved', async () => {
    type('pixiv/{artist}/{title}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect(stored()?.folderPattern).toBe('pixiv/{artist}/{title}');
  });

  it('pattern: valid shows Saved beside the Download folder heading only', async () => {
    type('pixiv/{artist}/{title}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect(savedSections()).toEqual(['folder']);
  });

  it('pattern: Saved is gone 2.3 s after the save', async () => {
    type('pixiv/{artist}/{title}');
    await advance(SETTINGS_DEBOUNCE_MS);
    await advance(SAVED_VISIBLE_MS + SAVED_FADE_MS);
    expect(savedSections()).toEqual([]);
  });

  it('pattern: fixing the pattern clears the error state', async () => {
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    type('pixiv/{artist}-{id}/x');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect([
      errorBox().hidden,
      field().hasAttribute('aria-invalid'),
      field().getAttribute('aria-describedby'),
      lineText('#preview'),
    ]).toEqual([
      true,
      false,
      'folder-help',
      'Preview: Downloads/pixiv/みずき-135882741/x/135882741_p0.jpg',
    ]);
  });

  it('pattern: a valid value equal to the stored one is not written again', async () => {
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    type('pixiv/{artist}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect([storage.sync.set.mock.calls.length, savedSections()]).toEqual([0, []]);
  });

  it('pattern: when both storage areas refuse the write, keeps the value and shows no Saved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.sync.refuseWrites = true;
    storage.local.refuseWrites = true;
    type('pixiv/{title}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect([field().value, savedSections()]).toEqual(['pixiv/{title}', []]);
  });

  it('pattern: a chip insertion is validated and saved after 400 ms', async () => {
    $('[data-token="{title}"]').click();
    await advance(SETTINGS_DEBOUNCE_MS);
    expect(stored()?.folderPattern).toBe('pixiv/{artist}-{id}{title}');
  });

  // R-004 S5: a pause mid-token never autosaves the fragment.
  it('pattern: an unclosed { (pixiv/{user) names the fragment, stores nothing and shows no Saved', async () => {
    type('pixiv/{user');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect([
      lineText('#pattern-error'),
      storage.sync.set.mock.calls.length,
      savedSections(),
    ]).toEqual([
      'Unknown token {user. Available tokens: {artist}, {id}, {title}, {userId}.',
      0,
      [],
    ]);
  });

  it('pattern: a lone } is literal, so pixiv/a}b is saved', async () => {
    type('pixiv/a}b');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect([stored()?.folderPattern, savedSections()]).toEqual(['pixiv/a}b', ['folder']]);
  });

  it('pattern: a paste with line breaks is not saved before 400 ms have passed', async () => {
    pasteOverAll('pixiv/\n{artist}/\r\n{title}\n');
    await advance(SETTINGS_DEBOUNCE_MS - 1);
    expect([field().value, storage.sync.set.mock.calls.length]).toEqual([
      'pixiv/{artist}/{title}',
      0,
    ]);
  });

  it('pattern: a paste with line breaks is validated and saved without them after 400 ms', async () => {
    pasteOverAll('pixiv/\n{artist}/\r\n{title}\n');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect([stored()?.folderPattern, savedSections(), lineText('#preview')]).toEqual([
      'pixiv/{artist}/{title}',
      ['folder'],
      'Preview: Downloads/pixiv/みずき/雨上がりの渋谷/135882741_p0.jpg',
    ]);
  });
});

// QA iteration 1, CUJ-3: a Saved from the previous valid save stayed beside the error.
describe('options page: no Saved beside a validation error', () => {
  const folderSaved = (): HTMLElement => $('#folder .saved');

  beforeEach(async () => {
    await initOptionsPage();
  });

  it('error: a valid save, then an invalid edit within 2 s, empties the folder Saved as the error renders', async () => {
    $('[data-token="{id}"]').click();
    await advance(SETTINGS_DEBOUNCE_MS);
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect([errorBox().hidden, folderSaved().textContent, folderSaved().style.opacity]).toEqual([
      false,
      '',
      '0',
    ]);
  });

  it('error: the folder Saved is already empty when the error box appears', async () => {
    $('[data-token="{id}"]').click();
    await advance(SETTINGS_DEBOUNCE_MS);
    let savedWhenShown: string | null = null;
    new MutationObserver(() => {
      savedWhenShown ??= folderSaved().textContent;
    }).observe(errorBox(), { attributes: true, attributeFilter: ['hidden'] });
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect(savedWhenShown).toBe('');
  });

  it('error: a write that resolves after the field turned invalid does not flash Saved', async () => {
    const release = holdNextWrite(storage.sync);
    type('pixiv/{title}');
    await advance(SETTINGS_DEBOUNCE_MS);
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    release();
    await advance();
    expect([errorBox().hidden, savedSections()]).toEqual([false, []]);
  });

  it('error: a write that resolves after the field turned invalid is still stored', async () => {
    const release = holdNextWrite(storage.sync);
    type('pixiv/{title}');
    await advance(SETTINGS_DEBOUNCE_MS);
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    release();
    await advance();
    expect([stored()?.folderPattern, lineText('#preview')]).toEqual([
      'pixiv/{title}',
      'Still using: pixiv/{title} — your last valid pattern stays in effect until this one is fixed.',
    ]);
  });

  it('error: a write that resolves once the field is valid again still flashes Saved', async () => {
    const release = holdNextWrite(storage.sync);
    type('pixiv/{title}');
    await advance(SETTINGS_DEBOUNCE_MS);
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    type('pixiv/{title}');
    await advance(SETTINGS_DEBOUNCE_MS);
    release();
    await advance();
    expect(savedSections()).toEqual(['folder']);
  });

  it('error: leaves the Ugoira output and metadata Saved alone', async () => {
    $('[data-value="webm"]').click();
    $('#meta').click();
    await advance();
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    expect([errorBox().hidden, savedSections()]).toEqual([false, ['ugoira', 'metadata']]);
  });
});

describe('options page: ugoira output and metadata switch', () => {
  beforeEach(async () => {
    await initOptionsPage();
  });

  it('ugoira: clicking WebM presses WebM only', () => {
    $('[data-value="webm"]').click();
    expect(pressed()).toEqual(['webm']);
  });

  it('ugoira: clicking WebM saves at once', async () => {
    $('[data-value="webm"]').click();
    await advance();
    expect(stored()?.ugoiraOutput).toBe('webm');
  });

  it('ugoira: clicking WebM shows Saved beside Ugoira output only', async () => {
    $('[data-value="webm"]').click();
    await advance();
    expect(savedSections()).toEqual(['ugoira']);
  });

  it('ugoira: clicking the selected segment writes nothing', async () => {
    $('[data-value="mp4"]').click();
    await advance();
    expect(storage.sync.set).not.toHaveBeenCalled();
  });

  it('metadata: the switch turns metadata off', () => {
    $('#meta').click();
    expect($('#meta').getAttribute('aria-checked')).toBe('false');
  });

  it('metadata: the switch saves at once', async () => {
    $('#meta').click();
    await advance();
    expect(stored()?.saveMetadata).toBe(false);
  });

  it('metadata: the switch shows Saved beside Save metadata.json only', async () => {
    $('#meta').click();
    await advance();
    expect(savedSections()).toEqual(['metadata']);
  });

  it('settings: two changes in quick succession are both kept', async () => {
    $('[data-value="webm"]').click();
    $('#meta').click();
    await advance();
    expect([stored()?.ugoiraOutput, stored()?.saveMetadata]).toEqual(['webm', false]);
  });

  it('settings: an invalid draft is never stored by another control', async () => {
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    $('[data-value="zip"]').click();
    await advance();
    expect(stored()?.folderPattern).toBe('pixiv/{artist}-{id}');
  });
});

describe('options page: reset to defaults', () => {
  it('reset: restores the three defaults in the controls', async () => {
    seed({ folderPattern: 'pixiv/{userId}', ugoiraOutput: 'zip', saveMetadata: false });
    await initOptionsPage();
    $('#reset').click();
    expect([field().value, pressed(), $('#meta').getAttribute('aria-checked')]).toEqual([
      'pixiv/{artist}-{id}',
      ['mp4'],
      'true',
    ]);
  });

  it('reset: saves the defaults in one write', async () => {
    seed({ folderPattern: 'pixiv/{userId}', ugoiraOutput: 'zip', saveMetadata: false });
    await initOptionsPage();
    $('#reset').click();
    await advance();
    expect([storage.sync.set.mock.calls.length, stored()?.folderPattern]).toEqual([
      1,
      DEFAULT_SETTINGS.folderPattern,
    ]);
  });

  it('reset: shows Saved only beside the section that changed', async () => {
    seed({ ugoiraOutput: 'zip' });
    await initOptionsPage();
    $('#reset').click();
    await advance();
    expect(savedSections()).toEqual(['ugoira']);
  });

  it('reset: shows Saved beside every section when all three changed', async () => {
    seed({ folderPattern: 'pixiv/{userId}', ugoiraOutput: 'zip', saveMetadata: false });
    await initOptionsPage();
    $('#reset').click();
    await advance();
    expect(savedSections()).toEqual(['folder', 'ugoira', 'metadata']);
  });

  it('reset: with every setting at its default, shows no Saved', async () => {
    await initOptionsPage();
    $('#reset').click();
    await advance();
    expect(savedSections()).toEqual([]);
  });

  it('reset: clears a validation error', async () => {
    await initOptionsPage();
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    $('#reset').click();
    expect([errorBox().hidden, field().hasAttribute('aria-invalid'), lineText('#preview')]).toEqual(
      [true, false, 'Preview: Downloads/pixiv/みずき-135882741/135882741_p0.jpg'],
    );
  });

  it('reset: cancels a pending pattern save', async () => {
    seed({ ugoiraOutput: 'zip' });
    await initOptionsPage();
    type('pixiv/{title}');
    $('#reset').click();
    await advance(SETTINGS_DEBOUNCE_MS);
    expect([storage.sync.set.mock.calls.length, stored()?.folderPattern]).toEqual([
      1,
      DEFAULT_SETTINGS.folderPattern,
    ]);
  });
});

describe('options page: two settings tabs', () => {
  beforeEach(async () => {
    await initOptionsPage();
  });

  it('tabs: a change saved in another tab updates every control', async () => {
    await otherTabSaves({
      folderPattern: 'art/{userId}',
      ugoiraOutput: 'zip',
      saveMetadata: false,
    });
    expect([field().value, pressed(), $('#meta').getAttribute('aria-checked')]).toEqual([
      'art/{userId}',
      ['zip'],
      'false',
    ]);
  });

  it('tabs: a change saved in another tab updates the preview', async () => {
    await otherTabSaves({ folderPattern: 'art/{userId}' });
    expect(lineText('#preview')).toBe('Preview: Downloads/art/40285173/135882741_p0.jpg');
  });

  it('tabs: a change saved in another tab shows no Saved', async () => {
    await otherTabSaves({ ugoiraOutput: 'zip' });
    expect(savedSections()).toEqual([]);
  });

  it('tabs: a focused field with no pending edit is updated', async () => {
    field().focus();
    await otherTabSaves({ folderPattern: 'art/{id}' });
    expect(field().value).toBe('art/{id}');
  });

  it('tabs: ignores the echo of its own write', async () => {
    // A draft is pending in an unfocused field when this tab's own ugoira save echoes back.
    type('pixiv/{artist}');
    field().blur();
    $('[data-value="webm"]').click();
    await advance();
    expect(field().value).toBe('pixiv/{artist}');
  });

  it('tabs: leaves the field alone while the user is typing', async () => {
    type('pixiv/{title}');
    await otherTabSaves({ folderPattern: 'art/{id}', ugoiraOutput: 'zip' });
    expect([field().value, pressed()]).toEqual(['pixiv/{title}', ['zip']]);
  });

  it("tabs: the typist's pending save wins and keeps the other tab's other values", async () => {
    type('pixiv/{title}');
    await otherTabSaves({ folderPattern: 'art/{id}', ugoiraOutput: 'zip' });
    await advance(SETTINGS_DEBOUNCE_MS);
    expect([stored()?.folderPattern, stored()?.ugoiraOutput]).toEqual(['pixiv/{title}', 'zip']);
  });

  it('tabs: leaves an invalid draft and its error alone', async () => {
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    field().blur();
    await otherTabSaves({ folderPattern: 'art/{id}' });
    expect([field().value, errorBox().hidden]).toEqual(['pixiv/{artst}-{id}', false]);
  });

  it("tabs: an invalid draft's Still using line shows the other tab's pattern", async () => {
    type('pixiv/{artst}-{id}');
    await advance(SETTINGS_DEBOUNCE_MS);
    field().blur();
    await otherTabSaves({ folderPattern: 'art/{id}' });
    expect(lineText('#preview')).toBe(
      'Still using: art/{id} — your last valid pattern stays in effect until this one is fixed.',
    );
  });
});
