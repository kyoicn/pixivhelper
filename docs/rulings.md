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
