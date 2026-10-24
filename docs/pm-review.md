# PM Review

Last updated: 2026-10-23 23:54:34 (UTC-7)
Iteration: 4
Scope: prd-000 (prd-000-mvp, CUJ-1 … CUJ-5, as amended by R-004, R-005, R-006 and the R-006 rev. 3 spec-sync in `c2c9de0`)

## Overall Assessment
All three of the owner's complaints are now fixed and verified:
- 20 flying icons per manga;
- Chrome's downloads button never coming back;
- the bubble leaving out the last file.

For the third, QA checked 44 busy periods with a final hand-off, on the e2e build, the dev build, the store zip and live pixiv. In every one, every other file had finished before the UI came back, the button appeared exactly once, and the bubble listed every file.

One small fix stands between this build and shipping. A pre-existing race between two jobs whose first files reach the offscreen document within about 10 ms can end in a `Saved` button over a folder that has no `metadata.json`. CUJ-1 and CUJ-4 stay at Caveats for that fix only.

The counter's `N / N` that sometimes flashes for one frame is not a defect: the spec line is wrong, not the build. It goes to the owner in R-007 together with five other spec-sync items. The product is converging.

## Per-CUJ Verdict

### CUJ-1: Download an illustration or manga from the artwork page — Caveats

**QA verdict** (from qa-report.md): FAIL (two `[LOW][BUG]`s: the offscreen creation race on the edge "Same artwork clicked in two tabs", and `N / N` against AC 7)
**PM verdict**: Caveats

**Assessment**:
- **Iteration-3 caveat resolved: the bubble now lists the last file.** From QA's "Resolved in iteration 4" table:
  - `race12-nohold` listed all 13 rows in 16/16 runs on the e2e build, 8/8 on the store zip and 4/4 on the dev build. Before the fix, 3/6 and 5/8 runs missed the last file.
  - In all 44 final periods, Chrome's `endTime` for every other file was at or before the restore's issue time, by 0–889 ms. Exactly one file was created after the restore (+0 … +6 ms), and the button appeared once (+2 … +25 ms).
  - The new tests discriminate: on `c2c9de0^` the headed "last files land together" test fails 4/4.
  - Live, store zip: `cuj-1/run1/r006-live-151116453-walk.json` shows the bubble opening 25 ms after the restore with 8 rows (`151116453_p2.jpg` … `metadata.json`) and `missing: []`.
- **The fix costs the user nothing visible.** Restore → `Saved` took 19–69 ms (n = 40). Click → `Saved` on a 12-page burst took 133–163 ms.
- **My iteration-3 exit rule is not needed.** No residual remains, not even at the 2 s cap, so AC 14 stands as written.
- **Steps 1–8 are green twice** (`cuj1.ts` run1/run2, 60 checks each, 0 failed):
  - `cuj-1/run1/05b-11-of-12-p11-in-flight-row.png`: `11 / 12` with the ring while p11 is in flight, which is the amended counter top;
  - `06-saved-row.png`: the outlined `Saved · 12P`, matching `cuj-1-saved-row0.png`;
  - all 12 originals are sha256-identical to the served bytes;
  - at most 5 files are in flight;
  - cancel is silent, with 0 of 1470 toolbar samples visible.
- **AC 7 (counter) holds within CUJ-1's own scenario.** QA saw `12 / 12` in 0 of 55 single 12-page runs.

**Caveats / gaps**:
- **The offscreen creation race makes `Saved` untruthful.** It hits the edge "Same artwork clicked in two tabs", which promises "two independent jobs run".
  - **What QA saw:**
    - `logs/two-tabs-sweep.log`, second click 5–11 ms after the first: the second job ended `Retry · 4 failed` / `Retry · 5 failed` in 4/4 runs on the e2e build and 2/4 on the store zip (`Retry · 1 failed`), and every failed run was also missing `metadata.json` (e.g. 21 of 26 files on disk). At gaps of 50–800 ms there were 0 failures.
    - `logs/two-artworks-retry-e2e.log`: after Retry the button reads `Saved · 8P`, with `secondFolderJson: []`.
  - **What the user is told:**
    - the tooltip says "failed after 4 attempts each", but no attempt reached pixiv;
    - the `metadata.json` failure is never mentioned;
    - after Retry the button says `Saved` while the folder lacks `metadata.json`.
- **Why I hold this as a product caveat and not only engineering hardening:**
  1. **Harm class.** This is a false done signal. `metadata.json` is one of the four things the product promises per artwork (§1). After `Saved` the user has no reason to look, so the gap is permanent and silent. The misleading tooltip is minor; the silent folder gap is not.
  2. **Reachability on live pixiv is not settled.**
     - The race is between the two jobs' first offscreen commands, not between the clicks. Each job sends its first command only after its pixiv API calls answer through the tab (`resolveJob`, `src/background/engine.ts:362-371`; `apiFetchJson`, `src/background/tab-client.ts:35-50`).
     - On the fake those calls take milliseconds, so QA's "≥ 50 ms apart is safe" measures a click gap that equals the command gap.
     - On live pixiv, two clicks a second apart can still collide if the first job's API calls answer about a second slower than the second job's.
     - That is uncommon, unmeasured and not ruled out. Slower hardware may also widen the window.
  3. **The fix is small and local**: `src/background/offscreen-client.ts`, Priority 1.
- **Exit condition, which flips CUJ-1 (and CUJ-4) to Satisfied.** All of the following must hold:
  - the Priority 1 fix lands;
  - QA's `twoTabsProbe.ts` at `CLICK_GAP=0`, same artwork and `SECOND=136120877`, on the e2e build and the store zip, ≥ 8 runs each, ends with both jobs `Saved` and both folders holding `metadata.json` (26 files for two 12-page jobs, 21 for 12 + 8);
  - the R-006 regression checks in Priority 5 stay green.
- **Pre-decided exit, so this does not loop.** If, after the fix, QA can make a file fail only by interfering with the offscreen document by hand (closing it from DevTools mid-command), I accept that as an engineering item. I will not hold a CUJ for any timing edge that neither loses a file nor misreports an outcome. A `Saved` with a file missing is never a timing edge.
- **The counter `N / N` is not a caveat.** Five reasons:
  - **CUJ-1's own job never shows it** (0 of 55 runs).
  - **It appears only with two jobs at once, or in a 200-page job.** In the DOM it lasts 0–2 ms. It was painted for one frame in 1 of 20 frame-sampled two-job runs (`logs/counter-probe-headed.log`, rep 7) and in 0 of 11 frame-sampled 200-page runs. Nobody perceives a 16 ms label that is replaced at once.
  - **It is truthful**: N of N pages have landed.
  - **The build already shows `12 / 12` by design in one place.** During a metadata-only retry the label is `12 / 12` throughout (`src/content/button/model.ts:292`, and `resolveRetryMetadata` sets `pagesOffset` to the page count in `src/background/resolver.ts`). That face is honest and correct, and the absolute AC forbids it.
  - **The owner never asked for this.** "`12 / 12` is never shown" is the quick-fix's description of a side effect, not a requirement.
- **No code change for the counter.** Suppressing the late running push would show a stale `N−1 / N` while every page has landed, for example while `metadata.json` waits on a Save dialog. That is less truthful than the flash. The AC is what needs fixing: spec-sync item 1.
- **Evidence gaps, carried:**
  - for a second animation shortly after a first in the same profile (re-download, retry), only the single appearance and Chrome's ordering were verified, not the bubble rows (QA "Coverage Gaps");
  - the logged-in live surface and pixiv's dark theme are NOT_RUN (`docs/release-checklist.md` §3).

**Spec gap**:
- Spec-sync item 1: AC 7's absolute "`12 / 12` is never shown".
- Spec-sync item 2: the edge "200-page manga: the counter runs `0 / 200` … `200 / 200`" (`prd-000-mvp.md:317`) contradicts AC 7. The build normally ends `199 / 200` → `Saved · 200P` (`logs/counter200-probe-headed.log`).

### CUJ-2: Download an ugoira — Satisfied

**QA verdict** (from qa-report.md): PASS
**PM verdict**: Satisfied

**Assessment**:
- **Walks:** `cuj2.ts` passed twice, R-006 `ugoira` / `ugoira-zip` passed ×2, and live 151105084 passed ×2 on the store zip.
- **The settle wait adds no visible delay here.** Every other file had finished 187–199 ms before the video's restore. The `.mp4` was created +1 ms after the restore, with one appearance +10 ms after it and 4 bubble rows.
- **ZIP only:** the done signal comes with `frames.json`, with 3 rows.
- **Live:** `cuj-2/run1/r006-live-151105084-02-end-pill.png` shows `Saved · MP4` in pixiv's real row. There were 4 rows and one appearance, +7 ms after the restore.
- **Every AC (1–13) passes in both runs.** The only change in this path is the shared settle wait.
- **The offscreen race is not a CUJ-2 issue.** An ugoira job could be the second of two simultaneous starts, but that is a concurrency case judged under CUJ-4, and Priority 1 fixes it for every job kind.

**Caveats / gaps**: none in the product. Evidence limit, carried: playback in the VLC GUI and on Windows is L5.

**Spec gap**: spec-sync item 5, carried from iteration 3 (system.md §15 gap 1). A Chrome prompt on the frame zip should be recorded as a known v1 limitation in CUJ-2's edge cases, with the pre-decided response.

### CUJ-3: Configure the extension from the toolbar icon — Satisfied

**QA verdict** (from qa-report.md): PASS
**PM verdict**: Satisfied

**Assessment**:
- **Nothing has changed on this page since iteration 3,** which judged it Satisfied with the full run2 evidence.
- **QA re-walked run1** (main plus the 4 locales, 0 failed checks, 0 console errors), and all @cuj3 e2e tests pass in both gate runs.
- **`cuj-3/run1/05-error.png` still shows the R-004 behaviour:**
  - the red field with `Unknown token {artst}. Available tokens: …`;
  - `Still using:` and the last valid pattern on one line;
  - the three sections only, with no Save button.

**Caveats / gaps**: none in the product.

**Spec gap**: spec-sync item 4, carried from iteration 3 (system.md §15 gap 2). The same screenshot shows both pairs below the index's 4.5:1 rule:
- the footer links `Reset to defaults` and `Report an issue`, `#0096FA` on `#f6f7f9`, 2.91:1;
- the selected `MP4` segment, white on `#0096FA`, 3.11:1.

The build follows CUJ-3's literal colours, so this is a PRD contradiction and not an implementation miss.

### CUJ-4: Follow several downloads at once from the toolbar badge — Caveats

**QA verdict** (from qa-report.md): FAIL (the offscreen creation race, on AC 5)
**PM verdict**: Caveats

**Assessment**:
- **The badge, this CUJ's actual job, is fully right.** ACs 1–4 and 6–10 pass in both runs (`cuj4.ts`, 28 checks each, 0 failed).
  - `cuj-4/run1/02-tab-b-busy-row.png` shows `3 / 8` with the ring, matching `cuj-4-initial-row0.png`.
  - Also green: `23` with "across 2 downloads", the one-job tooltip, the drop on cancel, `999+`, and recovery after a worker restart.
- **Iteration-3 caveat resolved: the bubble lists both jobs.**
  - B ending first and A ending first, ×4 each: in 8/8 runs the bubble lists all 21 names of both jobs, with one appearance in total (+11 / +12 ms). Before the fix, 3 of 4 runs missed a file.
  - B ends with 0 visible samples.
  - `r006-two-b-first-both-done-row.png` shows `Saved · 12P` in the Saved style. Its pale fill (computed `rgb(223, 240, 253)`) was captured during the button's 120 ms background transition (`src/content/button/styles.ts:44`) toward the `#e6f4fe` hover tint, with the pointer still on the button. It is not a style defect.
- **Every other R-006 edge passes:** cancel-after-B is silent, and the restarted worker makes no call at boot.

**Caveats / gaps**:
- **AC 5 ("Starting a second artwork while one is running begins downloading the second immediately") fails when the two starts coincide.**
  - `cuj-4/run1/two-artworks-e2e-gap0-1-failed.png` shows 夏祭りの帰り (136120877) at `Retry · 4 failed`. The walk records the tooltip "4 of 8 pages saved. 4 failed after 4 attempts each. Click to retry just those 4.", yet no request reached pixiv. This happened in 6/6 + 2/2 runs.
  - After Retry, the folder has no `metadata.json` (`logs/two-artworks-retry-e2e.log`).
  - Concurrent starts are this CUJ's whole premise, so the defect belongs here first. Judgment and reasons are as under CUJ-1.
- **Exit condition:** as under CUJ-1.
  - The fix may have the second job wait the few milliseconds the shared document needs to finish loading. That is not "waiting for the other job" in AC 5's sense, and it is acceptable.
- **The two-job `N / N` is not a CUJ-4 issue.** CUJ-4 names no counter top. It is spec-sync item 1.

**Spec gap**: none beyond item 1.

### CUJ-5: Recover when a download can't start or breaks — Satisfied

**QA verdict** (from qa-report.md): PASS (live logged-in paths NOT_RUN)
**PM verdict**: Satisfied

**Assessment**:
- **The amended step 5 holds in all 4 walked retries and in the e2e 'partial' test.**
  - `cuj-5/run1/05b-retry-11-of-12-row.png` shows `11 / 12` with the ring and badge `1`, then `Saved · 12P` directly.
  - At `9 / 12` the badge is `3`.
- **Step 4:** `04-retry-3-failed-row.png` matches `cuj-5-retry-row0.png`. The end is silent (0 of 1300 samples visible), and the next download brings the button back (+21 ms).
- **R-006 ends:**
  - the retry brings one animation with p11;
  - Unavailable makes no call;
  - `403` and `403-last` behave as §4.1 #3's definition of a final hand-off says.
- **Every AC (1–16) passes on the fake in both runs**, with 48 checks each and 0 failed.
- **The intent holds.** Every failure says what happened in the button itself, and no failure end fakes a done signal.

**Caveats / gaps**: none in the product. Evidence gap, carried: AC 2 / AC 4 after a real login, R-18 display off, and the stale-page probe are NOT_RUN (`docs/release-checklist.md` §3).

**Spec gap**:
- **Item 3, carried:** the §4.1 #3 parenthetical and CUJ-5 step 9 wording for a mid-job 403.
- **Item 6, new: a Retry after the pages and `metadata.json` both failed ends `Saved` without `metadata.json`.**
  - Step 5 says "`metadata.json` is not written again", which assumes it landed.
  - The build follows the step:
    - `classifyOutcome` returns `partial` before it looks at `metadata.json` (`src/shared/outcome.ts:100-104`);
    - `resolveRetryPages` writes only pages (`src/background/resolver.ts:181-204`).
  - Today the only known trigger is the CUJ-1/CUJ-4 race, so Priority 1 removes it. The spec change closes the class, e.g. a disk error on `metadata.json` next to network failures on pages.
  - It is not a CUJ-5 caveat: the literal step is met, and the trigger is judged under CUJ-1/CUJ-4.
  - The "after 4 attempts each" tooltip is true for every failure that goes through the retry policy. The 0-attempt failures come only from the race and disappear with the fix, so no copy change is needed.

## Spec-sync batch (R-007)

For the owner through `docs/owner-queue.md` R-007. Once it is approved, pm applies the batch in the next Phase 1, as with R-004. Items 1–3 and 5 are wording only. Items 4 and 6 need a small code change after approval.

1. **Counter (CUJ-1 AC 7, CUJ-5 step 5). No code change.**
   - **CUJ-1 AC 7** becomes: "During the job the label reads `N / 12`, where N counts the originals that have completed. N never decreases, and `metadata.json` never changes it. In a job running on its own, the last original is handed to Chrome only after every other file has finished, so the label tops out at `11 / 12`, and the last original's landing turns the button to `Saved · 12P` directly. When other files are still finishing at that moment (for example a second job's, CUJ-4), `12 / 12` may show for an instant first. Either way `Saved · 12P` follows the job's last file within 300 ms."
   - **CUJ-5 step 5 "User sees"** becomes: "The busy state continues from the earlier count, `9 / 12` → `11 / 12`, and the badge shows `3`. On success the last retried page turns the button to `Saved · 12P` directly, under CUJ-1's counter rule. If some still fail, `Retry · N failed` returns with updated numbers."
   - **Why:** QA can test the rule as written, it is true in every case QA measured, and it allows the honest `12 / 12` of a metadata-only retry.
2. **200-page edge (CUJ-1, `prd-000-mvp.md:317`). No code change.** "`0 / 200` … `200 / 200`" becomes "the counter runs `0 / 200` … `199 / 200`, then `Saved · 200P` (the counter rule in the acceptance criteria)".
3. **A 403 mid-job (§4.1 #3, CUJ-5 step 9), carried from iteration 3 (3a). No code change.**
   - In §4.1 #3's list of ends without a final hand-off, "needed login after a mid-job 403" becomes "needed login after a 403 with no other file still on its way to Chrome".
   - Add to CUJ-5 step 9 "User sees": "Files already on their way to Chrome when the 403 arrived still land. The last of them brings the job's one animation, so Chrome's downloads button can be back while the button reads `Log in to download`. If none was on its way, the end is silent (4.1 #3)."
4. **Settings-page contrast (CUJ-3 steps 7 and 10, the dark-theme edge, the index "Contrast" claim), carried from iteration 3 (3b).** Apply the R-004 S2 rule; do not widen the pixiv-blue exemption.
   - **Text colours:**
     - links `#0b6fc2` in light mode (4.82:1 on `#f6f7f9`) and `#0096FA` in dark mode (6.02:1 on `#121212`);
     - the selected segment filled `#0b6fc2` with white semibold text (5.16:1) in both modes.
   - **Non-text blues stay `#0096FA`:** the switch, focus rings, the header mark and the chip hover.
   - **Docs:** update `cuj-3-initial.html`, `cuj-3-error.html` and `cuj-3-saved.html`, and correct the index sentence "the colours specified in PRD-000 (§4.7.3, CUJ-3) pass it".
   - **Code:** `src/options/options.css`, one text-accent variable for `.link` and `.seg button[aria-pressed='true']`.
5. **A Chrome prompt on the ugoira frame zip (CUJ-2 edge cases), carried from iteration 3 (3c). No code change.**
   - Add the known v1 limitation: "If Chrome holds the frame zip for a decision (dangerous-file or deep-scan prompt), `frames.json` and the video wait for it. The button stays busy, and Chrome's download UI stays hidden, until the user acts on the zip in `chrome://downloads`. Cancel ends the job as usual."
   - Pre-decided response if L5 ever observes it: restore the UI as soon as `downloads.onChanged` reports a `danger` value that needs a decision for a running job's file.
6. **A Retry after the pages and `metadata.json` both failed (CUJ-5 step 5 and edge cases). New.**
   - **Step 5 "System response":** "`metadata.json` is not written again" becomes "`metadata.json` is written again only if it did not land in the earlier run. The label and tooltip do not mention it."
   - **New edge:** "**Pages and `metadata.json` both failed**: the button shows `Retry · N failed` with the usual tooltip (`metadata.json` is not a page). Retry re-writes the failed pages and `metadata.json`, so `Saved · 12P` always means every file of the job is on disk."
   - **Code, in three places:**
     - `src/shared/outcome.ts` row 6 records whether `metadata.json` landed;
     - `src/content/button/model.ts` `startRequest` passes that on;
     - `src/background/resolver.ts` `resolveRetryPages` adds `metadata` when asked (with the illust body, as `resolveRetryMetadata` does).
   - The counter and badge are unchanged.
   - **Rejected:** a tooltip sentence about `metadata.json`. It adds copy for a case that is near-impossible after Priority 1, and the Retry repairs the folder anyway.

## Recommended Next-Iteration Priorities
1. **[tl design, then coder] Fix the offscreen creation race.** This flips CUJ-1 and CUJ-4.
   - **Behaviour:** no file fails because the offscreen document is still being created, or is closing, when a job's command arrives.
   - **Change, `src/background/offscreen-client.ts`:**
     - `ensureOffscreen()` returns the in-flight `creating` promise whenever one exists, *before* asking `chrome.runtime.getContexts`.
     - `send()` treats "Receiving end does not exist" as "not ready yet": re-ensure and resend under a short bounded wait, not one immediate resend. tl picks the bound, ≤ 1 s, or a readiness handshake from the document. Only after the bound does the command fail as `internal`.
     - The same path covers a job that starts while `scheduleClose()`'s `closeDocument()` (after `OFFSCREEN_CLOSE_GRACE_MS`, 5 s) is in flight.
   - **Design doc:** record the rule in design-offscreen-worker.md "Lifecycle".
   - **Tests (L2 integration):**
     - two jobs whose first commands arrive while `createDocument` is pending and the context is already listed: both end `saved`, with no `internal` failure;
     - a command sent while `closeDocument` is in flight is resent, not failed.
     - Mutation check: removing the `creating` short-circuit fails the first test.
   - **Done when:** the exit condition under CUJ-1 is met, and Priority 5a–c are green.
2. **[owner → pm → coder] The spec-sync batch, R-007.**
   - On approval, pm applies the six items in Phase 1, and the coder builds items 4 and 6.
   - This does not gate Priority 1 or the closure of prd-000. If R-007 is still open when Priority 1 passes, I flip prd-000 to `completed` and record QA's counter LOW as the spec over-statement in item 1.
   - Items 4 and 6 change behaviour, so approving them later reopens the PRD (`completed → active`) for that work.
3. **[coder, in parallel with 1] ENG-013 (P2, test-only):** the three `othersSettled()` unit tests in `test/unit/background/engine-download-ui.test.ts`, as specified in `docs/eng-backlog.md`. It touches different files from Priority 1.
4. **[tl, design docs]**
   - **design-download-engine.md "Progress counter", "When `N / N` can still show" (`:377-380`), and Open Questions (`:1090`):** replace the account with QA's measured mechanism:
     - the earlier completion's `push` runs after its `release` round trip and reads a record the last completion has already updated;
     - add the metadata-only retry's deliberate `12 / 12`.
   - **After R-007:** close system.md §15 gaps 1–3 and add the item-6 retry rule.
   - **Not recommended:** a counter code change (reasons under CUJ-1). Only if the owner rejects item 1 does tl design one. It must never show a count lower than what has landed.
5. **[qa] Verification next cycle.**
   - **a. The race:** `twoTabsProbe.ts` at `CLICK_GAP=0`, same artwork and `SECOND=136120877`, on the e2e build and the store zip, ≥ 8 runs each. Every run ends with both jobs `Saved` and both folders holding `metadata.json`. Also re-run the 0–800 ms gap sweep.
   - **b. The grace-close edge:** a second job started about 5 s after a busy period ended (`OFFSCREEN_CLOSE_GRACE_MS`), swept ±50 ms. Expect 0 failures.
   - **c. Regression, since every offscreen command passes through the changed code:**
     - the headed R-006 matrix (one appearance per busy period, silent ends unchanged);
     - `race12-nohold` ×8 on the store zip (all 13 rows);
     - click → `Saved` on a 12-page burst, reported against this run's 133–163 ms.
   - **d. After R-007 items 4 and 6 land:**
     - CUJ-3 against the updated mocks, with the computed colour and contrast for the links and the selected segment in both themes;
     - CUJ-5 with injected failures on `metadata.json` and 3 pages: after Retry the folder holds `metadata.json` and the button reads `Saved · 12P`.
   - **e. After item 1 lands:** judge the counter against the amended AC. No further millisecond probing of `N / N` is needed.
6. **[release, owner-run before Web Store submission; not a loop gate]** `docs/release-checklist.md`:
   - **§2's R-006 item,** including the re-download served from the HTTP cache and the Windows Enhanced Safe Browsing ugoira-zip check;
   - **§3's logged-in checks;**
   - **§6, making the repository public (R-001).**
   - **New for tl to add to §2:** on live pixiv, click Download on two artworks in two tabs as fast as you can switch, five times. Both folders must hold `metadata.json` every time. This is the branded-Chrome confirmation of Priority 1.

## PRD Lifecycle Changes (if any)
- None. prd-000-mvp stays `active`, because CUJ-1 and CUJ-4 are Caveats. It closes when Priority 1 meets the exit condition; R-007 does not gate the flip.
