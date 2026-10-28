// The chrome.* fake is shared infrastructure for the SW tests; these pin the Chrome semantics it
// promises.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOWNLOADS_DIR,
  EXTENSION_ORIGIN,
  FAKE_EXTENSION_ID,
  FakeDownloads,
  INVALID_FILENAME_ERROR,
  RECEIVING_END_ERROR,
  SW_URL,
  SYNC_QUOTA_ERRORS,
  UI_DISABLED_ERROR,
  UI_PERMISSION_ERROR,
  installChromeFake,
  type ChromeFake,
} from '../../fakes/chrome';

const ARTWORK_URL = 'https://www.pixiv.net/artworks/135882741';
const BLOB_URL = `blob:${EXTENSION_ORIGIN}/0b6f6c1e`;

let fake: ChromeFake;

beforeEach(() => {
  fake = installChromeFake();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chrome fake: install', () => {
  it('fake: installs itself as globalThis.chrome', () => {
    expect(globalThis.chrome).toBe(fake.api);
  });

  it('fake: i18n.getMessage reads the requested locale', () => {
    installChromeFake({ locale: 'ja' });
    expect(chrome.i18n.getMessage('btn_download')).toBe('ダウンロード');
  });

  it('fake: runtime exposes the extension id, URLs and the manifest', () => {
    expect([
      chrome.runtime.id,
      chrome.runtime.getURL('/options.html'),
      chrome.runtime.getManifest().version,
    ]).toEqual([FAKE_EXTENSION_ID, `${EXTENSION_ORIGIN}/options.html`, '1.0.0']);
  });
});

describe('chrome fake: storage', () => {
  it('storage: get(null) returns every item, get(key) only that key', async () => {
    await chrome.storage.session.set({ a: 1, b: { c: 2 } });
    expect([await chrome.storage.session.get(null), await chrome.storage.session.get('b')]).toEqual(
      [{ a: 1, b: { c: 2 } }, { b: { c: 2 } }],
    );
  });

  it('storage: get with an object fills in defaults for missing keys', async () => {
    await chrome.storage.sync.set({ a: 1 });
    expect(await chrome.storage.sync.get({ a: 0, b: 'x' })).toEqual({ a: 1, b: 'x' });
  });

  it('storage: values are stored as copies', async () => {
    const value = { n: 1 };
    await chrome.storage.local.set({ k: value });
    value.n = 2;
    expect(await chrome.storage.local.get('k')).toEqual({ k: { n: 1 } });
  });

  it('storage: set fires storage.onChanged with old and new values and the area name', async () => {
    const events: unknown[] = [];
    chrome.storage.onChanged.addListener((changes, area) => events.push([changes, area]));
    await chrome.storage.sync.set({ k: 1 });
    await chrome.storage.sync.set({ k: 2 });
    expect(events).toEqual([
      [{ k: { newValue: 1 } }, 'sync'],
      [{ k: { newValue: 2, oldValue: 1 } }, 'sync'],
    ]);
  });

  it('storage: an unchanged value fires no event', async () => {
    const listener = vi.fn();
    await chrome.storage.session.set({ k: 1 });
    chrome.storage.session.onChanged.addListener(listener);
    await chrome.storage.session.set({ k: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('storage: remove fires a change with the old value', async () => {
    const events: unknown[] = [];
    await chrome.storage.session.set({ k: 1 });
    chrome.storage.session.onChanged.addListener((changes) => events.push(changes));
    await chrome.storage.session.remove('k');
    expect([events, fake.storage.session.snapshot()]).toEqual([[{ k: { oldValue: 1 } }], {}]);
  });

  it('storage: failNextSet rejects the next sync write with a quota error', async () => {
    fake.storage.sync.failNextSet();
    await expect(chrome.storage.sync.set({ k: 1 })).rejects.toThrow(SYNC_QUOTA_ERRORS.bytesPerItem);
  });

  it('storage: writes after an injected failure succeed', async () => {
    fake.storage.sync.failNextSet(SYNC_QUOTA_ERRORS.writesPerMinute);
    await chrome.storage.sync.set({ k: 1 }).catch(() => undefined);
    await chrome.storage.sync.set({ k: 2 });
    expect(fake.storage.sync.snapshot()).toEqual({ k: 2 });
  });

  it('storage: seed writes without firing onChanged', () => {
    const listener = vi.fn();
    chrome.storage.onChanged.addListener(listener);
    fake.storage.session.seed({ k: 1 });
    expect([listener.mock.calls.length, fake.storage.session.snapshot()]).toEqual([0, { k: 1 }]);
  });
});

describe('chrome fake: downloads', () => {
  const save = (filename: string): Promise<number> =>
    chrome.downloads.download({
      url: BLOB_URL,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });

  it('downloads: download starts an in-progress item under the Downloads directory', async () => {
    const id = await save('pixiv/a-1/1_p0.jpg');
    expect(await chrome.downloads.search({ id })).toEqual([
      expect.objectContaining({
        id,
        state: 'in_progress',
        filename: `${DOWNLOADS_DIR}/pixiv/a-1/1_p0.jpg`,
      }),
    ]);
  });

  it('downloads: uniquify adds " (1)" when the name is taken', async () => {
    await save('pixiv/a-1/metadata.json');
    const id = await save('pixiv/a-1/metadata.json');
    const [item] = await chrome.downloads.search({ id });
    expect(item?.filename).toBe(`${DOWNLOADS_DIR}/pixiv/a-1/metadata (1).json`);
  });

  it.each(['../x.jpg', '/abs/x.jpg', 'a//x.jpg', ''])(
    'downloads: rejects the unsafe filename %j',
    async (filename) => {
      await expect(save(filename)).rejects.toThrow(INVALID_FILENAME_ERROR);
    },
  );

  it('downloads: failNextDownload rejects the next download', async () => {
    fake.downloads.failNextDownload();
    await expect(save('pixiv/a-1/1_p0.jpg')).rejects.toThrow(INVALID_FILENAME_ERROR);
  });

  it('downloads: complete() finishes the oldest download and fires onChanged', async () => {
    const deltas: chrome.downloads.DownloadDelta[] = [];
    chrome.downloads.onChanged.addListener((delta) => deltas.push(delta));
    const first = await save('a/1.jpg');
    await save('a/2.jpg');
    fake.downloads.complete();
    expect(deltas).toEqual([
      expect.objectContaining({
        id: first,
        state: { previous: 'in_progress', current: 'complete' },
      }),
    ]);
  });

  it('downloads: interrupt() reports the reason', async () => {
    const deltas: chrome.downloads.DownloadDelta[] = [];
    chrome.downloads.onChanged.addListener((delta) => deltas.push(delta));
    const id = await save('a/1.jpg');
    fake.downloads.interrupt(id, 'FILE_NO_SPACE');
    expect(deltas[0]?.error).toEqual({ current: 'FILE_NO_SPACE' });
  });

  it('downloads: cancel interrupts an in-progress download with USER_CANCELED', async () => {
    const id = await save('a/1.jpg');
    await chrome.downloads.cancel(id);
    expect(await chrome.downloads.search({ id })).toEqual([
      expect.objectContaining({ state: 'interrupted', error: 'USER_CANCELED' }),
    ]);
  });

  it('downloads: search filters by url and state', async () => {
    await save('a/1.jpg');
    const other = await chrome.downloads.download({ url: `${BLOB_URL}-2`, filename: 'a/2.jpg' });
    fake.downloads.complete(other);
    const found = await chrome.downloads.search({ url: `${BLOB_URL}-2`, state: 'complete' });
    expect(found.map((item) => item.id)).toEqual([other]);
  });

  it('downloads: inProgress() is the completion queue, oldest first', async () => {
    const first = await save('a/1.jpg');
    const second = await save('a/2.jpg');
    const third = await save('a/3.jpg');
    fake.downloads.complete(second);
    expect(fake.downloads.inProgress().map((item) => item.id)).toEqual([first, third]);
  });
});

describe('chrome fake: deferred naming (R-006)', () => {
  const save = (filename: string): Promise<number> =>
    chrome.downloads.download({
      url: BLOB_URL,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });

  async function filenameOf(id: number): Promise<string | undefined> {
    return (await chrome.downloads.search({ id }))[0]?.filename;
  }

  function watchDeltas(): chrome.downloads.DownloadDelta[] {
    const deltas: chrome.downloads.DownloadDelta[] = [];
    chrome.downloads.onChanged.addListener((delta) => deltas.push(delta));
    return deltas;
  }

  it('deferNaming: off by default, an item is named at creation', async () => {
    const id = await save('a/1.jpg');
    expect(await filenameOf(id)).toBe(`${DOWNLOADS_DIR}/a/1.jpg`);
  });

  it('deferNaming: on, an item starts with an empty filename', async () => {
    fake.downloads.deferNaming(true);
    const id = await save('a/1.jpg');
    expect(await filenameOf(id)).toBe('');
  });

  it('deferNaming: on, an item starts in progress', async () => {
    fake.downloads.deferNaming(true);
    const id = await save('a/1.jpg');
    expect(fake.downloads.inProgress().map((item) => item.id)).toEqual([id]);
  });

  it('name: sets the reserved filename', async () => {
    fake.downloads.deferNaming(true);
    const id = await save('a/1.jpg');
    fake.downloads.name(id);
    expect(await filenameOf(id)).toBe(`${DOWNLOADS_DIR}/a/1.jpg`);
  });

  it('name: fires a filename delta from empty', async () => {
    fake.downloads.deferNaming(true);
    const deltas = watchDeltas();
    const id = await save('a/1.jpg');
    fake.downloads.name(id);
    expect(deltas).toEqual([
      { id, filename: { previous: '', current: `${DOWNLOADS_DIR}/a/1.jpg` } },
    ]);
  });

  it('name: an item named already throws', async () => {
    const id = await save('a/1.jpg');
    expect(() => fake.downloads.name(id)).toThrow(`no unnamed download (id ${id})`);
  });

  it('deferNaming: an unnamed item still reserves its target for uniquify', async () => {
    fake.downloads.deferNaming(true);
    const first = await save('a/metadata.json');
    const second = await save('a/metadata.json');
    fake.downloads.name(second);
    fake.downloads.name(first);
    expect([await filenameOf(first), await filenameOf(second)]).toEqual([
      `${DOWNLOADS_DIR}/a/metadata.json`,
      `${DOWNLOADS_DIR}/a/metadata (1).json`,
    ]);
  });

  it('complete: names an unnamed item first, its filename delta before the state delta', async () => {
    fake.downloads.deferNaming(true);
    const deltas = watchDeltas();
    const id = await save('a/1.jpg');
    fake.downloads.complete(id);
    expect(deltas.map((delta) => Object.keys(delta).filter((key) => key !== 'id'))).toEqual([
      ['filename'],
      ['state', 'endTime'],
    ]);
  });

  it('interrupt: names an unnamed item first, its filename delta before the state delta', async () => {
    fake.downloads.deferNaming(true);
    const deltas = watchDeltas();
    const id = await save('a/1.jpg');
    fake.downloads.interrupt(id, 'FILE_FAILED');
    expect(deltas.map((delta) => Object.keys(delta).filter((key) => key !== 'id'))).toEqual([
      ['filename'],
      ['state', 'error'],
    ]);
  });

  it('complete: a named item fires only its state delta', async () => {
    fake.downloads.deferNaming(true);
    const deltas = watchDeltas();
    const id = await save('a/1.jpg');
    fake.downloads.name(id);
    deltas.length = 0;
    fake.downloads.complete(id);
    expect(deltas.map((delta) => Object.keys(delta).filter((key) => key !== 'id'))).toEqual([
      ['state', 'endTime'],
    ]);
  });

  it('reset: turns deferred naming back off', async () => {
    fake.downloads.deferNaming(true);
    fake.reset();
    const id = await save('a/1.jpg');
    expect(await filenameOf(id)).toBe(`${DOWNLOADS_DIR}/a/1.jpg`);
  });
});

describe('chrome fake: disk model and existence re-check (D15)', () => {
  const save = (filename: string): Promise<number> =>
    chrome.downloads.download({
      url: BLOB_URL,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });

  async function saved(filename: string): Promise<number> {
    const id = await save(filename);
    fake.downloads.complete(id);
    return id;
  }

  async function filenameOf(id: number): Promise<string | undefined> {
    return (await chrome.downloads.search({ id }))[0]?.filename;
  }

  function existsDeltas(): chrome.downloads.DownloadDelta[] {
    const deltas: chrome.downloads.DownloadDelta[] = [];
    chrome.downloads.onChanged.addListener((delta) => {
      if (delta.exists) deltas.push(delta);
    });
    return deltas;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removeFile: the record still reads exists: true until a search', async () => {
    const id = await saved('pixiv/a-1/1_p0.jpg');
    fake.downloads.removeFile(id);
    expect(fake.downloads.items()[0]?.exists).toBe(true);
  });

  it('removeFile: the search itself still returns exists: true', async () => {
    const id = await saved('pixiv/a-1/1_p0.jpg');
    fake.downloads.removeFile(id);
    expect((await chrome.downloads.search({ id }))[0]?.exists).toBe(true);
  });

  it('removeFile: after a search and the re-check the item reads exists: false, with one exists delta', async () => {
    const id = await saved('pixiv/a-1/1_p0.jpg');
    const deltas = existsDeltas();
    fake.downloads.removeFile(id);
    await chrome.downloads.search({});
    await vi.advanceTimersByTimeAsync(0);
    expect([(await chrome.downloads.search({ id }))[0]?.exists, deltas]).toEqual([
      false,
      [{ id, exists: { previous: true, current: false } }],
    ]);
  });

  it('removeFile: a second search fires no second exists delta', async () => {
    const id = await saved('pixiv/a-1/1_p0.jpg');
    const deltas = existsDeltas();
    fake.downloads.removeFile(id);
    await chrome.downloads.search({});
    await vi.advanceTimersByTimeAsync(0);
    await chrome.downloads.search({});
    await vi.advanceTimersByTimeAsync(0);
    expect(deltas).toHaveLength(1);
  });

  it('removeFile: a file still on disk is never flagged', async () => {
    const kept = await saved('pixiv/a-1/1_p0.jpg');
    fake.downloads.removeFile(await saved('pixiv/a-1/1_p1.jpg'));
    await chrome.downloads.search({});
    await vi.advanceTimersByTimeAsync(0);
    expect((await chrome.downloads.search({ id: kept }))[0]?.exists).toBe(true);
  });

  it('removeFile: a download still in progress throws', async () => {
    const id = await save('pixiv/a-1/1_p0.jpg');
    expect(() => fake.downloads.removeFile(id)).toThrow(`no completed download (id ${id})`);
  });

  it('removeFile: a download to the removed file’s path gets the clean name', async () => {
    fake.downloads.removeFile(await saved('pixiv/a-1/1_p0.jpg'));
    expect(await filenameOf(await save('pixiv/a-1/1_p0.jpg'))).toBe(
      `${DOWNLOADS_DIR}/pixiv/a-1/1_p0.jpg`,
    );
  });

  it('removeFiles: marks every completed download matching the predicate as gone', async () => {
    await saved('pixiv/a-1/1_p0.jpg');
    await saved('pixiv/a-1/1_p1.jpg');
    await saved('pixiv/b-2/2_p0.jpg');
    fake.downloads.removeFiles((item) => item.filename.startsWith(`${DOWNLOADS_DIR}/pixiv/a-1/`));
    await chrome.downloads.search({});
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.downloads.items().map((item) => item.exists)).toEqual([false, false, true]);
  });

  it('existenceCheckDelay: the flag flips only after the delay', async () => {
    const id = await saved('pixiv/a-1/1_p0.jpg');
    fake.downloads.existenceCheckDelay(400);
    fake.downloads.removeFile(id);
    await chrome.downloads.search({});
    await vi.advanceTimersByTimeAsync(399);
    const before = fake.downloads.items()[0]?.exists;
    await vi.advanceTimersByTimeAsync(1);
    expect([before, fake.downloads.items()[0]?.exists]).toEqual([true, false]);
  });

  it('existenceCheckDelay: reset restores the next-macrotask default', async () => {
    fake.downloads.existenceCheckDelay(400);
    fake.reset();
    const id = await saved('pixiv/a-1/1_p0.jpg');
    fake.downloads.removeFile(id);
    await chrome.downloads.search({});
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.downloads.items()[0]?.exists).toBe(false);
  });

  it('reset: a re-check scheduled before it fires no delta', async () => {
    fake.downloads.existenceCheckDelay(400);
    fake.downloads.removeFile(await saved('pixiv/a-1/1_p0.jpg'));
    await chrome.downloads.search({});
    fake.reset();
    const deltas = existsDeltas();
    await vi.advanceTimersByTimeAsync(400);
    expect(deltas).toEqual([]);
  });

  it('search: filenameRegex matches the DOWNLOADS_DIR-prefixed absolute filename', async () => {
    const inFolder = await saved('pixiv/a-1/1_p0.jpg');
    await saved('pixiv/a-1 (1)/1_p0.jpg');
    const found = await chrome.downloads.search({
      filenameRegex: `^${DOWNLOADS_DIR}/pixiv/a-1/1_p\\d+\\.jpg$`,
    });
    expect(found.map((item) => item.id)).toEqual([inFolder]);
  });

  it('search: filenameRegex anchored at the relative path matches nothing', async () => {
    await saved('pixiv/a-1/1_p0.jpg');
    expect(await chrome.downloads.search({ filenameRegex: '^pixiv/' })).toEqual([]);
  });

  it('search: urlRegex filters on the url', async () => {
    await save('a/1.jpg');
    const other = await chrome.downloads.download({ url: `${BLOB_URL}-2`, filename: 'a/2.jpg' });
    const found = await chrome.downloads.search({ urlRegex: '-2$' });
    expect(found.map((item) => item.id)).toEqual([other]);
  });

  it('search: limit 0 returns every match', async () => {
    for (const page of [0, 1, 2]) await saved(`pixiv/a-1/1_p${page}.jpg`);
    expect(await chrome.downloads.search({ state: 'complete', limit: 0 })).toHaveLength(3);
  });

  it('search: limit 2 returns two matches', async () => {
    for (const page of [0, 1, 2]) await saved(`pixiv/a-1/1_p${page}.jpg`);
    expect(await chrome.downloads.search({ state: 'complete', limit: 2 })).toHaveLength(2);
  });

  it('addCompleted: the seeded record is found by search as a complete download', async () => {
    const seeded = fake.downloads.addCompleted('pixiv/a-1/1_p0.jpg', { byExtensionId: 'other' });
    expect(await chrome.downloads.search({ filenameRegex: '/pixiv/a-1/1_p0\\.jpg$' })).toEqual([
      expect.objectContaining({
        id: seeded.id,
        state: 'complete',
        exists: true,
        filename: `${DOWNLOADS_DIR}/pixiv/a-1/1_p0.jpg`,
        byExtensionId: 'other',
      }),
    ]);
  });

  it('addCompleted: byExtensionId defaults to this extension', () => {
    expect(fake.downloads.addCompleted('pixiv/a-1/1_p0.jpg').byExtensionId).toBe(FAKE_EXTENSION_ID);
  });

  it('addCompleted: uniquify respects the seeded record', async () => {
    fake.downloads.addCompleted('pixiv/a-1/metadata.json');
    expect(await filenameOf(await save('pixiv/a-1/metadata.json'))).toBe(
      `${DOWNLOADS_DIR}/pixiv/a-1/metadata (1).json`,
    );
  });

  it('addCompleted: exists: false seeds a flagged record whose name is free', async () => {
    const seeded = fake.downloads.addCompleted('pixiv/a-1/metadata.json', { exists: false });
    const id = await save('pixiv/a-1/metadata.json');
    expect([seeded.exists, await filenameOf(id)]).toEqual([
      false,
      `${DOWNLOADS_DIR}/pixiv/a-1/metadata.json`,
    ]);
  });
});

describe('chrome fake: download UI (setUiOptions, R-005)', () => {
  const save = (filename: string): Promise<number> =>
    chrome.downloads.download({ url: BLOB_URL, filename });

  it('setUiOptions: the UI starts on', () => {
    expect(fake.downloads.uiEnabled).toBe(true);
  });

  it('setUiOptions: turns the UI off and back on', async () => {
    await chrome.downloads.setUiOptions({ enabled: false });
    const off = fake.downloads.uiEnabled;
    await chrome.downloads.setUiOptions({ enabled: true });
    expect([off, fake.downloads.uiEnabled]).toEqual([false, true]);
  });

  it('setUiOptions: rejects like Chrome when the manifest lacks downloads.ui', async () => {
    const downloads = new FakeDownloads(false);
    await expect(downloads.setUiOptions({ enabled: false })).rejects.toThrow(UI_PERMISSION_ERROR);
  });

  it('setUiOptions: a refusal for a missing permission changes nothing', async () => {
    const downloads = new FakeDownloads(false);
    await downloads.setUiOptions({ enabled: false }).catch(() => undefined);
    expect([downloads.uiEnabled, downloads.callLog]).toEqual([true, []]);
  });

  it('setUiOptions: the installed fake grants downloads.ui from src/manifest.json', async () => {
    await expect(chrome.downloads.setUiOptions({ enabled: false })).resolves.toBeUndefined();
  });

  it('failNextSetUiOptions: rejects the next call with the message', async () => {
    fake.downloads.failNextSetUiOptions('boom');
    await expect(chrome.downloads.setUiOptions({ enabled: false })).rejects.toThrow('boom');
  });

  it('failNextSetUiOptions: defaults to Chrome’s "another extension" refusal', async () => {
    fake.downloads.failNextSetUiOptions();
    await expect(chrome.downloads.setUiOptions({ enabled: true })).rejects.toThrow(
      UI_DISABLED_ERROR,
    );
  });

  it('failNextSetUiOptions: the refused call changes nothing and the next one applies', async () => {
    fake.downloads.failNextSetUiOptions();
    await chrome.downloads.setUiOptions({ enabled: false }).catch(() => undefined);
    const afterRefusal = [fake.downloads.uiEnabled, fake.downloads.uiCalls()];
    await chrome.downloads.setUiOptions({ enabled: false });
    expect([afterRefusal, [fake.downloads.uiEnabled, fake.downloads.uiCalls()]]).toEqual([
      [true, []],
      [false, [false]],
    ]);
  });

  it('callLog: setUiOptions and download() share one ordered log', async () => {
    await chrome.downloads.setUiOptions({ enabled: false });
    await save('a/1.jpg');
    await chrome.downloads.setUiOptions({ enabled: true });
    expect(fake.downloads.callLog).toEqual([
      { op: 'ui', enabled: false },
      { op: 'download', filename: 'a/1.jpg' },
      { op: 'ui', enabled: true },
    ]);
  });

  it('callLog: a download is logged when asked for, a UI setting once applied', async () => {
    const hide = chrome.downloads.setUiOptions({ enabled: false });
    const download = save('a/1.jpg');
    await Promise.all([hide, download]);
    expect(fake.downloads.callLog.map((call) => call.op)).toEqual(['download', 'ui']);
  });

  it('callLog: a refused download is still logged', async () => {
    fake.downloads.failNextDownload();
    await save('a/1.jpg').catch(() => undefined);
    expect(fake.downloads.callLog).toEqual([{ op: 'download', filename: 'a/1.jpg' }]);
  });

  it('uiCalls: the applied settings, oldest first', async () => {
    await chrome.downloads.setUiOptions({ enabled: false });
    await save('a/1.jpg');
    await chrome.downloads.setUiOptions({ enabled: true });
    expect(fake.downloads.uiCalls()).toEqual([false, true]);
  });
});

describe('chrome fake: action', () => {
  it('action: starts with the manifest default title and no badge', async () => {
    expect([await chrome.action.getTitle({}), await chrome.action.getBadgeText({})]).toEqual([
      'Helper for Pixiv — click to open settings',
      '',
    ]);
  });

  it('action: badge colors read back as color arrays', async () => {
    await chrome.action.setBadgeBackgroundColor({ color: '#1f1f1f' });
    await chrome.action.setBadgeTextColor({ color: '#FFF' });
    expect([
      await chrome.action.getBadgeBackgroundColor({}),
      await chrome.action.getBadgeTextColor({}),
    ]).toEqual([
      [31, 31, 31, 255],
      [255, 255, 255, 255],
    ]);
  });
});

describe('chrome fake: messaging', () => {
  it('messaging: runtime.sendMessage from the SW reaches the offscreen document with SW sender info', async () => {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'test',
    });
    const senders: chrome.runtime.MessageSender[] = [];
    fake.offscreen.document?.handle((_message, sender) => {
      senders.push(sender);
      return { ok: true };
    });
    const response = await chrome.runtime.sendMessage<object, unknown>({
      target: 'offscreen',
      type: 'off/tasks',
    });
    expect([response, senders]).toEqual([
      { ok: true },
      [{ id: FAKE_EXTENSION_ID, url: SW_URL, origin: EXTENSION_ORIGIN }],
    ]);
  });

  it('messaging: rejects when no context listens', async () => {
    await expect(chrome.runtime.sendMessage({ target: 'offscreen' })).rejects.toThrow(
      RECEIVING_END_ERROR,
    );
  });

  it('messaging: content scripts do not receive runtime.sendMessage', async () => {
    fake.tabs.add({ url: ARTWORK_URL }).handle(() => ({ ok: true }));
    await expect(chrome.runtime.sendMessage({ target: 'tab' })).rejects.toThrow(
      RECEIVING_END_ERROR,
    );
  });

  it('messaging: resolves undefined when no listener responds', async () => {
    fake.tabs
      .add({ url: `${EXTENSION_ORIGIN}/options.html` })
      .onMessage.addListener(() => undefined);
    await expect(chrome.runtime.sendMessage({ target: 'sw' })).resolves.toBeUndefined();
  });

  it('messaging: a content script message reaches the SW with its tab as sender', async () => {
    const page = fake.tabs.add({ url: ARTWORK_URL, active: true });
    const senders: chrome.runtime.MessageSender[] = [];
    chrome.runtime.onMessage.addListener((_message, sender, sendResponse) => {
      senders.push(sender);
      sendResponse({ ok: true });
    });
    await page.sendMessage({ target: 'sw', type: 'job/listForTab' });
    expect(senders.map((s) => [s.tab?.id, s.frameId, s.url])).toEqual([[page.id, 0, ARTWORK_URL]]);
  });

  it('messaging: an offscreen event reaches the SW with the offscreen URL as sender', async () => {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'test',
    });
    const urls: Array<string | undefined> = [];
    chrome.runtime.onMessage.addListener((_message, sender) => {
      urls.push(sender.url);
    });
    await fake.offscreen.document?.sendMessage({ target: 'sw', type: 'off/ready', taskId: 't' });
    expect(urls).toEqual([`${EXTENSION_ORIGIN}/offscreen.html`]);
  });

  it('messaging: a listener returning true answers asynchronously', async () => {
    const page = fake.tabs.add({ url: ARTWORK_URL });
    page.onMessage.addListener((_message, _sender, sendResponse) => {
      setTimeout(() => sendResponse({ ok: true, late: true }), 1);
      return true;
    });
    await expect(chrome.tabs.sendMessage(page.id, { target: 'tab' })).resolves.toEqual({
      ok: true,
      late: true,
    });
  });

  it('messaging: receivers get a JSON copy of the message', async () => {
    const page = fake.tabs.add({ url: ARTWORK_URL });
    page.handle((message) => {
      (message as { n: number }).n = 2;
      return { ok: true };
    });
    const message = { target: 'tab', n: 1 };
    await chrome.tabs.sendMessage(page.id, message);
    expect(message.n).toBe(1);
  });

  it('messaging: tabs.sendMessage to a frame other than the top frame rejects', async () => {
    const page = fake.tabs.add({ url: ARTWORK_URL });
    page.handle(() => ({ ok: true }));
    await expect(chrome.tabs.sendMessage(page.id, {}, { frameId: 3 })).rejects.toThrow(
      RECEIVING_END_ERROR,
    );
  });
});

describe('chrome fake: contexts, tabs and windows', () => {
  it('getContexts: filters by context type and document URL', async () => {
    const settings = fake.tabs.add({ url: `${EXTENSION_ORIGIN}/options.html` });
    fake.tabs.add({ url: ARTWORK_URL });
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'test',
    });
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['TAB'],
      documentUrls: [`${EXTENSION_ORIGIN}/options.html`],
    });
    expect(contexts.map((c) => [c.contextType, c.tabId])).toEqual([['TAB', settings.id]]);
  });

  it('getContexts: lists the offscreen document while it is open', async () => {
    const filter = { contextTypes: ['OFFSCREEN_DOCUMENT' as const] };
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'test',
    });
    const open = await chrome.runtime.getContexts(filter);
    await chrome.offscreen.closeDocument();
    expect([open.length, (await chrome.runtime.getContexts(filter)).length]).toEqual([1, 0]);
  });

  it('tabs: create inserts at the index and shifts the tabs to its right', async () => {
    const left = fake.tabs.add({ url: ARTWORK_URL });
    const right = fake.tabs.add({ url: 'https://www.pixiv.net/' });
    const created = await chrome.tabs.create({ url: 'https://example.com/', index: 1 });
    expect([left.tab.index, created.index, right.tab.index]).toEqual([0, 1, 2]);
  });

  it('tabs: update of an unknown tab rejects', async () => {
    await expect(chrome.tabs.update(99, { active: true })).rejects.toThrow('No tab with id: 99.');
  });

  it('windows: update focuses that window only', async () => {
    const second = fake.tabs.addWindow();
    await chrome.windows.update(second, { focused: true });
    expect([fake.tabs.isFocused(1), fake.tabs.isFocused(second)]).toEqual([false, true]);
  });

  it('offscreen: a second document is refused', async () => {
    const params = { url: 'offscreen.html', reasons: ['BLOBS' as const], justification: 'test' };
    await chrome.offscreen.createDocument(params);
    await expect(chrome.offscreen.createDocument(params)).rejects.toThrow(
      'Only a single offscreen document may be created.',
    );
  });

  it('offscreen: closing without a document rejects', async () => {
    await expect(chrome.offscreen.closeDocument()).rejects.toThrow(
      'No current offscreen document.',
    );
  });
});

describe('chrome fake: offscreen lifecycle holds (D16)', () => {
  const params = { url: 'offscreen.html', reasons: ['BLOBS' as const], justification: 'test' };
  const filter = { contextTypes: ['OFFSCREEN_DOCUMENT' as const] };

  async function listed(): Promise<number> {
    return (await chrome.runtime.getContexts(filter)).length;
  }

  function settledFlag(promise: Promise<void>): () => boolean {
    let settled = false;
    void promise.then(() => (settled = true));
    return () => settled;
  }

  /** Lets every queued microtask and the next macrotask run. */
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('holdCreation: getContexts lists the document before it listens', async () => {
    fake.offscreen.setHandler(() => ({ ok: true }));
    fake.offscreen.holdCreation();
    void chrome.offscreen.createDocument(params);
    await flush();
    expect(await listed()).toBe(1);
  });

  it('holdCreation: a send to the listed document rejects with RECEIVING_END_ERROR', async () => {
    fake.offscreen.setHandler(() => ({ ok: true }));
    fake.offscreen.holdCreation();
    void chrome.offscreen.createDocument(params);
    await flush();
    await expect(chrome.runtime.sendMessage({ target: 'offscreen' })).rejects.toThrow(
      RECEIVING_END_ERROR,
    );
  });

  it('holdCreation: createDocument stays pending until release', async () => {
    fake.offscreen.holdCreation();
    const created = settledFlag(chrome.offscreen.createDocument(params));
    await flush();
    expect(created()).toBe(false);
  });

  it('holdCreation: a handler set during the hold leaves the document deaf', async () => {
    fake.offscreen.holdCreation();
    void chrome.offscreen.createDocument(params);
    await flush();
    fake.offscreen.setHandler(() => ({ ok: true }));
    await expect(chrome.runtime.sendMessage({ target: 'offscreen' })).rejects.toThrow(
      RECEIVING_END_ERROR,
    );
  });

  it('holdCreation: after release the scripted handler answers and createDocument has resolved', async () => {
    fake.offscreen.setHandler(() => ({ ok: true }));
    const hold = fake.offscreen.holdCreation();
    const creating = chrome.offscreen.createDocument(params);
    const created = settledFlag(creating);
    await flush();
    hold.release();
    await creating;
    expect([created(), await chrome.runtime.sendMessage({ target: 'offscreen' })]).toEqual([
      true,
      { ok: true },
    ]);
  });

  it('holdCreation: after release the next document is created without a hold', async () => {
    fake.offscreen.setHandler(() => ({ ok: true }));
    fake.offscreen.holdCreation().release();
    await chrome.offscreen.createDocument(params);
    await expect(chrome.runtime.sendMessage({ target: 'offscreen' })).resolves.toEqual({
      ok: true,
    });
  });

  it('holdClose: the closing document stays listed and deaf', async () => {
    fake.offscreen.setHandler(() => ({ ok: true }));
    await chrome.offscreen.createDocument(params);
    fake.offscreen.holdClose();
    void chrome.offscreen.closeDocument();
    await flush();
    const count = await listed();
    const send = chrome.runtime.sendMessage({ target: 'offscreen' }).then(
      () => 'answered',
      (error: Error) => error.message,
    );
    expect([count, await send]).toEqual([1, RECEIVING_END_ERROR]);
  });

  it('holdClose: closeDocument stays pending until release', async () => {
    await chrome.offscreen.createDocument(params);
    fake.offscreen.holdClose();
    const closed = settledFlag(chrome.offscreen.closeDocument());
    await flush();
    expect(closed()).toBe(false);
  });

  it('holdClose: after release the document is gone and closeDocument has resolved', async () => {
    await chrome.offscreen.createDocument(params);
    const hold = fake.offscreen.holdClose();
    const closing = chrome.offscreen.closeDocument();
    const closed = settledFlag(closing);
    await flush();
    hold.release();
    await closing;
    expect([closed(), await listed()]).toEqual([true, 0]);
  });
});

describe('chrome fake: declarativeNetRequest', () => {
  const rule = (id: number): chrome.declarativeNetRequest.Rule => ({
    id,
    priority: 1,
    action: { type: 'block' },
    condition: { requestDomains: ['i.pximg.net'] },
  });

  it('dnr: updateSessionRules removes before adding, so a rule can be replaced', async () => {
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: [rule(1)] });
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1],
      addRules: [rule(1)],
    });
    expect(await chrome.declarativeNetRequest.getSessionRules()).toEqual([rule(1)]);
  });

  it('dnr: a duplicate rule id is refused', async () => {
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: [rule(1)] });
    await expect(
      chrome.declarativeNetRequest.updateSessionRules({ addRules: [rule(1)] }),
    ).rejects.toThrow('Rule with id 1 does not have a unique ID.');
  });
});

describe('chrome fake: lifecycle', () => {
  it('restartWorker: drops the SW listeners', () => {
    chrome.runtime.onMessage.addListener(() => undefined);
    chrome.downloads.onChanged.addListener(() => undefined);
    chrome.action.onClicked.addListener(() => undefined);
    fake.restartWorker();
    expect([
      chrome.runtime.onMessage.hasListeners(),
      chrome.downloads.onChanged.hasListeners(),
      chrome.action.onClicked.hasListeners(),
    ]).toEqual([false, false, false]);
  });

  it('restartWorker: keeps Chrome’s download UI setting and the call log', async () => {
    await chrome.downloads.setUiOptions({ enabled: false });
    fake.restartWorker();
    expect([fake.downloads.uiEnabled, fake.downloads.uiCalls()]).toEqual([false, [false]]);
  });

  it('reset: turns the download UI back on and empties the call log', async () => {
    await chrome.downloads.setUiOptions({ enabled: false });
    fake.reset();
    expect([fake.downloads.uiEnabled, fake.downloads.callLog]).toEqual([true, []]);
  });

  it('reset: drops injected setUiOptions failures', async () => {
    fake.downloads.failNextSetUiOptions();
    fake.reset();
    await expect(chrome.downloads.setUiOptions({ enabled: false })).resolves.toBeUndefined();
  });

  it('restartWorker: keeps storage, downloads and the badge', async () => {
    await chrome.storage.session.set({ 'job:1': { v: 1 } });
    await chrome.downloads.download({ url: BLOB_URL, filename: 'a/1.jpg' });
    await chrome.action.setBadgeText({ text: '12' });
    fake.restartWorker();
    expect([
      fake.storage.session.snapshot(),
      fake.downloads.items().length,
      await chrome.action.getBadgeText({}),
    ]).toEqual([{ 'job:1': { v: 1 } }, 1, '12']);
  });

  it('reset: returns to the freshly installed state', async () => {
    await chrome.storage.sync.set({ k: 1 });
    await chrome.action.setBadgeText({ text: '3' });
    fake.tabs.add({ url: ARTWORK_URL });
    fake.reset();
    expect([
      fake.storage.sync.snapshot(),
      fake.action.badgeText,
      fake.tabs.all().length,
      fake.api.storage.sync.set.mock.calls.length,
    ]).toEqual([{}, '', 0, 0]);
  });

  it('reset: restores the default implementations of the API mocks', async () => {
    fake.api.downloads.download.mockRejectedValue(new Error('boom'));
    fake.reset();
    await expect(chrome.downloads.download({ url: BLOB_URL, filename: 'a/1.jpg' })).resolves.toBe(
      1,
    );
  });
});
