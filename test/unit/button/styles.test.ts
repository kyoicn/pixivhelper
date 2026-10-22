// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { type Glyph, setGlyph } from '../../../src/content/button/icons';
import {
  BUTTON_CSS,
  createStyleSheet,
  RING_CIRCUMFERENCE,
} from '../../../src/content/button/styles';

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const start = BUTTON_CSS.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no rule ${selector}`);
  const open = BUTTON_CSS.indexOf('{', start);
  return BUTTON_CSS.slice(open + 1, BUTTON_CSS.indexOf('}', open))
    .replace(/\s+/g, ' ')
    .trim();
}

describe('BUTTON_CSS', () => {
  it('BUTTON_CSS: the pill is a 40 px fully rounded, non-shrinking pill', () => {
    expect(rule('.pill')).toEqual(
      expect.stringMatching(
        /height: 40px;.*padding: 0 12px;.*border-radius: 9999px;.*white-space: nowrap;/,
      ),
    );
  });

  it('BUTTON_CSS: the pill takes the locked width', () => {
    expect(rule('.pill')).toContain('width: var(--hfp-width, auto);');
  });

  it('BUTTON_CSS: idle is pixiv blue with white 14 px semibold text', () => {
    expect(rule('.pill')).toEqual(
      expect.stringMatching(
        /background: #0096FA;.*color: #fff;.*box-shadow: 0 1px 2px rgba\(0, 0, 0, \.08\);.*font-size: 14px;.*font-weight: 600;/,
      ),
    );
  });

  it('BUTTON_CSS: background changes take 120 ms', () => {
    expect(rule('.pill')).toContain('transition: background-color 120ms;');
  });

  it('BUTTON_CSS: icon 18 px, 8 px gaps, hint 13 px at 85 %, dot at 60 %', () => {
    expect([rule('.icon'), rule('.face'), rule('.hint'), rule('.dot')]).toEqual([
      'display: inline-flex; flex: none; width: 18px; height: 18px;',
      'display: inline-flex; align-items: center; gap: 8px;',
      'font-size: 13px; font-weight: 400; opacity: .85;',
      'opacity: .6;',
    ]);
  });

  it('BUTTON_CSS: counters use tabular digits', () => {
    expect(rule('.count')).toBe('font-variant-numeric: tabular-nums;');
  });

  it.each([
    ['.pill.primary:hover', 'background: #0084DC;'],
    [
      '.pill.saved',
      'background: #fff; color: #0096FA; border: 1.5px solid #0096FA; box-shadow: none;',
    ],
    ['.pill.saved:hover', 'background: #e6f4fe;'],
    [
      '.pill.neutral',
      'background: #fff; color: #3c4043; border: 1.5px solid #c4c7c5; box-shadow: none;',
    ],
    ['.pill.neutral:hover', 'background: #f5f7f9; border-color: #8a8f94;'],
    [
      '.pill.error',
      'background: #fff; color: #d93025; border: 1.5px solid #d93025; box-shadow: none;',
    ],
    ['.pill.error:hover', 'background: #fdeceb;'],
    ['.pill.error .hint', 'opacity: 1;'],
    [
      '.pill.disabled',
      'background: #f1f3f4; color: #80868b; box-shadow: none; cursor: not-allowed;',
    ],
    ['.pill.cancel, .pill.busy.armed:hover', 'background: #3c4043; color: #fff;'],
  ])('BUTTON_CSS: %s matches PRD §4.7.3', (selector, declarations) => {
    expect(rule(selector)).toBe(declarations);
  });

  it('BUTTON_CSS: the cancel face shows only on an armed busy pill under the pointer', () => {
    expect([rule('.face-cancel'), rule('.pill.busy.armed:hover .face-cancel')]).toEqual([
      'display: none;',
      'display: inline-flex;',
    ]);
  });

  it('BUTTON_CSS: the focus ring is 2 px #0096FA at a 3 px offset on :focus-visible', () => {
    expect(rule('.pill:focus-visible')).toBe('outline: 2px solid #0096FA; outline-offset: 3px;');
  });

  it("BUTTON_CSS: pixiv's dark theme only lightens the focus ring", () => {
    expect(rule(':host([data-theme="dark"]) .pill:focus-visible')).toBe('outline-color: #5fb9fb;');
  });

  it('BUTTON_CSS: the floating pill has the CUJ-5 shadow', () => {
    expect(BUTTON_CSS).toContain(
      ':host([data-mode="viewport"]) .pill { box-shadow: 0 2px 8px rgba(0, 0, 0, .24); }',
    );
  });

  it('BUTTON_CSS: the ring is a white arc on a 20 % track from 12 o’clock', () => {
    expect([rule('.ring'), rule('.ring .track'), rule('.ring .bar')]).toEqual([
      'transform: rotate(-90deg);',
      'stroke: rgba(255, 255, 255, .2);',
      `stroke: #fff; stroke-linecap: round; stroke-dasharray: ${RING_CIRCUMFERENCE}; transition: stroke-dashoffset 300ms ease;`,
    ]);
  });

  it('BUTTON_CSS: the indeterminate arc turns once per second', () => {
    expect(rule('.ring.indeterminate')).toBe('animation: hfp-spin 1s linear infinite;');
  });

  it('BUTTON_CSS: reduced motion removes every transition and animation', () => {
    expect(BUTTON_CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.pill, \.pill \* \{ transition: none !important; animation: none !important; \}/,
    );
  });

  it('RING_CIRCUMFERENCE: is 2π·8', () => {
    expect(RING_CIRCUMFERENCE).toBeCloseTo(50.265, 3);
  });

  it('createStyleSheet: holds the button rules', () => {
    expect(createStyleSheet().cssRules.length).toBeGreaterThan(20);
  });
});

describe('setGlyph', () => {
  it.each<Glyph>(['download', 'check', 'x', 'warning', 'ring'])(
    'setGlyph: %s is an 18 × 18 decorative SVG',
    (glyph) => {
      const el = document.createElement('span');
      setGlyph(el, glyph);
      const svg = el.querySelector('svg');
      expect([
        svg?.getAttribute('width'),
        svg?.getAttribute('height'),
        svg?.getAttribute('aria-hidden'),
      ]).toEqual(['18', '18', 'true']);
    },
  );

  it('setGlyph: the ring has a track and a bar of radius 8', () => {
    const el = document.createElement('span');
    setGlyph(el, 'ring');
    expect(
      Array.from(el.querySelectorAll('circle'), (c) => [
        c.getAttribute('class'),
        c.getAttribute('r'),
      ]),
    ).toEqual([
      ['track', '8'],
      ['bar', '8'],
    ]);
  });

  it('setGlyph: null empties the element', () => {
    const el = document.createElement('span');
    setGlyph(el, 'check');
    setGlyph(el, null);
    expect(el.childNodes).toHaveLength(0);
  });
});
