# Engineering Backlog

Engineering tasks: infrastructure, tooling, operational hardening, tech debt — work that is neither a defect (docs/issues.md) nor a product feature (docs/prd/). Entries are removed when done; history lives in git via commits referencing the ENG ID.

Next-ID: ENG-013

---

### ENG-012: Pin the R-006 rev. 3 counter ACs in tests and align the AC mappings

- **Filed**: 2026-10-23 22:35:36 (UTC-7)
- **Priority**: P1
- **Background**: Quick-fix `c2c9de0` made the busy period's last hand-off wait for every other file to finish (D12 rev. 3). It amended two PRD-000 lines: CUJ-1 AC "the label reads `N / 12` … up to `11 / 12` … `12 / 12` is never shown", and CUJ-5 step 5 "`9 / 12` → `11 / 12` … `Saved · 12P` directly" (design-download-engine.md "Progress counter"). Only the full-job integration test (`sw-pages.test.ts`) pins the new top value.
  - The e2e "counter and badge" test still accepts `12 / 12` (`seen.every((n) => n <= 12)`).
  - The CUJ-5 retry e2e and the `retryPages` integration case do not check the top value.
  - Two AC mappings still describe the old AC ("`12 / 12` only after every original").
  - The doc comment on `HANDOFF_SETTLE_WAIT_MS` still says the cap waits for Chrome "to name" the files.

  No product behaviour changes.
- **Scope**:
  - `e2e/cuj1.spec.ts` 'counter and badge': assert that no label in the log is `12 / 12`, that the last counter value is `11`, and that `Saved · 12P` directly follows `11 / 12`. Update AC-mapping row 7 at the top of the file to the amended AC.
  - `e2e/README.md`, CUJ-1 table row "`N / 12` only rises; `12 / 12` only after every original; …": reword to the amended AC.
  - `e2e/cuj5.spec.ts` 'partial', the retry half: from the label log after the retry click, assert that every counter value lies in `9 … 11`, that no label is `12 / 12`, and that the log ends `Saved · 12P`.
  - `test/integration/sw-pages.test.ts` 'retryPages continues the count from the earlier run': also assert that the running `done` values never decrease and that the last one is `11`.
  - `src/shared/constants.ts:82`: change the doc comment of `HANDOFF_SETTLE_WAIT_MS` to "Caps the wait for earlier in-progress files to finish before the UI restore (R-006 rev. 3)." This is comment-only. Commit it apart from the test changes (`chore:`), so each commit's type matches its paths.
- **Acceptance criteria**:
  - The four tests above assert the amended values and pass.
  - Mutation check: make `settle()` in `src/background/scheduler.ts` always return `[...leading, { type: 'badge' }, { type: 'push' }, ...pumped]`, so a running view is pushed before finalize. The cuj1 counter test, the cuj5 retry test and both `sw-pages` counter cases must then fail. Revert the mutation.
  - No AC mapping or code comment says the counter reaches `12 / 12`, or that the settle wait is for naming.
- **Verify**:
  - `npx vitest run test/integration/sw-pages.test.ts` passes.
  - `HFP_HEADLESS=1 npm run test:e2e -- e2e/cuj1.spec.ts e2e/cuj5.spec.ts --grep "counter and badge|partial"` passes.
  - `! grep -rnE '12 / 12`? only after|to name earlier' e2e src test` exits 0 and prints nothing.
  - The coder reports the names of the tests that failed under the mutation check.
- **Relates-to**: prd-000-mvp CUJ-1, CUJ-5
