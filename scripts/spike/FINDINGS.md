# ENG-002 platform spike: findings

This file is the hand-off from the ENG-002 spike to the download engine (task 3.2, DNR rule and byte path) and to `src/content/pixiv-dom.ts` (task 3.4). Those tasks can't see the spike's task summary, so everything they need is here.

- **Run:** 2026-10-22, macOS arm64, Chromium 156.0.8078.4 (Chrome for Testing bundled with `@playwright/test` 1.64.1), `--headless=new`, real network, logged out (no pixiv account).
- **How:** `node scripts/spike/run.mjs` loads `scripts/spike/ext/` (hand-written MV3 extension, never shipped) through `--load-extension`, from a temp copy that also holds `node_modules/mediabunny/dist/bundles/mediabunny.mjs`. It drives the extension's service worker over CDP. The temp profile points Chrome's own download folder at a temp directory (`Browser.setDownloadBehavior({behavior:'default'})`), so Chrome's real `uniquify` naming applies.
- **Flags:** `--capture` refreshes the DOM captures. Without it, existing captures are kept. `--headed` shows the browser. `--keep` keeps the temp profile and downloads.
- **Works used:** the first all-ages illust and the first all-ages ugoira of the daily rankings (`ranking.php?mode=daily&content=illust|ugoira&format=json`). Each was checked through `/ajax/illust/<id>` for `xRestrict === 0` and the right `illustType`. On this run they were illust `151061734` (3 pages) and ugoira `151057533`.

## 1. Final run (verbatim)

`node scripts/spike/run.mjs` exited with code **0**. Lines starting with `#` are informational. The extension ID differs on every run because the extension is loaded from a fresh temp path.

```
# Chromium 156.0.8078.4, extension janbjohfogjplonhodicpbckcpmkbilm, headless=true
# illust 151061734 (3p) original https://i.pximg.net/img-original/img/2026/10/20/06/00/37/151061734_p0.jpg
# ugoira 151057533
referer-rule-offscreen: PASS with rule 200 (815067 B), without rule 403; rule matches 1 (initiator=chrome-extension://janbjohfogjplonhodicpbckcpmkbilm tabId=-1 type=xmlhttprequest)
referer-rule-not-on-tab-traffic: PASS tab navigation 403; tab fetch (xmlhttprequest from a www.pixiv.net tab, opaque) rule matches with tabId>=0: 0 (rule variant spec)
blob-download-uniquify: PASS fetch 815067 B (image/jpeg); spike/x.jpg 815067 B, spike/x (1).jpg 815067 B; download states complete/complete
cs-ajax-first-party: PASS status 200 error=false illustType=0 xRestrict=0; sec-fetch-site=same-origin cookie PHPSESSID sent=true
offscreen-ajax: PASS credentials:'include' status 200 error=false (informational)
codec-probe: PASS avc1.64001e@600x600=true avc1.4d001e@600x600=true avc1.42e01e@600x600=true avc1.640028@1920x1080=true vp9@600x600=true vp9@1920x1080=true (informational)
# live artwork 151061734: action-row DOM order=menu,bookmark,like visual L→R=like,bookmark,menu (display=flex flex-direction=row-reverse justify-content=normal column-gap=normal, box 704x48; gaps like→bookmark 20px, bookmark→menu 13px; like wrapper margin-left/right 0px 20px); area=figure(img) 704x757; html[data-theme]=light body bg=rgb(245, 245, 245); __NEXT_DATA__ isLoggedIn=false; theme bootstrap isLoggedIn=false allowNologinDarkTheme=false
# capture test/fixtures/pixiv/artwork-live-light.html: kept existing file (pass --capture to refresh)
# live ugoira 151057533: action-row DOM order=menu,bookmark,like visual L→R=like,bookmark,menu (display=flex flex-direction=row-reverse justify-content=normal column-gap=normal, box 704x48; gaps like→bookmark 20px, bookmark→menu 13px; like wrapper margin-left/right 0px 20px); area=figure(canvas) 704x315; html[data-theme]=light body bg=rgb(245, 245, 245); __NEXT_DATA__ isLoggedIn=false; theme bootstrap isLoggedIn=false allowNologinDarkTheme=false
# capture test/fixtures/pixiv/artwork-live-ugoira.html: kept existing file (pass --capture to refresh)
# capture test/fixtures/pixiv/artwork-live-dark.html: not possible logged out — with localStorage theme=dark the page still sets html[data-theme]=light (theme bootstrap isLoggedIn=false allowNologinDarkTheme=false)
# DNR rule variant: system.md §8.2 as written (initiatorDomains + tabIds + resourceTypes)
# result: OK
```

`referer-rule-offscreen-fallback` (check 7) did not run, because check 1 passed. The captures were written by the immediately preceding `--capture` run, which had identical PASS/FAIL lines.

## 2. DNR rule variant: use system.md §8.2 as written

**Decision:** the engine uses the §8.2 session rule unchanged: `requestDomains: ['i.pximg.net']`, `initiatorDomains: [chrome.runtime.id]`, `tabIds: [-1]`, `resourceTypes: ['xmlhttprequest']`, action `modifyHeaders` set `Referer: https://www.pixiv.net/`. The fallback without `initiatorDomains` is **not** needed.

Evidence:
- **Check 1.** With the rule, the offscreen `fetch(original, {credentials:'omit', cache:'no-store'})` returned 200 with the full 815 067 bytes. With the rule removed, the same fetch returned 403. `onRuleMatchedDebug` reported the match with `initiator=chrome-extension://<id>`, `tabId=-1` and `type=xmlhttprequest`. So `initiatorDomains: [chrome.runtime.id]` matches offscreen-document fetches in current Chrome.
- **Check 2.** While the rule was installed:
  - A tab navigated directly to the same original URL got **403**, so the rule did not touch the navigation.
  - A `fetch(original, {mode:'no-cors', referrerPolicy:'no-referrer'})` from a `www.pixiv.net` tab's main world produced **0** rule matches with `tabId >= 0`. That request was an `xmlhttprequest` to `i.pximg.net`, so `tabIds: [-1]` and/or `initiatorDomains` kept the rule off tab traffic.

  The PRD privacy promise holds with the rule as written.

## 3. Other platform findings

- **Blob hand-off (check 3).**
  - The offscreen document's `URL.createObjectURL(blob)` URL can be passed to `chrome.downloads.download({url, filename:'spike/x.jpg', conflictAction:'uniquify', saveAs:false})` from the SW. Two sequential downloads produced `spike/x.jpg` and `spike/x (1).jpg`, each exactly the fetched size (815 067 B).
  - The offscreen document was still open while Chrome read the blob. The design's rule "close only after all downloads are terminal" is what keeps this valid.
- **Content-script ajax is first-party (check 4).**
  - A content-script `fetch('/ajax/illust/<id>')` (default credentials) returned `error:false`.
  - The request went out with `sec-fetch-site: same-origin` and carried pixiv's (anonymous) `PHPSESSID` cookie. Request headers were observed through CDP.
  - This confirms system.md §8.3.
- **Offscreen ajax (check 5, informational).** `fetch('https://www.pixiv.net/ajax/illust/<id>', {credentials:'include'})` from the offscreen document returned 200 / `error:false` logged out, with Chrome's default cookie settings. The §8.3 risk case (third-party cookies blocked, R-18 work) was not exercised; it needs a logged-in account.
- **Codec probe (check 6, informational).**
  - mediabunny 1.62 `canEncodeVideo` with `QUALITY_VERY_HIGH` returned `true` for every requested config:
    - `avc1.64001e`, `avc1.4d001e`, `avc1.42e01e` at 600×600;
    - `avc1.640028` at 1920×1080;
    - VP9 at 600×600 and at 1920×1080.
  - This is on macOS arm64 (hardware encoders available). Linux CI may differ, as design-offscreen-worker.md already anticipates.
- **Locale-prefixed routes are real.** With `Accept-Language: en-US`, pixiv redirected `/artworks/151061734` to `/en/artworks/151061734`, and every artwork link in the page is `/en/artworks/<id>`. This confirms the locale-prefixed route regex in design-artwork-button.md. Any test or tool that looks a tab up by URL must allow the prefix. The spike uses the match pattern `https://www.pixiv.net/*artworks/<id>*`.

## 4. DOM captures

| File | Source | Notes |
|---|---|---|
| `test/fixtures/pixiv/artwork-live-light.html` | `https://www.pixiv.net/en/artworks/151061734` (illust, 3 pages) | `figure` holds an `img` |
| `test/fixtures/pixiv/artwork-live-ugoira.html` | `https://www.pixiv.net/en/artworks/151057533` (ugoira) | `figure` holds a `canvas` and a play button |
| `artwork-live-dark.html` | not captured | not possible logged out (see 5.3) |

Each capture contains:
- the live `<html>` attributes (`lang="en" data-theme="light"`) and `<body>` attributes (none);
- the hydrated `<main>` subtree, with `<script>` elements removed (there were none inside `main`), and no `iframe` present;
- `script#__NEXT_DATA__[type="application/json"]`, the data script that carries `"isLoggedIn"`, placed after `main` inside `body` as on the live page.

Deliberate differences from the live page:
- A leading provenance comment.
- The anonymous session's `api.token` inside `serverSerializedPreloadedState` is replaced by 32 zeros. It is not read by anything we build, and committing it would only trip secret scanners.
- No pixiv CSS, so unit tests (happy-dom) have no layout. Layout facts measured live are recorded in §1 and §5.1.

A logged-out R-18 wall capture was not part of this task and was not made.

## 5. Proposed selectors for `src/content/pixiv-dom.ts`

All hooks below are ARIA/`data-*` attributes, element structure, the `<html data-theme>` attribute or the `__NEXT_DATA__` JSON. None uses pixiv's generated classes (`sc-…`, the CSS-module `style_*__hash` classes, or the Tailwind-style utility classes on the SVGs). I checked each proposal live in Chromium (the `#` lines in §1 come from the same logic, `inspectArtworkDom()` in `run.mjs`) and against both captures in happy-dom.

### 5.1 Action row (group + like control)

**Live structure, identical in both captures.** The live layout is in §1. This is the action-row `section`, with `d` path data elided:

```html
<section class="sc-965831fb-0 ktBkio">
  <div class="sc-965831fb-2 bQzqun">
    <button type="button" class="style_transparentButton__czlx7 style_button__dQhWz" aria-haspopup="true">
      <svg class="sc-393f4d5b-0 kyTLUq" viewBox="0 0 32 32" size="32">…</svg></button></div>        <!-- share menu -->
  <div class="sc-965831fb-3 htqARa">
    <button type="button" class="sc-d9289f76-0 ebkyxS gtm-main-bookmark">
      <svg viewBox="0 0 32 32" width="32" height="32" class="…"><defs><mask id="uid-mask-1">…</mask></defs>…</svg></button></div>  <!-- bookmark heart -->
  <div class="sc-965831fb-5 JsInw">
    <button type="button" class="style_button__c7Nvf">
      <svg class="style_icon__5q37p" viewBox="0 0 12 12">…</svg><span class="style_label__qXujn">Like</span></button></div>  <!-- like -->
</section>
```

**Where it sits.** `main > section > div > div` holds the artwork column: first the artwork `figure`, then a sticky wrapper that contains this `section`, then the `figcaption`. In both captures, the action-row `section` is a descendant of `figure.parentElement`, follows the `figure` in document order, and precedes the `figcaption`. The outer `main > section` contains the figure, so a "follows the figure" test excludes it automatically.

**Strategy 1 (structure + ARIA), proposed:**

```js
const main = doc.querySelector('main');
const figure = [...main.querySelectorAll('figure')].find((f) => !f.closest('a'));   // artwork figure (5.2)
function roleOf(wrapper) {                     // wrapper = element child of a candidate section
  const b = wrapper.querySelector(':scope > button');
  if (!b) return 'none';
  if (b.getAttribute('aria-haspopup') === 'true') return 'menu';                      // ARIA
  if (b.querySelector('svg mask')) return 'bookmark';                                   // SVG signature
  const label = b.querySelector(':scope > span');
  if (b.querySelector(':scope > svg') && label && label.textContent.trim() !== '') return 'like';  // icon + text label
  return 'other';
}
// group = first `main section` that FOLLOWS `figure` in document order whose element children include
//         a 'like' wrapper and >= 2 non-'none' wrappers; like wrapper = that child.
```

- **The like control** is the only control in the row with an icon plus a visible text label (`button > svg + span`). The share menu is identified by `aria-haspopup="true"`. The bookmark heart is the only one whose SVG has a `<mask>`.
- **Locale independence.** The label text is localized ("Like" in en), so only "non-empty" is checked.
- **Thumbnails are not matched.** Their mini-actions are `div[data-ga4-label="bookmark_button"] > button` (6 in each capture) with no text label, and they are not inside a `section` that follows the figure.
- **Validation from design-artwork-button.md holds on the live page:**
  - the group is inside `main`;
  - the like wrapper is a child of the group;
  - there are 2 other buttons;
  - the box is 704×48;
  - it is the first matching row after the figure (the first `section` checked).
- **Last-resort SVG signatures**, should a redesign drop the text label: like = `button > svg[viewBox="0 0 12 12"]`; bookmark = `button svg[viewBox="0 0 32 32"] mask`.
- **Hooks deliberately not used:**
  - the hand-authored `gtm-main-bookmark` analytics class (stable-looking, but it is a class, not one of the allowed hook kinds);
  - `aria-label`: these three buttons have none;
  - all hashed classes.

**Contract implication: insertion point (architect to fold into design-artwork-button.md).**
- The group is `display:flex; flex-direction: row-reverse` (measured live). DOM order is `menu, bookmark, like`, but the visual order left→right is **like, bookmark, menu**, packed at the right edge.
- PRD §4.7.1 / CUJ-1 wants the Download pill **immediately left of Like**. In this layout that means DOM position **after** the like wrapper, which is currently the group's last child.
- The current contract `ActionRowHit { group, before: like }` → `group.insertBefore(host, like)` would render the pill between Like and Bookmark.
- Proposal: `findActionRow` returns the like wrapper, and placement checks `getComputedStyle(group).flexDirection.endsWith('-reverse')`:
  - reversed → `like.after(host)`, i.e. `before = like.nextElementSibling`, `null` = append;
  - otherwise → `group.insertBefore(host, like)`.
- happy-dom has no CSS, so unit tests of this branch must stub `getComputedStyle`.

**Spacing.**
- The group has `column-gap: normal` (no flex gap).
- pixiv spaces with margins. The like wrapper has `margin-left: 0; margin-right: 20px`; the visual gaps are like→bookmark 20 px and bookmark→menu 13 px.
- The design's non-gap rule ("host copies `margin-inline-start/end` of the like control") gives the host `margin-right: 20px`. Under `row-reverse`, that is exactly the space between the pill and Like.

**Unit-test note.** happy-dom 21 evaluates `:has(> …)` relative selectors incorrectly. For example, `section > div:has(> button > svg + span)` matched all 3 wrappers in the captures instead of only the like wrapper, and `section:has(> div > button > svg + span)` also matched the outer `section`. Implement the structural tests with child iteration and `:scope >` queries, as above, not `:has()`.

### 5.2 Artwork area

**Proposed:** the first `figure` inside `main` that is not inside a link: `[...main.querySelectorAll('figure')].find((f) => !f.closest('a'))`.

Evidence:
- **Light:** `main` contains 8 `figure`s. The first is the artwork; the others are "Other works" thumbnails inside `a[data-ga4-label="thumbnail_link"][href="/en/artworks/<id>"]`. Live, the artwork figure renders 704×757 and contains `div[role="presentation"] … img[src^="https://i.pximg.net/img-master/"]`.
- **Ugoira:** the artwork figure is `figure > div[role="presentation"] > div > canvas[width="560"][height="315"]` (plus a play `button`). Live it renders 704×315.

**Optional stale-DOM guard for SPA navigation.** The `figcaption` holds `div[data-ga4-label="work_content"][data-ga4-entity-id="illust/<id>"]`. The id is `illust/151061734` and `illust/151057533` respectively; ugoira also uses the `illust/` prefix. Comparing it with the route id tells whether pixiv has re-rendered the column for the current artwork.

### 5.3 Theme marker

**Proposed:** `document.documentElement.getAttribute('data-theme')`, where `'dark'` → dark and `'light'` → light. When the attribute is missing or has another value, use the design's luminance fallback. `observeTheme` uses `attributeFilter: ['data-theme']` on `<html>`. `<body>` carries no attributes.

Evidence:
- Both captures have `<html lang="en" data-theme="light">`.
- Live body background was `rgb(245, 245, 245)`, which the luminance fallback also classifies as light.
- pixiv sets the attribute before first paint with two inline scripts, quoted from the server HTML:

```js
'use strict';
var currentTheme = localStorage.getItem('theme');
if (currentTheme === 'default') {
  currentTheme = 'light';
  localStorage.setItem('theme', currentTheme);
}
```
```js
'use strict';(function f(a){var b=a.localStorageKey,c=a.rootAttribute,d=a.isLoggedIn||a.allowNologinDarkTheme?localStorage.getItem(b):"light";d&&(document.documentElement.dataset[c]=d)})({"isLoggedIn":false,"localStorageKey":"theme","allowNologinDarkTheme":false,"rootAttribute":"theme"});
```

So a logged-out page is always `data-theme="light"` (`allowNologinDarkTheme:false`). That is why no dark capture exists.
- The run set `localStorage.theme = 'dark'` and reloaded; the page still said `light`.
- An earlier exploratory session also emulated `prefers-color-scheme: dark`; still `light`.

For logged-in users the value is the stored `theme` (`light`/`dark`; `default` is migrated to `light`). The value `dark` is inferred from this code and was **not observed**.

### 5.4 Login marker (`isLoggedIn` source)

**Source that exists:** `script#__NEXT_DATA__[type="application/json"]` → `JSON.parse(textContent).props.pageProps.isLoggedIn` (boolean).
- It is present in both captures (`false`) and is still in the DOM after hydration (read live after load).
- pixiv's artwork page is Next.js (`x-powered-by: Next.js`, `page: "/artworks/[id]"`).
- The same object also has `props.pageProps.gaUserData.login` (`false`).

**Proposed `readIsLoggedIn` order:**
1. `__NEXT_DATA__` as above, if the value is a boolean.
2. Fallback: the inline theme bootstrap script above, which also carries `"isLoggedIn":false`. Use `/"isLoggedIn":(true|false)/` over `script:not([src])` text. This script is removed from the captures (scripts removed), so it is evidenced only by the quote in 5.3.
3. Otherwise `null`.

The legacy `meta#meta-global-data` / `meta[name="global-data"]` / `preload-data` markers are **absent** from the current server HTML. Don't use them.

## 6. Not verified (no pixiv account; out of scope)

- **Logged-in DOM.** The action row, like-button state after liking, and possible extra controls (the PRD mock shows "More") were observed logged out only. The `isLoggedIn: true` and `data-theme="dark"` values are unobserved. QA with a real account should re-run `inspectArtworkDom()` (or `--capture --headed` after logging in manually in that profile) before release.
- **Third-party cookies blocked.** The behavior of offscreen ajax with third-party cookies blocked, and logged-in R-18 API calls (§8.3), were not exercised.
- **Codec results** are from macOS arm64 only.
