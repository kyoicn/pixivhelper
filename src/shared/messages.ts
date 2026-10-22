// Message catalog (system.md §7; design-download-engine.md and design-offscreen-worker.md
// "API / Interface Contract"). Every listener ignores messages whose `target` is not its own.
// Payload validation (system.md §7 "Validation", "Sender checks") belongs in this module too.

import type { ErrorCode, StartRequest, UgoiraState } from '../background/types';
import type { Failure, JobView, RetryResult } from './types';

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
