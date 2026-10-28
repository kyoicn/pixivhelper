# Owner Queue

> Everything currently waiting on your decision — nothing else. Entries append
> at the bottom, so the oldest sits on top. Answer by writing under
> "your answer" (agents transcribe and clear the entry), or just say it in
> chat. When nothing is below the line, nothing is waiting on you.
Next-ID: R-009

---

### R-008 · Apply pm's prd-000 spec-sync batch (3 items)?

waiting since iter-5 · prd-000 · producer: pm (PRD edits); coder only under option B

Three prd-000 lines promise slightly more than Chrome lets the extension deliver. QA's iteration-5 LOW (the folder check also counts this artwork's files under another Downloads location or a longer earlier pattern, so a repeat run there gets a needless ` (1)`; nothing lost or overwritten) and the 10 s existence re-check limit (a repeat click within 10 s of the previous download, after the folder was moved away, still takes the next free `(n)`) both cost one cosmetic suffix in an uncommon case, and no API lets the extension do better. The third is a parenthetical on the 200-page counter. Details: [docs/pm-review.md "Spec-sync batch (R-008)"](pm-review.md#spec-sync-batch-r-008).

- **A. Approve all three as recommended** *(recommended: wording only, no code; the check can only over-suffix, never miss a real collision; prd-000 stays `completed` and 1.0.1 ships from `main` as is)*
- **B. Items 2 and 3, and build the folder-check fix for item 1**: anchor the check to a Downloads root learned from the extension's own completed downloads. Closes the longer-pattern case only; the download-location case keeps its one needless suffix. Reopens prd-000 (`completed → active`) and adds an iteration before 1.0.1.
- **C. Item by item**: run `/spec-sync` and answer each one

*No default — stays open.*

> **your answer:**
