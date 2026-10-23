# Code Review — dev-cycle iteration 2 (Phase 3.6)

> Reviewed: 2026-10-23 03:45:02 (UTC-7)
> Scope: `git diff b224695..fb42417`: 12 tasks in 3 groups, plus the orchestrator merge fix `3c1a342`. Also covers this review's own fix commits `fc542c9`, `6acde12`, `6ffc0a3` and `bd30155`.
> Guidelines: no `docs/*-guidelines.md` exist. The code was reviewed against `docs/design/*` and standard engineering practice.

## Code Review Summary
- **Files reviewed:** 84 in the diff.
  - Read in full: every changed `src/**` module, `scripts/{size,zip,build}.mjs`, `eslint.config.js`, the CI workflow, the fake-server changes (`e2e/server/*`, `e2e/fixtures/works.ts`), the new e2e cases in `cuj1`/`cuj5`/`harness.spec.ts`, and the two new API fixtures.
  - Sampled: unit tests and `e2e/live/smoke.spec.ts`.
- **Issues found:** 0 critical, 3 warnings, 3 info.
- **Auto-fixed:** 5 items in 4 commits. One was a flaky e2e test with a measured root cause.
- **Final gates on `main` after the fixes:**
  - `npm run check` passes: typecheck 0 errors, eslint 0, prettier clean, 2810/2810 vitest tests in 62 files, build.
  - `HFP_HEADLESS=1 npm run test:e2e`: **102 passed, 0 failed**, in two consecutive full runs.
  - Two more full runs on the pre-fix tree under synthetic load (load avg 16 and 32) also gave 102/102.

## Checklist results

| Area | Result |
|---|---|
| Type check | `tsc --noEmit`: 0 errors. The `src/` diff adds no `any`, no `@ts-*` comment and no `eslint-disable`. The only new cast is `as const` on the dispatch-failure literal (`engine.ts`). Test-side casts are justified: window globals in e2e, and one deliberate `as unknown as StartRequest` that models a record hydrated without `loggedIn`. |
| `requiresLogin` / `withheld` | `pixiv-api.ts` `isWithheld` matches system.md §8.5 line for line: `urls.original === null` → true; a string → false; otherwise the `sl ≥ WITHHELD_MIN_SANITY_LEVEL` fallback. `requiresLogin` is the §8.5 predicate. The content model (`model.ts` `reduce` `metadata`) and the resolver (`resolveFull`, before `/pages`/`ugoira_meta`) share one function. A record hydrated without `loggedIn` reads `?? null` and skips the check, as designed. |
| `lastStatus` plumbing | `retry.ts` remembers the last HTTP status of a non-final attempt. Only 429/5xx are retried, so only those can precede another attempt. `withLastStatus` attaches the status only to a final `network`/`timeout`. `isFailure` validates it as an optional count. `outcome.ts` row 8: `isUnanswered` = `network` without `lastStatus`. This matches §10 row 8 (a)–(c). |
| `failureOf` / `internal` | Offscreen: a non-encode exception becomes `internal`. An encode failure carries `EncodeError.attempts`, which is 2 only when the prefer-software pass ran and failed. An abort during either pass still rethrows the signal's reason, and the task is not live, so no failure is reported. Engine dispatch: `internal`, except `video`, which reports `encode`. `downloads.ts` "no blob" and resolver transport errors are `internal`. All four match system.md §10. |
| Layering (D11) | `npm run lint` passes. Probe: `import type … from '../background/registry'` in `src/shared` fails with the D11 message. `../../background/engine` from `src/content/button` fails too. `src/background/types.ts` is gone, with no shim left behind. |
| MV3: content bundle | IIFE. `npm run size`: **35.2 KB minified / 13.0 KB gzip** (budget 40 / 15; 34.4 / 12.6 at filing). |
| MV3: listeners | `sw.ts` and the offscreen entry are unchanged: registration is still synchronous at top level. |
| MV3: permissions | `src/manifest.json` is unchanged in the diff, and `test/unit/manifest.test.ts` passes. |
| Prod bundle | `npm run build:prod && ! grep -qE 'testHook\|__hfpTest\|await:(registry\|resolver\|handoff)' dist/*.js` passes. No `if (false)` remains. With `minifySyntax` the bundle stays readable for review (`const` → `let`, `!0`); identifiers and whitespace are intact. |
| pixiv selectors | Only in `src/content/pixiv-dom.ts`. The other DOM queries (`mount.ts:87`, `button/view.ts:198-199`) query our own elements. |
| Secrets | `test/fixtures/api/illust-{walled,visible}.json` hold only public work fields (`id`, `title`, `illustType`, `xRestrict`, `sl`, `urls`, `userId`, `userName`, `width`, `height`, `pageCount`). No token, cookie or session. |
| Logging / PII | The `sl` fallback `warn` logs the artwork ID and `sl` only. `content.ts`/`resolver.ts` log the needs-login reason (`xRestrict`/`withheld`) at `debug`. |
| Third-party notices | `npm run zip` → `THIRD_PARTY_NOTICES.txt` holds two sections, each with the full license text: `mediabunny 1.62.0`, `SPDX-License-Identifier: MPL-2.0`, `Source: https://github.com/Vanilagy/mediabunny`; `fflate 0.8.3`, `MIT`, `Source: https://github.com/101arrowz/fflate`. These are the only packages under `node_modules/` in the bundles; mediabunny's only dependencies are `@types/*`. |
| Packaging | The zip lists 17 files and no `.map`. Its manifest version is 1.0.0, equal to `package.json`. Sorted entries and a fixed DOS timestamp make it reproducible. `*.zip` is git-ignored. `build.mjs` wipes `dist/` first, so no stale file can ride along. |
| Fake-server prebuild | `startFakePixiv()` builds every ugoira zip before `listen`. The build is cached per worker process, so the ~1.5 s cost is paid once per worker, not once per test. The ENG-009 self-test answers the 1080p zip's headers within the 300 ms stall timeout. |
| Constants | `WITHHELD_MIN_SANITY_LEVEL` is used only in `pixiv-api.ts`; the fake server's `sl` values model pixiv and do not duplicate it. `PILL_HEIGHT_PX` exists once (`styles.ts`), interpolated into the CSS and imported by `mount.ts`. The options colours are now variables (`--invalid-border`, `--error-text`, `--saved`, `--muted`), and the dark mode overrides them. |

## Critical Issues (must fix before QA)

None.

The reported cuj5 "cancel a retry" flake was a test timing bug, not a Group 2 regression (Fixed 1).

## Warnings (should fix)

### 1. The floating fallback can miss "within 3 s of the artwork page rendering"

[src/content/mount.ts:213; system.md §11.6 row "3 s timer from artwork-route entry"]

This is the root cause of the cuj5 "floating fallback" CI flake.

**Measured delay** (12 runs, 6 workers, no extra load), from the fake's `<figure>` insertion to the host's insertion: **3016–3079 ms**. The test's budget is 3000 + 100 ms.

**Cause.** The timer starts when the content script enters the route, at `document_end`. The fake page renders the figure synchronously before `DOMContentLoaded`: `figureAt` ≈ `domContentLoadedEventStart`, ±0.5 ms. Three delays then add to the 3 s:
- the content script's injection lag;
- timer slack;
- the rAF-coalesced placement.

Under load these grow past 100 ms.

**Live pixiv** renders client-side after `document_end`, so it has natural margin. A page that renders before injection does not.

**Recommendation.** Do not widen the test's tolerance; that would hide a real gap against the PRD. Instead, anchor the **first** route of a document at navigation start:

```
setTimeout(fire, Math.max(0, FLOAT_FALLBACK_MS - performance.now()))
```

SPA route changes keep "from route entry".

This is a one-line code change, but it changes the timer semantics that system.md §11.6 and design-artwork-button.md "Mounting (mount.ts)" state. It therefore goes to next cycle's design (tl), then a coder. QA may log it as a LOW defect in the meantime.

### 2. cuj2 "no 100% while busy" and "no H.264 → WebM" load failures were not reproduced

[e2e/cuj2.spec.ts:471 `expectPercentRule`]

**Attempts, all passing:**
- two full suites under synthetic CPU load (load avg 16 and 32): 102/102 each;
- `cuj2` alone under load: 17/17;
- 48 runs of "no H.264", "ZIP only" and "metadata off" with 9 workers at load avg ~25: 48/48.

The original failure output was not kept.

**Code paths.** None found that shows a busy `100%` before the last file lands:
- `ugoiraPercent` returns 100 only when every file is `done`, otherwise it is capped at 99;
- the landing mutation returns `finalize` without a `push`;
- the unthrottled push on `off/ready` clears any trailing timer;
- `getJob` hides a finalizing job.

**The assertion is stricter than the PRD.** PRD §4.7.5 forbids `100%` only "before the last file has landed", and CUJ-2 "ZIP only" says the user sees "`0%` → `100%` … then `Saved · ZIP`". In practice the implementation never shows a busy `100%`, because finalize pushes the end state directly. That is a harmless spec/implementation nuance for pm (Info 3).

**Recommendation.** No change now. If it recurs, keep the Playwright trace (it is attached on failure) and file `/report-bug` with it. If the trace shows a busy `100%` after the last file landed, restate the rule as "no busy `100%` before the last `chrome.downloads` `endTime`" rather than relaxing it.

### 3. No e2e asserts the English ugoira width of 176 px

[e2e/cuj2.spec.ts]

The value is measured and depends on the font (176 px with the e2e fonts on macOS; Linux CI fonts may differ). The PRD also still disagrees with itself on it (CUJ-2 step 1 says 164 px; §4.7.2 says the widest label; system.md §15 item 10).

This review added the invariant that does not depend on the font (Fixed 2). The literal stays unasserted until pm resolves §15 item 10. The unit test `test/unit/button/width.test.ts` covers the candidate set.

## Info

1. **The content bundle grew 0.8 KB / 0.4 KB gzip this iteration** (R-003 `requiresLogin` and the logger import in `pixiv-api.ts`). Headroom is 4.8 KB minified and 2.0 KB gzip. The new value is recorded in system.md §11.6 (`bd30155`).
2. **The `sl` fallback warning fires once per parse** when pixiv's `urls` shape drifts:
   - up to twice per click (the render-time parse in the content script, and the resolver);
   - in production, in the pixiv page's console.

   This is acceptable as the drift alarm. It carries no PII.
3. **For pm (§4.7.5 / CUJ-2 "ZIP only")**: the busy label never reaches `100%`, because the end state replaces `99%` directly. The PRD's "`0%` → `100%` … then `Saved · ZIP`" describes a frame the user does not see. This is harmless, and pm can fold it into the next `/spec-sync`.

## Fixed

1. **[e2e/cuj5.spec.ts:851 "cancel a retry", e2e/cuj1.spec.ts:420, e2e/cuj4.spec.ts:193] The click-guard waits were timed from before the starting click.**
   - **Cause.** The waits started from a `Date.now()` taken before `clickButton()`. `clickButton()`'s `buttonCenter()` round trip delays the page's click, so the cancel click landed 478–499 ms after the starting click in page time, and the 500 ms guard (`model.ts` `canCancel`) ignored it. The button went back to `11 / 12`. Page-side click timestamps proved it: all 6 failures in 10 runs had gaps under 500 ms, and every pass had a gap of at least 501 ms.
   - **Not a Group 2 regression.** The same test fails 4/12 at `b224695`, the pre-iteration plan commit, in a throwaway worktree.
   - **Fix.** Take the timestamp after `await clickButton()`. Gaps are now 506–569 ms: "cancel a retry" passed 20/20, and the three affected tests passed 24/24. The product's guard is unchanged, and no assertion was relaxed.
   - Commit `fc542c9`.
2. **[e2e/cuj2.spec.ts "idle: Download · WebM and Download · ZIP"] cuj2 now checks the pill width.** The test asserts one fixed width (≥ the 164 px English floor; measured 176) across WebM → ZIP → WebM. This is design-artwork-button.md "Settings changes never change the width". Commit `6acde12`.
3. **[e2e/README.md] The CUJ-1 AC table gains the row "164 px also when the metadata arrives after the row"** (task 3.1's 'width: late metadata'). Commit `6acde12`.
4. **[src/content/button/view.ts:68] The `@example` called `clickAction` with its old 3-argument signature.** It now passes `loggedIn`. Commit `6ffc0a3`.
5. **[docs/design/system.md §12, §11.6] The design doc now records what shipped:**
   - `build:prod` is syntax-minified (ENG-007);
   - `THIRD_PARTY_NOTICES.txt` is written by `scripts/zip.mjs`, not by `build:prod` (ENG-006), and the `zip` row describes the reproducible archive and its version check;
   - the iteration-2 size measurement is recorded.

   Commit `bd30155`.

Also confirmed:
- The orchestrator's merge fix `3c1a342` (`loggedIn: null` in the badge test's `full` request literal) is a valid `StartRequest` value. The test's subject, the idle title at an expected count of 0, does not depend on it.

## Engineering-task verification (eng done-gate)

Every Verify was re-run on `main` and printed its token.

| ENG | Verify re-run | Evidence | Backlog |
|---|---|---|---|
| ENG-006 store packaging | `npm run zip && … unzip -l … && test -f docs/release-checklist.md && echo PACKAGE OK` | `PACKAGE OK`. 17 entries, no `.map`, manifest 1.0.0 = `package.json`. Notices hold MPL-2.0 and MIT texts with source URLs. The zip was deleted afterwards (git-ignored). | removed |
| ENG-007 prod bundle clean | `npm run build:prod && ! grep -qE '…' dist/*.js && grep -q 'build:prod' ci.yml && npm run check` | `PROD CLEAN` conditions met: grep clean, 0 `if (false)`, CI step present, check 2810/2810. | removed |
| ENG-008 layering | full Verify command | `LAYERING OK`, 2810 tests. The lint probe fails both a shared→background and a content→background import. | removed |
| ENG-009 zip prebuild | `HFP_HEADLESS=1`: `! grep -rn warmZip e2e && npm run build:e2e && playwright harness+cuj2 && … -g "fixture zips are prebuilt"` | `PREBUILD OK`: 24 passed, then 1 passed. | removed |
| ENG-010 size budget | `npm run size && ! node scripts/size.mjs --max-min-kb 1 --max-gzip-kb 1 && grep -q "npm run size" ci.yml` | `SIZE OK`. 35.2 / 13.0 KB passes; the 1 KB limits fail with "over budget". | removed |
| ENG-011 encode attempts | `npx vitest run -t "encode failure attempts" …; npm test` | `ATTEMPTS OK`. 7 matching tests passed, 0 failed. | removed |

`docs/eng-backlog.md` is now empty, with `Next-ID: ENG-012`. Nothing new was filed: Warning 1 changes user-visible timing (design or defect track), and Warnings 2 and 3 need either evidence or pm.

## Design-level items for next cycle (Phase 1)

1. **Fallback timer anchor** (Warning 1):
   - design-artwork-button.md "Mounting (mount.ts)" and system.md §11.6: the first route of a document counts the 3 s from navigation start;
   - `mount.ts` `show()`.
2. **Ugoira width literal and the CUJ-2 "100%" frame** (Warning 3, Info 3): pm via `/spec-sync` (system.md §15 item 10 and §4.7.5 wording). After that, add the literal width assertion if the resolved value is font-independent (an English floor), or keep only the invariant.
3. **Still open for pm** (system.md §15): items 1–12 as listed in `docs/tasks.md` "Document-authority notes". This iteration implemented the design side of items 6, 7, 8, 9 and 10, so the PRD amendments are now the only gap for those.
4. **R-003 residual "miss 2"** (stale logged-in marker after logging out in another tab): accepted per system.md §8.5. The release checklist §3 "R-003 stale-page probe" collects the evidence needed to close it.
