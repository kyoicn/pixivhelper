# Project Status

> Auto-generated project status summary.
> Last updated: 2026-10-23 21:09:00 (UTC-7)

## Overview
**Helper for Pixiv** (public name per R-002) is a Chrome extension (Manifest V3, desktop Chrome 116+) that adds one Download button to every pixiv artwork page. One click saves the artwork into its own folder under Chrome's Downloads folder: originals, a `metadata.json`, and for ugoira the frame zip, `frames.json` and a video encoded in the browser. It replaces the personal terminal script `ref/pixiv-dl`.

Current phase: **dev-cycle iteration 3, retry 1, Phase 5 (status refresh after the QA re-verification).** Iteration 3 (25 commits since `e2ab417`, 75 files, +6195/-1132) applied the R-004 spec-sync batch (S1-S15) and added R-005 (hide Chrome's download UI during jobs, permission `downloads.ui`) and R-006 (Chrome's downloads button returns with the job's last file). It built the job-level outage rule, the download-UI toggle, options paste handling, and the floating timer plus the 176 px ugoira pill. The QA gate (retry 1, run `iter3-19-38-54`, `main` at `68c35d7`) is **FAIL with 1 LOW**: CUJ-2, CUJ-3, CUJ-5 PASS; CUJ-1 and CUJ-4 FAIL on the same LOW. The iteration-3 MEDIUM (Chrome's downloads button does not come back) and all four iteration-2 LOWs are resolved. The iteration-3 PM review (`docs/pm-review.md`) rates CUJ-2, CUJ-3, CUJ-5 Satisfied and CUJ-1, CUJ-4 Caveats, with 0 Not done.

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
- **Service worker** (`src/background/`): `sw.ts` registers listeners synchronously; `handlers.ts` validates messages and senders; `engine.ts` runs jobs; `registry.ts` persists job records (`storage.session`); `scheduler.ts` caps concurrency (5 files per artwork); `resolver.ts` resolves the folder; `downloads.ts` drives `chrome.downloads`; `download-ui.ts` toggles Chrome's download UI via `setUiOptions` (hide at the first hand-off, restore just before the busy period's last hand-off, re-enable on SW boot when idle); `dnr.ts` sets the `Referer` rule for `i.pximg.net`; `reconcile.ts` recovers jobs after SW restart; `badge.ts`, `pusher.ts`, `view.ts` project progress to badge and tabs; `offscreen-client.ts`, `tab-client.ts`, `options-tab.ts`, `caps.ts`.
- **Offscreen document** (`src/offscreen/`): command router, byte fetches (`fetch-bytes.ts`), zip retention, ugoira pipeline in `ugoira/` (`timeline.ts`, `zip.ts`, `codec.ts`, `encode.ts`); one frame in flight to bound memory.
- **Options page** (`src/options/`): full-tab settings with autosave, validation, chips, and the Saved indicator; opened from the toolbar icon (no popup).
- **Shared** (`src/shared/`): types, `job.ts` (job model types, moved from `src/background/types.ts` in ENG-008; ESLint forbids shared importing background), message catalog, `retry.ts` (4 attempts, 429/5xx/network/30 s timeout, backoff 1.5/3/6 s, remembers `lastStatus`), `outcome.ts` classifier, `pixiv-api.ts` parsers, `pattern.ts` and `settings.ts`, `metadata.ts` (golden parity with `ref/pixiv-dl`), `i18n.ts`, `constants.ts`, `test-hooks.ts`.

## CUJ Status

Impl reflects code on `main`; QA is from `docs/qa-report.md` (iteration 3 retry 1, run `iter3-19-38-54`, gate FAIL); PM is from `docs/pm-review.md` (iteration 3): CUJ-2, CUJ-3, CUJ-5 Satisfied; CUJ-1, CUJ-4 Caveats; 0 Not done.

| CUJ | PRD | Priority | Impl | QA | PM |
|-----|-----|----------|------|----|----|
| CUJ-1: Download an illustration or manga from the artwork page | prd-000 | P0 | in progress (LOW: bubble misses the last file) | FAIL (LOW) | Caveats |
| CUJ-2: Download an ugoira | prd-000 | P0 | merged | PASS | Satisfied |
| CUJ-3: Configure the extension from the toolbar icon | prd-000 | P0 | merged | PASS | Satisfied |
| CUJ-4: Follow several downloads at once from the toolbar badge | prd-000 | P1 | in progress (same LOW) | FAIL (LOW) | Caveats |
| CUJ-5: Recover when a download can't start or breaks | prd-000 | P0 | merged | PASS | Satisfied |

**Column values:**
- `Impl`: `not started` | `in progress` | `merged`
- `QA`: `PASS` | `FAIL` | `BLOCKED` | `NOT_RUN` | `WAIVED` | `UNIMPLEMENTED` | `—`
- `PM`: `Satisfied` | `Caveats` | `Not done` | `—`

A CUJ is **fully done** when Impl=`merged`, QA=`PASS`, AND PM=`Satisfied`. No CUJ is fully done yet: CUJ-2, CUJ-3, CUJ-5 await the iteration-3 PM verdict; CUJ-1 and CUJ-4 carry the LOW below.

QA findings per CUJ:
- CUJ-1 (AC 14) and CUJ-4 (edge "its bubble lists the files of both jobs"): when a job's last files land together, Chrome's bubble can open just before the final hand-off and list every file except the last (e.g. `metadata.json` and p0-p10 without p11). `src/background/engine.ts:210-240` (`targetsKnown`) and `:278-288` (last-hand-off path) wait for earlier files to be named, not completed. Frequency: store zip on fake pixiv 5 of 8 runs; e2e build 3 of 6; two concurrent jobs 3 of 4; never when the last file lands alone (8 of 8) and never on live pixiv (6 of 6). The single animation, the returned button, files on disk and `chrome://downloads` are correct.
- CUJ-2: PASS (step 5: one animation with the video; bubble lists all 4 files, fake x2 and live x2). The 176 px pill is now spec (R-004 S10).
- CUJ-3: PASS (full walk and @cuj3 e2e green; pasted line breaks are dropped, an unclosed `{` is invalid).
- CUJ-5: PASS (step 4 silent end matches the amended step and `cuj-5-retry.html`; sustained outage reads per click from whether pixiv answered; floating fallback within 3 s).

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
├── test/             unit/, integration/, fakes/, fixtures/, golden/, helpers/ (3065 vitest tests)
├── e2e/              harness/, server/ (fake pixiv), fixtures/, qa/, live/, cuj1-5 specs
├── scripts/          build.mjs, gen-golden.py, render-icons.mjs, owner-lint.sh, size.mjs, zip.mjs, spike/ (ENG-002 findings)
├── .github/workflows/ci.yml
├── docs/
│   ├── prd/          index.md, prd-000-mvp.md
│   ├── design/       system.md + 6 design-*.md chapters
│   ├── ux/           12 HTML mocks
│   ├── qa-report.md, qa-artifacts/, code-review.md, tasks.md, eng-backlog.md
│   └── owner-queue.md, rulings.md (R-001..R-006), release-checklist.md, loop-state.md
└── ref/pixiv-dl      reference terminal script
```
No `CLAUDE.md` in the project root.

## Recent Activity
Iteration 3: 25 commits since `e2ab417` (75 files, +6195/-1132), in this order:
- **Spec and plan:** `053621c` R-004 spec-sync S1-S15 applied to prd-000 and mocks, `c7b0595` R-005 (hide Chrome's download UI), `91749c2` iteration-3 plan (layering-free).
- **Four parallel fixes (merged `82cc3da`, `7ae0d0b`, `3cef87b`):** job-level outage rule `b9c371c` and its 7-click e2e `39ba255` (CUJ-5, S3); download-UI toggle `3c86407` (R-005, `downloads.ui`, `src/background/download-ui.ts`) with e2e `7b7fa4b` and release checklist `886bd88`; options paste/S5/S15 `b97c94b`; floating fallback inside 3 s `8560828` and the 176 px ugoira pill `17b5570`.
- **TL review:** `fbe4066` (recording kept out of the shipped `download-ui` module), `7f5960c` (design docs), `e066f27` code review (0 critical, 0 warnings, 3 info).
- **QA gate additions:** `0d28f3f` 14 e2e cases including headed-only toolbar checks.
- **Retry 1 (R-006):** `d31880b` spec, `02b4ecf` plan (D12 rev 2), `ed7a579` fake `deferNaming`, `6c184ac` engine restores Chrome's UI before the last hand-off, `0a2da83` e2e pins the restore point, `68c35d7` release checklist, `d8a45a0` code-review addendum (0 critical, 1 warning, 7 info).
- **Uncommitted in working tree:** `docs/qa-report.md`, `docs/loop-state.md`, `e2e/cuj1.spec.ts`.

Test status at QA: `npm run check` green; vitest 3065/3065 (67 files); e2e headless (gate command) 143 passed / 4 skipped (the 4 headed-only Chrome toolbar tests); headed toolbar 4/4; live smoke 4/4 twice (~24 s); 0 flaky. Content bundle 35.3 KB minified / 13.1 KB gzip (budget 40 / 15). Total 3216 tests.

## Owner Queue
Owner queue: empty — nothing is waiting on the owner

## Known Issues & TODOs
QA (`docs/qa-report.md`, 0 critical / 0 high / 0 medium / 1 low):
1. `[LOW][BUG]` CUJ-1 AC 14 and CUJ-4 edge: Chrome's bubble omits the last file when the last files land together (`src/background/engine.ts:210-240` `targetsKnown`, `:278-288` last-hand-off path; fix direction: wait for earlier files to complete, not only to be named, before restoring).

Resolved this iteration: Chrome's downloads button not returning after a job (MEDIUM, R-006); pasted line breaks; "No connection" during a sustained outage (now per click); floating fallback at 3011-3023 ms; 176 px ugoira conflict (spec per R-004).

Not verified (NOT_RUN, QA has no pixiv account; `docs/release-checklist.md` section 3): CUJ-5 AC 2 and AC 4 after a real login, CUJ-5 AC 9 live, CUJ-1 AC 16 on pixiv's live dark theme, the logged-in action-row DOM, the R-003 stale-page probe. L5 only: VLC / QuickTime / Windows playback; the R-005/R-006 branded-Chrome checklist item; the Windows Safe Browsing prompt while the UI is hidden.

Open pm spec gaps (system.md section 15, from tl):
- gap 1: Chrome may show a decision prompt (e.g. for the ugoira zip) while its download UI is hidden (R-005).
- gap 2: options footer links at 2.91:1 contrast.
- PRD §4.1 #3 wording: "needed login after a mid-job 403" reads as always silent, but a 403 with other originals in flight ends with a final hand-off and one animation (QA judged PASS against the rule's definition).

Code review (`docs/code-review.md`, iteration 3 + retry-1 addendum): 1 warning, W1 (test strength): neither "last two together" unit test fails when the claim `decided.set` is moved after the UI call; fix by adding the held-hide "last two together" unit test. 7 info items; earlier info: `isFailure` accepts `answered: true` on any kind, one `setUiOptions` call per idle SW wake, `finalize` awaits `restore()` before `scheduleClose()`.

Other: Chrome "Ask where to save each file" may force a Save dialog per file (v1 limitation); pixiv DOM changes can break the action-row selector (floating fallback mitigates); R-001 requires `kyoicn/pixivhelper` to be public before Web Store submission; run `docs/release-checklist.md` (macOS and Windows branded Chrome) before submission; `scripts/spike/FINDINGS.md` should still be folded into system.md section 8.2.

Eng backlog: 0 open (Next-ID ENG-012) (+0 filed / -0 closed since the previous status.md; the backlog stayed empty through iteration 3).
