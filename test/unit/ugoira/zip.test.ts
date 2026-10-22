import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractEntry } from '../../../src/offscreen/ugoira/zip';

const FRAME_0 = strToU8('frame zero bytes '.repeat(64));
const FRAME_1 = strToU8('frame one bytes '.repeat(64));

function buildZip(level: 0 | 6): Uint8Array {
  return zipSync({ '000000.jpg': FRAME_0, '000001.jpg': FRAME_1 }, { level });
}

describe('extractEntry', () => {
  it('extractEntry: returns the named entry of a stored zip byte-for-byte', () => {
    expect(extractEntry(buildZip(0), '000001.jpg')).toEqual(FRAME_1);
  });

  it('extractEntry: returns the named entry of a deflated zip byte-for-byte', () => {
    expect(extractEntry(buildZip(6), '000000.jpg')).toEqual(FRAME_0);
  });

  it('extractEntry: the deflated fixture really is compressed', () => {
    expect(buildZip(6).length).toBeLessThan(buildZip(0).length);
  });

  it('extractEntry: returns undefined for a missing entry', () => {
    expect(extractEntry(buildZip(6), '000002.jpg')).toBeUndefined();
  });

  it('extractEntry: throws on bytes that are not a zip', () => {
    expect(() => extractEntry(strToU8('not a zip at all'), '000000.jpg')).toThrow();
  });
});
