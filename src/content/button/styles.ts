// The button's shadow-root stylesheet: PRD §4.7.2–4.7.4 geometry, colors and motion, matched to
// the mocks (design-artwork-button.md "View, styles, interaction").

/** Progress ring radius in the ring's 20 × 20 viewBox (icons.ts uses the same r). */
export const RING_RADIUS = 8;
/** `stroke-dashoffset = RING_CIRCUMFERENCE × (1 − fraction)` draws `fraction` of the ring. */
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** Share of the circle drawn by the indeterminate arc while the zip size is unknown (PRD §4.7.5). */
export const INDETERMINATE_ARC = 0.25;

export const BUTTON_CSS = `
:host {
  all: initial;
  display: inline-flex;
  flex-shrink: 0;
  vertical-align: middle;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", sans-serif;
}
[hidden] { display: none !important; }

.pill {
  appearance: none;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--hfp-width, auto);
  height: 40px;
  margin: 0;
  padding: 0 12px;
  border: none;
  border-radius: 9999px;
  background: #0096FA;
  color: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .08);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 120ms;
}
.face { display: inline-flex; align-items: center; gap: 8px; }
.icon { display: inline-flex; flex: none; width: 18px; height: 18px; }
.dot { opacity: .6; }
.hint { font-size: 13px; font-weight: 400; opacity: .85; }
.count { font-variant-numeric: tabular-nums; }

.pill.primary:hover { background: #0084DC; }
.pill.saved { background: #fff; color: #0096FA; border: 1.5px solid #0096FA; box-shadow: none; }
.pill.saved:hover { background: #e6f4fe; }
.pill.neutral { background: #fff; color: #3c4043; border: 1.5px solid #c4c7c5; box-shadow: none; }
.pill.neutral:hover { background: #f5f7f9; border-color: #8a8f94; }
.pill.error { background: #fff; color: #d93025; border: 1.5px solid #d93025; box-shadow: none; }
.pill.error:hover { background: #fdeceb; }
.pill.error .hint { opacity: 1; }
.pill.disabled { background: #f1f3f4; color: #80868b; box-shadow: none; cursor: not-allowed; }

/* Cancel face: only once armed (the pointer left after the starting click), never on focus. */
.face-cancel { display: none; }
.pill.cancel, .pill.busy.armed:hover { background: #3c4043; color: #fff; }
.pill.busy.armed:hover .face-main { display: none; }
.pill.busy.armed:hover .face-cancel { display: inline-flex; }

.pill:focus { outline: none; }
.pill:focus-visible { outline: 2px solid #0096FA; outline-offset: 3px; }
:host([data-theme="dark"]) .pill:focus-visible { outline-color: #5fb9fb; }

:host([data-mode="floating"]) .pill,
:host([data-mode="viewport"]) .pill { box-shadow: 0 2px 8px rgba(0, 0, 0, .24); }

.ring { transform: rotate(-90deg); }
.ring .track { stroke: rgba(255, 255, 255, .2); }
.ring .bar {
  stroke: #fff;
  stroke-linecap: round;
  stroke-dasharray: ${RING_CIRCUMFERENCE};
  transition: stroke-dashoffset 300ms ease;
}
.ring.indeterminate { animation: hfp-spin 1s linear infinite; }
@keyframes hfp-spin {
  from { transform: rotate(-90deg); }
  to { transform: rotate(270deg); }
}

@media (prefers-reduced-motion: reduce) {
  .pill, .pill * { transition: none !important; animation: none !important; }
}

.pill.measure {
  position: absolute;
  top: 0;
  left: -9999px;
  width: auto;
  visibility: hidden;
  pointer-events: none;
}
.sr-live {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
`;

/** A constructable stylesheet holding BUTTON_CSS, for `shadowRoot.adoptedStyleSheets`. */
export function createStyleSheet(): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(BUTTON_CSS);
  return sheet;
}
