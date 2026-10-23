# QA Report

Last updated: 2026-10-22 21:01:06 (UTC-7)
Scope: all active PRDs (prd-000, CUJ-1 … CUJ-5). Iteration 1, run-id `iter1-20-23-42`.

## Verdict: FAIL

4 bugs, all LOW (0 CRITICAL / 0 HIGH / 0 MEDIUM / 4 LOW: 1 VISUAL_DEVIATION, 2 BUG, 1 FLAKY). Every CUJ was walked twice on the fake pixiv, and the logged-out paths of CUJ-1 and CUJ-5 were also walked twice on live pixiv. No CUJ is BLOCKED or UNIMPLEMENTED, and no walk step is incomplete. CUJ results: CUJ-1 PASS, CUJ-2 FAIL (LOW visual), CUJ-3 FAIL (LOW), CUJ-4 PASS, CUJ-5 FAIL (LOW edge case). Live verification was NOT_RUN for the logged-in paths: R-18 download after a real login, R-18 display off, and pixiv's dark theme. QA has no pixiv account, so those ACs rest on the fake-pixiv walks.

## Automated Test Summary
- Total tests: 2768 (pre-existing: 2743 = 2671 vitest + 71 e2e + 1 live smoke; new: 25 e2e)
- Passing: 2768 at the final runs (vitest 2671/2671; e2e 96/96 in two consecutive full runs, 55.5 s and 55.6 s; live smoke passed its last 2 runs, 3 of 5 overall)
- Failing: 0 deterministic failures. The live smoke failed 2 of 5 runs; see FLAKY below.
- Skipped: 0 (the MP4/H.264-gated and `@ffprobe` tests ran: the CfT probe reports H.264, and ffprobe/ffmpeg are installed)
- Flaky (failed-then-passed): 3
  - `e2e/live/smoke.spec.ts`: 2 of 5 runs hit the 180 s test timeout. The root cause is in the test (it waits for pixiv's `load` event). Logged as `[LOW][FLAKY]`.
  - `e2e/cuj3.spec.ts` "theme: … dark mode" and "locale: … in en": both failed once, in the first full e2e run only. That run took 7.7 min against the normal 55 s, and the en-locale test alone ran 6.7 min, which matches a host stall while this QA session was suspended. Neither reproduced in 3× repeat-each (18/18) or in the two later full runs (96/96). Flagged here; no product or test defect identified, so no bug is filed.
- `npm run check` (typecheck + eslint + prettier + vitest + build): green twice (before and after the new tests).

## Mock Coverage Summary
- CUJs with mocks compared: 5 (all 12 files under `docs/ux/prd-000-mvp-mockups/`, rendered to `docs/qa-artifacts/iter1-20-23-42/mocks/` with pill/row crops `*-row0.png`)
- CUJs without mocks (`NO_MOCK`): 0
- Mocks are full pixiv-page compositions. Fidelity was compared on what the extension renders: the pill (size, fill, border, text, icon, hint), its placement in the action row, and the options page as a whole. pixiv's own chrome in the mocks counts as context.

## How the product was driven
- **Fake pixiv (L3 harness):** scripted Playwright walks against Chromium launched by `e2e/harness/launch.ts`. This is the real unpacked `dist-e2e/` extension with the real `chrome.downloads`, DNR, offscreen document and WebCodecs, talking to `e2e/server/`. Each CUJ was walked as `run1` and `run2`, each walk on a fresh profile and Downloads directory. Screenshots were reviewed visually against the mocks, and every "User sees" item was asserted from the live DOM (closed shadow root read over CDP), `chrome.action` getters, `chrome.downloads`, the server request log and the files on disk.
- **Production timing:** the dev build `dist/` against the fake server (real 1.5/3/6 s backoff) for the retry-policy and outage checks.
- **Live pixiv:** the dev build `dist/`, logged out: the live smoke spec (5 runs), 6 instrumented all-ages download walks and 2 R-18 needs-login walks.
- The Playwright MCP browser was not used: it cannot load an unpacked extension here. The harness-launched Chromium is the canonical surface (`design-test-harness.md`, "QA role usage").
- Walk scripts: `docs/qa-artifacts/iter1-20-23-42/walk-scripts/`. Logs: `.../logs/`. Per-walk observations: `.../<cuj>/<run>/<section>-walk.json`, with console logs in `*-console.json` and the fake server's request log in `*-server-log.json`.

## Per-CUJ Verification

### CUJ-1: Download an illustration or manga from the artwork page — PASS

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | One button, immediately left of Like, ≤ 500 ms after the row renders | both | PASS | PASS | PASS |
| 2 | `Download · 12P` / `Download` (single page) | both | PASS | PASS | PASS |
| 3 | 164 px in idle, busy, Cancel-hover, Saved; width never changes | both | PASS | PASS | PASS |
| 4 | Folder = `metadata.json` + `135882741_p0…p11`, sizes = Content-Length | both (+live) | PASS | PASS | PASS |
| 5 | `metadata.json`: 12 keys in order, literal non-ASCII, `\n` kept | both (+live key check) | PASS | PASS | PASS |
| 6 | Never > 5 of this artwork's files in flight | both | PASS | PASS | PASS |
| 7 | `N / 12` rises; `12 / 12` only after every original; metadata never changes N | both | PASS | PASS | PASS |
| 8 | Cancel face after leaving once; cancel stops, keeps files, back to `Download · 12P` | both | PASS | PASS | PASS |
| 9 | `Saved · 12P` style + tooltip `Saved to Downloads/pixiv/みずき-135882741` | both | PASS | PASS | PASS |
| 10 | SPA away/back keeps Saved; reload shows idle | both | PASS | PASS | PASS |
| 11 | Clicking Saved re-downloads as ` (1)` duplicates | both | PASS | PASS | PASS |
| 12 | Closing the tab does not stop the job | both | PASS | PASS | PASS |
| 13 | Badge = pages not yet complete; gone at the end | both | PASS | PASS | PASS |
| 14 | Tab / Enter / Space; 2 px `#0096FA` ring; `aria-busy` | both | PASS | PASS | PASS |
| 15 | pixiv dark theme: identical fill/text/icon, `#5fb9fb` ring | both (fake only) | PASS | PASS | PASS |
| 16 | Pattern changed mid-job: the running job keeps its folder | automated | PASS | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| 200-page manga | ≤ 5 in flight, width constant (may exceed 164) | 170 px in every state, peak 2 in flight | 170 px, peak 1 | PASS |
| Sanitized artist `  Sora / 空 :: 2nd  ` | `pixiv/Sora_空_2nd-135882744` | as expected | as expected | PASS |
| Tab closed mid-download | job completes, badge counts down | 9→0, 13 files | same | PASS |
| SPA nav / reload mid-download | live progress reattaches | `4 / 12` after reload | same | PASS |
| Re-render of the row | re-inserted, never duplicated | automated (`placement`) | — | PASS |
| Non-artwork pages | no button | none on `/`, `/users/…`, nor after 3.5 s | same | PASS |
| Locale-prefixed `/en/artworks/<id>` | same button and download | PASS (fake e2e); live pixiv redirected to `/en/…`, saved OK | PASS | PASS |
| `prefers-reduced-motion` | no transitions | `0s` on pill and ring (new e2e) | — | PASS |
| Same artwork in two tabs | 24, `(1)` suffixes | automated (cuj4) | — | PASS |
| Chrome "Ask where to save" on | known v1 limitation | NOT_RUN (L5, branded Chrome) | NOT_RUN | NOT_RUN (not an AC) |
| Live pixiv, logged out, all-ages | saves every page at Content-Length | 3 walks: 151061734 (3 p) and 151107515 (4 p), all byte sizes = HEAD Content-Length | 3 walks, same | PASS |

#### Manual Verification Notes
- Pill, ring, Cancel face, Saved outline and the dark-theme focus ring match `cuj-1-initial/downloading/saved/dark` (compare `00-initial-row.png`, `03-progress-row.png`, `04-hover-cancel-row.png`, `06-saved-row.png`, `edge-1-dark-focus-row.png` with `mocks/cuj-1-*-row0.png`). The gap to Like copies pixiv's own row spacing, as the PRD asks.
- Fabrication checks:
  - All 12 originals on disk are sha256-identical to the served bytes, and each size equals the server's Content-Length.
  - `metadata.json` content was checked field by field.
  - The counter moved only as held originals were released.
  - The badge read `12` → `5` → `''`, with `#1f1f1f`/`#FFFFFF`.
  - After cancel, no request for this artwork reached the server and Chrome's list held only the 6 completed files.
- Note for pm: the extension fetches originals in the offscreen document and hands Chrome finished `blob:` URLs (`system.md` §8, option B). Chrome's download bubble therefore lists each file when its bytes are complete, not "as they start": `chrome.downloads` showed 0 in progress while 5 originals were mid-fetch. Likewise, step 5's "Chrome lists them as Canceled" (assumption) never happens, because in-flight fetches are aborted before they reach Chrome. This is a documented design choice the PRD allows ("The mechanism is engineering's choice"), so no bug is filed.
- Live note for pm: live work 151107515 is `xRestrict: 0`, but pixiv hides it from logged-out visitors behind a "sensitive content, please log in" wall. Following the PRD's `xRestrict` rule, the extension shows `Download · 4P` and saves all four originals. That is spec-compliant; it is flagged only as a product-policy question.
- The toolbar UI (badge pixels) cannot be captured in a page screenshot. Badge text, colors and title were read through `chrome.action.getBadgeText/getBadgeBackgroundColor/getBadgeTextColor/getTitle`.

#### Artifacts
- Screenshots: `docs/qa-artifacts/iter1-20-23-42/cuj-1/run1/` and `.../run2/` (50 PNG each)
  - main: `00-initial`, `01-hover`, `02-click-busy`, `03-progress`, `04-hover-cancel`, `06-saved`, `06-saved-hover`, `07-spa-other-artwork`, `07-spa-back`, `08-redownload`, `09-reload-idle` (each with a `-row` crop)
  - cancel: `04b-pointer-still-on-button`, `04b-hover-cancel`, `05-cancelled`
  - edge: `edge-1-dark-focus`, `edge-2-keyboard-busy`, `edge-3-reload-mid-job`, `edge-4-sanitized-artist`, `edge-5-200-pages-*`, `edge-6-user-page-no-button`
  - live: `live-00-initial`, `live-01-busy`, `live-02-end`, `live-{a,b,c}-00-row`
- Console messages (run1 / run2): fake walks had 0 errors. Live walks had only pixiv's own page errors (`browsingTopics` deprecation, ad-server `ERR_FAILED`), none from the extension.
- Network verified: one 200 per original, Referer `https://www.pixiv.net/` (the fake returns 403 without it), peak 5 in flight per artwork.
- Mocks: `cuj-1-initial.html`, `cuj-1-downloading.html`, `cuj-1-saved.html`, `cuj-1-dark.html`.

#### Issues Found
- `[LOW][FLAKY]` `e2e/live/smoke.spec.ts` failed 2 of 5 runs with "Test timeout of 180000ms exceeded" (the error surfaces in `waitForText(/^Saved/)`).
  - Cause: `page.goto` at `e2e/live/smoke.spec.ts:115` waits for pixiv's `load` event, which took 43 s, 119 s and 46 s in three timed replicas (`logs/` and the `livetimed.ts` walk script).
  - The extension saved 4–10 s after the button appeared every time, and 6 instrumented live walks using `domcontentloaded` all reached `Saved` in 6–24 s. The product is not at fault: the test spends its budget on pixiv's ads/trackers.

### CUJ-2: Download an ugoira — FAIL

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | Idle `Download · MP4/WebM/ZIP` per setting (WebM without H.264) | both | PASS | PASS | PASS |
| 2 | Integer %, never decreases, no 100% early, ≥ 1 update/s in encode | both | PASS | PASS | PASS |
| 3 | Badge `1` for the whole job, gone at the end | both | PASS | PASS | PASS |
| 4 | Folder exactly zip, `frames.json`, `.mp4`, `metadata.json` | both | PASS | PASS | PASS |
| 5 | Zip byte-identical; `frames.json` = `ugoira_meta.body.frames` | both | PASS | PASS | PASS |
| 6 | Duration = Σ delays; per-frame ±1 ms; frame count | both | PASS | PASS | PASS |
| 7 | Width × height rounded down to even | both | PASS | PASS | PASS |
| 8 | Plays in Chrome, VLC, QuickTime | both (Chrome); proxy (VLC/QuickTime) | PASS | PASS | PASS (see notes) |
| 9 | ZIP only: zip + `frames.json` (+ metadata), no video, `Saved · ZIP` | both | PASS | PASS | PASS |
| 10 | Cancel during encode: no video, zip + `frames.json` stay | both | PASS | PASS | PASS |
| 11 | Closing the tab during encode still produces the video | both | PASS | PASS | PASS |
| 12 | No H.264 → hint, Saved label and extension say WebM | both (probe seeded `avc: null`) | PASS | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Step 1 "User sees": the same 164 × 40 px pill | 164 px | **176 px** | **176 px** | FAIL (`[LOW][VISUAL_DEVIATION]`) |
| Mixed delays 40/40/500/40 | exact | MP4 and WebM: 40,40,500,40 (620 ms) | same | PASS |
| Odd 601×451 | 600×450 | 600×450 | 600×450 | PASS |
| Settings changed mid-job / idle hint follows within 1 s | job keeps format; hint ≤ 1 s | hint followed in ~1 ms | same | PASS |
| No Content-Length | `0%` + rotating 25 % arc | e2e PASS; my walk's sample came too early to show the arc (inconclusive) | same | PASS (automated) |
| Encode failure / `ugoira_meta` error | CUJ-5 states | see CUJ-5 | — | PASS |

#### Manual Verification Notes
- The encode phase was captured under 60× CPU throttling of the offscreen document:
  - `53%` / `51%` with `aria-label` "Encoding MP4, NN percent. Click to cancel."
  - badge `1`, and Chrome had 0 downloads in progress
  - zip and `frames.json` already on disk
- The Cancel face on hover showed `#3c4043` with the tooltip `Cancel download`.
- ffprobe on the example: h264, 600×600, 48 frames × 100 ms, 4800 ms.
- The MP4 plays in a Chrome tab: 600×600, 4.8 s, `currentTime` advanced to 1.5 s (`05-mp4-plays-in-chrome.png`).
- QuickTime/VLC were checked by proxy, without a GUI:
  - macOS AVFoundation (QuickTime's framework) reads and remuxes the file (`avconvert --preset PresetPassthrough` exit 0).
  - ffmpeg/libavcodec (VLC's H.264 decoder) decodes every frame without error.
  - GUI playback in QuickTime Player and VLC stays on the L5 release checklist; VLC is not installed on this host.
- Fabrication: the zip on disk is sha256-identical to the fixture's `originalSrc` bytes; `frames.json` deep-equals `ugoira_meta.body.frames` with 2-space indentation; the video timing comes from real per-frame delays (verified on the 40/40/500/40 fixture).
- Visual: colors, ring, labels and the Saved style match `cuj-2-initial` / `cuj-2-encoding`. The pill is 12 px wider than the mock (see issue).

#### Artifacts
- Screenshots: `.../cuj-2/run1/` and `.../run2/` (31 PNG each)
  - main: `00-initial`, `02-zip-phase`, `03-encoding`, `04-hover-cancel`, `05-saved`, `05-mp4-plays-in-chrome`
  - variants: `06-zip-only-*`, `07-webm-*`, `09-no-h264-*`
  - edge: `edge-1-cancel-encode-hover`, `edge-1-cancelled`, `edge-2-before-tab-close`, `edge-3-no-content-length`
- Media: `.../cuj-2/media/136004512.mp4`, `136004512-frames.json`
- Console messages: 0 errors in both runs.
- Mocks: `cuj-2-initial.html`, `cuj-2-encoding.html`.

#### Issues Found
- `[LOW][VISUAL_DEVIATION]` The ugoira pill is 176 px wide in English (every state, both runs), while PRD CUJ-2 step 1 ("The same 164 × 40 px blue pill") and the `cuj-2-initial` / `cuj-2-encoding` mocks show 164 px.
  - Cause: `ugoiraCandidates()` in `src/content/button/width.ts:59-71` measures every format's labels (`Download · WebM`, `Saved · WebM`, `Retry · WebM`, …), following PRD §4.7.2 ("the widest label the button can show for this artwork").
  - This is a PRD-internal conflict, so triage it as a spec-conflict. §4.7.2 forces the width the WebM label needs, because the idle hint can switch to WebM after a settings change or when H.264 is unavailable, and a 164 px pill cannot fit `Download · WebM`. CUJ-2 step 1 and the mocks fix 164 px.
  - Either the PRD and mocks adopt the measured ugoira width, or the format labels must be shortened.

### CUJ-3: Configure the extension from the toolbar icon — FAIL

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | Toolbar opens a full tab `Helper for Pixiv — Settings`; again → focuses it | both | PASS | PASS | PASS |
| 2 | No popup | both (manifest has no `default_popup`) | PASS | PASS | PASS |
| 3 | Defaults `pixiv/{artist}-{id}`, MP4, metadata on | both | PASS | PASS | PASS |
| 4 | Chips insert at caret; tooltips exact | both | PASS | PASS | PASS |
| 5 | Preview `Downloads/pixiv/みずき-135882741/135882741_p0.jpg` | both | PASS | PASS | PASS |
| 6 | `{artst}`: red 2 px border, message, Still-using line ≤ ~400 ms; download uses last valid | both | PASS | PASS | PASS |
| 7 | Each validation case's exact message | both (8 inputs incl. stray `{`) | PASS | PASS | PASS |
| 8 | Autosave; green `Saved` (~400 ms / immediate), fades after 2 s | both | PASS | PASS | PASS |
| 9 | Reload shows most recent values | both | PASS | PASS | PASS |
| 10 | Change during a download does not affect it | automated (cuj1/cuj2 mid-job) | PASS | PASS | PASS |
| 11 | Reset to defaults | both | PASS | PASS | PASS |
| 12 | Footer content | both | PASS | PASS | PASS |
| 13 | Dark / light follows OS | both | PASS | PASS | PASS |
| 14 | ja / zh_CN / zh_TW strings | both | PASS | PASS | PASS |
| 15 | Keyboard-only reach and operation | both | PASS | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Step 5 "No `Saved` appears" with a typo typed < 2 s after a valid save | no `Saved` beside the heading while the error shows | `✓ Saved` (from the preceding valid save) shown together with the red error | same | FAIL (`[LOW][BUG]`) |
| Invalid pattern, then tab closed | reopening shows last valid, no error | PASS | PASS | PASS |
| > 200 characters | field truncates | 200 | 200 | PASS |
| Two settings tabs | sync ≤ 1 s; invalid draft left alone | automated | — | PASS |
| Toolbar click while a download runs | settings open; job unaffected | PASS (CUJ-4 walk) | PASS | PASS |

#### Manual Verification Notes
- `00-initial.png`, `05-error.png`, `07-webm-saved.png` and `01-dark.png` match `cuj-3-initial` / `cuj-3-error` / `cuj-3-saved` and the dark spec (page `#121212`). Layout, typography, colors, chip pills, segmented control, switch, footer and the "Still using" line wrap all match.
- The settings tab opened at index current+1 and active. A second toolbar click focused it without opening another tab.
- Persistence was checked in `chrome.storage.sync` and `local`, and invalid values were never stored. A download started while the field held `{artst}` saved into the last valid pattern's folder.
- Locales ja / zh_CN / zh_TW: `chrome.i18n.getUILanguage()` followed; title, `lang`, and every string localized; no English UI strings remained. Button widths: ja 177 px, zh 155 px.
- The physical toolbar icon cannot be clicked from Playwright. The real handler `openOrFocusOptions` was driven through the e2e hook `__hfpTest.clickAction`; `chrome.action.onClicked` is wired at `src/background/sw.ts:52`.

#### Artifacts
- Screenshots: `.../cuj-3/run1/` and `.../run2/` (21 PNG each)
  - `00-initial`, `00-initial-full`, `01-dark`, `03-edit-saved`, `04-chip-inserted`, `05-error`, `06-fixed`, `07-webm-saved`, `08-metadata-off`, `09-reset`, `10-footer`, `11-keyboard-focus-reset`
  - `12-locale-{ja,zh_CN,zh_TW}`, `13-button-{ja,zh_CN,zh_TW}`
- Console messages: 0 errors.
- Mocks: `cuj-3-initial.html`, `cuj-3-error.html`, `cuj-3-saved.html`.

#### Issues Found
- `[LOW][BUG]` A green `✓ Saved` from the previous valid save stays visible (up to 2 s) beside the **Download folder** heading while the field shows a validation error. This contradicts PRD CUJ-3 step 5 ("No `Saved` appears") and the `cuj-3-error` mock.
  - Repro: insert a chip (valid, saves), then within 2 s type `pixiv/{artst}-{id}`. See `cuj-3/run1/05-error.png` and `run2/05-error.png`.
  - Cause: `showError` (`src/options/page.ts:99-106`) never cancels the indicator, which runs on its own timer (`src/options/saved.ts:52-58`).

### CUJ-4: Follow several downloads at once from the toolbar badge — PASS

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | 18 + 5 → badge `23`, `#1f1f1f`/white, "… 23 files remaining across 2 downloads" | both | PASS | PASS | PASS |
| 2 | One-job tooltip forms | both | PASS | PASS | PASS |
| 3 | Each tab shows only its own progress | both | PASS | PASS | PASS |
| 4 | Badge decreases ≤ 1 s after any file lands | both (measured < 100 ms) | PASS | PASS | PASS |
| 5 | Second artwork starts immediately | both | PASS | PASS | PASS |
| 6 | Cancelling one job drops the badge by its remainder at once | both | PASS | PASS | PASS |
| 7 | Last lands / cancelled / fails → badge gone, idle title | both | PASS | PASS | PASS |
| 8 | ≥ 1000 → `999+` | automated (new e2e: 5×200 → `999+`, title "1000 files remaining across 5 downloads") + L1 | PASS | PASS | PASS |
| 9 | SW stopped mid-job: correct badge ≤ 1 s, jobs complete | both | PASS | PASS | PASS |
| 10 | Toolbar click while jobs run opens settings, jobs unaffected | both | PASS | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Ugoira in the mix | counts 1 | 6 pages + 1 ugoira = `7`, across 2 downloads | same | PASS |
| A job ends with failures | leaves the count | PASS (CUJ-5 walk / e2e) | PASS | PASS |
| SW restart with an ugoira and a manga in flight | both finish | 13 files + mp4 | same | PASS |

#### Manual Verification Notes
- The PRD's 30-page manga has no fixture. Tab A used the 200-page manga with its last 18 held, which gives exactly 18 + 5 = 23.
- Tab B's busy pill `3 / 8` matches `cuj-4-initial`.
- Badge values came from the `chrome.action` getters (toolbar not capturable).

#### Artifacts
- Screenshots: `.../cuj-4/run1/` and `.../run2/` (15 PNG each): `02-tab-a-busy`, `02-tab-b-busy`, `03-tab-b-saved`, `04-tab-a-hover-cancel`, `04-tab-a-cancelled`, `06-toolbar-while-running`, `edge-1-ugoira-in-mix`, `edge-2-after-sw-restart`.
- Console messages: 0 errors.
- Mocks: `cuj-4-initial.html`.

#### Issues Found
- none

### CUJ-5: Recover when a download can't start or breaks — FAIL

#### Acceptance Criteria
| # | Criterion | Coverage | Result (run1) | Result (run2) | Final |
|---|-----------|----------|---------------|---------------|-------|
| 1 | Logged out, `xRestrict ≥ 1`: `Log in to download` (white, `#c4c7c5`, `#3c4043`, no icon), tooltip, no other text | both (+live logged out) | PASS | PASS | PASS |
| 2 | Click → `accounts.pixiv.net/login?return_to=<encoded>`; after login `Download · 68P` | both (fake round trip); live: URL only | PASS | PASS | PASS (live post-login NOT_RUN: no account) |
| 3 | Logged out, all-ages: normal idle, download succeeds | both (+live) | PASS | PASS | PASS |
| 4 | `Retry · 3 failed`, red outline, warning triangle, same width, exact tooltip | both | PASS | PASS | PASS |
| 5 | Retry fetches only the 3 pages into the same folder → `Saved · 12P` | both | PASS | PASS | PASS |
| 6 | Network disconnected → `Retry` + "No connection…" | both (fake server stopped, then restarted) | PASS | PASS | PASS |
| 7 | Logged in, R-18 display off → `Retry` + "pixiv refused this work…" | both (fake) | PASS | PASS | PASS (live NOT_RUN: no account) |
| 8 | Deleted after page load → gray `Unavailable`; click does nothing | both | PASS | PASS | PASS |
| 9 | Encode fails: zip + `frames.json`, no video, `Retry · MP4` + exact tooltip; its click produces only the video | both (first half); automated (only-the-video, staged encoder failure) | PASS | PASS | PASS |
| 10 | 403 mid-job keeps saved files, back to `Log in to download` | both | PASS | PASS | PASS |
| 11 | No badge in error states unless another job runs | both | PASS | PASS | PASS |
| 12 | Cancelling never produces red or a message | both | PASS | PASS | PASS |
| 13 | Row removed before navigation → floating pill bottom-right of the artwork ≤ 3 s; downloads | both | PASS | PASS | PASS |
| 14 | 403 never retried; 429/500/502/503/504/network up to 4 attempts | both (dev build: 4 server hits for each of 500/502/503/504/429) | PASS | PASS | PASS |

#### Edge Cases & Error States
| Scenario | Expected | Observed (run1) | Observed (run2) | Result |
|----------|----------|-----------------|-----------------|--------|
| Repeated user Retry during a sustained pixiv 503 (production timing, dev build) | `Retry` + "pixiv isn't responding…" | clicks 1–3: correct; **clicks 4–7: "No connection. Retry when you're back online."**, 1 of 4 attempts reaches pixiv | not repeated (deterministic; Chromium throttling) | FAIL (`[LOW][BUG]`) |
| Downloads folder not writable (read-only dir) | `Retry` + "Chrome couldn't save…" | PASS (Chrome: `USER_CANCELED` → disk cause) | PASS | PASS |
| pixiv server failure (5xx × 4, 0 saved) | "pixiv isn't responding…" | PASS (504) | PASS | PASS |
| Exactly 1 failure | `Retry · 1 failed` + one-page tooltip | automated | — | PASS |
| Partial failure, pattern changed before Retry | original folder | automated | — | PASS |
| Partial failure, then reload | idle; whole job, `(1)` copies | automated | — | PASS |
| Logged in elsewhere after load | still `Log in to download`; login bounces back | automated | — | PASS |
| Logged out in another tab after load | `Download` → `Retry` refused | automated | — | PASS |
| 429 `Retry-After: 120` | waits min(RA, 30) s | ≈ 300 ms in dist-e2e (= 30 s × 0.01) | — | PASS |
| Floating fallback on dark theme | `#5fb9fb` ring | PASS | PASS | PASS |
| Viewport fallback (no artwork area) | fixed 24 px bottom-right | automated | — | PASS |
| Only `metadata.json` failed | `Retry` + tip_metadata_only | not reproducible e2e (needs a one-file `chrome.downloads` failure); L1/L2 only | — | NOT_RUN (not an AC) |
| R-18G (`xRestrict` 2) | same as R-18 | no fixture; same `≥ 1` rule | — | NOT_RUN (not an AC) |

#### Manual Verification Notes
- `01-needs-login`, `04-retry-3-failed` and `08-encode-failed` match `cuj-5-initial` / `cuj-5-retry` (outline weights, colors, icon, hint at full opacity).
- Live pixiv, logged out:
  - R-18 work 151107522 shows `Log in to download` in the real action row (both runs).
  - The click lands on the real `https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2Fen%2Fartworks%2F151107522`. The `return_to` is the current URL, `/en/` included.
- Offline was walked realistically: the fake pixiv was stopped mid-session (`ERR_CONNECTION_REFUSED`), giving `Retry` + "No connection…". After a restart on the same port, `Retry` reached `Saved`.
- 403 mid-job:
  - p5 was requested exactly once.
  - p10/p11 never started.
  - Files already in flight finished, matching `design-download-engine.md`: the in-flight originals are still handed to Chrome after the 403.
  - Button → `Log in to download`.
- Fabrication checks:
  - Error causes come from real failures: the server log shows the 4 attempts per failing page.
  - The retry refetched only p4/p9/p11 (server log), and `chrome.downloads` saw only those 3 files.
  - The floating pill really downloads (13 files).
- Harness limitation (not a product bug): Chromium throttles an extension's requests to a URL after repeated 500/503 answers ("Request throttled", https://dev.chromium.org/throttling). `dist-e2e` scales the backoff ×0.01, so the 4th 500/503 attempt in the e2e build never reaches the server and fails as a network error. `e2e/cuj5.spec.ts` therefore uses 502/504 for exhausted-retry scenarios, and the 4-attempt rule for 500/503 was verified with the dev build.
- Console (both runs): only the browser logs of injected faults (504/403/404, `ERR_CONNECTION_REFUSED`), plus one `[hfp:offscreen] EncodeError: ugoira encode failed: zip` from the corrupt-frame fixture. That last one is expected: `log.error` deliberately reaches `chrome://extensions` → Errors.

#### Artifacts
- Screenshots: `.../cuj-5/run1/` (49 PNG) and `.../run2/` (45 PNG)
  - `01-needs-login(-hover)`, `02-pixiv-login`, `03-after-login-idle`, `03-after-login-saved`
  - `04-retry-3-failed`, `04-retry-hover`, `05-retrying`, `05-retry-saved`
  - `06-offline`, `06-back-online-saved`, `06-server-failure`, `06-refused`
  - `07-unavailable`, `08-encode-failed`, `09-403-needs-login`, `10-cancel-not-error`
  - `11-floating`, `11-floating-saved`, `11-floating-dark-focus`, `11-row-restored`
  - live: `live-01-needs-login`, `live-r18-01-row`, `live-02-pixiv-login`
  - read-only Downloads: `run1-disk-not-writable` and `run2-disk-not-writable`, both under `run1/`
- Network: per-page attempt counts and gaps in `main-server-log.json`; dev-build outage log `logs/outage-503.log`.
- Mocks: `cuj-5-initial.html`, `cuj-5-retry.html`.

#### Issues Found
- `[LOW][BUG]` During a sustained 500/503 from `i.pximg.net`, from the user's 4th `Retry` onward Chromium's extension-request throttling refuses 3 of the 4 attempts locally. Measured with the dev build (real backoff), server hits per click went 4, 3, 2, 1, 1, 1, 1. The extension maps the refusal to `network` (`src/shared/retry.ts:126`) and `errorCause` (`src/shared/outcome.ts:24-33`) then reports "No connection. Retry when you're back online.", although the user is online and pixiv is failing.
  - Partly a spec gap: the PRD CUJ-5 step 6 detection table ("Network errors … after retries" → No connection) does not foresee browser-side throttling after 5xx.
  - Suggested direction for tl: treat a network failure that follows 5xx answers on the same request as a server failure.

## Bugs Found

### CRITICAL
- none

### HIGH
- none

### MEDIUM
- none

### LOW
- `[LOW][VISUAL_DEVIATION]` Ugoira pill is 176 px instead of the 164 px of PRD CUJ-2 step 1 and the `cuj-2-*` mocks. This is a PRD-internal conflict with §4.7.2's widest-label rule; triage as a spec-conflict. — CUJ-2 — `src/content/button/width.ts:59-71`
- `[LOW][BUG]` A residual `✓ Saved` stays visible next to a validation error for up to 2 s after a valid save, against CUJ-3 step 5 "No `Saved` appears". — CUJ-3 — `src/options/page.ts:99-106`, `src/options/saved.ts:52-58`
- `[LOW][BUG]` After repeated user retries during a pixiv 500/503 outage, Chromium throttling turns attempts into network errors and the tooltip says "No connection" instead of "pixiv isn't responding". Partly a spec gap. — CUJ-5 — `src/shared/retry.ts:126`, `src/shared/outcome.ts:24-33`
- `[LOW][FLAKY]` The live smoke spec times out in 2 of 5 runs because `page.goto` waits for pixiv's `load` event (43–119 s measured); the product saves in 4–10 s. — CUJ-1 (L4 live) — `e2e/live/smoke.spec.ts:115`

## Coverage Gaps
Acceptance criteria with Coverage = `none`: none. Every AC of CUJ-1 … CUJ-5 now has an automated check and/or a two-run manual walk. Remaining verification limits:
- Live, logged-in paths are NOT_RUN because QA has no pixiv account: R-18 download after a real login (CUJ-5 AC2 second half), R-18 display off (CUJ-5 AC7), and pixiv's dark theme (CUJ-1 AC15). All three are verified on the fake pixiv only.
- CUJ-2 AC8: VLC and QuickTime Player GUI playback rests on proxy evidence (AVFoundation passthrough, full ffmpeg decode). The L5 release checklist covers it.
- Edge cases without an e2e check: "only metadata.json failed" (L1/L2 only), R-18G (no fixture), and Chrome's "Ask where to save each file" (L5).
- `e2e/README.md` still lists CUJ-5 as "next iteration" in its AC mapping; `e2e/cuj5.spec.ts` now owns those rows.

## New Tests Written
- `e2e/cuj5.spec.ts` (new file, `@cuj5`, 21 tests, AC→test mapping at the top):
  - `needs login: logged out on an R-18 work, Log in to download before any click` — CUJ-5 AC1
  - `login round-trip: Log in to download → pixiv login with return_to → Download · 68P → saves` — CUJ-5 AC2
  - `logged in elsewhere after this page loaded: still Log in to download; login bounces straight back` — CUJ-5 edge
  - `logged out all-ages: normal idle Download, and the download succeeds` — CUJ-5 AC3
  - `partial: Retry · 3 failed with the exact tooltip; retry fetches only those 3 into the same folder → Saved · 12P` — CUJ-5 AC4, AC5, AC14; edge "pattern changed before Retry"
  - `partial one: Retry · 1 failed with the one-page tooltip; a 404 is not retried; reload clears the memory` — CUJ-5 edges, AC14
  - `offline: every original drops its connection → Retry with "No connection"; Retry re-runs the whole job` — CUJ-5 AC6
  - `offline: pixiv unreachable after the page loaded (API and images) → Retry with "No connection"` — CUJ-5 AC6
  - `server failure: 5xx on every original after 4 attempts → Retry with "pixiv isn’t responding"` — CUJ-5 step 6
  - `refused: logged in with R-18 display off → Retry with "pixiv refused this work"` — CUJ-5 AC7
  - `refused: logged out in another tab after this page loaded → Download, then Retry with the refused tooltip` — CUJ-5 edge
  - `unavailable: deleted after the page loaded → gray Unavailable; clicking does nothing` — CUJ-5 AC8
  - `unavailable: a work that 404s at render time shows Unavailable immediately` — CUJ-5 step 7
  - `encode failure (136004516, corrupt frame): zip + frames.json, no video, Retry · MP4; its retry saves no second zip` — CUJ-5 AC9
  - `encode failure, then a working encoder: Retry · MP4 produces only the video` — CUJ-5 AC9
  - `403 mid-job: nothing retried or started after it, saved files stay, Log in to download; login then re-runs the job` — CUJ-5 AC10, AC14
  - `badge in error states: a failed job shows no badge, another running job keeps counting` — CUJ-5 AC11
  - `cancel a retry: cancelling never shows red or a message` — CUJ-5 AC12
  - `retry policy: 429 (Retry-After capped), 500/502/503/504, resets, stalls and API 503s are retried to success; gaps follow the policy` — CUJ-5 AC14
  - `floating fallback: row removed before a direct load → floating pill at the artwork’s bottom-right within 3 s; downloads; moves into the row when it appears` — CUJ-5 AC13, step 11
  - `floating fallback: SPA navigation with the row gone; dark theme ring; viewport fallback without the artwork area` — CUJ-5 AC13, edges
- `e2e/cuj1.spec.ts` (appended `CUJ-1: QA gate additions`, `@cuj1`, 3 tests):
  - `locale-prefixed URL: /en/artworks/<id> gets the same button, placement and download` — CUJ-1 preconditions / NFR
  - `non-artwork pages: no button on the home or a user page; leaving an artwork removes it` — CUJ-1 edge
  - `reduced motion: the pill and the progress ring have no transitions` — PRD §4.7.4
- `e2e/cuj4.spec.ts` (appended `CUJ-4: QA gate additions`, `@cuj4`, 1 test):
  - `999+: five 200-page jobs (1000 files) show 999+, the tooltip the exact count` — CUJ-4 AC8 (previously L1 only)
- `.gitignore`: added `docs/qa-artifacts/`.

## Recommendations
1. (LOW, pm + tl, spec-conflict) Settle the ugoira width. Either amend PRD CUJ-2 step 1 and the `cuj-2-*` mocks to the measured widest-label width (176 px in English), or shorten the format labels. §4.7.2 and CUJ-2 step 1 cannot both hold while `Download · WebM` is a possible label.
2. (LOW, coder) Clear the folder section's `Saved` indicator when a validation error is shown (`src/options/page.ts` `showError`), so an error never sits next to `✓ Saved`.
3. (LOW, tl + pm) Classify a network failure that follows 5xx answers on the same request as `server`, and add Chromium's extension request throttling to the CUJ-5 detection notes. For the harness, consider `--disable-extensions-http-throttling` in `e2e/harness/launch.ts` (the ×0.01 time scale makes Chromium throttle 500/503 on the first job), or keep the 502/504 convention now in `e2e/cuj5.spec.ts`.
4. (LOW, tl) `e2e/live/smoke.spec.ts:115`: navigate with `waitUntil: 'domcontentloaded'` (as the 6 instrumented live walks did), so pixiv's ad/tracker `load` time (43–119 s) does not consume the 180 s budget.
5. (info, pm) Confirm two product observations:
   - Chrome's bubble lists files as each one finishes, not "as they start", and in-flight files are never "Canceled" in Chrome, because of the blob hand-off design.
   - xRestrict-0 works that pixiv walls off for logged-out visitors ("sensitive content") still download.
6. (info, tl) Update `e2e/README.md`'s CUJ-5 mapping to point at `e2e/cuj5.spec.ts`. Keep the L5 checklist items: QuickTime/VLC GUI playback, "Ask where to save", and logged-in live R-18 paths.
