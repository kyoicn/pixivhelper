// Message catalog (system.md §7; design-download-engine.md and design-offscreen-worker.md
// "API / Interface Contract"). Every listener ignores messages whose `target` is not its own.
// Payload validation (system.md §7 "Validation", "Sender checks") belongs in this module too.

import type { ErrorCode, StartRequest, UgoiraState } from './job';
import { MAX_FOLDER_CHARS, MAX_PAGES_PER_WORK, OFFSCREEN_DOCUMENT_PATH } from './constants';
import { isApiUrl, isArtworkId, isBytesUrl } from './pixiv-api';
import type {
  ErrorCause,
  Failure,
  FailureKind,
  JobOutcome,
  JobProgress,
  JobView,
  RetryResult,
  UgoiraOutput,
} from './types';

export type MessageTarget = 'sw' | 'offscreen' | 'tab';

/** Every message names its destination context and its type; the payload is spread alongside. */
export interface Envelope<
  Target extends MessageTarget = MessageTarget,
  Type extends string = string,
> {
  target: Target;
  type: Type;
}

export type OkResponse<Payload extends object = object> = { ok: true } & Payload;
export interface ErrorResponse {
  ok: false;
  error: ErrorCode;
}
/** Request/response shape: `{ ok: true, … } | { ok: false, error: ErrorCode }`. */
export type MessageResponse<Payload extends object = object> = OkResponse<Payload> | ErrorResponse;

/** Encoder support for one even frame size; also the `caps:<w>x<h>` storage value. */
export interface CodecCaps {
  avc: string | null; // chosen H.264 codec string, or null when no profile is encodable
  vp9: boolean;
}

// ── Content script → SW (`target: 'sw'`; sender must have `tab.id`) ──

export type JobStartMessage = Envelope<'sw', 'job/start'> & StartRequest;
export interface JobCancelMessage extends Envelope<'sw', 'job/cancel'> {
  jobId: string;
}
export type JobListForTabMessage = Envelope<'sw', 'job/listForTab'>;
export interface CapsGetMessage extends Envelope<'sw', 'caps/get'> {
  width: number; // 1..16384
  height: number; // 1..16384
}
export type ContentToSwMessage =
  JobStartMessage | JobCancelMessage | JobListForTabMessage | CapsGetMessage;

/** Sent once the job is created and persisted, before resolving. */
export type JobStartResponse = MessageResponse<{ view: JobView }>;
/** `FORBIDDEN` if the sender tab is not the job's origin tab; `NOT_FOUND` if the job already ended. */
export type JobCancelResponse = MessageResponse;
/** Running jobs whose origin tab is the sender tab (reload reattach). */
export type JobListForTabResponse = MessageResponse<{ views: JobView[] }>;
export type CapsGetResponse = MessageResponse<{ caps: CodecCaps }>;

// ── SW → content script (`target: 'tab'`; tabs.sendMessage(tabId, msg, { frameId: 0 })) ──

/** Full snapshot, never a delta; no response (a rejection means the tab is gone). */
export interface JobUpdateMessage extends Envelope<'tab', 'job/update'> {
  view: JobView;
}
/** First-party API proxy; `url` is an allowlisted pixiv API URL. */
export interface ApiFetchJsonMessage extends Envelope<'tab', 'api/fetchJson'> {
  url: string;
}
export type SwToTabMessage = JobUpdateMessage | ApiFetchJsonMessage;

export type ApiFetchJsonResponse = MessageResponse<{ result: RetryResult<unknown> }>;

// ── SW → offscreen commands (`target: 'offscreen'`; sender must have no `tab`) ──

export interface OffFetchBytesCommand extends Envelope<'offscreen', 'off/fetchBytes'> {
  taskId: string;
  url: string;
}
export interface OffMakeTextCommand extends Envelope<'offscreen', 'off/makeText'> {
  taskId: string;
  text: string;
  mime: string;
}
export interface OffFetchZipCommand extends Envelope<'offscreen', 'off/fetchZip'> {
  taskId: string;
  url: string;
  save: boolean;
}
export interface OffEncodeCommand extends Envelope<'offscreen', 'off/encode'> {
  taskId: string;
  zipTaskId: string;
  frames: UgoiraState['frames'];
  format: 'mp4' | 'webm';
  avcCodec: string | null;
  artworkId: string;
}
export interface OffAbortCommand extends Envelope<'offscreen', 'off/abort'> {
  taskIds: string[];
}
export interface OffReleaseCommand extends Envelope<'offscreen', 'off/release'> {
  taskIds: string[];
  keepRetained?: boolean; // keep retained zip bytes for a pending encode
}
export interface OffFetchJsonCommand extends Envelope<'offscreen', 'off/fetchJson'> {
  url: string;
  credentials: 'include';
}
export interface OffProbeCommand extends Envelope<'offscreen', 'off/probe'> {
  width: number;
  height: number;
}
export type OffTasksCommand = Envelope<'offscreen', 'off/tasks'>;

export type SwToOffscreenMessage =
  | OffFetchBytesCommand
  | OffMakeTextCommand
  | OffFetchZipCommand
  | OffEncodeCommand
  | OffAbortCommand
  | OffReleaseCommand
  | OffFetchJsonCommand
  | OffProbeCommand
  | OffTasksCommand;

/** Task commands are acknowledged immediately; their results arrive as events. */
export type OffCommandAck = MessageResponse;
export type OffFetchJsonResponse = MessageResponse<{ result: RetryResult<unknown> }>;
export type OffProbeResponse = MessageResponse<{ caps: CodecCaps }>;
export interface OffTaskSnapshot {
  taskId: string;
  state: 'running' | 'ready' | 'retained';
  blobUrl?: string;
}
export type OffTasksResponse = MessageResponse<{ tasks: OffTaskSnapshot[] }>;

// ── Offscreen → SW events (`target: 'sw'`; sender.url must be offscreen.html) ──

/** `blobUrl` is absent only for a zip fetched with `save: false`. */
export interface OffReadyEvent extends Envelope<'sw', 'off/ready'> {
  taskId: string;
  blobUrl?: string;
  size?: number;
}
export interface OffFailedEvent extends Envelope<'sw', 'off/failed'> {
  taskId: string;
  failure: Failure;
}
export interface OffZipProgressEvent extends Envelope<'sw', 'off/progress'> {
  taskId: string;
  phase: 'zip';
  loaded: number;
  total: number | null; // null without Content-Length
}
export interface OffEncodeProgressEvent extends Envelope<'sw', 'off/progress'> {
  taskId: string;
  phase: 'encode';
  done: number;
  total: number;
}
export type OffProgressEvent = OffZipProgressEvent | OffEncodeProgressEvent;
export type OffscreenToSwEvent = OffReadyEvent | OffFailedEvent | OffProgressEvent;

// ── By destination ──

export type SwMessage = ContentToSwMessage | OffscreenToSwEvent;
export type TabMessage = SwToTabMessage;
export type OffscreenMessage = SwToOffscreenMessage;
export type Message = SwMessage | TabMessage | OffscreenMessage;
export type MessageType = Message['type'];

/** Response of every request/response message type. Push messages and events have none. */
export interface ResponseMap {
  'job/start': JobStartResponse;
  'job/cancel': JobCancelResponse;
  'job/listForTab': JobListForTabResponse;
  'caps/get': CapsGetResponse;
  'api/fetchJson': ApiFetchJsonResponse;
  'off/fetchBytes': OffCommandAck;
  'off/makeText': OffCommandAck;
  'off/fetchZip': OffCommandAck;
  'off/encode': OffCommandAck;
  'off/abort': OffCommandAck;
  'off/release': OffCommandAck;
  'off/fetchJson': OffFetchJsonResponse;
  'off/probe': OffProbeResponse;
  'off/tasks': OffTasksResponse;
}
export type ResponseFor<M extends Message> = M['type'] extends keyof ResponseMap
  ? ResponseMap[M['type']]
  : undefined;

// ── Runtime guards (system.md §7 "Validation") ──
// Every handler validates its payload with these before use; invalid → { ok: false, error:
// 'BAD_REQUEST' } and a warn log. Folders get only the shape check here: the SW re-checks echoed
// folders with isSafeRelativeFolder() (pattern.ts).

const MAX_FRAME_EDGE = 16384;

type Fields = Record<string, unknown>;
type Check = (v: unknown) => boolean;
/** One guard per message type: adding a type to the catalog without a guard fails to compile. */
type GuardTable<M extends Message> = { [K in M['type']]: Check };

const UGOIRA_OUTPUTS: Record<UgoiraOutput, true> = { mp4: true, webm: true, zip: true };
const VIDEO_FORMATS: Record<'mp4' | 'webm', true> = { mp4: true, webm: true };
const FAILURE_KINDS: Record<FailureKind, true> = {
  http: true,
  pixivError: true,
  network: true,
  timeout: true,
  disk: true,
  dismissed: true,
  encode: true,
  internal: true,
  aborted: true,
};
const ERROR_CAUSES: Record<ErrorCause, true> = {
  offline: true,
  refused: true,
  server: true,
  disk: true,
};
const VIEW_KINDS: Record<JobView['kind'], true> = { pages: true, ugoira: true, unknown: true };
const VIEW_STATUSES: Record<JobView['status'], true> = { running: true, ended: true };
const PERCENT_PHASES: Record<Extract<JobProgress, { kind: 'percent' }>['phase'], true> = {
  frames: true,
  encode: true,
};

/** True for an envelope addressed to `target`; listeners ignore everything else. */
export function isForTarget<T extends MessageTarget>(m: unknown, target: T): m is Envelope<T> {
  return isRecord(m) && m.target === target && typeof m.type === 'string';
}

// Content script → SW

export function isJobStartMessage(m: unknown): m is JobStartMessage {
  return isEnvelope(m, 'sw', 'job/start') && isStartRequest(m);
}

export function isJobCancelMessage(m: unknown): m is JobCancelMessage {
  return isEnvelope(m, 'sw', 'job/cancel') && isId(m.jobId);
}

export function isJobListForTabMessage(m: unknown): m is JobListForTabMessage {
  return isEnvelope(m, 'sw', 'job/listForTab');
}

export function isCapsGetMessage(m: unknown): m is CapsGetMessage {
  return isEnvelope(m, 'sw', 'caps/get') && isFrameEdge(m.width) && isFrameEdge(m.height);
}

// SW → content script

export function isJobUpdateMessage(m: unknown): m is JobUpdateMessage {
  return isEnvelope(m, 'tab', 'job/update') && isJobView(m.view);
}

export function isApiFetchJsonMessage(m: unknown): m is ApiFetchJsonMessage {
  return isEnvelope(m, 'tab', 'api/fetchJson') && isApiUrl(m.url);
}

// SW → offscreen

export function isOffFetchBytesCommand(m: unknown): m is OffFetchBytesCommand {
  return isEnvelope(m, 'offscreen', 'off/fetchBytes') && isId(m.taskId) && isBytesUrl(m.url);
}

export function isOffMakeTextCommand(m: unknown): m is OffMakeTextCommand {
  return (
    isEnvelope(m, 'offscreen', 'off/makeText') &&
    isId(m.taskId) &&
    typeof m.text === 'string' &&
    isNonEmptyString(m.mime)
  );
}

export function isOffFetchZipCommand(m: unknown): m is OffFetchZipCommand {
  return (
    isEnvelope(m, 'offscreen', 'off/fetchZip') &&
    isId(m.taskId) &&
    isBytesUrl(m.url) &&
    typeof m.save === 'boolean'
  );
}

/** Frames are checked for shape only; the encoder reports bad delays as `encode` failures. */
export function isOffEncodeCommand(m: unknown): m is OffEncodeCommand {
  return (
    isEnvelope(m, 'offscreen', 'off/encode') &&
    isId(m.taskId) &&
    isId(m.zipTaskId) &&
    isFrames(m.frames) &&
    isKeyOf(m.format, VIDEO_FORMATS) &&
    (m.avcCodec === null || isNonEmptyString(m.avcCodec)) &&
    isArtworkId(m.artworkId)
  );
}

export function isOffAbortCommand(m: unknown): m is OffAbortCommand {
  return isEnvelope(m, 'offscreen', 'off/abort') && isIdList(m.taskIds);
}

export function isOffReleaseCommand(m: unknown): m is OffReleaseCommand {
  return (
    isEnvelope(m, 'offscreen', 'off/release') &&
    isIdList(m.taskIds) &&
    isOptional(m, 'keepRetained', isBoolean)
  );
}

export function isOffFetchJsonCommand(m: unknown): m is OffFetchJsonCommand {
  return (
    isEnvelope(m, 'offscreen', 'off/fetchJson') && isApiUrl(m.url) && m.credentials === 'include'
  );
}

export function isOffProbeCommand(m: unknown): m is OffProbeCommand {
  return isEnvelope(m, 'offscreen', 'off/probe') && isFrameEdge(m.width) && isFrameEdge(m.height);
}

export function isOffTasksCommand(m: unknown): m is OffTasksCommand {
  return isEnvelope(m, 'offscreen', 'off/tasks');
}

// Offscreen → SW

export function isOffReadyEvent(m: unknown): m is OffReadyEvent {
  return (
    isEnvelope(m, 'sw', 'off/ready') &&
    isId(m.taskId) &&
    isOptional(m, 'blobUrl', isBlobUrl) &&
    isOptional(m, 'size', isCount)
  );
}

export function isOffFailedEvent(m: unknown): m is OffFailedEvent {
  return isEnvelope(m, 'sw', 'off/failed') && isId(m.taskId) && isFailure(m.failure);
}

export function isOffProgressEvent(m: unknown): m is OffProgressEvent {
  if (!isEnvelope(m, 'sw', 'off/progress') || !isId(m.taskId)) return false;
  if (m.phase === 'zip') return isCount(m.loaded) && (m.total === null || isCount(m.total));
  return m.phase === 'encode' && isCount(m.done) && isCount(m.total);
}

// By direction

const CONTENT_TO_SW_GUARDS: GuardTable<ContentToSwMessage> = {
  'job/start': isJobStartMessage,
  'job/cancel': isJobCancelMessage,
  'job/listForTab': isJobListForTabMessage,
  'caps/get': isCapsGetMessage,
};
const OFFSCREEN_TO_SW_GUARDS: GuardTable<OffscreenToSwEvent> = {
  'off/ready': isOffReadyEvent,
  'off/failed': isOffFailedEvent,
  'off/progress': isOffProgressEvent,
};
const SW_TO_TAB_GUARDS: GuardTable<SwToTabMessage> = {
  'job/update': isJobUpdateMessage,
  'api/fetchJson': isApiFetchJsonMessage,
};
const SW_TO_OFFSCREEN_GUARDS: GuardTable<SwToOffscreenMessage> = {
  'off/fetchBytes': isOffFetchBytesCommand,
  'off/makeText': isOffMakeTextCommand,
  'off/fetchZip': isOffFetchZipCommand,
  'off/encode': isOffEncodeCommand,
  'off/abort': isOffAbortCommand,
  'off/release': isOffReleaseCommand,
  'off/fetchJson': isOffFetchJsonCommand,
  'off/probe': isOffProbeCommand,
  'off/tasks': isOffTasksCommand,
};

export function isContentToSwMessage(m: unknown): m is ContentToSwMessage {
  return matchesTable(CONTENT_TO_SW_GUARDS, m);
}

export function isOffscreenToSwEvent(m: unknown): m is OffscreenToSwEvent {
  return matchesTable(OFFSCREEN_TO_SW_GUARDS, m);
}

export function isSwToTabMessage(m: unknown): m is SwToTabMessage {
  return matchesTable(SW_TO_TAB_GUARDS, m);
}

export function isSwToOffscreenMessage(m: unknown): m is SwToOffscreenMessage {
  return matchesTable(SW_TO_OFFSCREEN_GUARDS, m);
}

// ── Sender checks (system.md §7 "Sender checks") ──

/** SW: content-script types are accepted only from a tab of this extension. */
export function isContentScriptSender(
  sender: chrome.runtime.MessageSender,
  extensionId: string = chrome.runtime.id,
): boolean {
  return typeof sender.tab?.id === 'number' && sender.id === extensionId;
}

/** SW: offscreen event types are accepted only from the offscreen document. */
export function isOffscreenSender(
  sender: chrome.runtime.MessageSender,
  offscreenUrl: string = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH),
): boolean {
  return sender.url === offscreenUrl;
}

/** Offscreen document: commands are accepted only from a sender without a tab (the SW). */
export function isNonTabSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.tab === undefined;
}

// ── Guard building blocks ──

function matchesTable<M extends Message>(table: GuardTable<M>, m: unknown): m is M {
  if (!isRecord(m) || typeof m.type !== 'string' || !Object.hasOwn(table, m.type)) return false;
  return table[m.type as M['type']](m);
}

function isEnvelope(m: unknown, target: MessageTarget, type: MessageType): m is Fields {
  return isRecord(m) && m.target === target && m.type === type;
}

function isStartRequest(m: Fields): boolean {
  if (!isArtworkId(m.artworkId)) return false;
  switch (m.mode) {
    case 'full':
      return isCount(m.expectedFiles) && (m.loggedIn === null || isBoolean(m.loggedIn));
    case 'retryPages':
      return (
        isFolder(m.folder) &&
        isRetryPages(m.pages, m.total) &&
        isOptional(m, 'withMetadata', (w) => w === true)
      );
    case 'retryEncode':
      return isFolder(m.folder) && isKeyOf(m.format, VIDEO_FORMATS);
    case 'retryMetadata':
      return isFolder(m.folder);
    default:
      return false;
  }
}

/** Non-empty, unique, 0-based page indexes below `total`, and `total` ≤ MAX_PAGES_PER_WORK. */
function isRetryPages(pages: unknown, total: unknown): boolean {
  if (
    !isCount(total) ||
    total > MAX_PAGES_PER_WORK ||
    !Array.isArray(pages) ||
    pages.length === 0
  ) {
    return false;
  }
  const seen = new Set<number>();
  for (const page of pages as unknown[]) {
    if (!isCount(page) || page >= total || seen.has(page)) return false;
    seen.add(page);
  }
  return true;
}

function isJobView(v: unknown): v is JobView {
  return (
    isRecord(v) &&
    isId(v.jobId) &&
    isArtworkId(v.artworkId) &&
    isKeyOf(v.kind, VIEW_KINDS) &&
    isKeyOf(v.status, VIEW_STATUSES) &&
    (v.progress === null || isJobProgress(v.progress)) &&
    (v.format === null || isKeyOf(v.format, UGOIRA_OUTPUTS)) &&
    (v.folder === null || isFolder(v.folder)) &&
    // outcome is non-null iff the job has ended
    (v.status === 'ended' ? isJobOutcome(v.outcome) : v.outcome === null)
  );
}

function isJobProgress(v: unknown): v is JobProgress {
  if (!isRecord(v)) return false;
  if (v.kind === 'pages') return isCount(v.done) && isCount(v.total);
  return (
    v.kind === 'percent' &&
    typeof v.percent === 'number' &&
    v.percent >= 0 &&
    v.percent <= 100 &&
    isKeyOf(v.phase, PERCENT_PHASES) &&
    isBoolean(v.indeterminate)
  );
}

function isJobOutcome(v: unknown): v is JobOutcome {
  if (!isRecord(v)) return false;
  switch (v.type) {
    case 'saved':
      return (
        isFolder(v.folder) &&
        isOptional(v, 'pages', isCount) &&
        isOptional(v, 'format', (f) => isKeyOf(f, UGOIRA_OUTPUTS))
      );
    case 'partial':
      return (
        isFolder(v.folder) &&
        isCount(v.total) &&
        isCount(v.saved) &&
        Array.isArray(v.failedPages) &&
        (v.failedPages as unknown[]).every(isCount) &&
        isOptional(v, 'metadataFailed', (m) => m === true)
      );
    case 'metadataOnly':
      return isFolder(v.folder) && isCount(v.total);
    case 'encodeFailed':
      return isFolder(v.folder) && isKeyOf(v.format, VIDEO_FORMATS);
    case 'error':
      return isKeyOf(v.cause, ERROR_CAUSES);
    case 'needsLogin':
    case 'unavailable':
    case 'cancelled':
      return true;
    default:
      return false;
  }
}

function isFailure(v: unknown): v is Failure {
  return (
    isRecord(v) &&
    isKeyOf(v.kind, FAILURE_KINDS) &&
    isCount(v.attempts) &&
    isOptional(v, 'status', isCount) &&
    isOptional(v, 'answered', (a) => a === true) &&
    isOptional(v, 'detail', (d) => typeof d === 'string')
  );
}

function isFrames(v: unknown): v is UgoiraState['frames'] {
  return (
    Array.isArray(v) &&
    (v as unknown[]).every(
      (f) => isRecord(f) && typeof f.file === 'string' && typeof f.delay === 'number',
    )
  );
}

/** Shape only: non-empty, ≤ MAX_FOLDER_CHARS, relative. */
function isFolder(v: unknown): v is string {
  return (
    typeof v === 'string' && v.length > 0 && v.length <= MAX_FOLDER_CHARS && !v.startsWith('/')
  );
}

function isFrameEdge(v: unknown): v is number {
  return isCount(v) && v >= 1 && v <= MAX_FRAME_EDGE;
}

function isIdList(v: unknown): v is string[] {
  return Array.isArray(v) && (v as unknown[]).every(isId);
}

function isBlobUrl(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('blob:');
}

/** jobId / taskId: crypto.randomUUID() strings, checked as non-empty strings. */
function isId(v: unknown): v is string {
  return isNonEmptyString(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** A non-negative integer. */
function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isKeyOf<K extends string>(v: unknown, keys: Record<K, true>): v is K {
  return typeof v === 'string' && Object.hasOwn(keys, v);
}

/** An absent (or undefined) optional field passes; a present one must satisfy `check`. */
function isOptional(o: Fields, key: string, check: Check): boolean {
  return o[key] === undefined || check(o[key]);
}

function isRecord(v: unknown): v is Fields {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
