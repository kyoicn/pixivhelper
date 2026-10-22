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
