// @vitest-environment happy-dom
// Placement on the e2e fake page (e2e/server/page.ts), driven by its own page script and
// window.__fake controls. happy-dom has no layout, so boxes are stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CatalogEntry,
  fakePixivApp,
  type FakeWindow,
  ROW_DELAY_MS,
  ROW_MARK,
  wwwPage,
} from '../../../e2e/server/page';
import { createMount, HOST_TAG, type Mount, type MountMode } from '../../../src/content/mount';
import { FLOAT_FALLBACK_MS, FLOAT_PLACEMENT_BUDGET_MS } from '../../../src/shared/constants';

const ID = '135882741';
const WORK: CatalogEntry = {
  id: ID,
  title: '雨上がりの渋谷',
  userName: 'みずき',
  userId: '40285173',
  xRestrict: 0,
  pageCount: 12,
  description: '',
  tags: [],
  master: 'https://i.pximg.net/img-master/img/2026/09/28/21/14/00/135882741_p0_master1200.jpg',
  width: 120,
  height: 170,
  pageTitle: '雨上がりの渋谷 - みずきのイラスト - pixiv',
};
/** The artwork figure's box: right edge 804, bottom edge 450. */
const AREA = new DOMRect(100, 50, 704, 400);
const HOST_WIDTH = 164;
/** The fallback timer fires the placement budget before the PRD's 3 s (system.md D14). */
const FALLBACK_TIMER_MS = FLOAT_FALLBACK_MS - FLOAT_PLACEMENT_BUDGET_MS;

let host: HTMLElement;
let mount: Mount;
let onPlaced: ReturnType<typeof vi.fn<(mode: MountMode) => void>>;
let onMutation: ReturnType<typeof vi.fn<() => void>>;
let area: DOMRect;

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

/** The fake artwork page, rendered by its own page script; the row arrives after ROW_DELAY_MS. */
function loadFakePage(): void {
  const works = { [ID]: WORK };
  const html = wwwPage({ title: WORK.pageTitle, loggedIn: false, illustId: ID, works });
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelector('script:not([type])')?.remove();
  loadDocument(parsed);
  history.pushState(null, '', `/artworks/${ID}`);
  fakePixivApp({ loggedIn: false, works, rowDelayMs: ROW_DELAY_MS, rowMark: ROW_MARK });
  if (document.readyState !== 'complete') window.dispatchEvent(new Event('load'));
}

function fake(): FakeWindow['__fake'] {
  return (window as unknown as FakeWindow).__fake;
}

function row(): HTMLElement | null {
  return document.querySelector('section.row');
}

function like(): Element | null {
  return document.querySelector('section.row > .like');
}

function hosts(): Element[] {
  return Array.from(document.getElementsByTagName(HOST_TAG));
}

/** Lets the MutationObserver microtask and the next animation frame run. */
async function frame(): Promise<void> {
  await vi.advanceTimersByTimeAsync(20);
}

async function afterRowDelay(): Promise<void> {
  await vi.advanceTimersByTimeAsync(ROW_DELAY_MS);
  await frame();
}

beforeEach(() => {
  vi.useFakeTimers();
  // Placement-mode logging (debug in the row, warn when floating).
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  area = AREA;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.localName === HOST_TAG) return new DOMRect(0, 0, HOST_WIDTH, 40);
    if (this.matches('figure.work-figure')) return area;
    return new DOMRect(0, 0, 704, 48);
  });
  loadFakePage();
  host = document.createElement(HOST_TAG);
  onPlaced = vi.fn<(mode: MountMode) => void>();
  onMutation = vi.fn<() => void>();
  mount = createMount({ host, artworkId: () => ID, onMutation, onPlaced });
});

afterEach(() => {
  mount.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('mount: action row', () => {
  it('mount: places the host right after the like wrapper in pixiv’s mirrored row', async () => {
    mount.show();
    await afterRowDelay();
    expect([host.parentElement, host.previousElementSibling]).toEqual([row(), like()]);
  });

  it('mount: places the host right before the like wrapper in a row-direction row', async () => {
    await afterRowDelay();
    row()?.style.setProperty('flex-direction', 'row');
    mount.show();
    await frame();
    expect([host.parentElement, host.nextElementSibling]).toEqual([row(), like()]);
  });

  it('mount: marks the host data-mode="row"', async () => {
    mount.show();
    await afterRowDelay();
    expect(host.getAttribute('data-mode')).toBe('row');
  });

  it('mount: copies the like wrapper’s margin when the row has no flex gap', async () => {
    mount.show();
    await afterRowDelay();
    expect(host.style.marginRight).toBe('20px');
  });

  it('mount: adds no margins when the row uses a flex gap', async () => {
    await afterRowDelay();
    row()?.style.setProperty('column-gap', '12px');
    mount.show();
    await frame();
    expect(host.style.marginRight).toBe('');
  });

  it('mount: calls onPlaced("row") once the host is in the row', async () => {
    mount.show();
    await afterRowDelay();
    expect(onPlaced.mock.calls).toEqual([['row']]);
  });

  it('mount: waits for the row instead of placing the host elsewhere', async () => {
    mount.show();
    await frame();
    expect(host.isConnected).toBe(false);
  });

  it('mount: removes any other <hfp-download> (single-host invariant)', async () => {
    mount.show();
    await afterRowDelay();
    document.body.append(document.createElement(HOST_TAG));
    await frame();
    expect(hosts()).toEqual([host]);
  });

  it('mount: re-inserts the host into a re-rendered row within a frame', async () => {
    mount.show();
    await afterRowDelay();
    const old = row();
    fake().rerenderRow();
    await frame();
    expect([host.parentElement !== old, host.parentElement, host.previousElementSibling]).toEqual([
      true,
      row(),
      like(),
    ]);
  });

  it('mount: never duplicates the host across re-renders', async () => {
    mount.show();
    await afterRowDelay();
    for (let i = 0; i < 3; i++) {
      fake().rerenderRow();
      await frame();
    }
    expect(hosts()).toEqual([host]);
  });

  it('mount: hide() removes the host', async () => {
    mount.show();
    await afterRowDelay();
    mount.hide();
    expect(host.isConnected).toBe(false);
  });

  it('mount: a hidden host is not put back by later re-renders', async () => {
    mount.show();
    await afterRowDelay();
    mount.hide();
    fake().rerenderRow();
    await frame();
    expect(host.isConnected).toBe(false);
  });
});

describe('mount: floating fallback', () => {
  it('mount: the fallback timer fires at 2750 ms, the 250 ms placement budget before 3 s', () => {
    expect([FALLBACK_TIMER_MS, FLOAT_FALLBACK_MS]).toEqual([2750, 3000]);
  });

  it('mount: not floating 1 ms before the fallback timer (2749 ms)', async () => {
    fake().removeRow();
    mount.show();
    await vi.advanceTimersByTimeAsync(FALLBACK_TIMER_MS - 1);
    expect(host.isConnected).toBe(false);
  });

  it('mount: at 2750 ms the host is in body and positioned before any animation frame runs', async () => {
    fake().removeRow();
    mount.show();
    await vi.advanceTimersByTimeAsync(FALLBACK_TIMER_MS - 1);
    const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    let placed: unknown[];
    try {
      await vi.advanceTimersByTimeAsync(1);
      placed = [
        host.parentElement,
        host.getAttribute('data-mode'),
        host.style.left,
        host.style.top,
      ];
    } finally {
      frames.mockRestore();
    }
    // left = 804 − 16 − 164, top = 450 − 16 − 40
    expect(placed).toEqual([document.body, 'floating', '624px', '394px']);
  });

  it('mount: floats over the artwork FLOAT_FALLBACK_MS after show() without a row', async () => {
    fake().removeRow();
    mount.show();
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    expect([host.parentElement, host.getAttribute('data-mode'), host.style.position]).toEqual([
      document.body,
      'floating',
      'fixed',
    ]);
  });

  it('mount: floating sits 16 px inside the artwork’s bottom-right corner', async () => {
    fake().removeRow();
    mount.show();
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    // left = 804 − 16 − 164, top = 450 − 16 − 40
    expect([host.style.left, host.style.top]).toEqual(['624px', '394px']);
  });

  it('mount: floating stays above pixiv’s UI', async () => {
    fake().removeRow();
    mount.show();
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    expect(host.style.zIndex).toBe('2147483000');
  });

  it('mount: warns once when the floating fallback engages (redesign signal)', async () => {
    fake().removeRow();
    mount.show();
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    document.body.append(document.createElement('div'));
    await frame();
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('mount: calls onPlaced("floating") before positioning', async () => {
    fake().removeRow();
    mount.show();
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    expect(onPlaced.mock.calls).toEqual([['floating']]);
  });

  it('mount: follows the artwork on scroll', async () => {
    fake().removeRow();
    mount.show();
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    area = new DOMRect(100, -50, 704, 400);
    window.dispatchEvent(new Event('scroll'));
    await frame();
    expect(host.style.top).toBe('294px');
  });

  it('mount: floats at once when the row disappears after FLOAT_FALLBACK_MS', async () => {
    mount.show();
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    fake().removeRow();
    await frame();
    expect(host.getAttribute('data-mode')).toBe('floating');
  });

  it('mount: a row lost before FLOAT_FALLBACK_MS floats when the time is up', async () => {
    mount.show();
    await afterRowDelay();
    fake().removeRow();
    await frame();
    const before = host.isConnected;
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    expect([before, host.getAttribute('data-mode')]).toEqual([false, 'floating']);
  });

  it('mount: moves back into the row when it appears later', async () => {
    fake().removeRow();
    mount.show();
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    fake().restoreRow();
    await frame();
    expect([host.parentElement, host.getAttribute('data-mode')]).toEqual([row(), 'row']);
  });

  it('mount: clears the floating styles back in the row', async () => {
    fake().removeRow();
    mount.show();
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    fake().restoreRow();
    await frame();
    expect([host.style.position, host.style.left, host.style.top]).toEqual(['', '', '']);
  });

  it('mount: viewport mode 24 px from the corner without an artwork area', async () => {
    fake().removeRow();
    document.querySelector('figure.work-figure')?.remove();
    mount.show();
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    expect([host.getAttribute('data-mode'), host.style.right, host.style.bottom]).toEqual([
      'viewport',
      '24px',
      '24px',
    ]);
  });

  it('mount: viewport mode when the artwork area has no box', async () => {
    fake().removeRow();
    area = new DOMRect(0, 0, 0, 0);
    mount.show();
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    expect(host.getAttribute('data-mode')).toBe('viewport');
  });

  it('mount: hide() cancels the fallback timer', async () => {
    fake().removeRow();
    mount.show();
    mount.hide();
    await vi.advanceTimersByTimeAsync(FLOAT_FALLBACK_MS);
    expect(host.isConnected).toBe(false);
  });

  it('mount: show() restarts the fallback timer (SPA navigation)', async () => {
    fake().removeRow();
    mount.show();
    await vi.advanceTimersByTimeAsync(FALLBACK_TIMER_MS - 100);
    mount.hide();
    mount.show();
    await vi.advanceTimersByTimeAsync(FALLBACK_TIMER_MS - 1);
    expect(host.isConnected).toBe(false);
  });

  it('mount: after hide() and show() the host floats 2750 ms after the new show()', async () => {
    fake().removeRow();
    mount.show();
    await vi.advanceTimersByTimeAsync(FALLBACK_TIMER_MS - 100);
    mount.hide();
    mount.show();
    await vi.advanceTimersByTimeAsync(FALLBACK_TIMER_MS);
    expect(host.getAttribute('data-mode')).toBe('floating');
  });
});

describe('mount: observer', () => {
  it('mount: every mutation batch runs onMutation, also while hidden', async () => {
    document.body.append(document.createElement('div'));
    await frame();
    expect(onMutation).toHaveBeenCalled();
  });

  it('mount: destroy() disconnects the observer', async () => {
    mount.destroy();
    document.body.append(document.createElement('div'));
    await frame();
    expect(onMutation).not.toHaveBeenCalled();
  });

  it('mount: destroy() removes the host', async () => {
    mount.show();
    await afterRowDelay();
    mount.destroy();
    expect(host.isConnected).toBe(false);
  });
});
