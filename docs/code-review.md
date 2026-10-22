# Code Review — dev-cycle iteration 1 (Phase 3.6)

> Reviewed: 2026-10-22 21:44:39 (UTC+9)
> Scope: `git diff 2bf5ac3..3baab1a` (18 tasks, 4 groups; the whole extension from scratch) plus the review's own fix commits `38e35eb`, `aa1499e`, `d5243e8`, `a15a74d`
> Guidelines: no `docs/*-guidelines.md` exist; reviewed against `docs/design/*` and standard engineering practice.

## Code Review Summary
- Files reviewed: 189 in the diff. Read in full: all 58 `src/**/*.ts` modules (except the generated `src/shared/html-entities.ts`), `manifest.json`, `scripts/build.mjs`, the CI workflow, the e2e harness core (`launch.ts`, `flows.ts`, `test.ts`, `harness.spec.ts`, the `server.ts` hold/fault paths) and the fixture captures. Unit tests and CUJ specs were sampled, not read line by line.
- Issues found: 0 critical · 11 warnings · 2 info
- Auto-fixed: 5 (4 fix commits)
- Final gates on main after the fixes: `npm ci && npm run check` passes (typecheck 0 errors, eslint 0, prettier clean, 2671/2671 vitest tests in 62 files, build). `HFP_HEADLESS=1 npm run test:e2e`: **71 passed, 0 failed** (was 69 / 2).

## Checklist results

| Area | Result |
|---|---|
| Type check | `tsc --noEmit`: 0 errors. No `any` in `src/`, `test/` or `e2e/`. No `@ts-ignore`/`@ts-nocheck`. The one `@ts-expect-error` (`test/unit/i18n.test.ts:41`) tests an invalid key on purpose. No `eslint-disable`. |
| Casts | All justified. `fetch-bytes.ts:35` (`Uint8Array` → `Uint8Array<ArrayBuffer>`) is deliberate and documented: `retry.ts` allocates a plain `ArrayBuffer`. `retry.ts:186-204` casts per response-type branch because TS cannot narrow a generic. `content.ts:239` (SW response) and `registry.ts:181` (hydrated `storage.session` record) are unchecked but read same-package data: `storage.session` is cleared on extension update or reload. `options/strings.ts:36-42` (`data-i18n` → `MessageKey`) is backed by `test/unit/i18n-keys.test.ts`. |
| MV3: content script | `dist/content.js` is an IIFE with no top-level `import`/`export`. No `node_modules/(mediabunny\|fflate)` in `dist/sw.js` or `dist/content.js`. |
| MV3: listeners | `sw.ts` registers `runtime.onMessage`, `downloads.onChanged` and `action.onClicked` synchronously at top level; `ready` is created in the same evaluation. `offscreen.ts` registers at top level. |
| MV3: permissions | Manifest is exactly the frozen set (4 permissions, 2 hosts, min Chrome 116, no popup, no web-accessible resources). Locked by `test/unit/manifest.test.ts`; re-verified by ENG-001's Verify. |
| Prod build hooks | `npm run build:prod && ! grep -qE '__testHook\|__hfpTest' dist/sw.js` passes. See W5: it passes by import aliasing, and 8 dead hook calls remain in the bundle text. |
| pixiv selectors | Only in `src/content/pixiv-dom.ts`. The other `querySelector`/`getElementsByTagName` calls (`mount.ts:88`, `button/view.ts:198-199`) query our own elements. |
| `innerHTML` | Only in `src/content/button/icons.ts` (constant SVG). ESLint `no-restricted-properties` enforces this. |
| Secrets | None in code. `test/fixtures/pixiv/*.html` have `api.token` zeroed. The remaining hex strings are pixiv's public Sentry key and per-request trace IDs from a logged-out capture, which are not secrets. The fake server uses `PHPSESSID=fake-session`. |
| DNR rule | `dnr.ts`: `requestDomains: ['i.pximg.net']`, `initiatorDomains: [chrome.runtime.id]`, `tabIds: [-1]`, `resourceTypes: ['xmlhttprequest']`, set `Referer` only. This is the variant ENG-002 verified live again in this review. |
| Allowlists | API URLs: `PIXIV_API_URL_RE` is checked in the guards, the content proxy and offscreen `fetchApiJson`. Bytes: `i.pximg.net/` prefix is checked in `parsePages`/`parseUgoiraMeta`, the guards and offscreen `assertAllowed`. File names: `FILE_BASENAME_RE`. Echoed folders: `isSafeRelativeFolder` in `handlers.ts`. |
| Sender checks | SW: content requests need `sender.tab.id` and `sender.id === runtime.id`; offscreen events need `sender.url === offscreen.html`. Offscreen: rejects any sender with a `tab`. Content script: none, and none is needed, because only this extension can reach a content script's `runtime.onMessage` and `api/fetchJson` is allowlisted. |
| Throttles | Offscreen progress at most once per 250 ms per task (`offscreen.ts` `PROGRESS_INTERVAL_MS`). Tab pushes at most once per 250 ms per job, plus a trailing push (`pusher.ts`). Badge coalesced over 50 ms (`BADGE_COALESCE_MS`). Display-only persists at most once per second (`registry.ts`). |
| Encode memory | One frame in flight: decode → draw → `bitmap.close()` → `await source.add()` → `sample.close()` (`encode.ts`). Zip entries are extracted one at a time through the `unzipSync` filter. |
| Concurrency | At most 5 files in flight per job (`scheduler.ts` `pump`, cap counts `fetching ∪ ready ∪ saving`). e2e `maxInFlight` checks pass. |
| NUL sentinel | No NUL use remains in `src/` (the only `\x00` is the control-char class in `pattern.ts:48`). `splitOnPlaceholder` uses U+FDD0. The test stub cuts substitutions at U+0000 as Chrome does. |

## Critical Issues (must fix before QA)
None.

## Warnings (should fix)
1. **[src/background/badge.ts:38-42] The action title can read "0 files remaining".** A lone `retryMetadata` job, or a `full` job resolving with `expectedFiles` 0 (clicked before metadata arrived), counts as a running job with 0 remaining. The title then becomes `action_title_one` with 0 while the badge is hidden. The PRD §4.8 defines no 0-file title, and the hidden badge means "nothing in flight". Recommend `total === 0 → action_title_idle`, and deciding whether "across N downloads" counts 0-file jobs. This is user-visible, so it goes to next cycle's design (design-download-engine "Badge") rather than a silent fix.
2. **[src/background/engine.ts:174] A refused or unreachable offscreen command fails the file as `network`.** If every file fails this way, the job ends `error: offline` ("No connection…"), which misleads: the cause is internal. `FailureKind` (system.md §6) has no internal kind. Recommend adding `internal` to `FailureKind` and classifying it as `server` in row 8. This is a system.md §6/§10 change.
3. **[src/shared/pattern.ts:121, `chromeSafeSegment`] A token value made only of `~`/`.` (after parity sanitization) drops a whole folder level instead of becoming `unknown`.** Probe: `resolveFolder('pixiv/{artist}/{title}', artist '~')` → `pixiv/T`. Artist `...` gives `pixiv/unknown/T` (correct), and `.~.` gives `pixiv/T` (wrong). Fix in design: apply the D8 edge trim to each token value before substitution, falling back to `unknown`, or substitute `unknown` when a segment made only of a token resolves empty.
4. **[docs/design/design-settings-model.md "Golden examples"] Design row `~sora~-1 → sora~-1` contradicts step f.** `sora~-1` is 8.3-shaped, so step f replaces `~`. The code yields `sora_-1` (probe confirmed). The code follows the normative step, and the example row is wrong.
5. **[src/background/engine.ts:12, registry.ts:9, resolver.ts:21] The prod hook guard passes by name only.** `__testHook` is imported under the alias `testHook`, so the grep check passes, but the unminified prod `dist/sw.js` still contains 8 dead `if (false) await testHook("await:…")` statements. The unit test that design-test-harness.md "Build variant" calls for (prod bundle has no hooks) does not exist. Filed **ENG-007** (esbuild `minifySyntax` for `--prod`, drop the aliases, add a CI bundle check).
6. **[src/shared/{messages,outcome,progress,pixiv-api}.ts, src/content/button/model.ts] Shared and content modules import types from `src/background/types.ts`** (`JobRecord`, `FileTask`, `StartRequest`, `UgoiraState`, `ErrorCode`). These are type-only imports with no runtime cost, but the layering is inverted: `src/shared` should not depend on the SW. Recommend moving the job and protocol types into `src/shared` (e.g. `shared/job.ts`) and stating it in system.md §6.
7. **[content bundle] 35.2 KB minified / 12.9 KB gzip vs the "< 30 KB" goal in design-artwork-button.md.** No single offender: `labels.ts` 4.6 KB, `retry.ts` 3.8, `model.ts` 3.8, `styles.ts` 3.2, then 2-3 KB each for `pixiv-dom`/`content`/`mount`/`view`. Recommend restating the goal (e.g. ≤ 40 KB minified, ≤ 15 KB gzip) instead of trimming function.
8. **[src/offscreen/offscreen.ts:219] Encode failures always report `attempts: 1`.** `EncodeError` does not record whether the prefer-software retry ran. This is observability only. Expose the attempt count from `encodeUgoira`.
9. **[src/content/mount.ts:18] `PILL_HEIGHT_PX = 40` duplicates `height: 40px` in `button/styles.ts:29`.** Export it from `styles.ts` and interpolate it in the CSS. (`hasBox` is also duplicated in `mount.ts:230` and `pixiv-dom.ts:187`; this is trivial.)
10. **[design drift] The implementation extends the design additively. Fold these into the docs next Phase 1:**
    - `ActionRowHit` is `{ group, like, side, via }` (row-reverse row; design says `{ group, before }`);
    - the fallback timer runs from route entry and is never cancelled;
    - `FileTask.text?`;
    - Effect `cancelDownload`;
    - `retryEncode` also fetches `/ajax/illust/{id}` (frame size for the probe key);
    - `PatternError` 7th code `tooLong`;
    - `writeSettings` returns `{ ok, updatedAt }`;
    - `off/ready` for a `save: false` zip carries no `blobUrl`;
    - `RetryOptions.responseType` adds `rawBytes`;
    - system.md §11.4 still names `\u0000` as the `splitOnPlaceholder` sentinel (now U+FDD0, because Chrome cuts substitutions at NUL).
11. **[e2e/server] The fake server builds a zip synchronously on first request.** For 136004517 (1080p, 300 frames) this takes ~1.5 s, beyond the e2e build's 300 ms stall timeout. Specs work around it with `warmZip()`, which is now documented in `e2e/README.md`. Building fixture zips at server start would remove the trap.

## Info
1. Keyboard tab order puts the button after Like. pixiv's row is `row-reverse`, so the host sits after the like wrapper in the DOM. The PRD edge case says "between More and Like", but that is not an AC. Visual placement is correct: immediately left of Like.
2. Logged-in DOM and the dark-theme capture remain unverified live, because a logged-out session cannot switch theme (FINDINGS §4). Cover in QA (`npm run qa:live` with an account) and in L5.

## Fixed
1. **[e2e/harness/launch.ts `listFiles`]** `stat` raced Chrome renaming `Unconfirmed *.crdownload`, so `downloads.files()`/`waitForFile()` threw ENOENT mid-download. This failed `cuj3.spec.ts` "a download started while the field holds an invalid edit uses the last valid pattern". Listings now skip `.crdownload` entries and files that vanish before `stat`. The `listDownloads`/`waitForDownload` workaround in `e2e/harness/flows.ts` is folded back (call sites in `cuj1`, `cuj4` and `live/smoke` use `harness.downloads` directly). Commit `38e35eb`.
2. **[e2e/harness/launch.ts `stopServiceWorker`]** Root cause, measured: in ~2 of 24 runs right after launch, Chrome answers `Target.closeTarget` with `success: true` and keeps the same SW target alive. A second close about 300 ms later always worked. The helper now repeats the close every 300 ms (alternate rounds also send `ServiceWorker.stopAllWorkers`) within a 5 s budget. Stop latency over 48 parallel runs: p50 63 ms, p90 334 ms, max 361 ms. The self-test keeps ENG-004's 2 s budget (more than 5× headroom), with the rationale in a comment. Commit `38e35eb`.
3. **[e2e/README.md]** Was stale. Now documents:
   - the row-reverse placement (the host's `previousElementSibling` is the like wrapper);
   - the 300 ms e2e stall timeout and why `{ delayHeadersMs: 300 }` fails attempts instead of delaying them;
   - `server.hold()` (new, previously undocumented), with an example;
   - the completed-files-only listing;
   - the retrying SW stop;
   - the 1080p zip pre-build;
   - the fixture page as a reduction of the live capture rather than a placeholder.

   Commit `aa1499e`.
4. **[test/fakes/chrome.ts]** `new URL('../../src/manifest.json', import.meta.url)` became a server URL under happy-dom ("The URL must be of scheme file"). It now reads by file path, as in `test/helpers/i18n-stub.ts`. Verified with a throwaway happy-dom test, which failed before the change and passed after it. Commit `d5243e8`.
5. **[src/shared/constants.ts]** Removed duplicated constants:
   - `offscreen.html` (3 copies: `engine.ts`, `offscreen-client.ts`, `messages.ts`) → `OFFSCREEN_DOCUMENT_PATH`;
   - the 200-page limit (`messages.ts`, `engine.ts`) → `MAX_PAGES_PER_WORK`;
   - the 1024-char folder limit (`messages.ts`, `pattern.ts` literal) → `MAX_FOLDER_CHARS`;
   - the ugoira output list (`settings.ts`, `options/page.ts`, `button/width.ts`) → `UGOIRA_OUTPUTS`.

   No behavior change. Commit `a15a74d`.

## Engineering-task verification (eng done-gate)

| ENG | Verify re-run | Evidence | Backlog |
|---|---|---|---|
| ENG-001 scaffold | `npm ci && npm run check && ! grep -qE '^(import\|export) ' dist/content.js && node -e …` on the post-fix tree | `SCAFFOLD OK`, exit 0, 2671/2671 tests | removed |
| ENG-002 platform spike | `node scripts/spike/run.mjs`, run live (network available) | exit 0; `referer-rule-offscreen: PASS`, `referer-rule-not-on-tab-traffic: PASS`, `blob-download-uniquify: PASS`, `cs-ajax-first-party: PASS`; DNR variant = system.md §8.2 as written; both captures present | removed |
| ENG-003 golden vectors | `python3 -I scripts/gen-golden.py && … --check && test ! -e ref/__pycache__ && node -e …` | `GOLDEN OK 323 148 19`; regeneration left the committed files unchanged (deterministic) | removed |
| ENG-004 e2e harness | `npm run build:e2e && npx playwright test e2e/harness.spec.ts --reporter=line` | 6 passed (the ja-locale case also passed on macOS); 36/36 with `--repeat-each=6 --workers=4` after the stop fix | removed |
| ENG-005 CI | `actionlint .github/workflows/ci.yml` (via `go run …/actionlint@latest`); `npm ci && npm run check && python3 -I scripts/gen-golden.py --check && npm run test:e2e` | actionlint exit 0; every step passed locally (e2e 71/71). `actions/checkout`, `setup-node` and `upload-artifact` `@v7` tags exist (checked with `gh api`). The Linux Actions run itself is not yet observed, because nothing has been pushed. | removed |

ENG-006 stays open. Filed **ENG-007** (P2): the prod bundle carries no test-hook code, checked in CI. `Next-ID` is now ENG-008.

## Design-level items for next cycle (Phase 1)

1. **Badge title with 0 remaining** (W1): design-download-engine "Badge" plus code.
2. **Internal failure kind** for refused or unreachable offscreen commands (W2): system.md §6 `FailureKind` and §10 row 8.
3. **Pattern edge cases** (W3, W4): token values that are only `~`/`.` drop a folder level; fix the "Golden examples" row `~sora~-1 → sora_-1`.
4. **Fold the implementation's additive deviations into the design docs** (W10):
   - `ActionRowHit` and the row-reverse placement;
   - the fallback timer;
   - `FileTask.text`;
   - Effect `cancelDownload`;
   - `retryEncode` API calls;
   - `tooLong`;
   - `writeSettings` return value;
   - `rawBytes`;
   - the §11.4 sentinel (U+FDD0).
5. **Fold the ENG-002 live selectors** (`scripts/spike/FINDINGS.md` §5) into system.md §8.2 and design-artwork-button.md "pixiv DOM contract":
   - like = icon + text label, with the SVG-signature fallback;
   - bookmark = `svg mask`;
   - menu = `aria-haspopup`;
   - theme `html[data-theme]`;
   - login `__NEXT_DATA__ props.pageProps.isLoggedIn`;
   - figcaption `illust/<id>` marker.

   Logged-in DOM and dark theme remain unverified live.
6. **Layering**: move the job and protocol types out of `src/background/types.ts` into `src/shared` (W6).
7. **Content bundle goal**: restate "< 30 KB" as a measured budget (W7).
8. **Encode attempts** observability (W8).
9. **Fake-server zip pre-build** at start (W11).
10. **PRD spec-sync items still open** (system.md §15, for pm via `/spec-sync`):
    - Chrome bubble wording for the blob byte path (CUJ-1 steps 2 and 5, CUJ-4);
    - D8 path safety vs PRD §4.4.3 "literal text is used as typed";
    - derived outcome mappings (§10 rows 4, 8, 9; WebM→MP4 fallback; ugoira metadata-only failure);
    - derived `_one` / `live_*` copy;
    - the PRD edge case "keyboard order between More and Like" vs pixiv's row-reverse DOM (Info 1).
