# Engineering Backlog

Engineering tasks: infrastructure, tooling, operational hardening, tech debt — work that is neither a defect (docs/issues.md) nor a product feature (docs/prd/). Entries are removed when done; history lives in git via commits referencing the ENG ID.

Next-ID: ENG-007

---

### ENG-001: Scaffold the MV3 project (toolchain, build, manifest, entry stubs)

- **Filed**: 2026-10-22 18:08:04 (UTC+9)
- **Priority**: blocking
- **Background**: The repository has no code, no `package.json` and no build. Every CUJ task needs the TypeScript/esbuild/Vitest/ESLint toolchain, the Manifest V3 skeleton with the approved permission set, and the four entry points. The layout and commands are specified in `docs/design/system.md` §3–§5 and §12.
- **Scope**:
  - `package.json` with scripts `build`, `build:prod`, `watch`, `typecheck`, `lint`, `test`, `check` (= typecheck + lint + test + build), `golden` (placeholder until ENG-003). `package-lock.json`. Node ≥ 22.
  - Runtime deps: `mediabunny@^1.62`, `fflate@^0.8.3`. Dev deps: `typescript@~6.0.3` (must stay < 6.1 for typescript-eslint), `esbuild@^0.28`, `vitest@^5`, `happy-dom@^21`, `eslint@^10`, `typescript-eslint@^8.72`, `prettier@^3`, `@types/chrome@^0.3`, `@playwright/test@^1.64`.
  - `tsconfig.json`:
    - `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`;
    - must typecheck SW, content, offscreen and options code;
    - path layout per system.md §4.
  - `eslint.config.js`:
    - typescript-eslint `recommendedTypeChecked`;
    - `@typescript-eslint/no-floating-promises: error`;
    - `no-restricted-properties` banning `innerHTML`/`outerHTML`/`insertAdjacentHTML` everywhere except `src/content/button/icons.ts`.
  - `.prettierrc`, `vitest.config.ts`.
  - `scripts/build.mjs`:
    - esbuild entries `src/background/sw.ts` → `sw.js` (ESM), `src/content/content.ts` → `content.js` (IIFE), `src/offscreen/offscreen.ts` → `offscreen.js` (ESM), `src/options/options.ts` → `options.js` (ESM);
    - `target: chrome116`;
    - copy `src/manifest.json` (version injected from package.json), `src/_locales/**`, `*.html`, `*.css`, `src/icons/*`;
    - defines `__DEBUG__`, `__RETRY_TIME_SCALE__` (= 1; any other value only with `--e2e`), `__TEST_HOOKS__` (false unless `--e2e`);
    - flags `--watch`, `--prod`, `--e2e` (writes `dist-e2e/`).
  - `src/manifest.json` exactly as system.md §5.
  - `src/_locales/{en,ja,zh_CN,zh_TW}/messages.json` with at least `ext_name` ("Helper for Pixiv", R-002), `ext_description`, `locale_tag` (`en`/`ja`/`zh-CN`/`zh-TW`) and `action_title_idle`.
  - `assets/icon.svg` + `scripts/render-icons.mjs` → committed `src/icons/icon-{16,32,48,128}.png` (blue rounded square, white download glyph as in the mocks).
  - Entry stubs:
    - `sw.ts`: top-level listener registration skeleton and a `ready` promise;
    - `content.ts`: init guard;
    - `offscreen.html`/`offscreen.ts`: message router skeleton;
    - `options.html`/`options.ts`: sets `document.title` from i18n.
  - Tests `test/unit/manifest.test.ts` (exact permissions/hosts/min version, no popup, no web_accessible_resources) and `test/unit/locales.test.ts` (identical key sets and placeholder counts across the 4 locales).
  - `.gitignore`: `dist-e2e/`, `.qa/`, `test-results/`, `playwright-report/`, `*.zip`.
- **Acceptance criteria**:
  - `npm ci && npm run check` succeeds from a clean clone with zero type errors and zero lint errors.
  - `dist/` contains every file referenced by `dist/manifest.json`. `content.js` is a classic script (no top-level `import`/`export`).
  - `dist/manifest.json` permissions are exactly `["downloads","storage","offscreen","declarativeNetRequestWithHostAccess"]`, the hosts are exactly `https://www.pixiv.net/*` and `https://i.pximg.net/*`, and `minimum_chrome_version` is `"116"`.
- **Verify**: `npm ci && npm run check && ! grep -qE '^(import|export) ' dist/content.js && node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('dist/manifest.json','utf8'));for(const f of ['sw.js','content.js','offscreen.html','offscreen.js','options.html','options.js','_locales/en/messages.json','_locales/ja/messages.json','_locales/zh_CN/messages.json','_locales/zh_TW/messages.json','icons/icon-128.png'])if(!fs.existsSync('dist/'+f))throw new Error('missing '+f);if(JSON.stringify(m.permissions)!=='[\"downloads\",\"storage\",\"offscreen\",\"declarativeNetRequestWithHostAccess\"]')throw new Error('perms');if(JSON.stringify(m.host_permissions)!=='[\"https://www.pixiv.net/*\",\"https://i.pximg.net/*\"]')throw new Error('hosts');if(m.minimum_chrome_version!=='116')throw new Error('minver');console.log('SCAFFOLD OK')"` prints `SCAFFOLD OK`.
- **Ordering**: First. Every other ENG entry and every CUJ implementation task depends on it.
- **Relates-to**: prd-000-mvp

---

### ENG-002: Platform spike — DNR Referer on offscreen fetch, blob hand-off, first-party ajax, codec probe, live pixiv DOM capture

- **Filed**: 2026-10-22 18:08:04 (UTC+9)
- **Priority**: blocking
- **Background**: The byte path (design decision D1, system.md §8) assumes four Chrome behaviors that the documentation does not fully pin down:
  1. a DNR session rule with `initiatorDomains: [chrome.runtime.id]` + `tabIds: [-1]` adds `Referer` to `fetch()` from the offscreen document and never to tab traffic;
  2. a `blob:` URL created in the offscreen document can be downloaded by `chrome.downloads.download` from the SW with `conflictAction: 'uniquify'`;
  3. content-script ajax is first-party (system.md §8.3);
  4. what the codec probe reports in Chrome for Testing.

  The content script's selector contract (design-artwork-button.md "pixiv DOM contract") also needs live captures of pixiv's action row, theme marker and login marker. All of these must be confirmed before the download engine and the button are built on them.
- **Scope**:
  - Throwaway spike extension in `scripts/spike/ext/` (minimal SW, offscreen and content script; the spike may add `declarativeNetRequestFeedback` for diagnostics; it is never shipped) and a runner `scripts/spike/run.mjs` (Playwright bundled Chromium, real network, `--load-extension`).
  - Checks, each printing `<name>: PASS|FAIL <detail>`:
    1. `referer-rule-offscreen`: with the rule, the offscreen fetch of page 0 of the first all-ages illust from `https://www.pixiv.net/ranking.php?mode=daily&content=illust&format=json` returns 200; with the rule removed it returns 403.
    2. `referer-rule-not-on-tab-traffic`: a tab navigated directly to the same original URL gets 403, so the rule did not touch tab traffic.
    3. `blob-download-uniquify`: the offscreen document creates a Blob URL; the SW downloads it twice as `spike/x.jpg`; `x.jpg` and `x (1).jpg` exist with the same byte size as the fetch.
    4. `cs-ajax-first-party`: a content-script fetch of `/ajax/illust/<id>` returns `error: false`.
    5. `offscreen-ajax`: the same fetch from the offscreen document with `credentials: 'include'` (record the result; informational).
    6. `codec-probe`: `canEncodeVideo` results for `avc1.64001e`/`avc1.4d001e`/`avc1.42e01e` at 600×600, `avc1.640028` at 1920×1080, and VP9 (informational).
    7. If check 1 fails, rerun it with `initiatorDomains` omitted and report `referer-rule-offscreen-fallback`.
  - DOM capture: save the artwork page's `main` subtree (scripts removed) plus `<html>`/`<body>` attributes and the inline data script that carries `"isLoggedIn"` as `test/fixtures/pixiv/artwork-live-light.html`, and an ugoira artwork as `test/fixtures/pixiv/artwork-live-ugoira.html`. Add a dark-theme capture if pixiv's logged-out theme toggle allows it.
  - Report in the task summary:
    - every PASS/FAIL line;
    - the proposed stable selectors for the action row (group + like control), artwork area, theme marker and login marker;
    - which `isLoggedIn` source exists.

    The architect folds these into system.md §8.2 and design-artwork-button.md.
- **Acceptance criteria**:
  - Checks 1–4 PASS. If check 1 fails but check 7 passes, the entry still completes, and the summary states that the fallback rule is required.
  - At least the light artwork capture and the ugoira capture are committed under `test/fixtures/pixiv/`.
  - Selector proposals use only stable hooks (ARIA/data attributes, href shapes, structure), never generated `sc-*` class names.
- **Verify**: `node scripts/spike/run.mjs` exits 0 and its output contains `referer-rule-offscreen: PASS` (or `referer-rule-offscreen-fallback: PASS`), `referer-rule-not-on-tab-traffic: PASS`, `blob-download-uniquify: PASS` and `cs-ajax-first-party: PASS`. Also `ls test/fixtures/pixiv/artwork-live-light.html test/fixtures/pixiv/artwork-live-ugoira.html` succeeds. (Requires network access to pixiv.net and i.pximg.net.)
- **Ordering**: After ENG-001. Before implementation of the download engine byte path (offscreen `fetchBytes`/`fetchZip`, DNR rule) and of `src/content/pixiv-dom.ts`. Options page, settings model and shared pure modules do not wait for it.
- **Relates-to**: prd-000-mvp, CUJ-1, CUJ-2, CUJ-5

---

### ENG-003: Golden parity vectors from ref/pixiv-dl

- **Filed**: 2026-10-22 18:08:04 (UTC+9)
- **Priority**: P1
- **Background**: PRD Goal 2 requires parity with `ref/pixiv-dl` for folder sanitization, `metadata.json` fields and description text. The design (design-settings-model.md, design-download-engine.md) proves parity by testing the TypeScript implementations against vectors produced by the script itself. Python's `re` whitespace set, `str.strip`, `html.unescape` and `json.dump` have subtle differences from JS built-ins that only such vectors catch.
- **Scope**:
  - `scripts/gen-golden.py`, run as `python3 -I`:
    - sets `sys.dont_write_bytecode = True` before importing anything from `ref/`, so no `ref/__pycache__/` is created;
    - stubs `browser_cookie3` in `sys.modules` and loads `ref/pixiv-dl` via `importlib.machinery.SourceFileLoader`;
    - writes `test/golden/safe_component.json` (≥ 200 `{in,out}` vectors covering: all PRD §4.4 examples, every Python `str.isspace` code point, ASCII controls, `/ : \ * ? " < > |`, emoji with ZWJ, NFC/NFD pairs, 59/60/61-byte CJK and 4-byte-character truncation boundaries, leading/trailing `._ ` runs, empty and all-dots strings);
    - writes `test/golden/plain_text.json` (≥ 50 vectors: `<br>` variants, `</p>`, `</div>`, nested tags, named/numeric/legacy-no-semicolon entities, surrounding Unicode whitespace);
    - writes `test/golden/write_metadata.json` (≥ 10 `{body, fileText}` cases built by calling `write_metadata` into a temp dir: full body, missing fields, empty tags, non-ASCII, description with line breaks);
    - writes `src/shared/html-entities.ts` (the `html.entities.html5` table as a TS constant);
    - `--check` mode regenerates in memory and exits 1 on any difference from the committed files.
  - npm script `golden` runs it. Add `__pycache__/` to `.gitignore`.
- **Acceptance criteria**:
  - Deterministic output: two consecutive runs produce identical files.
  - `--check` exits 0 on a clean tree.
  - Vector counts meet the minimums above.
- **Verify**: `python3 -I scripts/gen-golden.py && python3 -I scripts/gen-golden.py --check && test ! -e ref/__pycache__ && node -e "const a=require('./test/golden/safe_component.json'),b=require('./test/golden/plain_text.json'),c=require('./test/golden/write_metadata.json');if(a.length<200||b.length<50||c.length<10)process.exit(1);console.log('GOLDEN OK',a.length,b.length,c.length)"` prints `GOLDEN OK …`.
- **Ordering**: After ENG-001. Before or alongside the tasks implementing `src/shared/pattern.ts` and `src/shared/metadata.ts`, whose parity tests consume these files.
- **Relates-to**: prd-000-mvp, CUJ-1, CUJ-3

---

### ENG-004: E2E harness — fake pixiv HTTPS server, Chromium launcher, CDP/SW helpers

- **Filed**: 2026-10-22 18:08:04 (UTC+9)
- **Priority**: P1
- **Background**: QA must verify every CUJ acceptance criterion against the real extension: real `chrome.downloads`, DNR, offscreen and WebCodecs. That includes CUJ-5 failure modes and R-18/login paths that cannot be reproduced on live pixiv without an account. design-test-harness.md (L3) specifies a fake pixiv reached through `--host-resolver-rules`, a launcher that keeps Chrome's real download naming, and helpers for SW evaluation/termination.
- **Scope**:
  - `e2e/server/`:
    - HTTPS via `selfsigned@^5.5`;
    - `www.pixiv.net` routes: artwork pages, ajax illust/pages/ugoira_meta, non-artwork pages; `i.pximg.net` with Referer enforcement and optional `Content-Length`; `accounts.pixiv.net` login that sets `PHPSESSID=fake-session`;
    - the fixtures table from design-test-harness.md (start with a placeholder fixture page; swap in the ENG-002 capture when available);
    - fault API, request log, `maxInFlight`;
    - fixture-page SPA script and `window.__fake` controls.
  - `e2e/harness/`:
    - `launch({ locale })`: temp profile with download prefs, spawn bundled Chromium with `--load-extension=dist-e2e`, `connectOverCDP`, then `Browser.setDownloadBehavior({behavior:'default'})`;
    - helpers: extension ID, `swEval`, `stopServiceWorker`, `downloads.files`, `ffprobe`, `ssim`, `consoleErrors`.
  - `playwright.config.ts`. npm scripts `build:e2e`, `test:e2e`, `qa:fake`, `qa:live`. `e2e/README.md` with the AC-to-test mapping skeleton.
  - Self-test `e2e/harness.spec.ts` tagged `@harness`.
- **Acceptance criteria**: The self-test proves each of:
  1. the extension SW target loads from `dist-e2e` and the extension ID is resolved;
  2. `https://www.pixiv.net/artworks/135882741` is served by the fake server through host mapping (page title matches the fixture);
  3. `chrome.downloads.download({url:'https://i.pximg.net/__harness/ok.bin', filename:'harness/ok.bin'})` evaluated in the SW lands at `<downloads>/harness/ok.bin` with that exact name and the server's byte size (proves real naming, not Playwright GUIDs);
  4. `stopServiceWorker()` makes the SW target disappear within 2 s;
  5. `launch({ locale: 'ja' })` yields `chrome.i18n.getUILanguage()` starting with `ja` in the SW (on macOS, skipped with a logged reason if `-AppleLanguages` is not honored);
  6. a request to `https://i.pximg.net/img-original/...` without the Referer gets 403 from the fake server.
- **Verify**: `npm run build:e2e && npx playwright test e2e/harness.spec.ts --reporter=line` passes all `@harness` tests (5 passed + at most 1 skipped for the macOS locale case).
- **Ordering**: After ENG-001. The fixture page needs ENG-002's DOM capture for fidelity, but the harness can land first with a placeholder fixture. Needed before QA runs any CUJ.
- **Relates-to**: prd-000-mvp, CUJ-1, CUJ-2, CUJ-3, CUJ-4, CUJ-5

---

### ENG-005: CI workflow (GitHub Actions)

- **Filed**: 2026-10-22 18:08:04 (UTC+9)
- **Priority**: P2
- **Background**: Coders run `npm run check` locally, but nothing enforces it on push. The golden `--check` and e2e suites (design-test-harness.md) should gate merges once they exist.
- **Scope**:
  - `.github/workflows/ci.yml`, on push and pull_request, on `ubuntu-latest` with Node 22:
    - `npm ci`;
    - `npm run check`;
    - `python3 -I scripts/gen-golden.py --check`;
    - `npx playwright install --with-deps chromium`;
    - `npm run test:e2e` with `--headless=new`;
    - upload Playwright traces, the server log and the downloads listing as artifacts on failure.
  - Concurrency group per ref.
- **Acceptance criteria**: The workflow file is valid, and its command sequence passes locally on a clean checkout.
- **Verify**: `actionlint .github/workflows/ci.yml` exits 0 (install via `brew install actionlint` or `go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/ci.yml`), and `npm ci && npm run check && python3 -I scripts/gen-golden.py --check && npm run test:e2e` exits 0 locally.
- **Ordering**: After ENG-003 and ENG-004.
- **Relates-to**: prd-000-mvp

---

### ENG-006: Store packaging, third-party notices, release checklist

- **Filed**: 2026-10-22 18:08:04 (UTC+9)
- **Priority**: P2
- **Background**: Web Store submission (PRD index "Store readiness") needs a reproducible production zip. mediabunny is MPL-2.0 and fflate is MIT, so their license texts must ship with the package. Several release checks (hardware H.264, OS players, "Ask where to save", 4-locale rendering, public repository per R-001) cannot be automated and need a written checklist (design-test-harness.md L5).
- **Scope**:
  - `scripts/zip.mjs` and npm script `zip`: `build:prod`, then `dist/` zipped as `helper-for-pixiv-<version>.zip` with no source maps;
  - `THIRD_PARTY_NOTICES.txt` generated from `node_modules/mediabunny/LICENSE` and `node_modules/fflate/LICENSE` into `dist/`;
  - `docs/release-checklist.md` covering:
    - the L5 manual checks;
    - store listing items in 4 locales;
    - the permission justification texts from system.md §5;
    - privacy disclosure ("no data collected");
    - "repository `kyoicn/pixivhelper` is public" (R-001).
- **Acceptance criteria**:
  - The zip contains `manifest.json`, `sw.js`, `content.js`, `offscreen.html`, `options.html`, `_locales/` and `THIRD_PARTY_NOTICES.txt`, and no `.map` files.
  - The manifest version equals `package.json` version.
- **Verify**: `npm run zip && Z=helper-for-pixiv-$(node -p "require('./package.json').version").zip && test "$(unzip -l "$Z" | grep -cE ' (manifest.json|sw.js|content.js|offscreen.html|options.html|THIRD_PARTY_NOTICES.txt)$')" = 6 && test "$(unzip -l "$Z" | grep -c '\.map$')" = 0 && test -f docs/release-checklist.md && echo PACKAGE OK` prints `PACKAGE OK`.
- **Ordering**: After ENG-001. Due before the first Web Store submission, not before CUJ implementation.
- **Relates-to**: prd-000-mvp
