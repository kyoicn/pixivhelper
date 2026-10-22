// The pixiv DOM contract (design-artwork-button.md "pixiv DOM contract (pixiv-dom.ts)"): the only
// module that knows pixiv's markup. Hooks are ARIA/data-* attributes, element structure, the
// <html data-theme> marker and the __NEXT_DATA__ JSON, as pinned from the ENG-002 live captures
// (scripts/spike/FINDINGS.md §5, test/fixtures/pixiv/artwork-live-*.html). pixiv's generated class
// names are never used. Structure is checked by walking children: happy-dom evaluates `:has(> …)`
// incorrectly, so the unit tests could not vouch for such selectors.

export type Theme = 'light' | 'dark';

/**
 * Where the Download host goes: next to pixiv's like control, on its left on screen.
 *
 * The design's contract was `{ group, before: like }` (insert before the like control). pixiv's
 * action row is rendered mirrored (`flex-direction: row-reverse`, FINDINGS §5.1): DOM order is
 * share, bookmark, like, screen order like, bookmark, share. "Immediately left of Like on screen"
 * is therefore DOM position after the like wrapper in a reversed row, and before it otherwise;
 * `side` carries that decision so the placement code stays layout-agnostic.
 */
export interface ActionRowHit {
  /** The action-row container (a `section` inside `main`). */
  group: HTMLElement;
  /** The element child of `group` that wraps pixiv's like button. */
  like: HTMLElement;
  /** DOM side of `like` the host belongs on. */
  side: 'before' | 'after';
  /** Name of the strategy that found the like control (for logging). */
  via: string;
}

type ControlRole = 'menu' | 'bookmark' | 'like' | 'other' | 'none';

interface LikeStrategy {
  name: string;
  isLike(button: Element): boolean;
}

/** Ordered: the first strategy whose hit validates wins. */
const LIKE_STRATEGIES: readonly LikeStrategy[] = [
  // The only control in the row with an icon plus a visible (localized) text label.
  {
    name: 'icon+label',
    isLike: (button) =>
      childByTag(button, 'svg') !== null &&
      (childByTag(button, 'span')?.textContent ?? '').trim() !== '',
  },
  // Last resort, should a redesign drop the label: the like icon's SVG signature.
  {
    name: 'svg-signature',
    isLike: (button) => childByTag(button, 'svg')?.getAttribute('viewBox') === '0 0 12 12',
  },
];

const RENDERED_WORK_SELECTOR =
  'main figcaption [data-ga4-label="work_content"][data-ga4-entity-id]';
const RENDERED_WORK_RE = /^illust\/(\d{1,12})$/;
const LOGGED_IN_RE = /"isLoggedIn"\s*:\s*(true|false)/;
/** Relative luminance below which pixiv's page background counts as dark. */
const DARK_LUMINANCE = 0.4;
const RGB_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/;

/**
 * pixiv's action row and its like control: the first `main section` after the artwork figure in
 * document order whose element children include a like wrapper and at least one other control
 * (the bookmark heart), with a non-empty box. Thumbnails' mini-actions never qualify.
 *
 * With `artworkId`, a page whose rendered work (the figcaption's `illust/<id>` marker) is another
 * artwork is not matched: pixiv has not re-rendered the column for this route yet.
 */
export function findActionRow(doc: Document, artworkId?: string): ActionRowHit | null {
  const main = doc.querySelector('main');
  if (!main) return null;
  if (artworkId !== undefined) {
    const shown = renderedArtworkId(doc);
    if (shown !== null && shown !== artworkId) return null;
  }
  const figure = artworkFigure(main);
  const sections = Array.from(main.querySelectorAll('section')).filter(
    (section) =>
      figure === null ||
      (figure.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  for (const strategy of LIKE_STRATEGIES) {
    for (const section of sections) {
      const like = likeWrapper(section, strategy);
      if (like && hasBox(section)) {
        const side = isReversed(section) ? 'after' : 'before';
        return { group: section, like, side, via: strategy.name };
      }
    }
  }
  return null;
}

/** The artwork image container (floating fallback anchor): the first `main figure` not in a link. */
export function findArtworkArea(doc: Document): HTMLElement | null {
  const main = doc.querySelector('main');
  return main ? artworkFigure(main) : null;
}

/** The artwork the page has rendered, from the figcaption's `illust/<id>` marker; null if absent. */
export function renderedArtworkId(doc: Document): string | null {
  const marker = doc.querySelector(RENDERED_WORK_SELECTOR);
  return RENDERED_WORK_RE.exec(marker?.getAttribute('data-ga4-entity-id') ?? '')?.[1] ?? null;
}

/**
 * The page's login state, read once per document: `__NEXT_DATA__`'s
 * `props.pageProps.isLoggedIn`, else `"isLoggedIn":true|false` in an inline script (pixiv's theme
 * bootstrap carries it), else null (unknown).
 */
export function readIsLoggedIn(doc: Document): boolean | null {
  const nextData = doc.querySelector('script#__NEXT_DATA__[type="application/json"]');
  const fromNextData = nextDataLoggedIn(nextData?.textContent ?? '');
  if (fromNextData !== null) return fromNextData;
  for (const script of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const match = LOGGED_IN_RE.exec(script.textContent ?? '');
    if (match) return match[1] === 'true';
  }
  return null;
}

/**
 * pixiv's theme, never the OS's (PRD §4.7.4): `<html data-theme>`, else the luminance of the body
 * background.
 */
export function detectTheme(doc: Document): Theme {
  const marker = doc.documentElement.getAttribute('data-theme');
  if (marker === 'dark' || marker === 'light') return marker;
  const view = doc.defaultView;
  if (!view) return 'light';
  return luminance(view.getComputedStyle(doc.body).backgroundColor) < DARK_LUMINANCE
    ? 'dark'
    : 'light';
}

/** Calls `cb` with the new theme whenever it changes. Returns the disconnect function. */
export function observeTheme(doc: Document, cb: (theme: Theme) => void): () => void {
  let theme = detectTheme(doc);
  const observer = new MutationObserver(() => {
    const next = detectTheme(doc);
    if (next === theme) return;
    theme = next;
    cb(next);
  });
  const options = { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] };
  observer.observe(doc.documentElement, options);
  observer.observe(doc.body, options);
  return () => observer.disconnect();
}

function artworkFigure(main: Element): HTMLElement | null {
  for (const figure of Array.from(main.querySelectorAll('figure'))) {
    if (!figure.closest('a')) return figure;
  }
  return null;
}

/** The like wrapper among `section`'s children, if they also hold another control. */
function likeWrapper(section: Element, strategy: LikeStrategy): HTMLElement | null {
  let like: HTMLElement | null = null;
  let controls = 0;
  for (const wrapper of Array.from(section.children)) {
    const role = roleOf(wrapper, strategy);
    if (role === 'none') continue;
    controls++;
    if (role === 'like' && like === null && wrapper instanceof HTMLElement) like = wrapper;
  }
  return like !== null && controls >= 2 ? like : null;
}

function roleOf(wrapper: Element, strategy: LikeStrategy): ControlRole {
  const button = childByTag(wrapper, 'button');
  if (!button) return 'none';
  if (button.getAttribute('aria-haspopup') === 'true') return 'menu';
  if (button.querySelector('svg mask')) return 'bookmark';
  if (strategy.isLike(button)) return 'like';
  return 'other';
}

function childByTag(parent: Element, localName: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child.localName === localName) return child;
  }
  return null;
}

function hasBox(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isReversed(group: Element): boolean {
  return group.ownerDocument.defaultView?.getComputedStyle(group).flexDirection === 'row-reverse';
}

function nextDataLoggedIn(text: string): boolean | null {
  if (text === '') return null;
  try {
    const data: unknown = JSON.parse(text);
    const value = path(data, ['props', 'pageProps', 'isLoggedIn']);
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

function path(value: unknown, keys: readonly string[]): unknown {
  let node = value;
  for (const key of keys) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** WCAG relative luminance of a computed CSS color; a transparent or unknown color counts as 1. */
function luminance(color: string): number {
  const match = RGB_RE.exec(color.trim());
  if (!match) return 1;
  if (match[4] !== undefined && Number(match[4]) === 0) return 1;
  return 0.2126 * linear(match[1]) + 0.7152 * linear(match[2]) + 0.0722 * linear(match[3]);
}

function linear(channel: string | undefined): number {
  const c = Number(channel) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
