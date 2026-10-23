# Task Plan

Last updated: 2026-10-23 02:29:26 (UTC-7)

## Current State

- **Dev-cycle iteration 2.** All five CUJs of prd-000 are implemented and merged on `main` (`aea2be3`). Iteration-1 QA (`docs/qa-report.md`) is FAIL with 4 LOW bugs only (0 CRITICAL/HIGH/MEDIUM). PM (`docs/pm-review.md`) rates CUJ-1, CUJ-2 and CUJ-4 Satisfied and CUJ-3 and CUJ-5 Caveats. Since iteration 1:
  - the owner ruled R-003 (`docs/rulings.md`): `Log in to download` covers every work pixiv withholds from a logged-out visitor, and pm amended PRD-000 CUJ-5 Part A, the CUJ-1 precondition and `aria_login`;
  - tl updated all seven design docs (system.md §6, §8.5 D10, §9, §10, §11.4–11.6, D11; the six chapters) and filed ENG-008 … ENG-011.
  - The owner queue is empty and no routed defects exist.
- **Focus (priority ladder):**
  - Tiers 1–2 are empty: no MEDIUM+ bugs and no `blocking` ENG entries.
  - Tier 3 follows the pm-review "Recommended Next-Iteration Priorities", ENG `Ordering` and tl's file constraints:
    - **Group 1:** ENG-008 (P1 layering refactor) runs alone first, because it moves `src/background/types.ts` → `src/shared/job.ts`, which almost every later task imports (ENG-008 Ordering).
    - **Group 2:** one combined CUJ-5 task carries R-003 needs-login plus the outage classification (`internal` kind, `lastStatus`). The two must not be split across parallel tasks, because both edit `src/shared/types.ts`, `outcome.ts`, `messages.ts` and `src/background/resolver.ts`. Beside it run the disjoint fixes:
      - CUJ-3: clear `Saved` when a validation error shows, plus the options contrast values;
      - pattern `~` edge trim;
      - badge idle title at 0;
      - ENG-010 (P2, files disjoint from everything else in the group).
  - Tier 4 (P2) and the work that needs Group 2 merged run in **Group 3**:
    - the button provisional width and Unavailable contrast (it must update `e2e/cuj5.spec.ts`, which the Group 2 CUJ-5 task owns);
    - ENG-009 plus the e2e README;
    - the live smoke (it can only pass once R-003 has merged);
    - ENG-011 (after the outage change to `offscreen.ts`);
    - ENG-007 (after ENG-008, after the resolver edits, and after ENG-010's `ci.yml` step);
    - ENG-006 (its `package.json` edit comes after ENG-010's).
- **Orchestrator prerequisite.** The iteration-2 doc changes are uncommitted on `main`: `docs/design/*.md`, `docs/prd/*.md`, `docs/eng-backlog.md`, `docs/rulings.md`, `docs/owner-queue.md`, `docs/loop-state.md` and this file. Commit them (Checkpoint A) before creating Group 1 worktrees. Every task cites design sections that exist only in the working tree today.
- **Rules for every task:**
  - The done-gate is `npm run check` (typecheck + eslint + prettier + vitest + build).
  - Tasks that touch e2e also run their CUJ spec: `HFP_HEADLESS=1 npm run test:e2e -- --grep @cujN`.
  - Read the design sections named in the task before coding. Do not edit `docs/prd/**` or `docs/design/**`; report a design gap in the commit message or task summary instead.
  - From Group 2 on, the job model and protocol types (`JobRecord`, `FileTask`, `FileRole`, `FileState`, `UgoiraState`, `StartRequest`, `ErrorCode`) are imported from `src/shared/job.ts`. No context directory imports another one, and `src/shared` imports no context directory; ESLint enforces this after Group 1.
  - Only tasks 2.5 and 3.6 may edit `package.json` / `package-lock.json`, and no task adds or upgrades a dependency.
  - In the e2e build, Chromium throttles repeated 500/503 answers, so exhausted-retry e2e scenarios use 502/504 (see the note in `e2e/cuj5.spec.ts`).
  - Commit with conventional messages; split a task into several commits where it has separate parts.
- **QA expectations for iteration 2 (deliberate, not bugs):**
  - **New contrast colours** differ from the PRD values and mocks until pm's `/spec-sync` (system.md §11.5, §15 item 7):
    - options `Saved` light `#188038` (dark keeps `#1a9f5a`);
    - options validation message text light `#c5221f`, dark `#f28b82` (the invalid field's 2 px border stays `#d93025`);
    - "Still using" trailing sentence light `#5c6166` (dark keeps `#8a8f94`);
    - button `Unavailable` text `#5f6368`.
  - **Live work 151107515** (`xRestrict` 0, behind pixiv's sensitive-content wall) must now show `Log in to download` when logged out; iteration 1 downloaded it. The live smoke's download case now picks only works pixiv shows logged out.
  - `aria_login` is now neutral, `Log in to pixiv to download this work.`, also for a mid-job 403 on an all-ages work.
  - A click made before the render-time metadata arrived ends in `Log in to download` on an R-18 or walled work; iteration 1 showed `Retry` + `tip_refused` for an R-18 work (system.md §15 item 9d).
  - **The sustained-outage replay** `docs/qa-artifacts/iter1-20-23-42/walk-scripts/diagOutage.ts` (main checkout, dev build) should show `pixiv isn't responding. Retry in a few minutes.` on all 7 clicks. A stopped server still shows `No connection. Retry when you're back online.`
  - **Ugoira pill width** stays 176 px in English, per PRD §4.7.2 (a PRD-internal conflict with CUJ-2 step 1, still with pm).
  - **Accepted R-003 residual** (system.md §8.5, miss 2): a page that still says "logged in" after the user logged out in another tab downloads a walled all-ages work.
  - **Unclosed `{`** in the folder pattern is still literal text, because the PRD is unchanged.
- **Document-authority notes (recorded for pm/tl; not tasks):**
  1. **Contrast is a PRD-internal conflict.** The PRD index "Accessibility" says: "Every other text/background pair the extension introduces must meet WCAG 2.1 AA (4.5:1)." The specific values in CUJ-3 steps 3 and 5, §4.7.3 (Unavailable `#80868b`, "assumption — confirm; not mocked") and the `cuj-3-*` mocks fall below that line, and §4.7.7 claims "Every other state passes 4.5:1". Tasks 2.2 and 3.1 follow the index rule with the design's values, as PM recommended (pm-review item 5h). pm syncs the PRD values and mocks. The error pill's hover tint (`#d93025` on `#fdeceb`, 4.18:1) is flagged for pm only, and no task changes it.
  2. **Open spec-sync items, system.md §15** (pm via `/spec-sync`):
     - (1) Chrome-bubble wording under the blob hand-off (CUJ-1 steps 2 and 5, CUJ-4 edge).
     - (2) Drop the §4.5.2 `Retry-After` "(assumption — confirm)" marker.
     - (3) D8 path safety vs §4.4.3 "literal text … used as typed".
     - (4) Derived `_one` copy keys.
     - (5) Derived outcome mappings (§10 rows 4, 8 and 9; VP9 → MP4; ugoira metadata-only failure).
     - (6) CUJ-5 step 6 detection vs Chromium throttling. Task 2.1 implements the design's per-request `lastStatus` rule; PM's broader job-level variant stays open for pm.
     - (7) Contrast values (note 1).
     - (8) §4.8 title with 0 counted files (task 2.4 implements the idle title).
     - (9) R-003 residuals:
       - (a) the CUJ-5 edge "Logged out in another tab … The click is refused" is not true for walled all-ages works;
       - (b) the Part A step 1 "System response" still names only `xRestrict` 1;
       - (c) §4.2 probe facts;
       - (d) the pending-click needs-login outcome.
     - (10) §4.7.2 provisional width, the WebM-hint ellipsis edge, and CUJ-2 step 1's "164 × 40 px" vs §4.7.2.
     - (11) Keyboard order in pixiv's `row-reverse` row.
     - (12) CUJ-3 step 5, unclosed `{`.

## Parallel Group 1

### Task: 1.1 Move the job model and protocol types into src/shared; enforce the layering rule (ENG-008)
- **Do**:
  - **Background.**
    - `src/shared/{messages,outcome,progress,pixiv-api}.ts` and `src/content/button/model.ts` import `JobRecord`, `FileTask`, `StartRequest`, `UgoiraState` and `ErrorCode` from `src/background/types.ts`. That inverts the layering: the pure shared core depends on the service worker's directory (iteration-1 code review W6).
    - `docs/design/system.md` §4 "Layering rule (D11)" and `docs/design/design-download-engine.md` "Data Model" put these types in `src/shared/job.ts`.
    - This is a pure refactor with no behavior change. Record the vitest test count before you start; it must be identical at the end.
  1. `git mv src/background/types.ts src/shared/job.ts`:
     - Keep every declaration, field and comment unchanged.
     - Change its import from `'../shared/types'` to `'./types'`.
     - Update its header comment to cite design-download-engine.md "Data Model" and system.md §4 D11.
  2. Update every importer, with no re-export shim left behind. `grep -rn "background/types\|from './types'" src test e2e` lists them:
     - `src/background/{reconcile,scheduler,engine,downloads,resolver,view,badge,handlers,registry,pusher}.ts`: `'./types'` → `'../shared/job'`. Keep the imports from `'../shared/types'` as they are.
     - `src/shared/{messages,pixiv-api,progress,outcome}.ts`: `'../background/types'` → `'./job'`.
     - `src/content/button/model.ts`: `'../../background/types'` → `'../../shared/job'`.
     - Tests: `test/unit/{progress,registry,view,outcome}.test.ts`, `test/unit/background/{badge,engine-scheduler,engine-transitions,engine-handlers,engine-resolver,engine-pusher}.test.ts` and `test/integration/{sw-boot,sw-restart,sw-pages}.test.ts`.
  3. `eslint.config.js`: add one config block per directory, each using `no-restricted-imports` with `patterns`. The message cites system.md §4 D11.
     - `src/shared/**`: forbid `background`, `content`, `offscreen` and `options`.
     - `src/background/**`: forbid `content`, `offscreen` and `options`.
     - `src/content/**`: forbid `background`, `offscreen` and `options`.
     - `src/offscreen/**`: forbid `background`, `content` and `options`.
     - `src/options/**`: forbid `background`, `content` and `offscreen`.
     - The patterns must match relative specifiers at any depth (`../background/x`, `../../background/x`); use gitignore-style `**/background/**` groups or `regex`.
     - Prove it: temporarily add `import type { JobRecord } from '../background/registry'` to a `src/shared` file and check that `npm run lint` fails. Then revert.
  4. Update any remaining file-header comments in `src/` and `test/` that cite `src/background/types.ts`.
- **Files**: `src/background/types.ts` → `src/shared/job.ts`, `src/background/{reconcile,scheduler,engine,downloads,resolver,view,badge,handlers,registry,pusher}.ts`, `src/shared/{messages,pixiv-api,progress,outcome}.ts`, `src/content/button/model.ts`, the test files listed in step 2, `eslint.config.js`
- **Done when**:
  - ENG-008 Verify prints `LAYERING OK`: `test ! -e src/background/types.ts && test -f src/shared/job.ts && ! grep -rEn "from '(\.\./)+(background|content|offscreen|options)/" src/shared && ! grep -rEn "from '(\.\./)+(background|offscreen|options)/" src/content && ! grep -rEn "from '(\.\./)+(background|content|options)/" src/offscreen && ! grep -rEn "from '(\.\./)+(background|content|offscreen)/" src/options && grep -q "no-restricted-imports" eslint.config.js && npm run check && echo LAYERING OK`
  - The vitest test count is unchanged, and `git diff --stat` shows no change to any declaration in the moved file beyond its import line and header comment.
  - The deliberate bad import from step 3 failed `npm run lint` before it was reverted (say so in the summary).

## Parallel Group 2 (depends on Group 1)

### Task: 2.1 CUJ-5: needs-login on pixiv's login walls (R-003) and honest outage causes (`internal` kind, `lastStatus`)
- **Do**:
  - **Why.**
    - **(1) Owner ruling R-003** (`docs/rulings.md`). PRD-000 CUJ-5 acceptance criterion, verbatim: "Logged out, on an all-ages work (`xRestrict` 0) that pixiv hides behind its `This work may contain sensitive content. Please log in to view this work.` wall, the button renders `Log in to download` before any click, with the same styling and tooltip as on an R-18 work and the accessible name `Log in to pixiv to download this work.` Clicking it navigates to `https://accounts.pixiv.net/login?return_to=` followed by the URL-encoded artwork URL, and after logging in the returned page shows the normal idle `Download · NP` (per R-003)."
      - Today the extension keys needs-login on `xRestrict ≥ 1` only.
      - Live work 151107515 (all-ages, walled) shows `Download · 4P` and saves all four originals.
    - **(2) QA iteration-1 LOW bug (CUJ-5).** "During a sustained 500/503 from `i.pximg.net`, from the user's 4th `Retry` onward Chromium's extension-request throttling refuses 3 of the 4 attempts locally. … server hits per click went 4, 3, 2, 1, 1, 1, 1. The extension maps the refusal to `network` (`src/shared/retry.ts:126`) and `errorCause` (`src/shared/outcome.ts:24-33`) then reports 'No connection. Retry when you're back online.', although the user is online and pixiv is failing."
      - Same class (code review W2): a refused or unreachable offscreen command also ends as "No connection".
  - **Read first:**
    - `docs/design/system.md`: §6 (`WorkInfo.withheld`, `FailureKind` `internal`, `Failure.lastStatus`), §8.5 "pixiv's login walls: the needs-login signal (R-003)" (D10, including the exact `isWithheld`/`requiresLogin` code), §9 (row "Final failure after server answers (`lastStatus`)"), §10 (rows 4 and 8, "Why `internal` reads as `server`"), and §11.4 ("Translations of `aria_login`").
    - `docs/design/design-download-engine.md`: "Data Model" (`StartRequest.full.loggedIn`), "Resolving" steps 2 and 3a (`Resolution` with `loginRequired`), the event table rows "`off/ready` without `blobUrl`" and "Dispatch refused …", "Testing", and "Migration / Rollout".
    - `docs/design/design-artwork-button.md`: "Render-time metadata", "Needs-login decision (R-003)", the state diagram, the click-payload table, and "Testing".
    - `docs/design/design-offscreen-worker.md`: "Cross-Cutting Concerns" → "Error handling".
    - `docs/design/design-test-harness.md`: "Fake pixiv server" (the login-walls paragraph), the fixtures row 135882745, and the L3 rows "CUJ-5 (R-003)" and "CUJ-5 step 6".
  - **Part A: outage classification.** Commit as e.g. `fix(engine): classify throttled 5xx and internal failures as server errors`.
    1. `src/shared/types.ts`:
       - `FailureKind` gains `'internal'`.
       - `Failure` gains `lastStatus?: number`, with the field comments of system.md §6.
    2. `src/shared/retry.ts`:
       - When the final attempt fails with `network` or `timeout`, and an earlier attempt of the **same request** got HTTP 429/5xx, the returned `Failure` keeps its final `kind` and adds `lastStatus` = the most recent such status.
       - Nothing else in the policy changes: still 4 attempts, 403 never retried, `Retry-After` ≤ 30 s.
    3. `src/shared/outcome.ts`, row 8. The cause from the job's failures, first match wins:
       - (a) at least one failure, and all are `disk`/`dismissed` → `disk`;
       - (b) `navigator.onLine === false`, or at least one failure and every failure is `kind === 'network'` **with no `lastStatus`** → `offline`;
       - (c) otherwise → `server`.
    4. Use `internal` at the four plumbing points (system.md §10):
       - `src/background/resolver.ts` `fetchJson` catch (neither the tab nor the offscreen document answered): `kind: 'internal'`.
       - `src/background/engine.ts` `dispatch`, for a refused or undeliverable offscreen command: `internal` for every role except `video`, which stays `encode`.
       - `src/background/downloads.ts` `onOffReady` without `blobUrl` for a file that must be saved: `{ kind: 'internal', detail: 'no blob' }`.
       - `src/offscreen/offscreen.ts` `failureOf`, for an exception in a non-encode task: `{ kind: 'internal', detail: 'exception', attempts: 1 }`. Leave the encode branch's `attempts` alone; ENG-011 (task 3.4) changes it.
    5. `src/shared/messages.ts`:
       - `FAILURE_KINDS` includes `internal`.
       - `isFailure` accepts an optional integer `lastStatus` and rejects a non-integer one.
  - **Part B: R-003 needs-login.** Commit as e.g. `feat(content): needs-login on pixiv's login walls (R-003)`.
    1. **Shared core:**
       - `src/shared/types.ts`: `WorkInfo.withheld: boolean`.
       - `src/shared/constants.ts`: `WITHHELD_MIN_SANITY_LEVEL = 4`.
       - `src/shared/pixiv-api.ts`:
         - `parseIllust` sets `withheld` with exactly the `isWithheld` logic of system.md §8.5: `urls.original === null` → true; a string → false; `urls`/`original` missing or unrecognized → `sl >= 4`.
         - Log a `warn` (`createLogger` from `src/shared/log.ts`) whenever the `sl` fallback is used.
         - Export `requiresLogin(work, loggedIn) = loggedIn === false && (work.xRestrict >= 1 || work.withheld)`.
    2. **Protocol:**
       - `src/shared/job.ts`: `StartRequest` `full` gains `loggedIn: boolean | null`.
       - `src/shared/messages.ts` `isStartRequest`: `full` requires `loggedIn` to be exactly `true`, `false` or `null`. A missing or any other value → `BAD_REQUEST`.
       - `src/background/handlers.ts` `startRequest()` copies `loggedIn`.
    3. **Resolver** (`src/background/resolver.ts`):
       - `Resolution` gains `{ ok: false; loginRequired: true }`.
       - In `resolveFull`, right after the illust parses and **before** `/pages` or `ugoira_meta` is called: if `requiresLogin(work, request.loggedIn ?? null)`, return `loginRequired`.
       - `applyResolution` sets `stopReason = 'forbidden'` for it and finalizes.
       - Retry modes skip the check.
    4. **Classifier** (`src/shared/outcome.ts`, row 4): `needsLogin` also when `stopReason === 'forbidden'` and no byte file failed. Both the first byte 403 and the resolver stop set `stopReason = 'forbidden'` (system.md §10 row 4).
    5. **Content script:**
       - `src/content/button/model.ts`: on the `metadata` event, use `requiresLogin(event.work, event.loggedIn)` instead of the `xRestrict` check.
       - Every `full`-mode start payload carries `loggedIn`: `pending` (`expectedFiles: 0`), `idle`, `saved`, and `error` with a cause.
       - `src/content/content.ts`: pass the page's marker, read once per document by `readIsLoggedIn`, into the start payload. Log each needs-login decision at `debug` with its reason (`xRestrict` or `withheld`).
    6. **Copy.** In all four `src/_locales/*/messages.json`, change `aria_login` and nothing else:
       - en `Log in to pixiv to download this work.`
       - ja `この作品をダウンロードするには、pixivにログインしてください。`
       - zh_CN `登录 pixiv 以下载此作品。`
       - zh_TW `登入 pixiv 以下載此作品。`
    7. **API fixtures.** Add `test/fixtures/api/illust-walled.json`, a reduced 151107515 body (`xRestrict` 0, `sl` 4, all five `urls` keys `null`, illustType 0, pageCount 4), and `test/fixtures/api/illust-visible.json`, a reduced 151061734 body (`xRestrict` 0, `sl` 2, `urls.original` an `https://i.pximg.net/img-original/…_p0.jpg` string).
       - Use the same `{ error, message, body }` envelope as `test/fixtures/api/illust-manga.json`.
       - Capture them logged out: `curl` with a desktop Chrome User-Agent, no cookies. Reduce each to the keys `parseIllust` reads plus `urls`, `sl` and `xRestrict`.
       - If pixiv is unreachable, build them from the evidence table in system.md §8.5 and say so in the commit message.
    8. **Fake pixiv** (`e2e/fixtures/works.ts`, `e2e/server/{ajax,server,page}.ts`), per design-test-harness.md "Login walls mirror live pixiv":
       - Add `sensitiveWall?: boolean` to `WorkBase`.
       - Add fixture **135882745**: a 4-page illust, `xRestrict` 0, `sensitiveWall: true`, with a `purpose`.
       - `/ajax/illust` sends `sl` 6 for `xRestrict ≥ 1`, 4 for `sensitiveWall`, else 2. For a logged-out request it nulls every `urls` key when the work is R-18/R-18G **or** `sensitiveWall`; logged in, the URLs are present.
       - `/pages` and `ugoira_meta` of a `sensitiveWall` work answer normally while logged out, as pixiv does, so the tests prove the **extension** withholds the download.
       - The logged-out artwork page of a `sensitiveWall` work replaces the image with `This work may contain sensitive content.` … `Please log in to view this work.`; the action row stays.
       - Do **not** edit `e2e/README.md` (task 3.2 documents the fixture) or the zip-building code (task 3.2, ENG-009).
    9. **Unit tests** (one case per item):
       - `retry.test.ts`:
         - 503, then three `TypeError`s → `{ kind: 'network', lastStatus: 503 }`;
         - a timeout after 429 → `{ kind: 'timeout', lastStatus: 429 }`;
         - all network errors → no `lastStatus`;
         - 403 → 1 attempt.
       - `outcome.test.ts`:
         - all `network` without `lastStatus` → offline;
         - a `network` with `lastStatus` 503 → server;
         - any `internal` → server;
         - `navigator.onLine === false` → offline;
         - all `disk`/`dismissed` → disk;
         - row 4 via `stopReason 'forbidden'` with no failed file → needsLogin.
       - `pixiv-api.test.ts`:
         - `withheld` from both new fixtures;
         - a body without `urls` and `sl` 4 → true, and with `sl` 2 → false;
         - the `requiresLogin` truth table of system.md §8.5.
       - `messages.test.ts`:
         - `internal` and `lastStatus` accepted;
         - a non-integer `lastStatus` rejected;
         - `job/start` `full` with `loggedIn` missing or `'yes'` → rejected.
       - `test/unit/background/engine-resolver.test.ts`:
         - `full` with `loggedIn: false` on a withheld body → `loginRequired`, and the fake API saw no `/pages` or `ugoira_meta` call;
         - `loggedIn: true` or `null` → proceeds;
         - retry modes skip the check;
         - a transport error from both tab and offscreen → `apiFailure` with `kind: 'internal'`.
       - Engine tests: a refused dispatch → `internal` (video → `encode`); `off/ready` without `blobUrl` → `internal`.
       - `test/unit/offscreen/offscreen.test.ts`: a non-encode exception → `internal`.
       - `test/unit/button/model.test.ts`:
         - metadata `{ xRestrict: 0, withheld: true }` with `loggedIn` `false` → needsLogin;
         - with `true` or `null` → idle;
         - start payloads carry `loggedIn`.
       - `test/unit/button/labels.test.ts`: the new `aria_login` text.
       - `test/unit/content/content.test.ts`: the walled case.
       - Add `withheld` to every `WorkInfo` literal the compiler flags, wherever it is (e.g. `test/unit/button/*`, `test/unit/content/*`).
    10. **E2E** (`e2e/cuj5.spec.ts`, `@cuj5`). Update `ARIA_LOGIN` to `Log in to pixiv to download this work.` and the AC→test comment at the top, then add:
        - (i) Logged out on 135882745:
          - `Log in to download` before any click: white fill, 1.5 px `#c4c7c5` border, `#3c4043` text, no icon, the tooltip `Opens pixiv login and returns you here`, and the `aria-label` above;
          - the click goes to `https://accounts.pixiv.net/login?return_to=` + the encoded artwork URL;
          - after the fake login, the page shows `Download · 4P`, and a click saves 4 originals.
        - (ii) Pending click:
          - `server.hold('/ajax/illust/135882745')` before opening the page. It drip-feeds and never stalls; see e2e/README.md "Stall timeout".
          - Click while the button is still `Download` with no hint, then release.
          - The button ends `Log in to download`, and `server.requests()` shows no `/ajax/illust/135882745/pages` and no `i.pximg.net` request for 135882745.
        - (iii) Logged in on 135882745: `Download · 4P`, and the download saves 4 files.
- **Files**:
  - Shared: `src/shared/{types,job,constants,pixiv-api,messages,retry,outcome}.ts`
  - Service worker: `src/background/{resolver,handlers,engine,downloads}.ts`
  - Offscreen: `src/offscreen/offscreen.ts` (`failureOf`, non-encode branch only)
  - Content script: `src/content/content.ts`, `src/content/button/model.ts`
  - Copy: `src/_locales/{en,ja,zh_CN,zh_TW}/messages.json`
  - Fixtures: `test/fixtures/api/illust-walled.json`, `test/fixtures/api/illust-visible.json`
  - Unit tests: `test/unit/{retry,outcome,pixiv-api,messages}.test.ts`, `test/unit/background/engine-*.test.ts`, `test/unit/offscreen/offscreen.test.ts`, `test/unit/button/{model,labels}.test.ts` (plus `WorkInfo`-literal fixes in other `test/unit/button/*` and `test/unit/content/*` files), `test/unit/content/content.test.ts`, `test/integration/*` as needed
  - E2E: `e2e/fixtures/works.ts`, `e2e/server/{ajax,server,page}.ts`, `e2e/cuj5.spec.ts`
- **Done when**:
  - `npm run check` passes.
  - `HFP_HEADLESS=1 npm run test:e2e -- --grep @cuj5` passes, and the full `HFP_HEADLESS=1 npm run test:e2e` passes, because the fake server and fixtures are shared by every spec.
  - `grep -rn "R-18 work" src/_locales` prints nothing.
  - Every unit case listed in step B9 exists and passes.
  - **QA bug repro, unit level:** a pages job whose failures are all `{ kind: 'network', lastStatus: 503 }` classifies as `{ type: 'error', cause: 'server' }`, and one with plain `network` failures classifies as `offline`. QA re-runs the end-to-end replay `diagOutage.ts` against the merged dev build.
  - A logged-out click on a withheld work, made before its metadata arrived, never reaches `/pages`, `ugoira_meta` or `i.pximg.net` (e2e (ii)).

### Task: 2.2 CUJ-3: clear `Saved` when a validation error shows; options-page contrast values
- **Do**:
  - **Why.**
    - **QA iteration-1 LOW bug (CUJ-3).** "A green `✓ Saved` from the previous valid save stays visible (up to 2 s) beside the **Download folder** heading while the field shows a validation error. This contradicts PRD CUJ-3 step 5 ('No `Saved` appears') and the `cuj-3-error` mock. Repro: insert a chip (valid, saves), then within 2 s type `pixiv/{artst}-{id}`." The cause: `showError` (`src/options/page.ts`) never cancels the indicator, which runs on its own timer (`src/options/saved.ts`).
    - **Contrast.** PRD index "Accessibility", verbatim: "Every other text/background pair the extension introduces must meet WCAG 2.1 AA (4.5:1)."
  - **Read** `docs/design/design-options-page.md`: "Styles" (token table), "Validation, preview and save" (flowchart), "`Saved` indicator" (the `SavedIndicator` interface and "An error always clears the folder section's `Saved`"), "A11y" and "Testing". Also read `docs/design/system.md` §11.5 (contrast table).
  1. `src/options/saved.ts`: add `clear()` to `SavedIndicator`. It cancels both timers, empties the element and sets opacity 0 at once, with no fade. A later `flash()` still works.
  2. `src/options/page.ts`:
     - `showError()` calls the folder section's indicator `clear()` before it renders the message.
     - In `save()`, the folder flash runs only if the field shows no error (`error === null`) when `writeSettings` resolves. The write itself still counts.
     - The Ugoira and metadata indicators are untouched.
  3. `src/options/options.css`. Give text and border separate variables, so the field border no longer shares the text colour:
     - `Saved` text: light `#188038`; dark keeps `#1a9f5a`.
     - Validation message text: light `#c5221f`, dark `#f28b82`.
     - Invalid field border: stays 2 px `#d93025` in both modes.
     - "Still using" trailing sentence (`.muted`): light `#5c6166`; dark keeps `#8a8f94`.
  4. Unit tests:
     - `test/unit/options/saved.test.ts`: `clear()` cancels a pending hide and fade, empties the element immediately, and a re-flash after `clear()` shows `Saved` again.
     - `test/unit/options/page.test.ts`:
       - a valid save, then an invalid edit within 2 s → the folder indicator is empty the moment the error renders;
       - a write that resolves after the field turned invalid does not flash;
       - the other two indicators are unaffected.
  5. `e2e/cuj3.spec.ts` (`@cuj3`):
     - Add the regression: insert the `{id}` chip, then within 2 s fill `pixiv/{artst}-{id}`. While the error shows, `saved('folder')` is empty, both at once and for the next 2 s.
     - Update the colour assertions to the new values in light and dark: the error text colour, the `Saved` colour (currently `rgb('#1a9f5a')` around line 698) and the "Still using" trailing text. The field border assertions stay `#d93025`.
- **Files**: `src/options/saved.ts`, `src/options/page.ts`, `src/options/options.css`, `test/unit/options/saved.test.ts`, `test/unit/options/page.test.ts`, `e2e/cuj3.spec.ts`
- **Done when**:
  - `npm run check` passes.
  - `HFP_HEADLESS=1 npm run test:e2e -- --grep @cuj3` passes, including the new regression test.
  - QA's repro (chip, then `pixiv/{artst}-{id}` within 2 s) shows no `Saved` beside Download folder at any moment while the error is visible.
  - The computed colours match design-options-page.md "Styles" in light and dark.

### Task: 2.3 CUJ-1/CUJ-3: token values made only of `~`/`.` resolve to `unknown`; Golden rows
- **Do**:
  - **Why.** Code review W3/W4 and pm-review priority 4: `resolveFolder('pixiv/{artist}/{title}', artist '~')` returns `pixiv/T` and loses a folder level. This contradicts PRD §4.4 step 1.6 ("If the result is empty, use `unknown`") and the CUJ-1 edge case "A name that sanitizes to nothing becomes `unknown` (`pixiv/unknown-135882741`). The folder never gets an empty segment."
  - **Read** `docs/design/design-settings-model.md`: "Resolution" (sanitization table, step **4+** and "Why step 4+"), "Golden examples", and "Testing".
  1. `src/shared/pattern.ts` `sanitizeToken`: when `parityOnly` is false, the step-4 edge trim and the re-trim after step 5's truncation use the class `[._ ~]` instead of `[._ ]`. With `parityOnly: true`, the script's `[._ ]` stays exactly as is.
  2. `test/unit/pattern.test.ts`: one test per Golden row, and fix any existing expectation of the old wrong `sora~-1`:
     - artist `~`, pattern `pixiv/{artist}/{title}`, title `T` → `pixiv/unknown/T`;
     - title `.~.`, pattern `{title}` → `unknown`;
     - artist `~sora~`, pattern `{artist}-{id}`, id `1` → `sora-1`, while `sanitizeToken('~sora~', { parityOnly: true })` is still `~sora~`;
     - artist `so~ra` → `so_ra-1`;
     - literal pattern `~sora~-1` → `sora_-1`.
  3. The property test (`test/unit/pattern-property.test.ts`) and the golden parity test must pass unchanged.
- **Files**: `src/shared/pattern.ts`, `test/unit/pattern.test.ts`
- **Done when**:
  - `npm run check` passes.
  - `python3 -I scripts/gen-golden.py --check` exits 0, and `git diff --exit-code test/golden/` shows that the golden vectors are unchanged.
  - `npx vitest run test/unit/pattern.test.ts test/unit/pattern-property.test.ts test/unit/golden-safe-component.test.ts` passes, including `resolveFolder('pixiv/{artist}/{title}', { artist: '~', id: '1', title: 'T', userId: null }) === 'pixiv/unknown/T'`.

### Task: 2.4 CUJ-4: the action title is idle when no file is counted
- **Do**:
  - **Why** (code review W1, pm-review item 5i). A lone `retryMetadata` job, or a `full` job clicked before its metadata arrived (`expectedFiles` 0) while it resolves, makes the title read "Helper for Pixiv — 0 files remaining" while the badge is hidden. PRD §4.8: "With nothing in flight, the badge is hidden (empty text)", and "Nothing in flight: `Helper for Pixiv — click to open settings`".
  - **Read** `docs/design/design-download-engine.md` "Badge and action title (badge.ts)": the pseudo-code and the "Zero counted files" bullet.
  1. `src/background/badge.ts`:
     - `total === 0` → `action_title_idle`.
     - The job count passed to `action_title_many`, and used to choose the one-job form, counts only running jobs with `remaining(job) > 0`.
     - Badge text, `999+` and the singular form are unchanged.
  2. `test/unit/background/badge.test.ts`:
     - a lone `retryMetadata` job → idle title and empty badge;
     - a resolving `full` job with `expectedFiles` 0 → idle title;
     - one counting job plus one 0-count job → the one-job form (`Helper for Pixiv — 5 files remaining`);
     - the existing `999+` and singular cases still pass.
- **Files**: `src/background/badge.ts`, `test/unit/background/badge.test.ts`
- **Done when**:
  - `npm run check` passes.
  - `HFP_HEADLESS=1 npm run test:e2e -- --grep @cuj4` passes as a regression check (no spec edits needed).

### Task: 2.5 Content bundle size budget, checked in CI (ENG-010)
- **Do**:
  - **Why.** The content script runs on every pixiv page. `docs/design/system.md` §11.6 replaces the old "< 30 KB" guess with a measured budget: `content.js` ≤ **40 KB minified** and ≤ **15 KB gzip** (34.4 KB / 12.6 KB with the prod defines on 2026-10-23). The shipped `build:prod` stays unminified for Web Store review, so the check minifies separately. Read `docs/design/design-test-harness.md` "Bundle budget".
  1. `scripts/size.mjs`:
     - esbuild-bundle `src/content/content.ts` with `format: 'iife'`, `target: 'chrome116'`, `minify: true` and the prod defines `__DEBUG__=false`, `__RETRY_TIME_SCALE__=1`, `__TEST_HOOKS__=false`, written in memory (`write: false`).
     - gzip the output with `node:zlib` at level 9.
     - Print both sizes in KB, and exit 1 above either limit.
     - The limits default to 40 / 15 KB and can be overridden with `--max-min-kb N` and `--max-gzip-kb N`.
  2. `package.json`: script `"size": "node scripts/size.mjs"`. No dependency changes.
  3. `.github/workflows/ci.yml`: a step `npm run size` right after `npm run check`.
- **Files**: `scripts/size.mjs`, `package.json`, `.github/workflows/ci.yml`
- **Done when**:
  - ENG-010 Verify prints `SIZE OK`: `npm run size && ! node scripts/size.mjs --max-min-kb 1 --max-gzip-kb 1 && grep -q "npm run size" .github/workflows/ci.yml && echo SIZE OK`
  - `npm run check` passes, which includes eslint and prettier on the new `.mjs`.

## Parallel Group 3 (depends on Group 2)

### Task: 3.1 CUJ-1/CUJ-5: provisional button width from the 2-digit faces, hint ellipsis, Unavailable text contrast, shared pill height
- **Do**:
  - **Why.**
    - **pm-review CUJ-1 caveat.** "If pixiv renders the action row before `/ajax/illust` answers … the width locks on `candidates(null)` (`src/content/button/width.ts:40`): the 99-page faces plus every ugoira face. That measures 176 px in English (`Download · WebM`). `settleWidth` never shrinks. … So an illustration whose metadata arrives late stays at 176 px. That breaks the AC '164 px … on a work of 99 or fewer pages' and §4.7.2."
    - PRD §4.7.2, verbatim: "If the page count is unknown at first render, the button starts at the 2-digit width and may widen once, when the metadata arrives and before any interaction."
    - **Contrast.** The Unavailable text `#80868b` on `#f1f3f4` is 3.31:1. PRD §4.7.3 marks these colours "(assumption — confirm; not mocked)", and the index rule requires 4.5:1 for every other pair.
    - **Code review W9.** `PILL_HEIGHT_PX` is duplicated in `src/content/mount.ts`.
  - **Read** `docs/design/design-artwork-button.md`: "Fixed width (button/width.ts)" (the "Provisional width" and "Ugoira width" bullets) and "Styles" (Variants, "Pill height"). Also `docs/design/system.md` §11.5.
  1. `src/content/button/width.ts`: `candidates(null)` returns the 99-page faces only (`pageCandidates(99)`). Ugoira works keep every format's faces once their metadata is known.
  2. `src/content/button/styles.ts`:
     - `.hint` gets `min-width: 0; overflow: hidden; text-overflow: ellipsis`, and the icon and label do not shrink. On a provisional-width ugoira with WebM effective, the hint then reads `Saved · We…` instead of overflowing the pill's border.
     - `.pill.disabled` text becomes `#5f6368`.
     - Export `PILL_HEIGHT_PX = 40` and interpolate it into the stylesheet's `height`.
  3. `src/content/mount.ts`: import `PILL_HEIGHT_PX` from `./button/styles` and delete the local constant.
  4. Unit tests:
     - `test/unit/button/width.test.ts`:
       - `candidates(null)` has no ugoira face;
       - `computeWidth(null, 'en', …)` with real-size measures gives the 164 floor;
       - an ugoira widens once through `settleWidth` before interaction and never after.
     - `test/unit/button/styles.test.ts`: the disabled colour, the `.hint` rule, and the interpolated height.
     - `test/unit/content/mount.test.ts`, if it referenced the old constant.
  5. E2E:
     - `e2e/cuj1.spec.ts` (`@cuj1`): `server.hold('/ajax/illust/135882741')` before opening 135882741. The action row renders first. The host width is 164 px before the release and still 164 px in idle `Download · 12P` after it.
     - `e2e/cuj5.spec.ts`: change only the `GRAY_TEXT` constant to `'rgb(95, 99, 104)'` (`#5f6368`).
     - Do **not** edit `e2e/cuj2.spec.ts`; task 3.2 owns it.
- **Files**: `src/content/button/width.ts`, `src/content/button/styles.ts`, `src/content/mount.ts`, `test/unit/button/width.test.ts`, `test/unit/button/styles.test.ts`, `test/unit/content/mount.test.ts`, `e2e/cuj1.spec.ts`, `e2e/cuj5.spec.ts` (the `GRAY_TEXT` line only)
- **Done when**:
  - `npm run check` passes.
  - `HFP_HEADLESS=1 npm run test:e2e -- --grep "@cuj1|@cuj2|@cuj5"` passes. `@cuj2` is a read-only regression: the ugoira pill stays 176 px in English once its metadata is known.
  - A ≤ 99-page illustration with late metadata is 164 px throughout (new e2e).
  - The Unavailable pill's computed text colour is `rgb(95, 99, 104)`.

### Task: 3.2 Fake pixiv prebuilds its fixture zips; e2e README brought up to date (ENG-009)
- **Do**:
  - **Why** (code review W11).
    - The fake server builds an ugoira zip synchronously on its first request. For 136004517 (1920×1080, 300 frames) that takes ~1.5 s, beyond the e2e build's 300 ms stall timeout, so specs must call `warmZip()` first, a trap for every new spec.
    - `e2e/README.md` is also stale: its CUJ-5 mapping still says "next iteration", and it lacks the R-003 fixture that task 2.1 added.
  - **Read** `docs/design/design-test-harness.md`: "Fake pixiv server" (the login-walls paragraph), "Fixtures" (row 135882745, the "Zip prebuild (ENG-009)" and "Holding a response" bullets), "L3 → PRD AC mapping" and "L4: Live smoke".
  1. **ENG-009 scope:**
     - `e2e/server/server.ts` `FakePixiv.start()` builds every ugoira fixture's zip (`ugoiraZip(work)` for each `illustType === 2` work in `WORKS`) **before** `listen`.
     - Remove `warmZip()` and all its calls from `e2e/cuj2.spec.ts`.
     - Add a self-test to `e2e/harness.spec.ts`, named exactly `fake server: fixture zips are prebuilt`. It starts a fresh server, times the first request for 136004517's zip, and expects the response headers within 300 ms.
  2. **`e2e/README.md`:**
     - Delete the `warmZip` trap paragraph under "Fixtures", and state that zips are prebuilt at server start.
     - Add fixture row **135882745** (4-page illust, `xRestrict` 0, `sensitiveWall`, R-003).
     - Document the `sensitiveWall` flag and the login-wall behaviour under "Fake server": `sl` 6/4/2; `urls` null for a logged-out viewer of R-18 or `sensitiveWall` works; `/pages` answers normally for `sensitiveWall`; the wall text on the page.
     - Retitle the CUJ-5 section `### CUJ-5 (cuj5.spec.ts, @cuj5)` and replace its rows with the AC→test mapping from the top of `e2e/cuj5.spec.ts`, including the R-003 rows task 2.1 added.
     - Under "Running", note that the live smoke navigates with `domcontentloaded` and has a login-wall case (design-test-harness.md L4).
     - Run `npx prettier --write e2e/README.md`; prettier checks this file.
- **Files**: `e2e/server/server.ts` (start-up only), `e2e/cuj2.spec.ts`, `e2e/harness.spec.ts`, `e2e/README.md`, and `e2e/fixtures/assets.ts` only if the cache needs an export
- **Done when**:
  - ENG-009 Verify prints `PREBUILD OK`, with every listed test passing: `! grep -rn "warmZip" e2e && npm run build:e2e && npx playwright test e2e/harness.spec.ts e2e/cuj2.spec.ts --reporter=line && npx playwright test e2e/harness.spec.ts -g "fixture zips are prebuilt" --reporter=line && echo PREBUILD OK`
  - `npm run check` passes.
  - `HFP_HEADLESS=1 npm run test:e2e` (full suite) passes, because server start-up changes for every worker.

### Task: 3.3 Live smoke: domcontentloaded, visible-work filter, login-wall case, live ugoira walk
- **Do**:
  - **Why.**
    - **QA iteration-1 LOW FLAKY.** "`e2e/live/smoke.spec.ts` failed 2 of 5 runs with 'Test timeout of 180000ms exceeded' … `page.goto` at `e2e/live/smoke.spec.ts:115` waits for pixiv's `load` event, which took 43 s, 119 s and 46 s … The extension saved 4–10 s after the button appeared every time."
    - **R-003.** Without a `urls.original` filter, the smoke picks a walled work about one time in five (31 of 150 ranking works on 2026-10-23), and that work now correctly shows `Log in to download`. The walled case is also the drift alarm for the system.md §8.5 signal.
    - **pm-review priority 7a.** A live all-ages ugoira walk, which needs no account.
  - **Read** `docs/design/design-test-harness.md` "L4: Live smoke" and `docs/design/system.md` §8.5 (evidence).
  1. Every `page.goto` in `e2e/live/` passes `{ waitUntil: 'domcontentloaded' }`; the button and file waits keep their own timeouts.
  2. **Download case selection.** For each ranking entry, fetch its logged-out `/ajax/illust/<id>` body. Require `xRestrict === 0`, `illustType === 0`, ≤ the existing page cap, **and** `typeof body.urls.original === 'string'`. The existing assertions stay as they are: row placement, each file's size = HEAD `Content-Length` with the pixiv Referer, and the 12 metadata keys.
  3. **New login-wall test** (`@live`). Pick the first entry of the illust ranking with `xRestrict === 0` and `urls.original === null`; fall back to the manga ranking. Then:
     - Before any click, the button reads `Log in to download`, with `aria-label` `Log in to pixiv to download this work.` and title `Opens pixiv login and returns you here`.
     - Clicking navigates to a URL that starts with `https://accounts.pixiv.net/login?return_to=` followed by the URL-encoded artwork page URL as it was (keep any `/en/` prefix pixiv redirected to).
     - If the day's rankings have no walled all-ages entry, `test.skip` with a logged reason.
  4. **New live ugoira test** (`@live`). Use `ranking.php?mode=daily&content=ugoira&format=json` and take the first entry with `xRestrict === 0` and `urls.original` a string.
     - (a) Default settings:
       - the button shows `Download · MP4`, or `Download · WebM` if the browser's H.264 probe fails, then `Saved · <format>`;
       - the folder holds `<id>_ugoira.zip` (size = HEAD `Content-Length` of `ugoira_meta.body.originalSrc` with the pixiv Referer), `frames.json` deep-equal to `ugoira_meta.body.frames`, a non-empty `<id>.mp4`/`.webm`, and `metadata.json` with the 12 keys.
     - (b) Ugoira output set to ZIP only, the same way `e2e/cuj2.spec.ts` sets it:
       - the button shows `Download · ZIP`, then `Saved · ZIP`;
       - the folder holds the zip and `frames.json`, and no video.
     - Skip with a logged reason if no candidate exists.
  5. Edit only `e2e/live/smoke.spec.ts`; task 3.2 owns `e2e/README.md`.
- **Files**: `e2e/live/smoke.spec.ts`
- **Done when**:
  - `npm run check` passes.
  - `HFP_LIVE=1 npm run test:e2e -- --grep @live` passes **twice in a row** (needs network to `www.pixiv.net` and `i.pximg.net`). Report the work IDs used and whether any case was skipped, with its reason.
  - Without network, report the live run BLOCKED instead of claiming a pass. `npm run check` must still pass.

### Task: 3.4 Encode failures report how many encoder passes ran (ENG-011)
- **Do**:
  - **Why** (code review W8). `src/offscreen/offscreen.ts` `failureOf` reports every encode failure with `attempts: 1`, because `EncodeError` does not record whether the prefer-software retry ran. The fix is observability only; no outcome changes.
  - **Read** `docs/design/design-offscreen-worker.md`, row "Encoder failure" of the encode table.
  - Task 2.1 already changed `failureOf`'s non-encode branch to `internal`; keep that branch as it is.
  1. `src/offscreen/ugoira/encode.ts`:
     - `EncodeError` gains `attempts: 1 | 2`.
     - The prefer-software path rethrows with `attempts: 2` when that second pass also failed.
     - Every failure the retry does not apply to has `attempts: 1`: a missing zip, invalid frames, or an `EncodeError` such as a corrupt zip entry raised inside the first pass.
  2. `src/offscreen/offscreen.ts` `failureOf`: for an encode task, copy `error.attempts`, or 1 when the error is not an `EncodeError`.
  3. Unit tests whose names contain `encode failure attempts`:
     - a failure before any retry → 1;
     - a hardware failure followed by a failing prefer-software pass → 2.
- **Files**: `src/offscreen/ugoira/encode.ts`, `src/offscreen/offscreen.ts` (encode branch of `failureOf`), `test/unit/ugoira/encode.test.ts`, `test/unit/offscreen/offscreen.test.ts`
- **Done when**:
  - ENG-011 Verify prints `ATTEMPTS OK`: `npx vitest run -t "encode failure attempts" --reporter=json --outputFile=.eng011.json; node -e "const r=require('./.eng011.json'); process.exit(r.numPassedTests>=2&&r.numFailedTests===0?0:1)" && rm -f .eng011.json && npm test && echo ATTEMPTS OK`
  - `npm run check` passes.

### Task: 3.5 Prod bundle carries no test-hook code, checked in CI (ENG-007)
- **Do**:
  - **Why** (code review W5).
    - `engine.ts`, `registry.ts` and `resolver.ts` import `__testHook` under the alias `testHook`, so the guard `! grep -qE '__testHook|__hfpTest' dist/sw.js` passes by name only. The unminified prod `dist/sw.js` still carries 8 dead `if (false) await testHook("await:…")` statements.
    - esbuild drops dead `if (false)` branches only with `minifySyntax`.
    - **Read** `docs/design/design-test-harness.md` "Build variant".
  1. `scripts/build.mjs`: for `--prod`, set esbuild `minifySyntax: true`. Keep `minifyWhitespace` and `minifyIdentifiers` off, so the bundle stays readable for store review. The dev and e2e builds are unchanged.
  2. Remove the `__testHook as testHook` alias imports and their comments in `src/background/{engine,registry,resolver}.ts`, importing `__testHook` under its own name. Touch only those import lines and call sites; `resolver.ts` and `engine.ts` were just changed by task 2.1.
  3. `.github/workflows/ci.yml`: after `npm run check`, keep ENG-010's `npm run size` step and add `npm run build:prod && ! grep -qE 'testHook|__hfpTest|await:(registry|resolver|handoff)' dist/*.js`.
  4. If `test/unit/build-script.test.ts` asserts the build options, extend it for `minifySyntax` in prod.
- **Files**: `scripts/build.mjs`, `src/background/{engine,registry,resolver}.ts` (hook imports only), `.github/workflows/ci.yml`, `test/unit/build-script.test.ts` if applicable
- **Done when**:
  - ENG-007 Verify prints `PROD CLEAN`: `npm run build:prod && ! grep -qE 'testHook|__hfpTest|await:(registry|resolver|handoff)' dist/*.js && grep -q 'build:prod' .github/workflows/ci.yml && npm run check && echo PROD CLEAN`
  - `HFP_HEADLESS=1 npm run test:e2e` (full suite) passes, because the e2e builds keep their hooks.

### Task: 3.6 Store packaging, third-party notices, release checklist (ENG-006)
- **Do**:
  - **Why.**
    - Web Store submission (PRD index "Store readiness") needs a reproducible production zip.
    - mediabunny is MPL-2.0 and fflate is MIT, so their license texts must ship with the package.
    - Several release checks cannot be automated (design-test-harness.md "L5: Manual release checklist").
  - **Read** `docs/design/system.md` §5 (manifest and permission justifications) and §12 (`npm run zip`), `docs/design/design-test-harness.md` L5, `docs/pm-review.md` priority 7 (items 7a and 7d), and `docs/rulings.md` R-001.
  1. `scripts/zip.mjs`:
     - Run `npm run build:prod`.
     - Write `dist/THIRD_PARTY_NOTICES.txt` from `node_modules/mediabunny/LICENSE` and `node_modules/fflate/LICENSE`, with a header per package giving its name, version and SPDX id.
     - Zip the **contents** of `dist/` at the archive root into `helper-for-pixiv-<package.json version>.zip` at the repository root, excluding `*.map`.
     - Use `fflate` (already a dependency, `zipSync`): no new dependency, and no edit to `scripts/build.mjs` (task 3.5 owns it).
  2. `package.json`: script `"zip": "node scripts/zip.mjs"`. `.gitignore` already ignores `*.zip`.
  3. Create `docs/release-checklist.md` covering:
     - the L5 manual checks of design-test-harness.md:
       - H.264 hardware encode of a live ugoira;
       - MP4 in QuickTime, Windows Photos/Media Player and VLC, and WebM in Chrome and VLC;
       - "Ask where to save each file" on;
       - the 4 locales render without clipping;
     - the logged-in checks, run by the owner with `npm run qa:live` and their own session:
       - action-row placement on the logged-in DOM;
       - pixiv's dark theme and the `#5fb9fb` focus ring;
       - an R-18 download after a real login;
       - R-18 display off → `Retry` + `tip_refused`;
       - the R-003 stale-page probe;
     - a live all-ages ugoira walk (pm 7a);
     - store listing items (name, short description, full description, screenshots) in en/ja/zh_CN/zh_TW;
     - the permission justification texts from system.md §5;
     - the privacy disclosure "no data collected or transmitted";
     - "the repository `kyoicn/pixivhelper` is public" (R-001);
     - "manifest version equals `package.json` version".
- **Files**: `scripts/zip.mjs`, `package.json`, `docs/release-checklist.md`
- **Done when**:
  - ENG-006 Verify prints `PACKAGE OK`: `npm run zip && Z=helper-for-pixiv-$(node -p "require('./package.json').version").zip && test "$(unzip -l "$Z" | grep -cE ' (manifest.json|sw.js|content.js|offscreen.html|options.html|THIRD_PARTY_NOTICES.txt)$')" = 6 && test "$(unzip -l "$Z" | grep -c '\.map$')" = 0 && test -f docs/release-checklist.md && echo PACKAGE OK`
  - The zipped `manifest.json` version equals `package.json`'s.
  - `npm run check` passes.
  - The generated zip is not committed.

## Conflict Risks

- **`src/shared/types.ts`, `src/shared/job.ts`, `src/shared/outcome.ts`, `src/shared/messages.ts`, `src/shared/retry.ts`, `src/shared/pixiv-api.ts`, `src/shared/constants.ts`:**
  - 1.1 moves `job.ts` and edits import lines.
  - In Group 2, only 2.1 edits any of these files. They are the reason R-003 and the outage classification are one task: both change `FailureKind`/`WorkInfo`, row 4/row 8 of `outcome.ts`, the `messages.ts` guards, and the resolver.
  - No Group 3 task edits them. If one needs a shared type, keep it module-local and report it.
- **`src/background/resolver.ts`, `engine.ts`:**
  - 1.1 (imports) → 2.1 (login-wall stop, `internal` failures) → 3.5 (hook-alias import lines only).
  - `src/background/registry.ts`: 1.1 → 3.5.
  - `src/background/handlers.ts`, `downloads.ts`: 1.1 → 2.1.
  - `src/background/badge.ts`: 1.1 (import) → 2.4.
- **`src/offscreen/offscreen.ts`:** 2.1 changes the non-encode branch of `failureOf` to `internal` (Group 2) → 3.4 changes the encode branch's `attempts` (Group 3). The two never run in the same group.
- **`e2e/server/**`, `e2e/fixtures/works.ts`:**
  - 2.1 adds `sensitiveWall`, fixture 135882745 and the `sl`/`urls` logic (Group 2).
  - 3.2 changes only `FakePixiv.start()` to prebuild zips (Group 3).
  - Nobody else edits them; 3.1 and 3.3 only call `server.hold()` and the existing API.
- **`e2e/README.md`:** only 3.2 edits it, in Group 3. 2.1 must not touch it, even though it adds the fixture.
- **E2E specs:**
  - `e2e/cuj5.spec.ts`: 2.1 (Group 2) → 3.1 (Group 3, the `GRAY_TEXT` constant only).
  - `e2e/cuj1.spec.ts`: 3.1 only.
  - `e2e/cuj2.spec.ts`: 3.2 only. 3.1 must not add width checks there.
  - `e2e/cuj3.spec.ts`: 2.2 only.
  - `e2e/cuj4.spec.ts`: nobody (2.4 only runs it).
  - `e2e/harness.spec.ts`: 3.2.
  - `e2e/live/**`: 3.3.
- **`.github/workflows/ci.yml`:** 2.5 adds `npm run size` (Group 2) → 3.5 adds the prod-bundle grep after it (Group 3). Never in the same group.
- **`package.json` / `package-lock.json`:** 2.5 adds `size` (Group 2) → 3.6 adds `zip` (Group 3). No dependency changes anywhere.
- **Scripts:** `scripts/build.mjs` belongs to 3.5 only, `scripts/zip.mjs` to 3.6, and `scripts/size.mjs` to 2.5.
- **Locale files `src/_locales/*/messages.json`:** only 2.1 edits them, and only `aria_login`. 2.2 and 3.1 change no copy.
- **`src/shared/pattern.ts`:** 2.3 only. `src/options/**` and the preview only call `resolveFolder`.
- **`src/content/button/width.ts`, `styles.ts`, `src/content/mount.ts`:** 3.1 only.
  - 2.1 may have to add `withheld` to `WorkInfo` literals in `test/unit/button/width.test.ts`, `test/unit/content/mount.test.ts` and other button/content tests (Group 2). 3.1 edits those test files afterwards (Group 3), so the work is sequential, not parallel.
- **`src/content/content.ts`, `src/content/button/model.ts`, `labels.test.ts`:** 2.1 only.
- **`eslint.config.js`:** 1.1 only.
- **Semantic, not textual:**
  - 2.5 measures the content bundle before 2.1's R-003 code (< 0.3 KB) merges. The 40/15 KB budget has headroom, and CI re-measures the merged tree.
  - 3.5's grep and 3.3's live walled case both run against the merged Group 2 code, which is why they wait for Group 3.

**Parallelism:** 12 tasks in 3 groups (1 + 5 + 6). The critical path is 1.1 → 2.1 → the longest Group 3 task (3.2, 3.3 or 3.5): about 3 task-lengths of wall-clock instead of 12 sequential ones. 2.1 is the largest single task by design (tl's shared-file constraint). The other Group 2 tasks are small and will finish well before it.
