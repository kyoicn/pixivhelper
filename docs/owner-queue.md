# Owner Queue

> Everything currently waiting on your decision — nothing else. Entries append
> at the bottom, so the oldest sits on top. Answer by writing under
> "your answer" (agents transcribe and clear the entry), or just say it in
> chat. When nothing is below the line, nothing is waiting on you.
Next-ID: R-008

---

### R-007 · Apply pm's prd-000 spec-sync batch (6 items)?

waiting since iter-4 (items 3–5 first raised iter-3) · prd-000 · producer: pm (PRD + mock edits), then coder (items 4, 6)

Six prd-000 lines overstate, contradict each other, or leave a case open. QA re-flags the "`12 / 12` is never shown" line every run, and items 4 and 6 can't be built until you approve. Details: [docs/pm-review.md "Spec-sync batch (R-007)"](pm-review.md#spec-sync-batch-r-007).

- **A. Approve all six as recommended** *(recommended: four are wording only and make the PRD match what ships; item 4 brings two settings-page texts up to the PRD's own 4.5:1 rule; item 6 makes `Saved` after a Retry guarantee `metadata.json` is on disk)*
- **B. Wording only (items 1, 2, 3, 5)**: the settings-page links and the selected segment keep their 2.9:1 / 3.1:1 blue, and a Retry after a `metadata.json` failure can still end `Saved` without it
- **C. Item by item**: run `/spec-sync` and answer each one

*No default — stays open.*

> **your answer:**
