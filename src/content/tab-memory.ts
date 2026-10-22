// Per-artwork button state for the life of the document (PRD §4.1 #1, §4.7.6): SPA back/forward
// shows the state and width an artwork had, and job/update pushes keep updating artworks the user
// navigated away from (design-artwork-button.md "job/update handling").

import type { JobView } from '../shared/types';
import { createEntry, type Entry, reduce } from './button/model';

export interface EntryChange {
  prev: Entry;
  next: Entry;
}

export interface TabMemory {
  get(artworkId: string): Entry | undefined;
  /** The stored entry, or a fresh pending one (stored). */
  getOrCreate(artworkId: string): Entry;
  set(entry: Entry): void;
  entries(): Entry[];
  /**
   * Applies a job/update (or job/listForTab) view to its artwork's entry, creating the entry if
   * this document has not shown that artwork yet (reload reattach).
   */
  applyView(view: JobView): EntryChange;
}

export function createTabMemory(): TabMemory {
  const map = new Map<string, Entry>();
  const getOrCreate = (artworkId: string): Entry => {
    const known = map.get(artworkId);
    if (known) return known;
    const entry = createEntry(artworkId);
    map.set(artworkId, entry);
    return entry;
  };
  return {
    get: (artworkId) => map.get(artworkId),
    getOrCreate,
    set(entry) {
      map.set(entry.artworkId, entry);
    },
    entries: () => Array.from(map.values()),
    applyView(view) {
      const prev = getOrCreate(view.artworkId);
      const next = reduce(prev, { type: 'update', view });
      map.set(view.artworkId, next);
      return { prev, next };
    },
  };
}
