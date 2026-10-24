// The settings page (design-options-page.md): binds the shared settings and pattern rules to the
// controls, autosaves every valid change, and mirrors changes saved in other settings tabs.

import {
  PATTERN_MAX_CHARS,
  REPORT_ISSUE_URL,
  SETTINGS_DEBOUNCE_MS,
  UGOIRA_OUTPUTS,
} from '../shared/constants';
import { localeTag, t } from '../shared/i18n';
import { createLogger } from '../shared/log';
import { type PatternError, resolveFolder, SAMPLE, validatePattern } from '../shared/pattern';
import {
  DEFAULT_SETTINGS,
  onSettingsChanged,
  readSettings,
  writeSettings,
} from '../shared/settings';
import type { Settings, UgoiraOutput } from '../shared/types';
import { bindChips } from './chips';
import { createSavedIndicator, type SavedIndicator } from './saved';
import { bindSingleLine } from './single-line';
import { applyStrings, errorMessage, previewLine, stillUsingLine } from './strings';

type Section = 'folder' | 'ugoira' | 'metadata';

const SECTIONS: readonly Section[] = ['folder', 'ugoira', 'metadata'];
const HELP_ID = 'folder-help';
const ERROR_ID = 'pattern-error';

const log = createLogger('options');

function find<T extends Element>(selector: string, type: { new (): T; prototype: T }): T {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`options.html: missing ${selector}`);
  return el;
}

function sectionValue(s: Settings, section: Section): Settings[keyof Settings] {
  if (section === 'folder') return s.folderPattern;
  if (section === 'ugoira') return s.ugoiraOutput;
  return s.saveMetadata;
}

const pickSettings = (s: Settings): Settings => ({
  folderPattern: s.folderPattern,
  ugoiraOutput: s.ugoiraOutput,
  saveMetadata: s.saveMetadata,
});

/** Builds the page over options.html's markup. Resolves once it is visible and live. */
export async function initOptionsPage(): Promise<void> {
  const field = find('#pattern', HTMLInputElement);
  const errorBox = find(`#${ERROR_ID}`, HTMLParagraphElement);
  const errorText = find('#pattern-error .error-text', HTMLSpanElement);
  const previewText = find('#preview .preview-text', HTMLSpanElement);
  const metaSwitch = find('#meta', HTMLButtonElement);
  const report = find('#report', HTMLAnchorElement);
  const segments = new Map(
    UGOIRA_OUTPUTS.map((value) => [value, find(`.seg [data-value="${value}"]`, HTMLButtonElement)]),
  );
  const saved = Object.fromEntries(
    SECTIONS.map((section) => [
      section,
      createSavedIndicator(find(`#${section} .saved`, HTMLSpanElement)),
    ]),
  ) as Record<Section, SavedIndicator>;

  document.documentElement.lang = localeTag();
  document.title = t('opt_tab_title');
  applyStrings(document.body);
  report.href = REPORT_ISSUE_URL;
  find('#version', HTMLSpanElement).textContent = t(
    'opt_version',
    chrome.runtime.getManifest().version,
  );
  field.maxLength = PATTERN_MAX_CHARS;
  bindSingleLine(field, PATTERN_MAX_CHARS);

  // The newest values this tab saved or received; every write starts from them.
  let current = pickSettings(await readSettings());
  let error: PatternError | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  // updatedAt of this tab's latest write, to recognize its storage.onChanged echo.
  let lastOwnWriteAt = 0;

  const renderUgoira = (value: UgoiraOutput): void => {
    for (const [option, button] of segments) {
      button.setAttribute('aria-pressed', String(option === value));
    }
  };
  const renderMetadata = (on: boolean): void => {
    metaSwitch.setAttribute('aria-checked', String(on));
  };
  const renderPreview = (pattern: string): void => {
    previewText.replaceChildren(...previewLine(resolveFolder(pattern, SAMPLE)));
  };
  const renderStillUsing = (): void => {
    previewText.replaceChildren(...stillUsingLine(current.folderPattern));
  };
  const showError = (next: PatternError): void => {
    // At once, before the message: a Saved beside the error would read as "the typo was stored"
    // (PRD CUJ-3 step 5: no Saved appears).
    saved.folder.clear();
    error = next;
    errorText.replaceChildren(...errorMessage(next));
    errorBox.hidden = false;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', ERROR_ID);
    renderStillUsing();
  };
  const clearError = (): void => {
    error = null;
    errorBox.hidden = true;
    errorText.replaceChildren();
    field.removeAttribute('aria-invalid');
    field.setAttribute('aria-describedby', HELP_ID);
  };
  const cancelDebounce = (): void => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = null;
  };

  const save = async (next: Settings, flash: readonly Section[]): Promise<void> => {
    current = next;
    const { ok, updatedAt } = await writeSettings(next);
    if (!ok) {
      log.warn('settings not saved: storage.sync and storage.local both refused the write');
      return;
    }
    lastOwnWriteAt = updatedAt;
    for (const section of flash) {
      // The field turned invalid while the write was in flight: the error stays alone.
      if (section === 'folder' && error !== null) continue;
      saved[section].flash();
    }
  };

  const validateField = (): void => {
    debounce = null;
    const value = field.value;
    const invalid = validatePattern(value);
    if (invalid) {
      showError(invalid);
      return;
    }
    clearError();
    renderPreview(value);
    if (value !== current.folderPattern) {
      void save({ ...current, folderPattern: value }, ['folder']);
    }
  };
  const onFieldInput = (): void => {
    cancelDebounce();
    debounce = setTimeout(validateField, SETTINGS_DEBOUNCE_MS);
  };

  const showSettings = (s: Settings): void => {
    field.value = s.folderPattern;
    renderUgoira(s.ugoiraOutput);
    renderMetadata(s.saveMetadata);
    renderPreview(s.folderPattern);
  };

  showSettings(current);
  clearError();

  field.addEventListener('input', onFieldInput);
  bindChips(field, document.querySelectorAll<HTMLButtonElement>('.chip[data-token]'), onFieldInput);

  for (const [value, button] of segments) {
    button.addEventListener('click', () => {
      if (value === current.ugoiraOutput) return;
      renderUgoira(value);
      void save({ ...current, ugoiraOutput: value }, ['ugoira']);
    });
  }

  metaSwitch.addEventListener('click', () => {
    const on = !current.saveMetadata;
    renderMetadata(on);
    void save({ ...current, saveMetadata: on }, ['metadata']);
  });

  find('#reset', HTMLButtonElement).addEventListener('click', () => {
    const changed = SECTIONS.filter(
      (section) => sectionValue(current, section) !== sectionValue(DEFAULT_SETTINGS, section),
    );
    cancelDebounce();
    clearError();
    showSettings(DEFAULT_SETTINGS);
    void save({ ...DEFAULT_SETTINGS }, changed);
  });

  document.body.hidden = false;

  onSettingsChanged((s) => {
    if (s.updatedAt === lastOwnWriteAt) return;
    current = pickSettings(s);
    renderUgoira(current.ugoiraOutput);
    renderMetadata(current.saveMetadata);
    // An invalid draft is left alone (PRD CUJ-3 edge); so is a field the user is typing in,
    // whose pending save will be the newest.
    const typing = debounce !== null && document.activeElement === field;
    if (error) {
      renderStillUsing();
    } else if (!typing) {
      field.value = current.folderPattern;
      renderPreview(current.folderPattern);
    }
  });
}
