# PM Review

Last updated: 2026-10-23 21:14:45 (UTC-7)
Iteration: 3
Scope: prd-000 (prd-000-mvp, CUJ-1 … CUJ-5, as amended by R-004, R-005 and R-006)

## Overall Assessment
The owner's complaint, "20 flying icons per manga", is fixed. A job is now one quiet save that ends with one done signal. QA sampled Chrome's own toolbar model every 4–9 ms over 26 busy periods. In each one:
- Chrome showed no downloads button and no bubble from the click until the restore;
- the button came back exactly once, with the job's last file;
- ends without a final hand-off (cancel, `Retry · 3 failed`, needs login, Unavailable) stayed silent.

All four iteration-2 items shipped: the paste fix, the outage diagnosis, the floating timer, and the R-004 batch.

One timing edge remains. When the last files land together, the bubble that pops open with the done signal can leave out the last file. It is cosmetic, but it shows at the one moment the user actually reads the bubble, and the fix is small. So CUJ-1 and CUJ-4 are Caveats for one more short iteration, together with four spec-sync items. The product is converging. No owner decision is needed.

## Per-CUJ Verdict

### CUJ-1: Download an illustration or manga from the artwork page — Caveats

**QA verdict** (from qa-report.md): FAIL (one `[LOW][BUG]`: AC 14c, intermittent)
**PM verdict**: Caveats

**Assessment**:
- **Steps 1–8 are unchanged and green.** The run1 re-walk had 57 checks and 0 failures.
  - `cuj-1/run1/06-saved-row.png` matches `mocks/cuj-1-saved-row0.png`: the outlined `Saved · 12P`.
  - `r006-03-6-of-12.png`: `6 / 12` with the ring, in the row left of Like.
  - All 12 originals are sha256-identical to the served bytes.
  - The pill is 164 px in every state.
- **Step 2 / AC 14a, no animation while saving: met.** The hide settled at or before `metadata.json` was created. With p11 held back there were 0 visible samples up to `11 / 12` (QA "Edge Cases", step 2 row).
- **Step 6 / AC 14b, one animation with the last file: met.**
  - Chrome's button appeared once, 11–12 ms after the restore.
  - `r006-twelve-native/twelve-after-end.txt` shows the `DownloadBubblePartialView` with `135882741_p11.jpg … Done` on top, then p10, p9 … down to `metadata.json`: 13 rows. The toolbar keeps `PinnedActionToolbarButton "New download available"`.
  - `cuj-1-saved.html` now matches.
- **The rest of §4.1 #3 behaves as written:**
  - a single image with metadata: one appearance, with the image;
  - metadata off: no `setUiOptions` call at all, exactly as before R-005;
  - the user's own download mid-job: no animation, and the bubble lists it afterwards with the job's 13 files;
  - a re-download: the first hand-off takes the button away, then it returns once.
- **Live, logged out, store zip:**
  - 151102843 (3P) and 151090410 (6P) each ended with one appearance, and the bubble listed all files;
  - `r006-live-151090410-02-end.png`: `Saved · 6P` in pixiv's real row.
- **Cancel (step 5): met.** `r006-cancel-idle-row.png` shows idle with no error style. There were 0 visible toolbar samples from the click until 3 s after the end. The next download brings the button back, and its bubble lists p4…p0 and `metadata.json` (QA step 5 row).

**Caveats / gaps**:
- **The bubble that opens with the done signal can omit the last file.**
  - What QA saw: in 5 of 8 store-zip runs, with no page held back, the bubble opened 0–3 ms after the restore. In `r006-summary-prodzip-race12-nohold.json` rep 2 it opened at 0 ms, p11 was created at 33 ms, and the rows read p10 … p0, `metadata.json`, with no p11. It was still missing 2.5 s later.
  - Mechanism: p10, already named while the UI was off, completed just after the enable. Chrome opens its partial view on a completed download, before p11 exists.
- **Product judgment: this blocks Satisfied, but it is not a release blocker.** From the user's side:
  - *Who notices.* On a 12-page job, practically nobody. The 466 px bubble shows about 8 of its 52 px rows, and the top row reads p10 instead of p11. On a 2–3-page work, the most common multi-page case on pixiv, the auto-opened bubble shows 2 rows for a 3-file job. An archivist who glances at it reads "page 2 didn't save" while the button says `Saved · 2P`. The done signal then contradicts itself at the only moment the bubble is read.
  - *How often in real use.* Low. Live runs: 0 of 6. The fake's originals are 592 B, which makes bursts extreme. The realistic bursts are small works on fast connections and re-downloads served from the HTTP cache.
  - *Harm.* No data is lost. The files on disk, `chrome://downloads`, the button and the badge are all correct.
  - *Why it still counts.* "Its bubble lists every file of the job" is the part of R-006 option B the owner chose over a silent end, and the fix is local and cheap. Pixiv-sized blobs are written in milliseconds.
- **Evidence gap.** Whether a bubble the user reopens by hand lists the missing file is unverified, because Playwright cannot click Chrome's toolbar (QA "Coverage Gaps").
- **Evidence gap, carried.** The logged-in live surface and pixiv's dark theme are NOT_RUN (`docs/release-checklist.md` §3).

**Spec gap**: none in CUJ-1's own text. The fix keeps §4.1 #3 true as written: the UI still comes back "just before the final hand-off", which now waits a few milliseconds longer.

### CUJ-2: Download an ugoira — Satisfied

**QA verdict** (from qa-report.md): PASS
**PM verdict**: Satisfied

**Assessment**:
- **Step 3, hidden through the zip fetch and the encode: met.**
  - `cuj-2/run1/r006-ugoira-03-zip-held-row.png` shows `0%` with the ring at 176 px. The walk JSON records the badge `1` with "Helper for Pixiv — 1 file remaining", `metadata.json` already in Chrome, and no downloads button or bubble.
- **Step 5, one animation with the video: met.**
  - The last item was `136004512.mp4`, with one appearance 10–11 ms later.
  - The bubble listed `.mp4`, `frames.json`, `_ugoira.zip` and `metadata.json`.
  - The walk view ends `Saved · MP4` with the tooltip `Saved to Downloads/pixiv/ひなた-136004512`, still 176 px.
- **ZIP only:** one appearance, with `frames.json`, and 3 rows.
- **Live ugoira 151105084, store zip:** one appearance and 4 rows (`r006-live-151105084-02-end-pill.png`: `Saved · MP4`).
- **The LOW cannot happen here.** `frames.json` waits for the zip to land, so nothing else is still being written at the enable. The gap was 129–201 ms (QA "Manual Verification Notes").
- **Every other AC is carried green.** The ugoira and encode code is unchanged since iteration 2, and every @cuj2 e2e test passes.

**Caveats / gaps**: none in the product.
- Evidence limit: playback in the VLC GUI and on Windows is L5.

**Spec gap**: system.md §15 gap 1, narrowed by code review Info 6. If Chrome ever holds the frame zip for a decision (an Enhanced Safe Browsing deep-scan or a dangerous-file prompt), `frames.json` and the video wait for it. The user then sees a busy button that never finishes, and Chrome's UI stays hidden until they act in `chrome://downloads`. This has never been observed, and whether turning the UI back on would surface the prompt is unverified. The decision is priority 3c: record it as a known v1 limitation now, with a pre-decided response if L5 sees it.

### CUJ-3: Configure the extension from the toolbar icon — Satisfied

**QA verdict** (from qa-report.md): PASS
**PM verdict**: Satisfied

**Assessment**:
- **The page is three settings with autosave, and nothing more.**
  - `cuj-3/run1/10-footer.png`, after Reset: Download folder, Ugoira output and Save `metadata.json`. A green `✓ Saved` appears beside exactly the two headings whose values changed.
  - There is no Save button, no toast and no helper text beyond the section help.
- **Iteration-2 caveat "pasted line breaks become spaces": resolved.** `main-walk.json`:
  - three-line paste `pixiv/⏎{artist}⏎-{id}` → stored `pixiv/{artist}-{id}`, caret 19;
  - CRLF plus a trailing newline: same result;
  - single line with a trailing newline: `pixiv/{userId}/{title}`, with no trailing space;
  - paste at the caret and over a selection: both correct;
  - a two-line drag, from the page and from outside it: lands on one line at the drop point.

  `edge-paste-three-lines.png` shows the clean field, the preview `Downloads/pixiv/みずき-135882741/135882741_p0.jpg` and `Saved`.
- **R-004 S5:** `pixiv/{user` is not saved. A lone `}` is literal and saves (`Preview: Downloads/pixiv/a}b/…`).
- **R-004 S15:** `05-error.png` keeps `Still using:` and the pattern on one line. The walk confirms one line box each in all four locales.
- **R-004 S2 colours:** error text `rgb(197, 34, 31)`, muted text `rgb(92, 97, 102)`.
- 72 checks, 0 failures. All 44 @cuj3 e2e tests are green.

**Caveats / gaps**: none in the product.

**Spec gap**: two text pairs on this page fail the index's own AA rule while matching CUJ-3's literal colours:
- the footer links, `#0096FA` on `#f6f7f9`, 2.91:1 (system.md §15 gap 2);
- the selected Ugoira segment, white semibold 14 px on `#0096FA`, 3.11:1. This pair is new from this review: `src/options/options.css:320-324`, and visible as `MP4` in `05-error.png`.

The index's pixiv-blue exemption covers only the injected button, which sits next to pixiv's own buttons. The options page is our own page, so the parity reason does not apply. The PRD's claim that "the colours specified in … CUJ-3 pass it" is false for these two pairs. The build follows the more specific line, so this is a PRD contradiction, not an implementation miss. Fix: priority 3b.

### CUJ-4: Follow several downloads at once from the toolbar badge — Caveats

**QA verdict** (from qa-report.md): FAIL (the same `[LOW][BUG]`)
**PM verdict**: Caveats

**Assessment**:
- **The badge, the CUJ's actual job, is fully right.** ACs 1–10 pass, and `cuj4.ts` had 28 checks with 0 failures.
  - `cuj-4/run1/02-tab-b-busy-row.png` (`3 / 8`) matches `mocks/cuj-4-initial-row0.png`.
  - `23` with "… across 2 downloads", the one-job tooltip after B ends, the drop when A is cancelled, `999+`, and recovery after a worker restart are all green (QA AC table).
- **The R-006 edge works as written:**
  - two jobs show one animation in total;
  - the job that ends first shows none (`requested=false`);
  - cancelling A after B finished is silent;
  - after a worker stop, the new instance makes no call at boot, hides at its first hand-off and restores before p11.
- `r006-two-b-first-both-done.png` shows `Saved · 12P` in the settled Saved style.

**Caveats / gaps**:
- **The bubble omits the last file far more often here:** 3 of 4 two-job walks. In B-first, p11 is missing: the bubble opened at +2/+4 ms and p11 was created at +42/+48 ms. In A-first run2, `136120877_p7.jpg` is missing.
- A two-job end is naturally a burst, so this is the most common way a real user would hit the LOW.
- It is the same defect with the same fix as CUJ-1, and it is the only gap.

**Spec gap**: none.

### CUJ-5: Recover when a download can't start or breaks — Satisfied

**QA verdict** (from qa-report.md): PASS (live logged-in paths NOT_RUN)
**PM verdict**: Satisfied

**Assessment**:
- **Iteration-2 caveat "No connection during a pixiv outage": resolved by the job-level rule (R-004 S3).**
  - `docs/qa-artifacts/iter3-17-37-06/logs/diag-outage-all.log`, with real backoff: 3 replays × 7 clicks for each of 500 and 503, 42 of 42 clicks, all read `pixiv isn't responding. Retry in a few minutes.`
  - That includes click 7 with `server hits=0`: every image request was refused locally, and the click still reads correctly because pixiv's API answered.
  - Server stopped → `No connection. Retry when you're back online.` Server back → `Saved`.
- **Iteration-2 item "floating fallback overshoot": resolved.**
  - `iter3-17-37-06/logs/diag-float.log`: the pill painted at 2763–2778 ms over 40 samples (e2e and dev builds, direct load and SPA), inside the 3 s.
  - `iter3-19-38-54/cuj-5/run1/11-floating.png`: the pill floats at the artwork's bottom-right with its shadow.
- **Part A is unchanged.** `01b-walled-needs-login-row.png` and `r006-403-needs-login-row.png` both show `Log in to download`: neutral outline, no icon.
- **Part B:**
  - `04-retry-3-failed-row.png` matches `mocks/cuj-5-retry-row0.png`.
  - The amended step 4's silent end is met: 0 of 921 and 0 of 1067 samples visible, and the next download brings the button back.
  - The retry ends with one animation.
  - Unavailable makes no `setUiOptions` call.
- **The intent holds.** Every failure says what happened in the button itself, and no failure end pretends to be a done signal: none of them shows Chrome's done signal unless files actually reached Chrome last.

**Caveats / gaps**: none in the product.
- Evidence gap, carried: the live logged-in paths are NOT_RUN. These are AC 2 and AC 4 after a real login, R-18 display off, and the stale-page probe (`docs/release-checklist.md` §3).

**Spec gap**: §4.1 #3's list of ends without a final hand-off includes "needed login after a mid-job 403". As built and designed, a 403 stops new dispatches, but originals already on their way to Chrome still land. The last of them is a final hand-off, so the job ends with one animation while the button reads `Log in to download` (QA CUJ-5 "403 mid-job" row, judged PASS against the paragraph's own definition). The silent case is only a 403 with nothing else on its way (QA `403-last`).
- I endorse the build: the animation truthfully reports files that landed, and the button carries the outcome.
- The parenthetical needs rewording: priority 3a.

## Recommended Next-Iteration Priorities
1. **[tl design, then coder] Fix the LOW: the last hand-off waits until every earlier file has finished, not only until it is named.**
   - **Change.** In `src/background/engine.ts` `handOff()`, the last-hand-off path calls `targetsKnown([...earlierIds, ...otherSavingIds(self)])`. Make that wait release an id only when the item has left `in_progress` (complete or interrupted) or Chrome no longer knows it. Drop the `filename` release conditions in the delta watcher and in the `downloads.search` check (engine.ts:209-240), and rename the function to match, e.g. `othersSettled`.
   - **Keep it capped.** A file held by a Save As dialog or a danger prompt must never block the last hand-off. tl picks the cap from measured blob-write times. `HANDOFF_TARGET_WAIT_MS` (500 ms, `src/shared/constants.ts:83`) or a sibling constant of at most 2 s are both fine.
   - **Design doc.** Update design-download-engine.md "The last hand-off (R-006)" step 3. In the "When Chrome's download UI comes back" table, the rejected "Hold the last file until every other file has landed" option becomes the selected rule, with the cap removing its "blocks indefinitely" cost.
   - **Tests (L2).**
     - The restore waits for every earlier item to leave `in_progress`.
     - An item still `in_progress` after the cap does not hold the last hand-off back.
     - Use code review Info 3: the fake records whether a completion happened while the UI was on before the last item was created, and the test asserts that never happens.
   - **Done when:**
     - QA's `SCEN=race12-nohold REPS=8` on the dev build and on the store zip, and `SCEN=two-b-first,two-a-first` ×4, all show a bubble that lists the last file in every run;
     - the 26-period R-006 matrix still shows exactly one appearance;
     - the restore-to-`Saved` delay stays imperceptible, under 100 ms on the fake.
   - **Pre-decided exit, so the loop converges.** If the fix lands and a residual remains only when the cap expired, pm accepts it as a timing edge and amends AC 14. It will not loop again.
   - Flips CUJ-1 and CUJ-4 to Satisfied.
2. **[coder, with priority 1] Code review W1: pin the synchronous decide+claim.**
   - Add the held-hide "last two landing while the first hand-off still waits for its hide" test, verbatim from `docs/code-review.md` (addendum, Warning 1), to `test/unit/background/engine-download-ui.test.ts`.
   - It passes on `68c35d7` and fails when the claim moves after the UI call.
   - Also reconcile the design's test list with Info 7: "the watcher is gone afterwards" is untested. Drop the clause.
3. **[pm spec-sync, next Phase 1, then tl and coder where noted]**
   - **a. §4.1 #3 and the 403 (CUJ-5 step 9).** No code change.
     - In the parenthetical, replace "needed login after a mid-job 403" with "needed login after a 403 with no other file still on its way to Chrome".
     - Add to CUJ-5 step 9 "User sees": "Files already on their way to Chrome when the 403 arrived still land. The last of them brings the job's one animation, so Chrome's downloads button can be back while the button reads `Log in to download`. If none was on its way, the end is silent (4.1 #3)."
   - **b. Options-page contrast (system.md §15 gap 2, plus the selected segment found in this review).** Apply the R-004 S2 rule; do not widen the exemption.
     - CUJ-3 step 10: links `#0b6fc2` in light mode (4.82:1 on `#f6f7f9`), `#0096FA` in dark mode (6.02:1 on `#121212`).
     - CUJ-3 step 7: the selected segment is filled `#0b6fc2` with white semibold text (5.16:1) in both modes.
     - Dark-theme edge line: "Selected segment, links, and focus rings stay `#0096FA`" becomes "Focus rings stay `#0096FA`. The selected segment is `#0b6fc2`. Links are `#0096FA` in dark mode."
     - Correct the index "Contrast" claim.
     - Non-text blues stay `#0096FA`: the switch, focus rings, the header mark, and the chip hover (exempt as a hover).
     - Update `cuj-3-initial.html`, `cuj-3-error.html` and `cuj-3-saved.html`.
     - Code: `src/options/options.css`, a text-accent variable for `.link` (light) and `.seg button[aria-pressed='true']`.
     - Rejected alternative: extending the pixiv-blue exemption. It costs nothing in code, but the parity reason exists only beside pixiv's own buttons.
   - **c. Gap 1, a Chrome prompt on the ugoira zip.** Record it as a known v1 limitation in CUJ-2's edge cases: "If Chrome holds the frame zip for a decision (dangerous-file or deep-scan prompt), `frames.json` and the video wait for it. The button stays busy and Chrome's download UI stays hidden until the user acts on the zip in `chrome://downloads`. Cancel ends the job as usual."
     - Do not build anything now: it has never been observed, and the mechanism is unverified.
     - Pre-decided response if L5 observes it: when `downloads.onChanged` reports a `danger` value that needs a decision on a running job's file, the extension turns Chrome's UI back on and keeps it on for the rest of that busy period. Extra animations are accepted, because a prompt the user cannot see is worse. tl first verifies that the prompt becomes reachable for an item created while the UI was off.
     - With priority 1's cap, a held page of an illustration or manga already delays the last hand-off by the cap at most, and then the UI returns with the last file.
   - **d.** No PRD change is needed for priority 1. AC 14 stays as written.
4. **[tl design docs, next Phase 1]**
   - Code review Info 6: design-download-engine.md "Error handling" and system.md §15 gap 1 should say outright that a prompt on the ugoira zip blocks every later file of that job.
   - Code review Info 1: add the boot-time note to "Restart at `await:handoff.restoreUi`" (deltas wait for `ready`, and the cap bounds it).
   - After priority 3b lands, close §15 gap 2.
5. **[qa] Verification next cycle.**
   - a. The priority 1 probes, as listed under "Done when", plus the full headed R-006 matrix: one appearance per busy period, silent ends unchanged.
   - b. Measure the restore-to-last-file-created delay and the click-to-`Saved` time before and after the fix, and report the maximum.
   - c. CUJ-3 after priority 3b: compare against the updated mocks, and record the computed colour and contrast for the links and the selected segment in both themes.
   - d. Re-check CUJ-5 step 9 against the amended text, for both `403` and `403-last`.
   - e. If any OS-level way to click Chrome's downloads button exists in the headed harness, check whether a reopened bubble lists every file. This closes this review's evidence gap.
6. **[release, owner-run before Web Store submission; not a loop gate]** `docs/release-checklist.md`:
   - §2's R-006 item, including the re-download served from the HTTP cache (the burst case: watch that the bubble lists the last file) and the Windows Enhanced Safe Browsing ugoira-zip check (gap 1);
   - §3's logged-in checks;
   - making the repository public (R-001).

## PRD Lifecycle Changes (if any)
- None. prd-000-mvp stays `active`, because CUJ-1 and CUJ-4 are Caveats.
