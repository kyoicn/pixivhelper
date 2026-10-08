# pixiv Downloader: Product Requirements Index

This is the entry point for all product requirements. Feature specs live in numbered PRD files (`prd-NNN-<slug>.md`). Mocks live in `docs/ux/prd-NNN-<slug>-mockups/`.

## Product vision

**pixiv Downloader** is a Chrome extension (Manifest V3, desktop Chrome, Chrome Web Store) that puts one button on every pixiv artwork page. One click saves the whole artwork the way an archivist wants it:

- one folder per artwork inside Chrome's Downloads folder
- every page at original size
- a `metadata.json`
- for ugoira (pixiv's animated works): the original frame zip, the frame timing list, and a playable video encoded in the browser

It replaces a personal terminal script (`ref/pixiv-dl`), which needed cookie extraction and a local ffmpeg. It positions against heavy batch tools such as Powerful Pixiv Downloader on **simplicity**: one button, three settings.

### Goals
1. **Zero-configuration first download.** After install, saving an artwork takes one click on the artwork page. No setup, onboarding, or login to the extension.
2. **Parity with `ref/pixiv-dl` for a single artwork, without the terminal:**
   - originals byte-identical to what pixiv serves
   - the same `metadata.json` fields
   - the same folder-name sanitization
   - the same retry policy
   - an ugoira video with pixiv's exact frame timing
3. **A settings surface of exactly three settings** (folder pattern, ugoira output, metadata on/off) that a first-time user understands without help text beyond the page itself.
4. **Downloads never depend on the tab.** Closing or navigating the tab never loses a running download.

### Non-goals (product-wide, v1)
- Batch or listing-page downloading, crawling, or scheduling.
- Download history, deduplication, or library management.
- Saving outside Chrome's Downloads folder.
- Novels.
- Replacing or hiding Chrome's download UI.
- Mobile, Firefox, Safari, and other browsers.

## User personas

### P1: Aoi, the archivist collector
- Based in Tokyo, uses pixiv's Japanese UI and Chrome in Japanese. Follows about 300 artists and keeps a local archive organized by artist.
- Logged in, with R-18 display enabled.
- Wants every page at original size, `metadata.json` for provenance (title, tags, dates, description), and ugoira as videos that play in Finder or Explorer.
- Today: right-click saves the displayed size, multi-page manga takes 30 saves, and ugoira can't be saved at all.
- Will change the folder pattern once (e.g. `pixiv/{userId}/{id}` so renames don't split her archive), then never open settings again.

### P2: Chen, the casual saver
- Uses Chrome in Traditional or Simplified Chinese. Occasionally saves a wallpaper or a manga chapter. Often browses logged out.
- Will never open settings and won't read instructions.
- Needs "click, and it's in Downloads, in a sensible folder".
- Hits the needs-login state on R-18 works and needs the button itself to explain the next step.

### P3: The script user (maintainer, power user)
- Runs `ref/pixiv-dl` today and knows its behaviors.
- Expects the extension to keep the same folder discipline, `metadata.json` schema, and retry semantics.
- Values `{userId}` for rename-proof archives and the always-saved frame zip and `frames.json` for lossless provenance.

## PRD listing

| PRD | Title | Status | CUJs | Summary |
|---|---|---|---|---|
| [prd-000](prd-000-mvp.md) | pixiv Downloader MVP | active | CUJ-1 to CUJ-5 | Covers the Download button on artwork pages, ugoira-to-video in the browser, the three-setting options page, the files-remaining toolbar badge, and failure recovery. |

### CUJ index

| CUJ | Title | PRD | Priority | Depends on |
|---|---|---|---|---|
| CUJ-1 | Download an illustration or manga from the artwork page | prd-000 | P0 | none |
| CUJ-2 | Download an ugoira | prd-000 | P0 | CUJ-1, CUJ-3 |
| CUJ-3 | Configure the extension from the toolbar icon | prd-000 | P0 | none |
| CUJ-4 | Follow several downloads at once from the toolbar badge | prd-000 | P1 | CUJ-1 |
| CUJ-5 | Recover when a download can't start or breaks | prd-000 | P0 | CUJ-1, CUJ-2 |

CUJ IDs are never reused across PRDs.

## Cross-cutting concerns

### Accessibility
- Every interactive element the extension adds is a real, native, focusable control: `<button type="button">`, `role="switch"`, and segmented buttons with `aria-pressed` in a `role="group"`. Nothing is a clickable `<div>`.
- Everything works by keyboard alone. Enter and Space activate buttons. Tab order follows the visual order.
- Visible focus rings appear on `:focus-visible`: 2 px `#0096FA`, 3 px offset on the injected button, and `#5fb9fb` on pixiv's dark theme.
- The injected button uses `aria-busy="true"` while working, and a polite live region announces start, throttled progress (at most every 5 s), and the end state. Every state has an `aria-label` that carries the full meaning, including error causes, so nothing depends on hover tooltips.
- On the options page, the invalid field gets `aria-invalid="true"` and `aria-describedby` points to a `role="alert"` message. `Saved` confirmations sit in a polite live region.
- `prefers-reduced-motion: reduce` turns off the progress-ring transitions, the indeterminate rotation, and the `Saved` fade.
- **Contrast:** pixiv blue `#0096FA` against white is about 3.1:1. It is used for the idle and busy fill and the Saved text, and is accepted for parity with pixiv's own primary buttons. (assumption — confirm) Every other text/background pair the extension introduces must meet WCAG 2.1 AA (4.5:1).

### Internationalization
- **Locales:** `en` (default), `ja`, `zh_CN`, `zh_TW`, via Chrome's `_locales/<locale>/messages.json`. This includes the extension name and description in the manifest.
- **Language selection:** the UI follows Chrome's UI language (`chrome.i18n`). There is no in-extension language selector. Unsupported languages fall back to English. For example, `zh_HK` gets English under Chrome's fallback rules, which is a known v1 gap.
- **The copy deck in PRD-000 Appendix A is canonical.** Translations are reviewed by a native speaker before release.
- **Plurals:** `chrome.i18n` has no plural rules, so English singular and plural strings get separate message keys (`1 file remaining` / `5 files remaining`). Japanese and Chinese use one form.
- **Fixed-width button:** the injected button's width is locked per locale to its widest label. Translations should keep every label within the idle label's width wherever possible. Layouts are checked in all four locales.
- **CJK rendering:** the injected button and the options page set `lang` to the active UI locale, so Chrome picks the correct CJK glyph variants for Japanese vs. Simplified vs. Traditional Chinese.
- **Number formatting:** counters and percentages use ASCII digits in every locale. The page-count suffix stays `P`.
- **Japanese and Chinese user content** (artist names, titles, tags) flows unchanged into folder names, after NFC normalization and sanitization, and into `metadata.json`, written as literal UTF-8, never `\u`-escaped.

### Privacy & security
- **Network access** is limited to `https://www.pixiv.net` (artwork API) and `https://i.pximg.net` (originals and ugoira zips). `accounts.pixiv.net` is reached only by the user's own navigation (the login link). `Report an issue` is a user-initiated link.
- **No analytics, telemetry, crash reporting, remote config, or remote code.** Nothing the user downloads or views leaves the browser.
- **Stored data:**
  - the three settings, in `chrome.storage.sync` with `chrome.storage.local` as the fallback
  - in-flight job state, in session-scoped storage, which is gone when Chrome quits
  - no history, no artwork lists, no cookies, no credentials
- The extension never reads or stores the pixiv session cookie. It relies on the browser's own pixiv session for same-site requests.
- The Referer header is set only on the extension's own requests to `i.pximg.net`, never on the user's browsing traffic.
- **Target permissions:**
  - permissions: `downloads`, `storage`, `offscreen`, `declarativeNetRequestWithHostAccess`
  - host permissions: `https://www.pixiv.net/*`, `https://i.pximg.net/*`
  - content script on `https://www.pixiv.net/*`
  - explicitly not requested: `tabs`, `cookies`, `<all_urls>`, `webRequest`, `history`, `scripting`, `downloads.ui`

  Engineering may substitute an equivalent permission if an API demands it, with a written justification. It must never broaden host access.

### Theming
- **The injected button** looks identical on pixiv's light and dark themes. Only the focus ring changes (`#0096FA` → `#5fb9fb`). The theme is detected from pixiv's page, not from the OS.
- **The options page** follows the system preference via `prefers-color-scheme`. Its colors are specified in PRD-000 CUJ-3.

### Store readiness
- Manifest V3 with no remotely hosted code. The single purpose is "save the pixiv artwork you are viewing".
- Minimal permissions (see above), each with a Web Store justification.
- Privacy disclosures in the developer dashboard state that no user data is collected or transmitted.
- Store listing (name, short description, full description, screenshots) in `en`, `ja`, `zh_CN`, `zh_TW`.
- The version shown on the options page comes from the manifest.

## Non-functional requirements

| Area | Requirement |
|---|---|
| Injection latency | The Download button appears within **500 ms** of pixiv rendering the artwork's action row. Fallback: a floating button within **3 s** if the row can't be found. |
| Interaction latency | Busy feedback within **100 ms** of a click. State changes (Saved, idle after cancel, error) within **300 ms** of the triggering event. Toolbar badge updates within **1 s**. |
| Tab independence | Closing the tab, reloading it, or navigating away never cancels a running download. Orchestration runs in the background service worker and encoding in an offscreen document. In-flight job state survives service-worker restarts. Quitting Chrome loses files not yet handed to Chrome, which is accepted for v1. |
| Concurrency | At most **5 files per artwork** in Chrome's downloader at once. Different artworks run concurrently and are not serialized. |
| Retry policy | Up to **4 attempts** per request. Exponential backoff of 1.5·2ⁿ s plus 0–0.5 s jitter. `Retry-After` honored, capped at **30 s**. Retried: HTTP 429/500/502/503/504, network errors, and 30 s timeouts. **403 is never retried**. |
| Output fidelity | Originals are saved byte-for-byte as served. Ugoira video timing matches pixiv's per-frame delays exactly. The frame zip and `frames.json` are always kept. |
| Memory | Ugoira frames are decoded and encoded one at a time, never all held at once. |
| Payload | No WASM codec bundles (ffmpeg.wasm was rejected). Encoding uses Chrome's built-in WebCodecs. |
| Platform | Desktop Chrome on Windows, macOS, Linux, and ChromeOS. `minimum_chrome_version` is the lowest version supporting every API used (offscreen documents, WebCodecs `VideoEncoder`, action badge text color, session storage). |
| pixiv themes | Works and looks correct on pixiv's light and dark themes, and on pixiv's locale-prefixed URLs (`/en/artworks/<id>`). |
| Settings persistence | Every valid change is saved immediately. An invalid folder pattern is never stored, and the last valid one stays in effect. |

## Risks

- **pixiv DOM changes.** The action row selector is the most fragile dependency. Mitigation: the floating-button fallback (PRD-000 CUJ-5), with selectors kept in one place for fast updates.
- **Undocumented pixiv AJAX endpoints** (`/ajax/illust/{id}`, `/pages`, `/ugoira_meta`) may change shape without notice. Mitigation: the same endpoints have been stable in the reference script, and failures surface as the reactive error states.
- **Web Store trademark review.** A listing named "pixiv Downloader" uses a third-party brand and may be flagged. If it is, the name becomes an owner decision (e.g. "Downloader for pixiv").
- **Chrome's "Ask where to save each file before downloading" setting** may force a Save dialog per file. This is a known v1 limitation (PRD-000 CUJ-1 edge cases).
- **H.264 encoder availability** varies (some Chromium builds lack it). Mitigation: automatic per-download WebM fallback (PRD-000 §4.6).

## Glossary

| Term | Meaning |
|---|---|
| **Artwork** | One pixiv work with its own ID, page `https://www.pixiv.net/artworks/<id>`. |
| **illustType** | pixiv's work type: 0 illustration, 1 manga, 2 ugoira. |
| **xRestrict** | pixiv's age rating: 0 all ages, 1 R-18, 2 R-18G. |
| **Original** | The full-resolution file on `i.pximg.net`. It requires `Referer: https://www.pixiv.net/`. |
| **Ugoira** | pixiv's animated format: a zip of still frames plus a per-frame delay list. |
| **Action row** | The row of controls under the artwork image on pixiv (share, more, like, bookmark). |
| **Job** | One click on one artwork in one tab. Runs in the background and is independent of the tab. |
| **Badge** | The number on the extension's toolbar icon: files still to land across every job in flight. |
