// Canonical shared data model (system.md §6). Component modules extend these types; they never redefine them.

export type UgoiraOutput = 'mp4' | 'webm' | 'zip';
export interface Settings {
  folderPattern: string;
  ugoiraOutput: UgoiraOutput;
  saveMetadata: boolean;
}
export interface SettingsSnapshot extends Settings {
  effectiveFormat: UgoiraOutput | null; // null for non-ugoira
}

export interface WorkInfo {
  // parsed from GET /ajax/illust/{id} → body
  id: string; // body.illustId ?? body.id
  illustType: 0 | 1 | 2;
  xRestrict: 0 | 1 | 2;
  pageCount: number;
  width: number; // page-0 / ugoira frame size
  height: number;
  userName: string | null;
  userId: string | null;
  title: string | null;
}

export type FailureKind =
  | 'http' // status set; never 2xx
  | 'pixivError' // 2xx/4xx JSON with { error: true }
  | 'network' // fetch TypeError (DNS, reset, offline)
  | 'timeout' // 30 s inactivity (system.md §9)
  | 'disk' // chrome.downloads interrupt FILE_* or "Invalid filename"
  | 'dismissed' // interrupt USER_CANCELED (Save As dialog dismissed) — never retried
  | 'encode' // zip parse / decode / encoder / muxer error
  | 'aborted'; // our own cancel
export interface Failure {
  kind: FailureKind;
  status?: number;
  detail?: string;
  attempts: number;
}

export type JobMode = 'full' | 'retryPages' | 'retryEncode' | 'retryMetadata';
export type ErrorCause = 'offline' | 'refused' | 'server' | 'disk';
export type JobOutcome =
  | { type: 'saved'; folder: string; pages?: number; format?: UgoiraOutput }
  | { type: 'partial'; folder: string; total: number; saved: number; failedPages: number[] }
  | { type: 'metadataOnly'; folder: string; total: number }
  | { type: 'encodeFailed'; folder: string; format: 'mp4' | 'webm' }
  | { type: 'error'; cause: ErrorCause }
  | { type: 'needsLogin' }
  | { type: 'unavailable' }
  | { type: 'cancelled' };

export type JobProgress =
  | { kind: 'pages'; done: number; total: number } // done includes retry offset
  | { kind: 'percent'; percent: number; phase: 'frames' | 'encode'; indeterminate: boolean };

export interface JobView {
  // pushed SW → tab; full snapshot, idempotent
  jobId: string;
  artworkId: string;
  kind: 'pages' | 'ugoira' | 'unknown'; // unknown while resolving
  status: 'running' | 'ended';
  progress: JobProgress | null; // null while resolving
  format: UgoiraOutput | null;
  folder: string | null;
  outcome: JobOutcome | null; // non-null iff status === 'ended'
}

/** Result of `fetchWithRetry` (system.md §9). */
export type RetryResult<T> =
  { ok: true; value: T; status: number; attempts: number } | { ok: false; failure: Failure };
