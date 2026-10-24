# Engineering Backlog

Engineering tasks: infrastructure, tooling, operational hardening, tech debt — work that is neither a defect (docs/issues.md) nor a product feature (docs/prd/). Entries are removed when done; history lives in git via commits referencing the ENG ID.

Next-ID: ENG-014

---

### ENG-013: Pin the settle wait's search fallback and its cross-job ids in unit tests

- **Filed**: 2026-10-23 23:02:22 (UTC-7)
- **Priority**: P2
- **Background**: The busy period's last hand-off waits in `othersSettled()` (`src/background/engine.ts`) until every other in-progress file has finished (D12 rev. 3, design-download-engine.md "The last hand-off (R-006)", step 3). The iteration-4 code review (docs/code-review.md, Warning 1) mutated that function in a scratch copy of `0ce05cd`. Two of its parts can be removed with all 3066 vitest tests still passing:
  - **The `downloads.search` fallback.** Replacing `if (!item || item.state !== 'in_progress') pending.delete(id);` with a no-op fails no test. The search is what releases the wait when an earlier file finished before the watcher was added, while its record still says `saving`. Without it the restore, and so `Saved`, waits for the 2 s cap. At rev. 2 the progress test pinned the search incidentally; that pin went away when the test was adapted to rev. 3.
  - **The other jobs' in-progress files** (`otherSavingIds()` across jobs, CUJ-4). Limiting `otherSavingIds()` to the hand-off's own job fails no test. That regression brings the bubble race back for two jobs: job B's file finishing after job A's last hand-off turns the UI on opens the bubble before A's last file exists. Only QA's two-job race probe would notice it.

  No product behaviour changes.
- **Scope**: `test/unit/background/engine-download-ui.test.ts`, in the `'engine: the last hand-off restores the UI first (R-006)'` describe. Add three tests that reuse the file's helpers (`seedJob`, `unnamedInChrome`, `hydrated`, `land`, `flush`, `stubUi`, `downloadsOf`):
  1. `'handOff: an earlier file Chrome already finished lets the restore go ahead at once (downloads.search)'`. Call `unnamedInChrome(0)`, then `fake.downloads.complete(<its downloadId>)` **before** `hydrated()`, so the engine never sees that delta and the record still says `saving`. Seed `job-1` with `[inChrome, fetching(1)]`, `land(engine, 1)`, `await flush()`, and assert `[stub.events, downloadsOf()]` equals `[['restore'], [p(0), p(1)]]` with no timer advanced past `flush()`.
  2. `'handOff: an earlier download Chrome no longer knows lets the restore go ahead at once'`. Seed page 0 as `saving` with `blobUrl: blob(0)` and `downloadId: 99`, an id the fake has no item for, next to `fetching(1)`. `land(engine, 1)`, `await flush()`, and assert `[stub.events, downloadsOf()]` equals `[['restore'], [p(1)]]`.
  3. `'handOff: another job’s file still in progress holds the last hand-off’s restore back until it finishes'`. Seed `job-1` with `[fetching(0)]`, and seed `job-2` with one page that is `saving` in Chrome and still `in_progress`. Create that download before `hydrated()` with `` chrome.downloads.download({ url: blob(9), filename: `${FOLDER}/other_p0.jpg`, conflictAction: 'uniquify', saveAs: false }) ``; the distinct name keeps `uniquify` from renaming `p(0)`. `land(engine, 0)` and `flush()`, then assert `stub.events` is `[]`. Then `fake.downloads.complete(<job-2's downloadId>)` and `flush()`, and assert `stub.events` is `['restore']` and the call log ends with `p(0)`.

  No change under `src/`, `e2e/` or `docs/`.
- **Acceptance criteria**:
  - The three tests pass on the unchanged source. The review prototyped all three in a scratch copy of `0ce05cd`: they pass there, the first mutation below fails tests 1 and 2, and the second fails test 3.
  - Mutation check (apply, run, revert; never commit):
    - `src/background/engine.ts`: replace `if (!item || item.state !== 'in_progress') pending.delete(id);` with `void item; void id;`. Tests 1 and 2 fail.
    - `src/background/engine.ts`, in `otherSavingIds()`: insert `.filter((job) => job.jobId === self.jobId)` between `.list()` and `.flatMap(`. Test 3 fails.
  - `git diff -- src/` is empty after the revert.
- **Verify**:
  - `npx vitest run test/unit/background/engine-download-ui.test.ts` passes, and its output lists the three new test names.
  - `npm run check` passes.
  - The coder reports, for each mutation above, the names of the tests that failed.
- **Relates-to**: prd-000-mvp CUJ-1, CUJ-4
