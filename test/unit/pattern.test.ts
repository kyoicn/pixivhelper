import { describe, expect, it } from 'vitest';
import { PATTERN_MAX_CHARS } from '../../src/shared/constants';
import {
  ICU_WHITE_SPACE,
  SAMPLE,
  chromeSafeSegment,
  isSafeRelativeFolder,
  resolveFolder,
  sanitizeToken,
  validatePattern,
  type PatternError,
  type TokenValues,
} from '../../src/shared/pattern';

const work = (overrides: Partial<TokenValues> = {}): TokenValues => ({ ...SAMPLE, ...overrides });
const ZWJ = '\u{200d}';
// Python str.isspace (and so `re` \s): the set safe_component turns into '_'.
const PYTHON_WHITESPACE = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000,
];
const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
const chr = (cp: number): string => String.fromCodePoint(cp);

describe('validatePattern', () => {
  it.each([
    'pixiv/{artist}-{id}',
    'pixiv',
    'pixiv/{artist}/{title}',
    '{userId}/{id}',
    'a{b',
    'a}b',
    '{a{id}b}',
    '...',
    '~user/x',
    'pixiv~',
  ])('validatePattern: accepts %j', (p) => {
    expect(validatePattern(p)).toBeNull();
  });

  it.each(['', '   ', '\t'])('validatePattern: rule 1 rejects the empty pattern %j', (p) => {
    expect(validatePattern(p)).toEqual({ code: 'empty' });
  });

  it.each(['/abs', 'C:', 'c:/x', 'z:rel', '~', '~/pixiv', '\\\\server\\share'])(
    'validatePattern: rule 2 rejects the absolute path %j',
    (p) => {
      expect(validatePattern(p)).toEqual({ code: 'absolute' });
    },
  );

  it.each(['a\\b', 'pixiv\\'])('validatePattern: rule 3 rejects the backslash in %j', (p) => {
    expect(validatePattern(p)).toEqual({ code: 'backslash' });
  });

  it.each(['..', '../a', 'a/../b', 'a/ .. /b', 'a/..'])(
    'validatePattern: rule 4 rejects the ".." segment in %j',
    (p) => {
      expect(validatePattern(p)).toEqual({ code: 'dotdot' });
    },
  );

  it.each<[string, string]>([
    ['pixiv/{artst}-{id}', '{artst}'],
    ['{ID}', '{ID}'],
    ['{Artist}', '{Artist}'],
    ['{}', '{}'],
    ['{id}/{x}/{y}', '{x}'],
    ['{a b}', '{a b}'],
  ])('validatePattern: rule 5 names the first unknown token in %j', (p, token) => {
    expect(validatePattern(p)).toEqual({ code: 'unknownToken', token });
  });

  it.each([':', '*', '?', '"', '<', '>', '|'])(
    'validatePattern: rule 6 rejects the literal %j',
    (ch) => {
      expect(validatePattern(`pixiv${ch}{id}`)).toEqual({ code: 'illegalChars' });
    },
  );

  it('validatePattern: rule 6 checks literal text only, so known tokens never trip it', () => {
    expect(validatePattern('{artist}{id}{title}{userId}')).toBeNull();
  });

  it.each<[string, PatternError]>([
    ['/a\\..', { code: 'absolute' }],
    ['C:\\{x}', { code: 'absolute' }],
    ['a\\..', { code: 'backslash' }],
    ['../{x}', { code: 'dotdot' }],
    ['{x}:', { code: 'unknownToken', token: '{x}' }],
  ])('validatePattern: the earlier rule wins for %j', (p, error) => {
    expect(validatePattern(p)).toEqual(error);
  });

  it('validatePattern: accepts exactly PATTERN_MAX_CHARS characters', () => {
    expect(validatePattern('a'.repeat(PATTERN_MAX_CHARS))).toBeNull();
  });

  it('validatePattern: defensively rejects a pattern over PATTERN_MAX_CHARS', () => {
    expect(validatePattern('a'.repeat(PATTERN_MAX_CHARS + 1))).toEqual({ code: 'tooLong' });
  });

  it('validatePattern: the six user-facing rules win over the length guard', () => {
    expect(validatePattern(`{x}${'a'.repeat(PATTERN_MAX_CHARS)}`)).toEqual({
      code: 'unknownToken',
      token: '{x}',
    });
  });
});

describe('sanitizeToken', () => {
  it('sanitizeToken: PRD example "  Sora / 空 :: 2nd  " → Sora_空_2nd', () => {
    expect(sanitizeToken('  Sora / 空 :: 2nd  ')).toBe('Sora_空_2nd');
  });

  it('sanitizeToken: PRD example "..." → unknown', () => {
    expect(sanitizeToken('...')).toBe('unknown');
  });

  it('sanitizeToken: empty → unknown', () => {
    expect(sanitizeToken('')).toBe('unknown');
  });

  it('sanitizeToken: step 1 normalizes to NFC', () => {
    expect(sanitizeToken('cafe\u{301}')).toBe('caf\u{e9}');
  });

  it('sanitizeToken: step 2 removes C0 controls, DEL, "/", ":" and "\\"', () => {
    expect(sanitizeToken('a\u{0}b\u{1f}c\u{7f}d/e:f\\g')).toBe('abcdefg');
  });

  it('sanitizeToken: step 2+ removes * ? " < > | (PRD extension)', () => {
    expect(sanitizeToken('a*b?c"d<e>f|g')).toBe('abcdefg');
  });

  it.each(PYTHON_WHITESPACE.map((cp) => [hex(cp), cp] as const))(
    'sanitizeToken: step 3 handles Python whitespace %s like safe_component',
    (_name, cp) => {
      // C0 whitespace is removed by step 2 before the whitespace step sees it.
      const expected = cp < 0x20 ? 'ab' : 'a_b';
      expect(sanitizeToken(`a${chr(cp)}b`, { parityOnly: true })).toBe(expected);
    },
  );

  it('sanitizeToken: step 3 collapses a whitespace run into one "_"', () => {
    expect(sanitizeToken('a \u{3000}\u{a0} b')).toBe('a_b');
  });

  it('sanitizeToken: step 3 uses Python whitespace, not JS \\s (U+FEFF is not whitespace)', () => {
    expect(sanitizeToken('a\u{feff}b', { parityOnly: true })).toBe('a\u{feff}b');
  });

  it.each([0x80, 0x9f, 0xad, 0x200b, 0x200d, 0x200f, 0x2060, 0x2064, 0xfeff, 0xe0001, 0xe007f])(
    'sanitizeToken: step 3+ removes the Cc/Cf code point %d',
    (cp) => {
      expect(sanitizeToken(`a${chr(cp)}b`)).toBe('ab');
    },
  );

  it.each([0xfdd0, 0xfdef, 0xfffe, 0xffff, 0x1fffe, 0x10ffff])(
    'sanitizeToken: step 3+ removes the noncharacter %d',
    (cp) => {
      expect(sanitizeToken(`a${chr(cp)}b`)).toBe('ab');
    },
  );

  it('sanitizeToken: step 3+ runs after step 3, so U+0085 still becomes "_"', () => {
    expect(sanitizeToken('a\u{85}b')).toBe('a_b');
  });

  it('sanitizeToken: removes the ZWJ in 👩+ZWJ+🎨Mika (Chrome would refuse it)', () => {
    expect(sanitizeToken(`👩${ZWJ}🎨Mika`)).toBe('👩🎨Mika');
  });

  it('sanitizeToken: step 4 strips leading and trailing ".", "_" and space', () => {
    expect(sanitizeToken('._ a.b_c ._')).toBe('a.b_c');
  });

  it('sanitizeToken: keeps "~" (script parity; the segment pass handles the ends)', () => {
    expect(sanitizeToken('~sora~')).toBe('~sora~');
  });

  it('sanitizeToken: step 5 keeps 20 kanji (60 bytes)', () => {
    expect(sanitizeToken('漢'.repeat(21))).toBe('漢'.repeat(20));
  });

  it('sanitizeToken: step 5 never splits a 3-byte character', () => {
    expect(sanitizeToken(`a${'漢'.repeat(20)}`)).toBe(`a${'漢'.repeat(19)}`);
  });

  it('sanitizeToken: step 5 never splits a 4-byte character', () => {
    expect(sanitizeToken(`abc${'😀'.repeat(15)}`)).toBe(`abc${'😀'.repeat(14)}`);
  });

  it('sanitizeToken: step 5 strips "._ " again after truncating', () => {
    expect(sanitizeToken(`${'a'.repeat(59)} b`)).toBe('a'.repeat(59));
  });

  it('sanitizeToken: step 5 counts a lone surrogate as 3 bytes, like TextEncoder', () => {
    expect(sanitizeToken('\u{d800}'.repeat(21))).toBe('\u{d800}'.repeat(20));
  });

  it('sanitizeToken: parityOnly leaves out the PRD and Chrome removals', () => {
    const s = `a*?"<>|${ZWJ}\u{fdd0}b`;
    expect(sanitizeToken(s, { parityOnly: true })).toBe(s);
  });
});

describe('ICU_WHITE_SPACE', () => {
  it('ICU_WHITE_SPACE: lists exactly the ICU White_Space code points', () => {
    expect(ICU_WHITE_SPACE.map(hex)).toEqual([
      'U+0009',
      'U+000A',
      'U+000B',
      'U+000C',
      'U+000D',
      'U+0020',
      'U+0085',
      'U+00A0',
      'U+1680',
      'U+2000',
      'U+2001',
      'U+2002',
      'U+2003',
      'U+2004',
      'U+2005',
      'U+2006',
      'U+2007',
      'U+2008',
      'U+2009',
      'U+200A',
      'U+2028',
      'U+2029',
      'U+202F',
      'U+205F',
      'U+3000',
    ]);
  });

  it("ICU_WHITE_SPACE: agrees with the engine's \\p{White_Space} over all code points", () => {
    const engine: number[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (/\p{White_Space}/u.test(chr(cp))) engine.push(cp);
    }
    expect(engine).toEqual(ICU_WHITE_SPACE);
  });

  it.each(ICU_WHITE_SPACE.map((cp) => [hex(cp), cp] as const))(
    'chromeSafeSegment: trims %s at both ends and keeps it inside',
    (_name, cp) => {
      const ws = chr(cp);
      // Cc whitespace (TAB…CR, U+0085) is removed anywhere by step a.
      const kept = cp < 0x20 || cp === 0x85 ? 'ab' : `a${ws}b`;
      expect(chromeSafeSegment(`${ws}a${ws}b${ws}`)).toBe(kept);
    },
  );
});

describe('chromeSafeSegment', () => {
  it.each<[string, string]>([
    ['pixiv\t', 'pixiv'],
    [`a${ZWJ}b`, 'ab'],
    ['a"*:<>?|b', 'ab'],
    ['a\\b', 'ab'],
    ['a\u{fdd0}\u{ffff}b', 'ab'],
  ])('chromeSafeSegment: step a removes Chrome-illegal characters (%j → %j)', (seg, out) => {
    expect(chromeSafeSegment(seg)).toBe(out);
  });

  it.each<[string, string]>([
    ['~sora~-123', 'sora~-123'],
    ['pixiv ', 'pixiv'],
    ['. ~a~ .', 'a'],
    ['\u{3000}pixiv\u{3000}', 'pixiv'],
    ['my pixiv', 'my pixiv'],
  ])(
    'chromeSafeSegment: step b trims White_Space, "." and "~" at the ends (%j → %j)',
    (seg, out) => {
      expect(chromeSafeSegment(seg)).toBe(out);
    },
  );

  it.each(['', '...', ' ', '~.~', '\t'])(
    'chromeSafeSegment: step c drops a segment with nothing left (%j)',
    (seg) => {
      expect(chromeSafeSegment(seg)).toBe('');
    },
  );

  it.each<[string, string]>([
    ['CON', '_CON'],
    ['nul.txt', '_nul.txt'],
    ['Com1', '_Com1'],
    ['lpt9.tar.gz', '_lpt9.tar.gz'],
    ['clock$', '_clock$'],
    ['Desktop.ini', '_Desktop.ini'],
    ['thumbs.db', '_thumbs.db'],
    ['CONIN$', '_CONIN$'],
    ['conout$', '_conout$'],
  ])('chromeSafeSegment: step d prefixes the Windows reserved name %j', (seg, out) => {
    expect(chromeSafeSegment(seg)).toBe(out);
  });

  it.each(['com10', 'console', 'auxiliary', 'conin$.txt', 'desktop.ini.bak', 'ＣＯＮ'])(
    'chromeSafeSegment: step d leaves the non-reserved %j alone',
    (seg) => {
      expect(chromeSafeSegment(seg)).toBe(seg);
    },
  );

  it.each<[string, string]>([
    ['My.url', 'My.url_'],
    ['a.LNK', 'a.LNK_'],
    ['x.local', 'x.local_'],
    ['x.scf', 'x.scf_'],
    ['x.{abc}', 'x.{abc}_'],
    ['x.{}', 'x.{}_'],
    ['CON.lnk', '_CON.lnk_'],
  ])('chromeSafeSegment: step e suffixes the shell-integrated extension %j', (seg, out) => {
    expect(chromeSafeSegment(seg)).toBe(out);
  });

  it.each(['x.urls', 'x.{', 'x.}', 'url', 'x.url.gz'])(
    'chromeSafeSegment: step e leaves the ordinary name %j alone',
    (seg) => {
      expect(chromeSafeSegment(seg)).toBe(seg);
    },
  );

  // Includes Chromium's own cases (base/i18n/file_util_icu_unittest.cc), applied on every platform.
  it.each<[string, string]>([
    ['ab~c', 'ab_c'],
    ['config~1', 'config_1'],
    ['config~1.txt', 'config_1.txt'],
    ['~config1.txt', 'config1.txt'],
    ['config1.txt~', 'config1.txt'],
    ['a~b.c', 'a_b.c'],
    ['a~b.', 'a_b'],
  ])('chromeSafeSegment: step f replaces "~" in the 8.3-shaped %j', (seg, out) => {
    expect(chromeSafeSegment(seg)).toBe(out);
  });

  it.each([
    'conf g~1',
    'conf,g~1.txt',
    'conf~1.jpeg',
    'config~12.md',
    'config~12.txt',
    'config~1txt',
    'config~1VeryLongCannotBeShortNameOK.txt',
    'a~b.c.d',
    'a[~1',
    'a+b~1',
  ])('chromeSafeSegment: step f keeps "~" in %j, which cannot be an 8.3 name', (seg) => {
    expect(chromeSafeSegment(seg)).toBe(seg);
  });
});

describe('resolveFolder', () => {
  it('resolveFolder: PRD example pixiv/{artist}-{id} → pixiv/みずき-135882741', () => {
    expect(resolveFolder('pixiv/{artist}-{id}', work())).toBe('pixiv/みずき-135882741');
  });

  it('resolveFolder: PRD example pixiv/{artist}/{title} with SAMPLE → pixiv/みずき/雨上がりの渋谷', () => {
    expect(resolveFolder('pixiv/{artist}/{title}', SAMPLE)).toBe('pixiv/みずき/雨上がりの渋谷');
  });

  it('resolveFolder: golden {artist} "  Sora / 空 :: 2nd  " → Sora_空_2nd', () => {
    expect(resolveFolder('{artist}', work({ artist: '  Sora / 空 :: 2nd  ' }))).toBe('Sora_空_2nd');
  });

  it('resolveFolder: golden {artist} "..." → unknown', () => {
    expect(resolveFolder('{artist}', work({ artist: '...' }))).toBe('unknown');
  });

  it('resolveFolder: golden {artist} 👩+ZWJ+🎨Mika → 👩🎨Mika (ZWJ removed)', () => {
    expect(resolveFolder('{artist}', work({ artist: `👩${ZWJ}🎨Mika` }))).toBe('👩🎨Mika');
  });

  it('resolveFolder: golden ~sora~ trims the segment-leading "~" and keeps the inner one', () => {
    expect(resolveFolder('{artist}-{id}', work({ artist: '~sora~', id: '123' }))).toBe('sora~-123');
  });

  // The design's golden table shows `~sora~-1` → `sora~-1`, but `sora~-1` is 8.3-shaped, which
  // Chrome refuses on Windows, so step f also turns its "~" into "_".
  it('resolveFolder: golden ~sora~ with id 1 also gets step f (sora~-1 is 8.3-shaped)', () => {
    expect(resolveFolder('{artist}-{id}', work({ artist: '~sora~', id: '1' }))).toBe('sora_-1');
  });

  it('resolveFolder: golden pattern "pixiv" puts every work in one folder', () => {
    expect(resolveFolder('pixiv', work())).toBe('pixiv');
  });

  it('resolveFolder: golden pattern a//b/ drops empty and trailing segments → a/b', () => {
    expect(resolveFolder('a//b/', work())).toBe('a/b');
  });

  it('resolveFolder: golden {title} "CON" → _CON', () => {
    expect(resolveFolder('{title}', work({ title: 'CON' }))).toBe('_CON');
  });

  it('resolveFolder: null token values resolve to unknown', () => {
    expect(
      resolveFolder('{artist}/{title}/{userId}', work({ artist: null, title: null, userId: null })),
    ).toBe('unknown/unknown/unknown');
  });

  it('resolveFolder: substitutes in one pass, so a value reading "{id}" stays literal', () => {
    expect(resolveFolder('{artist}-{id}', work({ artist: '{id}' }))).toBe('{id}-135882741');
  });

  it('resolveFolder: a "/" inside a token value never creates a folder', () => {
    expect(resolveFolder('{artist}', work({ artist: 'a/b' }))).toBe('ab');
  });

  it('resolveFolder: applies the Chrome pass to literal text too', () => {
    expect(resolveFolder('pixiv /CON/{id}', work())).toBe('pixiv/_CON/135882741');
  });

  it('resolveFolder: falls back to unknown when every segment is dropped', () => {
    expect(resolveFolder('.../.', work())).toBe('unknown');
  });

  it('resolveFolder: SAMPLE is the PRD preview artwork', () => {
    expect(SAMPLE).toEqual({
      artist: 'みずき',
      id: '135882741',
      title: '雨上がりの渋谷',
      userId: '40285173',
    });
  });
});

describe('isSafeRelativeFolder', () => {
  it.each(['pixiv/みずき-135882741', 'a', '_CON/sora~-123', 'a'.repeat(1024)])(
    'isSafeRelativeFolder: accepts %j',
    (folder) => {
      expect(isSafeRelativeFolder(folder)).toBe(true);
    },
  );

  it.each([
    '',
    '/abs',
    'a//b',
    'a/',
    'a/./b',
    'a/../b',
    '..',
    'CON',
    'pixiv ',
    '~a',
    'a\\b',
    'a:b',
    'ab~c',
    'My.url',
    `a${ZWJ}b`,
    'a'.repeat(1025),
  ])('isSafeRelativeFolder: rejects %j', (folder) => {
    expect(isSafeRelativeFolder(folder)).toBe(false);
  });

  it('isSafeRelativeFolder: accepts what resolveFolder produces', () => {
    expect(isSafeRelativeFolder(resolveFolder('pixiv/{artist}/{title}', SAMPLE))).toBe(true);
  });
});
