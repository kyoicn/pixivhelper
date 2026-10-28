# Task Plan

Last updated: 2026-10-27 20:51:06 (UTC-7)

## Current State

- **Dev-cycle iteration 5, Phase 2.** `main` is at `8a65084`. 1.0.0 is live on the Chrome Web Store, so everything here ships as an update. The upgrade-safety notes in `docs/design/system.md` apply: `JobRecord`, storage and permissions are unchanged by both designs below, so no migration is needed.
- **QA, iteration 4** (`docs/qa-report.md`, run `iter4-22-53-54`): FAIL with 2 LOW, 0 MEDIUM or higher.
  - LOW #1, the offscreen creation race: tl has designed the fix as **D16** (design-offscreen-worker.md "Lifecycle"). It holds CUJ-1 and CUJ-4 at PM Caveats (pm-review iteration 4, priority 1).
  - LOW #2, the one-frame `N / N`: now spec per R-007 item 1 (applied in `82db9ef`, `c8d95bc`). No code.
- **PM, iteration 4**: CUJ-2, CUJ-3 and CUJ-5 Satisfied; CUJ-1 and CUJ-4 Caveats, held for the race only.
- **CUJ-1 was refined on 2026-10-27** (`8a65084`, Issue 2026-10-27-19-58-31), so its status row is reset. A repeat download of the same artwork now goes to a sibling folder `<folder> (n)`, chosen from Chrome's download history. tl designed this as **D15**: design-download-engine.md "Folder choice", system.md §14 D15, design-settings-model.md "Folder-choice suffix (D15)", design-artwork-button.md "Presentation" and design-test-harness.md L2/L3. No content-script code changes: the Saved tooltip already interpolates `JobOutcome.saved.folder`.
- **Backlog**:
  - ENG-014 (P1) adds the test doubles both designs need. Its Ordering rule is "before the L2/e2e tests of the folder-choice and readiness tasks; `src/` work can start in parallel".
  - ENG-013 (P2) is test-only.
  - Nothing is `blocking`. No routed defects. The owner queue is empty.
- **Focus, from the priority ladder:**
  - tiers 1 and 2: nothing;
  - tier 3: D16, D15 (CUJ-1) and ENG-014, interleaved;
  - tier 4: ENG-013.
- **Expected red e2e between the groups.** After Group 1 merges, the e2e tests that expect a repeat run's files uniquified in the same folder go red until Task 2.2 rewrites them. These are `e2e/cuj1.spec.ts` 're-download' and 'sanitized folder', `e2e/cuj2.spec.ts` ~L1029, and `e2e/cuj5.spec.ts` ~L552 and ~L887. `npm run check` (vitest) must stay green at every merge.
- **Spec note, not a contradiction to resolve here.** design-download-engine.md "Open Questions & Risks" #1 (system.md §15) records a gap in PRD §4.2 and the CUJ-1 edge/AC "First folder moved … the next run lands in the plain folder again". Chrome re-checks file existence at most once per 10 s per profile, and the PRD does not say so. The behaviour the PRD describes is still what gets built, and the e2e cases wait out the limit with `expireExistenceCheck()`. tl has suggested an amendment ("after at least 10 s") for pm. It is not an owner decision, so nothing goes to `docs/owner-queue.md`.

## Parallel Group 1

### Task: CUJ-1 folder choice: a repeat download goes to `<folder> (n)` (D15, `src/`, unit tests)

- **Read first:**
  - `docs/prd/prd-000-mvp.md` §4.3 "Folder choice" and "Name conflicts", CUJ-1 step 8, edges and ACs, all marked "(Refined 2026-10-27, Issue 2026-10-27-19-58-31)";
  - `docs/design/design-download-engine.md` "Resolving (resolver.ts)" step 4 and the whole "Folder choice (folder-choice.ts …; D15)" section;
  - `docs/design/design-settings-model.md` "Folder-choice suffix (D15)" and its Testing bullet;
  - `docs/design/design-artwork-button.md` "Presentation", the `tip_saved` paragraph and the Testing unit bullet.
- **Governing PRD lines** (build against these):
  - "the worker asks Chrome's download history, in one `chrome.downloads.search` call with a filename regex, for completed downloads whose path is `<Downloads>/<folder>/` or `<Downloads>/<folder> (n)/` followed by a file of **this artwork**: a basename starting with `<id>_` or `<id>.`" … "`metadata.json` and `frames.json` are never consulted" … "Only the folder's **last path segment** can carry a suffix";
  - "The job uses the lowest n ≥ 0 with no surviving record … Gaps are reused."
- **Do:**
  1. **Create `src/shared/folder-choice.ts`.** It is pure and uses no `chrome.*`. It exports exactly what the design specifies:
     - `escapeRegex(s)` (escapes `[\\^$.|?*+()[\]{}]` with a backslash);
     - `folderCheckRegex(folder, artworkId)`, which returns `` `(?:^|${SEP})${segments joined by SEP}(?: \\((\\d+)\\))?${SEP}${artworkId}[_.][^\\\\/]*$` `` with `SEP = '[\\\\/]'`. Capture group 1 is n; it is absent for the plain folder. Only RE2 ∩ ECMAScript syntax: no lookaround, no backreference, no `\Q`;
     - `folderIndexOf(filename, folder, artworkId): number | null`;
     - `lowestFreeIndex(taken: Iterable<number>): number`;
     - `withFolderIndex(folder, n)`, which returns `folder` for 0 and `` `${folder} (${n})` `` otherwise.
  2. **Create `src/background/folder-choice.ts`.** It exports `FolderChoiceDeps { search, sleep }` and `chooseFolder(folder, artworkId, deps = DEFAULT_DEPS): Promise<string>`. `DEFAULT_DEPS` must resolve `chrome.downloads.search` at call time, not at import time, so the fakes installed by tests are used. The behaviour:
     - The query is `{ filenameRegex, state: 'complete', limit: 0 }`.
     - First search. If it is empty, return `folder` at once, with no timer.
     - Otherwise `sleep(FOLDER_CHECK_RECHECK_WAIT_MS)`, then run the same search again. The second result replaces the first.
     - Keep the items with `exists !== false`. Map each to `folderIndexOf` and drop the nulls. Then take `withFolderIndex(folder, lowestFreeIndex(taken))`.
     - Belt check: if `!isSafeRelativeFolder(chosen)` (from `src/shared/pattern.ts`), `log.warn` and return `folder`.
     - Log `log.debug('folder choice', { artworkId, records, surviving, chosen })`. Log only the relative chosen folder, never the absolute paths Chrome returns.
     - Any throw, or a non-array result, from either search → `log.warn('folder check failed, using the plain folder', error)` and return `folder`. `chooseFolder` never rejects.
  3. **Add the constant to `src/shared/constants.ts`.** Put `FOLDER_CHECK_RECHECK_WAIT_MS = 250` at the **end** of the "Timings" block, right after `HANDOFF_SETTLE_WAIT_MS`, with a one-line comment: the wait for Chrome's asynchronous existence re-check before the second search (D15). Task 1.2 edits the same block next to `OFFSCREEN_CLOSE_GRACE_MS`; keep your hunk at the end.
  4. **Wire it into `src/background/resolver.ts`.**
     - Add `chooseFolder: (folder: string, artworkId: string) => Promise<string>` to `ResolverDeps`.
     - In `resolveFull`, after `resolveFolder(...)`, run the choice **concurrently** with the mode's second API call: `/pages` for illustType 0/1; `ugoira_meta` plus the caps probe for illustType 2. For example `const [pages, chosen] = await Promise.all([fetchPages(job, deps), deps.chooseFolder(folder, job.artworkId)])`.
     - Use `chosen` as `plan.folder`. Nothing is queued before both resolve.
     - A failed API call discards the choice and returns the failure as today.
     - Retry modes never call `chooseFolder`; they keep `request.folder`.
     - Do not add a new `__testHook` await point. The restart test enumerates the existing ones.
  5. **Inject the real `chooseFolder` in `src/background/engine.ts`** (the `resolve(job, { apiFetchJson, getCaps })` call, ~L366).
  6. **Add unit tests.**
     - **`test/unit/shared/folder-choice.test.ts`** (new). `folderCheckRegex` matches:
       - `/Users/aoi/Downloads/pixiv/みずき-135882741/135882741_p0.jpg` (n = 0);
       - `C:\Users\aoi\Downloads\pixiv\みずき-135882741 (2)\135882741_p11.png` (n = 2);
       - `…/135882741_ugoira.zip`, `…/135882741.mp4`, `…/135882741.webm`;
       - `…/135882741_p0 (1).jpg`.

       It rejects:
       - `…/metadata.json` and `…/frames.json`;
       - `…/1358827411_p0.jpg`;
       - `…/mypixiv/みずき-135882741/…`;
       - `…/pixiv (1)/みずき-135882741/…`;
       - `…/みずき-135882741/sub/135882741_p0.jpg`.

       More cases:
       - a folder with regex specials, `pixiv/(sora)+[x]-1`;
       - a last segment already ending in ` (2)`: records in `… (2)/` are n = 0, and `… (2) (1)/` is n = 1;
       - a `{title}` segment with `.` and `$`;
       - the regex source contains no `(?=`, `(?!`, `(?<`, `\1`… or `\Q`;
       - `folderIndexOf` returns `null` for `metadata.json`;
       - `lowestFreeIndex` over `{}`, `{0}`, `{1}`, `{0,2}`, `{0,1,2}`, duplicates and unsorted input;
       - `withFolderIndex(f, 0) === f`.
     - **`test/unit/background/folder-choice.test.ts`** (new). Inject **stubbed `deps.search` and `deps.sleep`** (the fake's disk model arrives in Task 1.3; Task 2.1 adds the fake-based cases to this file). Cases:
       - present → `(1)`, with exactly two searches carrying `state: 'complete'`, `limit: 0` and the regex;
       - absent → plain, with one search and no `sleep` call;
       - second search reports `exists: false` for every record → plain;
       - the gaps: surviving {1} → plain; surviving {0, 2} → `(1)`;
       - another artwork's records → ignored;
       - first search rejects → plain plus a `warn`; second search rejects → plain;
       - non-array result → plain.
     - **`test/unit/background/engine-resolver.test.ts`.** Add a `chooseFolder` stub to the deps used there, then:
       - `full` passes the resolved folder and the artwork id and uses the answer as `plan.folder`, for pages and ugoira;
       - it is called before `/pages` answers (hold the `/pages` stub and assert the call);
       - `retryPages`, `retryEncode` and `retryMetadata` never call it;
       - a `/pages` failure after an answered `chooseFolder` still fails the resolve.
     - **`test/unit/pattern.test.ts`** (`isSafeRelativeFolder` describe). For every Golden example folder `f` and `n ∈ {1, 2, 10, 999}`, `isSafeRelativeFolder(f + ' (' + n + ')')` is true. The same holds for `_CON (1)`, `My.url_ (1)`, `so_ra-1 (1)` and `pixiv/みずき-135882741 (1)`.
     - **`test/unit/button/model.test.ts`** (or the file that tests `present()` / `startRequest`):
       - a `saved` state whose `folder` ends in ` (1)` → `tip_saved`, `aria_saved_pages` and `aria_saved_ugoira` carry the suffix verbatim, in all 4 locales;
       - `startRequest` for `error.partial` with a `(1)` folder echoes it unchanged.
  7. **Update existing tests that pinned the old repeat-run behaviour.**
     - `test/integration/sw-pages.test.ts` 'sw: a second run of the same artwork gets uniquified names' (~L236–253). It now expects the second run in `` `${FOLDER} (1)/` `` with clean names (`${ID}_p0.jpg`, `metadata.json`) and the plain folder unchanged. Rename the test to say so.
     - Run the whole vitest suite and adapt any other unit or L2 test that runs two `full` jobs of one artwork. Under fake timers the second job now needs the 250 ms sleep advanced.
     - Do not edit `test/fakes/chrome.ts` (Task 1.3 owns it) or anything under `e2e/` (Task 2.2).
- **Files:**
  - `src/shared/folder-choice.ts` (new), `src/background/folder-choice.ts` (new), `src/background/resolver.ts`, `src/background/engine.ts`, `src/shared/constants.ts`;
  - `test/unit/shared/folder-choice.test.ts` (new), `test/unit/background/folder-choice.test.ts` (new), `test/unit/background/engine-resolver.test.ts`, `test/unit/pattern.test.ts`, `test/unit/button/model.test.ts`, `test/integration/sw-pages.test.ts`.
- **Done when:**
  - Every case listed above exists and passes. `npx vitest run test/unit/shared/folder-choice.test.ts test/unit/background/folder-choice.test.ts test/unit/background/engine-resolver.test.ts` lists the new test names.
  - Mutation checks. Apply each, run, revert, never commit, and report which tests failed for each:
    - (a) `folderCheckRegex` without the `(?:^|${SEP})` boundary → the `mypixiv` case fails;
    - (b) `chooseFolder` filtering `exists === true` → nothing should fail (the loose test is for the fakes; report it);
    - (c) `resolveFull` awaiting `chooseFolder` after `fetchPages` instead of `Promise.all` → the concurrency test fails;
    - (d) the retry path calling `chooseFolder` → the retry test fails.
  - `git diff -- e2e/ test/fakes/` is empty.
  - `npm run check` passes.

### Task: Offscreen readiness: no file fails while the document is being created or closed (D16, `src/`, unit tests)

- **Read first:**
  - `docs/design/design-offscreen-worker.md` "Lifecycle (owned by `src/background/offscreen-client.ts`; D16, revised iteration 5)", including the code block and the "Readiness (D16)" and "Bound" bullets, and the "Testing" bullet "Lifecycle (D16)";
  - `docs/design/system.md` §14 D16;
  - `docs/qa-report.md`, the first `[LOW][BUG]`;
  - `docs/pm-review.md` "Recommended Next-Iteration Priorities" item 1.
- **Governing PRD line:** CUJ-4 AC 5, "Starting a second artwork while one is running begins downloading the second immediately". pm accepts a wait of a few ms while the shared document loads, bounded at ≤ 1 s.
- **Do:**
  1. **Add two constants to `src/shared/constants.ts`.** Put them directly after `OFFSCREEN_CLOSE_GRACE_MS` (Task 1.1 appends at the end of the "Timings" block; stay at this spot):
     - `OFFSCREEN_READY_WAIT_MS = 1000`: how long a command whose send finds no listener keeps being resent, from the first such rejection (pm's bound);
     - `OFFSCREEN_RESEND_DELAY_MS = 25`.
  2. **Rewrite `src/background/offscreen-client.ts` to the design's code.**
     - Add module state `closing: Promise<void> | null`.
     - `ensureOffscreen()`:
       - `cancelScheduledClose()`;
       - (a) `if (closing) await closing;`;
       - (b) `if (creating) return creating;` **before** `chrome.runtime.getContexts`;
       - the `getContexts` lookup, returning if it lists a context;
       - (c) re-check `creating` after that await;
       - then `creating = chrome.offscreen.createDocument(...)`;
       - (d) `.catch` that swallows a rejection whose message contains `Only a single offscreen document may be created` and rethrows anything else;
       - `.finally(() => { creating = null; })`.
     - `send()` becomes a loop: `await ensureOffscreen()`, then `sendMessage`. On a "Receiving end does not exist" rejection, set `deadline ??= Date.now() + OFFSCREEN_READY_WAIT_MS`, throw if `Date.now() + OFFSCREEN_RESEND_DELAY_MS > deadline`, otherwise `log.debug('offscreen document not listening yet, resending', cmd.type)`, sleep `OFFSCREEN_RESEND_DELAY_MS` and loop. Any other rejection propagates at once.
     - `scheduleClose()` stores the `closeDocument()` promise in `closing`, with the existing `.catch` debug log, and clears it in `.finally`.
     - Update the doc comments to match. Engine behaviour after the bound is unchanged: the file fails `internal` with `attempts: 0`, as a refused ack does.
  3. **Rewrite the `send` tests in `test/unit/background/offscreen-client.test.ts`** that pin the old single resend: 'send: re-ensures the document and resends once when the receiving end is gone' and 'send: gives up after one re-ensure'. Add the D16 cases that need no new fake support:
     - **Test 4:** a document with no listener (the fake without `setHandler`) → `sendMessage` is called every 25 ms, at most 41 times, and the rejection propagates no earlier than 1000 ms after the first. A rejection with another message propagates at once, after one call. Use fake timers.
     - **Test 5:** a `createDocument` that rejects with "Only a single offscreen document may be created." resolves `ensureOffscreen()`, and the next `send` is delivered. For example, stub `chrome.runtime.getContexts` to return `[]` once while the fake's document exists; the fake's own `createDocument` then rejects with exactly that message.
     - **Rule (a) without holds:** `scheduleClose()`, advance `OFFSCREEN_CLOSE_GRACE_MS`, and call `send` before the close's tick resolves → the command is delivered to a fresh document (`createDocument` called twice).

     The hold-based tests 1–3 and the integration test 6 belong to Task 2.1, after ENG-014's `holdCreation`/`holdClose` exist. Do not edit `test/fakes/chrome.ts`.
  4. **Run the whole vitest suite.** Any L2 or unit test that relied on the immediate second failure, such as a test with no offscreen handler expecting a file to fail at once, now takes up to 1 s of (fake) time. Adapt it by advancing timers or installing a handler, without weakening what it asserts.
- **Files:** `src/background/offscreen-client.ts`, `src/shared/constants.ts`, `test/unit/background/offscreen-client.test.ts`, plus any test the full run shows depending on the single resend.
- **Done when:**
  - Tests 4 and 5 and the rule-(a) case pass, and `npx vitest run test/unit/background/offscreen-client.test.ts` lists them.
  - Mutation check. Apply, run, revert, report the failing test names: replacing the resend loop with one immediate resend fails test 4.
  - `git diff -- test/fakes/ e2e/` is empty.
  - `npm run check` passes.

### Task: Test-double support for the folder choice and the offscreen readiness fix (ENG-014)

- **Read first:**
  - `docs/eng-backlog.md` ENG-014, the whole entry;
  - `docs/design/design-test-harness.md`: the L2 `downloads` bullet ("Existence re-check (D15, folder choice)"), "Offscreen lifecycle holds (D16)", and the L3 helpers `downloads.remove`/`move`/`expireExistenceCheck`/`eraseHistory`;
  - `docs/design/design-download-engine.md` "Folder choice", platform facts 1–4.
- **Do** (scope per ENG-014; no change under `src/`):
  1. **Extend `FakeDownloads` in `test/fakes/chrome.ts`.**
     - **Disk model.** `removeFile(id)` and `removeFiles(predicate)` mark a completed download's file as gone without touching the record: `exists` stays `true` until the next `search()`.
     - **Re-check on `search()`.** Every `search()` schedules a re-check of every complete, not-yet-flagged item after `existenceCheckDelay` (default 0, the next macrotask). A gone item then gets `exists = false` and fires one `onChanged({ id, exists: { previous: true, current: false } })`. The flag is never cleared again.
     - **`existenceCheckDelay(ms)`** sets that delay.
     - **`addCompleted(relativePath, { exists?, byExtensionId? })`** seeds a finished record.
     - **Pin existing `search` behaviour.** `search` honours `limit: 0` as "all" (already true through the falsy check) and filters scalar fields, `filenameRegex` and `urlRegex` against the `DOWNLOADS_DIR`-prefixed absolute filename.
     - **`uniquify` ignores removed files.**
     - Chrome's 10 s rate limit is **not** modelled.
  2. **Extend `FakeOffscreen`.**
     - `holdCreation(): { release }`: while held, `createDocument` creates a document that `runtime.getContexts` lists but that has no listener, so sends reject with `RECEIVING_END_ERROR`. `release()` installs the scripted handler and resolves the `createDocument` promise.
     - `holdClose(): { release }`: while held, `closeDocument()` drops the listeners at once but keeps the document listed, and resolves at `release()`.
     - Unheld behaviour is unchanged.
  3. **E2E harness** (`e2e/harness/launch.ts`, plus `e2e/harness/flows.ts` if a helper fits there better). Add to `Downloads` and implement:
     - `remove(relativePath)` (`fs.rm`, recursive, inside the downloads dir);
     - `move(from, to)` (`fs.rename` inside the downloads dir);
     - `expireExistenceCheck()`: waits `EXISTENCE_RECHECK_RATE_LIMIT_MS + 500` = 10 500 ms. The harness constant `EXISTENCE_RECHECK_RATE_LIMIT_MS = 10_000` carries the comment from design-test-harness.md: Chrome re-checks file existence only on a `downloads.search()`, at most once per 10 s per profile; the extension's own searches reset that clock; only the moved-folder and gap cases pay this wait;
     - `eraseHistory()`: `swEval(() => chrome.downloads.erase({}))`.

     Do not use `expireExistenceCheck` in any spec yet (Task 2.2 does).
  4. **Unit tests of the fake in `test/unit/background/chrome-fake.test.ts`**, exactly the ENG-014 acceptance criteria:
     - `removeFile` then `search` → the item reads `exists: false` after `vi.advanceTimersByTimeAsync(0)` and one `exists` delta fired; a second `search` fires no second delta;
     - `existenceCheckDelay(400)` → the flag flips only after 400 ms;
     - `search({ filenameRegex })` matches on `DOWNLOADS_DIR`-prefixed absolute filenames; `limit: 0` returns all and `limit: 2` returns two;
     - `addCompleted` records are found by `search` and respected by `uniquify`;
     - after `removeFile`, a `download()` to the same path gets the clean name;
     - during `holdCreation()`, `getContexts` lists the document and `runtime.sendMessage` to it rejects with `RECEIVING_END_ERROR`; after `release()` the scripted handler answers and `createDocument` has resolved;
     - during `holdClose()`, the document is listed and deaf; after `release()` it is gone and `closeDocument` has resolved.

     Test names must contain `removeFile`, `existenceCheckDelay`, `holdCreation` and `holdClose`.
- **Files:** `test/fakes/chrome.ts`, `test/unit/background/chrome-fake.test.ts`, `e2e/harness/launch.ts`, optionally `e2e/harness/flows.ts`.
- **Done when** (ENG-014 acceptance criteria and Verify, verbatim):
  - `chrome-fake.test.ts` covers every case above. The e2e helpers exist with the documented signatures. `expireExistenceCheck` is used only where design-test-harness.md says (moved-folder and gap cases). Every existing test passes unchanged (the holds and the disk model are opt-in).
  - **Verify:**
    - `npx vitest run test/unit/background/chrome-fake.test.ts` passes, and its output lists the new test names (grep: `removeFile`, `existenceCheckDelay`, `holdCreation`, `holdClose`).
    - `npm run check` passes; `npx tsc -p tsconfig.json --noEmit` reports no error in `e2e/harness/`.
  - `git diff -- src/` is empty.

## Parallel Group 2 (depends on Group 1)

### Task: L2 and fake-based tests for the folder choice and the offscreen readiness fix (D15, D16)

- **Read first:**
  - `docs/design/design-download-engine.md` "Folder choice", its "Testing" bullets "Unit, orchestration" and "Integration";
  - `docs/design/design-offscreen-worker.md` "Testing", "Lifecycle (D16)" items 1–6;
  - `docs/design/design-test-harness.md` L2.
- **Builds on:** `src/background/folder-choice.ts` and resolver wiring (Task 1.1); the D16 `offscreen-client.ts` (Task 1.2); the fake's `removeFile`/`removeFiles`/`existenceCheckDelay`/`addCompleted` and `offscreen.holdCreation()`/`holdClose()` (Task 1.3, ENG-014).
- **Do** (tests only, no change under `src/` or `test/fakes/`; if the fake is missing something, report it rather than patching around it):
  1. **`test/unit/background/folder-choice.test.ts`.** Add cases against the real fake `chrome.downloads`, default deps, fake timers:
     - `removeFile` on the earlier records before the call → plain (the fake's re-check runs on `search`);
     - `addCompleted` gap seeds: plain deleted with `(1)` kept → plain; plain and `(2)` kept with `(1)` deleted → `(1)`;
     - in-progress and interrupted records ignored;
     - `existenceCheckDelay(400)` with the plain folder's files removed and `(1)` present → `(2)`, the stale-flag residual, pinned as the intended behaviour of the bound.
  2. **`test/integration/sw-folder-choice.test.ts`** (new, L2, using `test/integration/harness.ts`):
     - two consecutive `full` jobs of one artwork → `pixiv/みずき-135882741/{metadata.json, 135882741_p0.jpg…}`, then `pixiv/みずき-135882741 (1)/…` with clean names; the second job's ended view `folder` ends in ` (1)`;
     - `fake.downloads.removeFiles(...)` on the first run's files, then a third job → plain;
     - a `retryPages` from a `(1)` job writes into `(1)`;
     - two tabs, same artwork, the second `job/start` after the first job's first originals completed → `(1)`;
     - both starts in one tick → both plain, the second's names uniquified by the fake (the accepted same-instant race);
     - a repeat job's resolve ends within 260 ms of the API answers (system.md §11 performance row).
  3. **`test/unit/background/offscreen-client.test.ts`.** Add D16 tests 1–3 with `holdCreation`/`holdClose`:
     - **(1)** with creation held, a second `ensureOffscreen()` made while the document is already listed does not resolve before `release()`, and `createDocument` is called once;
     - **(2)** with creation held for 1500 ms (longer than `OFFSCREEN_READY_WAIT_MS`), a command sent by a second caller during creation is delivered exactly once after `release()` and resolves `ok`;
     - **(3)** `scheduleClose()`, advance `OFFSCREEN_CLOSE_GRACE_MS` with the close held for 1500 ms, then a command → delivered once after `release()`, `createDocument` called a second time, nothing sent to the old document.
  4. **`test/integration/sw-concurrent.test.ts`.** Add D16 test 6:
     - two `job/start` for different artworks in the same tick, creation held 1500 ms → both jobs end `saved`, no file `failed`, and the offscreen handler received each file's command exactly once;
     - the same for two tabs on one artwork (both `saved`, both in the plain folder, the second uniquified);
     - a job started 5 s after a busy period ended, with the close held → `saved`.
- **Files:** `test/unit/background/folder-choice.test.ts`, `test/integration/sw-folder-choice.test.ts` (new), `test/unit/background/offscreen-client.test.ts`, `test/integration/sw-concurrent.test.ts`.
- **Done when:**
  - Every test above passes, and `npx vitest run test/integration/sw-folder-choice.test.ts test/integration/sw-concurrent.test.ts test/unit/background/offscreen-client.test.ts test/unit/background/folder-choice.test.ts` lists the new names.
  - Mutation checks. Apply each, run, revert, never commit, and report the failing test names for each:
    - `src/background/offscreen-client.ts`: remove rule (b) `if (creating) return creating;` → test 2 (and the integration test 6) fails;
    - remove rule (a) `if (closing) await closing;` → test 3 fails;
    - `src/background/folder-choice.ts`: drop the `sleep` and the second search (use the first result) → the `removeFile` → plain case fails;
    - `src/background/resolver.ts`: pass `folder` instead of the chosen folder to the plan → the L2 two-runs test fails.
  - `git diff -- src/ test/fakes/` is empty after the reverts.
  - `npm run check` passes.

### Task: E2E: the repeat download goes to the sibling folder; two jobs started at once both save (CUJ-1 step 8, CUJ-4 AC 5)

- **Read first:**
  - `docs/prd/prd-000-mvp.md` CUJ-1 step 8, edges and ACs marked "(Refined 2026-10-27 …)", the CUJ-4 edge "Same artwork downloading in two tabs", and the CUJ-5 lines referring to a later click;
  - `docs/design/design-test-harness.md` "Acceptance-criteria mapping": the rows "CUJ-1 (R-005, R-006) re-download checks", "CUJ-1 step 8 and ACs 11–16 (refined 2026-10-27; D15)" and "CUJ-1 edge 'Same artwork clicked in two tabs'; CUJ-4 AC 5 (D16, offscreen readiness)", plus the L3 helpers paragraph and the Chrome 10 s re-check note;
  - `docs/design/design-download-engine.md` "Folder choice", the edge-case table.
- **Builds on:** Tasks 1.1 and 1.2 (product behaviour) and Task 1.3 (`harness.downloads.remove/move/expireExistenceCheck/eraseHistory`).
- **Do:**
  1. **`e2e/cuj1.spec.ts`: rewrite 're-download' (~L564)** as the folder-choice suite from the mapping row. Split into a few tests so each case gets a fresh browser:
     - **Second click.** The second click on `Saved · 12P` → `downloads.files()` holds `pixiv/みずき-135882741 (1)/metadata.json` and the 12 clean originals, sizes equal to `Content-Length`. The plain folder's 13 files are unchanged (same sizes and `mtime`s). The button's `title` is `Saved to Downloads/pixiv/みずき-135882741 (1)` and its `aria-label` is `Saved 12 pages to Downloads/pixiv/みずき-135882741 (1). Click to download again.`. The face is `Saved · 12P` at 164 px.
     - **Third click** → `… (2)/`.
     - **Moved folder.** `downloads.move('pixiv/みずき-135882741', 'moved-away')`, `expireExistenceCheck()`, click → the plain folder again, and no `(3)`.
     - **Gap.** Keep plain and `(2)`, remove `(1)`, `expireExistenceCheck()`, click → `(1)`.
     - **No parent suffix.** `downloads.files()` never lists a `pixiv (n)/` folder.
     - **History erased.** `eraseHistory()` with the files on disk, then click → the plain folder with `135882741_p0 (1).jpg` … and `metadata (1).json`.
     - **Token-free pattern `pixiv`** (set via `writeSettings`). Two different artworks share `pixiv/` with `metadata.json` and `metadata (1).json`; a repeat of the first → `pixiv (1)/`.
     - **Log lines.** The SW log shows one `folder choice` debug line per full job and no `folder check failed`.

     Call `expireExistenceCheck()` only in the moved-folder and gap cases. Update the header AC-mapping comment (row 11, ~L20) and add rows for the new ACs.
  2. **`e2e/cuj1.spec.ts` 'sanitized folder' (~L840).** The four saves of PUNCT under `pixiv/{artist}/{title}` now land in `pixiv/unknown/Punctuation_テスト_2nd`, then ` (1)`, ` (2)` and ` (3)`.
     - Assert the folders returned by `saveInto` accordingly.
     - Assert that each holds clean names.
     - Keep the "nothing lands a level up" assertion, and add "no `pixiv/unknown (n)/`".
  3. **`e2e/cuj2.spec.ts` (~L1029).** The second, ZIP-only run now lands in `` `${folder} (1)/` `` as `${id}_ugoira.zip`, `frames.json` and `metadata.json`.
  4. **`e2e/cuj5.spec.ts`.**
     - ~L552 (reload after `Retry · 1 failed`, then click): the new full job finds the landed pages, so it saves all 12 plus `metadata.json` cleanly into `` `${FOLDER} (1)/` ``, and the plain folder is unchanged.
     - ~L887 (403 mid-job, login, click): same rule, the whole job in `(1)` with clean names, the plain folder unchanged.
     - ~L582 (server failure, Retry re-runs the whole job): only `metadata.json` had landed and it is never consulted, so the expectation `metadata (1).json` in the plain folder should still hold. Confirm it, and add a one-line comment citing PRD §4.3.
  5. **`e2e/cuj4.spec.ts` 'same artwork in two tabs' (~L242).** It still holds every page before tab B starts, so no original of A has landed and both jobs use the plain folder with uniquified names (PRD CUJ-4 edge, "otherwise both share the folder").
     - Keep the test, rename it to say why, and add the PRD citation.
     - Add a variant in which tab B clicks after A's first originals have completed → B lands in `pixiv/みずき-135882741 (1)/` with clean names.
     - Update the header comment row (~L23).
  6. **`e2e/cuj4.spec.ts`: new D16 tests** in a new `describe` at the end of the file. Two tabs, both clicks inside one `Promise.all` (click gap 0):
     - (i) the same artwork;
     - (ii) two artworks, 135882741 and 136120877;
     - run each ×3 (`for` loop or `test.describe.configure({ retries: 0 })` with repeat).

     Expected: both buttons end `Saved`; both folders hold `metadata.json`; no SW warning `offscreen did not take`. For the same artwork, assert on the union of files: both jobs' 13 files exist either in `(1)` or uniquified next to the first (either outcome is accepted, PRD edge).
  7. **`e2e/README.md`.** Replace the row "Clicking Saved downloads again as `(1)` duplicates" (~L196) with the new CUJ-1 step 8 / AC rows, and update the CUJ-4 same-artwork row. Add the D16 click-gap-0 row.
  8. **`e2e/live/smoke.spec.ts`.** In the logged-out download case, click `Saved` once more and assert the files land in `<folder> (1)/` with clean names and that the tooltip names `(1)` (system.md §15 risk row: "the L4 live smoke's repeat-download case").
- **Files:** `e2e/cuj1.spec.ts`, `e2e/cuj2.spec.ts`, `e2e/cuj4.spec.ts`, `e2e/cuj5.spec.ts`, `e2e/README.md`, `e2e/live/smoke.spec.ts`. Use the Task 1.3 helpers in `e2e/harness/`; add a small flow helper to `e2e/harness/flows.ts` only if needed.
- **Done when:**
  - `HFP_HEADLESS=1 npm run test:e2e` passes, with 0 failed and only the headed-only toolbar tests skipped. Report the passed/skipped counts.
  - Run once more `-g "re-download|sibling|two tabs|same artwork|sanitized"` and report the timings. Only the moved-folder and gap tests take about 10.5 s extra.
  - The D16 tests also pass ×5 in a row with `--repeat-each=5` on the e2e build.
  - Discrimination check. Build `dist-e2e` from a tree with Task 1.2's rule (b) reverted (scratch only, never committed), run the D16 two-artworks test ×5, report how many fail, then rebuild from HEAD.
  - If network is available, `HFP_LIVE=1 npm run test:e2e -- --grep @live` passes; otherwise say so in the report.
  - `npm run check` passes.
  - `git diff -- src/` is empty.

### Task: Pin the settle wait's search fallback and its cross-job ids in unit tests (ENG-013)

- **Read first:** `docs/eng-backlog.md` ENG-013, the whole entry (it specifies the three tests line by line), and `docs/design/design-download-engine.md` "The last hand-off (R-006)", step 3.
- **Do:**
  - In `test/unit/background/engine-download-ui.test.ts`, inside the describe `'engine: the last hand-off restores the UI first (R-006)'`, add the three tests exactly as ENG-013 "Scope" lists them, reusing `seedJob`, `unnamedInChrome`, `hydrated`, `land`, `flush`, `stubUi` and `downloadsOf`:
    1. `'handOff: an earlier file Chrome already finished lets the restore go ahead at once (downloads.search)'`;
    2. `'handOff: an earlier download Chrome no longer knows lets the restore go ahead at once'`;
    3. `'handOff: another job’s file still in progress holds the last hand-off’s restore back until it finishes'`.
  - The fake gained a disk model and `exists` re-checks in Task 1.3. These tests must not depend on it: they use `complete()` and unknown ids, as specified.
  - No change under `src/`, `e2e/` or `docs/`.
- **Files:** `test/unit/background/engine-download-ui.test.ts`.
- **Done when** (ENG-013 acceptance criteria and Verify):
  - The three tests pass on the unchanged source.
  - Mutation checks. Apply, run, revert, never commit:
    - `src/background/engine.ts`: replace `if (!item || item.state !== 'in_progress') pending.delete(id);` with `void item; void id;` → tests 1 and 2 fail;
    - in `otherSavingIds()`, insert `.filter((job) => job.jobId === self.jobId)` between `.list()` and `.flatMap(` → test 3 fails.
  - `git diff -- src/` is empty after the revert.
  - **Verify:**
    - `npx vitest run test/unit/background/engine-download-ui.test.ts` passes, and its output lists the three new test names.
    - `npm run check` passes.
    - The coder reports, for each mutation above, the names of the tests that failed.

## Conflict Risks

- **`src/shared/constants.ts`: Tasks 1.1 and 1.2** (same group). Each adds constants in the "Timings" block. Task 1.2 puts its two directly after `OFFSCREEN_CLOSE_GRACE_MS`; Task 1.1 puts its one at the end of the block, after `HANDOFF_SETTLE_WAIT_MS`. The hunks are separated by unchanged lines and should merge cleanly. If they conflict, keep both.
- **`test/unit/background/offscreen-client.test.ts`: Task 1.2 (Group 1), then Task 2.1 (Group 2).** Sequential. Task 2.1 adds the hold-based tests next to Task 1.2's rewrite.
- **`test/unit/background/folder-choice.test.ts`: Task 1.1 (creates it, stubbed deps), then Task 2.1 (adds fake-based cases).** Sequential.
- **`test/fakes/chrome.ts` and `e2e/harness/`: only Task 1.3 edits them.** Every other task must leave them alone, and Group 2 tasks report a missing fake capability instead of patching it.
- **`e2e/*`: only Task 2.2 edits the specs and README in this plan.** QA's walk scripts (`docs/qa-artifacts/…`, `race12`, `twoTabsProbe.ts`) are QA's to update in Phase 4.
- **`e2e/cuj4.spec.ts`: Task 2.2 changes both the existing same-artwork test and the new D16 describe.** It is one task, so there is no cross-task conflict.
- **`test/unit/background/engine-download-ui.test.ts`: only Task 2.3.** Task 1.1 adapts other repeat-run tests but must not touch this file. If the full vitest run shows it is affected, report it instead.
- **Between the groups, `e2e` is knowingly red** for the repeat-run expectations listed in Current State. vitest (`npm run check`) stays green at every merge.
