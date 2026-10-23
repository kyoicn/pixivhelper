// The Download button's DOM (design-artwork-button.md "View, styles, interaction"): a closed
// shadow root holding the pill, a hidden measurement pill and the live region. It renders
// Presentations and owns the pointer-level interaction (click guard, cancel-face arming); the
// content script (task 3.4) owns the Entry and decides what an activation does.

import { CLICK_GUARD_MS } from '../../shared/constants';
import { h } from '../../shared/dom';
import type { LocaleTag } from '../../shared/i18n';
import type { Settings } from '../../shared/types';
import { type Glyph, setGlyph } from './icons';
import { type Face, present, type Ring } from './labels';
import { type Announcement, createLiveRegion } from './live-region';
import type { Entry } from './model';
import { createStyleSheet, INDETERMINATE_ARC, RING_CIRCUMFERENCE } from './styles';
import { computeWidth, type Measure, settleWidth } from './width';

export type Theme = 'light' | 'dark';

export interface ButtonOptions {
  /** Resolved UI locale (`localeTag()`): the host's `lang` and the width floor. */
  locale: LocaleTag;
  /**
   * Called for each click, Enter or Space on the pill, except clicks on a busy pill within
   * CLICK_GUARD_MS of the click that started the job. Run `clickAction()` and `reduce()` here and
   * re-render synchronously.
   */
  onActivate: () => void;
  /** Width probe for a face; defaults to rendering it into the hidden measurement pill. */
  measure?: Measure;
}

export interface ButtonHandle {
  /** Shows `entry` (state, hint, aria, title) at its locked width (`entry.width`). */
  render(entry: Entry, settings: Pick<Settings, 'saveMetadata'>): void;
  /**
   * Measures every face `entry.work` allows and returns the width to store in `entry.width`:
   * the first call locks it, a later wider value is taken only while `entry.interacted` is false,
   * and it never shrinks. Call after `document.fonts.ready`, at first render and again when the
   * metadata arrives.
   */
  lockWidth(entry: Entry): number;
  /** pixiv's theme: switches the focus-ring color (PRD §4.7.4). */
  setTheme(theme: Theme): void;
  /** Speaks `a` through the polite live region (progress throttled to once per 5 s). */
  announce(a: Announcement): void;
  /** Removes listeners and the host element. The handle must not be used afterwards. */
  destroy(): void;
}

interface FaceView {
  el: HTMLSpanElement;
  icon: HTMLSpanElement;
  label: HTMLSpanElement;
  dot: HTMLSpanElement;
  hint: HTMLSpanElement;
  glyph: Glyph | null;
}

/**
 * Mounts the button into `host` (an `<hfp-download>` element) with a closed shadow root.
 * Placement, the `data-mode` attribute and the host's position stay with the caller.
 *
 * @example
 * const button = createButton(host, {
 *   locale,
 *   onActivate() {
 *     const now = performance.now();
 *     const action = clickAction(entry, now, location.href, loggedIn);
 *     show(reduce(entry, { type: 'click', now })); // render (and announce) synchronously
 *     run(action); // job/start · job/cancel · location.assign(url) · nothing
 *   },
 * });
 * // show(next): button.render(next, settings); then, if announcementFor(prev.state, next)
 * // returns a message, button.announce(it).
 */
export function createButton(host: HTMLElement, options: ButtonOptions): ButtonHandle {
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.adoptedStyleSheets = [createStyleSheet()];

  const main = createFace('face face-main');
  const cancel = createFace('face face-cancel');
  // Hidden until the first render, so the first state appears without a color transition.
  const pill = h(
    'button',
    { type: 'button', class: 'pill', part: 'button', hidden: true },
    main.el,
    cancel.el,
  );
  const probe = createFace('face face-main');
  const measureEl = h(
    'button',
    { type: 'button', class: 'pill measure', tabindex: -1, 'aria-hidden': 'true' },
    probe.el,
  );
  const live = createLiveRegion();
  shadow.append(pill, measureEl, live.el);
  host.setAttribute('lang', options.locale);

  const measure: Measure =
    options.measure ??
    ((face) => {
      measureEl.className = `pill measure ${face.variant}`;
      paintFace(probe, face);
      return measureEl.getBoundingClientRect().width;
    });

  let busy = false;
  let armed = false;
  let activatedAt = Number.NEGATIVE_INFINITY;
  let guardUntil = Number.NEGATIVE_INFINITY;

  const onClick = (): void => {
    const now = performance.now();
    if (busy && now < guardUntil) return;
    activatedAt = now;
    options.onActivate();
  };
  const onPointerLeave = (): void => {
    if (!busy || armed) return;
    armed = true;
    pill.classList.add('armed');
  };
  pill.addEventListener('click', onClick);
  pill.addEventListener('pointerleave', onPointerLeave);

  return {
    render(entry, settings) {
      const p = present(entry, settings);
      if (p.ariaBusy && !busy) {
        // The model starts a job unarmed only on the click that started it (a reattached job is
        // armed), so that is when the double-click guard and the arming apply.
        armed = p.armed ?? true;
        guardUntil = armed ? Number.NEGATIVE_INFINITY : activatedAt + CLICK_GUARD_MS;
      }
      busy = p.ariaBusy;

      pill.className = `pill ${p.variant}`;
      pill.classList.toggle('busy', busy);
      pill.classList.toggle('armed', busy && armed);
      setOptionalAttr(pill, 'aria-busy', p.ariaBusy ? 'true' : null);
      setOptionalAttr(pill, 'aria-disabled', p.ariaDisabled ? 'true' : null);
      setOptionalAttr(pill, 'title', p.title ?? null);
      pill.setAttribute('aria-label', p.ariaLabel);
      if (entry.width === null) pill.style.removeProperty('--hfp-width');
      else pill.style.setProperty('--hfp-width', `${entry.width}px`);

      paintFace(main, p);
      cancel.el.hidden = p.cancelFace === undefined;
      if (p.cancelFace) paintFace(cancel, p.cancelFace);
      pill.hidden = false;
    },
    lockWidth(entry) {
      const computed = computeWidth(entry.work, options.locale, measure);
      return settleWidth(entry.width, computed, entry.interacted);
    },
    setTheme(theme) {
      host.setAttribute('data-theme', theme);
    },
    announce(a) {
      live.announce(a);
    },
    destroy() {
      pill.removeEventListener('click', onClick);
      pill.removeEventListener('pointerleave', onPointerLeave);
      shadow.replaceChildren();
      host.remove();
    },
  };
}

function createFace(className: string): FaceView {
  const icon = h('span', { class: 'icon', 'aria-hidden': 'true' });
  const label = h('span', { class: 'label' });
  const dot = h('span', { class: 'dot', 'aria-hidden': 'true' }, '·');
  const hint = h('span', { class: 'hint' });
  const el = h('span', { class: className }, icon, label, dot, hint);
  return { el, icon, label, dot, hint, glyph: null };
}

function paintFace(view: FaceView, face: Face): void {
  const glyph: Glyph | null = face.ring ? 'ring' : face.icon;
  // Replace the glyph only when it changes, so ring updates animate on the same element.
  if (glyph !== view.glyph) {
    setGlyph(view.icon, glyph);
    view.glyph = glyph;
  }
  view.icon.hidden = glyph === null;
  if (face.ring) paintRing(view.icon, face.ring);

  view.label.textContent = face.label;
  view.label.classList.toggle('count', face.ring !== undefined);
  view.dot.hidden = face.hint === undefined;
  view.hint.hidden = face.hint === undefined;
  view.hint.textContent = face.hint ?? '';
}

function paintRing(icon: HTMLElement, ring: Ring): void {
  const svg = icon.querySelector('svg');
  const bar = icon.querySelector<SVGElement>('.bar');
  if (!svg || !bar) return;
  svg.classList.toggle('indeterminate', ring.indeterminate);
  const shown = ring.indeterminate ? INDETERMINATE_ARC : Math.min(1, Math.max(0, ring.fraction));
  bar.style.setProperty('stroke-dashoffset', (RING_CIRCUMFERENCE * (1 - shown)).toFixed(3));
}

function setOptionalAttr(el: Element, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}
