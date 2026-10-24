# Dev Loop State

Last updated: 2026-10-23 21:17:48 (UTC-7)
Iteration: 3
Status: continue

## Last Cycle Summary
- Tasks executed: 5 (4 in one parallel group + 1 retry-pass fix), all merged, 0 failed, no conflicts
- CUJs passed QA: 3 of 5 (0 unimplemented) — CUJ-2, CUJ-3, CUJ-5 PASS; CUJ-1, CUJ-4 FAIL with one shared LOW
- Tests passing: 3065 unit/integration (67 files) + 143 e2e (4 headed-only skipped headless; headed toolbar 4/4) + 4/4 live ×2
- Tests failing: 0
- QA inner loops used: 1 (MEDIUM "Chrome's downloads button never returns" → owner ruling R-006 → fix → re-verified RESOLVED)
- CUJs completed this cycle (PM Satisfied): CUJ-2, CUJ-3, CUJ-5
- CUJs remaining: 2 (CUJ-1, CUJ-4 — PM Caveats on one LOW)
- ENG entries completed this cycle: none (backlog was empty; Next-ID ENG-012)
- ENG entries open: 0 (0 blocking)
- Routed issues: taken none / closed none / still open 0
- Owner sweep: R-004 and R-005 applied pre-cycle; R-006 filed, answered (B) and applied mid-cycle; queue empty (Next-ID R-007)
- Shipped: job-level outage rule (S3); hide Chrome's download UI during jobs with one animation at the last file (R-005/R-006, permission downloads.ui); options paste newlines dropped, unclosed "{" invalid, "Still using:" one line (S5/S15); floating fallback 2763–2778 ms (S4); English ugoira 176 px (S1)

## QA Gate
- Verdict: FAIL (LOW only → proceeded)
- Fabrications found: 0 (none)
- Bugs by severity: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 1
  - [LOW][BUG] CUJ-1/CUJ-4: when a job's last files land together, an earlier file finishing 0–7 ms after the UI restore opens Chrome's bubble before the last file exists; the bubble then lists all files but the last (5/8 store-zip runs on the fake, 0/6 live). Button, single animation, files, chrome://downloads unaffected. src/background/engine.ts targetsKnown (~210–240) and the last-hand-off path (~278–288)
- Resolved this cycle: iteration-2 LOWs (paste newlines, outage residual, floating timing, 176 px) and the iteration-3 MEDIUM
- Not run: logged-in live paths (no pixiv account) — docs/release-checklist.md §3

## Blocker (if status = blocked)
none

## Next Focus
Planner priority order (from docs/pm-review.md iteration 3):
1. [tl → coder] Fix the LOW: the last hand-off waits (capped ≤ 2 s) until earlier in-flight files have LEFT in_progress (finished/interrupted/unknown), not merely been named — rename targetsKnown → othersSettled; update design-download-engine.md "The last hand-off" step 3 + alternatives table; unit/integration tests incl. the fake recording "a file finished while the UI was on before the last file existed" (must never happen). Done when QA's race probe (SCEN=race12-nohold REPS=8, dev + store zip) and two-job ×4 list the last file every time, still one animation, Saved ≤ 100 ms later on the fake. Exit rule: anything left only at the cap → amend AC 14 instead of looping.
2. [coder, same change set] code-review W1: add the held-hide "last two together" unit test (docs/code-review.md addendum); drop the untested "watcher is gone" line from the design's test list.
3. [pm spec-sync] (a) §4.1 #3 "needed login after a mid-job 403" → "after a 403 with no other file still on its way to Chrome" + CUJ-5 step 9 sentence; (b) options contrast: links light #0b6fc2, selected segment #0b6fc2 + white in both modes, fix the index "Contrast" claim, update the three cuj-3 mocks (options.css follows); (c) record the Chrome prompt on the ugoira zip as a known v1 limitation in CUJ-2 edges with the pre-decided response.
4. [tl] design-doc notes: boot-time note at "Restart at await:handoff.restoreUi"; a prompt on the ugoira zip blocks later files of that job; close §15 gap 2 after 3b.
5. [qa] the priority-1 probes + full headed R-006 matrix; restore→last-file and click→Saved timing; CUJ-3 colours both themes; CUJ-5 step 9 for 403 and 403-last; hand-reopened bubble if an OS click is possible.
6. [owner, not a loop gate] release-checklist §2 R-006 item (HTTP-cache re-download burst, Windows ESB ugoira check), §3 logged-in checks, make the repo public (R-001).
Owner decisions never park here; the queue is empty.
