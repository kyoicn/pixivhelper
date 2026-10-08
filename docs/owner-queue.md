# Owner Queue

> Everything currently waiting on your decision — nothing else. Entries append
> at the bottom, so the oldest sits on top. Answer by writing under
> "your answer" (agents transcribe and clear the entry), or just say it in
> chat. When nothing is below the line, nothing is waiting on you.
Next-ID: R-003

---

### R-001 · Where should the settings page's "Report an issue" link go?

waiting since design (2026-10-08) · prd-000 · producer: pm (CUJ-3 footer)

The options-page footer in the agreed design carries a "Report an issue" link, but no destination was ever named. The Web Store listing also needs a support URL. Details: [CUJ-3 in prd-000](prd/prd-000-mvp.md).

- **A. GitHub Issues of this repository** *(recommended — zero cost, public, where bug reports already route via /report-bug)*; needs the repo to be public before submission.
- **B. A support email address** — simpler for non-technical users, but reports arrive unstructured and privately.
- **C. No link in v1** — footer shows only Reset, version and the privacy line.

*Unanswered by the first /dev-cycle → C applies automatically (link hidden until a URL exists).*

> **your answer:**

### R-002 · Keep "pixiv Downloader" as the public extension name?

waiting since design (2026-10-08) · prd-000 · producer: pm (index Risks)

The design uses "pixiv Downloader" as the working name. Chrome Web Store policy rejects names that use a third-party brand in a way that implies affiliation; the tolerated pattern is "<name> for <brand>". The name appears in the manifest, the settings header, and the store listing in four languages. Details: [Risks in the PRD index](prd/index.md).

- **A. Keep "pixiv Downloader"** — shortest and clearest; real risk of a store rejection that costs a resubmission round.
- **B. Rename to the "for pixiv" pattern**, e.g. "Original Saver for pixiv" *(recommended — matches what the store accepts; the word "pixiv" stays searchable)*.
- **C. Decide at submission time** — build under the working name, rename only if rejected.

*No default — stays open. The build proceeds under the working name until answered.*

> **your answer:**
