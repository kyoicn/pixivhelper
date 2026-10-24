# Download Engine (service worker)

> Last updated: 2026-10-23 18:44:59 (UTC-7)
> Serves: prd-000 — CUJ-1 (pipeline, cancel, re-download), CUJ-2 (ugoira job orchestration), CUJ-3 (toolbar click → settings tab), CUJ-4 (badge/title), CUJ-5 (retry modes, outcome classification incl. the job-level "No connection" rule per R-004 S3, login-wall check at resolve per R-003); PRD §4.1 #3 (Chrome's download UI hidden while a job runs, R-005; back on just before the last file of the last running job is handed to Chrome, R-006)

## Overview

The service worker (`src/background/`) is the system's **source of truth for jobs**. It:

- accepts start, cancel and attach requests from content scripts;
- snapshots settings and resolves a job's plan through pixiv's API (proxied through the originating tab, see [system.md §8.3](system.md));
- builds the file queue, schedules at most 5 files per artwork, and dispatches byte work to the offscreen document;
- hands finished bytes to `chrome.downloads` and observes completion;
- hides Chrome's download UI from a job's first hand-off and turns it back on just before the last file of the last running job is handed to Chrome, or when the last running job ends without such a hand-off (R-005, R-006);
- classifies the end state, pushes `JobView` snapshots to the originating tab, and keeps the toolbar badge and title correct;
- installs the DNR Referer rule;
- opens or focuses the settings tab on toolbar click.

Chrome may stop the SW after 30 s idle, and a fetch that takes more than 30 s to respond gets it terminated (Chrome docs, service worker lifecycle). The engine therefore treats every `await` as a possible death point. Job state is written through to `chrome.storage.session`, and a boot-time hydration reconciles it against `chrome.downloads` and the offscreen task table.

## Goals & Non-Goals

**Goals**
- Exact PRD semantics for the job pipeline (§4.5), concurrency (≤ 5 per artwork), badge accounting (§4.8) and outcome mapping (CUJ-5).
- Survive SW termination at any point with no lost or duplicated files and the badge correct within 1 s of restart (CUJ-4 AC).
- No persisted history: a job's record exists only while the job runs.
- Deterministic, unit-testable core: the scheduler, classifier and badge math are pure functions over `JobRecord`s.

**Non-Goals**
- Surviving a Chrome restart (PRD §4.1 #6: accepted loss).
- Global concurrency limits across artworks (PRD: artworks are not serialized).
- Owning file bytes: the SW never holds file contents ([system.md §2](system.md) principle 2).

## System Context

```mermaid
flowchart TB
  CS["Content script (originating tab)"] -- "job/start · job/cancel · job/listForTab · caps/get" --> SW
  SW -- "job/update (JobView)" --> CS
  SW -- "api/fetchJson (proxy)" --> CS
  subgraph SW["Service worker"]
    R["registry.ts<br/>JobRecord store + mutex"]
    RES["resolver.ts<br/>plan building"]
    SCH["scheduler.ts<br/>pump · deps · cap 5"]
    DLW["downloads.ts<br/>download / onChanged"]
    BAD["badge.ts"]
    OC["offscreen-client.ts<br/>ensure / close / commands"]
    CAPS["caps.ts"]
    OPTT["options-tab.ts"]
    DNRM["dnr.ts"]
    DUI["download-ui.ts<br/>Chrome's download UI on/off (R-005)"]
  end
  SW <--> OFF["Offscreen document"]
  R <--> SS[("storage.session<br/>job:* · caps:*")]
  DLW <--> DL["chrome.downloads"]
  DUI -- "setUiOptions: enabled on or off" --> DL
  BAD --> ACT["chrome.action"]
  OPTT --> TABS["tabs.create/update · windows.update · runtime.getContexts"]
  DNRM --> DNR["declarativeNetRequest (session rule)"]
  RES --> SETS[("storage.sync/local · settings")]
```

## Detailed Design

### Data Model

The job model and request protocol live in **`src/shared/job.ts`** (they were in `src/background/types.ts` in iteration 1). The pure shared modules (`outcome.ts`, `progress.ts`, `messages.ts`, `pixiv-api.ts`) and the content script's button model operate on them, and `src/shared` must not import the SW's directory ([system.md §4](system.md) layering rule, D11). The move is a pure refactor (ENG-008).

```ts
// src/shared/job.ts (extends src/shared/types.ts)
export type FileRole = 'metadata' | 'page' | 'zip' | 'framesJson' | 'video';
export type FileState =
  | 'queued'    // waiting for deps / a slot
  | 'fetching'  // offscreen task running (fetch, text blob, or encode)
  | 'ready'     // offscreen holds a blob: URL; not yet handed to Chrome
  | 'saving'    // chrome.downloads.download issued (downloadId may still be unknown)
  | 'done'      // Chrome reported state 'complete' (or zip retained, when save=false)
  | 'failed'
  | 'skipped';  // never attempted: cancel, 403 stop, or a failed dependency

export interface FileTask {
  idx: number;                    // queue order; dispatch is in ascending idx
  role: FileRole;
  page?: number;                  // 0-based page index (role 'page')
  name: string;                   // basename: '135882741_p0.jpg', 'metadata.json', '136004512_ugoira.zip', 'frames.json', '136004512.mp4'
  url?: string;                   // source URL (page, zip) — allowlisted i.pximg.net
  save: boolean;                  // false only for the retryEncode zip (fetched into memory, not written)
  dependsOn: number[];            // idx list that must be 'done' first
  state: FileState;
  taskId?: string;                // offscreen task id (uuid)
  blobUrl?: string;
  downloadId?: number;
  failure?: Failure;
  text?: string;                  // metadata.json text, built when the file is dispatched (the same mutation drops
                                  // job.metaBody); kept while in flight so a re-queue after a restart can dispatch again
}

export interface UgoiraState {
  frames: Array<{ file: string; delay: number }>;  // ugoira_meta.body.frames, unmodified
  format: UgoiraOutput;           // effective: 'mp4' | 'webm' | 'zip'
  avcCodec: string | null;        // chosen codec string when format === 'mp4'
  width: number; height: number;  // from /ajax/illust body (probe key); encoder uses decoded frame size
  zipLoaded: number; zipTotal: number | null;
  encDone: number;
  percent: number;                // last emitted, monotonic
}

export interface JobRecord {
  v: 1;
  jobId: string;                  // crypto.randomUUID()
  artworkId: string;              // /^\d{1,12}$/
  originTabId: number;            // MessageSender.tab.id (no "tabs" permission needed)
  createdAt: number;              // Date.now()
  mode: JobMode;                  // 'full' | 'retryPages' | 'retryEncode' | 'retryMetadata'
  request: StartRequest;          // the validated start payload (for re-running 'resolving' after a restart)
  kind: 'pages' | 'ugoira' | 'unknown';
  phase: 'resolving' | 'transferring' | 'ended';
  snapshot: SettingsSnapshot;     // taken at click (PRD §4.1 #8)
  expectedFiles: number;          // badge count while resolving — full: tab hint clamped 0..200; retryPages: pages.length; retryEncode: 1; retryMetadata: 0
  metaBody: Record<string, unknown> | null;  // raw /ajax/illust body, kept only until the metadata file is dispatched
  folder: string | null;          // resolved (full) or echoed (retries); validated by isSafeRelativeFolder
  pagesTotal: number;             // display total N in "k / N" (full page count, also for retries)
  pagesOffset: number;            // pages already saved before this run (retryPages: total − requested)
  files: FileTask[];
  ugoira: UgoiraState | null;
  stopReason: null | 'cancelled' | 'forbidden';   // forbidden: first byte 403, or the resolver's login-wall check (R-003)
  apiFailure: { endpoint: 'illust' | 'pages' | 'ugoira_meta'; failure: Failure } | null;
  answered?: true;                // pixiv answered at least one request of this job (any HTTP status); set by applyResolution,
                                  // never cleared; read by classifyOutcome row 8 (system.md §10, R-004 S3, D13)
}
```

**Persistence.** `storage.session` key `job:<jobId>` holds the full `JobRecord`. A 200-page job is ~35 KB, so even dozens of concurrent jobs stay far below the 10 MB quota. Records are written on every state transition (persist-then-act, below). Byte-progress fields (`zipLoaded`, `encDone`, `percent`) are persisted at most once per second, because they are display-only. Records are **deleted** in the same mutation that ends the job (no history).

**Indexes.** None are stored. Hydration loads `storage.session.get(null)` and filters the `job:` prefix. In-memory maps are rebuilt on boot: `byJobId`, `byTaskId → (jobId, idx)`, `byDownloadId → (jobId, idx)`.

### API / Interface Contract

All envelopes follow [system.md §7](system.md). `ErrorCode = 'BAD_REQUEST' | 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL'`.

**Content script → SW** (`target: 'sw'`, sender must have `tab.id`)

| `type` | Payload | Response |
|---|---|---|
| `job/start` | `StartRequest` (below) | `{ ok: true, view: JobView }` once the job is created and persisted, before resolving |
| `job/cancel` | `{ jobId }` | `{ ok: true }`. `FORBIDDEN` if `sender.tab.id !== job.originTabId`. `NOT_FOUND` if already ended (the tab then waits for or has the final `job/update`). |
| `job/listForTab` | `{}` | `{ ok: true, views: JobView[] }`: running jobs whose `originTabId === sender.tab.id` (reload reattach, PRD §4.7.6) |
| `caps/get` | `{ width: number, height: number }` (1..16384) | `{ ok: true, caps: { avc: string \| null, vp9: boolean } }` |

```ts
export type StartRequest =
  | { mode: 'full'; artworkId: string; expectedFiles: number;                        // expectedFiles: pageCount, or 1 for ugoira
      loggedIn: boolean | null }                                                     // the page's login marker (R-003 check at resolve);
                                                                                     // the guard accepts exactly true | false | null, else BAD_REQUEST
  | { mode: 'retryPages'; artworkId: string; folder: string; pages: number[]; total: number }  // pages: 0-based, unique, < total ≤ 200
  | { mode: 'retryEncode'; artworkId: string; folder: string; format: 'mp4' | 'webm' }
  | { mode: 'retryMetadata'; artworkId: string; folder: string };
```

**SW → content script** (`target: 'tab'`, `tabs.sendMessage(tabId, msg, { frameId: 0 })`)

| `type` | Payload | Response |
|---|---|---|
| `job/update` | `{ view: JobView }` | none (rejection ignored: tab closed or navigated off pixiv) |
| `api/fetchJson` | `{ url }` (allowlisted API URL) | `{ ok: true, result: RetryResult<unknown> }` |

**SW → offscreen** (`target: 'offscreen'`). Commands are acknowledged immediately with `{ ok: true }`; results arrive as events. The exceptions are `off/fetchJson`, `off/probe` and `off/tasks`, which are request/response.

| `type` | Payload | Result |
|---|---|---|
| `off/fetchBytes` | `{ taskId, url }` | event `off/ready { taskId, blobUrl, size }` or `off/failed { taskId, failure }` |
| `off/makeText` | `{ taskId, text, mime }` | event `off/ready` |
| `off/fetchZip` | `{ taskId, url, save: boolean }` | events `off/progress { taskId, phase: 'zip', loaded, total }` …, then `off/ready { taskId, blobUrl? }` (`blobUrl` only when `save`) or `off/failed`. Bytes are retained for a later `off/encode`. |
| `off/encode` | `{ taskId, zipTaskId, frames, format: 'mp4' \| 'webm', avcCodec: string \| null, artworkId }` | events `off/progress { taskId, phase: 'encode', done, total }` …, then `off/ready { taskId, blobUrl, size }` or `off/failed { failure: { kind: 'encode' } }` |
| `off/abort` | `{ taskIds: string[] }` | aborts; no further events for those tasks |
| `off/release` | `{ taskIds: string[], keepRetained?: boolean }` | revokes blob URLs and drops Blobs. Also drops retained zip bytes unless `keepRetained` (used when the zip has landed but the video is still to be encoded). |
| `off/fetchJson` | `{ url, credentials: 'include' }` | response `{ ok: true, result: RetryResult<unknown> }` (fallback API path) |
| `off/probe` | `{ width, height }` | response `{ ok: true, caps: { avc: string \| null, vp9: boolean } }` |
| `off/tasks` | `{}` | response `{ ok: true, tasks: Array<{ taskId, state: 'running' \| 'ready' \| 'retained', blobUrl?: string }> }` |

Details of each offscreen task are in [design-offscreen-worker.md](design-offscreen-worker.md).

### Logic & Behavior

#### Boot sequence (every SW start)

```ts
// src/background/sw.ts — listeners registered synchronously at top level (required for event wake-ups)
chrome.runtime.onMessage.addListener(router);           // routes by target/type; every handler awaits `ready`
chrome.downloads.onChanged.addListener(onDownloadChanged);
chrome.action.onClicked.addListener(openOrFocusOptions);
export const ready = (async () => {
  await installRefererRule();                           // system.md §8.2 (idempotent; a failure is logged, boot goes on)
  await chrome.action.setBadgeBackgroundColor({ color: '#1f1f1f' });
  await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  await engine.hydrate();                               // load job:* into memory
  await engine.badge.render();                          // PRD: correct within 1 s of restart
  await engine.restoreDownloadUiIfIdle();               // R-005: no job running → Chrome's download UI on (never rejects)
  await engine.reconcile();                             // below; then pump every job
  await engine.badge.render();
})();
```

The download-UI step sits after `hydrate()` because it needs the registry, and before `reconcile()` so that a job reconcile finishes on the spot restores through `finalize` like any other (below, "Chrome's download UI").

#### Mutations: persist intent, then act

All changes to a `JobRecord` go through `registry.mutate(jobId, fn)`:
1. Mutations are serialized through one global promise chain, so concurrent event handlers can never interleave and lose an update.
2. `fn` mutates the in-memory record and returns a list of **effects** (`src/background/registry.ts`):

   ```ts
   export type Effect =
     | { type: 'dispatch'; idx: number }                              // send the file's offscreen command
     | { type: 'download'; idx: number }                              // hand the file's blob URL to chrome.downloads
     | { type: 'abort'; taskIds: string[] }                           // off/abort
     | { type: 'release'; taskIds: string[]; keepRetained?: boolean } // off/release
     | { type: 'cancelDownload'; downloadIds: number[] }              // chrome.downloads.cancel (Chrome removes the partial file)
     | { type: 'push'; throttle?: boolean }                           // job/update to the origin tab; throttle for byte progress
     | { type: 'badge' }                                              // re-render the toolbar badge and title
     | { type: 'finalize' };                                          // classify, push the final view, release the job's tasks
   ```
3. The record is written to `storage.session` (or deleted when ended).
4. Effects run only after the write resolves.

A crash between steps 3 and 4 leaves an intent recorded but not executed (e.g. a file in `saving` with no `downloadId`). Hydration detects and completes it.

#### Job lifecycle

```mermaid
stateDiagram-v2
  [*] --> resolving: job/start (validated, snapshot taken, persisted)
  resolving --> transferring: plan built (folder resolved, files queued)
  resolving --> ended: API failure / unavailable / cancel
  transferring --> transferring: file done / failed / progress
  transferring --> ended: no queued or in-flight files left
  transferring --> ended: cancel (immediate)
  ended --> [*]: outcome classified, JobView pushed, record deleted, badge updated
```

#### Resolving (resolver.ts)

`resolve(job)` is idempotent. If the SW dies during `resolving`, hydration simply calls it again.

1. `snapshot = readSettings()` was taken at `job/start`, not here, so a re-run after restart still uses the click-time settings (PRD §4.1 #8).
2. API calls go through `apiFetchJson(job.originTabId, url)`: first `tabs.sendMessage(tab, api/fetchJson)`, and if that throws (no receiving end, tab closed) then `off/fetchJson`. If that also throws (the offscreen document did not answer), the call fails with `{ kind: 'internal', detail }`: no context could make the request, which says nothing about the user's connection ([system.md §10](system.md) "`internal` reads as `server`"). The `RetryResult` is parsed by `pixiv-api.ts`:
   - `parseIllust(body) → WorkInfo`, including `withheld` ([system.md §8.5](system.md)) (+ raw body kept for `metadata.json`);
   - `parsePages(body) → string[]` (`urls.original` per page, page order);
   - `parseUgoiraMeta(body) → { originalSrc, frames }`.

   A response whose JSON has `error: true` is a `pixivError` failure. A missing required field (`urls.original`, `originalSrc`, `frames` non-empty) is also treated as `pixivError`.
3. Per mode:

| Mode | API calls | Files queued (idx order) |
|---|---|---|
| `full`, illustType 0/1 | `/ajax/illust/{id}`, `/pages` | `metadata` (if `saveMetadata`), then `page` × N with names = URL basenames |
| `full`, illustType 2 | `/ajax/illust/{id}`, `/ugoira_meta`; `caps` for body width×height | `metadata` (if enabled), `zip` (`save: true`), `framesJson` (deps: zip), `video` (deps: zip, framesJson; only if effective format ≠ `zip`) |
| `retryPages` | `/pages` | `page` × requested indexes (no metadata) |
| `retryEncode` | `/ajax/illust/{id}` (frame size: the codec-probe key, so the encoder gets the same codec string as the first run), `/ugoira_meta`; `caps` | `zip` (`save: false`), `video` (deps: zip) |
| `retryMetadata` | `/ajax/illust/{id}` | `metadata` |

3a. **Login-wall check (R-003), `full` mode only.** Right after `/ajax/illust` parses, and before `/pages` or `ugoira_meta` is called: if `requiresLogin(work, request.loggedIn)` ([system.md §8.5](system.md)), the resolution is `{ ok: false, loginRequired: true }`; `applyResolution` sets `stopReason = 'forbidden'` and finalizes, and the classifier yields `needsLogin` (§10 row 4). No byte request is ever made. This is the same predicate the content script applies at render time; it matters when the user clicked before the render-time metadata arrived (`pending`), or after the render fetch failed. Retry modes skip the check: they exist only after a `full` job of the same document passed it.

   ```ts
   export type Resolution =
     | { ok: true; plan: Plan }
     | { ok: false; apiFailure: ApiFailure; answered: boolean }   // answered: some API call of this resolve got an HTTP response
     | { ok: false; loginRequired: true };   // R-003: page logged out and pixiv withholds the work
   ```
4. **Folder:** `full` mode calls `resolveFolder(snapshot.folderPattern, { artist: userName, id, title, userId })` ([design-settings-model.md](design-settings-model.md)). Retry modes use `request.folder` after re-validating it with `isSafeRelativeFolder()`, so a retry writes into the original job's folder (PRD CUJ-5 step 5 and edge case).
5. **Effective ugoira format:** `effectiveFormat(snapshot.ugoiraOutput, caps)` (shared, also used by the button):
   - `zip` → `zip`;
   - `mp4` → `caps.avc ? 'mp4' : caps.vp9 ? 'webm' : 'zip'`;
   - `webm` → `caps.vp9 ? 'webm' : caps.avc ? 'mp4' : 'zip'`.

   It is stored in `snapshot.effectiveFormat`.
6. Persist with `phase = 'transferring'`, then pump.

Failure in resolving → `apiFailure` is set and the job finalizes (classifier rows 2, 3 and 8 in [system.md §10](system.md)); a login-wall stop finalizes through row 4.

**`answered` (R-004 S3, D13).** `applyResolution` sets `job.answered = true` in the same mutation that applies the resolution when the resolution is `ok` (every mode's plan needs at least one API 2xx), is the login-wall stop (its `/ajax/illust` answered), or is a failure with `answered: true`. The resolver computes that flag per call: an API step whose `RetryResult` is `ok`, or whose failure `gotAnswer()` (system.md §10: `http`, `pixivError`, or `answered: true`), marks the resolve answered; the failure returned for a later step carries it. Examples: `full` with `/ajax/illust` 200 and `/pages` unanswered `network` → `answered: true` (server); `full` with `/ajax/illust` unanswered `network` → `false` (offline); `retryPages` whose `/pages` got 503, 503, then refused attempts → the failure has `answered: true` → `true` (server); a transport failure of both proxies (`internal`) → `false`, and row 8 reads `server` anyway because `internal` is not `network`. A re-run of `resolve` after a restart recomputes the flag from scratch.

#### `metadata.json` construction (src/shared/metadata.ts)

This gives byte parity with `write_metadata` in `ref/pixiv-dl`, except where the PRD explicitly differs.

```ts
export function buildMetadata(body: Record<string, unknown>, artworkId: string): object {
  const id = str(body.illustId) || str(body.id) || null;     // Python `or` semantics: '' falls through
  return {
    id,
    title: body.illustTitle ?? null,
    description: body.description == null ? null : plainText(String(body.description)),   // PRD: missing → null (script wrote "")
    userName: body.userName ?? null,
    userId: body.userId ?? null,
    createDate: body.createDate ?? null,
    uploadDate: body.uploadDate ?? null,
    pageCount: body.pageCount ?? null,
    illustType: body.illustType ?? null,
    xRestrict: body.xRestrict ?? null,
    tags: Array.isArray(body.tags?.tags) ? body.tags.tags.map(t => t?.tag ?? null) : [],
    url: `https://www.pixiv.net/artworks/${id ?? artworkId}`,  // script would write ".../None"; not ported
  };
}
export const plainText = (s: string) =>
  unescapeHtml(s.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
export const serializeJson = (v: unknown) => JSON.stringify(v, null, 2);   // no trailing newline (parity)
```

- `JSON.stringify(v, null, 2)` produces the same bytes as Python's `json.dump(ensure_ascii=False, indent=2)`: `", "`/`": "` separators with indent, the same short escapes, `\u00xx` lowercase for other controls, and literal non-ASCII. The only difference is lone surrogates: JS escapes them, while Python would crash. Golden tests (ENG-003) pin this.
- `unescapeHtml` must match Python's `html.unescape`: all HTML5 named references (including the legacy names that match without a trailing `;`), decimal and hex numeric references, and Python's invalid-codepoint replacement table. `DOMParser` cannot be used because the SW has no DOM, and its behavior differs from Python's anyway. The function lives in `metadata.ts`. Its entity table is a generated constant (`src/shared/html-entities.ts`, emitted from Python's `html.entities.html5` by `scripts/gen-golden.py`), so behavior is identical and pinned by golden vectors.
- `Python str.strip()` (no args) strips Unicode whitespace per `str.isspace`. `trim()` in JS strips a slightly different set (JS includes U+FEFF; Python includes U+001C–U+001F and U+0085). Implemented as an explicit `stripPy()` with Python's set, pinned by golden vectors.
- `frames.json` = `serializeJson(ugoira_meta.body.frames)`. This is the parsed array re-serialized with 2-space indent and insertion-order keys preserved: "unmodified" per PRD §4.3. It is identical to the script's output for ASCII file names.

#### Scheduler (scheduler.ts)

```
pump(job):
  if job.phase !== 'transferring': return
  inFlight = count(files, state ∈ {fetching, ready, saving})
  for f in files ordered by idx, where f.state == 'queued':
     if job.stopReason != null: mark f 'skipped'; continue
     if any dep of f is failed|skipped: mark f 'skipped'; continue
     if not all deps 'done': continue                       // keep queued, keep scanning (later files may be eligible)
     if inFlight >= MAX_IN_FLIGHT_PER_JOB (5): break
     f.state = 'fetching'; f.taskId = uuid()                 // persisted before dispatch
     effects.push(dispatch(f)); inFlight++
  if no file is queued or in flight: effects.push(finalize)
```

- Dispatch by role: `page` → `off/fetchBytes`; `metadata` → `off/makeText(serializeJson(buildMetadata(body)), 'application/json')`; `framesJson` → `off/makeText(serializeJson(frames), 'application/json')`; `zip` → `off/fetchZip`; `video` → `off/encode`. `metadata` and `framesJson` text is built in the SW from data held in the record. `metaBody` is set to `null` in the same mutation that dispatches the metadata file. `ugoira.frames` stays until the job ends, because `off/encode` needs it.
- **Page order** (PRD §4.5.1 step 6): dispatch is strictly ascending `idx`, so `_p0`, `_p1`, … are requested in order. Completion order is free. The next queued file starts as soon as any slot frees (on `done`/`failed`).
- **Cap semantics:** a file holds a slot from `fetching` until terminal. This bounds both concurrent HTTP requests per artwork (parity with `-j 5`) and concurrent Chrome downloads (AC: never > 5 in `chrome://downloads`).

#### Offscreen events → file transitions

| Event | Transition | Effects |
|---|---|---|
| `off/ready { blobUrl }` (save) | `fetching → saving` (blobUrl stored, persisted **before** the call) | effect `download` → `handOff()`: decide whether this is the busy period's last hand-off, then `await downloadUi.restore()` if it is (R-006) or `await downloadUi.hideForHandOff()` if not (R-005; both below), stop if the job ended or the file left `saving` meanwhile, then `downloads.download({ url: blobUrl, filename: folder + '/' + name, conflictAction: 'uniquify', saveAs: false })` → store `downloadId` (persist). If the call throws ("Invalid filename" etc.) → `failed{disk}`. |
| `off/ready` (zip with `save: false`) | `fetching → done` | pump |
| `off/ready` without `blobUrl` for a file that must be saved | `fetching → failed{ internal, detail: 'no blob' }` | release, pump |
| Dispatch refused (`{ ok: false }` ack) or undeliverable (`sendMessage` rejects after the one `ensureOffscreen` resend) | `fetching → failed{ internal }` for every role except `video`, which fails `{ encode }` (the zip landed, so `Retry · MP4` is the right next action, §10 row 5) | release, pump |
| `off/progress` | update `ugoira.zipLoaded/zipTotal/encDone`; recompute percent (monotonic) | throttled `job/update` push (≤ 4/s) |
| `off/failed { failure }` | `fetching → failed` | if `failure.status === 403` and role ∈ {page, zip}: `stopReason = 'forbidden'` (no new dispatches; in-flight files finish, PRD CUJ-5 step 9). Release task; pump. |
| `downloads.onChanged` `state: complete` | `saving → done` | `off/release` (with `keepRetained: true` for a `zip` file whose `video` is still pending), pump, badge, push |
| `downloads.onChanged` `state: interrupted` | `saving → failed{ disk \| dismissed }` (`USER_CANCELED` → `dismissed`; every `FILE_*`, `CRASH` and others → `disk`) | release, pump, badge, push |

Events for unknown task or download IDs (job already ended or cancelled) → `off/release` for the task and nothing else.

#### Cancel

`job/cancel` runs in one mutation:
- set `stopReason = 'cancelled'`;
- mark every `queued` file `skipped`;
- collect `taskIds` of `fetching`/`ready` files → effect `abort` (`off/abort`);
- `saving` files with a `downloadId` → effect `cancelDownload` (`chrome.downloads.cancel(id)`; Chrome removes the partial file). A download whose id arrives after the cancel (Chrome started it while the cancel mutation ran) is cancelled by the hand-off path itself, because `onDownloadStarted` finds the job ended;
- finalize immediately with outcome `cancelled`.

Already completed files stay on disk (PRD CUJ-1 step 5). An in-progress encode is aborted, and because the video is only handed to Chrome after `finalize()`, no partial video can exist (PRD §4.6). The button returns to idle within 300 ms because the push happens right after the persist, with no waiting for abort confirmations. Finalize then turns Chrome's download UI back on if no other job is running (PRD CUJ-1 step 5, R-005). A cancel has no final hand-off, so Chrome shows its downloads button again only with its next download (R-006; platform fact in "Chrome's download UI").

#### Finalize

1. `outcome = classifyOutcome(job, navigator.onLine)` ([system.md §10](system.md)). `partial.failedPages` = page indexes of failed pages; `saved = pagesTotal − failedPages.length`.
2. Push `job/update { view: toView(job, outcome) }` to `originTabId`.
3. Delete `job:<jobId>`; drop in-memory indexes; `off/release` all remaining task IDs of the job.
4. `badge.render()`.
5. If the registry is empty (no running job is left; a job still finalizing is still listed): `await downloadUi.restore()` (R-005, below; without a Chrome call when the job's last hand-off already restored the UI, R-006), then `offscreenClient.scheduleClose()` unless a codec probe is pending (5 s grace; cancelled by any new command).

#### Chrome's download UI (download-ui.ts, R-005, R-006)

PRD §4.1 #3 (R-005, with the restore point set by R-006). From the moment a job hands its first file to Chrome, Chrome's download UI is off. The job's files play no per-file fly-to-toolbar animation, and Chrome shows no downloads button.

The UI comes back on **just before the last file of the last running job is handed to Chrome** (R-006). Chrome's own download of that file brings the downloads button back with one animation, which is the job's "done" signal. The bubble then lists every file of the job. This is CUJ-1 AC 14 as R-006 amends it: "at most one animation, at the end".

Sometimes the last running job ends without such a final hand-off: it is cancelled, fails, needs login, is Unavailable, or its last outstanding file fails. Then finalize turns the UI on instead. The worker also turns it on whenever it starts with no job running.

The hidden window never starts before a job's first file is handed to Chrome ("not even for the first file", CUJ-1 step 2).

A **busy period** is a span in which at least one job is running; overlapping jobs share one. Each busy period hides the UI at most once and restores it at most once. The one exception is a job that starts after the restore was requested (see "Races" below).

**Platform facts the design relies on.** Sources: Chromium `chrome/browser/extensions/api/downloads/downloads_api.cc`, `chrome/browser/download/download_ui_controller.cc`, `chrome/browser/download/bubble/download_display_controller.cc` and `chrome/browser/download/bubble/download_bubble_prefs.cc`; Chrome extension docs for `chrome.downloads.setUiOptions`.
- `setUiOptions({ enabled })` (Chrome 105+, permission `downloads.ui`) adds this extension to, or removes it from, a per-profile set of "UI-disabling extensions" held in the browser process. The UI is hidden while the set is non-empty. Disabling also closes a bubble that is open.
- The entry belongs to the extension, not to the SW instance. It outlives SW termination. Chrome removes it when the extension unloads (disabled, reloaded, updated, uninstalled), and it is gone after a browser restart.
- `enabled: true` first removes our entry, then rejects (`runtime.lastError`) if another extension still keeps the UI off. Removing an entry that is not there changes nothing, so a repeated enable is harmless. `enabled: false` rejects only without the permission.
- There is no getter.
- **Chrome reads the setting per download event, never when the setting changes** (R-006).
  - `ShouldShowDownloadBubble()` is false while any extension disables the UI.
  - The toolbar's controller checks it in its new-item and updated-item handlers. No code observes the setting itself.
  - A new download reaches the new-item handler once Chrome has determined its target path, a few milliseconds after `downloads.download()`. Only that handler plays the fly-to-toolbar animation, and each item reaches it once.
  - So `setUiOptions({ enabled: true })` alone does not bring the downloads button back. The button returns with Chrome's next download event, and its bubble then lists the recent downloads, including those made while the UI was hidden.
  - QA observed exactly this in iteration 3, in headed Chrome for Testing 156: no button after `Saved · 12P`, also at +15 s; the next download brought it back with the job's 13 files listed.
  - No extension API shows the button or opens the bubble.
- **Consequences:**
  - a file whose target path is determined while the UI is off never animates later;
  - a file handed to Chrome after the enable has been applied animates once and brings the button back.
- **Naming and the UI decision happen in one pass.** Chrome sets a download's target path and then notifies its item observers synchronously: the toolbar's controller, which makes the animate-or-not decision, and the extension API's event router, which sends `downloads.onChanged` with the new `filename`. So once the SW has received a `filename` delta for an item, or the item has left `in_progress`, Chrome has already decided that item's UI. This comes from reading the source (`download_ui_controller.cc`, `downloads_api.cc`). The 500 ms cap in step 3 below bounds the wait if it ever does not hold; L5 confirms it.

```ts
// src/background/download-ui.ts
export interface DownloadUi {
  /** Before every hand-off but the busy period's last. Resolves once Chrome has applied the hide (or refused it); never rejects. */
  hideForHandOff(): Promise<void>;
  /**
   * Before the busy period's last hand-off (R-006), when the last running job ends, or when the SW starts with none
   * running. Resolves once Chrome has answered; never rejects. Makes no call when this instance last asked for `true`.
   */
  restore(): Promise<void>;
}
export function createDownloadUi(
  setUiOptions: (options: chrome.downloads.UiOptions) => Promise<void> = (o) => chrome.downloads.setUiOptions(o),
): DownloadUi;
```

R-006 changes nothing in `download-ui.ts` except these two doc comments. The module already makes the right calls for the new call site.

State, in memory only and per SW instance. Nothing is persisted, so the storage inventory (system.md §6) is unchanged. Chrome itself holds the real state, and a stored copy could go stale when Chrome clears the entry on unload.
- `requested: boolean | null`: the `enabled` value this instance last asked Chrome for. It is `null` until the first call, because a previous instance may have left the UI either way.
- `chain: Promise<void>`: every `setUiOptions` call is queued behind the previous one, so Chrome applies them in request order and its state is always the last request.
- `hideRefused: boolean`: a latch. Once a hide is refused, this instance stops trying, because the only documented refusal (missing permission) cannot be fixed by a retry.

| Call | State | Does |
|---|---|---|
| `hideForHandOff()` | `hideRefused` | resolves at once |
| `hideForHandOff()` | `requested === false` | returns `chain`: waits for the pending hide to settle, so no hand-off overtakes it |
| `hideForHandOff()` | `requested` is `true` or `null` | sets `requested = false` **synchronously**, enqueues `setUiOptions({ enabled: false })`, returns it |
| `restore()` | `requested === true` | returns `chain` |
| `restore()` | `requested` is `false` or `null` | sets `requested = true` synchronously, enqueues `setUiOptions({ enabled: true })`, returns it |

Updating `requested` before enqueueing is what keeps concurrent callers ordered:
- Up to five hand-offs per job, from any number of jobs, race into `hideForHandOff()`. One enqueues and the others await the same promise.
- Take a `restore()` before one busy period's last hand-off and the first hand-off of a job that starts right after it. They land in the queue in the order they were called.

##### The last hand-off (R-006)

**Rule.** The hand-off of file *F* of job *J* is the busy period's **last hand-off** when both hold:
- no other file of any running job will still be handed to Chrome. "Any running job" means every record in `registry.list()`, *J* included;
- no running job is still resolving.

`awaitsHandOff` decides whether a file **will still be handed to Chrome**:

| `FileState` | `save` | Still to be handed off? | Why |
|---|---|---|---|
| `queued` | `true` | **yes** | It will be dispatched. Pump marks queued files `skipped` in the same mutation that sets a stop reason or fails a dependency. So a `queued` file seen between mutations is one that will run: the ugoira video while its zip or `frames.json` hands off, for example. |
| `fetching` | `true` | **yes** | Its bytes are on the way. It reaches `saving` unless it fails. |
| `ready` | `true` | **yes** | The offscreen document holds its blob, and it has not been handed off yet. |
| `saving`, `downloadId` stored | `true` | no | Chrome has it. |
| `saving`, no `downloadId`, in `decided` | `true` | no | Its `handOff()` has passed the decision. Its `download()` call follows or is in flight. |
| `saving`, no `downloadId`, not in `decided` | `true` | **yes** | Its `download` effect has not run yet (it waits behind a mutation), or a restart interrupted it and reconcile will re-issue it. |
| `done`, `failed`, `skipped` | any | no | Terminal. |
| any | `false` | no | The `retryEncode` zip is fetched into memory and never handed to Chrome. |

A job is **still resolving** when `phase === 'resolving' && stopReason === null && apiFailure === null`. This is the same test `reconcile()` uses to re-run `resolve`:
- Such a job's plan, and so its files, are not known yet, and by R-006's "last running job" it is running.
- A resolving job with a stop reason (cancelled) or an API failure is about to finalize with no file.
- A job that is finalizing is still listed, but all its files are terminal, so it never holds back another job's last hand-off.

```ts
// src/background/scheduler.ts — pure, next to IN_FLIGHT and isTerminal
export const handOffKey = (jobId: string, idx: number): string => `${jobId}#${idx}`;

/** The file will still be handed to Chrome by a later handOff(), unless it fails first (R-006). */
export function awaitsHandOff(file: FileTask, decided: boolean): boolean {
  if (!file.save) return false;
  switch (file.state) {
    case 'queued':
    case 'fetching':
    case 'ready':
      return true;
    case 'saving':
      return file.downloadId === undefined && !decided;
    case 'done':
    case 'failed':
    case 'skipped':
      return false;
  }
}

/**
 * R-006: `self`'s hand-off is the busy period's last. `decided` holds the handOffKeys of hand-offs that passed this
 * decision before `self` did (a Set or the engine's Map both fit).
 */
export function isLastHandOff(
  jobs: readonly JobRecord[],
  self: FileRef,
  decided: { has(key: string): boolean },
): boolean {
  return jobs.every(
    (job) =>
      !(job.phase === 'resolving' && job.stopReason === null && job.apiFailure === null) &&
      job.files.every(
        (file) =>
          (job.jobId === self.jobId && file.idx === self.idx) ||
          !awaitsHandOff(file, decided.has(handOffKey(job.jobId, file.idx))),
      ),
  );
}
```

`decided` is an in-memory `Map<string, Promise<number | null>>` in `createEngine`. Like `pendingDownloads`, it is per SW instance and never persisted.
- **Entries.** There is one entry per hand-off that has passed the decision. Each holds a promise that settles with the download id once that hand-off's `downloads.download()` call has resolved, or with `null` once it threw or the hand-off gave up before making it.
- **Added** in the same synchronous step that evaluates the rule.
- **Removed** in `handOff()`'s `finally`. That runs only after one of three things:
  - the file's `downloadId` is stored (`onDownloadStarted`);
  - the file failed (`onHandOffFailed`);
  - the hand-off returned because the job ended or the file left `saving`.
- **Invariant.** At every moment, a `saving` file without a `downloadId` is either in `decided` or genuinely still to be handed off.
- **After a restart** the map is empty, and that is exact. Reconcile either adopts the dead instance's download (`downloadId` stored) or re-issues the hand-off through `handOff()`.

**The decision inside `handOff()`**, in this order:
1. **Decide and claim in one synchronous step, before the first `await`.** Snapshot `earlier = new Map(decided)`, evaluate `last = isLastHandOff(registry.list(), self, earlier)`, then add this file to `decided`.
   - Up to five hand-offs per job run concurrently, because each `off/ready` mutation runs its `download` effect outside the registry lock.
   - Without the claim, two files landing together as the job's last two would each see the other `saving` without a `downloadId`, and neither would restore.
   - With it, the later of any two racing hand-offs sees the earlier one as handed off, so exactly one is last.
   - Mutators change records synchronously, so the rule never sees a half-applied mutation.
2. **Last only: wait for the earlier hand-offs** with `earlierIds = await Promise.all(earlier.values())`.
   - This makes Chrome create every file decided before this one before the UI comes back, and yields their download ids.
   - It puts every earlier `download()` call before the enable, whatever the microtask interleaving. Without the wait the order is not guaranteed: the test builds' `await __testHook(...)` yields even with no handler installed, so a queued enable would overtake an earlier `download()`.
   - Only hand-offs decided earlier are awaited, so waits follow decision order and can never form a cycle.
3. **Last only: wait until Chrome has named every other in-progress file** with `await targetsKnown(ids)`.
   - `ids` = the non-null `earlierIds`, plus the `downloadId` of every other `saving` file of a running job.
   - Chrome makes its animate-or-not decision for a download when it determines the target path, a few milliseconds after creating the item (platform facts). An earlier file named after the enable would animate too, breaking the PRD's "exactly one animation accompanies the last file" (CUJ-1 AC, R-006).
   - `targetsKnown` (below) resolves once each item has reported a `filename` or left `in_progress`, capped at `HANDOFF_TARGET_WAIT_MS` = 500 ms (`src/shared/constants.ts`).
   - Steps 2 and 3 cost nothing in the usual case. There every earlier file has already landed: no promise is pending, no file is `saving`, and `ids` is empty.
   - When the last files land together, they add one `download()` round trip, one `downloads.search` per in-progress item, and Chrome's naming latency: a few milliseconds, never more than 500 ms.
4. **Last only: re-check** `last = isLastHandOff(registry.list(), self, earlier)`. Use the same snapshot, immediately before the `restore()` call, with no `await` in between.
   - A job created during the waits is listed as resolving.
   - A hand-off decided during the waits is not in `earlier`.
   - Either one makes this file not last. It then takes the hide path, and the newer job's last hand-off restores.
5. **The UI call.**
   - **Last:** `await downloadUi.restore()`, then the new restart-test await point **`await:handoff.restoreUi`**.
   - **Otherwise:** `await downloadUi.hideForHandOff()`, then `await:handoff.hideUi` (unchanged).
   - The last hand-off never calls `hideForHandOff()`, and no other hand-off calls `restore()`.
6. **The live check and the download** (both unchanged).
   - Return unless the record is still listed and the file is still `saving`. Then `await:handoff.download` and `downloads.download()`.
   - The enable is applied before the call, so Chrome determines the last file's target path with the UI on. That file animates once and brings the button back.
   - The UI stays on for the rest of the job: the last file's own download, typically well under 1 s. A download the user starts in that tail shows Chrome's usual animation.

```ts
// src/background/engine.ts (inside createEngine)
/** Hand-offs past the last-hand-off decision, by handOffKey; each settles with its download id, or null (R-006). */
const decided = new Map<string, Promise<number | null>>();
/** Called with every downloads.onChanged delta, before onDownloadChanged filters it (R-006). */
const deltaWatchers = new Set<(delta: chrome.downloads.DownloadDelta) => void>();

/**
 * Resolves once Chrome has determined the target path of each download in `ids` (or the download left
 * `in_progress`, or Chrome no longer knows it), or after HANDOFF_TARGET_WAIT_MS. Never rejects.
 */
async function targetsKnown(ids: readonly number[]): Promise<void> {
  const pending = new Set(ids);
  if (pending.size === 0) return;
  let release!: () => void;
  const settled = new Promise<void>((resolve) => (release = resolve));
  const watch = (delta: chrome.downloads.DownloadDelta): void => {
    if (delta.filename?.current || (delta.state && delta.state.current !== 'in_progress')) pending.delete(delta.id);
    if (pending.size === 0) release();
  };
  deltaWatchers.add(watch);                        // before the search, so no delta falls between the two
  const timer = setTimeout(release, HANDOFF_TARGET_WAIT_MS);
  try {
    const found = await Promise.all([...pending].map(async (id) => [id, (await chrome.downloads.search({ id }))[0]] as const));
    for (const [id, item] of found) {
      if (!item || item.filename !== '' || item.state !== 'in_progress') pending.delete(id);
    }
    if (pending.size > 0) await settled;
  } catch (error) {
    log.warn('downloads.search failed', error);    // go on: at worst one extra animation
  } finally {
    deltaWatchers.delete(watch);
    clearTimeout(timer);
  }
}

// Engine.onDownloadChanged(delta) gains a first line, before its `complete`/`interrupted` filter:
//   for (const watch of deltaWatchers) watch(delta);

/** downloadIds of the `saving` files of running jobs, other than `self`. */
function otherSavingIds(self: FileRef): number[] {
  return registry.list().flatMap((job) =>
    job.files.flatMap((file) =>
      file.state === 'saving' && file.downloadId !== undefined && !(job.jobId === self.jobId && file.idx === self.idx)
        ? [file.downloadId]
        : [],
    ),
  );
}

async function handOff(job: JobRecord, idx: number): Promise<void> {
  const file = fileAt(job, idx);
  if (file?.state !== 'saving' || file.blobUrl === undefined || file.downloadId !== undefined) return;
  const { blobUrl } = file;
  const self: FileRef = { jobId: job.jobId, idx };
  const key = handOffKey(job.jobId, idx);
  // Step 1: no await between the snapshot, the decision and the claim.
  const earlier = new Map(decided);
  let last = isLastHandOff(registry.list(), self, earlier);
  let markIssued!: (downloadId: number | null) => void;
  decided.set(key, new Promise<number | null>((resolve) => (markIssued = resolve)));
  try {
    if (last) {
      const earlierIds = await Promise.all(earlier.values());                    // step 2
      await targetsKnown([...earlierIds.filter((id): id is number => id !== null), ...otherSavingIds(self)]); // step 3
      last = isLastHandOff(registry.list(), self, earlier);                       // step 4
    }
    if (last) {
      await downloadUi.restore();                                                 // step 5, R-006
      if (__TEST_HOOKS__) await __testHook('await:handoff.restoreUi');
    } else {
      await downloadUi.hideForHandOff();                                          // step 5, R-005
      if (__TEST_HOOKS__) await __testHook('await:handoff.hideUi');
    }
    const live = registry.get(job.jobId);                                         // step 6, unchanged from here
    if (!live || fileAt(live, idx)?.state !== 'saving') return;
    if (__TEST_HOOKS__) await __testHook('await:handoff.download');
    let downloadId: number;
    try {
      downloadId = await chrome.downloads.download(downloadOptions(job, file));
    } catch (error) {
      markIssued(null);
      await registry.mutate(job.jobId, (record) => onHandOffFailed(record, idx, blobUrl, errorMessage(error)));
      return;
    }
    markIssued(downloadId);
    // … pendingDownloads + onDownloadStarted + cancel-if-ended: unchanged
  } finally {
    markIssued(null);      // no-op once settled; covers the early return
    decided.delete(key);   // after the id is stored or the file failed
  }
}
```

```mermaid
flowchart TD
  A["handOff(job, idx)"] --> B{"file saving with a blob URL<br/>and no downloadId?"}
  B -- no --> Z[return]
  B -- yes --> C["earlier = copy of decided<br/>last = isLastHandOff(registry.list(), self, earlier)<br/>decided.set(key, issued) — one synchronous step"]
  C --> D{last?}
  D -- yes --> W["await every promise in earlier<br/>(Chrome has created each earlier file)"]
  W --> T["await targetsKnown(ids)<br/>(Chrome has named each in-progress file, ≤ 500 ms)"]
  T --> R{"isLastHandOff again,<br/>same snapshot?"}
  R -- yes --> E["await downloadUi.restore()<br/>hook await:handoff.restoreUi"]
  R -- "no: a job started meanwhile" --> F
  D -- no --> F["await downloadUi.hideForHandOff()<br/>hook await:handoff.hideUi"]
  E --> G{"record listed and<br/>file still saving?"}
  F --> G
  G -- "no (cancelled meanwhile)" --> Y["return: nothing reaches Chrome,<br/>an applied restore stays applied"]
  G -- yes --> H["hook await:handoff.download<br/>downloads.download → markIssued → store downloadId"]
  H --> X["finally: markIssued(null), decided.delete(key)"]
  Y --> X
```

**Restart at `await:handoff.restoreUi`.**
- At that point Chrome holds `enabled: true`, and the file is `saving` with no `downloadId`.
- The new instance finds the job running, so boot makes no call.
- Reconcile finds no Chrome download for the blob URL and re-issues the hand-off through `handOff()`. If the offscreen document lost the blob, reconcile re-fetches the file instead, and the file is handed off later.
- `handOff()` decides again: still last, since `decided` is empty. It calls `restore()`, which makes one `{ enabled: true }` call because `requested === null`, and downloads the file exactly once.

The waits in steps 2 and 3 have no hook of their own. Dying there leaves the same state as dying at `await:registry.effects` before the hand-off, which the restart test already covers.

**Examples** (one job unless stated; the instance booted idle, so `requested === true` at the start):

| Busy period | Hand-offs, in order | Its last hand-off | Chrome calls |
|---|---|---|---|
| 12 pages + `metadata.json` | `metadata.json` first, then the pages as they land | the 13th file handed off, whichever page lands last | `{false}` before `metadata.json`; `{true}` right before the 13th `download()` |
| 1 page + `metadata.json` | `metadata.json` (the page is still `fetching`), then the page | the page | `{false}`, then `{true}` |
| ugoira, MP4 or WebM | `metadata.json` and the zip; then `frames.json` (needs the zip `done`); then the video (needs both, then the encode) | the video: it is `queued` during every earlier hand-off, which counts | `{false}` before the first of `metadata.json`/zip; `{true}` right before the video |
| ugoira, ZIP only | `metadata.json`, zip, `frames.json` | whichever lands last, normally `frames.json` | `{false}` … `{true}` before it |
| `retryEncode` | the video only (its zip has `save: false`) | the video | none: nothing was hidden, and `restore()` finds `requested === true` |
| `retryMetadata`; `retryPages` with one page; one page with metadata off | the one file | that file | none: the file plays Chrome's usual animation, as before R-005 |
| resolve fails; needs login at resolve; Unavailable | none | none | none: nothing is hidden, and finalize's `restore()` finds `requested === true` |
| A (12P) and B (8P), B ends first | B's files, its last included, see A's files still `fetching`/`queued` | A's last file | one `{false}`; one `{true}` right before A's last `download()`; B's end makes no call |
| A's last file lands while B is still resolving | A's last sees B resolving, so it hides | B's last file, or none if B ends with no file | `{true}` before B's last file, or at B's finalize |
| Hydrated after a restart, one file left (`requested === null`) | the remaining file | that file | one `{true}` right before it |

Sometimes a file that counted as still to be handed off fails instead. Examples: a page that exhausts its four attempts after the others were saved, a `403` that stops a job with nothing left in flight, or a dismissed Save As. Then no hand-off of the busy period was the last. Finalize restores, and Chrome shows its button only with its next download. R-006 accepts this for every end without a final hand-off.

**Races**

| Race | What happens | Why it is right |
|---|---|---|
| Two files land together as the busy period's last two | The first `handOff()` to run sees the other still to be handed off, and hides. The second sees the first in `decided`, waits for its `download()` and for Chrome to name it, then restores. Exactly one restore and one animation. | Step 1 claims in the deciding step. Steps 2–3 make Chrome create and name the earlier file, with the UI still off, before the enable. |
| A job starts before the decision (it is listed, resolving) | The file is not last and hides. The new job's last hand-off restores, or its finalize does if it ends with no file. | R-006's "last running job": the new job is running. |
| A job starts during the waits (steps 2–3) | The step-4 re-check sees it resolving, so the file takes the hide path. | Same. |
| A job starts after the restore was requested | `restore()` set `requested = true` synchronously, so the new job's first `hideForHandOff()` enqueues `{ enabled: false }` behind the enable. Chrome applies enable, then disable. The new job's first `download()` waits for its own hide. The earlier job's last file animates unless Chrome determines its target path after the re-hide. The new job's last hand-off restores again. | The unchanged `chain` queue orders calls by request time. Two jobs started back to back can each end with one animation: each was the last running job when its last file was handed off. |
| Cancel between the restore and the download, or while the restore is in flight | The live check fails, so there is no `download()`: no "Canceled" entry and no animation. The UI stays on. The cancel's finalize calls `restore()`, which finds `requested === true` and makes no call. | No job is running, so the UI belongs on. The button returns with Chrome's next download, as after any cancel. |
| The last file's `download()` throws (`failed{disk}`) or Chrome interrupts it | The UI stays on, and finalize makes no further call. | The job is ending. |
| A file counted as still to be handed off fails instead | No hand-off was the last, so finalize restores. | R-006: an end without a final hand-off. |
| Chrome takes longer than 500 ms to name an earlier file (another extension holding it in `onDeterminingFilename`, a stalled disk) | The cap expires, the restore goes ahead, and that file may animate too. | A bounded delay of the last file is worth more than a guaranteed single animation in a rare case (risk in "Open Questions & Risks"). |

**Call sites** (the only three):
1. **`handOff(job, idx)`** in `engine.ts`, after its `saving` guard and before `chrome.downloads.download`: steps 1–6 above.
   - **Live check.** After the UI call, `handOff` returns unless the record is still in the registry **and** the file is still `saving`. A job cancelled while the call was in flight never hands that file to Chrome, so it leaves no "Canceled" entry (PRD CUJ-1 step 5). Finalize already released the blob.
   - **Why the file check.** The cancel mutation fails the file at once, but its record stays listed until finalize has pushed the final view and deleted it. A hand-off resuming in that window would otherwise start a download that the started-after-cancel path then cancels, leaving exactly that entry. A unit test in `engine-download-ui.test.ts` pins this.
   - **Every hand-off goes through `handOff`:** a fresh `off/ready`, reconcile's `ready → saving`, and reconcile's re-issue of a hand-off a restart interrupted.
   - So in every multi-file busy period the hide comes before the first file and the restore before the last. Nothing before the first hand-off touches the UI: a job that only resolves, fetches or encodes never hides it.
2. **`finalize(job)`**: step 5 above, after the mutation that deletes the record, when `registry.list()` is empty. This is the safety net for a busy period that ends without a final hand-off.
   - It covers every end reason, because every job ends through `finalize`: Saved, partial and error, needs login (including a mid-job 403 and the resolver's login-wall stop), Unavailable, and cancel (whose mutation returns `finalize` at once).
   - After a final hand-off it is a no-op. `requested` is already `true`, so `restore()` returns the settled chain and Chrome gets no second call.
   - A job that is still finalizing is still listed, so when two jobs end together, only the last one calls `restore()`.
   - A job that is still resolving keeps the UI as it is until it ends too.
3. **Boot** (`sw.ts`, above): `engine.restoreDownloadUiIfIdle()` = `registry.list().length === 0 ? downloadUi.restore() : Promise.resolve()`.
   - With hydrated jobs, the UI stays as the previous instance left it. It is hidden if a job had handed off a file, and otherwise visible until the next hand-off.
   - With `requested === null`, that next hand-off calls Chrome once; repeating a disable or an enable is harmless.

`Engine` gains `restoreDownloadUiIfIdle(): Promise<void>`, used by boot; finalize uses the same check internally.

**Error handling.**
- **Hide refused:** `warn` once per SW instance ("could not hide Chrome's download UI"), set the latch, and let the hand-off proceed. Saving the file is the job; hiding the animation is cosmetic.
- **Restore refused:** `debug`. This is expected when another extension keeps the UI off, and Chrome has already removed our entry before refusing. `requested` stays `true`. At the last hand-off the download goes on and plays no animation, because the other extension keeps the UI off.
- Neither method ever rejects into the effect runner, `finalize` or boot.
- **SW killed between deleting the last record and the restore:** the next SW start finds no job and restores (call site 3). Chrome also clears the entry when the extension unloads. For a kill at `await:handoff.restoreUi`, see "Restart at `await:handoff.restoreUi`" above.
- **Chrome holds a job file for a user decision** (dangerous-file or deep-scan prompt) while the UI is hidden.
  - The file stays `saving` with its `downloadId`, so it does not hold back the last hand-off. When the busy period's last file is handed off, the UI returns with it and the prompt is reachable in the bubble. The job ends once the user decides.
  - If the held file is itself the last hand-off, the UI is already on.
  - The prompt stays out of reach only while other files are still to be handed off, or when no hand-off follows because they all fail. The job then waits for the user in `chrome://downloads` (system.md §15 gap 1).

**Performance.**
- Two IPC calls per busy period, about 1 ms each: the hide before its first hand-off, and the restore before its last hand-off (or at its end).
- The first hand-off waits one round trip for the hide. The last waits one for the restore. When earlier files are still in flight, it also waits for their `download()` calls and Chrome's naming of them: usually a few milliseconds, capped at 500 ms.
- The rule scans every file of every running job: at most 201 files per job, about a microsecond per hand-off, under 1 ms over a 200-page job's life.

**Test API.**
- In `--e2e` builds (`__TEST_HOOKS__`), `self.__hfpTest.downloadUi()` returns `{ requested, calls }`.
- `calls` is `Array<{ enabled: boolean; ok: boolean; at: number }>`: the calls this SW instance made, with Chrome's result and `Date.now()` when each settled.
- It is merged into `self.__hfpTest` (shared with `clickAction`) through a new `exposeTestApi(api)` in `src/shared/test-hooks.ts`. `options-tab.ts` switches to the same helper, so neither installer overwrites the other.
- The installer is a function referenced only from `if (__TEST_HOOKS__)`, as in `options-tab.ts`. It wraps the injected `setUiOptions` to record each settled call. So prod bundles carry no trace (ENG-007 check), and the shipped module keeps no recording state.
- The last hand-off awaits the earlier `download()` calls, then the restore, before its own `download()`. So the `{ enabled: true }` call's `at` is ≥ the `startTime` of every file of the busy period handed to Chrome before it, and ≤ the last file's `startTime`.

```mermaid
sequenceDiagram
  autonumber
  participant OD as Offscreen
  participant SW as Service worker (engine)
  participant UI as download-ui.ts
  participant DL as chrome.downloads
  Note over SW: job A resolved, files fetching, Chrome's UI visible
  OD-->>SW: off/ready A:metadata.json
  SW->>SW: isLastHandOff? no (A's pages still to come) · decided += metadata
  SW->>UI: hideForHandOff()
  UI->>DL: setUiOptions({enabled:false})
  DL-->>UI: ok
  SW->>DL: download(A:metadata.json)
  OD-->>SW: off/ready A:p0 … p10
  SW->>UI: hideForHandOff() (requested=false → resolved chain)
  SW->>DL: download(A:p0 …)
  Note over SW: job B starts and hands off · its last page sees A's pages still to come → hide (no call) · B ends
  SW->>SW: finalize(B): registry still holds A → no restore
  OD-->>SW: off/ready A:p11 (nothing queued, fetching or unclaimed anywhere, no job resolving)
  SW->>SW: isLastHandOff? yes · await earlier download() calls and Chrome's naming of in-progress files · re-check: yes
  SW->>UI: restore()
  UI->>DL: setUiOptions({enabled:true})
  DL-->>UI: ok
  SW->>DL: download(A:p11)
  Note over DL: p11 animates once · the downloads button returns · its bubble lists both jobs' files
  DL-->>SW: onChanged complete (A:p11)
  SW->>SW: finalize(A): registry empty → restore() (requested=true → no call)
```

#### Hydration and reconciliation (after a SW restart)

```mermaid
flowchart TD
  A[SW starts] --> B[load job:* from storage.session]
  B --> C[badge.render — within 1 s]
  C --> D{offscreen document exists?<br/>runtime.getContexts OFFSCREEN_DOCUMENT}
  D -- yes --> E[off/tasks → live task table]
  D -- no --> F[live task table = empty]
  E --> G[for each job]
  F --> G
  G --> H{phase}
  H -- resolving --> I[re-run resolve job]
  H -- transferring --> J[reconcile each file]
  J --> J1["fetching/ready: task live? keep (ready → hand to Chrome now)<br/>task missing → back to queued"]
  J --> J2["saving with downloadId: downloads.search({id}) →<br/>complete→done · interrupted→failed · in_progress→keep · missing→failed{disk}"]
  J --> J3["saving without downloadId (died mid-hand-off):<br/>downloads.search({url: blobUrl}) → adopt id, else re-issue download"]
  J1 --> K[pump]
  J2 --> K
  J3 --> K
  I --> K
```

Re-queued fetches restart their attempt counter. This is acceptable: it only happens when the offscreen document itself died, which is outside PRD retry semantics.

#### Badge and action title (badge.ts)

```ts
remaining(job) =
  job.phase === 'resolving'        ? job.expectedFiles
: job.kind === 'pages'             ? count(files, role === 'page' && state ∈ {queued, fetching, ready, saving})
: job.kind === 'ugoira'            ? 1                                   // PRD §4.8: 1 for the whole job
: 0;
total = Σ remaining(job) over running jobs
jobs  = number of running jobs with remaining(job) > 0          // "across N downloads" counts only jobs with files left
badgeText  = total === 0 ? '' : total >= 1000 ? '999+' : String(total)
title      = total === 0 ? t('action_title_idle')               // nothing counted → idle title, never "0 files remaining"
           : jobs === 1 ? (total === 1 ? t('action_title_one_single') : t('action_title_one', total))
           :              t('action_title_many', total, jobs)
```

- **Zero counted files** (PRD §4.8, R-004 S11). A lone `retryMetadata` job, or a `full` job clicked before its metadata arrived (`expectedFiles` 0) while it resolves, is running but counts 0: the badge is hidden and the title is `action_title_idle`, and the job count in `action_title_many` counts only jobs that contribute files. The title and the badge therefore always tell the same story. (The first design titled the icon "Helper for Pixiv — 0 files remaining" here; code review W1.)

- `metadata.json`, `frames.json` and the zip never count separately (PRD §4.8). A `retryMetadata` job contributes 0, so the badge stays hidden unless another job runs.
- Failed and skipped files leave the count immediately (CUJ-4 "A job ends with failures").
- `render()` is coalesced (50 ms trailing) and called after every mutation that changes `remaining` or the job count, which meets the "≤ 1 s" requirement. `setBadgeText`/`setTitle` are skipped when unchanged.

#### Toolbar click → settings tab (options-tab.ts)

```ts
async function openOrFocusOptions(tab: chrome.tabs.Tab) {
  const url = chrome.runtime.getURL('options.html');
  const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
  if (ctx && ctx.tabId !== -1) {
    await chrome.tabs.update(ctx.tabId, { active: true });
    await chrome.windows.update(ctx.windowId, { focused: true });   // PRD CUJ-3 step 1: "that tab and its window are focused"
  } else {
    await chrome.tabs.create({ url, index: tab.index + 1, windowId: tab.windowId, openerTabId: tab.id, active: true });
  }
}
```

`runtime.openOptionsPage()` is not used. Its tab placement and cross-window focus behavior are unspecified ("may depend on … what Chrome happens to support"), while the PRD requires both "to the right of the current tab" and cross-window focus. `getContexts` finds the extension's own tabs without the `tabs` permission.

#### Codec capabilities (caps.ts)

`caps/get` and resolver calls go through `getCaps(w, h)`:
1. key `caps:<evenW>x<evenH>`, where `even(n) = n - (n % 2)`;
2. `storage.session` hit → return;
3. otherwise `off/probe` (creating the offscreen document if needed) → store → return.

Concurrent misses for the same key share one in-flight promise. Caching for the browser session satisfies PRD §4.6 ("The answer is cached for the browser session"), and since the probe runs in the same context as the encoder, the hint shown and the format produced agree.

## Data Flow

### Illustration / manga job (happy path, CUJ-1)

```mermaid
sequenceDiagram
  autonumber
  participant CS as Content script
  participant SW as Service worker
  participant SS as storage.session
  participant OD as Offscreen
  participant PX as www.pixiv.net
  participant IMG as i.pximg.net
  participant DL as chrome.downloads
  CS->>CS: optimistic busy "0 / 12" (≤100 ms)
  CS->>SW: job/start {full, 135882741, expectedFiles:12}
  SW->>SW: readSettings() → snapshot
  SW->>SS: set job:{jobId} (resolving)
  SW-->>CS: {ok, view}
  SW->>SW: badge "12"
  SW->>CS: api/fetchJson /ajax/illust/135882741
  CS->>PX: fetch (first-party)
  CS-->>SW: body
  SW->>CS: api/fetchJson /ajax/illust/135882741/pages
  CS->>PX: fetch
  CS-->>SW: 12 original URLs
  SW->>SW: resolveFolder → pixiv/みずき-135882741
  SW->>SS: set job (transferring, files queued, answered)
  loop up to 5 in flight, ascending idx
    SW->>OD: off/makeText(metadata) / off/fetchBytes(p_k)
    OD->>IMG: fetch p_k (DNR adds Referer)
    IMG-->>OD: 200 bytes
    OD-->>SW: off/ready {blobUrl}
    SW->>SS: file saving (persist intent)
    alt first hand-off of the busy period
      SW->>DL: setUiOptions({enabled:false}) (R-005)
    else last hand-off: no file still to hand off, no job resolving
      SW->>DL: setUiOptions({enabled:true}) (R-006)
    end
    SW->>DL: download(blobUrl, folder/name, uniquify)
    DL-->>SW: onChanged complete
    SW->>OD: off/release
    SW->>CS: job/update "k / 12"
    SW->>SW: badge 12−k
  end
  SW->>SW: classify → saved
  SW->>CS: job/update ended {saved, folder}
  SW->>SS: remove job:{jobId}
  SW->>SW: badge '' · title idle
  Note over SW,DL: finalize's restore(): already requested on by the last hand-off → no call (R-006)
```

### Ugoira job (CUJ-2)

```mermaid
sequenceDiagram
  autonumber
  participant SW as Service worker
  participant OD as Offscreen
  participant IMG as i.pximg.net
  participant DL as chrome.downloads
  Note over SW: resolved: format=mp4, files = metadata, zip, framesJson←zip, video←zip+framesJson
  SW->>OD: off/makeText(metadata.json)
  SW->>OD: off/fetchZip {save:true}
  OD->>IMG: GET originalSrc (streamed)
  OD-->>SW: off/progress zip loaded/total (→ 0–40%)
  OD-->>SW: off/ready zip {blobUrl} (bytes retained)
  SW->>DL: download 136004512_ugoira.zip
  DL-->>SW: complete
  SW->>OD: off/makeText(frames.json)
  OD-->>SW: off/ready
  SW->>DL: download frames.json
  DL-->>SW: complete
  SW->>OD: off/encode {zipTaskId, frames, mp4, avcCodec}
  loop each frame
    OD-->>SW: off/progress encode done/total (→ 40–100%, capped 99)
  end
  OD-->>SW: off/ready video {blobUrl}
  SW->>DL: download 136004512.mp4
  DL-->>SW: complete
  SW->>OD: off/release [zip, video]
  SW->>SW: finalize → saved {format: mp4}
```

### SW restart mid-job (CUJ-4)

```mermaid
sequenceDiagram
  participant OD as Offscreen
  participant SW as Service worker (new instance)
  participant SS as storage.session
  participant DL as chrome.downloads
  Note over SW: Chrome stopped the old SW, offscreen keeps fetching
  OD->>SW: off/ready (wakes SW)
  SW->>SS: hydrate job:*
  SW->>SW: badge.render() (≤ 1 s)
  SW->>OD: off/tasks
  SW->>DL: downloads.search for saving files
  SW->>SW: reconcile + handle queued off/ready + pump
```

## Alternatives Considered

**Where job state lives**

| Criteria | **storage.session write-through** | In-memory only + rebuild from `downloads.search` | IndexedDB | State owned by the offscreen document |
|---|---|---|---|---|
| Survives SW restart | Yes | Partly: queued (not-yet-handed) files are invisible to `downloads.search` | Yes | Yes, but the SW still needs it for every `chrome.*` call |
| Gone when Chrome quits (PRD: no history) | Yes, by construction | Yes | No: needs explicit cleanup and leaves history on crash | Yes |
| PRD/index mandate | Matches "session-scoped storage" | Fails §4.8 | Contradicts "gone when Chrome quits" | Contradicts §4.1 #6 (orchestration in SW) |
| Complexity | Low (one key per job) | High (reconstruction heuristics) | Medium | Medium (two-hop for every decision) |
| **Verdict** | **Selected** | Rejected | Rejected | Rejected |

**Progress transport (SW → tab)**

| Criteria | **`tabs.sendMessage` full snapshots** | Long-lived `runtime.connect` port | Content script polls the SW |
|---|---|---|---|
| Survives SW restart | Yes (stateless) | No: port dies, needs reconnect logic | Yes |
| Keeps the SW alive needlessly | No | Yes (Chrome 114+ ports extend lifetime) | Polling wakes it constantly |
| Lost-message tolerance | Full snapshot each time | Needs replay | n/a |
| **Verdict** | **Selected** | Rejected | Rejected |

**API call origin for jobs**: see [system.md §8.3](system.md) (tab proxy + offscreen fallback, selected over SW-only fetch).

**Where Chrome's download UI is toggled (R-005)**

| Criteria | **SW module: hide before each hand-off, restore at finalize/boot (the restore moved to just before the last hand-off with R-006, table below)** | Hide at `job/start`, restore at finalize | A registry `Effect` per job (`hideUi`/`restoreUi`) | Persist the UI state in `storage.session` |
|---|---|---|---|---|
| PRD "never starts before the job's first file is handed to Chrome" | Yes | **No**: hides during resolving and fetching (a long zip fetch), and for jobs that end needs-login or Unavailable without any file | Yes | Yes |
| First file covered ("not even for the first file") | Yes (awaited before `download`) | Yes | Needs ordering between two effects of different mutations | Yes |
| Browser-wide fact vs per-job state | Matches: one module for the browser-wide setting | Matches | Mismatch: effects belong to one job; the UI belongs to all of them | Duplicates a fact Chrome already holds; stale after Chrome clears it on unload |
| Survives SW restart | Chrome keeps the state; the boot rule covers a lost restore | Same | Same | Same, with more code |
| **Verdict** | **Selected** | Rejected | Rejected | Rejected |

**When Chrome's download UI comes back (R-006)**

| Criteria | **Restore just before the busy period's last hand-off; finalize and boot as safety nets** | Restore at finalize only (iteration 3, R-005) | Finalize restore plus a marker download to wake the button | Hold the last file until every other file has landed, then restore and hand it off |
|---|---|---|---|---|
| Button back after a Saved job | Yes, through Chrome's own download of the last file | **No**: Chrome waits for its next download event (QA iteration 3) | Yes | Yes |
| Bubble lists the job's files | Yes | Only after the next download | Yes, plus the marker | Yes |
| Animations per job | One, at the end | None | One, for a file the user never asked for | Exactly one |
| Side effects | None | None | An extra file in Downloads and in `chrome://downloads`, which no CUJ allows (CUJ-1/CUJ-2 list each folder's exact contents) | The last file waits for the others to land (milliseconds to seconds). A file held for a danger decision blocks it indefinitely. |
| Ends without a final hand-off | Finalize restores; the button returns with the next download (accepted by R-006) | Same | The marker wakes it | Same as the selected option |
| Code | One pure predicate in `scheduler.ts`, plus an in-memory map and two bounded waits in `handOff()` | Existing | A marker file, its cleanup (`removeFile`/`erase`), and PRD changes | A completion-keyed waiter, plus a timeout for held files |
| **Verdict** | **Selected (R-006 option B)** | Replaced | Rejected | Rejected |

**How "No connection" is judged (R-004 S3)**

| Criteria | **Job-level flag (`JobRecord.answered`) + request-level `Failure.answered`** | Per-request `lastStatus` (iteration 2) | Per-URL/host memory of recent 429/5xx in the SW |
|---|---|---|---|
| Matches PRD CUJ-5 step 6 (per click: no request of the job answered) | Exactly | No (misses a click whose every byte request Chromium refused) | No (a different rule: time-windowed) |
| Deterministic under Chromium throttling | Yes | No (1 of 7 Retries wrong in QA iteration 2) | Mostly, but depends on the window length |
| Survives SW restart | Yes: persisted in the record | Yes | Needs its own persisted store |
| Extra state | One optional field per record | None | A new storage key and expiry |
| **Verdict** | **Selected** | Replaced | Rejected (it was the fallback if R-004 had answered B) |

## Cross-Cutting Concerns

- **Error handling:** every failure becomes a `Failure` on a file or as `apiFailure`. The classifier ([system.md §10](system.md)) is the only place outcomes are decided. `chrome.*` call rejections inside effects are caught and logged at `warn`; a failed `tabs.sendMessage` push is expected (tab gone) and logged at `debug`.
- **Security:** inputs are validated per [system.md §7](system.md). Retry requests cannot point the engine at arbitrary URLs because URLs are always re-derived from pixiv's API, never accepted from the tab. Folders echoed by the tab are re-validated. Only the originating tab may cancel a job.
- **Performance:** per-file overhead is 2 messages + 1 `storage.session` write + 1 download call (~2–5 ms). A 200-page job therefore spends < 1 s of SW CPU in total. Badge rendering is O(jobs × files), recomputed ≤ 20×/s.
- **Observability:** `info` at job start/end with `jobId`, `artworkId`, `mode`, `kind`, outcome, counts, duration; `debug` per file transition. `chrome://extensions` → Errors shows `warn`/`error`.
- **Testing:**
  - Unit: scheduler pump (cap, order, deps, stop on 403, cancel), `classifyOutcome` (one case per row plus precedence conflicts; row 8 cases: a job without `answered` whose only failure is an unanswered `network` API failure → offline; a resolved job (`answered: true`) whose every original failed with unanswered `network` → server (the PRD's accepted cost); an API `network` failure with `answered: true` → server; any `internal` or `timeout` → server; `navigator.onLine === false` → offline even when answered; all `disk`/`dismissed` → disk; row 4 via `stopReason 'forbidden'` with no failed file), badge/title math including `999+`, singular, a lone 0-count job (idle title, empty badge) and "across N" counting only jobs with files left, `buildMetadata`/`serializeJson` against golden vectors, `effectiveFormat` truth table.
  - Resolver: `full` with `loggedIn: false` on a withheld body → `loginRequired`, and the fake API saw no `/pages` or `ugoira_meta` call; `loggedIn: true` or `null` on the same body → proceeds; `retryEncode` calls `/ajax/illust` before `ugoira_meta`; a transport error from both the tab and the offscreen fallback → `apiFailure` with `kind: 'internal'` and `answered: false`; `Resolution.answered` per the examples in "Resolving"; `applyResolution` sets `job.answered` for `ok`, the login-wall stop and an answered failure, and leaves it absent for an unanswered failure.
  - `download-ui.ts` (fake `setUiOptions`):
    - concurrent `hideForHandOff()` calls make one Chrome call and all resolve after it;
    - `restore()` then `hideForHandOff()` in the same tick apply in that order, and so do `hideForHandOff()` then `restore()` (R-006: the last hand-off of a busy period whose first hide is still in flight);
    - a second `restore()` makes no call;
    - a refused hide warns once, latches, and still resolves;
    - a refused restore resolves and logs at `debug`;
    - `requested === null` at start makes both methods call Chrome.
  - Last-hand-off rule (`awaitsHandOff`, `isLastHandOff` in `scheduler.ts`, pure unit tests):
    - every row of the state table: each `FileState` with `save` true and false, and `saving` with a `downloadId`, and without one both in and out of `decided`;
    - the file itself is ignored;
    - a resolving job blocks; one with a `stopReason` or an `apiFailure` does not;
    - another job's pending file blocks;
    - the examples table: 12 pages + metadata at several points, ugoira MP4 and ZIP only, `retryEncode`, `retryMetadata`, two jobs.
  - Engine (`engine-download-ui.test.ts`, injected `DownloadUi` spy):
    - the last hand-off calls `restore()` and never `hideForHandOff()`, and no `download()` is asked for until the restore resolves;
    - every other hand-off calls `hideForHandOff()` only;
    - the last two files' `off/ready` in one tick → exactly one `restore()`, from the second hand-off, called only after the first file's `download()` has resolved and Chrome has named it;
    - an earlier file still `in_progress` with no `filename` → no `restore()` until its `filename` delta (or a terminal state) arrives, and the restore goes ahead after 500 ms without one (fake timers);
    - `targetsKnown([])` makes no `downloads.search` call; the watcher is gone afterwards;
    - a cancel while the restore is in flight → no `download()` and no hide;
    - a job created while the last hand-off waits (steps 2–3) → the re-check takes the hide path;
    - a job listed as resolving makes another job's last file hide;
    - the `decided` entry is gone after the id is stored, after a throwing `download()`, and after a give-up. This is observable because a later hand-off can then be last.
  - Integration (Vitest + `test/fakes/chrome.ts`): full job runs with a fake offscreen; SW restart is simulated by discarding the module instance and re-importing with the same fake `storage.session`/`downloads` at every await point of a scripted job, including `await:handoff.hideUi` and `await:handoff.restoreUi` (R-006). Also concurrent jobs, and cancel races: `off/ready` after a cancel, and a cancel while the hide or the restore is in flight → no `download` call.
  - R-005/R-006 order, from the fake's combined call log (design-test-harness.md L2):
    - no `setUiOptions` while a job only resolves or fetches;
    - `{ enabled: false }` resolves before the first `download` of a multi-file busy period;
    - a Saved job logs `ui:false`, every other `download`, `ui:true`, then the last `download`, and nothing after its record is deleted;
    - only one `download` is ever called while the UI is on: the busy period's last;
    - with the fake's deferred naming on, two files landing together as the last two → no `ui:true` until the earlier one is named;
    - ends without a final hand-off (cancel; a partial job whose failing file settles last; needs login after a 403 with nothing left in flight; Unavailable as the last job to end) → one `{ enabled: true }` after the last record is deleted;
    - a partial job whose last-settling file succeeds restores before that file;
    - none when job B ends while job A runs, and A's `ui:true` sits right before A's last `download`;
    - a single-file job after an idle boot → no `ui` entry;
    - a zero-file job → none;
    - a job started after the restore → a fresh `ui:false` before its first `download`;
    - boot with no records → `{ enabled: true }`;
    - boot with a hydrated running job → no call until its next hand-off;
    - a refused `setUiOptions` never fails a job.
  - E2E: [design-test-harness.md](design-test-harness.md).

## Migration / Rollout

**Iteration 3.**
- **Persisted shape.** `Failure.lastStatus` is removed; `Failure.answered?: true` and `JobRecord.answered?: true` are added. `storage.session` is cleared when the extension is updated or reloaded, so no record of an earlier build is ever hydrated: no migration and no bump of `JobRecord.v`. A record without `answered` reads as "nothing answered yet", which is exactly what an absent field means. The `isFailure` guard in `messages.ts` accepts `answered: true` (and nothing else under that key) and drops `lastStatus`.
- **Permission.** `downloads.ui` joins the manifest. It carries no install warning (system.md §5), so an update to this build installs silently and is not disabled for re-approval. Chrome removes our UI-disable entry when the extension unloads for the update, so no build ever leaves Chrome's UI hidden across an update.
- **Rollback** is a plain revert. The previous build never calls `setUiOptions`; a rollback is itself an update, which unloads the extension and clears any disable this build left. Removing a permission never prompts.

**Iteration 2.**
- **Persisted shape.** `StartRequest.full` gains `loggedIn`, and `Failure` gains `kind: 'internal'`. The resolver reads `request.loggedIn ?? null`, so even a hydrated record without the field skips the check (never needs-login), the safe reading; incoming `job/start` messages are validated strictly (above).
- **Type move (ENG-008)** is compile-time only.

## Dependencies & Integration Points

- **Depends on:**
  - `src/shared/*` (types, messages, settings, pattern, metadata, retry, pixiv-api, outcome, progress, i18n);
  - the offscreen worker contract;
  - the content-script contract (`api/fetchJson`, `job/update`);
  - `chrome.downloads` (including `setUiOptions`, permission `downloads.ui`), `chrome.storage.session`/`sync`/`local`, `chrome.action`, `chrome.declarativeNetRequest`, `chrome.offscreen`, `chrome.runtime.getContexts`, `chrome.tabs.create/update/sendMessage`, `chrome.windows.update`.
- **Depended on by:** the content script (all job states), the options page (none directly), the e2e harness (evaluates `chrome.downloads.search`, `chrome.action.getBadgeText` and `__hfpTest.downloadUi()` in the SW).

## Open Questions & Risks

- **Byte path verified** (ENG-002): the DNR rule as written matches offscreen fetches and nothing else, and `chrome.downloads.download(blobUrl)` from the SW saves a blob created in the offscreen document ([system.md §8.2](system.md)). No fallback rule is implemented.
- **"Ask where to save each file" on:** `saveAs: false` may still prompt per file. A dismissed dialog → `dismissed` → counted as failed and not retried (PRD CUJ-1 edge). The Save As dialog is a separate window, not part of the download UI that R-005 hides, so it is expected to appear while the UI is hidden. Verify on branded Chrome (L5).
- **A Chrome prompt for a job file while the UI is hidden** (dangerous-file or deep-scan). The held file does not hold back the busy period's last hand-off, which brings the UI, and so the prompt, back. The prompt stays hidden only while other files are still to be handed off, or when no hand-off follows because they all fail ([system.md §15](system.md) gap 1, with pm).
- **A second animation after a naming stall** (platform timing, R-006).
  - Step 3 waits for Chrome to name every in-progress file of the busy period before the enable, capped at 500 ms.
  - If Chrome takes longer, the restore goes ahead and that file may animate too. Causes: another extension holding the name in `onDeterminingFilename`, or a stalled disk.
  - Likelihood is low, and the cap bounds the delay of the job's last file.
  - The step rests on Chrome deciding a download's UI in the same observer pass that reports its `filename` (platform facts, from source reading). L5 watches a re-download served from the HTTP cache, where the last files land together, for exactly one animation.
- **An end without a final hand-off leaves the button away until Chrome's next download.** This covers cancel, failure, needs login, Unavailable, and a last outstanding file that fails. The UI is on, but Chrome shows the button only with its next download event, and no extension API can show it sooner. R-006 accepts this.
- **Stale logged-in page** (user logged out in another tab): the resolver does not treat a withheld body as a refusal while the page claims to be logged in, so a walled all-ages work downloads in that case. This is PRD text now (CUJ-5 edge, R-004 S12a), to be revisited after the release checklist's logged-in stale-page probe ([system.md §8.5](system.md) miss 2).
