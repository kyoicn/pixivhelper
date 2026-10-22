// Artwork-route detection, including pixiv's SPA navigations (design-artwork-button.md "Routing
// and SPA detection"). Every signal funnels into check(), which compares location.href with the
// last value seen and emits leave()/enter() only when the artwork shown changes.

import { createLogger } from '../shared/log';

const log = createLogger('router');

/** `/artworks/<id>` and locale-prefixed variants such as `/en/artworks/<id>` (PRD §4.7.1). */
export const ARTWORK_PATH_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?artworks\/(\d{1,12})\/?$/;

/** The artwork ID of an artwork route, or null for every other pixiv page. */
export function artworkIdFromPath(pathname: string): string | null {
  return ARTWORK_PATH_RE.exec(pathname)?.[1] ?? null;
}

export interface RouteHandlers {
  /** The document now shows artwork `artworkId`. */
  enter(artworkId: string): void;
  /** The document no longer shows the artwork it entered last. */
  leave(): void;
}

export interface Router {
  /** Adds the navigation listeners and runs the first check(). */
  start(): void;
  /** Re-reads the URL; also called from the placement MutationObserver to catch missed events. */
  check(): void;
  /** The artwork the current route shows, or null off artwork routes. */
  current(): string | null;
  /** Removes the navigation listeners. */
  stop(): void;
}

export function createRouter(handlers: RouteHandlers): Router {
  let lastHref: string | null = null;
  let current: string | null = null;

  const check = (): void => {
    const href = location.href;
    if (href === lastHref) return;
    lastHref = href;
    const next = artworkIdFromPath(location.pathname);
    if (next === current) return;
    log.debug('route', current ?? '-', '→', next ?? '-');
    // Artwork → artwork is leave() then enter() in the same tick.
    if (current !== null) handlers.leave();
    current = next;
    if (next !== null) handlers.enter(next);
  };

  return {
    start() {
      // Fires for pushState/replaceState and traversals; DOM events on the shared navigation
      // object reach isolated-world listeners.
      navigation.addEventListener('currententrychange', check);
      window.addEventListener('popstate', check);
      check();
    },
    check,
    current: () => current,
    stop() {
      navigation.removeEventListener('currententrychange', check);
      window.removeEventListener('popstate', check);
    },
  };
}
