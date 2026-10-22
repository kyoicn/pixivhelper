# E2E harness (L3) — fake pixiv + real Chromium

The built extension (`dist-e2e/`, unmodified manifest) runs in Playwright's bundled Chromium (Chrome for Testing) against a deterministic fake pixiv. Real `chrome.downloads`, DNR, offscreen document and WebCodecs are exercised. Design: [docs/design/design-test-harness.md](../docs/design/design-test-harness.md) "L3: E2E harness".

## Running

| Command                                                                        | What                                                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `npm run test:e2e`                                                             | build `dist-e2e/`, run every spec                                       |
| `npm run test:e2e -- --grep @cuj1`                                             | one CUJ's specs                                                         |
| `npm run build:e2e && npx playwright test e2e/harness.spec.ts --reporter=line` | harness self-test (`@harness`, ENG-004)                                 |
| `HFP_LIVE=1 npm run test:e2e -- --grep @live`                                  | L4 live smoke against the real pixiv (`e2e/live/**`, ignored otherwise) |
| `npm run qa:fake` / `npm run qa:live`                                          | QA sessions (below)                                                     |

- Chromium runs **headed** locally and **headless** (`--headless=new`) when `CI` is set. `HFP_HEADLESS=1` forces headless, `HFP_HEADLESS=0` headed.
- Each test gets a fresh profile and downloads directory; each Playwright worker has one fake server, reset before every test.
- On failure, `test-results/<test>/` holds `trace.zip`, `server-log.json`, `console-errors.json` and `downloads.json`.
- `ffprobe`/`ffmpeg` are optional. `ffprobe()` and `ssim()` skip the calling test with a reason when the tool is not on `PATH`.
- Chromium comes from the Playwright browser cache (`npx playwright install chromium` if missing).

## Layout

| Path                 | Contents                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `harness/launch.ts`  | `launch()` and the `Harness` object (CDP connection, SW helpers, downloads)                                     |
| `harness/test.ts`    | Playwright `test` with the `server`, `harness` and `uiLocale` fixtures; import specs' `test`/`expect` from here |
| `harness/console.ts` | console-error collection from pages, the SW and the offscreen document                                          |
| `harness/media.ts`   | `ffprobe()`, `ssim()`, `hasMediaTool()`                                                                         |
| `server/server.ts`   | the fake pixiv HTTPS server: routing, faults, request log, `maxInFlight`                                        |
| `server/ajax.ts`     | `/ajax/illust` JSON bodies                                                                                      |
| `server/page.ts`     | fixture page HTML, SPA script, `window.__fake` controls, login page                                             |
| `fixtures/works.ts`  | the 13 fixture works and their URLs                                                                             |
| `fixtures/assets.ts` | generated page images, ugoira frames and zips (deterministic, cached per process)                               |
| `fixtures/images.ts` | tiny PNG/JPEG encoders                                                                                          |
| `qa/`                | `qa:fake` / `qa:live` sessions (`run.mjs` bundles them with esbuild into `.qa/`)                                |
| `harness.spec.ts`    | harness self-test                                                                                               |

## Writing a spec

```ts
import { artworkUrl } from './fixtures/works';
import { expect, test } from './harness/test';

test('saves all 12 pages', { tag: '@cuj1' }, async ({ harness, server }) => {
  const page = await harness.newPage();
  await page.goto(artworkUrl('135882741'));
  // … click the button, then:
  await harness.downloads.waitForFile('pixiv/みずき-135882741/135882741_p11.jpg');
  expect(server.maxInFlight('135882741')).toBeLessThanOrEqual(5);
  expect(await harness.swEval(() => chrome.action.getBadgeText({}))).toBe('');
});
```

`test.use({ uiLocale: 'ja' })` launches Chromium with another UI language (`en` by default). On macOS this uses `-AppleLanguages`; skip with a logged reason if `chrome.i18n.getUILanguage()` does not follow.

A test fails if any page, the SW or the offscreen document logged an error (console `error`/`assert`, uncaught exception, or a browser error log such as a failed resource load) that the test did not expect. Declare expected ones with `harness.allowConsoleErrors(/status of 503/)`.

## Harness API (`harness/launch.ts`)

`launch({ server?, locale?, headless?, extensionDir?, profileDir?, downloadsDir? }) → Promise<Harness>`

- With `server`: `--host-resolver-rules` maps `www.pixiv.net`, `i.pximg.net` and `accounts.pixiv.net` to the fake server, `--ignore-certificate-errors` accepts its certificate, and `dist-e2e/` is loaded. Without `server`: real network and `dist/` (the dev build).
- Chromium is spawned with `--load-extension`, `--remote-debugging-port=0` and `--no-startup-window`. Playwright connects with `connectOverCDP`, then `Browser.setDownloadBehavior({ behavior: 'default' })` so files keep Chrome's real names in the profile's download directory.

| Member                                                                      | Purpose                                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `browser`, `context`, `cdp`                                                 | Playwright browser over CDP, its default context (the extension's profile), browser-level CDP session      |
| `wsEndpoint`                                                                | CDP endpoint for `chromium.connectOverCDP()`                                                               |
| `extensionId`, `serviceWorkerUrl`                                           | resolved from the extension's service-worker target                                                        |
| `newPage()`                                                                 | a new tab (a blank anchor tab keeps the window open, so closing a spec's tab never quits Chrome)           |
| `swEval(fn, arg?)`                                                          | `Worker.evaluate` in the extension SW, starting the worker first if it is stopped                          |
| `serviceWorker()`                                                           | the running SW as a Playwright `Worker`                                                                    |
| `isServiceWorkerRunning()`                                                  | whether the SW target exists                                                                               |
| `stopServiceWorker()`                                                       | `Target.closeTarget` on the SW (fallback `ServiceWorker.stopAllWorkers`); resolves when the target is gone |
| `downloads.dir`, `downloads.files()`                                        | the downloads directory; recursive `{ path, size }` listing, `/`-separated, sorted                         |
| `downloads.waitForFile(path, { timeout })`                                  | resolves when the file exists under its final name                                                         |
| `consoleErrors()`, `allowConsoleErrors(...re)`, `unexpectedConsoleErrors()` | collected errors (`source`: `sw` / `offscreen` / `extension-page` / `page`)                                |
| `close()`                                                                   | quits Chromium and removes temp dirs                                                                       |

Also exported: `unpackedExtensionId(dir)`, `E2E_EXTENSION_DIR`, `DEV_EXTENSION_DIR`, `REPO_ROOT`. From `harness/media.ts`: `ffprobe(file)` (`-show_frames -show_streams` as JSON) and `ssim(video, framePaths)` (per-frame SSIM against the source frames cropped to even size from the top-left; `{ perFrame, mean, min }`).

## Fake server (`server/server.ts`)

HTTP/2 (with HTTP/1.1 fallback) on `127.0.0.1`, ephemeral port, certificate generated at start by `selfsigned` (nothing committed). Routed by `Host`:

- **`www.pixiv.net`**: `/artworks/:id`, `/<lang>/artworks/:id`, `/users/:id` and `/` (fixture pages); `/ajax/illust/:id`, `/:id/pages`, `/:id/ugoira_meta`. `/pages` and `/ugoira_meta` of an `xRestrict ≥ 1` work answer `{ error: true }` unless the request carries `PHPSESSID=fake-session`, and always when the work has `r18Hidden`. Logged out, `/ajax/illust/:id` of such a work has every image URL `null`. Deleted or unknown works: 404 `{ error: true }`.
- **`i.pximg.net`**: `/img-original/…`, `/img-master/…`, `/img-zip-ugoira/…` return **403 unless `Referer` is exactly `https://www.pixiv.net/`**. Bytes carry `Content-Length` unless the work has `noContentLength` (then chunked). `/__harness/ok.bin` (`HARNESS_BLOB`) has no Referer check.
- **`accounts.pixiv.net`**: `GET /login?return_to=…` shows a "Log in" button (or redirects straight back when already logged in); its `POST` sets `PHPSESSID=fake-session` on `.pixiv.net` and redirects to `return_to` (only `https://www.pixiv.net/…` targets are honored).
- `/favicon.ico` answers 204 everywhere.

| Member                                                                    | Purpose                                                                                                              |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `startFakePixiv(port?)`                                                   | start a server                                                                                                       |
| `port`, `hostResolverRules`                                               | listening port; the `--host-resolver-rules` value                                                                    |
| `fault({ match, responses })`                                             | script responses (below)                                                                                             |
| `clearFaults()`                                                           | drop every fault rule                                                                                                |
| `patchWork(id, { title, userName, r18Hidden, noContentLength, deleted })` | override fixture fields until `reset()`                                                                              |
| `work(id)`                                                                | the fixture as served (with patches)                                                                                 |
| `log`, `requests(match?)`                                                 | every request: `at`, `method`, `host`, `path`, `url`, `referer`, `loggedIn`, `status`, `bytes`, `artworkId`, `fault` |
| `waitForRequest(match, { timeout })`                                      | first matching request, already logged or future                                                                     |
| `maxInFlight(artworkId)`                                                  | peak concurrent original/zip requests for one artwork                                                                |
| `reset()`                                                                 | clear log, faults, patches and peaks (the `harness` fixture does this per test)                                      |
| `close()`                                                                 | stop                                                                                                                 |

**Faults.** `match` is a substring of, or a RegExp tested against, the full URL. `responses` is one response, applied to every match until `clearFaults()`, or an array consumed one per matching request (e.g. per retry attempt), after which the rule is gone. A response is a status number or an object:

| Response                           | Effect                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `503`, `{ status: 403 }`           | answer with that status (JSON `{ error: true }` on `/ajax/`, text otherwise)                          |
| `{ status: 429, retryAfter: 120 }` | with a `Retry-After` header                                                                           |
| `200`                              | answer normally (e.g. the last element of `[503, 503, 200]`)                                          |
| `{ delayHeadersMs: 300 }`          | answer normally after a delay (forces overlap for `maxInFlight`)                                      |
| `{ stallAfterBytes: 1024 }`        | send headers and 1024 body bytes, then go silent                                                      |
| `{ reset: true }`                  | drop the request without a response (HTTP/2 stream reset; socket destroy on HTTP/1.1) → network error |

## Fixture page (`server/page.ts`)

A placeholder, until task 3.4 swaps in the structure of the ENG-002 live capture: `<html data-theme="light|dark">` (theme marker), an artwork `<figure>` with the master image (an R-18 wall when logged out), an action row with Share and More on the left and Like and Bookmark on the right, rendered `ROW_DELAY_MS` (300 ms) after `load` or after an SPA navigation with `performance.mark('fake:row')` (`ROW_MARK`), related works with their own Bookmark mini-buttons, and `<script id="__NEXT_DATA__">` carrying `"isLoggedIn":true|false` from the request's cookie. Links marked `data-spa` navigate with `history.pushState`; back/forward re-render.

Test controls (`page.evaluate(() => (window as unknown as FakeWindow).__fake.removeRow())`):

- `__fake.rerenderRow()`: replace the row with new nodes (as a React re-render does);
- `__fake.removeRow()` / `__fake.restoreRow()`: remove the row and keep it away across SPA navigations / bring it back (redesign fallback);
- `__fake.setTheme('dark' | 'light')`.

## Fixtures (`fixtures/works.ts`)

| ID        | Kind                                                                  | Purpose                                           |
| --------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| 135882741 | 12-page illust (p1, p7 PNG; others JPG), みずき, userId 40285173      | CUJ-1 example; CUJ-5 partial failure and 403      |
| 135882742 | 1-page illust                                                         | single-page labels                                |
| 135882743 | 200-page manga, tiny images                                           | badge 200, ≤ 5 in flight, 3-digit width           |
| 135882744 | artist `  Sora / 空 :: 2nd  `; patch `userName` to `ZWJ_EMOJI_ARTIST` | sanitization and Chrome path safety on disk       |
| 145892669 | 68 pages, `xRestrict` 1, ヨル                                         | needs-login, login round-trip; `r18Hidden`        |
| 136004512 | ugoira 600×600, 48 JPEG frames × 100 ms                               | CUJ-2 example                                     |
| 136004513 | ugoira, delays 40, 40, 500, 40                                        | timing exactness                                  |
| 136004514 | ugoira 601×451                                                        | even-dimension crop (600×450)                     |
| 136004515 | ugoira, no `Content-Length`                                           | indeterminate arc                                 |
| 136004516 | ugoira, frame 5 is not an image                                       | encode failure → `Retry · MP4`                    |
| 136004517 | ugoira 1920×1080, 300 frames                                          | long encode, ≥ 1 progress/s, tab close mid-encode |
| 136120877 | 8 pages, そら                                                         | CUJ-4 tab B                                       |
| 199999999 | deleted (ajax 404)                                                    | Unavailable                                       |

Bytes are generated on demand (`fixtures/assets.ts`): images are flat 16×16 tiles (checkerboards for pages, a gradient with a moving square for frames), zips are stored entries with a fixed timestamp. Specs that need the expected bytes call `pageBytes()`, `ugoiraFrames()` or `ugoiraZip()`.

## QA sessions

- `npm run qa:fake`: builds `dist-e2e/`, starts the fake server, launches headed Chromium with a persistent profile at `.qa/profile` and downloads at `.qa/downloads`, opens the CUJ-1 example, and prints the CDP endpoint, extension ID and fixture URLs. In a terminal it opens a REPL with `server`, `harness`, `page` and `works` (e.g. `server.fault({ match: '_p3.', responses: [503, 503, 200] })`, `await harness.swEval(() => chrome.action.getBadgeText({}))`); `.exit` closes everything. Without a terminal (an agent running it in the background) there is no REPL; attach with `chromium.connectOverCDP(endpoint)` and stop it with SIGINT/SIGTERM.
- `npm run qa:live`: builds `dist/` and launches headed Chromium against the real pixiv with a persistent profile at `.qa/profile-live`, so a human can log in once for R-18 paths.

QA reports cite the spec or fixture used, so failures are reproducible.

## Acceptance-criteria mapping

Skeleton: every PRD acceptance criterion (docs/prd/prd-000-mvp.md), the check that proves it, and the spec that will own it. Specs keep the detailed AC → test mapping in a comment block at their top. "L1" means a unit test covers it; "L5" means the manual release checklist.

### CUJ-1 (`cuj1.spec.ts`, `@cuj1`, task 4.1)

| PRD AC                                                                             | Check                                                                                                                             |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| One button, immediately left of like, ≤ 500 ms after the row renders               | one `hfp-download`; its `nextElementSibling` is the Like control; `fake:row` mark → host connected ≤ 500 ms                       |
| `Download · 12P` / `Download` (single page)                                        | idle label on 135882741 / 135882742                                                                                               |
| 164 px in idle, busy, Cancel-hover, Saved; width never changes                     | host `getBoundingClientRect().width` in each state, including after hover                                                         |
| Folder holds `metadata.json` + `135882741_p0` … `p11`, sizes = `Content-Length`    | `downloads.files()` vs `server.log` `bytes`                                                                                       |
| `metadata.json`: 12 keys in order, literal non-ASCII, `\n` kept                    | key order; raw bytes contain `みずき`, not `\u` escapes                                                                           |
| Never > 5 of this artwork's files in flight                                        | `server.maxInFlight('135882741') ≤ 5` with `{ delayHeadersMs: 300 }`; `chrome.downloads.search({ state: 'in_progress' })` sampled |
| `N / 12` only rises; `12 / 12` only after every original; metadata never changes N | label texts recorded by a `MutationObserver`                                                                                      |
| Cancel stops the job, keeps completed files, back to `Download · 12P`              | delayed responses; hover after `pointerleave`; click; no new `_pN` requests in `server.log`                                       |
| `Saved · 12P` style and tooltip                                                    | label, computed styles, `title`                                                                                                   |
| SPA away and back shows Saved; reload shows idle                                   | `data-spa` links, `page.goBack()`, `page.reload()`                                                                                |
| Clicking Saved downloads again as `(1)` duplicates                                 | second click; `downloads.files()`                                                                                                 |
| Closing the tab does not stop the job                                              | `page.close()`, then `downloads.waitForFile()`                                                                                    |
| Badge counts pages remaining and disappears at the end                             | `swEval(() => chrome.action.getBadgeText({}))`                                                                                    |
| Tab / Enter / Space, 2 px focus ring, `aria-busy`                                  | keyboard only; computed outline; attribute                                                                                        |
| Dark theme identical                                                               | `__fake.setTheme('dark')`; same computed fill, text, icon                                                                         |
| Pattern change mid-job does not move the job (also CUJ-3 "while a download runs")  | change settings mid-job; files land in the original folder                                                                        |

### CUJ-2 (`cuj2.spec.ts`, `@cuj2`, task 4.3)

| PRD AC                                                                     | Check                                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Idle label `Download · MP4` / `WebM` / `ZIP` per setting and codec support | idle label for each setting; MP4 gated on the codec probe (`avc: null` → skip with reason) |
| Percent never decreases, no `100%` early, ≥ 1 update/s during encode       | `MutationObserver` label log on 136004517                                                  |
| Badge `1` for the whole job                                                | `swEval(getBadgeText)` sampled                                                             |
| Folder holds exactly zip, `frames.json`, video, `metadata.json`            | `downloads.files()`                                                                        |
| Zip byte-identical; `frames.json` equals `ugoira_meta.body.frames`         | compare with `ugoiraZip()` and the ajax body                                               |
| Frame count and per-frame durations within ±1 ms (`@ffprobe`)              | `ffprobe()` on 136004512 (48 frames) and 136004513 (40, 40, 500, 40)                       |
| Width × height = frames rounded down to even (`@ffprobe`)                  | `ffprobe()` on 136004514 → 600×450                                                         |
| Plays in Chrome, VLC, QuickTime                                            | L5                                                                                         |
| ZIP only: zip + `frames.json` (+ metadata), no video, `Saved · ZIP`        | setting `zip`; `downloads.files()`                                                         |
| Cancel during encode leaves no video, keeps zip and `frames.json`          | cancel while the label shows a percent                                                     |
| Closing the tab during encode still produces the video                     | `page.close()` mid-encode on 136004517                                                     |
| No H.264 → hint, Saved label and extension all say WebM                    | when the probe reports `avc: null`                                                         |
| (engineering) quality: no visible blocking or banding                      | `ssim()` mean ≥ 0.98, min ≥ 0.95                                                           |
| (engineering) no `Content-Length` → indeterminate arc                      | 136004515                                                                                  |

### CUJ-3 (`cuj3.spec.ts`, `@cuj3`, task 4.2)

| PRD AC                                                                                                     | Check                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Toolbar opens a full tab `Helper for Pixiv — Settings`; a second click focuses it                          | e2e hook `__hfpTest.clickAction(tabId)` via `swEval`; tab list and focus              |
| No popup                                                                                                   | manifest has no `default_popup`; no popup target appears                              |
| Defaults: `pixiv/{artist}-{id}`, MP4, metadata on                                                          | fresh profile                                                                         |
| Chips insert at the caret; exact tooltips                                                                  | caret positions; `title` text                                                         |
| Preview `Downloads/pixiv/みずき-135882741/135882741_p0.jpg`                                                | text                                                                                  |
| `pixiv/{artst}-{id}`: red border, exact message, "Still using" line; downloads keep the last valid pattern | ≤ 400 ms after typing; `chrome.storage` unchanged via `swEval`                        |
| Each validation case shows its exact message                                                               | the 6 cases                                                                           |
| Autosave; `Saved` appears and fades after 2 s                                                              | timing                                                                                |
| Reload shows the saved values                                                                              | `page.reload()`                                                                       |
| A running download keeps its settings                                                                      | covered by CUJ-1 (pattern) and CUJ-2 (format) mid-job checks                          |
| `Reset to defaults`                                                                                        | click; values and storage                                                             |
| Footer content                                                                                             | text                                                                                  |
| Dark / light follows the OS                                                                                | `page.emulateMedia({ colorScheme })`                                                  |
| ja, zh_CN, zh_TW strings                                                                                   | `test.use({ uiLocale })`                                                              |
| Keyboard-only operation                                                                                    | Tab order: field → 4 chips → MP4 → WebM → ZIP only → switch → Reset → Report an issue |
| (design) two-tab sync within 1 s, invalid-draft exemption                                                  | two options tabs                                                                      |

### CUJ-4 (`cuj4.spec.ts`, `@cuj4`, task 4.1)

| PRD AC                                                                         | Check                                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Badge `23`, `#1f1f1f`/white, tooltip "… 23 files remaining across 2 downloads" | two tabs (one of them 136120877) held at 18 + 5 remaining with faults; `swEval(getBadgeText/getTitle/getBadgeBackgroundColor)` |
| One-job tooltip forms (`5 files` / `1 file`)                                   | `swEval(getTitle)`                                                                                                             |
| Each tab shows only its own artwork's progress                                 | both labels                                                                                                                    |
| Badge decreases within 1 s of any file landing                                 | poll after each `downloads.files()` change                                                                                     |
| A second artwork starts immediately                                            | `server.log` shows both artworks' byte requests overlapping                                                                    |
| Cancelling one job drops the badge by its remaining count                      | badge before/after                                                                                                             |
| Last file → badge gone, idle tooltip                                           | `getBadgeText` `''`, `getTitle`                                                                                                |
| ≥ 1000 shows `999+`                                                            | L1 (badge formatting)                                                                                                          |
| SW stopped mid-job: badge correct within 1 s, jobs complete                    | `stopServiceWorker()`, then poll ≤ 1 s after the next event                                                                    |
| Toolbar click while jobs run opens settings, jobs unaffected                   | e2e hook or `openOrFocusOptions` via `swEval`                                                                                  |

### CUJ-5 (`cuj5.spec.ts`, `@cuj5`, next iteration)

| PRD AC                                                                                       | Check                                                                                    |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Logged out on `xRestrict ≥ 1`: `Log in to download` before any click                         | 145892669, no cookie                                                                     |
| Click → `accounts.pixiv.net/login?return_to=…`; after login `Download · 68P`                 | fake login button; page reload with the cookie                                           |
| Logged out on all-ages: normal idle, download succeeds                                       | 135882742, no cookie                                                                     |
| `Retry · 3 failed` with the exact tooltip                                                    | persistent `503` faults on `_p4.`, `_p9.`, `_p11.`                                       |
| Retry fetches only the 3 pages into the same folder → `Saved · 12P`                          | clear faults; `server.log`; `downloads.files()`                                          |
| Offline → `Retry` + "No connection…"                                                         | `{ reset: true }` on every byte request                                                  |
| R-18 display off → "pixiv refused this work…"                                                | `patchWork('145892669', { r18Hidden: true })`, logged in                                 |
| Deleted after page load → `Unavailable`, click does nothing                                  | `patchWork(id, { deleted: true })` after load; 199999999 at render time                  |
| Encode failure: zip + `frames.json`, no video, `Retry · MP4`; retry writes only the video    | 136004516                                                                                |
| 403 mid-job keeps saved files, back to `Log in to download`                                  | `{ status: 403 }` on `_p5.`                                                              |
| No badge in error states unless another job runs                                             | `swEval(getBadgeText)`                                                                   |
| (system.md §9) 429/5xx up to 4 attempts, `Retry-After` honored and capped; 403 never retried | attempt counts and gaps in `server.log` (`1.5·2ⁿ·0.01` s ± jitter, `min(RA, 30)·0.01` s) |
| (PRD CUJ-5 step 11) floating fallback within 3 s                                             | `__fake.removeRow()`; `restoreRow()` moves the button back                               |
