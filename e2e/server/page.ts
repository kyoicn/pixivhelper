// HTML for the fake www.pixiv.net and accounts.pixiv.net. Placeholder structure: task 3.4 replaces it
// with the structure of the ENG-002 live capture (test/fixtures/pixiv/artwork-*.html). What the
// extension relies on is here: an action row (share, more, like, bookmark) rendered 300 ms after load,
// the artwork figure, a theme marker on <html>, the inline data script with `"isLoggedIn":`, SPA
// navigation, and `window.__fake` test controls.

export interface CatalogEntry {
  id: string;
  title: string;
  userName: string;
  userId: string;
  xRestrict: number;
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
body { margin: 0; background: #fff; color: #1f1f1f; }
html[data-theme='dark'] body { background: #1f1f1f; color: #f5f5f5; }
header { display: flex; gap: 16px; align-items: center; padding: 12px 24px; border-bottom: 1px solid #8884; }
main { max-width: 960px; margin: 0 auto; padding: 24px; }
figure { margin: 0; display: flex; justify-content: center; background: #8882; min-height: 240px; }
figure img { max-width: 100%; height: auto; }
.r18 { align-self: center; font-weight: 700; }
.row { display: flex; align-items: center; margin-top: 32px; }
.row-start { display: flex; gap: 8px; }
.row-end { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.row button, .row a, .related button { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
.description { white-space: pre-line; }
.related { display: flex; gap: 12px; padding: 0; list-style: none; }
.related li { position: relative; width: 120px; height: 120px; background: #8883; }
.related button { position: absolute; right: 4px; bottom: 4px; width: 32px; height: 32px; }
`;

/**
 * The page script, serialized with Function.prototype.toString(); it must not reference anything
 * outside its own body.
 */
function fakePixivApp(config: FakePageConfig): void {
  const ARTWORK_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?artworks\/(\d{1,12})\/?$/;
  const USER_RE = /^\/users\/(\d+)\/?$/;
  const ICONS = {
    share:
      'M18 2a3 3 0 1 1-2.8 4L8.8 9.6a3 3 0 0 1 0 4.8l6.4 3.6A3 3 0 1 1 15 19l-6.6-3.7a3 3 0 1 1 0-6.6L15 5a3 3 0 0 1 3-3z',
    more: 'M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
    like: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm-3.5 11.5c1 1.3 2.1 2 3.5 2s2.5-.7 3.5-2',
    bookmark: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
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

  function icon(d: string): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
  }

  function spaLink(href: string, ...children: (Node | string)[]): HTMLAnchorElement {
    return el('a', { href, 'data-spa': '' }, ...children);
  }

  function buildRow(work: CatalogEntry): HTMLElement {
    return el(
      'section',
      { class: 'row' },
      el(
        'div',
        { class: 'row-start' },
        el('button', { type: 'button', 'aria-label': 'Share' }, icon(ICONS.share)),
        el('button', { type: 'button', 'aria-label': 'More' }, icon(ICONS.more)),
      ),
      el(
        'div',
        { class: 'row-end' },
        el('button', { type: 'button', 'aria-label': 'Like' }, icon(ICONS.like)),
        el(
          'a',
          {
            href: `/bookmark_add.php?type=illust&illust_id=${work.id}`,
            role: 'button',
            'aria-label': 'Bookmark',
          },
          icon(ICONS.bookmark),
        ),
      ),
    );
  }

  function insertRow(seq: number): void {
    if (seq !== renderSeq || rowRemoved || row || !slot || !current) return;
    row = buildRow(current);
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

  function relatedWorks(work: CatalogEntry): HTMLElement {
    const others = Object.values(config.works)
      .filter((other) => other.id !== work.id)
      .slice(0, 3);
    return el(
      'ul',
      { class: 'related', 'aria-label': 'Related works' },
      ...others.map((other) =>
        el(
          'li',
          {},
          spaLink(`/artworks/${other.id}`, other.title),
          el('button', { type: 'button', 'aria-label': 'Bookmark' }, icon(ICONS.bookmark)),
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
    const figure = el(
      'figure',
      {},
      wall || !work.master
        ? el('div', { class: 'r18' }, wall ? 'R-18' : '')
        : el('img', {
            src: work.master,
            alt: work.title,
            width: String(work.width),
            height: String(work.height),
          }),
    );
    slot = el('div', {});
    root.replaceChildren(
      el(
        'section',
        {},
        figure,
        slot,
        el('h1', {}, work.title),
        el('p', { class: 'description' }, descriptionText(work.description)),
        el('p', {}, ...work.tags.map((tag) => `#${tag} `)),
        el('p', {}, spaLink(`/users/${work.userId}`, work.userName)),
        relatedWorks(work),
      ),
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
      const fresh = buildRow(current);
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
  // pixiv embeds its state in an inline data script; the extension reads `"isLoggedIn":` from it.
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
