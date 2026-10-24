# Task Plan

Last updated: 2026-10-23 19:03:54 (UTC-7)

## Current State

- **Dev-cycle iteration 3, QA retry loop 1, Phase 2 (re-plan).** The four iteration-3 tasks are merged on `main` and verified:
  - merge `3cef87b`;
  - review fixes `fbe4066` and `7f5960c`;
  - QA gate additions `0d28f3f`.
- **QA gate** (`docs/qa-report.md`, run `iter3-17-37-06`, `main` at `e066f27`): FAIL with **one `[MEDIUM][BUG]`** and nothing else.
  - After a job ends, Chrome's downloads toolbar button does not come back. The cause is in Chrome: it shows the button again only with the next download after `setUiOptions({ enabled: true })`.
  - CUJ-1, CUJ-4 and CUJ-5 fail on this one shared bug. CUJ-2 and CUJ-3 PASS. Every other check passes.
  - All 4 iteration-2 LOWs are resolved.
- **Since the gate:**
  - The owner ruled **R-006** (option B): re-enable Chrome's download UI just before the **last** file of the last running job is handed to Chrome. That gives exactly one animation per job, and the bubble lists the job's files. A job that ends without a final hand-off gets the UI back silently at finalize.
  - pm amended prd-000 (`d31880b`): §4.1 #3; CUJ-1 steps 2/5/6, edges and AC 14; CUJ-2 steps 3/5/6; the CUJ-4 edge; CUJ-5 step 4; and the `cuj-5-retry.html` mock, which no longer shows Chrome's button.
  - tl specified the rule in design-download-engine.md, "Chrome's download UI" → "The last hand-off (R-006)", in system.md D12 rev. 2, and in design-test-harness.md (the fake's deferred naming, the L2 call-log assertions and the e2e rows).
- **Focus (priority ladder):**
  - Tier 1 is this MEDIUM, and it is the only work planned.
  - Tier 2 is empty: `docs/eng-backlog.md` has no entries (Next-ID ENG-012).
  - There are no routed defects, and the owner queue is empty (Next-ID R-007).
  - One task, one group: the fix is a single coupled code path (`handOff()` + the pure rule + the fake + the tests that pin its call order).
- **Document authority.** No PRD and design-doc contradiction was found: the design follows the amended PRD.
  - Scope note: the orchestrator's file list made `e2e/cuj2.spec.ts` optional and left out `e2e/cuj5.spec.ts`.
  - Both files carry timing assertions that encode the R-005 restore point ("restore after every file ended"). These now contradict PRD §4.1 #3 as amended by R-006, and the full-e2e done-gate would fail on them.
  - So the task owns both files, limited to those expectations.
- **Orchestrator prerequisite.** tl's R-006 design edits are **uncommitted** on `main`:
  - `docs/design/design-download-engine.md`, `design-test-harness.md` and `system.md`;
  - also `docs/qa-report.md`, `docs/rulings.md`, `docs/owner-queue.md` and `docs/loop-state.md`, plus this file.

  Commit them before creating the worktree. The task cites design sections that exist only in the working tree today.
- **QA expectation change for the re-run** (deliberate R-006 behaviour, not bugs):
  - **One fly-to-toolbar animation per job, with its last file, is now CORRECT** (CUJ-1 AC 14: "…does not appear or animate for the first 12 files; exactly one animation accompanies the last file, after which the bubble lists `metadata.json` and the 12 originals"). Re-run `r005native.ts`, `r005nativeEnds.ts` and the two headed "Chrome toolbar" tests. Both must now pass headed.
  - **The restore moves to just before the last hand-off.** `{ enabled: true }` now settles before the last file's `download()`:
    - its `at` is ≥ the `startTime` of every other item of the busy period, and ≤ the last item's `startTime`;
    - finalize makes no second Chrome call after a final hand-off;
    - the per-job call sequence stays `[off, on]`.
  - **A job that ends in `Retry` / `Unavailable` / `Log in to download`, a cancel, or a job whose last outstanding file fails:** there is no final hand-off. The UI is turned on silently at finalize, and **Chrome's downloads button stays out of the toolbar until the next download** (PRD CUJ-5 step 4, CUJ-1 step 5, `cuj-5-retry.html`). This is correct per R-006, not the iteration-3 MEDIUM.
  - **Two concurrent jobs:** one animation in total, with the last file either job hands to Chrome. Job B ending while job A still has files to hand off makes no UI call.
  - **A single-file busy period** (one page with metadata off; `retryMetadata`; `retryPages` with one page) makes no `setUiOptions` call, and its file plays Chrome's usual animation. `retryEncode` also makes none.
  - **Accepted residuals** (design "Open Questions & Risks"): a second animation is possible only when Chrome takes more than 500 ms to name an earlier file. Two jobs started back to back can each end with one animation. The release checklist re-checks a cached re-download on branded Chrome (L5).
- **Rules:**
  - **Done-gate.** `npm run check`, the full `HFP_HEADLESS=1 npm run test:e2e`, the headed toolbar run, and the prod-bundle grep (see the task's "Done when").
  - **Docs.** Do not edit `docs/prd/**` or `docs/design/**`. Report a design gap in the commit message and the task summary instead.
  - **Dependencies.** No new dependency, no `package.json`/`package-lock.json` change, and no manifest change (the permissions stay exactly the five).
  - **Commits.** Conventional commits, one per separable part (fake; rule + engine; tests; e2e; docs).

## Parallel Group 1

### Task: 1.1 Bring Chrome's downloads button back with the last file of the last running job (R-006, D12 rev. 2)

- **QA's repro** (verbatim, `docs/qa-report.md` "Bugs Found → MEDIUM"):
  > `[MEDIUM][BUG]` After the last running job ends, Chrome's downloads toolbar button does not come back, so its bubble is not available. — CUJ-1 (AC 14, steps 5–6, edge "Chrome's own download UI", mock `cuj-1-saved.html`), CUJ-4 (edge "Chrome's own downloads button"), CUJ-5 (step 4) — `src/background/engine.ts:251-253`, `src/background/download-ui.ts`
  > - **Evidence:** observed in headed Chrome for Testing 156.0.8078.4 through Chrome's native-UI accessibility tree, deterministic in 2 of 2 runs each, after: `Saved · 12P` (at once, +5 s, and +15 s with the pixiv tab in front); a cancel; `Retry · 3 failed`; the last of two jobs; `Saved · MP4`.
  > - **What the extension does:** it calls `setUiOptions({ enabled: true })`, and Chrome accepts it.
  > - **What Chrome does:** it shows the button and opens the bubble only for the next download. That bubble then lists the job's `metadata.json` and 12 originals too.
  > - Pinned by `e2e/cuj1.spec.ts` "toolbar: back after Saved" (headed only; red).

  In short: in headed Chrome, `Saved · 12P` is reached and then there is no downloads button in the toolbar.
- **Governing spec.** PRD prd-000 §4.1 #3 (per R-006):
  > It turns the UI back on just before the **final hand-off**: the file after which no running job has anything left to hand to Chrome, meaning no file queued, being fetched, waiting to retry, or being encoded, and no job still resolving its files … That file reaches Chrome with the UI on, so it brings exactly one fly-to-toolbar animation, the job's "done" signal.

  And CUJ-1 AC 14:
  > During a 12-page download Chrome's download bubble does not appear or animate for the first 12 files; exactly one animation accompanies the last file, after which the bubble lists `metadata.json` and the 12 originals (per R-006).
- **Do**:
  1. **Read first** (they are authoritative; follow their code blocks):
     - `docs/design/design-download-engine.md`, "Chrome's download UI (download-ui.ts, R-005, R-006)": the platform facts, "The last hand-off (R-006)", Races, Call sites, Error handling and Test API. Also the "Testing" bullets under "Cross-Cutting Concerns".
     - `docs/design/system.md` D12 (rev. 2).
     - `docs/design/design-test-harness.md`: "R-005/R-006 assertions (L2)", deferred naming, the CUJ-1/CUJ-4 e2e rows and the L5 list.
     - `docs/rulings.md` R-006.
  2. **`src/shared/constants.ts`**: add only `HANDOFF_TARGET_WAIT_MS = 500`, with a one-line "why" comment: it caps the wait for Chrome to name earlier in-progress files before the restore.
  3. **`src/background/scheduler.ts`**: add the three pure helpers from the design's code block, next to `IN_FLIGHT`/`isTerminal`.
     - `handOffKey(jobId, idx)` returns `` `${jobId}#${idx}` ``.
     - `awaitsHandOff(file, decided)`:
       - `save === false` → false;
       - `queued`/`fetching`/`ready` → true;
       - `saving` → `downloadId === undefined && !decided`;
       - terminal → false.
     - `isLastHandOff(jobs, self, decided)`:
       - every job must not be still resolving (`phase === 'resolving' && stopReason === null && apiFailure === null`);
       - every file other than `self` must not `awaitsHandOff`.
     - Import `FileRef` as a type from `./registry`.
  4. **`src/background/engine.ts`** (inside `createEngine`):
     - Add `decided: Map<string, Promise<number | null>>` and `deltaWatchers: Set<(delta) => void>`, both in memory and never persisted.
     - Add `targetsKnown(ids)`, exactly as designed:
       - the watcher is registered before the `downloads.search` per id;
       - an id resolves on a `filename` delta, a non-`in_progress` state, a missing item, or an item whose `filename !== ''` or `state !== 'in_progress'`;
       - capped by `setTimeout(release, HANDOFF_TARGET_WAIT_MS)`;
       - a search failure logs `warn` and goes on;
       - the watcher and timer are always cleaned up in `finally`;
       - `ids = []` makes no search call.
     - Add `otherSavingIds(self)`.
     - **`onDownloadChanged`:** the first line feeds every delta to `deltaWatchers`, **before** the existing `complete`/`interrupted` filter.
     - **Rewrite `handOff(job, idx)` per the design's steps 1–6, in this order:**
       1. Keep the existing `saving`/`blobUrl`/no-`downloadId` guard.
       2. **Synchronously, before any `await`:**
          - `earlier = new Map(decided)`;
          - `last = isLastHandOff(registry.list(), self, earlier)`;
          - `decided.set(key, issuedPromise)`.
       3. If `last`: `await Promise.all(earlier.values())`, then `await targetsKnown([...non-null earlier ids, ...otherSavingIds(self)])`, then re-check `last = isLastHandOff(registry.list(), self, earlier)` with the same snapshot and no `await` before the UI call.
       4. If `last`: `await downloadUi.restore()`, then the **new** hook `if (__TEST_HOOKS__) await __testHook('await:handoff.restoreUi')`. Otherwise: `await downloadUi.hideForHandOff()` + `await:handoff.hideUi` (unchanged). The last hand-off never calls `hideForHandOff()`, and no other hand-off calls `restore()`.
       5. Unchanged from here:
          - the live check (record listed **and** file still `saving`, else return);
          - `await:handoff.download`;
          - `downloads.download`.

          The new parts:
          - call `markIssued(id)` after the call resolves;
          - call `markIssued(null)` before `onHandOffFailed` on a throw;
          - the existing `pendingDownloads`/`onDownloadStarted`/cancel-if-ended path stays.
       6. `finally { markIssued(null); decided.delete(key); }`. This runs after the id is stored, after a failure, or after a give-up.
     - **`finalize`:** keep `await downloadUi.restore()` when `registry.list()` is empty, unchanged. It is the idempotent safety net for ends without a final hand-off, and a no-op (no Chrome call) after one.
     - Update the doc comments of `handOff`, `finalize` and `Engine.restoreDownloadUiIfIdle` to R-006 wording.
  5. **`src/background/download-ui.ts`**: doc comments only.
     - Use the interface comments from the design's code block: `hideForHandOff` "Before every hand-off but the busy period's last…", and `restore` "Before the busy period's last hand-off (R-006), when the last running job ends, or when the SW starts with none running…".
     - Update the header comment from "until the last running job ends" to the R-006 restore point.
     - No logic change.
  6. **`test/fakes/chrome.ts`** (`FakeDownloads`). Add deferred naming, **off by default**, so every existing test is unchanged:
     - `deferNaming(on: boolean)`. While it is on, `download()` creates the item with `filename: ''` and **reserves** its target for the `uniquify` check, so a second same-path download still gets ` (1)`.
     - `name(id)` sets the reserved `filename` and fires `onChanged({ id, filename: { previous: '', current } })`.
     - `complete(id)` and `interrupt(id)` first name an item that is still unnamed, firing its `filename` delta before the state delta.
     - `reset()` turns naming back off.
     - With naming off, items are named at creation, as now.
  7. **Unit tests:**
     - **`test/unit/background/chrome-fake.test.ts`**:
       - naming off: unchanged;
       - naming on: `filename: ''` at creation, uniquify reservation, the `name(id)` delta, and `complete`/`interrupt` naming first;
       - `reset()`.
     - **Scheduler** (new `test/unit/background/scheduler-last-handoff.test.ts`, or a block in `engine-scheduler.test.ts`):
       - every row of the `awaitsHandOff` table: each `FileState` × `save` true/false, and `saving` with a `downloadId` and without one, both in and out of `decided`;
       - `self` is ignored;
       - a resolving job blocks; one with a `stopReason` or an `apiFailure` does not;
       - another job's pending file blocks;
       - the design's examples table: 12 pages + metadata at several points; ugoira MP4 (the `queued` video counts) and ZIP only; `retryEncode` (zip `save: false`); `retryMetadata`; two jobs.
     - **`test/unit/background/download-ui.test.ts`:** add `restore()` then `hideForHandOff()` in the same tick (applied in that order), and `hideForHandOff()` then `restore()` (also in order). Keep the existing cases.
     - **`test/unit/background/engine-download-ui.test.ts`** (injected `DownloadUi` spy). The existing single-file seeds now take the restore path, so re-seed those that pin the hide path with a second pending file. Then cover:
       - the last hand-off calls `restore()` and never `hideForHandOff()`, and no `download()` is asked for until the restore resolves;
       - every other hand-off calls `hideForHandOff()` only;
       - the last two files' `off/ready` in one tick → exactly one `restore()`, from the second hand-off, called only after the first file's `download()` resolved and Chrome named it;
       - an earlier file still `in_progress` with `filename: ''` → no `restore()` until its `filename` delta or a terminal state, and the restore goes ahead after 500 ms without one (fake timers);
       - `targetsKnown([])` makes no `downloads.search` call, and no watcher is left afterwards;
       - a cancel while the restore is in flight → no `download()` and no hide;
       - a job created while the last hand-off waits (steps 2–3) → the re-check takes the hide path;
       - a job listed as resolving makes another job's last file hide;
       - the `decided` entry is gone after the id is stored, after a throwing `download()`, and after a give-up (a later hand-off can then be last);
       - finalize after a final hand-off makes no second effective restore call.
  8. **Integration tests:**
     - **`test/integration/sw-download-ui.test.ts`**: rework the R-005 expectations to R-006, per design-test-harness.md "R-005/R-006 assertions (L2)".
       - Saved and ugoira: `aroundEnd(...)` → `{ before: [false, true], after: [] }`.
       - `downloadsWhileShown()` → the busy period's last file only, not `[]`.
       - Count what reached Chrome (the fake's `callLog`), not `vi.fn` spy calls, wherever a test asserts hand-offs.
       - Add a **12-page job** (`illustJson({ pageCount: 12 })` / `pagesJson(ID, 12)`). Its call log after boot reads exactly `ui:false`, 12 × `download` (`metadata.json` first), `ui:true`, `download` of `135882741_p11.jpg`, and no `ui` entry after its record is deleted.
       - Ends **without** a final hand-off each read `… ui:true` after the record delete, with no `download` after it. Arrange each case so the failing file settles last:
         - cancel;
         - a partial job whose failing page settles last;
         - needs login after a 403 with nothing else in flight;
         - Unavailable as the last job to end, while the other job's last file hid because this one was still resolving (the existing test already has this shape).
       - Also cover:
         - a partial job whose last-settling file succeeds restores before that file;
         - two jobs: B ending while A runs → no `ui` entry, and A's `ui:true` sits right before A's last `download`;
         - a single-file job after an idle boot → no `ui` entry;
         - a zero-file job → none;
         - a job started after the restore was requested → a fresh `ui:false` before its first `download`;
         - with `deferNaming(true)`, two files landing together as the last two → no `ui:true` until the earlier one is `name()`d;
         - a cancel while the restore is in flight → no `download` after it;
         - a refused restore still ends the job saved;
         - boot cases unchanged.
     - **`test/integration/sw-restart.test.ts`**:
       - Both dry-run hit lists (pages and ugoira) gain `'await:handoff.restoreUi'`.
       - `expectation()`: `uiEnabled: true`, and `downloadsWhileShown` holds exactly one entry, the call log's last `download` (which file it is may vary with the kill point), instead of `[]`.
       - Every kill point, including `await:handoff.restoreUi`, still hands each file over exactly once.
       - `test/integration/harness.ts` may gain a minimal helper if a case needs one.
  9. **E2E** (keep each file's QA blocks; change only the expectations R-006 changes):
     - **`e2e/cuj1.spec.ts`:**
       - Rework 'download UI: 12 pages' per the design-test-harness CUJ-1 row:
         - hold **only p11** (`server.hold(pagesOf(EXAMPLE, [11]))`);
         - once the 12 other files are complete, `downloadUi()` shows `requested: false` and exactly `[{ enabled: false, ok: true }]`, with its `at` ≤ the earliest `startTime` (`metadata.json` first);
         - release p11 and wait for `Saved · 12P`;
         - the calls are `[{ enabled: false, ok: true }, { enabled: true, ok: true }]`, with the `{ enabled: true }` `at` ≥ the `startTime` of every item but p11 and ≤ p11's `startTime`.
       - Cancel and 504 keep `[off, on]` (no final hand-off). Update the PRD-mapping comment tables to R-006 wording.
       - **Do not weaken or rewrite the two 'Chrome toolbar' tests.** Only their mapping comment may be reworded to the R-006 AC text.
     - **`e2e/cuj4.spec.ts`:** in 'download UI: two jobs', add that A's `{ enabled: true }` `at` is ≥ the `startTime` of every other item from both jobs and ≤ the `startTime` of A's last item. Update the comment table to R-006.
     - **`e2e/cuj2.spec.ts`** (required: its assertion `max(endedAt) ≤ restoreAt` contradicts R-006):
       - in 'download UI: ugoira', the restore's `at` is ≥ the `startTime` of `metadata.json`, the zip and `frames.json`, and ≤ the video's `startTime`;
       - retitle it to "… back on just before the video is handed to Chrome";
       - update the comment table.
     - **`e2e/cuj5.spec.ts`** (required, same reason; only the 'download UI: partial' test and its comment row): the retry's restore `at` is ≥ the `startTime` of the two retried pages that started first and ≤ the last retried page's `startTime`. This replaces `max(endedAt) ≤ restore.at`. The call sequence `[off, on, off, on]` is unchanged.
  10. **Docs:**
      - **`docs/release-checklist.md` §2**, the "Chrome's download UI" item. Replace the R-005 lines with the design-test-harness.md L5 list:
        - no animation and no button for the first 12 files, not even `metadata.json`;
        - **one animation, at the last file**, which brings the button back; after `Saved · 12P` the bubble lists the 13 files;
        - two jobs: the button returns only with the last file of the job that ends last;
        - **a re-download served from the HTTP cache** (the last files land together) also shows exactly one animation, at the end;
        - **after a cancel, the button returns only with the next download** (accepted by R-006);
        - keep the other-site download line and the Windows Enhanced Safe Browsing line.
        - Tag the item "(R-005, R-006, PRD-000 §4.1 #3)".
      - **`e2e/README.md`:**
        - update the CUJ-1 row "Chrome's download bubble does not appear or animate…" and the two CUJ-4 rows to the new assertions;
        - in the "Chrome's download UI" harness paragraph, add a short note on the headed-only "Chrome toolbar" tests if it needs one;
        - run `npx prettier --write e2e/README.md`.
- **Files**:
  - `src/background/engine.ts`
  - `src/background/scheduler.ts`
  - `src/shared/constants.ts` (`HANDOFF_TARGET_WAIT_MS` only)
  - `src/background/download-ui.ts` (doc comments only)
  - `test/fakes/chrome.ts`
  - `test/unit/background/chrome-fake.test.ts`, `download-ui.test.ts`, `engine-download-ui.test.ts`
  - new `test/unit/background/scheduler-last-handoff.test.ts` (or `engine-scheduler.test.ts`)
  - `test/integration/sw-download-ui.test.ts`, `sw-restart.test.ts`, and `harness.ts` (a helper only, if needed)
  - `e2e/cuj1.spec.ts`, `e2e/cuj4.spec.ts`, `e2e/cuj2.spec.ts`, `e2e/cuj5.spec.ts`
  - `docs/release-checklist.md` §2
  - `e2e/README.md` (CUJ-1/CUJ-4 rows, the harness paragraph)

  Another existing test that fails **only** because of R-006's new call order (for example `sw-cancel.test.ts`) may get a minimal expectation fix. Report each one.
- **Done when**:
  - `npm run check` passes (typecheck, eslint, prettier, vitest, build).
  - The full `HFP_HEADLESS=1 npm run test:e2e` passes. Only the two headed-only "Chrome toolbar" tests skip, with their reason.
  - **Headed:** `npm run build:e2e && HFP_HEADLESS=0 npx playwright test e2e/cuj1.spec.ts -g "toolbar"` passes both tests. "toolbar: back after Saved" finds Chrome's downloads button in `chrome://accessibility`'s native-UI tree after `Saved · 12P`. Include the run's output in the report.

    If this environment cannot launch headed Chromium, say so explicitly. Do not report the task done.
  - Prod bundle clean: `npm run build:prod && ! grep -qE 'testHook|__hfpTest|await:(registry|resolver|handoff)' dist/*.js` exits 0.
  - The fake's call log after an idle boot:
    - a 12-page job reads exactly `ui:false, download×12, ui:true, download`, with `metadata.json` first and `135882741_p11.jpg` last, and nothing after the record delete;
    - cancel, failure (the failing page settles last), needs login (a 403 with nothing in flight) and Unavailable each read `… ui:true` after the record delete, with no `download` after it.
  - With `deferNaming(true)`, the last two files landing together give exactly one `ui:true`, logged only after the earlier file is named. Without a `name()`, the restore goes ahead after `HANDOFF_TARGET_WAIT_MS`.
  - `sw-restart.test.ts`:
    - both dry-run hit lists include `await:handoff.restoreUi`;
    - at every kill point each file is handed over exactly once;
    - the UI ends on;
    - exactly one `download` was made while the UI was on.
  - `src/manifest.json` permissions are unchanged (the five). `npm run size` stays within 40 / 15 KB.
  - `docs/release-checklist.md` §2 and the `e2e/README.md` CUJ-1/CUJ-4 rows state "one animation, at the last file" and the cancel note. `git diff e2e/README.md` shows changes only in those places.

## Conflict Risks

- **Single task, single group:** no intra-group file overlap.
- **Uncommitted design docs** (orchestrator prerequisite above): a worktree branched from `HEAD` before they are committed would not see "The last hand-off (R-006)", D12 rev. 2 or the R-006 harness rows. Commit `docs/design/*.md`, `docs/qa-report.md`, `docs/rulings.md`, `docs/owner-queue.md`, `docs/loop-state.md` and `docs/tasks.md` first.
- **QA-owned e2e blocks:**
  - `cuj1`/`cuj2`/`cuj4`/`cuj5` contain QA gate blocks. Only the expectations R-006 changes may move.
  - The headed "Chrome toolbar" assertions are QA's pin for this MEDIUM and must stay as written.
  - Any other e2e failure is a finding to report, not a test to edit.
- **`e2e/README.md` tables:** Prettier realigns a whole table when a cell widens a column. A whitespace-only realignment of the CUJ-1/CUJ-4 tables is expected. Content changes elsewhere are not.
- **Semantic:** the existing `engine-download-ui.test.ts` seeds with a single `saving` file now take the restore path. Re-seed them instead of loosening the assertions. Any change to `test/integration/harness.ts` must keep every other integration file green.

**Parallelism:** 1 task in 1 group. The fake, the rule, `handOff()` and every test assert the same call order, so splitting them would only serialize the work behind the engine change. The wall-clock is this one task.
