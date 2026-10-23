# Project Status

> Auto-generated project status summary.
> Last updated: 2026-10-23 04:25:00 (UTC-7)

## Overview
**Helper for Pixiv** (public name per R-002) is a Chrome extension (Manifest V3, desktop Chrome 116+) that adds one Download button to every pixiv artwork page. One click saves the artwork into its own folder under Chrome's Downloads folder: originals, a `metadata.json`, and for ugoira the frame zip, `frames.json` and a video encoded in the browser. It replaces the personal terminal script `ref/pixiv-dl`.

Current phase: **dev-cycle iteration 2, Phase 5 (status refresh after the QA gate).** Iteration 2 (31 commits since `aea2be3`) amended the spec per R-003 (`Log in to download` also covers all-ages works behind pixiv's sensitive-content wall), refactored layering, and closed ENG-006..ENG-011. The QA gate verdict is **FAIL with 4 LOW findings** (CUJ-1 and CUJ-4 PASS; CUJ-2, CUJ-3, CUJ-5 FAIL on LOW items). `docs/pm-review.md` on disk is still the iteration-1 review; the iteration-2 PM review is being written, so the PM column shows `—` pending it.

## Tech Stack

| Area | Choice |
|------|--------|
| Platform | Chrome MV3 extension, min Chrome 116, permissions frozen at 4 + 2 hosts (`src/manifest.json`, locked by `test/unit/manifest.test.ts`) |
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
- **Service worker** (`src/background/`): `sw.ts` registers listeners synchronously; `handlers.ts` validates messages and senders; `engine.ts` runs jobs; `registry.ts` persists job records (`storage.session`); `scheduler.ts` caps concurrency (5 files per artwork); `resolver.ts` resolves the folder; `downloads.ts` drives `chrome.downloads`; `dnr.ts` sets the `Referer` rule for `i.pximg.net`; `reconcile.ts` recovers jobs after SW restart; `badge.ts`, `pusher.ts`, `view.ts` project progress to badge and tabs; `offscreen-client.ts`, `tab-client.ts`, `options-tab.ts`, `caps.ts`.
- **Offscreen document** (`src/offscreen/`): command router, byte fetches (`fetch-bytes.ts`), zip retention, ugoira pipeline in `ugoira/` (`timeline.ts`, `zip.ts`, `codec.ts`, `encode.ts`); one frame in flight to bound memory.
- **Options page** (`src/options/`): full-tab settings with autosave, validation, chips, and the Saved indicator; opened from the toolbar icon (no popup).
- **Shared** (`src/shared/`): types, `job.ts` (job model types, moved from `src/background/types.ts` in ENG-008; ESLint forbids shared importing background), message catalog, `retry.ts` (4 attempts, 429/5xx/network/30 s timeout, backoff 1.5/3/6 s, remembers `lastStatus`), `outcome.ts` classifier, `pixiv-api.ts` parsers, `pattern.ts` and `settings.ts`, `metadata.ts` (golden parity with `ref/pixiv-dl`), `i18n.ts`, `constants.ts`, `test-hooks.ts`.

## CUJ Status

Impl reflects code on `main`; QA is from `docs/qa-report.md` (iteration 2, run `iter2-03-48-13`, gate FAIL); PM is from `docs/pm-review.md` (iteration 2): CUJ-1, CUJ-2, CUJ-4 Satisfied; CUJ-3, CUJ-5 Caveats; 0 Not done.

| CUJ | PRD | Priority | Impl | QA | PM |
|-----|-----|----------|------|----|----|
| CUJ-1: Download an illustration or manga from the artwork page | prd-000 | P0 | not started | — | — Spec changed per R-005 (Chrome's download UI hidden during jobs); prior verification no longer applies. |
| CUJ-2: Download an ugoira | prd-000 | P0 | not started | — | — Spec changed per R-005 (Chrome's download UI hidden during jobs); prior verification no longer applies. |
| CUJ-3: Configure the extension from the toolbar icon | prd-000 | P0 | in progress (QA: pasted newlines become spaces) | FAIL (LOW) | Caveats |
| CUJ-4: Follow several downloads at once from the toolbar badge | prd-000 | P1 | not started | — | — Spec changed per R-005 (Chrome's download UI hidden during jobs); prior verification no longer applies. |
| CUJ-5: Recover when a download can't start or breaks | prd-000 | P0 | not started | — | — Spec changed per R-005 (Chrome's download UI hidden during jobs); prior verification no longer applies. |

**Column values:**
- `Impl`: `not started` | `in progress` | `merged`
- `QA`: `PASS` | `FAIL` | `BLOCKED` | `NOT_RUN` | `WAIVED` | `UNIMPLEMENTED` | `—`
- `PM`: `Satisfied` | `Caveats` | `Not done` | `—`

A CUJ is **fully done** when Impl=`merged`, QA=`PASS`, AND PM=`Satisfied`. CUJ-1 and CUJ-4 are fully done; CUJ-2, CUJ-3, CUJ-5 carry the QA findings below. The code for all five is on `main`, but a CUJ with a QA FAIL is not counted as implemented-and-verified.

QA findings per CUJ:
- CUJ-2: ugoira pill is 176 px, not the 164 px of PRD CUJ-2 step 1 and the mocks (`src/content/button/width.ts`); forced by the widest-label rule of section 4.7.2 (`Download · WebM`). Spec conflict, pm `/spec-sync` (system.md section 15 item 10); no code change requested. All 12 ACs otherwise PASS, including live all-ages ugoira walks.
- CUJ-3: a pasted pattern's line breaks become spaces instead of being dropped (`pixiv/⏎{artist}⏎-{id}` saves as `pixiv/ {artist} -{id}`); `src/options/page.ts:76` has no paste handling, and `design-options-page.md:146` wrongly assumes Chromium strips CR/LF. Pinned by the failing e2e test in `e2e/cuj3.spec.ts`. The iteration-1 stale-`Saved` bug is resolved.
- CUJ-5: (1) during a sustained pixiv 500/503, 1 of 7 Retries still reads "No connection" when Chromium throttling refuses all 4 attempts locally (`src/shared/retry.ts:58-73`, `src/shared/outcome.ts:27,35`; system.md section 15 item 6); (2) the floating fallback appears 3011-3023 ms after route entry, not within 3 s (`src/content/mount.ts:213`). The R-003 ACs (AC 4) and the rest PASS on fake and live pixiv.

Dependencies (PRD): CUJ-2 needs CUJ-1 and CUJ-3; CUJ-4 needs CUJ-1; CUJ-5 needs CUJ-1 and CUJ-2.

## Key Types & Interfaces
- `src/shared/types.ts`: `Settings` / `SettingsSnapshot` (folder pattern, `UgoiraOutput` = `mp4|webm|zip`, metadata on/off), `WorkInfo`, `Failure` / `FailureKind`, `JobMode` (`full|retryPages|retryEncode|retryMetadata`), `ErrorCause` (`offline|refused|server|disk`), `JobOutcome`, `JobProgress`, `JobView` (what the button renders), `RetryResult<T>`.
- `src/shared/job.ts` (formerly `src/background/types.ts`): `StartRequest` (now carries `loggedIn`), `FileRole` (`metadata|page|zip|framesJson|video`), `FileState`, `FileTask`, `UgoiraState`, `JobRecord`, `ErrorCode`.
- `src/shared/messages.ts`: typed message catalog between content, SW and offscreen.
- Output files: `metadata.json` (same fields as `ref/pixiv-dl`, parity checked by golden vectors in `test/golden/`) and `frames.json` (ugoira frame timing).

## Data Flow
Click in the content script, then `start` message to the SW. The engine snapshots settings, fetches `/ajax/illust/{id}`, then `/pages` (illustType 0/1) or `/ugoira_meta` (2), resolves the folder, writes `metadata.json`, and queues originals through `chrome.downloads` in page order (DNR sets `Referer` for `i.pximg.net`). For ugoira, the offscreen document fetches and unzips the frame zip, encodes video with WebCodecs, and returns bytes for the SW to save. Progress flows back as `JobView` pushes to the tab (throttled 250 ms) and as the toolbar badge (total files remaining across jobs, `999+` cap, coalesced 50 ms). Job records persist in `storage.session`, and `reconcile.ts` rebuilds state after a SW restart. Failures are classified by `outcome.ts` into button states (Retry, Log in to download, Unavailable). Per R-003, `requiresLogin`/`withheld` (`pixiv-api.ts`: `urls.original === null` or high `sl`) shows `Log in to download` for walled all-ages works before any click, and the resolver refuses to fetch pages for them.

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
├── test/             unit/, integration/, fakes/, fixtures/, golden/, helpers/ (2810 vitest tests)
├── e2e/              harness/, server/ (fake pixiv), fixtures/, qa/, live/, cuj1-5 specs
├── scripts/          build.mjs, gen-golden.py, render-icons.mjs, owner-lint.sh, size.mjs, zip.mjs, spike/ (ENG-002 findings)
├── .github/workflows/ci.yml
├── docs/
│   ├── prd/          index.md, prd-000-mvp.md
│   ├── design/       system.md + 6 design-*.md chapters
│   ├── ux/           12 HTML mocks
│   ├── qa-report.md, qa-artifacts/, code-review.md, tasks.md, eng-backlog.md
│   └── owner-queue.md, rulings.md (R-001..R-003), release-checklist.md, loop-state.md
└── ref/pixiv-dl      reference terminal script
```
No `CLAUDE.md` in the project root.

## Recent Activity
Iteration 2: 31 commits since `aea2be3` (100 files, +3698/-1252), in this order:
- **Spec and plan:** `d2449e3` spec amendment (R-003), `b224695` iteration-2 plan.
- **Group 1:** ENG-008 layering refactor (`2cdcea7`, job model types move to `src/shared/job.ts`, lint-enforced), ENG-010 content bundle size budget CI check (`329c72f`), pattern fix so lone `~`/`.` tokens resolve to `unknown` (`5ca6413`), badge idle title and counting fix (`e638132`), throttled 5xx and internal failures classified as `server` (`4f6f2e7`), options fix: clear `Saved` on validation error, AA contrast colors (`b57d694`).
- **R-003:** `fb51316` needs-login on pixiv's login walls (`requiresLogin`/`withheld` predicates, `loggedIn` on the start request).
- **Group 3:** ENG-007 prod bundles stripped of test hooks (`a484463`), ENG-006 store zip with third-party notices (`ead41d5`) and release checklist (`8f031a6`), ENG-009 fixture zips prebuilt at server start (`b71cb4c`), ENG-011 real encoder pass count on encode failures (`c5d8a5a`), live smoke rewrite (`05c5dab`), button provisional width and hint ellipsis (`9bbfb36`).
- **TL review fixes:** `fc542c9`, `6acde12`, `6ffc0a3`, `bd30155`; `0f17aca` iteration-2 code review (0 critical, 3 warnings, 3 info; ENG-006..011 removed as done).
- **Uncommitted in working tree:** QA's new tests (`e2e/cuj1.spec.ts`, `e2e/cuj3.spec.ts`, `e2e/cuj5.spec.ts`, `e2e/fixtures/works.ts`, `e2e/README.md`) plus `docs/qa-report.md`, `docs/loop-state.md`.

Test status at QA: `npm run check` green; vitest 2810/2810 (62 files); e2e 110/111 in two runs (the one failure is QA's new paste-newline test, deterministic); live smoke 4/4 in 3 consecutive runs (about 24 s each); 0 skipped, 0 flaky. Content bundle 35.2 KB minified / 13.0 KB gzip (budget 40 / 15).

## Owner Queue
Owner queue: empty — nothing is waiting on the owner

## Known Issues & TODOs
QA LOW findings (`docs/qa-report.md`, 0 critical / 0 high / 0 medium / 4 low):
1. `[LOW][BUG]` CUJ-3: pasted line breaks become spaces (`src/options/page.ts:76`; fix: strip CR/LF on `paste`/`beforeinput`, and correct `design-options-page.md:146`).
2. `[LOW][BUG]` CUJ-5: 1 of 7 Retries during a sustained 500/503 still says "No connection" (Chromium throttling; options: per-URL/host last-5xx memory in the SW, or the job-level rule in system.md section 15 item 6; verify with `diagOutage.ts`, at least 3 replays).
3. `[LOW][BUG]` CUJ-5: floating fallback lands at 3011-3023 ms (`src/content/mount.ts:213`; code-review W1; the first-route anchor alone does not fix the SPA case, or pm restates the AC as "at 3 s").
4. `[LOW][VISUAL_DEVIATION]` CUJ-2: ugoira pill 176 px vs 164 px (spec conflict; pm `/spec-sync`).
5. R-005 (hide Chrome's download UI during jobs, permission `downloads.ui`) is specified but not yet built — next dev cycle.

Resolved in iteration 2: stale `Saved` beside a validation error; live smoke flake; the outage message now correct for 6 of 7 clicks; late metadata keeps a 99-page-or-fewer work at 164 px; lone `~`/`.` tokens no longer drop a folder level.

Not verified (NOT_RUN, QA has no pixiv account; all on `docs/release-checklist.md` section 3): CUJ-5 AC 2 and AC 4 after a real login, CUJ-5 AC 8 (R-18 display off), CUJ-1 AC 15 on pixiv's live dark theme, the logged-in action-row DOM, the R-003 stale-page probe. CUJ-2 AC 8 VLC/QuickTime/Windows playback is L5 only. Automated-only (no e2e): "only `metadata.json` failed", `internal` failures, `chrome.storage.sync` unavailable. "Ask where to save each file" is L5 only.

Code review (`docs/code-review.md`, iteration 2): 3 warnings and 3 info remain, including the floating-fallback timing (W1, above), no e2e asserting the 176 px English ugoira width (a TL review fix `6acde12` added one), and cuj2 load-failure items not reproduced.

Open spec-sync items for pm (system.md section 15, 12 items): 1 Chrome bubble wording of CUJ-1 steps 2 and 5 / CUJ-4; 2 `Retry-After` assumption marker; 3 sanitization beyond PRD 4.4 (Chrome-rejected characters, reserved names); 4 singular `_one` copy; 5 derived outcome mappings and WebM fallback copy; 6 CUJ-5 step 6 detection vs Chromium throttling; 7 contrast color replacements (`#188038`, `#5f6368`, `#c5221f`, `#5c6166`); 8 action title with 0 counted files; 9 R-003 residuals (a)-(d); 10 section 4.7.2 provisional width and 176 px ugoira pill; 11 keyboard order (Tab reaches the button after Like); 12 unclosed `{` as literal text. `scripts/spike/FINDINGS.md` should still be folded into system.md section 8.2.

Other: Chrome "Ask where to save each file" may force a Save dialog per file (v1 limitation); pixiv DOM changes can break the action-row selector (floating fallback mitigates); pixiv could change how it hides walled works (`sl` fallback and live smoke mitigate); R-001 requires the repository `kyoicn/pixivhelper` to be public before Web Store submission; run `docs/release-checklist.md` (macOS and Windows branded Chrome) before submission.

Eng backlog: 0 open (Next-ID ENG-012) (+4 filed / -6 closed since the previous status.md: ENG-008..011 filed during iteration-2 planning; ENG-006..011 closed this iteration).
