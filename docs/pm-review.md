# PM Review

Last updated: 2026-10-22 21:14:11 (UTC-7)
Iteration: 1
Scope: all active PRDs (prd-000-mvp, CUJ-1 … CUJ-5)

## Overall Assessment
Iteration 1 ships the product as designed:
- one blue pill that reads as the action row's single obvious action;
- a settings page with exactly three settings that save themselves;
- a toolbar badge that tells the truth;
- recovery states that match the mocks.

It also works on live pixiv for logged-out, all-ages works: 6 instrumented walks, every file byte-exact.

The open issues are small but real. Two wrong signals keep CUJ-3 and CUJ-5 at Caveats:
- `✓ Saved` shows next to a validation error;
- "No connection" shows during a pixiv outage.

Most of what remains is in the spec, not the code. That includes one policy question that only the owner can answer (R-003). One fix iteration plus one spec-sync pass should close prd-000. After that, the largest release risk is the logged-in live surface, which has not been verified.

## Per-CUJ Verdict

### CUJ-1: Download an illustration or manga from the artwork page — Satisfied

**QA verdict** (from qa-report.md): PASS
**PM verdict**: Satisfied

**Assessment**:
- **Step 1, the obvious action.** On live pixiv (`cuj-1/run1/live-00-initial.png`, `live-a-00-row.png`), the pill sits in pixiv's real action row, immediately left of Like. It is the only filled, saturated control there, so it reads as the primary action, as the mocks intended (`00-initial-row.png` vs `mocks/cuj-1-initial-row0.png`). It measures 164 px in every state in both fake runs and in all 6 live walks (`live-*-walk.json`).
- **Steps 2–3.** `02-click-busy` and `03-progress-row.png` (`7 / 12` with the ring) match `mocks/cuj-1-downloading-row0.png`. Through the `chrome.action` getters, the badge read `12` → `5` → empty. (The toolbar itself cannot be captured, so this rests on the getters.)
- **Steps 4–5: cancel feels safe.**
  - `04b-pointer-still-on-button-row.png` still shows progress (`5 / 12`) while the pointer rests where it clicked, so the user never sees `Cancel` under their cursor right after starting.
  - `04-hover-cancel-row.png` is neutral `#3c4043` with an X, not red.
  - `05-cancelled-row.png` is back to `Download · 12P` with no styling.
  - Per the QA server log, no request for the artwork followed, and the 6 completed files stayed.
- **Steps 6–7: Saved lasts until reload.** `06-saved-row.png` matches `mocks/cuj-1-saved-row0.png`, with the exact folder tooltip. `07-spa-back-row.png` still shows `Saved · 12P` after an SPA round trip. `09-reload-idle` shows `Download · 12P`.
- **Step 8.** The re-download writes ` (1)` duplicates into the same folder.
- **Edges:**
  - dark-theme `#5fb9fb` ring (`edge-1-dark-focus.png`);
  - reattach after a reload mid-job (`edge-3-reload-mid-job-row.png`, `4 / 12`);
  - a 200-page manga constant at 170 px (`edge-5-200-pages-saved-row.png`);
  - the sanitized artist name;
  - a locale-prefixed URL;
  - no button on non-artwork pages.
- **Live.**
  - Every live original's size equals its `Content-Length`.
  - `metadata.json` has the 12 keys.
  - Saved arrived 6–24 s after the click. The 24 s walk includes a 23 MB first page.

**Caveats / gaps** (none change the verdict):
- **Latent width deviation (from code, not observed).** If pixiv renders the action row before `/ajax/illust` answers, which is exactly the case PRD §4.7.1 provides for:
  - The width locks on `candidates(null)` (`src/content/button/width.ts:40`): the 99-page faces plus every ugoira face. That measures 176 px in English (`Download · WebM`).
  - `settleWidth` never shrinks (`width.ts:83-86`).
  - So an illustration whose metadata arrives late stays at 176 px. That breaks the AC "164 px … on a work of 99 or fewer pages" and §4.7.2 "starts at the 2-digit width and may widen once".
  - Every walk measured 164 px because metadata won the race. The row still never shifts, but QA will hit this on a slow network.
- **Latent folder-level loss (code-review W3, not walked).** A token value made only of `~`/`.` (for example an artist named `~`) drops a whole folder level: `pixiv/{artist}/{title}` → `pixiv/<title>`. It should become `unknown`. This contradicts §4.4 step 1.6 and the CUJ-1 edge case "the folder never gets an empty segment".
- **Evidence gap: logged-in live is NOT_RUN.** P1 (Aoi) is always logged in, and her action-row DOM has never been seen live (code-review Info 2). If pixiv's logged-in row differs, the button would float instead of sitting in the row. This is the biggest unverified surface for the primary persona.

**Spec gap**:
- **Steps 2 and 5, Chrome's download bubble.** Bytes are fetched in the offscreen document and handed to Chrome as `blob:` URLs (D1, system.md §8.4). As a result:
  - The bubble lists each file when it is complete (`metadata.json` immediately, then each original as it finishes), not "as they start".
  - A cancel leaves no "Canceled" entries.
  Product judgment: acceptable, and cleaner for the user. Amend the wording only.
- **Edge "Keyboard and screen reader".** The PRD says Tab reaches the button "after pixiv's Share/More, before Like". pixiv's live row is `row-reverse`, so the button must sit after the Like wrapper in the DOM to appear left of Like (code-review Info 1). Following pixiv's own row order is right. Amend to "Tab reaches the button in pixiv's row order, next to Like".

### CUJ-2: Download an ugoira — Satisfied

**QA verdict** (from qa-report.md): FAIL (one LOW VISUAL_DEVIATION: 176 px vs 164 px, a PRD-internal conflict)
**PM verdict**: Satisfied

**Assessment**:
- All 12 acceptance criteria pass in both runs.
- **Screens** (`cuj-2/run1/`):
  - `00-initial-row.png`: `Download · MP4`, same style as `mocks/cuj-2-initial-row0.png`
  - `03-encoding-row.png`: `53%` with the ring; badge `1` and Chrome idle, per the QA notes
  - `04-hover-cancel-row.png`
  - `05-saved-row.png`: `Saved · MP4`
  - `06-zip-only-saved-row.png`: `Saved · ZIP`
  - `edge-1-cancelled-row.png`: back to `Download · MP4`
- **Output fidelity:**
  - ffprobe: 48 frames × 100 ms = 4800 ms.
  - Mixed delays (40/40/500/40) are kept exactly.
  - 601×451 → 600×450.
  - The zip is sha256-identical to the source.
  - `frames.json` deep-equals pixiv's array.
  - The MP4 plays in Chrome (`05-mp4-plays-in-chrome.png`). QuickTime and VLC are checked by proxy only.
- **The 176 px width serves the intent.** The implementation follows §4.7.2: the widest label this artwork can show, which includes `Download · WebM`. The WebM label is reachable two ways: through a settings change while the page is open, or when H.264 is unavailable. `07-webm-idle-row.png` shows `Download · WebM` filling the pill exactly, which is why the width is needed. At 176 px, `Download · MP4` still looks balanced (`00-initial-row.png`). Users don't compare pill widths across artworks. The no-shift rule is what matters, and it holds. This is a spec defect, not an implementation one.

**Caveats / gaps**:
- **Evidence gap: no live ugoira walk.** Every CUJ-2 walk used fake-pixiv synthetic frames, and `e2e/live/smoke.spec.ts` selects only `illustType === 0`. All-ages ugoira can be downloaded logged out, so a live walk needs no account. It would exercise real `i.pximg.net` zips, real JPEG frames and real delays for a P0 journey. Add it before release.

**Spec gap**:
- **Width conflict.** CUJ-2 step 1 ("The same 164 × 40 px blue pill") and the mocks `cuj-2-initial.html` and `cuj-2-encoding.html` (164 px) contradict §4.7.2.
  - Resolution: keep §4.7.2 as the governing rule. Amend step 1 to "the same 40 px pill, at the §4.7.2 width (176 px in English, because `Download · WebM` and `Saved · WebM` are possible labels)". Widen both mocks.
  - Rejected alternatives:
    - shortening the labels: there is no shorter honest label for WebM;
    - sizing to the effective format: the width would change whenever the setting changes.
- **Derived: WebM selected but VP9 not encodable → MP4** (system.md §15 item 5). Endorse. It mirrors the H.264 → WebM rule, and the hint stays honest.
- **Derived: an ugoira whose only failure is `metadata.json`.** The design treats this as `error: disk` with a full retry, which re-saves the zip and the video as ` (1)` duplicates.
  - Proposal: a metadata-only retry, with copy such as `<format> and frames saved. metadata.json couldn't be saved. Click to retry it.` (derived, confirm).
  - This is rare, because `metadata.json` is built locally. It is a low-priority confirmation.

### CUJ-3: Configure the extension from the toolbar icon — Caveats

**QA verdict** (from qa-report.md): FAIL (one LOW BUG)
**PM verdict**: Caveats

**Assessment**:
- The page is the product's positioning in one screen: exactly three settings, no Save button, and a quiet `Saved` per section.
- **Matches the mocks:**
  - `cuj-3/run1/00-initial.png`, `07-webm-saved.png` and `01-dark.png` match `mocks/cuj-3-initial.png`, `mocks/cuj-3-saved.png` and the dark spec.
  - `09-reset.png` shows `Saved` only beside the two sections that changed (`main-walk.json`: folder hidden, ugoira and metadata visible), as step 9 specifies.
  - `12-locale-ja.png` is fully localized, using pixiv's own term うごイラ. The zh_CN and zh_TW walks found no English strings.
- **Behavior:**
  - A second toolbar click focuses the existing tab. QA drove this through the e2e hook, because the toolbar cannot be clicked from Playwright.
  - Invalid values are never stored.
  - A download started with `{artst}` in the field saved into the last valid pattern's folder.
  - Keyboard order follows the step list.

**Caveats / gaps**:
- **`✓ Saved` next to a validation error.**
  - What shows: `cuj-3/run1/05-error.png` and `run2/05-error.png` show a green `✓ Saved` at the right of the Download folder heading while the field is red, `Unknown token {artst}` is displayed, and "Still using" names a different pattern.
  - Why it matters: step 5 says "No `Saved` appears", and the `cuj-3-error` mock has none. This is the moment the page must be unambiguous. "Saved" beside "Unknown token" invites the user to conclude the typo was stored.
  - How common: autosave fires 400 ms after any pause on a valid prefix, so typing `pixiv/{art`, pausing, then typing `st}` produces a save and then an error within 2 s.
  - Cause: `showError` (`src/options/page.ts:99-106`) never clears the folder indicator, and `src/options/saved.ts` has no way to clear it. The fix is small.

**Spec gap**:
- **Half-typed tokens get autosaved.** Step 5 makes an unclosed `{` a literal character (QA: `a/{b` → no error). Combined with the 400 ms autosave, a pause mid-token saves a fragment such as `pixiv/{user` as the "last valid pattern":
  - `validatePattern` matches only closed `{…}` (`src/shared/pattern.ts:44, 103-105`).
  - If the user then leaves a typo behind, downloads go to a literal `{user` folder, and "Still using:" names that fragment rather than the pattern they had.

  Proposal: a `{` with no closing `}` is invalid and uses the unknown-token message, so nothing half-typed is ever saved. A lone `}` can stay literal.
- **Saved-green contrast.** `Saved` green `#1a9f5a` on `#f6f7f9` is **3.19:1** at 12.5 px. That is below the PRD's own rule (index "Accessibility": every pair except pixiv blue must reach 4.5:1). The mock carries the same color. Proposal: `#188038` in light mode (4.68:1). Dark mode can keep `#1a9f5a` (5.49:1 on `#121212`).
- **"Still using:" line layout.** In both the mock and the build (`05-error.png`, `mocks/cuj-3-error.png`), the label wraps to "Still / using:" and the pattern breaks mid-token. Mock polish: keep the label on one line and let only the pattern wrap.
- **§4.4.3 "Literal text in the pattern is used as typed" vs D8** (system.md §15 item 3). Chrome's path-safety pass also rewrites literal text:
  - trailing `.`, space and `~`;
  - Windows reserved names;
  - shell-integrated extensions.

  The preview always shows the result, so nothing surprises the user. Amend to "used as typed, except where Chrome's path rules require a change; the preview shows the exact result".

### CUJ-4: Follow several downloads at once from the toolbar badge — Satisfied

**QA verdict** (from qa-report.md): PASS
**PM verdict**: Satisfied

**Assessment**:
- The badge answers "is anything still coming?" whichever tab is in front.
- **Two jobs** (`cuj-4/run{1,2}/main-walk.json`):
  - job B started 28 ms (run1) and 41 ms (run2) after A;
  - the badge read `23` with "… 23 files remaining across 2 downloads";
  - it dropped within 85–94 ms of a landing from either job;
  - after B saved, it showed `17` with the one-job title;
  - cancelling A cleared it, and the idle title returned within 341–375 ms (within the 1 s NFR);
  - a toolbar click during the jobs left them running.
- **Edge walks:**
  - `02-tab-b-busy.png` (`3 / 8`) matches `mocks/cuj-4-initial.png`;
  - `edge-2-after-sw-restart-row.png` keeps counting (`7 / 12`), with the badge correct 87 ms after the service worker stopped;
  - an ugoira counts 1 (`7` across 2);
  - `999+` is covered by an automated test.

**Caveats / gaps**: none. The badge pixels themselves are not capturable, so the evidence is the `chrome.action` getters.

**Spec gap**:
- **Title with 0 counted files.** PRD §4.8 does not define this case, for example a metadata-only retry, or a job clicked before its metadata resolved. The title then reads "Helper for Pixiv — 0 files remaining" while the badge is hidden (code-review W1, `src/background/badge.ts:38-42`). Proposal:
  - a total of 0 → the idle title;
  - "across N downloads" counts only jobs with at least one remaining file.
- **§4.8 assumption: the ugoira job counts 1 during its zip-fetch phase too.** Implemented and walked. Confirm.

### CUJ-5: Recover when a download can't start or breaks — Caveats

**QA verdict** (from qa-report.md): FAIL (one LOW BUG, partly a spec gap; the live logged-in paths are NOT_RUN)
**PM verdict**: Caveats

**Assessment**:
- **Part A, needs login.**
  - On live pixiv, an R-18 work viewed logged out shows `Log in to download` in the real row, under pixiv's own "R-18 works cannot be displayed" wall (`cuj-5/run1/live-01-needs-login.png`).
  - The click lands on `accounts.pixiv.net/login?return_to=…`, with `/en/` kept.
  - The fake-pixiv round trip goes `03-after-login-idle` → `03-after-login-saved` (`Saved · 68P`).
- **Part B, reactive errors.**
  - **Partial failure.** `04-retry-3-failed-row.png` matches `mocks/cuj-5-retry-row0.png`, and the tooltip is exact. The retry continues at `9 / 12` with badge `3` (`05-retrying-row.png`), then reaches `Saved · 12P`. Per the server log, only p4, p9 and p11 were fetched again, into the same folder.
  - **Cause states.** Each has its exact tooltip:
    - offline, with the server really stopped (`06-offline-row.png`);
    - server failure (`06-server-failure`);
    - refused (`06-refused`);
    - Downloads folder not writable.
  - **Other states:**
    - `07-unavailable-row.png`: gray, and a click does nothing;
    - `08-encode-failed-row.png`: `Retry · MP4`, with the zip and `frames.json` on disk and no video;
    - `09-403-needs-login`;
    - `10-cancel-not-error`: cancelling shows no red.
- **Part C, floating fallback.** `11-floating.png` places the pill at the artwork's bottom-right after 3069 ms. It moves into the row when the row appears and keeps `Saved` (`11-row-restored`).
- **Retry policy.** 403 is never retried. Each 5xx gets 4 attempts.
- The intent holds: the label gives the gist, the tooltip the detail, and the extension adds no other text to the page.

**Caveats / gaps**:
- **Wrong diagnosis during a sustained outage** (`docs/qa-artifacts/iter1-20-23-42/logs/outage-503.log`, dev build, real backoff):
  - Clicks 1–3 say "pixiv isn't responding…". Clicks 4–7 say **"No connection. Retry when you're back online."**, while the user is online and pixiv is the one failing.
  - Mechanism: Chromium throttles an extension's repeated 5xx requests on the client side. Those refused attempts become `network` failures (`src/shared/retry.ts:126`). `errorCause` then reads "every failure is network" as offline (`src/shared/outcome.ts:24-33`).
  - Impact: CUJ-5 exists to say what happened. This sends a frustrated user to debug a working connection at exactly the moment pixiv is down.
  - Same class of bug: code-review W2. A refused or unreachable offscreen command also ends as "No connection".

**Spec gap**:
- **Step 6 detection table.** It does not foresee browser-side throttling. Amend:
  - **No connection:** no request in this job got any HTTP response from pixiv, or `navigator.onLine` is false.
  - **pixiv server failure:** also covers attempts the browser refused after earlier 5xx answers.
- **`aria_login` copy.** The text "Log in to pixiv to download this R-18 work" is also used by step 9 (403 mid-job, e.g. an expired session) on **all-ages** works. In the walk, `09-403-needs-login` on all-ages 135882741 gave exactly that `aria-label` and live announcement (`main-walk.json`), so screen-reader users hear a false claim. Add a neutral variant for step 9, e.g. `Log in to pixiv to finish downloading this work` (derived, confirm). R-003 option B needs the same.
- **Unavailable contrast.** `#80868b` on `#f1f3f4` is **3.31:1**, while §4.7.7 says "Every other state passes 4.5:1". The colors are marked as an assumption and were never mocked. In `07-unavailable-row.png` the pill nearly disappears into pixiv's light-gray page, and its label is the only explanation the user gets. Proposal: `#5f6368` text (5.44:1).
- **Derived outcome mappings** (system.md §10):
  - **Row 4, zip 403 → needs login.** Endorse: same meaning as a 403 on originals.
  - **Row 8, `dismissed` grouped with `disk`.** Endorse: QA saw Chrome report a read-only Downloads folder as `USER_CANCELED`, so this grouping is what makes the disk case work. A user who really dismissed every "Ask where to save" prompt then reads "Check free space". That is accepted as the known v1 limitation, and optionally the copy could be broadened.
  - **Row 9, video save failure → `tip_disk`.** Endorse.
- **Policy: pixiv's sensitive-content wall.**
  - What QA saw live: work 151107515 is `xRestrict` 0, but pixiv hides it from logged-out visitors behind "This work may contain sensitive content. Please log in to view this work." The extension shows `Download · 4P` and ends in `Saved · 4P` directly beneath pixiv's login prompt (`cuj-1/run1/live-00-initial.png`, `live-02-end.png`).
  - Why it matters: this follows the spec (Part A keys on `xRestrict` only), but it hands over what pixiv withholds, and it goes beyond the store single-purpose line "save the pixiv artwork you are viewing".
  - Filed as **R-003** in `docs/owner-queue.md`. The recommendation is to treat the wall like R-18.
  - This is not counted against this iteration's verdict.

## Recommended Next-Iteration Priorities
1. **[coder] CUJ-3: clear `Saved` when an error appears.**
   - Change: add `clear()` to `SavedIndicator` (`src/options/saved.ts`), which cancels both timers and empties the element at once. Call it for the folder section in `showError` (`src/options/page.ts:99-106`). Add an e2e regression.
   - Done when: inserting a chip and then typing `pixiv/{artst}-{id}` within 2 s shows no `Saved` beside Download folder.
   - Flips CUJ-3 to Satisfied.
2. **[tl design, then coder] CUJ-5: "No connection" only when pixiv never answered.**
   - Change: record per request whether any attempt got an HTTP status. A final network failure that follows a 5xx or 429 is a `server` failure. This touches system.md §10 row 8, `src/shared/retry.ts` and `src/shared/outcome.ts`.
   - Also fold in code-review W2: a refused or unreachable offscreen command becomes an internal kind, classified as `server`.
   - Done when:
     - QA's replay of 7 consecutive Retry clicks against a sustained 503 (`docs/qa-artifacts/iter1-20-23-42/walk-scripts/diagOutage.ts`, dev build) shows "pixiv isn't responding…" on every click;
     - a stopped server still shows "No connection…".
   - Flips CUJ-5 to Satisfied, together with spec-sync item 5f.
3. **[coder] CUJ-1: provisional width when metadata is late.**
   - Change: `candidates(null)` = the 99-page faces only (`src/content/button/width.ts:40`). An illustration with late metadata then stays at 164 px, and an ugoira widens once to its §4.7.2 width before any interaction. Update design-artwork-button.md "Fixed width" to match.
   - Done when: a test with a delayed `/ajax/illust` passes.
4. **[tl, then coder] CUJ-1/CUJ-3: token values made only of `~`/`.`** (code-review W3).
   - Change: apply the D8 edge trim to each token value before substitution, falling back to `unknown`. Also correct the design Golden row to `~sora~-1 → sora_-1` (W4).
   - Done when: `resolveFolder('pixiv/{artist}/{title}', artist '~')` returns `pixiv/unknown/<title>`.
5. **[pm, spec-sync]** One `/spec-sync` or `/design-feature` Route D pass with the owner, covering the PRD and the mocks:
   - a. CUJ-2 step 1, `cuj-2-initial.html` and `cuj-2-encoding.html`: width per §4.7.2 (176 px in English). Resolves QA's LOW VISUAL_DEVIATION.
   - b. CUJ-1 steps 2 and 5, and the CUJ-4 edge "Chrome's own downloads button": Chrome's bubble wording under the blob hand-off.
   - c. CUJ-1 edge "Keyboard": Tab follows pixiv's row order, next to Like.
   - d. §4.4.3: the D8 exception to "used as typed".
   - e. CUJ-3 step 5: an unclosed `{` is invalid, so no half-typed autosave.
   - f. CUJ-5 step 6 detection: "No connection" only when pixiv never answered; throttled attempts after 5xx count as a server failure.
   - g. Copy:
     - a neutral `aria_login` variant for CUJ-5 step 9;
     - confirm the derived `_one` / `live_*` keys (system.md §15 item 4) and the derived tooltips (`tip_partial_one`, `tip_server`, `tip_disk`, `tip_metadata_only`);
     - decide the ugoira metadata-only retry and its copy.
   - h. Contrast: `Saved` green to `#188038` (light only) and Unavailable text to `#5f6368`. Update the index "Accessibility" section, §4.7.3, CUJ-3 step 3 and the `cuj-3-*` mocks.
   - i. §4.8 title: 0 counted files → idle title; "across N downloads" counts only jobs with remaining files (W1). Confirm the ugoira counts 1 during the zip fetch.
   - j. Confirm the derived outcome mappings: §10 rows 4, 8 and 9, and the VP9 → MP4 fallback.
   - k. `cuj-3-error.html` polish: keep "Still using:" on one line.
   - l. Once R-003 is answered with B: amend CUJ-5 Part A (trigger, copy, a new AC). Don't plan this work before the answer.
6. **[tl, Phase 1 design-doc reconciliation]**
   - Fold code-review W10's additive deviations into the design docs:
     - `ActionRowHit` and the row-reverse placement;
     - the fallback timer, which runs from route entry;
     - `FileTask.text`;
     - the `cancelDownload` effect;
     - the `retryEncode` call to `/ajax/illust`;
     - the `tooLong` error code;
     - the `writeSettings` return value;
     - `rawBytes`;
     - the §11.4 sentinel, now U+FDD0.
   - Fold the ENG-002 live selectors into system.md §8.2 and the design-artwork-button "pixiv DOM contract".
   - W6: move the job and protocol types into `src/shared`.
   - W7: restate the content-bundle budget.
   - W8: record encode attempts.
   - W11: build the fake-server fixture zips at server start.
   - Then reconcile everything with the outcome of item 5.
7. **[qa / tl, verification]**
   - a. Add a live all-ages ugoira walk (MP4 and ZIP only) to the live suite. No account is needed.
   - b. `e2e/live/smoke.spec.ts:115`: navigate with `waitUntil: 'domcontentloaded'` (the LOW FLAKY).
   - c. Point the CUJ-5 mapping in `e2e/README.md` to `e2e/cuj5.spec.ts`.
   - d. Logged-in live paths. These are P1's everyday surface and are needed before release:
     - R-18 after a real login;
     - R-18 display off;
     - pixiv's dark theme;
     - the logged-in action-row placement.

     They need an owner-run `npm run qa:live` with the owner's own session, or an L5 checklist entry. Credentials are never committed.
8. **[deferred ENG, P2, before Web Store submission]**
   - ENG-007: prod bundle free of test hooks, with a CI check.
   - ENG-006: packaging, notices and the release checklist. Its L5 list should include:
     - 7a and 7d;
     - QuickTime and VLC GUI playback;
     - "Ask where to save each file".

## PRD Lifecycle Changes (if any)
- None. prd-000-mvp stays `active`, because CUJ-3 and CUJ-5 are Caveats.
