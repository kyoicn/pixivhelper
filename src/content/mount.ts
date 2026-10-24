// Placement of the one <hfp-download> host (design-artwork-button.md "Mounting (mount.ts)"): next
// to pixiv's like control, re-inserted within a frame after pixiv re-renders the row, or floating
// over the artwork when there is no row by FLOAT_FALLBACK_MS after the route was entered. The
// fallback timer fires FLOAT_PLACEMENT_BUDGET_MS early and places the pill synchronously, because
// the PRD's 3 s run to the pill on screen (R-004 S4, system.md D14). The host keeps its shadow
// root and state when moved, so moving it never changes what the button shows.

import { FLOAT_FALLBACK_MS, FLOAT_PLACEMENT_BUDGET_MS } from '../shared/constants';
import { createLogger } from '../shared/log';
import { PILL_HEIGHT_PX } from './button/styles';
import { type ActionRowHit, findActionRow, findArtworkArea } from './pixiv-dom';

const log = createLogger('mount');

export type MountMode = 'row' | 'floating' | 'viewport';

export const HOST_TAG = 'hfp-download';
/** Floating mode: inset from the artwork area's bottom-right corner (PRD CUJ-5 step 11). */
const FLOAT_INSET_PX = 16;
/** Viewport mode (no artwork area either): inset from the viewport's bottom-right corner. */
const VIEWPORT_INSET_PX = 24;
const FLOAT_Z_INDEX = '2147483000';
/** When the fallback timer fires: early enough that placing and painting fit in the 3 s. */
const FALLBACK_TIMER_MS = FLOAT_FALLBACK_MS - FLOAT_PLACEMENT_BUDGET_MS;
const FLOATING_PROPS = ['position', 'z-index', 'left', 'top', 'right', 'bottom'] as const;
const SPACING_PROPS = ['margin-left', 'margin-right'] as const;

export interface MountOptions {
  host: HTMLElement;
  /** The artwork the route shows, or null off artwork routes. */
  artworkId(): string | null;
  /** Runs for every batch of DOM mutations, before placement (the router's check()). */
  onMutation(): void;
  /** The host was just inserted or moved, so it is connected and can be measured. */
  onPlaced(mode: MountMode): void;
}

export interface Mount {
  /** An artwork route was entered: restart the fallback timer and place the host. */
  show(): void;
  /** The artwork route was left: remove the host from the document. */
  hide(): void;
  /** Places the host now; normally called rAF-coalesced from the MutationObserver. */
  ensurePlaced(): void;
  /** hide() plus disconnecting the observer, for teardown. */
  destroy(): void;
}

export function createMount(options: MountOptions): Mount {
  const { host } = options;
  let shown = false;
  let mode: MountMode | null = null;
  let hit: ActionRowHit | null = null;
  let frame: number | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let fallbackFired = false;
  let tracked: { area: HTMLElement; resize: ResizeObserver } | null = null;
  let positionFrame: number | null = null;

  // One observer for the document's life; off artwork routes it only drives the router.
  const observer = new MutationObserver(() => {
    options.onMutation();
    if (shown) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function schedule(): void {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      ensurePlaced();
    });
  }

  function ensurePlaced(): void {
    if (!shown) return;
    removeStrayHosts();
    if (isInPlace(hit)) return;
    const artworkId = options.artworkId();
    const next = artworkId === null ? null : findActionRow(document, artworkId);
    hit = next;
    if (next) {
      if (!isInPlace(next)) placeInRow(next);
    } else if (fallbackFired) {
      float();
    }
  }

  /** Single-host invariant; also removes a host left behind by a previous extension version. */
  function removeStrayHosts(): void {
    for (const other of Array.from(document.getElementsByTagName(HOST_TAG))) {
      if (other !== host) other.remove();
    }
  }

  function isInPlace(row: ActionRowHit | null): boolean {
    if (!row?.group.isConnected || host.parentElement !== row.group) return false;
    if (row.like.parentElement !== row.group) return false;
    const neighbor = row.side === 'after' ? host.previousElementSibling : host.nextElementSibling;
    return neighbor === row.like;
  }

  function placeInRow(row: ActionRowHit): void {
    untrackArea();
    for (const prop of FLOATING_PROPS) host.style.removeProperty(prop);
    if (row.side === 'after') row.like.after(host);
    else row.like.before(host);
    copySpacing(row);
    setMode('row', `action row via ${row.via}, ${row.side} like`);
    options.onPlaced('row');
  }

  /** pixiv spaces the row with margins, not a flex gap: give the host the like wrapper's. */
  function copySpacing(row: ActionRowHit): void {
    if (parseFloat(getComputedStyle(row.group).columnGap) > 0) {
      for (const prop of SPACING_PROPS) host.style.removeProperty(prop);
      return;
    }
    const like = getComputedStyle(row.like);
    // pixiv is left-to-right only, so the physical margins are the inline ones.
    host.style.marginLeft = like.marginLeft;
    host.style.marginRight = like.marginRight;
  }

  function float(): void {
    const area = findArtworkArea(document);
    const anchored = area !== null && hasBox(area);
    const moved = host.parentElement !== document.body;
    if (moved) document.body.append(host);
    for (const prop of SPACING_PROPS) host.style.removeProperty(prop);
    host.style.position = 'fixed';
    host.style.zIndex = FLOAT_Z_INDEX;
    if (anchored) {
      setMode('floating', 'action row not found; floating over the artwork');
      trackArea(area);
    } else {
      setMode('viewport', 'action row and artwork area not found; floating in the viewport');
      untrackArea();
      host.style.removeProperty('left');
      host.style.removeProperty('top');
      host.style.right = `${VIEWPORT_INSET_PX}px`;
      host.style.bottom = `${VIEWPORT_INSET_PX}px`;
    }
    // Measure (lock the width) before positioning by the host's width.
    if (moved) options.onPlaced(anchored ? 'floating' : 'viewport');
    if (anchored) position(area);
  }

  function position(area: HTMLElement): void {
    const rect = area.getBoundingClientRect();
    const width = host.getBoundingClientRect().width;
    host.style.removeProperty('right');
    host.style.removeProperty('bottom');
    host.style.left = `${rect.right - FLOAT_INSET_PX - width}px`;
    host.style.top = `${rect.bottom - FLOAT_INSET_PX - PILL_HEIGHT_PX}px`;
  }

  function schedulePosition(): void {
    if (positionFrame !== null) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = null;
      if (tracked && mode === 'floating') position(tracked.area);
    });
  }

  function trackArea(area: HTMLElement): void {
    if (tracked?.area === area) return;
    untrackArea();
    const resize = new ResizeObserver(schedulePosition);
    resize.observe(area);
    tracked = { area, resize };
    window.addEventListener('scroll', schedulePosition, { capture: true, passive: true });
    window.addEventListener('resize', schedulePosition, { passive: true });
  }

  function untrackArea(): void {
    if (!tracked) return;
    tracked.resize.disconnect();
    tracked = null;
    window.removeEventListener('scroll', schedulePosition, { capture: true });
    window.removeEventListener('resize', schedulePosition);
    if (positionFrame !== null) cancelAnimationFrame(positionFrame);
    positionFrame = null;
  }

  function setMode(next: MountMode, reason: string): void {
    if (next === mode) return;
    if (next === 'row') log.debug(reason);
    else log.warn(reason);
    mode = next;
    host.setAttribute('data-mode', next);
  }

  function resetFallback(): void {
    clearTimeout(fallbackTimer);
    fallbackTimer = undefined;
    fallbackFired = false;
  }

  function hide(): void {
    shown = false;
    resetFallback();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    untrackArea();
    hit = null;
    mode = null;
    host.remove();
  }

  return {
    show() {
      shown = true;
      resetFallback();
      // Measured from entering the route and not cancelled by finding the row: a row that is
      // missing at any later point (a redesign, or a row pixiv removed) floats the host at once.
      // The callback places without waiting for a frame, so the pill paints at the next one.
      fallbackTimer = setTimeout(() => {
        fallbackTimer = undefined;
        fallbackFired = true;
        ensurePlaced();
      }, FALLBACK_TIMER_MS);
      schedule();
    },
    hide,
    ensurePlaced,
    destroy() {
      observer.disconnect();
      hide();
    },
  };
}

function hasBox(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
