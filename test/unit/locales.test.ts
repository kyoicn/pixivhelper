import { describe, expect, it } from 'vitest';
import { LOCALES, loadMessages, type Locale, type MessageEntry } from '../helpers/i18n-stub';

// The full copy deck: every key with its placeholders in substitution order ($1, $2, …).
const DECK: Record<string, readonly string[]> = {
  // Meta
  ext_name: [],
  ext_description: [],
  locale_tag: [],
  // Download button
  btn_download: [],
  hint_pages: ['n'],
  hint_format: ['format'],
  btn_progress_pages: ['done', 'total'],
  btn_progress_percent: ['p'],
  btn_cancel: [],
  tip_cancel: [],
  btn_saved: [],
  tip_saved: ['folder'],
  btn_login: [],
  tip_login: [],
  btn_retry: [],
  hint_failed: ['n'],
  tip_partial: ['saved', 'total', 'failed'],
  tip_partial_one: ['saved', 'total'],
  tip_offline: [],
  tip_refused: [],
  tip_server: [],
  tip_disk: [],
  tip_metadata_only: ['total'],
  btn_unavailable: [],
  tip_unavailable: [],
  tip_encode_failed: [],
  // Accessible names and announcements
  aria_idle_pages: ['n'],
  aria_idle_single: [],
  aria_idle_ugoira: ['format'],
  aria_idle_ugoira_nometa: ['format'],
  aria_idle_ugoira_zip: [],
  aria_busy_pages: ['done', 'total'],
  aria_busy_pages_one: ['done'],
  aria_busy_frames: ['p'],
  aria_busy_encode: ['format', 'p'],
  aria_saved_pages: ['n', 'folder'],
  aria_saved_pages_one: ['folder'],
  aria_saved_ugoira: ['format', 'folder'],
  aria_login: [],
  aria_partial: ['saved', 'total', 'failed'],
  aria_failed: ['cause'],
  live_start: ['n'],
  live_start_one: [],
  live_start_ugoira: [],
  live_progress_pages: ['done', 'total'],
  live_progress_percent: ['p'],
  live_saved: ['n'],
  live_saved_one: [],
  live_saved_ugoira: ['format'],
  live_failed: ['n'],
  live_failed_one: [],
  live_cancelled: [],
  // Toolbar
  action_title_idle: [],
  action_title_one: ['n'],
  action_title_one_single: [],
  action_title_many: ['n', 'jobs'],
  // Settings page
  opt_tab_title: [],
  opt_title: [],
  opt_subtitle: [],
  opt_folder_heading: [],
  opt_folder_help: [],
  opt_folder_aria: [],
  opt_insert: [],
  tok_artist_tip: [],
  tok_id_tip: [],
  tok_title_tip: [],
  tok_userid_tip: [],
  opt_preview: [],
  opt_still_using: ['pattern'],
  err_empty: [],
  err_absolute: [],
  err_backslash: [],
  err_dotdot: [],
  err_unknown_token: ['token'],
  err_illegal_chars: [],
  opt_ugoira_heading: [],
  opt_ugoira_help: [],
  opt_ugoira_aria: [],
  opt_ugoira_mp4: [],
  opt_ugoira_webm: [],
  opt_ugoira_zip: [],
  opt_meta_heading: [],
  opt_meta_help: [],
  opt_saved: [],
  opt_reset: [],
  opt_report: [],
  opt_version: ['version'],
  opt_privacy: [],
};

const LOCALE_TAGS: Record<Locale, string> = { en: 'en', ja: 'ja', zh_CN: 'zh-CN', zh_TW: 'zh-TW' };

// PRD-000 Appendix A, "Proposed translations for width-critical button labels".
const BUTTON_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    btn_download: 'Download',
    btn_saved: 'Saved',
    btn_cancel: 'Cancel',
    btn_retry: 'Retry',
    hint_failed: '$N$ failed',
    btn_login: 'Log in to download',
    btn_unavailable: 'Unavailable',
  },
  ja: {
    btn_download: 'ダウンロード',
    btn_saved: '保存済み',
    btn_cancel: 'キャンセル',
    btn_retry: '再試行',
    hint_failed: '$N$件失敗',
    btn_login: 'ログインして保存',
    btn_unavailable: '利用不可',
  },
  zh_CN: {
    btn_download: '下载',
    btn_saved: '已保存',
    btn_cancel: '取消',
    btn_retry: '重试',
    hint_failed: '$N$ 个失败',
    btn_login: '登录后下载',
    btn_unavailable: '不可用',
  },
  zh_TW: {
    btn_download: '下載',
    btn_saved: '已儲存',
    btn_cancel: '取消',
    btn_retry: '重試',
    hint_failed: '$N$ 個失敗',
    btn_login: '登入後下載',
    btn_unavailable: '無法使用',
  },
};

const decks = new Map(LOCALES.map((locale) => [locale, loadMessages(locale)] as const));

function deck(locale: Locale): Record<string, MessageEntry> {
  const messages = decks.get(locale);
  if (!messages) throw new Error(`no deck for ${locale}`);
  return messages;
}

/** Declared placeholder names ordered by their `$n` content. */
function declaredPlaceholders(entry: MessageEntry): string[] {
  return Object.entries(entry.placeholders ?? {})
    .sort(([, a], [, b]) => a.content.localeCompare(b.content))
    .map(([name]) => name);
}

function referencedPlaceholders(entry: MessageEntry): string[] {
  const names = [...entry.message.matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map((m) =>
    (m[1] ?? '').toLowerCase(),
  );
  return [...new Set(names)].sort();
}

describe('src/_locales', () => {
  it('locales: en has exactly the copy-deck key set', () => {
    expect(Object.keys(deck('en')).sort()).toEqual(Object.keys(DECK).sort());
  });

  it.each(LOCALES)('locales: %s has the same key set as en', (locale) => {
    expect(Object.keys(deck(locale)).sort()).toEqual(Object.keys(deck('en')).sort());
  });

  it.each(LOCALES)('locales: %s has the same placeholder count per key as en', (locale) => {
    const counts = (l: Locale) =>
      Object.fromEntries(
        Object.entries(deck(l)).map(([key, e]) => [key, Object.keys(e.placeholders ?? {}).length]),
      );
    expect(counts(locale)).toEqual(counts('en'));
  });

  it.each(LOCALES)('locales: %s numbers its placeholders in substitution order', (locale) => {
    const actual = Object.fromEntries(
      Object.entries(deck(locale)).map(([key, entry]) => [
        key,
        Object.values(entry.placeholders ?? {}).map((p) => p.content),
      ]),
    );
    const expected = Object.fromEntries(
      Object.entries(DECK).map(([key, names]) => [key, names.map((_, i) => `$${i + 1}`)]),
    );
    expect(actual).toEqual(expected);
  });

  it.each(LOCALES)('locales: %s placeholder names match the copy deck', (locale) => {
    const actual = Object.fromEntries(
      Object.entries(deck(locale)).map(([key, entry]) => [key, declaredPlaceholders(entry)]),
    );
    expect(actual).toEqual(DECK);
  });

  it.each(LOCALES)('locales: %s messages use every declared placeholder and no other', (locale) => {
    const mismatched = Object.entries(deck(locale)).filter(
      ([, entry]) =>
        referencedPlaceholders(entry).join() !== declaredPlaceholders(entry).sort().join(),
    );
    expect(mismatched.map(([key]) => key)).toEqual([]);
  });

  it.each(LOCALES)('locales: %s locale_tag is its BCP 47 tag', (locale) => {
    expect(deck(locale).locale_tag?.message).toBe(LOCALE_TAGS[locale]);
  });

  it.each(LOCALES)('locales: %s uses the PRD width-critical button labels', (locale) => {
    const labels = Object.fromEntries(
      Object.keys(BUTTON_LABELS[locale]).map((key) => [key, deck(locale)[key]?.message]),
    );
    expect(labels).toEqual(BUTTON_LABELS[locale]);
  });

  it.each(LOCALES)('locales: %s keeps the page hint as <n>P', (locale) => {
    expect(deck(locale).hint_pages?.message).toBe('$N$P');
  });

  it.each(LOCALES)('locales: %s contains no HTML markup', (locale) => {
    const withHtml = Object.entries(deck(locale)).filter(([, e]) => /<[A-Za-z/!]/.test(e.message));
    expect(withHtml.map(([key]) => key)).toEqual([]);
  });

  it.each(LOCALES)('locales: %s uses ASCII digits only', (locale) => {
    const nonAscii = Object.entries(deck(locale)).filter(([, e]) =>
      /[^\P{Nd}0-9]/u.test(e.message),
    );
    expect(nonAscii.map(([key]) => key)).toEqual([]);
  });

  it.each(LOCALES)('locales: %s keeps the product name "Helper for Pixiv"', (locale) => {
    expect(deck(locale).ext_name?.message).toBe('Helper for Pixiv');
  });

  it.each(LOCALES)('locales: %s ext_description fits the 132-character store limit', (locale) => {
    expect(deck(locale).ext_description?.message.length).toBeLessThanOrEqual(132);
  });
});
