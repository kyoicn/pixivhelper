// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSavedIndicator, type SavedIndicator } from '../../../src/options/saved';
import { SAVED_FADE_MS, SAVED_VISIBLE_MS } from '../../../src/shared/constants';
import { stubChromeI18n } from '../../helpers/i18n-stub';

let el: HTMLSpanElement;
let indicator: SavedIndicator;

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  stubChromeI18n('en');
  stubReducedMotion(false);
  el = document.createElement('span');
  document.body.append(el);
  indicator = createSavedIndicator(el);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('createSavedIndicator', () => {
  it('flash: shows the text Saved', () => {
    indicator.flash();
    expect(el.textContent).toBe('Saved');
  });

  it('flash: shows a decorative check icon before the text', () => {
    indicator.flash();
    expect(el.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('flash: is fully visible at once', () => {
    indicator.flash();
    expect(el.style.opacity).toBe('1');
  });

  it('flash: stays visible until 2 s have passed', () => {
    indicator.flash();
    vi.advanceTimersByTime(SAVED_VISIBLE_MS - 1);
    expect(el.style.opacity).toBe('1');
  });

  it('flash: starts a 300 ms opacity fade after 2 s', () => {
    indicator.flash();
    vi.advanceTimersByTime(SAVED_VISIBLE_MS);
    expect([el.style.opacity, el.style.transition]).toEqual(['0', `opacity ${SAVED_FADE_MS}ms`]);
  });

  it('flash: keeps the text during the fade', () => {
    indicator.flash();
    vi.advanceTimersByTime(SAVED_VISIBLE_MS + SAVED_FADE_MS - 1);
    expect(el.textContent).toBe('Saved');
  });

  it('flash: clears the content when the fade ends', () => {
    indicator.flash();
    vi.advanceTimersByTime(SAVED_VISIBLE_MS + SAVED_FADE_MS);
    expect(el.childNodes).toHaveLength(0);
  });

  it('flash: under reduced motion, disappears at 2 s without a fade', () => {
    stubReducedMotion(true);
    indicator.flash();
    vi.advanceTimersByTime(SAVED_VISIBLE_MS);
    expect([el.style.opacity, el.style.transition, el.textContent]).toEqual(['0', 'none', '']);
  });

  it('flash: a second flash restarts the 2 s', () => {
    indicator.flash();
    vi.advanceTimersByTime(SAVED_VISIBLE_MS - 500);
    indicator.flash();
    vi.advanceTimersByTime(SAVED_VISIBLE_MS - 1);
    expect(el.style.opacity).toBe('1');
  });

  it('flash: a flash during the fade cancels the pending clear', () => {
    indicator.flash();
    vi.advanceTimersByTime(SAVED_VISIBLE_MS + SAVED_FADE_MS / 2);
    indicator.flash();
    vi.advanceTimersByTime(SAVED_FADE_MS);
    expect([el.style.opacity, el.textContent]).toEqual(['1', 'Saved']);
  });
});
