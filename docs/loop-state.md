# Dev Loop State

Last updated: 2026-10-23 23:58:55 (UTC-7)
Iteration: 4
Status: continue

## Last Cycle Summary
- Tasks executed: 1 (ENG-012 test pins), merged, 0 failed; plus the between-cycles quick-fix c2c9de0 (bubble-misses-last-file LOW)
- CUJs passed QA: 3 of 5 (0 unimplemented) — CUJ-2, CUJ-3, CUJ-5 PASS; CUJ-1, CUJ-4 FAIL with LOW-only findings
- Tests passing: 3066 unit/integration (67 files) + 146 e2e (6 headed-only skipped headless; headed toolbar 6/6) + 4/4 live ×2
- Tests failing: 0
- QA inner loops used: 0
- CUJs completed this cycle (PM Satisfied): CUJ-2, CUJ-3, CUJ-5 (unchanged)
- CUJs remaining: 2 (CUJ-1, CUJ-4 — PM Caveats for the offscreen creation race only)
- ENG entries completed this cycle: ENG-012
- ENG entries open: 1 (0 blocking) — ENG-013 P2 test-only (othersSettled search-fallback + cross-job unit tests)
- Routed issues: taken none / closed none / still open 0
- Owner sweep: queue was empty at setup; pm filed R-007 (spec-sync batch of 6) at review — open, no default

## QA Gate
- Verdict: FAIL (LOW only → proceeded)
- Fabrications found: 0 (none)
- Bugs by severity: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 2
  - [LOW][BUG] CUJ-1/CUJ-4: offscreen-document creation race when two jobs start within ~10 ms (second job's metadata.json + first pages fail with 0 attempts; "4 attempts" tooltip misleading; after Retry the folder lacks metadata.json with no report). 14/16 at 5–11 ms gap, 0/36 at ≥50 ms on the fake; live reachability unmeasured (API latency, not click gap, sets the race). src/background/offscreen-client.ts ensureOffscreen()/send(), engine.ts ~180–200. Pre-existing.
  - [LOW][BUG] CUJ-1: pages counter shows N / N in the DOM for 0–2 ms before Saved in two-job and 200-page cases (painted once in 20 two-job runs; never in single 12-page jobs). PM: not a caveat; the AC wording should change (R-007 item 1), no code change.
- Resolved this cycle: iteration-3 LOW (bubble missing the last file) — 44/44 busy periods ordered correctly across e2e, dev, store-zip and live builds
- Not run: logged-in live paths (no pixiv account) — docs/release-checklist.md §3

## Blocker (if status = blocked)
none

## Next Focus
Planner priority order (from docs/pm-review.md iteration 4):
1. [tl → coder] Fix the offscreen creation race in src/background/offscreen-client.ts: ensureOffscreen() returns the in-flight creating promise before calling getContexts; send() treats "Receiving end does not exist" as not-ready-yet with a bounded wait (≤ 1 s) and resend (also covers a job starting during the 5 s grace close); record in design-offscreen-worker.md "Lifecycle"; L2 tests for two jobs starting during creation and a command during close, with a mutation check. Exit: twoTabsProbe.ts at CLICK_GAP=0, same and different artworks, e2e build and store zip, ≥ 8 runs each → both jobs Saved with metadata.json; R-006 regressions green.
2. [owner → pm → coder] R-007 spec-sync batch (6 items; see docs/pm-review.md "Spec-sync batch (R-007)"): counter wording; the 200-page edge line; mid-job 403 wording; settings contrast (#0b6fc2 links + selected segment, three cuj-3 mocks, options.css); ugoira-zip prompt as a known v1 limitation; Retry after pages + metadata.json both failed must re-write metadata.json (outcome.ts, model.ts startRequest, resolver.ts resolveRetryPages).
3. [coder, parallel with 1] ENG-013 (P2, test-only).
4. [tl] design-download-engine.md "When N / N can still show" → QA's measured mechanism + the metadata-only retry's 12 / 12; close §15 gaps 1–3 after R-007.
5. [qa] race probe at CLICK_GAP=0 both builds ≥ 8 runs + 0–800 ms sweep; grace-close edge (second job ~5 s after a busy period, ±50 ms); regression: headed R-006 matrix, race12-nohold ×8 on the store zip, click→Saved 133–163 ms; after R-007 items 4/6: CUJ-3 colours both themes, CUJ-5 with injected metadata.json + page failures.
6. [owner, not a loop gate] docs/release-checklist.md §2 (R-006 item, Windows ESB ugoira check, new: two artworks in two tabs ×5 on live pixiv → both folders hold metadata.json), §3 logged-in checks, §6 make the repo public (R-001).
Owner decisions never park here: R-007 is in docs/owner-queue.md.
