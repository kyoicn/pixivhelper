import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodecCaps } from '../../../src/shared/messages';
import { installChromeFake, type ChromeFake } from '../../fakes/chrome';

type Caps = typeof import('../../../src/background/caps');

const PROBED: CodecCaps = { avc: 'avc1.64001e', vp9: true };

let fake: ChromeFake;
let caps: Caps;
let probes: unknown[];
let respond: () => unknown;

beforeEach(async () => {
  fake = installChromeFake();
  probes = [];
  respond = () => ({ ok: true, caps: PROBED });
  fake.offscreen.setHandler((message) => {
    probes.push(message);
    return respond();
  });
  // Fresh in-flight map per test.
  vi.resetModules();
  caps = await import('../../../src/background/caps');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('capsKey', () => {
  it('capsKey: keys even sizes as caps:<w>x<h>', () => {
    expect(caps.capsKey(600, 600)).toBe('caps:600x600');
  });

  it('capsKey: crops odd sizes to even', () => {
    expect(caps.capsKey(601, 451)).toBe('caps:600x450');
  });
});

describe('getCaps', () => {
  it('getCaps: returns a cached answer without probing', async () => {
    const cached: CodecCaps = { avc: null, vp9: true };
    fake.storage.session.seed({ 'caps:600x600': cached });
    const result = await caps.getCaps(600, 600);
    expect([result, probes, fake.api.offscreen.createDocument.mock.calls.length]).toEqual([
      cached,
      [],
      0,
    ]);
  });

  it('getCaps: probes the even size on a miss', async () => {
    await caps.getCaps(601, 451);
    expect(probes).toEqual([{ target: 'offscreen', type: 'off/probe', width: 600, height: 450 }]);
  });

  it('getCaps: returns the probe result', async () => {
    await expect(caps.getCaps(600, 600)).resolves.toEqual(PROBED);
  });

  it('getCaps: stores the probe result in storage.session', async () => {
    await caps.getCaps(601, 451);
    expect(fake.storage.session.snapshot()).toEqual({ 'caps:600x450': PROBED });
  });

  it('getCaps: a later call reads the cache instead of probing again', async () => {
    await caps.getCaps(600, 600);
    await caps.getCaps(600, 600);
    expect(probes).toHaveLength(1);
  });

  it('getCaps: concurrent misses for one size share one probe', async () => {
    const results = await Promise.all([
      caps.getCaps(600, 600),
      caps.getCaps(601, 601),
      caps.getCaps(600, 600),
    ]);
    expect([probes.length, results]).toEqual([1, [PROBED, PROBED, PROBED]]);
  });

  it('getCaps: different sizes are probed separately', async () => {
    await Promise.all([caps.getCaps(600, 600), caps.getCaps(1920, 1080)]);
    expect(Object.keys(fake.storage.session.snapshot()).sort()).toEqual([
      'caps:1920x1080',
      'caps:600x600',
    ]);
  });

  it('getCaps: re-probes over a malformed cached value', async () => {
    fake.storage.session.seed({ 'caps:600x600': { avc: 1 } });
    await expect(caps.getCaps(600, 600)).resolves.toEqual(PROBED);
  });

  it('getCaps: a failed probe rejects and is not cached', async () => {
    respond = () => ({ ok: false, error: 'INTERNAL' });
    await expect(caps.getCaps(600, 600)).rejects.toThrow('off/probe failed: INTERNAL');
    expect(fake.storage.session.snapshot()).toEqual({});
  });

  it('getCaps: the next call after a failed probe probes again', async () => {
    respond = () => ({ ok: false, error: 'INTERNAL' });
    await caps.getCaps(600, 600).catch(() => undefined);
    respond = () => ({ ok: true, caps: PROBED });
    await expect(caps.getCaps(600, 600)).resolves.toEqual(PROBED);
  });
});

describe('probePending', () => {
  it('probePending: is true while a probe runs', async () => {
    const probe = caps.getCaps(600, 600);
    const pending = caps.probePending();
    await probe;
    expect(pending).toBe(true);
  });

  it('probePending: is false once the probe settled', async () => {
    await caps.getCaps(600, 600);
    expect(caps.probePending()).toBe(false);
  });
});
