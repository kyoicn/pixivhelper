// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ButtonState, createEntry, type Entry } from '../../../src/content/button/model';
import { RING_CIRCUMFERENCE } from '../../../src/content/button/styles';
import { type ButtonOptions, createButton } from '../../../src/content/button/view';
import type { JobProgress, WorkInfo } from '../../../src/shared/types';

const SETTINGS = { saveMetadata: true };

function work(overrides: Partial<WorkInfo> = {}): WorkInfo {
  return {
    id: '135882741',
    illustType: 0,
    xRestrict: 0,
    pageCount: 12,
    width: 1200,
    height: 1697,
    userName: 'みずき',
    userId: '40285173',
    title: '雨上がりの渋谷',
    ...overrides,
  };
}

function entry(state: ButtonState, overrides: Partial<Entry> = {}): Entry {
  return { ...createEntry('135882741'), work: work(), state, ...overrides };
}

function busy(progress: JobProgress | null, armed = false): ButtonState {
  return { s: 'busy', jobId: 'job-1', progress, startedAt: 0, armed };
}

const IDLE = entry({ s: 'idle' });
const BUSY = entry(busy({ kind: 'pages', done: 0, total: 12 }));
const REATTACHED = entry(busy({ kind: 'pages', done: 9, total: 12 }, true));

function mount(options: Partial<ButtonOptions> = {}) {
  const attachShadow = vi.spyOn(Element.prototype, 'attachShadow');
  const host = document.createElement('hfp-download');
  document.body.append(host);
  const onActivate = vi.fn();
  const handle = createButton(host, { locale: 'en', onActivate, ...options });
  const shadow = attachShadow.mock.results[0]?.value as ShadowRoot;
  attachShadow.mockRestore();
  const pill = shadow.querySelector<HTMLButtonElement>('.pill:not(.measure)');
  if (!pill) throw new Error('no pill');
  const part = (selector: string): HTMLElement => {
    const el = pill.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  };
  return { host, handle, shadow, pill, part, onActivate };
}

/**
 * Echoes the key and its substitutions, e.g. `hint_pages(12)`. The copy itself is covered in all
 * four locales by labels.test.ts: test/helpers/i18n-stub.ts cannot load the locale files under
 * happy-dom, where Vite rewrites its `new URL(…, import.meta.url)` to a server path.
 */
function echoMessage(key: string, subs?: string | string[]): string {
  const list = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
  return list.length === 0 ? key : `${key}(${list.join(',')})`;
}

beforeEach(() => {
  vi.stubGlobal('chrome', { i18n: { getMessage: echoMessage } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('createButton: structure', () => {
  it('createButton: uses a closed shadow root', () => {
    expect(mount().host.shadowRoot).toBeNull();
  });

  it('createButton: adopts the constructable stylesheet', () => {
    expect(mount().shadow.adoptedStyleSheets).toHaveLength(1);
  });

  it('createButton: holds the pill, the measurement pill and the live region', () => {
    const { shadow } = mount();
    expect(Array.from(shadow.children, (el) => el.className)).toEqual([
      'pill',
      'pill measure',
      'sr-live',
    ]);
  });

  it('createButton: the pill is a native type=button', () => {
    expect(mount().pill.type).toBe('button');
  });

  it('createButton: keeps the measurement pill out of the tab order and the a11y tree', () => {
    const measure = mount().shadow.querySelector('.measure');
    expect([measure?.getAttribute('tabindex'), measure?.getAttribute('aria-hidden')]).toEqual([
      '-1',
      'true',
    ]);
  });

  it('createButton: the live region is polite', () => {
    expect(mount().shadow.querySelector('.sr-live')?.getAttribute('aria-live')).toBe('polite');
  });

  it('createButton: keeps the pill hidden until the first render (no color transition)', () => {
    expect(mount().pill.hidden).toBe(true);
  });

  it('createButton: marks the host with the resolved locale', () => {
    expect(mount({ locale: 'ja' }).host.getAttribute('lang')).toBe('ja');
  });
});

describe('render', () => {
  it('render: reveals the pill', () => {
    const { handle, pill } = mount();
    handle.render(IDLE, SETTINGS);
    expect(pill.hidden).toBe(false);
  });

  it('render: idle shows the icon, Download, a dot and 12P', () => {
    const { handle, part } = mount();
    handle.render(IDLE, SETTINGS);
    expect([
      part('.face-main .icon svg').tagName.toLowerCase(),
      part('.face-main .label').textContent,
      part('.face-main .dot').hidden,
      part('.face-main .hint').textContent,
    ]).toEqual(['svg', 'btn_download', false, 'hint_pages(12)']);
  });

  it('render: a face without a hint hides the dot and the hint', () => {
    const { handle, part } = mount();
    handle.render(entry({ s: 'idle' }, { work: work({ pageCount: 1 }) }), SETTINGS);
    expect([part('.face-main .dot').hidden, part('.face-main .hint').hidden]).toEqual([true, true]);
  });

  it('render: needs-login has no icon', () => {
    const { handle, part } = mount();
    handle.render(entry({ s: 'needsLogin' }), SETTINGS);
    expect(part('.face-main .icon').hidden).toBe(true);
  });

  it('render: sets the accessible name', () => {
    const { handle, pill } = mount();
    handle.render(IDLE, SETTINGS);
    expect(pill.getAttribute('aria-label')).toBe('aria_idle_pages(12)');
  });

  it('render: applies the variant class', () => {
    const { handle, pill } = mount();
    handle.render(entry({ s: 'error', err: { t: 'cause', cause: 'offline' } }), SETTINGS);
    expect(pill.className).toBe('pill error');
  });

  it('render: aria-busy is true while busy', () => {
    const { handle, pill } = mount();
    handle.render(BUSY, SETTINGS);
    expect(pill.getAttribute('aria-busy')).toBe('true');
  });

  it('render: aria-busy is removed once the job ends', () => {
    const { handle, pill } = mount();
    handle.render(BUSY, SETTINGS);
    handle.render(entry({ s: 'saved', folder: 'pixiv/x-1', kind: 'pages', pages: 12 }), SETTINGS);
    expect(pill.hasAttribute('aria-busy')).toBe(false);
  });

  it('render: idle has no aria-busy', () => {
    const { handle, pill } = mount();
    handle.render(IDLE, SETTINGS);
    expect(pill.hasAttribute('aria-busy')).toBe(false);
  });

  it('render: unavailable is aria-disabled but stays focusable', () => {
    const { handle, pill } = mount();
    handle.render(entry({ s: 'unavailable' }), SETTINGS);
    expect([pill.getAttribute('aria-disabled'), pill.disabled]).toEqual(['true', false]);
  });

  it('render: aria-disabled is removed when the state changes', () => {
    const { handle, pill } = mount();
    handle.render(entry({ s: 'unavailable' }), SETTINGS);
    handle.render(IDLE, SETTINGS);
    expect(pill.hasAttribute('aria-disabled')).toBe(false);
  });

  it('render: sets the tooltip when the state has one', () => {
    const { handle, pill } = mount();
    handle.render(BUSY, SETTINGS);
    expect(pill.getAttribute('title')).toBe('tip_cancel');
  });

  it('render: idle has no tooltip', () => {
    const { handle, pill } = mount();
    handle.render(BUSY, SETTINGS);
    handle.render(IDLE, SETTINGS);
    expect(pill.hasAttribute('title')).toBe(false);
  });

  it('render: the ring draws the completed fraction from 12 o’clock', () => {
    const { handle, part } = mount();
    handle.render(entry(busy({ kind: 'pages', done: 7, total: 12 })), SETTINGS);
    expect(part('.ring .bar').style.getPropertyValue('stroke-dashoffset')).toBe(
      (RING_CIRCUMFERENCE * (1 - 7 / 12)).toFixed(3),
    );
  });

  it('render: progress updates keep the same ring element so it can animate', () => {
    const { handle, part } = mount();
    handle.render(entry(busy({ kind: 'pages', done: 6, total: 12 })), SETTINGS);
    const bar = part('.ring .bar');
    handle.render(entry(busy({ kind: 'pages', done: 7, total: 12 })), SETTINGS);
    expect(part('.ring .bar')).toBe(bar);
  });

  it('render: the indeterminate ring is a spinning 25 % arc', () => {
    const { handle, part } = mount();
    const progress: JobProgress = {
      kind: 'percent',
      percent: 0,
      phase: 'frames',
      indeterminate: true,
    };
    handle.render(entry(busy(progress), { work: work({ illustType: 2, pageCount: 1 }) }), SETTINGS);
    expect([
      part('.ring').classList.contains('indeterminate'),
      part('.ring .bar').style.getPropertyValue('stroke-dashoffset'),
    ]).toEqual([true, (RING_CIRCUMFERENCE * 0.75).toFixed(3)]);
  });

  it('render: the busy counter uses tabular digits', () => {
    const { handle, part } = mount();
    handle.render(BUSY, SETTINGS);
    expect(part('.face-main .label').classList.contains('count')).toBe(true);
  });

  it('render: busy carries the Cancel face with the x icon', () => {
    const { handle, part } = mount();
    handle.render(BUSY, SETTINGS);
    expect([
      part('.face-cancel').hidden,
      part('.face-cancel .label').textContent,
      part('.face-cancel .icon svg path').getAttribute('d'),
    ]).toEqual([false, 'btn_cancel', 'M6 6l12 12M18 6 6 18']);
  });

  it('render: the Cancel face is hidden outside busy', () => {
    const { handle, part } = mount();
    handle.render(BUSY, SETTINGS);
    handle.render(IDLE, SETTINGS);
    expect(part('.face-cancel').hidden).toBe(true);
  });

  it('render: applies the locked width', () => {
    const { handle, pill } = mount();
    handle.render({ ...IDLE, width: 164 }, SETTINGS);
    expect(pill.style.getPropertyValue('--hfp-width')).toBe('164px');
  });

  it('render: leaves the width natural until it is locked', () => {
    const { handle, pill } = mount();
    handle.render(IDLE, SETTINGS);
    expect(pill.style.getPropertyValue('--hfp-width')).toBe('');
  });
});

describe('click guard', () => {
  function startable() {
    vi.useFakeTimers();
    const ctx = mount();
    ctx.handle.render(IDLE, SETTINGS);
    // Like the content script: the starting click renders busy synchronously.
    ctx.onActivate.mockImplementationOnce(() => ctx.handle.render(BUSY, SETTINGS));
    ctx.pill.click();
    return ctx;
  }

  it('click guard: the starting click is forwarded', () => {
    expect(startable().onActivate).toHaveBeenCalledTimes(1);
  });

  it('click guard: a second click within 500 ms is swallowed', () => {
    const { pill, onActivate } = startable();
    vi.advanceTimersByTime(499);
    pill.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('click guard: a click 500 ms after the start is forwarded (cancel)', () => {
    const { pill, onActivate } = startable();
    vi.advanceTimersByTime(500);
    pill.click();
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('click guard: does not apply to a busy button shown without a click (reattach)', () => {
    vi.useFakeTimers();
    const { handle, pill, onActivate } = mount();
    handle.render(IDLE, SETTINGS);
    pill.click();
    handle.render(IDLE, SETTINGS);
    vi.advanceTimersByTime(100);
    handle.render(REATTACHED, SETTINGS);
    vi.advanceTimersByTime(100);
    pill.click();
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('click guard: never blocks clicks on a button that is not busy', () => {
    vi.useFakeTimers();
    const { handle, pill, onActivate } = mount();
    handle.render(entry({ s: 'unavailable' }), SETTINGS);
    pill.click();
    pill.click();
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
});

describe('cancel-face arming', () => {
  it('arming: the button is not armed right after the starting click', () => {
    const { handle, pill } = mount();
    handle.render(BUSY, SETTINGS);
    expect(pill.classList.contains('armed')).toBe(false);
  });

  it('arming: the first pointerleave arms the cancel face', () => {
    const { handle, pill } = mount();
    handle.render(BUSY, SETTINGS);
    pill.dispatchEvent(new PointerEvent('pointerleave'));
    expect(pill.classList.contains('armed')).toBe(true);
  });

  it('arming: progress re-renders keep the button armed', () => {
    const { handle, pill } = mount();
    handle.render(BUSY, SETTINGS);
    pill.dispatchEvent(new PointerEvent('pointerleave'));
    handle.render(entry(busy({ kind: 'pages', done: 1, total: 12 })), SETTINGS);
    expect(pill.classList.contains('armed')).toBe(true);
  });

  it('arming: a reattached job is armed at once', () => {
    const { handle, pill } = mount();
    handle.render(REATTACHED, SETTINGS);
    expect(pill.classList.contains('armed')).toBe(true);
  });

  it('arming: pointerleave outside busy does nothing', () => {
    const { handle, pill } = mount();
    handle.render(IDLE, SETTINGS);
    pill.dispatchEvent(new PointerEvent('pointerleave'));
    expect(pill.classList.contains('armed')).toBe(false);
  });

  it('arming: the next job starts unarmed again', () => {
    const { handle, pill } = mount();
    handle.render(BUSY, SETTINGS);
    pill.dispatchEvent(new PointerEvent('pointerleave'));
    handle.render(IDLE, SETTINGS);
    handle.render(BUSY, SETTINGS);
    expect(pill.classList.contains('armed')).toBe(false);
  });

  it('arming: keyboard focus does not arm the cancel face', () => {
    const { handle, pill } = mount();
    handle.render(BUSY, SETTINGS);
    pill.focus();
    expect(pill.classList.contains('armed')).toBe(false);
  });
});

describe('handle', () => {
  it('setTheme: marks the host with pixiv’s theme', () => {
    const { handle, host } = mount();
    handle.setTheme('dark');
    expect(host.getAttribute('data-theme')).toBe('dark');
  });

  it('announce: speaks through the live region', () => {
    const { handle, shadow } = mount();
    handle.announce({ kind: 'status', text: 'Downloading 12 pages' });
    expect(shadow.querySelector('.sr-live')?.textContent).toBe('Downloading 12 pages');
  });

  it('lockWidth: measures with the injected function and applies the English floor', () => {
    const { handle } = mount({ measure: () => 150 });
    expect(handle.lockWidth(IDLE)).toBe(164);
  });

  it('lockWidth: other locales use the measured width', () => {
    const { handle } = mount({ locale: 'zh-CN', measure: () => 120.5 });
    expect(handle.lockWidth(IDLE)).toBe(121);
  });

  it('lockWidth: widens once the metadata needs more room, before any click', () => {
    const widest = 'btn_progress_pages(150,150)';
    const { handle } = mount({ measure: (face) => (face.label === widest ? 190 : 150) });
    const locked = { ...createEntry('1'), width: 164 };
    expect(handle.lockWidth({ ...locked, work: work({ pageCount: 150 }) })).toBe(190);
  });

  it('lockWidth: keeps the locked width after an interaction', () => {
    const { handle } = mount({ measure: () => 190 });
    expect(handle.lockWidth({ ...IDLE, width: 164, interacted: true })).toBe(164);
  });

  it('lockWidth: never shrinks the locked width', () => {
    const { handle } = mount({ measure: () => 100 });
    expect(handle.lockWidth({ ...IDLE, width: 180 })).toBe(180);
  });

  it('lockWidth: the default probe renders each candidate in the measurement pill', () => {
    const { handle, shadow } = mount({ locale: 'ja' });
    const measureEl = shadow.querySelector('.measure');
    const rect = vi.spyOn(measureEl as Element, 'getBoundingClientRect');
    handle.lockWidth(IDLE);
    expect(rect).toHaveBeenCalledTimes(8);
  });

  it('destroy: removes the host', () => {
    const { handle, host } = mount();
    handle.destroy();
    expect(host.isConnected).toBe(false);
  });

  it('destroy: stops forwarding clicks', () => {
    const { handle, pill, onActivate } = mount();
    handle.destroy();
    pill.click();
    expect(onActivate).not.toHaveBeenCalled();
  });
});
