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
