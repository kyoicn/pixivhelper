# PM Review

Last updated: 2026-10-28 01:29:50 (UTC-7)
Iteration: 5
Scope: prd-000 (prd-000-mvp, CUJ-1 … CUJ-5, as refined on 2026-10-27 for the sibling-folder repeat download, Issue 2026-10-27-19-58-31, and as amended by R-007 in `c8d95bc`). QA run `iter5-00-09-39`, `main` at `cac42dc`.

## Overall Assessment
Every product promise of prd-000 is now on `main`. The iteration-4 hold, the offscreen creation race, is closed by D16 with evidence that discriminates (32/32 at a click gap of 0 on HEAD, 1/8 on the pre-fix build), so CUJ-1 and CUJ-4 leave Caveats. The 2026-10-27 refinement, a repeat download of the same artwork going to `<folder> (n)` with clean names inside, is built as D15 and walked through every refined acceptance criterion on the e2e build twice and on the store zip once. The two R-007 behaviour items (settings contrast, Retry re-writing `metadata.json`) are verified.

QA's verdict is FAIL on one LOW in CUJ-1: the folder check also counts this artwork's files under another Downloads location or under a longer earlier pattern, so a repeat run there gets a needless ` (1)`. I judge CUJ-1 Satisfied despite it, for reasons set out below (it errs only in the safe direction, costs one cosmetic suffix in an uncommon case, the tooltip still tells the truth, and no API gives the extension the fact it would need to do better). It goes to the owner as a spec-sync item, R-008, together with the 10 s existence re-check limit. All five CUJs are Satisfied; prd-000 flips to `completed`. 1.0.1 is ready for the release checklist.

## Per-CUJ Verdict

### CUJ-1: Download an illustration or manga from the artwork page — Satisfied

**QA verdict** (from qa-report.md): FAIL (one `[LOW][BUG]`: the folder check counts files outside `<Downloads>/<folder>/`)
**PM verdict**: Satisfied

**Assessment**:
- **The refinement delivers what the owner asked for on 2026-10-27: a second download of the same artwork lands next to the first, not on top of it, with clean file names.** From `cuj-1/run1/folders-series-e2e-walk.json` (26/26 checks; repeated in run2 and 22/22 on the store zip):
  - run 1 → `pixiv/みずき-135882741/` with `metadata.json` and 12 clean originals, tooltip `Saved to Downloads/pixiv/みずき-135882741`;
  - run 2 → `pixiv/みずき-135882741 (1)/` with the 13 clean files, the plain folder untouched (names, sizes and mtimes checked), tooltip `Saved to Downloads/pixiv/みずき-135882741 (1)`, `aria-label` `Saved 12 pages to Downloads/pixiv/みずき-135882741 (1). Click to download again.` (steps 8 and AC 11);
  - run 3 → `(2)`, with no `pixiv (n)/` anywhere (AC 12, AC 14);
  - run 4, plain folder moved away → plain again, no `(3)`, the moved folder keeps its 13 (AC 13);
  - runs 5 and 6, gaps → `(1)` re-created, then plain re-used (the "Gaps" edge);
  - the busy face came 2–3 ms after every click, and the 250 ms re-check wait is invisible on a first run (click → `Saved` 141–157 ms on the store zip against 133–163 ms in iteration 4).
- **The button face does not change, which is the design.** `cuj-1/run1/08-redownload-row.png` and `fs-e2e-02-second-sibling-1-row.png` show the same outlined `Saved · 12P` as `mocks/cuj-1-saved-again-row0.png`, 164 × 40. The index lives only in the tooltip and the accessible name, as §4.3 specifies. The mock renders the tooltip visibly; the product's native `title` was verified as text.
- **The edges a real user hits are right:** history cleared → plain folder with per-file ` (1)` names (`fh-e2e-01-after-clear-history`, 26 files, the accepted limitation); files renamed inside the folder → plain again (`fr-e2e-01-after-rename-plain`, with `metadata (1).json` from the safety net, since `metadata.json` had not been renamed); token-free `pixiv` → two artworks share `pixiv/`, the repeat goes to `pixiv (1)/` (`ft-e2e-01-repeat-pixiv-1`); an ugoira repeat → `pixiv/ひなた-136004512 (1)/` with all four files (`folders-ugoira-e2e-walk.json`).
- **The same-artwork two-tab edge now behaves exactly as the refined spec says:** the second job goes to `(1)` once the first job's originals have begun landing (12 runs at gaps ≥ 49 ms), and shares the folder with per-file suffixes when both choose before either has landed a file (20 runs at gaps ≤ 31 ms; QA's search spy confirmed the choice followed the rule in 8/8).
- **The iteration-4 caveat is closed.** My exit condition was: `twoTabsProbe.ts` at `CLICK_GAP=0`, same artwork and `SECOND=136120877`, on the e2e build and the store zip, ≥ 8 runs each, both jobs `Saved` and both folders holding `metadata.json`; plus the R-006 regression green. QA's table: 8/8, 8/8, 8/8, 8/8, the 0–800 ms sweep 40/40, the R-006 matrix 137/137 twice, `race12-nohold` 16/16 with 13 rows. `logs/race-diff-e2e.log` shows every run with `metaOk: true`, 22 files, 0 failures, 0 resends. The pre-D16 build fails 7/8 under the same probe, so the probe discriminates.
- **Everything else in the CUJ is unchanged and green twice** (`cuj1.ts` 62 checks per run, 0 console errors): counter tops at `11 / 12` alone and `Saved · 12P` follows the last file within 2–54 ms (the R-007 AC 7); cancel silent; one animation with the last file and 13 bubble rows; keyboard, focus ring, dark theme on the fake.

**Caveats / gaps**: none that hold the CUJ. Two limits go to the owner as spec-sync items (R-008); my reasoning on each:
- **QA's LOW: the folder check is a suffix match on Chrome's absolute path** (`src/shared/folder-choice.ts:18-21`). `cuj-1/run1/folders-dirchange-e2e-2-walk.json`: after the Downloads location moved from A to B, the repeat run in B used `pixiv/みずき-135882741 (1)` although B held no plain folder. `folders-nested-e2e-walk.json`: after a run with the pattern `x/pixiv/{artist}-{id}`, the default pattern's run used `(1)` as well. A pattern that drops a parent folder (`{artist}-{id}` after the default) is the same class and the more likely trigger. I accept this as a limitation rather than a caveat:
  1. **It errs only in the safe direction.** A suffix match is a superset of the anchored match the PRD describes, so the check can over-suffix but never under-detect. Under-detection is the harmful direction: duplicates mixed into the plain folder as `135882741_p0 (1).jpg`, the pre-refinement behaviour the owner asked to leave. Over-suffixing costs one clean sibling folder with a truthful tooltip.
  2. **The user is told the truth.** The tooltip and accessible name say `(1)`, and the folder holds every file with clean names. No file is lost, overwritten or misplaced. My iteration-4 rule stands: I hold a CUJ for a false done signal, never for a cosmetic naming edge.
  3. **No clean fix exists.** The extension cannot read Chrome's download location. Anchoring to a root learned from the extension's own completed downloads would close the longer-pattern case, but the download-location case would still get its one needless suffix (the learned root is stale until a download completes in the new location). A root guessed from the newest download in history can be poisoned by a Save As to another folder and would then under-detect, which is worse than today.
  4. **The triggers are uncommon**, and both require a repeat download of an artwork the user already has, where "you already have this one" is not a wrong message.
  The owner may still prefer the partial fix; R-008 offers it as option B, which would reopen prd-000 for that work.
- **Chrome's 10 s existence re-check limit** (tl, system.md §15 item 1; QA Recommendations 2). Chrome re-checks whether history files still exist at most once per 10 s per profile, and the previous job's own searches start that clock. A repeat click within 10 s of the previous download of this artwork, after its folder was moved away, still sees the records as present and takes the next free `(n)`; QA measured `(2)` instead of the plain folder, 2/2, and the plain folder after 10.5 s in every walk. This is an acceptable limit the spec should state, not a caveat: the normal case (a person moving a folder in Finder or Explorer and clicking again) takes longer than 10 s; the cost is one needless suffix; and no API forces an earlier check. PRD §4.2 and the "First folder moved" edge and AC 13 need the qualifier (R-008 item 2). tl's related fact belongs there too: a folder moved **back** stays flagged removed until Chrome restarts, so the next run uses the plain name plus per-file suffixes, the "history cleared" class.
- **Evidence gaps, carried** (no pixiv account): the live dark theme and the logged-in live paths are NOT_RUN (`docs/release-checklist.md` §3). Windows backslash paths for the folder regex are unit-tested only (L5).

**Spec gap**: R-008 items 1 and 2 above. Item 3, minor: the 200-page edge ("`199 / 200`, then `Saved · 200P`") can still hold `200 / 200` in the DOM for an unpainted instant in a lone 200-page job (QA 1 of 2 walks; the mechanism is recorded in design-download-engine.md). I decided in iteration 4 that this needs no probing and no code; one parenthetical makes the edge true as written.

### CUJ-2: Download an ugoira — Satisfied

**QA verdict** (from qa-report.md): PASS
**PM verdict**: Satisfied

**Assessment**:
- **Nothing in the ugoira pipeline changed this iteration except the two shared paths**, the folder choice and the offscreen client, and both are verified on this CUJ. `cuj2.ts` passed twice (44 checks each), the R-006 `ugoira` / `ugoira-zip` rows passed headed twice, and the live ugoira 151301221 passed twice (MP4 with H.264, ZIP only).
- **The repeat case holds for ugoira:** `cuj-1/run1/fu-e2e-01-ugoira-repeat-row.png` shows `Saved · MP4` with the tooltip `Saved to Downloads/pixiv/ひなた-136004512 (1)`, and the `(1)` folder holds `136004512.mp4`, `136004512_ugoira.zip`, `frames.json` and `metadata.json` with clean names. The SW log names the same folder (`records: 2, surviving: 2, chosen: … (1)`).
- **The one animation with the video / with `frames.json` is unchanged** (R-006 matrix PASS), and the timing and dimension ACs still hold (ffprobe: 4 frames at 40/40/500/40, 601×451 → 600×450).
- `cuj-2/run1/05-saved-row.png` matches the Saved style; `03-encoding-row.png` matches `cuj-2-encoding-row0.png` as in iteration 4.

**Caveats / gaps**: none in the product. Evidence limit, carried: playback in the VLC GUI and on Windows is L5.

**Spec gap**: none. The Chrome-prompt-on-the-zip limitation is now in the PRD (R-007 item 5).

### CUJ-3: Configure the extension from the toolbar icon — Satisfied

**QA verdict** (from qa-report.md): PASS
**PM verdict**: Satisfied

**Assessment**:
- **R-007 item 4 is built and matches the amended spec in both themes.** `cuj-3/run1/contrast-light.png`: the footer links `Reset to defaults` and `Report an issue` render in the darker `#0b6fc2`, and the selected `MP4` segment is a `#0b6fc2` fill with white semibold text, while the switch, the header mark and the chips keep pixiv's `#0096FA`. `contrast-dark.png`: the links are `#0096FA` on `#121212`, the selected segment stays `#0b6fc2` with white text. QA's computed colours and ratios match the PRD exactly (4.82:1, 6.02:1, 5.16:1). The iteration-3/4 contrast gap is closed.
- **Nothing else on this page changed.** `cuj3.ts` passed twice (main plus the four locales, 72 checks each), with 0 console errors, and the mocks `cuj-3-initial.html` / `-error.html` / `-saved.html` match the shots.

**Caveats / gaps**: none.

**Spec gap**: none.

### CUJ-4: Follow several downloads at once from the toolbar badge — Satisfied

**QA verdict** (from qa-report.md): PASS
**PM verdict**: Satisfied

**Assessment**:
- **AC 5, the iteration-4 hold, is met.** "Starting a second artwork while one is running begins downloading the second immediately. Neither job waits for the other." `cuj-4/run1/two-artworks-e2e-gap0-1-walk.json`: both clicks 6 ms apart, `Saved · 12P` and `Saved · 8P`, both folders holding `metadata.json`, 22 files, 0 failures, 0 resends. The same in all 16 gap-0 runs on the e2e build and the store zip, in the 20 two-artwork sweep runs, and in the 111 grace-close runs (a second job started about 5 s after a busy period, while `closeDocument` can be in flight). On the pre-D16 build the same probe ends `Retry · 2 failed` (`two-artworks-pred16-gap0-1-failed-row.png`) and, with a slowed close, hangs at `7 / 8` (`grace-pred16-slowclose-off100-B-7_8-row.png`), so the evidence discriminates.
- **The cost of the fix is as I pre-accepted:** the second job may wait the few milliseconds the shared document needs to start listening (rule b in `src/background/offscreen-client.ts`, `ensureOffscreen` returning the in-flight creation). QA saw 0 resends in 72 e2e-build runs, so on this machine the wait is the creation itself and nothing more. That is not "waiting for the other job" in AC 5's sense.
- **The badge, this CUJ's actual job, is unchanged and green twice** (`cuj4.ts`, 28 checks each): `23` with "across 2 downloads" (`02-tab-b-busy-row.png` shows `3 / 8` with the ring, matching `cuj-4-initial-row0.png`), the one-job tooltip, the drop on cancel, `999+`, recovery after a worker restart within 61–88 ms.
- **The same-artwork two-tab edge** reads `24` with "across 2 downloads" and lands the second job in `(1)` once the first's originals have landed, as the refined edge says.
- **R-006 across two jobs** (one animation in total, B silent while A still has files, a cancelled A ending silently) passes in both headed runs.

**Caveats / gaps**: none.

**Spec gap**: none.

### CUJ-5: Recover when a download can't start or breaks — Satisfied

**QA verdict** (from qa-report.md): PASS (live logged-in paths NOT_RUN, no account)
**PM verdict**: Satisfied

**Assessment**:
- **R-007 item 6 is built: `Saved` after a Retry now guarantees every file is on disk.** `cuj-5/run1/meta-01-retry-3-failed-row.png` shows `Retry · 3 failed` in the error style after pages 4, 9, 11 and `metadata.json` all failed (9 pages on disk, no `metadata.json`); after the click, `meta-02-saved-after-retry-row.png` shows `Saved · 12P` and the folder holds all 13 files. The pre-R-007 build `f15466a` ends the same scenario `Saved` without `metadata.json` (2/2), so the new e2e test discriminates. The "only `metadata.json` failed" edge keeps its own copy and writes only `metadata.json` (e2e ×4).
- **The refined step 5 holds: a Retry stays in the job's own folder, suffix included, with no second folder check.** `meta-03-sibling-retry-3-failed-row.png` → `meta-04-sibling-saved-row.png`: a repeat run that failed 3 pages in `(1)` retried only `(1)/p4, p9, p11` and ended `Saved · 12P` naming `(1)`; one `folder choice` log line in total.
- **The refined reload edge and step 9 hold:** a partial failure followed by reload and click runs the full job into `(1)` with the partial folder untouched; a mid-job 403, login and click lands in `(1)`.
- **Everything else is unchanged and green twice** (`cuj5.ts`, 48 checks each): the pre-emptive `Log in to download` on R-18 and walled works, the four cause tooltips, `Unavailable`, `Retry · MP4` after an encode failure, the floating fallback, and the R-006 ends (`retry3`, `403`, `403-last`, `unavailable`).
- **The intent holds:** every failure says what happened in the button itself, and after this iteration no end state fakes a done signal.

**Caveats / gaps**: none in the product. Evidence gap, carried: AC 2 / AC 4 after a real login, R-18 display off, and the stale-page probe are NOT_RUN (`docs/release-checklist.md` §3).

**Spec gap**: none.

## Spec-sync batch (R-008)

For the owner through `docs/owner-queue.md` R-008. All three are wording that records a limit the build has; none changes behaviour. Once approved, pm applies them in the next Phase 1, as with R-004 and R-007.

1. **Folder-check scope (§4.3 "Folder choice", the "Present" bullet; CUJ-1 AC 13 family). No code change.** Add: "The check matches the folder as the last segments of each record's path, because the extension cannot read Chrome's download location. A record of this artwork in the same folder name under another Downloads location (the user changed Chrome's download location), or under a longer earlier pattern whose folder ends with the current one (e.g. `x/pixiv/{artist}-{id}` before `pixiv/{artist}-{id}`), therefore also counts, and the run takes the next free `(n)` although the plain folder is free. One needless suffix with clean names inside; the check never fails the other way. Accepted limitation." Alternative the owner may choose instead: tl's root-anchoring fix (learn the Downloads root from the extension's own completed downloads and anchor the regex there), an iteration-6 code task that closes the longer-pattern case only; the location-change case keeps its one needless suffix. Choosing it reopens prd-000.
2. **The 10 s existence re-check (§4.2; CUJ-1 edge "First folder moved, renamed or deleted before the repeat click"; AC 13). No code change.** §4.2: after "The re-check is asynchronous and takes at most a few hundred ms", add "and Chrome runs it at most once every 10 s per profile; a search inside that window returns the flags as they were." The edge and AC 13 gain "at least 10 s after the previous download of this artwork": a repeat click sooner than that after the folder was moved away may still take the next free `(n)`. Also record: a folder moved back stays flagged removed until Chrome restarts, so the next run uses the plain name and the per-file safety net, as after a history clear.
3. **The 200-page edge (CUJ-1 edge cases). No code change.** "`0 / 200` … `199 / 200`, then `Saved · 200P`" gains "(an unpainted instant of `200 / 200` can occur; the counter rule in the acceptance criteria)".

## Recommended Next-Iteration Priorities
1. **[owner] R-008**: approve the three-item spec-sync batch (recommended, option A), or choose option B to have the folder-check fix built. On A, pm applies the wording in Phase 1 and nothing is coded. On B, tl designs the root-anchoring change in `src/shared/folder-choice.ts` / `src/background/folder-choice.ts` (anchor only to a root learned from the extension's own completed downloads, never a guessed one; the fix must be shown never to under-detect), with the deterministic repro `cuj1folders.ts SECTIONS=nested,dirchange` as the acceptance check for the nested case.
2. **[release, owner-run] Ship 1.0.1.** `docs/release-checklist.md`: bump `package.json` to `1.0.1` (line 7), `npm run zip`, and run §2 including its two new items (the repeat download landing in `<folder> (1)/` with clean names on real Chrome history, and the two-tabs ×5 `metadata.json` check that confirms D16 on branded Chrome) and §3's logged-in checks (CUJ-5 AC 2 / AC 4 / AC 9, CUJ-1 AC 20 dark theme). The release note should name the two user-visible changes: repeat downloads go to a sibling folder; two downloads started at the same instant no longer fail files.
3. **[tl, design docs, after R-008]** Close system.md §15 item 1 and fold the folder-check scope limit into design-download-engine.md "Folder choice" (the table row for records outside the Downloads root), so the next review has nothing to carry.
4. **[qa, next cycle, only if option B is chosen]** Re-run `cuj1folders.ts` with `SECTIONS=nested,dirchange` and the full `folders-series` walk on both builds; expect the plain folder in the nested case, and no regression in the six-run series. Nothing else needs re-verification: no other code path is touched.
5. **[pm, after R-008 wording lands]** No further review is needed for prd-000 unless option B reopens it. The next product work, if any, is a new PRD (candidates the owner has parked: a ZIP-per-artwork option, a folder picker outside Downloads), through `/design-feature`.

## PRD Lifecycle Changes (if any)
- prd-000-mvp: `active → completed` — all five CUJs Satisfied this iteration. The flip is in the PRD's frontmatter. R-008 does not gate it: items 1–3 are wording. If the owner chooses R-008 option B (build the folder-check fix), the PRD reopens `completed → active` for that work.
