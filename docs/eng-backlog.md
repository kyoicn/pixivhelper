# Engineering Backlog

Engineering tasks: infrastructure, tooling, operational hardening, tech debt — work that is neither a defect (docs/issues.md) nor a product feature (docs/prd/). Entries are removed when done; history lives in git via commits referencing the ENG ID.

Next-ID: ENG-015

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

---

### ENG-014: Test-double support for the folder choice and the offscreen readiness fix (fake chrome + e2e harness)

- **Filed**: 2026-10-27 20:32:56 (UTC-7)
- **Priority**: P1
- **Background**: Two iteration-5 designs need test doubles the harness does not have. (1) The folder choice (design-download-engine.md "Folder choice", D15) relies on Chrome's asynchronous file-existence re-check that `chrome.downloads.search` triggers; the fake `downloads.search` has no disk model, so neither "folder moved → plain name again" nor the stale-flag residual can be tested at L2, and the e2e harness has no way to remove a folder, wait out Chrome's 10 s re-check rate limit, or clear the history. (2) The offscreen readiness fix (design-offscreen-worker.md "Lifecycle", D16) closes a race the fake cannot reproduce: `FakeOffscreen.createDocument` never lists a document before it listens, which is exactly the window QA hit 14/16 times. Without these doubles the feature and fix tasks have no discriminating tests (the mutation checks in both chapters depend on them).
- **Scope**: `test/fakes/chrome.ts` and `e2e/harness/launch.ts` (plus `e2e/harness/flows.ts` if a helper fits there); unit tests of the fake in `test/unit/background/chrome-fake.test.ts`. No change under `src/`.
  - `FakeDownloads`: a disk model (`removeFile(id)`, `removeFiles(predicate)`) that leaves `exists` untouched until the next `search()`; `search()` schedules the re-check of every complete, unflagged item after `existenceCheckDelay` (default 0 → next macrotask): `exists = false` plus one `onChanged({ id, exists: { previous: true, current: false } })`, never cleared again; `existenceCheckDelay(ms)`; `addCompleted(relativePath, { exists?, byExtensionId? })`; `search` honours `limit: 0` as "all" (already true via the falsy check: pin it) and filters scalar fields, `filenameRegex`, `urlRegex`; `uniquify` ignores removed files. Chrome's 10 s rate limit is not modelled (design-test-harness.md L2).
  - `FakeOffscreen`: `holdCreation(): { release }` (document listed by `getContexts` but without a listener until release; `createDocument` resolves at release) and `holdClose(): { release }` (listeners dropped at once, document listed until release; `closeDocument` resolves at release). Unheld behaviour unchanged.
  - E2E harness: `downloads.remove(relativePath)`, `downloads.move(from, to)`, `downloads.expireExistenceCheck()` (waits `EXISTENCE_RECHECK_RATE_LIMIT_MS + 500` = 10 500 ms, constant with the comment from design-test-harness.md), `downloads.eraseHistory()` (`swEval(() => chrome.downloads.erase({}))`).
- **Acceptance criteria**:
  - `chrome-fake.test.ts` covers: `removeFile` then `search` → the item reads `exists: false` after `vi.advanceTimersByTimeAsync(0)` and one `exists` delta fired; a second `search` fires no second delta; `existenceCheckDelay(400)` → the flag flips only after 400 ms; `search({ filenameRegex })` matches on `DOWNLOADS_DIR`-prefixed absolute filenames, with `limit: 0` returning all and `limit: 2` two; `addCompleted` records are found by `search` and respected by `uniquify`; after `removeFile` a `download()` to the same path gets the clean name.
  - `chrome-fake.test.ts` covers: during `holdCreation()`, `getContexts` lists the document and `runtime.sendMessage` to it rejects with `RECEIVING_END_ERROR`; after `release()` the scripted handler answers and the `createDocument` promise has resolved; during `holdClose()`, the document is listed and deaf, and after `release()` it is gone and `closeDocument` has resolved.
  - The e2e helpers exist with the documented signatures; `expireExistenceCheck` is used only where design-test-harness.md says (moved-folder and gap cases).
  - Every existing test passes unchanged (the holds and the disk model are opt-in).
- **Verify**:
  - `npx vitest run test/unit/background/chrome-fake.test.ts` passes and its output lists the new test names (grep: `removeFile`, `existenceCheckDelay`, `holdCreation`, `holdClose`).
  - `npm run check` passes; `npx tsc -p tsconfig.json --noEmit` reports no error in `e2e/harness/`.
- **Ordering**: before the L2/e2e tests of the iteration-5 CUJ-1 folder-choice task and of the offscreen-readiness task; the `src/` changes of both can start in parallel.
- **Relates-to**: prd-000-mvp CUJ-1 (step 8, edges), CUJ-4 AC 5; docs/qa-report.md iteration 4 LOW #1
