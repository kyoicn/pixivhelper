// Test access to the Download button. It lives in a closed shadow root, which Playwright's
// selectors do not pierce, so exposeButton() reaches it over CDP (DOM.describeNode with `pierce`)
// and parks the ShadowRoot on the page's main-world window; buttonView() and the other helpers
// read it from there with page.evaluate(). Call exposeButton() again after every full page load.

import type { Page } from '@playwright/test';

export const HOST_TAG = 'hfp-download';
/** Main-world global holding the button's ShadowRoot (test pages only). */
const ROOT_GLOBAL = '__hfpButtonRoot';
/** Main-world global holding the label log of watchLabels(). */
const LOG_GLOBAL = '__hfpLabelLog';

export type Glyph = 'download' | 'check' | 'x' | 'warning' | 'ring' | null;

export interface ButtonView {
  /** `<hfp-download>` elements in the document. */
  hosts: number;
  connected: boolean;
  /** The host's `data-mode` (`row`, `floating`, `viewport`). */
  mode: string | null;
  /** What the pill shows now, e.g. `Download · 12P`, `7 / 12`, `Cancel`. */
  text: string;
  /** The visible face's glyph. */
  glyph: Glyph;
  /** The visible face's icon markup (for identity comparisons). */
  iconMarkup: string;
  /** Pill classes, e.g. `['pill', 'primary', 'busy', 'armed']`. */
  classes: string[];
  title: string | null;
  ariaLabel: string | null;
  ariaBusy: string | null;
  ariaDisabled: string | null;
  /** The live region's current text. */
  live: string;
  /** The host's rendered width (px). */
  width: number;
  /** The pill's box in viewport coordinates. */
  box: { x: number; y: number; width: number; height: number };
  /** Computed style of the pill. */
  style: {
    backgroundColor: string;
    color: string;
    borderTop: string;
    boxShadow: string;
    outlineStyle: string;
    outlineWidth: string;
    outlineColor: string;
    outlineOffset: string;
  };
}

export interface LabelSample {
  /** performance.now() in the page. */
  at: number;
  text: string;
}

/** Waits for the host to be in the document, then parks its ShadowRoot on `window`. */
export async function exposeButton(page: Page, { timeout = 5_000 } = {}): Promise<void> {
  await page.waitForFunction((tag) => document.querySelector(tag) !== null, HOST_TAG, {
    timeout,
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(HOST_TAG)})`,
    });
    if (!result.objectId) throw new Error(`exposeButton: no <${HOST_TAG}>`);
    const { node } = await cdp.send('DOM.describeNode', {
      objectId: result.objectId,
      depth: 1,
      pierce: true,
    });
    const shadow = node.shadowRoots?.[0];
    if (!shadow) throw new Error(`exposeButton: <${HOST_TAG}> has no shadow root`);
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: shadow.backendNodeId });
    if (!object.objectId) throw new Error('exposeButton: shadow root did not resolve');
    await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function () { window[${JSON.stringify(ROOT_GLOBAL)}] = this; }`,
    });
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** A snapshot of the button. Requires exposeButton(). */
export function buttonView(page: Page): Promise<ButtonView> {
  return page.evaluate(
    ({ rootGlobal, hostTag }) => {
      const root = (window as unknown as Record<string, ShadowRoot | undefined>)[rootGlobal];
      if (!root) throw new Error('buttonView: call exposeButton() first');
      const host = root.host as HTMLElement;
      const pill = root.querySelector<HTMLButtonElement>('button.pill:not(.measure)');
      if (!pill) throw new Error('buttonView: no pill');
      const visible = (el: Element | null): el is HTMLElement =>
        el instanceof HTMLElement && el.checkVisibility();
      const face = Array.from(pill.querySelectorAll('.face')).find(visible) ?? null;
      const parts = face
        ? Array.from(face.querySelectorAll('.label, .dot, .hint'))
            .filter(visible)
            .map((el) => (el.textContent ?? '').trim())
        : [];
      const icon = face?.querySelector('.icon') ?? null;
      const svg = visible(icon) ? icon.querySelector('svg') : null;
      const d = svg?.querySelector('path')?.getAttribute('d') ?? '';
      const glyph = !svg
        ? null
        : svg.classList.contains('ring')
          ? 'ring'
          : d.startsWith('M12 4v11')
            ? 'download'
            : d.startsWith('m5 12.5')
              ? 'check'
              : d.startsWith('M6 6')
                ? 'x'
                : d.startsWith('M12 3')
                  ? 'warning'
                  : null;
      const css = getComputedStyle(pill);
      const rect = pill.getBoundingClientRect();
      return {
        hosts: document.getElementsByTagName(hostTag).length,
        connected: host.isConnected,
        mode: host.getAttribute('data-mode'),
        text: parts.join(' '),
        glyph,
        iconMarkup: svg ? new XMLSerializer().serializeToString(svg) : '',
        classes: Array.from(pill.classList),
        title: pill.getAttribute('title'),
        ariaLabel: pill.getAttribute('aria-label'),
        ariaBusy: pill.getAttribute('aria-busy'),
        ariaDisabled: pill.getAttribute('aria-disabled'),
        live: root.querySelector('[role="status"]')?.textContent ?? '',
        width: host.getBoundingClientRect().width,
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        style: {
          backgroundColor: css.backgroundColor,
          color: css.color,
          borderTop: `${css.borderTopWidth} ${css.borderTopStyle} ${css.borderTopColor}`,
          boxShadow: css.boxShadow,
          outlineStyle: css.outlineStyle,
          outlineWidth: css.outlineWidth,
          outlineColor: css.outlineColor,
          outlineOffset: css.outlineOffset,
        },
      } satisfies ButtonView;
    },
    { rootGlobal: ROOT_GLOBAL, hostTag: HOST_TAG },
  );
}

/** Polls buttonView() until `text` is shown; returns that view. */
export async function waitForText(
  page: Page,
  text: string | RegExp,
  { timeout = 10_000 } = {},
): Promise<ButtonView> {
  const deadline = Date.now() + timeout;
  let last: ButtonView | null = null;
  for (;;) {
    last = await buttonView(page);
    if (typeof text === 'string' ? last.text === text : text.test(last.text)) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `button never showed ${String(text)} within ${timeout} ms (last: ${last.text})`,
      );
    }
    await page.waitForTimeout(25);
  }
}

/** Center of the pill in viewport coordinates, for page.mouse. */
export async function buttonCenter(page: Page): Promise<{ x: number; y: number }> {
  const { box } = await buttonView(page);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Clicks the pill with the mouse (the pointer stays on it afterwards). */
export async function clickButton(page: Page): Promise<void> {
  const { x, y } = await buttonCenter(page);
  await page.mouse.click(x, y);
}

/** Moves the pointer onto the pill, or well away from it. */
export async function hoverButton(page: Page, on: boolean): Promise<void> {
  const { x, y } = await buttonCenter(page);
  if (on) await page.mouse.move(x, y);
  else await page.mouse.move(5, 5);
}

/**
 * Records every text the pill shows from now on (MutationObserver on the shadow root), with
 * page timestamps; read it with labelLog().
 */
export async function watchLabels(page: Page): Promise<void> {
  await page.evaluate(
    ({ rootGlobal, logGlobal }) => {
      const w = window as unknown as Record<string, unknown>;
      const root = w[rootGlobal] as ShadowRoot | undefined;
      if (!root) throw new Error('watchLabels: call exposeButton() first');
      const pill = root.querySelector('button.pill:not(.measure)');
      if (!pill) throw new Error('watchLabels: no pill');
      const log: { at: number; text: string }[] = [];
      w[logGlobal] = log;
      const read = (): string => {
        const face = pill.querySelector('.face-main');
        if (!face) return '';
        return Array.from(face.querySelectorAll<HTMLElement>('.label, .dot, .hint'))
          .filter((el) => !el.hidden)
          .map((el) => (el.textContent ?? '').trim())
          .join(' ');
      };
      const record = (): void => {
        const text = read();
        if (log.at(-1)?.text !== text) log.push({ at: performance.now(), text });
      };
      record();
      new MutationObserver(record).observe(pill, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['hidden'],
      });
    },
    { rootGlobal: ROOT_GLOBAL, logGlobal: LOG_GLOBAL },
  );
}

/** The main face's texts recorded since watchLabels(), in order, without repeats. */
export function labelLog(page: Page): Promise<LabelSample[]> {
  return page.evaluate(
    (logGlobal) =>
      ((window as unknown as Record<string, unknown>)[logGlobal] as LabelSample[] | undefined) ??
      [],
    LOG_GLOBAL,
  );
}

/** Whether keyboard focus is on the pill (inside the host's closed shadow root). */
export function buttonHasFocus(page: Page): Promise<boolean> {
  return page.evaluate((rootGlobal) => {
    const root = (window as unknown as Record<string, ShadowRoot | undefined>)[rootGlobal];
    return (
      root !== undefined &&
      document.activeElement === root.host &&
      root.activeElement?.matches('button.pill:not(.measure)') === true
    );
  }, ROOT_GLOBAL);
}

/**
 * The declared style of the first rule in the button's stylesheet whose selector is exactly
 * `selector` (computed values snap border widths to device pixels; the rule keeps what was written).
 */
export function buttonRule(page: Page, selector: string): Promise<Record<string, string>> {
  return page.evaluate(
    ({ rootGlobal, selector: wanted }) => {
      const root = (window as unknown as Record<string, ShadowRoot | undefined>)[rootGlobal];
      if (!root) throw new Error('buttonRule: call exposeButton() first');
      for (const sheet of root.adoptedStyleSheets) {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule instanceof CSSStyleRule && rule.selectorText === wanted) {
            const style = rule.style;
            return Object.fromEntries(
              Array.from(style).map((name) => [name, style.getPropertyValue(name)]),
            );
          }
        }
      }
      throw new Error(`buttonRule: no rule ${wanted}`);
    },
    { rootGlobal: ROOT_GLOBAL, selector },
  );
}

/**
 * Before page.goto(): records (as `performance.now()`) when an `<hfp-download>` is first in the
 * document; read it with hostConnectedAt().
 */
export async function recordHostConnection(page: Page): Promise<void> {
  await page.addInitScript((hostTag) => {
    const w = window as unknown as { __hfpHostAt?: number };
    const observer = new MutationObserver(() => {
      if (document.getElementsByTagName(hostTag).length === 0) return;
      w.__hfpHostAt = performance.now();
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  }, HOST_TAG);
}

/** performance.now() at which the host was first in the document, or null. */
export function hostConnectedAt(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as unknown as { __hfpHostAt?: number }).__hfpHostAt ?? null);
}
