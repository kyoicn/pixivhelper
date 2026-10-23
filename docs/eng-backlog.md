# Engineering Backlog

Engineering tasks: infrastructure, tooling, operational hardening, tech debt — work that is neither a defect (docs/issues.md) nor a product feature (docs/prd/). Entries are removed when done; history lives in git via commits referencing the ENG ID.

Next-ID: ENG-012

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

---

### ENG-007: Prod bundle carries no test-hook code, checked in CI

- **Filed**: 2026-10-22 21:44:39 (UTC+9)
- **Priority**: P2
- **Background**: design-test-harness.md "Build variant" requires a check that the shipped bundle contains no test hooks. No such test exists; the only guard is the manual `! grep -qE '__testHook|__hfpTest' dist/sw.js`. That grep passes only because `engine.ts`, `registry.ts` and `resolver.ts` import `__testHook` under an alias: the unminified prod `dist/sw.js` still carries 8 dead `if (false) await testHook("await:…")` statements (harmless at runtime, but visible to Web Store reviewers, and proof that the guard checks a name rather than the property). esbuild drops dead `if (false)` branches only with `minifySyntax`.
- **Scope**:
  - `scripts/build.mjs`: for `--prod`, set esbuild `minifySyntax: true` (keep `minifyWhitespace` and `minifyIdentifiers` off, so the bundle stays readable for review).
  - Remove the `__testHook as testHook` alias imports and their comments in `src/background/{engine,registry,resolver}.ts`.
  - `.github/workflows/ci.yml`: after `npm run check`, add a step `npm run build:prod && ! grep -qE 'testHook|__hfpTest|await:(registry|resolver|handoff)' dist/*.js`.
- **Acceptance criteria**:
  - The prod bundle contains no `testHook`, `__hfpTest` or hook-name strings.
  - `npm run check` and `npm run test:e2e` still pass (e2e builds keep their hooks).
  - CI runs the bundle check.
- **Verify**: `npm run build:prod && ! grep -qE 'testHook|__hfpTest|await:(registry|resolver|handoff)' dist/*.js && grep -q 'build:prod' .github/workflows/ci.yml && npm run check && echo PROD CLEAN` prints `PROD CLEAN`.
- **Relates-to**: prd-000-mvp

---

### ENG-008: Move the job model and protocol types into src/shared; enforce the layering rule

- **Filed**: 2026-10-23 02:06:20 (UTC-7)
- **Priority**: P1
- **Background**: `src/shared/{messages,outcome,progress,pixiv-api}.ts` and `src/content/button/model.ts` import `JobRecord`, `FileTask`, `StartRequest`, `UgoiraState` and `ErrorCode` from `src/background/types.ts` (iteration-1 code review W6). The imports are type-only, but the dependency is inverted: the pure shared core depends on the service worker's directory. system.md §4 now states the layering rule (D11) and puts these types in `src/shared/job.ts`. This is a pure refactor with no behavior change.
- **Scope**:
  - `git mv src/background/types.ts src/shared/job.ts`; fix its relative imports; update every importer in `src/` and `test/` (no re-export shim is left behind);
  - `eslint.config.js`: one `no-restricted-imports` block per directory with `patterns` so that `src/shared/**` cannot import `**/background/**`, `**/content/**`, `**/offscreen/**`, `**/options/**`, and each context directory cannot import the other three;
  - update the file-header comments that cite `src/background/types.ts`.
- **Acceptance criteria**:
  - `src/background/types.ts` no longer exists; `src/shared/job.ts` holds the same declarations unchanged.
  - No module under `src/shared/` imports a context directory, and no context directory imports another.
  - `npm run check` passes with an unchanged test count.
- **Verify**: `test ! -e src/background/types.ts && test -f src/shared/job.ts && ! grep -rEn "from '(\.\./)+(background|content|offscreen|options)/" src/shared && ! grep -rEn "from '(\.\./)+(background|offscreen|options)/" src/content && ! grep -rEn "from '(\.\./)+(background|content|options)/" src/offscreen && ! grep -rEn "from '(\.\./)+(background|content|offscreen)/" src/options && grep -q "no-restricted-imports" eslint.config.js && npm run check && echo LAYERING OK` prints `LAYERING OK`.
- **Ordering**: Before any iteration-2 task that edits `src/shared/{outcome,messages,pixiv-api,progress}.ts`, `src/background/{resolver,badge,engine}.ts` or `src/content/button/model.ts` (the R-003 needs-login, outcome-classification and badge-title tasks), so those tasks are written against the new paths; run it alone in its group. It also overlaps ENG-007's edits to `engine.ts`, `registry.ts` and `resolver.ts` imports.
- **Relates-to**: prd-000-mvp

---

### ENG-009: Fake pixiv prebuilds its fixture zips at start; drop warmZip()

- **Filed**: 2026-10-23 02:06:20 (UTC-7)
- **Priority**: P2
- **Background**: The fake server builds an ugoira zip synchronously on its first request (`e2e/fixtures/assets.ts` `ugoiraZip`, cached per process). For 136004517 (1920×1080, 300 frames) that takes ~1.5 s, beyond the e2e build's 300 ms stall timeout, so the first download attempt times out unless the spec calls `warmZip()` first (iteration-1 code review W11; documented as a trap in `e2e/README.md`). Every new spec that touches an ugoira fixture can fall into it.
- **Scope**:
  - `e2e/server/server.ts` `FakePixiv.start()`: build every ugoira fixture's zip (`ugoiraZip(work)` for each `illustType === 2` work in `WORKS`) before `listen`;
  - remove `warmZip()` and its calls from `e2e/cuj2.spec.ts`; drop the trap paragraph from `e2e/README.md`;
  - add a self-test in `e2e/harness.spec.ts` named `fake server: fixture zips are prebuilt` that times the first request for 136004517's zip from a fresh server and expects the response headers within 300 ms.
- **Acceptance criteria**:
  - No spec or helper calls `warmZip`.
  - The first 1080p zip request of a fresh server answers within the e2e stall timeout.
  - `e2e/cuj2.spec.ts` passes without warming.
- **Verify**: `! grep -rn "warmZip" e2e && npm run build:e2e && npx playwright test e2e/harness.spec.ts e2e/cuj2.spec.ts --reporter=line && npx playwright test e2e/harness.spec.ts -g "fixture zips are prebuilt" --reporter=line && echo PREBUILD OK` prints `PREBUILD OK` (every listed test passes).
- **Relates-to**: prd-000-mvp, CUJ-2

---

### ENG-010: Content bundle size budget, checked in CI

- **Filed**: 2026-10-23 02:06:20 (UTC-7)
- **Priority**: P2
- **Background**: design-artwork-button.md set "< 30 KB" for the content script before any code existed; iteration 1 measured 35.2 KB minified / 12.9 KB gzip with no single offender (code review W7). system.md §11.6 now states a measured budget: `content.js` ≤ 40 KB minified and ≤ 15 KB gzip (34.4 KB / 12.6 KB with the prod defines on 2026-10-23). The content script runs on every pixiv page, so growth should fail CI rather than surface in review. The shipped `build:prod` stays unminified for Web Store review, so the check minifies separately.
- **Scope**:
  - `scripts/size.mjs`: esbuild-bundle `src/content/content.ts` (IIFE, `target: chrome116`, `minify: true`, the prod defines `__DEBUG__=false`, `__RETRY_TIME_SCALE__=1`, `__TEST_HOOKS__=false`), gzip the output with `node:zlib` (level 9), print both sizes in KB, exit 1 above the limits; limits default to 40 / 15 KB and can be overridden with `--max-min-kb N` and `--max-gzip-kb N` (for the negative check);
  - `package.json` script `size`; `.github/workflows/ci.yml` step `npm run size` after `npm run check`.
- **Acceptance criteria**:
  - `npm run size` prints the minified and gzip sizes of the content bundle and passes at today's size.
  - It fails when a limit is exceeded.
  - CI runs it.
- **Verify**: `npm run size && ! node scripts/size.mjs --max-min-kb 1 --max-gzip-kb 1 && grep -q "npm run size" .github/workflows/ci.yml && echo SIZE OK` prints `SIZE OK`.
- **Relates-to**: prd-000-mvp

---

### ENG-011: Encode failures report how many encoder passes ran

- **Filed**: 2026-10-23 02:06:20 (UTC-7)
- **Priority**: P2
- **Background**: `src/offscreen/offscreen.ts` `failureOf` reports every encode failure with `attempts: 1`, because `EncodeError` does not record whether the prefer-software retry ran (iteration-1 code review W8). design-offscreen-worker.md now specifies `attempts` = 2 when the prefer-software pass ran and also failed, 1 otherwise, so a user's error log shows whether the software path was tried. Observability only; no outcome changes.
- **Scope**:
  - `src/offscreen/ugoira/encode.ts`: `EncodeError` gains `attempts: 1 | 2`; the prefer-software path rethrows with `attempts: 2`;
  - `src/offscreen/offscreen.ts` `failureOf`: copy `error.attempts` (1 when the error is not an `EncodeError`);
  - unit tests whose names contain `encode failure attempts`: a failure before any retry → 1; a hardware failure followed by a failing prefer-software pass → 2.
- **Acceptance criteria**:
  - `off/failed` for an encode carries the real pass count.
  - `npm test` passes.
- **Verify**: `npx vitest run -t "encode failure attempts" --reporter=json --outputFile=.eng011.json; node -e "const r=require('./.eng011.json'); process.exit(r.numPassedTests>=2&&r.numFailedTests===0?0:1)" && rm -f .eng011.json && npm test && echo ATTEMPTS OK` prints `ATTEMPTS OK`.
- **Relates-to**: prd-000-mvp, CUJ-5
