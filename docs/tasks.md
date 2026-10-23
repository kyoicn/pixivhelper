# Task Plan

Last updated: 2026-10-23 16:51:22 (UTC-7)

## Current State

- **Dev-cycle iteration 3, Phase 2.** Iteration 2's plan (12 tasks, ENG-006 … ENG-011) is merged on `main`. Iteration-2 QA (`docs/qa-report.md`, run `iter2-03-48-13`) is FAIL with 4 LOW findings only:
  - CUJ-3: pasted line breaks become spaces. `e2e/cuj3.spec.ts` "edge: newlines …" is **red on `main`** by design until task 1.3 lands.
  - CUJ-5: 1 of 7 Retries during a sustained 503/500 still reads "No connection".
  - CUJ-5: the floating fallback lands at 3011–3079 ms.
  - CUJ-2: the 176 px ugoira pill. Since R-004 S1 this is PRD text, so it is no longer a deviation.
- **PM iteration 2:** CUJ-1, CUJ-2 and CUJ-4 Satisfied; CUJ-3 and CUJ-5 Caveats.
- **Since then:**
  - The owner ruled R-004 (approve S1–S15) and R-005 (hide Chrome's download UI while a job runs), and pm applied both to prd-000 and the mocks (`053621c`, `c7b0595`).
  - `docs/status.md` resets CUJ-1/2/4/5 per R-005.
  - tl updated all seven design docs:
    - system.md D12 (`download-ui.ts`), D13 (`Failure.answered` + `JobRecord.answered`, replacing `lastStatus`) and D14 (fallback timer at 3000 − 250 ms);
    - §5 (five permissions), §9, §10 row 8, §11.5 and §11.6;
    - the chapters' "Chrome's download UI", "Mounting", "Fixed width" (`UGOIRA_LOCALE_FLOOR_PX`), `single-line.ts`, the S15 layout, rule 5 (S5) and the e2e `__hfpTest.downloadUi()` check.
  - The owner queue is empty, `docs/eng-backlog.md` is empty, and no routed defects exist.
- **Focus (priority ladder):**
  - Tier 1 (MEDIUM+ bugs) and tier 2 (`blocking` ENG) are empty.
  - Tier 3 is the open CUJ work. tl pre-split it into four tasks that touch disjoint sets of files, and this plan keeps that split, so all four run in **one parallel group**:
    - 1.1: the S3 job-level outage rule (CUJ-5);
    - 1.2: R-005, Chrome's download UI (CUJ-1/2/4/5);
    - 1.3: the CUJ-3 fixes (paste, S5, S15);
    - 1.4: the content-script fixes (D14 timer, 176 px ugoira floor).
  - Tier 4 (LOW bugs, P2) has nothing left.
- **Orchestrator prerequisite.** tl's iteration-3 design-doc edits are **uncommitted** on `main`: `docs/design/*.md` and `docs/loop-state.md`, plus this file. Commit them before creating worktrees. Every task cites design sections that exist only in the working tree today, and a worktree branched from `HEAD` would not see them.
- **Rules for every task:**
  - **Done-gate.** `npm run check` (typecheck + eslint + prettier + vitest + build), plus the task's `HFP_HEADLESS=1 npm run test:e2e -- --grep @cujN`. Task 1.2 also runs the full e2e suite and the prod-bundle grep.
  - **Design docs.** Read the design sections named in the task before coding. Do not edit `docs/prd/**` or `docs/design/**`; report a design gap in the commit message or task summary instead.
  - **Dependencies.** No task adds a dependency or edits `package.json`/`package-lock.json`.
  - **Exhausted-retry e2e.** Under the e2e build, Chromium throttles an extension's repeated 500/503 answers, so a test that asserts 4 server attempts keeps using 502/504. Only task 1.1's sustained-outage test uses 503 on purpose.
  - **Commits.** Use conventional messages, one commit per separable part.
  - **Shared files.** Edit only your own blocks of `e2e/cuj5.spec.ts` and only your own sections of `e2e/README.md` (see Conflict Risks). After `npx prettier --write e2e/README.md`, `git diff e2e/README.md` must show changes only inside your sections.
- **QA expectations for iteration 3** (deliberate behaviour, not bugs):
  - **Floating fallback.** The floating pill now appears at about **2.75 s** after route entry: the timer fires at 2750 ms, so placement lands inside the 3 s. The e2e and `diagFloat.ts` measure from `domInteractive` on a direct load and from the in-page click on SPA navigation, to the first frame after the host connects; both must be ≤ 3000 ms. Cost (accepted in D14): a row that pixiv renders between 2.75 s and 3 s shows the pill floating for a moment, then moves it into the row.
  - **Ugoira width.** An English ugoira is **exactly 176 px** in idle, busy, Cancel-hover and Saved (`UGOIRA_LOCALE_FLOOR_PX.en`), whatever the Ugoira output. Illustrations and manga stay 164 px, also with late metadata.
  - **"Every original resets" case.** A click where pixiv's API answered but every original's connection reset now reads `pixiv isn't responding. Retry in a few minutes.` (PRD CUJ-5 step 6 "Accepted cost"). The iteration-2 e2e "offline: every original drops its connection" therefore now expects `tip_server`. "No connection" now needs that nothing in the click got an HTTP answer: the network is disconnected, or the fake server is stopped.
  - **Sustained outage.** Every click reads `pixiv isn't responding` (7 of 7), whatever Chromium's throttling does to the image requests. A stopped server still reads `No connection`.
  - **Chrome's download UI (R-005).**
    - Playwright cannot see Chrome's toolbar, bubble or fly-to-toolbar animation. The e2e suite asserts the toggle through `self.__hfpTest.downloadUi()` → `{ requested, calls: [{ enabled, ok, at }] }`, which reports what the extension asked for and that the real Chrome accepted it.
    - The visual effect is an owner/L5 check (`docs/release-checklist.md`), or QA's OS-level screenshot of the headed harness browser: no animation and no downloads button during a job, then the button returns.
    - Side effect accepted by R-005: a download from another site during a job also shows no animation.
  - **Paste.** A paste with line breaks lands as one line without them: `pixiv/⏎{artist}⏎-{id}` becomes `pixiv/{artist}-{id}`. Such a paste is not on the field's native undo stack (accepted design cost).
  - **Unclosed `{` (S5).** `pixiv/{user` and a pause show `Unknown token {user. …` and save nothing. A lone `}` is literal.
  - **"Still using:" (S15)** stays on one line in all four locales.
- **Two new pm spec gaps from tl** (system.md §15 "Open spec gaps"; not tasks, for pm via `/design-feature` or `/spec-sync`):
  1. **A Chrome prompt hidden while the UI is off (R-005).** If Chrome holds a job file for a user decision (a dangerous-file warning, or an Enhanced Safe Browsing deep-scan prompt), that prompt sits in the hidden bubble. The job does not end, so the UI stays hidden until the user acts in `chrome://downloads`. The design follows the PRD as written and does not re-enable early. The L5 checklist covers it on Windows.
  2. **Footer link contrast.** `Reset to defaults` and `Report an issue` are `#0096FA` 13 px on `#f6f7f9`, which is **2.91:1**. That is below the index's 4.5:1 rule, and outside its pixiv-blue acceptance. The build ships the PRD value; pm either extends the acceptance or specifies an AA link colour (tl suggests `#0b6fc2`, 4.82:1).
- **Document-authority notes** (no PRD/design contradiction on user-visible behaviour was found):
  - `docs/design/design-test-harness.md` "Open Questions & Risks" still says the `e2e/README.md` CUJ-5 mapping says "next iteration". That has been stale since iteration 2 (design-only, for tl).
  - `docs/owner-queue.md` reads `Next-ID: R-005`, but R-005 is already ruled in `docs/rulings.md`. The next ID is R-006 (for the orchestrator's owner sweep).

## Parallel Group 1

### Task: 1.1 CUJ-5: "No connection" only when pixiv answered nothing in the click (R-004 S3, D13)
- **Do**:
  - **Why.**
    - **QA iteration-2 LOW bug (CUJ-5).** In QA's dev-build replay (`docs/qa-artifacts/iter2-03-48-13/walk-scripts/diagOutage.ts`), single-page work 135882742 had every original answering 503 (or 500), and the user clicked Retry 7 times. Server hits per click were 4, 3, 2, 2, 1, **0**, 1. On the click with 0 hits, Chromium's extension-request throttling refused all 4 attempts locally, so no request carried `lastStatus`. `isUnanswered` (`src/shared/outcome.ts:27,35`) then classified the job `offline`, and the tooltip read "No connection. Retry when you're back online." This happened although `/ajax/illust` and `/pages` had answered 200 through the tab in that same click. It occurred in 5 of 5 replays.
    - **PRD CUJ-5 step 6 table (R-004 S3), verbatim:**
      - "No connection": "0 pages saved, and either `navigator.onLine === false`, or pixiv answered nothing in this click: no request of this click's job (to `www.pixiv.net` or `i.pximg.net`) got any HTTP response, and every failure is a network error (per R-004 S3)".
      - "pixiv server failure": "0 pages saved, no other cause in this table applies, and pixiv answered at least one request of this click's job (any HTTP status, including the artwork API's 200) or a request timed out. The extension's own internal failures also land here (per R-004 S3, S10)".
    - **PRD CUJ-5 acceptance criteria, verbatim:**
      - "With the network disconnected, clicking Download ends in `Retry` with the tooltip `No connection. Retry when you're back online.`"
      - "During a sustained pixiv outage (every image request answered 500 or 503), every click ends in `Retry` with the tooltip `pixiv isn't responding. Retry in a few minutes.`, including the 7th consecutive Retry; none reads `No connection…` (per R-004 S3)."
  - **Read first:**
    - `docs/design/system.md`:
      - §6: `Failure.answered`, and the `JobRecord.answered` comment;
      - §9: the row "Final failure after an answer (`answered`)";
      - §10: row 8, "How 'answered' is tracked (D13)" with the exact `gotAnswer` / `errorCause` code and its bullets, and "`internal` reads as `server`";
      - §14: D13.
    - `docs/design/design-download-engine.md`:
      - "Data Model" (`JobRecord.answered`);
      - "Resolving": the `Resolution` type with `answered: boolean`, and the "`answered` (R-004 S3, D13)" paragraph with its examples;
      - "Cross-Cutting Concerns → Testing": the row-8 and resolver cases;
      - "Migration / Rollout → Iteration 3".
    - `docs/design/design-offscreen-worker.md`: the body-level-failure paragraph under the fetch pseudo-code.
    - `docs/design/design-test-harness.md`, L3 mapping: the rows "CUJ-5: offline (R-004 S3)" and "CUJ-5 step 6 and AC 'sustained outage, 7th Retry' (R-004 S3)".
  1. **`src/shared/types.ts`.**
     - Remove `Failure.lastStatus`.
     - Add `answered?: true`, with the §6 comment: kind `network` | `timeout` only; some attempt of this request got an HTTP response before it finally failed.
  2. **`src/shared/job.ts`.** `JobRecord` gains `answered?: true`, with the Data Model comment.
  3. **`src/shared/retry.ts`.**
     - Replace `lastStatus` / `withLastStatus` with `answered`. An attempt "got an answer" when `fetch()` resolved with a response (status line and headers). That covers:
       - an earlier 429/5xx `http` failure;
       - a final attempt that failed while reading the body: short or long body, a reset mid-body, or a stall (timeout) mid-body.
     - A `fetch()` that rejects before any response is unanswered. Examples: DNS failure, a refused or reset connection, offline, Chromium's local "Request throttled" refusal.
     - When the request finally fails with `network` or `timeout` and any of its attempts got an answer, the returned `Failure` keeps its `kind` and adds `answered: true`.
     - `http` and `pixivError` never carry the flag (they are answered by definition), and neither does `aborted`.
     - Nothing else in the policy changes: 4 attempts, 403 never retried, `Retry-After` ≤ 30 s, the 30 s stall timer. Update the doc comments that cite `lastStatus`.
  4. **`src/shared/messages.ts` `isFailure`.**
     - Drop the `lastStatus` check.
     - Accept an optional `answered` that is exactly `true`. Any other value under that key (`false`, `1`, `'yes'`) → not a `Failure`.
     - `FAILURE_KINDS` already contains `internal`; keep it.
  5. **`src/shared/outcome.ts`.** Row 8 becomes the job-level rule, exactly as in system.md §10:
     - `const gotAnswer = (f) => f.kind === 'http' || f.kind === 'pixivError' || f.answered === true`.
     - `errorCause(job, list, navigatorOnLine)`:
       - (a) all failures `disk`/`dismissed` → `disk`;
       - (b) `answered = job.answered === true || list.some(gotAnswer)`. `!navigatorOnLine`, or `!answered` with at least one failure and every failure `network` → `offline`;
       - (c) otherwise → `server`.
     - Remove `isUnanswered`, and update the header comments.
  6. **`src/background/resolver.ts`.**
     - `Resolution`'s failure variant becomes `{ ok: false; apiFailure: ApiFailure; answered: boolean }`.
     - The resolve is answered when any of its API steps got a `RetryResult` that is `ok`, or whose failure `gotAnswer()` (export `gotAnswer` from `outcome.ts`, or keep an equivalent module-local predicate).
     - The failure returned for a later step carries the flag. Examples:
       - `full`, `/ajax/illust` 200 then `/pages` with an unanswered `network` failure → `answered: true`;
       - `full`, `/ajax/illust` unanswered `network` → `false`;
       - `retryPages`, `/pages` got 503, 503, then refused attempts → the failure has `answered: true` → `true`;
       - a transport failure of both proxies (`internal`) → `false`, which row 8 still reads as `server`.
     - `applyResolution` sets `job.answered = true`, in the same mutation that applies the resolution, when the resolution is `ok`, is the login-wall stop (`loginRequired`), or is a failure with `answered: true`. It is never cleared.
     - Do not edit `engine.ts`; task 1.2 owns it, and `engine.start()` needs no change because the field is optional.
  7. **Unit tests** (one case per item):
     - `test/unit/retry.test.ts`. Replace the `lastStatus` describe block with an `answered` one:
       - 503, then three `TypeError`s → `{ kind: 'network', answered: true, attempts: 4 }`;
       - a timeout after a 429 → `{ kind: 'timeout', answered: true }`;
       - a short body, then `TypeError`s → `answered: true`;
       - a stall mid-body on every attempt → `timeout` with `answered: true`;
       - `TypeError` on every attempt → no `answered` key;
       - a final `http` failure → its `status`, no `answered`;
       - 403 → 1 attempt, no `answered`;
       - aborted → no `answered`.
     - `test/unit/outcome.test.ts`. Replace the `lastStatus` cases with:
       - a job without `answered` whose only failure is an unanswered `network` API failure → `offline`;
       - a resolved job (`answered: true`) whose every original failed with unanswered `network` → `server`;
       - an API `network` failure with `answered: true` → `server`;
       - any `internal` → `server`;
       - any `timeout` → `server`;
       - `navigator.onLine === false` → `offline`, even when answered;
       - all `disk`/`dismissed` → `disk`;
       - keep row 4 via `stopReason 'forbidden'` with no failed file.
     - `test/unit/messages.test.ts`:
       - `answered: true` on a `network` and on a `timeout` failure → accepted;
       - `answered: false`, `1` and `'yes'` → rejected;
       - delete the `lastStatus` rows.
     - `test/unit/background/engine-resolver.test.ts`:
       - `Resolution.answered` for each example in step 6;
       - `applyResolution` sets `job.answered` for `ok`, for the login-wall stop and for an answered failure, and leaves it absent for an unanswered failure;
       - fix the existing literal `{ ok: false, apiFailure: failure }` (around line 527) to include `answered`.
     - If another unit test (e.g. `test/unit/offscreen/*`, `test/unit/content/api-proxy.test.ts`) asserts an exact failure shape that now gains `answered`, update only that assertion. Do not edit `test/integration/**` or `test/fakes/**` (task 1.2 owns them). No integration test is expected to change; if one fails, stop and report rather than edit it.
  8. **E2E, `e2e/cuj5.spec.ts`.** You own these blocks only:
     - **(a)** the header comment, lines 1–52. Renumber its AC table to the PRD's current 16 CUJ-5 acceptance criteria:
       - 7 = network disconnected;
       - 8 = sustained outage (new, mapped to the new test below);
       - 9–16 shift by one;
       - 15's wording becomes "within 3 s of the page loading or of the in-app navigation, measured to the pill appearing (R-004 S4)".
       - Keep the test title prefixes as they are. Rewrite the Chromium-throttling note and the "Not covered here" paragraph, which no longer applies to the sustained-outage case.
     - **(b)** the test `'offline: every original drops its connection → …'`. Rename it, e.g. `'server failure: every original drops its connection while the API answered → Retry with "pixiv isn’t responding"; Retry re-runs the whole job'`. Expect `TIP_SERVER` (title, `aria-label` and live text); keep the 4-requests-per-page check and the "back online → Saved · 12P" half.
     - **(c)** a new test right after `'server failure: 5xx on every original after 4 attempts …'`, e.g. `'sustained outage: every original answers 503; 7 consecutive clicks each end Retry with "pixiv isn’t responding", never "No connection"'`:
       - `server.fault({ match: originalUrl(SINGLE, 0), responses: 503 })`, open SINGLE (135882742) and click.
       - Do this 7 times: wait for the resting `Retry`, assert `title === TIP_SERVER` and the `aria-label`, then click again.
       - Allow Chromium's throttling console line with `harness.allowConsoleErrors(...FAULT_LOGS, /Request throttled/)`.
       - Record the server hits per click in a `test.info().annotations` entry; do not assert them (throttling decides them).
     - **(d)** the "QA gate additions (iteration 2)" comment block above `test.describe('CUJ-5: QA gate additions (iteration 2)' …)`, and the `'server failure: a ${name} answer, then dropped connections …'` loop: replace the `lastStatus` wording with `answered`. The tests themselves should pass unchanged.
     - Do **not** touch the two `'floating fallback: …'` tests in "Part C" (task 1.4 owns them) or the import block.
  9. **`e2e/README.md`.** You own the `### CUJ-5 (cuj5.spec.ts, @cuj5)` section only:
     - renumber its rows as in 8(a), with the same AC 15 wording;
     - add the sustained-outage row;
     - update the "offline" row (1 test now) and the trailing paragraph about 502/504 and throttling.
- **Files**:
  - Shared: `src/shared/{types,job,retry,messages,outcome}.ts`
  - Service worker: `src/background/resolver.ts`
  - Unit tests: `test/unit/{retry,outcome,messages}.test.ts`, `test/unit/background/engine-resolver.test.ts`, and exact-shape assertions elsewhere under `test/unit/**` only if they break
  - E2E: `e2e/cuj5.spec.ts` (blocks 8a–d), `e2e/README.md` (CUJ-5 section)
- **Done when**:
  - `npm run check` passes, and `npm run size` passes (retry.ts is in the content bundle).
  - `HFP_HEADLESS=1 npm run test:e2e -- --grep @cuj5` passes, including the renamed test (now `tip_server`) and the new 7-click test. Run the new test 3 times with `--grep "sustained outage" --repeat-each=3`; it passes every time.
  - `! grep -rn "lastStatus" src test e2e` prints nothing.
  - **QA repro, unit level.**
    - A job with `answered: true` whose failures are all `{ kind: 'network' }` without the flag classifies as `{ type: 'error', cause: 'server' }`.
    - The same job without `answered` classifies as `offline`.
    - QA re-runs `diagOutage.ts` against the merged dev build: ≥ 3 replays × 7 clicks for 503 and 500 must all read "pixiv isn't responding", and the stopped server must still read "No connection".

### Task: 1.2 Hide Chrome's download UI while a job runs; the `downloads.ui` permission (R-005, D12)
- **Do**:
  - **Why.**
    - **Owner ruling R-005** (`docs/rulings.md`). Each file handed to Chrome triggers Chrome's fly-to-toolbar animation, so a 20-page manga produced 20 of them; the owner observed this on first install.
    - **PRD §4.1 #3, verbatim:** "From the moment the first file of a job is handed to Chrome until the last running job ends, for any reason (Saved, cancelled, failed, needs login, or Unavailable), the extension turns Chrome's download UI off with `chrome.downloads.setUiOptions({ enabled: false })`: no per-file fly-to-toolbar animation and no downloads button in Chrome's toolbar. When the last running job ends, it turns the UI back on … it never starts before the job's first file is handed to Chrome and ends as soon as the last running job ends. Whenever the background worker starts and no job is running, it turns the UI back on. This needs the `downloads.ui` permission."
    - **CUJ-1 acceptance criterion, verbatim:** "During a 12-page download Chrome's download bubble does not appear or animate, for any of the job's files including the first; after the job ends it is available again and lists `metadata.json` and the 12 originals (per R-005)."
    - **CUJ-4 edge, verbatim:** "With two concurrent jobs it stays hidden until both have finished: when job B ends while job A still runs, it stays hidden, and it returns only when job A ends too (Saved, cancelled, or failed)."
    - **PRD index:** permissions `downloads`, `storage`, `offscreen`, `declarativeNetRequestWithHostAccess`, `downloads.ui`. The `downloads.ui` justification is "Hides Chrome's per-file download animation while a multi-page artwork saves, then restores it."
  - **Read first:**
    - `docs/design/design-download-engine.md`:
      - "Chrome's download UI (download-ui.ts, R-005)", in full: the platform facts, the `DownloadUi` interface, the state/call table, the three call sites, error handling and the test API;
      - "Boot sequence" (the `restoreDownloadUiIfIdle()` line and why it sits between `hydrate()` and `reconcile()`);
      - "Finalize" step 5;
      - "Offscreen events → file transitions" (the `off/ready` row, `handOff()`);
      - "Cancel";
      - the "Where Chrome's download UI is toggled" alternatives table;
      - "Cross-Cutting Concerns → Testing" (the `download-ui.ts` and R-005 integration bullets);
      - "Migration / Rollout → Iteration 3".
    - `docs/design/system.md`: §2 data flow, §5 (manifest, permission justifications, the manifest-test paragraph), §13 (the two R-005 rows), §14 D12, §15 (risks: SW killed before restore, another extension).
    - `docs/design/design-test-harness.md`:
      - "L1 Manifest test";
      - "L2: SW integration with chrome fakes" (the `setUiOptions` fake and the shared call log, `await:handoff.hideUi`, the "R-005 assertions (L2)" paragraph);
      - the L3 helper `downloadUi()`;
      - the mapping rows "CUJ-1 (R-005)" and "CUJ-4 (R-005)";
      - L5 "Chrome's download UI (R-005)".
  1. **`src/background/download-ui.ts` (new).**
     - `createDownloadUi(setUiOptions = (o) => chrome.downloads.setUiOptions(o))` returns `{ hideForHandOff(), restore() }`.
     - In-memory state per SW instance only (nothing persisted): `requested: boolean | null`, a serializing `chain` promise, and a `hideRefused` latch.
     - Follow the design's call table exactly. `requested` is updated **synchronously** before enqueueing, so concurrent callers stay ordered and one hide serves every racing hand-off.
     - Neither method ever rejects:
       - a refused hide → `warn` once per instance, then latch;
       - a refused restore → `debug`, and `requested` stays `true`.
     - Record `{ enabled, ok, at: Date.now() }` per settled call for the test API (below).
  2. **`src/background/engine.ts`.**
     - Create the engine's `DownloadUi`, injectable for tests.
     - **`handOff()`:** after its `saving` guard and before `chrome.downloads.download`:
       - `await downloadUi.hideForHandOff()`;
       - then `if (__TEST_HOOKS__) await __testHook('await:handoff.hideUi')`;
       - then `if (!registry.get(job.jobId)) return`. A job cancelled while the hide was in flight never hands that file to Chrome.
       - Keep the existing `await:handoff.download` point right before the download call.
     - **`finalize()`:** after the mutation that deletes the record, when `registry.list().length === 0`: `await downloadUi.restore()`, then `scheduleClose()` unless `probePending()`.
     - Add `restoreDownloadUiIfIdle(): Promise<void>` to `Engine`: restore only when the registry is empty, otherwise resolve.
  3. **`src/background/sw.ts` boot.** `await engine.restoreDownloadUiIfIdle()` after the first `engine.badge.render()` and before `engine.reconcile()`. Listener registration stays synchronous at top level.
  4. **Test API.**
     - `src/shared/test-hooks.ts` gains `exposeTestApi(api: Record<string, unknown>)`, which **merges** into `globalThis.__hfpTest` instead of replacing it.
     - `src/background/options-tab.ts` switches `installTestApi()` to it, so `clickAction` and `downloadUi` coexist.
     - The download-UI installer exposes `downloadUi(): { requested, calls }`. Like `options-tab.ts`, it is a function referenced only from `if (__TEST_HOOKS__)`, so prod bundles carry no trace (ENG-007).
  5. **Manifest.**
     - `src/manifest.json` `permissions` becomes exactly `["downloads", "storage", "offscreen", "declarativeNetRequestWithHostAccess", "downloads.ui"]`, in this order.
     - `test/unit/manifest.test.ts`: rename the case to "requests exactly the five approved permissions" and update it and the whole-manifest literal (system.md §5).
  6. **Chrome fake (`test/fakes/chrome.ts`, per design-test-harness L2).**
     - `downloads.setUiOptions({ enabled })` keeps `uiEnabled` (initially `true`).
     - It rejects like Chrome when the manifest the fake loads (`src/manifest.json`) lacks `downloads.ui`.
     - It supports `failNextSetUiOptions(message)`.
     - It appends to an ordered **call log shared with `download()`**: `Array<{ op: 'ui'; enabled: boolean } | { op: 'download'; filename: string }>`.
     - Extend `test/unit/background/chrome-fake.test.ts` for these.
  7. **Unit tests.**
     - `test/unit/background/download-ui.test.ts` (new), with a fake `setUiOptions`:
       - concurrent `hideForHandOff()` calls make one Chrome call, and all resolve after it;
       - `restore()` then `hideForHandOff()` in the same tick apply in that order;
       - a refused hide warns once, latches, and still resolves;
       - a refused restore resolves and logs at `debug`;
       - `requested === null` at start makes both methods call Chrome.
     - Engine tests (`test/unit/background/engine-*.test.ts` other than `engine-resolver.test.ts`, which task 1.1 owns): the hand-off awaits the hide before `download`; a cancel during the hide → no `download`.
     - `test/unit/background/sw.test.ts`: the boot order.
     - `test/unit/background/options-tab.test.ts`: `exposeTestApi` merges.
  8. **Integration (`test/integration/**`).**
     - Add `await:handoff.hideUi` to the await points `sw-restart.test.ts` enumerates. A restart there → the file is still handed over exactly once.
     - The R-005 assertions of design-test-harness L2, from the fake's call log:
       - no `ui` entry while a job only resolves or fetches;
       - `{ op: 'ui', enabled: false }` precedes the first `download` of every busy period;
       - exactly one `{ enabled: true }` after the last job's record is deleted, for each end reason: saved, partial, needs login after a 403, unavailable, and cancel;
       - none when job B ends while job A runs;
       - an ugoira job keeps the UI hidden through its encode and restores at its end (CUJ-2 step 4);
       - boot with no `job:*` records → `{ enabled: true }` first;
       - boot with a hydrated running job → no `ui` entry until its next hand-off;
       - an injected `setUiOptions` failure never fails a job or a hand-off.
  9. **E2E.**
     - Add a helper `downloadUi(harness)` = `harness.swEval(() => self.__hfpTest.downloadUi())`, in `e2e/harness/flows.ts` (or as a `Harness` member).
     - `e2e/cuj1.spec.ts`, new tests. With the originals held (`server.hold`):
       - `downloadUi()` shows `requested: false` and one `{ enabled: false, ok: true }` whose `at` ≤ the earliest `startTime` (`Date.parse`) of the job's `chrome.downloads.search` items (`metadata.json` first);
       - after `Saved · 12P`, the last call is `{ enabled: true, ok: true }`, one of each for the job;
       - a cancelled job, and a job whose every original answers 504, also end with `{ enabled: true, ok: true }`.
     - `e2e/cuj4.spec.ts`, new tests:
       - job B ends while job A runs → no new call; A ends → `{ enabled: true, ok: true }`;
       - `stopServiceWorker()` mid-job → the new instance makes no call at boot, and `{ enabled: true }` follows the job's end;
       - boot with no job: `swEval(() => chrome.downloads.setUiOptions({ enabled: false }))`, then `stopServiceWorker()`, then wake the worker by loading a pixiv page (`job/listForTab`) → the new instance's first call is `{ enabled: true, ok: true }`.
     - `e2e/README.md`: you own the "Harness API" section (document the helper) and the `### CUJ-1` and `### CUJ-4` sections (add the R-005 rows). Edit nothing else in the file.
  10. **`docs/release-checklist.md`:**
      - §5 table: add a `downloads.ui` row with the justification text verbatim: "Hides Chrome's per-file download animation while a multi-page artwork saves, then restores it."
      - §2: add the L5 item "Chrome's download UI (R-005)" from design-test-harness L5, and extend the "Ask where to save each file" item: the Save As dialog still appears while the UI is hidden.
- **Files**:
  - Service worker: `src/background/download-ui.ts` (new), `src/background/{engine,sw,options-tab}.ts`
  - Shared: `src/shared/test-hooks.ts`
  - Manifest: `src/manifest.json`, `test/unit/manifest.test.ts`
  - Fakes: `test/fakes/chrome.ts`
  - Unit tests: `test/unit/background/{download-ui (new),chrome-fake,sw,options-tab}.test.ts`, `test/unit/background/engine-{transitions,handlers,scheduler,pusher}.test.ts` as needed
  - Integration: `test/integration/**`
  - E2E: `e2e/harness/**`, `e2e/cuj1.spec.ts`, `e2e/cuj4.spec.ts`, `e2e/README.md` (Harness API, CUJ-1, CUJ-4 sections)
  - Docs: `docs/release-checklist.md`
- **Done when**:
  - `npm run check` passes.
  - `HFP_HEADLESS=1 npm run test:e2e -- --grep "@cuj1|@cuj4"` passes, and the **full** `HFP_HEADLESS=1 npm run test:e2e` passes, because the fake and the manifest are shared. The one known exception is `e2e/cuj3.spec.ts` "edge: newlines …", which is red on `main` until task 1.3 merges: report it as pre-existing if it is the only failure.
  - `npm run build:prod && ! grep -qE 'testHook|__hfpTest|await:(registry|resolver|handoff)' dist/*.js` succeeds, so the new hook name and the test API stay out of prod.
  - `node -e "const m=require('./src/manifest.json'); process.exit(JSON.stringify(m.permissions)===JSON.stringify(['downloads','storage','offscreen','declarativeNetRequestWithHostAccess','downloads.ui'])?0:1)"` exits 0.
  - Every L2 R-005 assertion listed in step 8 exists and passes, including the restart at `await:handoff.hideUi`.

### Task: 1.3 CUJ-3: pasted line breaks dropped; unclosed `{` is invalid (S5); "Still using:" on one line (S15)
- **Do**:
  - **Why.**
    - **QA iteration-2 LOW bug (CUJ-3).**
      - Repro: copy `pixiv/⏎{artist}⏎-{id}` and paste it (⌘V, or `keyboard.insertText`) into the empty field.
      - Observed: the field holds `pixiv/ {artist} -{id}`, which validates and autosaves; the preview reads `Downloads/pixiv/みずき -135882741/…`.
      - Cause: Chromium replaces CR/LF with spaces for **user-inserted** text before `input` fires, and `src/options/page.ts:76` only sets `maxLength`.
      - Pinned by the red e2e `e2e/cuj3.spec.ts` "edge: newlines: a pasted pattern with line breaks lands on one line without them and validates as usual". Do not weaken its assertions.
    - **PRD CUJ-3 edge, verbatim:** "**Paste containing newlines or control characters**: the single-line field drops newlines on paste. Validation then runs as usual."
    - **PRD CUJ-3 acceptance criteria (R-004 S5, S15), verbatim:**
      - "Typing `pixiv/{user` and pausing shows `Unknown token {user. Available tokens: {artist}, {id}, {title}, {userId}.` and saves nothing: no `Saved` appears, and reloading the settings page shows the last valid pattern. A pattern with a lone `}` (e.g. `pixiv/a}b`) is valid and saved (per R-004 S5)."
      - "In the error state, the `Still using:` label renders on a single line in all four locales, and the default pattern `pixiv/{artist}-{id}` after it is not broken across lines (per R-004 S15)."
  - **Read first:**
    - `docs/design/design-options-page.md`:
      - "Line breaks in inserted text": the `bindSingleLine` contract, steps 1–7, the cost and the alternatives table;
      - "The preview / 'Still using' line (CUJ-3 steps 2 and 5; R-004 S15)";
      - "Validation, preview and save": the Messages and Paste bullets;
      - "A11y" (contrast);
      - "Testing";
      - "Open Questions" (drop placement).
    - `docs/design/design-settings-model.md`: "Validation" rule 5 (the scan regex `/\{[^{}]*(?:\}|(?=\{)|$)/g`), "Rule 5 fragments", the lone-`}` bullet, the rule-6 bullet, "Testing" (rule 5's fragments), and "Open Questions" (stored fragments from earlier builds).
  1. **`src/options/single-line.ts` (new): `bindSingleLine(field, maxChars)`**, exactly per the design's steps:
     - On `beforeinput`, act only when `inputType` is `insertText`, `insertFromPaste` or `insertFromDrop` and the event is `cancelable`.
     - Text = `event.data ?? event.dataTransfer?.getData('text/plain') ?? null`. If there is no `\r`/`\n`, return and leave it native.
     - Otherwise:
       - `preventDefault()`;
       - strip every `\r` and `\n`;
       - insert at `[selectionStart, selectionEnd]`, capped at `maxChars − (value.length − (end − start))` without leaving a lone high surrogate;
       - do nothing if the result is empty over a collapsed selection;
       - `setRangeText(clean, start, end, 'end')`;
       - dispatch `new InputEvent('input', { bubbles: true, inputType, data: clean })`, so the existing debounce → validate → autosave path and the chips' caret tracker run unchanged.
  2. **`src/options/page.ts`.** Call `bindSingleLine(field, PATTERN_MAX_CHARS)` right after `field.maxLength = PATTERN_MAX_CHARS`.
  3. **`src/options/strings.ts`.**
     - `stillUsingLine()` returns:
       - a `.label` span with the text before the placeholder, its trailing whitespace moved out (en `Still using: ` → `Still using:` plus a `' '` text node; ja likewise; zh_CN/zh_TW `仍在使用：` have none);
       - the pattern in a `mono pattern` span;
       - the `.muted` trailing sentence.
     - `previewLine()` puts `Preview:` in a `.label` span the same way, then the path.
  4. **`src/options/options.css` (S15 layout, design-options-page.md):**
     - `.preview`: `display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 20px`.
     - The icon: `flex-shrink: 0; margin-top: 2px`.
     - `.preview-text`: `flex: 1 1 auto; min-width: 0`. This replaces `display: contents`; delete its old comment.
     - `.label`: `white-space: nowrap`.
     - `.pattern`: `display: inline-block; max-width: 100%; overflow-wrap: anywhere; color: var(--text)`.
     - `.path` keeps `overflow-wrap: anywhere`.
     - Colours are unchanged. The footer links stay `#0096FA` (2.91:1 is an open pm gap; do not change it).
  5. **`src/shared/pattern.ts` `validatePattern`, rule 5 (S5).**
     - Scan `/\{[^{}]*(?:\}|(?=\{)|$)/g` left to right. The first match that does not end in `}` (unclosed), or ends in `}` but is not a known token, → `{ code: 'unknownToken', token: <that fragment> }`.
     - A `}` that closes no `{` stays literal. Rule 6 and resolution are unchanged; `sanitizeToken`/`resolveFolder` must not change.
  6. **Unit tests.**
     - `test/unit/options/single-line.test.ts` (new; happy-dom, synthetic `InputEvent`s):
       - `insertFromPaste` of `pixiv/\n{artist}\r\n-{id}\n` into an empty field → `pixiv/{artist}-{id}`, caret at the end, exactly one `input` event;
       - the same over a selection replaces it;
       - `insertFromDrop` at a caret inside the value;
       - `insertText` with a newline;
       - text without line breaks is not prevented;
       - a non-cancelable event is not prevented;
       - only newlines with a collapsed selection → no change and no `input`;
       - the 200 cap with a surrogate pair at the cut.
     - `test/unit/options/strings.test.ts`: `stillUsingLine` returns label (no trailing whitespace), space text node, pattern span and muted sentence, in all 4 locales.
     - `test/unit/options/page.test.ts`: `pixiv/{user` → `Unknown token {user. …` with no write and no `Saved`; a paste with newlines goes through the normal debounce and save.
     - `test/unit/pattern.test.ts`, rule 5 fragments:
       - `pixiv/{user` → `{user`;
       - `pixiv/{artist` → `{artist`;
       - `{id}{` → `{`;
       - `a{b{id}` → `{b`;
       - `pixiv/{artst}-{` → `{artst}`;
       - `pixiv/a}b` and `}{id}` → valid.
  7. **E2E, `e2e/cuj3.spec.ts` (`@cuj3`).**
     - The red "edge: newlines …" test must now pass as written.
     - Add:
       - a single-line paste copied with a trailing newline → no trailing space;
       - `keyboard.insertText` with a newline;
       - `pixiv/{user` and a pause → the exact message, no `Saved`, and a reload shows the last valid pattern;
       - `pixiv/a}b` saves (`Saved`, stored);
       - in the error state of each of the 4 locales (`test.use({ uiLocale })`, as the locale tests do), the `.label` element has exactly one client rect, and the pattern span showing the default `pixiv/{artist}-{id}` has exactly one client rect.
     - `e2e/README.md`: you own the `### CUJ-3` section only; add rows for the paste edge, S5 and S15.
- **Files**:
  - Options page: `src/options/single-line.ts` (new), `src/options/{page,strings}.ts`, `src/options/options.css` (and `src/options/options.html` only if the markup must change)
  - Shared: `src/shared/pattern.ts` (`validatePattern` only)
  - Unit tests: `test/unit/options/{single-line (new),strings,page}.test.ts`, `test/unit/pattern.test.ts`
  - E2E: `e2e/cuj3.spec.ts`, `e2e/README.md` (CUJ-3 section)
- **Done when**:
  - `npm run check` passes.
  - `HFP_HEADLESS=1 npm run test:e2e -- --grep @cuj3` passes, **including** the previously red "edge: newlines …", the 200-character test and the new S5/S15 cases.
  - `git diff --exit-code test/golden/` shows that the golden vectors are unchanged, and `npx vitest run test/unit/pattern.test.ts test/unit/pattern-property.test.ts test/unit/golden-safe-component.test.ts` passes.
  - **QA repro:** pasting `pixiv/⏎{artist}⏎-{id}` leaves `pixiv/{artist}-{id}` with the preview `Downloads/pixiv/みずき-135882741/135882741_p0.jpg`.

### Task: 1.4 Content script: floating fallback inside 3 s (R-004 S4, D14); English ugoira exactly 176 px (R-004 S1)
- **Do**:
  - **Why.**
    - **QA iteration-2 LOW bug (CUJ-5).**
      - The floating pill appeared 11–23 ms *after* 3 s, measured in-page with `performance.now()`, 5 samples each (`docs/qa-artifacts/iter2-03-48-13/logs/diag-float.log`): direct load, `<figure>` inserted → host inserted, 3018–3023 ms; SPA click → host inserted, 3011–3013 ms.
      - The code review measured 3016–3079 ms under parallel load.
      - Cause: the timer fires at exactly 3000 ms from route entry, before the placement work (`src/content/mount.ts:213`).
    - **PRD CUJ-5 acceptance criterion, verbatim:** "With pixiv's action row removed (simulated by deleting it in DevTools before navigation), the button appears as a floating pill at the bottom-right of the artwork area within 3 s of the page loading or of the in-app navigation to it, measured to the pill appearing, and downloads normally (per R-004 S4)."
    - **PRD CUJ-2 acceptance criterion, verbatim:** "In English, on an ugoira whose metadata arrived before the first click, the button is 176 px wide in idle, busy, Cancel-hover, and Saved states, and its width does not change across any transition or when Ugoira output changes (per R-004 S1)."
    - **PRD §4.7.2:** "In English this is **164 px** for illustrations and manga up to 99 pages, and **176 px** for every ugoira … If the metadata is unknown at first render, the button starts at the 2-digit illustration width (164 px in English) and may widen once, when the metadata arrives and before any interaction."
  - **Read first:**
    - `docs/design/design-artwork-button.md`:
      - "Mounting": the "Fallback timer (… D14)" bullets — the anchor, the placement budget, the not-cancelled rule;
      - the `ensurePlaced()` pseudo-code;
      - "Fixed width (button/width.ts)": `floor(work, locale)`, `UGOIRA_LOCALE_FLOOR_PX`, "Why the English floors", "Provisional width";
      - "Testing";
      - "Open Questions" (floating fallback budget).
    - `docs/design/system.md`: §11.6 (the floating-fallback row) and §14 D14.
    - `docs/design/design-test-harness.md`, L3 mapping: the rows "CUJ-5 step 11 (R-004 S4)" and "CUJ-2 (R-004 S1)".
  1. **`src/shared/constants.ts`.** Add `FLOAT_PLACEMENT_BUDGET_MS = 250` next to `FLOAT_FALLBACK_MS` (which stays 3000, the PRD's number), with a comment citing D14.
  2. **`src/content/mount.ts` `show()`.**
     - The fallback timer's delay becomes `FLOAT_FALLBACK_MS − FLOAT_PLACEMENT_BUDGET_MS` (2750 ms).
     - Make sure its callback places the pill **synchronously**: `fallbackFired = true; ensurePlaced()`, which runs `float()`, the width lock and `position()` with no `requestAnimationFrame` in between.
     - The timer is still not cancelled when the row is found, `hide()` still resets it, and the anchor is still route entry.
     - Update the header comment.
  3. **`src/content/button/width.ts`.**
     - Add `export const UGOIRA_LOCALE_FLOOR_PX = { en: 176, ja: 0, 'zh-CN': 0, 'zh-TW': 0 }`.
     - `computeWidth` uses the floor `work?.illustType === 2 ? UGOIRA_LOCALE_FLOOR_PX[locale] : LOCALE_FLOOR_PX[locale]`.
     - `candidates(null)` stays the 99-page faces (164 floor), and `settleWidth` is unchanged.
     - Update the doc comments.
  4. **Unit tests.**
     - `test/unit/button/width.test.ts`:
       - an English ugoira with narrower measures → 176;
       - a wider measured face wins;
       - `null` → the 164 floor;
       - ja/zh use the measured width;
       - an ugoira widens once from 164 to 176 when its metadata arrives before interaction, and never after interaction.
     - `test/unit/content/mount.test.ts`:
       - not floating at 2749 ms;
       - floating at 2750 ms, with the host in `body` and `left`/`top` set before any animation frame runs;
       - `hide()` then `show()` starts a fresh 2750 ms timer.
     - `test/unit/content/content.test.ts`: only if its `settle(FLOAT_FALLBACK_MS)` uses break.
  5. **E2E, `e2e/cuj5.spec.ts`.** You own only the two tests whose titles start `'floating fallback:'` in "Part C". You may add a local helper directly above them inside Part C. Keep the `'floating fallback:'` title prefix, and do **not** touch the header comment, the import block or any other test (task 1.1 owns them).
     - **Direct load.** Replace the `<figure>`-to-host measurement with the PRD anchor:
       - start = `performance.getEntriesByType('navigation')[0].domInteractive`;
       - end = a `requestAnimationFrame` stamp taken right after the page `MutationObserver` sees `hfp-download` connect;
       - expect `end − start ≤ 3000`.
     - **SPA.** Stamp `performance.now()` in the page at the click. For example, install a capture-phase `click` listener in the page that records the time, then click the `a[data-spa]` link. The end is the same rAF stamp, and the expectation is ≤ 3000 (replacing the Node-side `Date.now()` with 3000 + 300).
     - Annotate both delays, and keep every other assertion: the mode, the 16 px inset, the shadow, the 164 px width, the download, the move into the row, the dark ring and the viewport fallback.
  6. **E2E, `e2e/cuj2.spec.ts`.**
     - In `'idle: Download · WebM and Download · ZIP follow the setting …'`, assert `toBe(176)` instead of `toBeGreaterThanOrEqual(164)`, and fix the comment (PRD text since R-004 S1).
     - Add a test, e.g. `'width: 176 px in idle, busy, Cancel-hover and Saved'`, on 136004512:
       - hold the zip (`server.hold`) to observe busy;
       - hover to Cancel after the pointer has left once, as `e2e/cuj1.spec.ts` "width" does;
       - release, and read the width again at `Saved · MP4`.
  7. **`e2e/README.md`.** You own the `### CUJ-2` section only; add the 176 px row. Do not edit the CUJ-5 section: task 1.1 updates its floating row's wording.
- **Files**:
  - Shared: `src/shared/constants.ts`
  - Content script: `src/content/mount.ts`, `src/content/button/width.ts`
  - Unit tests: `test/unit/button/width.test.ts`, `test/unit/content/mount.test.ts`, `test/unit/content/content.test.ts` (only if needed)
  - E2E: `e2e/cuj5.spec.ts` (the two `'floating fallback:'` tests only), `e2e/cuj2.spec.ts`, `e2e/README.md` (CUJ-2 section)
- **Done when**:
  - `npm run check` passes, and `npm run size` passes (content bundle budget).
  - `HFP_HEADLESS=1 npm run test:e2e -- --grep "@cuj1|@cuj2|@cuj5"` passes. `@cuj1` is a read-only regression: illustrations stay 164 px, also with late metadata.
  - `HFP_HEADLESS=1 npm run test:e2e -- --grep "floating fallback" --repeat-each=3` passes every time, with both delays ≤ 3000 ms. Report the annotated delays.
  - The English ugoira pill is exactly 176 px in idle, busy, Cancel-hover and Saved, and across MP4 → ZIP → WebM.
  - QA re-runs `diagFloat.ts` (5 direct + 5 SPA samples, dev build): ≤ 3000 ms in 10 of 10.

## Conflict Risks

- **`e2e/cuj5.spec.ts`** is shared by 1.1 and 1.4, with explicit block ownership:
  - **1.1** owns the header comment (lines 1–52), the renamed "every original drops its connection" test, the new sustained-outage test (inserted right after `'server failure: 5xx on every original …'`, far from Part C), the "QA gate additions (iteration 2)" comment block and the `'server failure: a ${name} answer …'` loop.
  - **1.4** owns only the two `'floating fallback:'` tests in Part C, plus any local helper directly above them.
  - Neither touches the import block. A helper either needs is defined locally (1.4) or uses what is already imported (1.1). The blocks are hundreds of lines apart, so git merges them cleanly.
  - 1.1's header keeps referring to the `'floating fallback'` title prefix, which 1.4 keeps.
- **`e2e/README.md`** is shared by every task, with section ownership:
  - 1.1: `### CUJ-5`;
  - 1.2: "Harness API", `### CUJ-1` and `### CUJ-4`;
  - 1.3: `### CUJ-3`;
  - 1.4: `### CUJ-2`.

  Prettier realigns a whole table when a cell widens a column, so each task's tables stay inside its own section. Each task checks `git diff e2e/README.md` after `npx prettier --write` and fixes any change outside its section. If the orchestrator still sees a conflict, it is whitespace-only: re-run `npx prettier --write e2e/README.md` after the merge.
- **`src/shared/`** is touched by three tasks, in disjoint files:
  - 1.1: `types.ts`, `job.ts`, `retry.ts`, `messages.ts`, `outcome.ts`;
  - 1.2: `test-hooks.ts`;
  - 1.3: `pattern.ts`;
  - 1.4: `constants.ts`.

  No task needs another's file; a task that does keeps the addition module-local and reports it.
- **`src/background/`:** 1.1 edits `resolver.ts` only, and does not touch `engine.ts`: `applyResolution` lives in `resolver.ts`, and `engine.start()` needs no change for the optional `answered`. 1.2 owns `engine.ts`, `sw.ts`, `options-tab.ts` and the new `download-ui.ts`.
- **Tests:**
  - **1.1 only:** `test/unit/background/engine-resolver.test.ts`, `retry.test.ts`, `outcome.test.ts`, `messages.test.ts`.
  - **1.2 only:** the other `engine-*.test.ts`, `sw.test.ts`, `options-tab.test.ts`, `chrome-fake.test.ts`, `manifest.test.ts`, `test/fakes/**` and `test/integration/**`. 1.1 must not edit integration tests; none asserts `offline` for an answered job today.
  - **1.3 only:** `test/unit/options/**` and `pattern.test.ts`.
  - **1.4 only:** `test/unit/button/width.test.ts`, `test/unit/content/mount.test.ts` and `content.test.ts`.
  - `test/unit/content/api-proxy.test.ts` and `test/unit/offscreen/**` may need a one-line exact-shape fix from 1.1 only.
- **E2E specs:**
  - `cuj1.spec.ts` and `cuj4.spec.ts`: 1.2;
  - `cuj2.spec.ts`: 1.4;
  - `cuj3.spec.ts`: 1.3;
  - `e2e/harness/**`: 1.2;
  - `e2e/server/**` and `e2e/fixtures/**`: nobody (all four use the existing `hold` / `fault` / `__fake` API).
- **Semantic, not textual:**
  - 1.2's full e2e run happens before 1.3 merges, so `cuj3` "edge: newlines …" is still red there (pre-existing, expected). After all four merge, the orchestrator runs `npm run check` and the full `HFP_HEADLESS=1 npm run test:e2e` once on `main`.
  - 1.2's fake makes `setUiOptions` reject without `downloads.ui` in `src/manifest.json`. 1.2 adds the permission in the same task, so the other tasks' worktrees never see the rejecting fake.
  - 1.1 and 1.4 both change the content bundle slightly (`retry.ts`, `mount.ts`/`width.ts`). Each runs `npm run size`, and CI re-measures the merged tree against the 40/15 KB budget (35.2/13.0 KB today).

**Parallelism:** 4 tasks in 1 group, so the wall-clock is the longest single task (1.2: new module, fake, integration matrix and two e2e specs) instead of four tasks run one after another. That is roughly 2.5–3× faster than sequential. No follow-up group is needed: the merge check above is the orchestrator's normal post-merge gate.
