// Copy for the settings page: the static strings named by data-i18n attributes in options.html,
// and the dynamic lines (validation message, preview, "Still using"). Text only ever enters the
// DOM as text nodes (system.md §11.1).

import { h } from '../shared/dom';
import { type MessageKey, splitOnPlaceholder, t } from '../shared/i18n';
import { type PatternError, SAMPLE } from '../shared/pattern';

export type Copy = Array<string | HTMLElement>;

// Identical in every locale, so they can be found in translated text and set in monospace.
const MONO_LITERAL_RE = /(\{artist\}|\{id\}|\{title\}|\{userId\}|frames\.json|metadata\.json)/;

/** The PRD's generic label for Chrome's download directory, whose real location is unknown. */
const PREVIEW_ROOT = 'Downloads';
/** The sample artwork's first page (PRD CUJ-3 step 2). */
const PREVIEW_FILE = `${SAMPLE.id}_p0.jpg`;

const mono = (text: string, extra = ''): HTMLSpanElement =>
  h('span', { class: extra ? `mono ${extra}` : 'mono' }, text);

/** `text` with every token name and file name wrapped in a mono span. */
export function withMono(text: string): Copy {
  return text
    .split(MONO_LITERAL_RE)
    .map((part, i) => (i % 2 === 1 ? mono(part) : part))
    .filter((part) => part !== '');
}

/**
 * Fills every `[data-i18n]` element's text and every `[data-i18n-title]` /
 * `[data-i18n-aria-label]` attribute under `root` from the locale files.
 */
export function applyStrings(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.replaceChildren(...withMono(t(el.dataset.i18n as MessageKey)));
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle as MessageKey);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel as MessageKey));
  }
}

/** The message for a validation failure (PRD CUJ-3 step 5); the unknown token is mono semibold. */
export function errorMessage(error: PatternError): Copy {
  switch (error.code) {
    case 'empty':
      return withMono(t('err_empty'));
    case 'absolute':
      return withMono(t('err_absolute'));
    case 'backslash':
      return withMono(t('err_backslash'));
    case 'dotdot':
      return withMono(t('err_dotdot'));
    case 'unknownToken': {
      const [before = '', after = ''] = splitOnPlaceholder('err_unknown_token');
      return [...withMono(before), mono(error.token, 'strong'), ...withMono(after)];
    }
    case 'illegalChars':
    // The field's maxlength and the chip guard keep input within PATTERN_MAX_CHARS, so tooLong
    // cannot come from the page, and the PRD has no copy for it. It still must not be stored.
    case 'tooLong':
      return withMono(t('err_illegal_chars'));
  }
}

/** `Preview: Downloads/<folder>/135882741_p0.jpg`, as running text. */
export function previewLine(folder: string): Copy {
  return [
    h('span', { class: 'label' }, t('opt_preview')),
    ' ',
    mono(`${PREVIEW_ROOT}/${folder}/${PREVIEW_FILE}`, 'path'),
  ];
}

/** `Still using: <pattern> — your last valid pattern stays in effect until this one is fixed.` */
export function stillUsingLine(pattern: string): Copy {
  const [before = '', after = ''] = splitOnPlaceholder('opt_still_using');
  // The label never breaks (R-004 S15). Its trailing space stays outside it as a text node, so the
  // line can still wrap between the label and the pattern.
  const name = before.trimEnd();
  const space = before.slice(name.length);
  return [
    h('span', { class: 'label' }, name),
    ...(space === '' ? [] : [space]),
    mono(pattern, 'pattern'),
    h('span', { class: 'muted' }, after),
  ];
}
