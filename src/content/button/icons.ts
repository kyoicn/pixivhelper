// Button glyphs as compile-time constant SVG markup, copied from the mocks (cuj-1-*, cuj-5-retry).
// This is the only module allowed to use innerHTML (system.md §11.1): nothing here is ever built
// from data.

export type IconName = 'download' | 'check' | 'x' | 'warning';
/** An icon, or the progress ring (its arc is set by the view after insertion). */
export type Glyph = IconName | 'ring';

const SVG_OPEN =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false"';

const GLYPHS: Readonly<Record<Glyph, string>> = {
  download: `${SVG_OPEN} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/></svg>`,
  check: `${SVG_OPEN} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
  x: `${SVG_OPEN} stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  warning: `${SVG_OPEN} stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".9" fill="currentColor"/></svg>`,
  // r = 8 must match RING_RADIUS in styles.ts.
  ring: '<svg class="ring" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke-width="2.5" aria-hidden="true" focusable="false"><circle class="track" cx="10" cy="10" r="8"/><circle class="bar" cx="10" cy="10" r="8"/></svg>',
};

/** Replaces the content of `el` with `glyph`'s constant markup, or empties it for `null`. */
export function setGlyph(el: Element, glyph: Glyph | null): void {
  el.innerHTML = glyph === null ? '' : GLYPHS[glyph];
}
