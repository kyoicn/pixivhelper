# Project Status

> Auto-generated project status summary.
> Last updated: 2026-10-27 20:19:24 (UTC-7)

## Overview
**Helper for Pixiv** (public name per R-002) is a Chrome extension (Manifest V3, desktop Chrome 116+) that adds one Download button to every pixiv artwork page. One click saves the artwork into its own folder under Chrome's Downloads folder: originals, a `metadata.json`, and for ugoira the frame zip, `frames.json` and a video encoded in the browser. It replaces the personal terminal script `ref/pixiv-dl`.

Current phase: **dev-cycle iteration 4, Phase 5 (status refresh after the QA gate).** Iteration 4 started from the iteration-3 LOW "bubble misses the last file", fixed between cycles by quick-fix `c2c9de0` (the last hand-off now waits for earlier files to finish, D12 rev. 3), then added ENG-012 test pins and a comment fix. The QA gate (run `iter4-22-53-54`) is **FAIL with 2 LOW**: CUJ-2, CUJ-3, CUJ-5 PASS; CUJ-1 fails on both LOWs and CUJ-4 on LOW #1. The iteration-3 LOW is RESOLVED. The iteration-4 PM review (`docs/pm-review.md`) rates CUJ-2, CUJ-3, CUJ-5 Satisfied and CUJ-1, CUJ-4 Caveats (held for the offscreen creation race only), with 0 Not done.

Release: 1.0.0 is live on the Chrome Web Store since 2026-10-27 (https://chromewebstore.google.com/detail/helper-for-pixiv/acodafjaeeanbgobjgpjknnehibaednb); CUJ-1 was refined after release (repeat downloads of the same artwork go to a sibling folder `<folder> (1)` chosen via Chrome's download history; Issue 2026-10-27-19-58-31), so its Impl/QA/PM are reset below.

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

Impl reflects code on `main`; QA is from `docs/qa-report.md` (iteration 4, run `iter4-22-53-54`, gate FAIL); PM is from `docs/pm-review.md` (iteration 4): CUJ-2, CUJ-3, CUJ-5 Satisfied; CUJ-1, CUJ-4 Caveats (held for the offscreen creation race only); 0 Not done.

| CUJ | PRD | Priority | Impl | QA | PM |
|-----|-----|----------|------|----|----|
| CUJ-1: Download an illustration or manga from the artwork page | prd-000 | P0 | not started | — | — |
| CUJ-2: Download an ugoira | prd-000 | P0 | merged | PASS | Satisfied |
| CUJ-3: Configure the extension from the toolbar icon | prd-000 | P0 | merged | PASS | Satisfied |
| CUJ-4: Follow several downloads at once from the toolbar badge | prd-000 | P1 | in progress (LOW #1) | FAIL (LOW #1) | Caveats |
| CUJ-5: Recover when a download can't start or breaks | prd-000 | P0 | merged | PASS | Satisfied |

**Column values:**
- `Impl`: `not started` | `in progress` | `merged`
- `QA`: `PASS` | `FAIL` | `BLOCKED` | `NOT_RUN` | `WAIVED` | `UNIMPLEMENTED` | `—`
- `PM`: `Satisfied` | `Caveats` | `Not done` | `—`

A CUJ is **fully done** when Impl=`merged`, QA=`PASS`, AND PM=`Satisfied`. CUJ-2, CUJ-3 and CUJ-5 are fully done; CUJ-1 and CUJ-4 carry the LOWs below.

QA findings per CUJ:
- CUJ-1: FAIL on LOW #1 (offscreen-creation race, below) and LOW #2 (counter residual, below). The iteration-3 LOW (AC 14 bubble misses the last file) is resolved by `c2c9de0`.
- CUJ-2: PASS.
- CUJ-3: PASS.
- CUJ-4: FAIL on LOW #1 only (two jobs started within ~10 ms).
- CUJ-5: PASS.

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
├── test/             unit/, integration/, fakes/, fixtures/, golden/, helpers/ (3066 vitest tests)
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
Iteration 4 (`git log a8dd551..HEAD`, 5 commits):
- `c2c9de0` quick-fix: wait for earlier files to finish before restoring Chrome's download UI (D12 rev. 3: `othersSettled()` in `src/background/engine.ts`, `HANDOFF_SETTLE_WAIT_MS = 2000`, fake `settledWhileShown`, held-hide unit test). Resolves the iteration-3 LOW and code-review W1 of iteration 3.
- `a2e8897` docs(cycle): iteration 4 plan.
- `a9d9212` test(e2e): pin the N-1 / N counter ACs and align AC mappings (ENG-012); `0ce05cd` constants comment says finished, not named (ENG-012).
- `913a95f` docs(review): iteration 4 code review (0 critical, 1 warning, 6 info); ENG-012 removed as done, ENG-013 filed.
- **Uncommitted in working tree:** `docs/loop-state.md`, `docs/qa-report.md`, `e2e/README.md`, `e2e/cuj1.spec.ts`, `e2e/cuj4.spec.ts`.

Test status at QA: vitest 3066 tests; e2e 146 passed / 6 headed-only skipped; headed 6/6; live smoke 4/4 twice.

## Owner Queue
Owner queue: 1 open (R-007, spec-sync batch of 6, since 2026-10-24) → docs/owner-queue.md

## Known Issues & TODOs
QA (`docs/qa-report.md`, iteration 4: 0 critical / 0 high / 0 medium / 2 low):
1. `[LOW][BUG]` CUJ-1 and CUJ-4, offscreen-document creation race: when two jobs start within ~10 ms, the second job's `metadata.json` and first pages fail with 0 attempts; the tooltip "Retry · N failed" is misleading, and `metadata.json` is silently missing after the retry. `src/background/offscreen-client.ts:26-45,76-87` and `src/background/engine.ts:180-200`. Reproduced 14/16 at 5-11 ms gap, 0/36 at >= 50 ms.
2. `[LOW][BUG]` CUJ-1: the pages counter shows `N / N` in the DOM for 0-2 ms before `Saved` (two-job and 200-page cases). `src/background/engine.ts:123-131,149-150`, `src/background/pusher.ts:38-42`.

Resolved this iteration: the iteration-3 LOW "bubble misses the last file" (CUJ-1 AC 14, CUJ-4 edge), fixed by `c2c9de0`.

Not verified (NOT_RUN, QA has no pixiv account; `docs/release-checklist.md` section 3): CUJ-5 AC 2 and AC 4 after a real login, CUJ-5 AC 9 live, CUJ-1 AC 16 on pixiv's live dark theme, the logged-in action-row DOM, the R-003 stale-page probe. L5 only: VLC / QuickTime / Windows playback; the R-005/R-006 branded-Chrome checklist item; the Windows Safe Browsing prompt while the UI is hidden.

Open pm spec-sync items:
- `docs/design/system.md` section 15 gap 1: Chrome may show a decision prompt (e.g. for the ugoira zip) while its download UI is hidden (R-005).
- gap 2: options footer links at 2.91:1 contrast.
- gap 3: PRD section 4.1 #3 wording, "needed login after a mid-job 403" reads as always silent, but a 403 with other originals in flight ends with a final hand-off and one animation.
- Spec conflict: `docs/prd/prd-000-mvp.md` ~line 317, CUJ-1 edge still says "0 / 200 ... 200 / 200", while the shipped and pinned behavior is the N-1 / N counter.
- Counter-residual wording (LOW #2): the spec needs to say whether `N / N` may flash before `Saved`.

Code review (`docs/code-review.md`, iteration 4): 0 critical, 1 warning, 6 info. W1 is filed as ENG-013; the earlier W1 (decide+claim not pinned) is closed by `c2c9de0`'s held-hide test.

Other: Chrome "Ask where to save each file" may force a Save dialog per file (v1 limitation); pixiv DOM changes can break the action-row selector (floating fallback mitigates); R-001 requires `kyoicn/pixivhelper` to be public before Web Store submission; run `docs/release-checklist.md` (macOS and Windows branded Chrome) before submission; `scripts/spike/FINDINGS.md` should still be folded into system.md section 8.2.

Eng backlog: 1 open (ENG-013, P2, test-only: pin the `othersSettled()` `downloads.search` fallback and cross-job ids in unit tests; Next-ID ENG-014) (+1 filed / -1 closed since the previous status.md: ENG-012 filed and closed within iteration 4, ENG-013 filed from the code review).

