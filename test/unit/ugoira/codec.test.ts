import { canEncodeVideo } from 'mediabunny';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUALITY, avcCandidates, even, probe } from '../../../src/offscreen/ugoira/codec';

vi.mock('mediabunny', async (importOriginal) => ({
  ...(await importOriginal<typeof import('mediabunny')>()),
  canEncodeVideo: vi.fn(),
}));

const canEncode = vi.mocked(canEncodeVideo);

/** Encoder support stub: `supported` lists avc codec strings that encode; `vp9` toggles VP9. */
function supportOnly(supported: string[], vp9: boolean): void {
  canEncode.mockImplementation((codec, options) =>
    Promise.resolve(codec === 'vp9' ? vp9 : supported.includes(options?.fullCodecString ?? '')),
  );
}

afterEach(() => {
  canEncode.mockReset();
});

describe('even', () => {
  it.each([
    [600, 600],
    [601, 600],
    [451, 450],
    [2, 2],
    [1, 0],
  ])('even: %i → %i', (n, expected) => {
    expect(even(n)).toBe(expected);
  });
});

describe('avcCandidates', () => {
  it('avcCandidates: 600×600 (1444 MBs) → High level 3.0 first', () => {
    expect(avcCandidates(600, 600)[0]).toBe('avc1.64001e');
  });

  it('avcCandidates: 1920×1080 (8160 MBs) → level 4.0', () => {
    expect(avcCandidates(1920, 1080)[0]).toBe('avc1.640028');
  });

  it('avcCandidates: ladder is High → Main → Constrained Baseline at the same level', () => {
    expect(avcCandidates(600, 600)).toEqual(['avc1.64001e', 'avc1.4D001e', 'avc1.42E01e']);
  });

  it.each([
    [1280, 720, 'avc1.64001f'], // 3600 MBs, exactly MaxFS of 3.1
    [1280, 1024, 'avc1.640020'], // 5120 MBs → 3.2
    [2048, 1088, 'avc1.64002a'], // 8704 MBs → 4.2
    [2560, 1600, 'avc1.640032'], // 16000 MBs → 5.0
    [4096, 2304, 'avc1.640033'], // 36864 MBs → 5.1
  ])('avcCandidates: %i×%i → %s', (w, h, expected) => {
    expect(avcCandidates(w, h)[0]).toBe(expected);
  });

  it('avcCandidates: partial macroblocks round up (1281×720 needs 3645 MBs → 3.2)', () => {
    expect(avcCandidates(1281, 720)[0]).toBe('avc1.640020');
  });

  it('avcCandidates: no candidates beyond the level table', () => {
    expect(avcCandidates(4112, 2304)).toEqual([]);
  });
});

describe('probe', () => {
  it('probe: picks High when it encodes', async () => {
    supportOnly(['avc1.64001e', 'avc1.4D001e', 'avc1.42E01e'], true);
    expect(await probe(600, 600)).toEqual({ avc: 'avc1.64001e', vp9: true });
  });

  it('probe: falls back to Baseline when only Baseline encodes', async () => {
    supportOnly(['avc1.42E01e'], true);
    expect((await probe(600, 600)).avc).toBe('avc1.42E01e');
  });

  it('probe: reports no H.264 when no profile encodes', async () => {
    supportOnly([], true);
    expect(await probe(600, 600)).toEqual({ avc: null, vp9: true });
  });

  it('probe: reports VP9 support independently of H.264', async () => {
    supportOnly(['avc1.64001e'], false);
    expect(await probe(600, 600)).toEqual({ avc: 'avc1.64001e', vp9: false });
  });

  it('probe: asks about the even-cropped size with very-high quality', async () => {
    supportOnly([], true);
    await probe(601, 451);
    expect(canEncode).toHaveBeenCalledWith('vp9', { width: 600, height: 450, quality: QUALITY });
  });

  it('probe: stops at the first profile that encodes', async () => {
    supportOnly(['avc1.64001e'], true);
    await probe(600, 600);
    expect(canEncode.mock.calls.filter(([codec]) => codec === 'avc')).toHaveLength(1);
  });

  it('probe: a frame under 2×2 even pixels supports nothing', async () => {
    supportOnly(['avc1.64001e'], true);
    expect(await probe(1, 600)).toEqual({ avc: null, vp9: false });
  });

  it('probe: a frame under 2×2 even pixels asks no encoder', async () => {
    supportOnly(['avc1.64001e'], true);
    await probe(600, 1);
    expect(canEncode).not.toHaveBeenCalled();
  });
});
