// The quiet "Saved" confirmation beside a section heading (design-options-page.md "`Saved`
// indicator"). The element is a polite live region, so filling it announces "Saved".

import { SAVED_FADE_MS, SAVED_VISIBLE_MS } from '../shared/constants';
import { t } from '../shared/i18n';

export interface SavedIndicator {
  /** Shows the check and `Saved` for SAVED_VISIBLE_MS, then fades out; a re-flash restarts it. */
  flash(): void;
  /** Hides it at once, without a fade, and cancels a pending hide or clear. */
  clear(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function checkIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs: Record<string, string> = {
    width: '14',
    height: '14',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  };
  for (const [name, value] of Object.entries(attrs)) svg.setAttribute(name, value);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'm5 12.5 4.5 4.5L19 7.5');
  svg.append(path);
  return svg;
}

export function createSavedIndicator(el: HTMLElement): SavedIndicator {
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  const hideNow = (): void => {
    el.style.transition = 'none';
    el.style.opacity = '0';
    el.replaceChildren();
  };

  const hide = (): void => {
    if (matchMedia(REDUCED_MOTION_QUERY).matches) {
      hideNow();
      return;
    }
    el.style.transition = `opacity ${SAVED_FADE_MS}ms`;
    el.style.opacity = '0';
    clearTimer = setTimeout(() => el.replaceChildren(), SAVED_FADE_MS);
  };

  const cancel = (): void => {
    clearTimeout(hideTimer);
    clearTimeout(clearTimer);
  };

  return {
    flash() {
      cancel();
      el.replaceChildren(checkIcon(), t('opt_saved'));
      el.style.transition = 'none';
      el.style.opacity = '1';
      hideTimer = setTimeout(hide, SAVED_VISIBLE_MS);
    },
    clear() {
      cancel();
      hideNow();
    },
  };
}
