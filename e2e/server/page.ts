// HTML for the fake www.pixiv.net and accounts.pixiv.net. The artwork page is a reduction of the
// ENG-002 live capture (test/fixtures/pixiv/artwork-live-*.html, scripts/spike/FINDINGS.md §5) to
// exactly the hooks src/content/pixiv-dom.ts relies on, minus pixiv's generated class names:
// - `main > section > div > div` holding the artwork `figure` (not inside a link), then a wrapper
//   with the action-row `section`, then the `figcaption` with the `illust/<id>` work marker;
// - the action row, rendered ROW_DELAY_MS after load: share (`aria-haspopup="true"`), bookmark
//   (an SVG with a `<mask>`) and like (an SVG plus a text label) in that DOM order, laid out
//   `flex-direction: row-reverse` (screen order like, bookmark, share) with the like wrapper's
//   `margin-right: 20px` and no flex gap, as measured live;
// - other works as `a`-wrapped thumbnail figures with their own bookmark mini-buttons;
// - `<html data-theme>` and `script#__NEXT_DATA__` with `props.pageProps.isLoggedIn`.
// Plus SPA navigation and the `window.__fake` test controls.

export interface CatalogEntry {
  id: string;
  title: string;
  userName: string;
  userId: string;
  xRestrict: number;
  /** Behind pixiv's sensitive-content login wall: logged out, the page shows the wall text. */
  sensitiveWall?: boolean;
  pageCount: number;
  /** Description HTML, as pixiv serves it. */
  description: string;
  tags: readonly string[];
  master: string;
  width: number;
  height: number;
  pageTitle: string;
}

export interface FakePageConfig {
  loggedIn: boolean;
  works: Record<string, CatalogEntry>;
  rowDelayMs: number;
  rowMark: string;
}

/** `window.__fake` on every fake www.pixiv.net page. */
export interface FakePageControls {
  /** Replaces the action row with freshly built nodes (as a React re-render does). False if no row is shown. */
  rerenderRow(): boolean;
  /** Removes the action row and keeps it away, across SPA navigations, until restoreRow(). */
  removeRow(): void;
  restoreRow(): void;
  setTheme(theme: 'light' | 'dark'): void;
}

export type FakeWindow = Window & { __fake: FakePageControls };

/** The action row appears this long after `load` (or after an SPA navigation). */
export const ROW_DELAY_MS = 300;
/** `performance.mark` set when the action row is inserted. */
export const ROW_MARK = 'fake:row';

export function artworkPageTitle(work: { title: string; userName: string }): string {
  return `${work.title} - ${work.userName}のイラスト - pixiv`;
}

const CSS = `
:root { color-scheme: light; font: 14px/1.6 system-ui, sans-serif; }
html[data-theme='dark'] { color-scheme: dark; }
body { margin: 0; background: #f5f5f5; color: #1f1f1f; }
html[data-theme='dark'] body { background: #1f1f1f; color: #f5f5f5; }
header { display: flex; gap: 16px; align-items: center; padding: 12px 24px; border-bottom: 1px solid #8884; }
main { max-width: 752px; margin: 0 auto; padding: 24px; }
.work-figure { margin: 0; display: flex; justify-content: center; background: #8882; min-height: 240px; }
.work-figure img { max-width: 100%; height: auto; }
.r18 { align-self: center; font-weight: 700; }
.wall { align-self: center; text-align: center; }
.row-wrapper { margin-top: 16px; }
.row { display: flex; flex-direction: row-reverse; align-items: center; min-height: 48px; }
.row button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 32px; height: 32px; padding: 0; border: 0; border-radius: 16px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.row svg { width: 32px; height: 32px; fill: currentColor; }
.row .like { margin-right: 20px; }
.row .like button { padding: 0 12px; background: #8882; }
.row .like svg { width: 12px; height: 12px; }
.row .bookmark { margin-right: 13px; }
.description { white-space: pre-line; }
.others nav { display: flex; gap: 12px; }
.thumb { position: relative; width: 136px; height: 136px; }
.thumb figure { margin: 0; width: 136px; height: 136px; background: #8883; overflow: hidden; }
.thumb button { position: absolute; right: 4px; bottom: 4px; width: 32px; height: 32px; border: 0; background: transparent; color: inherit; }
.thumb svg { width: 32px; height: 32px; fill: currentColor; }
`;

/**
 * The page script, serialized with Function.prototype.toString(); it must not reference anything
 * outside its own body. Exported so unit tests can render the page in happy-dom.
 */
export function fakePixivApp(config: FakePageConfig): void {
  const ARTWORK_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?artworks\/(\d{1,12})\/?$/;
  const USER_RE = /^\/users\/(\d+)\/?$/;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Simplified from pixiv's own icons (live capture).
  const ICONS = {
    share:
      'M17 9.9V18a1 1 0 0 1-2 0V9.9l-3.3 3.3a1 1 0 0 1-1.4-1.4L16 6.1l5.7 5.7a1 1 0 0 1-1.4 1.4zM25 17v7a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3v-7a1 1 0 0 1 2 0v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7a1 1 0 0 1 2 0z',
    heart:
      'M21 5.5a7 7 0 0 1 7 7c0 5.8-3.7 10.7-10.8 14.6a2.5 2.5 0 0 1-2.4 0C7.7 23.2 4 18.3 4 12.5a7 7 0 0 1 12-4.7 7 7 0 0 1 5-2.3z',
    heartHole:
      'M16 11.3c-.9-2-3-3.8-5-3.8a5 5 0 0 0-5 5c0 4.9 3.3 9.2 9.8 12.9h.4C22.7 21.7 26 17.4 26 12.5a5 5 0 0 0-5-5c-2 0-4.1 1.8-5 3.8z',
    like: 'M2 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm8 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM2.1 8.9a1 1 0 0 1 1.4-1.4 3.5 3.5 0 0 0 5 0 1 1 0 0 1 1.4 1.4 5.5 5.5 0 0 1-7.8 0z',
  };
  const main = document.querySelector('main');
  if (!main) return;
  const root: HTMLElement = main;

  let current: CatalogEntry | null = null;
  let slot: HTMLElement | null = null;
  let row: HTMLElement | null = null;
  let rowRemoved = false;
  let renderSeq = 0;

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string>,
    ...children: (Node | string)[]
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  }

  function svgEl(tag: string, attrs: Record<string, string>, ...children: Element[]): Element {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  }

  function icon(viewBox: string, d: string): Element {
    return svgEl('svg', { viewBox }, svgEl('path', { d }));
  }

  /** The bookmark heart: the only control in the row whose SVG has a `<mask>`. */
  function heartIcon(maskId: string): Element {
    return svgEl(
      'svg',
      { viewBox: '0 0 32 32', width: '32', height: '32' },
      svgEl(
        'defs',
        {},
        svgEl(
          'mask',
          { id: maskId },
          svgEl('rect', { x: '0', y: '0', width: '32', height: '32', fill: 'white' }),
          svgEl('path', { d: ICONS.heartHole, fill: 'black' }),
        ),
      ),
      svgEl('g', { mask: `url(#${maskId})` }, svgEl('path', { d: ICONS.heart })),
    );
  }

  function spaLink(href: string, ...children: (Node | string)[]): HTMLAnchorElement {
    return el('a', { href, 'data-spa': '' }, ...children);
  }

  /** pixiv's action row: DOM order share, bookmark, like; mirrored on screen by the CSS. */
  function buildRow(): HTMLElement {
    return el(
      'section',
      { class: 'row' },
      el(
        'div',
        { class: 'share' },
        el('button', { type: 'button', 'aria-haspopup': 'true' }, icon('0 0 32 32', ICONS.share)),
      ),
      el('div', { class: 'bookmark' }, el('button', { type: 'button' }, heartIcon('fake-mask-1'))),
      el(
        'div',
        { class: 'like' },
        el('button', { type: 'button' }, icon('0 0 12 12', ICONS.like), el('span', {}, 'Like')),
      ),
    );
  }

  function insertRow(seq: number): void {
    if (seq !== renderSeq || rowRemoved || row || !slot || !current) return;
    row = buildRow();
    slot.append(row);
    performance.mark(config.rowMark);
  }

  function scheduleRow(): void {
    const seq = renderSeq;
    const start = () => window.setTimeout(() => insertRow(seq), config.rowDelayMs);
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }

  function descriptionText(html: string): string {
    const withBreaks = html.replace(/<br\s*\/?>/gi, '\n');
    return new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? '';
  }

  function workList(works: CatalogEntry[]): HTMLElement {
    return el(
      'ul',
      {},
      ...works.map((work) =>
        el(
          'li',
          {},
          spaLink(`/artworks/${work.id}`, `${work.id} ${work.title} / ${work.userName}`),
        ),
      ),
    );
  }

  /** Other works: link-wrapped thumbnail figures with bookmark mini-buttons, outside any section. */
  function otherWorks(work: CatalogEntry): HTMLElement {
    const others = Object.values(config.works)
      .filter((other) => other.id !== work.id)
      .slice(0, 3);
    return el(
      'div',
      { class: 'others' },
      el(
        'nav',
        {},
        ...others.map((other, i) =>
          el(
            'div',
            { class: 'thumb' },
            el(
              'a',
              { href: `/artworks/${other.id}`, 'data-spa': '', 'data-ga4-label': 'thumbnail_link' },
              el('figure', {}, el('div', {}, other.title)),
            ),
            el(
              'div',
              { 'data-ga4-label': 'bookmark_button' },
              el('button', { type: 'button' }, heartIcon(`fake-thumb-mask-${i}`)),
            ),
          ),
        ),
      ),
    );
  }

  function renderArtwork(id: string): void {
    const work: CatalogEntry = config.works[id] ?? {
      id,
      title: 'Unknown work',
      userName: 'unknown',
      userId: '0',
      xRestrict: 0,
      pageCount: 1,
      description: '',
      tags: [],
      master: '',
      width: 1,
      height: 1,
      pageTitle: 'pixiv',
    };
    current = work;
    document.title = work.pageTitle;
    const wall = work.xRestrict > 0 && !config.loggedIn;
    // pixiv's sensitive-content wall replaces the image; the action row stays.
    const sensitiveWall = work.sensitiveWall === true && !config.loggedIn;
    const artwork = sensitiveWall
      ? el(
          'div',
          { class: 'wall' },
          el('p', {}, 'This work may contain sensitive content.'),
          el('p', {}, 'Please log in to view this work.'),
        )
      : wall || !work.master
        ? el('div', { class: 'r18' }, wall ? 'R-18' : '')
        : el('img', {
            src: work.master,
            alt: work.title,
            width: String(work.width),
            height: String(work.height),
          });
    const figure = el(
      'figure',
      { class: 'work-figure' },
      el('div', { role: 'presentation' }, artwork),
    );
    slot = el('div', { class: 'row-wrapper' });
    const caption = el(
      'figcaption',
      {},
      el(
        'div',
        { 'data-ga4-label': 'work_content', 'data-ga4-entity-id': `illust/${work.id}` },
        el('h1', {}, work.title),
        el('p', { class: 'description' }, descriptionText(work.description)),
        el('footer', {}, ...work.tags.map((tag) => `#${tag} `)),
        el('p', {}, spaLink(`/users/${work.userId}`, work.userName)),
      ),
    );
    root.replaceChildren(
      el('section', {}, el('div', {}, el('div', {}, figure, slot, caption))),
      otherWorks(work),
    );
    scheduleRow();
  }

  function renderUser(userId: string): void {
    const works = Object.values(config.works).filter((work) => work.userId === userId);
    const name = works[0]?.userName ?? 'unknown';
    document.title = `${name} - pixiv`;
    root.replaceChildren(el('h1', {}, name), workList(works));
  }

  function renderHome(): void {
    document.title = 'pixiv';
    root.replaceChildren(el('h1', {}, 'fake pixiv'), workList(Object.values(config.works)));
  }

  function render(): void {
    renderSeq++;
    current = null;
    slot = null;
    row = null;
    const path = location.pathname;
    const artwork = ARTWORK_RE.exec(path);
    const user = USER_RE.exec(path);
    if (artwork?.[1]) renderArtwork(artwork[1]);
    else if (user?.[1]) renderUser(user[1]);
    else renderHome();
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    const link = target instanceof Element ? target.closest('a[data-spa]') : null;
    if (!(link instanceof HTMLAnchorElement) || event.defaultPrevented || event.button !== 0)
      return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.pushState(null, '', link.href);
    render();
  });
  window.addEventListener('popstate', render);

  const controls: FakePageControls = {
    rerenderRow() {
      if (!row || !current) return false;
      const fresh = buildRow();
      row.replaceWith(fresh);
      row = fresh;
      return true;
    },
    removeRow() {
      rowRemoved = true;
      row?.remove();
      row = null;
    },
    restoreRow() {
      rowRemoved = false;
      insertRow(renderSeq);
    },
    setTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
    },
  };
  (window as unknown as FakeWindow).__fake = controls;
  render();
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export interface WwwPageOptions {
  title: string;
  loggedIn: boolean;
  illustId: string | null;
  works: Record<string, CatalogEntry>;
}

/** Every www.pixiv.net HTML route serves this shell; the page script renders the route. */
export function wwwPage({ title, loggedIn, illustId, works }: WwwPageOptions): string {
  // pixiv embeds its state in __NEXT_DATA__; the extension reads props.pageProps.isLoggedIn.
  const nextData = {
    props: { pageProps: { isLoggedIn: loggedIn, illustId } },
    page: illustId ? '/artworks/[id]' : '/',
    query: illustId ? { id: illustId } : {},
  };
  const config: FakePageConfig = { loggedIn, works, rowDelayMs: ROW_DELAY_MS, rowMark: ROW_MARK };
  return `<!doctype html>
<html lang="ja" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:,">
<style>${CSS}</style>
</head>
<body>
<header><a href="/" data-spa>pixiv</a><span>fake pixiv (e2e)</span></header>
<main></main>
<script id="__NEXT_DATA__" type="application/json">${scriptJson(nextData)}</script>
<script>(${fakePixivApp.toString()})(${scriptJson(config)});</script>
</body>
</html>
`;
}

export function notFoundPage(): string {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>404 - pixiv</title><link rel="icon" href="data:,"></head>
<body><h1>404 Not Found</h1></body></html>
`;
}

/** accounts.pixiv.net/login: one button that logs in and returns to `returnTo`. */
export function loginPage(returnTo: string): string {
  const action = `/login?return_to=${encodeURIComponent(returnTo)}`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>ログイン - pixiv</title><link rel="icon" href="data:,"></head>
<body>
<main>
<h1>pixiv login (fake)</h1>
<form method="post" action="${escapeHtml(action)}"><button type="submit">Log in</button></form>
</main>
</body></html>
`;
}
