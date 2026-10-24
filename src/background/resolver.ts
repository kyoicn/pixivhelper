// Plan building (design-download-engine.md "Resolving (resolver.ts)"): pixiv API calls through the
// originating tab, then the job's folder, file queue and ugoira format. `resolve` only reads the
// record, so it can simply run again when the SW died during `resolving`.

import { effectiveFormat } from '../shared/settings';
import type { CodecCaps } from '../shared/messages';
import { resolveFolder } from '../shared/pattern';
import {
  basenameOf,
  illustBody,
  illustUrl,
  pagesUrl,
  parseIllust,
  parsePages,
  parseUgoiraMeta,
  requiresLogin,
  ugoiraMetaUrl,
  type UgoiraMeta,
} from '../shared/pixiv-api';
import { createLogger } from '../shared/log';
import { gotAnswer } from '../shared/outcome';
import { __testHook } from '../shared/test-hooks';
import type { RetryResult, UgoiraOutput, WorkInfo } from '../shared/types';
import type { Effect } from './registry';
import { settle } from './scheduler';
import type { FileRole, FileTask, JobRecord, StartRequest, UgoiraState } from '../shared/job';

const log = createLogger('resolver');

const METADATA_NAME = 'metadata.json';
const FRAMES_NAME = 'frames.json';
/** A failed probe means no encoder is known to work: the job saves the ZIP only. */
const NO_CAPS: CodecCaps = { avc: null, vp9: false };

export interface ResolverDeps {
  /** The tab proxy with offscreen fallback (tab-client.ts). */
  apiFetchJson: (tabId: number, url: string) => Promise<RetryResult<unknown>>;
  /** Cached codec probe (caps.ts). */
  getCaps: (width: number, height: number) => Promise<CodecCaps>;
}

export type ApiFailure = NonNullable<JobRecord['apiFailure']>;

/** Everything `resolving → transferring` sets on the record. */
export interface Plan {
  kind: 'pages' | 'ugoira';
  folder: string;
  pagesTotal: number;
  pagesOffset: number;
  files: FileTask[];
  metaBody: Record<string, unknown> | null;
  ugoira: UgoiraState | null;
  effectiveFormat: UgoiraOutput | null;
}

export type Resolution =
  | { ok: true; plan: Plan }
  | { ok: false; apiFailure: ApiFailure; answered: boolean } // answered: some API call of this resolve got an HTTP response
  | { ok: false; loginRequired: true }; // R-003: page logged out and pixiv withholds the work

type Failed = { ok: false; apiFailure: ApiFailure };
type Step<T> = { ok: true; value: T } | Failed;
/** A mode's resolution before `resolve` adds whether the failure was answered. */
type Draft = { ok: true; plan: Plan } | Failed | { ok: false; loginRequired: true };
type Endpoint = ApiFailure['endpoint'];
type Request<M extends StartRequest['mode']> = Extract<StartRequest, { mode: M }>;

/** Fetches and parses the job's plan. API failures are returned, never thrown. */
export async function resolve(job: JobRecord, deps: ResolverDeps): Promise<Resolution> {
  // A failed resolve tells row 8 whether any of its API calls got an HTTP response, also one that
  // succeeded before a later call failed (system.md §10 "How answered is tracked", D13).
  let answered = false;
  const draft = await resolveMode(job, {
    ...deps,
    apiFetchJson: async (tabId, url) => {
      const result = await deps.apiFetchJson(tabId, url);
      if (result.ok || gotAnswer(result.failure)) answered = true;
      return result;
    },
  });
  return draft.ok || 'loginRequired' in draft ? draft : { ...draft, answered };
}

function resolveMode(job: JobRecord, deps: ResolverDeps): Promise<Draft> {
  const { request } = job;
  switch (request.mode) {
    case 'full':
      return resolveFull(job, request, deps);
    case 'retryPages':
      return resolveRetryPages(job, request, deps);
    case 'retryEncode':
      return resolveRetryEncode(job, request, deps);
    case 'retryMetadata':
      return resolveRetryMetadata(job, request, deps);
  }
}

/**
 * Mutator: applies a resolution. A failure ends the job through finalize (system.md §10); so does
 * the login-wall stop, as `forbidden` like a byte 403 (row 4: needsLogin). A plan, the login-wall
 * stop (its /ajax/illust answered) and an answered failure mark the job answered (row 8, D13).
 */
export function applyResolution(job: JobRecord, resolution: Resolution): Effect[] {
  if (job.phase !== 'resolving' || job.stopReason !== null || job.apiFailure !== null) return [];
  if (resolution.ok || 'loginRequired' in resolution || resolution.answered) job.answered = true;
  if (!resolution.ok) {
    if ('loginRequired' in resolution) job.stopReason = 'forbidden';
    else job.apiFailure = resolution.apiFailure;
    return [{ type: 'finalize' }];
  }
  const { plan } = resolution;
  job.kind = plan.kind;
  job.folder = plan.folder;
  job.pagesTotal = plan.pagesTotal;
  job.pagesOffset = plan.pagesOffset;
  job.files = plan.files;
  job.metaBody = plan.metaBody;
  job.ugoira = plan.ugoira;
  job.snapshot.effectiveFormat = plan.effectiveFormat;
  job.phase = 'transferring';
  return settle(job);
}

async function resolveFull(
  job: JobRecord,
  request: Request<'full'>,
  deps: ResolverDeps,
): Promise<Draft> {
  const illust = await fetchIllust(job, deps);
  if (!illust.ok) return illust;
  const { work, body } = illust.value;
  // R-003, before /pages or ugoira_meta: pixiv serves those (and the originals) to logged-out
  // sessions for walled all-ages works, so a click made before the render-time metadata arrived
  // must be stopped here. A record hydrated without `loggedIn` skips the check.
  if (requiresLogin(work, request.loggedIn ?? null)) {
    log.debug('login required', job.artworkId, work.xRestrict >= 1 ? 'xRestrict' : 'withheld');
    return { ok: false, loginRequired: true };
  }
  const { snapshot } = job;
  const folder = resolveFolder(snapshot.folderPattern, {
    artist: work.userName,
    id: work.id,
    title: work.title,
    userId: work.userId,
  });
  const files = new FileQueue();
  if (snapshot.saveMetadata) files.add('metadata', METADATA_NAME);

  if (work.illustType !== 2) {
    const pages = await fetchPages(job, deps);
    if (!pages.ok) return pages;
    pages.value.forEach((url, page) => files.addPage(job.artworkId, page, url));
    return plan({
      kind: 'pages',
      folder,
      pagesTotal: pages.value.length,
      files: files.list,
      metaBody: snapshot.saveMetadata ? body : null,
    });
  }

  const meta = await fetchUgoiraMeta(job, deps);
  if (!meta.ok) return meta;
  const caps = await fetchCaps(work, deps);
  const format = effectiveFormat(snapshot.ugoiraOutput, caps);
  const zip = files.add('zip', zipName(job.artworkId), { url: meta.value.originalSrc });
  const framesJson = files.add('framesJson', FRAMES_NAME, { dependsOn: [zip] });
  if (format !== 'zip') {
    files.add('video', `${job.artworkId}.${format}`, { dependsOn: [zip, framesJson] });
  }
  return plan({
    kind: 'ugoira',
    folder,
    files: files.list,
    metaBody: snapshot.saveMetadata ? body : null,
    ugoira: ugoiraState(meta.value, work, format, caps),
    effectiveFormat: format,
  });
}

/** Only the requested pages, into the original job's folder; metadata.json is not written again. */
async function resolveRetryPages(
  job: JobRecord,
  request: Request<'retryPages'>,
  deps: ResolverDeps,
): Promise<Draft> {
  const pages = await fetchPages(job, deps);
  if (!pages.ok) return pages;
  const files = new FileQueue();
  for (const page of [...request.pages].sort((a, b) => a - b)) {
    const url = pages.value[page];
    if (url === undefined) {
      return failed('pages', { kind: 'pixivError', detail: `no page ${page}`, attempts: 1 });
    }
    files.addPage(job.artworkId, page, url);
  }
  return plan({
    kind: 'pages',
    folder: request.folder,
    pagesTotal: request.total,
    pagesOffset: request.total - request.pages.length,
    files: files.list,
  });
}

/**
 * The zip again, into memory only (save: false), then only the video. The illust body gives the
 * frame size that keys the codec probe, so the encoder gets the same codec string as before.
 */
async function resolveRetryEncode(
  job: JobRecord,
  request: Request<'retryEncode'>,
  deps: ResolverDeps,
): Promise<Draft> {
  const illust = await fetchIllust(job, deps);
  if (!illust.ok) return illust;
  const meta = await fetchUgoiraMeta(job, deps);
  if (!meta.ok) return meta;
  const { work } = illust.value;
  const caps = await fetchCaps(work, deps);
  const files = new FileQueue();
  const zip = files.add('zip', zipName(job.artworkId), {
    url: meta.value.originalSrc,
    save: false,
  });
  files.add('video', `${job.artworkId}.${request.format}`, { dependsOn: [zip] });
  return plan({
    kind: 'ugoira',
    folder: request.folder,
    files: files.list,
    ugoira: ugoiraState(meta.value, work, request.format, caps),
    effectiveFormat: request.format,
  });
}

/** Only metadata.json, into the original folder; every page was saved by the earlier run. */
async function resolveRetryMetadata(
  job: JobRecord,
  request: Request<'retryMetadata'>,
  deps: ResolverDeps,
): Promise<Draft> {
  const illust = await fetchIllust(job, deps);
  if (!illust.ok) return illust;
  const { work, body } = illust.value;
  const files = new FileQueue();
  files.add('metadata', METADATA_NAME);
  return plan({
    kind: 'pages',
    folder: request.folder,
    pagesTotal: work.pageCount,
    pagesOffset: work.pageCount,
    files: files.list,
    metaBody: body,
  });
}

// ── API steps ──

async function fetchIllust(
  job: JobRecord,
  deps: ResolverDeps,
): Promise<Step<{ work: WorkInfo; body: Record<string, unknown> }>> {
  if (__TEST_HOOKS__) await __testHook('await:resolver.illust');
  const raw = await fetchJson(job, illustUrl(job.artworkId), deps);
  const parsed = parseIllust(raw);
  if (!parsed.ok) return failed('illust', parsed.failure);
  const body = raw.ok ? illustBody(raw.value) : null;
  return { ok: true, value: { work: parsed.value, body: body ?? {} } };
}

async function fetchPages(job: JobRecord, deps: ResolverDeps): Promise<Step<string[]>> {
  if (__TEST_HOOKS__) await __testHook('await:resolver.pages');
  const parsed = parsePages(await fetchJson(job, pagesUrl(job.artworkId), deps));
  return parsed.ok ? parsed : failed('pages', parsed.failure);
}

async function fetchUgoiraMeta(job: JobRecord, deps: ResolverDeps): Promise<Step<UgoiraMeta>> {
  if (__TEST_HOOKS__) await __testHook('await:resolver.ugoiraMeta');
  const parsed = parseUgoiraMeta(await fetchJson(job, ugoiraMetaUrl(job.artworkId), deps));
  return parsed.ok ? parsed : failed('ugoira_meta', parsed.failure);
}

async function fetchCaps(work: WorkInfo, deps: ResolverDeps): Promise<CodecCaps> {
  if (__TEST_HOOKS__) await __testHook('await:resolver.caps');
  try {
    return await deps.getCaps(work.width, work.height);
  } catch (error) {
    log.warn('codec probe failed, saving the ZIP only', error);
    return NO_CAPS;
  }
}

/**
 * A transport error (neither the tab nor the offscreen document answered) is `internal`: no
 * context could make the request, which says nothing about the user's connection (system.md §10).
 */
async function fetchJson(
  job: JobRecord,
  url: string,
  deps: ResolverDeps,
): Promise<RetryResult<unknown>> {
  try {
    return await deps.apiFetchJson(job.originTabId, url);
  } catch (error) {
    return {
      ok: false,
      failure: {
        kind: 'internal',
        detail: error instanceof Error ? error.message : String(error),
        attempts: 1,
      },
    };
  }
}

function failed(endpoint: Endpoint, failure: ApiFailure['failure']): Failed {
  return { ok: false, apiFailure: { endpoint, failure } };
}

// ── Plan building ──

function plan(fields: Pick<Plan, 'kind' | 'folder' | 'files'> & Partial<Plan>): {
  ok: true;
  plan: Plan;
} {
  return {
    ok: true,
    plan: {
      pagesTotal: 0,
      pagesOffset: 0,
      metaBody: null,
      ugoira: null,
      effectiveFormat: null,
      ...fields,
    },
  };
}

/** PRD §4.3: the frame zip is always `<id>_ugoira.zip`, whatever the source URL is called. */
function zipName(artworkId: string): string {
  return `${artworkId}_ugoira.zip`;
}

function ugoiraState(
  meta: UgoiraMeta,
  work: WorkInfo,
  format: UgoiraOutput,
  caps: CodecCaps,
): UgoiraState {
  return {
    frames: meta.frames,
    format,
    avcCodec: format === 'mp4' ? caps.avc : null,
    width: work.width,
    height: work.height,
    zipLoaded: 0,
    zipTotal: null,
    encDone: 0,
    percent: 0,
  };
}

/** Files in queue order: `idx` is the position, which is also the dispatch order. */
class FileQueue {
  readonly list: FileTask[] = [];

  add(
    role: FileRole,
    name: string,
    extra: { url?: string; save?: boolean; dependsOn?: number[]; page?: number } = {},
  ): number {
    const idx = this.list.length;
    this.list.push({
      idx,
      role,
      name,
      save: extra.save ?? true,
      dependsOn: extra.dependsOn ?? [],
      state: 'queued',
      ...(extra.page === undefined ? {} : { page: extra.page }),
      ...(extra.url === undefined ? {} : { url: extra.url }),
    });
    return idx;
  }

  /** Pages keep the original URL's basename (parsePages has checked it is a safe name). */
  addPage(artworkId: string, page: number, url: string): void {
    this.add('page', basenameOf(url) ?? `${artworkId}_p${page}`, { url, page });
  }
}
