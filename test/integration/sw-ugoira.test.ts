import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeJson } from '../../src/shared/metadata';
import type { ChromeFake } from '../fakes/chrome';
import {
  API,
  ContentTab,
  DownloadDriver,
  ScriptedOffscreen,
  bootSw,
  savedFiles,
  settle,
  setUp,
  tearDown,
  ugoiraIllustJson,
  ugoiraMetaJson,
  until,
  type ApiTable,
  type OffscreenOptions,
} from './harness';

const ID = '136004512';
const FOLDER = 'pixiv/Sora_空-136004512';
const ARTWORK_URL = `https://www.pixiv.net/artworks/${ID}`;
const FRAMES = (ugoiraMetaJson().body as { frames: unknown[] }).frames;

let fake: ChromeFake;

beforeEach(() => {
  fake = setUp();
});

afterEach(tearDown);

function api(): ApiTable {
  return new Map<string, Record<string, unknown> | number>([
    [`${API}/${ID}`, ugoiraIllustJson()],
    [`${API}/${ID}/ugoira_meta`, ugoiraMetaJson()],
  ]);
}

function seedSettings(ugoiraOutput: 'mp4' | 'webm' | 'zip'): void {
  fake.storage.sync.seed({
    settings: {
      v: 1,
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput,
      saveMetadata: true,
      updatedAt: 1,
    },
  });
}

async function runJob(
  options: OffscreenOptions = {},
  start: Record<string, unknown> = {
    mode: 'full',
    artworkId: ID,
    expectedFiles: 1,
    loggedIn: true, // the fixture is an R-18 body as a logged-in page gets it
  },
) {
  const offscreen = new ScriptedOffscreen(fake, options);
  await bootSw();
  const tab = new ContentTab(fake, ARTWORK_URL, api());
  const badges: string[] = [];
  fake.api.action.setBadgeText.mockImplementation(async ({ text }) => {
    badges.push(text ?? '');
    await Promise.resolve();
  });
  await settle(tab.send({ type: 'job/start', ...start }));
  const driver = new DownloadDriver(fake);
  await until(() => {
    driver.step();
    return tab.ended() !== undefined;
  }, 'job end');
  await settle(new Promise((resolve) => setTimeout(resolve, 100)));
  return { tab, offscreen, badges };
}

describe('sw: ugoira job (CUJ-2)', () => {
  it('sw: saves metadata.json, the zip, frames.json, then the video, in that order', async () => {
    await runJob();
    expect(savedFiles(fake)).toEqual([
      `${FOLDER}/metadata.json`,
      `${FOLDER}/${ID}_ugoira.zip`,
      `${FOLDER}/frames.json`,
      `${FOLDER}/${ID}.mp4`,
    ]);
  });

  it('sw: the badge counts 1 for the whole job', async () => {
    const { badges } = await runJob({ delayMs: 100 });
    expect(badges).toEqual(['1', '']);
  });

  it('sw: fetches the original-size zip with save: true', async () => {
    const { offscreen } = await runJob();
    expect(offscreen.commandsOf('off/fetchZip')).toEqual([
      expect.objectContaining({
        url: 'https://i.pximg.net/img-zip-ugoira/img/2025/10/05/21/00/00/136004512_ugoira1920x1080.zip',
        save: true,
      }),
    ]);
  });

  it('sw: writes frames.json as pixiv sent the frames', async () => {
    const { offscreen } = await runJob();
    const texts = offscreen.commandsOf('off/makeText').map((c) => c.text);
    expect(texts).toContain(serializeJson(FRAMES));
  });

  it('sw: encodes from the retained zip with the probed codec', async () => {
    const { offscreen } = await runJob();
    const zipTaskId = offscreen.commandsOf('off/fetchZip')[0]?.taskId;
    expect(offscreen.commandsOf('off/encode')).toEqual([
      expect.objectContaining({
        zipTaskId,
        frames: FRAMES,
        format: 'mp4',
        avcCodec: 'avc1.64001e',
        artworkId: ID,
      }),
    ]);
  });

  it('sw: keeps the zip bytes when its download lands before the video is encoded', async () => {
    const { offscreen } = await runJob();
    const zipTaskId = offscreen.commandsOf('off/fetchZip')[0]?.taskId as string;
    expect(offscreen.released.find((r) => r.taskIds.includes(zipTaskId))).toEqual({
      taskIds: [zipTaskId],
      keepRetained: true,
    });
  });

  it('sw: ends saved with the effective format', async () => {
    const { tab } = await runJob();
    expect(tab.ended()?.outcome).toEqual({ type: 'saved', folder: FOLDER, format: 'mp4' });
  });

  it('sw: pushes a percent that never decreases and never reaches 100, not even in the view pushed after the last file lands', async () => {
    const { tab } = await runJob();
    const percents = tab.views.flatMap((v) =>
      v.progress?.kind === 'percent' ? [v.progress.percent] : [],
    );
    expect([
      percents.every((p, i) => i === 0 || p >= (percents[i - 1] ?? p)),
      Math.max(...percents),
      tab.ended()?.status,
    ]).toEqual([true, 99, 'ended']);
  });

  it('sw: falls back to WebM when H.264 cannot be encoded', async () => {
    await runJob({ caps: { avc: null, vp9: true } });
    expect(savedFiles(fake).at(-1)).toBe(`${FOLDER}/${ID}.webm`);
  });

  it('sw: saves the ZIP only when no video codec can be encoded', async () => {
    const { tab } = await runJob({ caps: { avc: null, vp9: false } });
    expect([savedFiles(fake).length, tab.ended()?.outcome]).toEqual([
      3,
      { type: 'saved', folder: FOLDER, format: 'zip' },
    ]);
  });

  it('sw: the ZIP only setting writes no video', async () => {
    seedSettings('zip');
    const { offscreen } = await runJob();
    expect(offscreen.commandsOf('off/encode')).toEqual([]);
  });

  it('sw: a failed encode keeps the zip and frames.json and ends encodeFailed', async () => {
    const { tab } = await runJob({
      encodeFailure: { kind: 'encode', detail: 'encoder', attempts: 1 },
    });
    expect([savedFiles(fake), tab.ended()?.outcome]).toEqual([
      [`${FOLDER}/metadata.json`, `${FOLDER}/${ID}_ugoira.zip`, `${FOLDER}/frames.json`],
      { type: 'encodeFailed', folder: FOLDER, format: 'mp4' },
    ]);
  });

  it('sw: a refused off/encode fails the video as encode: zip kept, Retry · MP4 (encodeFailed)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { tab } = await runJob({ refuse: ['off/encode'] });
    expect([savedFiles(fake), tab.ended()?.outcome]).toEqual([
      [`${FOLDER}/metadata.json`, `${FOLDER}/${ID}_ugoira.zip`, `${FOLDER}/frames.json`],
      { type: 'encodeFailed', folder: FOLDER, format: 'mp4' },
    ]);
  });

  it('sw: a refused off/fetchZip fails the zip internal and ends server, not offline', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { tab } = await runJob({ refuse: ['off/fetchZip'] });
    expect(tab.ended()?.outcome).toEqual({ type: 'error', cause: 'server' });
  });

  it('sw: a 403 on the zip ends needs-login', async () => {
    const failures = new Map([
      [
        'https://i.pximg.net/img-zip-ugoira/img/2025/10/05/21/00/00/136004512_ugoira1920x1080.zip',
        { kind: 'http' as const, status: 403, attempts: 1 },
      ],
    ]);
    const { tab } = await runJob({ failures });
    expect(tab.ended()?.outcome).toEqual({ type: 'needsLogin' });
  });
});

describe('sw: retryEncode (CUJ-5 step 8)', () => {
  const OLD_FOLDER = 'pixiv/old-folder';
  const retry = { mode: 'retryEncode', artworkId: ID, folder: OLD_FOLDER, format: 'mp4' };

  it('sw: fetches the zip into memory only (save: false)', async () => {
    const { offscreen } = await runJob({}, retry);
    expect(offscreen.commandsOf('off/fetchZip')).toEqual([
      expect.objectContaining({ save: false }),
    ]);
  });

  it('sw: writes only the video, into the original folder', async () => {
    const { tab } = await runJob({}, retry);
    expect([savedFiles(fake), tab.ended()?.outcome]).toEqual([
      [`${OLD_FOLDER}/${ID}.mp4`],
      { type: 'saved', folder: OLD_FOLDER, format: 'mp4' },
    ]);
  });
});
