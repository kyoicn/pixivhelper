// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveRegion } from '../../../src/content/button/live-region';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createLiveRegion', () => {
  it('createLiveRegion: is a polite status region', () => {
    const { el } = createLiveRegion();
    expect([el.getAttribute('role'), el.getAttribute('aria-live')]).toEqual(['status', 'polite']);
  });

  it('createLiveRegion: replaces the text instead of appending', () => {
    const live = createLiveRegion();
    live.announce({ kind: 'status', text: 'Downloading 12 pages' });
    live.announce({ kind: 'status', text: 'Download cancelled' });
    expect(live.el.textContent).toBe('Download cancelled');
  });

  it('createLiveRegion: drops progress within 5 s of the last announcement', () => {
    const live = createLiveRegion();
    live.announce({ kind: 'status', text: 'Downloading 12 pages' });
    vi.advanceTimersByTime(4999);
    expect(live.announce({ kind: 'progress', text: '3 of 12 pages saved' })).toBe(false);
  });

  it('createLiveRegion: keeps the earlier text when progress is dropped', () => {
    const live = createLiveRegion();
    live.announce({ kind: 'status', text: 'Downloading 12 pages' });
    vi.advanceTimersByTime(1000);
    live.announce({ kind: 'progress', text: '3 of 12 pages saved' });
    expect(live.el.textContent).toBe('Downloading 12 pages');
  });

  it('createLiveRegion: speaks progress again once 5 s have passed', () => {
    const live = createLiveRegion();
    live.announce({ kind: 'status', text: 'Downloading 12 pages' });
    vi.advanceTimersByTime(5000);
    live.announce({ kind: 'progress', text: '7 of 12 pages saved' });
    expect(live.el.textContent).toBe('7 of 12 pages saved');
  });

  it('createLiveRegion: throttles progress against the previous progress message', () => {
    const live = createLiveRegion();
    live.announce({ kind: 'progress', text: '1 of 12 pages saved' });
    vi.advanceTimersByTime(3000);
    live.announce({ kind: 'progress', text: '4 of 12 pages saved' });
    vi.advanceTimersByTime(2000);
    live.announce({ kind: 'progress', text: '7 of 12 pages saved' });
    expect(live.el.textContent).toBe('7 of 12 pages saved');
  });

  it('createLiveRegion: always speaks the end state, even right after progress', () => {
    const live = createLiveRegion();
    live.announce({ kind: 'progress', text: '11 of 12 pages saved' });
    vi.advanceTimersByTime(100);
    live.announce({ kind: 'status', text: 'Saved 12 pages' });
    expect(live.el.textContent).toBe('Saved 12 pages');
  });
});
