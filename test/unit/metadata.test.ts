import { describe, expect, it } from 'vitest';
import {
  buildMetadata,
  plainText,
  serializeJson,
  stripPy,
  unescapeHtml,
} from '../../src/shared/metadata';

const ARTWORK_ID = '135882741';

const BODY: Record<string, unknown> = {
  illustId: '135882741',
  illustTitle: '雨上がりの渋谷',
  id: '135882741',
  description: '久しぶりに渋谷で雨。<br />Sketches from a rainy walk home through Shibuya.',
  illustType: 1,
  createDate: '2026-09-28T21:14:00+09:00',
  uploadDate: '2026-09-28T21:15:00+09:00',
  xRestrict: 0,
  tags: { authorId: '40285173', tags: [{ tag: 'オリジナル', locked: true }, { tag: '風景' }] },
  userId: '40285173',
  userName: 'みずき',
  width: 1448,
  pageCount: 12,
};

describe('buildMetadata', () => {
  it('buildMetadata: has exactly the 12 PRD §4.3 keys, in order', () => {
    expect(Object.keys(buildMetadata(BODY, ARTWORK_ID))).toEqual([
      'id',
      'title',
      'description',
      'userName',
      'userId',
      'createDate',
      'uploadDate',
      'pageCount',
      'illustType',
      'xRestrict',
      'tags',
      'url',
    ]);
  });

  it('buildMetadata: maps every field from the ajax body', () => {
    expect(buildMetadata(BODY, ARTWORK_ID)).toEqual({
      id: '135882741',
      title: '雨上がりの渋谷',
      description: '久しぶりに渋谷で雨。\nSketches from a rainy walk home through Shibuya.',
      userName: 'みずき',
      userId: '40285173',
      createDate: '2026-09-28T21:14:00+09:00',
      uploadDate: '2026-09-28T21:15:00+09:00',
      pageCount: 12,
      illustType: 1,
      xRestrict: 0,
      tags: ['オリジナル', '風景'],
      url: 'https://www.pixiv.net/artworks/135882741',
    });
  });

  it('buildMetadata: writes null for every field missing from the body', () => {
    expect(buildMetadata({}, ARTWORK_ID)).toEqual({
      id: null,
      title: null,
      description: null,
      userName: null,
      userId: null,
      createDate: null,
      uploadDate: null,
      pageCount: null,
      illustType: null,
      xRestrict: null,
      tags: [],
      url: 'https://www.pixiv.net/artworks/135882741',
    });
  });

  it('buildMetadata: a null description is null, not ""', () => {
    expect(buildMetadata({ ...BODY, description: null }, ARTWORK_ID).description).toBeNull();
  });

  it('buildMetadata: a non-string description is null (the script cannot parse one)', () => {
    expect(buildMetadata({ ...BODY, description: 42 }, ARTWORK_ID).description).toBeNull();
  });

  it('buildMetadata: an empty description stays ""', () => {
    expect(buildMetadata({ ...BODY, description: '' }, ARTWORK_ID).description).toBe('');
  });

  it('buildMetadata: keeps zero and empty-string values instead of nulling them', () => {
    const meta = buildMetadata({ ...BODY, illustTitle: '', pageCount: 0 }, ARTWORK_ID);
    expect([meta.title, meta.pageCount]).toEqual(['', 0]);
  });

  it('buildMetadata: missing tags are []', () => {
    const body: Record<string, unknown> = { ...BODY };
    delete body.tags;
    expect(buildMetadata(body, ARTWORK_ID).tags).toEqual([]);
  });

  it('buildMetadata: a tags object without a tags list is []', () => {
    expect(buildMetadata({ ...BODY, tags: { authorId: '1' } }, ARTWORK_ID).tags).toEqual([]);
  });

  it('buildMetadata: a tag entry without a tag is null', () => {
    const tags = { tags: [{ tag: 'a' }, { translation: { en: 'b' } }, 'c'] };
    expect(buildMetadata({ ...BODY, tags }, ARTWORK_ID).tags).toEqual(['a', null, null]);
  });

  it('buildMetadata: id falls back to body.id when illustId is missing', () => {
    const body: Record<string, unknown> = { ...BODY, id: '42' };
    delete body.illustId;
    expect(buildMetadata(body, ARTWORK_ID).id).toBe('42');
  });

  it('buildMetadata: an empty illustId falls through to body.id (Python `or`)', () => {
    expect(buildMetadata({ ...BODY, illustId: '', id: '42' }, ARTWORK_ID).id).toBe('42');
  });

  it('buildMetadata: url uses the body id', () => {
    expect(buildMetadata({ ...BODY, illustId: '42' }, ARTWORK_ID).url).toBe(
      'https://www.pixiv.net/artworks/42',
    );
  });

  it('buildMetadata: with no id in the body, url uses the requested artwork id', () => {
    const meta = buildMetadata({ illustTitle: 'x' }, '777');
    expect([meta.id, meta.url]).toEqual([null, 'https://www.pixiv.net/artworks/777']);
  });
});

describe('serializeJson', () => {
  it('serializeJson: indents by 2 spaces with no trailing newline', () => {
    expect(serializeJson({ a: 1, b: [2, 3], c: [] })).toBe(
      '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ],\n  "c": []\n}',
    );
  });

  it('serializeJson: writes non-ASCII literally', () => {
    const text = serializeJson(buildMetadata(BODY, ARTWORK_ID));
    expect(text).toContain('"title": "雨上がりの渋谷"');
  });

  it('serializeJson: never escapes a printable character as \\u', () => {
    const text = serializeJson(buildMetadata(BODY, ARTWORK_ID));
    expect(text).not.toContain('\\u');
  });

  it('serializeJson: keeps description line breaks as \\n', () => {
    const text = serializeJson(buildMetadata({ ...BODY, description: 'a<br>b</p>c' }, '1'));
    expect(text).toContain('"description": "a\\nb\\nc"');
  });

  it('serializeJson: escapes controls like Python json (short forms, lowercase \\u00xx)', () => {
    expect(serializeJson('"\\\t\n\r\b\f\u0001\u001f\u007f')).toBe(
      '"\\"\\\\\\t\\n\\r\\b\\f\\u0001\\u001f\u007f"',
    );
  });
});

describe('plainText', () => {
  it('plainText: turns <br>, <br/>, <br />, </p> and </div> into \\n, case-insensitively', () => {
    expect(plainText('a<br>b<BR/>c<br />d</P>e</div>f')).toBe('a\nb\nc\nd\ne\nf');
  });

  it('plainText: removes all other tags', () => {
    expect(plainText('<p><a href="x">link</a> <b>bold</b></p>')).toBe('link bold');
  });

  it('plainText: unescapes entities after tags are removed', () => {
    expect(plainText('&lt;b&gt;x&lt;/b&gt;')).toBe('<b>x</b>');
  });

  it('plainText: trims Python whitespace, including U+0085 and U+001C', () => {
    expect(plainText('\u0085\u001c x \u3000&nbsp;')).toBe('x');
  });

  it('plainText: <br> with a U+FEFF inside is an ordinary tag, as in Python re', () => {
    expect(plainText('a<br\ufeff>b')).toBe('ab');
  });

  it('plainText: </d\u0131v> (dotless i) is a line break, as under Python re.I', () => {
    expect(plainText('a</d\u0131v>b')).toBe('a\nb');
  });
});

describe('unescapeHtml', () => {
  it('unescapeHtml: decodes named references', () => {
    expect(unescapeHtml('&amp;&lt;&gt;&quot;&apos;&NotEqualTilde;')).toBe('&<>"\'≂\u0338');
  });

  it('unescapeHtml: decodes legacy names without a semicolon, longest prefix first', () => {
    expect(unescapeHtml('&ampx &notit; &notin;')).toBe('&x ¬it; ∉');
  });

  it('unescapeHtml: leaves unknown names alone', () => {
    expect(unescapeHtml('&unknown; &a &')).toBe('&unknown; &a &');
  });

  it('unescapeHtml: does not resolve Object.prototype names', () => {
    expect(unescapeHtml('&constructor;&toString;&__proto__;')).toBe(
      '&constructor;&toString;&__proto__;',
    );
  });

  it('unescapeHtml: decodes decimal and hex references with or without a semicolon', () => {
    expect(unescapeHtml('&#65;&#x42;&#X43&#68&#x1F600;')).toBe(
      'ABCD' + String.fromCodePoint(0x1f600),
    );
  });

  it('unescapeHtml: remaps references through the HTML5 invalid-charref table', () => {
    expect(unescapeHtml('&#0;&#13;&#x80;&#x81;&#x9F;')).toBe('\ufffd\r€\u0081Ÿ');
  });

  it('unescapeHtml: surrogates and out-of-range references become U+FFFD', () => {
    expect(unescapeHtml('&#xD800;&#x110000;&#99999999999;')).toBe('\ufffd\ufffd\ufffd');
  });

  it('unescapeHtml: invalid code points become empty', () => {
    expect(unescapeHtml('a&#1;&#11;&#x7f;&#xFDD0;&#xFFFE;&#x10FFFF;b')).toBe('ab');
  });
});

describe('stripPy', () => {
  it('stripPy: strips the characters Python str.strip() strips', () => {
    expect(stripPy('\t\n\v\f\r\u001c\u001f \u0085\u00a0\u1680\u2000\u2028\u3000x\u3000 ')).toBe(
      'x',
    );
  });

  it('stripPy: keeps U+FEFF and U+200B, which Python does not treat as whitespace', () => {
    expect(stripPy('\ufeff\u200bx\u200b\ufeff')).toBe('\ufeff\u200bx\u200b\ufeff');
  });

  it('stripPy: keeps inner whitespace', () => {
    expect(stripPy(' a \n b ')).toBe('a \n b');
  });

  it('stripPy: an all-whitespace string becomes empty', () => {
    expect(stripPy(' \u3000\u0085 ')).toBe('');
  });
});
