# PM Review

Last updated: 2026-10-23 04:33:14 (UTC-7)
Iteration: 2
Scope: prd-000 (prd-000-mvp, CUJ-1 … CUJ-5, including this iteration's R-003 amendments to the CUJ-1 precondition and CUJ-5 Part A)

## Overall Assessment
Iteration 2 resolved every product caveat from iteration 1. It also shipped R-003 as the owner ruled: on live pixiv, the button says `Log in to download` under pixiv's own sensitive-content wall. That holds even when the click comes before the metadata arrives, and nothing is fetched.

Three things are left:
- two narrow defects: a pasted multi-line pattern keeps its line breaks as spaces, and 1 in 7 Retries during a long pixiv outage still says "No connection";
- a timer overshoot of about 20 ms;
- a spec that now lags the build in 15 places (S1–S15 below, filed as **R-004**).

The product is converging. One small fix iteration plus the R-004 sync should close prd-000. The largest remaining release risk is still the logged-in live surface (`docs/release-checklist.md` §3).

## Per-CUJ Verdict

### CUJ-1: Download an illustration or manga from the artwork page — Satisfied

**QA verdict** (from qa-report.md): PASS
**PM verdict**: Satisfied

**Assessment**:
- **Steps 1–8 match the mocks again.** Screens in `docs/qa-artifacts/iter2-03-48-13/cuj-1/run1/`:
  - `00-initial-row.png`: `Download · 12P` immediately left of Like, compared with `mocks/cuj-1-initial-row0.png`;
  - `03-progress-row.png`: `7 / 12` with the ring;
  - `04-hover-cancel-row.png`: neutral `#3c4043` with an X, not red;
  - `06-saved-row.png`: the outlined `Saved · 12P`.

  Per the QA report:
  - 164 px in every state;
  - at most 5 files in flight;
  - originals sha256-identical to the served bytes;
  - `metadata.json` with its 12 keys.
- **Iteration-1 caveat "latent width deviation": resolved.** When the action row renders before the metadata, the pill first shows `Download` with no hint (`edge-7-late-metadata-135882741-before-row.png`). It gains `· 12P` without changing width (`…-after-row.png`). The 200-page work widens once, from 164 to 170 px, before any interaction, which is exactly what §4.7.2 allows. `edge-5-200-pages-saved-row.png` keeps that width at `Saved · 200P`.
- **Iteration-1 caveat "folder-level loss for `~`/`.` names": resolved.** QA's new e2e resolves the artists `~`, `...`, `~.~` and ` . ` to `pixiv/unknown/…`. No folder level is lost.
- **Live, logged out.**
  - `live-00-row.png`: the pill sits in pixiv's real row, left of Like (`Download · 3P`).
  - `live-02-end.png`: `Saved · 3P`. Three PNGs (20.6 MB) were saved in 3.3 s and 2.3 s, each at its `Content-Length`.
  - The store zip itself downloads (`prodzip-saved-row.png`), and it carries no test hooks.
- **Dark theme:** the focus ring is `#5fb9fb` (`edge-1-dark-focus-row.png`).

**Caveats / gaps** (none change the verdict):
- **Evidence gap: the logged-in live surface is NOT_RUN.** This covers the logged-in action-row DOM and pixiv's dark theme, which is P1's everyday surface. If the logged-in row differs, the floating fallback is the safety net. The checks are in `docs/release-checklist.md` §3.

**Spec gap**: S1 (part: the provisional-width assumption is verified, so drop its marker), S6 (bubble wording, steps 2 and 5), S7 (keyboard order), S8 (§4.4.3 vs D8), S9 (singular copy variants).

### CUJ-2: Download an ugoira — Satisfied

**QA verdict** (from qa-report.md): FAIL (one carried-over LOW VISUAL_DEVIATION: 176 px against step 1's 164 px, a PRD-internal conflict)
**PM verdict**: Satisfied

**Assessment**:
- All 12 acceptance criteria pass in both runs.
- **Screens** (`cuj-2/run1/`):
  - `00-initial-row.png`: `Download · MP4`;
  - `03-encoding-row.png`: `46%` with the ring. Apart from the width it matches `mocks/cuj-2-encoding-row0.png`, which shows `58%`.
  - `07-webm-idle-row.png`: `Download · WebM` fills the pill edge to edge. This is why the pill needs 176 px.
- **Iteration-1 caveat "no live ugoira walk": resolved.** Live 151105084 (16 frames, 900×900):
  - h264, and every frame keeps its delay (2240 ms = Σ delays);
  - the zip's sha256 equals `originalSrc`;
  - progress `0, 1, 5, 15, 40%`, then `Saved · MP4` (`live-ugoira-05-saved.png`);
  - ZIP only ends in `Saved · ZIP`.
- **R-003 reaches ugoira too.** A walled or R-18 ugoira viewed logged out shows `Log in to download` and never requests `ugoira_meta` or the zip (new e2e).
- **The 176 px width still serves the intent.** The pill never shifts between states or when the setting changes: code review Fixed 2 asserts one width across WebM → ZIP → WebM.

**Caveats / gaps**: none in the product.
- Evidence limit: GUI playback in VLC, QuickTime and the Windows players is L5 (`docs/release-checklist.md` §2).

**Spec gap**: S1 (the 164 px in step 1 and the mocks), S10 (VP9 → MP4 fallback; an ugoira whose only failure is `metadata.json`), S13 (the ZIP-only "`0%` → `100%`" frame the user never sees), S15 (the `cuj-2-encoding.html` tooltip).

### CUJ-3: Configure the extension from the toolbar icon — Caveats

**QA verdict** (from qa-report.md): FAIL (one new LOW BUG)
**PM verdict**: Caveats

**Assessment**:
- **Iteration-1 caveat "`Saved` beside a validation error": resolved.**
  - `cuj-3/run1/05-error.png` shows the red field, the exact unknown-token message and the "Still using" line, with no `Saved` beside Download folder.
  - QA saw none 2.6 s later either, and a MutationObserver test finds no overlap.
  - Apart from the intentional AA colours, it matches `mocks/cuj-3-error.png`.
- **The rest of the page:**
  - `07-webm-saved.png`: WebM is selected, and `✓ Saved` sits beside Ugoira output in `#188038` (4.68:1 on `#f6f7f9`).
  - `01-dark.png`: the page renders dark.
  - `12-locale-*`: fully localized.
  - `13-button-ja-row.png`: `ダウンロード · 12P` in pixiv's row.
  - All 15 acceptance criteria pass. The 200-character cap, two settings tabs, and "invalid draft, then tab closed" all pass too.

**Caveats / gaps**:
- **A pasted multi-line pattern keeps its line breaks as spaces.**
  - What QA saw (`edge-paste-newlines.png` and `.json`): pasting `pixiv/⏎{artist}⏎-{id}` saves `pixiv/ {artist} -{id}` with `✓ Saved`, and the preview reads `Downloads/pixiv/みずき -135882741/…`. The CUJ-3 edge case says the field drops newlines on paste.
  - Why it matters: this page exists for a folder layout set once and then forgotten (P1 "will change the folder pattern once … then never open settings again"). A stray space inside a segment is still valid, so it autosaves silently. From then on, every artwork lands in a folder the user did not type, and fixing it later splits the archive into two naming schemes. The preview does show the space, but one space in monospace is easy to miss.
  - How common: only a break inside a segment survives as a space. Breaks at either end, or next to `/`, are trimmed by D8's segment-edge pass (`src/shared/pattern.ts:61`, `:148-157`). So the most common paste, a triple-click copy with a trailing newline, already resolves correctly.
  - Cause: `src/options/page.ts` has no `paste`/`beforeinput` handling; `:76` only sets `maxLength`. `docs/design/design-options-page.md:146` assumes Chromium strips CR/LF, but for text the user inserts, Chromium replaces them with spaces.
  - QA's e2e pins the bug deterministically (6 of 6 runs fail), so `main` carries one red test until it is fixed.

**Spec gap**: S2 (`Saved`, validation-text and "Still using" colours), S5 (an unclosed `{` is still autosaved), S8 (§4.4.3 vs D8), S15 (the "Still using:" label still wraps to "Still / using:" in `05-error.png`, as it does in the mock).

### CUJ-4: Follow several downloads at once from the toolbar badge — Satisfied

**QA verdict** (from qa-report.md): PASS
**PM verdict**: Satisfied

**Assessment**:
- `cuj-4/run1/02-tab-b-busy-row.png` (`3 / 8`) matches `mocks/cuj-4-initial-row0.png`.
- **From the `chrome.action` getters:**
  - `23` with "… across 2 downloads";
  - the badge drops within 88–91 ms of a landing;
  - job B starts 40–43 ms after A;
  - cancelling A drops the badge by A's remainder;
  - after the service worker is stopped, the count is correct again within 91 ms;
  - an ugoira counts 1 (6 + 1 = `7`);
  - `999+` is covered by an automated test.
- **Iteration-1 spec gap "title with 0 counted files": implemented.** `actionTitle` returns the idle title for a total of 0, and "across N downloads" counts only jobs that still have files (`src/background/badge.ts:36-45`).

**Caveats / gaps**: none.
- The toolbar cannot be captured, so the evidence is the getters.
- The PRD's 30-page tab A was played by the 200-page manga with 18 pages held. That is an equivalent setup.

**Spec gap**: S6 (the CUJ-4 edge about Chrome's downloads button), S9 (`action_title_one_single`), S11 (the 0-count title; confirm that an ugoira counts 1 during its zip fetch).

### CUJ-5: Recover when a download can't start or breaks — Caveats

**QA verdict** (from qa-report.md): FAIL (2 LOW). The live logged-in paths are NOT_RUN.
**PM verdict**: Caveats

**Assessment**:
- **Part A under R-003, the change that mattered most this iteration:**
  - **The walled all-ages work.** In `live-wall-01-needs-login.png`, pixiv's own wall reads "This work may contain sensitive content. … Please log in to view this work." Directly beneath it, in pixiv's row, is `Log in to download`: white, gray outline, no icon, 164 px, with the accessible name `Log in to pixiv to download this work.` In iteration 1 the same work showed `Download · 4P` → `Saved · 4P` under the same wall. R-003 asked for exactly that to stop.
  - **The R-18 work.** In `live-r18-01-needs-login.png`, `Log in to download` sits under pixiv's "R-18 works cannot be displayed".
  - **Nothing is fetched.** By CDP initiator, the extension requests only `/ajax/illust`. No offscreen document is created and no file is downloaded.
  - **The race.** A click before the metadata arrives spins with `Download` (`live-wall-03-clicked-before-metadata.png`), then becomes `Log in to download` (`live-wall-03-race-needs-login-pill.png`). No request goes to `/pages`, `ugoira_meta` or the image host. The brief spin followed by the switch is honest, because the new label says why nothing downloaded.
  - **The login link.** The click goes to `accounts.pixiv.net/login?return_to=…` (live). The fake round trip ends `Download · 68P` → `Saved`.
- **Iteration-1 spec gap "the login copy says R-18 on all-ages works": resolved.**
  - `aria_login` is neutral in all four `src/_locales/*/messages.json`.
  - A mid-job 403 on an all-ages work (`09-403-needs-login-row.png`) no longer claims "R-18".
- **Part B:**
  - `04-retry-3-failed-row.png` matches `mocks/cuj-5-retry-row0.png`. The retry fetches only p4, p9 and p11, then shows `Saved · 12P`.
  - The offline, server-failure (`06-server-failure-row.png`) and refused states each show their exact tooltip.
  - `07-unavailable-row.png` is now legible: `#5f6368` on `#f1f3f4`, 5.44:1, where iteration 1 had 3.31:1.
  - `08-encode-failed-row.png`: `Retry · MP4`.
  - Cancelling is never red.
- **Part C:**
  - `11-floating.png`: the pill floats at the artwork's bottom-right, with its shadow.
  - `11-row-restored-row.png`: it moves into the row and keeps `Saved · 12P` (dark theme).
- **Iteration-1 caveat "No connection during a pixiv outage": mostly resolved.** It used to be 4 of 7 Retries. Now it is 1 of 7 (`edge-outage-503.json`).

**Caveats / gaps**:
- **The residual wrong diagnosis.**
  - What QA saw: during a sustained 500 or 503, 1 of 7 consecutive Retries says "No connection. Retry when you're back online." It happened in 5 of 5 replays, on the 6th or 7th click.
  - Mechanism: on that click Chromium refused all 4 attempts locally, so no request reached the server. No request therefore carries a `lastStatus`, and `isUnanswered` classifies the job `offline` (`src/shared/outcome.ts:27`, `:35`; `src/shared/retry.ts:58-73`).
  - Why it matters: on that same click, `/ajax/illust` and `/pages` answered 200 through the tab. The extension had proof that the connection was up, and still told the user to check it. It takes 5 or more Retries in one outage, but it is exactly the claim CUJ-5 exists to get right.
- **The floating fallback appears at 3011–3023 ms against "within 3 s"** (`logs/diag-float.log`).
  - No user can perceive 11–23 ms. Floating *earlier* has a visible cost: on a slow pixiv render, the pill floats, then jumps into the row.
  - So this is not a product caveat on its own. It is an acceptance-criterion miss with a known cause: the timer runs from route entry, and placement happens after it fires (`src/content/mount.ts:208-218`). Priority 3 fixes it inside the 3 s.
- **Evidence gap: the live logged-in paths are NOT_RUN.** These are the second halves of AC 2 and AC 4, AC 8, and the stale-page probe. They are in `docs/release-checklist.md` §3.
- **Evidence note, not a finding.** The outage frames `edge-outage-*-click{1,7}.png` show a light-blue fill under a red `Retry`. That is the 120 ms background transition from the busy fill, captured mid-way (`src/content/button/styles.ts:44`). The settled state is `06-server-failure-row.png`.

**Spec gap**: S2 (Unavailable and hover-tint contrast), S3 (detection table, including the case where every attempt is throttled locally), S4 (the floating-fallback anchor), S10 (derived outcome mappings), S12 (R-003 residuals), S14 (the `Retry-After` marker).

## Recommended Next-Iteration Priorities
1. **[coder] CUJ-3: drop line breaks from pasted or dropped text.**
   - Change: in `src/options/page.ts` `initOptionsPage`, intercept inserted text on `#pattern` (`beforeinput` for paste, drop and `insertText`). Remove CR and LF before the text reaches the field, and keep the caret, the 200-character cap and the usual debounce, validation and autosave.
   - Also correct `docs/design/design-options-page.md:146`: Chromium replaces line breaks with spaces for user input; it does not strip them.
   - Done when:
     - QA's red e2e `e2e/cuj3.spec.ts` "edge: newlines …" passes: `pixiv/⏎{artist}⏎-{id}` → `pixiv/{artist}-{id}`, with the preview `Downloads/pixiv/みずき-135882741/135882741_p0.jpg`;
     - the 200-character e2e still passes.
   - Flips CUJ-3 to Satisfied.
2. **[tl design, then coder] CUJ-5: "No connection" only when the user's connection really failed.**
   - If R-004 is answered **A** before Phase 1, build the job-level rule (S3). In `src/shared/outcome.ts` `errorCause`, unanswered network failures read `offline` only if nothing in this job got an HTTP answer from pixiv. A job whose API calls answered counts as answered.
   - Otherwise, stay within today's step 6 wording: remember the last 429/5xx per original or zip URL for Chromium's throttling window, in a way that survives a service-worker restart. A later request to that URL that the browser refused counts as answered (`src/shared/retry.ts` `withLastStatus`, `src/shared/outcome.ts` `isUnanswered`).
   - Either way, update system.md §9 and §10 row 8 and close §15 item 6's residual.
   - Done when:
     - `docs/qa-artifacts/iter2-03-48-13/walk-scripts/diagOutage.ts` (dev build, real timing) runs at least 3 replays of 7 clicks each for both 503 and 500, and every click reads "pixiv isn't responding…";
     - with the server stopped, the result is still "No connection…" (5 of 5);
     - when the server comes back, the download ends `Saved`.
3. **[tl design-doc, then coder] CUJ-5: floating-fallback timer.**
   - tl restates design-artwork-button.md "Mounting (mount.ts)" and the system.md §11.6 row "3 s timer from artwork-route entry" with two decisions:
     - **(a) The anchor.** pm's position: keep route entry (content-script start on a full load, the URL change on SPA navigation). Do not use navigation start: pixiv renders its row after `document_end`, so an earlier anchor would float the pill on slow loads and then jump it into the row.
     - **(b) A placement budget inside the 3 s.** The timer fires at 3000 ms minus the budget, so the rAF-coalesced placement lands by 3000 ms. tl picks the budget from the measured overshoot: 11–79 ms, including the code review's loaded runs.
   - Then change `src/content/mount.ts` `show()` and its use of `FLOAT_FALLBACK_MS` (`src/shared/constants.ts:68`).
   - Done when:
     - `walk-scripts/diagFloat.ts` is at or under 3000 ms in all 10 samples (5 direct, 5 SPA);
     - the cuj5 floating e2e passes at its existing 3000 + 100 ms budget in two full parallel runs.
   - With priority 2, this flips CUJ-5 to Satisfied.
4. **[pm with the owner, R-004] prd-000 spec-sync batch.** The owner answers R-004 (`docs/owner-queue.md`), then pm applies the approved items to the PRD and mocks, citing R-004, and tl reconciles the design docs in the next Phase 1. Each item lists what changes and pm's recommendation.
   - **S1. Ugoira width** (system.md §15 item 10; QA's LOW VISUAL_DEVIATION).
     - CUJ-2 step 1: "The same 164 × 40 px blue pill" → "The same 40 px pill, at the §4.7.2 width (176 px in English, because `Download · WebM` is a reachable label)".
     - Widen `cuj-2-initial.html` and `cuj-2-encoding.html` to 176 px.
     - §4.7.2: drop "(assumption — confirm)" on the provisional width (verified: ≤ 99 pages stay 164 px; 200 pages widen once, to 170 px). Add that an ugoira clicked before its metadata arrives keeps the provisional width, so a WebM hint may be cut with an ellipsis. Accept this: it needs a click inside the metadata latency window.
   - **S2. Contrast** (§15 item 7). Write the values the build ships into the PRD:
     - index "Contrast", and §4.7.3 Unavailable text: `#80868b` → `#5f6368`;
     - §4.7.7 "Every other state passes 4.5:1";
     - CUJ-3 step 3 `Saved`: `#188038` in light mode (dark keeps `#1a9f5a`);
     - CUJ-3 step 5 message: `#c5221f` light / `#f28b82` dark (the 2 px border stays `#d93025`);
     - "Still using" trailing text: `#5c6166`;
     - the `cuj-3-*` mocks.

     Record one exemption: hover tints. The error hover (`#d93025` on `#fdeceb`) is 4.18:1, and the Saved hover (`#0096FA` on `#e6f4fe`) is 2.78:1, a new finding with no spec coverage. Recommend accepting both: they show only under the pointer, the label does not change, and the accessible name carries the meaning. Keep pixiv blue on white (3.11:1) for parity, and drop its "(assumption — confirm)".
   - **S3. Outage detection** (§15 item 6, including the case where every attempt is throttled locally). In the CUJ-5 step 6 table:
     - "No connection": `navigator.onLine === false`, or no request in this click got any HTTP answer from pixiv, with 0 pages saved.
     - "pixiv server failure": pixiv answered at least once in this click but nothing was saved.

     Recommended:
     - It fixes the residual deterministically.
     - It needs no time-windowed memory.
     - It matches what the user reads: "No connection" is a claim about their network.

     Cost: "pixiv's API answered, then every image connection reset" reads "pixiv isn't responding". That is the truer message, because www.pixiv.net just answered.
   - **S4. Floating-fallback anchor.** CUJ-5 step 11 and its acceptance criterion say "within 3 s of the artwork page rendering", and the extension cannot observe "rendering". Change it to "within 3 s of the artwork page loading, or of pixiv's in-app navigation to it". The 3 s stays.
   - **S5. Unclosed `{`** (§15 item 12). CUJ-3 step 5: a `{` with no closing `}` is invalid and shows the unknown-token message, naming the fragment. A lone `}` stays literal.
     - Reason: the 400 ms autosave stores a fragment such as `pixiv/{user` when the user pauses mid-token.
     - Cost: a token typed slowly by hand shows the error until `}` is typed. Chips, the main path, are unaffected.
   - **S6. Chrome's download bubble** (§15 item 1).
     - CUJ-1 step 2: "lists files as they start" → "lists each file once its bytes are complete".
     - CUJ-1 step 5: drop the "Canceled" entries. Unfinished files never reach Chrome.
     - Align the CUJ-4 edge "Chrome's own downloads button" with this.
   - **S7. Keyboard order** (§15 item 11). CUJ-1 edge: "Tab reaches the button in pixiv's own row order, next to Like".
   - **S8. §4.4 step 3 "Literal text … used as typed"** (§15 item 3): add "…except where Chrome's path rules require a change; the preview shows the exact result".
   - **S9. Derived copy** (§15 item 4).
     - Add the `_one` variants to Appendix A: `action_title_one_single`, `aria_busy_pages_one`, `aria_saved_pages_one`, `live_start_one`, `live_saved_one`, `live_failed_one`.
     - Confirm every string marked "(derived)" (the `tip_*`, `aria_*`, `live_*` and `err_illegal_chars` keys).
     - Translations stay subject to native review before release.
   - **S10. Derived outcome mappings** (§15 item 5; system.md §10).
     - Endorse:
       - a zip 403 → needs login;
       - `dismissed` grouped with `disk`;
       - a failed ugoira video save → `tip_disk`;
       - `internal` and throttled-after-5xx failures → `server`;
       - WebM selected but VP9 not encodable → MP4.
     - An ugoira whose only failure is `metadata.json`: accept the design (a full retry, classified as `disk`) and add no new copy. This revises pm's iteration-1 proposal; the case needs a local write failure that spares the zip and the video.
   - **S11. §4.8** (§15 item 8). A counted total of 0 shows the idle title, and "across N downloads" counts only jobs that still have files. Drop "(assumption — confirm)" on the ugoira counting 1 during its zip fetch; this was walked in iterations 1 and 2.
   - **S12. R-003 residuals** (§15 item 9).
     - (b) CUJ-5 Part A step 1, "metadata (`xRestrict` 1)" → "`xRestrict` ≥ 1, or no image URLs in pixiv's answer".
     - (c) Add the logged-out probe facts to §4.2.
     - (d) Endorse: a click made before the metadata arrives, on a walled or R-18 work, ends in `Log in to download` and fetches nothing.
     - (a) Narrow the CUJ-5 edge "Logged out in another tab after this page loaded … the click is refused" to R-18 and R-18G works.
       - For a walled all-ages work on such a stale page, the download proceeds. pixiv showed the work when the page loaded and still serves it to that session.
       - Refusing on `urls.original === null` for a page that says it is logged in could refuse works P1 can see.
       - This reads R-003 for a case the ruling did not name, which is why it is part of R-004. Revisit it after the release-checklist §3 stale-page probe.
   - **S13. CUJ-2 step 6.** "`0%` → `100%` by zip bytes, then `Saved · ZIP`" → "`0%` rising with zip bytes, then `Saved · ZIP`". In §4.7.5, add: "The busy label never shows `100%`; the button turns Saved when the last file lands" (code review Info 3; live: `40%` → `Saved · MP4`).
   - **S14. §4.5.2 `Retry-After`.** Drop "(assumption — confirm)". The mechanism sees the header, and the 30 s cap was verified (§15 item 2).
   - **S15. Mock polish.**
     - `cuj-3-error.html`: keep "Still using:" on one line.
     - `cuj-2-encoding.html`: the tooltip `Cancel` → `Cancel download`.
   - **Code follow-ups, if approved.** Three items change the build:
     - S3 → priority 2;
     - S5 → `src/shared/pattern.ts` `validatePattern`: an unclosed `{` returns `unknownToken`, plus one test row (system.md §15 item 12);
     - S15 → `src/options/options.css`: keep the "Still using:" label on one line.
5. **[qa] Verification next cycle.**
   - a. Re-run `diagOutage.ts` (priority 2), `diagFloat.ts` (priority 3) and the paste e2e (priority 1). Also paste a single-line pattern copied with a trailing newline: the field must hold no trailing space.
   - b. Once the R-004 amendments land:
     - compare CUJ-2 against the widened mocks and CUJ-3 against the recoloured mocks, and stop logging the 176 px deviation;
     - tl adds the literal 176 px English assertion if it does not depend on the font (code review Warning 3).
   - c. Take state screenshots after the 120 ms background transition settles.
6. **[release, owner-run before Web Store submission; not a loop gate] `docs/release-checklist.md` §3, the logged-in checks:**
   - action-row placement;
   - pixiv's dark theme;
   - R-18 after a real login;
   - R-18 display off;
   - the R-003 stale-page probe, which S12(a) leans on.

## PRD Lifecycle Changes (if any)
- None. prd-000-mvp stays `active`, because CUJ-3 and CUJ-5 are Caveats.
