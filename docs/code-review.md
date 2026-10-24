# Code Review — dev-cycle iteration 4 (Phase 3.6)

> Reviewed: 2026-10-23 23:02:22 (UTC-7)
> Scope: `git diff a8dd551..0ce05cd`. It holds two pieces of work:
> - the between-cycles quick-fix `c2c9de0` (D12 rev. 3), which had no Phase 3.6 review yet. It makes `othersSettled()` wait for earlier in-progress files to *finish*, sets `HANDOFF_SETTLE_WAIT_MS = 2000`, adds the fake's `settledWhileShown`, adds the W1 held-hide test, adapts the sw-pages progress test, updates design D12 rev. 3 and syncs two PRD lines;
> - this iteration's ENG-012 task: `a9d9212` (counter pins in cuj1, cuj5 and sw-pages, `counts()` moved to `e2e/harness/hfp-button.ts`, AC-mapping wording) and `0ce05cd` (the constant's comment). The plan commit `a2e8897` was read for context.
>
> Baseline: design-download-engine.md "Progress counter (pages jobs)" and "The last hand-off (R-006)" rev. 3, system.md D12 rev. 3 and the §13 constraints row, design-test-harness.md "R-005/R-006 assertions (L2)", and PRD-000 CUJ-1 AC and CUJ-5 step 5 as amended by R-006 rev. 3.
> Guidelines: no `docs/*-guidelines.md` exist. The code was reviewed against `docs/design/*` and standard engineering practice.
> Constraint: QA gates this exact HEAD in parallel. This review changed no file under `src/`, `test/` or `e2e/`, and never rebuilt the shared `dist/` or `dist-e2e/`. Every gate and mutation ran in an isolated `git archive 0ce05cd` copy in the session scratchpad, which has its own `dist/` and `dist-e2e/`. The e2e fake server listens on an ephemeral port and each run uses a temporary profile, so nothing was shared with QA's run. Code findings are recorded here and in `docs/eng-backlog.md`, not fixed.

## Code Review Summary
- **Files reviewed:** 19 in the diff (2 `src/`, 4 `test/`, 4 `e2e/`, 9 `docs/`).
  - Read in full: the whole `handOff`/`othersSettled`/`otherSavingIds`/`finalize` region of `engine.ts`, plus `onDownloadChanged`; `constants.ts`; the `FakeDownloads` hunks; every changed unit, integration and e2e test; `e2e/harness/hfp-button.ts`; the design and PRD hunks.
  - Also read for context: `scheduler.ts` `settle()`, `downloads.ts` `onDownloadInterrupted`, `pusher.ts`, the integration harness (`DownloadDriver`, `ScriptedOffscreen`, `until`), and the e2e launcher (repo-root resolution, port).
- **Issues found:** 0 critical, 1 warning, 6 info.
- **Auto-fixed:** none, because of the parallel-QA constraint. The warning is filed as **ENG-013** (P2).
- **Gates on `0ce05cd`** (isolated copy):
  - `tsc --noEmit`: 0 errors. `eslint .`: 0 problems. `prettier --check .`: clean.
  - vitest: **3066/3066** tests in 67 files.
  - `npm run build:prod && ! grep -qE 'testHook|__hfpTest|await:(registry|resolver|handoff)' dist/*.js`: **passes**. Prod `sw.js` keeps both `in_progress` checks and `setTimeout(release2, 2e3)`.
  - `npm run size`: **35.3 KB minified / 13.1 KB gzip** (budget 40 / 15). This is unchanged, because the diff touches only SW code and tests.
  - ENG-012's e2e Verify: **4 passed** (below).

## Checklist results

| Area | Result |
|---|---|
| Type safety | No `any`, `@ts-*`, `eslint-disable` or weak `as` cast in the changed engine lines. `[id, …[0]] as const` builds a readonly tuple. `(id): id is number => id !== null` is a real guard. `search(...)[0]` is typed possibly `undefined` (`noUncheckedIndexedAccess`), and `!item` handles it. `let release!` is the same definite-assignment pattern as `markIssued`, assigned synchronously by the Promise executor (iteration 3 retry 1, Info 5). Test-side, the only new `!`s are the `done[i - 1]!` lookups in `sw-pages.test.ts`, guarded by `i === 0 \|\|`. `counts()` now takes `LabelSample[]` rather than `{ text: string }[]`, which is stricter. |
| Layering (D11) | `eslint .` passes. No import changed in `src/`. `e2e/harness/hfp-button.ts` gains an export, and both specs import it from there. |
| MV3 listeners | `sw.ts` is not in the diff. Every listener is still registered synchronously at top level. `onDownloadChanged` still feeds `deltaWatchers` before its `complete`/`interrupted` filter. |
| Prod bundle | The grep check passes (above). No test seam leaked: `settledWhileShown` lives only in `test/fakes/chrome.ts`. |
| Delta watch | `if (delta.state && delta.state.current !== 'in_progress') pending.delete(delta.id)`, as in the design's step 3. A `filename` delta alone no longer releases the wait. `interrupted` releases it, which is right: an interrupted file is terminal (`onDownloadInterrupted` → `failed`, not retried), so it can open no bubble later. A user cancel of another job's file arrives as `interrupted` and also releases the wait. |
| Search fallback | `if (!item \|\| item.state !== 'in_progress') pending.delete(id)`, as in the design. The watcher is added in the same synchronous turn that computes `ids` and before the first `await`, so a delta either reaches the watcher or happened before it, and then the search sees the terminal state. **Correct, but unpinned (Warning 1).** |
| Cap | `HANDOFF_SETTLE_WAIT_MS = 2000` in `src/shared/constants.ts`. The timer starts before the search and is cleared in `finally`. The cap bounds the delta wait, but not a `downloads.search` that never answers (Info 1). |
| Watcher cleanup | `deltaWatchers.delete(watch)` runs in `finally` on every path: release, cap, and search rejection. A leaked watcher would have no observable effect (Info 3). |
| `decided` settle | Unchanged from rev. 2 and still correct. `earlierIds = await Promise.all(earlier.values())` only awaits hand-offs decided earlier. Each of those settles with an id once `download()` resolves, or `null` on a throw or give-up (outer `finally`). The longer wait cannot form a cycle: `othersSettled` waits on Chrome download states, never on a `decided` promise. A hand-off decided *during* the wait awaits this one's promise, and this one's re-check then takes the hide path. The worst case is two caps in series (≤ 4 s), and only with a file held by the user. |
| Re-check | `last = isLastHandOff(registry.list(), self, earlier)` uses the same snapshot, with no `await` between it and `restore()`'s synchronous `requested = true`. Pinned by "a job created while the last hand-off waits makes the re-check hide instead" (killed by mutation M5). |
| Id set | `ids` = the non-null `earlierIds` plus `otherSavingIds(self)`. That covers every other file of every running job that Chrome has, including `metadata.json` and other jobs' files. The `Set` removes duplicates when an earlier id is also stored on its record. **The cross-job part is unpinned (Warning 1).** |
| Counter (pages) | Matches "Progress counter (pages jobs)". `settle()` emits no running push when pump finalizes (`scheduler.ts:118-122`). In a job of its own, the wait makes the last hand-off also the last completion, so the running views top out at `N−1 / N` and the next view is the ended one. The settle push is unthrottled (`{ type: 'push' }`), so `N−1 / N` is always pushed before the last hand-off starts. |
| Configuration | The 2 s cap is a centralized constant, recorded in system.md §13 (Constraints) with its basis: a design parameter inside pm's ≤ 2 s bound, ≈ 300× the measured 0–7 ms write tail, and needed to bound a file held by a prompt. D12 rev. 3 and design-download-engine.md step 3, "Performance" and the boot note all cite it. The old name has no remaining reference (`grep HANDOFF_TARGET_WAIT_MS\|targetsKnown` over `src test e2e docs/design` is empty). |
| Design ↔ code | **No drift.** The design's `othersSettled` code block matches `engine.ts` line for line, and so do the handOff flow and its comments. design-artwork-button.md keeps `busy(n / n)` as a width candidate. That is right, because `N / N` can still show past the cap. |
| PRD ↔ design | The two synced PRD lines (CUJ-1 AC, CUJ-5 step 5) match design-download-engine.md "Progress counter". The design names two residuals where `N / N` can show. The PRD line is absolute; that is a pm item, not code (next-cycle item 2). |
| Commit hygiene | Each commit's type matches its paths. `c2c9de0` `fix:` carries the quick-fix's design and PRD sync, as `/quick-fix` does. `a9d9212` `test(e2e)` also carries `test/integration/sw-pages.test.ts`: the type fits, the scope is narrower than the paths (Info 5). `0ce05cd` `chore(constants)` carries `src/shared/constants.ts` only. |

## Test strength: mutation run

Each mutation was applied to `src/background/engine.ts` in the isolated copy, the full vitest suite (3066 tests) was run, and the file was restored. A `diff` against `git show 0ce05cd:…` confirmed each restore.

| # | Mutation | Result |
|---|---|---|
| M1 | Rev. 2 condition: a `filename` delta, or a named search result, releases the wait | **Killed**: 5 fail. They include "12 pages: ui:false, metadata.json and 11 pages, ui:true, then …_p11.jpg", **only through `settledWhileShown`** (`[p9, p10, p11]` instead of `[p11]`); the `names()` call log is identical to the passing run. Also killed by both sw-pages counter cases, the deferred-naming integration case and the "filename delta alone" unit test. |
| M2 | No settle wait at all (`void othersSettled(…)`) | **Killed**: 9 fail. |
| M3 | Timer not cleared | **Killed**: 1 ("once the earlier file finished, the wait leaves no timer behind"). |
| M4 | Watcher not removed | Survives (Info 3). |
| M5 | No re-check after the waits | **Killed**: 1 ("a job created while the last hand-off waits …"). |
| M6 / M6b / M6c | Search ignores finished items / keeps unknown ids pending / is ignored entirely | **All survive (Warning 1).** At `a8dd551`, ignoring the search killed "pushes k / 12 progress as pages land". The rev.-3 version of that test no longer reaches the search. Instrumenting the cap timer shows it fires only in the 2 explicit cap tests, both at HEAD and under M6c. So no test reaches the search path; this is a coverage gap, not a test that silently stalls. |
| M7 | Delta watch ignored | **Killed**: 8 fail. |
| M8 | Any delta releases the wait | **Killed**: 2 fail. |
| M9 | `otherSavingIds()` limited to the hand-off's own job | **Survives (Warning 1).** Pre-existing: it survives at `a8dd551` too. |
| M10 | `otherSavingIds()` dropped | **Killed**: 7 fail. |
| M11 | `earlierIds` dropped from `ids` | **Killed**: 3 fail. |
| W1 | Claim (`decided.set`) moved after the UI call | **Killed**: 2 fail, including the new held-hide test "the last two landing while the first hand-off still waits for its hide make one restore, from the second". **Iteration 3 retry 1 W1 is closed.** |
| ENG-012 | `settle()` always pushes a running view before finalize | **Killed**: both sw-pages counter cases, the cuj1 "counter and badge" e2e test and the cuj5 "partial" e2e test fail. The other two tests the grep matches ("partial one", "download UI: partial") check no counter and pass, as expected. |

Answers to the two test-strength questions:
- **Does `settledWhileShown` pin the bubble race?** Yes, and nothing else in the 12-page test does. Under the rev.-2 condition (M1), the fake names synchronously, so the call log keeps `ui:false … ui:true, p11`. Only `settledWhileShown` shows `p9` and `p10` finishing after the enable. The `DownloadDriver` completes a download one 1 ms step after it appears, and the auto offscreen lands the last five in-flight pages together. So the last hand-off reliably finds earlier pages still `in_progress`, and the race is exercised deterministically.
- **Would a regression that restores before earlier files finish fail the 12-page call-log test?** Yes for a same-job regression (M1, M2). For other jobs' files (M9) no test fails; that is Warning 1.

## Items from iteration 3 retry 1

| Item | Status |
|---|---|
| W1: decide+claim not directly pinned | **Closed** by `c2c9de0`'s held-hide test (the W1 mutation is killed above). |
| Info 1: boot-time deltas wait for `ready` | **Closed** in the design. design-download-engine.md "Restart at `await:handoff.restoreUi`" records it. The cost grew from 500 ms to 2 s (Info 2). |
| Info 3: fake `animated` flag | **Superseded** by `settledWhileShown`. design-test-harness.md explains why it also pins the single animation within one busy period. |
| Info 6: gap-1 wording for the ugoira zip | **Closed** in system.md §15 gap 1 and design-test-harness.md L5. |
| Info 7: design claims watcher removal is tested | **Closed**: the design's test list no longer claims it. The mutation still survives (Info 3). |
| Info 2, 4, 5 | Unchanged, accepted. |

## Critical Issues (must fix before QA)

None.

## Warnings (should fix)

1. **[test/unit/background/engine-download-ui.test.ts] Two parts of `othersSettled()`'s input and release are unpinned.** Filed as **ENG-013** (P2).
   - **(a) The `downloads.search` fallback (M6, M6b, M6c survive).** The search releases the wait when an earlier file finished before the watcher existed but its record still says `saving`, because the completion mutation was still in flight when the last file landed. That is exactly the "last files land together" burst. A regression there would hold the restore, and so `Saved`, to the 2 s cap. It would also make every boot-time last hand-off wait the full cap. At rev. 2 the sw-pages progress test pinned the search by accident; rev. 3's version of the test does not.
   - **(b) Other jobs' in-progress files (M9 survives, also at `a8dd551`).** If `otherSavingIds()` stopped looking across jobs, job B's file could finish after job A's last hand-off turned the UI on. That is the QA iteration-3 bubble bug again, for CUJ-4. Only QA's `two-b-first`/`two-a-first` probe would catch it.
   - **Fix.** Three unit tests are specified in ENG-013: an earlier file Chrome already finished, an id Chrome no longer knows, and another job's in-progress file. They were prototyped in the scratch copy: all pass on `0ce05cd`, M6c fails the first two, and M9 fails the third.

## Info

1. **The cap does not bound `downloads.search` itself.** `othersSettled` awaits `Promise.all(search…)` before `await settled`. A search that never answers would stall the last hand-off past 2 s. This is unchanged from rev. 2, and `downloads.search` is a browser-process query that always answers. No change. If ever needed, the fix is a one-line `Promise.race` against `settled`.
2. **The boot-time stall is now up to 2 s, not 500 ms.** Suppose a reconcile-issued last hand-off finds an earlier file still `in_progress`. Before `ready`, no delta can reach the watcher, and the search finds `in_progress`. So that wait now always runs to the full cap, where rev. 2's search released a merely named file at once. Messages queue behind `ready` for that long. The badge renders before reconcile, so CUJ-4's 1 s budget holds. It needs the SW to die within milliseconds of the busy period's last hand-off. The design records it. No change.
3. **Watcher cleanup is unpinned (M4).** A leaked watcher removes ids from an empty `Set` and calls `release()` on a promise that has already resolved. That is one closure per last hand-off, per SW instance. Not worth a test seam. No change.
4. **The cuj5 retry e2e pins the range, not the top.** It asserts that every count lies in 9 … 11, that no `12 / 12` shows, and that the log ends with `Saved · 12P`. Unlike cuj1, it does not assert that `11 / 12` directly precedes `Saved`. The sw-pages `retryPages` case pins that the last running value is 11. ENG-012's scope is met, so no change is needed. Adding `expect(log.at(-2)?.text).toBe('11 / 12')` is an option if QA ever sees a skipped step.
5. **`a9d9212`'s scope `(e2e)` is narrower than its paths** (`test/integration/sw-pages.test.ts`). The type is right. Cosmetic.
6. **`HANDOFF_SETTLE_WAIT_MS` also bounds the counter residual.** The design names two cases where `N / N` can still show: `metadata.json` held past the cap, and a CUJ-4 job B whose last page is not the busy period's last hand-off. The PRD line "`12 / 12` is never shown" is absolute. This is a pm wording item (next-cycle item 2), not a code defect.

## Fixed

None (parallel-QA constraint).

## Engineering-task verification (eng done-gate)

**ENG-012: confirmed and removed.**

| Verify / AC | Evidence |
|---|---|
| `npx vitest run test/integration/sw-pages.test.ts` passes | Re-run on the isolated `0ce05cd` copy: **32/32** pass. The full suite has 3066/3066. |
| `HFP_HEADLESS=1 npm run test:e2e -- e2e/cuj1.spec.ts e2e/cuj5.spec.ts --grep "counter and badge\|partial"` passes | Re-run on the isolated copy, with its own `dist-e2e` build, `--workers=1`: **4 passed** (cuj1 "counter and badge"; cuj5 "partial", "partial one", "download UI: partial"). |
| `! grep -rnE '12 / 12`? only after\|to name earlier' e2e src test` | Exits 0 and prints nothing, run on the main checkout. |
| Mutation check names the failing tests | Re-run with the `settle()` mutation: the two sw-pages counter cases, cuj1 "counter and badge" and cuj5 "partial" fail. This matches the coder's report of 4. Restored afterwards, `diff` clean. |
| The four tests assert the amended values | cuj1: no `12 / 12`, last count 11, `log.at(-2)` is `11 / 12`, `log.at(-1)` is `Saved · 12P`. cuj5: counts within 9 … 11, no `12 / 12`, ends with `Saved · 12P`. sw-pages full job and `retryPages`: non-decreasing, last 11, ended `saved`. |
| AC mappings and comment | cuj1 row 7 and the `e2e/README.md` CUJ-1 row state the amended AC. The constant's comment reads "…to finish before the UI restore (R-006 rev. 3)". `git diff c2c9de0..0ce05cd -- src/` is that one comment line. |

The ENG-012 block is removed from `docs/eng-backlog.md`. The commits referencing ENG-012 (`a9d9212`, `0ce05cd`) are the record.

**Filed: ENG-013** (P2, test-only), from Warning 1. The backlog is therefore **not** empty after this review: it holds ENG-013, and `Next-ID` is ENG-014.

## Design-level items for next cycle (Phase 1)

1. **ENG-013** (P2): three unit tests for the settle wait's search fallback and its cross-job ids. When it lands, tl adds the three cases to the engine test list in design-download-engine.md "Cross-Cutting Concerns → Testing", next to "with no other file in Chrome, the last hand-off makes no `downloads.search` call".
2. **Counter residual wording** (pm, `/spec-sync`; already in `docs/tasks.md` "Document-authority notes"). Two cases fall outside the PRD's absolute "`12 / 12` is never shown": a file held past the 2 s cap, and a CUJ-4 job B whose last page is not the busy period's last hand-off. pm's pre-decided exit accepts the cap residual. Not a blocker.
3. **pm spec-sync items still open** (system.md §15 gaps 1–3; pm-review iteration 3, priorities 3a–3c). They are unchanged by this diff, and none blocks QA.

**Fine as is:** the finish-based wait (delta watch, search fallback, cap, cleanup), the `decided` settle, the re-check, the counter rules, the constant and its §13 record, type safety, listener registration, the prod bundle, the size, and the ENG-012 test pins.
