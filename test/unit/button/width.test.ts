import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Face } from '../../../src/content/button/labels';
import {
  candidates,
  computeWidth,
  LOCALE_FLOOR_PX,
  type Measure,
  settleWidth,
  UGOIRA_LOCALE_FLOOR_PX,
} from '../../../src/content/button/width';
import type { WorkInfo } from '../../../src/shared/types';
import { stubChromeI18n } from '../../helpers/i18n-stub';

function work(overrides: Partial<WorkInfo> = {}): WorkInfo {
  return {
    id: '135882741',
    illustType: 0,
    xRestrict: 0,
    withheld: false,
    pageCount: 12,
    width: 1200,
    height: 1697,
    userName: 'みずき',
    userId: '40285173',
    title: '雨上がりの渋谷',
    ...overrides,
  };
}

const UGOIRA = work({ id: '136004512', illustType: 2, pageCount: 1 });

function text(face: Face): string {
  return face.hint === undefined ? face.label : `${face.label} · ${face.hint}`;
}

function texts(faces: Face[]): string[] {
  return faces.map(text);
}

/** A fake font: 8 px per character plus padding, icon and gaps like the real pill. */
const charMeasure: Measure = (face) =>
  24 +
  (face.icon !== null || face.ring ? 26 : 0) +
  face.label.length * 8 +
  (face.hint === undefined ? 0 : 32 + face.hint.length * 8) +
  0.4;

/** The English faces' widths in px, measured with BUTTON_CSS in headless Chromium (macOS). */
const REAL_EN: Readonly<Record<string, number>> = {
  'Download · 12P': 159.390625,
  '12 / 12': 97.765625,
  'Saved · 12P': 135.59375,
  'Retry · 11 failed': 157.5625,
  'Download · 99P': 162.078125,
  '99 / 99': 97.765625,
  'Saved · 99P': 138.28125,
  'Retry · 98 failed': 162.078125,
  Cancel: 96.328125,
  'Log in to download': 152.9375,
  Retry: 88.4375,
  Unavailable: 102.109375,
  'Download · MP4': 164.875,
  'Download · WebM': 175.90625,
  'Download · ZIP': 157.59375,
  '100%': 91.015625,
  'Saved · MP4': 141.078125,
  'Saved · WebM': 152.109375,
  'Saved · ZIP': 133.796875,
  'Retry · MP4': 136.3125,
  'Retry · WebM': 147.34375,
};

const realMeasure: Measure = (face) => {
  const px = REAL_EN[text(face)];
  if (px === undefined) throw new Error(`no real-size width for ${text(face)}`);
  return px;
};

beforeEach(() => {
  stubChromeI18n('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('candidates', () => {
  it('candidates: a 12-page work covers every state with its real page count', () => {
    expect(texts(candidates(work()))).toEqual([
      'Download · 12P',
      '12 / 12',
      'Cancel',
      'Saved · 12P',
      'Log in to download',
      'Retry · 11 failed',
      'Retry',
      'Unavailable',
    ]);
  });

  it('candidates: a single page has no hints and no partial failure', () => {
    expect(texts(candidates(work({ pageCount: 1 })))).toEqual([
      'Download',
      '1 / 1',
      'Cancel',
      'Saved',
      'Log in to download',
      'Retry',
      'Unavailable',
    ]);
  });

  it('candidates: an ugoira covers every output format', () => {
    expect(texts(candidates(UGOIRA))).toEqual([
      'Download · MP4',
      'Download · WebM',
      'Download · ZIP',
      '100%',
      'Cancel',
      'Saved · MP4',
      'Saved · WebM',
      'Saved · ZIP',
      'Log in to download',
      'Retry',
      'Retry · MP4',
      'Retry · WebM',
      'Unavailable',
    ]);
  });

  it('candidates: an unknown work starts at the 2-digit width', () => {
    expect(texts(candidates(null))).toEqual(texts(candidates(work({ pageCount: 99 }))));
  });

  it('candidates: an unknown work has no ugoira face', () => {
    expect(texts(candidates(null)).filter((t) => /MP4|WebM|ZIP|%/.test(t))).toEqual([]);
  });

  it('candidates: the busy faces carry the ring', () => {
    expect(candidates(work())[1]?.ring).toEqual({ fraction: 1, indeterminate: false });
  });
});

describe('computeWidth', () => {
  it('computeWidth: takes the widest measured candidate, rounded up', () => {
    const measure: Measure = (face) => (face.label === 'Saved' ? 170.2 : 150);
    expect(computeWidth(work(), 'en', measure)).toBe(171);
  });

  it('computeWidth: English never goes below the 164 px floor', () => {
    expect(computeWidth(work({ pageCount: 1 }), 'en', () => 120)).toBe(LOCALE_FLOOR_PX.en);
  });

  it.each(['ja', 'zh-CN', 'zh-TW'] as const)(
    'computeWidth: %s uses the measured width',
    (locale) => {
      expect(computeWidth(work(), locale, () => 120.2)).toBe(121);
    },
  );

  it('computeWidth: measures every candidate once', () => {
    const measure = vi.fn<Measure>(() => 100);
    computeWidth(work(), 'en', measure);
    expect(measure).toHaveBeenCalledTimes(candidates(work()).length);
  });

  it('computeWidth: a 100+ page work can be wider than the 2-digit width', () => {
    const twoDigit = computeWidth(null, 'en', charMeasure);
    expect(computeWidth(work({ pageCount: 150 }), 'en', charMeasure)).toBeGreaterThan(twoDigit);
  });

  it('computeWidth: an unknown work is the 164 px floor in English at real sizes', () => {
    expect(computeWidth(null, 'en', realMeasure)).toBe(164);
  });

  it('computeWidth: a 12-page work is the 164 px floor in English at real sizes', () => {
    expect(computeWidth(work(), 'en', realMeasure)).toBe(164);
  });

  it('computeWidth: an ugoira is 176 px in English at real sizes (Download · WebM)', () => {
    expect(computeWidth(UGOIRA, 'en', realMeasure)).toBe(176);
  });

  it('LOCALE_FLOOR_PX: only English has a floor', () => {
    expect(LOCALE_FLOOR_PX).toEqual({ en: 164, ja: 0, 'zh-CN': 0, 'zh-TW': 0 });
  });

  it('UGOIRA_LOCALE_FLOOR_PX: only English has a floor, 176 px', () => {
    expect(UGOIRA_LOCALE_FLOOR_PX).toEqual({ en: 176, ja: 0, 'zh-CN': 0, 'zh-TW': 0 });
  });

  it('computeWidth: an English ugoira whose faces measure narrower is 176 px', () => {
    expect(computeWidth(UGOIRA, 'en', () => 150.5)).toBe(176);
  });

  it('computeWidth: an English ugoira takes a measured face wider than 176 px', () => {
    const measure: Measure = (face) => (face.hint === 'WebM' ? 181.2 : 150);
    expect(computeWidth(UGOIRA, 'en', measure)).toBe(182);
  });

  it('computeWidth: an unknown work keeps the 164 px floor, not the ugoira floor', () => {
    expect(computeWidth(null, 'en', () => 120)).toBe(164);
  });

  it.each(['ja', 'zh-CN', 'zh-TW'] as const)(
    'computeWidth: a %s ugoira uses the measured width',
    (locale) => {
      expect(computeWidth(UGOIRA, locale, () => 120.2)).toBe(121);
    },
  );
});

describe('settleWidth', () => {
  it('settleWidth: the first computation locks the width', () => {
    expect(settleWidth(null, 164, false)).toBe(164);
  });

  it('settleWidth: widens when the metadata needs more room before any interaction', () => {
    expect(settleWidth(164, 180, false)).toBe(180);
  });

  it('settleWidth: never widens after an interaction', () => {
    expect(settleWidth(164, 180, true)).toBe(164);
  });

  it('settleWidth: never shrinks', () => {
    expect(settleWidth(171, 164, false)).toBe(171);
  });

  it('settleWidth: a 150-page work locked before its metadata widens once, then stays', () => {
    const measure: Measure = (face) => (face.label === '150 / 150' ? 190.5 : 150);
    const first = settleWidth(null, computeWidth(null, 'en', measure), false);
    const widened = settleWidth(
      first,
      computeWidth(work({ pageCount: 150 }), 'en', measure),
      false,
    );
    const afterClick = settleWidth(widened, 250, true);
    expect([first, widened, afterClick]).toEqual([164, 191, 191]);
  });

  it('settleWidth: an illustration whose metadata is late keeps 164 px', () => {
    const first = settleWidth(null, computeWidth(null, 'en', realMeasure), false);
    expect(settleWidth(first, computeWidth(work(), 'en', realMeasure), false)).toBe(164);
  });

  it('settleWidth: an ugoira locked before its metadata widens once to 176 px, then stays', () => {
    const first = settleWidth(null, computeWidth(null, 'en', realMeasure), false);
    const widened = settleWidth(first, computeWidth(UGOIRA, 'en', realMeasure), false);
    const afterClick = settleWidth(widened, 250, true);
    expect([first, widened, afterClick]).toEqual([164, 176, 176]);
  });

  it('settleWidth: an ugoira with narrow faces widens once from 164 to its 176 px floor', () => {
    const narrow: Measure = () => 150;
    const first = settleWidth(null, computeWidth(null, 'en', narrow), false);
    const widened = settleWidth(first, computeWidth(UGOIRA, 'en', narrow), false);
    expect([first, widened]).toEqual([164, 176]);
  });

  it('settleWidth: an ugoira with narrow faces clicked before its metadata stays 164 px', () => {
    const narrow: Measure = () => 150;
    const first = settleWidth(null, computeWidth(null, 'en', narrow), false);
    expect(settleWidth(first, computeWidth(UGOIRA, 'en', narrow), true)).toBe(164);
  });

  it('settleWidth: an ugoira clicked before its metadata keeps the provisional 164 px', () => {
    const first = settleWidth(null, computeWidth(null, 'en', realMeasure), false);
    expect(settleWidth(first, computeWidth(UGOIRA, 'en', realMeasure), true)).toBe(164);
  });
});
