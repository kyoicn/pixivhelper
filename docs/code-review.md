# Code Review — dev-cycle iteration 5 (Phase 3.6)

> Reviewed: 2026-10-28 00:02:49 (UTC-7)
> Scope: `git diff 5508a46..HEAD`, the six merged task branches of iteration 5:
> - `4f863f2` feat(engine) — D15 folder choice (`src/shared/folder-choice.ts`, `src/background/folder-choice.ts`, `resolver.ts`, `engine.ts`, `constants.ts`, unit tests);
> - `18b02f0` fix(offscreen) — D16 offscreen readiness (`offscreen-client.ts`, `constants.ts`, unit tests);
> - `d46b7fa` test(harness) — ENG-014 test doubles (`test/fakes/chrome.ts`, `e2e/harness/launch.ts`, `chrome-fake.test.ts`);
> - `5e27fc9` test(engine) — L2 and fake-based tests for D15/D16 (`sw-folder-choice.test.ts`, `sw-concurrent.test.ts`, orchestration and lifecycle-hold unit tests);
> - `d59219e` test(e2e) — cuj1/cuj2/cuj4/cuj5 and live smoke rewrites, `e2e/harness/flows.ts` `recordSwLog`;
> - `5511f40` test(engine) — ENG-013 settle-wait pins.
>
> Baseline: system.md D15, D16, §11 (performance rows), §13 (constraints rows for the folder choice and the offscreen readiness); design-download-engine.md "Folder choice"; design-offscreen-worker.md "Lifecycle" and "Testing"; design-test-harness.md L2 (disk model, holds), L3 helpers and the acceptance-criteria mapping; design-settings-model.md "Folder-choice suffix"; PRD-000 §4.3 "Folder choice" and CUJ-1 step 8 / CUJ-4 AC 5 as refined 2026-10-27.
> Guidelines: no `docs/*-guidelines.md` exist. The code was reviewed against `docs/design/*` and standard engineering practice.
> This review changed files under `docs/` only. No file under `src/`, `test/` or `e2e/` needed a fix.

## Code Review Summary
- **Files reviewed:** 27 in the diff (6 `src/`, 13 `test/`, 8 `e2e/`), plus the design chapters above.
  - Read in full: `src/shared/folder-choice.ts`, `src/background/folder-choice.ts`, the `offscreen-client.ts` diff, the `resolver.ts` diff and `fetchUgoiraMedia`, the `engine.ts` wiring, the three new constants; the `FakeDownloads` disk model and the `FakeOffscreen` holds; `e2e/harness/launch.ts` (`inside`, `remove`, `move`, `expireExistenceCheck`, `eraseHistory`) and `flows.ts` (`recordSwLog`); every new or changed unit, integration and e2e test.
  - Also read for context: `isSafeRelativeFolder` (`pattern.ts`), the artwork-id validation (`pixiv-api.ts`, `router.ts`), `handlers.ts`'s folder validation for retry requests, `eslint.config.js` (D11 layering rule), `@types/chrome` `DownloadQuery`/`DownloadItem`.
- **Issues found:** 0 critical, 0 warnings, 3 doc corrections (the coders' reports, all confirmed), 6 info.
- **Auto-fixed:** 3 design-doc corrections (below). No code change.
- **Gates on `HEAD` (`fbcdc71`)** before and after the doc edits:
  - `npm run typecheck`: 0 errors. `eslint .` + `prettier --check .`: clean.
  - vitest: **3305/3305** tests in 71 files (`npm run check` passes, including the dev build).
  - `npm run build:prod && ! grep -qE 'testHook|__hfpTest|await:(registry|resolver|handoff)' dist/*.js`: **passes**. The prod `sw.js` carries the `folder choice` debug string once (the SW is not size-budgeted; the content script is).
  - `npm run size`: **35.4 KB minified / 13.1 KB gzip** (budget 40 / 15), unchanged: the diff touches no content-script code.
  - e2e spot check (`HFP_HEADLESS=1`, `--workers=1`, fresh `dist-e2e/`): cuj1 "a third click goes to (2)" (2.7 s), cuj1 "gap: … the next click uses (1)" (13.4 s, pays the 10.5 s re-check wait as designed), cuj4 "two tabs at once, two artworks (run 1)" (1.3 s): **3 passed**.

## Checklist results

| Area | Result |
|---|---|
| Type safety | No `any`, `@ts-*`, `eslint-disable` or `as unknown as` added anywhere in the diff (the e2e suite's pre-existing `window as unknown as {…}` globals are untouched). `src/background/folder-choice.ts` reads `deps.search`'s result as `unknown`, checks `Array.isArray`, and only then narrows to `DownloadItem[]`: a deliberate guard against a malformed answer, not a weak cast. `(n): n is number => n !== null` is a real guard. `FolderChoiceDeps` and `ResolverDeps.chooseFolder` are fully typed; `chrome.downloads.DownloadQuery` accepts `limit: 0` and `DownloadItem.exists?: boolean` in `@types/chrome@0.3.6`, which is why `exists !== false` (not `=== true`) is the right test (design "Folder choice", bullet). `OffscreenCommand`/`ResponseMap` typing of `send` is unchanged. Test side: `let resolve!` in `createHold` is the established definite-assignment pattern, assigned synchronously by the executor. |
| Layering (D11) | `eslint .` passes. `src/shared/folder-choice.ts` has **no imports at all** and touches no `chrome.*` (pure, as the design requires). `src/background/folder-choice.ts` imports `../shared/{constants,folder-choice,log,pattern}` only. `resolver.ts` gains no import: the folder choice reaches it through `ResolverDeps`, injected by `engine.ts`. |
| DEFAULT_DEPS late binding | `search: (query) => chrome.downloads.search(query)` resolves `chrome` per call, so a fake installed after module import is used. Pinned by "chooseFolder: uses the chrome.downloads installed after import". |
| Resolver ordering | Both `full` branches run `Promise.all([<second API call>, deps.chooseFolder(folder, artworkId)])` and only then build the plan, so nothing (including `metadata.json`) is queued before the folder is known. The ugoira branch bundles `ugoira_meta` → `caps` into `fetchUgoiraMedia` so the pair runs alongside the choice. `chooseFolder` never rejects (its `catch` returns the plain folder), so `Promise.all` cannot reject on its account; an API failure still fails the resolve after the choice settles (pinned: "a /pages failure after an answered folder choice fails the resolve"). Retry modes never call it (pinned ×4) and echo the folder, suffix included. |
| Test hooks | No `+` line in `src/` adds `__testHook`/`__TEST_HOOKS__`; the existing `await:resolver.caps` hook moved with `fetchCaps` unchanged. Prod bundle grep passes. |
| Upgrade safety (1.0.0 → next) | `JobRecord`, `StartRequest`, every message shape and the storage layout are unchanged (`git diff -- src/shared/job.ts src/shared/messages.ts` is empty); no migration. A job persisted by 1.0.0 in `resolving` re-resolves under the new resolver with the same inputs. A 1.0.0 content script still running in an open tab sends the same `job/start`; a retry it sends echoes the plain folder, which the new resolver keeps. A 1.0.0 user's history already holds `135882741_p0 (1).jpg`-style safety-net names in the plain folder: the regex counts them as n = 0, so the first post-upgrade repeat goes to `(1)` (design edge "A safety-net name in the history"). No new permission (`downloads` covers `search` and, in the harness, `erase`). |
| Security / privacy | The `debug` line logs `{ artworkId, records, surviving, chosen }`: two counts and the **relative** chosen folder; no `DownloadItem.filename` (the absolute path naming the user's home directory) is ever logged, and the `warn` paths log the relative `chosen` or the `Error` object. Pinned by "logs only the relative chosen folder, never Chrome's absolute paths". The regex escapes `\ ^ $ . \| ? * + ( ) [ ] { }` and uses only `(?:…)`, `\d`, a negated class and `^`/`$`: the RE2 ∩ ECMAScript subset (pinned: no lookaround, `\Q`, backreference or `\k`). `artworkId` is `/^\d{1,12}$/`-validated at the job boundary (`pixiv-api.ts`, `router.ts`), so it needs no escaping. The chosen folder is re-validated with `isSafeRelativeFolder` as a belt (the invariant is proven in design-settings-model.md and pinned over the Golden examples ×4 suffixes). `e2e/harness` `inside()` resolves the relative path under the downloads dir and refuses `''`, `..`-escapes and absolute results before `rm`/`rename`; `eraseHistory` runs inside the test profile only. |
| Performance | **Second search only when the first found records:** `if (first.length === 0) return folder;` before the `sleep`, pinned by "no record → one search and no wait" (1 call, 0 sleeps). **250 ms concurrent with the API call:** the `Promise.all` above; pinned at L2 by "a repeat job's resolve ends within 260 ms of the API answers" (system.md §11 row). **D16 loop bounded:** `deadline ??= Date.now() + 1000`, `if (Date.now() + 25 > deadline) throw error`, so at most 41 sends and ≤ 1 s from the first rejection; pinned by three fake-timer tests. Each resend costs one `getContexts` and one `sendMessage`, sub-millisecond each. |
| Configuration | `FOLDER_CHECK_RECHECK_WAIT_MS = 250`, `OFFSCREEN_READY_WAIT_MS = 1000` and `OFFSCREEN_RESEND_DELAY_MS = 25` live in `src/shared/constants.ts` under "Timings", each with a comment naming its basis (D15; pm's CUJ-4 AC 5 bound, D16). All three are recorded in system.md §13 and consumed by name in the tests. The harness-only `EXISTENCE_RECHECK_RATE_LIMIT_MS = 10_000` is a documented constant in `e2e/harness/launch.ts` (Chromium `kFileExistenceRateLimitSeconds`), used by `expireExistenceCheck()` only. No duplicated or hardcoded timing anywhere in the diff. |
| Design ↔ code | `src/shared/folder-choice.ts` matches the design block character for character. `src/background/folder-choice.ts` matches the design block except for the `search()` array-check wrapper, which the design described in its edge table but omitted from the block (now noted, Fixed 1). `offscreen-client.ts` matches design-offscreen-worker.md's block line for line (rules a–d, the resend loop, the kept `closing` promise). The fake's disk model and holds match design-test-harness.md L2. |
| Commit hygiene | Every commit's type matches its paths: `feat(engine)` carries `src/` plus its tests; `fix(offscreen)` carries `src/` plus tests (its 3-line touch of `engine-download-ui.test.ts` installs a listening fake handler so no send waits out the resends, which the fix made necessary); the four `test(...)` commits carry `test/`/`e2e/` only. |

## Test strength (read, not mutated)

The iteration's tests discriminate the designed behaviour at the right layer:
- **D15 regex and index** (`test/unit/shared/folder-choice.test.ts`): every row of the design's match/reject list, including both OS separators, a last segment already ending in ` (2)`, regex specials, and the RE2-subset pins.
- **D15 orchestration** (`test/unit/background/folder-choice.test.ts`): two searches with the exact query, the sleep between them, one search and no sleep when empty, gaps, `exists: false` dropped, the no-`exists` record counted, every failure path → plain + `warn`, the validation belt, default-deps late binding, and the fake's disk model including the stale-flag residual (`existenceCheckDelay(400)` → `(2)`), which pins the 250 ms bound's accepted cost as intended behaviour.
- **D15 resolver and L2**: concurrency pinned by holding `/pages` and `ugoira_meta` and observing `chooseFolder` already called; "nothing is planned before the folder choice answers"; the sw-folder-choice suite covers the PRD's two-tab edges both ways and the retry echo.
- **D16** (`offscreen-client.test.ts`, `sw-concurrent.test.ts`): rule (b) by a creation held 1500 ms (longer than the bound, so the resend loop cannot mask its removal), rule (a) by a held close, rule (d) by a duplicate-creation rejection, the loop's cadence/count/deadline, and three integration runs ending `saved` with every command delivered exactly once.
- **ENG-013**: the three specified pins are present by name (below).
- **E2E**: the folder-choice cases assert the per-file sizes, the untouched first folder (`mtime`s), the tooltip/aria text, the absence of parent suffixes, and the SW log lines; the D16 cases click both tabs in one `Promise.all` and assert no `offscreen did not take`.

## Critical Issues (must fix before QA)

None.

## Warnings (should fix)

None.

## Info

1. **A failed `/pages` or `ugoira_meta` now waits for the folder choice to settle** (≤ ~260 ms when records exist) before the resolve fails, because `Promise.all` settles after both. The design accepts this ("a `/pages` failure after an answered `chooseFolder` still fails the resolve"); the user-visible cost is a slightly later `Retry`/`Error` face in a case that already took a network round trip. No change.
2. **Up to 40 `debug` lines per command during a slow document load** (`offscreen document not listening yet, resending`), times the five concurrent files. Debug level, bounded to the 1 s window, and the only trace of the readiness path at L4. No change.
3. **`ensureOffscreen` does not re-check `closing` after awaiting it.** A new close can only start from `scheduleClose()`, which the registry calls when it is empty; a caller inside `send()` has a job registered, so the window is theoretical. Also test-covered end to end by "a command during a held close goes once to a fresh document". No change.
4. **`folderIndexOf` compiles the regex per record.** V8's RegExp compilation cache serves identical `new RegExp(source)` calls, and the record set is bounded by the artwork's files × runs. No change.
5. **`downloads.remove()` uses `rm({ recursive: true })` without `force`.** A missing path rejects and fails the test loudly, which is the right default for a harness helper. No change.
6. **The harness `move()` helper does not resolve symlinks** before the containment check; the downloads dir is a per-test temp dir the harness itself creates, so nothing inside it is a symlink. No change.

## Fixed

1. **[docs/design/design-download-engine.md "Folder choice" → Observability]** The paragraph said `debug` once per `full` job. The code (`src/background/folder-choice.ts:43`) returns the plain folder before any logging when the first search is empty, so a first run and the run after `eraseHistory()` log nothing. Rewritten to say so; the e2e helper `expectFolderChoices` already encodes this (empty list for the erased-history case). Also recorded the `search()` array-check wrapper as a bullet (the edge table already listed the behaviour) and added the "record without `exists` counts as present" and "no `filename` in the debug line" pins to the Testing list. (Coder reports 1 and 3.)
2. **[docs/design/design-test-harness.md mapping row for CUJ-1 step 8; L3 helpers]** The row said "`consoleErrors()` collector at `debug`" and "one `folder choice` line per full job". Corrected to `recordSwLog()` (new helper, now listed under Helpers with its purpose: `consoleErrors()` keeps errors only) and to "one line per job whose first search found records, none for a first run or after `eraseHistory()`". (Coder report 1.)
3. **[docs/design/design-offscreen-worker.md "Testing"]** Added item 7: the e2e 'two tabs at once' tests, and the discrimination finding that removing rule (b) alone stays green on real Chrome because the document loads well inside the 1 s bound and rule 2's resend loop covers it; rule (b) (and rule a) are pinned at L2 by holds longer than the bound, which real Chrome cannot be made to reproduce; e2e pins the end-to-end outcome of the three rules together. (Coder report 2.)

## Engineering-task verification (eng done-gate)

**ENG-013: confirmed and removed.**

| Verify / AC | Evidence |
|---|---|
| `npx vitest run test/unit/background/engine-download-ui.test.ts` passes and lists the three names | Re-run: **36/36** pass; the verbose output lists "handOff: an earlier file Chrome already finished lets the restore go ahead at once (downloads.search)", "handOff: an earlier download Chrome no longer knows lets the restore go ahead at once", "handOff: another job's file still in progress holds the last hand-off's restore back until it finishes". |
| `npm run check` passes | Passes (3305 tests, build). |
| Mutation report | The coder's report names tests 1–2 failing under the search no-op and test 3 under the own-job filter, matching the entry's prototype. Not re-run here (the iteration-4 review already ran both mutations on the prototyped tests; the committed tests are the same cases). |
| No change under `src/`, `e2e/`, `docs/` | `git show --stat 5511f40`: one file, `test/unit/background/engine-download-ui.test.ts`. |

**ENG-014: confirmed and removed.**

| Verify / AC | Evidence |
|---|---|
| `npx vitest run test/unit/background/chrome-fake.test.ts` passes and lists `removeFile`, `existenceCheckDelay`, `holdCreation`, `holdClose` | Re-run: **103/103** pass (139 with the ENG-013 file); the verbose output lists 8 `removeFile`/`removeFiles` cases, 2 `existenceCheckDelay`, 6 `holdCreation`, 3 `holdClose`, plus the `search` (`filenameRegex`, `urlRegex`, `limit 0`, `limit 2`) and `addCompleted` cases the AC requires. |
| `npm run check` passes; `tsc --noEmit` reports no error in `e2e/harness/` | Both pass (`tsconfig.json` includes `e2e/`). |
| The e2e helpers exist with the documented signatures; `expireExistenceCheck` only in the moved-folder and gap cases | `remove`, `move`, `expireExistenceCheck`, `eraseHistory` on `Downloads` in `e2e/harness/launch.ts`; `grep -n expireExistenceCheck e2e/*.spec.ts` → the 'moved' and 'gap' tests only. |
| Every existing test passes unchanged (holds and disk model opt-in) | 3305/3305; the only pre-existing test edits in the iteration are the deliberate D15 rewrites (`sw-pages` "second run", e2e 're-download', cuj5 four-saves). |
| No change under `src/` | `git show --stat d46b7fa`: `e2e/harness/launch.ts`, `test/fakes/chrome.ts`, `test/unit/background/chrome-fake.test.ts`. |

Both blocks are removed from `docs/eng-backlog.md`; the backlog is **empty** and `Next-ID` stays ENG-015. The commits referencing the IDs (`5511f40`, `d46b7fa`) are the record.

## Design-level items for next cycle (Phase 1)

1. **pm spec-sync (already in system.md §15 item 1):** PRD §4.2 and the CUJ-1 "folder moved" edge omit Chrome's 10 s re-check rate limit; the e2e suite pays 10.5 s in two tests because of it, and the design records the residual. Not a blocker.
2. **Live smoke (L4) repeat-download case** was added to `e2e/live/smoke.spec.ts` by `d59219e`; it has not been run in this review (live pixiv). QA's `@live` run should include it once before release.

**Fine as is:** the pure regex/index module, the orchestration's two-search read of the re-check and its never-reject contract, the resolver's `Promise.all` placement, the D16 rules and bounded resend loop, the three constants and their §13 records, the fake's disk model and holds, the harness path guards, type safety, layering, the prod bundle, the size, and the ENG-013/ENG-014 pins.
