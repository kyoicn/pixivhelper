// @vitest-environment happy-dom
// Every pixiv-dom.ts strategy against the ENG-002 live captures (test/fixtures/pixiv/) and the e2e
// fake page (e2e/server/page.ts). happy-dom has no layout, so boxes are stubbed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CatalogEntry,
  fakePixivApp,
  type FakeWindow,
  ROW_DELAY_MS,
  ROW_MARK,
  wwwPage,
} from '../../../e2e/server/page';
import {
  detectTheme,
  findActionRow,
  findArtworkArea,
  observeTheme,
  readIsLoggedIn,
  renderedArtworkId,
} from '../../../src/content/pixiv-dom';

// Not `new URL(…, import.meta.url)`: under happy-dom, Vite rewrites that to a server path.
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/pixiv');

const LIVE = [
  { name: 'artwork-live-light.html', id: '151061734', media: 'img' },
  { name: 'artwork-live-ugoira.html', id: '151057533', media: 'canvas' },
] as const;

const FAKE_ID = '135882741';
const FAKE_WORK: CatalogEntry = {
  id: FAKE_ID,
  title: '雨上がりの渋谷',
  userName: 'みずき',
  userId: '40285173',
  xRestrict: 0,
  pageCount: 12,
  description: '',
  tags: ['オリジナル'],
  master: 'https://i.pximg.net/img-master/img/2026/09/28/21/14/00/135882741_p0_master1200.jpg',
  width: 120,
  height: 170,
  pageTitle: '雨上がりの渋谷 - みずきのイラスト - pixiv',
};
const OTHER_WORK: CatalogEntry = { ...FAKE_WORK, id: '135882742', title: '夕焼け' };

/** Replaces the global document's content (happy-dom cannot replace documentElement itself). */
function loadDocument(parsed: Document): void {
  const root = document.documentElement;
  for (const attr of Array.from(root.attributes)) root.removeAttribute(attr.name);
  for (const attr of Array.from(parsed.documentElement.attributes)) {
    root.setAttribute(attr.name, attr.value);
  }
  root.replaceChildren(
    ...Array.from(parsed.documentElement.childNodes, (node) => document.importNode(node, true)),
  );
}

function loadHtml(html: string): void {
  loadDocument(new DOMParser().parseFromString(html, 'text/html'));
}

function loadLive(name: string): void {
  loadHtml(readFileSync(path.join(FIXTURES, name), 'utf8'));
}

/**
 * The fake page's shell from wwwPage(), rendered by its own page script; with `waitForRow`, also
 * past ROW_DELAY_MS so the action row is in. Needs fake timers.
 */
function loadFake({ loggedIn = false, waitForRow = true } = {}): void {
  const works = { [FAKE_ID]: FAKE_WORK, [OTHER_WORK.id]: OTHER_WORK };
  const html = wwwPage({ title: FAKE_WORK.pageTitle, loggedIn, illustId: FAKE_ID, works });
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  // The page script runs below as a function, not as markup.
  parsed.querySelector('script:not([type])')?.remove();
  loadDocument(parsed);
  history.pushState(null, '', `/artworks/${FAKE_ID}`);
  fakePixivApp({ loggedIn, works, rowDelayMs: ROW_DELAY_MS, rowMark: ROW_MARK });
  if (document.readyState !== 'complete') window.dispatchEvent(new Event('load'));
  if (waitForRow) vi.advanceTimersByTime(ROW_DELAY_MS);
}

function fake(): FakeWindow['__fake'] {
  return (window as unknown as FakeWindow).__fake;
}

/** Every element gets a 704 × 48 box, except those in `empty`. */
function stubBoxes(empty: Element[] = []): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return empty.includes(this) ? new DOMRect(0, 0, 0, 0) : new DOMRect(0, 0, 704, 48);
  });
}

function rowSection(): HTMLElement {
  const share = document.querySelector('main section button[aria-haspopup="true"]');
  const section = share?.closest('section');
  if (!section) throw new Error('no action row in the page');
  return section;
}

function flushObservers(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

beforeEach(() => {
  stubBoxes();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  loadHtml('<html><head></head><body></body></html>');
});

describe.each(LIVE)('live capture $name', ({ name, id, media }) => {
  beforeEach(() => loadLive(name));

  it('findActionRow: the icon+label strategy finds the like wrapper in the row', () => {
    const hit = findActionRow(document);
    expect([hit?.group, hit?.like, hit?.via]).toEqual([
      rowSection(),
      rowSection().lastElementChild,
      'icon+label',
    ]);
  });

  it('findActionRow: the like wrapper holds the button with the text label', () => {
    expect(findActionRow(document)?.like.querySelector('button > span')?.textContent).toBe('Like');
  });

  it('findActionRow: the svg-signature strategy finds the like once the label is gone', () => {
    rowSection().querySelector('button > span')?.remove();
    const hit = findActionRow(document);
    expect([hit?.like, hit?.via]).toEqual([rowSection().lastElementChild, 'svg-signature']);
  });

  it('findActionRow: side is before without pixiv CSS (row direction)', () => {
    expect(findActionRow(document)?.side).toBe('before');
  });

  it('findActionRow: side is after in the live row-reverse layout', () => {
    rowSection().style.flexDirection = 'row-reverse';
    expect(findActionRow(document)?.side).toBe('after');
  });

  it('findActionRow: the matched row follows the artwork figure', () => {
    const figure = findArtworkArea(document);
    const row = findActionRow(document)?.group;
    expect(row && figure?.compareDocumentPosition(row)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('findActionRow: thumbnails’ bookmark mini-buttons never qualify', () => {
    rowSection().remove();
    expect(findActionRow(document)).toBeNull();
  });

  it('findActionRow: a row without a second control is rejected', () => {
    const row = rowSection();
    for (const wrapper of Array.from(row.children).slice(0, -1)) wrapper.remove();
    expect(findActionRow(document)).toBeNull();
  });

  it('findActionRow: a row with an empty box is rejected', () => {
    vi.restoreAllMocks();
    stubBoxes([rowSection()]);
    expect(findActionRow(document)).toBeNull();
  });

  it('findActionRow: matches when the rendered work is the route’s artwork', () => {
    expect(findActionRow(document, id)?.group).toBe(rowSection());
  });

  it('findActionRow: refuses a column still showing another artwork', () => {
    expect(findActionRow(document, '1')).toBeNull();
  });

  it('renderedArtworkId: reads the figcaption’s illust/<id> marker', () => {
    expect(renderedArtworkId(document)).toBe(id);
  });

  it(`findArtworkArea: the artwork figure (holding the ${media}), not a thumbnail`, () => {
    const area = findArtworkArea(document);
    expect([area?.localName, area?.closest('a'), area?.querySelector(media) !== null]).toEqual([
      'figure',
      null,
      true,
    ]);
  });

  it('readIsLoggedIn: __NEXT_DATA__ says logged out', () => {
    expect(readIsLoggedIn(document)).toBe(false);
  });

  it('detectTheme: <html data-theme="light">', () => {
    expect(detectTheme(document)).toBe('light');
  });
});

describe('fake page (e2e/server/page.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('fake page: findActionRow finds the like wrapper via icon+label', () => {
    loadFake();
    const hit = findActionRow(document, FAKE_ID);
    expect([hit?.group, hit?.like, hit?.via]).toEqual([
      document.querySelector('section.row'),
      document.querySelector('section.row > .like'),
      'icon+label',
    ]);
  });

  it('fake page: the row is mirrored like pixiv’s, so the host goes after the like', () => {
    loadFake();
    expect(findActionRow(document, FAKE_ID)?.side).toBe('after');
  });

  it('fake page: the svg-signature strategy also matches', () => {
    loadFake();
    document.querySelector('section.row > .like span')?.remove();
    expect(findActionRow(document, FAKE_ID)?.via).toBe('svg-signature');
  });

  it('fake page: no row before ROW_DELAY_MS', () => {
    loadFake({ waitForRow: false });
    expect(findActionRow(document, FAKE_ID)).toBeNull();
  });

  it('fake page: findActionRow follows __fake.rerenderRow()', () => {
    loadFake();
    fake().rerenderRow();
    expect(findActionRow(document, FAKE_ID)?.group).toBe(document.querySelector('section.row'));
  });

  it('fake page: no row after __fake.removeRow()', () => {
    loadFake();
    fake().removeRow();
    expect(findActionRow(document, FAKE_ID)).toBeNull();
  });

  it('fake page: thumbnails’ bookmark mini-buttons never qualify', () => {
    loadFake();
    document.querySelector('section.row')?.remove();
    expect(findActionRow(document, FAKE_ID)).toBeNull();
  });

  it('fake page: findArtworkArea is the artwork figure, not a thumbnail', () => {
    loadFake();
    expect(findArtworkArea(document)).toBe(document.querySelector('figure.work-figure'));
  });

  it('fake page: renderedArtworkId is the route’s artwork', () => {
    loadFake();
    expect(renderedArtworkId(document)).toBe(FAKE_ID);
  });

  it('fake page: readIsLoggedIn is false logged out', () => {
    loadFake({ loggedIn: false });
    expect(readIsLoggedIn(document)).toBe(false);
  });

  it('fake page: readIsLoggedIn is true logged in', () => {
    loadFake({ loggedIn: true });
    expect(readIsLoggedIn(document)).toBe(true);
  });

  it('fake page: detectTheme follows __fake.setTheme()', () => {
    loadFake();
    fake().setTheme('dark');
    expect(detectTheme(document)).toBe('dark');
  });
});

describe('readIsLoggedIn', () => {
  function page(...scripts: string[]): void {
    loadHtml(`<html><head></head><body><main></main>${scripts.join('')}</body></html>`);
  }
  const nextData = (json: string) =>
    `<script id="__NEXT_DATA__" type="application/json">${json}</script>`;

  it('readIsLoggedIn: __NEXT_DATA__ props.pageProps.isLoggedIn true', () => {
    page(nextData('{"props":{"pageProps":{"isLoggedIn":true}}}'));
    expect(readIsLoggedIn(document)).toBe(true);
  });

  it('readIsLoggedIn: falls back to the inline theme bootstrap script', () => {
    page(
      nextData('{"props":{"pageProps":{}}}'),
      '<script>(function f(a){})({"isLoggedIn":false,"localStorageKey":"theme"});</script>',
    );
    expect(readIsLoggedIn(document)).toBe(false);
  });

  it('readIsLoggedIn: falls back when __NEXT_DATA__ is not JSON', () => {
    page(nextData('{oops'), '<script>({"isLoggedIn" : true})</script>');
    expect(readIsLoggedIn(document)).toBe(true);
  });

  it('readIsLoggedIn: ignores external scripts', () => {
    // A non-JS type keeps happy-dom from fetching the src.
    page('<script src="/x.json" type="application/json">"isLoggedIn":true</script>');
    expect(readIsLoggedIn(document)).toBeNull();
  });

  it('readIsLoggedIn: null without any marker', () => {
    page();
    expect(readIsLoggedIn(document)).toBeNull();
  });
});

describe('detectTheme and observeTheme', () => {
  function page(htmlAttrs: string, bodyStyle = ''): void {
    loadHtml(`<html ${htmlAttrs}><head></head><body style="${bodyStyle}"></body></html>`);
  }

  it('detectTheme: <html data-theme="dark">', () => {
    page('data-theme="dark"');
    expect(detectTheme(document)).toBe('dark');
  });

  it('detectTheme: without a marker, a dark body background is dark', () => {
    page('', 'background-color: rgb(31, 31, 31)');
    expect(detectTheme(document)).toBe('dark');
  });

  it('detectTheme: without a marker, a light body background is light', () => {
    page('', 'background-color: rgb(245, 245, 245)');
    expect(detectTheme(document)).toBe('light');
  });

  it('detectTheme: without a marker, a transparent body background is light', () => {
    page('', 'background-color: rgba(0, 0, 0, 0)');
    expect(detectTheme(document)).toBe('light');
  });

  it('detectTheme: an unknown marker value falls back to the background', () => {
    page('data-theme="default"', 'background-color: rgb(0, 0, 0)');
    expect(detectTheme(document)).toBe('dark');
  });

  it('observeTheme: reports a data-theme change once', async () => {
    page('data-theme="light"');
    const cb = vi.fn();
    observeTheme(document, cb);
    document.documentElement.setAttribute('data-theme', 'dark');
    await flushObservers();
    document.documentElement.setAttribute('data-theme', 'dark');
    await flushObservers();
    expect(cb.mock.calls).toEqual([['dark']]);
  });

  it('observeTheme: stops after the returned disconnect', async () => {
    page('data-theme="light"');
    const cb = vi.fn();
    observeTheme(document, cb)();
    document.documentElement.setAttribute('data-theme', 'dark');
    await flushObservers();
    expect(cb).not.toHaveBeenCalled();
  });
});
