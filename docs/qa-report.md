# QA Report

Last updated: 2026-10-23 21:03:22 (UTC-7)
Scope: all active PRDs (prd-000, CUJ-1 … CUJ-5), as amended by R-004, R-005 and R-006 (`d31880b`). Iteration 3, **retry loop 1** (re-verification), run-id `iter3-19-38-54`, `main` at `68c35d7`. Previous report for this iteration: run `iter3-17-37-06` (FAIL, 1 MEDIUM).

## Verdict: FAIL

1 bug: 0 CRITICAL / 0 HIGH / 0 MEDIUM / **1 LOW**.

The iteration's MEDIUM ("Chrome's downloads button does not come back after a job") is **resolved in retry 1** (evidence below). Chrome's button now returns exactly once, with the job's last file, in every busy period that has a final hand-off. Ends without a final hand-off (cancel, `Retry · 3 failed`, needs login, Unavailable) stay silent, and the next download brings the button back.

The new LOW is `[LOW][BUG]`: when a job's last files land together, Chrome's bubble can pop open just before the last file is handed over. It then lists every file **except the last one**, for example `metadata.json` and p0–p10 without p11. Frequency:
- the store zip on the fake pixiv, no page held back: 5 of 8 runs;
- the e2e build: 3 of 6;
- two concurrent jobs: 3 of 4;
- never when the last file lands on its own (8 of 8), and never on live pixiv (6 of 6).

This breaks CUJ-1 AC 14 ("… after which the bubble lists `metadata.json` and the 12 originals") and the CUJ-4 edge ("its bubble lists the files of both jobs") intermittently. The single animation, the returned button, the files on disk and `chrome://downloads` are all correct.

CUJ results:

| CUJ | Result | Why |
|---|---|---|
| CUJ-1 | FAIL | `[LOW][BUG]`: AC 14, bubble misses the last file when the last files land together (intermittent) |
| CUJ-2 | PASS | step 5: one animation with the video; the bubble lists all 4 files (fake ×2, live ×2) |
| CUJ-3 | PASS | spot-check: full walk and all @cuj3 e2e green; no code change in its path |
| CUJ-4 | FAIL | the same `[LOW][BUG]`: two jobs, the bubble misses the last file (3 of 4 walks) |
| CUJ-5 | PASS | step 4 silent end matches the amended step and `cuj-5-retry.html`; retry, 403, Unavailable as specified |

- No CUJ is BLOCKED or UNIMPLEMENTED. No walk step stayed NOT_RUN.
- Still NOT_RUN, because QA has no pixiv account (unchanged, `docs/release-checklist.md` §3): CUJ-5 AC 2 / AC 4 after a real login; CUJ-5 AC 9 live; CUJ-1 AC 16 live dark theme.
- L5 only: VLC / Windows playback; the R-005/R-006 checklist item on branded Chrome; the Windows Safe Browsing prompt while the UI is hidden (pm spec gap 1).

## Resolved in retry 1

### `[MEDIUM][BUG]` "after the job ends Chrome's downloads button does not come back": resolved

The fix (`6c184ac`) restores the UI just before the busy period's last hand-off (R-006, D12 rev 2). Evidence, all in headed Chrome for Testing 156.0.8078.4.

**1. The red pin is green.** `e2e/cuj1.spec.ts` "toolbar: back after Saved" failed 3 of 3 times in `iter3-17-37-06` (`Received: null`). It now passes headed in both gate runs (`logs/e2e-toolbar-headed-{1,2}.log`).

**2. Chrome's own toolbar model, sampled every 4–9 ms.** `chrome://accessibility` → Chrome Native UI, read through the page's own `requestNativeUITree` message (`walk-scripts/nativePoll.ts`), 500–2600 samples per walk.
- 26 busy periods with a final hand-off were walked (fake run1 + run2, store zip, live pixiv).
- In every one:
  - no downloads button and no bubble from the click (or from the period's hide) until the restore;
  - Chrome's button (or its bubble) appears **exactly once**, 1–20 ms after the restore. Usually that is about 10 ms after the last file was created. In the runs hit by the LOW race it comes 13–56 ms *before* the last file's creation, triggered by an earlier file completing after the enable;
  - the button stays in the toolbar after the end (`New download available`).
- In the canonical CUJ-1 repro (p11 last), the bubble opens with that animation and lists, in Chrome's order: `135882741_p11.jpg`, p10, …, p0, `metadata.json`. That is 13 rows, in both runs.

**3. Order, against Chrome's own download records.** QA's spies run in the live SW: `chrome.downloads.setUiOptions` is wrapped and still calls the real API, and `onCreated`/`onChanged` are recorded. In every final period:
- the hide settled at or before the first item's creation;
- every other item's Chrome `startTime` ≤ the restore's issue time;
- every other item had its target named by Chrome before the restore settled;
- exactly one item (the last) was created after the restore settled: +0 … +14 ms after the restore, and +42 … +58 ms in the two-job runs that the LOW race delayed.

**4. The shipped build behaves the same.** Store zip (`npm run zip`, unzipped into an empty directory), on the fake pixiv (8 runs) and live pixiv (6 runs: 151102843 ×2, 151090410 ×2, ugoira 151105084 ×2): real calls `off,on`, the same ordering, one appearance.

| Busy period (each ×2 unless noted) | Final hand-off | Chrome |
|---|---|---|
| CUJ-1 12 pages, p11 last | `135882741_p11.jpg` | one appearance (+11/+12 ms); bubble 13 rows |
| CUJ-1 step 8 re-download, all files land together | `135882741_p11 (1).jpg` | the first hand-off takes the button away (29–30 ms after the hide), then one appearance (+13 / +11 ms) |
| CUJ-1 user's own download mid-job | p11 | nothing during the job; one appearance; bubble 14 rows incl. `users-own-download.txt` |
| Single image + metadata | the image | `off,on`; one appearance with the image; bubble `135882742_p0.jpg`, `metadata.json` |
| Single image, metadata off | the image | **no `setUiOptions` call**; one appearance 22–24 ms after the image was created; as before R-005 |
| CUJ-2 ugoira MP4 | `136004512.mp4` | hidden through the held zip fetch and the encode; one appearance; bubble 4 rows |
| CUJ-2 ZIP only | `frames.json` | one appearance; bubble 3 rows |
| CUJ-4 two jobs, B ends first / A ends first (×4) | the last job's last page | the first job to end: no animation, `requested=false`; one appearance in total |
| CUJ-4 worker stopped mid-job | p11 | new instance: no call at boot, `off` at its first hand-off, `on` before p11; one appearance; ends `requested=true` |
| CUJ-5 retry of 3 pages | p11 | the retry's first hand-off takes the button away; one appearance (+4 / +1 ms; in run2 it was triggered by p9 completing after the enable, 13 ms before p11 was created) |
| Live 3P / 6P / ugoira (store zip) | last page / `.mp4` | one appearance (+4 … +20 ms); bubble lists all files |

**Ends without a final hand-off** (each ×2, fake): cancel at 5/12, `Retry · 3 failed`, a 403 on the last page fetched (`403-last`), Unavailable.
- From the click until 3 s after the end, 900–1130 samples: no button and no bubble at any sample.
- The UI is left on (`requested=true`). Calls are `off,on` with the restore after every file finished, or no call at all for Unavailable.
- The next download brings the button back 24–53 ms after it starts. Its bubble lists that file plus the job's landed files: e.g. after the cancel, `cancel-next-download.txt`, p4…p0, `metadata.json`.

## Automated Test Summary
- **Total tests:** 3216 = 3065 vitest + 147 e2e + 4 live smoke.
  - Pre-existing: 3211 (3065 + 142 + 4).
  - New: 5 e2e (3 headless, 2 headed-only).
- **Passing:** 3216 at the final runs.
  - vitest: 3065/3065 (67 files) in both `npm run check` runs. Typecheck, eslint, prettier (incl. the new e2e code) and build are green (`logs/check-{1,2}.log`).
  - e2e headless, the gate command (`HFP_HEADLESS=1 npm run test:e2e`):
    - before the new tests: 140 passed, 2 skipped (1.5 min, `e2e-1.log`);
    - with them: **143 passed, 4 skipped** (1.5 min, `e2e-2.log`).
  - e2e headed toolbar (`HFP_HEADLESS=0 … -g "toolbar"`): 2/2 before the new tests (`e2e-toolbar-headed-1.log`), **4/4** with them (`e2e-toolbar-headed-2.log`).
  - live smoke `HFP_LIVE=1 … --grep @live`: 4/4, twice (24.5 s, 23.4 s; `live-{1,2}.log`).
- **Failing:** 0.
- **Skipped:** 4 in headless runs, all with the reason "this Chromium shows no download UI at all (headless): run with HFP_HEADLESS=0". They are the 4 "Chrome toolbar" tests, all green headed.
- **Flaky** (failed, then passed on framework retry): 0.
  - New headless tests: 30/30 with `--repeat-each=10`, plus 15/15 at ×5.
  - New headed tests: 6/6 at ×3.
  - The 3 headless tests also pass headed: 9/9 at ×3.
- **Bundle size:** `npm run size`: 35.3 KB minified / 13.1 KB gzip (budget 40 / 15), unchanged.

## Mock Coverage Summary
- **CUJs with mocks compared:** 5. All 12 mocks under `docs/ux/prd-000-mvp-mockups/` were rendered again to `docs/qa-artifacts/iter3-19-38-54/mocks/`, with pill crops in `*-row0.png`.
- **CUJs without mocks (`NO_MOCK`):** 0.
- **Changed since the last run:** `cuj-5-retry.html` (R-006). Chrome's downloads button was removed from its toolbar; the extension icon has no badge.
  - The live end of `Retry · 3 failed` matches, in both runs:
    - the native tree has no downloads button;
    - the pill (`cuj-5/run1/04-retry-3-failed-row.png`) matches `mocks/cuj-5-retry-row0.png`.
- **`cuj-1-saved.html`**, whose toolbar shows "Chrome keeps its downloads button in the toolbar", **now matches**. After `Saved · 12P` the native tree has `PinnedActionToolbarButton "New download available"`, and the pill (`cuj-1/run1/06-saved-row.png`) matches `mocks/cuj-1-saved-row0.png`.
- **Placeholder regions:** none.

## How the product was driven
- **Fake pixiv (L3 harness).** Chrome for Testing 156.0.8078.4 launched by `e2e/harness/launch.ts`, with the real unpacked `dist-e2e/` (or the store zip), against `e2e/server/`.
  - **R-006 walks** (`walk-scripts/r006.ts`): headed, a fresh browser and profile per scenario, run1 and run2.
  - **CUJ-1 / CUJ-4 / CUJ-5 end-to-end re-walks** (`cuj1.ts`, `cuj4.ts`, `cuj5.ts`; headless, run1): their R-005 ordering checks were replaced by R-006 ones (`common.ts` `r006Ordering`/`r006Check`).
  - **CUJ-3 spot-check:** `cuj3.ts`, run1.
- **Chrome's toolbar.**
  - Previously read through `chrome://accessibility` button clicks about once a second. Now read through the page's own WebUI message in a tight loop (`nativePoll.ts`), so a transient appearance between two files cannot fall between reads.
  - The native tree has no node for the fly-in animation itself, and Chrome's histograms record nothing per animation (checked: `probe/hist2-*.txt`). So an "animation" is evidenced two ways:
    - the downloads button going from absent to present: after a hide, Chrome shows it only for a download whose target it determines with the UI on;
    - Chrome's own ordering: every other file named before the restore, exactly one file created after it.
- **Store artifact.** `npm run zip` → `helper-for-pixiv-1.0.0.zip`: 17 files, 183.1 KB, sha256 `d33f6f4b…ad447`. Unzipped into an empty scratch directory and loaded as the extension, for the fake race probe and all live walks.
- **Live pixiv, logged out** (`r006live.ts`, headed, store zip): 151102843 (3P), 151090410 (6P, picked from the manga ranking), ugoira 151105084. Each twice.
- **Walk scripts:** `docs/qa-artifacts/iter3-19-38-54/walk-scripts/`.
  - Per-walk results: `<cuj>/<run>/r006-<scenario>-walk.json`.
  - Native trees, transitions and SW spy dumps: `<cuj>/<run>/r006-<scenario>-native/`.
  - Summaries: `r006-summary-*.json`.

## Per-CUJ Verification

### CUJ-1: Download an illustration or manga from the artwork page — FAIL

ACs 1–13 and 15–17 have their own code untouched by this retry: the src diff `e066f27..68c35d7` touches only `src/background/{download-ui,engine,scheduler}.ts` and `src/shared/constants.ts`. They were re-walked end to end (run1, `cuj1.ts`: main, cancel, edge and late-metadata sections, 57 checks, 0 failed) and stay green in the e2e suite. Their run2 column is carried from `iter3-17-37-06`.

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | One button, immediately left of Like, ≤ 500 ms after the row | both (+live) | PASS | PASS (carried) | PASS |
| 2 | `Download · 12P` / `Download` (single page) | both | PASS | PASS (carried) | PASS |
| 3 | 164 px in every state; never changes | both | PASS | PASS (carried) | PASS |
| 4 | `metadata.json` + `135882741_p0…p11`; sizes = Content-Length | both (+live) | PASS (sha256 = served bytes, ×2 in `r006-twelve`) | PASS | PASS |
| 5 | `metadata.json`: 12 keys in order, literal non-ASCII, `\n` kept | both (+live) | PASS | PASS (carried) | PASS |
| 6 | ≤ 5 of this artwork's files in flight | both | PASS | PASS (carried) | PASS |
| 7 | `N / 12` rises; `12 / 12` only at the end | both | PASS | PASS (carried) | PASS |
| 8 | Cancel face; cancel stops; files stay; idle, no error style | both | PASS | PASS | PASS |
| 9 | `Saved · 12P` style; tooltip | both | PASS | PASS | PASS |
| 10 | SPA away/back keeps Saved; reload shows idle | both | PASS | PASS (carried) | PASS |
| 11 | Clicking Saved re-downloads as ` (1)` duplicates | both | PASS (26 files) | PASS | PASS |
| 12 | Closing the tab does not stop the job | both | PASS | PASS (carried) | PASS |
| 13 | Badge = pages not yet complete; gone at the end | both | PASS | PASS | PASS |
| 14a | (R-006) No bubble or animation for the first 12 files | both (native tree, headed; new e2e "toolbar: one animation") | PASS | PASS | PASS |
| 14b | (R-006) Exactly one animation, with the last file | both (native tree + Chrome order; new e2e) | PASS | PASS | PASS |
| 14c | (R-006) … after which the bubble lists `metadata.json` and the 12 originals | both (native tree, headed) | PASS with p11 landing last; FAIL in 3/6 (e2e build) and 5/8 (store zip) runs when the last files land together | PASS with p11 last | FAIL (`[LOW][BUG]`) |
| 15 | Tab / Enter / Space; focus ring; `aria-busy` | both | PASS | PASS (carried) | PASS |
| 16 | Dark theme identical | both (fake only) | PASS | PASS (carried) | PASS (live NOT_RUN: login) |
| 17 | Pattern changed mid-job keeps the job's folder | automated | PASS | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Step 2 (R-006): hidden from `metadata.json` on | no button / bubble; the UI is off before the first file reaches Chrome | hide settled at or before `metadata.json`'s creation; 0 visible samples up to `11 / 12` with p11 held (12 items in Chrome, `requested=false`) | same | PASS |
| Step 5 cancel (R-006) | no animation; the button stays out until the next download | `off,on`, restore after the last landed file, 0 items after it; 0 visible samples from the click until 3 s after the end; next download: button +27 ms, bubble `cancel-next-download.txt`, p4…p0, `metadata.json` | same (+24 ms) | PASS |
| Step 6 (R-006): the button came back moments earlier with p11 | one animation at p11; bubble lists 13 | +12 ms after the restore; 13 rows, p11 first | +11 ms; 13 rows | PASS |
| Step 8 re-download (R-006): a new job turns the UI off again at its first hand-off, which closes the bubble, and ends with its own animation | hidden again, then one appearance | the button left at the first file (30 ms after the hide settled); one appearance +13 ms; last `p11 (1).jpg` | 29 ms; +11 ms | PASS |
| User's own download mid-job (R-005/R-006) | completes; no animation or button; listed once the button returns | completes (`byExtensionId` null); 0 visible samples; after the end the bubble lists it with the 13 job files | same | PASS |
| Single image + metadata (§4.1 #3) | one animation, with the image | `off,on`; one appearance +14 ms; bubble `135882742_p0.jpg`, `metadata.json` | same (+11 ms) | PASS |
| Single image, metadata off (§4.1 #3) | UI never turned off; as before R-005 | no `setUiOptions` call; one appearance 24 ms after the image was created; bubble lists only the image | same (22 ms) | PASS |
| Worker terminated mid-job (R-006) | hidden until just before the final hand-off; never stranded | see CUJ-4 | same | PASS |
| **Last files land together** (no page held back, fresh profile) | the bubble that opens with the end lists all 13 | e2e build 3/6 and store zip 5/8: the bubble opened 0–3 ms after the restore, before p11 was created (+24 … +38 ms); it listed `metadata.json` + p0–p10, no p11, and still did 2.5 s later | — (repeated probe) | FAIL (`[LOW][BUG]`) |
| Same, with p6–p11 released together (hold) | same | 6/6 PASS: p11 created 0–2 ms after the restore; the bubble opened after it, 13 rows | — | PASS |
| Live pixiv, logged out, 151102843 (3P) and 151090410 (6P), store zip | one animation with the last page; bubble lists all | 3P: +4 ms, 4 rows; 6P: +7 ms, 7 rows | 3P +7 ms; 6P +7 ms | PASS |

#### Manual Verification Notes
- **Why the LOW happens.** In the 8 failing runs, one earlier original (e.g. p10, already named by Chrome while the UI was off) **completed** 0–7 ms after the enable. Chrome opens its partial bubble on a completed download once the UI is on, so the bubble opened before the last file existed. Chrome's UI thread then created p11 24–38 ms later, and the already-open bubble never added it.
  - When the last file lands alone, nothing completes in that window. Then the bubble opens with p11 (+17 … +27 ms) and lists all 13.
  - The design waits for earlier files to be *named* (`targetsKnown`), not *completed*. That is enough for the single animation, but not for the bubble's list. (`design-download-engine.md` "The last hand-off (R-006)" step 3; `src/background/engine.ts:210-240`, `:278-288`.)
- **Visual:** these match the mock crops:
  - `cuj-1/run1/06-saved-row.png` ↔ `mocks/cuj-1-saved-row0.png`;
  - `00-initial-row`, `03-progress-row`, `04-hover-cancel-row`.
- **Fabrication checks:**
  - All 12 originals on disk are sha256-identical to the served bytes (`r006-twelve` ×2, `cuj1.ts` main). Sizes = Content-Length.
  - `metadata.json` is derived from the fixture.
  - Every `setUiOptions` call seen by `__hfpTest.downloadUi()` is also seen by QA's wrapper around the real API, with `ok: true`.
  - In the store zip, where `__hfpTest` is absent, the wrapper alone saw `off,on` around the files.

#### Artifacts
- Screenshots:
  - `docs/qa-artifacts/iter3-19-38-54/cuj-1/run1/` (75 PNG): `00-initial` … `09-reload-idle`, `04b-*`, `05-cancelled`, `edge-*`, `r006-*`;
  - `.../run2/` (22 PNG: `r006-*`).
- Native trees, transitions, spies:
  - `cuj-1/run{1,2}/r006-{twelve,userdl,cancel,single-meta,single-nometa}-native/`;
  - race probe: `cuj-1/run1/r006-race12-{hold6-11,nohold}-<n>-native/`, `cuj-1/prodzip/r006-race12-nohold-<n>-native/`;
  - live: `cuj-1/run{1,2}/r006-live-{151102843,151090410}-native/`.
- Console messages:
  - fake walks: 0;
  - live: pixiv's own page errors only (`browsingTopics` NotSupportedError, an ad script), none from the SW or offscreen document.
- Mocks: `cuj-1-initial.html`, `cuj-1-downloading.html`, `cuj-1-saved.html`, `cuj-1-dark.html`.

#### Issues Found
- `[LOW][BUG]` When the last files land together, Chrome's bubble opens just before the final hand-off and omits the last file. See "Bugs Found". `src/background/engine.ts:278-288` (the last-hand-off path waits for naming, not completion).

### CUJ-2: Download an ugoira — PASS

Re-walked: step 5 (R-006) and the step 6 ZIP-only variant, twice each on the fake and twice live. Every other AC is carried from `iter3-17-37-06`: there is no change in the ugoira/encode code, and every @cuj2 e2e test passes in both gate runs.

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | Idle `Download · MP4/WebM/ZIP` per setting | both (+live) | PASS (carried) | PASS (carried) | PASS |
| 2 | 176 px in every state | both (+live) | PASS (carried) | PASS (carried) | PASS |
| 3 | Integer %, never decreases, no `100%` before the last file | both (+live) | PASS (carried) | PASS (carried) | PASS |
| 4 | Badge `1` for the whole job | both | PASS (carried) | PASS (carried) | PASS |
| 5 | Folder exactly zip, `frames.json`, `.mp4`, `metadata.json` | both (+live) | PASS (4 items in Chrome, 4 bubble rows) | PASS | PASS |
| 6–13 | zip byte-identical, frames.json, duration, even size, playback, ZIP only, cancel in encode, tab closed, no-H.264 → WebM | both | PASS (carried; @cuj2 e2e green) | PASS (carried) | PASS (VLC GUI: L5) |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Step 3 (R-006): no button / animation until just before the video | hidden through the zip fetch and the encode | zip held: `requested=false`, `metadata.json` in Chrome, 0 visible samples; none until the restore | same | PASS |
| Step 5 (R-006): one animation with the video; the bubble lists 4 files | the video is the final hand-off | last `136004512.mp4` (created +0 ms); one appearance +11 ms; bubble `136004512.mp4`, `frames.json`, `136004512_ugoira.zip`, `metadata.json` | same (+10 ms) | PASS |
| Step 6 ZIP only (R-006): the animation comes with `frames.json` | final hand-off `frames.json` | last `frames.json`; one appearance +11 ms; bubble 3 rows | same | PASS |
| Live ugoira 151105084 (store zip) | same as step 5 | last `.mp4`, one appearance +8 ms, bubble 4 rows | +20 ms, 4 rows | PASS |

#### Manual Verification Notes
- The LOW bug cannot occur here in practice:
  - `frames.json` waits for the zip to land, so no earlier file is still in progress at the enable. The gap from the last other file being named to the restore was 129–201 ms.
  - With ZIP only, `frames.json` waits for the zip too, and `metadata.json` lands long before.

#### Artifacts
- Screenshots: `cuj-2/run{1,2}/r006-ugoira*-*.png`, `r006-live-151105084-*`.
- Native trees, spies: `cuj-2/run{1,2}/r006-{ugoira,ugoira-zip,live-151105084}-native/`.
- Console: fake 0; live pixiv-page only.
- Mocks: `cuj-2-initial.html`, `cuj-2-encoding.html` (unchanged; carried).

#### Issues Found
- none

### CUJ-3: Configure the extension from the toolbar icon — PASS

Spot-check: `cuj3.ts` run1 re-walked every section (main + 4 locales: 72 checks, 0 failed, 0 console errors), and all 44 @cuj3 e2e tests pass in both gate runs. The options code is untouched since `iter3-17-37-06`, so every AC (1–17) and edge case is carried PASS from that report: run1 re-confirmed, run2 carried. Mocks `cuj-3-initial/error/saved.html` are unchanged.

#### Issues Found
- none

### CUJ-4: Follow several downloads at once from the toolbar badge — FAIL

`cuj4.ts` run1 was re-walked end to end: main, edge, restart-cancel; 28 checks, 0 failed. ACs 1–10 PASS (run2 carried from `iter3-17-37-06`). The R-006 edge cases were walked twice, headed.

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1–10 | Badge sum/colours/tooltip, per-tab progress, ≤ 1 s updates, cancel drops, gone at the end, `999+`, SW restart ≤ 1 s, toolbar click opens settings | both | PASS | PASS (carried) | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Two jobs, B ends first (R-006): B no animation; one in total, with A's last file | as expected | B `Saved · 8P`: 0 visible samples, `requested=false`; one `off`, one `on` before A's p11; one appearance | same | PASS |
| Two jobs, A ends first | one in total, with B's last file | last `136120877_p7.jpg`; one appearance | same | PASS |
| … "once the button returns, its bubble lists the files of both jobs" | 21 distinct names (both `metadata.json`) | B-first: p11 missing (the bubble opened at +4 ms, p11 created at +48 ms); A-first: all listed | B-first: p11 missing (bubble +2 ms, p11 created +42 ms); A-first: `136120877_p7.jpg` missing (bubble +3 ms, created +58 ms) | FAIL (`[LOW][BUG]`) |
| Step 4: A cancelled after B finished (R-006) | no final hand-off, silent | `cuj4.ts`: one `off` for both jobs (193 files), one silent `on` after every file of A and B | — (run2 carried, R-005 semantics) | PASS |
| Worker stopped mid-job, job completes (R-006) | no call at boot; hidden until just before the final hand-off; never stranded | new instance `{requested:null, calls:[]}`; `off` at its first hand-off, `on` before p11; one appearance +11 ms; bubble 13 rows; ends `requested=true` | same | PASS |
| Worker stopped, two jobs incl. an ugoira (`cuj4.ts` edge) | final hand-off of the two jobs restores | `off,on`, 9 files after the restart, one created after the restore | — | PASS |
| Worker stopped, then cancel | the new instance restores a UI it never hid | its only call is `on` (spy agrees) | — | PASS |

#### Manual Verification Notes
- In two-job ends the last files of the last job land in a burst. That makes the LOW bug's window (an earlier file completing after the enable) likely: 3 of 4 walks.
- The single animation and the button's return were correct in all 4.

#### Artifacts
- Screenshots: `cuj-4/run1/` (33 PNG: `01-tab-a-started` … `06-toolbar-while-running`, `edge-*`, `r006-two-*`, `r006-restart-saved`), `cuj-4/run2/` (10 PNG).
- Native trees, spies: `cuj-4/run{1,2}/r006-{two-b-first,two-a-first,restart}-native/`.
- Console: 0.
- Mocks: `cuj-4-initial.html` (pill crop matches `02-tab-b-busy-row.png`).

#### Issues Found
- `[LOW][BUG]` (shared with CUJ-1) With two jobs, the bubble that opens at the end omits the last file the last job handed over.

### CUJ-5: Recover when a download can't start or breaks — PASS

`cuj5.ts` run1 was re-walked end to end: parts A, B and C, 46 checks, 0 failed. Its 13 R-006 end checks:
- `final`: A3 after login, B5 retry, B6 back online, C11 floating;
- `silent`: B4 `Retry · 3 failed`, B6 504 with `metadata.json` landed, B8 encode failure, B10 cancel;
- `none`: R-003 race, B6 offline, B6 refused, B7 Unavailable;
- `either`: B9 403 mid-job.

The R-006 toolbar ends were walked twice, headed.

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1–16 | needs-login, login URL, walled all-ages, `Retry · 3 failed`, retry → Saved, no connection, outage, refused, Unavailable, encode failure, 403 mid-job, no badge, cancel no red, floating ≤ 3 s, retry policy | both | PASS | PASS (carried; outage/floating diagnostics carried) | PASS (live post-login: NOT_RUN) |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Step 4 (R-006): `Retry · 3 failed`: the button not in the toolbar; it returns with the next download; mock `cuj-5-retry.html` | silent restore | `off,on`, restore after the 10th file, 0 after it; 0 of 921 samples visible; next download: button +32 ms | same (0 of 1067; +38 ms) | PASS |
| Step 5 (R-006): the retry hides the UI again and ends with one animation | final hand-off = the last retried page | the retry's first hand-off takes the button away; last `135882741_p11.jpg`; one appearance +4 ms | same (+1 ms: p9 completed after the enable, 13 ms before p11 was created; the bubble did not auto-open, so no rows to miss) | PASS |
| Step 9: 403 on the last page fetched, every other file landed | no final hand-off → silent | metadata + p0–p10 in Chrome, p11 never; `off,on` after all landed; 0 visible samples; next download +30 ms | same | PASS |
| Step 9: 403 mid-job while other originals are in flight | §4.1 #3: the last in-flight file to land is a final hand-off ("ends with the UI already on, whatever its outcome") | p6/p7, dispatched 11–13 ms after p5's 403 reached the server, before the SW learned of it, landed; the last one was the final hand-off; one appearance; no original requested > 50 ms after the 403 | same | PASS |
| Step 7: Unavailable (deleted after load) | nothing handed to Chrome; no call; the next download shows the button | no call; 0 visible samples; next download +48 ms | same (+53 ms) | PASS |
| Step 4 "the same holds for … Log in to download without a final hand-off" | silent | see the 403 rows | same | PASS |

#### Manual Verification Notes
- **Mock:** `cuj-5/run1/04-retry-3-failed-row.png` ↔ `mocks/cuj-5-retry-row0.png` matches (red outline, warning icon, `Retry · 3 failed`). The mock's toolbar now has no Chrome downloads button, matching the native tree.
- **403 mid-job.** §4.1 #3's parenthetical lists "needed login after a mid-job 403" among the ends without a final hand-off. As built and designed ("403: no new dispatches; in-flight files finish", design-download-engine.md), a 403 that arrives while other originals are in flight usually *does* end with a final hand-off and one animation. That is consistent with the rule's own definition and with CUJ-5 step 4's "without a final hand-off" qualifier. Not filed; noted for pm under Recommendations.
- **Console** (run1 main, 51 entries, all injected faults):
  - 45 offscreen 504/503/500/403;
  - 4 `ERR_CONNECTION_REFUSED` with the server stopped;
  - 1 404 (deleted);
  - 1 expected `[hfp:offscreen] EncodeError` (corrupt-frame fixture).

  The R-006 walks: 403 ×1, 404 ×1, 504 ×12, all injected.

#### Artifacts
- Screenshots: `cuj-5/run1/` (66 PNG: `01-*` … `11-*`, `r006-*`), `cuj-5/run2/` (10 PNG).
- Native trees, spies: `cuj-5/run{1,2}/r006-{retry3,403,403-last,unavailable}-native/`.
- Mocks: `cuj-5-initial.html`, `cuj-5-retry.html`.

#### Issues Found
- none

## Bugs Found

### CRITICAL
- none

### HIGH
- none

### MEDIUM
- none (the iteration's MEDIUM is resolved; see "Resolved in retry 1")

### LOW
- `[LOW][BUG]` When the last files of the busy period land together, Chrome's download bubble opens a few ms **before** the final hand-off and then lists every file except the last. — CUJ-1 (AC 14 "… after which the bubble lists `metadata.json` and the 12 originals", step 6), CUJ-4 (edge "its bubble lists the files of both jobs"), §4.1 #3 ("its bubble lists every file of the job") — `src/background/engine.ts:210-240` (`targetsKnown`), `:278-288` (last-hand-off path)
  - **Observed.** Headed CfT 156, native-UI tree, fresh profiles:
    - store zip, 12 pages, no page held: 5 of 8 runs;
    - e2e build: 3 of 6;
    - two concurrent jobs: 3 of 4 walks (run1 / run2 inconsistent for A-first);
    - 0 of 8 when the last page lands alone;
    - 0 of 6 live runs (3P, 6P, ugoira).
  - **What the user sees.** The bubble pops open listing `metadata.json` and p0–p10. p11's single fly-in follows 24–38 ms later, and the open bubble never adds p11 (still missing 2.5 s later).
  - **Not affected.** The button comes back. One animation. All 13 files on disk and in `chrome://downloads`.
  - **Mechanism.** An earlier original that Chrome had already named while the UI was off completes 0–7 ms after the enable. Chrome opens its partial view for a completed download whenever the UI is on, before the last file exists.
  - **Likely fix (tl).** In the last-hand-off path, also wait (capped) until the other in-progress items have left `in_progress`, not only until they are named.
  - **Repro:** `RUN=x REPS=8 SCEN=race12-nohold node docs/qa-artifacts/iter3-19-38-54/walk-scripts/run.mjs docs/qa-artifacts/iter3-19-38-54/walk-scripts/r006.ts`. Add `EXT_DIR=<unzipped store zip>` for the shipped build.
  - Not pinned by an e2e test: the race is timing-dependent, so a test would be red only intermittently.

## Coverage Gaps
Acceptance criteria with Coverage = `none`: none.

Remaining verification limits:
- **Chrome's toolbar** is observable only in headed Chromium. The 4 "Chrome toolbar" e2e tests skip, with a reason, in the headless gate command. Run them with `HFP_HEADLESS=0 npx playwright test e2e/cuj1.spec.ts -g "toolbar"`.
- **Opening the bubble by hand** (clicking Chrome's toolbar button) is not possible from Playwright. So whether a re-opened bubble lists the missing last file in the LOW case is unverified.
  - The partial view also does not auto-open for a second animation shortly after a first one in the same profile (e.g. the step 8 re-download, the retry). For those periods only the button's return and the single appearance were verified, not the rows.
- **Naming in headless.** Whether Chrome named a file before the enable can be read from QA's `onChanged` listener only approximately. Chrome's filename delta can trail the `downloads.search` answer the engine waits on: +1 ms after the restore settled in 1 of 12 headless probe runs, `probe/headless-naming-headless.json`. The headless e2e therefore asserts `startTime` order only, and the headed native tree is the proof.
- **Live logged-in paths** (NOT_RUN, no account) and the **L5 items**: unchanged, `docs/release-checklist.md` §2–3. The §2 R-006 item now also matters for the LOW bug: "a re-download served from the HTTP cache … exactly one animation" is the burst case.

## New Tests Written
All are in `e2e/cuj1.spec.ts`; no `src/` change.

- Block `CUJ-1: QA gate additions (iteration 3, retry 1)` (`@cuj1`, headless and headed). 30/30 at ×10 headless; 9/9 at ×3 headed:
  - `download UI: last files land together: every earlier file is in Chrome before the UI comes back; only the last file starts after it` — CUJ-1 AC 14 / §4.1 #3 (R-006): the burst path, with no page held back. The existing test holds p11.
  - `download UI: single image: off before metadata.json, back on just before the image is handed to Chrome` — §4.1 #3 (R-006): a single-image work's one animation comes with its image.
  - `download UI: single image, metadata off: the image is the only file, so Chrome’s UI is never turned off` — §4.1 #3 (R-006): "the UI is never turned off and the work behaves exactly as before R-005".
- Block `CUJ-1: QA gate additions (iteration 3, retry 1), Chrome toolbar` (`@cuj1`; headed only, skips headless with a reason). It polls Chrome's native-UI tree every few ms. 6/6 at ×3 headed:
  - `toolbar: one animation: no downloads button until p11 is handed to Chrome, then it returns once, with a bubble listing metadata.json and the 12 originals` — CUJ-1 AC 14 (all three parts), step 6.
  - `toolbar: cancel: no animation, and Chrome’s downloads button stays out of the toolbar until the next download brings it back` — CUJ-1 step 5 (R-006).
- **Test-authoring fixes made during this run** (superseded logs kept as `logs/superseded-*`):
  - the cancel test computed its click guard before the click;
  - `chrome://accessibility` may already have the native tree on in headed Chromium, so no reload follows;
  - an `onChanged` naming assertion was dropped as unreliable (see Coverage Gaps).
- **QA walk scripts** (not part of the suite), in `docs/qa-artifacts/iter3-19-38-54/walk-scripts/`:
  - `r006.ts`: 15 headed scenarios plus the race probe;
  - `r006live.ts`: live pixiv, store zip;
  - `nativePoll.ts`: the fast native-tree poller;
  - `r006headless.ts`: the naming-timing probe;
  - `probeR006*.ts`: the histogram and poller feasibility checks;
  - `common.ts`: `r006Ordering`, `r006Check`, and the spies now recording `named` events;
  - `cuj1.ts`, `cuj4.ts`, `cuj5.ts`: their checks switched to R-006.

## Recommendations
1. **(LOW, tl)** Fix the bubble-misses-the-last-file race.
   - The last hand-off should wait, capped like `HANDOFF_TARGET_WAIT_MS`, until every other in-progress item of the running jobs has left `in_progress`, not only until it is named. Then no earlier completion can open Chrome's bubble with the UI on before the final file exists.
   - Re-run `SCEN=race12-nohold REPS=8` (also with the store zip) and `SCEN=two-b-first,two-a-first`. Expect the bubble to list the last file in every run.
   - The cost is the earlier files' write time before the last hand-off: milliseconds for pixiv-sized originals.
2. **(info, pm)** Consider a wording tweak in §4.1 #3. The parenthetical "needed login after a mid-job 403" reads as always silent. As specified by the same paragraph's definition, a 403 with other originals still in flight ends with a final hand-off and one animation. The design states this ("in-flight files finish"), and QA judged it PASS against the definition.
3. **(info, owner, L5)** `docs/release-checklist.md` §2's R-006 item is the only branded-Chrome check of the toolbar. Its "re-download served from the HTTP cache" bullet is the burst case where the LOW bug shows: watch whether the bubble lists the last file.
