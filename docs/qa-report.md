# QA Report

Last updated: 2026-10-23 23:41:16 (UTC-7)
Scope: all active PRDs (prd-000, CUJ-1 … CUJ-5), as amended by R-004, R-005, R-006 and the R-006 rev. 3 spec-sync (`c2c9de0`: CUJ-1 AC "up to `11 / 12` … `12 / 12` is never shown", CUJ-5 step 5 "`9 / 12` → `11 / 12` … `Saved · 12P` directly"). Iteration 4, run-id `iter4-22-53-54`, `main` at `0ce05cd` (src) / `913a95f` (docs only since). Previous report: iteration 3 retry 1, run `iter3-19-38-54` (FAIL, 1 LOW).

## Verdict: FAIL

2 bugs: 0 CRITICAL / 0 HIGH / 0 MEDIUM / **2 LOW**. Both were found by new probes this iteration and are explained under "Bugs Found". The iteration-3 LOW is **resolved** (quick-fix `c2c9de0`, evidence below).

- `[LOW][BUG]` **Offscreen-document creation race (pre-existing).**
  - When two jobs start within about 10 ms of each other, the second job's first commands reach the offscreen document before it has a listener. They fail at once as `internal`, with 0 attempts.
  - The job ends `Retry · N failed`, with a tooltip that says "failed after 4 attempts each".
  - Its `metadata.json` also fails, and nothing reports it. After the Retry the button says `Saved · 8P` with no `metadata.json` in the folder.
  - Frequency on HEAD builds: 14 of 16 runs with the second click 5–11 ms after the first, and 5 of 7 with it right after `0 / 12` appeared. 0 of 36 at a gap of 50 ms or more (32 HEAD, 4 pre-fix). The pre-fix build fails the same way (4/4).
  - Affects CUJ-1 (edge "Same artwork clicked in two tabs") and CUJ-4 (AC "Starting a second artwork … immediately").
- `[LOW][BUG]` **The pages counter can still show `N / N`.**
  - Seen just before `Saved` when a job's last two pages complete within a few ms, which contradicts the amended CUJ-1 AC "`12 / 12` is never shown".
  - Two jobs at once: the job that ends first held `N / N` in the DOM for 0–2 ms in 34 of 37 runs, and it was painted in 1 of 20 frame-sampled runs.
  - A single 200-page job: 2 of 13 in the DOM, 0 of 11 painted.
  - A single 12-page job: never (0 of 55 walked or probed runs).
  - The mechanism is not the one design-download-engine.md describes.

CUJ results:

| CUJ | Result | Why |
|---|---|---|
| CUJ-1 | FAIL | Both LOWs: the edge "Same artwork clicked in two tabs" (race) and AC 7 "`12 / 12` is never shown" (concurrent or 200-page). The iteration-3 LOW (AC 14) is resolved; the single-job journey passes end to end, twice. |
| CUJ-2 | PASS | `cuj2.ts` ×2, R-006 ugoira ×2, live ugoira ×2 (store zip). |
| CUJ-3 | PASS | Spot-check: `cuj3.ts` run1 (main + 4 locales); options code untouched; run2 carried. |
| CUJ-4 | FAIL | `[LOW][BUG]` race: AC 5 with near-simultaneous starts. The iteration-3 LOW (bubble lists both jobs) is resolved: 8 of 8 headed two-job walks. |
| CUJ-5 | PASS | `cuj5.ts` ×2. Amended step 5 (`9 / 12` → `11 / 12` → `Saved · 12P`) holds in all 4 walked retries and in the e2e 'partial' test. Silent ends unchanged. |

- No CUJ is BLOCKED or UNIMPLEMENTED. Every walk step completed in both runs, except CUJ-3, which was a run1-only spot-check (run2 carried from iteration 3).
- Still NOT_RUN, because QA has no pixiv account (unchanged, `docs/release-checklist.md` §3): CUJ-5 AC 2 / AC 4 after a real login, CUJ-5 AC 9 live, CUJ-1 AC 16 live dark theme.
- L5 only: VLC / Windows playback; the R-005/R-006 checklist item on branded Chrome.
- A spec conflict, not a product bug: PRD CUJ-1 edge "200-page manga: the counter runs `0 / 200` … `200 / 200`" was not amended with the AC. See Recommendations.

## Resolved in iteration 4 (quick-fix `c2c9de0`)

### `[LOW][BUG]` "the bubble that opens with the end omits the last file when the last files land together": resolved

The fix: the busy period's last hand-off now waits until every other in-progress file has **finished**, not merely been named (`othersSettled()`, `src/background/engine.ts:206-240`, capped by `HANDOFF_SETTLE_WAIT_MS` = 2 s). Evidence, all headed Chrome for Testing 156.0.8078.4, a fresh browser and profile per walk, Chrome's native-UI tree polled every 4–9 ms:

| Probe (no page held back unless noted) | Iteration 3 (before) | Iteration 4 |
|---|---|---|
| `race12-nohold`, e2e build (`dist-e2e` at HEAD) | 3 of 6 missed the last file | **16 / 16** list all 13 rows; 1 appearance each |
| `race12-nohold`, store zip (unzipped `npm run zip`) | 5 of 8 missed | **8 / 8** list all 13 |
| `race12-nohold`, dev build (`npm run build`, `dist/`) | — | **4 / 4** list all 13 |
| Two jobs, B ends first / A ends first (×4 each) | 3 of 4 missed | **8 / 8** list all 21 names of both jobs |
| R-006 matrix, 14 scenarios × run1 / run2 | — | run2 121 / 121 checks; run1 120 / 121, then `twelve` re-walked 21 / 21 after a QA-script fix (the re-download's new counter check read the previous job's `Saved` label) |
| Live pixiv, store zip: 3P 151102843, 7P 151116453 (auto-picked), ugoira 151105084, ×2 | 6 / 6 (no burst live) | **6 / 6**, bubble lists every file |

In all 44 busy periods with a final hand-off (fake and live), three things held against Chrome's own records and QA's spies.
- **Every other file finished before the restore.**
  - Chrome's `endTime` was at or before the restore's *issue* time, by 0–889 ms.
  - The worker heard each completion no later than the restore *settled*.
- **Exactly one file was created after the restore,** +0 … +6 ms after it (the maximum asked for by tasks.md: **6 ms**).
- **Chrome's downloads button appeared exactly once,** +2 … +25 ms after the restore. The bubble opened 11–25 ms after the restore and listed every file.

**The probe check was corrected once.** The first e2e probe (`logs/superseded-race12-nohold-e2e.log`) flagged "p10 completed after the enable" in 6 of 8 runs. Chrome's `endTime` for p10 was −1 … 0 ms before the restore's issue, and QA's listener logged the delta in the same millisecond as the issue. QA's listener runs after the engine's in the same event dispatch, and the engine issues the restore on that very delta. That is an observer-order artefact, not a late completion. The check now compares QA's time with the restore's settle and Chrome's `endTime` with its issue; 8 of 8 re-runs are clean. The user-visible result (all 13 rows) was 8 of 8 in both sets.

**Timing:**
- `Saved` follows the last file's landing by 2–54 ms (Chrome `endTime` → label change).
- Restore → `Saved` is 19–69 ms (n = 40; expected ≤ 100 ms on the fake).
- Click → `Saved` on a 12-page burst is 133–163 ms.

**The new tests discriminate.** On a build of `c2c9de0^`, swapped into `dist-e2e/` temporarily (`logs/mutation-prefix-*.log`):
- `toolbar: last files land together` failed 4 of 4, with `135882741_p11.jpg` missing from the bubble;
- `toolbar: two jobs` failed 3 of 4;
- the headless "finished" tests failed 4/8 (CUJ-1), 6/8 (two jobs, B first) and 7/8 (A first).

On HEAD they pass 30/30 headless at ×10 and 10/10 headed at ×5.

## Automated Test Summary
- **Total tests:** 3222 = 3066 vitest + 152 e2e + 4 live smoke.
  - Pre-existing: 3217 (3066 + 147 + 4).
  - New: 5 e2e (3 headless, 2 headed-only).
- **Passing:** 3222 at the final runs.
  - `npm run check`: 3066/3066 (67 files), plus typecheck, eslint and prettier (incl. the new e2e code) and the build, twice (`logs/check-{1,2}.log`).
  - e2e headless, the gate command (`HFP_HEADLESS=1 npm run test:e2e`):
    - baseline: **143 passed / 4 skipped** (`e2e-1.log`);
    - with the new tests: **146 passed / 6 skipped** (`e2e-2.log`).
  - e2e headed toolbar (`npm run build:e2e && HFP_HEADLESS=0 npx playwright test e2e/cuj1.spec.ts -g "toolbar"`): 4/4 baseline, **6/6** with the new tests (`e2e-toolbar-headed-{1,2}.log`).
  - Live smoke `HFP_LIVE=1 npm run test:e2e -- --grep @live`: 4/4, twice (`live-{1,2}.log`).
- **Failing:** 0.
- **Skipped:** 6 in headless runs. They are the "Chrome toolbar" tests (4 old, 2 new), which skip with the reason "this Chromium shows no download UI at all (headless): run with HFP_HEADLESS=0". All 6 pass headed.
- **Flaky** (failed, then passed on framework retry): 0.
- **Bundle size:** `npm run size`: 35.3 KB minified / 13.1 KB gzip (budget 40 / 15), unchanged.

## Mock Coverage Summary
- **CUJs with mocks compared:** 5. All 12 mocks were re-rendered to `docs/qa-artifacts/iter4-22-53-54/mocks/`. The pill crops `*-row0.png` are byte-identical to `iter3-19-38-54`; mocks are unchanged since `d31880b`.
- **CUJs without mocks (`NO_MOCK`):** 0.
- **Compared this run:**
  - `cuj-1/run1/06-saved-row.png` ↔ `cuj-1-saved-row0.png`;
  - `03-progress-row.png` ↔ `cuj-1-downloading-row0.png`;
  - `cuj-4/run2/02-tab-b-busy-row.png` ↔ `cuj-4-initial-row0.png`;
  - `cuj-5/run2/04-retry-3-failed-row.png` ↔ `cuj-5-retry-row0.png`;
  - `cuj-2/run2/03-encoding-row.png` ↔ `cuj-2-encoding-row0.png` (`48%` vs the mock's `58%`, timing only).

  All match: same fill, border, glyph, label layout and width. The fake page draws its own pixiv icons beside the pill.
- **New states without a mock** (labels, not failures): `11 / 12` with p11 in flight (`cuj-1/run{1,2}/05b-11-of-12-p11-in-flight.png`) and the retry's `11 / 12` (`cuj-5/run{1,2}/05b-retry-11-of-12-row.png`). Both use the busy style of `cuj-1-downloading.html`.
- **Placeholder regions:** none.

## How the product was driven
- **Fake pixiv (L3 harness).** Chrome for Testing 156.0.8078.4, launched by `e2e/harness/launch.ts`, with the real unpacked `dist-e2e/`, `dist/` (dev) or the unzipped store zip, against `e2e/server/`.
- **Walk scripts:** `docs/qa-artifacts/iter4-22-53-54/walk-scripts/`, run with `run.mjs`.
  - **R-006 walks** (`r006.ts`): headed, a fresh browser and profile per scenario, with three observers: Chrome's native-UI tree (`nativePoll.ts`), QA's SW spies (a wrapper around the real `chrome.downloads.setUiOptions` plus `downloads.onCreated` / `onChanged`), and Chrome's own download items (`startTime` / `endTime`).
  - **New this iteration:**
    - the ordering check also requires every other file **finished** before the restore (`common.ts` `r006Ordering`, `othersFinishedBeforeRestore`);
    - every final period records the label log (`counterCheck`: counter top, `Saved` latency after the last file's `endTime`).
  - **CUJ end-to-end walks** (`cuj1.ts` … `cuj5.ts`): headless, run1 and run2 (CUJ-3 run1 only).
    - `cuj1.ts` and `cuj5.ts` now capture the `11 / 12` state and the label log.
    - `cuj2.ts`'s three R-005-era ordering checks were switched to R-006 (`logs/superseded-cuj2-run1.log`). They required the restore *after* the video landed; R-006 restores just before it.
  - **Probes:**
    - `twoTabsProbe.ts`: the offscreen race, with a click-gap sweep, both builds and pre-fix;
    - `counterProbe.ts` / `counter200Probe.ts`: the `N / N` counter, DOM-level by MutationObserver and painted-level by one `requestAnimationFrame` sample per frame, headless and headed.
- **Store artifact.** `npm run zip` → `helper-for-pixiv-1.0.0.zip`: 17 files, 183.0 KB, sha256 `da5b765d…2d84`. Unzipped into an empty scratch directory.
  - Its `manifest.json` is byte-identical to the zip built from `c2c9de0^`.
  - `sw.js` differs exactly by the fix: `targetsKnown` → `othersSettled`, naming no longer releases the wait, cap 500 → 2000 ms.
  - No `__hfpTest`, test hooks or source maps.
- **Live pixiv, logged out** (`r006live.ts`, headed, store zip): 151102843 (3P), 151116453 (7P, auto-picked from the manga ranking), ugoira 151105084. Each twice.

## Per-CUJ Verification

### CUJ-1: Download an illustration or manga from the artwork page — FAIL

Walked end to end twice (`cuj1.ts` run1 / run2: main, cancel, edge and late-metadata sections, 60 checks each, 0 failed), plus the R-006 matrix (`twelve`, `userdl`, `cancel`, `single-meta`, `single-nometa`, ×2), the race probes and the counter / two-tabs probes.

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | One button, immediately left of Like, ≤ 500 ms after the row | both (+live) | PASS | PASS | PASS |
| 2 | `Download · 12P` / `Download` (single page) | both | PASS | PASS | PASS |
| 3 | 164 px in every state; never changes | both | PASS | PASS | PASS |
| 4 | `metadata.json` + `135882741_p0…p11`; sizes = Content-Length | both (+live) | PASS (sha256 = served bytes) | PASS | PASS |
| 5 | `metadata.json`: 12 keys in order, literal non-ASCII, `\n` kept | both (+live) | PASS | PASS | PASS |
| 6 | ≤ 5 of this artwork's files in flight | both | PASS (peak 5) | PASS | PASS |
| 7 | (amended) `N / 12` rises up to `11 / 12`; `Saved` directly; `12 / 12` never shown | both (e2e 'counter and badge' + new 'last files land together, finished'; walks) | PASS single job: `11 / 12` held with p11 in flight, `Saved · 12P` directly after (`05b-…`); 55 single 12-page runs never showed `12 / 12`. FAIL two jobs at once / 200 pages: `N / N` for 0–2 ms (see Bugs) | same | FAIL (`[LOW][BUG]`) |
| 8 | Cancel face; cancel stops; files stay; idle, no error style | both | PASS | PASS | PASS |
| 9 | `Saved · 12P` style; tooltip | both | PASS | PASS | PASS |
| 10 | SPA away/back keeps Saved; reload shows idle | both | PASS | PASS | PASS |
| 11 | Clicking Saved re-downloads as ` (1)` duplicates | both | PASS (26 files) | PASS | PASS |
| 12 | Closing the tab does not stop the job | both | PASS | PASS | PASS |
| 13 | Badge = pages not yet complete; gone at the end | both | PASS (badge `1` at `11 / 12`) | PASS | PASS |
| 14 | (R-006) no bubble / animation for the first 12 files; exactly one with the last; then the bubble lists `metadata.json` + 12 originals | both (headed 'toolbar: one animation' + new 'toolbar: last files land together'; headless 'finished') | PASS (p11 held and burst: 16 + 8 + 4 race runs, all 13 rows) | PASS | PASS (iteration-3 LOW resolved) |
| 15 | Tab / Enter / Space; focus ring; `aria-busy` | both | PASS | PASS | PASS |
| 16 | Dark theme identical | both (fake only) | PASS | PASS | PASS (live NOT_RUN: login) |
| 17 | Pattern changed mid-job keeps the job's folder | automated | PASS (e2e) | PASS (e2e) | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Step 2 (R-006): hidden from `metadata.json` on | no button / bubble | hide settled at/before `metadata.json`'s creation; 0 visible samples up to `11 / 12` with p11 held | same | PASS |
| Step 5 cancel (R-006) | no animation; the button returns with the next download | `off,on`, the restore after the last landed file; 0 of 1470 samples visible; the next download brings the button back at +21 ms | same | PASS |
| Step 6 (rev. 3): last files land together | one animation; the bubble lists 13 | the button at +9 … +12 ms; the bubble at +14 … +22 ms, 13 rows; every other file finished before the restore | same | PASS |
| Step 8 re-download | hidden again, one animation | its first hand-off takes the button away; one appearance +2 / +6 ms; top `11 / 12` | same (+2 ms) | PASS |
| User's own download mid-job | no animation; listed afterwards | completes; 0 visible samples; the bubble lists 14 rows incl. `users-own-download.txt` | same | PASS |
| Single image + metadata / metadata off | one animation with the image / never off | `off,on`, +10 ms, 2 rows / no call, appearance 18 ms after the image | same | PASS |
| 200-page manga: width; ≤ 5 in flight; (PRD edge) "counter runs `0 / 200` … `200 / 200`" | as PRD | width constant; peak 5; top `199 / 200` → `Saved · 200P` | width, peak 5; `199 / 200` → **`200 / 200`** (1 ms) → `Saved · 200P` | PASS on width and flight. Counter: spec conflict, and part of the `N / N` LOW |
| **Same artwork clicked in two tabs** | two independent jobs; the second run's files get ` (1)` | clicks ≥ 50 ms apart: both `Saved · 12P`, 26 files (e2e test + 36 probe runs). Clicks ~8–11 ms apart: the second job ends `Retry · 1–6 failed` in 4/4 (e2e) and 2/4 (zip); its `metadata (1).json` is missing | — (repeated probe) | FAIL (`[LOW][BUG]`) |
| Worker terminated mid-job (R-006) | hidden until just before the final hand-off; never stranded | see CUJ-4 | same | PASS |
| Live pixiv, store zip: 3P, 7P | one animation with the last file; the bubble lists all | 4 and 8 rows; one appearance at +12 / +25 ms | +8 / +7 ms | PASS |

#### Manual Verification Notes
- **Counter, amended AC.**
  - A single 12-page job, every observation: `0 / 12` … `11 / 12`, then `Saved · 12P`.
    - Walks with p11 held: `11 / 12` and badge `1` hold until p11 lands.
    - Burst probes (28 headed runs): top 11, never `12 / 12`.
    - Frame-sampled runs (11): never painted.
  - Intermediate values can be skipped in a burst, e.g. `7 / 12` → `9 / 12`, when two pages complete in the same millisecond. That predates this iteration and the counter never decreases.
  - The `N / N` cases are under "Bugs Found".
- **Fabrication checks on the fix.**
  - **Real calls.** QA's wrapper around the real `setUiOptions` recorded `off,on`, both answered `ok`, in every final period. In the store zip, which has no test API, the wrapper alone saw them.
  - **Chrome's own records.** Every other item's `endTime` ≤ the restore's issue time; the last item's `startTime` ≥ its settle.
  - **Files on disk.** All 12 originals are sha256-identical to the served bytes (matrix `twelve` ×2, `cuj1.ts` main ×2), with sizes equal to Content-Length.
  - **The store zip.** Permissions are `downloads, storage, offscreen, declarativeNetRequestWithHostAccess, downloads.ui`; hosts `www.pixiv.net` / `i.pximg.net`; content script on `https://www.pixiv.net/*`. The manifest is identical to the pre-fix build.
- **Visual:** the crops listed in the Mock Coverage Summary match.

#### Artifacts
- **Screenshots:**
  - `docs/qa-artifacts/iter4-22-53-54/cuj-1/run1/` (115 PNG) and `.../run2/` (81 PNG);
  - steps: `00-initial`, `01-hover`, `02-click-busy`, `03-progress`, `04-hover-cancel`, `04b-*`, `05-cancelled`, **`05b-11-of-12-p11-in-flight`**, `06-saved`, `06-saved-hover`, `07-spa-*`, `08-redownload`, `09-reload-idle`;
  - edges: `edge-*`, `r006-*`, `counter-*`, `two-tabs-*-failed`.
- **Native trees, transitions, spies:** `cuj-1/run{1,2}/r006-{twelve,userdl,cancel,single-meta,single-nometa}-native/`.
- **Race probes:** `cuj-1/run1/r006-race12-nohold-<n>-{e2e,e2e-b,zip,dev}-native/`; summaries `r006-summary-run1-{e2e,e2e-b,zip,dev}-race12-nohold.json`.
- **Probe data:** two-tabs job snapshots `cuj-1/run1/two-tabs-*/job-snapshots.json`; counter probes `logs/counter*-probe*.log`.
- **Console messages:**
  - fake walks: 0;
  - live: pixiv's own page errors only (`browsingTopics` NotSupportedError, ad scripts `ipds.adrta.com`, `cm.mgid.com` 400), none from the SW or the offscreen document.
- **Network verified:**
  - ≤ 5 in flight (`server.maxInFlight`);
  - after a cancel, no new page requests;
  - in the race probe, no original requested twice.
- **Mocks:** `cuj-1-initial.html`, `cuj-1-downloading.html`, `cuj-1-saved.html`, `cuj-1-dark.html`.

#### Issues Found
- `[LOW][BUG]` Offscreen-document creation race: a second job started within about 10 ms loses files and `metadata.json`. `src/background/offscreen-client.ts:26-45`, `:76-87`; `src/background/engine.ts:180-200`.
- `[LOW][BUG]` The counter can show `N / N` before `Saved` (AC 7, amended). `src/background/engine.ts:123-131`, `:149-150`; `src/background/pusher.ts:38-42`.

### CUJ-2: Download an ugoira — PASS

`cuj2.ts` was walked twice (main, variants, edge; 0 failed checks each run, after the R-006 check switch), plus the R-006 `ugoira` / `ugoira-zip` scenarios ×2 and live 151105084 ×2 (store zip). The only change in its path is the shared settle wait before the video's hand-off.

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | Idle `Download · MP4/WebM/ZIP` per setting | both (+live) | PASS | PASS | PASS |
| 2 | 176 px in every state | both (+live) | PASS | PASS | PASS |
| 3 | Integer %, never decreases, no `100%` before the last file, ≥ 1 update/s | both (+live) | PASS | PASS | PASS |
| 4 | Badge `1` for the whole job | both | PASS | PASS | PASS |
| 5 | Folder exactly zip, `frames.json`, `.mp4`, `metadata.json` | both (+live) | PASS (4 items, 4 bubble rows) | PASS | PASS |
| 6–13 | zip byte-identical, frames.json, duration, even size, playback, ZIP only, cancel in encode, tab closed, no H.264 → WebM | both | PASS (walk + @cuj2 e2e incl. ffprobe) | PASS | PASS (VLC GUI: L5) |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Step 3 (R-006): no button through the zip fetch and the encode | hidden | `requested=false`, 0 visible samples with the zip held | same | PASS |
| Step 5: one animation with the video; the bubble lists 4 | the video is the final hand-off | `.mp4` created +1 ms after the restore; one appearance +10 ms; 4 rows; every other file finished 187–199 ms before | same | PASS |
| Step 6 ZIP only: the animation with `frames.json` | final hand-off `frames.json` | +0 ms; one appearance +10 ms; 3 rows | same (+11 ms) | PASS |
| Tab closed mid-encode | the video lands; the video is the final hand-off | R-006 `final`, last `.mp4` | same | PASS |
| Live 151105084, store zip | as step 5 | 4 rows, one appearance +7 ms | same | PASS |

#### Artifacts
- **Screenshots:** `cuj-2/run{1,2}/` (43 PNG each): `00-initial` … `05-saved`, `06-*`, `07-*`, `09-*`, `edge-*`, `r006-ugoira*`, `r006-live-151105084-*`.
- **Console:** fake 0; live pixiv-page only.
- **Mocks:** `cuj-2-initial.html`, `cuj-2-encoding.html`.

#### Issues Found
- none

### CUJ-3: Configure the extension from the toolbar icon — PASS

Spot-check: `cuj3.ts` run1 re-walked main and all 4 locales (0 failed checks, 0 console errors), and every @cuj3 e2e test passes in both gate runs. There is no options-page change since iteration 3, so every AC (1–17) and edge case is PASS: run1 re-confirmed, run2 carried from `iter3-17-37-06`. Mocks `cuj-3-initial/error/saved.html` are unchanged.

#### Issues Found
- none

### CUJ-4: Follow several downloads at once from the toolbar badge — FAIL

`cuj4.ts` was walked twice (main, edge, restart-cancel; 28 checks each, 0 failed). The R-006 two-job scenarios ran ×4 per order, plus the worker-restart scenario ×2.

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1–4 | Badge 23 / colours / tooltip; one-job title; per-tab progress; ≤ 1 s countdown | both | PASS | PASS | PASS |
| 5 | A second artwork starts at once; neither waits | both | PASS when started ≥ 50 ms after the first (walks, e2e). FAIL when started within ~10 ms: the second job's first files fail without reaching pixiv (8/8 probe runs, 136120877 after 135882741) | — | FAIL (`[LOW][BUG]`) |
| 6–10 | Cancel one job; gone at the end; `999+`; SW restart ≤ 1 s; toolbar click opens settings | both | PASS | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Two jobs, B ends first (R-006) | B silent; one animation with A's last file; the bubble lists both jobs | B `Saved · 8P` with 0 visible samples; one appearance +11 / +12 ms; 21 names | same (×2 each run) | PASS |
| Two jobs, A ends first | one animation with B's last file; the bubble lists both | last `136120877_p7.jpg`; one appearance; 21 names | same | PASS (iteration-3 LOW resolved) |
| Step 4: A cancelled after B finished | silent | one `off` for both jobs, one silent `on` after every file | same | PASS |
| Worker stopped mid-job, job completes | no call at boot; hidden until just before the final hand-off | `{requested:null, calls:[]}` at boot; one appearance +9 / +10 ms; 13 rows | same | PASS |
| Worker stopped, then cancel | the new instance restores the UI | its only call is `on` (the spy agrees) | same | PASS |

#### Manual Verification Notes
- In the two-job walks the job that ends first shows `12 / 12` or `8 / 8` in the DOM before `Saved` in 7 of 8 walks. That is the counter LOW; CUJ-4 itself states no counter top.

#### Artifacts
- **Screenshots:** `cuj-4/run{1,2}/` (35 PNG each): `01-tab-a-started`, `02-tab-{a,b}-busy`, `03-tab-b-saved`, `04-tab-a-*`, `05-last-job-landed-badge-gone`, `06-toolbar-while-running`, `edge-*`, `r006-two-*`, `r006-restart-saved`, `two-artworks-*-failed-row.png`.
- **Native trees, spies:** `cuj-4/run{1,2}/r006-{two-b-first,two-a-first}{,-c,-d}-native/`, `r006-restart-native/`.
- **Console:** 0.
- **Mocks:** `cuj-4-initial.html`.

#### Issues Found
- `[LOW][BUG]` (shared with CUJ-1) The offscreen creation race fails the second of two near-simultaneous jobs.

### CUJ-5: Recover when a download can't start or breaks — PASS

`cuj5.ts` was walked twice: parts A, B and C, 48 checks each, 0 failed. The R-006 `retry3`, `403`, `403-last` and `unavailable` scenarios ran ×2 headed.

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1–16 | needs-login, login URL, walled all-ages, `Retry · 3 failed`, retry → Saved, no connection, outage, refused, Unavailable, encode failure, 403 mid-job, no badge, cancel no red, floating ≤ 3 s, retry policy | both | PASS | PASS | PASS (live post-login: NOT_RUN) |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Step 4: `Retry · 3 failed` (R-006, mock `cuj-5-retry.html`) | silent; the button returns with the next download | `off,on` after the 10th file; 0 of 1300 samples visible; the next download +21 ms | same | PASS |
| **Step 5 (amended): `9 / 12` → `11 / 12` → `Saved · 12P` directly** | `12 / 12` never shown; badge `3` | walk: badge 3 at `9 / 12`, badge 1 at `11 / 12` (`05b-retry-11-of-12`), then `Saved · 12P`; burst retry: `9 / 12` → `11 / 12` → `Saved · 12P` | same (both) | PASS |
| Step 5 (R-006): the retry hides again, one animation | final hand-off = the last retried page | p11, created +5 / +6 ms; one appearance +4 / +7 ms | same | PASS |
| Step 9: 403 mid-job / 403 on the last page | §4.1 #3 | mid-job: a final hand-off (p9), one appearance, no original requested > 50 ms after the 403; last page: silent, next download +25 ms | same | PASS |
| Step 7: Unavailable | no call; the next download shows the button | no call; +49 ms | same | PASS |

#### Manual Verification Notes
- **Console** (main walk, 51 entries per run, all injected faults): 44 × 504, 1 × 403, 1 × 404, 4 × `ERR_CONNECTION_REFUSED` (server stopped), 1 expected `[hfp:offscreen] EncodeError` (corrupt-frame fixture).
- **Mock:** `04-retry-3-failed-row.png` matches `cuj-5-retry-row0.png`.

#### Artifacts
- **Screenshots:** `cuj-5/run{1,2}/` (68 PNG each): `01-*` … `11-*`, **`05b-retry-11-of-12`**, `r006-*`.
- **Native trees:** `cuj-5/run{1,2}/r006-{retry3,403,403-last,unavailable}-native/`.
- **Mocks:** `cuj-5-initial.html`, `cuj-5-retry.html`.

#### Issues Found
- none

## Bugs Found

### CRITICAL
- none

### HIGH
- none

### MEDIUM
- none

### LOW
- `[LOW][BUG]` **A second job started while the offscreen document is still being created loses its first files and its `metadata.json`.**
  - **Affects:** CUJ-1 (edge "Same artwork clicked in two tabs") and CUJ-4 (AC 5).
  - **Code:** `src/background/offscreen-client.ts:26-45` (`ensureOffscreen`), `:76-87` (`send`'s single retry); `src/background/engine.ts:180-200` (dispatch failure → `internal`, `attempts: 0`).
  - **Repro.** Two tabs open on artworks, and the second Download clicked 5–11 ms after the first:
    - same artwork: e2e build 4/4, plus 4/6 with the second click right after `0 / 12`; store zip 2/4; pre-fix build 4/4;
    - two different artworks (135882741, then 136120877): 6/6 + 2/2;
    - a gap ≥ 50 ms: 0/36 (32 on HEAD builds, 4 pre-fix).
    - Command: `SECOND=136120877 CLICK_GAP=0 RUN=run1 REPS=6 node docs/qa-artifacts/iter4-22-53-54/walk-scripts/run.mjs docs/qa-artifacts/iter4-22-53-54/walk-scripts/twoTabsProbe.ts` (add `EXT_DIR=<unzipped zip>`, `RETRY=1`).
  - **What happens.** The second job's `metadata.json` and the pages it dispatches in its first burst (e.g. p4–p8) fail at once with `{"kind":"internal","attempts":0,"detail":"Could not establish connection. Receiving end does not exist."}`. No request reaches pixiv.
  - **What the user sees:**
    - the button says `Retry · 4 failed` with the tooltip "4 of 8 pages saved. 4 failed after 4 attempts each…", but no attempt was made;
    - the `metadata.json` failure is not mentioned;
    - clicking Retry fetches only the pages and ends `Saved · 8P`, and the folder has no `metadata.json`. The data is silently incomplete.
  - **Likely cause.** `ensureOffscreen()` returns as soon as `chrome.runtime.getContexts` lists the document. That can happen while the first job's `chrome.offscreen.createDocument` is still pending and the document has no `onMessage` listener yet. `send`'s one retry re-ensures the same way, so it fails again.
  - **Pre-existing.** The code is unchanged since `a15a74d`, and the `c2c9de0^` build fails identically. It is not caused by this iteration's fix.
  - **Severity LOW.** It needs two job starts within about 10 ms on this machine, which two hand clicks practically cannot do. Whether the window is wider on slower hardware is unverified, and a wider window would argue for MEDIUM.
  - Not pinned by an e2e test: it is a timing race, and a red pin would block the suite for a LOW.
- `[LOW][BUG]` **The pages counter can show `N / N` for a moment before `Saved`**, against the amended CUJ-1 AC "… `12 / 12` is never shown".
  - **Code:** `src/background/engine.ts:123-131` (`runEffects` awaits each effect in turn), `:149-150`; `src/background/pusher.ts:38-42` (the view is built from the live record when the push runs).
  - **Two jobs at once.** The job that ends first is the one whose last page is not the busy period's last hand-off:
    - DOM-level `N / N` (`12 / 12`, `8 / 8`) for 0–2 ms in 34 of 37 runs (7/8 two-job walks, 27/29 probe runs);
    - frame-sampled with the tab in front: painted for one frame in 1 of 10 headed runs, 0 of 10 headless;
    - it happens with the CUJ-1 example itself (A ends first).
  - **A single 200-page job:** DOM-level `200 / 200` in 2 of 13 (the `cuj1.ts` run2 edge walk, 1 of 6 headless probe runs), never painted (0 of 11).
  - **A single 12-page job:** never (55 runs: race probes, matrix, walks, frame probe).
  - **Mechanism, measured.** A page completion's effects are `[release, badge, push]`, run in order with `await`. The `release` is an offscreen round trip. If the job's last page completes during that round trip, the earlier completion's `push` reads the already-updated record and sends a "running" view with `done = N`. Only then does finalize push `Saved`.
  - **The design's account is inaccurate.** design-download-engine.md "Progress counter" (`:377-380`) and tasks.md list the CUJ-4 case as needing B's `metadata.json` still in progress, "in practice" never. Neither covers the single 200-page case. pm's pre-decided exit covers only the 2 s cap residual.
  - **Fix options.**
    - Code: build the running view when `settle()` emits the push, or drop a running push whose record has no unfinished page.
    - Spec: pm narrows the AC via `/spec-sync` and also amends the 200-page edge line.

## Coverage Gaps
Acceptance criteria with Coverage = `none`: none.

Remaining verification limits:
- **Chrome's toolbar** is observable only headed. The 6 "Chrome toolbar" e2e tests skip, with a reason, in the headless gate command.
- **Not pinned in e2e** (timing races; documented with repro probes instead):
  - the offscreen creation race;
  - the concurrent / 200-page `N / N`.
- **Re-opened bubble.** The partial view does not auto-open for a second animation shortly after a first one in the same profile (re-download, retry). For those periods only the single appearance and Chrome's ordering were verified, not the bubble rows.
- **Live logged-in paths** (NOT_RUN, no account) and the **L5 items**: unchanged, `docs/release-checklist.md` §2–3.

## New Tests Written
No `src/` change. All pass on HEAD: headless 30/30 at ×10 and 9/9 headed at ×3; headed toolbar 10/10 at ×5. All fail on the pre-fix build (see "Resolved").

- `e2e/cuj1.spec.ts`, block `CUJ-1: QA gate additions (iteration 4)` (`@cuj1`):
  - `download UI: last files land together, finished: every earlier file has finished in Chrome before the UI comes back; the last file starts after it and its landing shows Saved · 12P within 300 ms, never 12 / 12`. Covers CUJ-1 AC 14 and the amended AC 7 (rev. 3) on the burst path. It uses a wrapper around the real `setUiOptions` for the restore's issue time and a worker-side `onChanged` listener.
- `e2e/cuj1.spec.ts`, block `CUJ-1: QA gate additions (iteration 4), Chrome toolbar` (`@cuj1`; headed only, skips headless with a reason):
  - `toolbar: last files land together: one animation, and the bubble that opens lists metadata.json and the 12 originals, the last file included`. Covers CUJ-1 AC 14; this is the iteration-3 LOW's repro.
  - `toolbar: two jobs: B ends first with no animation; one animation in total, with A’s last file, and the bubble lists the files of both jobs` (`@cuj4`). Covers the CUJ-4 edge "its bubble lists the files of both jobs".
  - The native-tree poller helpers (`startTree`, `samples`, `shown`, `appearances`, `controlDownload`) moved from inside the retry-1 describe to module scope, unchanged, so both blocks share them.
- `e2e/cuj4.spec.ts`, block `CUJ-4: QA gate additions (iteration 4)` (`@cuj4`):
  - `download UI: two jobs, B ends first, finished: …` and `… A ends first, finished: …`. Covers the CUJ-4 edge (R-006 rev. 3): every other file of both jobs finished before the restore was issued, and only the last job's last file starts after it.
- `e2e/README.md`: the CUJ-1 and CUJ-4 download-UI rows name the new checks; "the two headed-only tests" no longer gives a count.
- **QA walk scripts** (not part of the suite), in `docs/qa-artifacts/iter4-22-53-54/walk-scripts/`:
  - `r006.ts`: the `counterCheck`, the corrected race checks, `SUFFIX` / `EXT_TAG`;
  - `common.ts`: `othersFinishedBeforeRestore`;
  - `cuj1.ts`, `cuj5.ts`: the `11 / 12` steps;
  - `cuj2.ts`: switched to R-006;
  - new: `twoTabsProbe.ts`, `counterProbe.ts`, `counter200Probe.ts`.
  - Superseded logs are kept as `logs/superseded-*`.

## Recommendations
1. **(LOW, tl → coder) Offscreen creation race.**
   - In `ensureOffscreen()`, await an in-flight `creating` promise even when `getContexts` already lists the document, or have the offscreen document signal readiness.
   - Give "Receiving end does not exist" during creation a bounded wait instead of a single immediate resend.
   - Separately, a file failing as `internal` should not produce "failed after 4 attempts each".
   - A failed `metadata.json` next to failed pages is neither reported nor retried: pm may want to specify it.
   - Re-run `twoTabsProbe.ts` with `CLICK_GAP=0`, same and different artworks (`SECOND=136120877`), e2e build and store zip. Expect 0 failures.
2. **(LOW, tl / pm) Counter `N / N`.** Either fix the stale running push (code), or have pm scope "`12 / 12` is never shown" to a job whose last page is the busy period's last hand-off and add the 200-page residual.
   - Either way, correct design-download-engine.md "When `N / N` can still show" to the measured mechanism.
   - Re-run `counterProbe.ts` (`SKIP_TABS=1`, `HEADED=1`) and `counter200Probe.ts`.
3. **(pm, `/spec-sync`) Spec conflict.** PRD CUJ-1 edge "200-page manga: the counter runs `0 / 200` … `200 / 200`" (`prd-000-mvp.md:317`) contradicts the amended AC. The build normally ends `199 / 200` → `Saved · 200P`.
4. **(info, owner, L5)** `docs/release-checklist.md` §2's R-006 item ("a re-download served from the HTTP cache … exactly one animation … the bubble lists the new job's last file") is the branded-Chrome confirmation of the resolved LOW.
