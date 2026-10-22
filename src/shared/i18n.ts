// chrome.i18n wrappers (system.md §11.4). No HTML ever enters messages.json: message parts that
// need their own styling are split out with splitOnPlaceholder() and built as DOM nodes.

import type en from '../_locales/en/messages.json';

/** A copy-deck key. All four locales carry the same key set (test/unit/locales.test.ts). */
export type MessageKey = keyof typeof en;
export type LocaleTag = 'en' | 'ja' | 'zh-CN' | 'zh-TW';
export type Substitution = string | number;

const LOCALE_TAGS: readonly LocaleTag[] = ['en', 'ja', 'zh-CN', 'zh-TW'];
const SENTINEL = '\u0000';

/** Resolves `key` in Chrome's UI locale. Numbers are substituted as ASCII digits, never localized. */
export function t(key: MessageKey, subs?: Substitution | readonly Substitution[]): string {
  if (subs === undefined) return chrome.i18n.getMessage(key);
  const list = typeof subs === 'string' || typeof subs === 'number' ? [subs] : subs;
  return chrome.i18n.getMessage(key, list.map(String));
}

/**
 * The locale Chrome actually resolved after fallback (e.g. zh_HK → en), unlike getUILanguage().
 * Used for `lang` attributes and the per-locale button width floor.
 */
export function localeTag(): LocaleTag {
  const tag = chrome.i18n.getMessage('locale_tag');
  return LOCALE_TAGS.find((known) => known === tag) ?? 'en';
}

/**
 * Splits message `key` around its `count` placeholders so the substituted parts can be styled as
 * separate DOM nodes. Returns `count + 1` literal segments in message order: placeholder i sits
 * between segments i and i + 1.
 */
export function splitOnPlaceholder(key: MessageKey, count = 1): string[] {
  const subs = Array.from({ length: count }, () => SENTINEL);
  return chrome.i18n.getMessage(key, subs).split(SENTINEL);
}
