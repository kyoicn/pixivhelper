# Dev Loop State

Last updated: 2026-10-28 01:32:37 (UTC-7)
Iteration: 5
Status: done

## Last Cycle Summary
- Tasks executed: 6 (two groups: D15 folder choice, D16 offscreen readiness, ENG-014 test doubles, L2/fake tests, e2e sibling-folder + D16 suites, ENG-013 settle-wait tests), all merged, 0 failed; tl review 0 critical (docs/code-review.md)
- CUJs passed QA: 4 of 5 (0 unimplemented) — CUJ-2, CUJ-3, CUJ-4, CUJ-5 PASS; CUJ-1 FAIL with one LOW
- Tests passing: 3305 unit/L2 (vitest) + 162 e2e (6 headed-only skipped headless; headed toolbar 6/6) + 4/4 live ×2
- Tests failing: 0
- QA inner loops used: 0
- CUJs completed this cycle (PM Satisfied): CUJ-1 (refined 2026-10-27), CUJ-4 — both out of Caveats; CUJ-2, CUJ-3, CUJ-5 unchanged. All 5 Satisfied; prd-000 flipped to `completed`
- CUJs remaining: 0
- ENG entries completed this cycle: ENG-013, ENG-014
- ENG entries open: 0 (0 blocking)
- Routed issues: taken none / closed none / still open 0 (Issue 2026-10-27-19-58-31 was refined through /design-feature before this cycle and is closed)
- Owner sweep: queue empty at setup; pm filed R-008 (prd-000 spec-sync batch of 3) at review — open, no default

## QA Gate
- Verdict: FAIL (LOW only → proceeded)
- Fabrications found: 0 (none)
- Bugs by severity: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 1
  - [LOW][BUG] CUJ-1: `folderCheckRegex` (src/shared/folder-choice.ts) is a suffix match on Chrome's absolute path, so a record under a previous Downloads location or an earlier longer pattern (`x/pixiv/{artist}-{id}`) makes the next run take `<folder> (1)` although `<Downloads>/<folder>/` is absent. Cosmetic: nothing lost or overwritten. PM: not a caveat; R-008 decides between recording it as a §4.3 limitation (A) and a root-anchored check (B).
- Resolved this cycle: both iteration-4 LOWs — the offscreen creation race (D16: 32/32 at click gap 0 on both builds, sweep 40/40, pre-fix build 1/8) and the `N / N` counter (spec via R-007 item 1)
- Spec note, not a bug: Chrome rate-limits the download-existence re-check to once per 10 s per profile, so a repeat click within 10 s of moving the first folder away takes `(2)`; PRD §4.2 / CUJ-1 moved edge omit this (system.md §15 item 1) — R-008 item 2
- Not run: logged-in live paths (no pixiv account), Windows backslash paths, branded Chrome — docs/release-checklist.md §2/§3

## Blocker (if status = blocked)
none

## Next Focus
No CUJ work remains in prd-000. From docs/pm-review.md iteration 5:
1. [owner] Answer R-008 in docs/owner-queue.md (A recommended: wording only). On A, pm applies the three amendments via /spec-sync. On B, tl designs the root-anchored folder check (root learned from the extension's own completed downloads, never guessed; must never under-detect) and prd-000 reopens for one iteration; qa re-runs `cuj1folders.ts` nested/dirchange on both builds.
2. [release, owner-run] Ship 1.0.1: bump package.json, `npm run zip`, release-checklist §2 (incl. the repeat-download and two-tabs ×5 items) and §3 logged-in checks; release note names the two user-visible changes (sibling folder on repeat, race fix). Push main first — commits since 5ea4c27 are not on origin.
3. [tl, after R-008] Close system.md §15 item 1; fold the folder-check scope limit into design-download-engine.md "Folder choice".
4. [pm] Next product work is a new PRD via /design-feature.
