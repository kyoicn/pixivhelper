# Engineering Backlog

Engineering tasks: infrastructure, tooling, operational hardening, tech debt — work that is neither a defect (docs/issues.md) nor a product feature (docs/prd/). Entries are removed when done; history lives in git via commits referencing the ENG ID.

Next-ID: ENG-008

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
