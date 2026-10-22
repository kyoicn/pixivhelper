import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_KEY } from '../../src/shared/constants';
import {
  DEFAULT_SETTINGS,
  PATTERN_MAX_CHARS,
  effectiveFormat,
  onSettingsChanged,
  readSettings,
  writeSettings,
  type StoredSettings,
} from '../../src/shared/settings';
import type { Settings, UgoiraOutput } from '../../src/shared/types';

// Minimal in-memory chrome.storage: sync, local and session areas plus onChanged.
type AreaName = 'sync' | 'local' | 'session';
type ChangeListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: AreaName,
) => void;

function createStorage() {
  const listeners = new Set<ChangeListener>();
  const area = (name: AreaName) => {
    const data = new Map<string, unknown>();
    const fake = {
      data,
      getError: null as Error | null,
      setError: null as Error | null,
      get: vi.fn((key: string): Promise<Record<string, unknown>> => {
        if (fake.getError) return Promise.reject(fake.getError);
        return Promise.resolve(data.has(key) ? { [key]: structuredClone(data.get(key)) } : {});
      }),
      set: vi.fn((items: Record<string, unknown>): Promise<void> => {
        if (fake.setError) return Promise.reject(fake.setError);
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: data.get(key), newValue: structuredClone(value) };
          data.set(key, structuredClone(value));
        }
        // Chrome dispatches onChanged asynchronously.
        setTimeout(() => {
          for (const listener of listeners) listener(changes, name);
        }, 0);
        return Promise.resolve();
      }),
    };
    return fake;
  };
  return {
    sync: area('sync'),
    local: area('local'),
    session: area('session'),
    onChanged: {
      addListener: (listener: ChangeListener) => listeners.add(listener),
      removeListener: (listener: ChangeListener) => listeners.delete(listener),
    },
  };
}

let storage: ReturnType<typeof createStorage>;

const record = (fields: Partial<StoredSettings>): StoredSettings => ({
  ...DEFAULT_SETTINGS,
  v: 1,
  updatedAt: 1,
  ...fields,
});

beforeEach(() => {
  storage = createStorage();
  vi.stubGlobal('chrome', { storage });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DEFAULT_SETTINGS', () => {
  it('DEFAULT_SETTINGS: are the PRD §4.9 defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput: 'mp4',
      saveMetadata: true,
    });
  });

  it('PATTERN_MAX_CHARS: is 200 (PRD §4.9)', () => {
    expect(PATTERN_MAX_CHARS).toBe(200);
  });
});

describe('readSettings', () => {
  it('readSettings: returns the defaults with updatedAt 0 when nothing is stored', async () => {
    await expect(readSettings()).resolves.toEqual({ ...DEFAULT_SETTINGS, updatedAt: 0 });
  });

  it('readSettings: returns the sync record when only sync has one', async () => {
    storage.sync.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'webm', updatedAt: 5 }));
    await expect(readSettings()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      ugoiraOutput: 'webm',
      updatedAt: 5,
    });
  });

  it('readSettings: returns the local record when only local has one', async () => {
    storage.local.data.set(SETTINGS_KEY, record({ saveMetadata: false, updatedAt: 5 }));
    await expect(readSettings()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      saveMetadata: false,
      updatedAt: 5,
    });
  });

  it('readSettings: the newer sync record wins', async () => {
    storage.sync.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'webm', updatedAt: 20 }));
    storage.local.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'zip', updatedAt: 10 }));
    expect((await readSettings()).ugoiraOutput).toBe('webm');
  });

  it('readSettings: the newer local record wins (sync is stale after a quota-hit write)', async () => {
    storage.sync.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'webm', updatedAt: 10 }));
    storage.local.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'zip', updatedAt: 20 }));
    expect((await readSettings()).ugoiraOutput).toBe('zip');
  });

  it('readSettings: a tie goes to sync', async () => {
    storage.sync.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'webm', updatedAt: 10 }));
    storage.local.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'zip', updatedAt: 10 }));
    expect((await readSettings()).ugoiraOutput).toBe('webm');
  });

  it('readSettings: returns only the settings fields and updatedAt', async () => {
    storage.sync.data.set(SETTINGS_KEY, { ...record({ updatedAt: 3 }), extra: 'x' });
    expect(Object.keys(await readSettings()).sort()).toEqual([
      'folderPattern',
      'saveMetadata',
      'ugoiraOutput',
      'updatedAt',
    ]);
  });

  it('readSettings: replaces every corrupt field with its default', async () => {
    storage.sync.data.set(SETTINGS_KEY, {
      v: 7,
      folderPattern: 42,
      ugoiraOutput: 'gif',
      saveMetadata: 'yes',
      updatedAt: 'later',
    });
    await expect(readSettings()).resolves.toEqual({ ...DEFAULT_SETTINGS, updatedAt: 0 });
  });

  it('readSettings: keeps the valid fields of a partly corrupt record', async () => {
    storage.sync.data.set(SETTINGS_KEY, {
      folderPattern: 'pixiv/{artist}',
      ugoiraOutput: 'avi',
      saveMetadata: false,
      updatedAt: 9,
    });
    await expect(readSettings()).resolves.toEqual({
      folderPattern: 'pixiv/{artist}',
      ugoiraOutput: 'mp4',
      saveMetadata: false,
      updatedAt: 9,
    });
  });

  it.each(['/abs', 'pixiv/{artst}', '', 'a'.repeat(PATTERN_MAX_CHARS + 1)])(
    'readSettings: treats the invalid stored pattern %j as absent',
    async (folderPattern) => {
      storage.sync.data.set(SETTINGS_KEY, record({ folderPattern, ugoiraOutput: 'zip' }));
      await expect(readSettings()).resolves.toMatchObject({
        folderPattern: DEFAULT_SETTINGS.folderPattern,
        ugoiraOutput: 'zip',
      });
    },
  );

  it.each([['garbage'], [null], [[1, 2]], [7]])(
    'readSettings: ignores the non-object sync record %j and uses local',
    async (raw) => {
      storage.sync.data.set(SETTINGS_KEY, raw);
      storage.local.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'zip', updatedAt: 1 }));
      expect((await readSettings()).ugoiraOutput).toBe('zip');
    },
  );

  it('readSettings: a record without a usable updatedAt loses to a dated one', async () => {
    storage.sync.data.set(SETTINGS_KEY, { ...record({ ugoiraOutput: 'webm' }), updatedAt: NaN });
    storage.local.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'zip', updatedAt: 1 }));
    expect((await readSettings()).ugoiraOutput).toBe('zip');
  });

  it('readSettings: falls back to local when sync cannot be read', async () => {
    storage.sync.getError = new Error('sync unavailable');
    storage.sync.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'webm', updatedAt: 99 }));
    storage.local.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'zip', updatedAt: 1 }));
    expect((await readSettings()).ugoiraOutput).toBe('zip');
  });

  it('readSettings: never throws, even when neither area can be read', async () => {
    storage.sync.getError = new Error('sync unavailable');
    storage.local.getError = new Error('local unavailable');
    await expect(readSettings()).resolves.toEqual({ ...DEFAULT_SETTINGS, updatedAt: 0 });
  });

  it('readSettings: works when the sync area does not exist at all', async () => {
    vi.stubGlobal('chrome', { storage: { ...storage, sync: undefined } });
    storage.local.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'zip' }));
    expect((await readSettings()).ugoiraOutput).toBe('zip');
  });
});

describe('writeSettings', () => {
  const NOW = 1_761_000_000_000;
  const next: Settings = {
    folderPattern: 'pixiv/{artist}/{title}',
    ugoiraOutput: 'webm',
    saveMetadata: false,
  };

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  it('writeSettings: stores the same v1 record with updatedAt in sync and local', async () => {
    await writeSettings(next);
    const expected: StoredSettings = { ...next, v: 1, updatedAt: NOW };
    expect([storage.sync.data.get(SETTINGS_KEY), storage.local.data.get(SETTINGS_KEY)]).toEqual([
      expected,
      expected,
    ]);
  });

  it('writeSettings: reports ok and the updatedAt it stored', async () => {
    await expect(writeSettings(next)).resolves.toEqual({ ok: true, updatedAt: NOW });
  });

  it('writeSettings: stores only the three settings, not extra caller fields', async () => {
    await writeSettings({ ...next, updatedAt: 5, junk: true } as Settings);
    expect(Object.keys(storage.sync.data.get(SETTINGS_KEY) as object).sort()).toEqual([
      'folderPattern',
      'saveMetadata',
      'ugoiraOutput',
      'updatedAt',
      'v',
    ]);
  });

  it('writeSettings: still reports ok when sync is over quota (CUJ-3 edge)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage.sync.setError = new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
    await expect(writeSettings(next)).resolves.toEqual({ ok: true, updatedAt: NOW });
  });

  it('writeSettings: after a sync quota error, local holds the value and reads return it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage.sync.data.set(SETTINGS_KEY, record({ ugoiraOutput: 'zip', updatedAt: NOW - 1000 }));
    storage.sync.setError = new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded');
    await writeSettings(next);
    await expect(readSettings()).resolves.toEqual({ ...next, updatedAt: NOW });
  });

  it('writeSettings: warns with the area when a write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage.sync.setError = new Error('QUOTA_BYTES quota exceeded');
    await writeSettings(next);
    expect(warn).toHaveBeenCalledWith(
      '[hfp:settings]',
      'storage.sync write failed:',
      'QUOTA_BYTES quota exceeded',
    );
  });

  it('writeSettings: reports ok when only sync stored the value', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage.local.setError = new Error('local unavailable');
    await expect(writeSettings(next)).resolves.toEqual({ ok: true, updatedAt: NOW });
  });

  it('writeSettings: reports not ok, without throwing, when neither area stored it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage.sync.setError = new Error('sync unavailable');
    storage.local.setError = new Error('local unavailable');
    await expect(writeSettings(next)).resolves.toEqual({ ok: false, updatedAt: NOW });
  });

  it('writeSettings: reports ok when the sync area does not exist at all', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('chrome', { storage: { ...storage, sync: undefined } });
    await expect(writeSettings(next)).resolves.toEqual({ ok: true, updatedAt: NOW });
  });

  it('writeSettings: rejects an invalid pattern (caller bug)', async () => {
    await expect(writeSettings({ ...next, folderPattern: 'pixiv/{artst}' })).rejects.toThrow(
      'invalid folderPattern (unknownToken)',
    );
  });

  it('writeSettings: stores nothing for an invalid pattern', async () => {
    await writeSettings({ ...next, folderPattern: '/abs' }).catch(() => undefined);
    expect([...storage.sync.data.keys(), ...storage.local.data.keys()]).toEqual([]);
  });
});

describe('onSettingsChanged', () => {
  it('onSettingsChanged: calls back with the merged settings after a write', async () => {
    const cb = vi.fn();
    onSettingsChanged(cb);
    const { updatedAt } = await writeSettings({ ...DEFAULT_SETTINGS, ugoiraOutput: 'webm' });
    await vi.waitFor(() => {
      expect(cb).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, ugoiraOutput: 'webm', updatedAt });
    });
  });

  it('onSettingsChanged: reacts to a change that reached local only', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage.sync.setError = new Error('sync unavailable');
    const cb = vi.fn();
    onSettingsChanged(cb);
    await writeSettings({ ...DEFAULT_SETTINGS, saveMetadata: false });
    await vi.waitFor(() => {
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ saveMetadata: false }));
    });
  });

  it('onSettingsChanged: ignores other keys and the session area', async () => {
    const cb = vi.fn();
    onSettingsChanged(cb);
    await storage.sync.set({ other: 1 });
    await storage.session.set({ [SETTINGS_KEY]: record({}) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cb).not.toHaveBeenCalled();
  });

  it('onSettingsChanged: stops calling back after unsubscribing', async () => {
    const cb = vi.fn();
    const unsubscribe = onSettingsChanged(cb);
    unsubscribe();
    await writeSettings(DEFAULT_SETTINGS);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('effectiveFormat', () => {
  const AVC = 'avc1.640028';
  it.each<[UgoiraOutput, string | null, boolean, UgoiraOutput]>([
    ['zip', AVC, true, 'zip'],
    ['zip', null, false, 'zip'],
    ['mp4', AVC, true, 'mp4'],
    ['mp4', AVC, false, 'mp4'],
    ['mp4', null, true, 'webm'],
    ['mp4', null, false, 'zip'],
    ['webm', AVC, true, 'webm'],
    ['webm', null, true, 'webm'],
    ['webm', AVC, false, 'mp4'],
    ['webm', null, false, 'zip'],
  ])('effectiveFormat: %s with avc=%s vp9=%s → %s', (setting, avc, vp9, expected) => {
    expect(effectiveFormat(setting, { avc, vp9 })).toBe(expected);
  });
});
