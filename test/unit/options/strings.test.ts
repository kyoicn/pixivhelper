// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type Copy,
  applyStrings,
  errorMessage,
  previewLine,
  stillUsingLine,
  withMono,
} from '../../../src/options/strings';
import { LOCALES, type Locale, loadMessages, stubChromeI18n } from '../../helpers/i18n-stub';

const OPTIONS_HTML = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/options/options.html',
);

const text = (copy: Copy): string =>
  copy.map((part) => (typeof part === 'string' ? part : part.textContent)).join('');

const monoParts = (copy: Copy): string[] =>
  copy.flatMap((part) =>
    typeof part !== 'string' && part.classList.contains('mono') ? [part.textContent] : [],
  );

/** Each part as [class, text]; a text node is ['text', …]. */
const shape = (copy: Copy): Array<[string, string]> =>
  copy.map((part) =>
    typeof part === 'string' ? ['text', part] : [part.className, part.textContent],
  );

/** options.html without its <head>, whose stylesheet and script happy-dom would try to load. */
function markup(): Document {
  const html = readFileSync(OPTIONS_HTML, 'utf8').replace(/<head>[\s\S]*<\/head>/, '');
  return new DOMParser().parseFromString(html, 'text/html');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('withMono', () => {
  it('withMono: wraps every token name in a mono span', () => {
    expect(monoParts(withMono('Use {artist}, {id}, {title} or {userId}.'))).toEqual([
      '{artist}',
      '{id}',
      '{title}',
      '{userId}',
    ]);
  });

  it('withMono: wraps frames.json and metadata.json', () => {
    expect(monoParts(withMono('frames.json and metadata.json'))).toEqual([
      'frames.json',
      'metadata.json',
    ]);
  });

  it('withMono: keeps the text around the mono parts', () => {
    expect(text(withMono('Save metadata.json now'))).toBe('Save metadata.json now');
  });

  it('withMono: returns plain text unchanged', () => {
    expect(withMono('Download folder')).toEqual(['Download folder']);
  });

  it('withMono: leaves an unknown brace pair as text', () => {
    expect(monoParts(withMono('{artst}'))).toEqual([]);
  });
});

describe('errorMessage', () => {
  it.each([
    [{ code: 'empty' } as const, 'Enter a folder pattern.'],
    [{ code: 'absolute' } as const, 'Must be a relative path inside Downloads.'],
    [{ code: 'backslash' } as const, 'Use "/" between folders.'],
    [{ code: 'dotdot' } as const, `Can't contain "..".`],
    [
      { code: 'unknownToken', token: '{artst}' } as const,
      'Unknown token {artst}. Available tokens: {artist}, {id}, {title}, {userId}.',
    ],
    [{ code: 'illegalChars' } as const, `Can't contain : * ? " < > |.`],
  ])('errorMessage: %o reads the PRD copy', (error, expected) => {
    stubChromeI18n('en');
    expect(text(errorMessage(error))).toBe(expected);
  });

  it('errorMessage: tooLong falls back to the illegal-characters message', () => {
    stubChromeI18n('en');
    expect(text(errorMessage({ code: 'tooLong' }))).toBe(`Can't contain : * ? " < > |.`);
  });

  it('errorMessage: sets the unknown token in mono semibold', () => {
    stubChromeI18n('en');
    const token = errorMessage({ code: 'unknownToken', token: '{artst}' }).find(
      (part) => typeof part !== 'string' && part.textContent === '{artst}',
    );
    expect(typeof token !== 'string' && token?.className).toBe('mono strong');
  });

  it('errorMessage: sets the available tokens in mono', () => {
    stubChromeI18n('en');
    expect(monoParts(errorMessage({ code: 'unknownToken', token: '{x}' }))).toEqual([
      '{x}',
      '{artist}',
      '{id}',
      '{title}',
      '{userId}',
    ]);
  });

  it('errorMessage: places the token where the translation puts it', () => {
    stubChromeI18n('ja');
    expect(text(errorMessage({ code: 'unknownToken', token: '{artst}' }))).toBe(
      '不明なトークン {artst} です。使用できるトークン: {artist}, {id}, {title}, {userId}',
    );
  });
});

describe('previewLine', () => {
  it('previewLine: reads Preview: Downloads/<folder>/135882741_p0.jpg', () => {
    stubChromeI18n('en');
    expect(text(previewLine('pixiv/みずき-135882741'))).toBe(
      'Preview: Downloads/pixiv/みずき-135882741/135882741_p0.jpg',
    );
  });

  it('previewLine: sets the path in mono', () => {
    stubChromeI18n('en');
    expect(monoParts(previewLine('pixiv'))).toEqual(['Downloads/pixiv/135882741_p0.jpg']);
  });

  it('previewLine: puts Preview: in a label span, then a space and the path', () => {
    stubChromeI18n('en');
    expect(shape(previewLine('pixiv'))).toEqual([
      ['label', 'Preview:'],
      ['text', ' '],
      ['mono path', 'Downloads/pixiv/135882741_p0.jpg'],
    ]);
  });
});

describe('stillUsingLine', () => {
  it('stillUsingLine: reads the PRD copy with the last valid pattern', () => {
    stubChromeI18n('en');
    expect(text(stillUsingLine('pixiv/{artist}-{id}'))).toBe(
      'Still using: pixiv/{artist}-{id} — your last valid pattern stays in effect until this one is fixed.',
    );
  });

  it('stillUsingLine: sets the pattern in mono', () => {
    stubChromeI18n('en');
    expect(monoParts(stillUsingLine('pixiv/{artist}-{id}'))).toEqual(['pixiv/{artist}-{id}']);
  });

  // R-004 S15: the label holds no trailing whitespace, so the line can wrap after it but never
  // inside it; zh_CN/zh_TW end the label with a full-width colon and no space.
  it.each<[Locale, Array<[string, string]>]>([
    [
      'en',
      [
        ['label', 'Still using:'],
        ['text', ' '],
        ['mono pattern', 'pixiv/{artist}-{id}'],
        ['muted', ' — your last valid pattern stays in effect until this one is fixed.'],
      ],
    ],
    [
      'ja',
      [
        ['label', '使用中:'],
        ['text', ' '],
        ['mono pattern', 'pixiv/{artist}-{id}'],
        ['muted', ' — このパターンを修正するまで、最後に有効だったパターンが使われます。'],
      ],
    ],
    [
      'zh_CN',
      [
        ['label', '仍在使用：'],
        ['mono pattern', 'pixiv/{artist}-{id}'],
        ['muted', ' — 在修正此格式之前，上一个有效的格式继续生效。'],
      ],
    ],
    [
      'zh_TW',
      [
        ['label', '仍在使用：'],
        ['mono pattern', 'pixiv/{artist}-{id}'],
        ['muted', ' — 在修正此格式之前，上一個有效的格式繼續生效。'],
      ],
    ],
  ])(
    'stillUsingLine: in %s returns the label, its trailing space as text, the pattern and the muted sentence',
    (locale, expected) => {
      stubChromeI18n(locale);
      expect(shape(stillUsingLine('pixiv/{artist}-{id}'))).toEqual(expected);
    },
  );

  it.each(LOCALES)('stillUsingLine: in %s reads the whole message unchanged', (locale) => {
    const getMessage = stubChromeI18n(locale);
    expect(text(stillUsingLine('pixiv/{artist}-{id}'))).toBe(
      getMessage('opt_still_using', ['pixiv/{artist}-{id}']),
    );
  });
});

describe('applyStrings', () => {
  it('applyStrings: every key named in options.html exists in the copy deck', () => {
    const en = loadMessages('en');
    const keys = [...markup().querySelectorAll<HTMLElement>('*')].flatMap((el) =>
      [el.dataset.i18n, el.dataset.i18nTitle, el.dataset.i18nAriaLabel].filter(
        (key): key is string => key !== undefined,
      ),
    );
    expect(keys.filter((key) => !(key in en))).toEqual([]);
  });

  it('applyStrings: fills text, titles and aria-labels', () => {
    stubChromeI18n('en');
    const doc = markup();
    applyStrings(doc.body);
    expect([
      doc.querySelector('h1')?.textContent,
      doc.querySelector('[data-token="{id}"]')?.getAttribute('title'),
      doc.querySelector('.seg')?.getAttribute('aria-label'),
    ]).toEqual([
      'Helper for Pixiv',
      'Artwork ID, the number in the page URL',
      'Ugoira output format',
    ]);
  });

  it('applyStrings: sets metadata.json in the metadata heading in mono', () => {
    stubChromeI18n('en');
    const doc = markup();
    applyStrings(doc.body);
    expect(doc.querySelector('#meta-h .mono')?.textContent).toBe('metadata.json');
  });

  it('applyStrings: sets frames.json in the ugoira help in mono', () => {
    stubChromeI18n('en');
    const doc = markup();
    applyStrings(doc.body);
    expect(doc.querySelector('#ugoira-help .mono')?.textContent).toBe('frames.json');
  });
});
