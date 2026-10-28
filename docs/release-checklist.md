# Release checklist

Run before every Chrome Web Store submission. This is the L5 layer of [design-test-harness.md](design/design-test-harness.md): the checks that need branded Chrome, OS media players, a real pixiv login or the store dashboard, which no automated layer can run. Copy the list into the release note, tick each item, and record the Chrome version, OS and work IDs used. A failed item blocks the release until it is fixed or the owner accepts it.

## 1. Package

- [ ] `package.json` `version` is the release version (SemVer, the single source; system.md §12), higher than the version live on the store (updates only).
- [ ] CI is green on the release commit: `npm run check`, the content-bundle size budget and the prod-bundle test-hook check.
- [ ] `npm run zip` writes `helper-for-pixiv-<version>.zip` at the repository root. Upload this file, never a hand-made zip of `dist/`.
- [ ] The manifest version equals the `package.json` version: `unzip -p helper-for-pixiv-<version>.zip manifest.json | grep '"version"'`. (`npm run zip` also refuses to pack on a mismatch.)
- [ ] `unzip -l helper-for-pixiv-<version>.zip` lists `manifest.json`, `sw.js`, `content.js`, `offscreen.html`, `offscreen.js`, `options.html`, `options.js`, `options.css`, `_locales/{en,ja,zh_CN,zh_TW}/messages.json`, `icons/icon-{16,32,48,128}.png` and `THIRD_PARTY_NOTICES.txt`, and no `.map` file.
- [ ] `THIRD_PARTY_NOTICES.txt` carries the MPL-2.0 text for mediabunny and the MIT text for fflate, each under a header with the package version and SPDX id.
- [ ] The live smoke passes: `HFP_LIVE=1 npm run test:e2e -- --grep @live` (design-test-harness.md L4).

## 2. Branded Chrome, macOS and Windows

Use Chrome stable, not Chrome for Testing. Unzip the release zip into an empty folder, then `chrome://extensions` → Developer mode → Load unpacked → that folder. Run every item on both macOS and Windows; tick it when it passed on both, and note any difference between them.

- [ ] **Install from the zip.** The extension loads with no entry under Errors on `chrome://extensions`, and the options page footer shows `v<version>`.
- [ ] **H.264 hardware encode** of a live all-ages ugoira comparable to fixture 136004512 (about 600×600, about 50 frames):
  - `chrome://gpu` lists `Video Encode: Hardware accelerated`;
  - the button reads `Download · MP4` before the click and ends `Saved · MP4`;
  - in `chrome://extensions` → Helper for Pixiv → Inspect views → `offscreen.html`, the console shows `[hfp:offscreen] encoded avc1.…` and no `encoder failed, retrying with prefer-software` warning.
- [ ] **Live all-ages ugoira walk** (pm-review 7a), with no pixiv login:
  - default settings: the folder holds `<id>_ugoira.zip`, `frames.json`, `<id>.mp4` and `metadata.json`;
  - Settings → Ugoira output → `ZIP only`: the button reads `Download · ZIP` and ends `Saved · ZIP`; the folder holds the zip and `frames.json`, and no video.
- [ ] **Playback.** The MP4 plays at pixiv's frame timing in QuickTime Player (macOS), Windows Photos and Windows Media Player (Windows), and VLC (both). With Ugoira output → `WebM`, the WebM plays in Chrome (drop the file into a tab) and in VLC.
- [ ] **"Ask where to save each file before downloading"** on (`chrome://settings/downloads`), then download a multi-page work. Expected, PRD-000 CUJ-1 edge cases (known v1 limitation): the extension requests no prompt; if Chrome still shows a Save dialog per file, that is Chrome honoring the setting; a file whose dialog is dismissed counts as failed and is not retried automatically. The Save dialog is a separate window, so it still appears while the extension keeps Chrome's download UI hidden (R-005). Record what Chrome actually did, since the PRD marks this "assumption — confirm by testing". Turn the setting off afterwards.
- [ ] **Chrome's download UI (R-005, R-006, PRD-000 §4.1 #3).** Watch the toolbar; the e2e suite cannot see it.
  - During the download of a live all-ages 12-page work, Chrome shows no fly-to-toolbar animation and no downloads button for the first 12 files, not even for `metadata.json`.
  - **One animation, at the last file**: it brings the downloads button back, and after `Saved · 12P` its bubble lists the 13 files (`metadata.json` and the 12 originals).
  - With two jobs, the button returns only with the last file of the job that ends last.
  - **A re-download served from the HTTP cache** (click `Saved · 12P` again, so the last files land together) also shows exactly one animation, at the end, and the bubble that opens with it lists the new job's last file, now under the sibling folder `pixiv/<artist>-<id> (1)/` (`135882741_p11.jpg` or whichever page landed last; PRD-000 §4.3 "Folder choice").
  - **After a cancel, the button returns only with the next download** (accepted by R-006).
  - A file downloaded from another site while a job runs shows no animation either (the browser-wide side effect R-005 accepts), and is listed once the button returns.
  - Windows, with Enhanced Safe Browsing on: an ugoira's zip raises no deep-scan or dangerous-file prompt that the hidden bubble would swallow. If one appears, the job waits and the button stays hidden until the file is handled in `chrome://downloads`; record it for pm (a known v1 limitation, PRD-000 CUJ-2 edge; system.md §15 "Known limitation").
- [ ] **Repeat download goes to a sibling folder (PRD-000 §4.3 "Folder choice", CUJ-1 step 8; design-download-engine.md D15).** On a live all-ages multi-page work:
  - click `Saved · NP` again: the new files land in `Downloads/pixiv/<artist>-<id> (1)/` with clean names (`<id>_p0.jpg`, `metadata.json`), the first folder is untouched, and the tooltip reads `Saved to Downloads/pixiv/<artist>-<id> (1)`; a third click uses `(2)`;
  - move `pixiv/<artist>-<id>` away in Finder or Explorer, **wait at least 10 s** (Chrome re-checks file existence at most once per 10 s), click again: the plain folder is used, and no new `(n)` appears;
  - on Windows this also confirms the history regex against backslash paths, which no automated layer runs.
- [ ] **Two artworks in two tabs, five times** (branded-Chrome confirmation of the offscreen-readiness fix, design-offscreen-worker.md D16; pm-review iteration 4 priority 6). Open two artworks in two tabs and click Download in both as fast as you can switch tabs. Every time, both buttons end `Saved` and both folders hold `metadata.json` and every page.
- [ ] **4 locales without clipping.** For each of en, ja, zh_CN and zh_TW, switch Chrome's UI language (Windows: `chrome://settings/languages` → "Display Google Chrome in this language"; macOS: System Settings → General → Language & Region → Applications → Google Chrome), relaunch, and check that no text is clipped or overflows:
  - the button in every state you can reach: idle, progress, `Saved`, and `Log in to download` (logged out, on a walled work);
  - the options page, every section and the footer;
  - the toolbar title and badge;
  - the name and description on `chrome://extensions`.

## 3. Logged-in checks (owner only)

These need a real pixiv session, which no agent has. Run `npm run qa:live` (headed Chromium with the dev build against real pixiv) and log in with your own account in that window. The session stays in the git-ignored `.qa/profile-live`; credentials are never committed.

- [ ] **Action-row placement on the logged-in DOM.** On an illustration, a manga and an ugoira, the button sits in pixiv's action row immediately left of Like, not floating. Repeat on a work you have already liked, so the liked Like control is still found.
- [ ] **pixiv's dark theme** on (`html[data-theme="dark"]`). The button looks the same as on the light theme in every state reached, and Tab focus shows the `#5fb9fb` ring instead of `#0096FA`.
- [ ] **R-18 after a real login** (PRD-000 CUJ-5), with pixiv's R-18 display on. Logged out, an R-18 work shows `Log in to download`. Clicking opens pixiv's login; after logging in, the same artwork shows `Download · <N>P`, and the download ends `Saved · <N>P` with every page on disk.
- [ ] **R-18 display off** in pixiv's settings. Clicking Download on an R-18 work ends in `Retry` with the tooltip `pixiv refused this work. If you're logged in, check your R-18 setting on pixiv.` (`tip_refused`). Turn R-18 display back on afterwards.
- [ ] **R-003 stale-page probe** (system.md §8.5, miss 2). In the logged-in pixiv tab's DevTools console, run `const b = (await (await fetch('/ajax/illust/<id>')).json()).body; [b.sl, b.xRestrict, b.urls.original]` for:
  - an all-ages work with `sl` 4 (one pixiv walls when logged out);
  - an R-18 work with R-18 display on;
  - the same R-18 work with R-18 display off.

  Record the three results and work IDs for tl and pm (system.md §8.5, miss 2). They decide whether the stale-page gap can close: it can only if `urls.original` is a URL for every work the logged-in viewer can see, and `null` only with R-18 display off.

## 4. Store listing (en, ja, zh_CN, zh_TW)

- [ ] **Name** "Helper for Pixiv" in all four locales (R-002, `ext_name`). No listing text, screenshot or image uses "pixiv Downloader".
- [ ] **Short description** in all four locales: the store takes it from each locale's `ext_description`, which must stay within 132 characters.
- [ ] **Full description** written in all four languages and reviewed by a native speaker (PRD index "Internationalization").
- [ ] **Screenshots** for each locale, taken with Chrome's UI in that language.
- [ ] **Store icon and promo tile** present: the 128×128 icon (`icons/icon-128.png`) and the 440×280 small promo tile.
- [ ] **Support URL** `https://github.com/kyoicn/pixivhelper/issues` (R-001).

## 5. Privacy practices (developer dashboard)

- [ ] **Single purpose:** "Save the pixiv artwork you are viewing." (PRD index "Store readiness").
- [ ] **Permission justifications**, pasted from system.md §5 "Permission justifications":

  | Dashboard field | Text |
  |---|---|
  | `downloads` | Saves the artwork's files into the user's Downloads folder (the single purpose). |
  | `storage` | Remembers the three settings. Keeps running downloads alive across service-worker restarts. Nothing persists after Chrome quits. |
  | `offscreen` | WebCodecs and `URL.createObjectURL` are not available in service workers. The offscreen document encodes ugoira videos and hands downloaded bytes to Chrome's downloader. |
  | `declarativeNetRequestWithHostAccess` | One session rule sets `Referer: https://www.pixiv.net/`. pixiv's image host returns 403 without this Referer. The rule matches only the extension's own requests to `i.pximg.net`, never browsing traffic. |
  | `downloads.ui` | Hides Chrome's per-file download animation while a multi-page artwork saves, then restores it. |
  | Host permissions | `https://www.pixiv.net/*`: Shows the button on artwork pages and reads the artwork's page list. `https://i.pximg.net/*`: Downloads the original-size images. |
- [ ] **Remote code:** none. All code is bundled, and MV3's default CSP applies.
- [ ] **Data usage:** no user data is collected or transmitted. No data category is ticked, and the three certifications are ticked.

## 6. Before you submit

- [ ] **The repository `kyoicn/pixivhelper` is public** (R-001): the options page's `Report an issue` link and the listing's support URL point to its Issues. `https://github.com/kyoicn/pixivhelper/issues` opens in a private window, signed out of GitHub, and the `Report an issue` link lands there.
- [ ] Every item above is ticked or accepted by the owner, and the release note records the Chrome versions, OSes and work IDs used.
