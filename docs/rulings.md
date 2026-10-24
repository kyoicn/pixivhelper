# Rulings

Standing rulings. Append-only; agents cite entries by R-ID. Same ID namespace as docs/owner-queue.md.

---

### R-001 · Where should the settings page's "Report an issue" link go?

The options-page footer carries a "Report an issue" link and the Web Store listing needs a support URL; no destination had been named.

**Scope**: prd-000
**Ruling**: GitHub Issues of this repository, `https://github.com/kyoicn/pixivhelper/issues`. The repository is private today, so the link does not work for the public yet; making the repository public is a pre-submission requirement for the Web Store listing. (2026-10-22)

### R-002 · Keep "pixiv Downloader" as the public extension name?

"pixiv Downloader" was the working name; Chrome Web Store policy rejects third-party brands used as if affiliated, tolerating the "<name> for <brand>" pattern.

**Scope**: prd-000
**Ruling**: The public name is **"Helper for Pixiv"**. It replaces "pixiv Downloader" in the manifest, settings header, tooltips, store listing, PRD and mocks. The pattern follows what the store accepts; the owner preferred it over the proposed alternative. (2026-10-22)

### R-003 · Should `Log in to download` also cover all-ages works that pixiv hides from logged-out visitors?

CUJ-5 Part A showed the needs-login state only for `xRestrict ≥ 1`. On live pixiv an all-ages work behind pixiv's "This work may contain sensitive content. Please log in to view this work." wall still downloaded while logged out.

**Scope**: prd-000
**Ruling**: Option B. The extension respects pixiv's login requirement wherever pixiv imposes one: logged out plus any work pixiv withholds behind a login wall (R-18, R-18G, or the sensitive-content wall) shows `Log in to download`. Owner's words: "of course, respect whenever pixiv requires login." pm amends CUJ-5 Part A and the login copy; tl specifies the detection signal. (2026-10-23)

### R-004 · Apply pm's prd-000 spec-sync batch (S1–S15)?

The build deliberately departs from prd-000 in 15 places (176 px ugoira pill, AA contrast colours, outage diagnosis, …) so QA re-flagged them every run and the PRD could not close. Items and recommendations: docs/pm-review.md (iteration 2), priority 4.

**Scope**: prd-000
**Ruling**: Option A — approve all 15 as pm recommended. Twelve items record what the build already does; three change behaviour slightly: S3 the job-level outage rule ("No connection" only when pixiv answered nothing in that click), S5 a half-typed `{` is invalid and never autosaved, S15 the "Still using:" label stays on one line. pm amends the PRD and mocks; S3/S5/S15 become iteration-3 tasks. Owner's words: "GO WITH A". (2026-10-24)

### R-005 · Hide Chrome's download UI while a job runs?

Each file handed to Chrome triggers Chrome's fly-to-toolbar download animation; a 20-page manga produces 20 of them (owner observed this on first install, 2026-10-24). Options discussed: hide Chrome's download UI during jobs (`chrome.downloads.setUiOptions`, permission `downloads.ui`, no new install warning), one ZIP per artwork, direct folder writes via the File System Access API.

**Scope**: prd-000
**Ruling**: Option 1 — the extension disables Chrome's download UI from the moment the first file of a job is handed to Chrome until the last running job ends, then re-enables it; the worker re-enables it on boot whenever no job is running. The `downloads.ui` permission is added with the justification "hides Chrome's per-file download animation while a multi-page artwork saves, then restores it". Browser-wide side effect while active is accepted. The ZIP-per-artwork option and the folder-picker option remain future candidates. Owner's words: "ok go with option 1". (2026-10-24)

### R-006 · After a job ends, how does Chrome's downloads button come back?

Chrome re-enables its download UI on `setUiOptions({ enabled: true })` but shows the toolbar button again only with the next download; no extension API can open the bubble. The PRD (R-005 wording) promised the bubble returns listing the finished files.

**Scope**: prd-000
**Ruling**: Option B — the extension re-enables Chrome's download UI just before the LAST file of the last running job is handed to Chrome, so each job ends with exactly one fly-to-toolbar animation (the "done" signal) and the bubble lists every file of the job. CUJ-1 AC 14 changes from "no animation" to "at most one animation, at the end"; jobs that end without a final hand-off (cancel, failure, needs-login, unavailable) still restore the UI at finalize. (2026-10-24)

### R-007 · Apply pm's prd-000 spec-sync batch (6 items)?

Six prd-000 lines overstated, contradicted each other, or left a case open after iterations 3 and 4 (counter wording, the 200-page edge, the mid-job 403 wording, settings-page contrast, the ugoira-zip prompt, Retry after a `metadata.json` failure). Details: docs/pm-review.md "Spec-sync batch (R-007)".

**Scope**: prd-000
**Ruling**: Option A — approve all six as pm recommended. Items 1, 2, 3 and 5 are wording that makes the PRD match what ships; item 4 raises the settings-page links and the selected segment to the PRD's own 4.5:1 contrast rule; item 6 makes `Saved` after a Retry guarantee `metadata.json` is on disk. pm amends the PRD and mocks; items 4 and 6 become code tasks. Owner's words: "go with A". (2026-10-24)
