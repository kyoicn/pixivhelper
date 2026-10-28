import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcementFor, type Presentation, present } from '../../../src/content/button/labels';
import { type ButtonState, createEntry, type Entry } from '../../../src/content/button/model';
import type { JobProgress, UgoiraOutput, WorkInfo } from '../../../src/shared/types';
import { type GetMessage, LOCALES, stubChromeI18n } from '../../helpers/i18n-stub';

const FOLDER = 'pixiv/みずき-135882741';
const UGOIRA_FOLDER = 'pixiv/ひなた-136004512';
const META_ON = { saveMetadata: true };
const META_OFF = { saveMetadata: false };

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

const SINGLE = work({ pageCount: 1 });
const UGOIRA = work({ id: '136004512', illustType: 2, pageCount: 1, width: 600, height: 600 });

function entry(state: ButtonState, overrides: Partial<Entry> = {}): Entry {
  return { ...createEntry('135882741'), work: work(), state, ...overrides };
}

function busy(progress: JobProgress | null, armed = false): ButtonState {
  return { s: 'busy', jobId: 'job-1', progress, startedAt: 0, armed };
}

const NOT_BUSY = { ariaBusy: false, ariaDisabled: false };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(LOCALES)('present (%s)', (locale) => {
  let m: GetMessage;
  beforeEach(() => {
    m = stubChromeI18n(locale);
  });

  function busyRow(label: string, fraction: number, ariaLabel: string): Presentation {
    return {
      variant: 'primary',
      icon: null,
      ring: { fraction, indeterminate: false },
      label,
      title: m('tip_cancel'),
      ariaLabel,
      ariaBusy: true,
      ariaDisabled: false,
      cancelFace: { variant: 'cancel', icon: 'x', label: m('btn_cancel') },
      armed: false,
    };
  }

  it('present: pending shows Download without a hint', () => {
    expect(present(createEntry('1'), META_ON)).toEqual({
      variant: 'primary',
      icon: 'download',
      label: m('btn_download'),
      ariaLabel: m('btn_download'),
      ...NOT_BUSY,
    });
  });

  it('present: idle multi-page shows Download · 12P', () => {
    expect(present(entry({ s: 'idle' }), META_ON)).toEqual({
      variant: 'primary',
      icon: 'download',
      label: m('btn_download'),
      hint: m('hint_pages', [12]),
      ariaLabel: m('aria_idle_pages', [12]),
      ...NOT_BUSY,
    });
  });

  it('present: idle single page shows Download without a hint', () => {
    expect(present(entry({ s: 'idle' }, { work: SINGLE }), META_ON)).toEqual({
      variant: 'primary',
      icon: 'download',
      label: m('btn_download'),
      ariaLabel: m('aria_idle_single'),
      ...NOT_BUSY,
    });
  });

  it.each<[UgoiraOutput, boolean, string, string[]]>([
    ['mp4', true, 'aria_idle_ugoira', ['MP4']],
    ['webm', true, 'aria_idle_ugoira', ['WebM']],
    ['mp4', false, 'aria_idle_ugoira_nometa', ['MP4']],
    ['zip', true, 'aria_idle_ugoira_zip', []],
  ])(
    'present: idle ugoira %s (metadata %s) names the output',
    (format, saveMetadata, key, subs) => {
      const p = present(entry({ s: 'idle' }, { work: UGOIRA, format }), { saveMetadata });
      expect(p).toEqual({
        variant: 'primary',
        icon: 'download',
        label: m('btn_download'),
        hint: m('hint_format', [{ mp4: 'MP4', webm: 'WebM', zip: 'ZIP' }[format]]),
        ariaLabel: m(key, subs),
        ...NOT_BUSY,
      });
    },
  );

  it('present: idle ugoira before its format is known shows plain Download', () => {
    const p = present(entry({ s: 'idle' }, { work: UGOIRA }), META_ON);
    expect(p).toMatchObject({ label: m('btn_download'), ariaLabel: m('btn_download') });
  });

  it('present: busy pages shows the counter, ring and cancel face', () => {
    const p = present(entry(busy({ kind: 'pages', done: 7, total: 12 })), META_ON);
    expect(p).toEqual(
      busyRow(m('btn_progress_pages', [7, 12]), 7 / 12, m('aria_busy_pages', [7, 12])),
    );
  });

  it('present: busy on a single page uses the _one accessible name', () => {
    const p = present(entry(busy({ kind: 'pages', done: 0, total: 1 }), { work: SINGLE }), META_ON);
    expect(p.ariaLabel).toBe(m('aria_busy_pages_one', [0]));
  });

  it('present: busy ugoira frames shows the percentage', () => {
    const progress: JobProgress = {
      kind: 'percent',
      percent: 23,
      phase: 'frames',
      indeterminate: false,
    };
    const p = present(entry(busy(progress), { work: UGOIRA, format: 'mp4' }), META_ON);
    expect(p).toEqual(busyRow(m('btn_progress_percent', [23]), 0.23, m('aria_busy_frames', [23])));
  });

  it('present: busy ugoira with an unknown zip size shows the indeterminate arc', () => {
    const progress: JobProgress = {
      kind: 'percent',
      percent: 0,
      phase: 'frames',
      indeterminate: true,
    };
    const p = present(entry(busy(progress), { work: UGOIRA, format: 'mp4' }), META_ON);
    expect(p.ring).toEqual({ fraction: 0, indeterminate: true });
  });

  it('present: busy ugoira encode names the video format', () => {
    const progress: JobProgress = {
      kind: 'percent',
      percent: 58,
      phase: 'encode',
      indeterminate: false,
    };
    const p = present(entry(busy(progress), { work: UGOIRA, format: 'webm' }), META_ON);
    expect(p).toEqual(
      busyRow(m('btn_progress_percent', [58]), 0.58, m('aria_busy_encode', ['WebM', 58])),
    );
  });

  it('present: busy before any progress counts from zero when the work is known', () => {
    const p = present(entry(busy(null)), META_ON);
    expect(p.label).toBe(m('btn_progress_pages', [0, 12]));
  });

  it('present: busy with an unknown work spins without a number', () => {
    const p = present({ ...createEntry('1'), state: busy(null) }, META_ON);
    expect(p).toMatchObject({
      label: m('btn_download'),
      ring: { indeterminate: true },
      ariaLabel: m('tip_cancel'),
    });
  });

  it('present: busy passes the arming through for the cancel face', () => {
    const p = present(entry(busy({ kind: 'pages', done: 1, total: 12 }, true)), META_ON);
    expect(p.armed).toBe(true);
  });

  it('present: saved pages shows Saved · 12P with the folder', () => {
    const state: ButtonState = { s: 'saved', folder: FOLDER, kind: 'pages', pages: 12 };
    expect(present(entry(state), META_ON)).toEqual({
      variant: 'saved',
      icon: 'check',
      label: m('btn_saved'),
      hint: m('hint_pages', [12]),
      title: m('tip_saved', [FOLDER]),
      ariaLabel: m('aria_saved_pages', [12, FOLDER]),
      ...NOT_BUSY,
    });
  });

  it('present: saved single page shows Saved without a hint', () => {
    const state: ButtonState = { s: 'saved', folder: FOLDER, kind: 'pages', pages: 1 };
    expect(present(entry(state, { work: SINGLE }), META_ON)).toEqual({
      variant: 'saved',
      icon: 'check',
      label: m('btn_saved'),
      title: m('tip_saved', [FOLDER]),
      ariaLabel: m('aria_saved_pages_one', [FOLDER]),
      ...NOT_BUSY,
    });
  });

  it('present: saved ugoira shows the saved format', () => {
    const state: ButtonState = { s: 'saved', folder: UGOIRA_FOLDER, kind: 'ugoira', format: 'mp4' };
    expect(present(entry(state, { work: UGOIRA, format: 'zip' }), META_ON)).toEqual({
      variant: 'saved',
      icon: 'check',
      label: m('btn_saved'),
      hint: m('hint_format', ['MP4']),
      title: m('tip_saved', [UGOIRA_FOLDER]),
      ariaLabel: m('aria_saved_ugoira', ['MP4', UGOIRA_FOLDER]),
      ...NOT_BUSY,
    });
  });

  it('present: saved pages in a (1) folder carry the suffix verbatim in tip_saved and aria_saved_pages', () => {
    const folder = `${FOLDER} (1)`;
    const state: ButtonState = { s: 'saved', folder, kind: 'pages', pages: 12 };
    const p = present(entry(state), META_ON);
    expect([
      p.label,
      p.title,
      p.ariaLabel,
      p.title?.includes(folder),
      p.ariaLabel.includes(folder),
    ]).toEqual([
      m('btn_saved'),
      m('tip_saved', [folder]),
      m('aria_saved_pages', [12, folder]),
      true,
      true,
    ]);
  });

  it('present: a saved ugoira in a (1) folder carries the suffix verbatim in aria_saved_ugoira', () => {
    const folder = `${UGOIRA_FOLDER} (1)`;
    const state: ButtonState = { s: 'saved', folder, kind: 'ugoira', format: 'mp4' };
    const p = present(entry(state, { work: UGOIRA }), META_ON);
    expect([p.title, p.ariaLabel, p.title?.includes(folder), p.ariaLabel.includes(folder)]).toEqual(
      [m('tip_saved', [folder]), m('aria_saved_ugoira', ['MP4', folder]), true, true],
    );
  });

  it('present: needsLogin shows the neutral login pill without an icon', () => {
    expect(present(entry({ s: 'needsLogin' }), META_ON)).toEqual({
      variant: 'neutral',
      icon: null,
      label: m('btn_login'),
      title: m('tip_login'),
      ariaLabel: m('aria_login'),
      ...NOT_BUSY,
    });
  });

  it('present: a partial failure shows Retry · 3 failed', () => {
    const state: ButtonState = {
      s: 'error',
      err: { t: 'partial', folder: FOLDER, total: 12, saved: 9, failedPages: [3, 8, 10] },
    };
    expect(present(entry(state), META_ON)).toEqual({
      variant: 'error',
      icon: 'warning',
      label: m('btn_retry'),
      hint: m('hint_failed', [3]),
      title: m('tip_partial', [9, 12, 3]),
      ariaLabel: m('aria_partial', [9, 12, 3]),
      ...NOT_BUSY,
    });
  });

  it('present: a partial failure that lost metadata.json looks the same (R-007)', () => {
    const plain: ButtonState = {
      s: 'error',
      err: { t: 'partial', folder: FOLDER, total: 12, saved: 9, failedPages: [3, 8, 10] },
    };
    const flagged: ButtonState = {
      s: 'error',
      err: {
        t: 'partial',
        folder: FOLDER,
        total: 12,
        saved: 9,
        failedPages: [3, 8, 10],
        metadataFailed: true,
      },
    };
    expect(present(entry(flagged), META_ON)).toEqual(present(entry(plain), META_ON));
  });

  it('present: a single failed page uses tip_partial_one', () => {
    const state: ButtonState = {
      s: 'error',
      err: { t: 'partial', folder: FOLDER, total: 12, saved: 11, failedPages: [4] },
    };
    expect(present(entry(state), META_ON).title).toBe(m('tip_partial_one', [11, 12]));
  });

  it.each([
    ['offline', 'tip_offline'],
    ['refused', 'tip_refused'],
    ['server', 'tip_server'],
    ['disk', 'tip_disk'],
  ] as const)('present: error %s shows Retry with %s', (cause, tipKey) => {
    const state: ButtonState = { s: 'error', err: { t: 'cause', cause } };
    expect(present(entry(state), META_ON)).toEqual({
      variant: 'error',
      icon: 'warning',
      label: m('btn_retry'),
      title: m(tipKey),
      ariaLabel: m('aria_failed', [m(tipKey)]),
      ...NOT_BUSY,
    });
  });

  it('present: metadataOnly shows Retry with the metadata tooltip as its name', () => {
    const state: ButtonState = {
      s: 'error',
      err: { t: 'metadataOnly', folder: FOLDER, total: 12 },
    };
    expect(present(entry(state), META_ON)).toEqual({
      variant: 'error',
      icon: 'warning',
      label: m('btn_retry'),
      title: m('tip_metadata_only', [12]),
      ariaLabel: m('tip_metadata_only', [12]),
      ...NOT_BUSY,
    });
  });

  it('present: encodeFailed shows Retry · MP4', () => {
    const state: ButtonState = {
      s: 'error',
      err: { t: 'encodeFailed', folder: FOLDER, format: 'mp4' },
    };
    expect(present(entry(state, { work: UGOIRA }), META_ON)).toEqual({
      variant: 'error',
      icon: 'warning',
      label: m('btn_retry'),
      hint: m('hint_format', ['MP4']),
      title: m('tip_encode_failed'),
      ariaLabel: m('tip_encode_failed'),
      ...NOT_BUSY,
    });
  });

  it('present: unavailable is disabled with its tooltip as its name', () => {
    expect(present(entry({ s: 'unavailable' }), META_ON)).toEqual({
      variant: 'disabled',
      icon: null,
      label: m('btn_unavailable'),
      title: m('tip_unavailable'),
      ariaLabel: m('tip_unavailable'),
      ariaBusy: false,
      ariaDisabled: true,
    });
  });

  it('present: every row has filled-in copy (no missing key or placeholder)', () => {
    const percent = (phase: 'frames' | 'encode'): JobProgress => ({
      kind: 'percent',
      percent: 58,
      phase,
      indeterminate: false,
    });
    const rows: Entry[] = [
      createEntry('1'),
      entry({ s: 'idle' }),
      entry({ s: 'idle' }, { work: SINGLE }),
      entry({ s: 'idle' }, { work: UGOIRA, format: 'mp4' }),
      entry({ s: 'idle' }, { work: UGOIRA, format: 'zip' }),
      entry(busy({ kind: 'pages', done: 7, total: 12 })),
      entry(busy({ kind: 'pages', done: 0, total: 1 }), { work: SINGLE }),
      entry(busy(percent('frames')), { work: UGOIRA, format: 'mp4' }),
      entry(busy(percent('encode')), { work: UGOIRA, format: 'mp4' }),
      entry({ s: 'saved', folder: FOLDER, kind: 'pages', pages: 12 }),
      entry({ s: 'saved', folder: FOLDER, kind: 'pages', pages: 1 }, { work: SINGLE }),
      entry({ s: 'saved', folder: UGOIRA_FOLDER, kind: 'ugoira', format: 'webm' }),
      entry({ s: 'needsLogin' }),
      entry({
        s: 'error',
        err: { t: 'partial', folder: FOLDER, total: 12, saved: 9, failedPages: [1, 2, 3] },
      }),
      entry({
        s: 'error',
        err: { t: 'partial', folder: FOLDER, total: 12, saved: 11, failedPages: [1] },
      }),
      entry({ s: 'error', err: { t: 'cause', cause: 'disk' } }),
      entry({ s: 'error', err: { t: 'metadataOnly', folder: FOLDER, total: 12 } }),
      entry({ s: 'error', err: { t: 'encodeFailed', folder: FOLDER, format: 'webm' } }),
      entry({ s: 'unavailable' }),
    ];
    const texts = rows.flatMap((row) => {
      const p = present(row, META_ON);
      return [p.label, p.hint, p.title, p.ariaLabel, p.cancelFace?.label].filter(
        (text) => text !== undefined,
      );
    });
    expect(texts.filter((text) => text === '' || text.includes('$'))).toEqual([]);
  });
});

describe('present: English copy (PRD Appendix A)', () => {
  beforeEach(() => {
    stubChromeI18n('en');
  });

  it('present: idle reads Download · 12P with the full accessible name', () => {
    expect(present(entry({ s: 'idle' }), META_ON)).toMatchObject({
      label: 'Download',
      hint: '12P',
      ariaLabel: 'Download all 12 original images of this artwork',
    });
  });

  it('present: busy reads 7 / 12 with a Cancel download tooltip', () => {
    const p = present(entry(busy({ kind: 'pages', done: 7, total: 12 })), META_ON);
    expect(p).toMatchObject({
      label: '7 / 12',
      title: 'Cancel download',
      ariaLabel: 'Downloading, 7 of 12 pages saved. Click to cancel.',
      cancelFace: { label: 'Cancel' },
    });
  });

  it('present: busy encode reads 58% and names the format', () => {
    const progress: JobProgress = {
      kind: 'percent',
      percent: 58,
      phase: 'encode',
      indeterminate: false,
    };
    const p = present(entry(busy(progress), { work: UGOIRA, format: 'mp4' }), META_ON);
    expect(p).toMatchObject({
      label: '58%',
      ariaLabel: 'Encoding MP4, 58 percent. Click to cancel.',
    });
  });

  it('present: saved embeds Downloads/<folder> in the tooltip and the name', () => {
    const state: ButtonState = { s: 'saved', folder: FOLDER, kind: 'pages', pages: 12 };
    expect(present(entry(state), META_ON)).toMatchObject({
      label: 'Saved',
      hint: '12P',
      title: 'Saved to Downloads/pixiv/みずき-135882741',
      ariaLabel: 'Saved 12 pages to Downloads/pixiv/みずき-135882741. Click to download again.',
    });
  });

  it('present: saved ugoira embeds Downloads/<folder> in the name', () => {
    const state: ButtonState = { s: 'saved', folder: UGOIRA_FOLDER, kind: 'ugoira', format: 'mp4' };
    expect(present(entry(state, { work: UGOIRA }), META_ON).ariaLabel).toBe(
      'Saved MP4 to Downloads/pixiv/ひなた-136004512. Click to download again.',
    );
  });

  it('present: idle ugoira with metadata off omits the metadata', () => {
    const p = present(entry({ s: 'idle' }, { work: UGOIRA, format: 'mp4' }), META_OFF);
    expect(p.ariaLabel).toBe('Download this ugoira as MP4, with its frame zip');
  });

  it('present: partial failure copy matches CUJ-5 step 4', () => {
    const state: ButtonState = {
      s: 'error',
      err: { t: 'partial', folder: FOLDER, total: 12, saved: 9, failedPages: [3, 8, 10] },
    };
    expect(present(entry(state), META_ON)).toMatchObject({
      label: 'Retry',
      hint: '3 failed',
      title: '9 of 12 pages saved. 3 failed after 4 attempts each. Click to retry just those 3.',
      ariaLabel: '9 of 12 pages saved, 3 failed. Click to retry the failed pages.',
    });
  });

  it('present: a cause error embeds the tooltip in the accessible name', () => {
    const state: ButtonState = { s: 'error', err: { t: 'cause', cause: 'offline' } };
    expect(present(entry(state), META_ON).ariaLabel).toBe(
      "Download failed. No connection. Retry when you're back online. Click to retry.",
    );
  });

  it('present: needs-login copy matches CUJ-5 step 1', () => {
    expect(present(entry({ s: 'needsLogin' }), META_ON)).toMatchObject({
      label: 'Log in to download',
      title: 'Opens pixiv login and returns you here',
      ariaLabel: 'Log in to pixiv to download this work.',
    });
  });

  // R-003: also announced for a mid-job 403 on an all-ages work, so it no longer says R-18.
  it.each([
    ['en', 'Log in to pixiv to download this work.'],
    ['ja', 'この作品をダウンロードするには、pixivにログインしてください。'],
    ['zh_CN', '登录 pixiv 以下载此作品。'],
    ['zh_TW', '登入 pixiv 以下載此作品。'],
  ] as const)(
    'present: the needs-login accessible name in %s is the neutral R-003 text',
    (locale, text) => {
      stubChromeI18n(locale);
      expect(present(entry({ s: 'needsLogin' }), META_ON).ariaLabel).toBe(text);
    },
  );
});

describe('announcementFor', () => {
  beforeEach(() => {
    stubChromeI18n('en');
  });

  const pages = (done: number, total = 12): JobProgress => ({ kind: 'pages', done, total });
  const percent = (p: number): JobProgress => ({
    kind: 'percent',
    percent: p,
    phase: 'frames',
    indeterminate: false,
  });

  it('announcementFor: the start of a pages job says how many pages', () => {
    expect(announcementFor({ s: 'idle' }, entry(busy(pages(0))))).toEqual({
      kind: 'status',
      text: 'Downloading 12 pages',
    });
  });

  it('announcementFor: the start of a single-page job uses live_start_one', () => {
    expect(announcementFor({ s: 'idle' }, entry(busy(pages(0, 1))))?.text).toBe(
      'Downloading 1 page',
    );
  });

  it('announcementFor: a retry announces only the pages it fetches', () => {
    expect(announcementFor({ s: 'idle' }, entry(busy(pages(9))))?.text).toBe('Downloading 3 pages');
  });

  it('announcementFor: the start of an ugoira job uses live_start_ugoira', () => {
    expect(announcementFor({ s: 'idle' }, entry(busy(percent(0)), { work: UGOIRA }))?.text).toBe(
      'Downloading ugoira',
    );
  });

  it('announcementFor: a metadata-only retry has no start announcement', () => {
    expect(announcementFor({ s: 'idle' }, entry(busy(pages(12))))).toBeNull();
  });

  it('announcementFor: the start waits until the progress is known', () => {
    expect(announcementFor({ s: 'pending' }, entry(busy(null)))).toBeNull();
  });

  it('announcementFor: the first known progress counts as the start', () => {
    expect(announcementFor(busy(null), entry(busy(pages(0))))?.text).toBe('Downloading 12 pages');
  });

  it('announcementFor: page progress is a progress message', () => {
    expect(announcementFor(busy(pages(6)), entry(busy(pages(7))))).toEqual({
      kind: 'progress',
      text: '7 of 12 pages saved',
    });
  });

  it('announcementFor: percent progress is a progress message', () => {
    expect(announcementFor(busy(percent(40)), entry(busy(percent(58))))?.text).toBe('58 percent');
  });

  it('announcementFor: unchanged progress says nothing', () => {
    expect(announcementFor(busy(pages(7)), entry(busy(pages(7))))).toBeNull();
  });

  it.each<[string, ButtonState, Partial<Entry>, string]>([
    ['saved pages', { s: 'saved', folder: FOLDER, kind: 'pages', pages: 12 }, {}, 'Saved 12 pages'],
    [
      'saved single page',
      { s: 'saved', folder: FOLDER, kind: 'pages', pages: 1 },
      { work: SINGLE },
      'Saved 1 page',
    ],
    [
      'saved ugoira',
      { s: 'saved', folder: UGOIRA_FOLDER, kind: 'ugoira', format: 'webm' },
      { work: UGOIRA },
      'Saved WebM',
    ],
    [
      'partial',
      {
        s: 'error',
        err: { t: 'partial', folder: FOLDER, total: 12, saved: 9, failedPages: [3, 8, 10] },
      },
      {},
      '3 pages failed',
    ],
    [
      'partial single',
      { s: 'error', err: { t: 'partial', folder: FOLDER, total: 12, saved: 11, failedPages: [3] } },
      {},
      '1 page failed',
    ],
    [
      'cause',
      { s: 'error', err: { t: 'cause', cause: 'refused' } },
      {},
      "pixiv refused this work. If you're logged in, check your R-18 setting on pixiv.",
    ],
    [
      'metadataOnly',
      { s: 'error', err: { t: 'metadataOnly', folder: FOLDER, total: 12 } },
      {},
      "All 12 pages saved. metadata.json couldn't be saved. Click to retry it.",
    ],
    [
      'encodeFailed',
      { s: 'error', err: { t: 'encodeFailed', folder: FOLDER, format: 'mp4' } },
      { work: UGOIRA },
      'Frames saved as ZIP. Video encoding failed. Click to retry the encode, or choose ZIP only in settings.',
    ],
    ['cancelled', { s: 'idle' }, {}, 'Download cancelled'],
    ['needsLogin', { s: 'needsLogin' }, {}, 'Log in to pixiv to download this work.'],
    ['unavailable', { s: 'unavailable' }, {}, 'This work is no longer available.'],
  ])('announcementFor: the end state %s is always announced', (_, state, overrides, text) => {
    expect(announcementFor(busy(pages(5)), entry(state, overrides))).toEqual({
      kind: 'status',
      text,
    });
  });

  it('announcementFor: a state change outside a job says nothing', () => {
    expect(announcementFor({ s: 'pending' }, entry({ s: 'needsLogin' }))).toBeNull();
  });
});
