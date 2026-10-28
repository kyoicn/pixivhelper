# QA Report

Last updated: 2026-10-28 01:21:10 (UTC-7)
Scope: all active PRDs (prd-000, CUJ-1 … CUJ-5), as refined on 2026-10-27 (Issue 2026-10-27-19-58-31: CUJ-1 step 8 and ACs, §4.3 "Folder choice", CUJ-4 same-artwork edge, CUJ-5 step 5 / step 9 / reload edge) and amended by R-007 (applied `c8d95bc`). Iteration 5, run-id `iter5-00-09-39`, `main` at `cac42dc` (src unchanged since `fbcdc71`). Work under test: D15 folder choice (`4f863f2`), D16 offscreen readiness (`18b02f0`), the e2e/L2 test rewrites (`5e27fc9`, `d59219e`); ENG-013 (`5511f40`) and ENG-014 (`d46b7fa`) for regression only. Previous report: iteration 4, run `iter4-22-53-54` (FAIL, 2 LOW).

## Verdict: FAIL

1 bug: 0 CRITICAL / 0 HIGH / 0 MEDIUM / **1 LOW**, new this iteration. Both iteration-4 LOWs are closed: the offscreen creation race is **resolved** by D16 (evidence below), and the `N / N` counter is now spec (R-007 item 1).

- `[LOW][BUG]` **The folder check counts files outside `<Downloads>/<folder>/`.** The regex is a suffix match on Chrome's absolute path, so a record at `<old Downloads>/pixiv/みずき-135882741/…` (download location changed in Chrome) or `<Downloads>/x/pixiv/みずき-135882741/…` (an earlier pattern `x/pixiv/{artist}-{id}`) makes the next run use `pixiv/みずき-135882741 (1)` although `<Downloads>/pixiv/みずき-135882741/` does not exist. PRD §4.3 defines "present" as a record under `<Downloads>/<folder>/`. Reproduced 2/2 (one per scenario). CUJ-1.

CUJ results:

| CUJ | Result | Why |
|---|---|---|
| CUJ-1 | FAIL | The LOW above. Everything else passes: the refined ACs (second → `(1)`, third → `(2)`, moved → plain, gap → `(1)`, history cleared → per-file ` (1)`, token-free `pixiv (1)`, no parent suffix, tooltip/aria name the folder) walked twice on the e2e build and once on the store zip; the same-artwork two-tab edge is race-free at a click gap of 0. |
| CUJ-2 | PASS | `cuj2.ts` ×2 (44 checks each), R-006 `ugoira` / `ugoira-zip` ×2 headed, live ugoira ×2 (MP4 and ZIP only); an ugoira repeat lands in `(1)` with zip, `frames.json`, video and `metadata.json`. |
| CUJ-3 | PASS | Regression: `cuj3.ts` ×2 (main + 4 locales, 72 checks each) and the R-007 item 4 contrast walk ×2, both themes. |
| CUJ-4 | PASS | AC 5 now holds at a click gap of 0: 32/32 probe runs (two builds × same/different artworks × 8) plus a 0–800 ms sweep 40/40; `cuj4.ts` ×2 (28 checks each). Iteration-4 LOW resolved. |
| CUJ-5 | PASS | `cuj5.ts` ×2 (48 checks each), the R-007 item 6 walk ×2 (pages + `metadata.json` failed → Retry re-writes both), Retry of a `(1)` job stays in `(1)`; R-006 `retry3` / `403` / `403-last` / `unavailable` ×2 headed. |

- No CUJ is BLOCKED, NOT_RUN or UNIMPLEMENTED; every walk step completed in both runs.
- Still NOT_RUN, because QA has no pixiv account (unchanged, `docs/release-checklist.md` §3): CUJ-5 AC 2 / AC 4 after a real login, CUJ-5 AC 9 live, CUJ-1 AC 20 live dark theme. L5 only: Windows backslash paths for the folder regex, VLC / Windows playback, branded-Chrome items of §2.
- Spec conflict, not counted as a bug: the 10 s existence re-check limit (Recommendations 2). Measured: a click made at once after moving the plain folder lands in `(2)`, not the plain folder (2/2).

## Resolved this iteration

### `[LOW][BUG]` (iteration 4) Offscreen-document creation race: resolved by D16

`twoTabsProbe.ts` (two tabs, both buttons clicked, the second `CLICK_GAP` ms after the first; job records polled every 15 ms; the SW log recorded at every level):

| Probe | Build | Runs | Both `Saved` + every file + `metadata.json` in both folders | Failed files / `did not take` |
|---|---|---|---|---|
| Gap 0, same artwork | e2e (`dist-e2e`, HEAD) | 8 | **8/8** (actual gap 6–14 ms) | 0 / 0 |
| Gap 0, 135882741 + 136120877 | e2e | 8 | **8/8** (6–8 ms) | 0 / 0 |
| Gap 0, same artwork | store zip | 8 | **8/8** (6–8 ms) | 0 / 0 |
| Gap 0, 135882741 + 136120877 | store zip | 8 | **8/8** (5–9 ms) | 0 / 0 |
| Sweep 0, 5, 10, 20, 30, 50, 100, 200, 400, 800 ms × same/different × 2 | e2e | 40 | **40/40** | 0 / 0 |
| Gap 0, both pairs × 4 | pre-D16 (`5508a46`, built in a scratch worktree) | 8 | **1/8**: `Retry · 1–5 failed`, `metadata.json` missing | 2–6 per run |

- The iteration-4 failure window was 5–11 ms. All 32 HEAD runs at gap 0 fell inside it; the pre-D16 build still fails there (7/8), so the probe discriminates.
- The resend loop never had to fire on this machine (0 `not listening yet` lines in 72 e2e-build runs): rule (b), awaiting the in-flight `createDocument` before `getContexts`, is what closes the race in real Chrome. This matches the code review's note.
- The e2e suite `CUJ-4: two tabs clicked at once (D16)` fails 3 of 6 on the pre-D16 build (`Retry · 4 failed`, `Retry · 6 failed`) and passes 6/6 on HEAD (`logs/mutation-pred16-cuj4-two-tabs.log`).
- **Grace-close edge (b).** Job A to `Saved`, then job B clicked at `Saved + 5000 + offset` ms. QA's spies wrapped the real `chrome.offscreen.createDocument` / `closeDocument` and `chrome.runtime.sendMessage` in the SW.

  | Sweep | Build | Runs | B `Saved · 8P` with 9 files incl. `metadata.json` | Close-then-recreate observed | Rejections |
  |---|---|---|---|---|---|
  | −150 … +75 ms (15 offsets) | e2e | 15 | 15/15 | 9 | 0 |
  | −36 … −12 ms, 1 ms steps | e2e | 26 | 26/26 | 13 | 0 |
  | −30 … −20 ms, 44 runs | e2e | 44 | 44/44 | 10 | 0 |
  | −50 … +50 ms, 10 ms steps | store zip | 11 | 11/11 | 7 | 0 |
  | −40 … +140 ms, close slowed by 150 ms | e2e | 15 | **15/15**; B's first command always waits for the close (0 sends inside it) | 14 | 0 |
  | same, close slowed by 150 ms | pre-D16 | 15 | **14/15**: at +100 ms B's commands went to the closing document and the job hung at `7 / 8` | — | — |

  - Real Chrome closes the document in ≤ 1 ms here, so an unslowed job start never landed inside an in-flight close (the closest recreate began 8.4 ms after the close settled). The slowed close (a wrapper delaying the real call) stands in for a slow machine, and that is where rule (a) shows: HEAD waits and recreates; the old build loses commands.

## Automated Test Summary
- **Total tests:** 3477 = 3305 vitest + 168 e2e + 4 live smoke.
  - Pre-existing: 3473 (3305 + 164 + 4).
  - New: 4 e2e (headless).
- **Passing:** 3477 at the final runs.
  - `npm run check` (typecheck, eslint, prettier, vitest, dev build): **3305/3305** in 71 files, twice (`logs/check-{1,2}.log`).
  - e2e headless (`HFP_HEADLESS=1 npm run test:e2e`): baseline **158 passed / 6 skipped** (`e2e-1.log`); with the new tests **162 passed / 6 skipped** (`e2e-2.log`).
  - e2e headed toolbar (`HFP_HEADLESS=0 npx playwright test e2e/cuj1.spec.ts -g "toolbar"`): **6/6**, twice.
  - Live smoke (`HFP_LIVE=1 npm run test:e2e -- --grep @live`): **4/4**, twice. Test 1 now includes the repeat click: works 151339262 (3P), walled 151292997, ugoira 151301221 (MP4 and ZIP only); the repeat landed in `<folder> (1)/` with clean names on real Chrome history.
  - New tests: 12/12 at `--repeat-each=3`, then 4/4 after formatting.
- **Failing:** 0.
- **Skipped:** 6 in headless runs, the "Chrome toolbar" tests (skip with the reason "this Chromium shows no download UI at all (headless)"). All 6 pass headed.
- **Flaky** (failed, then passed on framework retry): 0.
- **Bundle size:** 35.4 KB minified / 13.1 KB gzip (budget 40 / 15).

## Mock Coverage Summary
- **CUJs with mocks compared:** 5. All 13 mocks re-rendered to `docs/qa-artifacts/iter5-00-09-39/mocks/`, pill crops `*-row0.png`.
- **CUJs without mocks (`NO_MOCK`):** 0.
- **Compared this run:**
  - new `cuj-1-saved-again.html` ↔ `cuj-1/run{1,2}/08-redownload-row.png` and `fs-e2e-02-second-sibling-1-row.png`: same face (white, 1.5 px `#0096FA`, check, `Saved · 12P`, 164 × 40). The mock renders the tooltip visibly; in the product it is the native `title` tooltip, verified as text: `Saved to Downloads/pixiv/みずき-135882741 (1)`.
  - `cuj-3-initial.html` ↔ `cuj-3/run{1,2}/contrast-{light,dark}.png`: links `#0b6fc2` (light) / `#0096FA` (dark), selected segment `#0b6fc2` with white semibold text, match.
  - CUJ-1/2/4/5 crops as in iteration 4 (`06-saved-row`, `03-progress-row`, `02-tab-b-busy-row`, `04-retry-3-failed-row`, `03-encoding-row`): unchanged.
- **Placeholder regions:** the mocks' artwork image placeholders, verified by layout only.

## How the product was driven
- **Builds:**
  - e2e build `dist-e2e/` at HEAD (test hooks, debug logs);
  - store zip `npm run zip` → `helper-for-pixiv-1.0.0.zip`, 17 files, 184.3 KB, sha256 `2d3d6fa7…44bc`, unzipped into an empty scratch dir; no `__hfpTest` / `testHook`; manifest `1.0.0`, permissions `downloads, storage, offscreen, declarativeNetRequestWithHostAccess, downloads.ui`, hosts `www.pixiv.net` / `i.pximg.net` (unchanged);
  - dev build `dist/` for the live smoke;
  - discriminators, built in scratch worktrees and removed afterwards: pre-D16/D15 `5508a46`, pre-R-007-item-6 `f15466a`.
- **Browser:** Chrome for Testing 156.0.8078.4 via `e2e/harness/launch.ts`, a fresh profile per walk, against the fake pixiv (`e2e/server/`), headless for functional walks, headed for the R-006 matrix.
- **Walk scripts:** `docs/qa-artifacts/iter5-00-09-39/walk-scripts/`, run with `run.mjs`.
  - Carried from iteration 4 and updated for D15: `cuj1.ts` (step 8 now checks the `(1)` sibling, the untouched plain folder, tooltip and aria; the tab-closed check reads `(1)`), `cuj2.ts` (the re-runs of 136004513 and 136004517 land in `(1)`), `r006.ts` (the re-download's bubble row is `metadata.json`), `twoTabsProbe.ts` (D16 exit checks, `SPY_SEARCH`).
  - New: `cuj1folders.ts` (walk d), `graceProbe.ts` (b), `cuj3contrast.ts` and `cuj5meta.ts` (e).
  - Superseded logs (before the script updates) are kept as `logs/superseded*-*.log`. Each failure there was a script expectation of the pre-D15 behaviour, re-checked against the PRD.

## Per-CUJ Verification

### CUJ-1: Download an illustration or manga from the artwork page — FAIL

Walked end to end twice (`cuj1.ts` run1 / run2: main, cancel, edge, late metadata; 62 checks each, 0 failed), the folder-choice walk (`cuj1folders.ts`: run1 and run2 on the e2e build 26/26 each, store zip 22/22), the R-006 matrix ×2, and the race probes.

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | One button left of Like ≤ 500 ms | both (+live) | PASS | PASS | PASS |
| 2 | `Download · 12P` / `Download` | both | PASS | PASS | PASS |
| 3 | 164 px in every state | both | PASS (also on `(1)` / `(2)` Saved) | PASS | PASS |
| 4 | `metadata.json` + 12 originals, sizes = Content-Length | both (+live) | PASS (sha256 = served) | PASS | PASS |
| 5 | `metadata.json` 12 keys, literal non-ASCII | both | PASS | PASS | PASS |
| 6 | ≤ 5 in flight | both | PASS | PASS | PASS |
| 7 | (R-007) `N / 12` rises; alone it tops at `11 / 12` and `Saved · 12P` follows ≤ 300 ms; concurrent `12 / 12` may flash | both | PASS: 16 race12 + 4 matrix + walks top at `11 / 12`; `Saved` 2–54 ms after the last file | PASS | PASS |
| 8 | Cancel face; stops; files stay; no error style | both | PASS | PASS | PASS |
| 9 | (refined) `Saved · 12P`, tooltip = the folder actually used | both | PASS: tooltip and aria named plain / `(1)` / `(2)` / plain / `(1)` / plain in turn | PASS | PASS |
| 10 | SPA away/back keeps Saved; reload idle | both | PASS | PASS | PASS |
| 11 | (refined) Saved click → `… (1)/` with 13 clean names; first folder unchanged; tooltip `(1)` | both (+live) | PASS: names, sizes, mtimes of the plain folder unchanged | PASS | PASS |
| 12 | (refined) third run → `(2)` | both | PASS | PASS | PASS |
| 13 | (refined) after moving/deleting the plain folder, next run → plain, no new `(n)` | both | PASS after waiting 10.5 s (moved; also the plain deleted with `(1)`,`(2)` kept); no `(3)` | PASS | PASS (see spec conflict for clicks within 10 s) |
| 14 | (refined) no parent folder ever gets ` (n)` | both | PASS (no `pixiv (n)/` across 6 runs) | PASS | PASS |
| 15 | (refined) history cleared, files on disk → plain with `135882741_p0 (1).jpg` … `metadata (1).json` | both | PASS (`chrome.downloads.erase({})` erased 13) | PASS | PASS |
| 16 | Tab closed: job completes | both | PASS (job in `(1)`, as the cancelled run's p0/p1 were present) | PASS | PASS |
| 17 | Badge = pages left; gone at the end | both | PASS | PASS | PASS |
| 18 | (R-006) one animation with the last file; bubble lists 13 | both (headed) | PASS (matrix `twelve` incl. re-download; race12 16/16, 13 rows) | PASS | PASS |
| 19 | Keyboard, focus ring, `aria-busy` | both | PASS | PASS | PASS |
| 20 | Dark theme identical | both (fake only) | PASS | PASS | PASS (live NOT_RUN: login) |
| 21 | Pattern changed mid-job keeps the job's folder | automated | PASS (e2e) | PASS (e2e) | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Same artwork in two tabs, second click after A's originals began landing | B → `(1)`, clean names | gaps ≥ 49 ms: B in `(1)` (12 runs); e2e 'second click after the first originals landed' | same | PASS |
| Same artwork, same instant | both may share the folder with per-file suffixes | gaps ≤ 31 ms: shared folder, `metadata (1).json` (20 runs). With a search spy, B's folder search ran 1–34 ms **before** A's first original finished in every shared run (8/8), so the choice followed the PRD rule | same | PASS |
| Same artwork at a click gap of 0 (D16) | both jobs `Saved`, every file | 16/16 (e2e + zip), 26 files, two `metadata` files | — (repeated probe) | PASS (iteration-4 LOW resolved) |
| First folder moved / deleted (≥ 10 s before the click) | plain again | plain, 13 files; the moved folder keeps its 13 | same | PASS |
| Files inside renamed (`01.jpg` …) | plain again, no `(1)` folder | plain; 12 clean originals beside `01…12`; `metadata (1).json` (uniquify, `metadata.json` was not renamed) | same | PASS (new e2e pins it) |
| Gaps: plain + `(2)` kept, `(1)` deleted / plain deleted, `(1)` kept | `(1)` / plain | `(1)` / plain | same | PASS |
| History cleared | plain + per-file ` (1)` | as expected; no `folder choice` log line | same | PASS |
| Token-free `pixiv` (set on the real options page) | artworks share `pixiv/`; repeat → `pixiv (1)/` | `metadata.json` + `metadata (1).json` in `pixiv/`; repeat of 135882741 → `pixiv (1)/` (13); repeat of 135882742 → `pixiv (1)` too (only its own files counted) | same; zip same | PASS |
| **Records outside `<Downloads>/<folder>/`** (§4.3 "Present") | plain: `<Downloads>/pixiv/みずき-135882741/` holds nothing | download location changed (same profile, relaunched with a new Downloads dir): `… (1)`; pattern `x/pixiv/{artist}-{id}` then default: `… (1)`. SW log `records: 12, surviving: 12, chosen: … (1)` | — (deterministic, 1 run per scenario) | FAIL (`[LOW][BUG]`) |
| Move, then click at once (inside Chrome's 10 s re-check window) | PRD: plain | `(2)` (stale `exists`) | `(2)` | Spec conflict (not a bug; see Recommendations 2) |
| 200-page manga, alone | `0 / 200` … `199 / 200`, then `Saved · 200P` | DOM label log `199 / 200` → `200 / 200` → `Saved · 200P` | `199 / 200` → `Saved · 200P` | PASS with note: the DOM-only, unpainted instant recorded in design-download-engine.md "When N / N can still show" and accepted by pm (R-007 item 1, pm-review 5e: no further probing) |
| R-006 rows (step 2, cancel, user's own download, single image ± metadata, worker restart) | as PRD | matrix 137/137 | 137/137 | PASS |

#### Manual Verification Notes
- **The folder choice is real, not fabricated.**
  - QA's spy on `chrome.downloads.search` saw the regex query twice per repeat run (≈ 250 ms apart) and once per first run.
  - The outcome followed the disk: moving, deleting or renaming files changed the next folder; erasing history changed it back to per-file suffixes.
  - The SW's `debug` line named the same folder as the tooltip in every e2e-build run (`records: 36, surviving: 24, chosen: pixiv/みずき-135882741` after the move). The store zip has no debug output and behaved identically.
- **Timing** (headless, fake pixiv):
  - busy face 2–3 ms after every click, first or repeat;
  - click → `Saved` 86–96 ms on a first run, 313–347 ms on a repeat run (the 250 ms re-check wait, as designed, since the fake's `/pages` answers in a few ms);
  - headed 12-page burst (race12-nohold ×8): store zip **141–157 ms**, e2e 142–168 ms; A/B on the pre-D15/D16 build the same day: 142–160 ms; iteration 4: 133–163 ms. No measurable cost on a first run.
- **Visual:** `08-redownload-row.png` and `fs-e2e-02-second-sibling-1-row.png` match `cuj-1-saved-again-row0.png`.

#### Artifacts
- **Screenshots:** `docs/qa-artifacts/iter5-00-09-39/cuj-1/run1/` and `.../run2/`: `00-initial` … `09-reload-idle`, `edge-*`, `fs-e2e-00 … 06` (series), `fs-zip-*`, `fr-*` (rename), `fh-*` (history), `ft-*` (token-free), `fu-*` (ugoira), `fx-*` (residual), `fn-*` (nested), `fd-*` (download-location change), `r006-*`.
- **Walk records:** `cuj-1/run{1,2}/folders-*-walk.json` (incl. `sw-folder-log`, `timings`), `two-tabs-*/job-snapshots.json`.
- **Logs:** `logs/race-*.log`, `logs/sweep-*.log`, `logs/search-same-gap*.log`, `logs/walk-cuj1*.log`, `logs/r006-*.log`.
- **Console:** 0 errors in every CUJ-1 walk and probe.
- **Network verified:** ≤ 5 in flight; each repeat run requested every original once more; no original requested twice within one run.
- **Mocks:** `cuj-1-initial.html`, `cuj-1-downloading.html`, `cuj-1-saved.html`, `cuj-1-saved-again.html`, `cuj-1-dark.html`.

#### Issues Found
- `[LOW][BUG]` The folder check counts this artwork's files outside `<Downloads>/<folder>/` (a changed download location, or a pattern whose folder ends with the current one), so the run uses `(1)` with no plain folder in the Downloads dir. `src/shared/folder-choice.ts:18-21` (`folderCheckRegex`: `(?:^|SEP)` anchors only the first pattern segment, not the Downloads root).

### CUJ-2: Download an ugoira — PASS

`cuj2.ts` ×2 (main, variants, edge; 44 checks each, 0 failed), R-006 `ugoira` / `ugoira-zip` ×2 headed, live ugoira 151301221 ×2 (MP4 with H.264, ZIP only).

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1–13 | Idle hint, 176 px, percent rules, badge 1, folder contents, zip identical, frames.json, durations, even size, playback, ZIP only, cancel in encode, tab closed, no H.264 → WebM | both (+live) | PASS (ffprobe: 4 frames 40/40/500/40; 601×451 → 600×450) | PASS | PASS (VLC: L5) |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Re-run of a saved ugoira (D15) | `<folder> (1)/` with zip, `frames.json`, video, `metadata.json` | `pixiv/ひなた-136004512 (1)/` with the 4 files (`cuj1folders.ts` ugoira); WebM-then-MP4 of 136004513 → `(1)` | same | PASS |
| Tab closed mid-encode after a cancelled encode | the video lands | lands in `(1)` (the cancelled run's zip and `frames.json` are present); the video is the final hand-off | same | PASS |
| R-006: one animation with the video / `frames.json` | as PRD | matrix PASS | PASS | PASS |

#### Artifacts
- **Screenshots:** `cuj-2/run{1,2}/`, `cuj-1/run{1,2}/fu-e2e-01-ugoira-repeat.png`.
- **Console:** 0.
- **Mocks:** `cuj-2-initial.html`, `cuj-2-encoding.html`.

#### Issues Found
- none

### CUJ-3: Configure the extension from the toolbar icon — PASS

Regression only (no options change since R-007 item 4, `f15466a`, which QA had not walked before). `cuj3.ts` ×2 (main + en/ja/zh_CN/zh_TW, 72 checks each), `cuj3contrast.ts` ×2, all @cuj3 e2e tests.

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1–17 | As iteration 4 | both | PASS | PASS | PASS |
| R-007 item 4 | Links `#0b6fc2` light (4.82:1 on `#f6f7f9`), `#0096FA` dark (6.02:1 on `#121212`); selected segment `#0b6fc2`, white semibold (5.16:1), both themes | both | PASS: computed colours and ratios exactly as specified | PASS | PASS |

#### Artifacts
- **Screenshots:** `cuj-3/run{1,2}/` (main, locales, `contrast-light.png`, `contrast-dark.png`).
- **Console:** 0.
- **Mocks:** `cuj-3-initial.html`, `cuj-3-error.html`, `cuj-3-saved.html`.

#### Issues Found
- none

### CUJ-4: Follow several downloads at once from the toolbar badge — PASS

`cuj4.ts` ×2 (main, edge, restart-cancel; 28 checks each, 0 failed), R-006 `two-b-first` / `two-a-first` / `restart` ×2 headed, the race probes and the grace-close probe.

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1–4 | Badge 23 / colours / tooltips; per-tab progress; ≤ 1 s countdown | both | PASS (61–88 ms) | PASS | PASS |
| 5 | A second artwork starts at once; neither waits | both | PASS: B starts 35 ms after its click; click gap 0: 16/16, sweep 20/20 (two artworks); grace-close: 111/111 | PASS | PASS (iteration-4 LOW resolved) |
| 6–10 | Cancel one job; gone at the end; `999+`; SW restart ≤ 1 s; toolbar click | both | PASS | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Same artwork in two tabs (refined) | `24`, "across 2 downloads"; `(1)` once A's originals landed | as CUJ-1 edge; e2e both variants | same | PASS |
| Second job ~5 s after a busy period (grace close) | B saves fully | 100/100 e2e, 11/11 zip, slowed close 15/15 | — | PASS |
| R-006 two jobs, one animation; restart | as PRD | matrix PASS | PASS | PASS |

#### Artifacts
- **Screenshots:** `cuj-4/run{1,2}/` (`01-…` … `06-…`, `edge-*`, `two-artworks-*`, `grace-*` failure shots: none taken, no failure).
- **Probe records:** `cuj-4/run1/grace-*-walk.json`, `cuj-4/run1/two-artworks-*/job-snapshots.json`.
- **Console:** 0.
- **Mocks:** `cuj-4-initial.html`.

#### Issues Found
- none

### CUJ-5: Recover when a download can't start or breaks — PASS

`cuj5.ts` ×2 (parts A–C, 48 checks each), `cuj5meta.ts` ×2 (5 checks each), R-006 `retry3` / `403` / `403-last` / `unavailable` ×2 headed, new e2e tests.

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1–16 | As iteration 4 | both | PASS | PASS | PASS (live post-login: NOT_RUN) |
| 6 (step 5 refined) | Retry → only the failed pages, into the job's folder, suffix included, no new folder check | both (new e2e) | PASS: a repeat run failing 3 pages in `(1)`; Retry started only `(1)/p4, p9, p11`; one `folder choice` log line in total | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Pages and `metadata.json` both failed (R-007 item 6) | `Retry · 3 failed`, usual tooltip; Retry re-writes both → `Saved · 12P` | 9 pages on disk, no `metadata.json`; after Retry `metadata.json` + p4/p9/p11 started; 13 files | same | PASS (fails on the pre-R-007 build: `metadata.json` missing) |
| Only `metadata.json` failed | `Retry`, `All 12 pages saved. metadata.json couldn't be saved. Click to retry it.` | as specified; Retry wrote only `metadata.json`, no original requested | — (e2e ×4) | PASS |
| Partial failure, then reload and click (refined) | full job → `(1)` | `(1)` with 13; partial folder untouched (e2e, walk) | same | PASS |
| 403 mid-job, log in, click (refined step 9) | `(1)` | `(1)` (e2e) | same | PASS |
| Step 5 retry counter (R-007 item 1) | `9 / 12` → `11 / 12` → `Saved · 12P` | as specified | same | PASS |

#### Manual Verification Notes
- Console (main walk, 51 per run, all injected): 44 × 504, 1 × 403, 1 × 404, 4 × `ERR_CONNECTION_REFUSED`, 1 `[hfp:offscreen] EncodeError`. `meta-retry`: 24 × 504 (6 pages × 4 attempts).
- `metadata.json`'s failure was injected by a wrapper around the real `chrome.downloads.download` in the SW; every other file went through Chrome.

#### Artifacts
- **Screenshots:** `cuj-5/run{1,2}/` incl. `meta-01-retry-3-failed`, `meta-02-saved-after-retry`, `meta-03-sibling-retry-3-failed`, `meta-04-sibling-saved`.
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
- `[LOW][BUG]` **The folder check counts files outside `<Downloads>/<folder>/`.** CUJ-1. `src/shared/folder-choice.ts:18-21`.
  - **PRD:** §4.3 "Folder choice": present means a completed record whose path is `<Downloads>/<folder>/` or `<Downloads>/<folder> (n)/` followed by a file of this artwork, whose file still exists.
  - **What happens:** `folderCheckRegex` matches `(?:^|[\\/])pixiv[\\/]みずき-135882741(?: \((\d+)\))?[\\/]135882741[_.][^\\/]*$` anywhere in the absolute path. Any surviving record whose path *ends* with the folder counts, wherever its root is.
  - **Repro 1, download location changed:** profile P with Downloads dir A, click Download on 135882741 (→ `A/pixiv/みずき-135882741/`). Relaunch P with Downloads dir B (Chrome Settings → Downloads → Location). Click Download → `Saved to Downloads/pixiv/みずき-135882741 (1)`; `B/` holds only `pixiv/みずき-135882741 (1)/`.
  - **Repro 2, a longer pattern:** pattern `x/pixiv/{artist}-{id}`, download, then the default pattern, download → `pixiv/みずき-135882741 (1)` with no plain folder.
  - **Command:** `RUN=run1 SECTIONS=nested,dirchange node docs/qa-artifacts/iter5-00-09-39/walk-scripts/run.mjs docs/qa-artifacts/iter5-00-09-39/walk-scripts/cuj1folders.ts`.
  - **Impact:** a needless ` (1)` on the folder name; no file lost, overwritten or misplaced. The download-location case is the realistic one.
  - **Severity LOW:** cosmetic naming, an uncommon trigger.
  - **Fix options (tl):** anchor the match to the Downloads root. The extension cannot read the Chrome setting, but the history can approximate it (e.g. the newest download's directory). Or pm accepts the behaviour in §4.3 as a limitation.
  - Not pinned in e2e: the deterministic repro is the script above; a red pin would block the suite for a LOW (same convention as iteration 4).

## Coverage Gaps
Acceptance criteria with Coverage = `none`: none.

Remaining verification limits:
- **Chrome's toolbar** is observable only headed; the 6 "Chrome toolbar" e2e tests skip, with a reason, in the headless gate command.
- **Windows** backslash paths for the folder regex: unit-tested only; L5 (`docs/release-checklist.md` §2).
- **In-flight close on real Chrome:** an unslowed job start never coincided with a ≤ 1 ms `closeDocument`; rule (a) was exercised with a slowed close (wrapper) and is pinned at L2 by a held close.
- **Live logged-in paths** (NOT_RUN, no account) and the **L5 items**: unchanged, `docs/release-checklist.md` §2–3.

## New Tests Written
All pass on HEAD (12/12 at `--repeat-each=3`; in the final gate run).

- `e2e/cuj1.spec.ts`: `readFile, rename, stat` import, and the new block `CUJ-1: QA gate additions (iteration 5)` (`@cuj1`):
  - `re-download: after the pages inside the first folder are renamed (01.jpg …), the next click uses the plain folder again, no "(1)" folder`. Covers the CUJ-1 edge "Renaming the files inside the folder (e.g. to 01.jpg) has the same effect" (AC 13 family). It pays one `expireExistenceCheck()` (10.5 s).
- `e2e/cuj5.spec.ts`: `readFile` / `path` imports, `recordSwLog` import, the header comment on what is covered, helpers `refuseMetadataHandOff` / `metadataRefusals`, and the new block `CUJ-5: QA gate additions (iteration 5)` (`@cuj5`):
  - `partial in a sibling folder: … the Retry fetches only those 3 into "(1)", with no new folder check → Saved · 12P naming "(1)"`. Covers CUJ-5 step 5 "suffix included … the folder check is not run again", which had only L1/L2 coverage before.
  - `pages and metadata.json both failed: … the Retry writes metadata.json and the 3 pages → Saved · 12P with all 13 files`. Covers the R-007 item 6 edge. Discriminates: fails 2/2 on the pre-R-007 build `f15466a` (`logs/mutation-prer007-metadata-retry.log`).
  - `only metadata.json failed: Retry with "All 12 pages saved. metadata.json couldn’t be saved. Click to retry it."; the Retry writes only metadata.json → Saved · 12P`. Covers the CUJ-5 edge that `cuj5.spec.ts` listed as "Not covered here".
- `e2e/README.md`: the CUJ-1 "First folder moved or deleted" row names the renamed-files test; three CUJ-5 edge rows added; Prettier re-flowed the table widths.
- **QA walk scripts** (not part of the suite), in `docs/qa-artifacts/iter5-00-09-39/walk-scripts/` (git-ignored): `cuj1folders.ts`, `graceProbe.ts`, `cuj3contrast.ts`, `cuj5meta.ts` (new); `cuj1.ts`, `cuj2.ts`, `r006.ts`, `twoTabsProbe.ts` (updated for D15 / D16).

## Recommendations
1. **(LOW, tl → coder or pm) Folder check scope.** Anchor the folder check to the current Downloads root, or have pm accept "a record of the same folder under another Downloads location counts" in §4.3. Re-run `cuj1folders.ts SECTIONS=nested,dirchange`; expect the plain folder.
2. **(pm, spec conflict, already system.md §15 item 1) The 10 s existence re-check limit.**
   - PRD §4.2 says the re-check "takes at most a few hundred ms", and CUJ-1 AC 13 / the "First folder moved" edge promise the plain folder on the next run.
   - Chrome re-checks at most once per 10 s per profile, and the previous job's own searches start that clock. Measured: moving the plain folder and clicking at once gives `(2)` instead of the plain folder (2/2); waiting 10.5 s gives the plain folder (every walk).
   - tl's suggested wording "after at least 10 s" would make the AC true as built. No code change is possible from the extension.
3. **(pm, spec precision, info)** The 200-page edge says `199 / 200`, then `Saved · 200P`. A lone 200-page job can still hold `200 / 200` in the DOM for an instant (1 of 2 walks, unpainted in iteration 4's frame sampling), the residual design-download-engine.md records as accepted. Consider "(an unpainted instant of `200 / 200` can occur)", or leave it as recorded.
4. **(release, owner)** `package.json` / manifest are still `1.0.0` while 1.0.0 is live. `docs/release-checklist.md` line 7 covers the bump before the next submission. Also: §2's new two-tabs ×5 item and the repeat-download item, plus §3 logged-in checks.
