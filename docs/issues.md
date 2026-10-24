# Issues

Lightweight intake queue. Each issue is an h3 block with structured fields. Removed when resolved (history lives in git via fix: commits).

---

### Issue 2026-10-24-03-03-39: ugoira button shows `100%` for one frame while still busy under full-suite load

- **Filed**: 2026-10-24 03:03:39 (UTC-7)
- **Description**: During the 1.0.0 release checklist (§1, local `npm run test:e2e`, macOS, Playwright's Chrome for Testing 156.0.8078.4), two CUJ-2 tests failed in two consecutive full-suite runs with `no 100% while busy — Expected: < 100, Received: 100`: `example (136004512) as MP4` and either `metadata off` or `long ugoira (136004517)`. Both pass when run alone (`--grep`), and CI's last run (iteration 2) passed them. Cause: `ugoiraPercent()` in `src/shared/progress.ts` returns `100` as soon as every file has landed, and the job ends (button → `Saved · MP4`) in a later turn after finalize (download-UI restore, record write). On an idle machine the two happen within the same frame; under CPU load the MutationObserver sampler sees the `100%` busy frame. Same class as the one-frame `N / N` on two-job and 200-page runs (qa-report iteration 4 LOW 2; owner-queue R-007 item 1 amends the wording for pages jobs). Candidate fix: cap the busy percent at `RUNNING_CAP` until the job has ended (one line in `ugoiraPercent`, plus the design-download-engine.md "Progress counter" line and the unit tests that expect 100 when all files landed). Alternatively, amend PRD-000 §4.7.5 the way R-007 item 1 does for pages jobs and loosen the e2e assertion.
- **CUJ**: CUJ-2 (docs/prd/prd-000-mvp.md)
- **Expected**: PRD-000 §4.7.5: an integer percent while busy, never `100%` before the end.
- **Observed**: one sample of `100%` with `aria-busy="true"` right before `Saved · MP4`, only when the suite runs in parallel.
- **Repro**:
  1. `npm run test:e2e` (full suite, default workers) on a loaded machine.
  2. Watch `e2e/cuj2.spec.ts` › `example (136004512) as MP4` and `long ugoira (136004517)`.
  3. `npx playwright test e2e/cuj2.spec.ts --grep "example \(136004512\) as MP4"` alone passes.
