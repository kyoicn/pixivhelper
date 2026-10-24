// CUJ-2 "Download an ugoira" end to end (task 4.3): the button, the SW engine, the offscreen
// encoder (WebCodecs + mediabunny) and chrome.downloads in Playwright's Chromium against the fake
// pixiv's ugoira fixtures 136004512–136004517. The pill lives in a closed shadow root, so the spec
// reads it through a main-world reference to that root obtained over CDP (exposePill), and a
// MutationObserver records every state it shows with page-clock timestamps.
//
// 136004516 (corrupt frame → `Retry · MP4`) is CUJ-5's encode-failure fixture and is not used here.
//
// AC → test (docs/prd/prd-000-mvp.md CUJ-2 "Acceptance Criteria"; "eng" rows are the engineering
// checks of design-test-harness.md "Acceptance-criteria mapping"):
// - Idle label `Download · MP4` / `WebM` / `ZIP` matching the setting
//     → "idle: Download · MP4 …" (gated on H.264), "idle: Download · WebM and Download · ZIP …"
//       (also step 1: a change in another tab shows within 1 s)
// - … or WebM when H.264 can't be encoded; hint, Saved label and extension say WebM
//     → "no H.264 …" (the probe result is seeded as avc: null in the caps cache)
// - 176 px in English in idle, busy, Cancel-hover and Saved; the Ugoira output never changes it
//   (R-004 S1) → "width: 176 px …", "idle: Download · WebM and Download · ZIP …"
// - Busy label is an integer percent, never decreases, no 100% before the last file lands
//     → every job test (expectPercentRule); ≥ 1 update/s during the encode → "long ugoira …"
// - Badge `1` for the whole job, gone when it ends → "example …", "long ugoira …", "ZIP only …";
//   its tooltip (step 2) → "badge tooltip …"
// - Folder holds exactly the zip, frames.json, the MP4 and metadata.json (when enabled); no frames
//   folder → "example …", "metadata off …" (also ZIP only, cancel, tab close, no Content-Length)
// - Zip byte-identical to originalSrc; frames.json equals ugoira_meta.body.frames
//     → "example …", "ZIP only …", "no Content-Length …"
// - Duration = Σ delays, frame count and per-frame durations within ±1 ms (@ffprobe)
//     → "timing …" (136004513, MP4 gated; WebM too), "quality …" (136004512)
// - Width × height = frame size rounded down to even (@ffprobe)
//     → "odd size …" (136004514 → 600×450), "quality …" (600×600)
// - Plays in Chrome, VLC, QuickTime → Chrome: "example …" decodes and plays it in a <video>;
//   VLC and QuickTime: L5 (manual release checklist)
// - ZIP only: zip + frames.json + metadata.json, no video, `Saved · ZIP` → "ZIP only …"
// - Cancel during the encode: no .mp4/.webm, zip and frames.json stay → "cancel during the encode …"
// - Closing the tab during the encode still produces the video → "closing the tab …"
// - eng: SSIM mean ≥ 0.98 and min ≥ 0.95 (@ffprobe) → "quality …" (MP4 gated, and WebM)
// - eng: no Content-Length → `0%` and the rotating 25 % arc until the encode → "no Content-Length …"
// - Edge case (also CUJ-3 "a running download keeps its settings"): switching Ugoira output
//   mid-job keeps the running job's format; the next click uses the new one → "mid-job …"
//
// Gating: MP4-specific tests skip with a logged reason when the offscreen codec probe reports
// `avc: null` (WebM always runs). ffprobe()/ssim() skip their (@ffprobe) test without the tool.

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
import { CAPS_KEY_PREFIX, CLICK_GUARD_MS, SETTINGS_KEY } from '../src/shared/constants';
import type { CodecCaps } from '../src/shared/messages';
import { DEFAULT_SETTINGS, type StoredSettings } from '../src/shared/settings';
import type { Settings, UgoiraOutput } from '../src/shared/types';
import { ugoiraFrames, ugoiraZip } from './fixtures/assets';
import { artworkUrl, requireWork, ugoiraZipUrl, type UgoiraWork } from './fixtures/works';
import { restingView } from './harness/flows';
import { clickButton, exposeButton, hoverButton, waitForText } from './harness/hfp-button';
import type { Harness } from './harness/launch';
import {
  ffprobe,
  requireMediaTool,
  ssim,
  type FfprobeFrame,
  type FfprobeResult,
} from './harness/media';
import { expect, test } from './harness/test';
import { ugoiraMetaBody } from './server/ajax';

// ── Fixtures ──

function ugoiraWork(id: string): UgoiraWork {
  const work = requireWork(id);
  if (work.illustType !== 2) throw new Error(`fixture ${id} is not an ugoira`);
  return work;
}

/** 600×600, 48 JPEG frames × 100 ms: the PRD's example. */
const EXAMPLE = ugoiraWork('136004512');
/** Delays 40, 40, 500, 40 ms. */
const TIMING = ugoiraWork('136004513');
/** 601×451 frames. */
const ODD = ugoiraWork('136004514');
/** The zip is served without Content-Length. */
const NO_LENGTH = ugoiraWork('136004515');
/** 1920×1080, 300 frames: the longest encode. */
const LONG = ugoiraWork('136004517');

type VideoFormat = Exclude<UgoiraOutput, 'zip'>;

const FORMAT_LABEL: Readonly<Record<UgoiraOutput, string>> = {
  mp4: 'MP4',
  webm: 'WebM',
  zip: 'ZIP',
};
const CODEC_NAME: Readonly<Record<VideoFormat, string>> = { mp4: 'h264', webm: 'vp9' };
const HOST = 'hfp-download';
/** Ring geometry of src/content/button/styles.ts (r = 8). */
const RING_CIRCUMFERENCE = 2 * Math.PI * 8;
/** PRD §4.7.5: the indeterminate arc covers 25 % of the circle. */
const INDETERMINATE_ARC = 0.25;
/** PRD CUJ-2 step 3: the percentage updates at least once per second during the encode. */
const ENCODE_UPDATE_MAX_GAP_MS = 1000;
/** PRD CUJ-2 step 4: after a cancel the button is idle again within 300 ms. */
const CANCEL_IDLE_MS = 300;
/** PRD CUJ-2 step 1 / CUJ-4: the idle hint and the badge follow changes within 1 s. */
const FOLLOW_MS = 1000;
const JOB_TIMEOUT_MS = 60_000;
const DURATION_TOLERANCE_MS = 1;
/**
 * CPU slowdown of the offscreen document once its encode runs: stretches the 1080p encode (about
 * 1 s with a hardware encoder) so a cancel lands inside it after the click guard, and so the
 * update rate is measured over several seconds, as on a slow machine.
 */
const ENCODE_SLOWDOWN = 4;

const execFileAsync = promisify(execFile);

/** The default pattern `pixiv/{artist}-{id}`; ひなた needs no sanitizing. */
function folderOf(work: UgoiraWork): string {
  return `pixiv/${work.userName}-${work.id}`;
}

function zipPath(work: UgoiraWork): string {
  return `${folderOf(work)}/${work.id}_ugoira.zip`;
}

function videoPath(work: UgoiraWork, format: VideoFormat): string {
  return `${folderOf(work)}/${work.id}.${format}`;
}

/**
 * The folder after a full job: the zip, frames.json, the video unless `format` is ZIP only, and
 * metadata.json unless it is turned off. Sorted, like downloads.files().
 */
function expectedPaths(work: UgoiraWork, format: UgoiraOutput, metadata = true): string[] {
  const folder = folderOf(work);
  const paths = [`${folder}/frames.json`, zipPath(work)];
  if (metadata) paths.push(`${folder}/metadata.json`);
  if (format !== 'zip') paths.push(videoPath(work, format));
  return paths.sort();
}

function sumOfDelays(work: UgoiraWork): number {
  return work.frameDelays.reduce((sum, delay) => sum + delay, 0);
}

// ── Settings and codec probe ──

async function setSettings(harness: Harness, changes: Partial<Settings>): Promise<void> {
  const record: StoredSettings = { v: 1, ...DEFAULT_SETTINGS, ...changes, updatedAt: Date.now() };
  // The options page writes the same record to both areas (src/shared/settings.ts writeSettings).
  await harness.swEval(
    async ({ key, value }) => {
      await chrome.storage.sync.set({ [key]: value });
      await chrome.storage.local.set({ [key]: value });
    },
    { key: SETTINGS_KEY, value: record },
  );
}

function setUgoiraOutput(harness: Harness, ugoiraOutput: UgoiraOutput): Promise<void> {
  return setSettings(harness, { ugoiraOutput });
}

function capsKey(work: UgoiraWork): string {
  const even = (n: number) => n - (n % 2);
  return `${CAPS_KEY_PREFIX}${even(work.width)}x${even(work.height)}`;
}

/** The offscreen codec probe's answer for `work`, cached by the SW once the page asked for it. */
async function probeResult(harness: Harness, work: UgoiraWork): Promise<CodecCaps> {
  const key = capsKey(work);
  const read = () =>
    harness.swEval(
      async (k) => (await chrome.storage.session.get(k))[k] as CodecCaps | undefined,
      key,
    );
  await expect.poll(read, { message: `codec probe for ${key}` }).toBeDefined();
  const caps = (await read()) as CodecCaps;
  test.info().annotations.push({
    type: 'codec probe',
    description: `${key}: avc ${caps.avc ?? 'null'}, vp9 ${String(caps.vp9)}`,
  });
  return caps;
}

/** Skips the calling test, with a logged reason, when H.264 cannot be encoded here. */
function requireAvc(caps: CodecCaps, work: UgoiraWork): void {
  if (caps.avc !== null) return;
  const reason = `the codec probe reports avc: null for ${capsKey(work)} in this Chromium; MP4 checks are covered by L5, WebM runs instead`;
  console.log(`skipped: ${reason}`);
  test.skip(true, reason);
}

function requireVp9(caps: CodecCaps, work: UgoiraWork): void {
  if (caps.vp9) return;
  const reason = `the codec probe reports vp9: false for ${capsKey(work)} in this Chromium`;
  console.log(`skipped: ${reason}`);
  test.skip(true, reason);
}

/** What the default setting (MP4) produces here: MP4, or WebM without H.264. */
function defaultVideo(caps: CodecCaps, work: UgoiraWork): VideoFormat {
  if (caps.avc !== null) return 'mp4';
  requireVp9(caps, work);
  return 'webm';
}

// ── Offscreen document ──

/**
 * Slows the offscreen document's main thread `rate` times (CDP Emulation.setCPUThrottlingRate).
 * Playwright does not attach to offscreen documents, so this opens its own flat CDP session; the
 * throttling holds until the returned function closes it.
 */
async function slowOffscreen(harness: Harness, rate: number): Promise<() => void> {
  const url = `chrome-extension://${harness.extensionId}/offscreen.html`;
  const { targetInfos } = await harness.cdp.send('Target.getTargets');
  const target = targetInfos.find((info) => info.type === 'background_page' && info.url === url);
  if (!target) throw new Error('slowOffscreen: no offscreen document');
  const socket = new WebSocket(harness.wsEndpoint);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('slowOffscreen: no CDP connection')), {
      once: true,
    });
  });
  let lastId = 0;
  const send = (method: string, params: object, sessionId?: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++lastId;
      const onMessage = (event: { data: unknown }): void => {
        const message = JSON.parse(String(event.data)) as {
          id?: number;
          result?: Record<string, unknown>;
          error?: { message: string };
        };
        if (message.id !== id) return;
        socket.removeEventListener('message', onMessage);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result ?? {});
      };
      socket.addEventListener('message', onMessage);
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  try {
    const { sessionId } = await send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    await send('Emulation.setCPUThrottlingRate', { rate }, String(sessionId));
  } catch (error) {
    socket.close();
    throw error;
  }
  return () => socket.close();
}

// ── The pill (closed shadow root) ──

interface RingState {
  indeterminate: boolean;
  /** The bar's stroke-dashoffset: C × (1 − shown fraction). */
  offset: number;
  animationName: string;
  animationDuration: string;
  animationIterationCount: string;
}

interface PillState {
  label: string;
  /** The text after the `·`, or null when no hint is shown. */
  hint: string | null;
  /** `label · hint` as the user reads it. */
  text: string;
  aria: string;
  title: string | null;
  busy: boolean;
  ring: RingState | null;
}

interface PillSample extends PillState {
  /** performance.now() in the page. */
  at: number;
}

/** Main-world globals this spec installs on the artwork page. */
interface PillWindow {
  __cuj2Read?: () => PillState;
  __cuj2Samples?: PillSample[];
  /** performance.now() of every click that reached the button host. */
  __cuj2Clicks?: number[];
}

/**
 * Hands the main world a reference to the button's closed shadow root (CDP resolves nodes across
 * shadow boundaries), then installs a reader and a recorder of every distinct state.
 */
async function exposePill(page: Page): Promise<void> {
  await page.locator(HOST).waitFor({ state: 'attached' });
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: HOST,
    });
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: 1, pierce: true });
    const shadow = node.shadowRoots?.[0];
    if (!shadow) throw new Error(`${HOST} has no shadow root`);
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: shadow.backendNodeId });
    if (!object.objectId) throw new Error('the shadow root did not resolve to an object');
    await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function () { window.__cuj2Shadow = this; }',
    });
  } finally {
    await cdp.detach();
  }
  await page.evaluate((host) => {
    const w = window as unknown as PillWindow & { __cuj2Shadow: ShadowRoot };
    const root = w.__cuj2Shadow;
    const pill = root.querySelector<HTMLButtonElement>('button.pill:not(.measure)');
    const face = pill?.querySelector<HTMLElement>('.face-main');
    if (!pill || !face) throw new Error('no pill in the shadow root');
    const read = (): PillState => {
      const label = face.querySelector('.label')?.textContent ?? '';
      const hintEl = face.querySelector<HTMLElement>('.hint');
      const hint = hintEl && !hintEl.hidden ? (hintEl.textContent ?? '') : null;
      const svg = face.querySelector<SVGElement>('svg.ring');
      const bar = svg?.querySelector<SVGElement>('.bar');
      const style = svg ? getComputedStyle(svg) : null;
      return {
        label,
        hint,
        text: hint === null ? label : `${label} · ${hint}`,
        aria: pill.getAttribute('aria-label') ?? '',
        title: pill.getAttribute('title'),
        busy: pill.getAttribute('aria-busy') === 'true',
        ring:
          svg && style
            ? {
                indeterminate: svg.classList.contains('indeterminate'),
                offset: Number.parseFloat(bar?.style.getPropertyValue('stroke-dashoffset') ?? ''),
                animationName: style.animationName,
                animationDuration: style.animationDuration,
                animationIterationCount: style.animationIterationCount,
              }
            : null,
      };
    };
    const samples: PillSample[] = [];
    const record = (): void => {
      const state = read();
      const last = samples.at(-1);
      if (
        last &&
        last.text === state.text &&
        last.aria === state.aria &&
        last.busy === state.busy &&
        last.ring?.indeterminate === state.ring?.indeterminate
      ) {
        return;
      }
      samples.push({ ...state, at: performance.now() });
    };
    w.__cuj2Read = read;
    w.__cuj2Samples = samples;
    w.__cuj2Clicks = [];
    record();
    new MutationObserver(record).observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    document.addEventListener(
      'click',
      (event) => {
        if (event.target instanceof Element && event.target.localName === host) {
          w.__cuj2Clicks?.push(performance.now());
        }
      },
      true,
    );
  }, HOST);
}

function readPill(page: Page): Promise<PillState> {
  return page.evaluate(() => {
    const read = (window as unknown as PillWindow).__cuj2Read;
    if (!read) throw new Error('exposePill() has not run on this page');
    return read();
  });
}

/** The host's rendered width in px (PRD §4.7.2: fixed per artwork, whatever the format). */
function pillWidth(page: Page): Promise<number> {
  return page.locator(HOST).evaluate((host) => host.getBoundingClientRect().width);
}

function pillSamples(page: Page): Promise<PillSample[]> {
  return page.evaluate(() => [...((window as unknown as PillWindow).__cuj2Samples ?? [])]);
}

function pillClicks(page: Page): Promise<number[]> {
  return page.evaluate(() => [...((window as unknown as PillWindow).__cuj2Clicks ?? [])]);
}

/** Opens the artwork and waits for the idle pill with its format hint. */
async function openArtwork(harness: Harness, work: UgoiraWork): Promise<Page> {
  const page = await harness.newPage();
  await page.goto(artworkUrl(work.id));
  await exposePill(page);
  await expect
    .poll(async () => (await readPill(page)).hint, { message: 'idle format hint' })
    .not.toBeNull();
  return page;
}

/** Waits until the pill shows the encode phase (`Encoding <format>, N percent …`). */
async function waitForEncoding(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as PillWindow).__cuj2Read?.().aria.startsWith('Encoding ') === true,
    undefined,
    { polling: 10, timeout: JOB_TIMEOUT_MS },
  );
}

interface BadgeSample {
  /** Date.now() in the test process. */
  at: number;
  text: string;
}

interface JobRun {
  /** Pill states from the click to the end state, in order (the last one is the end state). */
  samples: PillSample[];
  /** Badge texts read while the pill was busy (each read before the busy check). */
  badges: BadgeSample[];
  clickedAt: number;
  end: PillState;
}

/** Clicks the idle pill and waits for the job to end, sampling the toolbar badge meanwhile. */
async function runJob(
  harness: Harness,
  page: Page,
  { onEncoding }: { onEncoding?: () => Promise<void> } = {},
): Promise<JobRun> {
  const before = (await pillSamples(page)).length;
  const clickedAt = Date.now();
  await page.locator(HOST).click();
  const badges: BadgeSample[] = [];
  const deadline = clickedAt + JOB_TIMEOUT_MS;
  let encoding = false;
  for (;;) {
    const text = await harness.swEval(() => chrome.action.getBadgeText({}));
    const at = Date.now();
    const state = await readPill(page);
    if (!state.busy) break;
    badges.push({ at, text });
    if (!encoding && state.aria.startsWith('Encoding ')) {
      encoding = true;
      await onEncoding?.();
    }
    if (at > deadline) throw new Error(`the job did not end within ${JOB_TIMEOUT_MS} ms`);
  }
  const samples = (await pillSamples(page)).slice(before);
  const end = samples.at(-1);
  if (!end) throw new Error('no pill state recorded');
  return { samples, badges, clickedAt, end };
}

/** PRD §4.7.5: an integer percent while busy, never decreasing, and no `100%` before the end. */
function expectPercentRule(samples: readonly PillSample[]): number[] {
  const busy = samples.filter((sample) => sample.busy);
  expect(busy.length, 'busy states recorded').toBeGreaterThan(0);
  for (const sample of busy) expect(sample.label, 'busy label').toMatch(/^\d{1,3}%$/);
  const percents = busy.map((sample) => Number.parseInt(sample.label, 10));
  expect(percents, 'the percentage never decreases').toEqual([...percents].sort((a, b) => a - b));
  expect(Math.max(...percents), 'no 100% while busy').toBeLessThan(100);
  const last = samples.at(-1);
  expect(last?.busy, 'the end state is not busy').toBe(false);
  return percents;
}

/** PRD CUJ-2: `1` while the job runs (after the first render), then gone within 1 s of the end. */
async function expectBadgeOne(harness: Harness, run: JobRun): Promise<void> {
  const first = run.badges.findIndex((badge) => badge.text === '1');
  expect(first, `badge texts while busy: ${run.badges.map((b) => b.text).join(',')}`).not.toBe(-1);
  const shownAt = run.badges[first]?.at ?? Number.POSITIVE_INFINITY;
  expect(shownAt - run.clickedAt, 'badge shown within 1 s of the click').toBeLessThanOrEqual(
    FOLLOW_MS,
  );
  expect(
    run.badges.slice(0, first).every((badge) => badge.text === ''),
    'nothing but an empty badge before it shows 1',
  ).toBe(true);
  expect(
    run.badges.slice(first).map((badge) => badge.text),
    'badge stays 1 for the whole job',
  ).toEqual(run.badges.slice(first).map(() => '1'));
  await expect
    .poll(() => harness.swEval(() => chrome.action.getBadgeText({})), { timeout: FOLLOW_MS })
    .toBe('');
}

// ── Files ──

async function readDownload(harness: Harness, relative: string): Promise<Buffer> {
  return readFile(path.join(harness.downloads.dir, relative));
}

async function filePaths(harness: Harness): Promise<string[]> {
  return (await harness.downloads.files()).map((file) => file.path);
}

/** The zip is byte-identical to originalSrc and frames.json equals ugoira_meta.body.frames. */
async function expectFidelity(harness: Harness, work: UgoiraWork): Promise<void> {
  const zip = await readDownload(harness, zipPath(work));
  expect(zip.equals(Buffer.from(ugoiraZip(work))), 'zip byte-identical to originalSrc').toBe(true);
  const frames: unknown = JSON.parse(
    (await readDownload(harness, `${folderOf(work)}/frames.json`)).toString('utf8'),
  );
  expect(frames).toEqual(ugoiraMetaBody(work).frames);
}

/** Resolves once the SW holds no job record any more (nothing can be handed to Chrome after). */
async function waitForNoJobs(harness: Harness): Promise<void> {
  await expect
    .poll(
      () =>
        harness.swEval(async () =>
          Object.keys(await chrome.storage.session.get(null)).filter((key) =>
            key.startsWith('job:'),
          ),
        ),
      { timeout: JOB_TIMEOUT_MS, message: 'job records in storage.session' },
    )
    .toEqual([]);
}

function videoFrames(probe: FfprobeResult): FfprobeFrame[] {
  return probe.frames.filter((frame) => frame.media_type === 'video');
}

/** An ffprobe time in seconds as ms; NaN when absent. */
function ms(seconds: string | undefined): number {
  return seconds === undefined ? Number.NaN : Number(seconds) * 1000;
}

/** The container's duration (MP4 movie, WebM segment). Call after ffprobe(), which gates the tool. */
async function containerDurationMs(file: string): Promise<number> {
  const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file];
  const { stdout } = await execFileAsync('ffprobe', args);
  return ms(stdout.trim());
}

/**
 * PRD §4.6 timing as frame stepping sees it: one video frame per ugoira frame; frame i starts at
 * Σ delay₀…delayᵢ₋₁ and is shown for delayᵢ (until the next frame, the last one until the end of
 * the container), each within ±1 ms. A per-frame duration the container stores must agree too.
 * Also the codec and the size.
 */
async function expectVideo(
  harness: Harness,
  work: UgoiraWork,
  format: VideoFormat,
  size: { width: number; height: number },
): Promise<void> {
  const file = path.join(harness.downloads.dir, videoPath(work, format));
  const probe = await ffprobe(file);
  const streams = probe.streams.filter((stream) => stream.codec_type === 'video');
  expect(streams).toHaveLength(1);
  const [stream] = streams;
  expect(stream?.codec_name).toBe(CODEC_NAME[format]);
  expect({ width: stream?.width, height: stream?.height }).toEqual(size);

  const frames = videoFrames(probe);
  const delays = work.frameDelays;
  expect(frames, 'one video frame per ugoira frame').toHaveLength(delays.length);
  const endMs = await containerDurationMs(file);
  expect(
    Math.abs(endMs - sumOfDelays(work)),
    `container duration ${endMs} ms, Σ delays ${sumOfDelays(work)} ms`,
  ).toBeLessThanOrEqual(DURATION_TOLERANCE_MS * delays.length);
  const starts = frames.map((frame) => ms(frame.best_effort_timestamp_time ?? frame.pts_time));
  let expectedStart = 0;
  frames.forEach((frame, i) => {
    const delay = delays[i] ?? Number.NaN;
    const start = starts[i] ?? Number.NaN;
    const shown = (starts[i + 1] ?? endMs) - start;
    expect(Math.abs(start - expectedStart), `frame ${i} starts at ${start} ms`).toBeLessThanOrEqual(
      DURATION_TOLERANCE_MS,
    );
    expect(
      Math.abs(shown - delay),
      `frame ${i} is shown ${shown} ms, listed ${delay} ms`,
    ).toBeLessThanOrEqual(DURATION_TOLERANCE_MS);
    const stored = ms(frame.duration_time ?? frame.pkt_duration_time);
    if (!Number.isNaN(stored)) {
      expect(
        Math.abs(stored - delay),
        `frame ${i} stores ${stored} ms, listed ${delay} ms`,
      ).toBeLessThanOrEqual(DURATION_TOLERANCE_MS);
    }
    expectedStart += delay;
  });
}

/** Source frames on disk, in order, for ssim(). */
async function writeSourceFrames(work: UgoiraWork): Promise<string[]> {
  const dir = test.info().outputPath('source-frames');
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const frame of ugoiraFrames(work)) {
    const file = path.join(dir, frame.file);
    await writeFile(file, frame.bytes);
    files.push(file);
  }
  return files;
}

async function expectQuality(harness: Harness, work: UgoiraWork, format: VideoFormat) {
  const video = path.join(harness.downloads.dir, videoPath(work, format));
  const result = await ssim(video, await writeSourceFrames(work));
  test.info().annotations.push({
    type: 'ssim',
    description: `${format}: mean ${result.mean.toFixed(4)}, min ${result.min.toFixed(4)}`,
  });
  expect(result.perFrame).toHaveLength(work.frameDelays.length);
  expect(result.mean, 'SSIM mean').toBeGreaterThanOrEqual(0.98);
  expect(result.min, 'SSIM min').toBeGreaterThanOrEqual(0.95);
}

/** Loads the video into a <video> on `page`: metadata, first frame decoded, and playback starts. */
async function playInChrome(page: Page, bytes: Buffer, type: string) {
  return page.evaluate(
    async ({ base64, mime }) => {
      const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const video = document.createElement('video');
      video.muted = true;
      const loaded = new Promise<void>((resolve, reject) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true });
        video.addEventListener(
          'error',
          () => reject(new Error(`video error ${video.error?.code}: ${video.error?.message}`)),
          { once: true },
        );
      });
      video.src = URL.createObjectURL(new Blob([data], { type: mime }));
      await loaded;
      await video.play();
      await new Promise<void>((resolve) => {
        const check = () => (video.currentTime > 0 ? resolve() : requestAnimationFrame(check));
        check();
      });
      video.pause();
      return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
    },
    { base64: bytes.toString('base64'), mime: type },
  );
}

// ── Tests ──

test.describe('CUJ-2: download an ugoira', { tag: '@cuj2' }, () => {
  test('idle: Download · MP4 with the MP4 aria-label under the default setting', async ({
    harness,
  }) => {
    const page = await openArtwork(harness, EXAMPLE);
    requireAvc(await probeResult(harness, EXAMPLE), EXAMPLE);
    const pill = await readPill(page);
    expect(pill.text).toBe('Download · MP4');
    expect(pill.aria).toBe('Download this ugoira as MP4, with its frame zip and metadata');
    expect(pill.busy).toBe(false);
  });

  test('idle: Download · WebM and Download · ZIP follow the setting, also when it changes in another tab', async ({
    harness,
  }) => {
    await setUgoiraOutput(harness, 'webm');
    const page = await openArtwork(harness, EXAMPLE);
    requireVp9(await probeResult(harness, EXAMPLE), EXAMPLE);
    let pill = await readPill(page);
    expect(pill.text).toBe('Download · WebM');
    expect(pill.aria).toBe('Download this ugoira as WebM, with its frame zip and metadata');
    // Every format's faces are width candidates, so a format change never resizes the pill; in
    // English it is 176 px for every ugoira (PRD §4.7.2, CUJ-2 AC, since R-004 S1).
    const width = await pillWidth(page);
    expect(width).toBe(176);

    await setUgoiraOutput(harness, 'zip');
    await expect
      .poll(async () => (await readPill(page)).text, { timeout: FOLLOW_MS })
      .toBe('Download · ZIP');
    pill = await readPill(page);
    expect(pill.aria).toBe("Download this ugoira's frame zip");
    expect(await pillWidth(page)).toBe(width);

    await setUgoiraOutput(harness, 'webm');
    await expect
      .poll(async () => (await readPill(page)).text, { timeout: FOLLOW_MS })
      .toBe('Download · WebM');
    expect(await pillWidth(page)).toBe(width);
  });

  test('width: 176 px in idle, busy, Cancel-hover and Saved, never changing', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE);
    const label = FORMAT_LABEL[defaultVideo(await probeResult(harness, EXAMPLE), EXAMPLE)];
    await exposeButton(page);
    await page.evaluate((host) => {
      const el = document.querySelector(host);
      const w = window as unknown as { __hfpWidths: number[] };
      w.__hfpWidths = [];
      if (el) {
        new ResizeObserver(() => w.__hfpWidths.push(el.getBoundingClientRect().width)).observe(el);
      }
    }, HOST);
    const idle = await restingView(page);
    expect([idle.text, idle.width]).toEqual([`Download · ${label}`, 176]);

    // The zip trickles until released, so the job stays busy.
    const hold = server.hold(ugoiraZipUrl(EXAMPLE));
    await clickButton(page);
    await expect.poll(() => hold.held).toBe(1);
    const busy = await restingView(page);
    expect([busy.glyph, busy.width]).toEqual(['ring', 176]);

    // The Cancel face shows once the pointer has left after the starting click.
    await hoverButton(page, true);
    expect((await waitForText(page, 'Cancel')).width).toBe(176);

    hold.release();
    await hoverButton(page, false);
    const saved = await waitForText(page, `Saved · ${label}`, { timeout: JOB_TIMEOUT_MS });
    expect(saved.width).toBe(176);

    const widths = await page.evaluate(
      () => (window as unknown as { __hfpWidths: number[] }).__hfpWidths,
    );
    expect([...new Set(widths)]).toEqual([176]);
  });

  test('example (136004512) as MP4: percent, badge 1, Saved · MP4, exact folder, identical zip and frames.json, plays in Chrome', async ({
    harness,
  }) => {
    const page = await openArtwork(harness, EXAMPLE);
    requireAvc(await probeResult(harness, EXAMPLE), EXAMPLE);
    const run = await runJob(harness, page);

    expectPercentRule(run.samples);
    expect(
      run.samples.some((sample) =>
        /^Encoding MP4, \d+ percent\. Click to cancel\.$/.test(sample.aria),
      ),
      'busy aria-label during the encode',
    ).toBe(true);
    expect(
      run.samples.some((sample) =>
        /^Downloading frames, \d+ percent\. Click to cancel\.$/.test(sample.aria),
      ),
      'busy aria-label during the zip fetch',
    ).toBe(true);
    await expectBadgeOne(harness, run);

    const folder = folderOf(EXAMPLE);
    expect(run.end.text).toBe('Saved · MP4');
    expect(run.end.title).toBe(`Saved to Downloads/${folder}`);
    expect(run.end.aria).toBe(`Saved MP4 to Downloads/${folder}. Click to download again.`);

    expect(await filePaths(harness)).toEqual(expectedPaths(EXAMPLE, 'mp4'));
    await expectFidelity(harness, EXAMPLE);

    const played = await playInChrome(
      page,
      await readDownload(harness, videoPath(EXAMPLE, 'mp4')),
      'video/mp4',
    );
    expect({ width: played.width, height: played.height }).toEqual({ width: 600, height: 600 });
    expect(Math.abs(played.duration * 1000 - sumOfDelays(EXAMPLE))).toBeLessThanOrEqual(
      DURATION_TOLERANCE_MS * EXAMPLE.frameDelays.length,
    );
  });

  test('badge tooltip while the job runs: Helper for Pixiv — 1 file remaining', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE);
    // Hold the zip so the job is surely running while the title is read.
    server.fault({ match: ugoiraZipUrl(EXAMPLE), responses: [{ delayHeadersMs: 1000 }] });
    await page.locator(HOST).click();
    await server.waitForRequest(ugoiraZipUrl(EXAMPLE));
    await expect
      .poll(() => harness.swEval(() => chrome.action.getBadgeText({})), { timeout: FOLLOW_MS })
      .toBe('1');
    expect(await harness.swEval(() => chrome.action.getTitle({}))).toBe(
      'Helper for Pixiv — 1 file remaining',
    );
    await expect
      .poll(async () => (await readPill(page)).busy, { timeout: JOB_TIMEOUT_MS })
      .toBe(false);
  });

  test('long ugoira (136004517): percent never decreases, no 100% early, ≥ 1 update/s during the encode, badge 1', async ({
    harness,
  }) => {
    test.slow(); // 300 frames at 1080p: tens of seconds with a software encoder
    const page = await openArtwork(harness, LONG);
    const format = defaultVideo(await probeResult(harness, LONG), LONG);
    const restores: Array<() => void> = [];
    const run = await runJob(harness, page, {
      onEncoding: async () => {
        restores.push(await slowOffscreen(harness, ENCODE_SLOWDOWN));
      },
    }).finally(() => restores.forEach((restore) => restore()));
    expect(restores, 'the encode was slowed down once it started').toHaveLength(1);

    const percents = expectPercentRule(run.samples);
    expect(percents[0], 'starts at 0%').toBe(0);
    await expectBadgeOne(harness, run);
    expect(run.end.text).toBe(`Saved · ${FORMAT_LABEL[format]}`);

    // From the first encode-phase render to the end state: no gap above 1 s between updates of
    // the percentage (the end state counts as the last update).
    const start = run.samples.findIndex((sample) => sample.aria.startsWith('Encoding '));
    expect(start, 'an encode-phase state was shown').not.toBe(-1);
    const encode = run.samples.slice(start);
    const updates = encode.filter((sample, i) => i === 0 || sample.label !== encode[i - 1]?.label);
    const gaps = updates.slice(1).map((sample, i) => sample.at - (updates[i]?.at ?? sample.at));
    test.info().annotations.push({
      type: 'encode updates',
      description: `${updates.length} updates over ${Math.round((updates.at(-1)?.at ?? 0) - (updates[0]?.at ?? 0))} ms, gaps ${gaps.map(Math.round).join(', ')} ms`,
    });
    expect(Math.max(0, ...gaps), 'longest gap between updates').toBeLessThanOrEqual(
      ENCODE_UPDATE_MAX_GAP_MS,
    );
    expect(await filePaths(harness)).toEqual(expectedPaths(LONG, format));
  });

  test('metadata off: no metadata.json, and the aria-label leaves out the metadata', async ({
    harness,
  }) => {
    await setSettings(harness, { saveMetadata: false });
    const page = await openArtwork(harness, EXAMPLE);
    const format = defaultVideo(await probeResult(harness, EXAMPLE), EXAMPLE);
    const label = FORMAT_LABEL[format];
    expect((await readPill(page)).aria).toBe(
      `Download this ugoira as ${label}, with its frame zip`,
    );
    const run = await runJob(harness, page);
    expectPercentRule(run.samples);
    expect(run.end.text).toBe(`Saved · ${label}`);
    expect(await filePaths(harness)).toEqual(expectedPaths(EXAMPLE, format, false));
    await expectFidelity(harness, EXAMPLE);
  });

  test('ZIP only: zip, frames.json and metadata.json, no video, Saved · ZIP', async ({
    harness,
    server,
  }) => {
    await setUgoiraOutput(harness, 'zip');
    const page = await openArtwork(harness, EXAMPLE);
    const idle = await readPill(page);
    expect(idle.text).toBe('Download · ZIP');
    expect(idle.aria).toBe("Download this ugoira's frame zip");
    // Without an encode the local job ends within tens of ms, faster than the badge's 50 ms
    // coalescing; holding the zip's headers keeps it running long enough to watch the badge.
    server.fault({ match: ugoiraZipUrl(EXAMPLE), responses: [{ delayHeadersMs: 500 }] });
    const run = await runJob(harness, page);

    expectPercentRule(run.samples);
    expect(
      run.samples.filter((sample) => sample.aria.startsWith('Encoding ')),
      'no encode phase',
    ).toEqual([]);
    await expectBadgeOne(harness, run);
    const folder = folderOf(EXAMPLE);
    expect(run.end.text).toBe('Saved · ZIP');
    expect(run.end.aria).toBe(`Saved ZIP to Downloads/${folder}. Click to download again.`);
    expect(await filePaths(harness)).toEqual(expectedPaths(EXAMPLE, 'zip'));
    await expectFidelity(harness, EXAMPLE);
  });

  test('no Content-Length (136004515): 0% with the rotating 25 % arc until the encode starts', async ({
    harness,
    server,
  }) => {
    expect(NO_LENGTH.noContentLength).toBe(true);
    const page = await openArtwork(harness, NO_LENGTH);
    const format = defaultVideo(await probeResult(harness, NO_LENGTH), NO_LENGTH);
    const run = await runJob(harness, page);
    const zipRequest = server.requests(ugoiraZipUrl(NO_LENGTH));
    expect(zipRequest.map((request) => request.status)).toEqual([200]);

    expectPercentRule(run.samples);
    const encodeStart = run.samples.findIndex((sample) => sample.aria.startsWith('Encoding '));
    expect(encodeStart, 'an encode-phase state was shown').not.toBe(-1);
    const frames = run.samples.slice(0, encodeStart).filter((sample) => sample.busy);
    const spinning = frames.findIndex((sample) => sample.ring?.indeterminate === true);
    expect(spinning, 'the indeterminate arc was shown during the zip fetch').not.toBe(-1);
    for (const sample of frames.slice(spinning)) {
      expect(sample.label, 'holds at 0%').toBe('0%');
      expect(sample.ring?.indeterminate, 'arc until the encode phase').toBe(true);
      expect(sample.ring?.offset).toBeCloseTo(RING_CIRCUMFERENCE * (1 - INDETERMINATE_ARC), 2);
      expect(sample.ring?.animationName, 'the arc rotates').not.toBe('none');
      expect(sample.ring?.animationDuration, 'once per second').toBe('1s');
      expect(sample.ring?.animationIterationCount).toBe('infinite');
    }
    for (const sample of run.samples.slice(encodeStart).filter((s) => s.busy)) {
      expect(sample.ring?.indeterminate, 'a determinate ring in the encode phase').toBe(false);
      expect(Number.parseInt(sample.label, 10)).toBeGreaterThanOrEqual(40);
    }
    expect(run.end.text).toBe(`Saved · ${FORMAT_LABEL[format]}`);
    expect(await filePaths(harness)).toEqual(expectedPaths(NO_LENGTH, format));
    await expectFidelity(harness, NO_LENGTH);
  });

  test('cancel during the encode (136004517): idle within 300 ms, no video, the zip and frames.json stay', async ({
    harness,
  }) => {
    test.slow(); // 300 frames at 1080p: tens of seconds with a software encoder
    const page = await openArtwork(harness, LONG);
    const format = defaultVideo(await probeResult(harness, LONG), LONG);
    await page.locator(HOST).click();
    await waitForEncoding(page);
    const restore = await slowOffscreen(harness, ENCODE_SLOWDOWN);
    try {
      // The double-click guard ignores clicks within 500 ms of the click that started the job.
      await page.waitForFunction(
        (guardMs) => {
          const [startedAt] = (window as unknown as PillWindow).__cuj2Clicks ?? [];
          return startedAt !== undefined && performance.now() - startedAt >= guardMs;
        },
        CLICK_GUARD_MS,
        { polling: 10 },
      );
      await page.locator(HOST).click();
      await expect
        .poll(async () => (await readPill(page)).text, { timeout: JOB_TIMEOUT_MS })
        .toBe(`Download · ${FORMAT_LABEL[format]}`);
    } finally {
      restore();
    }

    const clicks = await pillClicks(page);
    expect(clicks, 'start and cancel clicks').toHaveLength(2);
    const cancelAt = clicks[1] ?? Number.NaN;
    const samples = await pillSamples(page);
    const lastBusy = samples.filter((sample) => sample.busy && sample.at <= cancelAt).at(-1);
    expect(lastBusy?.aria, 'cancelled during the encode').toMatch(/^Encoding /);
    const idleAt = samples.find((sample) => sample.at > cancelAt && !sample.busy)?.at;
    expect(
      (idleAt ?? Number.POSITIVE_INFINITY) - cancelAt,
      'idle after the cancel',
    ).toBeLessThanOrEqual(CANCEL_IDLE_MS);

    await waitForNoJobs(harness);
    await expect
      .poll(() => harness.swEval(() => chrome.action.getBadgeText({})), { timeout: FOLLOW_MS })
      .toBe('');
    // What a ZIP-only job leaves: the zip, frames.json and metadata.json.
    expect(await filePaths(harness)).toEqual(expectedPaths(LONG, 'zip'));
    expect(
      await harness.swEval(() =>
        chrome.downloads.search({}).then((items) => items.map((item) => item.filename)),
      ),
    ).not.toContainEqual(expect.stringMatching(/\.(mp4|webm)$/));
    await expectFidelity(harness, LONG);
  });

  test('closing the tab during the encode (136004517) still produces the video', async ({
    harness,
  }) => {
    test.slow(); // 300 frames at 1080p: tens of seconds with a software encoder
    const page = await openArtwork(harness, LONG);
    const format = defaultVideo(await probeResult(harness, LONG), LONG);
    await page.locator(HOST).click();
    await waitForEncoding(page);
    await page.close();

    const video = await harness.downloads.waitForFile(videoPath(LONG, format), {
      timeout: JOB_TIMEOUT_MS,
    });
    expect(video.size).toBeGreaterThan(0);
    await waitForNoJobs(harness);
    await expect
      .poll(() => harness.swEval(() => chrome.action.getBadgeText({})), { timeout: FOLLOW_MS })
      .toBe('');
    expect(await filePaths(harness)).toEqual(expectedPaths(LONG, format));
  });

  test('mid-job: switching Ugoira output to ZIP only keeps the running job’s format; the next click uses ZIP only', async ({
    harness,
    server,
  }) => {
    const page = await openArtwork(harness, EXAMPLE);
    const format = defaultVideo(await probeResult(harness, EXAMPLE), EXAMPLE);
    const label = FORMAT_LABEL[format];
    // Hold the zip so the job is running, with its plan made, when the setting changes.
    server.fault({ match: ugoiraZipUrl(EXAMPLE), responses: [{ delayHeadersMs: 500 }] });
    const before = (await pillSamples(page)).length;
    await page.locator(HOST).click();
    await server.waitForRequest(ugoiraZipUrl(EXAMPLE));
    await setUgoiraOutput(harness, 'zip');
    expect((await readPill(page)).busy, 'the setting changed while the job ran').toBe(true);
    await expect
      .poll(async () => (await readPill(page)).busy, { timeout: JOB_TIMEOUT_MS })
      .toBe(false);

    const samples = (await pillSamples(page)).slice(before);
    const encoding = samples.filter((sample) => sample.aria.startsWith('Encoding '));
    expect(encoding.length, 'the running job still encodes').toBeGreaterThan(0);
    for (const sample of encoding) expect(sample.aria).toMatch(new RegExp(`^Encoding ${label}, `));
    expect((await readPill(page)).text).toBe(`Saved · ${label}`);
    expect(await filePaths(harness)).toEqual(expectedPaths(EXAMPLE, format));

    // The next click snapshots the new setting: ZIP only, so no second video.
    const second = await runJob(harness, page);
    expect(second.end.text).toBe('Saved · ZIP');
    const folder = folderOf(EXAMPLE);
    expect(await filePaths(harness)).toEqual(
      [
        ...expectedPaths(EXAMPLE, format),
        `${folder}/${EXAMPLE.id}_ugoira (1).zip`,
        `${folder}/frames (1).json`,
        `${folder}/metadata (1).json`,
      ].sort(),
    );
  });

  test('no H.264 (probe seeded as avc: null): the hint, Encoding, Saved label and file say WebM', async ({
    harness,
  }) => {
    // The SW keeps the offscreen probe's answer per frame size in storage.session; seeding it is
    // what a browser without an H.264 encoder would have produced.
    const noAvc: CodecCaps = { avc: null, vp9: true };
    await harness.swEval(({ key, caps }) => chrome.storage.session.set({ [key]: caps }), {
      key: capsKey(EXAMPLE),
      caps: noAvc,
    });
    const page = await openArtwork(harness, EXAMPLE);
    const idle = await readPill(page);
    expect(idle.text).toBe('Download · WebM');
    expect(idle.aria).toBe('Download this ugoira as WebM, with its frame zip and metadata');

    const run = await runJob(harness, page);
    expectPercentRule(run.samples);
    const encoding = run.samples.filter((sample) => sample.aria.startsWith('Encoding '));
    expect(encoding.length).toBeGreaterThan(0);
    for (const sample of encoding) expect(sample.aria).toMatch(/^Encoding WebM, \d+ percent\./);
    const folder = folderOf(EXAMPLE);
    expect(run.end.text).toBe('Saved · WebM');
    expect(run.end.aria).toBe(`Saved WebM to Downloads/${folder}. Click to download again.`);
    expect(await filePaths(harness)).toEqual(expectedPaths(EXAMPLE, 'webm'));
  });

  test.describe('video checks', { tag: '@ffprobe' }, () => {
    // Skip before running a job when there is nothing to check its video with.
    test.beforeEach(() => requireMediaTool('ffprobe'));

    test('timing (136004513) as MP4: 4 frames lasting 40, 40, 500, 40 ms (±1 ms), 620 ms in all', async ({
      harness,
    }) => {
      const page = await openArtwork(harness, TIMING);
      requireAvc(await probeResult(harness, TIMING), TIMING);
      const run = await runJob(harness, page);
      expect(run.end.text).toBe('Saved · MP4');
      await expectVideo(harness, TIMING, 'mp4', { width: 320, height: 240 });
    });

    test('timing (136004513) as WebM: 4 frames lasting 40, 40, 500, 40 ms (±1 ms), 620 ms in all', async ({
      harness,
    }) => {
      await setUgoiraOutput(harness, 'webm');
      const page = await openArtwork(harness, TIMING);
      requireVp9(await probeResult(harness, TIMING), TIMING);
      const run = await runJob(harness, page);
      expect(run.end.text).toBe('Saved · WebM');
      await expectVideo(harness, TIMING, 'webm', { width: 320, height: 240 });
    });

    test('odd size (136004514): 601×451 frames give a 600×450 video', async ({ harness }) => {
      const page = await openArtwork(harness, ODD);
      const format = defaultVideo(await probeResult(harness, ODD), ODD);
      const run = await runJob(harness, page);
      expect(run.end.text).toBe(`Saved · ${FORMAT_LABEL[format]}`);
      await expectVideo(harness, ODD, format, { width: 600, height: 450 });
    });

    test('quality (136004512) as MP4: 48 frames of 100 ms at 600×600, SSIM mean ≥ 0.98 and min ≥ 0.95', async ({
      harness,
    }) => {
      const page = await openArtwork(harness, EXAMPLE);
      requireAvc(await probeResult(harness, EXAMPLE), EXAMPLE);
      const run = await runJob(harness, page);
      expect(run.end.text).toBe('Saved · MP4');
      await expectVideo(harness, EXAMPLE, 'mp4', { width: 600, height: 600 });
      await expectQuality(harness, EXAMPLE, 'mp4');
    });

    test('quality (136004512) as WebM: 48 frames of 100 ms at 600×600, SSIM mean ≥ 0.98 and min ≥ 0.95', async ({
      harness,
    }) => {
      await setUgoiraOutput(harness, 'webm');
      const page = await openArtwork(harness, EXAMPLE);
      requireVp9(await probeResult(harness, EXAMPLE), EXAMPLE);
      const run = await runJob(harness, page);
      expect(run.end.text).toBe('Saved · WebM');
      await expectVideo(harness, EXAMPLE, 'webm', { width: 600, height: 600 });
      await expectQuality(harness, EXAMPLE, 'webm');
    });
  });
});
