// Single-entry zip extraction (design-offscreen-worker.md "Zip extraction"). The filter makes fflate
// inflate only the requested entry, so at most one frame's bytes are copied out of the retained zip.

import { unzipSync } from 'fflate';

/** The entry's bytes, or `undefined` when the zip has no entry of that name. Throws on a corrupt zip. */
export function extractEntry(zip: Uint8Array, name: string): Uint8Array<ArrayBuffer> | undefined {
  return unzipSync(zip, { filter: (file) => file.name === name })[name];
}
