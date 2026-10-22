# Task Plan

Last updated: 2026-10-22 18:46:48 (UTC+9)

## Current State

- **Greenfield, iteration 1.** There is no code and no `package.json` yet. The PRD (`docs/prd/index.md`, `docs/prd/prd-000-mvp.md`, CUJ-1 to CUJ-5) and the full engineering design (`docs/design/system.md` plus the six `docs/design/design-*.md` chapters) are written. `docs/eng-backlog.md` has ENG-001 to ENG-006; ENG-001 and ENG-002 are `blocking`. There is no `docs/qa-report.md` and no `docs/pm-review.md`, so all five CUJs are unfinished. There are no bugs, and the owner queue is empty.
- **Focus (priority ladder):** tier 2 comes first: ENG-001 (Group 1), then ENG-002 (Group 2, which respects its "After ENG-001" ordering and still finishes before anything that needs it). Tier 3 follows, interleaved with the P1 ENG entries ENG-003 and ENG-004:
  - Group 2 builds every shared module and component that does not need the spike.
  - Group 3 builds the four runtime contexts: options page, service worker engine, offscreen document, and content-script integration.
  - Group 4 proves CUJ-1, CUJ-3, CUJ-4 and CUJ-2 end to end on the fake-pixiv harness, and adds CI (ENG-005, P2, one file).
  - When Group 3 is done, all of CUJ-5 is implemented: outcome classifier, retry modes, error, needs-login and floating states. Its e2e specs, ENG-006 (store packaging, P2, due before store submission) and the spec-sync follow-ups are deferred to the next iteration.
- **Orchestrator prerequisite:** `docs/design/`, `docs/eng-backlog.md`, `docs/loop-state.md`, `docs/rulings.md` (modified), `scripts/owner-lint.sh` and this file are not committed on `main`. Commit them before creating the Group 1 worktree. Every task below cites the design docs by section name, and a worktree branched from the current HEAD would not contain them.
- **Rules for every task:**
  - The done-gate is `npm run check` (typecheck + lint + test + build, system.md §12).
  - Only the tasks that say so may change `package.json` or `package-lock.json`.
  - The shared contracts created in task 1.1 are imported, not redefined: `src/shared/types.ts`, `src/background/types.ts`, the `src/shared/messages.ts` type catalog, `src/shared/constants.ts` and the `src/_locales/**` key set. In Groups 2 and 3, only the tasks named in Conflict Risks may edit them. Anywhere else, keep any new constant or type module-local and mention it in the task summary.
- **Document-authority notes (not blocking; recorded for tl/pm):**
  1. Open spec-sync items listed by tl in system.md §15 are still unresolved. The tasks implement the design for each, so pm should run `/spec-sync`.
     - (a) **Byte path D1.** Chrome's bubble lists a file once its bytes are complete, and a cancel leaves no "Canceled" entries. This differs from the wording of PRD CUJ-1 steps 2 and 5, which step 5 marks "(assumption — confirm)". Every CUJ-1 acceptance criterion still holds.
     - (b) **D8 Chrome path-safety pass.** PRD §4.4.3 says "Literal text in the pattern is used as typed". D8 also trims White_Space, `.` and `~` from whole segments, prefixes Windows reserved names and strips Cc/Cf characters. Without D8, Chrome refuses such paths ("Invalid filename"), which would break CUJ-1's acceptance criterion "`Downloads/pixiv/みずき-135882741/` contains `metadata.json` and exactly 12 originals" for those names. The PRD's own rationale in §4.4.2 is "Chrome's downloads API rejects a path segment that contains any of them". This plan follows the design and flags the deviation here rather than resolving it silently.
     - (c) **Derived outcome mappings** (system.md §10 rows 4, 8 and 9) and the derived `_one`/`live_*` copy keys.
  2. ENG-002 writes its findings to `scripts/spike/FINDINGS.md`. Tasks 3.2 (DNR rule variant) and 3.4 (pixiv selectors) read that file. tl should fold it into system.md §8.2 and the design-artwork-button.md section "pixiv DOM contract" next cycle.

## Parallel Group 1

### Task: 1.1 Scaffold the MV3 project, shared contracts and full copy deck (ENG-001)
- **Do**:
  1. **ENG-001 exactly as scoped in `docs/eng-backlog.md` (entry ENG-001).** Follow `docs/design/system.md` §3 "Tech stack", §4 "Repository layout", §5 "Manifest, permissions, minimum Chrome" and §12 "Build, test, release".
     - **`package.json` + `package-lock.json`.** Node ≥ 22, `"type": "module"`.
       - Runtime dependencies: `mediabunny@^1.62`, `fflate@^0.8.3`.
       - Dev dependencies: `typescript@~6.0.3` (must stay < 6.1), `esbuild@^0.28`, `vitest@^5`, `happy-dom@^21`, `eslint@^10`, `typescript-eslint@^8.72`, `prettier@^3`, `@types/chrome@^0.3`, `@playwright/test@^1.64`, plus `@types/node` if test or e2e typing needs it.
       - Scripts: `build`, `build:prod`, `watch`, `typecheck`, `lint` (= `eslint . && prettier --check .`), `test` (= `vitest run`), `check` (= typecheck + lint + test + build), and `golden` set to its final command `python3 -I scripts/gen-golden.py` (the script itself arrives with task 2.2).
       - Do not add `build:e2e`, `test:e2e`, `qa:fake` or `qa:live`; task 2.9 owns those.
     - **`tsconfig.json`.** Enable `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. It must cover `src/**`, `test/**`, `e2e/**` and the root `*.config.ts`. Add `src/globals.d.ts` declaring `__DEBUG__`, `__RETRY_TIME_SCALE__` and `__TEST_HOOKS__`.
     - **`eslint.config.js`.**
       - Use `recommendedTypeChecked`, with `@typescript-eslint/no-floating-promises: error`.
       - Add `no-restricted-properties` banning `innerHTML`/`outerHTML`/`insertAdjacentHTML` everywhere except `src/content/button/icons.ts`.
       - Ignore `dist/`, `dist-e2e/`, `ref/`, `docs/`, `.claude/`, `scripts/spike/**`, `test/fixtures/**`, `test/golden/**` and `node_modules/`.
     - **`.prettierrc` + `.prettierignore`.** Use the same ignores, plus `src/shared/html-entities.ts` (generated by task 2.2) and `package-lock.json`. Get these ignores right now: later groups run in parallel and must not need to edit them.
     - **`vitest.config.ts`.** Include `test/**/*.test.ts` only (never `e2e/`). Define `__DEBUG__=true`, `__RETRY_TIME_SCALE__=1` and `__TEST_HOOKS__=true`.
     - **`scripts/build.mjs`** as specified in ENG-001:
       - entries and formats: `content.js` is IIFE; `sw.js`, `offscreen.js` and `options.js` are ESM;
       - `target: chrome116`;
       - copies `src/manifest.json` (version injected from `package.json`), `src/_locales/**`, `*.html`, `*.css` and `src/icons/*`;
       - defines `__DEBUG__` / `__RETRY_TIME_SCALE__` / `__TEST_HOOKS__`;
       - flags `--watch` and `--prod`;
       - `--e2e` writes `dist-e2e/` with `__RETRY_TIME_SCALE__=0.01` and `__TEST_HOOKS__=true`, and the script refuses those values without `--e2e`.
     - **`src/manifest.json`** exactly as in system.md §5.
     - **Icons:** `assets/icon.svg` + `scripts/render-icons.mjs`, producing committed `src/icons/icon-{16,32,48,128}.png`. The design is a `#0096FA` rounded square with a white download glyph, as in the header icon of `docs/ux/prd-000-mvp-mockups/cuj-3-initial.html`.
     - **Entry stubs:**
       - `src/background/sw.ts`: synchronous top-level listener skeleton and an exported `ready` promise.
       - `src/content/content.ts`: `window.__hfpInit` guard.
       - `src/offscreen/offscreen.html` + `offscreen.ts`: listener registered at top level that ignores messages whose `target !== 'offscreen'` and returns `undefined`.
       - `src/options/options.html` + `options.ts`: sets `document.title = t('opt_tab_title')`.
     - **Tests:**
       - `test/unit/manifest.test.ts`: exact permissions, hosts and minimum version; no `default_popup`; no `web_accessible_resources`.
       - `test/unit/locales.test.ts`: identical key sets and placeholder counts across the 4 locales; `locale_tag` values are `en`/`ja`/`zh-CN`/`zh-TW`.
     - **`.gitignore`:** add `dist-e2e/`, `.qa/`, `test-results/`, `playwright-report/`, `*.zip` and `__pycache__/`.
  2. **Shared contracts**, so the 9 Group 2 tasks can build in parallel against them:
     - `src/shared/types.ts`: the normative sketch in system.md §6 "Shared data model" verbatim (`UgoiraOutput`, `Settings`, `SettingsSnapshot`, `WorkInfo`, `FailureKind`, `Failure`, `JobMode`, `ErrorCause`, `JobOutcome`, `JobProgress`, `JobView`), plus `RetryResult<T>` from system.md §9.
     - `src/background/types.ts`: `FileRole`, `FileState`, `FileTask`, `UgoiraState`, `JobRecord`, `StartRequest` and `ErrorCode`, from design-download-engine.md "Data Model" and "API / Interface Contract".
     - `src/shared/messages.ts`: a **type-only** catalog. Runtime guards are added by task 2.4. It contains:
       - the envelope `{ target: 'sw'|'offscreen'|'tab'; type }`;
       - every message in design-download-engine.md "API / Interface Contract" (content→SW, SW→tab, SW→offscreen);
       - every command and event in design-offscreen-worker.md "API / Interface Contract", including `off/ready`, `off/failed` and `off/progress` as SW-bound events;
       - the `{ ok: true, … } | { ok: false, error: ErrorCode }` response shapes.
     - `src/shared/constants.ts`, the single source for:
       - origins `https://www.pixiv.net` and `https://i.pximg.net`, the Referer `https://www.pixiv.net/`, the login URL `https://accounts.pixiv.net/login`, and the report URL `https://github.com/kyoicn/pixivhelper/issues` (R-001);
       - the API allowlist regex `^https://www\.pixiv\.net/ajax/illust/\d{1,12}(/pages|/ugoira_meta)?$`, the bytes prefix `https://i.pximg.net/`, and the basename regex `^[0-9A-Za-z_.-]{1,128}$`;
       - retry numbers from system.md §9: 4 attempts, 1500 ms base, 500 ms jitter, 30 s Retry-After cap, 30 s stall;
       - `MAX_IN_FLIGHT_PER_JOB = 5`, `PATTERN_MAX_CHARS = 200`, `TOKEN_MAX_BYTES = 60`;
       - storage keys `settings`, `job:` and `caps:`;
       - timings: 400 ms debounce, 2000/300 ms Saved, 3000 ms float fallback, 500 ms click guard, 5000 ms live-progress throttle, 5000 ms offscreen close grace, 50 ms badge coalesce;
       - badge colors `#1f1f1f` and `#FFFFFF`.
     - `src/shared/log.ts` per system.md §11.3.
     - `src/shared/i18n.ts`: `t(key, subs?)`, `localeTag()` and `splitOnPlaceholder()`, per system.md §11.4.
     - `src/shared/dom.ts`: the ~40-line `h()` helper, with no `innerHTML`.
     - `test/helpers/i18n-stub.ts`: loads `src/_locales/<locale>/messages.json` and implements `chrome.i18n.getMessage` semantics (named placeholders with `$1…$9` content). Tasks 2.5 and 2.7 reuse it.
     - Unit tests for `i18n.ts` and `dom.ts`.
  3. **Full copy deck** (instead of ENG-001's 4-key minimum), so no later parallel task has to touch `_locales`. `src/_locales/{en,ja,zh_CN,zh_TW}/messages.json` hold every key below.
     - **English** is PRD-000 "Appendix A: Copy deck" verbatim. The product name is "Helper for Pixiv" (R-002). `ext_description` is a one-line store summary of at most 132 characters.
     - **ja, zh_CN, zh_TW** are draft translations. They use the "Proposed translations for width-critical button labels" table exactly. `P` stays `P`, digits stay ASCII, and no HTML appears.
     - **Placeholders** use chrome.i18n named placeholders, in the listed order.
     - **Exact key names:**
       - **Meta:** `ext_name`, `ext_description`, `locale_tag`.
       - **Button:**
         - `btn_download`, `hint_pages`(n), `hint_format`(format, the literal `MP4`/`WebM`/`ZIP`), `btn_progress_pages`(done,total), `btn_progress_percent`(p);
         - `btn_cancel`, `tip_cancel`, `btn_saved`, `tip_saved`(folder), `btn_login`, `tip_login`, `btn_retry`, `hint_failed`(n);
         - `tip_partial`(saved,total,failed), `tip_partial_one`(saved,total), `tip_offline`, `tip_refused`, `tip_server`, `tip_disk`, `tip_metadata_only`(total);
         - `btn_unavailable`, `tip_unavailable`, `tip_encode_failed`.
       - **Accessible names and announcements:**
         - `aria_idle_pages`(n), `aria_idle_single`, `aria_idle_ugoira`(format), `aria_idle_ugoira_nometa`(format), `aria_idle_ugoira_zip`;
         - `aria_busy_pages`(done,total), `aria_busy_pages_one`(done) = "Downloading, <done> of 1 page saved. Click to cancel.", `aria_busy_frames`(p), `aria_busy_encode`(format,p);
         - `aria_saved_pages`(n,folder), `aria_saved_pages_one`(folder) = "Saved 1 page to Downloads/<folder>. Click to download again.", `aria_saved_ugoira`(format,folder);
         - `aria_login`, `aria_partial`(saved,total,failed), `aria_failed`(cause);
         - `live_start`(n), `live_start_one` = "Downloading 1 page", `live_start_ugoira` = "Downloading ugoira";
         - `live_progress_pages`(done,total) = "<done> of <total> pages saved", `live_progress_percent`(p) = "<p> percent";
         - `live_saved`(n), `live_saved_one` = "Saved 1 page", `live_saved_ugoira`(format) = "Saved <format>";
         - `live_failed`(n), `live_failed_one` = "1 page failed", `live_cancelled`.
       - **Toolbar:** `action_title_idle`, `action_title_one`(n), `action_title_one_single` = "Helper for Pixiv — 1 file remaining", `action_title_many`(n,jobs).
       - **Settings:**
         - `opt_tab_title`, `opt_title`, `opt_subtitle`, `opt_folder_heading`, `opt_folder_help`, `opt_folder_aria`, `opt_insert`;
         - `tok_artist_tip`, `tok_id_tip`, `tok_title_tip`, `tok_userid_tip`;
         - `opt_preview`, `opt_still_using`(pattern) = "Still using: <pattern> — your last valid pattern stays in effect until this one is fixed.";
         - `err_empty`, `err_absolute`, `err_backslash`, `err_dotdot`, `err_unknown_token`(token), `err_illegal_chars`;
         - `opt_ugoira_heading`, `opt_ugoira_help`, `opt_ugoira_aria`, `opt_ugoira_mp4`, `opt_ugoira_webm`, `opt_ugoira_zip`;
         - `opt_meta_heading`, `opt_meta_help`, `opt_saved`, `opt_reset`, `opt_report`, `opt_version`(version), `opt_privacy`.
- **Files**:
  - **Root config:** `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `vitest.config.ts`, `.gitignore`.
  - **Scripts and assets:** `scripts/build.mjs`, `scripts/render-icons.mjs`, `assets/icon.svg`, `src/icons/*.png`.
  - **Manifest, locales, globals:** `src/manifest.json`, `src/_locales/*/messages.json`, `src/globals.d.ts`.
  - **Shared modules:** `src/shared/{types,messages,constants,log,i18n,dom}.ts`.
  - **Entry points:** `src/background/{sw,types}.ts`, `src/content/content.ts`, `src/offscreen/offscreen.{html,ts}`, `src/options/options.{html,ts}`.
  - **Tests:** `test/unit/{manifest,locales,i18n,dom}.test.ts`, `test/helpers/i18n-stub.ts`.
- **Done when**:
  - ENG-001 Verify: `npm ci && npm run check && ! grep -qE '^(import|export) ' dist/content.js && node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('dist/manifest.json','utf8'));for(const f of ['sw.js','content.js','offscreen.html','offscreen.js','options.html','options.js','_locales/en/messages.json','_locales/ja/messages.json','_locales/zh_CN/messages.json','_locales/zh_TW/messages.json','icons/icon-128.png'])if(!fs.existsSync('dist/'+f))throw new Error('missing '+f);if(JSON.stringify(m.permissions)!=='[\"downloads\",\"storage\",\"offscreen\",\"declarativeNetRequestWithHostAccess\"]')throw new Error('perms');if(JSON.stringify(m.host_permissions)!=='[\"https://www.pixiv.net/*\",\"https://i.pximg.net/*\"]')throw new Error('hosts');if(m.minimum_chrome_version!=='116')throw new Error('minver');console.log('SCAFFOLD OK')"` prints `SCAFFOLD OK`.
  - The locales test passes on the full deck, and every key listed above exists in all 4 locales.
  - `node scripts/build.mjs --prod` refuses a non-1 `__RETRY_TIME_SCALE__`, and `--e2e` writes `dist-e2e/`.
  - `npm run check` passes.

## Parallel Group 2 (depends on Group 1)

### Task: 2.1 Platform spike: DNR Referer on offscreen fetch, blob hand-off, first-party ajax, codec probe, live pixiv DOM capture (ENG-002)
- **Do**: Implement the ENG-002 scope in `docs/eng-backlog.md` exactly. Background is in system.md §8 "Network strategy" and the design-artwork-button.md section "pixiv DOM contract".
  - Use Chromium from `@playwright/test` (already a devDependency; run `npx playwright install chromium`) with `--load-extension`, on the real network.
  - The spike extension is hand-written JS in `scripts/spike/ext/`, with no build step. It may add `declarativeNetRequestFeedback` and is never shipped.
  - `scripts/spike/run.mjs` prints one `<name>: PASS|FAIL <detail>` line for each check:
    1. `referer-rule-offscreen`
    2. `referer-rule-not-on-tab-traffic`
    3. `blob-download-uniquify`
    4. `cs-ajax-first-party`
    5. `offscreen-ajax` (informational)
    6. `codec-probe` (informational)
    7. `referer-rule-offscreen-fallback`, only if check 1 fails
  - It exits 0 only when checks 1–4 pass, or when check 1 fails but check 7 passes.
  - **DOM captures** (scripts removed):
    - `test/fixtures/pixiv/artwork-live-light.html`: the artwork page's `main` subtree, the `<html>`/`<body>` attributes, and the inline data script that carries `"isLoggedIn"`;
    - `test/fixtures/pixiv/artwork-live-ugoira.html`;
    - `artwork-live-dark.html`, if pixiv's logged-out theme toggle allows it.
  - **Commit `scripts/spike/FINDINGS.md`.** Tasks 3.2 and 3.4 run later in separate worktrees and cannot see your summary, so this file is their only hand-off. It must contain:
    - every PASS/FAIL line from the final run;
    - which DNR rule variant the engine must use (the system.md §8.2 rule as written, or the fallback without `initiatorDomains`);
    - proposed selectors for the action row (group + like control), the artwork area, the theme marker and the login marker (which `isLoggedIn` source exists), each with evidence from the captures.

    Selectors may use only stable hooks (ARIA/`data-*` attributes, href shapes, structure), never generated `sc-*` classes. Put the same report in your task summary.
- **Files**: `scripts/spike/ext/**`, `scripts/spike/run.mjs`, `scripts/spike/FINDINGS.md`, `test/fixtures/pixiv/artwork-live-*.html`
- **Done when**:
  - ENG-002 Verify: `node scripts/spike/run.mjs` exits 0 and its output contains `referer-rule-offscreen: PASS` (or `referer-rule-offscreen-fallback: PASS`), `referer-rule-not-on-tab-traffic: PASS`, `blob-download-uniquify: PASS` and `cs-ajax-first-party: PASS`. Also `ls test/fixtures/pixiv/artwork-live-light.html test/fixtures/pixiv/artwork-live-ugoira.html` succeeds. (Requires network access to pixiv.net and i.pximg.net.)
  - `scripts/spike/FINDINGS.md` is committed with all items above.
  - `npm run check` passes.
  - If pixiv is unreachable from your environment, stop and report BLOCKED with the error. Do not fabricate captures.

### Task: 2.2 Golden parity vectors from ref/pixiv-dl (ENG-003) + metadata.ts
- **Do**:
  - **Implement the ENG-003 scope exactly** (`docs/eng-backlog.md`; design-test-harness.md "L1: Unit and golden tests").
    - `scripts/gen-golden.py` runs under `python3 -I`, sets `sys.dont_write_bytecode = True`, stubs `browser_cookie3`, and loads `ref/pixiv-dl` via `SourceFileLoader`.
    - It writes `test/golden/safe_component.json` (≥ 200 vectors in the listed categories), `test/golden/plain_text.json` (≥ 50) and `test/golden/write_metadata.json` (≥ 10 cases). The `write_metadata` cases must include a body with no `description` and one with no `illustId`/`id`.
    - It also writes `src/shared/html-entities.ts`, and supports a `--check` mode.
    - The npm `golden` script and the `__pycache__/` ignore already exist from 1.1. Verify them; don't duplicate them.
  - **Implement `src/shared/metadata.ts`** per the design-download-engine.md section "`metadata.json` construction (src/shared/metadata.ts)":
    - `buildMetadata(body, artworkId)`: 12 keys in PRD §4.3 order;
    - `plainText`;
    - `unescapeHtml`, with Python `html.unescape` semantics: HTML5 table including legacy no-semicolon names, decimal/hex references, and Python's invalid-codepoint replacement table;
    - `stripPy`, using Python's `str.isspace` set;
    - `serializeJson` = `JSON.stringify(v, null, 2)` with no trailing newline.
  - **Tests:**
    - `test/unit/golden-metadata.test.ts`: `plainText` equals every `plain_text.json` vector, and `serializeJson(buildMetadata(body, id))` equals `fileText` byte for byte for every `write_metadata.json` case. There are two documented exceptions, asserted per the PRD/design: a missing `description` is `null` (PRD §4.3), and a missing id gives a `url` built from `artworkId`.
    - `test/unit/metadata.test.ts`: key order, `null` for missing fields, `[]` for missing tags, literal non-ASCII, and `\n` kept.
  - Do **not** write the `safe_component` parity test. It needs `pattern.ts` from parallel task 2.3 and is done in task 3.1.
- **Files**: `scripts/gen-golden.py`, `test/golden/{safe_component,plain_text,write_metadata}.json`, `src/shared/html-entities.ts`, `src/shared/metadata.ts`, `test/unit/metadata.test.ts`, `test/unit/golden-metadata.test.ts`
- **Done when**:
  - ENG-003 Verify: `python3 -I scripts/gen-golden.py && python3 -I scripts/gen-golden.py --check && test ! -e ref/__pycache__ && node -e "const a=require('./test/golden/safe_component.json'),b=require('./test/golden/plain_text.json'),c=require('./test/golden/write_metadata.json');if(a.length<200||b.length<50||c.length<10)process.exit(1);console.log('GOLDEN OK',a.length,b.length,c.length)"` prints `GOLDEN OK …`.
  - Two consecutive generator runs produce identical files.
  - All golden-metadata vectors pass.
  - `npm run check` passes.

### Task: 2.3 Settings model: pattern.ts and settings.ts (CUJ-3, CUJ-1 folder resolution)
- **Do**: Implement all of `docs/design/design-settings-model.md`:
  - **Data Model and API / Interface Contract:** `DEFAULT_SETTINGS`, `PATTERN_MAX_CHARS`, `StoredSettings`, `validatePattern`, `resolveFolder`, `sanitizeToken` (with `parityOnly`), `chromeSafeSegment`, `isSafeRelativeFolder`, `SAMPLE`, `readSettings`, `writeSettings`, `onSettingsChanged`, and `effectiveFormat` (truth table in design-download-engine.md "Resolving", step 5).
  - **"Read / write algorithm":** dual-write to sync and local; newest `updatedAt` wins, with a tie going to sync; field-wise parsing with per-field defaults; `{ ok }`, true if either area stored the value; throws only on an invalid pattern.
  - **"Pattern validation":** the 6 rules in order, plus the defensive > 200 check.
  - **"Resolution"**, **"Token sanitization"** (steps 1–6 plus the PRD 2+ and D8 3+ additions) and **"Chrome path-safety pass"** (steps a–f).
  - `pattern.ts` is fully pure (no `chrome.*`).
  - **Tests**, per "Cross-Cutting Concerns → Testing":
    - each validation rule and its precedence (e.g. `/a\..` → rule 2);
    - every row of the "Golden examples" table;
    - the PRD examples: `pixiv/{artist}-{id}` + `みずき` → `pixiv/みずき-135882741`; `  Sora / 空 :: 2nd  ` → `Sora_空_2nd`; `...` → `unknown`; `a//b/` → `a/b`; `pixiv/{artist}/{title}` with `SAMPLE` → `pixiv/みずき/雨上がりの渋谷`;
    - the ICU White_Space constant listing;
    - `isSafeRelativeFolder`;
    - newest-wins merge cases: sync newer, local newer, tie, one missing, corrupt fields, and sync quota error with `{ ok: true }` still returned;
    - `effectiveFormat`;
    - a seeded property test: 10 000 random strings, where every segment satisfies a JS port of Chrome's `IsSafePortablePathComponent`.
  - Spot-check `parityOnly` against `ref/pixiv-dl`'s `safe_component` locally (`python3 -I`, stub `browser_cookie3`, don't commit). The committed golden parity test comes in task 3.1.
  - D8 is a recorded PRD deviation (Current State note 1b). Implement it as designed.
- **Files**: `src/shared/pattern.ts`, `src/shared/settings.ts`, `test/unit/pattern.test.ts`, `test/unit/pattern-property.test.ts`, `test/unit/settings.test.ts`
- **Done when**: All listed tests pass, and `npm run check` passes.

### Task: 2.4 Network core: retry.ts, pixiv-api.ts and message guards (CUJ-1, CUJ-5)
- **Do**:
  - **`src/shared/retry.ts`:** `fetchWithRetry` per system.md §9 "Retry policy", every table row:
    - 4 attempts;
    - retried: 429/500/502/503/504, network and timeout;
    - never retried: 403, any other non-2xx, `pixivError` (a JSON body with `error: true`) and `aborted`;
    - delay `1.5·2ⁿ + U(0,0.5)` s;
    - `Retry-After` parity: a positive seconds value → `min(v, 30)`; `0`, negative or HTTP-date falls through to the backoff;
    - no sleep after the last attempt;
    - 30 s inactivity timeout, re-armed per body chunk;
    - streamed body with `onProgress`;
    - all delays scaled by `__RETRY_TIME_SCALE__`;
    - injectable `random`/`sleep`;
    - debug log without headers, cookies or query strings.

    Response types are `json`, `bytes` (Blob), and a raw-bytes mode that returns a `Uint8Array`, preallocated when `Content-Length` is known, with a short body → `network` failure (retried). The offscreen zip fetch in design-offscreen-worker.md "Byte fetch (fetch-bytes.ts)" needs the raw-bytes mode.
  - **`src/shared/pixiv-api.ts`:**
    - URL builders;
    - allowlist asserts using the 1.1 constants (system.md §11.1);
    - `parseIllust` → `WorkInfo` (`illustId ?? id`, page-0 width/height);
    - `parsePages` → `urls.original` in page order;
    - `parseUgoiraMeta` → `{ originalSrc, frames }`;
    - a missing required field → `pixivError`;
    - basename extraction with the basename regex.
  - **`src/shared/messages.ts`:** add hand-written runtime guards for every message type in the 1.1 catalog (system.md §7 "Validation"):
    - artwork IDs match `/^\d{1,12}$/`;
    - URLs pass the allowlist;
    - caps width/height are in 1..16384;
    - `retryPages` pages are unique, 0-based and `< total ≤ 200`;
    - formats are valid enum values;
    - folders are a non-empty string ≤ 1024 with no leading `/`. The semantic `isSafeRelativeFolder` check is done by the SW engine (task 3.2), because `pattern.ts` lands in parallel task 2.3.

    Also add sender-check helpers per system.md §7 "Sender checks". Keep the type catalog unchanged except for additive fixes.
  - **Tests**, using fake timers and mocked `fetch`/`ReadableStream`:
    - the status matrix 200/403/404/429/500/502/503/504;
    - network `TypeError`;
    - stall;
    - each `Retry-After` variant;
    - delay ratios and attempt counts;
    - abort;
    - short body;
    - parser tolerance;
    - guard rejection of malformed payloads.

    Use sample pixiv bodies in `test/fixtures/api/*.json`.
- **Files**: `src/shared/retry.ts`, `src/shared/pixiv-api.ts`, `src/shared/messages.ts`, `test/unit/retry.test.ts`, `test/unit/pixiv-api.test.ts`, `test/unit/messages.test.ts`, `test/fixtures/api/*.json`
- **Done when**: Every system.md §9 table row has a passing test, every message guard has positive and negative tests, and `npm run check` passes.

### Task: 2.5 SW platform layer: chrome fakes, badge/title, toolbar → settings tab, offscreen and tab clients, codec caps cache (CUJ-3 step 1, CUJ-4)
- **Do**:
  - **`test/fakes/chrome.ts`**, per design-test-harness.md "L2: SW integration with chrome fakes". It is installable and resettable as `globalThis.chrome` per test, and fakes:
    - `storage.sync`/`local`/`session`, with `onChanged` and injectable sync quota errors;
    - `downloads.download`/`search`/`cancel`/`onChanged`, with a controllable completion queue and interrupt reasons;
    - `action` badge text and colors, and title get/set;
    - `runtime.sendMessage`/`onMessage` (a router between registered fake contexts, with sender info), `getContexts`, `getURL`, `id` and `getManifest`;
    - `tabs.sendMessage`/`create`/`update` and `windows.update`;
    - `offscreen.createDocument`/`closeDocument`;
    - `declarativeNetRequest.updateSessionRules`/`getSessionRules`;
    - `i18n.getMessage`, via `test/helpers/i18n-stub.ts` with `en`.
  - **`src/background/badge.ts`**, per design-download-engine.md "Badge and action title (badge.ts)":
    - pure `remaining(job)`, `badgeText(total)` (`''`, the number, or `999+`) and `actionTitle(total, jobs)` (keys `action_title_idle`, `action_title_one`, `action_title_one_single`, `action_title_many`);
    - a renderer coalesced with a 50 ms trailing delay, driven by a jobs supplier, that skips unchanged `setBadgeText`/`setTitle` calls.
  - **`src/background/options-tab.ts`:** `openOrFocusOptions(tab)` per "Toolbar click → settings tab".
    - If an options tab exists (`runtime.getContexts` with `TAB` + `documentUrls`), activate it and focus its window.
    - Otherwise create the tab at `tab.index + 1`, with the same `windowId` and `openerTabId`.
  - **`src/background/offscreen-client.ts`**, per design-offscreen-worker.md "Lifecycle":
    - `ensureOffscreen` with a shared creating promise, reason `BLOBS` and the justification text;
    - `scheduleClose` (5 s grace) and `cancelScheduledClose`;
    - `send(cmd)` with `target: 'offscreen'`, which re-ensures the document once on "Receiving end does not exist".
  - **`src/background/tab-client.ts`:**
    - `pushView(tabId, view)` sends `{target:'tab', type:'job/update', view}` with `{frameId:0}`; a rejection is logged at debug level.
    - `apiFetchJson(tabId, url)` asks the tab (`api/fetchJson`) first and falls back to `off/fetchJson` when the tab call throws (system.md §8.3).
  - **`src/background/caps.ts`**, per "Codec capabilities (caps.ts)": key `caps:<evenW>x<evenH>`; on a `storage.session` hit, return it; otherwise run `off/probe` and store the result. Concurrent misses share one promise.
  - **`src/background/sw.ts`:**
    - register `chrome.action.onClicked → openOrFocusOptions` synchronously at top level;
    - in `ready`: set the badge background `#1f1f1f`, the text color `#FFFFFF`, and do an initial render (empty text, `action_title_idle`);
    - keep the structure open for task 3.2 (router, `downloads.onChanged`, DNR, hydration).
  - **Tests**, using the fakes:
    - badge math: pages remaining, ugoira = 1, resolving = `expectedFiles`, `retryMetadata` = 0, `999+`, and the singular, plural and "across N downloads" titles;
    - options tab: create vs focus, including a tab in another window;
    - offscreen create-once under concurrency, and the close grace cancelled by a new command;
    - tab-client fallback;
    - caps cache and dedupe.
- **Files**: `test/fakes/chrome.ts`, `src/background/{badge,options-tab,offscreen-client,tab-client,caps,sw}.ts`, `test/unit/background/{badge,options-tab,offscreen-client,tab-client,caps}.test.ts`
- **Done when**: All listed tests pass, and `npm run check` passes.

### Task: 2.6 Job model core: registry, outcome classifier, progress mapping, JobView projection (CUJ-1, CUJ-2, CUJ-4, CUJ-5)
- **Do**:
  - **`src/background/registry.ts`**, per design-download-engine.md "Mutations: persist intent, then act", "Persistence" and "Indexes":
    - `create`/`get`/`list` and indexes by `taskId` and `downloadId`;
    - `mutate(jobId, fn)`, serialized through one global promise chain. `fn` returns an effects union (`dispatch`, `download`, `abort`, `release`, `push`, `badge`, `finalize`). The record is written as `job:<jobId>` to `storage.session` (or deleted when the job has ended) **before** the effects go to a caller-supplied runner;
    - display-only progress fields persisted at most once per second;
    - `hydrate()` from `storage.session.get(null)`, rebuilding the indexes.
  - **`src/shared/test-hooks.ts`:** `__testHook(name)`, a no-op unless `__TEST_HOOKS__`. Call it at every await inside `mutate`. Task 3.2 uses it for restart-at-every-await tests.
  - **`src/shared/outcome.ts`:** `classifyOutcome(job, navigatorOnLine)` per system.md §10, all 10 rows, first match wins.
    - `partial.failedPages` lists the failed page indexes, and `saved = pagesTotal − failedPages.length`.
    - An ugoira whose only failure is `metadata.json` maps to `error: disk` (system.md §15 item 5).
  - **`src/shared/progress.ts`** (PRD §4.7.5; design-offscreen-worker.md "Progress"):
    - pages progress: `done` includes `pagesOffset`, and `total = pagesTotal`;
    - ugoira percent: the zip maps to 0–40 by bytes (0–100 for ZIP only); the encode maps to `40 + floor(60·done/total)`, capped at 99 until the video lands; the job is `indeterminate` while `zipTotal` is null, until the encode phase starts; the value is clamped monotonic.
  - **`src/background/view.ts`:** `toView(job, outcome)` → `JobView` (system.md §6).
  - **Tests:**
    - one classifier case per row, plus precedence conflicts: cancel beats all; a bytes 403 beats partial; offline vs server; all disk/dismissed → disk;
    - progress is monotonic and never reaches 100 before the end;
    - `mutate` serializes concurrent calls, persists before effects, and deletes the record when the job ends;
    - `hydrate` rebuilds the indexes.

    Use a minimal in-test storage mock, because the shared fakes land in parallel task 2.5.
- **Files**: `src/background/registry.ts`, `src/background/view.ts`, `src/shared/{outcome,progress,test-hooks}.ts`, `test/unit/{registry,outcome,progress,view}.test.ts`
- **Done when**: Every classifier row has a passing test, and `npm run check` passes.

### Task: 2.7 Download button component: state model, presentation, fixed width, view, styles, icons, live region (CUJ-1, CUJ-2, CUJ-5)
- **Do**: Implement `src/content/button/{model,labels,width,view,styles,icons,live-region}.ts`. Follow design-artwork-button.md "Button state model", "Click actions", "Presentation (button/labels.ts)", "Fixed width (button/width.ts)" and "View, styles, interaction" (including its live-region table), plus PRD §4.7.2–4.7.7 and the §4.7.3 state table. The visual references are `docs/ux/prd-000-mvp-mockups/` `cuj-1-initial`, `cuj-1-downloading`, `cuj-1-saved`, `cuj-1-dark`, `cuj-2-initial`, `cuj-2-encoding`, `cuj-5-initial` and `cuj-5-retry` `.html`.
  - **`model.ts`:**
    - `ButtonState` and `Entry`;
    - pure `reduce(state, event)` per the state diagram, including the `cancelledJobs` rule;
    - the click → action mapping (start payload / cancel / login URL `https://accounts.pixiv.net/login?return_to=<encoded href>` / ignore), returned as a value. Task 3.4 executes it.
  - **`labels.ts`:** `present(entry, settings, locale)` for every row of the presentation table. It uses only the 1.1 key names (including the `_one` variants), and `tip_saved` and the saved aria strings embed `Downloads/<folder>`.
  - **`width.ts`:**
    - `candidates(work|null, locale)`;
    - width = max(measured, `LOCALE_FLOOR_PX`), with `en` = 164 and the others 0;
    - lock at first render, widen once before any interaction, never shrink;
    - the measure function is injectable for tests.
  - **`view.ts`/`styles.ts`:**
    - a closed shadow root containing the pill, the measure button and an `sr-live` region;
    - a constructable stylesheet with every PRD color and dimension;
    - focus ring `#0096FA`, and `#5fb9fb` under `:host([data-theme=dark])`;
    - the ring SVG (`C = 2π·8`, dashoffset) and the indeterminate 25% arc;
    - `prefers-reduced-motion`;
    - the cancel face shown only on `.busy.armed:hover`, with arming on the first `pointerleave`;
    - the 500 ms click guard;
    - `aria-busy`, `aria-disabled`, `aria-label` and `title`.
  - **`icons.ts`:** constant SVG strings (download, check, x, warning). It is the only `innerHTML` user.
  - **`live-region.ts`:** polite, replaces text rather than appending, and throttles progress announcements to once per 5 s.
  - **Mount API for task 3.4:** export a small JSDoc-documented API that mounts into an `<hfp-download>` host, e.g. `createButton(host, { onActivate }) → { render, lockWidth, setTheme, announce, destroy }`.
  - **Tests** (happy-dom):
    - `reduce` transitions;
    - `present()` for every table row in all 4 locales (via `test/helpers/i18n-stub.ts`);
    - candidates, floor, lock and widen-once;
    - the click guard and arming with fake timers;
    - the live-region throttle;
    - `aria-busy` present only while busy.
- **Files**: `src/content/button/*.ts`, `test/unit/button/*.test.ts`
- **Done when**: All listed tests pass, and `npm run check` passes.

### Task: 2.8 Ugoira encoder modules: timeline, zip extraction, codec probe, encode pipeline (CUJ-2)
- **Do**: Implement `src/offscreen/ugoira/{timeline,zip,codec,encode}.ts` per design-offscreen-worker.md "Codec probe (ugoira/codec.ts)", "Ugoira encode (ugoira/encode.ts)" (the flowchart and the decision table), "Zip extraction (ugoira/zip.ts)" and "Memory budget".
  - **Pure boundaries for task 3.3 to wire:**
    - `probe(width, height) → { avc, vp9 }`, using the High → Main → Baseline ladder and the level table;
    - `encodeUgoira({ zip: Uint8Array, frames, format, avcCodec, signal, onProgress }) → Promise<Blob>`.
  - **Encode rules:**
    - frames are looked up by name;
    - one frame in flight (`await source.add`);
    - integer-µs timestamps and durations;
    - MP4 with `frameRate: 1000` and `fastStart: 'in-memory'`; WebM without `frameRate`;
    - `Quality('very-high')`, `keyFrameInterval: 2`, first frame forced key;
    - crop to even size on an `OffscreenCanvas` with `alpha: false`;
    - abort → `output.cancel()` and no Blob;
    - one retry with `hardwareAcceleration: 'prefer-software'`;
    - failures throw with a `detail` of `no-zip`, `bad-frames`, `zip` or `encoder`.
  - Use only `mediabunny` and `fflate`, both already in `package.json`.
  - **Tests** (Node):
    - timeline: 40/40/500/40 → 0/40/80/580 ms, total 620, integer µs;
    - `avcCandidates`: 600×600 → `avc1.64001e` first, 1920×1080 → `avc1.640028`;
    - `even()`;
    - `extractEntry` on fflate-built stored and deflated zips, with a missing entry → `undefined`;
    - frame validation;
    - with mediabunny mocked: the timestamps and durations passed per sample, the first frame keyed, abort → `cancel`, and the single software retry.

    Real WebCodecs output is verified in a browser by task 4.3.
- **Files**: `src/offscreen/ugoira/*.ts`, `test/unit/ugoira/*.test.ts`
- **Done when**: All listed tests pass, and `npm run check` passes.

### Task: 2.9 E2E harness: fake pixiv HTTPS server, Chromium launcher, CDP/SW helpers (ENG-004)
- **Do**: Implement the ENG-004 scope per design-test-harness.md "L3: E2E harness":
  - **"Build variant":** use `node scripts/build.mjs --e2e` from 1.1.
  - **"Fake pixiv server (`e2e/server/`)":**
    - HTTPS via `selfsigned`;
    - `www.pixiv.net` artwork pages, ajax `illust`/`pages`/`ugoira_meta`, and non-artwork pages;
    - `i.pximg.net` returns 403 unless `Referer` is exactly `https://www.pixiv.net/`, and can omit `Content-Length`;
    - `accounts.pixiv.net` login sets `PHPSESSID=fake-session`;
    - R-18 cookie gating and the `r18Hidden` flag;
    - fault API, request log and `maxInFlight`.
  - **"Fixtures":** all 13 IDs in `e2e/fixtures/works.ts`, with tiny generated images and ugoira zips. Generate them deterministically; do not commit large binaries.
  - **Placeholder artwork page:**
    - an action row with share/more/like/bookmark controls;
    - an artwork figure;
    - a theme marker;
    - an inline data script with `"isLoggedIn":` set per cookie;
    - an SPA script;
    - `window.__fake.rerenderRow()`, `removeRow()` and `setTheme()`.

    Task 3.4 later replaces its structure with the ENG-002 live capture.
  - **"Launcher (`e2e/harness/launch.ts`)" and helpers:** `swEval`, `stopServiceWorker`, `downloads.files`, `ffprobe`, `ssim` and `consoleErrors`.
  - **"QA role usage":** `qa:fake`, with a persistent `.qa/profile` and a fault REPL, and `qa:live`.
  - **Files to add:**
    - `playwright.config.ts`;
    - `e2e/README.md`, with the AC→test mapping skeleton from "Acceptance-criteria mapping";
    - `e2e/harness.spec.ts`, tagged `@harness`, proving ENG-004's 6 acceptance points.
  - **`package.json`:** this is the only Group 2 task allowed to edit it. Add the `selfsigned@^5.5` devDependency and the scripts `build:e2e`, `test:e2e` (= `npm run build:e2e && playwright test`), `qa:fake` and `qa:live`.
- **Files**: `e2e/server/**`, `e2e/harness/**`, `e2e/fixtures/**`, `e2e/qa/**`, `e2e/harness.spec.ts`, `e2e/README.md`, `playwright.config.ts`, `package.json`, `package-lock.json`
- **Done when**:
  - ENG-004 Verify: `npm run build:e2e && npx playwright test e2e/harness.spec.ts --reporter=line` passes all `@harness` tests (5 passed + at most 1 skipped for the macOS locale case).
  - `npm run check` passes, with `e2e/` typechecked and linted.

## Parallel Group 3 (depends on Group 2)

### Task: 3.1 Options page (CUJ-3) + folder-sanitization golden parity
- **Do**:
  - **Implement `src/options/options.html`, `options.css` and `options.ts`** (split into small modules if useful) per `docs/design/design-options-page.md`:
    - "Markup": DOM order equals the PRD tab order; `body` stays hidden until the strings are applied.
    - "Styles": the light/dark token table via `prefers-color-scheme`, and the geometry.
    - "Load".
    - "Pattern field": 400 ms debounce, then validate:
      - invalid → 2 px red border, `aria-invalid` + `aria-describedby` → the `role="alert"` message, the "Still using" line, and no write;
      - valid → preview `Preview: Downloads/<resolveFolder(value, SAMPLE)>/135882741_p0.jpg`, `writeSettings`, and a Saved flash.
    - "Chips": caret tracking, `setRangeText`, append when the field was never focused, the 200-character guard, `mousedown` `preventDefault`, and the exact tooltips.
    - "Ugoira output and metadata switch": immediate writes.
    - "`Saved` indicator": 2 s + 300 ms fade, instant under reduced motion, `aria-live="polite"`.
    - "Reset to defaults": Saved appears only on sections that changed.
    - "Two settings tabs": own-echo suppression, plus the invalid-draft and typing exemptions.
    - "Accessibility".
    - Footer: the Report link (R-001 URL from constants, `target=_blank`, `rel="noopener noreferrer"`), `v` + manifest version, and the privacy line.
  - **Copy and markup rules:**
    - All copy comes from the 1.1 locale keys.
    - `document.title` = `opt_tab_title`; `<html lang>` = `localeTag()`.
    - Mono spans use `splitOnPlaceholder` and the literal `metadata.json`.
    - No remote resources and no Tailwind.
    - Match `docs/ux/prd-000-mvp-mockups/cuj-3-initial.html`, `cuj-3-error.html` and `cuj-3-saved.html`.
  - **Golden parity test** `test/unit/golden-safe-component.test.ts`: `sanitizeToken(s, { parityOnly: true }) === out` for every vector in `test/golden/safe_component.json`. Fix `src/shared/pattern.ts` if any vector fails. In this group, only this task may edit `pattern.ts`.
  - **Unit tests** (happy-dom, fake timers), per design-options-page.md "Testing": all 6 validation messages with their exact English text, ARIA, chips, reset, and the cross-tab rules.
  - **Visual check:** run `npm run build`, launch Chromium with `dist/` using the harness launcher from 2.9, and open `chrome-extension://<id>/options.html`.
    - Screenshot light and dark, and compare them with the three CUJ-3 mocks.
    - Confirm the default preview reads `Preview: Downloads/pixiv/みずき-135882741/135882741_p0.jpg`.
- **Files**: `src/options/**`, `src/shared/pattern.ts` (parity fixes only), `test/unit/options/*.test.ts`, `test/unit/golden-safe-component.test.ts`
- **Done when**:
  - Golden parity passes for all ≥ 200 vectors.
  - The options unit tests pass.
  - The screenshot comparison is done, with any remaining differences listed in the summary.
  - `npm run check` passes.

### Task: 3.2 Service-worker download engine: resolver, scheduler, chrome.downloads hand-off, cancel, finalize, restart reconciliation, DNR rule (CUJ-1, CUJ-2, CUJ-4, CUJ-5)
- **Do**: Implement the job engine per `docs/design/design-download-engine.md`. It uses the Group 2 modules: registry/outcome/progress/view (2.6), badge/offscreen-client/tab-client/caps/fakes (2.5), guards and pixiv-api (2.4), settings/pattern (2.3) and metadata (2.2).
  - **"Boot sequence"** in `src/background/sw.ts`:
    - listeners registered synchronously at top level: a `runtime.onMessage` router by target/type, `downloads.onChanged`, and the `action.onClicked` handler from 2.5;
    - every handler awaits `ready`;
    - `ready` runs `installRefererRule` → badge colors → `registry.hydrate` → badge render → reconcile + pump.
  - **Handlers** for `job/start`, `job/cancel`, `job/listForTab` and `caps/get`, with sender checks and guards (system.md §7).
    - Folders echoed back by the tab must pass `isSafeRelativeFolder`.
    - `job/start` responds after the job is persisted and before resolving.
    - Push `job/update` after every user-visible change, with progress throttled to ≤ 4/s.
  - **"Resolving (resolver.ts)":**
    - all four modes, via `tabClient.apiFetchJson`;
    - the per-mode file queues;
    - the folder from `resolveFolder(snapshot.folderPattern, …)`, or the echoed folder;
    - `effectiveFormat` + caps for ugoira.
  - **"Scheduler (scheduler.ts)":** pump in ascending `idx`; a cap of 5 counting `fetching ∪ ready ∪ saving`; deps; skip once a stop reason is set. Dispatch by role:
    - `page` → `off/fetchBytes`;
    - `metadata` → `off/makeText(serializeJson(buildMetadata(body)))`, nulling `metaBody` in the same mutation;
    - `framesJson` → `off/makeText`;
    - `zip` → `off/fetchZip`;
    - `video` → `off/encode`.
  - **"Offscreen events → file transitions"** (`downloads.ts`), every table row:
    - `downloads.download({ url: blobUrl, filename: folder + '/' + name, conflictAction: 'uniquify', saveAs: false })`;
    - a throw → `disk`;
    - interrupted with `USER_CANCELED` → `dismissed`; any other reason → `disk`;
    - a 403 on a page or the zip → `stopReason = 'forbidden'`;
    - `keepRetained` release for the zip while the video is pending.
  - **"Cancel"**, **"Finalize"** and **"Hydration and reconciliation"**, as designed. Log `info` lines at job start and end.
  - **`src/background/dnr.ts`**, per system.md §8.2, using the variant recorded in `scripts/spike/FINDINGS.md` (task 2.1). If that file is missing or inconclusive, stop and report BLOCKED rather than guessing.
  - **Tests:**
    - **Unit:**
      - scheduler: cap 5, order, deps, stop on 403, cancel;
      - resolver per mode: full pages; full ugoira with mp4/webm/zip and the fallbacks; `retryPages` with `pagesOffset`; `retryEncode` with a `save:false` zip; `retryMetadata`;
      - every transition-table row.
    - **Integration** (`test/integration/`; Vitest + `test/fakes/chrome.ts` + a scripted fake offscreen):
      - a 12-page job lands `metadata.json` plus `135882741_p0…p11` under `pixiv/みずき-135882741` with `uniquify` and `saveAs:false`, never more than 5 in flight, in ascending dispatch order;
      - the ugoira job order (metadata → zip → `frames.json` → video) with a badge of 1;
      - a cancel race (`off/ready` after cancel → release only);
      - two concurrent jobs, checking the badge sum and titles;
      - SW restart at every `__testHook` await point, using `vi.resetModules()` and a re-import against the same fake state: no duplicated `downloads.download`, no lost file, and the badge correct right after `ready`.
- **Files**: `src/background/{sw,resolver,scheduler,downloads,dnr}.ts` (plus e.g. `handlers.ts`), `test/unit/background/engine-*.test.ts`, `test/integration/sw-*.test.ts`. Additive edits to `src/background/{types,registry,badge}.ts` are allowed if needed; list them in the summary.
- **Done when**:
  - All listed tests pass.
  - `npm run build:prod && ! grep -q __testHook dist/sw.js` passes.
  - `npm run check` passes.

### Task: 3.3 Offscreen document: task table, byte fetches to Blob URLs, zip retention, fallback API, probe/encode wiring (CUJ-1, CUJ-2)
- **Do**: Implement `src/offscreen/offscreen.ts` (router), `tasks.ts` and `fetch-bytes.ts` per `docs/design/design-offscreen-worker.md` "Lifecycle" (listener registered synchronously at top level), "Data Model", "API / Interface Contract" and "Byte fetch (fetch-bytes.ts)".
  - **Router:**
    - ignore targets other than `offscreen`, returning `undefined`;
    - reject messages that carry `sender.tab`;
    - validate with the `messages.ts` guards;
    - commands are acknowledged `{ ok: true }` immediately, and their results are emitted as `off/ready`/`off/failed`/`off/progress` events to `target: 'sw'`;
    - `off/fetchJson`, `off/probe` and `off/tasks` are request/response.
  - **Command handlers:**
    - `fetchBytes`: `i.pximg.net` allowlist, `credentials: 'omit'`, `cache: 'no-store'`, a Blob that keeps the content type, byte-exact.
    - `makeText`: a UTF-8 Blob.
    - `fetchZip`: streamed; progress ≤ 4/s plus a final event; a retained `Uint8Array`; a Blob only when `save`.
    - `encode`: calls `encodeUgoira` (from 2.8) on the retained `zipBytes`; progress ≤ 4/s, and at least 1/s while frames flow.
    - `probe`: calls `probe` (from 2.8).
    - `abort`: late completions are swallowed.
    - `release`: revokes the URL and drops the Blob; `keepRetained` keeps `zipBytes`.
    - `tasks`: returns the snapshot.
    - `fetchJson`: the allowlisted API URL with `credentials: 'include'`.
  - Every task ends in exactly one `ready`/`failed` event unless aborted. Exceptions become a `Failure` at the task boundary.
  - **Tests:**
    - target and sender filtering;
    - `fetchBytes` success, 403 (no retry) and 503 → retry, with a mocked `fetch`;
    - the zip progress throttle and retention;
    - release with and without `keepRetained`;
    - abort swallowing late completions;
    - the `tasks` snapshot;
    - encode/probe wiring, with the 2.8 modules mocked.
- **Files**: `src/offscreen/{offscreen,tasks,fetch-bytes}.ts`, `src/offscreen/offscreen.html` (only if needed), `test/unit/offscreen/*.test.ts`
- **Done when**:
  - All listed tests pass.
  - `npm run build && grep -q 'node_modules/mediabunny' dist/offscreen.js && ! grep -qE 'node_modules/(mediabunny|fflate)' dist/sw.js dist/content.js` passes (third-party code ships only in the offscreen bundle).
  - `npm run check` passes.

### Task: 3.4 Content script page integration: router, pixiv DOM contract, mounting, tab memory, API proxy (CUJ-1, CUJ-2, CUJ-4, CUJ-5)
- **Do**: Implement `src/content/{content,router,pixiv-dom,mount,tab-memory,api-proxy}.ts` per `docs/design/design-artwork-button.md`. It uses the button component (2.7), settings (2.3), retry/pixiv-api/messages (2.4) and i18n (1.1).
  - **"Startup":** the init guard; locale, logged-in state and theme read once; the `onMessage` listener; reattach via `job/listForTab`.
  - **"Routing and SPA detection":** the artwork regex, including locale prefixes; the Navigation API, `popstate` and the MutationObserver check.
  - **"Render-time metadata":** `pending` → `idle` / `needsLogin` (`xRestrict ≥ 1 && loggedIn === false`) / `unavailable` (404 or `pixivError`). For ugoira: `caps/get` → `effectiveFormat`.
  - **"pixiv DOM contract (pixiv-dom.ts)":** this is the only file with pixiv selectors. Use ordered strategies with validation, and take the selectors from `scripts/spike/FINDINGS.md` and `test/fixtures/pixiv/artwork-live-*.html` (task 2.1). If they are missing, stop and report BLOCKED; do not invent selectors.
  - **"Mounting (mount.ts)":**
    - one `<hfp-download>` host, with the single-host invariant;
    - an rAF-coalesced `ensurePlaced` driven by one MutationObserver;
    - spacing copied from pixiv's like control;
    - floating after 3 s (anchored to the artwork area, or 24 px from the viewport corner), and a move back into the row later.
  - **Clicks:**
    - optimistic `busy` synchronously in the click handler, before `job/start`;
    - if `job/start` fails → `error` with cause `server`;
    - `needsLogin` → `location.assign(login URL with return_to)`;
    - `busy` → the guard, then `job/cancel` and an optimistic idle;
    - `unavailable` → nothing.
  - **"job/update handling"**, **"Settings and codec reactivity"** (idle ugoira hint within 1 s), **"API proxy"**, and **"Extension update / context invalidation"** (teardown).
  - **Fake fixture page:** replace the structure of the placeholder artwork page served by the e2e fake server (from 2.9, under `e2e/server/`) with a reduction of the live capture. It must contain exactly the hooks `pixiv-dom.ts` relies on, and the SPA script and `window.__fake` controls must keep working.
  - **Tests** (happy-dom):
    - router regex, including `/en/artworks/<id>`, with no button on non-artwork routes;
    - every pixiv-dom strategy against each committed live fixture and against the fake page;
    - theme detection and the login marker;
    - mount: the single-host invariant, re-insertion after the row is replaced, and the floating timer;
    - tab memory and `job/update` mapping;
    - the API proxy allowlist;
    - teardown.
  - **Smoke test:** run `npm run build:e2e` and launch with the harness on `https://www.pixiv.net/artworks/135882741` (fake).
    - Exactly one `hfp-download` appears, immediately before the like control, labelled `Download · 12P`.
    - After `__fake.rerenderRow()` it is still exactly one, re-inserted.
    - With the row removed (`__fake.removeRow()`), the button floats within 3 s.
- **Files**: `src/content/{content,router,pixiv-dom,mount,tab-memory,api-proxy}.ts`, `e2e/server/**` (fixture page only), `test/unit/content/*.test.ts`
- **Done when**:
  - All listed tests pass.
  - The smoke checks pass.
  - `npm run build:e2e && npx playwright test e2e/harness.spec.ts --reporter=line` still passes.
  - `npm run check` passes.

## Parallel Group 4 (depends on Group 3)

### Task: 4.1 CUJ-1 and CUJ-4 end-to-end on the fake-pixiv harness, plus L4 live smoke
- **Do**:
  - **Write `e2e/cuj1.spec.ts` (`@cuj1`) and `e2e/cuj4.spec.ts` (`@cuj4`).** Each must check every Acceptance Criterion of CUJ-1 and CUJ-4 in `docs/prd/prd-000-mvp.md`, following design-test-harness.md "Acceptance-criteria mapping". Put the AC→test mapping in a comment block at the top of each spec; do not edit `e2e/README.md`.
    - **CUJ-1:**
      - one button, left of like, within 500 ms;
      - `Download · 12P` and `Download` labels;
      - 164 px in idle, busy, cancel-hover and saved states;
      - folder contents, with sizes equal to `Content-Length`;
      - `metadata.json`: 12 keys in order, literal non-ASCII, `\n`;
      - ≤ 5 in flight (`server.maxInFlight`);
      - an `N / 12` label that only rises;
      - cancel;
      - `Saved · 12P` and its tooltip;
      - SPA back and reload;
      - re-download creates `(1)` duplicates;
      - closing the tab doesn't stop the job;
      - the badge counts down and clears;
      - keyboard, focus ring and `aria-busy`;
      - dark theme identical;
      - a pattern change mid-job doesn't move the running job (this also covers CUJ-3's AC "Changing a setting while a download runs …" for folder and metadata).
    - **CUJ-4:**
      - badge `23` with the "across 2 downloads" title;
      - one-job singular and plural titles;
      - per-tab progress;
      - badge updates within 1 s;
      - a concurrent start;
      - cancelling one job;
      - an empty badge brings back the idle title;
      - `stopServiceWorker()` mid-job → badge correct within 1 s, and the jobs complete;
      - a toolbar trigger while jobs run (use the e2e hook from 4.2 if present; otherwise call `openOrFocusOptions` via `swEval`).
  - **Write `e2e/live/smoke.spec.ts`** (`@live`, design-test-harness.md "L4") and run it once with `HFP_LIVE=1`. Report the result.
  - **Fix integration defects** within `src/background/**`, `src/offscreen/*.ts` (not `ugoira/`), `src/content/**` and `src/shared/**` (except `progress.ts`, `settings.ts`, `pattern.ts` and `i18n.ts`).
  - **Off-limits in this group:** `src/_locales/**`, `src/options/**` and `src/offscreen/ugoira/**`. List any copy or encoder defects in the summary instead of fixing them. Changes to `e2e/server/**` and `e2e/harness/**` must be additive only.
- **Files**: `e2e/cuj1.spec.ts`, `e2e/cuj4.spec.ts`, `e2e/live/smoke.spec.ts`, and fixes under the paths above
- **Done when**:
  - `npm run test:e2e -- --grep "@cuj1|@cuj4"` passes.
  - The live smoke result is reported (PASS, or the failure with its cause).
  - `npm run check` passes.

### Task: 4.2 CUJ-3 end-to-end + i18n key coverage
- **Do**:
  - **Write `e2e/cuj3.spec.ts` (`@cuj3`)**, covering every CUJ-3 Acceptance Criterion except the mid-job one (covered by 4.1).
    - **Toolbar trigger hook.** Playwright cannot click the toolbar, so add an e2e-only trigger to `src/background/options-tab.ts`. Under `if (__TEST_HOOKS__)`, register `self.__hfpTest.clickAction(tabId)`, which calls the same handler; invoke it via `swEval`.
    - **Toolbar behavior:** the full tab is titled `Helper for Pixiv — Settings` and opens right of the current tab; a second click focuses the existing tab, including across windows; there is no popup.
    - **Defaults** are shown.
    - **Chips** insert at the caret, and their tooltips are exact.
    - **Preview** text is exact.
    - **Validation:** each of the 6 messages is exact, with the red border, the exact "Still using" line, and no storage write (check `chrome.storage` via `swEval`).
    - **Saved** appears and fades.
    - **Reload persistence** and **Reset**.
    - **Footer.**
    - **Themes:** light and dark via `emulateMedia`.
    - **Locales:** ja, zh_CN and zh_TW via `launch({ locale })`; skip with a logged reason where the platform ignores the locale.
    - **Keyboard-only order:** field → 4 chips → MP4 → WebM → ZIP only → switch → Reset to defaults → Report an issue.
    - **Two-tab sync** within 1 s, with the invalid-draft exemption.
  - **Add `test/unit/i18n-keys.test.ts`:**
    - every literal key passed to `t()`, `splitOnPlaceholder()` or `data-i18n` in `src/` exists in `src/_locales/en/messages.json`;
    - no `en` key is unused. Allow-list `ext_name`, `ext_description` and `locale_tag` (used by the manifest).
  - **Fix defects** within `src/options/**`, `src/background/options-tab.ts`, `src/_locales/**` (the sole owner of locale edits in this group) and `src/shared/{settings,pattern,i18n}.ts`.
- **Files**: `e2e/cuj3.spec.ts`, `test/unit/i18n-keys.test.ts`, and fixes under the paths above
- **Done when**:
  - `npm run test:e2e -- --grep @cuj3` passes.
  - `npm run build:prod && ! grep -q __hfpTest dist/sw.js` passes.
  - `npm run check` passes.

### Task: 4.3 CUJ-2 end-to-end: ugoira encode in the real browser
- **Do**:
  - **Write `e2e/cuj2.spec.ts` (`@cuj2`)** against fixtures 136004512–136004517, covering every CUJ-2 Acceptance Criterion.
    - **Gating:** MP4 assertions are skipped with a logged reason when the probe reports `avc: null`. `@ffprobe` checks are skipped when `ffprobe` is absent.
    - **Idle hint** matches the setting.
    - **Busy percent:** never decreases, never shows `100%` before the end, and updates at least once per second during the encode (136004517).
    - **Badge** shows `1`.
    - **Folder** contains exactly the zip, `frames.json`, the video and `metadata.json`.
    - **Fidelity:** the zip is byte-identical, and `frames.json` equals `ugoira_meta.body.frames`.
    - **ffprobe:** the frame count and per-frame durations within ±1 ms (136004513); the even crop gives 600×450 (136004514).
    - **No `Content-Length`** gives the indeterminate arc (136004515).
    - **Variants:** ZIP only; cancelling during the encode leaves no video; closing the tab during the encode still produces the video.
    - **Quality:** SSIM mean ≥ 0.98 and min ≥ 0.95.
    - **Mid-job change:** switching the Ugoira output keeps the running job's format.
  - **Fix defects only** within `src/offscreen/ugoira/**` and `src/shared/progress.ts`. 4.1 and 4.2 own every other path this group.
    - For a failure caused by code elsewhere, mark that test `test.fixme` with a comment naming the file, the function and the failing assertion. List each one in the summary so it is queued; never weaken an assertion.
- **Files**: `e2e/cuj2.spec.ts`, `src/offscreen/ugoira/**`, `src/shared/progress.ts`
- **Done when**:
  - `npm run test:e2e -- --grep @cuj2` passes. The only `fixme` tests allowed are those attributed to out-of-scope files, each listed in the summary.
  - `npm run check` passes.

### Task: 4.4 CI workflow (GitHub Actions) (ENG-005)
- **Do**: Implement the ENG-005 scope in `docs/eng-backlog.md`: `.github/workflows/ci.yml`.
  - Triggers: push and pull_request.
  - Runner: `ubuntu-latest` with Node 22.
  - Steps: `npm ci` → `npm run check` → `python3 -I scripts/gen-golden.py --check` → `npx playwright install --with-deps chromium` → `npm run test:e2e` (headless=new).
  - On failure, upload as artifacts the Playwright traces, the server log and the downloads listing.
  - One concurrency group per ref.
- **Files**: `.github/workflows/ci.yml`
- **Done when**:
  - ENG-005 Verify: `actionlint .github/workflows/ci.yml` exits 0 (install via `brew install actionlint` or `go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/ci.yml`), and `npm ci && npm run check && python3 -I scripts/gen-golden.py --check && npm run test:e2e` exits 0 locally.
  - `npm run check` passes.

## Conflict Risks

- **`package.json` / `package-lock.json`:**
  - Group 1: task 1.1 creates them.
  - Group 2: only task 2.9 edits them (adds `selfsigned` and the e2e/qa scripts).
  - No other task may add or upgrade dependencies. If one seems necessary, stop and report it.
- **`src/background/sw.ts`:** each group has one owner: 1.1 (stub) → 2.5 (toolbar + badge init) → 3.2 (router, DNR, hydration) → 4.1 (fixes only).
- **`src/shared/messages.ts`:** 1.1 writes the types; 2.4 adds the guards. Everyone else only imports it. If 3.2, 3.3 and 3.4 drift from the contract in parallel, the Group 4 e2e tasks catch it.
- **`src/shared/types.ts`, `src/background/types.ts`, `src/shared/constants.ts`:** created by 1.1. No Group 2 task edits them; keep any new constant or type module-local and report it. In Group 3, only 3.2 may make additive edits to `src/background/types.ts`.
- **`src/shared/pattern.ts`:** created by 2.3. Only 3.1 may edit it in Group 3 (golden parity fixes), and only 4.2 in Group 4.
- **`src/_locales/**`:** 1.1 writes the full deck. Nobody edits it in Groups 2 and 3; report copy problems instead. In Group 4, only 4.2 edits it.
- **`.prettierignore` / ESLint ignores:** 1.1 must already ignore `scripts/spike/**`, `test/fixtures/**`, `test/golden/**` and `src/shared/html-entities.ts`. If they are missing, 2.1 and 2.2 would both append lines and conflict trivially. Resolve by keeping both lines.
- **`e2e/server/**`:**
  - 2.9 creates it.
  - In Group 3, only 3.4 edits it (the fixture page structure).
  - In Group 4, 4.1 may make additive changes only, and 4.3 must not edit it.
  - `e2e/README.md` is edited only by 2.9.
- **Test files:** every task writes uniquely named files under `test/unit/<area>/`, `test/integration/` or `e2e/<cuj>.spec.ts`. No shared test file is edited by two tasks in the same group.
- **Group 4 fix scopes overlap by design:** 4.1 owns `src/background/**` / `src/content/**` / offscreen non-ugoira code; 4.2 owns the options and locale code; 4.3 owns ugoira code. An engine-side ugoira defect found by 4.3 becomes a `fixme` and is listed, not fixed, to avoid a three-way edit of `resolver.ts`/`scheduler.ts`.
- **ENG-002 dependency:** 3.2 (DNR variant) and 3.4 (selectors) read `scripts/spike/FINDINGS.md`. If 2.1 ends BLOCKED (no network to pixiv), 3.2 and 3.4 must report BLOCKED rather than guess. 3.1 and 3.3 can still run.

**Parallelism:** 18 tasks in 4 groups (1 + 9 + 4 + 4). The critical path is 1.1 → 2.x → 3.2 → 4.1, so this is roughly 4 task-lengths of wall-clock instead of 18 sequential ones.
