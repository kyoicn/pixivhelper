---
id: prd-000
title: pixiv Downloader MVP
status: active
created: 2026-10-08
deprecation_reason:
---

# PRD-000: pixiv Downloader MVP

## 1. Overview

pixiv Downloader is a Manifest V3 Chrome extension for desktop Chrome, published on the Chrome Web Store. It adds one button to every pixiv artwork page. One click saves the whole artwork the way an archivist wants it: one folder per artwork inside Chrome's Downloads folder, every page at original size, a `metadata.json`, and for ugoira (pixiv's animated works) the original frame zip, the frame timing list, and a playable video encoded in the browser.

The extension replaces a personal Python script, `ref/pixiv-dl`, and carries over its behaviors (endpoints, folder-name sanitization, `metadata.json` fields, retry policy). The browser now does what the terminal, the cookie extraction, and the local ffmpeg install used to do.

## 2. Motivation

Getting originals plus metadata plus an ugoira video today requires either:

- **A terminal script** (`ref/pixiv-dl`): it reads the `PHPSESSID` cookie out of Chrome's cookie database (Chrome must be fully quit to unlock it) and needs a local ffmpeg install to build ugoira videos.
- **A batch engine** such as Powerful Pixiv Downloader: dozens of settings built for crawling listing pages. That is overkill for "save the thing in front of me".

pixiv itself has no "download originals" action. Right-click "Save image" saves only the displayed page at the displayed size, and fails on `i.pximg.net` whenever the Referer is dropped.

**Value proposition:** one button on the artwork page that saves the whole artwork into a tidy folder, plus a three-setting options page. Against Powerful Pixiv Downloader, the product competes on simplicity.

## 3. Scope

### In v1
- One artwork at a time, started from that artwork's page: illustrations (`illustType` 0), manga (1), ugoira (2).
- A Download button injected into the artwork's action row (CUJ-1, CUJ-2, CUJ-5).
- The toolbar icon opens settings in a full tab (CUJ-3). The toolbar badge shows the total number of files remaining (CUJ-4).
- An options page with exactly three settings: download folder pattern, ugoira output, save `metadata.json`.
- In-browser ugoira encoding: WebCodecs to MP4/H.264, with WebM as the fallback.
- Four locales: `en`, `ja`, `zh_CN`, `zh_TW`. UI language follows Chrome's UI language. There is no language selector.

### Not in v1
- Batch or listing-page downloads (artist pages, rankings, search, bookmarks, series).
- Download history, "already downloaded" markers, skip-if-exists.
- Saving outside Chrome's Downloads folder (no File System Access API folder picker).
- Novels and novel series.
- Hiding or replacing Chrome's own download bubble.
- Onboarding, a welcome page, or a popup of any kind.
- Mobile Chrome and other browsers.

## 4. Design decisions & constraints

### 4.1 Product decisions (settled in discovery; reopen only with the owner)

1. **No persisted download history.** Users may download the same artwork as often as they like. Chrome's conflict handling renames duplicates (`" (1)"` suffix). Button state lives only in per-tab memory keyed by artwork ID and is cleared on any full page load (see 4.7.6).
2. **Output goes through the Chrome downloads API.** All paths are relative to Chrome's Downloads folder. The only output setting the user controls is a subfolder pattern (4.4).
3. **Chrome's download bubble is left alone.** It lists every file as it normally would.
4. **Ugoira is encoded in the browser with WebCodecs.** The output is MP4 (H.264) with pixiv's per-frame delays preserved. If H.264 can't be encoded, that download falls back to WebM. The frame zip (`<id>_ugoira.zip`) and `frames.json` are always saved. There is no extracted-frames folder (the script's `<id>_frames/` directory is dropped). ffmpeg.wasm was evaluated and rejected: about a 24 MB payload, and slower.
5. **Concurrency.** Each artwork has at most 5 files handed to Chrome at once, matching the script's default `-j 5`. Artworks are not serialized against each other, so several can run at the same time.
6. **Tab-independent jobs.** Closing the tab or navigating away never cancels a running download. Orchestration lives in the background service worker, and encoding runs in an offscreen document. Neither depends on the tab. If the user quits Chrome entirely, files already in Chrome's downloader behave like any Chrome download, and files not yet handed to Chrome are lost. v1 keeps no queue state across a Chrome restart, and this is accepted.
7. **The retry policy comes from the script** (4.5.2).
8. **Settings snapshot.** Each job copies the settings at the moment the user clicks. Settings changes apply to the next download, never to one already running.

### 4.2 Verified technical facts (probed live, no session cookie)

- Originals at `i.pximg.net` return 200 with `Referer: https://www.pixiv.net/` and 403 without. All-ages works need no cookie.
- `GET https://www.pixiv.net/ajax/illust/{id}` works logged out for every work. It returns `pageCount`, `illustType` (0 illustration, 1 manga, 2 ugoira), `xRestrict` (0 all ages, 1 R-18, 2 R-18G), `userName`, and `userId`.
- `GET /ajax/illust/{id}/pages` is refused when logged out if `xRestrict ≥ 1`.
- `GET /ajax/illust/{id}/ugoira_meta` returns `originalSrc` (the original-size frame zip) and `frames` (`[{file, delay}]`, delay in ms).
- pixiv's page HTML embeds `"isLoggedIn":false` or `"isLoggedIn":true`.
- pixiv is a single-page app. Moving between artworks does not reload the document.
- WebCodecs is not available in service workers, so encoding needs an offscreen document.
- Chrome's downloads API cannot set `Referer`, because it is on the forbidden-header list shared with fetch/XHR. The Referer requirement must be met some other way, for example a `declarativeNetRequest` header rule limited to the extension's own requests to `i.pximg.net`. The mechanism is engineering's choice. The requirement is that every original returns 200.

### 4.3 Output layout

Everything lands in `<Chrome Downloads folder>/<resolved folder pattern>/`.

| File | Present when | File name | Content |
|---|---|---|---|
| Original pages | illustType 0 or 1 | Basename of each original URL, e.g. `135882741_p0.jpg`, `135882741_p1.png` | Bytes exactly as served by `i.pximg.net`, never re-encoded |
| `metadata.json` | "Save metadata.json" is on (default) | `metadata.json` | Schema below |
| Frame zip | illustType 2 | `<id>_ugoira.zip` | Bytes of `ugoira_meta.body.originalSrc`, unmodified |
| `frames.json` | illustType 2 (always, regardless of settings) | `frames.json` | pixiv's `ugoira_meta.body.frames` array, unmodified, 2-space indentation |
| Video | illustType 2, Ugoira output = MP4 or WebM | `<id>.mp4` or `<id>.webm` | Section 4.6 |

**Name conflicts.** Every file uses Chrome's `uniquify` conflict action, so Chrome inserts `" (1)"`, `" (2)"`, … before the extension, e.g. `135882741_p0 (1).jpg` or `metadata (1).json`. The folder is never renamed. Duplicates land next to the earlier files in the same folder.

**`metadata.json` schema.** UTF-8, 2-space indentation, non-ASCII characters written literally (not `\u`-escaped). Exactly these 12 keys, in this order, which matches `write_metadata` in `ref/pixiv-dl`:

| Key | Source (`/ajax/illust/{id}` → `body`) | Type | Example |
|---|---|---|---|
| `id` | `illustId`, else `id` | string | `"135882741"` |
| `title` | `illustTitle` | string | `"雨上がりの渋谷"` |
| `description` | `description` as plain text: `<br>`, `<br/>`, `<br />`, `</p>`, `</div>` (case-insensitive) become `\n`; all other tags are removed; HTML entities are unescaped; leading and trailing whitespace is trimmed | string | `"久しぶりに渋谷で雨。…\nSketches from a rainy walk home through Shibuya."` |
| `userName` | `userName` | string | `"みずき"` |
| `userId` | `userId` | string | `"40285173"` |
| `createDate` | `createDate`, verbatim | string | `"2026-09-28T21:14:00+09:00"` |
| `uploadDate` | `uploadDate`, verbatim | string | `"2026-09-28T21:14:00+09:00"` |
| `pageCount` | `pageCount` | number | `12` |
| `illustType` | `illustType` | number | `1` |
| `xRestrict` | `xRestrict` | number | `0` |
| `tags` | `tags.tags[].tag`, in pixiv's order | string[] | `["オリジナル","風景","渋谷","雨","女の子","漫画"]` |
| `url` | constructed | string | `"https://www.pixiv.net/artworks/135882741"` |

A field missing from pixiv's response is written as `null`. Missing tags are written as `[]`.

### 4.4 Folder pattern & sanitization

**Default pattern:** `pixiv/{artist}-{id}`

| Token | Value | Example |
|---|---|---|
| `{artist}` | Artist display name (`userName`) | `みずき` |
| `{id}` | Artwork ID | `135882741` |
| `{title}` | Artwork title (`illustTitle`) | `雨上がりの渋谷` |
| `{userId}` | Artist's numeric pixiv account ID. Stable when the artist renames. | `40285173` |

Tokens are case-sensitive. `{ID}` is an unknown token.

**Resolution at job start**, using the settings snapshot:
1. Each token is replaced by its sanitized value. Each token value is sanitized on its own, following `safe_component` in `ref/pixiv-dl`:
   1. Unicode NFC normalization.
   2. Remove control characters U+0000–U+001F and U+007F, plus `/`, `:` and `\`.
   3. Replace every run of whitespace with a single `_`.
   4. Trim leading and trailing `.`, `_` and space.
   5. Truncate to at most **60 UTF-8 bytes** without splitting a character, then trim `._ ` again. (60 bytes is 20 kanji or kana.)
   6. If the result is empty, use `unknown`.
2. **Extension-only addition to the script's rules:** also remove `* ? " < > |` from token values. Chrome's downloads API rejects a path segment that contains any of them, on every platform. The script ran only on macOS and never hit this. (assumption — confirm)
3. Literal text in the pattern is used as typed. It is validated when the user enters it (CUJ-3). Empty segments (`a//b`) and a trailing `/` are dropped silently.

Examples:
- `pixiv/{artist}-{id}` with artist `みずき` and id `135882741` → `pixiv/みずき-135882741`
- An artist named `  Sora / 空 :: 2nd  ` → `{artist}` resolves to `Sora_空_2nd`
- An artist named `...` → `{artist}` resolves to `unknown`
- A pattern with no tokens, e.g. `pixiv`, is valid. Every artwork then lands in the same folder, and Chrome uniquifies collisions (`metadata (1).json`).

### 4.5 Download pipeline

#### 4.5.1 Job steps
A **job** is one click on one artwork in one tab. It runs in the background service worker, plus the offscreen document for encoding.
1. Snapshot the settings.
2. Fetch `/ajax/illust/{id}` using the user's pixiv session.
3. For illustType 0/1, fetch `/ajax/illust/{id}/pages` and collect `urls.original` per page, in page order. For illustType 2, fetch `/ajax/illust/{id}/ugoira_meta`.
4. Resolve the folder (4.4).
5. If metadata is enabled, write `metadata.json` first. It is built in the browser and needs no network.
6. Hand files to Chrome in page order (`_p0`, `_p1`, …). At most 5 of this artwork's files are in Chrome's downloader at once. The next queued file starts as soon as one completes. Every file is requested with `conflictAction: "uniquify"` and with no Save As prompt.
7. Report progress to the tab that started the job (if it is still open) and update the toolbar badge (4.8).

#### 4.5.2 Retry policy (from `ref/pixiv-dl`)
This applies to every request: API calls, originals, and the frame zip.

| Aspect | Rule |
|---|---|
| Attempts | At most **4 per request** (1 initial + 3 retries) |
| Retried | HTTP 429, 500, 502, 503, 504; network errors; no response within 30 s |
| Not retried | HTTP 403, which means the session or Referer was rejected, not a transient fault. Other 4xx codes are not retried either. |
| Wait before retry *n* (n = 0, 1, 2) | 1.5 × 2ⁿ s + random 0–0.5 s, i.e. about 1.5 s, 3 s, 6 s |
| `Retry-After` | If the failed response has `Retry-After` (seconds), wait `min(Retry-After, 30)` s instead of the backoff. If the download mechanism engineering chooses cannot see the header, the backoff alone applies. (assumption — confirm) |

A file that still fails after 4 attempts counts as **failed** (CUJ-5).

### 4.6 Ugoira encoding

- **Where:** in the offscreen document, independent of any tab.
- **Order:** `metadata.json` (if enabled) → fetch the frame zip (progress by bytes) → save `<id>_ugoira.zip` and `frames.json` → decode and encode each frame → save the video.
- **Codecs:** MP4 is H.264 (AVC) in an MP4 container. WebM is VP9 in a WebM container. (assumption — confirm VP9 over VP8)
- **Codec availability:** when the button is first rendered on an ugoira page, the extension asks WebCodecs whether H.264 can be encoded at this work's dimensions. The answer is cached for the browser session. If H.264 can't be encoded and the setting is MP4, this download uses WebM, and the button hint, the Saved label, and the file extension all say WebM. If neither H.264 nor VP9 can be encoded, the job behaves as ZIP only and the hint says ZIP. (assumption — confirm)
- **Timing:** frame *i* is shown at timestamp Σ(delay₀ … delayᵢ₋₁) ms and lasts delayᵢ ms. Total duration equals the sum of all delays. No frame is dropped, duplicated, or re-timed. Mixed delays (e.g. 40, 40, 500, 40) are kept exactly at millisecond precision. This matches the script's variable-frame-rate ffmpeg concat.
- **Dimensions:** the frame width and height, each rounded down to an even number (601×451 → 600×450). This matches the script's `scale=trunc(iw/2)*2:trunc(ih/2)*2`.
- **Quality target:** no visible blocking or banding at 100% zoom compared with the source frames. The reference is the script's libx264 `-crf 18` output.
- **Memory:** frames are decoded and encoded one at a time. Peak memory is the zip bytes plus one decoded frame plus encoder buffers, never all frames at once.
- **Playback compatibility:** the MP4 plays in Chrome, VLC, QuickTime Player (macOS), and Windows Media Player / Photos (Windows). The WebM plays in Chrome and VLC.
- **No partial videos:** a cancelled or failed encode writes no video file.

### 4.7 The Download button (shared by CUJ-1, 2, 4, 5)

#### 4.7.1 Placement
- Inserted into pixiv's artwork action row, inside the right-aligned group, **immediately before pixiv's like button**, with the row's own gap between controls (12 px in the mocks).
- Appears within **500 ms** of pixiv rendering the action row. If the artwork metadata has not arrived by then, the button appears in the idle state with no hint (`Download`). The hint, or the needs-login state, is applied when the metadata arrives. The width does not change. (assumption — confirm)
- There is exactly one button per page at any time. If pixiv re-renders the action row (SPA navigation, React re-render), the button is re-inserted within 500 ms and keeps its state. It is never duplicated.
- **Redesign fallback (CUJ-5):** if the action row can't be found within 3 s of the artwork page rendering, the button floats at the bottom-right of the artwork area.
- Appears only on artwork pages: `https://www.pixiv.net/artworks/<id>` and locale-prefixed variants such as `https://www.pixiv.net/en/artworks/<id>`. No button on any other pixiv page.

#### 4.7.2 Geometry & typography (all states)
- Height 40 px, fully rounded pill, horizontal padding 12 px, 8 px gap between icon and text, `white-space: nowrap`, does not shrink.
- Icon 18 × 18 px.
- Label: 14 px semibold, system font stack. Hint (the part after `·`): 13 px regular at 85% opacity. The `·` separator is at 60% opacity. Counters and percentages use `font-variant-numeric: tabular-nums`.
- **Fixed width:** within the active locale, the width equals the widest label the button can show for this artwork (every state, using the artwork's real page count). In English this is **164 px** for works up to 99 pages. The width is locked when the button first renders and never changes between states, so the action row never shifts. Works with 100+ pages (pixiv allows up to 200) may get a wider button. If the page count is unknown at first render, the button starts at the 2-digit width and may widen once, when the metadata arrives and before any interaction. (assumption — confirm) Translations should keep every label within the idle label's width wherever possible.
- Background transitions take 120 ms. The progress ring moves over 300 ms ease.

#### 4.7.3 State table

| State | Fill / border / text | Icon | Label | Hover | Tooltip (`title`) | Click |
|---|---|---|---|---|---|---|
| **Idle** (illust/manga) | Fill `#0096FA`, no border, white text, shadow `0 1px 2px rgba(0,0,0,.08)` | Down arrow onto a baseline | `Download · 12P` (multi-page), `Download` (single page) | Fill `#0084DC` | none | Start job |
| **Idle** (ugoira) | as above | Down arrow | `Download · MP4` / `Download · WebM` / `Download · ZIP` (the effective output, 4.6) | Fill `#0084DC` | none | Start job |
| **Busy** (illust/manga) | as Idle | Progress ring: white arc on a `rgba(255,255,255,.2)` track, r = 8, stroke 2.5, round caps, starting at 12 o'clock and running clockwise | `7 / 12` (pages completed / total pages; `metadata.json` never counts) | **Cancel face:** fill `#3c4043`, X icon, label `Cancel` | `Cancel download` | Cancel job |
| **Busy** (ugoira) | as Idle | Progress ring | `58%` (whole job, 4.7.5) | Cancel face as above | `Cancel download` | Cancel job |
| **Saved** | Fill white, 1.5 px `#0096FA` border, `#0096FA` text, no shadow | Checkmark | `Saved · 12P` / `Saved` (single page) / `Saved · MP4` / `Saved · WebM` / `Saved · ZIP` | Fill `#e6f4fe`; label unchanged | `Saved to Downloads/<resolved folder>`, e.g. `Saved to Downloads/pixiv/みずき-135882741` | Run the whole job again |
| **Needs login** | Fill white, 1.5 px `#c4c7c5` border, `#3c4043` text, no shadow | none | `Log in to download` | Fill `#f5f7f9`, border `#8a8f94` | `Opens pixiv login and returns you here` | Go to pixiv login (CUJ-5) |
| **Error** | Fill white, 1.5 px `#d93025` border, `#d93025` text (hint at full opacity), no shadow | Warning triangle | `Retry · 3 failed`, `Retry`, `Retry · MP4`, `Retry · WebM` (CUJ-5) | Fill `#fdeceb` | Cause-specific (CUJ-5) | Retry (CUJ-5) |
| **Unavailable** | Fill `#f1f3f4`, no border, `#80868b` text, no shadow (assumption — confirm; not mocked) | none | `Unavailable` | No change; cursor `not-allowed` | `This work is no longer available.` | Nothing (`aria-disabled="true"`; still focusable so the tooltip and label can be reached) |

The busy tooltip is `Cancel download` in every busy state. `cuj-2-encoding.html` shows `Cancel`, and this PRD's string takes precedence. (assumption — confirm)

#### 4.7.4 Focus, theme, motion
- Focus ring: 2 px solid `#0096FA`, 3 px offset, shown on `:focus-visible` only.
- **pixiv dark theme:** every state looks identical (pixiv keeps its primary blue in dark mode). Only the focus ring changes, to `#5fb9fb`. The theme is detected from pixiv's own theme marker on the page, not from the OS setting.
- `prefers-reduced-motion: reduce`: the ring jumps to each new value with no transition, and the background change is instant.

#### 4.7.5 Progress semantics
- **Illust/manga:** the counter shows `<completed pages> / <total pages>`. It starts at `0 / <total>` within 100 ms of the click and goes up by one each time Chrome reports an original as complete. The ring fraction equals completed ÷ total.
- **Ugoira:** a single integer percentage covering the whole job. It starts at `0%`. The frame-zip fetch maps to 0–40% by bytes received, and the encode maps to 40–100% by frames encoded. (assumption — confirm the 40/60 split) With **ZIP only**, the zip fetch maps to 0–100%. The percentage is rounded down, never decreases, and never shows `100%` before the last file has landed. If the zip size is unknown (no Content-Length), the label holds at `0%` and the ring shows a 25% arc that rotates once per second until the encode phase starts. Under reduced motion the arc stays still.
- The busy state's Cancel face is suppressed until the pointer has left the button once after the starting click, so the user sees progress rather than "Cancel" right after clicking. Clicks within 500 ms of the starting click are ignored, which guards against double-clicks. (assumption — confirm)

#### 4.7.6 Per-tab state memory
- The content script keeps a map from artwork ID to state for the life of the document: busy (live), Saved (with the resolved folder), Error (with the failed-page list or the cause), Needs login, Unavailable.
- SPA navigation keeps the map. Leaving an artwork and coming back shows that artwork's remembered state.
- Any full document load clears the map: reload, returning from pixiv login, or opening the artwork in a new tab.
- **Exception, in-flight jobs:** if this tab started a job that is still running in the background when the document reloads, the reloaded button reattaches to that job and shows its live progress. This is not history, because the job is still in flight. A finished or failed job is not remembered after a reload. (assumption — confirm)

#### 4.7.7 Accessibility
- The button is a real `<button type="button">`, reachable with Tab. Enter and Space activate it.
- `aria-label` per state (exact strings in Appendix A), e.g. `Download all 12 original images of this artwork`, `Downloading, 7 of 12 pages saved. Click to cancel.`, `Saved 12 pages to Downloads/pixiv/みずき-135882741. Click to download again.`
- When busy, the button has `aria-busy="true"`. A polite live region announces the start (`Downloading 12 pages`), progress at most once every 5 s, and always the end state (`Saved 12 pages`, `3 pages failed`, `Download cancelled`).
- Contrast: white on `#0096FA` and `#0096FA` on white are about **3.1:1**. That passes WCAG for UI components and large text but falls short of the 4.5:1 AA threshold for 14 px text. This is accepted deliberately for parity with pixiv's own primary buttons, which use the same pair. (assumption — confirm) Every other state passes 4.5:1.

### 4.8 Toolbar icon & badge
- **Click** always opens the settings page in a full tab (CUJ-3), whether or not downloads are running. There is no popup.
- **Badge text:** the number of files still to land across every job in flight. An illustration or manga job counts its image pages not yet complete (`metadata.json` never counts). An ugoira job counts **1** from start to finish: the video, or the zip with ZIP only. (assumption — confirm that the ugoira job counts 1 during its zip-fetch phase too) Counts of 1000 or more show `999+`. With nothing in flight, the badge is hidden (empty text).
- **Badge style:** background `#1f1f1f`, text `#FFFFFF`.
- **Action title (tooltip):**
  - Nothing in flight: `pixiv Downloader — click to open settings`
  - One job: `pixiv Downloader — 5 files remaining` (singular: `pixiv Downloader — 1 file remaining`)
  - Two or more jobs: `pixiv Downloader — 23 files remaining across 2 downloads`
- The badge updates within 1 s of any file completing, any job starting, or any job being cancelled or failing.
- **Service-worker restarts:** in-flight job state (queued files, completed and failed counts, originating tab) survives a service-worker restart (for example in session-scoped extension storage). The badge is recomputed within 1 s of the restart. State does not survive quitting Chrome (4.1 #6).

### 4.9 Settings model
| Setting | Values | Default | Storage |
|---|---|---|---|
| Download folder | pattern string, max 200 characters (assumption — confirm) | `pixiv/{artist}-{id}` | `chrome.storage.sync`; falls back to `chrome.storage.local` if sync is unavailable or over quota |
| Ugoira output | `MP4` / `WebM` / `ZIP only` | `MP4` | same |
| Save `metadata.json` | on / off | on | same |

## 5. CUJ dependency graph

```
CUJ-1  Download an illustration or manga ............ (none)
CUJ-3  Configure the extension ...................... (none)
CUJ-2  Download an ugoira ........................... CUJ-1, CUJ-3
CUJ-4  Follow several downloads from the badge ...... CUJ-1
CUJ-5  Recover when a download can't start/breaks ... CUJ-1, CUJ-2
```

Suggested implementation order: CUJ-1 and CUJ-3 in parallel, then CUJ-2 and CUJ-4, then CUJ-5.

## 6. Critical User Journeys

### CUJ-1: Download an illustration or manga from the artwork page

**Dependencies**: none
**Priority**: P0 (launch blocker)

#### Context
This is the core promise of the product. The user is looking at an illustration or a multi-page manga and wants every page at original size, saved together in one folder with its metadata, without leaving the page and without thinking about where files go. Every other CUJ builds on this button and this pipeline.

#### Preconditions
- The extension is installed and enabled in desktop Chrome.
- The tab shows `https://www.pixiv.net/artworks/<id>` or a locale-prefixed variant (`https://www.pixiv.net/en/artworks/<id>`), reached by direct load or by pixiv's in-app navigation.
- The work's `illustType` is 0 (illustration) or 1 (manga).
- The work is all-ages (`xRestrict` 0), or the user is logged in to pixiv with R-18 display enabled. Otherwise CUJ-5 applies.
- Settings are at their defaults: pattern `pixiv/{artist}-{id}`, metadata on.
- Example data: artwork `135882741`, "雨上がりの渋谷" by みずき (userId `40285173`), 12 pages.

#### Journey Steps

1. **User action**: User opens the artwork page, either directly or by clicking an artwork thumbnail elsewhere on pixiv.
   - **System response**: The content script recognizes the artwork URL, requests `/ajax/illust/135882741`, waits for pixiv's action row, and inserts the Download button immediately before pixiv's like button.
   - **User sees**: Below the artwork image, the action row has pixiv's Share and More icon buttons on the left. On the right is a group (12 px gaps) of the Download pill, then pixiv's Like and Bookmark icon buttons. The pill is 164 × 40 px, filled `#0096FA`, with an 18 px white down-arrow icon, `Download` (14 px semibold white), a `·` at 60% opacity, and `12P` (13 px regular, 85% opacity). See `cuj-1-initial.html`.
   - **Details**: The button appears within 500 ms of the action row rendering. A single-page work shows the icon and `Download` with no hint. Hover darkens the fill to `#0084DC`. There is no tooltip in the idle state. `aria-label` is `Download all 12 original images of this artwork` (single page: `Download the original image of this artwork`).

2. **User action**: User clicks the button once (or focuses it with Tab and presses Enter or Space).
   - **System response**: The tab sends a start request for artwork `135882741` to the background service worker. The worker snapshots the settings, fetches metadata and the page list using the user's pixiv session, and resolves the folder to `pixiv/みずき-135882741`. It writes `metadata.json`, then hands the 12 originals to Chrome in page order, at most 5 at a time, with `uniquify` and the Referer requirement met.
   - **User sees**: Within 100 ms the pill (same width, same blue) swaps its icon for a progress ring at 0 and its label for `0 / 12` in tabular digits. The toolbar icon shows a dark badge `12`. Chrome's own downloads button shows activity, and its bubble lists files as they start (`metadata.json`, `135882741_p0.jpg`, …).
   - **Details**: `aria-busy="true"`, `aria-label` `Downloading, 0 of 12 pages saved. Click to cancel.` The live region announces `Downloading 12 pages`. The Cancel face stays hidden until the pointer has left the button once, and clicks within 500 ms of this click are ignored (4.7.5).

3. **User action**: User waits, or keeps browsing pixiv.
   - **System response**: Each time Chrome reports an original complete, the worker sends progress to the tab, decrements the badge, and hands the next queued original to Chrome.
   - **User sees**: The counter advances (`7 / 12`) and the ring fills clockwise to the matching fraction (58% at 7/12). The toolbar badge shows `5` with the tooltip `pixiv Downloader — 5 files remaining`. See `cuj-1-downloading.html`.
   - **Details**: `metadata.json` counts in neither the counter nor the badge. The counter never goes down. Pages may finish out of order, and the counter only counts completions.

4. **User action**: User hovers the busy button.
   - **System response**: none.
   - **User sees**: The pill turns neutral dark gray `#3c4043` (not red, because nothing is wrong), the ring becomes an 18 px X icon, and the label becomes `Cancel`. Tooltip: `Cancel download`. When the pointer leaves, the progress face returns.
   - **Details**: The width is unchanged. Keyboard focus does not swap faces. The `aria-label` already says "Click to cancel."

5. **User action** (optional): User clicks the busy button to cancel.
   - **System response**: The worker stops handing this artwork's files to Chrome. Any of its files currently downloading in Chrome are cancelled, and Chrome lists them as "Canceled". (assumption — confirm) Files already completed stay on disk. The badge drops by this artwork's remaining count at once and disappears if nothing else is in flight.
   - **User sees**: Within 300 ms the button returns to idle `Download · 12P`. No toast, no message, no error styling, because cancelling is not an error.
   - **Details**: The live region announces `Download cancelled`. The tab's memory for this artwork returns to idle.

6. **User action**: User waits for the last file (no cancel).
   - **System response**: When the 12th original completes, the job ends, the worker notifies the tab, and the badge clears.
   - **User sees**: Within 300 ms the button becomes **Saved**: white fill, 1.5 px `#0096FA` border, `#0096FA` text, checkmark icon, `Saved · 12P` (single page: `Saved`). Hovering gives only a faint `#e6f4fe` tint, and the text never changes. Tooltip: `Saved to Downloads/pixiv/みずき-135882741`. The toolbar badge is gone, and the action title returns to `pixiv Downloader — click to open settings`. On disk, `Downloads/pixiv/みずき-135882741/` holds `metadata.json` and `135882741_p0.jpg` … `135882741_p11.jpg`. See `cuj-1-saved.html`.
   - **Details**: `aria-busy` is removed. `aria-label` is `Saved 12 pages to Downloads/pixiv/みずき-135882741. Click to download again.` The live region announces `Saved 12 pages`. If any page failed after retries, the job ends in CUJ-5's error state instead.

7. **User action**: User follows a link within pixiv to another artwork, then presses Back.
   - **System response**: The content script detects each SPA URL change and renders the button for the artwork now shown, looking up the tab's per-artwork memory.
   - **User sees**: The other artwork shows its own idle button. Back on `135882741`, the button shows `Saved · 12P` again.
   - **Details**: The memory lasts for the life of the document. A reload brings back idle `Download · 12P` (4.7.6).

8. **User action**: User clicks the Saved button.
   - **System response**: The whole job runs again from step 2 with the current settings. Chrome uniquifies every file that already exists.
   - **User sees**: The same busy → Saved sequence. The folder now also holds `135882741_p0 (1).jpg` … and `metadata (1).json`.
   - **Details**: There is no confirmation dialog. Re-downloading is allowed by design (4.1 #1).

#### Edge Cases & Error States
- **200-page manga** (pixiv's maximum): the counter runs `0 / 200` … `200 / 200`. At most 5 files are in Chrome's downloader at any moment, and the badge starts at `200`. Cancel exists for this case: one click stops the remaining files. The button may be wider than 164 px on this artwork (4.7.2), but it never changes width between states.
- **Long or punctuation-heavy artist names**: each token value is sanitized and capped at 60 UTF-8 bytes (4.4). `  Sora / 空 :: 2nd  ` produces the folder `pixiv/Sora_空_2nd-135882741`. A name that sanitizes to nothing becomes `unknown` (`pixiv/unknown-135882741`). The folder never gets an empty segment.
- **Tab closed mid-download**: the job continues in the background, the remaining files land, and the badge keeps counting down to empty. No UI is left to show Saved, which is expected.
- **SPA navigation mid-download**: the job for `135882741` continues. The new artwork's button appears idle. Coming back to `135882741` shows its live progress (e.g. `9 / 12`).
- **Reload mid-download**: the job continues. The reloaded button reattaches to the running job and shows its progress (4.7.6). After the job ends, a further reload shows idle.
- **Chrome quit mid-download**: files already in Chrome's downloader behave like any Chrome download (Chrome may offer to resume them). Files not yet handed to Chrome are lost, and nothing resumes them on the next launch. This is accepted for v1.
- **Same artwork clicked in two tabs**: two independent jobs run, the badge counts both, and the second run's files get `" (1)"` suffixes. Each tab's button shows only its own job.
- **Chrome's "Ask where to save each file before downloading" is on**: the extension requests no prompt for every file. If Chrome still shows a Save dialog per file, that is Chrome honoring the user's own setting. A file whose dialog is dismissed counts as failed and is not retried automatically. (assumption — confirm by testing; known v1 limitation)
- **Network drops mid-job**: each affected file follows the retry policy (4.5.2). If some files still fail, the job ends in CUJ-5's `Retry · N failed`.
- **Pattern changed in settings mid-job**: the running job keeps its snapshot folder. The next click uses the new pattern.
- **pixiv re-renders the action row**: the button is re-inserted within 500 ms with the same state, never duplicated.
- **Keyboard and screen reader**: Tab reaches the button in DOM order (after pixiv's Share/More, before Like). Enter and Space start, cancel, or re-download. The focus ring is 2 px `#0096FA` with a 3 px offset. Progress is announced at most every 5 s.
- **pixiv dark theme**: the button is identical in every state, and only the focus ring becomes `#5fb9fb`. See `cuj-1-dark.html`.
- **Non-artwork pixiv pages** (home, search, user profile, bookmarks, novels): no button is injected.

#### Mocks / Reference Designs

Mocks for this CUJ:
- `docs/ux/prd-000-mvp-mockups/cuj-1-initial.html`: idle button `Download · 12P` in the action row, no badge
- `docs/ux/prd-000-mvp-mockups/cuj-1-downloading.html`: busy `7 / 12` with hover-to-Cancel, toolbar badge `5`, Chrome's downloads button active
- `docs/ux/prd-000-mvp-mockups/cuj-1-saved.html`: Saved state `Saved · 12P` with the folder tooltip, badge gone
- `docs/ux/prd-000-mvp-mockups/cuj-1-dark.html`: idle button on pixiv's dark theme, lighter focus ring

#### Acceptance Criteria
- On an illustType 0/1 artwork page, exactly one Download button appears in the action row, immediately left of pixiv's like button, within 500 ms of the row rendering.
- The idle label reads `Download · 12P` on the 12-page example and `Download` on a single-page work.
- In English, the button is 164 px wide in idle, busy, Cancel-hover, and Saved states on a work of 99 or fewer pages. Its width does not change across any transition.
- After one click on the example, `Downloads/pixiv/みずき-135882741/` contains `metadata.json` and exactly 12 originals named `135882741_p0` … `135882741_p11` with their original extensions. Each file's byte size equals the `Content-Length` served by `i.pximg.net` for that page.
- `metadata.json` contains exactly the 12 keys of 4.3 in order. Non-ASCII text is written literally, and line breaks from pixiv's description are kept as `\n`.
- At no moment does `chrome://downloads` show more than 5 of this artwork's files in progress at once.
- During the job the label reads `N / 12` with N rising as files complete. It reaches `12 / 12` only after every original has completed, and `metadata.json` never changes N.
- Hovering the busy button (after the pointer has left it once) shows `Cancel` on `#3c4043`. Clicking it stops the job: no further files of this artwork start in `chrome://downloads`, completed files remain on disk, and the button returns to `Download · 12P` with no error styling.
- On completion the button shows `Saved · 12P` (white fill, blue 1.5 px border, checkmark), and the tooltip reads `Saved to Downloads/pixiv/みずき-135882741`.
- Navigating within pixiv to another artwork and back still shows `Saved · 12P`. After a reload with no job running, the button shows `Download · 12P`.
- Clicking `Saved · 12P` downloads all files again, and the duplicates appear as `135882741_p0 (1).jpg` … and `metadata (1).json` in the same folder.
- Closing the tab mid-download does not stop the job: every remaining file still completes in `chrome://downloads` and on disk.
- The toolbar badge shows the number of pages not yet complete during the job and disappears when it ends.
- The button is reachable with Tab and activates with Enter and Space. It shows a 2 px `#0096FA` focus ring (`#5fb9fb` on pixiv's dark theme) and carries `aria-busy="true"` while busy.
- On pixiv's dark theme the button's fill, text, and icon are identical to the light theme.
- Changing the folder pattern while a job runs does not change where that job's remaining files land.

---

### CUJ-2: Download an ugoira

**Dependencies**: CUJ-1, CUJ-3
**Priority**: P0 (launch blocker)

#### Context
Ugoira is pixiv's animated format: a zip of still frames plus a per-frame delay list, played by pixiv's own player. Outside pixiv the zip is useless to most people. The archivist wants the original frames (lossless provenance) and a video that plays anywhere with the original timing. The script needed a local ffmpeg for this. Here it happens in the browser, from the same button.

#### Preconditions
- Everything in CUJ-1's preconditions, except the work's `illustType` is 2. pixiv shows its play overlay and an "Ugoira" label on the artwork.
- Ugoira output is set to MP4 (default), WebM, or ZIP only (CUJ-3).
- Example data: artwork `136004512`, "ゆれる前髪" by ひなた, 600 × 600, 48 frames, about 4.8 s loop.

#### Journey Steps

1. **User action**: User opens the ugoira's artwork page.
   - **System response**: The content script fetches metadata, sees `illustType` 2, asks the extension which output is effective (setting plus the H.264 availability check, 4.6), and inserts the button.
   - **User sees**: The same 164 × 40 px blue pill in the same place, labelled `Download · MP4` (or `Download · WebM`, or `Download · ZIP` for ZIP only). See `cuj-2-initial.html`.
   - **Details**: `aria-label` is `Download this ugoira as MP4, with its frame zip and metadata`. With metadata off: `Download this ugoira as MP4, with its frame zip`. With ZIP only: `Download this ugoira's frame zip`. While the button is idle, the hint updates within 1 s if the user changes Ugoira output in settings in another tab.

2. **User action**: User clicks the button.
   - **System response**: The worker snapshots the settings, writes `metadata.json` (if enabled), and fetches `ugoira_meta` and then the original frame zip, reporting byte progress.
   - **User sees**: The pill shows the progress ring and `0%`, rising through 0–40% as the zip downloads. The toolbar badge shows `1` with the tooltip `pixiv Downloader — 1 file remaining`.
   - **Details**: `aria-label` is `Downloading frames, 23 percent. Click to cancel.` (with the live value). The Cancel face and double-click guard behave exactly as in CUJ-1 (4.7.5).

3. **User action**: User waits.
   - **System response**: The zip lands as `136004512_ugoira.zip`, and `frames.json` is written. The offscreen document decodes each frame in order and encodes it with its exact delay. The percentage moves from 40% to 100% as frames are encoded.
   - **User sees**: The ring and percentage keep moving, for example `58%`. The toolbar badge stays at `1`, because the video is the one remaining file. Chrome's own downloads button is idle, because nothing of Chrome's is in flight during the encode. See `cuj-2-encoding.html`.
   - **Details**: `aria-label` is `Encoding MP4, 58 percent. Click to cancel.` The percentage updates at least once per second while frames are being encoded.

4. **User action**: User hovers the busy button, and optionally clicks to cancel.
   - **System response**: On cancel during the zip fetch, the fetch is aborted, and only `metadata.json` (if already written) remains. On cancel during the encode, encoding stops, no video file is written, and the zip and `frames.json` stay.
   - **User sees**: The hover shows `Cancel` on `#3c4043` with the tooltip `Cancel download`. After cancelling, the button returns to `Download · MP4` within 300 ms. The badge drops by 1.
   - **Details**: Same as CUJ-1 step 5.

5. **User action**: User waits for the end.
   - **System response**: The video is written as `136004512.mp4` and the job ends.
   - **User sees**: The button shows `Saved · MP4` in the Saved style. Tooltip: `Saved to Downloads/pixiv/ひなた-136004512`. The badge is gone. The folder holds `metadata.json`, `136004512_ugoira.zip`, `frames.json` and `136004512.mp4`.
   - **Details**: `aria-label` is `Saved MP4 to Downloads/pixiv/ひなた-136004512. Click to download again.` The video is 600 × 600, lasts the sum of all frame delays, and plays in Chrome, VLC, QuickTime Player, and Windows Media Player / Photos (4.6).

6. **Variant: ZIP only.**
   - **System response**: There is no encode step. The job ends once the zip and `frames.json` have landed.
   - **User sees**: `0%` → `100%` by zip bytes, then `Saved · ZIP`.

7. **Variant: H.264 not encodable in this browser** (setting is MP4).
   - **System response**: This download encodes VP9 WebM instead (4.6).
   - **User sees**: The idle hint says `Download · WebM` from the start, the busy `aria-label` says "Encoding WebM", the result is `Saved · WebM`, and the file is `136004512.webm`.

#### Edge Cases & Error States
- **Very long ugoira** (hundreds of frames, 1920 × 1080): the encode may take tens of seconds. The ring and percentage keep moving at least once per second, and the job survives the tab closing (the offscreen document is tab-independent).
- **Mixed delays** (e.g. 40, 40, 500, 40 ms): every frame keeps its exact delay. The video's duration equals the sum of delays, and no frame is dropped or duplicated.
- **Odd dimensions** (601 × 451): the video is 600 × 450.
- **Memory**: frames are decoded and encoded one at a time, so a 300-frame 1080p ugoira does not hold 300 decoded frames in memory.
- **`ugoira_meta` returns an error, or the zip fails after retries**: the job ends in CUJ-5's reactive error state (`Retry` with the cause tooltip). Nothing partial is written beyond `metadata.json`.
- **Zip landed but the encode failed** (encoder error, corrupt frame): the zip and `frames.json` stay, no video is written, and the button shows `Retry · MP4` (CUJ-5).
- **Tab closed mid-encode**: nothing changes. The video still lands, and the badge clears when it does.
- **Settings changed mid-job** (e.g. MP4 → ZIP only): the running job keeps MP4. The next click uses the new setting.
- **Logged out on an R-18 ugoira**: the needs-login state (CUJ-5) replaces the idle state.

#### Mocks / Reference Designs

Mocks for this CUJ:
- `docs/ux/prd-000-mvp-mockups/cuj-2-initial.html`: idle on an ugoira page, `Download · MP4`
- `docs/ux/prd-000-mvp-mockups/cuj-2-encoding.html`: busy `58%` during the encode, toolbar badge `1`, Chrome's downloads button idle

#### Acceptance Criteria
- On an illustType 2 page the idle label reads `Download · MP4`, `Download · WebM`, or `Download · ZIP`, matching the Ugoira output setting (or `WebM` when H.264 can't be encoded).
- While busy, the label is an integer percentage that never decreases, never shows `100%` before the last file lands, and updates at least once per second during the encode.
- The toolbar badge shows `1` for the whole ugoira job and disappears when it ends.
- After completion with MP4, the folder contains exactly `136004512_ugoira.zip`, `frames.json`, `136004512.mp4`, and `metadata.json` (when enabled). No extracted-frames folder exists.
- `136004512_ugoira.zip` is byte-identical to `ugoira_meta.body.originalSrc`. `frames.json` equals `ugoira_meta.body.frames` (file name and delay per frame).
- The MP4's duration equals the sum of all frame delays within ±1 ms per frame. Stepping frame by frame (e.g. in VLC or `ffprobe -show_frames`) shows the same number of frames as `frames.json`, each lasting its listed delay.
- The video's width and height equal the frames' dimensions rounded down to even numbers.
- The MP4 plays in Chrome, VLC, and QuickTime Player.
- With ZIP only, the job writes the zip and `frames.json` (plus `metadata.json` if enabled), writes no video, and ends with `Saved · ZIP`.
- Cancelling during the encode leaves no `.mp4` or `.webm` file, while the zip and `frames.json` remain.
- Closing the tab during the encode still produces the video file.
- When H.264 encoding is unsupported, the hint, the Saved label, and the file extension all say WebM.

---

### CUJ-3: Configure the extension from the toolbar icon

**Dependencies**: none
**Priority**: P0 (launch blocker)

#### Context
The product's positioning is "three settings, not thirty". Users come here once, usually to change the folder layout (e.g. one folder per artist) or the ugoira format, and leave. The page must be obvious without documentation, must never lose a change, and must never let an invalid pattern break downloads.

#### Preconditions
- The extension is installed. Any tab can be active, on pixiv or not, with downloads running or not.
- Example: first visit, settings at their defaults.

#### Journey Steps

1. **User action**: User clicks the pixiv Downloader icon in Chrome's toolbar.
   - **System response**: Chrome opens the extension's options page as a **full tab** to the right of the current tab and focuses it. If a settings tab is already open, that tab and its window are focused instead. No popup ever opens.
   - **User sees**: A tab titled `pixiv Downloader — Settings`. The page background is `#f6f7f9` (dark: `#121212`), with a centered 640 px column, 56 px top padding and 24 px side padding. The header has a 48 × 48 px rounded blue square with the download glyph, `pixiv Downloader` (22 px bold), and `Settings` (14 px, `#5c6166`) below it. Then three sections, 48 px apart, in this order: **Download folder**, **Ugoira output**, **Save metadata.json**, followed by the footer. See `cuj-3-initial.html`.
   - **Details**: Each section heading is 16 px semibold, and its help text is 14 px `#5c6166` (dark: `#9aa0a6`). The page follows the system light/dark preference via `prefers-color-scheme`. All strings appear in Chrome's UI language (en, ja, zh_CN, or zh_TW, falling back to en).

2. **User action**: User reads the Download folder section.
   - **System response**: none.
   - **User sees**:
     - Help: `Inside your Downloads folder. Use tokens to name folders after the artwork.`
     - A full-width text field 44 px tall, 8 px radius, 1 px `#d0d5db` border, monospace 14 px, prefilled `pixiv/{artist}-{id}`, `aria-label` `Folder pattern`, spellcheck off.
     - A row: `Insert:` (12.5 px gray), then four monospace chips (28 px tall pills, 1 px `#d0d5db` border): `{artist}`, `{id}`, `{title}`, `{userId}`, with the tooltips `Artist display name, as shown on pixiv`, `Artwork ID, the number in the page URL`, `Artwork title, shortened to stay a safe folder name`, `Artist's numeric pixiv account ID; stable if the artist renames`.
     - A preview line (13 px) with a folder icon: `Preview:` followed by `Downloads/pixiv/みずき-135882741/135882741_p0.jpg` in monospace.
   - **Details**: The preview always uses the fixed sample artwork (artist `みずき`, id `135882741`, title `雨上がりの渋谷`, userId `40285173`, first page `135882741_p0.jpg`) run through the real resolution rules (4.4). The word `Downloads` is generic on purpose, because Chrome's actual download directory can't be known. Chip hover: border and text `#0096FA`, fill `#f0f8ff`.

3. **User action**: User edits the pattern, e.g. clears it and types `pixiv/{artist}/{title}`.
   - **System response**: Validation runs about 400 ms after the last keystroke. If valid, the pattern is saved immediately.
   - **User sees**: The preview updates to `Downloads/pixiv/みずき/雨上がりの渋谷/135882741_p0.jpg`. A green (`#1a9f5a`) check icon and `Saved` (12.5 px) appear at the right end of the **Download folder** heading row. They stay for 2 s, then fade out over 300 ms.
   - **Details**: Saving happens per valid change, with no Save button and no toast. `Saved` sits in a polite live region. Under reduced motion it disappears without the fade.

4. **User action**: User places the caret in the field and clicks the `{id}` chip.
   - **System response**: `{id}` is inserted at the caret (replacing any selected text). Focus returns to the field with the caret right after the inserted token. Validation and save follow as in step 3.
   - **User sees**: The token appears at the caret, then the preview updates and `Saved` appears.
   - **Details**: If the field has never had focus, the token is appended at the end. Chips are real buttons reachable with Tab, and Enter or Space inserts.

5. **User action**: User mistypes a token: `pixiv/{artst}-{id}`.
   - **System response**: Validation fails, nothing is saved, and the last valid pattern stays in effect for downloads.
   - **User sees**: The field gets a 2 px `#d93025` border. Below it, a red 13 px line with an info icon reads `Unknown token {artst}. Available tokens: {artist}, {id}, {title}, {userId}.` The preview line is replaced by `Still using: pixiv/{artist}-{id} — your last valid pattern stays in effect until this one is fixed.` (the pattern in monospace). No `Saved` appears. See `cuj-3-error.html`.
   - **Details**: The field gets `aria-invalid="true"` and `aria-describedby` pointing to the message, which has `role="alert"`. Only the first applicable message is shown, checked in this order:
     1. Empty after trimming whitespace → `Enter a folder pattern.`
     2. Starts with `/` or is an absolute path (e.g. `C:`, `~/`) → `Must be a relative path inside Downloads.`
     3. Contains `\` → `Use "/" between folders.`
     4. Contains a `..` segment → `Can't contain "..".`
     5. A `{…}` that is not one of the four tokens → `Unknown token {artst}. Available tokens: {artist}, {id}, {title}, {userId}.` (naming the first unknown token)
     6. Literal text contains `: * ? " < > |` → `Can't contain : * ? " < > |.` (assumption — confirm; this rule and its copy are not in the mocks)

     Stray `{` or `}` with no matching pair are literal characters.

6. **User action**: User fixes the typo.
   - **System response**: About 400 ms after typing stops, validation passes and the pattern is saved.
   - **User sees**: The red border and message disappear, the `Preview:` line returns with the new path, and `Saved` appears beside the heading for 2 s.

7. **User action**: User clicks `WebM` in Ugoira output.
   - **System response**: Saved immediately (no debounce).
   - **User sees**: Section help: `Encoded in your browser from the original frames. The frame zip and frames.json are always saved.` The three-segment control (36 px tall, 10 px radius, 1 px `#d0d5db` border) shows `WebM` filled `#0096FA` with white semibold text. `MP4` and `ZIP only` are unselected (`#3c4043` text, hover `#f5f7f9`). `Saved` appears at the right of the **Ugoira output** heading for 2 s. See `cuj-3-saved.html`.
   - **Details**: Segments are buttons with `aria-pressed` inside a `role="group"` labelled `Ugoira output format`. Idle buttons on open ugoira pages update their hint within 1 s.

8. **User action**: User turns off the Save metadata.json switch.
   - **System response**: Saved immediately.
   - **User sees**: Heading `Save metadata.json` (with `metadata.json` in monospace) and help `Title, description, tags, dates and artist, saved next to the images.` on the left. On the right is a 44 × 26 px switch: blue `#0096FA` with the knob on the right when on, gray `#bdc1c6` (dark: `#5f6368`) with the knob on the left when off (off colors not mocked). `Saved` appears beside this heading for 2 s.
   - **Details**: `role="switch"`, `aria-checked`, `aria-label` `Save metadata.json`. Space toggles it.

9. **User action**: User clicks `Reset to defaults` in the footer.
   - **System response**: All three settings return to the defaults (`pixiv/{artist}-{id}`, MP4, metadata on) and are saved immediately. There is no confirmation dialog, because three settings are trivial to set again. (assumption — confirm)
   - **User sees**: The field, segmented control, and switch show the defaults. Any validation error clears. `Saved` appears beside each section heading whose value actually changed.

10. **User action**: User reads or uses the footer.
    - **User sees**: A 1 px top border, then 13 px gray text: `Reset to defaults` and `Report an issue` as `#0096FA` links (underlined on hover), the version (`v1.0.0`, read from the manifest) right-aligned, and a full-width line below: `Only talks to pixiv.net and its image host. Nothing you download leaves your browser.`
    - **Details**: `Report an issue` opens the project's issue tracker in a new tab. (assumption — confirm: the exact URL is not yet decided and must exist before Web Store submission.)

#### Edge Cases & Error States
- **Reset or any change while a download runs**: the change is saved and applies to the next download only. The running job keeps its snapshot.
- **`chrome.storage.sync` unavailable or over quota**: the value is saved to `chrome.storage.local` instead, and the user still sees `Saved`. Reads prefer sync and fall back to local.
- **Invalid pattern, then tab closed**: nothing invalid is ever stored. Reopening settings shows the last valid pattern with no error.
- **Pattern whose token values sanitize to empty** (e.g. `{title}` on a work titled `...`): resolution uses `unknown` for that token. The folder never contains an empty segment.
- **Extremely long resulting path** (`{artist}/{title}/{userId}-{id}`): each token is capped at 60 UTF-8 bytes, so the path stays bounded (at most about 4 × 60 bytes plus literal text). The field accepts at most 200 characters, and further typing or pasting beyond that is truncated by the field. (assumption — confirm)
- **Paste containing newlines or control characters**: the single-line field drops newlines on paste. Validation then runs as usual.
- **Two settings tabs open** (e.g. one opened from `chrome://extensions`): a saved change in one tab updates the other within 1 s, unless that tab's field holds an unsaved invalid edit, in which case the edit is left alone.
- **Clicking the toolbar icon during a download**: settings open as usual, and the download continues.
- **Dark system theme**: page `#121212`, text `#e8eaed`, field `#1f1f1f` with border `#3a3f45`, chips `#1f1f1f`/`#3a3f45` (hover fill `#102a3f`), segmented control `#1f1f1f`/`#3a3f45` (hover `#2a2f35`). Selected segment, links, and focus rings stay `#0096FA`.
- **Keyboard**: tab order is field → four chips → MP4 → WebM → ZIP only → switch → Reset to defaults → Report an issue. Every control has a visible 2 px `#0096FA` focus ring.

#### Mocks / Reference Designs

Mocks for this CUJ:
- `docs/ux/prd-000-mvp-mockups/cuj-3-initial.html`: settings tab with defaults, preview line
- `docs/ux/prd-000-mvp-mockups/cuj-3-error.html`: unknown token `{artst}`, red field, message, "Still using" line
- `docs/ux/prd-000-mvp-mockups/cuj-3-saved.html`: WebM selected, green `Saved` beside the Ugoira output heading

#### Acceptance Criteria
- Clicking the toolbar icon opens the settings page in a full tab titled `pixiv Downloader — Settings`. Clicking it again while that tab exists focuses the existing tab and opens no new one.
- No popup ever appears from the toolbar icon.
- With no settings saved, the page shows `pixiv/{artist}-{id}`, `MP4` selected, and the metadata switch on.
- Each of the four chips inserts its token at the caret, and its tooltip matches the copy in step 2 exactly.
- With the default pattern, the preview reads `Preview: Downloads/pixiv/みずき-135882741/135882741_p0.jpg`.
- Typing `pixiv/{artst}-{id}` shows, within about 400 ms of the last keystroke, a 2 px red border, the exact unknown-token message, and the exact "Still using" line. A download started now still uses the last valid pattern.
- Each validation case in step 5 shows its exact message.
- A valid change to any setting is saved without a Save button. Within about 400 ms (pattern) or immediately (other settings), `Saved` with a green check appears beside that section's heading and fades after 2 s.
- Reloading the settings page shows the most recently saved values.
- Changing a setting while a download runs does not change that download's folder, format, or files. The next download uses the new values.
- `Reset to defaults` restores all three defaults immediately.
- The footer shows `Reset to defaults`, `Report an issue`, the version, and `Only talks to pixiv.net and its image host. Nothing you download leaves your browser.`
- With the OS in dark mode the page renders dark. In light mode it renders light.
- With Chrome's UI language set to Japanese, Simplified Chinese, or Traditional Chinese, every string on the page is in that language.
- Every control can be reached and operated by keyboard alone.

---

### CUJ-4: Follow several downloads at once from the toolbar badge

**Dependencies**: CUJ-1
**Priority**: P1 (important)

#### Context
Downloads run in the background and outlive their tabs, so the user needs one glanceable place that says "is anything still coming?". The answer must not depend on which tab is in front. The badge answers that question with one number. Per-artwork detail stays on each artwork's own button.

#### Preconditions
- CUJ-1 works.
- Two pixiv tabs are open: tab A with a 30-page manga, and tab B with artwork `136120877`, "夏祭りの帰り" by そら, 8 pages.

#### Journey Steps

1. **User action**: In tab A, user clicks `Download · 30P`.
   - **System response**: Job A starts (CUJ-1).
   - **User sees**: Tab A's button shows `0 / 30`. The badge shows `30`, and its tooltip reads `pixiv Downloader — 30 files remaining`.

2. **User action**: User switches to tab B and clicks `Download · 8P` while job A is still running.
   - **System response**: Job B starts right away. It is not queued behind A. Each job independently keeps at most 5 files in Chrome's downloader.
   - **User sees**: Tab B's button shows its own progress only, for example `3 / 8`. The badge shows the sum of files still to land: 18 for A plus 5 for B gives `23`. Badge style: `#1f1f1f` background, white text. Hovering the icon shows `pixiv Downloader — 23 files remaining across 2 downloads`. Chrome's own downloads button shows activity alongside it. See `cuj-4-initial.html`.
   - **Details**: The badge counts down as files land from either job and updates within 1 s of each completion.

3. **User action**: User stays on tab B until job B finishes.
   - **System response**: Job B ends.
   - **User sees**: Tab B's button shows `Saved · 8P`. The badge keeps counting job A's remainder (e.g. `14`), and the tooltip switches to the one-job form, `pixiv Downloader — 14 files remaining`.

4. **User action**: User goes back to tab A, hovers the busy button, and clicks `Cancel`.
   - **System response**: Only job A stops. Any other running jobs continue.
   - **User sees**: Tab A's button returns to `Download · 30P`. The badge drops at once by job A's remaining count. If nothing else is in flight, it disappears and the tooltip returns to `pixiv Downloader — click to open settings`.

5. **User action**: (Alternative to step 4) User lets job A run to the end.
   - **User sees**: When the last file of the last job lands, the badge disappears.

6. **User action**: User clicks the toolbar icon at any point.
   - **System response / User sees**: The settings page opens or is focused, exactly as in CUJ-3. Nothing about the downloads changes.

#### Edge Cases & Error States
- **Large totals**: badge text is limited to 4 characters, so counts of 1000 or more show `999+`. The tooltip still shows the exact number, e.g. `pixiv Downloader — 1204 files remaining across 7 downloads`.
- **Service-worker restart mid-job** (Chrome stops idle extension workers): the in-flight job list survives the restart (4.8). Within 1 s the badge shows the correct remaining count again, and the jobs continue.
- **Ugoira in the mix**: an ugoira job contributes `1` for its whole life (4.8). A 12-page job plus an encoding ugoira shows, e.g., `6`.
- **A job ends with failures**: its failed files leave the count (nothing is in flight for them). Its button shows CUJ-5's error state, and the badge keeps counting the other jobs.
- **Tab closed mid-job**: the job keeps running and keeps counting in the badge until its files land.
- **Same artwork downloading in two tabs**: two jobs, both counted (e.g. 12 + 12 = `24`), and the tooltip says `across 2 downloads`. The second run's files get `" (1)"` suffixes.
- **Chrome's own downloads button**: it appears and animates alongside our icon while Chrome has files in flight. This is expected and deliberately not hidden. During an ugoira encode Chrome's button is idle while our badge shows `1`.

#### Mocks / Reference Designs

Mocks for this CUJ:
- `docs/ux/prd-000-mvp-mockups/cuj-4-initial.html`: tab B busy at `3 / 8`, tab A (30-page manga) visible in the tab strip, toolbar badge `23` with the "across 2 downloads" tooltip

#### Acceptance Criteria
- With two jobs running (18 and 5 files remaining), the badge reads `23` on a `#1f1f1f` background with white text, and the icon's tooltip reads `pixiv Downloader — 23 files remaining across 2 downloads`.
- With one job running, the tooltip uses the one-job form (`pixiv Downloader — 5 files remaining`, or `… — 1 file remaining`).
- Each tab's button shows only the progress of the artwork in that tab.
- The badge decreases within 1 s of any file landing, from any job.
- Starting a second artwork while one is running begins downloading the second immediately. Neither job waits for the other.
- Cancelling one job stops only that artwork's files, and the badge immediately drops by that job's remaining count.
- When the last in-flight file lands (or the last job is cancelled or fails), the badge disappears and the tooltip reads `pixiv Downloader — click to open settings`.
- A count of 1000 or more displays as `999+`.
- Stopping the extension's service worker from `chrome://serviceworker-internals` mid-job (or waiting for Chrome to stop it) does not lose the count. The badge shows the correct remaining number again within 1 s, and the jobs complete.
- Clicking the toolbar icon while jobs run opens settings and does not affect the jobs.

---

### CUJ-5: Recover when a download can't start or breaks

**Dependencies**: CUJ-1, CUJ-2
**Priority**: P0 (launch blocker)

#### Context
Downloads fail for reasons the user can fix (not logged in, connection dropped, pixiv's R-18 setting) and reasons they can't (work deleted, pixiv redesign). The extension must predict the predictable failure before the click. When a failure happens anyway, it must say what happened in the button itself and offer the one sensible next action without losing what already landed. There is no explanatory text anywhere on the page: the label carries the gist and the tooltip carries the detail.

#### Preconditions
- CUJ-1 and CUJ-2 work.
- Example A (pre-emptive): artwork `145892669`, "夜明け前" by ヨル, `xRestrict` 1, 68 pages, viewed while logged out. pixiv shows its R-18 wall instead of the image.
- Example B (reactive): artwork `135882741` (12 pages), where 3 pages fail after all retries.

#### Journey Steps

**Part A: pre-emptive needs-login (known before any click)**

1. **User action**: Logged out, user opens an R-18 or R-18G work.
   - **System response**: At render time the extension has the work's metadata (`xRestrict` 1) and the page's `"isLoggedIn":false`. Because `xRestrict ≥ 1` and the page is logged out, it renders the needs-login state instead of idle.
   - **User sees**: In the usual spot, a white pill with a 1.5 px `#c4c7c5` border, `#3c4043` text, **no icon**, and the label `Log in to download`. Hover: fill `#f5f7f9`, border `#8a8f94`. Tooltip: `Opens pixiv login and returns you here`. There is no other text anywhere on the page from the extension. See `cuj-5-initial.html`.
   - **Details**: `aria-label` is `Log in to pixiv to download this R-18 work`. Same fixed width as every other state.

2. **User action**: User clicks `Log in to download`.
   - **System response**: The tab navigates to `https://accounts.pixiv.net/login?return_to=<URL-encoded current page URL>`, e.g. `https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2Fartworks%2F145892669`.
   - **User sees**: pixiv's own login page.

3. **User action**: User logs in, and pixiv returns them to the artwork.
   - **System response**: A full page load. The page now reports `"isLoggedIn":true`, and the button renders normally.
   - **User sees**: `Download · 68P` in the idle style. Clicking it runs CUJ-1.

**Part B: reactive error states (after a click)**

4. **User action**: User clicks `Download · 12P`. Pages 4, 9 and 11 fail even after 4 attempts each; the other 9 land.
   - **System response**: When no work is left in flight, the job ends with 9 saved and 3 failed. The tab remembers which 3 pages failed, and the job's resolved folder.
   - **User sees**: An outlined red pill: white fill, 1.5 px `#d93025` border and text, warning-triangle icon, label `Retry · 3 failed`, same fixed width. Tooltip: `9 of 12 pages saved. 3 failed after 4 attempts each. Click to retry just those 3.` Hover: `#fdeceb` tint. No toolbar badge, because nothing is in flight. See `cuj-5-retry.html`.
   - **Details**: `aria-label` is `9 of 12 pages saved, 3 failed. Click to retry the failed pages.` The live region announces `3 pages failed`. With exactly 1 failure the tooltip is `11 of 12 pages saved. 1 failed after 4 attempts. Click to retry just that one.` (derived copy). The error state is remembered per artwork for the life of the document.

5. **User action**: User clicks `Retry · 3 failed`.
   - **System response**: Only the 3 failed pages are fetched again, into the **same folder** as the original job (not re-resolved from current settings), with the full retry policy. `metadata.json` is not written again.
   - **User sees**: The busy state continues from the earlier count, `9 / 12` → `12 / 12` (assumption — confirm), and the badge shows `3`. On success the button shows `Saved · 12P`. If some still fail, `Retry · N failed` returns with updated numbers.

6. **User action**: User clicks Download while nothing can be saved.
   - **System response / User sees**: The button shows the red error style with the label `Retry` (no hint). The tooltip names the cause:

     | Cause | Detection | Tooltip |
     |---|---|---|
     | No connection | Network errors or `navigator.onLine === false` after retries, with 0 pages saved | `No connection. Retry when you're back online.` |
     | pixiv refused the work | HTTP 401/403 or a pixiv error body on `/pages` or `ugoira_meta` while logged in (e.g. R-18 display off in pixiv settings, which can't be detected in advance) | `pixiv refused this work. If you're logged in, check your R-18 setting on pixiv.` |
     | pixiv server failure | 5xx after 4 attempts, with 0 pages saved | `pixiv isn't responding. Retry in a few minutes.` (derived copy — confirm) |
     | Downloads folder not writable | Chrome reports a file-system error (no space, access denied, name too long) on every file | `Chrome couldn't save to your Downloads folder. Check free space and try again.` (derived copy — confirm) |

   - **Details**: Clicking `Retry` runs the whole job again with the current settings. `aria-label` is `Download failed. <tooltip text> Click to retry.`

7. **User action**: The work was deleted after the page loaded, and the user clicks Download.
   - **System response**: `/ajax/illust/{id}` returns 404 or a pixiv "not found" error body.
   - **User sees**: The button becomes `Unavailable`: fill `#f1f3f4`, `#80868b` text, no border, no icon, no hover change, `not-allowed` cursor. Tooltip: `This work is no longer available.` If the 404 already happens at render time, the button renders as Unavailable immediately.
   - **Details**: `aria-disabled="true"`, `aria-label` `This work is no longer available.` The button stays focusable, and clicking it does nothing.

8. **User action**: On an ugoira, the zip lands but the encode fails.
   - **System response**: No video is written. The zip and `frames.json` stay.
   - **User sees**: The red error pill with the label `Retry · MP4` (or `Retry · WebM`). Tooltip: `Frames saved as ZIP. Video encoding failed. Click to retry the encode, or choose ZIP only in settings.`
   - **Details**: Clicking it fetches the frame zip again into memory without saving a second copy, then runs only the encode and writes only the video (`0%` → `100%`). (assumption — confirm)

9. **User action**: Mid-job, originals start returning 403 (e.g. the pixiv session expired).
   - **System response**: 403 is not retried. The job stops handing new files to Chrome, and files already saved stay.
   - **User sees**: The button drops back to `Log in to download` (needs-login style). Clicking it goes through steps 2–3. After returning, the button is a normal idle `Download · 12P`, and a click runs the whole job again (Chrome uniquifies the files that already landed).

10. **Cancel is not an error.** Cancelling in any busy state returns the button to idle with no red styling, no message, and no tooltip change.

**Part C: page-redesign fallback**

11. **User action**: User opens an artwork after pixiv has changed its page structure so the action row can't be found.
    - **System response**: If no action row is found within 3 s of the artwork page rendering, the button is inserted as a floating pill instead.
    - **User sees**: The same pill, in every state, positioned 16 px from the right and bottom edges of the artwork image area, above the image, with a `0 2px 8px rgba(0,0,0,.24)` shadow. If the artwork area also can't be found, the pill is fixed 24 px from the bottom-right of the viewport. (assumption — confirm: inset, shadow, and viewport fallback are not mocked)
    - **Details**: If the action row appears later, the button moves into it and keeps its state. Downloads work exactly as in CUJ-1 and CUJ-2.

#### Edge Cases & Error States
- **All-ages work while logged out**: no needs-login state. Downloads work normally, because originals need only the Referer.
- **Logged in elsewhere after this page loaded** (e.g. logged in from another tab): this page still says logged out, so the button still shows `Log in to download`. Clicking it goes to pixiv login, which redirects straight back because the session already exists, and the reloaded page shows `Download · 68P`.
- **Logged out in another tab after this page loaded**: the button shows `Download`. The click is refused and ends in `Retry` with the "pixiv refused this work" tooltip.
- **Partial failure, then the user changes the folder pattern before clicking Retry**: the retry still writes into the original job's folder, so the artwork is never split across folders.
- **Partial failure, then reload**: the failure memory is cleared and the button is idle. A click runs the whole job again, and the existing pages get `" (1)"` duplicates. This is accepted, because there is no persisted history (4.1 #1).
- **Only `metadata.json` failed** (pages all landed): the button shows `Retry` with the tooltip `All 12 pages saved. metadata.json couldn't be saved. Click to retry it.` (derived copy — confirm). The retry writes only `metadata.json`.
- **Rate limiting (429 with `Retry-After: 120`)**: wait at most 30 s per retry (4.5.2). After 4 attempts the file counts as failed.
- **Floating fallback on pixiv's dark theme**: same styling as the in-row button, with the `#5fb9fb` focus ring.
- **Screen reader**: each error state's `aria-label` contains the full cause, so it doesn't rely on the hover tooltip. The live region announces the failure once.

#### Mocks / Reference Designs

Mocks for this CUJ:
- `docs/ux/prd-000-mvp-mockups/cuj-5-initial.html`: logged out on R-18 work `145892669`, `Log in to download` (neutral outline, no icon)
- `docs/ux/prd-000-mvp-mockups/cuj-5-retry.html`: partial failure, `Retry · 3 failed` (red outline, warning icon), no badge

#### Acceptance Criteria
- Logged out, on a work with `xRestrict` 1 or 2, the button renders `Log in to download` (white fill, `#c4c7c5` border, `#3c4043` text, no icon) before any click, with the tooltip `Opens pixiv login and returns you here`. The extension shows no other text on the page.
- Clicking it navigates the tab to `https://accounts.pixiv.net/login?return_to=` followed by the URL-encoded artwork URL. After logging in, the returned page shows `Download · 68P`.
- Logged out, on an all-ages work, the button is the normal idle `Download · NP`, and the download succeeds.
- When some pages fail after 4 attempts, the button shows `Retry · 3 failed` (red outline, warning triangle, same width), and the tooltip reads exactly `9 of 12 pages saved. 3 failed after 4 attempts each. Click to retry just those 3.`
- Clicking `Retry · 3 failed` downloads only the 3 failed pages (no other file of the artwork appears again in `chrome://downloads`), into the same folder, and ends in `Saved · 12P` when they succeed.
- With the network disconnected, clicking Download ends in `Retry` with the tooltip `No connection. Retry when you're back online.`
- A logged-in account with R-18 display off in pixiv settings, clicking Download on an R-18 work, ends in `Retry` with the tooltip `pixiv refused this work. If you're logged in, check your R-18 setting on pixiv.`
- A work deleted after page load ends in a gray `Unavailable` button with the tooltip `This work is no longer available.`, and clicking it does nothing.
- On an ugoira whose encode fails, the zip and `frames.json` exist on disk, no video file exists, and the button shows `Retry · MP4` with the exact encode-failure tooltip. Clicking it produces only the video file.
- A 403 on originals mid-job leaves the already-saved files in place and returns the button to `Log in to download`.
- No error state shows a toolbar badge unless another job is in flight.
- Cancelling never produces red styling or any message.
- With pixiv's action row removed (simulated by deleting it in DevTools before navigation), the button appears as a floating pill at the bottom-right of the artwork area within 3 s and downloads normally.
- HTTP 403 responses are never retried, while 429/500/502/503/504 and network errors are retried up to 4 attempts in total (observable as repeated requests in the extension's network log).

---

## Appendix A: Copy deck

English is canonical. Strings marked **(derived)** were not mocked or given in discovery. They follow the discovery copy's voice and need owner confirmation. Variables are in `<angle brackets>`.

### Download button

| ID | English |
|---|---|
| `btn_download` | `Download` |
| `hint_pages` | `<n>P` (e.g. `12P`) |
| `hint_format` | `MP4` / `WebM` / `ZIP` |
| `btn_progress_pages` | `<done> / <total>` |
| `btn_progress_percent` | `<p>%` |
| `btn_cancel` | `Cancel` |
| `tip_cancel` | `Cancel download` |
| `btn_saved` | `Saved` |
| `tip_saved` | `Saved to Downloads/<folder>` |
| `btn_login` | `Log in to download` |
| `tip_login` | `Opens pixiv login and returns you here` |
| `btn_retry` | `Retry` |
| `hint_failed` | `<n> failed` |
| `tip_partial` | `<saved> of <total> pages saved. <failed> failed after 4 attempts each. Click to retry just those <failed>.` |
| `tip_partial_one` (derived) | `<saved> of <total> pages saved. 1 failed after 4 attempts. Click to retry just that one.` |
| `tip_offline` | `No connection. Retry when you're back online.` |
| `tip_refused` | `pixiv refused this work. If you're logged in, check your R-18 setting on pixiv.` |
| `tip_server` (derived) | `pixiv isn't responding. Retry in a few minutes.` |
| `tip_disk` (derived) | `Chrome couldn't save to your Downloads folder. Check free space and try again.` |
| `tip_metadata_only` (derived) | `All <total> pages saved. metadata.json couldn't be saved. Click to retry it.` |
| `btn_unavailable` | `Unavailable` |
| `tip_unavailable` | `This work is no longer available.` |
| `tip_encode_failed` | `Frames saved as ZIP. Video encoding failed. Click to retry the encode, or choose ZIP only in settings.` |

### Button accessible names and announcements

| ID | English |
|---|---|
| `aria_idle_pages` | `Download all <n> original images of this artwork` |
| `aria_idle_single` (derived) | `Download the original image of this artwork` |
| `aria_idle_ugoira` | `Download this ugoira as <format>, with its frame zip and metadata` |
| `aria_idle_ugoira_nometa` (derived) | `Download this ugoira as <format>, with its frame zip` |
| `aria_idle_ugoira_zip` (derived) | `Download this ugoira's frame zip` |
| `aria_busy_pages` | `Downloading, <done> of <total> pages saved. Click to cancel.` |
| `aria_busy_frames` (derived) | `Downloading frames, <p> percent. Click to cancel.` |
| `aria_busy_encode` | `Encoding <format>, <p> percent. Click to cancel.` |
| `aria_saved_pages` | `Saved <n> pages to Downloads/<folder>. Click to download again.` |
| `aria_saved_ugoira` (derived) | `Saved <format> to Downloads/<folder>. Click to download again.` |
| `aria_login` | `Log in to pixiv to download this R-18 work` |
| `aria_partial` | `<saved> of <total> pages saved, <failed> failed. Click to retry the failed pages.` |
| `aria_failed` (derived) | `Download failed. <cause tooltip> Click to retry.` |
| `live_start` (derived) | `Downloading <n> pages` |
| `live_saved` (derived) | `Saved <n> pages` |
| `live_failed` (derived) | `<n> pages failed` |
| `live_cancelled` (derived) | `Download cancelled` |

### Toolbar

| ID | English |
|---|---|
| `action_title_idle` | `pixiv Downloader — click to open settings` |
| `action_title_one` | `pixiv Downloader — <n> files remaining` / `pixiv Downloader — 1 file remaining` |
| `action_title_many` | `pixiv Downloader — <n> files remaining across <jobs> downloads` |

### Settings page

| ID | English |
|---|---|
| `opt_tab_title` | `pixiv Downloader — Settings` |
| `opt_title` | `pixiv Downloader` |
| `opt_subtitle` | `Settings` |
| `opt_folder_heading` | `Download folder` |
| `opt_folder_help` | `Inside your Downloads folder. Use tokens to name folders after the artwork.` |
| `opt_folder_aria` | `Folder pattern` |
| `opt_insert` | `Insert:` |
| `tok_artist_tip` | `Artist display name, as shown on pixiv` |
| `tok_id_tip` | `Artwork ID, the number in the page URL` |
| `tok_title_tip` | `Artwork title, shortened to stay a safe folder name` |
| `tok_userid_tip` | `Artist's numeric pixiv account ID; stable if the artist renames` |
| `opt_preview` | `Preview:` |
| `opt_still_using` | `Still using:` + `<pattern>` + `— your last valid pattern stays in effect until this one is fixed.` |
| `err_unknown_token` | `Unknown token <token>. Available tokens: {artist}, {id}, {title}, {userId}.` |
| `err_empty` | `Enter a folder pattern.` |
| `err_absolute` | `Must be a relative path inside Downloads.` |
| `err_dotdot` | `Can't contain "..".` |
| `err_backslash` | `Use "/" between folders.` |
| `err_illegal_chars` (derived) | `Can't contain : * ? " < > \|.` |
| `opt_ugoira_heading` | `Ugoira output` |
| `opt_ugoira_help` | `Encoded in your browser from the original frames. The frame zip and frames.json are always saved.` |
| `opt_ugoira_aria` | `Ugoira output format` |
| `opt_ugoira_mp4` / `_webm` / `_zip` | `MP4` / `WebM` / `ZIP only` |
| `opt_meta_heading` | `Save metadata.json` |
| `opt_meta_help` | `Title, description, tags, dates and artist, saved next to the images.` |
| `opt_saved` | `Saved` |
| `opt_reset` | `Reset to defaults` |
| `opt_report` | `Report an issue` |
| `opt_version` | `v<version>` |
| `opt_privacy` | `Only talks to pixiv.net and its image host. Nothing you download leaves your browser.` |

### Proposed translations for width-critical button labels

These are proposed and must be reviewed by a native speaker before release. (assumption — confirm) The fixed-width rule (4.7.2) measures these. `P` stays `P` in every locale.

| English | ja | zh_CN | zh_TW |
|---|---|---|---|
| `Download` | `ダウンロード` | `下载` | `下載` |
| `Saved` | `保存済み` | `已保存` | `已儲存` |
| `Cancel` | `キャンセル` | `取消` | `取消` |
| `Retry` | `再試行` | `重试` | `重試` |
| `<n> failed` | `<n>件失敗` | `<n> 个失败` | `<n> 個失敗` |
| `Log in to download` | `ログインして保存` | `登录后下载` | `登入後下載` |
| `Unavailable` | `利用不可` | `不可用` | `無法使用` |
