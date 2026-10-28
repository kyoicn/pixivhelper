# Project Status

> Auto-generated project status summary.
> Last updated: 2026-10-28 01:58:23 (UTC-7)

## Overview
**Helper for Pixiv** (public name per R-002) is a Chrome extension (Manifest V3, desktop Chrome 116+) that adds one Download button to every pixiv artwork page. One click saves the artwork into its own folder under Chrome's Downloads folder: originals, a `metadata.json`, and for ugoira the frame zip, `frames.json` and a video encoded in the browser. It replaces the personal terminal script `ref/pixiv-dl`.

Current phase: **dev-cycle iteration 5, done (QA gate and PM review complete); `docs/prd/prd-000-mvp.md` is `status: completed`.** Iteration 5 built the 2026-10-27 CUJ-1 refinement: D15 folder choice (a repeat download of the same artwork goes to a sibling folder `<folder> (n)`, chosen from Chrome's download history) and D16 offscreen readiness (the fix for the iteration-4 creation race), plus the test-double work ENG-013 and ENG-014 and the e2e/L2 test rewrites. Code review (`docs/code-review.md`): 0 critical, 0 warnings. The QA gate (run `iter5-00-09-39`, `main` at `cac42dc`) is **FAIL with 1 LOW**: CUJ-2, CUJ-3, CUJ-4, CUJ-5 PASS; CUJ-1 fails on one new LOW (the folder check is a suffix match on the absolute path, so records outside `<Downloads>/<folder>/` cause a needless ` (1)`; no data loss). Both iteration-4 LOWs are closed. The iteration-5 PM review (`docs/pm-review.md`) rates all five CUJs Satisfied: CUJ-1 and CUJ-4 left Caveats because D16 closed the race, and the refined CUJ-1 is Satisfied with QA's LOW judged not a caveat.

Release: 1.0.0 is live on the Chrome Web Store since 2026-10-27 (https://chromewebstore.google.com/detail/helper-for-pixiv/acodafjaeeanbgobjgpjknnehibaednb; `docs/releases/1.0.0.md`). The D15/D16 work ships as **1.0.1**, prepared but not released: the version is bumped (`8a03bdc`; `package.json`, and the manifest takes it from there at build time), `helper-for-pixiv-1.0.1.zip` is built (17 files, 184.3 KB), and the release note is `docs/releases/1.0.1.md`. Local `npm run check` 3305/3305, size 35.4 / 13.1 KB, prod test-hook grep clean, golden ok, live smoke 4/4. `main` is not pushed, so CI on the release commit is pending (the owner must run `git push`); the owner-only `docs/release-checklist.md` section 2/3 items and the store upload are not done.

## Tech Stack

| Area | Choice |
|------|--------|
| Platform | Chrome MV3 extension, min Chrome 116, permissions frozen at 5 (adds `downloads.ui`) + 2 hosts (`src/manifest.json`, locked by `test/unit/manifest.test.ts`) |
| Language / build | TypeScript `~6.0.3` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), esbuild `^0.28.2` via `scripts/build.mjs` (`--prod`, `--e2e`, `--watch`), Node >= 22, ESM |
| Runtime deps | `mediabunny ^1.62.0` (WebCodecs mux, MPL-2.0), `fflate ^0.8.3` (zip, MIT) |
| Unit tests | vitest `^5.0.5` + happy-dom `^21.0.4`, chrome fakes in `test/fakes` |
| Lint / format | eslint `^10.13.0` + typescript-eslint `^8.72.0` (innerHTML banned outside `src/content/button/icons.ts`), prettier `^3.9.10` |
| E2E | `@playwright/test ^1.64.1` against an unpacked `dist-e2e/` extension and a fake pixiv server (`e2e/server/`, `selfsigned` TLS); QA walks in `e2e/qa/` |
| CI | `.github/workflows/ci.yml` (check, content bundle size budget, prod-bundle test-hook check) |
| Ugoira encoding | WebCodecs to MP4/H.264, WebM fallback, ZIP-only option |
| Locales | `en`, `ja`, `zh_CN`, `zh_TW` (`src/_locales/`) |

Scripts: `build`, `build:prod`, `build:e2e`, `watch`, `typecheck`, `lint`, `test`, `test:e2e`, `size`, `zip` (store zip with third-party notices), `check` (typecheck + lint + test + build), `golden`, `qa:fake`, `qa:live`.

## Architecture
Four runtime contexts, designed in `docs/design/system.md` plus six chapter docs:
- **Content script** (`src/content/`, IIFE bundle): `pixiv-dom.ts` is the only home of pixiv selectors; `mount.ts` injects the pill into the action row (floating fallback after 3 s); `button/` holds model, labels, width, view, styles, icons, live region; `router.ts` and `api-proxy.ts` talk to the SW; `tab-memory.ts` keeps per-tab state.
- **Service worker** (`src/background/`): `sw.ts` registers listeners synchronously; `handlers.ts` validates messages and senders; `engine.ts` runs jobs; `registry.ts` persists job records (`storage.session`); `scheduler.ts` caps concurrency (5 files per artwork); `resolver.ts` resolves the folder; `folder-choice.ts` (D15) asks `chrome.downloads.search` (`filenameRegex`, `state: 'complete'`, a second search after `FOLDER_CHECK_RECHECK_WAIT_MS` = 250 ms for Chrome's `exists` re-check) and picks `<folder>` or the lowest free `<folder> (n)`, failing soft to the plain folder; `downloads.ts` drives `chrome.downloads`; `download-ui.ts` toggles Chrome's download UI via `setUiOptions` (hide at the first hand-off, restore just before the busy period's last hand-off, re-enable on SW boot when idle); `dnr.ts` sets the `Referer` rule for `i.pximg.net`; `reconcile.ts` recovers jobs after SW restart; `badge.ts`, `pusher.ts`, `view.ts` project progress to badge and tabs; `offscreen-client.ts` (D16: awaits the in-flight `createDocument` and any in-flight close, then resends a command for at most 1 s while the document is not listening yet), `tab-client.ts`, `options-tab.ts`, `caps.ts`.
- **Offscreen document** (`src/offscreen/`): command router, byte fetches (`fetch-bytes.ts`), zip retention, ugoira pipeline in `ugoira/` (`timeline.ts`, `zip.ts`, `codec.ts`, `encode.ts`); one frame in flight to bound memory.
- **Options page** (`src/options/`): full-tab settings with autosave, validation, chips, and the Saved indicator; opened from the toolbar icon (no popup).
- **Shared** (`src/shared/`): types, `job.ts` (job model types, moved from `src/background/types.ts` in ENG-008; ESLint forbids shared importing background), message catalog, `retry.ts` (4 attempts, 429/5xx/network/30 s timeout, backoff 1.5/3/6 s, remembers `lastStatus`), `outcome.ts` classifier, `pixiv-api.ts` parsers, `pattern.ts` and `settings.ts`, `folder-choice.ts` (pure: `folderCheckRegex`, `folderIndexOf`, `lowestFreeIndex`, `withFolderIndex`), `metadata.ts` (golden parity with `ref/pixiv-dl`), `i18n.ts`, `constants.ts`, `test-hooks.ts`.

## CUJ Status

Impl reflects code on `main`; QA is from `docs/qa-report.md` (iteration 5, run `iter5-00-09-39`, gate FAIL, 1 LOW); PM is from `docs/pm-review.md` (iteration 5): all five CUJs Satisfied.

| CUJ | PRD | Priority | Impl | QA | PM |
|-----|-----|----------|------|----|----|
| CUJ-1: Download an illustration or manga from the artwork page | prd-000 | P0 | in progress (D15 built; LOW folder-check scope) | FAIL (LOW) | Satisfied |
| CUJ-2: Download an ugoira | prd-000 | P0 | merged | PASS | Satisfied |
| CUJ-3: Configure the extension from the toolbar icon | prd-000 | P0 | merged | PASS | Satisfied |
| CUJ-4: Follow several downloads at once from the toolbar badge | prd-000 | P1 | merged | PASS | Satisfied |
| CUJ-5: Recover when a download can't start or breaks | prd-000 | P0 | merged | PASS | Satisfied |

**Column values:**
- `Impl`: `not started` | `in progress` | `merged`
- `QA`: `PASS` | `FAIL` | `BLOCKED` | `NOT_RUN` | `WAIVED` | `UNIMPLEMENTED` | `—`
- `PM`: `Satisfied` | `Caveats` | `Not done` | `—`

A CUJ is **fully done** when Impl=`merged`, QA=`PASS`, AND PM=`Satisfied`. CUJ-2, CUJ-3, CUJ-4 and CUJ-5 are fully done (CUJ-4's caveat, the creation race, is resolved: QA probe 32/32 at click gap 0, grace-close 111/111). CUJ-1 is PM Satisfied but not fully done: QA is FAIL on the LOW below, which pm judged not a caveat and which R-008 (answered A) accepted in PRD §4.3 as a limitation.

QA findings per CUJ:
- CUJ-1: FAIL on one LOW (folder check counts files outside `<Downloads>/<folder>/`, below). The refined ACs otherwise pass twice on the e2e build and once on the store zip: second download goes to `(1)`, third to `(2)`, moved or deleted folder goes back to the plain one, a gap is reused, history cleared falls back to per-file ` (1)` names, a token-free `pixiv` pattern repeats to `pixiv (1)`, no parent folder is ever suffixed, tooltip and aria name the folder actually used.
- CUJ-2: PASS (a repeat of an ugoira lands in `(1)` with zip, `frames.json`, video and `metadata.json`).
- CUJ-3: PASS (including the R-007 item 4 contrast colours in both themes).
- CUJ-4: PASS (the iteration-4 LOW is resolved by D16).
- CUJ-5: PASS (a Retry of a `(1)` job stays in `(1)`; R-007 item 6 Retry re-writes `metadata.json`).

Dependencies (PRD): CUJ-2 needs CUJ-1 and CUJ-3; CUJ-4 needs CUJ-1; CUJ-5 needs CUJ-1 and CUJ-2.

## Key Types & Interfaces
- `src/shared/types.ts`: `Settings` / `SettingsSnapshot` (folder pattern, `UgoiraOutput` = `mp4|webm|zip`, metadata on/off), `WorkInfo`, `Failure` / `FailureKind`, `JobMode` (`full|retryPages|retryEncode|retryMetadata`), `ErrorCause` (`offline|refused|server|disk`), `JobOutcome`, `JobProgress`, `JobView` (what the button renders), `RetryResult<T>`.
- `src/shared/job.ts` (formerly `src/background/types.ts`): `StartRequest` (now carries `loggedIn`), `FileRole` (`metadata|page|zip|framesJson|video`), `FileState`, `FileTask`, `UgoiraState`, `JobRecord`, `ErrorCode`.
- `src/shared/messages.ts`: typed message catalog between content, SW and offscreen.
- Output files: `metadata.json` (same fields as `ref/pixiv-dl`, parity checked by golden vectors in `test/golden/`) and `frames.json` (ugoira frame timing).

## Data Flow
Click in the content script, then `start` message to the SW. The engine snapshots settings, fetches `/ajax/illust/{id}`, then `/pages` (illustType 0/1) or `/ugoira_meta` (2), resolves the folder (a `full` job also runs the folder choice alongside the second API call, so a repeat download gets `<folder> (n)`; retries reuse the job's folder), writes `metadata.json`, and queues originals through `chrome.downloads` in page order (DNR sets `Referer` for `i.pximg.net`). For ugoira, the offscreen document fetches and unzips the frame zip, encodes video with WebCodecs, and returns bytes for the SW to save. Progress flows back as `JobView` pushes to the tab (throttled 250 ms) and as the toolbar badge (total files remaining across jobs, `999+` cap, coalesced 50 ms). Job records persist in `storage.session`, and `reconcile.ts` rebuilds state after a SW restart. Failures are classified by `outcome.ts` into button states (Retry, Log in to download, Unavailable). Per R-003, `requiresLogin`/`withheld` (`pixiv-api.ts`: `urls.original === null` or high `sl`) shows `Log in to download` for walled all-ages works before any click, and the resolver refuses to fetch pages for them.

## File Structure
```
/Users/xlw/workspace/codebase/pixivhelper
├── src/
│   ├── manifest.json, globals.d.ts, icons/, _locales/{en,ja,zh_CN,zh_TW}
│   ├── background/   service worker engine, registry, scheduler, DNR, badge
│   ├── content/      pixiv-dom.ts, mount.ts, router.ts, button/
│   ├── offscreen/    command router, fetch-bytes, ugoira/ encoder
│   ├── options/      settings page
│   └── shared/       types, messages, retry, outcome, pattern, metadata, i18n
├── test/             unit/, integration/, fakes/, fixtures/, golden/, helpers/ (3305 vitest tests)
├── e2e/              harness/, server/ (fake pixiv), fixtures/, qa/, live/, cuj1-5 specs
├── scripts/          build.mjs, gen-golden.py, render-icons.mjs, owner-lint.sh, size.mjs, zip.mjs, spike/ (ENG-002 findings)
├── .github/workflows/ci.yml
├── docs/
│   ├── prd/          index.md, prd-000-mvp.md
│   ├── design/       system.md + 6 design-*.md chapters
│   ├── ux/           12 HTML mocks
│   ├── qa-report.md, qa-artifacts/, code-review.md, tasks.md, eng-backlog.md
│   └── owner-queue.md, rulings.md (R-001..R-008), release-checklist.md, loop-state.md
└── ref/pixiv-dl      reference terminal script
```
No `CLAUDE.md` in the project root.

## Recent Activity
Iteration 5 (`git log 5508a46..HEAD`, plan to code review):
- `4f863f2` feat(engine): a repeat download goes to `<folder> (n)` (D15; merged as `e7af7d1`). New `src/shared/folder-choice.ts`, `src/background/folder-choice.ts`, wiring in `resolver.ts` / `engine.ts`, new constants.
- `18b02f0` fix(offscreen): wait for the document to listen instead of failing files (D16; merged as `6b383ba`). Rewrite of `src/background/offscreen-client.ts`. Resolves the iteration-4 creation-race LOW.
- `d46b7fa` test(harness): disk model, offscreen holds and e2e folder helpers (ENG-014); `5511f40` pin the settle wait's search fallback and cross-job ids (ENG-013).
- `5e27fc9` L2 and fake-based tests for folder choice and offscreen readiness; `d59219e` e2e: repeat downloads land in the sibling folder, two tabs clicked at once both save.
- `5708d09` docs(design): folder-choice log per job, `recordSwLog`, D16 e2e discrimination note; `cac42dc` docs(review): iteration 5 code review, close ENG-013 and ENG-014.
- Before the cycle: `8a65084` docs(prd): refine CUJ-1 (route D, Issue 2026-10-27-19-58-31), `5ea4c27` README with the Store link, `d225a30` docs(release): 1.0.0 submitted, `442e192` privacy policy.
- **Uncommitted in working tree:** QA's new tests and docs: `docs/qa-report.md`, `e2e/README.md`, `e2e/cuj1.spec.ts` (renamed-files re-download), `e2e/cuj5.spec.ts` (sibling-folder Retry, pages + `metadata.json` both failed, only `metadata.json` failed).

Test status at QA: `npm run check` 3305/3305 vitest in 71 files; e2e headless 162 passed / 6 headed-only skipped (headed toolbar 6/6); live smoke 4/4 twice (now includes the repeat click); bundle 35.4 KB minified / 13.1 KB gzip (budget 40 / 15).

## Owner Queue
Owner queue: empty — nothing is waiting on the owner

## Known Issues & TODOs
QA (`docs/qa-report.md`, iteration 5: 0 critical / 0 high / 0 medium / 1 low):
1. `[LOW][BUG]` CUJ-1, folder check scope: `folderCheckRegex` (`src/shared/folder-choice.ts:18-21`) anchors only the first pattern segment, not the Downloads root. A record at `<old Downloads>/pixiv/みずき-135882741/…` (Chrome's download location changed) or `<Downloads>/x/pixiv/…` (an earlier longer pattern) makes the next run use `pixiv/みずき-135882741 (1)` although `<Downloads>/pixiv/みずき-135882741/` does not exist. PRD §4.3 defines "present" as a record under `<Downloads>/<folder>/`. Reproduced 2/2; no file lost or misplaced. Fix options: anchor to the Downloads root (approximate it from the history) or accept it in §4.3. Resolved by R-008 ("Go with A"): pm applied it as an accepted §4.3 limitation (`e717850`), and tl recorded it in `design-download-engine.md` (`0c0dc12`); no code change. Not pinned in e2e (repro: `cuj1folders.ts` `SECTIONS=nested,dirchange` in `docs/qa-artifacts/iter5-00-09-39/walk-scripts/`).

Resolved this iteration: the iteration-4 LOW "offscreen-document creation race" (D16: two tabs at click gap 0 8/8 on e2e and store zip, sweep 40/40, pre-D16 build 1/8) and the iteration-4 LOW "`N / N` counter residual" (now spec, R-007 item 1).

Spec note (not a bug; spec-synced by R-008): Chrome rate-limits the download-existence re-check to once per 10 s, so a click made within 10 s of moving the plain folder lands in `(2)`, not the plain folder (QA 2/2; waiting 10.5 s gives the plain folder). PRD §4.2 ("takes at most a few hundred ms") and the CUJ-1 AC 13 / "folder moved" edge omit this. pm added the qualifier to PRD §4.2 / CUJ-1 (`e717850`) and tl closed `docs/design/system.md` section 15 item 1 (`0c0dc12`); no code change is possible.

Not verified (NOT_RUN, QA has no pixiv account; `docs/release-checklist.md` section 3): CUJ-5 AC 2, AC 4 and AC 9 after a real login, CUJ-1 AC 20 on pixiv's live dark theme, the logged-in action-row DOM, the R-003 stale-page probe. L5 only (`docs/release-checklist.md` section 2): Windows backslash paths for the folder regex, VLC / Windows playback, branded-Chrome items (R-005/R-006), the Windows Safe Browsing prompt while the UI is hidden.

Spec-sync status: R-007 (six items) is applied (`c8d95bc`) and its gaps are closed in `docs/design/system.md` section 15. The ugoira frame-zip prompt is a documented v1 limitation (CUJ-2 edge, no code change). R-008 (answered "Go with A", now in `docs/rulings.md`) is applied: the folder-check scope as an accepted §4.3 limitation, the 10 s re-check qualifier in §4.2 / CUJ-1 moved edge / AC 13, and the 200-page unpainted-instant parenthetical (`e717850`). No spec-sync item is open.

Code review (`docs/code-review.md`, iteration 5): 0 critical, 0 warnings, 3 design-doc corrections (applied), 6 info.

Other: Chrome "Ask where to save each file" may force a Save dialog per file (v1 limitation); the first repeat after upgrading from 1.0.0 can go to `(1)` if the history holds a safety-net name such as `135882741_p0 (1).jpg` (design edge, by design); pixiv DOM changes can break the action-row selector (floating fallback mitigates); R-001 requires `kyoicn/pixivhelper` to be public before Web Store submission; run the owner-only `docs/release-checklist.md` items before the 1.0.1 submission, including the two-tabs x5 item, the repeat-download item and the logged-in checks; `scripts/spike/FINDINGS.md` should still be folded into system.md section 8.2.

Release 1.0.1 (D15/D16): prepared as described under Overview. Remaining, owner-only: `git push` of `main` (denied in the preparing session) and a green CI run on the release commit, the checklist section 2/3 items, and the Chrome Web Store upload.

Eng backlog: 0 open (Next-ID ENG-015) (+1 filed / -2 closed since the previous status.md: ENG-014 filed and closed in iteration 5, ENG-013 closed by `5511f40`).
