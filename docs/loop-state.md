# Dev Loop State

Last updated: 2026-10-23 04:36:17 (UTC-7)
Iteration: 2
Status: continue

## Last Cycle Summary
- Tasks executed: 12 (3 parallel groups: 1 + 5 + 6), all merged; 0 failed; 1 orchestrator merge fix (badge.test loggedIn literal)
- CUJs passed QA: 2 of 5 (0 unimplemented) — CUJ-1, CUJ-4 PASS; CUJ-2, CUJ-3, CUJ-5 FAIL with LOW-only findings
- Tests passing: 2810 unit/integration (62 files) + 110 e2e + 12/12 live (3 runs)
- Tests failing: 1 e2e — QA's new CUJ-3 paste-newline test, failing by design until the fix lands
- QA inner loops used: 0
- CUJs completed this cycle (PM Satisfied): CUJ-1, CUJ-2, CUJ-4
- CUJs remaining: 2 (CUJ-3, CUJ-5 — PM Caveats, one narrow LOW each)
- ENG entries completed this cycle: ENG-006, ENG-007, ENG-008, ENG-009, ENG-010, ENG-011
- ENG entries open: 0 (0 blocking) — backlog empty, Next-ID ENG-012
- Routed issues: taken none / closed none / still open 0
- Owner sweep: R-003 answered (B) → docs/rulings.md; pm amended CUJ-5 Part A, CUJ-1 precondition, aria_login (d2449e3). R-004 filed by pm (spec-sync batch S1–S15).

## QA Gate
- Verdict: FAIL (LOW only → proceeded)
- Fabrications found: 0 (none)
- Bugs by severity: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 4
  - [LOW][BUG] CUJ-3 NEW: pasted line breaks become spaces in the folder pattern (Chromium replaces CR/LF with spaces; src/options/page.ts) → folder "pixiv/みずき -135882741"
  - [LOW][BUG] CUJ-5 residual: when Chromium throttles all 4 attempts locally (1 of 7 Retry clicks in an outage) the tooltip still says "No connection" (retry.ts / outcome.ts); the common case is fixed
  - [LOW][BUG] CUJ-5: floating fallback lands at 3011–3079 ms vs the 3 s target (timer starts at content-script load; mount.ts) — design item
  - [LOW][VISUAL_DEVIATION] CUJ-2: ugoira pill 176 px vs PRD 164 — PRD-internal conflict, awaiting R-004 (S1)
- Resolved from iteration 1: Saved-beside-error, outage tooltip (common case), live smoke flakiness, provisional width, aria text, contrast (AA values differ from PRD), pattern ~ edge, badge 0-count title
- Not run: logged-in live paths (no pixiv account) — docs/release-checklist.md §3 covers them as owner-run checks
- R-003 verified live: 151107515 (sensitive wall) and 151107522 (R-18) show "Log in to download"; click-before-metadata race reaches only /ajax/illust

## Blocker (if status = blocked)
none

## Next Focus
Planner priority order (from docs/pm-review.md iteration 2):
1. [coder] CUJ-3 paste: intercept inserted text on #pattern (beforeinput/paste/drop) and strip CR/LF in src/options/page.ts; fix design-options-page.md line ~146 (Chromium replaces, not strips). Done when e2e/cuj3.spec.ts "edge: newlines" passes.
2. [tl → coder] CUJ-5 outage residual: if R-004 answered A → job-level rule (offline only if nothing in the job got an HTTP answer) in outcome.ts; else per-URL last-429/5xx memory surviving SW restart (retry.ts withLastStatus, outcome.ts isUnanswered). Update system.md §9/§10 row 8. Done when diagOutage.ts shows "pixiv isn't responding" on every click across 3 replays × 7 clicks (503 and 500) and a stopped server still shows "No connection".
3. [tl → coder] Floating-fallback timer: keep route entry as anchor, fire at 3000 ms minus a placement budget (overshoot measured 11–79 ms); update design-artwork-button.md "Mounting" and system.md §11.6; then mount.ts show(). Done when diagFloat.ts ≤ 3000 ms in 10/10 samples and the cuj5 floating e2e passes twice.
4. [pm + owner] R-004 spec-sync batch S1–S15 (docs/pm-review.md priority 4) — if approved, S3/S5/S15 need code; QA then stops logging the 176 px deviation and compares against the recoloured/widened mocks.
5. [qa] Re-run diagOutage, diagFloat, the paste e2e, a single-line paste with trailing newline; screenshot states after the 120 ms transition settles.
6. [owner, not a loop gate] docs/release-checklist.md §3 logged-in checks before store submission.
Owner decisions never park here: R-004 is in docs/owner-queue.md.
