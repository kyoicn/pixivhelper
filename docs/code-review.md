# Code Review — dev-cycle iteration 3 (Phase 3.6)

> Reviewed: 2026-10-23 17:32:24 (UTC-7)
> Scope: `git diff 91749c2..HEAD` (the iteration-3 plan commit to the merge `3cef87b`): tasks 1.1 (job-level outage rule, D13), 1.2 (Chrome's download UI, R-005/D12), 1.3 (CUJ-3 paste, S5, S15) and 1.4 (D14 fallback timer, 176 px ugoira floor), merged without conflicts. Also covers this review's own fix commits `fbe4066` and `7f5960c`.
> Guidelines: no `docs/*-guidelines.md` exist. The code was reviewed against `docs/design/*` and standard engineering practice.

## Code Review Summary
- **Files reviewed:** 49 in the diff (20 `src/`, 21 `test/`, 7 `e2e/`, 1 `docs/`).
  - Read in full: every changed `src/**` module (`download-ui.ts`, the `engine.ts`/`sw.ts`/`options-tab.ts`/`resolver.ts` hunks, `retry.ts`, `outcome.ts`, `messages.ts`, `types.ts`, `job.ts`, `test-hooks.ts`, `single-line.ts`, `strings.ts`, `options.css`, `pattern.ts`, `mount.ts`, `width.ts`, `constants.ts`, `manifest.json`), the chrome fake, `e2e/harness/flows.ts`, the new R-005 e2e cases in `cuj1`, the cancel-race tests in `engine-download-ui.test.ts` and `sw-cancel.test.ts`, the `download-ui.test.ts` suite, and the `e2e/README.md` diff.
  - Sampled: the other unit and integration tests, and the `cuj2`/`cuj3`/`cuj4`/`cuj5` additions.
- **Issues found:** 0 critical, 0 warnings, 3 info.
- **Auto-fixed:** 4 items in 2 commits (one code, one design docs).
- **Final gates on `main` after the fixes:**
  - `npm run check` passes: typecheck 0 errors, eslint 0, prettier clean, **2973/2973** vitest tests in 66 files, build.
  - `HFP_HEADLESS=1 npm run test:e2e`: **128 passed, 0 failed**.
  - `npm run size`: **35.3 KB minified / 13.1 KB gzip** (budget 40 / 15).

## Checklist results

| Area | Result |
|---|---|
| Type check | `tsc --noEmit`: 0 errors. The `src/` diff adds no `any`, no `as` cast, no `@ts-*` comment and no `eslint-disable`. `download-ui.ts` and `single-line.ts` carry no cast at all. The `answered` plumbing is typed end to end: `Failure.answered?: true`, `JobRecord.answered?: true`, `Resolution`'s failure variant `answered: boolean`, and the internal `Draft` type, so `resolve()` cannot return a failure without the flag. Test-side casts are the established window/`self` globals in e2e (`__hfpWidths`, `__pillPaintedAt`, `__clickAt`, `__hfpTest`). |
| `answered` plumbing (1.1) | `retry.ts` sets `answered` the moment `fetch()` resolves, so an `http` answer, a short or long body, a reset mid-body and a stall mid-body all count, and a rejected `fetch()` (DNS, refused, offline, Chromium's local throttle) does not. `withAnswered` adds the flag only to a final `network`/`timeout`. The resolver wraps `apiFetchJson` once, so every API step of every mode is counted, including a 2xx before a later failure. `applyResolution` sets `job.answered` for a plan, the login-wall stop and an answered failure, inside its existing guard. `errorCause` is §10's code line for line. The offscreen and tab-proxy paths forward the `Failure` object unchanged, so the flag survives `off/failed` and `api/fetchJson`; `isFailure` accepts exactly `true`. `! grep -rn lastStatus src test e2e` prints nothing. |
| Layering (D11) | `npm run lint` passes. `resolver.ts` imports `gotAnswer` from `src/shared/outcome.ts` (background → shared, allowed); `e2e/harness/flows.ts` imports only types from `download-ui.ts`. |
| MV3: listeners | `sw.ts` still registers every listener synchronously at top level. The diff adds one `await engine.restoreDownloadUiIfIdle()` inside `boot()`, after the first `badge.render()` (so the 1 s badge budget is untouched) and before `reconcile()`, as designed. |
| MV3: permissions | `src/manifest.json` `permissions` is exactly `["downloads","storage","offscreen","declarativeNetRequestWithHostAccess","downloads.ui"]` (the `node -e` check exits 0); hosts unchanged. `test/unit/manifest.test.ts` is renamed to "five approved permissions" and its whole-manifest literal matches. |
| Prod bundle | `npm run build:prod && ! grep -qE 'testHook\|__hfpTest\|await:(registry\|resolver\|handoff)' dist/*.js` passes, before and after Fixed 1. After Fixed 1, prod `createDownloadUi` keeps only `requested`, `chain` and `hideRefused`. |
| pixiv selectors | No new DOM query in the diff. Selectors stay in `src/content/pixiv-dom.ts`; the options page queries only its own markup. |
| `innerHTML` | None added; the ESLint ban still holds outside `icons.ts`. |
| Security | No secrets, tokens or cookies in the diff. Both `DownloadUi` methods never reject: `apply()` catches every failure (also a synchronous throw, unit-tested), so `chain` never rejects into `handOff`, `finalize` or boot. The `downloads.ui` justification is in `docs/release-checklist.md` §5, verbatim from the PRD index, and system.md §5 records why the permission adds no install warning. |
| Performance | The `setUiOptions` queue holds one promise reference (`chain`), so it never grows. Per busy period it makes one hide and one restore call, and racing hand-offs share one hide. The hand-off path adds exactly what the design specifies: `await hideForHandOff()` (an already-settled `chain` after the first hand-off, so one microtask), the test-only `await:handoff.hideUi`, and two in-memory lookups. `finalize` awaits `restore()` only when the registry is empty, after the final view is pushed. |
| Constants | `FLOAT_PLACEMENT_BUDGET_MS = 250` sits next to `FLOAT_FALLBACK_MS` in `src/shared/constants.ts`; `mount.ts` derives its module-local `FALLBACK_TIMER_MS` from the two. `UGOIRA_LOCALE_FLOOR_PX` sits next to `LOCALE_FLOOR_PX` in `width.ts`, its only user, as design-artwork-button.md "Fixed width" specifies. The fake's error strings are test-only constants. No duplicate constant was found. |
| `e2e/README.md` (g) | Prettier-clean (`npm run lint`). The section headings are identical to `91749c2`, and each of the six diff hunks lies inside the section its task owned: Harness API and CUJ-1/CUJ-4 (1.2), CUJ-2 (1.4), CUJ-3 (1.3), CUJ-5 (1.1). Every table keeps its column count. Nothing was clobbered. |

## Items the coders flagged

| # | Item | Verdict |
|---|---|---|
| a | `handOff()` re-checks that the file is still `saving` after the hide, not only `registry.get(jobId)` | **Correct, and needed.** `cancel()` fails every in-flight file in its own mutation, but the record stays listed until `finalize` has awaited the final push and deleted it. A hand-off resuming in that window would pass a registry-only check, call `downloads.download`, and then `onDownloadStarted`'s cancel path would cancel it, leaving the very "Canceled" entry the design wants to avoid (PRD CUJ-1 step 5). The check costs one array lookup. Unit test: `engine-download-ui.test.ts` "a cancel whose final push is still pending also hands nothing to Chrome"; integration: `sw-cancel.test.ts` "a cancel while Chrome applies the hide hands no file to Chrome". The design now states the rule (Fixed 2). |
| b | `job/cancel`'s response now waits for `restore()`, queued behind an in-flight hide | **No user-visible latency.** The button shows idle optimistically and synchronously on the click (`content.ts` `onActivate`), and `run()` ignores the `job/cancel` response. In `finalize`, the cancelled view is pushed before the record is deleted and before `restore()`. `sw-cancel.test.ts` pins it: the cancelled view reaches the tab while the hide is still gated. The extra wait is at most one in-flight `setUiOptions` round trip (about 1 ms) plus the restore itself. |
| c | Prod bundle kept the unused locals `ok` and `calls` | **Fixed** (Fixed 1). The recording moved into a test-only wrapper around `setUiOptions`, installed by `if (__TEST_HOOKS__) setUiOptions = withTestApi(…)`. The prod output has neither local. Behaviour and the test API are unchanged: 59 download-UI unit and integration tests and the cuj1/cuj4 e2e cases pass. |
| d | A body that stays short or long on every attempt now ends `answered: true` | **Matches system.md §9**, which names "a short or long body, a reset or a stall mid-body" as answered, and PRD CUJ-5 step 6 ("pixiv answered at least one request … any HTTP status"): the status line and headers arrived, so pixiv answered. Row 8 reads such a job as `server`. |
| e | An insertion with line breaks is not on the native undo stack | **Recorded.** design-options-page.md "Line breaks in inserted text", **Cost** paragraph, and the alternatives table's "Native undo" row. `docs/tasks.md` lists it in the QA expectations, so QA will not log it as a defect. |
| f | design-test-harness.md "Open Questions" still said the README's CUJ-5 mapping was for the "next iteration" | **Fixed** (Fixed 2): the line is removed. The README's CUJ-5 section now points to the mapping at the top of `cuj5.spec.ts`. |
| g | `e2e/README.md` was edited by all four tasks | **Clean.** See the checklist row above. |
| h | Content-bundle size | **Changed: 35.2 / 13.0 → 35.3 / 13.1 KB.** Recorded in system.md §11.6 (Fixed 2). |

## Critical Issues (must fix before QA)

None.

## Warnings (should fix)

None.

## Info

1. **`isFailure` accepts `answered: true` on any failure kind**, while the type comment says `network`/`timeout` only. It is harmless: `gotAnswer` already treats `http` and `pixivError` as answered, and no producer sets the flag on another kind. Tightening the guard would add a kind check for no behavioural gain. No change.
2. **Every SW start with no job running calls `setUiOptions({ enabled: true })`.** The worker wakes on every pixiv page load (`job/listForTab`), so this is one IPC call per wake, about 1 ms, after the badge render. This is the design (D12 call site 3), and it is what closes the "SW killed before restore" risk. No change.
3. **`finalize` now awaits `restore()` before `scheduleClose()`** when no job is left. This delays the 5 s offscreen-close grace by one IPC round trip. Negligible, and it follows design-download-engine.md "Finalize" step 5.

## Fixed

1. **[src/background/download-ui.ts] The prod module no longer carries the test API's recording state.** In the shipped bundle, the `if (__TEST_HOOKS__) calls.push(…)` branch was dropped, but its inputs remained as dead locals: `calls = []` and the `ok` flag.
   - **Fix.** Recording now lives in a module-level `withTestApi(setUiOptions, requested)`. It installs `downloadUi()` and returns `setUiOptions` wrapped to push `{ enabled, ok, at }` when each call settles. `createDownloadUi` calls it from `if (__TEST_HOOKS__)`, so prod drops both the branch and the function.
   - **Behaviour.** `apply()` is back to the design's error handling only. `at` is still `Date.now()` when Chrome answered.
   - Commit `fbe4066`.
2. **[docs/design] The design docs now record what shipped:**
   - design-download-engine.md "Chrome's download UI", call site 1, and the `off/ready` row: the hand-off returns unless the record is listed **and** the file is still `saving`, with the cancel-window rationale and the pinning test (item a). "Test API" now notes the recording wrapper (item c).
   - design-test-harness.md: the stale "next iteration" README line is removed from "Open Questions" (item f), and the "ENG backlog" note now says the release checklist carries the R-005 items.
   - system.md §11.6: the iteration-3 size, 35.3 / 13.1 KB (item h).

   Commit `7f5960c`.

## Engineering-task verification (eng done-gate)

No task this iteration came from `docs/eng-backlog.md`. The backlog is empty (`Next-ID: ENG-012`), and nothing was removed or filed. This review found no engineering work without a product surface that needs a backlog entry.

## Design-level items for next cycle (Phase 1)

1. **Still open for pm** (system.md §15 "Open spec gaps"):
   - gap 1: a Chrome decision prompt for a job file while the UI is hidden (R-005);
   - gap 2: the options footer links at 2.91:1.

   Neither blocks QA. The design follows the PRD as written for both.
2. **QA re-measurements named in `docs/tasks.md`** (not review items): `diagOutage.ts` (≥ 3 × 7 clicks for 503 and 500 read "pixiv isn't responding"; a stopped server reads "No connection"), `diagFloat.ts` (10 samples ≤ 3000 ms), one manual multi-line drag into the folder field (design-options-page.md "Open Questions", drop placement), and the R-005 visual check by OS-level screenshot of the headed harness browser.
3. **R-003 residual "miss 2"** (stale logged-in page) remains accepted per system.md §8.5. The release checklist §3 probe collects the evidence to close it.

---

# Iteration 3 retry 1 addendum — R-006 (Phase 3.6)

> Reviewed: 2026-10-23 19:49:53 (UTC-7)
> Scope: `git diff 02b4ecf..68c35d7`. Commits: `ed7a579` (fake `deferNaming`/`name`), `6c184ac` (engine: restore before the last hand-off), `0a2da83` (e2e expectations), `68c35d7` (release checklist).
> Baseline: design-download-engine.md "The last hand-off (R-006)", system.md D12 rev. 2, design-test-harness.md "R-005/R-006 assertions (L2)", and PRD-000 §4.1 #3 as amended by R-006.
> Constraint: QA re-verifies this exact HEAD in parallel, so this review changed no file under `src/`, `test/` or `e2e/`. Every gate ran in an isolated `git archive 68c35d7` copy, so the shared `dist/` and `dist-e2e/` were never rebuilt. Every finding, simple ones included, is recorded here instead of fixed.

## Code Review Summary
- **Files reviewed:** 18 in the diff (5 `src/`, 7 `test/`, 5 `e2e/`, 1 `docs/`).
  - Read in full: `engine.ts` (whole file), `scheduler.ts` and `download-ui.ts` hunks, `constants.ts`, the fake's `FakeDownloads`, `engine-download-ui.test.ts`, `sw-download-ui.test.ts`, the `sw-restart.test.ts` hunks, the e2e expectation hunks and the release checklist.
  - Also read for context: `sw.ts`, `registry.ts`, `downloads.ts`, `applyResolution`.
  - Sampled: `scheduler-last-handoff.test.ts`, `chrome-fake.test.ts`, and the `e2e/README.md` table re-flow.
- **Issues found:** 0 critical, 1 warning, 7 info.
- **Auto-fixed:** none, because of the parallel QA constraint.
- **Gates on `68c35d7`:**
  - `tsc --noEmit`: 0 errors. `eslint` and `prettier --check`: clean.
  - vitest: **3065/3065** tests in 67 files.
  - `npm run build:prod && ! grep -qE 'testHook|__hfpTest|await:(registry|resolver|handoff)' dist/*.js`: **passes**. The prod `handOff` keeps the decision, the waits and the re-check. It has no hook yields.
  - `npm run size`: **35.3 KB minified / 13.1 KB gzip** (budget 40 / 15). This is unchanged, because R-006 touches only SW code. The prod `sw.js` grows from 124,062 to 126,782 bytes (+2.7 KB, unminified).
  - e2e was not re-run here, because QA owns the e2e run on this HEAD.

## Checklist results

| Area | Result |
|---|---|
| `isLastHandOff` across jobs | **Matches the design table line for line.** `awaitsHandOff` returns false for `save === false`. It returns true for `queued`/`fetching`/`ready`. For `saving` it returns true only with no `downloadId` and not `decided`. Terminal states return false. The switch is exhaustive (no default; `strict` with `noFallthroughCasesInSwitch`). "Still resolving" is `phase === 'resolving' && stopReason === null && apiFailure === null`, the same test `reconcile()` uses. A finalizing job (all files terminal) never blocks. This matches PRD §4.1 #3: "no file queued, being fetched, waiting to retry [inside the offscreen fetch, so `fetching`], or being encoded [`fetching` video], and no job still resolving". |
| Decide + claim | **Synchronous.** `new Map(decided)`, `isLastHandOff(...)` and `decided.set(key, …)` run with no `await` between them (engine.ts:273–276). Mutators are synchronous, so the rule never sees a half-applied mutation. `onOffReady` returns `[download]` alone, so `handOff` starts inside the registry's `run()` call. |
| `decided` always settles | **Yes.** `markIssued(id)` runs right after `download()` resolves, before the `onDownloadStarted` mutation. `markIssued(null)` runs on a throw, and again in the outer `finally`, which covers the live-check give-up and any hook rejection. `decided.delete(key)` runs only in that `finally`, after the id is stored, the file failed, or the hand-off gave up. So the invariant holds: a `saving` file without an id is either in `decided` or still to be handed off. Waits follow decision order, so they cannot form a cycle. No awaited dependency needs the registry lock. |
| `targetsKnown` | The watcher is added before the search, so no delta can fall between the two. Duplicate ids (an earlier id that is also in `otherSavingIds`) are deduplicated by the `Set`. `otherSavingIds` is evaluated after `Promise.all(earlier)`, so it sees the ids stored meanwhile. A search rejection logs `warn` and goes on. The timer starts before the search, so the 500 ms cap includes the search. `finally` removes the watcher and clears the timer. `HANDOFF_TARGET_WAIT_MS = 500` lives in `src/shared/constants.ts`. |
| Re-check after the waits | Uses the same `earlier` snapshot. Nothing awaits between the re-check and the synchronous `requested = true` inside `restore()`. A job created during the waits is listed as `resolving`, and a hand-off decided during the waits is absent from `earlier`. Either one sends the file down the hide path. |
| Restore / hide / hook | The last hand-off awaits `restore()` and then `await:handoff.restoreUi`, and never calls `hideForHandOff()`. Every other hand-off is unchanged. The live check (record listed **and** file `saving`) follows both paths. |
| Finalize safety net | Unchanged code. After a final hand-off, `restore()` finds `requested === true` and makes no Chrome call. Pinned by "finalize: after a final hand-off, Chrome gets no second restore". |
| Races | Covered: a job starting during the waits (re-check), a cancel while the restore is in flight (live check), and two files landing together (claim + step 2 + step 3). See the mutation table below for how strongly each is pinned. |
| Type safety | No `any`, `@ts-*`, `eslint-disable` or `as`-cast in `src/`. `as const` builds a readonly tuple. `(id): id is number => id !== null` is a real guard. `noUncheckedIndexedAccess` types `search(...)[0]` as possibly `undefined`, and the code checks it. The two definite-assignment `!`s (`release`, `markIssued`) are assigned synchronously by Promise executors. `Promise.withResolvers` would remove them but needs Chrome 119, above `minimum_chrome_version` 116. Test-side, the only cast is the established `settle(...) as JobStartResponse`. |
| MV3 listeners | `sw.ts` is not in the diff. Every listener is still registered synchronously at top level. |
| Prod bundle | The grep check passes (above). |
| Design drift (item 7) | **None.** `decided`, `deltaWatchers`, `targetsKnown`, `otherSavingIds`, the first line of `onDownloadChanged` (watchers before the `complete`/`interrupted` filter) and the constant all match the code block in design-download-engine.md nearly verbatim. design-test-harness.md records the fake's `deferNaming`/`name`, including "complete/interrupt name an unnamed item first". The harness's `finish(match)` is a trivial test helper that needs no design entry. |

## Test strength (item 6): mutation run

Each mutation was applied to the isolated copy, and `test/unit/background` plus `test/integration` (660 tests) were re-run.

| Mutation | Result |
|---|---|
| The last hand-off hides, then restores **after** its `download()` | **Killed**: 112 fail, including "12 pages: ui:false, metadata.json and 11 pages, ui:true, then …_p11.jpg", whose `names()` sequence is exact. |
| Restore at finalize only (iteration-3 / R-005 behaviour) | **Killed**: 114 fail. |
| Drop step 2 (no wait for earlier `download()` calls) | **Killed**: 4 fail (both deferred-naming integration cases, "last two together … named the first", and the give-up case). |
| Drop the step-4 re-check | **Killed**: 1 fail ("a job created while the last hand-off waits"). |
| Drop the 500 ms cap | **Killed**: 2 fail (unit + integration "without a name … after 500 ms"). |
| No delta watchers in `onDownloadChanged` | **Killed**: 7 fail. |
| No `markIssued(null)` in `finally` (a give-up never settles) | **Killed**: 1 fail. |
| Live check by record only (drops the `saving` check) | **Killed**: 1 fail. |
| Rule ignores resolving jobs | **Killed**: 5 fail. |
| `saving` without an id never counts | **Killed**: 20 fail (restart matrix). |
| `decided.delete` dropped | **Killed**: 1 fail. |
| Timer not cleared | **Killed**: 1 fail ("leaves no timer behind"). |
| **Claim moved after the UI call** (`decided.set` after `await hideForHandOff()/restore()`) | **Killed by 1 test only, incidentally**: the cross-job give-up case. Neither "last two together" test fails (W1). |
| Claim delayed by one microtask | Survives. **Benign**: in prod, two hand-off decisions are always separated by at least one `storage.session` write (each comes from its own serialized mutation). |
| Watcher not removed from `deltaWatchers` | Survives (I7). |

Answer to item 6:
- **The integration assertions pin `ui:false, 12 downloads, ui:true, last download` exactly.** `names(afterBoot)` compares the whole call log: the fake logs `ui` once Chrome applied it and `download` at call time.
- **A regression where the restore follows the last download fails 112 tests.**
- The e2e checks compare whole-millisecond timestamps with `≤`, so a same-millisecond inversion can slip through there (I4). The L2 call log is the exact pin.

## Critical Issues (must fix before QA)

None.

## Warnings (should fix next cycle)

1. **[test/unit/background/engine-download-ui.test.ts] The synchronous decide+claim is not directly pinned.**
   - The design's core race is "two files land together as the busy period's last two".
   - Both tests for it ("the last two files landing together make one restore …" and "… hand the second to Chrome after the restore") run with a hide that resolves at once. So the first hand-off has already passed its UI call, and claimed, by the time the second decides.
   - A regression that claims after the UI call keeps both passing. Only the cross-job give-up test catches it, and only incidentally.
   - Proposed test. It passes on `68c35d7` and fails with the claim moved after the UI call; both were verified in the scratch copy:
     ```ts
     it('handOff: the last two landing while the first hand-off still waits for its hide make one restore, from the second', async () => {
       const stub = stubUi();
       stub.holdHide();
       seedJob('job-1', [fetching(0), fetching(1)]);
       const engine = await hydrated(stub.ui);
       land(engine, 0);
       await flush();
       land(engine, 1);
       await flush();
       stub.releaseHide();
       await flush();
       expect([stub.events, fake.downloads.callLog]).toEqual([
         ['hide', 'restore'],
         [{ op: 'download', filename: p(0) }, { op: 'download', filename: p(1) }],
       ]);
     });
     ```

## Info

1. **Boot-time deltas wait for `ready`.**
   - At boot, reconcile awaits its `download` effects (`mutate` awaits `effectsDone`). Meanwhile `sw.ts` delivers `downloads.onChanged` only after `ready` (sw.ts:50–53), and `ready` waits for reconcile.
   - So a reconcile-issued last hand-off that finds an earlier item still unnamed can be released only by its search or by the 500 ms cap. The deltas cannot arrive in time.
   - The impact is bounded (boot and the first messages wait at most 500 ms more) and practically never happens: the item would need to be created within milliseconds of the SW's death, and Chrome names an item in a few milliseconds.
   - The cap is what makes this safe. The design's "Restart at `await:handoff.restoreUi`" does not mention it. Next cycle: record it in one sentence, or feed the watchers from the `sw.ts` listener before `ready`. That needs one new `Engine` method and is not needed today.
2. **A cancel during the last file's `download()` call.**
   - The window is after the live check, about 1 ms of IPC. The started-after-cancel path cancels the download.
   - With R-006 that item was created with the UI on, so it animates and appears as "Canceled" in the bubble. Under R-005 the same window existed for every file but was invisible.
   - The window is too narrow to matter. No change.
3. **The fake versus Chrome's naming order (item 5).**
   - **The fake matches Chrome on the order that matters:** `download()` resolves with the id before the item is named, and the `filename` delta follows (`{ previous: '', current }`). In Chrome the id comes at item creation and target determination comes later.
   - **Divergences:**
     - The fake reserves `uniquify` targets in creation order. Chrome reserves them in determination order, so which file gets ` (1)` can differ while naming is deferred. No test depends on it.
     - The fake's `interrupt()` always names first. Chrome can interrupt an item that was never named. The engine accepts any non-`in_progress` state, and the unit test "the earlier file leaving in_progress unnamed …" drives that path with a direct delta.
     - Chrome may bundle `filename` with other fields (`danger`, `totalBytes`) in one delta. The watcher handles that.
   - **Gap:** the fake does not model the animate-or-not decision itself. Suggested improvement (P2): record `animated = uiEnabled` when an item is named, and add an L2 assertion that exactly one item animated, the busy period's last. That pins CUJ-1 AC 14 ("at most one animation, at the end") directly, instead of through call order.
4. **The e2e restore checks compare whole-millisecond timestamps.**
   - `max(others.startTime) ≤ restoreAt ≤ last.startTime` cannot tell a same-millisecond inversion apart.
   - This is acceptable: the L2 call log pins the order exactly (mutation table). The hold on p11 in `cuj1` also makes "no restore before p11 lands" structural.
5. **Two definite-assignment `!`s in `engine.ts` (213, 275).** They are justified (see Type safety). No change until the minimum Chrome version reaches 119.
6. **Gap 1 wording (system.md §15, design-download-engine.md "Error handling").**
   - The design says a prompt-held file "does not hold back the last hand-off". That is true, but in the one realistic case, a deep-scan prompt on the ugoira zip, `frames.json` and the video depend on the zip being `done`. So no final hand-off can happen until the user acts in `chrome://downloads`.
   - The release-checklist line is accurate ("the job waits and the button stays hidden"). The design sentence should state this explicitly, because pm decides gap 1 from it.
7. **The design's test list says "the watcher is gone afterwards", but no test checks it** (that mutation survives). A leaked watcher has no observable effect beyond one closure per wait, per SW instance. Next cycle: drop the clause from the test list, or expose a watcher count through the test API. A test hook only for this would be over-engineering.

## Fixed

None (parallel-QA constraint). Every simple item is listed above for the next cycle.

## Engineering-task verification (eng done-gate)

No retry task came from `docs/eng-backlog.md`. It is still empty (`Next-ID: ENG-012`). Nothing was removed or filed: this review may write only this file.

## Next cycle

**Should fix** (test and doc work, no behaviour change; one ENG entry, P2, could carry all of it):
- W1: add the held-hide "last two together" unit test above.
- Info 3: add the fake's `animated` flag and the matching L2 assertion.
- Info 7: reconcile the design's test list with what is tested.

**Design-doc edits** (tl, next Phase 1):
- design-download-engine.md, "Restart at `await:handoff.restoreUi`": add the boot-time note (Info 1).
- design-download-engine.md "Error handling" and system.md §15 gap 1: make explicit that a prompt on the ugoira zip blocks every later file, so it hides the UI until the user acts (Info 6).

**Fine as is:** the rule, the claim, the waits, the cap, the re-check, the live check, the finalize and boot safety nets, type safety, listener registration, the prod bundle, and the size.
