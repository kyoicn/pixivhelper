# Project Status

> Auto-generated project status summary.
> Last updated: 2026-10-22 21:05:17 (UTC-7)

## Overview
**Helper for Pixiv** (public name per R-002; formerly the working name "pixiv Downloader") is a Chrome extension (Manifest V3, desktop Chrome 116+) that adds one Download button to every pixiv artwork page. One click saves the artwork into its own folder under Chrome's Downloads folder: originals, a `metadata.json`, and for ugoira the frame zip, `frames.json` and a video encoded in the browser. It replaces the personal terminal script `ref/pixiv-dl`.

Current phase: **dev-cycle iteration 1 implemented and QA-gated.** All five CUJs are merged on `main` (38 commits since `2bf5ac3`). QA gate verdict is **FAIL with 4 LOW findings** (CUJ-1 and CUJ-4 PASS; CUJ-2, CUJ-3, CUJ-5 FAIL on LOW items). No `docs/pm-review.md` yet, so PM is `—` for all CUJs. Nothing is fully done until the LOW items are triaged and PM reviews.

## Tech Stack

| Area | Choice |
|------|--------|
| Platform | Chrome MV3 extension, min Chrome 116, permissions frozen at 4 + 2 hosts (`src/manifest.json`, locked by `test/unit/manifest.test.ts`) |
| Language / build | TypeScript `~6.0.3` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), esbuild `^0.28.2` via `scripts/build.mjs` (`--prod`, `--e2e`, `--watch`), Node >= 22, ESM |
| Runtime deps | `mediabunny ^1.62.0` (WebCodecs mux, MPL-2.0), `fflate ^0.8.3` (zip, MIT) |
| Unit tests | vitest `^5.0.5` + happy-dom `^21.0.4`, chrome fakes in `test/fakes` |
| Lint / format | eslint `^10.13.0` + typescript-eslint `^8.72.0` (innerHTML banned outside `src/content/button/icons.ts`), prettier `^3.9.10` |
| E2E | `@playwright/test ^1.64.1` against an unpacked `dist-e2e/` extension and a fake pixiv server (`e2e/server/`, `selfsigned` TLS); QA walks in `e2e/qa/` |
| CI | `.github/workflows/ci.yml` (ENG-005) |
| Ugoira encoding | WebCodecs to MP4/H.264, WebM fallback, ZIP-only option |
| Locales | `en`, `ja`, `zh_CN`, `zh_TW` (`src/_locales/`) |

Scripts: `build`, `build:prod`, `build:e2e`, `watch`, `typecheck`, `lint`, `test`, `test:e2e`, `check` (typecheck + lint + test + build), `golden`, `qa:fake`, `qa:live`.

## Architecture
Four runtime contexts, designed in `docs/design/system.md` plus six chapter docs:
- **Content script** (`src/content/`, IIFE bundle): `pixiv-dom.ts` is the only home of pixiv selectors; `mount.ts` injects the pill into the action row (floating fallback after 3 s); `button/` holds model, labels, width, view, styles, icons, live region; `router.ts` and `api-proxy.ts` talk to the SW; `tab-memory.ts` keeps per-tab state.
- **Service worker** (`src/background/`): `sw.ts` registers listeners synchronously; `handlers.ts` validates messages and senders; `engine.ts` runs jobs; `registry.ts` persists job records (`storage.session`); `scheduler.ts` caps concurrency (5 files per artwork); `resolver.ts` resolves the folder; `downloads.ts` drives `chrome.downloads`; `dnr.ts` sets the `Referer` rule for `i.pximg.net`; `reconcile.ts` recovers jobs after SW restart; `badge.ts`, `pusher.ts`, `view.ts` project progress to badge and tabs; `offscreen-client.ts`, `tab-client.ts`, `options-tab.ts`, `caps.ts`.
- **Offscreen document** (`src/offscreen/`): command router, byte fetches (`fetch-bytes.ts`), zip retention, ugoira pipeline in `ugoira/` (`timeline.ts`, `zip.ts`, `codec.ts`, `encode.ts`); one frame in flight to bound memory.
- **Options page** (`src/options/`): full-tab settings with autosave, validation, chips, and the Saved indicator; opened from the toolbar icon (no popup).
- **Shared** (`src/shared/`): types, message catalog, `retry.ts` (4 attempts, 429/5xx/network/30 s timeout, backoff 1.5/3/6 s), `outcome.ts` classifier, `pixiv-api.ts` parsers, `pattern.ts` and `settings.ts`, `metadata.ts` (golden parity with `ref/pixiv-dl`), `i18n.ts`, `constants.ts`, `test-hooks.ts`.

## CUJ Status

Impl reflects code merged on `main`; QA is from `docs/qa-report.md` (run `iter1-20-23-42`, gate FAIL); PM is `—` because `docs/pm-review.md` does not exist yet.

| CUJ | PRD | Priority | Impl | QA | PM |
|-----|-----|----------|------|----|----|
| CUJ-1: Download an illustration or manga from the artwork page | prd-000 | P0 | merged | PASS | — |
| CUJ-2: Download an ugoira | prd-000 | P0 | merged | FAIL (LOW) | — |
| CUJ-3: Configure the extension from the toolbar icon | prd-000 | P0 | merged | FAIL (LOW) | — |
| CUJ-4: Follow several downloads at once from the toolbar badge | prd-000 | P1 | merged | PASS | — |
| CUJ-5: Recover when a download can't start or breaks | prd-000 | P0 | merged | FAIL (LOW) | — |

**Column values:**
- `Impl`: `not started` | `in progress` | `merged`
- `QA`: `PASS` | `FAIL` | `BLOCKED` | `NOT_RUN` | `WAIVED` | `UNIMPLEMENTED` | `—`
- `PM`: `Satisfied` | `Caveats` | `Not done` | `—`

A CUJ is **fully done** when Impl=`merged`, QA=`PASS`, AND PM=`Satisfied`. None are done yet. CUJ-2, CUJ-3 and CUJ-5 are treated as in progress for acceptance: their code is merged, but each carries a QA finding (see Known Issues). CUJ-1 and CUJ-4 await PM review.

QA findings per CUJ:
- CUJ-2: ugoira pill is 176 px, not the 164 px in PRD CUJ-2 step 1 and mocks (`src/content/button/width.ts:59-71`); a PRD-internal conflict with the widest-label rule of section 4.7.2, to be triaged as a spec conflict.
- CUJ-3: a stale green `Saved` shows up to 2 s beside a validation error (`src/options/page.ts:99-106`, `src/options/saved.ts:52-58`), against PRD step 5.
- CUJ-5: after the user's 4th Retry during a sustained pixiv 500/503, Chromium extension-request throttling is mapped to `network`, so the tooltip says "No connection" instead of "pixiv isn't responding" (`src/shared/retry.ts:126`, `src/shared/outcome.ts:24-33`); partly a spec gap.

Dependencies (PRD): CUJ-2 needs CUJ-1 and CUJ-3; CUJ-4 needs CUJ-1; CUJ-5 needs CUJ-1 and CUJ-2.

## Key Types & Interfaces
- `src/shared/types.ts`: `Settings` / `SettingsSnapshot` (folder pattern, `UgoiraOutput` = `mp4|webm|zip`, metadata on/off), `WorkInfo`, `Failure` / `FailureKind`, `JobMode` (`full|retryPages|retryEncode|retryMetadata`), `ErrorCause` (`offline|refused|server|disk`), `JobOutcome`, `JobProgress`, `JobView` (what the button renders), `RetryResult<T>`.
- `src/background/types.ts`: `StartRequest`, `FileRole` (`metadata|page|zip|framesJson|video`), `FileState`, `FileTask`, `UgoiraState`, `JobRecord`, `ErrorCode`.
- `src/shared/messages.ts`: typed message catalog between content, SW and offscreen.
- Output files: `metadata.json` (same fields as `ref/pixiv-dl`, parity checked by golden vectors in `test/golden/`) and `frames.json` (ugoira frame timing).

## Data Flow
Click in the content script, then `start` message to the SW. The engine snapshots settings, fetches `/ajax/illust/{id}`, then `/pages` (illustType 0/1) or `/ugoira_meta` (2), resolves the folder, writes `metadata.json`, and queues originals through `chrome.downloads` in page order (DNR sets `Referer` for `i.pximg.net`). For ugoira, the offscreen document fetches and unzips the frame zip, encodes video with WebCodecs, and returns bytes for the SW to save. Progress flows back as `JobView` pushes to the tab (throttled 250 ms) and as the toolbar badge (total files remaining across jobs, `999+` cap, coalesced 50 ms). Job records persist in `storage.session`, and `reconcile.ts` rebuilds state after a SW restart. Failures are classified by `outcome.ts` into button states (Retry, Log in to download, Unavailable).

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
├── test/             unit/, integration/, fakes/, fixtures/, golden/, helpers/ (2671 vitest tests)
├── e2e/              harness/, server/ (fake pixiv), fixtures/, qa/, live/, cuj1-5 specs
├── scripts/          build.mjs, gen-golden.py, render-icons.mjs, owner-lint.sh, spike/ (ENG-002 findings)
├── .github/workflows/ci.yml
├── docs/
│   ├── prd/          index.md, prd-000-mvp.md
│   ├── design/       system.md + 6 design-*.md chapters
│   ├── ux/           12 HTML mocks
│   ├── qa-report.md, qa-artifacts/, code-review.md, tasks.md, eng-backlog.md
│   └── owner-queue.md, rulings.md (R-001, R-002), loop-state.md
└── ref/pixiv-dl      reference terminal script
```
No `CLAUDE.md` in the project root.

## Recent Activity
38 commits since `2bf5ac3` (iteration 1 plan), in this order:
- **Group 1:** `a5c9e2a` scaffold, shared contracts, copy deck (ENG-001).
- **Group 2 (9 modules):** ugoira pipeline, metadata with golden parity (ENG-003), job registry and outcome classifier, `fetchWithRetry` and pixiv parsers, settings and pattern, SW fakes and badge, button model/view, platform spike (ENG-002), fake pixiv server and launcher (ENG-004).
- **Group 3 (4 runtime contexts):** offscreen router (`f665328`), options page (`41f507d`), content integration (`f756110`), SW download engine with scheduler, DNR and restart reconciliation (`06414e8`).
- **Group 4:** CI workflow (`f2c5472`, ENG-005), e2e specs for CUJ-3, CUJ-2, CUJ-1 and CUJ-4, i18n placeholder fix (`9481e00`).
- **TL review fixes:** `38e35eb`, `aa1499e`, `d5243e8`, `a15a74d` (shared constants); `ccffd58` iteration-1 code review (0 critical, 11 warnings, 2 info; ENG-001..005 closed, ENG-007 filed).
- **Uncommitted in working tree:** `e2e/cuj5.spec.ts` (new), edits to `e2e/cuj1.spec.ts`, `e2e/cuj4.spec.ts`, `.gitignore`, plus `docs/qa-report.md` and `docs/loop-state.md`.

Test status at QA: `npm run check` green; vitest 2671/2671; e2e 96/96 in two consecutive runs; live smoke passed 3 of 5 (flaky).

## Owner Queue
Owner queue: empty — nothing is waiting on the owner

## Known Issues & TODOs
QA LOW findings carried forward (`docs/qa-report.md`):
- `[LOW][VISUAL_DEVIATION]` CUJ-2 pill 176 px vs 164 px; spec-conflict triage needed.
- `[LOW][BUG]` CUJ-3 stale `Saved` beside a validation error.
- `[LOW][BUG]` CUJ-5 Chromium throttling reported as "No connection" during a sustained pixiv outage.
- `[LOW][FLAKY]` `e2e/live/smoke.spec.ts:115` waits for pixiv's `load` event; 2 of 5 runs timed out (product saves in 4-10 s).

Verification limits: logged-in live paths are NOT_RUN (no pixiv account): R-18 after real login, R-18 display off, pixiv dark theme. VLC/QuickTime playback rests on proxy evidence (L5 checklist). No e2e for "only metadata.json failed" and R-18G. `e2e/README.md` still lists CUJ-5 as next iteration.

Code review warnings (`docs/code-review.md`, W1-W11) to carry into design: badge title with 0 remaining, internal failure kind for unreachable offscreen, `~`/`.`-only token values drop a folder level, shared modules importing types from `src/background/types.ts` (layering), content bundle size budget, and folding additive deviations into the design docs.

Pending spec-sync (`docs/tasks.md`, system.md section 15): byte path D1 (Chrome bubble wording of PRD CUJ-1 steps 2 and 5), D8 path-safety pass vs PRD 4.4.3 "literal text as typed", derived outcome mappings and copy keys. `scripts/spike/FINDINGS.md` should be folded into system.md section 8.2.

Other: PRD 4.5.2 `Retry-After` assumption; Chrome "Ask where to save each file" may force a Save dialog per file (v1 limitation); pixiv DOM changes can break the action-row selector (floating fallback mitigates); R-001 requires the repository `kyoicn/pixivhelper` to be public before Web Store submission.

Planned: ENG-006 (store packaging, third-party notices, release checklist; before first submission) and ENG-007 (prod bundle free of test-hook code, checked in CI); then the next iteration (bug triage, PM review, spec-sync).

Eng backlog: 2 open (ENG-006, ENG-007) (+7 filed / −5 closed since the previous status.md, which had no backlog file; ENG-001..005 closed this iteration).
