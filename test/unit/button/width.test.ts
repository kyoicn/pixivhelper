import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Face } from '../../../src/content/button/labels';
import {
  candidates,
  computeWidth,
  LOCALE_FLOOR_PX,
  type Measure,
  settleWidth,
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

function texts(faces: Face[]): string[] {
  return faces.map((f) => (f.hint === undefined ? f.label : `${f.label} · ${f.hint}`));
}

/** A fake font: 8 px per character plus padding, icon and gaps like the real pill. */
const charMeasure: Measure = (face) =>
  24 +
  (face.icon !== null || face.ring ? 26 : 0) +
  face.label.length * 8 +
  (face.hint === undefined ? 0 : 32 + face.hint.length * 8) +
  0.4;

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

  it('candidates: an unknown work starts at the 2-digit width plus every ugoira face', () => {
    expect(texts(candidates(null))).toEqual([
      ...texts(candidates(work({ pageCount: 99 }))),
      ...texts(candidates(UGOIRA)),
    ]);
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

  it('LOCALE_FLOOR_PX: only English has a floor', () => {
    expect(LOCALE_FLOOR_PX).toEqual({ en: 164, ja: 0, 'zh-CN': 0, 'zh-TW': 0 });
  });
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
});
