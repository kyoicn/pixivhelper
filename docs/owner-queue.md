# Owner Queue

> Everything currently waiting on your decision — nothing else. Entries append
> at the bottom, so the oldest sits on top. Answer by writing under
> "your answer" (agents transcribe and clear the entry), or just say it in
> chat. When nothing is below the line, nothing is waiting on you.
Next-ID: R-005

---

### R-004 · Apply pm's prd-000 spec-sync batch (S1–S15)?

waiting since iter-2 (some items open since iter-1) · prd-000 · producer: pm (PRD and mock amendments), tl (CUJ-5 outage fix)

The build deliberately departs from prd-000 in 15 places (176 px ugoira pill, AA contrast colours, outage diagnosis, …), so QA re-flags them every run and prd-000 can't close. Each item and pm's recommendation: [pm-review.md, Recommended Next-Iteration Priorities, item 4](pm-review.md).

- **A. Approve all 15 as recommended** *(recommended — 12 items only write down what the build already does; 3 change it a little: S3 the simpler outage fix ("No connection" only when pixiv answered nothing in that click), S5 a half-typed `{` is no longer autosaved, S15 the "Still using:" label stays on one line)*
- **B. Approve all except S3** — step 6 keeps its wording; tl builds a per-URL memory fix instead
- **C. Go through them one by one** — run `/spec-sync prd-000` with pm

*No default — stays open. Until it is answered, the loop runs on the current PRD and tl builds the B outage fix.*

> **your answer:**
