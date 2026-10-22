import { afterEach, describe, expect, it, vi } from 'vitest';
import { localeTag, splitOnPlaceholder, t } from '../../src/shared/i18n';
import { createGetMessage, stubChromeI18n, type Locale } from '../helpers/i18n-stub';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('t', () => {
  it('t: returns the message of a key without placeholders', () => {
    stubChromeI18n('en');
    expect(t('btn_download')).toBe('Download');
  });

  it('t: substitutes a single number as ASCII digits', () => {
    stubChromeI18n('ja');
    expect(t('hint_failed', 3)).toBe('3件失敗');
  });

  it('t: substitutes several values in placeholder order', () => {
    stubChromeI18n('en');
    expect(t('btn_progress_pages', [7, 12])).toBe('7 / 12');
  });

  it('t: lets a translation reorder its placeholders', () => {
    stubChromeI18n('ja');
    expect(t('aria_busy_pages', [7, 12])).toBe(
      'ダウンロード中、12ページ中7ページ保存済み。クリックでキャンセル。',
    );
  });

  it('t: passes string substitutions through unchanged', () => {
    stubChromeI18n('en');
    expect(t('tip_saved', 'pixiv/みずき-135882741')).toBe(
      'Saved to Downloads/pixiv/みずき-135882741',
    );
  });

  it('t: only accepts copy-deck keys (checked by the type checker)', () => {
    stubChromeI18n('en');
    // @ts-expect-error 'no_such_key' is not a MessageKey
    expect(t('no_such_key')).toBe('');
  });
});

describe('localeTag', () => {
  it.each<[Locale, string]>([
    ['en', 'en'],
    ['ja', 'ja'],
    ['zh_CN', 'zh-CN'],
    ['zh_TW', 'zh-TW'],
  ])('localeTag: the %s deck resolves to %s', (locale, tag) => {
    stubChromeI18n(locale);
    expect(localeTag()).toBe(tag);
  });

  it('localeTag: falls back to en for an unexpected value', () => {
    vi.stubGlobal('chrome', { i18n: { getMessage: () => '' } });
    expect(localeTag()).toBe('en');
  });
});

describe('splitOnPlaceholder', () => {
  it('splitOnPlaceholder: splits a message around its placeholder', () => {
    stubChromeI18n('en');
    expect(splitOnPlaceholder('opt_still_using')).toEqual([
      'Still using: ',
      ' — your last valid pattern stays in effect until this one is fixed.',
    ]);
  });

  it('splitOnPlaceholder: follows the translation of the resolved locale', () => {
    stubChromeI18n('ja');
    expect(splitOnPlaceholder('err_unknown_token')).toEqual([
      '不明なトークン ',
      ' です。使用できるトークン: {artist}, {id}, {title}, {userId}',
    ]);
  });

  it('splitOnPlaceholder: returns count + 1 segments for several placeholders', () => {
    stubChromeI18n('en');
    expect(splitOnPlaceholder('btn_progress_pages', 2)).toEqual(['', ' / ', '']);
  });
});

describe('i18n stub', () => {
  it('i18n stub: returns an empty string for an unknown key, like Chrome', () => {
    expect(createGetMessage('en')('no_such_key')).toBe('');
  });

  it('i18n stub: matches message names case-insensitively, like Chrome', () => {
    expect(createGetMessage('zh_TW')('BTN_DOWNLOAD')).toBe('下載');
  });

  it('i18n stub: leaves a placeholder empty when its substitution is missing', () => {
    expect(createGetMessage('en')('btn_progress_pages', ['7'])).toBe('7 / ');
  });

  it('i18n stub: keeps chrome members installed before it', () => {
    vi.stubGlobal('chrome', { runtime: { id: 'test' } });
    stubChromeI18n('en');
    expect((globalThis as { chrome?: { runtime?: unknown } }).chrome?.runtime).toEqual({
      id: 'test',
    });
  });
});
