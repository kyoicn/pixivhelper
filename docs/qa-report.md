# QA Report

Last updated: 2026-10-23 04:17:56 (UTC-7)
Scope: all active PRDs (prd-000, CUJ-1 … CUJ-5, with the R-003 amendments to CUJ-1's precondition and CUJ-5 Part A). Iteration 2, run-id `iter2-03-48-13`.

## Verdict: FAIL

4 bugs, all LOW (0 CRITICAL / 0 HIGH / 0 MEDIUM / 4 LOW: 3 BUG, 1 VISUAL_DEVIATION). One is new (a pasted pattern keeps its line breaks as spaces, CUJ-3). Three are carried over or already known: the outage tooltip is fixed for most clicks but one of 7 still says "No connection" (CUJ-5); the floating fallback appears 11–23 ms after the 3 s mark (CUJ-5, known design item); the ugoira pill is 176 px against the PRD's 164 px (CUJ-2, known spec conflict).

CUJ results: CUJ-1 PASS, CUJ-2 FAIL (carried-over spec conflict only), CUJ-3 FAIL (LOW edge case), CUJ-4 PASS, CUJ-5 FAIL (2 LOW). No CUJ is BLOCKED or UNIMPLEMENTED, and no walk step is incomplete: every CUJ was walked twice on the fake pixiv, and the logged-out paths of CUJ-1, CUJ-2 and CUJ-5 were also walked twice on live pixiv. The live R-003 walks include the login wall on 151107515 and a click made before the metadata arrived.

Not verified live (NOT_RUN, because QA has no pixiv account):
- CUJ-5 AC 2 and AC 4: the page after a real login;
- CUJ-5 AC 8: R-18 display off;
- CUJ-1 AC 15: pixiv's dark theme;
- the logged-in action-row DOM.

These rest on the fake-pixiv walks and on `docs/release-checklist.md` §3.

## Automated Test Summary
- Total tests: 2925 (pre-existing: 2916 = 2810 vitest + 102 e2e + 4 live smoke; new: 9 e2e)
- Passing: 2924 at the final runs
  - vitest 2810/2810 (62 files), in both `npm run check` runs
  - e2e 110/111, in two consecutive full runs (1.2 min each)
  - live smoke 4/4 in each of 3 consecutive runs (23.8 s, 23.7 s, 23.6 s)
- Failing: 1, deterministic (it failed in every run, 6 of 6). This is a finding, not a test problem:
  - `e2e/cuj3.spec.ts` "CUJ-3: QA gate additions (iteration 2) › edge: newlines: a pasted pattern with line breaks lands on one line without them and validates as usual"
  - Received `"pixiv/ {artist} -{id}"`, expected `"pixiv/{artist}-{id}"`.
- Skipped: 0. The MP4/H.264-gated and `@ffprobe` tests ran: the CfT probe reports `avc1.64001f`, and ffprobe/ffmpeg are installed.
- Flaky (failed-then-passed): 0. The 9 new tests passed 3 of 3 times with `--repeat-each=3` (24/24), except the deterministic paste failure.
- The pre-existing suite was run before any new test was added: `npm run check` green, `HFP_HEADLESS=1 npm run test:e2e` 102/102 (1.1 min).
- Logs: `docs/qa-artifacts/iter2-03-48-13/logs/`
  - `check-{1,2}.log`
  - `e2e-{1,2,3}.log`
  - `live-{1,2,3}.log`
  - `new-tests-*.log`

## Mock Coverage Summary
- CUJs with mocks compared: 5. All 12 files under `docs/ux/prd-000-mvp-mockups/` were rendered to `docs/qa-artifacts/iter2-03-48-13/mocks/`, with pill and row crops in `*-row0.png`. The mocks are unchanged since iteration 1.
- CUJs without mocks (`NO_MOCK`): 0.
- Placeholder regions: none.
- Intentional deviations, not logged per the orchestrator, pending pm's `/spec-sync`. Measured values:
  - options page `Saved` (light): `rgb(24, 128, 56)` = `#188038`;
  - validation text (light): `rgb(197, 34, 31)` = `#c5221f`;
  - "Still using" line: `rgb(92, 97, 102)` = `#5c6166`;
  - `Unavailable` button text: `rgb(95, 99, 104)` = `#5f6368`.

## How the product was driven
- **Fake pixiv (L3 harness):** scripted Playwright walks against Chromium launched by `e2e/harness/launch.ts`. This is the real unpacked `dist-e2e/` extension with the real `chrome.downloads`, DNR, offscreen document and WebCodecs, talking to `e2e/server/`.
  - Each CUJ was walked as `run1` and `run2`, each on a fresh profile and downloads directory.
  - Every "User sees" item was asserted from:
    - the live DOM (the closed shadow root, read over CDP);
    - the `chrome.action` getters and `chrome.downloads`;
    - the server request log;
    - the files on disk.
  - Screenshots were compared visually with the mock crops.
- **Production timing:** the dev build `dist/` against the fake server, with the real 1.5/3/6 s backoff. This was used for the outage replay (`walk-scripts/diagOutage.ts`): 5 replays of 7 clicks each.
- **Store artifact:** `npm run zip`, unzipped into an empty directory, was loaded as the extension for one CUJ-1 download (`walk-scripts/prodzip.ts`).
- **Live pixiv:** the dev build, logged out:
  - the `@live` smoke, 3 runs;
  - 2 instrumented all-ages download walks (`live.ts`);
  - 2 all-ages ugoira walks, MP4 and ZIP only (`liveugoira.ts`);
  - 2 login-wall/R-18 walks, with CDP request recording (`livewall.ts`).
- **Browser surface:** the Playwright MCP browser cannot load an unpacked extension, so the harness-launched Chromium is the canonical surface (design-test-harness.md "QA role usage"), as in iteration 1.
- **Where things are:**
  - walk scripts: `docs/qa-artifacts/iter2-03-48-13/walk-scripts/`;
  - per-walk observations: `.../<cuj>/<run>/<section>-walk.json`;
  - console logs: `*-console.json`;
  - the fake server's request log: `*-server-log.json`.

## Resolved in iteration 2 (iteration-1 bugs)
- **Resolved:** `[LOW][BUG]` CUJ-3 "a residual `✓ Saved` next to a validation error".
  - Repro as in iteration 1: insert the `{id}` chip (a valid save, `Saved` shown), then type `pixiv/{artst}-{id}` 791 ms later.
  - The folder `Saved` is empty while the error shows, in both runs (`cuj-3/run{1,2}/05-error.png`). It is still empty 2.6 s later, with the error still up.
  - The e2e test "saved: a valid save, then an invalid edit within 2 s: no Saved beside Download folder while the error shows" passes. It records every overlap with a MutationObserver and finds none.
- **Resolved:** `[LOW][FLAKY]` live smoke timeouts.
  - `@live` passed 4/4 in 3 consecutive runs, in 23.6–23.8 s each, against a 180 s budget.
  - Cases: download 151090277; walled 151107515 → `Log in to download` → `accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2Fen%2Fartworks%2F151107515`; ugoira 151105084 as MP4 (`avc1.64001f`) and as ZIP.
- **Partly resolved, still open:** `[LOW][BUG]` CUJ-5 "pixiv outage reads as No connection".
  - Iteration 1: clicks 4–7 of 7 said "No connection".
  - Now: 6 of 7 clicks say "pixiv isn't responding" in each of 5 replays, and the one remaining click is a new LOW finding (see CUJ-5).
- **Unchanged, carried over:** `[LOW][VISUAL_DEVIATION]` ugoira pill width. It measures 176 px: fake run1/run2, and live 151105084 in both runs. This is the documented spec conflict (system.md §15 item 10).
- **PM iteration-1 caveats, verified:**
  - Late metadata keeps a ≤ 99-page work at 164 px: 135882741 and 135882742 measured 164 → 164. The 200-page manga widens once, 164 → 170, as PRD §4.7.2 allows (`cuj-1/run*/edge-7-late-metadata-*`).
  - A token value made only of `~`/`.` resolves to `unknown` and never drops a folder level (new e2e test).
  - The live all-ages ugoira walk is done (CUJ-2).
- **QA recommendation 6, done:** `e2e/README.md` now maps CUJ-5 to `e2e/cuj5.spec.ts`.

## Per-CUJ Verification

### CUJ-1: Download an illustration or manga from the artwork page — PASS

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | One button, immediately left of Like, ≤ 500 ms after the row renders | both (+live) | PASS | PASS | PASS |
| 2 | `Download · 12P` / `Download` (single page) | both | PASS | PASS | PASS |
| 3 | 164 px in idle, busy, Cancel-hover, Saved; never changes (also with late metadata) | both | PASS | PASS | PASS |
| 4 | Folder = `metadata.json` + `135882741_p0…p11`; sizes = Content-Length | both (+live) | PASS | PASS | PASS |
| 5 | `metadata.json`: 12 keys in order, literal non-ASCII, `\n` kept | both (+live key check) | PASS | PASS | PASS |
| 6 | Never > 5 of this artwork's files in flight | both | PASS (peak 5) | PASS (peak 5) | PASS |
| 7 | `N / 12` rises; `12 / 12` only at the end; metadata never counts | both | PASS | PASS | PASS |
| 8 | Cancel face only after leaving once; cancel stops, keeps files, back to `Download · 12P` | both | PASS | PASS | PASS |
| 9 | `Saved · 12P` style; tooltip `Saved to Downloads/pixiv/みずき-135882741` | both | PASS | PASS | PASS |
| 10 | SPA away/back keeps Saved; reload shows idle | both | PASS | PASS | PASS |
| 11 | Clicking Saved re-downloads as ` (1)` duplicates | both | PASS (26 files) | PASS | PASS |
| 12 | Closing the tab does not stop the job | both | PASS | PASS | PASS |
| 13 | Badge = pages not yet complete; gone at the end | both | PASS | PASS | PASS |
| 14 | Tab / Enter / Space; 2 px `#0096FA` ring; `aria-busy` | both | PASS | PASS | PASS |
| 15 | Dark theme: identical fill/text/icon; `#5fb9fb` ring | both (fake only) | PASS | PASS | PASS (live NOT_RUN: theme needs a login) |
| 16 | Pattern changed mid-job: the running job keeps its folder | automated | PASS | PASS | PASS |
| P | Precondition (R-003): a walled all-ages work while logged out belongs to CUJ-5 | both | PASS (see CUJ-5 AC 4) | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| 200-page manga | ≤ 5 in flight; one width in every state | 170 px in every state; peak 2 in flight | same | PASS |
| Punctuation-heavy artist `  Sora / 空 :: 2nd  ` | `pixiv/Sora_空_2nd-135882744` | as expected (walk and new e2e) | same | PASS |
| Artist of only `~`, `...`, `~.~`, ` . ` (pattern `pixiv/{artist}/{title}`) | `unknown`; no empty segment | all four → `pixiv/unknown/Punctuation_テスト_2nd` (new e2e) | — | PASS |
| Late metadata (row first) | `Download` at the 2-digit width, then the hint; ≤ 99 pages stay 164 | 164 → 164 (12-page and 1-page); 200-page widens once, 164 → 170 | same | PASS |
| Tab closed mid-download | job completes; badge counts down | 8 → 0; 13 files | same | PASS |
| Reload mid-download | reattaches to live progress | `4 / 12`, `aria-busy` | same | PASS |
| Non-artwork pages | no button | none on `/users/…` after 3.5 s | same | PASS |
| Locale-prefixed `/en/artworks/<id>` | same button and download | e2e PASS; live pixiv redirects to `/en/…` and saves | — | PASS |
| Keyboard Enter starts, Space cancels | as specified | PASS | PASS | PASS |
| Live pixiv, logged out, all-ages | every page at Content-Length | 151102843 (3 PNG, 20.6 MB): Saved in 3.3 s, sizes = HEAD Content-Length, 12 metadata keys | Saved in 2.3 s, same | PASS |
| Store zip as the extension | same download works; no test hooks | `__hfpTest` undefined in the SW; `Saved · 12P`, 13 files | — | PASS |

#### Manual Verification Notes
- **Visual:** `00-initial-row`, `03-progress-row`, `04-hover-cancel-row`, `06-saved-row` and `edge-1-dark-focus-row` match the `mocks/cuj-1-{initial,downloading,saved,dark}-row0.png` crops (the mocks are at 2×): fill, text, icon, ring, outline, the gap to Like. On live pixiv, the pill sits in the real action row left of Like (`live-00-row.png`).
- **Fabrication checks:**
  - All 12 originals on disk are sha256-identical to the served bytes, each at the server's Content-Length.
  - `metadata.json` is derived from the fixture: `<br />` → `\n`, `&amp;` → `&`, tags in order, literal `みずき`.
  - The counter moved only as held originals were released.
  - The badge read `12` → `5` → `''`, with colors `[31,31,31,255]` / `[255,255,255,255]` from `chrome.action`.
  - After cancel, no page request reached the server, and only the 5 completed files plus `metadata.json` stayed.
- **Known PRD wording item (not filed):** keyboard Tab reaches the button after Like, because pixiv's row is `row-reverse`.

#### Artifacts
- Screenshots: `docs/qa-artifacts/iter2-03-48-13/cuj-1/run1/` (62 PNG) and `.../run2/` (60 PNG):
  - steps 1–8: `00-initial`, `01-hover`, `02-click-busy`, `03-progress`, `04-hover-cancel`, `04b-pointer-still-on-button`, `04b-hover-cancel`, `05-cancelled`, `06-saved`, `06-saved-hover`, `07-spa-other-artwork`, `07-spa-back`, `08-redownload`, `09-reload-idle`
  - edges: `edge-1-dark-focus`, `edge-2-keyboard-busy`, `edge-3-reload-mid-job`, `edge-4-sanitized-artist`, `edge-5-200-pages-{idle,saved}`, `edge-6-user-page-no-button`, `edge-7-late-metadata-{135882741,135882742,135882743}-{before,after}`
  - live: `live-00-initial`, `live-00-row`, `live-01-busy`, `live-02-end`
  - store zip: `prodzip-saved` (run1)
- Console messages (run1): fake walks 0. Live: 2 `browsingTopics` errors from pixiv's own page, none from the extension.
- Console messages (run2): 0.
- Network verified: one 200 per original, Referer enforced by the fake (it returns 403 without it), peak 5 in flight.
- Mocks: `cuj-1-initial.html`, `cuj-1-downloading.html`, `cuj-1-saved.html`, `cuj-1-dark.html`.

#### Issues Found
- none

### CUJ-2: Download an ugoira — FAIL

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | Idle `Download · MP4/WebM/ZIP` per setting (WebM without H.264) | both (+live) | PASS | PASS | PASS |
| 2 | Integer %, never decreases, no 100% early, ≥ 1 update/s in encode | both (+live) | PASS | PASS | PASS |
| 3 | Badge `1` for the whole job, gone at the end | both (+live) | PASS | PASS | PASS |
| 4 | Folder exactly zip, `frames.json`, `.mp4`, `metadata.json` | both (+live) | PASS | PASS | PASS |
| 5 | Zip byte-identical; `frames.json` = `ugoira_meta.body.frames` | both (+live sha256) | PASS | PASS | PASS |
| 6 | Duration = Σ delays; per-frame ±1 ms; frame count | both (+live ffprobe) | PASS | PASS | PASS |
| 7 | Width × height rounded down to even | both (+live) | PASS | PASS | PASS |
| 8 | Plays in Chrome, VLC, QuickTime | Chrome: both; VLC/QuickTime: L5 | PASS (Chrome) | PASS (Chrome) | PASS (GUI players: L5 checklist) |
| 9 | ZIP only: zip + `frames.json` (+ metadata), no video, `Saved · ZIP` | both (+live) | PASS | PASS | PASS |
| 10 | Cancel during encode: no video; zip + `frames.json` stay | both | PASS | PASS | PASS |
| 11 | Closing the tab during the encode still produces the video | both | PASS | PASS | PASS |
| 12 | No H.264 → hint, Saved label and extension say WebM | both (probe seeded `avc: null`) | PASS | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Step 1 "User sees": the same 164 × 40 px pill | 164 px | 176 px (fake); live 151105084: 176 px | 176 px; live 176 px | FAIL (carried-over `[LOW][VISUAL_DEVIATION]`, spec conflict) |
| Mixed delays 40/40/500/40 | exact | MP4 and WebM: 40,40,500,40 (620 ms) | same | PASS |
| Odd 601×451 | 600×450 | 600×450 | 600×450 | PASS |
| Settings change while idle | hint follows within 1 s | 1 ms | same | PASS |
| Live all-ages ugoira 151105084 (16 frames, 900×900) | MP4 + zip + frames.json + metadata | h264 900×900, 16 frames, per-frame = delays, 2240 ms = Σ; zip sha256 = `originalSrc` (3 442 344 B); `0,1,5,15,40%` → `Saved · MP4` | `0,2,8,21,40%` → `Saved · MP4`, same checks | PASS |
| Live ZIP only | zip + `frames.json` + metadata, no video | `Saved · ZIP`, ` (1)` copies, no second video | same | PASS |
| Logged out on a walled/R-18 ugoira | needs-login (CUJ-5) | `Log in to download`; no `ugoira_meta`, no zip request (new e2e) | — | PASS |

#### Manual Verification Notes
- **Encode phase:** captured under 60× CPU throttling of the offscreen document.
  - The pill read `46%`, with `aria-label` "Encoding MP4, 46 percent. Click to cancel."
  - The badge read `1`, and Chrome had 0 downloads in progress.
  - The zip and `frames.json` were already on disk.
- **ffprobe (example 136004512):** h264, 600×600, 48 frames × 100 ms = 4800 ms. The MP4 plays in a Chrome tab: 600×600, 4.8 s, `currentTime` reached 1.5 s.
- **Live:** the encode took about 130 ms, so the label went `40%` → `Saved · MP4`. Chrome showed no busy `100%`. "≥ 1 update/s while encoding" holds trivially there, and the long fixture (136004517) covers it in e2e.
- **Visual:** colors, ring, labels and the Saved style match `cuj-2-initial` / `cuj-2-encoding`. The pill is 12 px wider than the mock (see issue).
- **Known PRD wording items (not filed):**
  - ZIP-only and MP4 jobs go from the last busy percent straight to `Saved`, with no busy `100%`;
  - the mock's encoding tooltip says `Cancel`, while the PRD string is `Cancel download`.

#### Artifacts
- Screenshots: `.../cuj-2/run1/` and `.../run2/` (42 PNG each):
  - main: `00-initial`, `02-zip-phase`, `03-encoding`, `04-hover-cancel`, `05-saved`, `05-mp4-plays-in-chrome`
  - variants: `06-zip-only-{idle,saved}`, `07-webm-{idle,saved}`, `09-no-h264-{idle,saved}`
  - edges: `edge-1-cancel-encode-hover`, `edge-1-cancelled`, `edge-2-before-tab-close`, `edge-3-no-content-length`
  - live: `live-ugoira-00-initial`, `live-ugoira-00-row`, `live-ugoira-02-busy`, `live-ugoira-05-saved`, `live-ugoira-06-zip-only-{idle,saved}`
- Console messages (run1 / run2): fake 0. Live: 3 `browsingTopics` errors from pixiv's page, 0 from the SW or offscreen document.
- Mocks: `cuj-2-initial.html`, `cuj-2-encoding.html`.

#### Issues Found
- `[LOW][VISUAL_DEVIATION]` (carried over, spec conflict; no new code change requested) The ugoira pill is 176 px wide in English, in every state and both runs, and on live pixiv. PRD CUJ-2 step 1 and the `cuj-2-*` mocks show 164 px.
  - §4.7.2's widest-label rule forces 176 px, because `Download · WebM` is a reachable label.
  - Owner of the fix: pm `/spec-sync` (system.md §15 item 10).
  - `src/content/button/width.ts`

### CUJ-3: Configure the extension from the toolbar icon — FAIL

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | Toolbar opens a full tab `Helper for Pixiv — Settings` right of the current tab; again → focuses it | both | PASS | PASS | PASS |
| 2 | No popup | both | PASS | PASS | PASS |
| 3 | Defaults `pixiv/{artist}-{id}`, MP4, metadata on | both | PASS | PASS | PASS |
| 4 | Chips insert at the caret; exact tooltips | both | PASS | PASS | PASS |
| 5 | Preview `Downloads/pixiv/みずき-135882741/135882741_p0.jpg` | both | PASS | PASS | PASS |
| 6 | `{artst}`: red 2 px border, message, Still-using line ≤ ~400 ms; a download uses the last valid pattern | both | PASS | PASS | PASS |
| 7 | Each validation case's exact message | both (8 inputs) | PASS | PASS | PASS |
| 8 | Autosave; `Saved` (~400 ms / immediate); fades after 2 s; none beside an error | both | PASS (390 ms) | PASS | PASS |
| 9 | Reload shows the most recent values | both | PASS | PASS | PASS |
| 10 | A change during a download does not affect it | automated (cuj1/cuj2 mid-job) | PASS | PASS | PASS |
| 11 | Reset to defaults; `Saved` only beside changed sections | both | PASS | PASS | PASS |
| 12 | Footer content | both | PASS | PASS | PASS |
| 13 | Dark / light follows the OS | both | PASS | PASS | PASS |
| 14 | ja / zh_CN / zh_TW strings | both | PASS | PASS | PASS |
| 15 | Keyboard-only reach and operation | both | PASS | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Step 5 "No `Saved` appears": typo 791 ms after a chip save | no `Saved` beside the heading | none; none 2.6 s later | same | PASS (iteration-1 bug resolved) |
| Paste containing newlines (`pixiv/\n{artist}\r\n-{id}\n`, real clipboard, ⌘V) | "the single-line field drops newlines on paste" → `pixiv/{artist}-{id}` | `pixiv/ {artist} -{id}`; preview `Downloads/pixiv/みずき -135882741/…`; saved as typed | same | FAIL (`[LOW][BUG]`) |
| > 200 characters (typing and paste) | the field truncates | 200; a chip that would not fit inserts nothing (new e2e) | 200 | PASS |
| Invalid pattern, then tab closed | reopening shows the last valid pattern, no error | PASS | PASS | PASS |
| Two settings tabs | sync ≤ 1 s; an invalid draft is left alone | automated | — | PASS |
| `chrome.storage.sync` unavailable | saves to local, still `Saved` | L1/L2 only | — | PASS (automated) |

#### Manual Verification Notes
- **Visual:** `00-initial.png`, `05-error.png`, `07-webm-saved.png` and `01-dark.png` match `mocks/cuj-3-{initial,error,saved}.png` and the dark spec (`#121212`), apart from the intentional AA colours listed above.
  - In `07-webm-saved.png`, the folder `Saved` also shows: step 6's valid save came less than 2 s earlier, which is correct.
- **Locales:**
  - ja, zh_CN and zh_TW show no English UI strings.
  - Button widths: ja 177 px, zh_CN/zh_TW 155 px.
  - `aria_login` in all four locales carries the R-003 copy, and `grep -rn "R-18 work" src/_locales` prints nothing.
- **Toolbar:** the physical toolbar icon cannot be clicked from Playwright. The real handler was driven through `__hfpTest.clickAction`, as in iteration 1.

#### Artifacts
- Screenshots: `.../cuj-3/run1/` and `.../run2/` (22 PNG each):
  - `00-initial`, `00-initial-full`, `01-dark`, `03-edit-saved`, `04-chip-inserted`, `05-error`, `06-fixed`, `07-webm-saved`, `08-metadata-off`, `09-reset`, `10-footer`, `11-keyboard-focus-reset`
  - `12-locale-{ja,zh_CN,zh_TW}`, `13-button-{ja,zh_CN,zh_TW}`
  - `edge-paste-newlines` (+ `.json` with the pasted value and the preview)
- Console messages (run1 / run2): 0.
- Mocks: `cuj-3-initial.html`, `cuj-3-error.html`, `cuj-3-saved.html`.

#### Issues Found
- `[LOW][BUG]` (new) Pasting a multi-line pattern turns each line break into a space instead of dropping it. This contradicts the CUJ-3 edge case "the single-line field drops newlines on paste".
  - Repro: copy `pixiv/⏎{artist}⏎-{id}`, paste into the empty field.
  - Observed: the field holds `pixiv/ {artist} -{id}`, which validates, saves, and gives the folder `Downloads/pixiv/みずき -135882741/` (a literal space).
  - Cause: the page relies on HTML value sanitization (design-options-page.md:146, "strips CR/LF"), but Chromium sanitizes *user-inserted* text in an `<input type="text">` by replacing CR/LF with spaces. `src/options/page.ts` has no `paste`/`beforeinput` handling (`page.ts:76` sets only `maxLength`).
  - Reproduced by the real clipboard (⌘V) and by `keyboard.insertText`.
  - Pinned by the new failing e2e test `e2e/cuj3.spec.ts` "edge: newlines …".

### CUJ-4: Follow several downloads at once from the toolbar badge — PASS

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | 18 + 5 → badge `23`, `#1f1f1f`/white, "… 23 files remaining across 2 downloads" | both | PASS | PASS | PASS |
| 2 | One-job tooltip forms | both | PASS | PASS | PASS |
| 3 | Each tab shows only its own progress | both | PASS | PASS | PASS |
| 4 | Badge decreases ≤ 1 s after any file lands | both | PASS (88 / 91 ms) | PASS (89 / 90 ms) | PASS |
| 5 | A second artwork starts immediately | both | PASS (43 ms) | PASS (40 ms) | PASS |
| 6 | Cancelling one job drops the badge by its remainder | both | PASS | PASS | PASS |
| 7 | Last lands / cancelled / fails → badge gone, idle title | both | PASS | PASS | PASS |
| 8 | ≥ 1000 → `999+` | automated (5 × 200) | PASS | PASS | PASS |
| 9 | SW stopped mid-job: correct badge ≤ 1 s; jobs complete | both | PASS (91 ms) | PASS (91 ms) | PASS |
| 10 | Toolbar click while jobs run opens settings; jobs unaffected | both | PASS | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Step 1: badge after the first click | pages left, one-job title, within 1 s | `200`, "200 files remaining", 66 ms after the click | 65 ms | PASS |
| Ugoira in the mix | counts 1 | 6 + 1 = `7`, across 2 downloads | same | PASS |
| A job ends with failures | leaves the count | e2e "failed" + CUJ-5 | — | PASS |
| SW restart with an ugoira and a manga in flight | both finish | 13 files + mp4; badge empty | same | PASS |

#### Manual Verification Notes
- The PRD's 30-page manga has no fixture. Tab A is the 200-page manga with its last 18 pages held, which gives 18 + 5 = 23.
- Tab B's `3 / 8` matches `cuj-4-initial`.
- Badge values come from the `chrome.action` getters, because the toolbar cannot be captured.
- `logs/diag-badge-200.log` holds a 50 ms timeline: the badge goes from `''` to `200` 58 ms after the label shows `0 / 200`, and then tracks the label within one poll.

#### Artifacts
- Screenshots: `.../cuj-4/run1/` and `.../run2/` (19 PNG each): `01-tab-a-started`, `02-tab-a-busy`, `02-tab-b-busy`, `03-tab-b-saved`, `04-tab-a-hover-cancel`, `04-tab-a-cancelled`, `05-last-job-landed-badge-gone`, `06-toolbar-while-running`, `edge-1-ugoira-in-mix`, `edge-2-after-sw-restart`.
- Console messages (run1 / run2): 0.
- Mocks: `cuj-4-initial.html`.

#### Issues Found
- none

### CUJ-5: Recover when a download can't start or breaks — FAIL

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | Logged out, `xRestrict` 1 or 2: `Log in to download` (white, `#c4c7c5`, `#3c4043`, no icon), tooltip, no other text | both (R-18 + new R-18G e2e; live R-18 151107522) | PASS | PASS | PASS |
| 2 | Click → `accounts.pixiv.net/login?return_to=<encoded>`; after login `Download · 68P` | both (fake round trip); live: URL only | PASS | PASS | PASS (live post-login NOT_RUN: no account) |
| 3 | Logged out, all-ages shown: normal idle; download succeeds | both (+live) | PASS | PASS | PASS |
| 4 | (R-003) Logged out, all-ages behind the sensitive-content wall: `Log in to download` before any click, same style, tooltip, `aria-label` `Log in to pixiv to download this work.`, 164 px; click → login; after login `Download · NP` | both (fake 135882745 + 5 e2e tests; live 151107515) | PASS | PASS | PASS (live post-login NOT_RUN: no account) |
| 5 | `Retry · 3 failed`, red outline, warning triangle, same width, exact tooltip | both | PASS | PASS | PASS |
| 6 | Retry fetches only the 3 pages into the same folder → `Saved · 12P` | both | PASS | PASS | PASS |
| 7 | Network disconnected → `Retry` + "No connection…" | both (server stopped) | PASS | PASS | PASS |
| 8 | Logged in, R-18 display off → `Retry` + "pixiv refused this work…" | both (fake) | PASS | PASS | PASS (live NOT_RUN: no account) |
| 9 | Deleted after load → gray `Unavailable`; click does nothing | both | PASS | PASS | PASS |
| 10 | Encode fails: zip + `frames.json`, no video, `Retry · MP4` + tooltip; its click produces only the video | both + automated | PASS | PASS | PASS |
| 11 | 403 mid-job keeps saved files, back to `Log in to download` | both | PASS | PASS | PASS |
| 12 | No badge in error states unless another job runs | both | PASS | PASS | PASS |
| 13 | Cancelling never produces red or a message | both | PASS | PASS | PASS |
| 14 | Row removed before navigation → floating pill bottom-right of the artwork **within 3 s**; downloads | both | FAIL (3011–3023 ms in-page) | FAIL | FAIL (`[LOW][BUG]`, known design item) |
| 15 | 403 never retried; 429/500/502/503/504/network up to 4 attempts | both (dev build: 4 hits on the first click of each 500/503 replay) | PASS | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| R-003: click before the metadata arrived (fake: `/ajax/illust/135882745` held) | `Log in to download`; nothing beyond `/ajax/illust` | exactly 2 `/ajax/illust` 200s (render + resolver), then `Log in to download`; no `/pages`, no `i.pximg.net`, no file, no badge | same | PASS |
| R-003 live, 151107515 (`xRestrict` 0, `sl` 4, `urls.original` null) | `Log in to download` in the row; nothing fetched | row, 164 px, R-003 `aria-label`; the extension requested only `/ajax/illust/151107515` (CDP initiator); no offscreen document, no download; click → `…login?return_to=https%3A%2F%2Fwww.pixiv.net%2Fen%2Fartworks%2F151107515` | same | PASS |
| R-003 live race (both `/ajax/illust` calls held 4 s by `page.route`, click while pending) | `Log in to download`; no network | the pending pill (floating, because pixiv's own render was held too) took the click, moved into the row on release and showed `Log in to download`; extension requests = 2 × `/ajax/illust`; no `/pages`, `ugoira_meta` or original; no offscreen document, no download, no badge | same | PASS |
| R-003: walled all-ages **ugoira**; SPA into and out of a walled work; R-18G | needs-login; no `ugoira_meta`/zip | new e2e: all pass | — | PASS |
| Sustained pixiv 503/500, 7 user Retries (dev build, real timing) | every click: `Retry` + "pixiv isn't responding…" | 503: 6/7 (click 6: 0 server hits → "No connection"); 500: 6/7 (click 7) | 503: 6/7 (click 6); 500: 6/7 (click 6); run3 503: 6/7 (click 7) | FAIL (`[LOW][BUG]`, iteration-1 bug only partly fixed) |
| The same page with the fake pixiv stopped | "No connection…" | "No connection" (5/5 replays); then the server came back → `Saved` (5/5) | same | PASS |
| A 502 or 429 answer, then dropped connections on every attempt left (e2e build) | `Retry` + "pixiv isn't responding" | new e2e: PASS, 4 server attempts | — | PASS |
| pixiv server failure (5xx × 4, 0 saved) | "pixiv isn't responding…" | PASS (504) | PASS | PASS |
| Downloads folder not writable | "Chrome couldn't save…" | automated / iteration 1 (unchanged code path) | — | PASS |
| Floating fallback on the dark theme | `#5fb9fb` ring | PASS | PASS | PASS |
| Only `metadata.json` failed | `Retry` + `tip_metadata_only` | L1/L2 only (needs a single-file `chrome.downloads` failure) | — | NOT_RUN (not an AC) |
| `internal` failure (refused offscreen command) → not "No connection" | `server` cause | L1/L2 only (`outcome.test.ts`, engine tests); cannot be provoked from the page | — | PASS (automated) |

#### Manual Verification Notes
- **Visual:** these match `cuj-5-initial` / `cuj-5-retry`: outline weights, colors, no icon on needs-login, warning icon, hint at full opacity.
  - `01-needs-login`, `01b-walled-needs-login`
  - `04-retry-3-failed`, `08-encode-failed`
  - live: `live-wall-01-needs-login` (pixiv's real "This work may contain sensitive content" wall, with the pill in pixiv's row)
- **Fabrication checks:**
  - The needs-login state really blocks the download. On the fake, the walled work's `/pages` and `ugoira_meta` *do* answer logged-out requests, so a passing check proves that the extension withholds the download.
  - The race and live walks show no request beyond `/ajax/illust`, and no offscreen document is ever created.
  - The retry refetched only p4/p9/p11, and `chrome.downloads` saw only those 3.
  - The server log shows 4 attempts per failing page.
  - The floating pill really downloads 13 files.
  - The 403 was asked once.
- **Outage replay:** `walk-scripts/diagOutage.ts`, dev build, single-page work 135882742, every original answering 503 (or 500).
  - Server hits per click:
    - 503 run1: 4,3,2,2,1,**0**,1
    - 503 run2: 4,3,2,2,1,**0**,1
    - 503 run3: 4,3,2,1,1,2,**0**
    - 500 run1: 4,3,2,1,2,1,**0**
    - 500 run2: 4,3,2,2,1,**0**,1
  - Every click with at least one server hit now reads "pixiv isn't responding". Every click with 0 hits reads "No connection".
  - The offscreen console shows `Failed to load resource: Request throttled. Visit https://dev.chromium.org/throttling` 15 times in run3.

#### Artifacts
- Screenshots: `.../cuj-5/run1/` and `.../run2/` (79 PNG each, plus the outage and live shots):
  - Part A: `01-needs-login(-hover)`, `01b-walled-needs-login`, `01b-walled-hover`, `01c-walled-pending-metadata`, `01c-walled-clicked-before-metadata`, `01c-walled-race-needs-login`, `02-pixiv-login`, `02b-walled-pixiv-login`, `03-after-login-{idle,saved}`, `03b-walled-after-login-{idle,saved}`
  - Part B: `04-retry-3-failed`, `04-retry-hover`, `05-retrying`, `05-retry-saved`, `06-offline`, `06-back-online-saved`, `06-server-failure`, `06-refused`, `07-unavailable`, `08-encode-failed`, `09-403-needs-login`, `10-cancel-not-error`
  - Part C: `11-floating`, `11-floating-saved`, `11-floating-dark-focus`, `11-row-restored`
  - outage: `edge-outage-{503,500}-{click1,click7,server-stopped,back-saved}.png` + `edge-outage-*.json` (run1, run2; extra 503 replay in `run3/`)
  - live: `live-wall-01-needs-login`, `live-wall-01-row`, `live-wall-01-hover`, `live-wall-02-pixiv-login`, `live-wall-03-{pending-metadata,clicked-before-metadata,race-needs-login}`, `live-r18-01-needs-login`, `live-r18-01-row`
- Console messages (run1 / run2):
  - 63 / 59 entries, all from injected faults: 504/403/404 resource errors and `ERR_CONNECTION_REFUSED` while the server was stopped;
  - one expected `[hfp:offscreen] EncodeError` from the corrupt-frame fixture;
  - live: only pixiv's own page errors (`browsingTopics`, an ad server's CORS errors), none from the SW or offscreen document.
- Network verified:
  - per-request attempt counts and gaps in `main-server-log.json`;
  - the R-003 request lists in `main-walk.json` (`R-003-race-requests`) and `live-wall-walk.json` (`race`, `walled-ext-requests-before-click`).
- Mocks: `cuj-5-initial.html`, `cuj-5-retry.html`.

#### Issues Found
- `[LOW][BUG]` (iteration-1 bug, only partly fixed) During a sustained pixiv 500/503, one of 7 user Retries still ends "No connection. Retry when you're back online." although the user is online and pixiv is failing.
  - Reproduced in 5 of 5 dev-build replays: the 6th or 7th click.
  - On that click, Chromium's extension request throttling refused all 4 attempts locally, with 0 server hits.
  - The `lastStatus` rule is per request (`src/shared/retry.ts:58-73`, `:216-218`). A request that never got an answer in *this* click has no `lastStatus`, so `isUnanswered` (`src/shared/outcome.ts:27`, `:35`) classifies it `offline`.
  - system.md §15 item 6 names this exact residual: "if Chromium refuses all 4 attempts of a request locally … it still reads as 'No connection'; QA never observed that". It is observed now.
  - Direction for tl/pm:
    - remember the last 429/5xx per URL or host across jobs for Chromium's throttling window;
    - or adopt pm's job-level rule. In this job `/ajax/illust` and `/pages` answered 200 through the tab proxy, so the connection was demonstrably up.
- `[LOW][BUG]` (known design item, code-review W1) The floating fallback appears 11–23 ms *after* the 3 s that CUJ-5 step 11 and the AC allow. Measured in the page with `performance.now()`, 5 samples each (`logs/diag-float.log`):
  - direct load, `<figure>` inserted → host inserted: 3018–3023 ms;
  - SPA click → host inserted: 3011–3013 ms.
  - The timer starts at route entry and fires at exactly 3000 ms, before placement work (`src/content/mount.ts:213`). The code review's proposed first-route anchor (`FLOAT_FALLBACK_MS - performance.now()`) would not fix the SPA case, which also lands after 3 s.

## Bugs Found

### CRITICAL
- none

### HIGH
- none

### MEDIUM
- none

### LOW
- `[LOW][BUG]` (new) A pasted pattern's line breaks become spaces instead of being dropped (CUJ-3 edge "drops newlines on paste"). `pixiv/⏎{artist}⏎-{id}` saves as `pixiv/ {artist} -{id}` → folder `pixiv/みずき -135882741`. — CUJ-3 — `src/options/page.ts:76` (no paste handling); `docs/design/design-options-page.md:146`
- `[LOW][BUG]` (carried over, partly fixed) 1 of 7 Retries during a sustained pixiv 500/503 still reads "No connection", when Chromium throttles all 4 attempts of that click. — CUJ-5 — `src/shared/retry.ts:58-73`, `src/shared/outcome.ts:27,35`; system.md §15 item 6
- `[LOW][BUG]` (known design item) The floating fallback appears 3011–3023 ms after the artwork appears or the SPA navigation, not within 3 s. — CUJ-5 — `src/content/mount.ts:213`
- `[LOW][VISUAL_DEVIATION]` (carried over, spec conflict; no code change requested) The ugoira pill is 176 px against the 164 px of CUJ-2 step 1 and the `cuj-2-*` mocks. §4.7.2's widest-label rule requires it. — CUJ-2 — `src/content/button/width.ts`; pm `/spec-sync` (system.md §15 item 10)

## Coverage Gaps
Acceptance criteria with Coverage = `none`: none. Every AC of CUJ-1 … CUJ-5, including the R-003 ACs, has an automated check and/or a two-run manual walk.

Remaining verification limits:
- **Live logged-in paths (NOT_RUN, no account):**
  - CUJ-5 AC 2 and AC 4 second halves (the page after a real login);
  - CUJ-5 AC 8 (R-18 display off);
  - CUJ-1 AC 15 (pixiv's dark theme live);
  - the logged-in action-row DOM;
  - the R-003 stale-page probe.

  All five are on `docs/release-checklist.md` §3.
- **CUJ-2 AC 8:** VLC, QuickTime Player and Windows players are L5. This run verified Chrome playback and ffprobe on fake and live MP4s.
- **Automated only (L1/L2), no e2e:**
  - "only `metadata.json` failed";
  - `internal` failures (a refused offscreen command);
  - `chrome.storage.sync` unavailable.
- **L5 only:** "Ask where to save each file".

## New Tests Written
- `e2e/cuj5.spec.ts`, new block `CUJ-5: QA gate additions (iteration 2)` (`@cuj5`, 5 tests, AC mapping in its header comment):
  - `needs login: R-18G (xRestrict 2) logged out → Log in to download before any click; nothing fetched but the metadata` — CUJ-5 AC 1 (`xRestrict` 2)
  - `needs login: a walled all-ages ugoira logged out → Log in to download; a click before the metadata reaches neither ugoira_meta nor the zip` — CUJ-5 AC 4, CUJ-2 edge "logged out on an R-18 ugoira"
  - `needs login: SPA navigation from a visible work into a walled work and back keeps each work’s own state` — CUJ-5 AC 4, CUJ-1 step 7
  - `server failure: a 502 answer, then dropped connections on every attempt left → Retry with "pixiv isn’t responding", not "No connection"` — CUJ-5 step 6 detection (`lastStatus`)
  - `server failure: a 429 answer, then dropped connections …` — the same, for 429
- `e2e/cuj1.spec.ts`, new block `CUJ-1: QA gate additions (iteration 2)` (`@cuj1`, 2 tests):
  - `sanitized folder: a punctuation-heavy artist, and artists of only "~" or "." resolve to unknown without losing a folder level` — CUJ-1 edge "long or punctuation-heavy artist names", §4.4
  - `200 pages: one width from Download · 200P through 0 / 200 … and Cancel to Saved · 200P` — CUJ-1 edge "200-page manga"
- `e2e/cuj3.spec.ts`, new block `CUJ-3: QA gate additions (iteration 2)` (`@cuj3`, 2 tests):
  - `edge: 200 chars: typing or pasting past 200 characters is truncated; a chip that would not fit inserts nothing` — CUJ-3 edge "extremely long resulting path"
  - `edge: newlines: a pasted pattern with line breaks lands on one line without them and validates as usual` — CUJ-3 edge "paste containing newlines". **Fails: the `[LOW][BUG]` above.**
- Test infrastructure:
  - `e2e/fixtures/works.ts`: `WorkPatch` also accepts `xRestrict` and `sensitiveWall`. Both are type-only; neither changes generated bytes.
  - `e2e/README.md`: the `patchWork` row.
- QA walk scripts (not part of the suite): `docs/qa-artifacts/iter2-03-48-13/walk-scripts/`
  - `cuj1`–`cuj5.ts`
  - `diagOutage.ts`, `diagBadge.ts`, `diagFloat.ts`
  - `live.ts`, `livewall.ts`, `liveugoira.ts`
  - `prodzip.ts`, `paste.ts`, `mocks.ts`, `mockcrops.ts`

## Recommendations
1. **(LOW, coder) Paste with newlines.** Strip CR/LF from pasted or inserted text before it reaches the field, e.g. a `beforeinput`/`paste` handler on `#pattern` in `src/options/page.ts`. Correct `design-options-page.md:146`: Chromium replaces line breaks with spaces for user input; it does not strip them. The new e2e test pins the PRD behavior.
2. **(LOW, tl + pm) Outage residual.** The per-request `lastStatus` cannot see a 5xx that an earlier click received, and Chromium's throttling can refuse every attempt of a later click. Either:
   - keep a short-lived per-URL/per-host "last 429/5xx" memory in the SW and treat an unanswered network failure on that URL as `server`; or
   - adopt pm's job-level rule (system.md §15 item 6). In the replays the API calls of the same job answered 200, so the connection was up.

   Re-run `walk-scripts/diagOutage.ts` (≥ 3 replays) as the end-to-end check.
3. **(LOW, tl, next-cycle design item) Floating fallback timer.** It must fire early enough that the pill is placed by 3000 ms, in both the direct-load and the SPA case. The first-route anchor alone leaves the SPA case at about 3012 ms. Alternatively, pm restates the AC as "at 3 s".
4. **(LOW, pm `/spec-sync`) Pending wording items:**
   - the ugoira width (176 px in English);
   - the options-page and Unavailable AA colours;
   - Tab order "next to Like";
   - no busy `100%` before `Saved`;
   - the bubble wording for blob hand-off.
5. **(info, owner, L5) Logged-in checks.** Run `docs/release-checklist.md` §3 before submission. The R-003 live paths QA could not reach after a real login are there, including the stale-page probe.
