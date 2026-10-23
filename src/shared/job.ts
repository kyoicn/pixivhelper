// Job model and request protocol (design-download-engine.md "Data Model", "API / Interface Contract").
// Lives in src/shared so the pure core and every context share it (system.md §4 "Layering rule (D11)").
// Extends src/shared/types.ts.

import type { Failure, JobMode, SettingsSnapshot, UgoiraOutput } from './types';

export type ErrorCode = 'BAD_REQUEST' | 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL';

export type StartRequest =
  | { mode: 'full'; artworkId: string; expectedFiles: number } // expectedFiles: pageCount, or 1 for ugoira
  | { mode: 'retryPages'; artworkId: string; folder: string; pages: number[]; total: number } // pages: 0-based, unique, < total ≤ 200
  | { mode: 'retryEncode'; artworkId: string; folder: string; format: 'mp4' | 'webm' }
  | { mode: 'retryMetadata'; artworkId: string; folder: string };

export type FileRole = 'metadata' | 'page' | 'zip' | 'framesJson' | 'video';
export type FileState =
  | 'queued' // waiting for deps / a slot
  | 'fetching' // offscreen task running (fetch, text blob, or encode)
  | 'ready' // offscreen holds a blob: URL; not yet handed to Chrome
  | 'saving' // chrome.downloads.download issued (downloadId may still be unknown)
  | 'done' // Chrome reported state 'complete' (or zip retained, when save=false)
  | 'failed'
  | 'skipped'; // never attempted: cancel, 403 stop, or a failed dependency

export interface FileTask {
  idx: number; // queue order; dispatch is in ascending idx
  role: FileRole;
  page?: number; // 0-based page index (role 'page')
  name: string; // basename: '135882741_p0.jpg', 'metadata.json', '136004512_ugoira.zip', 'frames.json', '136004512.mp4'
  url?: string; // source URL (page, zip) — allowlisted i.pximg.net
  save: boolean; // false only for the retryEncode zip (fetched into memory, not written)
  dependsOn: number[]; // idx list that must be 'done' first
  state: FileState;
  taskId?: string; // offscreen task id (uuid)
  blobUrl?: string;
  downloadId?: number;
  failure?: Failure;
  /**
   * metadata.json text, built when the file is dispatched (the same mutation drops `metaBody`).
   * Kept while the file is in flight so a re-queue after a restart can dispatch it again.
   */
  text?: string;
}

export interface UgoiraState {
  frames: Array<{ file: string; delay: number }>; // ugoira_meta.body.frames, unmodified
  format: UgoiraOutput; // effective: 'mp4' | 'webm' | 'zip'
  avcCodec: string | null; // chosen codec string when format === 'mp4'
  width: number; // from /ajax/illust body (probe key); encoder uses decoded frame size
  height: number;
  zipLoaded: number;
  zipTotal: number | null;
  encDone: number;
  percent: number; // last emitted, monotonic
}

export interface JobRecord {
  v: 1;
  jobId: string; // crypto.randomUUID()
  artworkId: string; // /^\d{1,12}$/
  originTabId: number; // MessageSender.tab.id (no "tabs" permission needed)
  createdAt: number; // Date.now()
  mode: JobMode;
  request: StartRequest; // the validated start payload (for re-running 'resolving' after a restart)
  kind: 'pages' | 'ugoira' | 'unknown';
  phase: 'resolving' | 'transferring' | 'ended';
  snapshot: SettingsSnapshot; // taken at click (PRD §4.1 #8)
  expectedFiles: number; // badge count while resolving — full: tab hint clamped 0..200; retryPages: pages.length; retryEncode: 1; retryMetadata: 0
  metaBody: Record<string, unknown> | null; // raw /ajax/illust body, kept only until the metadata file is dispatched
  folder: string | null; // resolved (full) or echoed (retries); validated by isSafeRelativeFolder
  pagesTotal: number; // display total N in "k / N" (full page count, also for retries)
  pagesOffset: number; // pages already saved before this run (retryPages: total − requested)
  files: FileTask[];
  ugoira: UgoiraState | null;
  stopReason: null | 'cancelled' | 'forbidden';
  apiFailure: { endpoint: 'illust' | 'pages' | 'ugoira_meta'; failure: Failure } | null;
}
