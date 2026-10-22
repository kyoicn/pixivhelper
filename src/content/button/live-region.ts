// Polite live region for the button's announcements (PRD §4.7.7; design-artwork-button.md
// "Live region"): starts and ends are always spoken, progress at most once per 5 s.

import { LIVE_PROGRESS_THROTTLE_MS } from '../../shared/constants';
import { h } from '../../shared/dom';

export interface Announcement {
  /** `progress` messages are throttled; `status` messages (job start and end) never are. */
  kind: 'status' | 'progress';
  text: string;
}

export interface LiveRegion {
  /** The visually hidden `role="status"` element to place in the shadow root. */
  el: HTMLDivElement;
  /** Replaces the region's text with `a.text`. Returns false when a progress message is dropped. */
  announce(a: Announcement): boolean;
}

export function createLiveRegion(): LiveRegion {
  const el = h('div', { class: 'sr-live', role: 'status', 'aria-live': 'polite' });
  // Any announcement restarts the window, so the first progress message cannot cut off the start.
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    el,
    announce(a) {
      const now = performance.now();
      if (a.kind === 'progress' && now - lastAt < LIVE_PROGRESS_THROTTLE_MS) return false;
      lastAt = now;
      el.textContent = a.text;
      return true;
    },
  };
}
