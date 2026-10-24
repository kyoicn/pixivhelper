import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const OPTIONS_CSS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/options/options.css',
);
const CSS = readFileSync(OPTIONS_CSS, 'utf8');
const DARK_MEDIA = '@media (prefers-color-scheme: dark)';
const DARK_CSS = CSS.slice(CSS.indexOf(DARK_MEDIA));
const PIXIV_BLUE = '#0096fa';
const AA_TEXT = 4.5;

/** The declarations of the first rule in `css` whose selector is exactly `selector`. */
function rule(selector: string, css = CSS): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\n\\s*${escaped} \\{([^}]*)\\}`).exec(css);
  if (!match?.[1]) throw new Error(`no rule ${selector}`);
  return match[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The custom properties a `:root` rule declares. */
function variables(declarations: string): Record<string, string> {
  return Object.fromEntries(
    [...declarations.matchAll(/(--[\w-]+): ([^;]+);/g)].map(
      ([, name = '', value = '']): [string, string] => [name, value],
    ),
  );
}

const LIGHT = variables(rule(':root'));
const DARK_OVERRIDES = variables(rule(':root', DARK_CSS));
const DARK = { ...LIGHT, ...DARK_OVERRIDES };

/** WCAG 2.x contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe('options.css: text blues (R-007)', () => {
  it('options.css: --accent-text is #0b6fc2 in light mode and pixiv blue in dark mode', () => {
    expect([LIGHT['--accent-text'], DARK['--accent-text']]).toEqual(['#0b6fc2', PIXIV_BLUE]);
  });

  it('options.css: --seg-selected is #0b6fc2 in both modes', () => {
    expect([LIGHT['--seg-selected'], DARK['--seg-selected']]).toEqual(['#0b6fc2', '#0b6fc2']);
  });

  it('options.css: links use --accent-text', () => {
    expect(rule('.link')).toContain('color: var(--accent-text);');
  });

  it('options.css: the selected segment is filled --seg-selected with white semibold text', () => {
    expect(rule(".seg button[aria-pressed='true']")).toBe(
      'background: var(--seg-selected); color: #fff; font-weight: 600;',
    );
  });

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ])('options.css: in %s mode links and the selected segment meet 4.5:1', (_mode, vars) => {
    const pairs = [
      contrast(vars['--accent-text'] ?? '', vars['--bg'] ?? ''),
      contrast('#ffffff', vars['--seg-selected'] ?? ''),
    ];
    expect(pairs.every((ratio) => ratio >= AA_TEXT)).toBe(true);
  });
});

describe('options.css: non-text blues stay pixiv blue', () => {
  it('options.css: --accent is pixiv blue in both modes', () => {
    expect([LIGHT['--accent'], DARK['--accent']]).toEqual([PIXIV_BLUE, PIXIV_BLUE]);
  });

  it.each([
    ['the focus ring', ':focus-visible', 'outline: 2px solid var(--accent)'],
    ['the field focus ring', '.field:focus-visible', 'outline: 2px solid var(--accent)'],
    ['the header mark', '.app-icon', 'background: var(--accent)'],
    ['the switch', ".switch[aria-checked='true']", 'background: var(--accent)'],
    ['the chip hover border', '.chip:hover', 'border-color: var(--accent)'],
    ['the chip hover text', '.chip:hover', 'color: var(--accent)'],
  ])('options.css: %s uses --accent', (_name, selector, declaration) => {
    expect(rule(selector).split(/;\s*/)).toContain(declaration);
  });
});
