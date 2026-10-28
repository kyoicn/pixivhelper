# Helper for Pixiv — System Design

> Last updated: 2026-10-28 01:55:46 (UTC-7)
> Serves: prd-000 (CUJ-1 … CUJ-5, including the 2026-10-27 CUJ-1 refinement: a repeat download goes to the sibling folder `<folder> (n)` chosen from Chrome's download history, Issue 2026-10-27-19-58-31); rulings R-001, R-002, R-003, R-004 (spec-sync S1–S15), R-005 (Chrome's download UI hidden while a job runs), R-006 (it comes back just before the last file of the last running job is handed to Chrome), R-007 (spec-sync of six items: counter wording, the 200-page edge, a mid-job 403, settings-page contrast, the ugoira-zip prompt, a Retry re-writes a `metadata.json` that did not land), R-008 (spec-sync of three items: the folder-check scope as an accepted limitation, the 10 s existence re-check qualifier, the unpainted `200 / 200` instant)
> Chapters: [design-download-engine.md](design-download-engine.md) · [design-offscreen-worker.md](design-offscreen-worker.md) · [design-artwork-button.md](design-artwork-button.md) · [design-settings-model.md](design-settings-model.md) · [design-options-page.md](design-options-page.md) · [design-test-harness.md](design-test-harness.md)

This chapter holds the cross-cutting architecture: runtime contexts, tech stack, the shared data model, message conventions, the network/Referer strategy, the retry policy, the error model, security/privacy/i18n/a11y conventions, build/release, and the constraints table. Component chapters own everything specific to one context.

---

## 1. Overview & guiding philosophy

Helper for Pixiv is a Manifest V3 Chrome extension. It injects one button into pixiv artwork pages. One click saves the whole artwork (originals, `metadata.json`, and for ugoira the frame zip, `frames.json` and a browser-encoded video) into a folder under Chrome's Downloads directory (PRD-000 §1, §4.3).

The system has four runtime contexts. Each one owns a single concern.

| Context | Owns | Lifetime | Chapter |
|---|---|---|---|
| **Content script** (`content.js`, every `https://www.pixiv.net/*` top frame) | The button: discovery, rendering, state, a11y. Per-tab memory. First-party pixiv API calls (render-time metadata, and API proxy for jobs). | One pixiv document | [design-artwork-button.md](design-artwork-button.md) |
| **Service worker** (`sw.js`) | **Job truth**: job registry, scheduling, `chrome.downloads` (including hiding Chrome's download UI while a job runs, R-005), badge/title, DNR rule, toolbar click. | Ephemeral: Chrome stops it after 30 s idle. All state is write-through to `chrome.storage.session`. | [design-download-engine.md](design-download-engine.md) |
| **Offscreen document** (`offscreen.html`) | **Bytes**: fetching originals and frame zips, building Blob URLs, codec probing, ugoira decode/encode. | Created on demand, closed 5 s after the last job ends. Not subject to the SW idle timer. | [design-offscreen-worker.md](design-offscreen-worker.md) |
| **Options page** (`options.html`, full tab) | The three settings. | One tab | [design-options-page.md](design-options-page.md) |

The domain logic all four contexts share (settings schema, folder pattern grammar, sanitization, Chrome path safety) is specified once in [design-settings-model.md](design-settings-model.md).

### Guiding principles

1. **Tab-independent by construction** (PRD NFR "Tab independence", §4.1 #6). The content script only renders and asks. Every step of a job runs in the SW or the offscreen document, so closing the tab cannot cancel anything.
2. **The SW owns truth; the offscreen document owns bytes.** The SW never holds file bytes, because it cannot create Blob URLs and a fetch taking more than 30 s to respond gets the worker terminated. The offscreen document never decides policy, because it can only use `chrome.runtime`.
3. **Assume the SW dies at every `await`.** Every job mutation is persisted to `chrome.storage.session` before its side effect is issued. Hydration reconciles against `chrome.downloads.search` and the offscreen task table (PRD §4.8, CUJ-4 "Service-worker restart").
4. **Pure core, thin shells.** Folder resolution, sanitization, `metadata.json` construction, retry policy, progress math, label/width candidates and outcome classification are pure TypeScript modules in `src/shared/`. They make no `chrome.*` calls at import time, and they are unit-tested, with the parity rules checked against golden vectors generated from `ref/pixiv-dl`.
5. **Parity is proven, not asserted** (PRD Goal 2). Behaviors carried over from `ref/pixiv-dl` (sanitization, `metadata.json`, `plain_text`, retry) are pinned by golden tests produced by the script itself (ENG-003).
6. **Minimal surface** (PRD index "Privacy & security"): 5 permissions (the fifth, `downloads.ui`, added by R-005), 2 hosts, no UI framework, no telemetry, no remote code.
7. **Every failure maps to exactly one button outcome.** A deterministic classifier (§10) turns low-level failures into the PRD's states. No failure is swallowed.

---

## 2. Architecture

```mermaid
flowchart LR
  subgraph Tab["pixiv tab (www.pixiv.net)"]
    CS["Content script<br/>button · tab memory · API proxy"]
  end
  subgraph Ext["Extension (chrome-extension://ID)"]
    SW["Service worker<br/>job registry · scheduler · badge"]
    OFF["Offscreen document<br/>fetch → Blob URL · WebCodecs encode"]
    OPT["Options page<br/>3 settings"]
  end
  subgraph Chrome["Chrome platform"]
    DL["chrome.downloads"]
    SS["storage.session<br/>(in-flight jobs, codec caps)"]
    SYNC["storage.sync / storage.local<br/>(settings)"]
    DNR["declarativeNetRequest<br/>session rule: Referer"]
    ACT["chrome.action<br/>badge · title · click"]
  end
  PX["www.pixiv.net/ajax/illust/*"]
  IMG["i.pximg.net<br/>originals · ugoira zip"]

  CS -- "runtime.sendMessage<br/>job/start · job/cancel · job/listForTab · caps/get" --> SW
  SW -- "tabs.sendMessage<br/>job/update · api/fetchJson" --> CS
  CS -- "fetch (first-party cookies)" --> PX
  SW -- "runtime.sendMessage off/*" --> OFF
  OFF -- "runtime.sendMessage off/* events" --> SW
  OFF -- "fetch (Referer added by DNR)" --> IMG
  OFF -. "fallback fetchJson (tab gone)" .-> PX
  DNR -. "modifies only extension-initiated, tab-less requests" .-> IMG
  SW --> DL
  SW --> SS
  SW --> ACT
  SW --> DNR
  CS --> SYNC
  OPT --> SYNC
  SW --> SYNC
```

**One-sentence data flow.** The user clicks, and the content script sends `job/start`. The SW creates and persists a job, then resolves the plan through pixiv's API, using the originating tab as a first-party proxy (§8.3). It chooses the folder actually used: the resolved one, or its sibling `<folder> (n)` when Chrome's download history (`chrome.downloads.search`) shows this artwork's files still present there (D15). It queues files, and asks the offscreen document to fetch each one (Referer added by DNR) and hand back a `blob:` URL. The SW then calls `chrome.downloads.download(blobUrl, folder/name, uniquify)`, counts completions from `downloads.onChanged`, updates the badge, and pushes `JobView` snapshots to the tab. Before the first `downloads.download` call of a busy period it hides Chrome's download UI (`chrome.downloads.setUiOptions({ enabled: false })`), and it shows the UI again just before the last file of the last running job is handed to Chrome, once every other file has finished (capped at 2 s). Chrome's download of that file then brings its downloads button back with one animation, and the bubble lists every file. A busy period that ends without such a hand-off gets the UI back at its end (PRD §4.1 #3, R-005, R-006, D12).

---

## 3. Tech stack

| Area | Choice (version) | Why | Rejected |
|---|---|---|---|
| Language | **TypeScript ~6.0.3**, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` | Type-checked message protocol and state machines. The pin is below 6.1 because `typescript-eslint` 8.72 declares `typescript <6.1.0` as its peer range. TS 7 (native) is not yet supported by the lint toolchain. | TS 7.x (lint incompatibility); plain JS |
| Bundler | **esbuild ^0.28** driven by `scripts/build.mjs` | There are four entry points with two output formats (content script must be a classic IIFE; SW, offscreen and options are ESM). esbuild builds each in milliseconds with no plugin layer. The build script also copies `manifest.json`, `_locales/`, HTML/CSS and icons. The output is plain, readable JS, which helps Web Store review. | Vite + `@crxjs/vite-plugin` (HMR has little value for a 1-button UI; plugin maintenance history is uneven); WXT (a full framework with file-based magic; too much indirection for 4 entry points) |
| Unit/integration tests | **Vitest ^5** + **happy-dom ^21** (DOM tests opt in per file with `// @vitest-environment happy-dom`) | Fast, native TS/ESM, fake timers for retry/backoff. | Jest (ESM friction) |
| End-to-end | **@playwright/test ^1.64**, bundled Chromium (Chrome for Testing) | Branded Chrome ≥ 137 ignores `--load-extension`; CfT/Chromium do not. CfT ships proprietary codecs, so H.264 is testable. | Puppeteer (Playwright is the QA role's tool) |
| Lint/format | **ESLint ^10** flat config + **typescript-eslint ^8.72** (`recommendedTypeChecked`) + **Prettier ^3** | Type-aware rules catch floating promises, the main SW bug class. | — |
| Video muxing/encoding | **mediabunny ^1.62** (MPL-2.0, pure TS, no WASM, `sideEffects: false`) | Wraps WebCodecs `VideoEncoder`. Writes MP4 (H.264) and WebM (VP9). Has backpressure-aware `VideoSampleSource.add()`, quantizer rate control with bitrate fallback, `canEncodeVideo()` probes, and exact ms timestamps (MP4 track `frameRate: 1000` → timescale 1000; WebM TimestampScale is 1 ms natively). Successor of `mp4-muxer`/`webm-muxer`. | ffmpeg.wasm (banned by PRD §4.1 #4); `mp4-muxer` + `webm-muxer` (deprecated in favor of mediabunny) |
| Zip reading | **fflate ^0.8.3** (MIT), `unzipSync` with a per-frame `filter` | Reads one frame at a time from the retained zip bytes, satisfying PRD "Memory". Tiny, with no workers or eval when the sync API is used. | JSZip (heavier, async-only); `@zip.js/zip.js` (more surface, worker config to neutralize); hand-written reader (needless risk) |
| Chrome typings | **@types/chrome ^0.3** | `offscreen`, `runtime.getContexts`, `declarativeNetRequest` types. | — |
| UI | **No framework.** Vanilla TS + a ~40-line `h()` element helper in `src/shared/dom.ts` | The injected button is one component with a state machine. The options page has 3 controls. A framework would add bytes to a content script running on every pixiv page, plus a second rendering model to fight pixiv's React. | Preact, Lit |
| Dev runtime | Node ≥ 22 (dev only), npm with committed `package-lock.json` | — | — |

Runtime dependencies are exactly `mediabunny` and `fflate`. Both are bundled into the offscreen document only. The content script and SW bundles contain no third-party code.

---

## 4. Repository layout

```
/
├── package.json  package-lock.json  tsconfig.json  eslint.config.js  .prettierrc  vitest.config.ts  playwright.config.ts
├── scripts/
│   ├── build.mjs            # esbuild + static copy → dist/ ; --watch ; --prod
│   ├── zip.mjs              # dist/ → helper-for-pixiv-<version>.zip (store upload)
│   ├── gen-golden.py        # golden vectors from ref/pixiv-dl (ENG-003)
│   ├── render-icons.mjs     # assets/icon.svg → src/icons/*.png (one-off)
│   └── owner-lint.sh        # (existing)
├── src/
│   ├── manifest.json        # version injected from package.json at build
│   ├── _locales/{en,ja,zh_CN,zh_TW}/messages.json
│   ├── icons/icon-{16,32,48,128}.png
│   ├── shared/              # pure modules; no chrome.* at import time
│   │   ├── constants.ts     # hosts, limits, timings, colors, storage keys (single source)
│   │   ├── types.ts         # Settings, JobView, JobOutcome, Failure, WorkInfo …
│   │   ├── job.ts           # job model + protocol: JobRecord, FileTask, UgoiraState, StartRequest, ErrorCode (§6, D11)
│   │   ├── messages.ts      # message catalog + runtime guards
│   │   ├── settings.ts      # schema, defaults, read/merge/write (sync+local)
│   │   ├── pattern.ts       # validate · resolve · sanitizeToken · chromeSafeSegment
│   │   ├── metadata.ts      # buildMetadata · plainText · serialize (byte parity)
│   │   ├── html-entities.ts # generated by scripts/gen-golden.py (Python html.entities.html5)
│   │   ├── retry.ts         # fetchWithRetry (policy §9)
│   │   ├── pixiv-api.ts     # URL builders, response parsing, API failure mapping, requiresLogin (§8.5)
│   │   ├── outcome.ts       # classifyOutcome (§10)
│   │   ├── progress.ts      # ugoira percent mapping, monotonic clamp
│   │   ├── i18n.ts          # t(key, subs), localeTag(), splitOnPlaceholder()
│   │   ├── log.ts           # leveled console logger, debug-gated
│   │   └── dom.ts           # h() helper (used by content + options)
│   ├── background/          # SW: sw.ts (entry), registry.ts, scheduler.ts, resolver.ts, downloads.ts,
│   │                        #     offscreen-client.ts, tab-client.ts, badge.ts, dnr.ts, options-tab.ts, caps.ts
│   ├── offscreen/           # offscreen.html, offscreen.ts (router), tasks.ts, fetch-bytes.ts,
│   │                        #     ugoira/{zip.ts, encode.ts, codec.ts, timeline.ts}
│   ├── content/             # content.ts (entry), router.ts, pixiv-dom.ts (ALL pixiv selectors),
│   │                        #     mount.ts, tab-memory.ts, api-proxy.ts, button/{model.ts, labels.ts,
│   │                        #     width.ts, view.ts, styles.ts, icons.ts, live-region.ts}
│   └── options/             # options.html, options.css, options.ts
├── test/
│   ├── unit/                # *.test.ts per shared module + background/content logic
│   ├── golden/              # *.json produced by scripts/gen-golden.py (committed)
│   ├── fakes/chrome.ts      # in-memory chrome.* fakes for SW integration tests
│   └── fixtures/            # pixiv JSON bodies, zips, DOM snapshots
└── e2e/                     # Playwright: fake-pixiv server, launcher, CDP helpers, specs (design-test-harness.md)
```

**Rule:** `src/content/pixiv-dom.ts` is the only file that knows pixiv's DOM (selectors, theme marker, login marker). This keeps fixes for pixiv redesigns in one place (PRD index Risks).

**Layering rule (D11).** `src/shared/` imports nothing from `src/background/`, `src/content/`, `src/offscreen/` or `src/options/`, and no context directory imports from another context directory: contexts depend on `src/shared/` and on themselves only. Every type that crosses a context boundary, or that a pure shared module operates on, lives in `src/shared/`. That includes the job model (`JobRecord`, `FileTask`, `FileRole`, `FileState`, `UgoiraState`) and the request protocol (`StartRequest`, `ErrorCode`), which live in `src/shared/job.ts`. The rule exists because the pure core (principle 4: `classifyOutcome`, progress math, message guards, `pixiv-api.ts` parsers, the button model) operates on these types; when they lived in `src/background/types.ts`, every shared module and the content-script model depended on the service worker's directory (iteration-1 code review W6). The rule is enforced by ESLint `no-restricted-imports` patterns per directory (ENG-008), so a regression fails `npm run lint` rather than review.

---

## 5. Manifest, permissions, minimum Chrome

```jsonc
{
  "manifest_version": 3,
  "name": "__MSG_ext_name__",                 // "Helper for Pixiv" (R-002)
  "description": "__MSG_ext_description__",
  "default_locale": "en",
  "version": "1.0.0",                         // injected from package.json
  "minimum_chrome_version": "116",
  "icons": { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" },
  "action": { "default_title": "__MSG_action_title_idle__", "default_icon": { "16": "icons/icon-16.png", "32": "icons/icon-32.png" } },
  "background": { "service_worker": "sw.js", "type": "module" },
  "options_ui": { "page": "options.html", "open_in_tab": true },
  "content_scripts": [{
    "matches": ["https://www.pixiv.net/*"],
    "js": ["content.js"],
    "run_at": "document_end",
    "all_frames": false
  }],
  "permissions": ["downloads", "storage", "offscreen", "declarativeNetRequestWithHostAccess", "downloads.ui"],
  "host_permissions": ["https://www.pixiv.net/*", "https://i.pximg.net/*"]
}
```

There is no `default_popup`, so `chrome.action.onClicked` fires (PRD §4.8). There are no `web_accessible_resources` (icons are inline SVG in the content script), no `declarative_net_request.rule_resources` (the rule needs `chrome.runtime.id` at runtime, §8.2), and no `content_security_policy` override (MV3 default).

The content script matches all of `www.pixiv.net/*`, not only `/artworks/*`. pixiv is an SPA, so a user who lands on the home page and clicks into an artwork never triggers a new content-script injection (PRD §4.2).

### Permission justifications (Web Store dashboard text)

| Permission | Used for | Justification |
|---|---|---|
| `downloads` | `chrome.downloads.download/search/cancel`, `onChanged` (`search` also answers the folder choice, D15: whether this artwork's files are already in the target folder) | Saves the artwork's files into the user's Downloads folder (the single purpose). |
| `storage` | `storage.sync/local` (3 settings), `storage.session` (in-flight jobs) | Remembers the three settings. Keeps running downloads alive across service-worker restarts. Nothing persists after Chrome quits. |
| `offscreen` | One offscreen document | WebCodecs and `URL.createObjectURL` are not available in service workers. The offscreen document encodes ugoira videos and hands downloaded bytes to Chrome's downloader. |
| `declarativeNetRequestWithHostAccess` | One session rule that sets `Referer: https://www.pixiv.net/` | pixiv's image host returns 403 without this Referer. The rule matches only the extension's own requests to `i.pximg.net`, never browsing traffic. |
| `downloads.ui` (R-005) | `chrome.downloads.setUiOptions` | Hides Chrome's per-file download animation while a multi-page artwork saves, then restores it. (PRD index text, verbatim.) |
| host `https://www.pixiv.net/*` | Content script; artwork API | Shows the button on artwork pages and reads the artwork's page list. |
| host `https://i.pximg.net/*` | Fetch originals and frame zips; DNR header modification | Downloads the original-size images. |

`downloads.ui` adds no install warning: Chromium's permission-message rules (`chrome/common/extensions/permissions/chrome_permission_message_rules.cc`) map `kDownloads` to "Manage your downloads" and have no rule for `kDownloadsUi`. The install prompt is unchanged, and an update that adds the permission does not disable the extension for re-approval (PRD index: same warning class, no new install warning).

Explicitly **not** requested (PRD index): `tabs`, `cookies`, `<all_urls>`, `webRequest`, `history`, `scripting`. The design never needs them:
- `sender.tab.id` and `tabs.sendMessage/create/update` work without `tabs`.
- Finding an open options tab uses `runtime.getContexts`, not `tabs.query({url})`.

A unit test (`test/unit/manifest.test.ts`) asserts the permission list equals exactly `["downloads", "storage", "offscreen", "declarativeNetRequestWithHostAccess", "downloads.ui"]` (this order, the PRD index's) and the host list exactly the two hosts, and that the whole manifest equals the block above. That guards against permission creep. Its iteration-2 case "requests exactly the four approved permissions" and its whole-manifest literal are stale since R-005; they change in the same commit as `src/manifest.json`.

### `minimum_chrome_version: "116"`

| API | First Chrome |
|---|---|
| `chrome.offscreen` | 109 |
| Offscreen messages reset SW idle timer | 109 |
| `chrome.action.setBadgeTextColor` | 110 |
| `chrome.storage.session` (10 MB quota) | 102 (quota raised in 112) |
| DNR `initiatorDomains` / `requestDomains` | 101 |
| Navigation API (`navigation.oncurrententrychange`) | 102 |
| WebCodecs `VideoEncoder` | 94 |
| `chrome.downloads.setUiOptions` (`downloads.ui`) | 105 |
| **`chrome.runtime.getContexts`** | **116** (binding constraint) |

The esbuild `target` is `chrome116`. Code must not call web APIs newer than 116 without a feature check. (mediabunny's quantizer rate control falls back to bitrate on older encoders, so it is not a hard requirement.)

---

## 6. Shared data model

The canonical TypeScript definitions live in `src/shared/types.ts`. Component chapters extend them; they never redefine them.

```mermaid
classDiagram
  class Settings {
    folderPattern: string
    ugoiraOutput: "mp4"|"webm"|"zip"
    saveMetadata: boolean
  }
  class SettingsSnapshot {
    folderPattern
    ugoiraOutput
    saveMetadata
    effectiveFormat: "mp4"|"webm"|"zip"|null
  }
  class WorkInfo {
    id: string
    illustType: 0|1|2
    xRestrict: 0|1|2
    withheld: boolean
    pageCount: number
    width: number
    height: number
    userName, userId, title
  }
  class JobRecord {
    jobId, artworkId, originTabId
    mode, kind, phase
    folder: string|null
    files: FileTask[]
    answered: true|absent
  }
  class FileTask {
    role: metadata|page|zip|framesJson|video
    name, url, state
    taskId, blobUrl, downloadId
    failure: Failure|null
  }
  class JobView {
    jobId, artworkId, kind, status
    progress, format, folder
    outcome: JobOutcome|null
  }
  Settings <|-- SettingsSnapshot
  JobRecord "1" *-- "many" FileTask
  JobRecord --> SettingsSnapshot : snapshot at click
  JobRecord ..> JobView : projected for the tab
```

```ts
// src/shared/types.ts (normative sketch)
export type UgoiraOutput = 'mp4' | 'webm' | 'zip';
export interface Settings { folderPattern: string; ugoiraOutput: UgoiraOutput; saveMetadata: boolean; }
export interface SettingsSnapshot extends Settings { effectiveFormat: UgoiraOutput | null; } // null for non-ugoira

export interface WorkInfo {            // parsed from GET /ajax/illust/{id} → body
  id: string;                          // body.illustId ?? body.id
  illustType: 0 | 1 | 2;
  xRestrict: 0 | 1 | 2;
  withheld: boolean;                   // pixiv withholds the images from this viewer: body.urls.original === null (§8.5, R-003)
  pageCount: number;
  width: number; height: number;       // page-0 / ugoira frame size
  userName: string | null; userId: string | null; title: string | null;
}

export type FailureKind =
  | 'http'        // status set; never 2xx
  | 'pixivError'  // 2xx/4xx JSON with { error: true }
  | 'network'     // fetch TypeError (DNS, reset, offline)
  | 'timeout'     // 30 s inactivity (§9)
  | 'disk'        // chrome.downloads interrupt FILE_* or "Invalid filename"
  | 'dismissed'   // interrupt USER_CANCELED (Save As dialog dismissed) — never retried
  | 'encode'      // zip parse / decode / encoder / muxer error
  | 'internal'    // the extension's own plumbing failed: an offscreen command refused or undeliverable, an off/ready
                  // without a blob URL, an exception at an offscreen task boundary, or no context answered an API call
  | 'aborted';    // our own cancel
export interface Failure {
  kind: FailureKind;
  status?: number;      // kind 'http' (and pixivError when known): the status of the final attempt
  answered?: true;      // kind 'network' | 'timeout' only: some attempt of this request got an HTTP response before it finally failed (§9)
  detail?: string;
  attempts: number;     // fetches: attempts made (1..4); encode: encoder passes (1, or 2 after the prefer-software retry)
}

export type JobMode = 'full' | 'retryPages' | 'retryEncode' | 'retryMetadata';
export type ErrorCause = 'offline' | 'refused' | 'server' | 'disk';
export type JobOutcome =
  | { type: 'saved'; folder: string; pages?: number; format?: UgoiraOutput }
  | { type: 'partial'; folder: string; total: number; saved: number; failedPages: number[];
      metadataFailed?: true }      // metadata.json was queued and did not land; the Retry writes it again (§10 row 6, R-007)
  | { type: 'metadataOnly'; folder: string; total: number }
  | { type: 'encodeFailed'; folder: string; format: 'mp4' | 'webm' }
  | { type: 'error'; cause: ErrorCause }
  | { type: 'needsLogin' }
  | { type: 'unavailable' }
  | { type: 'cancelled' };

export type JobProgress =
  | { kind: 'pages'; done: number; total: number }                 // done includes retry offset
  | { kind: 'percent'; percent: number; phase: 'frames' | 'encode'; indeterminate: boolean };

// Job model and protocol (src/shared/job.ts; fields in design-download-engine.md "Data Model"):
// FileRole, FileState, FileTask, UgoiraState, JobRecord, StartRequest, ErrorCode.
// JobRecord.answered?: true — pixiv answered at least one request of this job (§10 row 8, D13).

export interface JobView {               // pushed SW → tab; full snapshot, idempotent
  jobId: string; artworkId: string;
  kind: 'pages' | 'ugoira' | 'unknown';  // unknown while resolving
  status: 'running' | 'ended';
  progress: JobProgress | null;          // null while resolving
  format: UgoiraOutput | null;
  folder: string | null;
  outcome: JobOutcome | null;            // non-null iff status === 'ended'
}
```

### Storage inventory (complete; nothing else may be stored)

| Area | Key | Value | Written by | Lifetime |
|---|---|---|---|---|
| `storage.sync` | `settings` | `{ v: 1, folderPattern, ugoiraOutput, saveMetadata, updatedAt }` | options page | until changed |
| `storage.local` | `settings` | mirror of the above (fallback; newest-wins read, see [design-settings-model.md](design-settings-model.md)) | options page | until changed |
| `storage.session` | `job:<jobId>` | `JobRecord` | SW | until the job ends, then removed; gone when Chrome quits |
| `storage.session` | `caps:<w>x<h>` | `{ avc: string \| null, vp9: boolean }` (avc = chosen codec string) | SW | browser session |

**No history** (PRD §4.1 #1): a job's record is deleted in the same mutation that marks it ended. "Saved"/"Error" memory lives only in the content script's per-document map. The folder choice (D15) reads **Chrome's own** download history through `chrome.downloads.search` and stores nothing: the inventory above is unchanged by it.

---

## 7. Message protocol conventions

The full catalog lives in `src/shared/messages.ts`. Each chapter documents the messages its context handles.

| Rule | Detail |
|---|---|
| Envelope | `{ target: 'sw' \| 'offscreen' \| 'tab'; type: string; …payload }`. Every listener ignores messages whose `target` is not its own and **returns `undefined`**, so it never holds the channel open. `runtime.sendMessage` from a content script also reaches the offscreen document, which is why routing by `target` is mandatory. |
| Transport | content → SW: `chrome.runtime.sendMessage`. SW → tab: `chrome.tabs.sendMessage(tabId, msg, { frameId: 0 })`. SW ↔ offscreen: `chrome.runtime.sendMessage` both ways. No long-lived ports: they would keep the SW alive and complicate restarts. |
| Request/response | The listener returns `true` and calls `sendResponse` once. Responses are `{ ok: true, … } \| { ok: false, error: ErrorCode }`. Promise-returning listeners are not used, because their support postdates Chrome 116. |
| Push messages | `job/update` carries a **full `JobView`**, never a delta. A lost or duplicated message is harmless, and any receiver can render from one message. |
| Validation | Every handler validates the payload with a hand-written guard in `messages.ts`: artwork IDs `/^\d{1,12}$/`, folders via `isSafeRelativeFolder()`, URLs via host allowlist. Invalid → `{ ok: false, error: 'BAD_REQUEST' }` and a `warn` log. |
| Sender checks | The SW accepts content-script types only when `sender.tab?.id` is set and `sender.id === chrome.runtime.id`. It accepts offscreen event types only when `sender.url === chrome.runtime.getURL('offscreen.html')`. The offscreen document accepts only messages with no `sender.tab`. |
| Serialization | Messages are JSON-serialized. No `ArrayBuffer`/`Blob` crosses a message, and bytes travel as `blob:` URLs created in the offscreen document. |
| Versioning | Not needed: all contexts ship in one package and update atomically. |

---

## 8. Network strategy

### 8.1 Decision

| Request | Made from | Credentials | Referer |
|---|---|---|---|
| `GET /ajax/illust/{id}` at render (button hint, needs-login incl. pixiv's login walls §8.5, unavailable) | Content script | First-party cookies (same-origin) | Browser default (page URL) |
| Job API calls: `/ajax/illust/{id}`, `/pages`, `/ugoira_meta` | **Originating tab's content script**, proxied by the SW (`api/fetchJson`). **Fallback:** offscreen document when the tab is unreachable. | First-party via tab; `credentials: 'include'` in fallback | Browser default |
| Originals and frame zip on `i.pximg.net` | **Offscreen document** `fetch()` | `credentials: 'omit'` | `https://www.pixiv.net/`, set by the DNR session rule (§8.2) |
| File writes | SW `chrome.downloads.download({ url: blobUrl, filename, conflictAction: 'uniquify', saveAs: false })` | — | — |
| Folder choice: is this artwork already in the folder? (PRD §4.3) | SW `chrome.downloads.search({ filenameRegex, state: 'complete', limit: 0 })`, once; a second time 250 ms later when the first found records, to read Chrome's asynchronous file-existence re-check (D15, [design-download-engine.md](design-download-engine.md) "Folder choice") | — | — |

### 8.2 Referer via declarativeNetRequest (session rule)

`chrome.downloads.download` cannot set `Referer` (PRD §4.2). Fetch from an extension page cannot set a cross-origin `referrer`. The offscreen document's fetches therefore get the header from a DNR rule. Chrome documents that DNR applies to `fetch()` issued by extension contexts that reach the network stack.

```ts
// src/background/dnr.ts — run at every SW start (idempotent), awaited by the SW `ready` promise
const REFERER_RULE_ID = 1;
await chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [REFERER_RULE_ID],
  addRules: [{
    id: REFERER_RULE_ID,
    priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://www.pixiv.net/' }] },
    condition: {
      requestDomains: ['i.pximg.net'],
      initiatorDomains: [chrome.runtime.id],   // only this extension's own requests
      tabIds: [-1],                            // TAB_ID_NONE: never a tab's (browsing) request
      resourceTypes: ['xmlhttprequest'],       // fetch() from the offscreen document
    },
  }],
});
```

- **Session rule**, not static: `initiatorDomains` needs `chrome.runtime.id`, which a static ruleset cannot know for both unpacked and store builds. `tabIds` is session-only. Session rules survive SW restarts and vanish on browser quit, the same lifetime as jobs.
- **Both scoping conditions** keep the PRD privacy promise ("set only on the extension's own requests to `i.pximg.net`, never on the user's browsing traffic").
- **Verified live (ENG-002, 2026-10-22, Chromium 156.0.8078.4, `scripts/spike/FINDINGS.md` §1–2; re-verified in the iteration-1 code review).** The rule exactly as written above is the shipped rule; the `tabIds`-only fallback is not needed and is not implemented.
  - With the rule, an offscreen `fetch(original, { credentials: 'omit', cache: 'no-store' })` got 200 and the full body; without it, 403. `onRuleMatchedDebug` reported `initiator=chrome-extension://<id>`, `tabId=-1`, `type=xmlhttprequest`, so `initiatorDomains: [chrome.runtime.id]` matches offscreen-document fetches.
  - While the rule was installed, a tab navigating to the same original got 403 (navigation untouched), and a `www.pixiv.net` tab's own `fetch` to `i.pximg.net` produced 0 rule matches. The privacy promise holds.
  - The blob hand-off was verified in the same run: an offscreen `URL.createObjectURL` URL passed to `chrome.downloads.download` from the SW saved the exact bytes, and `uniquify` produced `x.jpg` / `x (1).jpg`. The offscreen document must stay open until Chrome has read the blob, which the close policy guarantees ([design-offscreen-worker.md](design-offscreen-worker.md)).

### 8.3 Why API calls go through the tab

Chrome documents that an extension's requests to a host it has permission for are treated as same-site **"does not apply if third-party cookies are blocked"** (developer.chrome.com, Storage and cookies). A user who blocks third-party cookies would send no `PHPSESSID` on SW/offscreen fetches. `/pages` and `/ugoira_meta` for R-18 works would then be refused, and the button would show "pixiv refused this work" for a user who is logged in. P1 (Aoi) is exactly the logged-in R-18 user.

The originating tab's content script fetches same-origin. It carries first-party cookies under every cookie setting, and sends the same `Origin`/`Sec-Fetch-Site` as pixiv's own frontend. The SW therefore asks that tab first (`api/fetchJson`). It falls back to the offscreen document only if the tab is gone or no longer has the content script (closed, or navigated off pixiv). This keeps the job tab-independent (the fallback always exists) while being correct in the common case. The fallback path's failure mode, 3P cookies blocked and tab closed during the sub-second API phase on an R-18 work, is accepted.

Verified live by ENG-002 (`scripts/spike/FINDINGS.md` §3): a content-script `fetch('/ajax/illust/<id>')` went out with `sec-fetch-site: same-origin` and pixiv's `PHPSESSID` cookie, and the offscreen fallback with `credentials: 'include'` also answered with Chrome's default cookie settings. The blocked-third-party-cookie case with a logged-in R-18 work needs an account and remains unexercised (L5). The same run confirmed that pixiv redirects `/artworks/<id>` to `/en/artworks/<id>` for an English browser, so every URL match in code and tests must allow the locale prefix.

### 8.4 Alternatives considered (bytes path)

| Criterion | A: `downloads.download(i.pximg.net URL)` + DNR | **B: offscreen `fetch` + DNR → `blob:` → `downloads.download`** | C: content-script fetch + blob (PPD's approach) | D: SW fetch → `data:` URL |
|---|---|---|---|---|
| Referer satisfiable | Only if DNR matches download-manager requests (undocumented) | Yes (DNR on extension fetch, documented) | Yes, but DNR must touch tab traffic | Yes (same as B) |
| PRD retry parity: status codes 429/5xx vs 403, `Retry-After`, 30 s timeout | No. Only coarse interrupt reasons (`SERVER_FAILED`), no headers, no timeout. | **Exact** | Exact | Exact, but a >30 s response kills the SW |
| AC "retries observable in the extension's network log" | No | **Yes** (offscreen DevTools) | Page DevTools | Yes |
| Retries pollute `chrome://downloads` | Yes. Each failed attempt is a "Failed" entry, and retries may get `(1)` names. | **No.** Only final bytes are handed over. | No | No |
| Tab independence | Yes | **Yes** | **No** (dies with the tab) | Yes |
| Memory | None in extension | ≤ 5 files per job buffered as Blobs | Same as B, in the page | base64 strings, +33%, URL limit 2 MB |
| Chrome's bubble (hidden while a job runs under every option, R-005) | Would show per-file progress if visible | Lists each file once it is complete | Same as B | Same as B |
| Extra permissions | None | None | None | None |
| **Verdict** | Rejected: cannot meet §4.5.2 | **Selected** | Rejected: violates tab independence | Rejected: SW lifetime, size limits |

**What Chrome's own UI shows under D1 (PRD text since R-004 S6, R-005 and R-006).** Chrome's download UI is hidden from a job's first hand-off until just before the last file of the last running job is handed to Chrome. That file's own download brings the downloads button back (PRD §4.1 #3, R-006, D12). A file reaches Chrome's downloader only once its bytes are complete, so when the button returns, the bubble and `chrome://downloads` list each completed file once, and `chrome://downloads` lists them throughout. A cancelled job leaves no "Canceled" entries for files still being fetched, because those are offscreen fetches, not Chrome downloads (PRD CUJ-1 step 5).

### 8.5 pixiv's login walls: the needs-login signal (R-003)

R-003 (owner ruling, 2026-10-23) and PRD CUJ-5 Part A require `Log in to download` whenever the page is logged out and pixiv withholds the work behind a login requirement: an R-18 work, an R-18G work, or an all-ages work behind pixiv's wall `This work may contain sensitive content. Please log in to view this work.` The extension must know before any click.

**Decision (D10).** A work is withheld from the viewer when the first-party `GET /ajax/illust/{id}` body has **no image URLs**: `body.urls.original === null`. The extension requires login when the page is logged out and the work is R-18/R-18G or withheld:

```ts
// src/shared/pixiv-api.ts — parseIllust sets WorkInfo.withheld
function isWithheld(body: Record<string, unknown>): boolean {
  const urls = body.urls;
  if (isRecord(urls) && 'original' in urls) {
    if (urls.original === null) return true;               // pixiv's own per-viewer decision (primary signal)
    if (typeof urls.original === 'string') return false;
  }
  const sl = toInt(body.sl);                                // shape drift only: pixiv's sanity level
  return sl !== null && sl >= WITHHELD_MIN_SANITY_LEVEL;    // = 4, in constants.ts
}

export function requiresLogin(work: WorkInfo, loggedIn: boolean | null): boolean {
  return loggedIn === false && (work.xRestrict >= 1 || work.withheld);
}
```

- **Why `urls.original === null`.** It is pixiv's own decision, per viewer, not a reconstruction of pixiv's policy. pixiv's artwork page renders the wall precisely because its own client receives no image URLs, so the signal moves with pixiv: if pixiv lowers or raises the threshold, or adds another reason to hide a work from logged-out visitors, the signal follows without a code change. It costs nothing: the content script already fetches this body at render time for the page-count hint (§8.1), so the decision is available at the same moment as `xRestrict` today, before any click.
- **Why the `sl` fallback exists, and why it is only a fallback.** On every work sampled, `sl ≥ 4` coincided exactly with `urls.original === null` (evidence below). It is used only when the `urls` shape is missing or unrecognized (a pixiv API change), so a shape drift degrades to the threshold pixiv uses today instead of silently downloading walled works. It is never combined with a present `urls` value, because a threshold is a guess about pixiv's policy and would show `Log in to download` on works pixiv chose to show (violating the CUJ-5 AC "all-ages work that pixiv shows without a login wall → normal idle").
- **Why `xRestrict ≥ 1` stays in the predicate.** It is the PRD's stated trigger (CUJ-5 AC 1) and is redundant only today (logged-out R-18 bodies also have null URLs). Keeping it means an R-18 work never depends on the `urls` shape.
- **Why `loggedIn === false` gates it.** A logged-in page never shows needs-login (PRD CUJ-5 step 3 and AC 2: after logging in the page shows `Download · NP`). A logged-in viewer whom pixiv still refuses (R-18 display off) is the reactive `refused` case (§10 row 3), decided by pixiv's answer to `/pages` or `ugoira_meta`. `null` (marker not found) never produces needs-login, as before.

**Where it is enforced.**

```mermaid
flowchart TD
  A["GET /ajax/illust/{id} (first-party)"] --> B{"page loggedIn === false?<br/>(read once per document)"}
  B -- "true / null" --> I["no needs-login<br/>(pixiv's answers decide: refused, unavailable, …)"]
  B -- "false" --> C{"xRestrict ≥ 1?"}
  C -- yes --> L["needs login"]
  C -- no --> D{"body.urls has 'original'?"}
  D -- "null" --> L
  D -- "string" --> N["show / download normally"]
  D -- "missing or unrecognized (shape drift)" --> E{"sl ≥ 4?"}
  E -- yes --> L
  E -- no --> N
```

| Moment | Where | Effect |
|---|---|---|
| Render time | Content script, on the `/ajax/illust` result (design-artwork-button.md "Render-time metadata") | `pending → needsLogin`, before any click (CUJ-5 step 1) |
| Click before the metadata arrived (`pending` click), or after the render fetch failed | SW resolver, `full` mode, right after its own `/ajax/illust` call; the content script sends its `loggedIn` in `job/start` (design-download-engine.md "Resolving") | The job ends `needsLogin` before `/pages` or `ugoira_meta` is called and before any byte is fetched (§10 row 4) |

Without the second row, a logged-out user who clicks within the metadata latency window would download a walled work, because `/pages` and `ugoira_meta` serve walled all-ages works to logged-out sessions (evidence below). Retry modes (`retryPages`, `retryEncode`, `retryMetadata`) are not re-checked: they only exist after a `full` job of the same document passed the check.

**Evidence (live probe, 2026-10-23, logged out, no cookies; `curl` with a desktop Chrome UA, and headless Chromium 156.0.8078.4 for page renders and a page-context first-party `fetch`).**

| Work | `xRestrict` | `sl` | `/ajax/illust` `body.urls.original` | `/pages` or `ugoira_meta` (logged out) | What pixiv's page shows logged out |
|---|---|---|---|---|---|
| 151107515 (illust, 4 p; QA's walled example) | 0 | 4 | `null` (all five `urls` keys null) | 200, 4 originals | `This work may contain sensitive content.` … `Please log in to view this work.` |
| 151122454 (ugoira) | 0 | 4 | `null` | 200, `originalSrc` | same wall |
| 151134548 (illust) | 0 | 6 | `null` | 200, originals | same wall |
| 151121303 (ugoira) | 0 | 6 | `null` | 200, `originalSrc` | same wall |
| 151107522 (R-18) | 1 | 6 | `null` | `{"error":true}` (404) | `R-18 works cannot be displayed` |
| 151061734 (illust, 3 p; ENG-002's work) | 0 | 2 | `https://i.pximg.net/img-original/…_p0.jpg` | 200 | the image |
| 151105084 (ugoira) | 0 | 2 | URL | 200 | the ugoira canvas |

- **Population check.** All 150 works of that day's logged-out daily rankings (`ranking.php?mode=daily&content=illust|manga|ugoira&format=json`) were fetched: 119 with `sl` 2 had URLs (and `is_masked: false` in the ranking); 21 with `sl` 4 and 10 with `sl` 6 (all `xRestrict` 0) had `urls.original === null` (and `is_masked: true`). No exception in either direction.
- **First-party equivalence.** A `fetch('/ajax/illust/<id>')` from a logged-out `www.pixiv.net` page context (anonymous pixiv cookies, exactly what the content script sends) returned the same `urls.original` / `sl` / `xRestrict` values as the cookieless `curl` for 151107515, 151122454, 151134548, 151107522 and 151061734.
- **The hole R-003 closes.** For walled all-ages works, `/pages` and `ugoira_meta` answer normally while logged out and `i.pximg.net` needs only the Referer, so nothing downstream refuses: the decision must be made from the illust body.
- Reduced copies of the 151107515 and 151061734 bodies become unit fixtures (`test/fixtures/api/illust-walled.json`, `illust-visible.json`), so the parser is pinned against the real shape.

**Signals considered.**

| Criterion | **`urls.original === null` (+ `sl` fallback)** | `sl ≥ 4` alone | DOM marker (wall text / no `img` in the artwork figure) | `/pages` refusing | Page HTML (`__NEXT_DATA__`, `<meta name="robots" content="noindex">`, OGP `decorate.php`) |
|---|---|---|---|---|---|
| Available before any click | Yes (render-time fetch already made) | Yes | Only after pixiv hydrates the column; timing varies | No (only during a job) | Full loads only; absent on SPA navigation |
| Follows pixiv's policy changes | Yes (pixiv's per-viewer output) | No (hard-coded threshold) | Yes | — | Partly |
| Locale-independent | Yes | Yes | No (wall text is localized) | — | Yes |
| Correct on the evidence | 150/150 + 7 rendered | 150/150 today | Yes, but `pixiv-dom.ts` fragility | **No**: walled all-ages works get 200 | `__NEXT_DATA__` carries no work data (`ssr: false`, preloaded `illust` empty); `noindex` also marks R-18 and is not specific |
| **Verdict** | **Selected** | Fallback only, for a missing `urls` shape | Rejected | Rejected | Rejected |

**What the signal misses (accepted, each named in design-artwork-button.md "Open Questions").**
1. **Login state unknown** (`readIsLoggedIn` → `null`, i.e. pixiv dropped both login markers): no needs-login; a walled all-ages work downloads on click. This only happens after a pixiv redesign that the `warn`-level logs and the live smoke would surface.
2. **Stale logged-in page** (the user logged out in another tab after this page loaded): the page still says logged in, so neither check applies. R-18 works are refused by pixiv at `/pages`; a walled all-ages work downloads, because pixiv itself serves `/pages` to that session. Both are PRD text now (CUJ-5 edge "Logged out in another tab after this page loaded", R-004 S12a). Closing it would mean treating `urls.original === null` as a refusal for a page that claims to be logged in; the PRD defers that until the release checklist's logged-in stale-page probe confirms that pixiv never nulls the URLs of a work a logged-in viewer can see, because otherwise P1 (always logged in) could be refused works she can view (L5 logged-in checks).
3. **Logged-in viewers who hide sensitive works in pixiv's settings**: out of scope; a logged-in page never shows needs-login, and pixiv's answers decide the outcome.
4. **Signal drift** (pixiv starts sending URLs for walled works and blurs client-side): the extension would show idle on a walled work. Detected by the L4 live smoke, which asserts `Log in to download` on a ranking work with `xRestrict` 0 and `urls.original === null` ([design-test-harness.md](design-test-harness.md) L4), run before every release.

---

## 9. Retry policy (shared, `src/shared/retry.ts`)

This implements PRD §4.5.2 with parity to `Fetcher.__call__` in `ref/pixiv-dl`. It is used by the content script (render fetch, API proxy) and the offscreen document (bytes, fallback API).

```ts
export interface RetryOptions {
  signal?: AbortSignal;                 // cancel → Failure{kind:'aborted'}
  onProgress?: (loaded: number, total: number | null) => void;   // body bytes
  init?: RequestInit;                   // credentials etc.
  responseType: 'json' | 'bytes' | 'rawBytes';   // json → parsed object; bytes → Blob (originals);
                                        // rawBytes → Uint8Array, preallocated from Content-Length (the ugoira zip, held once)
  random?: () => number;                // injectable for tests
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
export type RetryResult<T> = { ok: true; value: T; status: number; attempts: number } | { ok: false; failure: Failure };
export function fetchWithRetry<T>(url: string, opts: RetryOptions): Promise<RetryResult<T>>;
```

| Aspect | Rule |
|---|---|
| Attempts | `MAX_ATTEMPTS = 4` per request (1 + 3 retries) |
| Retried | HTTP 429, 500, 502, 503, 504; `network`; `timeout` |
| Never retried | 403 and every other non-2xx; `pixivError` bodies; `aborted` |
| Delay before retry *n* (n = 0,1,2) | `Retry-After` if the failed response has one that parses as a positive number of seconds → `min(value, 30)` s. Otherwise `1.5 × 2ⁿ + U(0, 0.5)` s. **Parity detail:** the script's `_retry_after(e) or _backoff(...)` treats `Retry-After: 0` as falsy, so `0`, negative, or HTTP-date values fall through to the backoff. |
| No sleep after the last attempt | as in the script |
| Final failure after an answer (`answered`) | When the request finally fails with `network` or `timeout` and **any attempt of it received an HTTP response** (status line and headers: an earlier 429/5xx, or this attempt failed while reading the body: a short or long body, a reset or a stall mid-body), the returned `Failure` keeps its `kind` and adds `answered: true`. A `fetch()` that rejects before any response (DNS, a refused or reset connection, offline, Chromium's local "Request throttled" refusal) answers nothing. `http` and `pixivError` failures are answered by definition and do not carry the flag. The job-level rule of §10 row 8 reads it. It replaces iteration 2's `lastStatus` (the status of an earlier 429/5xx on the same request), which could not see a click whose every byte request Chromium refused locally: QA iteration 2 saw 1 of 7 Retries during a sustained 503 read "No connection" (R-004 S3, D13). |
| Timeout | **30 s inactivity**, matching `urlopen(timeout=30)` socket semantics. Response headers must arrive within 30 s, and then every body chunk within 30 s of the previous one. A slow but progressing download of a large original is never cut off. Implemented with an `AbortController` re-armed per chunk. |
| Body | Streamed via `response.body.getReader()`; chunks collected into an array, then `new Blob(chunks, { type })`. The stream yields byte progress (ugoira zip, PRD §4.7.5) and the stall timer. |
| Session refresh | **Not ported.** The script re-reads the cookie once on 403. The extension never reads cookies (PRD index "Privacy"), so 403 fails immediately (PRD §4.5.2). |
| Logging | Each attempt logs `debug` with URL host+path, status and delay (never headers or cookies). |
| Test time scale | All delays and the stall timeout are multiplied by the compile-time constant `__RETRY_TIME_SCALE__`. It is `1` in every shipped build (`build`, `build:prod`); only `build:e2e` sets `0.01`, and `scripts/build.mjs` refuses it elsewhere ([design-test-harness.md](design-test-harness.md)). |

---

## 10. Error model & outcome classification

Low-level failures are `Failure` values (§6). They are classified into exactly one `JobOutcome` by the pure function `classifyOutcome(job, navigatorOnLine)` in `src/shared/outcome.ts`. The precedence below is applied top to bottom, and the first match wins:

| # | Condition | Outcome | Button (PRD) |
|---|---|---|---|
| 1 | Job cancelled by the user | `cancelled` | idle, no styling (CUJ-1 step 5, CUJ-5 step 10) |
| 2 | `/ajax/illust/{id}` → HTTP 404 or `pixivError`; or `/pages`/`ugoira_meta` → 404 | `unavailable` | Unavailable (CUJ-5 step 7) |
| 3 | Any API call (`/ajax/illust`, `/pages`, `ugoira_meta`) → 401/403 or `pixivError` | `error: refused` | `Retry`, tip_refused (CUJ-5 step 6) |
| 4 | Any `i.pximg.net` byte request (original or zip) → 403; **or** the `full`-mode resolver found the work requires login for a logged-out page (`requiresLogin`, §8.5). Both set `stopReason = 'forbidden'`. | `needsLogin` (the job stops dispatching new files at the first 403; a resolver hit stops before any byte request) | Log in to download (CUJ-5 step 9; Part A for a click made before the render-time metadata arrived, R-003) |
| 5 | Ugoira: zip + `frames.json` saved, encode failed | `encodeFailed` | `Retry · MP4/WebM`, tip_encode_failed (CUJ-5 step 8) |
| 6 | Pages job: ≥ 1 page saved and ≥ 1 page failed | `partial`, with `metadataFailed: true` when the run queued `metadata.json` and it did not land (absent otherwise; R-007 item 6) | `Retry · N failed` (CUJ-5 step 4; the flag is never shown) |
| 7 | Pages job: every page saved, `metadata.json` failed | `metadataOnly` | `Retry`, tip_metadata_only |
| 8 | Nothing saved (0 pages or ugoira zip not saved). Cause from the job's failures (API failure + failed files), first match wins (PRD CUJ-5 step 6, R-004 S3): (a) at least one failure and all are `disk`/`dismissed` → `disk`; (b) `navigator.onLine === false`, **or pixiv answered nothing in this click**: the job is not answered (below) and there is at least one failure and every failure is `network` → `offline`; (c) otherwise → `server`: pixiv answered at least one request of the job (any status, including the artwork API's 200), or a request timed out, or a failure is `internal`, an HTTP status or a `pixivError`. | `error: <cause>` | `Retry`, cause tooltip (CUJ-5 step 6) |
| 9 | Ugoira: zip saved, video encoded but its save failed (`disk`) | `error: disk` | `Retry`, tip_disk |
| 10 | Everything required landed | `saved` | Saved (CUJ-1 step 6, CUJ-2 step 5) |

Rows 4, 8 and 9 were derived in iterations 1–2 and are PRD text since R-004: a zip 403 → needs login (CUJ-5 step 9); `dismissed` with `disk`, and a failed ugoira video or `metadata.json` save → `tip_disk` with a full retry (step 6 table, edge cases; S10); `internal` failures and timeouts → `server` (S3, S10); the resolver's login-wall stop (Part A step 1, edge "Clicked before the metadata arrived"; S12).

**A Retry after a partial writes `metadata.json` again only if it did not land (R-007 item 6; PRD CUJ-5 step 5, edge "Pages and `metadata.json` both failed").** Row 6 comes before row 7, so a job whose pages and `metadata.json` both failed ends `partial`. Before R-007 its Retry fetched only the pages, so `Saved · 12P` could show over a folder without `metadata.json`. Now `Saved` after a Retry means every file of the job is on disk:
- Row 6 sets `metadataFailed: true` when the run queued `metadata.json` and it did not land. With metadata off, or with a landed `metadata.json`, the field is absent, and the Retry leaves `metadata.json` alone, so it is never written twice.
- The button keeps the flag on its `partial` error and sends `retryPages` with `withMetadata: true` (design-artwork-button.md "Click actions"). Label, tooltip and live text are unchanged, because `metadata.json` is not a page.
- The resolver then reads `/ajax/illust` before `/pages` and queues `metadata.json` ahead of the pages, built from that body as in `retryMetadata` (design-download-engine.md "Resolving"). A failure of the extra call classifies like any resolve failure (rows 2, 3, 8).
- The counter (`pagesOffset`) and the badge count pages only, so neither changes: the Retry still runs `9 / 12` → `11 / 12` with badge `3`.
- The Retry run is classified by the same table. Its pages landing without `metadata.json` gives row 7 (`metadataOnly`). A page failing again re-flags `metadata.json` only if it did not land in this run.
- The `job/start` and `JobOutcome` guards (`src/shared/messages.ts`) accept `withMetadata` and `metadataFailed` only as `true`.

**How "answered" is tracked (D13, R-004 S3).** The PRD judges "No connection" per click: only if no request of this click's job (to `www.pixiv.net` or `i.pximg.net`) got any HTTP response. Two persisted facts carry that, so the rule needs no time window and no memory outside the job:

```ts
// src/shared/outcome.ts
const gotAnswer = (f: Failure): boolean => f.kind === 'http' || f.kind === 'pixivError' || f.answered === true;

function errorCause(job: JobRecord, list: Failure[], navigatorOnLine: boolean): ErrorCause {
  if (list.length > 0 && list.every((f) => f.kind === 'disk' || f.kind === 'dismissed')) return 'disk';
  const answered = job.answered === true || list.some(gotAnswer);
  if (!navigatorOnLine || (!answered && list.length > 0 && list.every((f) => f.kind === 'network'))) return 'offline';
  return 'server';
}
```

- **`Failure.answered`** (request level, §9) is set by `fetchWithRetry` in whichever context made the request (content-script API proxy, offscreen bytes or fallback API), and travels in `api/fetchJson` results and `off/failed` events. It answers "did this failed request ever get a response".
- **`JobRecord.answered?: true`** (job level) records answers that leave no failure behind: a successful API call. `applyResolution` sets it in the same mutation that applies the resolution, when the resolution succeeded (every mode's plan needs at least one API 2xx), or failed after an earlier API call of this resolve answered, or failed on a call that itself answered (`Resolution.answered`, design-download-engine.md "Resolving"); the login-wall stop also sets it (its `/ajax/illust` answered). It is never cleared. Byte requests need no setter: a job that reaches `transferring` is already answered, and a failed byte request's own answer is on its `Failure`.
- **Survives a service-worker restart by construction**: the flag is part of the `JobRecord` that is written to `storage.session` before any effect runs (design-download-engine.md "Mutations"). A resolve that a restart interrupted runs again from its first API call (the resolver is idempotent) and recomputes `Resolution.answered`; an answer from the interrupted run is not carried over. That only matters if the re-run then gets no answer at all, and then the user's connection has just failed, so `offline` is the honest reading.
- **"This click" is this job.** The render-time `/ajax/illust` fetch is not part of any job and never counts. A Retry is a new job and starts unanswered.
- **Consequences, all PRD text.** During a sustained pixiv outage the job's API calls answer through the tab, so every click reads `server` whatever Chromium's throttling does to the image requests (CUJ-5 AC "including the 7th consecutive Retry"). With the network disconnected, the API calls fail unanswered and the click reads `offline` (AC "network disconnected"). Accepted cost (step 6 Details): if the API answers and then every image connection fails while `navigator.onLine` stays true, the click reads `server`. The e2e case that faulted only the originals with `reset` and expected `tip_offline` therefore now expects `tip_server` (design-test-harness.md).

**`internal` reads as `server`** (PRD CUJ-5 step 6: "The extension's own internal failures also land here", R-004 S3, S10). `internal` means the extension's own messaging failed (an offscreen command refused or undeliverable, an `off/ready` without a blob URL, an exception at an offscreen task boundary, or neither the tab nor the offscreen document answered an API call). Before iteration 2 these were recorded as `network`, so a job whose every file failed this way told the user "No connection" while the network was fine (code review W2). A `video` dispatch failure stays `encode` (row 5: the zip landed, so `Retry · MP4` is the right next action).

---

## 11. Cross-cutting concerns

### 11.1 Security
- **No dynamic HTML.** `innerHTML`/`insertAdjacentHTML` are allowed only with compile-time constant strings (the SVG icons in `icons.ts`). All user content (titles, artist names, folders in tooltips) goes through `textContent` or attributes. The ESLint `no-restricted-properties` rule bans `innerHTML` outside `icons.ts`.
- **URL allowlist.** Before any fetch, `pixiv-api.ts` asserts `https://www.pixiv.net/ajax/illust/<digits>(/pages|/ugoira_meta)?` for API calls and `https://i.pximg.net/` for bytes. An original URL from pixiv's API that fails the allowlist becomes a `refused` failure, never a fetch.
- **File names** come from `basename(new URL(url).pathname)` and must match `/^[0-9A-Za-z_.-]{1,128}$/`. Folders must pass `isSafeRelativeFolder()` ([design-settings-model.md](design-settings-model.md)) at resolution and again when a retry request echoes a folder back from the tab.
- **Cookies** are never read, stored or sent explicitly. The design relies on the browser's own same-origin cookie behavior (§8.3).
- **Remote code:** none. All code is bundled, and MV3's default CSP applies to extension pages.

### 11.2 Privacy
There is no analytics, telemetry, crash reporting or remote config. The only network destinations are `www.pixiv.net` and `i.pximg.net`, plus `accounts.pixiv.net` and `github.com` via user-initiated navigation. The storage inventory in §6 is exhaustive.

### 11.3 Observability
- `src/shared/log.ts`: `debug | info | warn | error`, prefixed `[hfp:<context>]`. `debug` is compiled out of `--prod` builds (`define: { __DEBUG__: false }`). `warn`/`error` always print, so they show on `chrome://extensions` → Errors, which is the only error channel a user can share in a GitHub issue (R-001).
- Logs never contain cookies, headers, or full URLs with query strings. Artwork IDs and file names are allowed (local only).
- Each job logs one `info` line at start (`jobId, artworkId, mode, kind`) and one at end (`outcome.type`, counts, duration ms).
- E2E tests capture SW and offscreen console output (Playwright `worker.on('console')`) and fail on any `error` log not explicitly expected.

### 11.4 Internationalization
- `src/_locales/{en,ja,zh_CN,zh_TW}/messages.json`. `en` is `default_locale`, so missing keys in other locales fall back to English at runtime.
- **Keys are the PRD Appendix A IDs verbatim**, plus `ext_name`, `ext_description` and `locale_tag` (`en` / `ja` / `zh-CN` / `zh-TW`). Since R-004 S9 Appendix A itself lists the singular `_one` variants (`action_title_one_single`, `aria_busy_pages_one`, `aria_saved_pages_one`, `live_start_one`, `live_saved_one`, `live_failed_one`, `tip_partial_one`) and the live-region keys the design had derived (`live_start_ugoira`, `live_progress_pages`, `live_progress_percent`, `live_saved_ugoira`), and confirms every "(derived)" English string as written; translations still need native review. The shipped `en/messages.json` matches Appendix A string for string (checked in iteration 3).
- **Resolved locale** = `chrome.i18n.getMessage('locale_tag')`. This returns the locale Chrome actually resolved after fallback (`zh_HK` → `en`), unlike `getUILanguage()`. It is used for the `lang` attribute (PRD index "CJK rendering") and for the per-locale width floor.
- **Placeholders** use `$1`…`$9` substitutions. Where part of a message needs different styling (monospace token in `err_unknown_token`, pattern in `opt_still_using`), `splitOnPlaceholder(key, n)` calls `getMessage` with the sentinel **U+FDD0** as every substitution, splits on it, and builds DOM nodes. No HTML ever enters `messages.json`. The sentinel was `\u0000` in the first design; Chrome's `getMessage` cuts a substitution at NUL, so the split never happened (fixed in `9481e00`). U+FDD0 is a Unicode noncharacter: it never occurs in translated text, survives `getMessage` unchanged, and is stripped from folder names anyway (design-settings-model.md step 3+). The test stub (`test/helpers/i18n-stub.ts`) cuts substitutions at NUL exactly as Chrome does, so a regression to a NUL sentinel fails unit tests.
- **Translations of `aria_login` (R-003).** PRD Appendix A changed `aria_login` to the neutral `Log in to pixiv to download this work.` and gives no ja/zh text. All four `messages.json` files must carry the neutral meaning, because the string is also announced for a mid-job 403 on an all-ages work (CUJ-5 step 9), where "R-18" was false. Draft translations, to be reviewed with the rest (Appendix A "Proposed translations"): ja `この作品をダウンロードするには、pixivにログインしてください。`, zh_CN `登录 pixiv 以下载此作品。`, zh_TW `登入 pixiv 以下載此作品。` They follow the existing translations of the old string with "R-18" removed and the English sentence's final period added.
- Numbers are ASCII digits everywhere (`String(n)`; never `toLocaleString`).
- A unit test asserts that all four `messages.json` files have identical key sets and identical placeholder counts per key. Missing translations fail CI instead of silently falling back. Translations are drafts until native review (PRD Appendix A).

### 11.5 Accessibility and theming
These are owned by the component chapters, which implement the PRD index "Accessibility" and "Theming" sections: [design-artwork-button.md](design-artwork-button.md) §A11y and [design-options-page.md](design-options-page.md) §A11y. Shared rules:
- Every interactive element is a native `<button>`/`<input>` (or `role="switch"` on a `<button>`), and `prefers-reduced-motion` disables all transitions and animations.
- **Contrast** (PRD index "Contrast", §4.7.3, §4.7.7, CUJ-3 steps 3, 5, 7 and 10; R-004 S2, R-007 item 4). Every text/background pair the extension introduces meets WCAG 2.1 AA 4.5:1 **at rest**, except pixiv blue `#0096FA` with white (about 3.1:1). The index accepts that pair for the button's idle and busy fill and its Saved text, for parity with pixiv's own primary buttons. The PRD now specifies the AA values the iteration-2 audit introduced (R-004 S2) and, since R-007 item 4, those of the options page's links and selected Ugoira segment, so design, PRD and mocks agree. The options page's non-text blues (switch, focus rings, header mark) and its chip hover stay `#0096FA` (design-options-page.md "Styles"). Ratios are WCAG relative-luminance ratios computed from the hex values:

| Where | Value (PRD) | Ratio |
|---|---|---|
| Options `Saved` (CUJ-3 step 3) | light `#188038` on `#f6f7f9`; dark `#1a9f5a` on `#121212` | 4.68; 5.49 |
| Button `Unavailable` text (§4.7.3, CUJ-5 step 7) | `#5f6368` on `#f1f3f4` | 5.44 |
| Options validation message (CUJ-3 step 5) | light `#c5221f` on `#f6f7f9`; dark `#f28b82` on `#121212`. The invalid field's 2 px border stays `#d93025` (a non-text UI component needs 3:1). | 5.41; 7.84 |
| Options "Still using" trailing sentence (CUJ-3 step 5) | light `#5c6166`; dark `#8a8f94` on `#121212` | 5.84; 5.74 |
| Options footer links (CUJ-3 step 10, dark-theme edge; R-007 item 4) | light `#0b6fc2` on `#f6f7f9`; dark `#0096FA` on `#121212` | 4.82; 6.02 |
| Options selected Ugoira segment (CUJ-3 step 7, dark-theme edge; R-007 item 4) | white semibold on `#0b6fc2`, both modes | 5.16 |

- **Hover-tint exemption** (PRD index, R-004 S2). A background tint shown only under the pointer, which never changes the label and whose meaning the accessible name already carries, may fall below 4.5:1. Two exist: the error hover (`#d93025` on `#fdeceb`, 4.18:1) and the Saved hover (`#0096FA` on `#e6f4fe`, 2.78:1). Nothing else may use the exemption: a new pair below 4.5:1 at rest, or a hover that changes the label, is a defect.

### 11.6 Performance budgets

| Budget (PRD NFR) | Design mechanism | Verified by |
|---|---|---|
| Button within 500 ms of the action row rendering | `MutationObserver` + rAF-coalesced placement check (≤ 1 frame after the row appears); render-time metadata fetched in parallel, not awaited | e2e timing assertion (fake pixiv renders the row after a delay) |
| Content script stays cheap on every pixiv page (engineering budget, not a PRD number) | `content.js` ≤ **40 KB minified** and ≤ **15 KB gzip**. Measured at iteration 1: 35.2 KB / 12.9 KB (code review, debug on), 34.4 KB / 12.6 KB with the prod defines; 35.2 KB / 13.0 KB at the end of iteration 2 (`npm run size`, after R-003's `requiresLogin` and the outage changes); 35.3 KB / 13.1 KB at the end of iteration 3 (the `answered` plumbing in `retry.ts`, the D14 timer and `UGOIRA_LOCALE_FLOOR_PX`). The budget replaces the first design's "< 30 KB", which was a guess made before any code existed; no single module dominates (labels 4.6 KB, retry 3.8, model 3.8, styles 3.2), so meeting 30 KB would mean cutting function, not waste. 40/15 leaves ~15 % headroom for v1 work. | `npm run size` in CI (ENG-010): esbuild-minifies `src/content/content.ts` with the prod defines and fails above either limit |
| Floating fallback within 3 s of the page loading or of the in-app navigation, measured to the pill on screen (PRD §4.7.1, CUJ-5 step 11; R-004 S4) | Timer from artwork-route entry (content-script start on a full load, the URL change on SPA navigation) fires at `FLOAT_FALLBACK_MS − FLOAT_PLACEMENT_BUDGET_MS` = 3000 − 250 = 2750 ms; the callback places the pill synchronously, so it paints at the next frame (D14, design-artwork-button.md "Mounting") | e2e from the PRD anchors (`domInteractive` on a direct load, the in-page click on SPA navigation) to the first animation frame after the host connects: ≤ 3000 ms; QA `diagFloat.ts`, 10 samples |
| Busy feedback ≤ 100 ms after click | Optimistic local `busy 0/N` before the SW round-trip | e2e (`performance.now` delta) |
| State change ≤ 300 ms | SW pushes `job/update` synchronously after the final mutation persists | e2e |
| Badge ≤ 1 s | Badge recomputed after every mutation (coalesced 50 ms); recomputed on SW start before anything else | SW integration test + e2e after CDP SW stop |
| Folder choice adds "at most a few hundred ms" inside resolving and changes nothing on screen (PRD §4.3) | A first run: one `downloads.search`, no wait. A repeat run: a 250 ms wait (`FOLDER_CHECK_RECHECK_WAIT_MS`) and a second search, started concurrently with the `/pages` or `ugoira_meta` call, so the net delay is `max(0, 250 ms − API round trip)` (D15) | unit (fake timers): no timer when the first search is empty; L2: a repeat job's resolve ends within 260 ms of the API answers; e2e: click → `0 / 12` within 100 ms unchanged on the second run |
| A second job never waits for the first beyond the offscreen document's load (CUJ-4 AC 5) | Concurrent starts share one `createDocument`; a command that finds no listener is resent every 25 ms for at most 1 s (`OFFSCREEN_READY_WAIT_MS`, D16) | L2 with creation held 1.5 s; QA's `twoTabsProbe.ts` at click gap 0, ≥ 8 runs per build |
| ≤ 5 files in flight per artwork | Scheduler cap counts `fetching ∪ ready ∪ saving` | unit + fake-server concurrency counter |
| Ugoira memory: one frame at a time | `unzipSync` filter per frame; `await source.add()` backpressure; frame closed after add | unit (mock), manual heap check |
| Encode progress ≥ 1/s | Offscreen progress events every 250 ms max, at least every 1 s while encoding | e2e (long-ugoira fixture) |

---

## 12. Build, test, release

| Command | Does |
|---|---|
| `npm run build` | dev build → `dist/` (unminified, sourcemaps inline, `__DEBUG__ = true`) |
| `npm run build:prod` | prod build → `dist/` (esbuild `minifySyntax` only, so dead `if (false)` test-hook branches are dropped (ENG-007) while whitespace and identifiers stay readable for review; no sourcemaps; `__DEBUG__ = false`) |
| `npm run watch` | rebuild on change. Reload the extension from `chrome://extensions`. |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` (zero errors required) |
| `npm run lint` | `eslint .` + `prettier --check .` |
| `npm test` | `vitest run` (unit + golden + SW integration with fakes) |
| `npm run build:e2e` | e2e build → `dist-e2e/` (`__RETRY_TIME_SCALE__ = 0.01`, `__TEST_HOOKS__ = true`) |
| `npm run test:e2e` | `build:e2e` + `playwright test` (fake-pixiv harness) |
| `npm run qa:fake` / `npm run qa:live` | headed Chromium with the extension against the fake pixiv / real pixiv, for the QA role |
| `npm run golden` | `python3 -I scripts/gen-golden.py` (regenerate golden vectors) |
| `npm run check` | typecheck + lint + test + build. **The coder's done-gate.** |
| `npm run size` | minified + gzip size of the content bundle against the §11.6 budget (ENG-010; CI step) |
| `npm run zip` | `scripts/zip.mjs`: `build:prod`, then writes `dist/THIRD_PARTY_NOTICES.txt` (each bundled package's name, version, SPDX id, source URL and license text) and packs `dist/` without `.map` files into `helper-for-pixiv-<version>.zip` at the repository root (git-ignored; sorted entries, fixed timestamp, so a commit always yields the same bytes). Refuses to pack when the manifest version differs from `package.json` (ENG-006) |

- **Versioning:** SemVer in `package.json` is the single source. `build.mjs` writes it into `manifest.json`, and the options footer reads `chrome.runtime.getManifest().version` (PRD CUJ-3 step 10).
- **Test pyramid and QA harness:** [design-test-harness.md](design-test-harness.md).
- **Release:** manual upload of the `npm run zip` artifact to the Chrome Web Store. Prerequisites (PRD index "Store readiness", R-001): the repository is public, the store listing is in 4 locales, privacy disclosures say "no data collected", and the permission justifications in §5 are pasted into the dashboard.
- **Licensing:** mediabunny is MPL-2.0, which requires its license text and source availability. The package is unmodified and its source is public on npm/GitHub. `THIRD_PARTY_NOTICES.txt` in the zip carries the MPL-2.0 text for mediabunny and MIT for fflate.

---

## 13. Constraints

Every implementation-shape constraint in PRD-000 and the index, classified by what it rests on. (User-facing constraints such as latencies, colors and copy are pm's and are not repeated here.)

| Constraint | Source | Basis | Design impact |
|---|---|---|---|
| Manifest V3, Chrome Web Store, desktop Chrome only | PRD §1, index | External fact: the Chrome Web Store accepts only MV3. Plus product scope. | SW + offscreen architecture (§2). |
| No remotely hosted code | index "Store readiness" | External fact: MV3 / Web Store policy | Everything bundled; no CDN libraries. |
| Permissions exactly `downloads`, `storage`, `offscreen`, `declarativeNetRequestWithHostAccess`, `downloads.ui`; hosts `www.pixiv.net`, `i.pximg.net`; never broaden host access | index "Privacy & security" | PRD reason: minimal permissions for store review + privacy. `downloads.ui` is added by owner ruling R-005 (reason recorded: one fly-to-toolbar animation per file, 20 for a 20-page manga). External fact: `downloads.ui` has no Chromium permission-message rule, so it adds no install warning (§5) | Design needs nothing more (§5). Manifest test locks the five. |
| Chrome's download UI is turned off with `chrome.downloads.setUiOptions({ enabled: false })` only from a job's first hand-off to Chrome. It is turned on again just before the last file of the last running job is handed to Chrome, giving one animation, the "done" signal; or at the last running job's end when there is no such hand-off; and on every worker start with no job running | PRD §4.1 #3, CUJ-1/2/4/5 (R-005, R-006) | Owner decisions with recorded reasons. R-005: one animation per file; the browser-wide side effect is accepted in the ruling, not a challenge. R-006: Chrome shows the button again only with a download, so the restore must come before one. External facts (Chromium `downloads_api.cc`, `download_ui_controller.cc`, `download_display_controller.cc`, Chrome docs): API since Chrome 105, below the 116 minimum; Chrome keeps the disable per extension in the browser process, so it outlives SW termination, and clears it when the extension unloads (disabled, reloaded, updated, uninstalled) or the browser quits; an enable is refused while another extension keeps the UI off, after our own entry is removed; no getter; Chrome reads the setting only per download event (a new item once its target path is determined, or an item update), never when the setting changes, so an enable alone does not bring the button back (QA iteration 3) | D12 rev. 3: one SW module with three call sites. Before every hand-off: hide, or restore for the busy period's last, once every other in-progress file has finished (≤ 2 s, next row). In finalize when no job is left. At boot when none runs. No persisted state. |
| The busy period's last hand-off waits at most 2 s (`HANDOFF_SETTLE_WAIT_MS`) for the other in-progress files to finish | Design parameter of D12 rev. 3, inside pm's bound of at most 2 s (pm-review iteration 3, priority 1). No PRD line states a number | Engineering reason, recorded. External facts: (1) a file Chrome receives as an in-memory blob is written in milliseconds. In QA iteration 3 retry 1, the earlier originals of every burst completed 0–7 ms after the enable; live runs showed no burst at all. (2) Chrome can hold a download indefinitely: a Save As dialog, a dangerous-file or deep-scan prompt, another extension in `onDeterminingFilename`. An uncapped wait would then keep the job from ending, which is the rejected "uncapped" option in design-download-engine.md. So the cap is about 300× the measured write tail, and it exists only to bound a file held by a user or another extension | Only the last hand-off waits. Past the cap the restore goes ahead, and one file may animate or open the bubble early (cosmetic; pm's pre-decided exit accepts a residual that occurs only at the cap). At boot only the search or the cap ends the wait (design-download-engine.md "Restart at `await:handoff.restoreUi`"). Not challenged: its reason is recorded |
| Encoding via built-in WebCodecs; no WASM codec bundles (ffmpeg.wasm rejected) | PRD §4.1 #4, NFR "Payload" | PRD reason: ~24 MB payload, slower | mediabunny (pure TS) over WebCodecs. |
| Output only through `chrome.downloads`, relative to the Downloads folder | PRD §4.1 #2 | Product decision (settled in discovery) | Blob URL hand-off (§8). |
| Orchestration in the SW, encoding in an offscreen document | PRD §4.1 #6, NFR | PRD reason (tab independence) + external fact (no WebCodecs/Blob URLs in SW, PRD §4.2) | §2 split. |
| ≤ 5 files of one artwork in flight | PRD §4.1 #5, NFR | PRD reason: parity with script `-j 5` | Scheduler cap counts fetches + hand-offs. |
| Retry: 4 attempts, 1.5·2ⁿ+U(0,0.5) s backoff, `Retry-After` ≤ 30 s, 30 s timeout, never 403 | PRD §4.5.2 | PRD reason: parity with script | §9. It decided the bytes-path choice (§8.4). |
| Token value ≤ 60 UTF-8 bytes + script sanitization | PRD §4.4 | PRD reason: parity with `safe_component` (macOS 255-byte component limit) | [design-settings-model.md](design-settings-model.md). |
| Folder choice through Chrome's download history: **one `chrome.downloads.search` query with a filename regex**, before the job's first write; `metadata.json` and `frames.json` never consulted; only the folder's last segment may carry ` (n)`; per-file `uniquify` kept as the safety net; the same-instant two-tab race not guarded | PRD §4.1 #1, §4.2, §4.3 "Folder choice" and "Name conflicts", §4.5.1 step 4, CUJ-1 step 8 and edges (refined 2026-10-27) | External facts: an extension cannot read the disk, and `search` is the one API that reports whether a downloaded file still exists (§4.2; verified in Chromium `downloads_api.cc`, `download_query.cc`, `download_manager_impl.cc`: RE2 `PartialMatch` on the absolute target path; an asynchronous `PathExists` re-check per complete item, at most once per 10 s per profile; `exists` never cleared in-session). PRD reasons recorded: no persisted history of our own (§4.1 #1); `metadata.json`/`frames.json` carry no artwork id, so with a token-free pattern they could be any artwork's; parent folders are shared by every artwork; `uniquify` stays because the history can be cleared. No new permission (`downloads` covers `search`) | D15: a pure regex/index module plus one orchestration function in the resolver's dependencies; the one query is issued twice when it finds records, 250 ms apart, because Chrome's re-check has no completion signal; no persisted state, `JobRecord` unchanged ([design-download-engine.md](design-download-engine.md) "Folder choice"). The regex is a suffix match because no API exposes the Downloads root; PRD §4.3 records its over-match (a record under another download location or a longer earlier pattern costs one needless `(n)`, never an under-detection) as an accepted limitation (R-008 item 1). Not challenged |
| The folder check waits at most 250 ms (`FOLDER_CHECK_RECHECK_WAIT_MS`) for Chrome's existence re-check before reading `exists` again | Design parameter inside PRD §4.3's "adds at most a few hundred ms" | Engineering reason, recorded: the re-check is one `PathExists` per complete history item on a thread pool, milliseconds for hundreds of items; there is no completion signal, so a fixed bound is the only option; 250 ms covers a large history, stays inside the PRD's budget, and usually hides behind the concurrent API call | Only a repeat run waits. Past the bound a stale flag can cost one needless `(n)`, never a lost file. Not challenged |
| Offscreen readiness: a command whose send finds no listener is resent every 25 ms for at most 1 s (`OFFSCREEN_READY_WAIT_MS`, `OFFSCREEN_RESEND_DELAY_MS`); an in-flight `createDocument` is awaited before `getContexts` is consulted | pm-review iteration 4, priority 1 ("a bounded wait, ≤ 1 s"); CUJ-4 AC 5 | pm's bound with its reason recorded: the few milliseconds a shared document needs to load are not "waiting for the other job" in AC 5's sense, a second would be. External fact: `runtime.getContexts` lists an offscreen document before its script has run (QA iteration 4, 14/16 reproductions) | D16 ([design-offscreen-worker.md](design-offscreen-worker.md) "Lifecycle"). Not challenged |
| Folder pattern ≤ 200 characters | PRD §4.9 (assumption — confirm) | PRD reason (CUJ-3 edge: "path stays bounded"). The number is pm's open assumption. | `maxlength=200`; zero design cost. Not challenged. |
| In-flight job state in session-scoped storage; no persisted history | PRD §4.1 #1, §4.8, index | Product decision + privacy reason | `storage.session` write-through; records deleted at job end. |
| Settings in `storage.sync` with `storage.local` fallback | PRD §4.9 | Product decision | Dual write + newest-wins read ([design-settings-model.md](design-settings-model.md)). |
| Locales `en`/`ja`/`zh_CN`/`zh_TW` via `_locales`, UI follows Chrome's language, no selector | PRD §3, index | Product decision | §11.4. |
| Badge text ≤ 4 chars (`999+`) | PRD §4.8 | External fact: Chrome badge space | `formatBadge()`. |
| Ugoira frames decoded/encoded one at a time | NFR "Memory", §4.6 | PRD reason: a 300-frame 1080p ugoira would need ~2.4 GB if held at once | Streaming pipeline; zero extra cost. |
| WebM codec = VP9 | PRD §4.6 (assumption — confirm) | PRD assumption. VP9 is also the engineering preference: better quality per bit than VP8, and libvpx encode is in every Chrome. | None; designed to it. |
| `minimum_chrome_version` = lowest supporting all APIs | index NFR "Platform" | External fact (API availability) | 116 (§5). |
| pixiv selectors kept in one place | index "Risks" | PRD reason: fast redesign fixes | `pixiv-dom.ts` rule (§4). |

**Result of the review:** every implementation-shape constraint rests on an external fact, a recorded PRD reason, or a settled product decision. None stands in for an unstated goal in a way that costs the architecture. **No requirement challenge filed.**

**Re-review, iteration 5, against the 2026-10-27 CUJ-1 refinement** (`8a65084`, Issue 2026-10-27-19-58-31: §4.1 #1, §4.2, §4.3 "Folder choice" and "Name conflicts", §4.4 token-free example, §4.5.1 step 4, §4.7.3 Saved row, §4.7.6, CUJ-1 steps 2 and 8 with edges and ACs, CUJ-4 and CUJ-5 lines, Appendix A `tip_saved`, mock `cuj-1-saved-again.html`). Most lines are user-facing (where a repeat run lands, what the tooltip says, which gaps are reused) and are designed to in D15. Two implementation-shape constraints are new: the mechanism ("in one `chrome.downloads.search` call with a filename regex", before the first write) and what the check may consult (`<id>_`/`<id>.` basenames only; the last segment only). Both rest on external facts verified in Chromium's source and on PRD reasons recorded in §4.1 #1, §4.3 and §4.4 (rows above). The latency line ("at most a few hundred ms") is user-facing and met with margin. **No requirement challenge filed.** One PRD *technical fact* is incomplete rather than wrong: §4.2 omits that Chrome re-checks file existence at most once per 10 s per profile, which narrows the "moved folder → plain name again" edge to clicks more than 10 s after the previous check. It is a spec-sync item for pm (§15), not a challenge: it changes no architecture and no normal-case behaviour. Closed by R-008 item 2 (option A, 2026-10-28): §4.2, the CUJ-1 "folder moved" edge and AC 13 carry the 10 s qualifier. The R-007 batch (`c8d95bc`) was reconciled on 2026-10-24 (`b97320f`) and re-verified today against the design: no drift.

**Re-review, iteration 4, against the R-007 spec-sync** (`c8d95bc`, six items). Every amended line is user-facing: the counter wording (CUJ-1 AC 7, CUJ-5 step 5, the 200-page edge), the §4.1 #3 and CUJ-5 step 9 wording for a mid-job 403, the settings-page text colours, the frame-zip prompt as a known v1 limitation (CUJ-2 edge), and which files a Retry writes (CUJ-5 step 5 and edge). None dictates how the product is built. **No requirement challenge filed.**

**Re-review, iteration 4, against the R-006 rev. 3 spec-sync** (quick-fix `c2c9de0`: PRD-000 CUJ-1 AC "up to `11 / 12` … `12 / 12` is never shown", CUJ-5 step 5 "`9 / 12` → `11 / 12`"). Both lines are user-facing: they state the counter values that the rev. 3 settle wait produces (design-download-engine.md "Progress counter"). They add no implementation-shape constraint. The one new number, the 2 s settle cap, is a design parameter, and its basis is recorded in the row above. **No requirement challenge filed.**

**Re-review, iteration 3 QA loop 1, against R-006.** R-006 moves the restore of an existing owner-decided mandate (the `setUiOptions` row above) from the last job's end to just before its last hand-off. The reason is recorded in the ruling, and the platform fact behind it is verified in Chromium's source and by QA's headed run. It adds no implementation-shape constraint. **No requirement challenge filed.**

**Re-review, iteration 3, against R-004 (S1–S15) and R-005.** R-004 adds no implementation-shape constraint. Its items write down user-visible behavior: widths, colours, copy, the outage diagnosis (S3) and the floating-fallback anchor (S4), which the design implements in §10 and §11.6. S8 adopts the design's Chrome path-safety pass (D8) into PRD §4.4, and S14 drops the `Retry-After` assumption marker; both were already designed. R-005 adds the two rows above: the fifth permission and the `setUiOptions` mandate. Both rest on the owner's ruling with its reason recorded, and the permission's "no new install warning" claim is verified against Chromium's permission-message rules (§5). The remaining "(assumption — confirm)" markers that touch implementation (the 200-character field, VP9 for WebM) are unchanged and were reviewed above. **No requirement challenge filed.**

**Re-review, iteration 2 (2026-10-23), against the R-003 amendment** (PRD-000 CUJ-1 preconditions, CUJ-5 Part A step 1, its edge case and ACs, Appendix A `aria_login`; index persona P2). The amendment adds user-facing behavior only: when the needs-login state appears, and its accessible name. It adds no implementation-shape constraint; the one implementation statement in it, "The signal that detects the sensitive-content wall is specified in the design docs", delegates the mechanism to engineering (§8.5). The signal works within the existing rows above: it needs no permission, no cookie access (the "Permissions exactly …" and privacy rows) and no extra request (it reuses the render-time `/ajax/illust` body). No row changed; **no requirement challenge filed.** The content-bundle budget (§11.6) is an engineering budget, not a PRD constraint, and is not listed here.

---

## 14. Key decisions (summary)

| ID | Decision | Rationale (detail in) |
|---|---|---|
| D1 | Offscreen `fetch` + DNR session Referer rule + `blob:` hand-off for all file bytes | Only option meeting retry parity and tab independence (§8.4) |
| D2 | Job API calls proxied through the originating tab, offscreen fallback | First-party cookies regardless of 3P-cookie settings (§8.3) |
| D3 | SW owns job truth, write-through to `storage.session`; offscreen owns bytes | SW may die at any await; offscreen cannot call `chrome.downloads` ([design-download-engine.md](design-download-engine.md)) |
| D4 | mediabunny + WebCodecs, MP4 `frameRate: 1000` timescale, crop-to-even, quantizer "very-high" | Exact ms timing, sharper than resampling, CRF-18-class quality ([design-offscreen-worker.md](design-offscreen-worker.md)) |
| D5 | fflate `unzipSync` per frame from retained bytes | Memory rule, tiny dependency ([design-offscreen-worker.md](design-offscreen-worker.md)) |
| D6 | Codec capability probed in the offscreen document, cached per size in `storage.session` | Same context as the encoder; "cached for the browser session" (PRD §4.6) |
| D7 | Shadow-DOM button, vanilla TS, Navigation API + MutationObserver | Style isolation from pixiv; no framework in a page-wide content script ([design-artwork-button.md](design-artwork-button.md)) |
| D8 | Chrome path-safety pass after script-parity sanitization | Chrome's `IsSafePortablePathComponent` rejects more than the script's sanitization strips; PRD §4.4 step 3 adopts the pass (R-004 S8) ([design-settings-model.md](design-settings-model.md)) |
| D9 | esbuild + Vitest + Playwright (CfT) + fake-pixiv HTTPS harness | Simple build, deterministic CUJ-5 fault coverage ([design-test-harness.md](design-test-harness.md)) |
| D10 | Login walls (R-003) detected from the first-party `/ajax/illust` body: withheld ⇔ `urls.original === null` (`sl ≥ 4` only if the `urls` shape is missing); needs-login ⇔ page logged out and (`xRestrict ≥ 1` or withheld); enforced at render time and again by the `full`-mode resolver | pixiv's own per-viewer decision, available before any click at zero cost; `/pages` does not refuse walled all-ages works, so the resolver check closes the pre-metadata click (§8.5) |
| D11 | Job model and protocol types live in `src/shared/job.ts`; `src/shared` never imports a context directory, contexts never import each other; ESLint-enforced | The pure core operates on these types; the inverted dependency on `src/background/` was code-review W6 (§4) |
| D12 | Chrome's download UI is toggled by one SW module (`src/background/download-ui.ts`) from three call sites. (1) `handOff()` decides, in the same synchronous step that claims the file, whether this is the busy period's last hand-off. That is the case when no other file of any running job is still `queued`, `fetching`, `ready`, or `saving` with neither a download id nor an earlier decision, and no job is still resolving. If it is, `handOff()` waits for the earlier hand-offs' `download()` calls and for every in-progress file to finish (capped at 2 s; being named is not enough, since a file finishing after the enable opens the bubble before the last file exists). It then re-checks, and awaits `restore()` before `downloads.download`. Otherwise it awaits `hideForHandOff()`. (2) `finalize()` restores when no job is left: the safety net for an end without a final hand-off. (3) Boot restores when no job runs. Calls are serialized and idempotent per SW instance, and a failure never blocks a hand-off. **Rev. 3 (quick-fix, 2026-10-24):** the last hand-off waits for the other files to finish, not merely to be named. **Rev. 2 (R-006, 2026-10-23):** the restore moved from finalize to just before the last hand-off; rev. 1 (R-005) restored at finalize only | R-005, R-006 / PRD §4.1 #3. Chrome brings its downloads button back only with a download event after the enable, never on the enable itself (Chromium `download_display_controller.cc`; QA iteration 3). The last file's own download is therefore the only in-product way to bring the button back with the job's files in the bubble. `handOff()` is the only hand-off point and `finalize()` the only end point, so the hide can never start before a file reaches Chrome (design-download-engine.md "Chrome's download UI", "The last hand-off") |
| D13 | "No connection" is judged per job: `Failure.answered` (request level) plus `JobRecord.answered` (job level, persisted), replacing `lastStatus` | R-004 S3. Deterministic whatever Chromium's throttling does, no time-windowed memory, survives SW restarts with the record (§10) |
| D14 | The floating fallback timer fires 250 ms before the 3 s deadline (`FLOAT_PLACEMENT_BUDGET_MS`), anchored at route entry | R-004 S4: the 3 s is measured to the pill on screen; measured overshoot of a 3000 ms timer was 11–79 ms (design-artwork-button.md "Mounting") |
| D15 | **Folder choice from Chrome's download history** (iteration 5, PRD §4.3 refined 2026-10-27). After `resolveFolder`, a `full` job runs `chooseFolder(folder, artworkId)` concurrently with its second API call: one `chrome.downloads.search({ filenameRegex, state: 'complete', limit: 0 })` whose regex is a path-suffix match for `<folder>` or `<folder> (n)` followed by a basename starting `<id>_` or `<id>.`, with either OS separator, in the RE2 ∩ ECMAScript subset; if it finds records, a 250 ms wait and the same search again, so Chrome's asynchronous existence re-check can land; records with `exists: false` dropped; the lowest free `n ≥ 0` chosen. Any failure → the plain folder. Pure regex/index logic in `src/shared/folder-choice.ts`, orchestration in `src/background/folder-choice.ts`, a resolver dependency. Retries echo the job's folder, suffix included; `JobRecord` and storage are unchanged | PRD §4.3 names the mechanism and its reasons (no history of our own, the token-free pattern, shared parents). Chromium facts: RE2 `PartialMatch` on the absolute target path; the re-check is asynchronous, has no completion signal and runs at most once per 10 s; `exists` is never cleared in-session. Two identical searches are the simplest correct read of the re-check (design-download-engine.md "Folder choice", Alternatives) |
| D16 | **Offscreen readiness** (iteration 5, QA iteration 4 LOW). `ensureOffscreen()` awaits a close in flight, then returns an in-flight `createDocument` promise *before* consulting `runtime.getContexts`, re-checks `creating` after the context lookup, and reads a duplicate-creation rejection as "exists". `send()` treats "Receiving end does not exist" as not-ready-yet: re-ensure and resend every 25 ms for at most 1 s from the first rejection, then fail as before (`internal`, `attempts: 0`). `scheduleClose()` keeps the `closeDocument()` promise so a job starting during the grace close waits for it and creates afresh | `getContexts` lists a document before its script has run, so the old early return let a second job's first commands hit a listener-less document (14/16 at a 5–11 ms gap). The resend is safe because an undelivered command has no effect; the bound is pm's (design-offscreen-worker.md "Lifecycle") |

---

## 15. Open questions, risks, and PRD spec-sync items

### PRD spec-sync status

The twelve spec-sync items listed here in iteration 2 were resolved by R-004 (owner: "GO WITH A"; pm applied S1–S15 to prd-000 and the mocks): Chrome-bubble wording (S6), the `Retry-After` marker (S14), the D8 path-safety pass (S8), the `_one` copy keys and every "(derived)" string (S9), the derived outcome mappings including WebM → MP4 when VP9 cannot be encoded and the ugoira metadata-only failure (S10), the job-level "No connection" rule (S3, now D13), the AA contrast values and the hover-tint exemption (S2), the 0-count idle title (S11), the R-003 residuals a–d (S12), the provisional and ugoira widths (S1), keyboard order (S7), and the unclosed `{` (S5). Their design consequences are folded into the sections above and into the chapters. Nothing from that list remains open.

R-007 (owner: "go with A"; pm applied the six items to prd-000 and the mocks in `c8d95bc`) closed the three gaps listed here in iterations 3–4:
- **The ugoira frame zip held by a Chrome prompt** is a known v1 limitation in CUJ-2's edge cases (item 5, no code change). The analysis and the pre-decided response are under "Known limitation" below.
- **Settings-page contrast:** the links and the selected Ugoira segment meet 4.5:1 at rest (item 4, built in `f15466a`). See §11.5 and design-options-page.md "Styles".
- **A mid-job 403:** §4.1 #3 now lists "needed login after a 403 with no other file still on its way to Chrome" as an end without a final hand-off. CUJ-5 step 9 says that files already on their way still land, and the last of them brings the job's one animation (item 3, no code change; design-download-engine.md L2 case "needs login after a 403 with nothing left in flight").

R-007 also rewrote the counter rule (items 1 and 2: CUJ-1 AC 7, CUJ-5 step 5 and the 200-page edge; design-download-engine.md "Progress counter"). And it made a Retry after the pages and `metadata.json` both failed write `metadata.json` again (item 6, built in `8e4606f`; §10 "A Retry after a partial").

R-008 (owner: "Go with A"; pm applied the three items to prd-000 in `e717850`; no code change) closed the one gap listed here in iteration 5:
- **The 10 s existence re-check:** §4.2 now says that Chrome runs the re-check at most once every 10 s per profile and that a search inside that window returns the flags as they were; the CUJ-1 edge "First folder moved, renamed or deleted before the repeat click" and AC 13 promise the plain name only for a click at least 10 s after the previous download of this artwork, and the edge records that a folder moved back stays flagged removed until Chrome restarts, so the next run uses the plain name and the per-file safety net (item 2; design-download-engine.md "Folder choice" platform fact 3 and its edge table).

R-008 also recorded the folder-check scope as an accepted limitation in §4.3 "Folder choice": the check matches the folder as the last segments of each record's path, so a record of this artwork under another Downloads location or under a longer earlier pattern also counts and costs one needless `(n)` (item 1; design-download-engine.md "Scope of the match" and "Anchoring"; §13 row "Folder choice through Chrome's download history"). And it added the unpainted `200 / 200` instant to the 200-page edge (item 3; design-download-engine.md "Progress counter").

### Open spec gaps for pm (not blocking; `/design-feature` or `/spec-sync`, the PRD is not edited here)

None. The gap listed in iteration 5 was closed by R-008 and the three from iterations 3–4 by R-007 (above).

### Known limitation: a download held for a decision while Chrome's UI is hidden (R-005, R-006; PRD §4.1 #3, CUJ-2 edge; R-007 item 5)

- **The situation.** Chrome may hold one of a job's files for a user decision: a dangerous-file warning, or an Enhanced Safe Browsing deep-scan prompt, which the risk table below lists for blob-sourced `.zip`. The prompt then lives in the bubble the extension has hidden. The file stays `saving` with its download id, and Chrome reports it `in_progress`.
- **A held page or `metadata.json`** delays the busy period's last hand-off by at most the 2 s settle cap (D12 rev. 3). Then the UI comes back with the last file, and the prompt should be reachable in the bubble; that is unverified for an item created while the UI was off. If the held file is itself the last hand-off, the UI is already on.
- **A held ugoira zip keeps every later file of that job waiting.** `frames.json` depends on the zip being `done`, and the video on both, so they stay `queued`. That counts as still to be handed off, so no hand-off of the busy period can be the last. The button stays busy, and Chrome's UI stays hidden, for every running job, until the user acts on the zip in `chrome://downloads` (which keeps listing it) or cancels the job (code review iteration 3 retry 1, Info 6). This is the one realistic case.
- **The prompt is also out of reach** while other files are still to be handed off, or when no hand-off follows because they all fail.
- **Status: PRD text since R-007 item 5, nothing built.** The PRD records the zip case as a known v1 limitation (CUJ-2 edge "Chrome prompt on the frame zip"). Pre-decided response, if L5 ever observes it: as soon as `downloads.onChanged` reports a `danger` value that needs a decision for a running job's file, restore the UI and keep it on for the rest of the busy period. tl first verifies that the prompt becomes reachable for an item created while the UI was off. The response is a one-branch change in `engine.ts` (the delta path) and `download-ui.ts`.
- **Likelihood is low.** pixiv originals are images, and no such prompt appeared in iterations 1–3. The L5 checklist covers it on Windows (design-test-harness.md, release checklist §2).

### Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| DNR `initiatorDomains: [extension id]` does not match extension-initiated requests | **Retired** (verified live by ENG-002, §8.2) | — |
| pixiv changes how it hides walled works from logged-out visitors (e.g. sends URLs and blurs client-side) | Low–medium over product life | `sl` fallback for a missing `urls` shape; L4 live smoke asserts `Log in to download` on a live walled work before every release (§8.5) |
| Logged-in DOM and dark theme never observed live (no pixiv account) | Medium (P1 is always logged in) | Selectors validate structurally and fall back to floating; owner-run `npm run qa:live` with a session, or the L5 checklist, before release (design-test-harness.md) |
| Chromium throttles every image request of a click during a long pixiv outage | **Retired** by the job-level rule (D13, R-004 S3): the job's API calls answered, so the click reads `server` | — |
| The SW dies after deleting the last job's record and before re-enabling Chrome's download UI | Low | The next SW start finds no job and re-enables (D12 boot rule); Chrome also clears the disable when the extension unloads or the browser quits |
| Another extension also hides Chrome's download UI | Low | Chrome keeps the UI hidden while any extension disables it; our enable is refused after our own entry is removed, logged at `debug`; nothing to do |
| pixiv DOM redesign breaks action-row discovery | Medium over product life | Floating fallback; selectors only in `pixiv-dom.ts`; live-DOM fixture refresh (ENG-002) |
| Undocumented pixiv AJAX shape changes | Low | Parsing in `pixiv-api.ts` with tolerant defaults; failures surface as button states |
| Hardware H.264 encoder session limits with concurrent ugoira encodes | Low | On encoder `configure`/`error`, retry once with `hardwareAcceleration: 'prefer-software'` before failing ([design-offscreen-worker.md](design-offscreen-worker.md)) |
| Very long literal pattern text exceeds 255 bytes per component or Windows path limits | Low | Surfaces as `disk` (`FILE_NAME_TOO_LONG`); bounded by the 200-character field |
| Chrome changes `filenameRegex` matching (the path it matches, the regex engine) or the `exists` re-check | Low; both are long-standing documented behaviour | The folder choice fails soft: a search error or a non-matching regex yields the plain folder with `uniquify`, the 1.0.0 behaviour. The L4 live smoke's repeat-download case and the unit regex examples would surface a change (D15) |
| Enhanced Safe Browsing deep-scan prompts on blob-sourced `.zip` | Low | Not seen so far. On the ugoira zip, the prompt would sit in the hidden bubble and keep `frames.json`, the video and Chrome's UI waiting until the user acts in `chrome://downloads` (a known v1 limitation, PRD CUJ-2 edge; §15 "Known limitation", with a pre-decided response). L5 check on Windows |
