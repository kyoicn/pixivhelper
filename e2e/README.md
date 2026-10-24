# E2E harness (L3) — fake pixiv + real Chromium

The built extension (`dist-e2e/`, unmodified manifest) runs in Playwright's bundled Chromium (Chrome for Testing) against a deterministic fake pixiv. Real `chrome.downloads`, DNR, offscreen document and WebCodecs are exercised. Design: [docs/design/design-test-harness.md](../docs/design/design-test-harness.md) "L3: E2E harness".

## Running

| Command                                                                        | What                                                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `npm run test:e2e`                                                             | build `dist-e2e/`, run every spec                                       |
| `npm run test:e2e -- --grep @cuj1`                                             | one CUJ's specs                                                         |
| `npm run build:e2e && npx playwright test e2e/harness.spec.ts --reporter=line` | harness self-test (`@harness`, ENG-004, ENG-009)                        |
| `HFP_LIVE=1 npm run test:e2e -- --grep @live`                                  | L4 live smoke against the real pixiv (`e2e/live/**`, ignored otherwise) |
| `npm run qa:fake` / `npm run qa:live`                                          | QA sessions (below)                                                     |

- Chromium runs **headed** locally and **headless** (`--headless=new`) when `CI` is set. `HFP_HEADLESS=1` forces headless, `HFP_HEADLESS=0` headed.
- Each test gets a fresh profile and downloads directory; each Playwright worker has one fake server, reset before every test.
- On failure, `test-results/<test>/` holds `trace.zip`, `server-log.json`, `console-errors.json` and `downloads.json`.
- `ffprobe`/`ffmpeg` are optional. `ffprobe()` and `ssim()` skip the calling test with a reason when the tool is not on `PATH`.
- Chromium comes from the Playwright browser cache (`npx playwright install chromium` if missing).
- The live smoke navigates with `waitUntil: 'domcontentloaded'`, never `load`: pixiv's `load` waits on ads and trackers (43–119 s in QA's runs). The button and file waits carry their own timeouts. Besides the all-ages download it has a login-wall case (R-003): a logged-out, all-ages ranking work whose `/ajax/illust` withholds `urls.original` must read `Log in to download` before any click and open pixiv's login with `return_to`. It is skipped with a logged reason when the day's ranking has no such work.

## Layout

| Path                 | Contents                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `harness/launch.ts`  | `launch()` and the `Harness` object (CDP connection, SW helpers, downloads)                                     |
| `harness/test.ts`    | Playwright `test` with the `server`, `harness` and `uiLocale` fixtures; import specs' `test`/`expect` from here |
| `harness/console.ts` | console-error collection from pages, the SW and the offscreen document                                          |
| `harness/media.ts`   | `ffprobe()`, `ssim()`, `hasMediaTool()`                                                                         |
| `server/server.ts`   | the fake pixiv HTTPS server: routing, faults, request log, `maxInFlight`                                        |
| `server/ajax.ts`     | `/ajax/illust` JSON bodies; `isWalled(work, loggedIn)` (login walls)                                            |
| `server/page.ts`     | fixture page HTML, SPA script, `window.__fake` controls, login page                                             |
| `fixtures/works.ts`  | the 14 fixture works and their URLs                                                                             |
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

| Member                                                                      | Purpose                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser`, `context`, `cdp`                                                 | Playwright browser over CDP, its default context (the extension's profile), browser-level CDP session                                                                                                                      |
| `wsEndpoint`                                                                | CDP endpoint for `chromium.connectOverCDP()`                                                                                                                                                                               |
| `extensionId`, `serviceWorkerUrl`                                           | resolved from the extension's service-worker target                                                                                                                                                                        |
| `newPage()`                                                                 | a new tab (a blank anchor tab keeps the window open, so closing a spec's tab never quits Chrome)                                                                                                                           |
| `swEval(fn, arg?)`                                                          | `Worker.evaluate` in the extension SW, starting the worker first if it is stopped                                                                                                                                          |
| `serviceWorker()`                                                           | the running SW as a Playwright `Worker`                                                                                                                                                                                    |
| `isServiceWorkerRunning()`                                                  | whether the SW target exists                                                                                                                                                                                               |
| `stopServiceWorker()`                                                       | `Target.closeTarget` on the SW, repeated every 300 ms (alternate rounds also `ServiceWorker.stopAllWorkers`) because Chrome can drop a stop request right after launch; resolves when the target is gone, throws after 5 s |
| `downloads.dir`, `downloads.files()`                                        | the downloads directory; recursive `{ path, size }` listing of completed files, `/`-separated, sorted. In-progress `*.crdownload` files, and files Chrome renames between the directory read and the `stat`, are left out  |
| `downloads.waitForFile(path, { timeout })`                                  | resolves when the file exists under its final name                                                                                                                                                                         |
| `consoleErrors()`, `allowConsoleErrors(...re)`, `unexpectedConsoleErrors()` | collected errors (`source`: `sw` / `offscreen` / `extension-page` / `page`)                                                                                                                                                |
| `close()`                                                                   | quits Chromium and removes temp dirs                                                                                                                                                                                       |

Also exported: `unpackedExtensionId(dir)`, `E2E_EXTENSION_DIR`, `DEV_EXTENSION_DIR`, `REPO_ROOT`. From `harness/media.ts`: `ffprobe(file)` (`-show_frames -show_streams` as JSON) and `ssim(video, framePaths)` (per-frame SSIM against the source frames cropped to even size from the top-left; `{ perFrame, mean, min }`).

**Chrome's download UI (R-005).** `harness/flows.ts` exports `downloadUi(harness)` = `swEval(() => self.__hfpTest.downloadUi())` → `{ requested, calls: [{ enabled, ok, at }] }`: the `enabled` value the running SW instance last asked `chrome.downloads.setUiOptions` for (`null` before its first call), and each call it made with the real Chrome's answer (`ok`) and the SW's `Date.now()` when it settled. Each SW instance reports only its own calls; Chrome has no getter for the UI itself, and Playwright cannot see the toolbar or bubble, so the visual effect is an L5 check (`docs/release-checklist.md`). Helpers: `downloadUiAfterBoot(harness)` waits until an idle worker's boot has turned the UI on (`requested: true`), a test's baseline; `downloadUiRestored(harness)` waits until the last call is `enabled: true`; `uiCalls(calls, from)` drops the times. `self.__hfpTest` exists only in `dist-e2e/` and also carries `clickAction(tabId)`.

## Fake server (`server/server.ts`)

HTTP/2 (with HTTP/1.1 fallback) on `127.0.0.1`, ephemeral port, certificate generated at start by `selfsigned` (nothing committed). Routed by `Host`:

- **`www.pixiv.net`**: `/artworks/:id`, `/<lang>/artworks/:id`, `/users/:id` and `/` (fixture pages); `/ajax/illust/:id`, `/:id/pages`, `/:id/ugoira_meta`. `/pages` and `/ugoira_meta` of an `xRestrict ≥ 1` work answer `{ error: true }` unless the request carries `PHPSESSID=fake-session`, and always when the work has `r18Hidden`. Deleted or unknown works: 404 `{ error: true }`. Login walls: below.
- **`i.pximg.net`**: `/img-original/…`, `/img-master/…`, `/img-zip-ugoira/…` return **403 unless `Referer` is exactly `https://www.pixiv.net/`**. Bytes carry `Content-Length` unless the work has `noContentLength` (then chunked). `/__harness/ok.bin` (`HARNESS_BLOB`) has no Referer check.
- **`accounts.pixiv.net`**: `GET /login?return_to=…` shows a "Log in" button (or redirects straight back when already logged in); its `POST` sets `PHPSESSID=fake-session` on `.pixiv.net` and redirects to `return_to` (only `https://www.pixiv.net/…` targets are honored).
- `/favicon.ico` answers 204 everywhere.

**Login walls** mirror live pixiv (R-003, [system.md §8.5](../docs/design/system.md)). A work flagged `sensitiveWall` is all-ages but behind pixiv's sensitive-content wall.

- `/ajax/illust/:id` sends `sl` 6 for `xRestrict ≥ 1`, 4 for a `sensitiveWall` work, else 2.
- Logged out, it sends every `urls` key as `null` for an R-18/R-18G or `sensitiveWall` work (`isWalled(work, loggedIn)` in `server/ajax.ts`). Logged in, the URLs are present.
- `/pages` and `/ugoira_meta` of a `sensitiveWall` work answer normally while logged out, as pixiv's do. A passing test therefore proves the extension, not the server, withholds the download.
- Logged out, the artwork page of a `sensitiveWall` work shows pixiv's wall text (`This work may contain sensitive content.` / `Please log in to view this work.`) instead of the image; the action row stays.

| Member                                                                                              | Purpose                                                                                                              |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `startFakePixiv(port?)`                                                                             | start a server                                                                                                       |
| `port`, `hostResolverRules`                                                                         | listening port; the `--host-resolver-rules` value                                                                    |
| `fault({ match, responses })`                                                                       | script responses (below)                                                                                             |
| `hold(match)` → `{ held, release() }`                                                               | keep matching 200 transfers in flight without stalling until `release()` (below)                                     |
| `clearFaults()`                                                                                     | drop every fault rule                                                                                                |
| `patchWork(id, { title, userName, xRestrict, sensitiveWall, r18Hidden, noContentLength, deleted })` | override fixture fields until `reset()`                                                                              |
| `work(id)`                                                                                          | the fixture as served (with patches)                                                                                 |
| `log`, `requests(match?)`                                                                           | every request: `at`, `method`, `host`, `path`, `url`, `referer`, `loggedIn`, `status`, `bytes`, `artworkId`, `fault` |
| `waitForRequest(match, { timeout })`                                                                | first matching request, already logged or future                                                                     |
| `maxInFlight(artworkId)`                                                                            | peak concurrent original/zip requests for one artwork                                                                |
| `reset()`                                                                                           | clear log, faults, patches and peaks (the `harness` fixture does this per test)                                      |
| `close()`                                                                                           | stop                                                                                                                 |

**Faults.** `match` is a substring of, or a RegExp tested against, the full URL. `responses` is one response, applied to every match until `clearFaults()`, or an array consumed one per matching request (e.g. per retry attempt), after which the rule is gone. A response is a status number or an object:

| Response                           | Effect                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `503`, `{ status: 403 }`           | answer with that status (JSON `{ error: true }` on `/ajax/`, text otherwise)                          |
| `{ status: 429, retryAfter: 120 }` | with a `Retry-After` header                                                                           |
| `200`                              | answer normally (e.g. the last element of `[503, 503, 200]`)                                          |
| `{ delayHeadersMs: 100 }`          | answer normally after a delay; must stay under the 300 ms stall timeout (below)                       |
| `{ stallAfterBytes: 1024 }`        | send headers and 1024 body bytes, then go silent                                                      |
| `{ reset: true }`                  | drop the request without a response (HTTP/2 stream reset; socket destroy on HTTP/1.1) → network error |

**Stall timeout.** `dist-e2e/` scales the 30 s inactivity timeout by `__RETRY_TIME_SCALE__` (0.01) to **300 ms**. A response whose headers or next body chunk take 300 ms or longer counts as a `timeout` and is retried, so `{ delayHeadersMs: 300 }` (or more) does not delay a transfer: it fails the attempt. To keep transfers in flight (cancel mid-job, `maxInFlight`, badge counts while files are pending), use **`server.hold(match)`**: matching requests that would be answered 200 with a `Content-Length` get their headers at once, then their body one byte every 100 ms with the last byte held back, until `release()` (or `reset()`). The transfer never stalls, so nothing times out. A body of n bytes can be held for about (n − 1) × 100 ms (the smallest fixture page, 239 bytes, for ~24 s); after that it stalls and the client's retry starts a fresh hold. `held` counts the requests currently held. JSON answers can be held too, e.g. `/ajax/illust` so a click lands before the metadata arrives (`server.hold((r) => r.path === '/ajax/illust/135882745')` in `cuj5.spec.ts`).

```ts
const held = server.hold(pagesOf(EXAMPLE, range(5, 11))); // e2e/harness/flows.ts helpers
await clickButton(page);
await expect.poll(() => held.held).toBe(5);
// … assert the in-flight state …
held.release();
```

## Fixture page (`server/page.ts`)

A reduction of the ENG-002 live capture (`test/fixtures/pixiv/artwork-live-*.html`, `scripts/spike/FINDINGS.md` §5) to the hooks `src/content/pixiv-dom.ts` relies on: `<html data-theme="light|dark">` (theme marker), an artwork `<figure>` with the master image (logged out: an R-18 placeholder, or the wall text of a `sensitiveWall` work), the `figcaption` work marker, and the action row, rendered `ROW_DELAY_MS` (300 ms) after `load` or after an SPA navigation with `performance.mark('fake:row')` (`ROW_MARK`). As on pixiv, the row's DOM order is share, bookmark, like, laid out `flex-direction: row-reverse` (screen order like, bookmark, share). The extension therefore inserts its host **after** the like wrapper in the DOM, which puts it immediately left of Like on screen: in specs, the host's `previousElementSibling` is the like wrapper. Related works carry their own Bookmark mini-buttons, and `<script id="__NEXT_DATA__">` carries `props.pageProps.isLoggedIn` from the request's cookie. Links marked `data-spa` navigate with `history.pushState`; back/forward re-render.

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
| 135882745 | 4-page illust, `xRestrict` 0, `sensitiveWall` (`sl` 4), うみ          | R-003 wall: needs-login, pending click, login     |
| 145892669 | 68 pages, `xRestrict` 1, ヨル                                         | needs-login, login round-trip; `r18Hidden`        |
| 136004512 | ugoira 600×600, 48 JPEG frames × 100 ms                               | CUJ-2 example                                     |
| 136004513 | ugoira, delays 40, 40, 500, 40                                        | timing exactness                                  |
| 136004514 | ugoira 601×451                                                        | even-dimension crop (600×450)                     |
| 136004515 | ugoira, no `Content-Length`                                           | indeterminate arc                                 |
| 136004516 | ugoira, frame 5 is not an image                                       | encode failure → `Retry · MP4`                    |
| 136004517 | ugoira 1920×1080, 300 frames                                          | long encode, ≥ 1 progress/s, tab close mid-encode |
| 136120877 | 8 pages, そら                                                         | CUJ-4 tab B                                       |
| 199999999 | deleted (ajax 404)                                                    | Unavailable                                       |

Bytes are generated on first use and cached per process (`fixtures/assets.ts`): images are flat 16×16 tiles (checkerboards for pages, a gradient with a moving square for frames), zips are stored entries with a fixed timestamp. Specs that need the expected bytes call `pageBytes()`, `ugoiraFrames()` or `ugoiraZip()`.

Zips are prebuilt at server start: `startFakePixiv()` builds every ugoira fixture's zip before it listens (ENG-009). Built on its first request instead, the 1080p zip of 136004517 took ~1.5 s, longer than the 300 ms stall timeout, and failed that download attempt. Specs need no warm-up; the harness self-test `fake server: fixture zips are prebuilt` guards this.

## QA sessions

- `npm run qa:fake`: builds `dist-e2e/`, starts the fake server, launches headed Chromium with a persistent profile at `.qa/profile` and downloads at `.qa/downloads`, opens the CUJ-1 example, and prints the CDP endpoint, extension ID and fixture URLs. In a terminal it opens a REPL with `server`, `harness`, `page` and `works` (e.g. `server.fault({ match: '_p3.', responses: [503, 503, 200] })`, `await harness.swEval(() => chrome.action.getBadgeText({}))`); `.exit` closes everything. Without a terminal (an agent running it in the background) there is no REPL; attach with `chromium.connectOverCDP(endpoint)` and stop it with SIGINT/SIGTERM.
- `npm run qa:live`: builds `dist/` and launches headed Chromium against the real pixiv with a persistent profile at `.qa/profile-live`, so a human can log in once for R-18 paths.

QA reports cite the spec or fixture used, so failures are reproducible.

## Acceptance-criteria mapping

Skeleton: every PRD acceptance criterion (docs/prd/prd-000-mvp.md), the check that proves it, and the spec that will own it. Specs keep the detailed AC → test mapping in a comment block at their top. "L1" means a unit test covers it; "L5" means the manual release checklist.

### CUJ-1 (`cuj1.spec.ts`, `@cuj1`, task 4.1)

| PRD AC                                                                                                                                      | Check                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One button, immediately left of like, ≤ 500 ms after the row renders                                                                        | one `hfp-download`; its `previousElementSibling` is the like wrapper (row-reverse row); `fake:row` mark → host connected ≤ 500 ms                                                                                                                                                                                                                                                                               |
| `Download · 12P` / `Download` (single page)                                                                                                 | idle label on 135882741 / 135882742                                                                                                                                                                                                                                                                                                                                                                             |
| 164 px in idle, busy, Cancel-hover, Saved; width never changes                                                                              | host `getBoundingClientRect().width` in each state, including after hover                                                                                                                                                                                                                                                                                                                                       |
| 164 px also when the metadata arrives after the row (PRD §4.7.2 provisional width)                                                          | `server.hold('/ajax/illust/135882741')` before load; a `ResizeObserver` on the host records only 164 through `Download` → `Download · 12P` ('width: late metadata')                                                                                                                                                                                                                                             |
| Folder holds `metadata.json` + `135882741_p0` … `p11`, sizes = `Content-Length`                                                             | `downloads.files()` vs `server.log` `bytes`                                                                                                                                                                                                                                                                                                                                                                     |
| `metadata.json`: 12 keys in order, literal non-ASCII, `\n` kept                                                                             | key order; raw bytes contain `みずき`, not `\u` escapes                                                                                                                                                                                                                                                                                                                                                         |
| Never > 5 of this artwork's files in flight                                                                                                 | `server.maxInFlight('135882741') ≤ 5` with `server.hold()`; `chrome.downloads.search({ state: 'in_progress' })` sampled                                                                                                                                                                                                                                                                                         |
| `N / 12` only rises; `12 / 12` only after every original; metadata never changes N                                                          | label texts recorded by a `MutationObserver`                                                                                                                                                                                                                                                                                                                                                                    |
| Cancel stops the job, keeps completed files, back to `Download · 12P`                                                                       | held responses (`server.hold()`); hover after `pointerleave`; click; no new `_pN` requests in `server.log`                                                                                                                                                                                                                                                                                                      |
| `Saved · 12P` style and tooltip                                                                                                             | label, computed styles, `title`                                                                                                                                                                                                                                                                                                                                                                                 |
| SPA away and back shows Saved; reload shows idle                                                                                            | `data-spa` links, `page.goBack()`, `page.reload()`                                                                                                                                                                                                                                                                                                                                                              |
| Clicking Saved downloads again as `(1)` duplicates                                                                                          | second click; `downloads.files()`                                                                                                                                                                                                                                                                                                                                                                               |
| Closing the tab does not stop the job                                                                                                       | `page.close()`, then `downloads.waitForFile()`                                                                                                                                                                                                                                                                                                                                                                  |
| Badge counts pages remaining and disappears at the end                                                                                      | `swEval(() => chrome.action.getBadgeText({}))`                                                                                                                                                                                                                                                                                                                                                                  |
| Tab / Enter / Space, 2 px focus ring, `aria-busy`                                                                                           | keyboard only; computed outline; attribute                                                                                                                                                                                                                                                                                                                                                                      |
| Dark theme identical                                                                                                                        | `__fake.setTheme('dark')`; same computed fill, text, icon                                                                                                                                                                                                                                                                                                                                                       |
| Pattern change mid-job does not move the job (also CUJ-3 "while a download runs")                                                           | change settings mid-job; files land in the original folder                                                                                                                                                                                                                                                                                                                                                      |
| Chrome's download bubble does not appear or animate during the job, for any file including the first; available again after it ends (R-005) | `downloadUi()` with the originals held: `requested: false` and one `{ enabled: false, ok: true }` whose `at` ≤ the earliest `startTime` of the job's `chrome.downloads.search` items (`metadata.json`); after `Saved · 12P` the job's calls are that hide and one `{ enabled: true, ok: true }`; the same restore after a cancel and after every original answers 504 ('download UI'). The animation itself: L5 |

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
| S5: `pixiv/{user` and a pause: `Unknown token {user. …`, no `Saved`, reload shows the last valid pattern   | `pressSequentially`; `Saved` recorder; `chrome.storage` via `swEval`; `page.reload()` |
| S5: a lone `}` is literal: `pixiv/a}b` is valid and saved                                                  | `Saved`; `chrome.storage`                                                             |
| S15: error state in all 4 locales: `Still using:` on one line, the default pattern unbroken                | `test.use({ uiLocale })`; `.label` and `.pattern` each have one client rect           |
| (edge) Paste with newlines drops them; validation runs as usual                                            | clipboard paste (QA's 3 lines, a trailing newline); `keyboard.insertText`             |
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

| PRD AC                                                                                    | Check                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Badge `23`, `#1f1f1f`/white, tooltip "… 23 files remaining across 2 downloads"            | two tabs (one of them 136120877) held at 18 + 5 remaining with faults; `swEval(getBadgeText/getTitle/getBadgeBackgroundColor)`                                                                                                                                                                                                                                                                     |
| One-job tooltip forms (`5 files` / `1 file`)                                              | `swEval(getTitle)`                                                                                                                                                                                                                                                                                                                                                                                 |
| Each tab shows only its own artwork's progress                                            | both labels                                                                                                                                                                                                                                                                                                                                                                                        |
| Badge decreases within 1 s of any file landing                                            | poll after each `downloads.files()` change                                                                                                                                                                                                                                                                                                                                                         |
| A second artwork starts immediately                                                       | `server.log` shows both artworks' byte requests overlapping                                                                                                                                                                                                                                                                                                                                        |
| Cancelling one job drops the badge by its remaining count                                 | badge before/after                                                                                                                                                                                                                                                                                                                                                                                 |
| Last file → badge gone, idle tooltip                                                      | `getBadgeText` `''`, `getTitle`                                                                                                                                                                                                                                                                                                                                                                    |
| ≥ 1000 shows `999+`                                                                       | L1 (badge formatting)                                                                                                                                                                                                                                                                                                                                                                              |
| SW stopped mid-job: badge correct within 1 s, jobs complete                               | `stopServiceWorker()`, then poll ≤ 1 s after the next event                                                                                                                                                                                                                                                                                                                                        |
| Toolbar click while jobs run opens settings, jobs unaffected                              | e2e hook or `openOrFocusOptions` via `swEval`                                                                                                                                                                                                                                                                                                                                                      |
| Chrome's downloads button stays hidden until both jobs end (R-005)                        | `downloadUi()`: job B ends while job A runs → no new call; A ends → `{ enabled: true, ok: true }` ('download UI: two jobs')                                                                                                                                                                                                                                                                        |
| SW restart (R-005): hidden until the job ends; a worker woken with no job turns the UI on | `stopServiceWorker()` mid-job → the new instance reports `{ requested: null, calls: [] }` after its boot, then a hide and `{ enabled: true, ok: true }` around the job's end; `swEval(() => chrome.downloads.setUiOptions({ enabled: false }))`, `stopServiceWorker()`, a pixiv page wakes it (`job/listForTab`) → its first call is `{ enabled: true, ok: true }` ('download UI: service worker') |

### CUJ-5 (`cuj5.spec.ts`, `@cuj5`)

The AC → test mapping at the top of `cuj5.spec.ts` (30 tests), numbered as in docs/prd/prd-000-mvp.md CUJ-5 "Acceptance Criteria"; tests are named by their title prefix.

| PRD AC                                                                                                                                                                                                          | Test                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1 Logged out, `xRestrict ≥ 1`: `Log in to download` (white, `#c4c7c5` border, `#3c4043` text, no icon) before any click, tooltip; no other text                                                                 | 'needs login'                                                          |
| 2 Click → `accounts.pixiv.net/login?return_to=<encoded URL>`; after login `Download · 68P`                                                                                                                      | 'login round-trip'; 'logged in elsewhere'                              |
| 3 Logged out, all-ages: normal idle `Download · NP`, download succeeds                                                                                                                                          | 'logged out all-ages'                                                  |
| 4 Logged out, all-ages behind pixiv's sensitive-content wall (R-003): `Log in to download` before any click, same styling and tooltip, name `Log in to pixiv to download this work.`; login → `Download · 4P`   | 'needs login (R-003)' (3 tests: walled work, pending click, logged in) |
| 5 Some pages fail after 4 attempts: `Retry · 3 failed`, red outline, warning triangle, same width, exact tooltip                                                                                                | 'partial'                                                              |
| 6 `Retry · 3 failed` fetches only the 3 pages into the same folder, ends `Saved · 12P`                                                                                                                          | 'partial'                                                              |
| 7 Network disconnected → `Retry` + "No connection…"                                                                                                                                                             | 'offline'; 'sustained outage' (last click)                             |
| 8 Sustained outage (every image request 500/503): every click → `Retry` + "pixiv isn't responding…", including the 7th consecutive Retry; none reads "No connection…" (R-004 S3)                                | 'sustained outage'                                                     |
| 9 Logged in, R-18 display off → `Retry` + "pixiv refused this work…"                                                                                                                                            | 'refused' (2 tests)                                                    |
| 10 Deleted after page load → gray `Unavailable`, click does nothing                                                                                                                                             | 'unavailable' (2 tests)                                                |
| 11 Encode fails: zip + `frames.json`, no video, `Retry · MP4` + exact tooltip; clicking it produces only the video                                                                                              | 'encode failure' (2 tests)                                             |
| 12 403 on originals mid-job: saved files stay, back to `Log in to download`                                                                                                                                     | '403 mid-job'                                                          |
| 13 No error state shows a badge unless another job is in flight                                                                                                                                                 | 'badge in error states'; also every error test                         |
| 14 Cancelling never produces red styling or any message                                                                                                                                                         | 'cancel a retry'                                                       |
| 15 Action row removed before navigation → floating pill at the artwork's bottom-right within 3 s of the page loading or of the in-app navigation, measured to the pill appearing (R-004 S4); downloads normally | 'floating fallback' (2 tests)                                          |
| 16 403 never retried; 429/500/502/503/504 and network errors retried up to 4 attempts                                                                                                                           | 'retry policy'; '403 mid-job'; 'partial'                               |
| Edge: 5xx with 0 pages saved → `Retry` + "pixiv isn't responding…"                                                                                                                                              | 'server failure'                                                       |
| Edge (step 6, accepted cost): the API answered, then every original drops its connection → `Retry` + "pixiv isn't responding…"                                                                                  | 'server failure: every original drops'                                 |
| Edge: exactly 1 failure → `Retry · 1 failed` + `tip_partial_one`; reload clears the failure memory and a click re-runs the whole job                                                                            | 'partial one'                                                          |
| Edge: retry after the pattern changed still writes into the original folder                                                                                                                                     | 'partial'                                                              |
| Edge: logged out in another tab after load → `Retry` + refused                                                                                                                                                  | 'refused … logged out'                                                 |
| Edge: 429 with `Retry-After: 120` waits min(RA, 30) s (×0.01 in `dist-e2e/`)                                                                                                                                    | 'retry policy'                                                         |
| Edge: floating fallback on pixiv's dark theme: `#5fb9fb` focus ring                                                                                                                                             | 'floating fallback'                                                    |

"No connection" is judged per click (system.md §10 row 8, D13): only when no request of the click's job got an HTTP response. A disconnected network is simulated by dropping every pixiv request (`reset`). Tests that count 4 server attempts use 502/504: under the ×0.01 backoff, Chromium throttles an extension's repeated 500/503 requests, so a later quick attempt never reaches the server. 'sustained outage' uses 503 on purpose, because the job's API calls answered and every click reads "pixiv isn't responding" whatever the throttling refuses; it records the server hits per click as an annotation. Not covered here: "only `metadata.json` failed" (L1/L2). QA's dev-build replay covers 500/503 under the real backoff and a stopped server (`diagOutage.ts`).
