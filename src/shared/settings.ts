// Settings schema, defaults, and read/merge/write across storage.sync and storage.local
// (design-settings-model.md "Read / write algorithm").

import { PATTERN_MAX_CHARS, SETTINGS_KEY } from './constants';
import { createLogger } from './log';
import { validatePattern } from './pattern';
import type { Settings, UgoiraOutput } from './types';

export { PATTERN_MAX_CHARS };

export const DEFAULT_SETTINGS: Settings = {
  folderPattern: 'pixiv/{artist}-{id}',
  ugoiraOutput: 'mp4',
  saveMetadata: true,
};

/** The record under SETTINGS_KEY, identical in storage.sync and storage.local. */
export interface StoredSettings extends Settings {
  v: 1;
  updatedAt: number;
}

type PersistedSettings = Settings & { updatedAt: number };
type SettingsArea = 'sync' | 'local';

const UGOIRA_OUTPUTS: readonly UgoiraOutput[] = ['mp4', 'webm', 'zip'];
const log = createLogger('settings');

/**
 * The newest record across sync and local (tie → sync), parsed field by field. Never throws:
 * missing, unreadable or invalid values fall back to DEFAULT_SETTINGS per field.
 */
export async function readSettings(): Promise<PersistedSettings> {
  const [sync, local] = await Promise.allSettled([getRecord('sync'), getRecord('local')]);
  const fromSync = sync.status === 'fulfilled' ? parseRecord(sync.value) : null;
  const fromLocal = local.status === 'fulfilled' ? parseRecord(local.value) : null;
  if (fromSync && fromLocal) return fromLocal.updatedAt > fromSync.updatedAt ? fromLocal : fromSync;
  return fromSync ?? fromLocal ?? { ...DEFAULT_SETTINGS, updatedAt: 0 };
}

/**
 * Writes the same record to sync and local. `ok` is true if either area stored it (PRD CUJ-3:
 * the user still sees Saved when sync is unavailable or over quota). `updatedAt` lets a settings
 * tab recognize the storage.onChanged echo of its own write. Rejects only on an invalid pattern,
 * which is a caller bug: the UI never saves one.
 */
export async function writeSettings(next: Settings): Promise<{ ok: boolean; updatedAt: number }> {
  const error = validatePattern(next.folderPattern);
  if (error) throw new Error(`writeSettings: invalid folderPattern (${error.code})`);
  const record: StoredSettings = {
    v: 1,
    folderPattern: next.folderPattern,
    ugoiraOutput: next.ugoiraOutput,
    saveMetadata: next.saveMetadata,
    updatedAt: Date.now(),
  };
  const storedInSync = await setRecord('sync', record);
  const storedInLocal = await setRecord('local', record);
  return { ok: storedInSync || storedInLocal, updatedAt: record.updatedAt };
}

/** Calls `cb` with the re-read merged settings whenever either area's record changes. */
export function onSettingsChanged(cb: (s: PersistedSettings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ): void => {
    if ((area === 'sync' || area === 'local') && SETTINGS_KEY in changes) {
      void readSettings().then(cb);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** The format an ugoira is actually encoded to on this machine (design-download-engine.md step 5). */
export function effectiveFormat(
  setting: UgoiraOutput,
  caps: { avc: string | null; vp9: boolean },
): UgoiraOutput {
  if (setting === 'mp4') return caps.avc ? 'mp4' : caps.vp9 ? 'webm' : 'zip';
  if (setting === 'webm') return caps.vp9 ? 'webm' : caps.avc ? 'mp4' : 'zip';
  return 'zip';
}

async function getRecord(area: SettingsArea): Promise<unknown> {
  const items = await chrome.storage[area].get(SETTINGS_KEY);
  return items[SETTINGS_KEY];
}

async function setRecord(area: SettingsArea, record: StoredSettings): Promise<boolean> {
  try {
    await chrome.storage[area].set({ [SETTINGS_KEY]: record });
    return true;
  } catch (err) {
    log.warn(`storage.${area} write failed:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

// A non-object record counts as absent; inside an object, each bad field takes its default.
function parseRecord(raw: unknown): PersistedSettings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const pattern = r.folderPattern;
  const output = r.ugoiraOutput;
  return {
    folderPattern:
      typeof pattern === 'string' && validatePattern(pattern) === null
        ? pattern
        : DEFAULT_SETTINGS.folderPattern,
    ugoiraOutput: UGOIRA_OUTPUTS.find((known) => known === output) ?? DEFAULT_SETTINGS.ugoiraOutput,
    saveMetadata:
      typeof r.saveMetadata === 'boolean' ? r.saveMetadata : DEFAULT_SETTINGS.saveMetadata,
    updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  };
}
