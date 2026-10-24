# Task Plan

Last updated: 2026-10-23 22:40:40 (UTC-7)

## Current State

- **Dev-cycle iteration 4, Phase 2.** `main` is at `c2c9de0`.
  - Iteration 3 shipped R-005/R-006. Chrome's download UI is hidden while a job runs and comes back with the busy period's last file.
  - Iteration 3's QA retry 1 (`docs/qa-report.md`, run `iter3-19-38-54`, `main` at `68c35d7`) ended FAIL with **one `[LOW][BUG]`**: when the last files land together, the bubble can open before the last file exists and leave it out.
  - That LOW was **fixed between cycles by quick-fix `c2c9de0`** (D12 rev. 3). `othersSettled()` in `src/background/engine.ts` now waits until every other in-progress file has *finished*, not just been named, capped at `HANDOFF_SETTLE_WAIT_MS` = 2 s. QA's own race probe passed 8/8 on the fixed build. The report has not been re-run, so QA re-verifies this cycle.
  - Side effect, now spec: the pages counter climbs to `N−1 / N`, and `Saved` follows directly. The quick-fix amended two prd-000 lines:
    - CUJ-1 AC: "During the job the label reads `N / 12` with N rising as files complete, up to `11 / 12`; the last original is handed to Chrome only after every other file has finished, so its landing turns the button to `Saved` directly and `12 / 12` is never shown (Spec-sync: R-006 rev. 3)."
    - CUJ-5 step 5: "The busy state continues from the earlier count, `9 / 12` → `11 / 12`, and the badge shows `3`. On success the last retried page turns the button to `Saved · 12P` directly, so `12 / 12` is never shown."
  - tl's Phase 1 brought the design in line. It covers design-download-engine.md "Progress counter (pages jobs)" and "The last hand-off (R-006)" rev. 3, system.md D12 rev. 3 with the 2 s cap's rationale, and §15 gaps 1–3. tl also filed ENG-012. No requirement challenge.
- **Focus (priority ladder):**
  1. MEDIUM+ bugs: none open. The iteration-3 MEDIUM is resolved, and the LOW is fixed by `c2c9de0` and pending QA re-verification.
  2. `blocking` ENG: none.
  3. P1 ENG: **ENG-012**, the only open backlog entry. It pins the amended counter ACs in tests and fixes the stale AC mappings. It is test and comment work only, with no product behaviour change.
  4. LOW bugs and P2 ENG: none.
  - No CUJ work remains. pm has CUJ-2/3/5 Satisfied, and CUJ-1/4 at Caveats only on the LOW that `c2c9de0` fixed.
  - No routed defects. The owner queue is empty (Next-ID R-007).
  - So the plan is **one task in one group**. ENG-012's five edits are small, and most of them share the same two spec files, so splitting them would add overhead and no parallelism.
- **Document-authority notes. Not tasks; for `/spec-sync` with the owner and for tl.**
  - pm-review iteration 3 priorities 3a, 3b and 3c are pm spec-sync items, pending the owner through `/spec-sync`. Nothing is built for them this cycle. system.md §15 tracks them as open gaps 3, 2 and 1:
    - **3a:** reword §4.1 #3 "needed login after a mid-job 403" to "after a 403 with no other file still on its way to Chrome", and add the in-flight case to CUJ-5 step 9. No code change. QA keeps judging CUJ-5 step 9 against §4.1 #3's own definition of a final hand-off, as it did in iteration 3.
    - **3b:** the options-page footer links (`#0096FA` on `#f6f7f9`, 2.91:1) and the selected Ugoira segment (white on `#0096FA`, 3.11:1) fall below the index's 4.5:1 rule. That rule also claims, wrongly, that CUJ-3's colours pass. The build ships CUJ-3's literal values, so QA should not file these as bugs until the PRD changes.
    - **3c:** record a Chrome prompt on the ugoira frame zip as a known v1 limitation in CUJ-2's edge cases, with pm's pre-decided response. Nothing is built for it.
  - **Counter edge cases versus "`12 / 12` is never shown".** The PRD line is absolute. design-download-engine.md "Progress counter" lists two cases outside the PRD's examples where `N / N` can still show:
    - `metadata.json` is held past the 2 s cap, for example by a Save As dialog, a known v1 limitation;
    - in CUJ-4, job B's last page is not the busy period's last hand-off, and B's `metadata.json` is somehow still being written.

    pm's pre-decided exit (pm-review iteration 3, priority 1) accepts a residual that occurs only at the cap. The tests pin the PRD's own scenarios. pm/tl may want the AC to name the cap residual at the next `/spec-sync`. Not a blocker.
- **QA expectations for this cycle's gate.** These are deliberate behaviour since `c2c9de0`, not bugs:
  - **Counter.** A 12-page job climbs `0 / 12` … `11 / 12`, then shows `Saved · 12P` directly. `12 / 12` never shows. A CUJ-5 retry of 3 pages runs `9 / 12` … `11 / 12`, then `Saved · 12P`. A single page shows `0 / 1`, then `Saved`. Accepted exceptions:
    - a file held past the 2 s settle cap, where `N / N` can show until it lands;
    - job B in CUJ-4, whose last page is not the busy period's last hand-off.
  - **Re-verify the fixed LOW** with QA's race probe, `SCEN=race12-nohold REPS=8`, on **both** the dev build and the store zip (`npm run zip`, unzipped into an empty directory). Also run the two-job scenarios `SCEN=two-b-first,two-a-first` ×4. In every run, the bubble that opens with the done signal must list the last file, with still exactly one appearance. `Saved` should follow the restore within 100 ms on the fake.
  - **Re-run the headed R-006 matrix** (the 26 busy periods of `iter3-19-38-54`). Expect one appearance per busy period that has a final hand-off, and silent ends unchanged for cancel, `Retry · N failed`, `403-last` and Unavailable. Measure and report the maximum restore-to-last-file-created delay and the click-to-`Saved` time (pm priority 5b).
  - **Baseline on `main`:** the full `HFP_HEADLESS=1 npm run test:e2e` gives **143 passed / 4 skipped**. The 4 skipped are the headed-only "Chrome toolbar" tests, which pass 4/4 headed. ENG-012 adds no tests, so the counts should not change.
- **Orchestrator prerequisite.** These files are **uncommitted** on `main`:
  - tl's Phase 1 edits: `docs/design/design-artwork-button.md`, `design-download-engine.md`, `design-options-page.md`, `design-test-harness.md` and `system.md`;
  - `docs/eng-backlog.md`, which holds the ENG-012 entry (`HEAD` has only "Next-ID: ENG-012");
  - `docs/release-checklist.md`, `docs/loop-state.md` and this file.

  Commit them before creating the worktree. The task cites design-download-engine.md "Progress counter (pages jobs)", which exists only in the working tree today.
- **Rules for the coder:**
  - Do not edit `docs/prd/**` or `docs/design/**`. Report a design gap in the commit message and the task summary instead.
  - No product source change except the one comment in `src/shared/constants.ts`.
  - No new dependency, and no change to `package.json`, `package-lock.json` or the manifest.

## Parallel Group 1

### Task: 1.1 Pin the R-006 rev. 3 counter ACs in tests and align the AC mappings (ENG-012)

- **Governing spec** (prd-000, amended by `c2c9de0`; quote these in the AC mappings):
  - CUJ-1 AC: "During the job the label reads `N / 12` with N rising as files complete, up to `11 / 12`; the last original is handed to Chrome only after every other file has finished, so its landing turns the button to `Saved` directly and `12 / 12` is never shown (Spec-sync: R-006 rev. 3). `metadata.json` never changes N."
  - CUJ-5 step 5: "The busy state continues from the earlier count, `9 / 12` → `11 / 12`, and the badge shows `3`. On success the last retried page turns the button to `Saved · 12P` directly, so `12 / 12` is never shown (Spec-sync: R-006 rev. 3)."
  - Design: `docs/design/design-download-engine.md` "Progress counter (pages jobs)". Two rules give the last running value `N−1`:
    - `settle()` in `src/background/scheduler.ts:118-122` emits no running `push` when pump finalizes;
    - the last hand-off waits for every other file to finish, capped at 2 s.
- **Do**:
  1. **`e2e/cuj1.spec.ts`, test `'counter and badge: N / 12 only rises, metadata.json never counts, badge = pages left'`** (around lines 365–425). Keep the test title unchanged, because the Verify `--grep` matches it.
     - Replace `expect(seen.every((n) => n <= 12)).toBe(true);` (line 408) with assertions that:
       - no entry in `log` has the text `12 / 12`;
       - `seen.at(-1)` is `11`;
       - `Saved · 12P` directly follows `11 / 12`: the last non-empty entry before the final `Saved · 12P` is `11 / 12`. Skip an empty text only if the observer records a transient blank face, and say so in a comment if you do. Use the existing `counts()` helper (line 110) and `labelLog()`.
     - Reword the stale comment at line 392, "12 / 12 needs the last original: …", so it no longer implies `12 / 12` shows. For example: "the counter holds at 11 while page 11 is in flight; its landing turns the button to Saved directly".
     - Update **AC-mapping row 7** at the top of the file. It currently reads `` `N / 12` only rises; 12 / 12 only after every original; metadata ≠ N ``. Make it the amended AC, for example `` `N / 12` only rises, up to `11 / 12`, then `Saved` directly (`12 / 12` never shown); metadata ≠ N ``. Wrap onto a continuation row (`// |    … |  |`) if it does not fit the column width, as `e2e/cuj5.spec.ts` rows 5–6 do.
  2. **`e2e/README.md`, CUJ-1 table** (line 192). The row reads `` `N / 12` only rises; `12 / 12` only after every original; metadata never changes N ``. Reword it to the same amended AC, then run `npx prettier --write e2e/README.md` so the table realigns (`npm run lint` runs `prettier --check .`, which covers `e2e/`).
  3. **`e2e/cuj5.spec.ts`, test `'partial: Retry · 3 failed with the exact tooltip; retry fetches only those 3 into the same folder → Saved · 12P'`** (around lines 455–510), the retry half. Keep the title.
     - Import `watchLabels` and `labelLog` from `./harness/hfp-button`.
     - Call `await watchLabels(page)` after the button settles on `Retry · 3 failed` and before the retry `clickButton(page)`.
     - After `settle(page, 'Saved · 12P')`, read `labelLog(page)` and assert that:
       - every `N / 12` value in the log lies in `9 … 11`. Parse the values with a small local `counts`-style helper, or move cuj1's `counts()` into `e2e/harness/hfp-button.ts` and import it in both files;
       - no entry is `12 / 12`;
       - the log's last entry is `Saved · 12P`.
     - AC-mapping row 6 ("… ends `Saved · 12P`") stays accurate. Optionally add "via `9 / 12` → `11 / 12`".
  4. **`test/integration/sw-pages.test.ts`, case `'sw: retryPages continues the count from the earlier run'`** (around line 427). Collect the running `done` values the same way as the full-job case at lines 163–175 (`tab.views` filtered to `status === 'running'` and `progress.kind === 'pages'`). Then also assert that:
     - they never decrease;
     - the last one is `11`.

     Keep the existing first-view (`done: 9`) and ended-outcome assertions.
  5. **Mutation check.** Do this before committing, and do not commit it.
     - Temporarily make `settle()` in `src/background/scheduler.ts` always return `[...leading, { type: 'badge' }, { type: 'push' }, ...pumped]`, so a running view is pushed before finalize.
     - Run the cuj1 counter test, the cuj5 partial test and the two `sw-pages` counter cases (`'sw: pushes k / 12 progress as pages land, and the last page ends the job'` and the retryPages case). All four must fail.
     - Record the failing test names.
     - Revert, and confirm that `git diff src/background/scheduler.ts` is empty.
     - If a test does not fail under the mutation, strengthen it. Do not weaken the check.
  6. **`src/shared/constants.ts:82`**, comment only. Change the doc comment of `HANDOFF_SETTLE_WAIT_MS` to exactly: `/** Caps the wait for earlier in-progress files to finish before the UI restore (R-006 rev. 3). */`. The value stays `2000`.
  7. **Two commits**, with conventional types that match their paths. Use `git commit --only <paths>`, and check `git diff --cached --name-only` before each:
     - `test: pin the 11 / 12 counter top and Saved-directly in e2e and integration (ENG-012)`: `e2e/cuj1.spec.ts`, `e2e/cuj5.spec.ts`, `e2e/README.md`, `test/integration/sw-pages.test.ts`, plus `e2e/harness/hfp-button.ts` only if `counts()` moved there.
     - `chore: correct the HANDOFF_SETTLE_WAIT_MS comment (ENG-012)`: `src/shared/constants.ts` only.
- **Files**: `e2e/cuj1.spec.ts`, `e2e/cuj5.spec.ts`, `e2e/README.md`, `test/integration/sw-pages.test.ts`, `src/shared/constants.ts` (comment only), and optionally `e2e/harness/hfp-button.ts` (if `counts()` is shared). Read-only: `src/background/scheduler.ts` (mutation check, reverted), `docs/design/design-download-engine.md` "Progress counter (pages jobs)".
- **Done when**:
  - The four tests above assert the amended values and pass:
    - cuj1 'counter and badge';
    - cuj5 'partial';
    - sw-pages 'pushes k / 12 progress …';
    - sw-pages 'retryPages continues the count …'.
  - Mutation check: make `settle()` in `src/background/scheduler.ts` always return `[...leading, { type: 'badge' }, { type: 'push' }, ...pumped]`, so a running view is pushed before finalize. The cuj1 counter test, the cuj5 retry test and both `sw-pages` counter cases must then fail. Revert the mutation.
  - No AC mapping or code comment says the counter reaches `12 / 12`, or that the settle wait is for naming.
  - **Verify** (verbatim from ENG-012):
    - `npx vitest run test/integration/sw-pages.test.ts` passes.
    - `HFP_HEADLESS=1 npm run test:e2e -- e2e/cuj1.spec.ts e2e/cuj5.spec.ts --grep "counter and badge|partial"` passes.
    - `! grep -rnE '12 / 12`? only after|to name earlier' e2e src test` exits 0 and prints nothing.
    - The coder reports the names of the tests that failed under the mutation check.
  - `npm run check` passes: typecheck, eslint, prettier including `e2e/README.md`, vitest and build.
  - The full `HFP_HEADLESS=1 npm run test:e2e` still reports 143 passed / 4 skipped.
  - `git diff c2c9de0 -- src/` after both commits shows only the one comment line in `src/shared/constants.ts`.
  - Exactly two commits, `test:` and `chore:`, each carrying only its own paths, both referencing ENG-012.
  - The task summary lists the mutation-check failures by test name and the Verify outputs.

## Conflict Risks
- One task in one group, so there are no in-group file conflicts.
- `e2e/harness/hfp-button.ts` is shared by every e2e spec. Moving `counts()` there is additive (a new export), and no other task touches it this cycle.
- QA's Phase 4 gate additions usually append tests to `e2e/cuj1.spec.ts` and `e2e/cuj5.spec.ts`. They run after this task merges, so they will not overlap.
