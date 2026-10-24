# Options Page

> Last updated: 2026-10-23 22:29:54 (UTC-7)
> Serves: prd-000 — CUJ-3 (all steps and edge cases), CUJ-2 step 1 / CUJ-3 step 7 (hint reactivity, via storage), R-001 (Report-an-issue URL), R-002 (product name), R-004 S2 (contrast), S5 (unclosed `{`), S15 ("Still using:" on one line)

## Overview

`options.html` + `options.ts` + `options.css` is the settings surface. It holds exactly three settings (folder pattern, ugoira output, save `metadata.json`) plus a footer. It always opens as a **full tab** (manifest `options_ui.open_in_tab: true`). The toolbar click opens or focuses it via `openOrFocusOptions()` ([design-download-engine.md](design-download-engine.md)). It is vanilla TypeScript over static semantic HTML. All rules (validation, resolution, storage) come from the shared modules in [design-settings-model.md](design-settings-model.md). This page only binds them to controls.

## Goals & Non-Goals

**Goals**
- Mock fidelity (`cuj-3-initial.html`, `cuj-3-error.html`, `cuj-3-saved.html`) in light and dark.
- Never lose a change, never store an invalid pattern, always show the last valid pattern's effect (CUJ-3 Context).
- Fully keyboard-operable in the PRD's tab order; correct ARIA for the field, chips, segmented control and switch.

**Non-Goals**
- Any setting beyond the three; any help text beyond the PRD copy; a Save button; confirmation dialogs (PRD CUJ-3 step 9).
- A popup (PRD §4.8: none).

## System Context

```mermaid
flowchart LR
  ACT["Toolbar click (SW openOrFocusOptions)"] --> PAGE
  EXT["chrome://extensions → Extension options"] --> PAGE
  subgraph PAGE["options.html (chrome-extension://id/options.html, full tab)"]
    F["Folder section<br/>field · chips · preview/error"]
    U["Ugoira section<br/>segmented control"]
    MD["Metadata section<br/>switch"]
    FT["Footer<br/>Reset · Report · version · privacy"]
  end
  PAGE -- "validatePattern · resolveFolder(SAMPLE)" --> PAT["shared/pattern.ts"]
  PAGE -- "readSettings · writeSettings · onSettingsChanged" --> SET["shared/settings.ts"]
  SET <--> ST[("storage.sync + storage.local")]
  ST -. "storage.onChanged" .-> CS["Content scripts (idle ugoira hints)"]
  ST -. "storage.onChanged" .-> OTHER["Other settings tabs"]
  FT -- "new tab" --> GH["github.com/kyoicn/pixivhelper/issues (R-001)"]
```

## Detailed Design

### Data Model (page state)

```ts
interface PageState {
  persisted: Settings & { updatedAt: number };   // last value known to be stored (own write or onChanged)
  lastValidPattern: string;                       // = persisted.folderPattern; shown in "Still using"
  error: PatternError | null;                     // current field validation result
  debounce: number | null;                        // setTimeout id (400 ms)
  caret: { start: number; end: number } | null;   // last known selection in the field; null until first focus
  lastOwnWriteAt: number;                         // updatedAt of this tab's most recent write (echo suppression)
}
```

### Markup (semantic skeleton; all text from `chrome.i18n`)

```html
<body hidden>                                   <!-- unhidden after i18n strings are applied (no flash of empty labels) -->
<main class="col">                              <!-- 640px column, 56px top, 24px sides -->
  <header> <div class="app-icon" aria-hidden="true">…</div> <h1 data-i18n="opt_title"></h1> <p data-i18n="opt_subtitle"></p> </header>
  <section id="folder" aria-labelledby="folder-h">
    <div class="head"><h2 id="folder-h" data-i18n="opt_folder_heading"></h2><span class="saved" aria-live="polite"></span></div>
    <p class="help" data-i18n="opt_folder_help"></p>
    <input id="pattern" type="text" class="field mono" maxlength="200" spellcheck="false" autocomplete="off" autocapitalize="off">
    <p id="pattern-error" class="error" role="alert" hidden></p>
    <div class="chips"><span data-i18n="opt_insert"></span> <button type="button" class="chip mono" data-token="{artist}">{artist}</button> … </div>
    <p id="preview" class="preview"></p>         <!-- "Preview: <mono>Downloads/…/135882741_p0.jpg</mono>" or the "Still using" line -->
  </section>
  <section id="ugoira" aria-labelledby="ugoira-h">
    <div class="head"><h2 id="ugoira-h" data-i18n="opt_ugoira_heading"></h2><span class="saved" aria-live="polite"></span></div>
    <p class="help" data-i18n="opt_ugoira_help"></p>
    <div class="seg" role="group"> <button type="button" data-value="mp4" aria-pressed="true"></button> <button … data-value="webm"> <button … data-value="zip"> </div>
  </section>
  <section id="metadata" aria-labelledby="meta-h">
    <div class="row"><div><h2 id="meta-h"></h2><p class="help" data-i18n="opt_meta_help"></p></div>
      <button type="button" id="meta" class="switch" role="switch" aria-checked="true"></button></div>
    <span class="saved" aria-live="polite"></span>
  </section>
  <footer>
    <button type="button" id="reset" class="link" data-i18n="opt_reset"></button>
    <a id="report" class="link" href="https://github.com/kyoicn/pixivhelper/issues" target="_blank" rel="noopener noreferrer" data-i18n="opt_report"></a>
    <span id="version"></span>
    <p data-i18n="opt_privacy"></p>
  </footer>
</main>
```

- `Reset to defaults` is a `<button>` styled as a link, because it performs an action. `Report an issue` is a real link (R-001). This follows the index rule "nothing is a clickable `<div>`".
- `document.title = t('opt_tab_title')` ("Helper for Pixiv — Settings", R-002); `<html lang>` = `localeTag()` (CJK glyph selection).
- The `metadata.json` part of the heading `opt_meta_heading` is wrapped in a mono span by splitting on the literal `metadata.json`, which is identical in every locale. The same technique wraps `{artist}`/`{id}`/`{title}`/`{userId}` and `frames.json` in help and error text.

### Styles (`options.css`; values from PRD CUJ-3 and mocks)

| Token | Light | Dark (`prefers-color-scheme: dark`) |
|---|---|---|
| page bg / text | `#f6f7f9` / `#1f1f1f` | `#121212` / `#e8eaed` |
| help text | `#5c6166` | `#9aa0a6` |
| field bg / border | `#fff` / 1px `#d0d5db` | `#1f1f1f` / `#3a3f45` |
| field invalid (border) | 2px `#d93025` (a non-text component: 3:1 suffices) | same |
| chip bg / border / hover | `#fff` / `#d0d5db` / border+text `#0096FA`, fill `#f0f8ff` | `#1f1f1f` / `#3a3f45` / fill `#102a3f` |
| segment bg / border / hover / selected | `#fff` / `#d0d5db` / `#f5f7f9` / `#0096FA` + white 600 | `#1f1f1f` / `#3a3f45` / `#2a2f35` / same |
| switch on / off | `#0096FA` knob right / `#bdc1c6` knob left | same / `#5f6368` |
| saved | `#188038`, 12.5 px, check icon (4.68:1 on `#f6f7f9`; CUJ-3 step 3) | `#1a9f5a` (5.49:1 on `#121212`) |
| error text (validation message) | `#c5221f`, 13 px, info icon (5.41:1; CUJ-3 step 5) | `#f28b82` (7.84:1) |
| "Still using" trailing sentence (`— your last valid pattern stays in effect …`) | `#5c6166` (5.84:1; CUJ-3 step 5) | `#8a8f94` (5.74:1) |
| links, focus ring | `#0096FA`; focus 2 px `#0096FA` on `:focus-visible` | same |
| footer rule | `#e3e6ea` | `#2a2f35` |

Geometry:
- Column 640 px; header icon 48×48 radius 12; h1 22/700; h2 16/600; help 14; sections 48 px apart.
- Field 44 px tall, radius 8, mono 14.
- Chips 28 px pills, mono 12.5; segmented 36 px, radius 10; switch 44×26.
- Footer 13 px.

Fonts: system stack (as the mocks), mono `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

`@media (prefers-reduced-motion: reduce)` removes the `Saved` fade and the switch knob transition.

#### The preview / "Still using" line (CUJ-3 steps 2 and 5; R-004 S15)

PRD CUJ-3 step 5: "The `Still using:` label never breaks across lines; the pattern and the trailing sentence flow after it as running text, so the pattern breaks only when it is longer than the line." AC: the label renders on a single line in all four locales, and the default pattern after it is not broken. The iteration-2 layout broke this: `.preview-text { display: contents }` made each part a flex item of `.preview`, so the label item shrank and wrapped (`Still` / `using:`) whenever the trailing sentence needed room. That layout followed the iteration-1 mock; the R-004 mock (`cuj-3-error.html`) lays the line out as running text.

```
<p id="preview" class="preview">                 display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 20px
  <svg …>                                         flex-shrink: 0; margin-top: 2px (centres the 16 px icon on the first 20 px line)
  <span class="preview-text">                     flex: 1 1 auto; min-width: 0   (a block of running text; replaces display: contents)
    <span class="label">Still using:</span>       white-space: nowrap
    " "                                           text node: the break opportunity after the label
    <span class="mono pattern">pixiv/{artist}-{id}</span>   display: inline-block; max-width: 100%; overflow-wrap: anywhere; color: var(--text)
    <span class="muted"> — your last valid pattern …</span> inline, wraps normally
```

- **Label.** `stillUsingLine()` splits `opt_still_using` on its placeholder as today and puts the text before it in a `.label` span with trailing whitespace moved out of the span into a text node (en `Still using: ` → `Still using:` + ` `; ja `使用中: ` likewise; zh_CN/zh_TW `仍在使用：` have none). `white-space: nowrap` then keeps the label whole in every locale without suppressing the line break after it.
- **Pattern as an atomic inline.** `inline-block` with `max-width: 100%` moves the pattern to the next line as a whole when it does not fit after the label, and wraps inside it (`overflow-wrap: anywhere`) only when it is longer than a full line: exactly "breaks only when it is longer than the line". A plain inline span (the mock's markup) would let a pattern shorter than the line break at its `-` or `/` when it starts near the end of the label's line.
- **Trailing sentence**: inline, `.muted` colour (table above), flows after the pattern.
- **The preview line** uses the same box: `Preview:` in a `.label` span, then the path inline with `.path { overflow-wrap: anywhere }` as today (a resolved path is often longer than the line, and the PRD sets no rule for it).
- The old comment "Its parts are laid out as the preview line's own flex items, as in the mocks" goes with the `display: contents` rule it described.

### Logic & Behavior

#### Load
1. `readSettings()` → `persisted`.
2. Fill the controls; apply i18n; set the version (`'v' + chrome.runtime.getManifest().version`, CUJ-3 step 10).
3. Render the preview for `persisted.folderPattern`.
4. `body.hidden = false`.
5. Subscribe `onSettingsChanged`.

#### Pattern field (CUJ-3 steps 3, 5, 6)

```mermaid
flowchart TD
  I[input event] --> T[clear + start 400 ms debounce]
  T --> V{validatePattern value}
  V -- error --> E["folder Saved indicator cleared at once<br/>field.aria-invalid=true · aria-describedby=pattern-error<br/>show first message (role=alert) · 2px red border<br/>preview → 'Still using: lastValidPattern — …'<br/>nothing stored"]
  V -- ok --> P["clear error · preview = 'Preview: Downloads/' + resolveFolder(value, SAMPLE) + '/135882741_p0.jpg'"]
  P --> C{value === persisted.folderPattern?}
  C -- yes --> X["done: no write, no Saved"]
  C -- no --> W["writeSettings({...persisted, folderPattern: value})"]
  W -- ok --> S["persisted ← new · lastValidPattern ← value · lastOwnWriteAt ← updatedAt<br/>flash Saved (folder) only if the field shows no error now"]
  W -- not ok --> N["keep the value in the field · warn log · no Saved"]
```

- **Messages** come from the PRD keys `err_empty`, `err_absolute`, `err_backslash`, `err_dotdot`, `err_unknown_token` (placeholder = the first offending fragment, an unknown `{…}` token or an unclosed `{…`, rendered mono semibold; R-004 S5) and `err_illegal_chars`, in the validator's order ([design-settings-model.md](design-settings-model.md) rule 5). Because an unclosed `{` is invalid, a pause mid-token (`pixiv/{user`) shows `Unknown token {user. …` and is never autosaved; chips insert whole tokens, so the main path never shows it.
- **Preview** always uses the fixed sample `SAMPLE` through the real `resolveFolder` (PRD CUJ-3 step 2 Details). The word `Downloads` comes from the message (`opt_preview` + literal path). It is not localized in the path, because the PRD shows `Downloads/…` as a generic label.
- **Paste, drop and inserted text** are kept on one line by `bindSingleLine` (below; CUJ-3 edge "drops newlines on paste"). `maxlength=200` truncates native typing and paste (CUJ-3 edge), and `bindSingleLine` applies the same cap to the insertions it performs itself.
- **Closing the tab with an invalid edit** loses only the draft. Storage still holds the last valid pattern, and reopening shows it with no error (CUJ-3 edge).

#### Line breaks in inserted text (CUJ-3 edge "Paste containing newlines"; QA iteration 2)

Chromium does **not** strip CR/LF from text the user inserts into an `<input type="text">`: it replaces each line break with a space before the `input` event fires (QA iteration 2: `pixiv/⏎{artist}⏎-{id}` → `pixiv/ {artist} -{id}`, which validated and saved a folder with a literal space). The HTML value-sanitization algorithm that strips line breaks applies only to programmatic `.value` writes; the first design wrongly relied on it for paste. By the time `input` fires, the spaces are indistinguishable from typed ones, so the page intercepts the insertion before Chromium edits the value.

```ts
// src/options/single-line.ts
/** Keeps CR and LF out of text inserted into `field` by paste, drop or insertText. `maxChars` is the field's cap. */
export function bindSingleLine(field: HTMLInputElement, maxChars: number): void;
```

On `beforeinput`:
1. Act only for `inputType` ∈ {`insertText`, `insertFromPaste`, `insertFromDrop`} with `event.cancelable`. The text is `event.data ?? event.dataTransfer?.getData('text/plain') ?? null` (Chromium fills `data` for these types on text controls; `dataTransfer` is the fallback). If the text is `null` or contains no `\r` or `\n`, return and let the browser insert natively, so native undo, `maxlength` and the caret stay untouched. The common path costs one regex test.
2. `event.preventDefault()`. `clean = text.replace(/[\r\n]/g, '')`: CRLF, CR and LF all disappear (PRD: "drops newlines"). Tabs and other control characters stay; validation and the D8 path-safety pass handle them as before (PRD: "Validation then runs as usual").
3. Insertion range `[start, end]` = `field.selectionStart`, `field.selectionEnd`. For a drop, Blink has already moved the selection to the drop point when it dispatches `insertFromDrop` (`DragController::ConcludeEditDrag` sets the selection to the drag caret before the replace step that fires `beforeinput`). The `deleteByDrag` half of an in-field move is a separate event and is left alone.
4. Cap: `room = maxChars − (field.value.length − (end − start))`; `clean = clean.slice(0, Math.max(room, 0))`, and drop a final lone high surrogate (as Chromium's own `maxlength` truncation does), so the field never exceeds 200 UTF-16 units and never holds half a character.
5. If `clean === ''` and `start === end`, nothing changes: stop, with no `input` event. (`clean === ''` over a selection still deletes the selection, as a native paste of nothing would.)
6. `field.setRangeText(clean, start, end, 'end')`: the selection is replaced and the caret lands right after the inserted text, as with a native paste.
7. `field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: event.inputType, data: clean }))`. `setRangeText` fires no `input` event, and every existing listener must run unchanged: the 400 ms debounce → validate → autosave path, and the chips' caret tracker.

It is bound in `initOptionsPage` right after `field.maxLength = PATTERN_MAX_CHARS`, with the same constant, before the `input` listener and `bindChips` (order does not matter for correctness; it keeps the field's wiring in one place).

**Cost:** an insertion that carried line breaks is not on the field's native undo stack, because `setRangeText` bypasses it. Accepted: it is rare, and the result is one line the user can edit.

| Criteria | **`beforeinput` + `setRangeText` + synthetic `input`** | `paste`/`drop` listeners reading `clipboardData`/`dataTransfer` | Repair in the `input` handler | `document.execCommand('insertText')` from inside `beforeinput` |
|---|---|---|---|---|
| Sees the line breaks | Yes | Yes | **No**: they are already spaces | Yes |
| Covers `insertText` (IME, assistive tech, CDP `Input.insertText`) | Yes | No | — | Yes |
| Drop position | The selection, already at the drop point | Not exposed at `drop` | — | Same as selected |
| Native undo | Lost for this insertion only | Lost | — | Kept |
| Reliability | Deterministic; unit-testable in happy-dom | Deterministic | — | A nested editing command during an editing event's dispatch is not reliably honoured |
| **Verdict** | **Selected** | Rejected | Rejected | Rejected |

#### Chips (CUJ-3 step 4)
- `caret` is tracked from the field's `select`, `keyup`, `mouseup`, `input` and `blur` events. It stays `null` until the field first receives focus.
- On chip activation (click, Enter or Space; native button):
  - `caret == null` → append the token at the end;
  - otherwise `field.setRangeText(token, start, end, 'end')`, which replaces the selection.

  Then `field.focus()`, the caret lands right after the token, and the same `input` path (debounce → validate → save) runs.
- If the insertion would exceed 200 characters, the chip does nothing (a token is never truncated into an unknown token).
- `title` = `tok_artist_tip` / `tok_id_tip` / `tok_title_tip` / `tok_userid_tip` (exact PRD copy).
- `mousedown` calls `preventDefault()`, so clicking a chip does not blur the field and lose the selection highlight. Focus is still restored explicitly.

#### Ugoira output and metadata switch (CUJ-3 steps 7, 8)
- **Segmented control:** clicking a non-selected segment sets `aria-pressed` on all three, then `writeSettings` immediately (no debounce), then flashes `Saved` on the Ugoira heading. Clicking the selected segment does nothing. Group label: `opt_ugoira_aria`.
- **Switch:** click (or Space/Enter, native) toggles `aria-checked`, writes immediately, and flashes `Saved` (metadata section). `aria-label` = `opt_meta_heading` text ("Save metadata.json").

#### `Saved` indicator
`flashSaved(section)`:
1. set content (check icon + `opt_saved`), `opacity: 1`;
2. after 2000 ms, `opacity: 0` with a 300 ms transition (instant under reduced motion);
3. then clear the text.

Re-flashing resets both timers. Each indicator is `aria-live="polite"`, so screen readers hear "Saved" (index a11y).

```ts
// src/options/saved.ts
export interface SavedIndicator {
  flash(): void;   // as above
  clear(): void;   // cancels both timers, empties the element and sets opacity 0 at once (no fade)
}
```

**An error always clears the folder section's `Saved` (CUJ-3 step 5: "No `Saved` appears").** In iteration 1 a valid save followed within 2 s by a typo showed the green `✓ Saved` next to the red error (QA iteration 1, CUJ-3 LOW bug), because the indicator ran on its own timer and `showError` never touched it. A `Saved` beside `Unknown token` invites the user to believe the typo was stored, exactly the ambiguity the step forbids. Two rules close it:
1. `showError()` calls `folderSaved.clear()` before it renders the message. Clearing has no fade: the error and the indicator are never visible together, not even for 300 ms.
2. A `writeSettings` that resolves **after** the field became invalid does not flash: the folder flash runs only if `error === null` when the write resolves. (The write itself still counts: storage holds the earlier valid pattern, and "Still using" names it.)

Clearing empties a polite live region, which announces nothing, so screen-reader users hear the `role="alert"` error alone. The other two sections' indicators are untouched (their values did not change).

#### Reset to defaults (CUJ-3 step 9)
1. Compute the sections whose value differs from `DEFAULT_SETTINGS`.
2. Cancel any pending debounce; clear any validation error.
3. `writeSettings(DEFAULT_SETTINGS)` (one write).
4. Update all controls and the preview.
5. Flash `Saved` only on the changed sections.

There is no confirmation (PRD).

#### Two settings tabs (CUJ-3 edge)
`onSettingsChanged` fires in every tab within milliseconds, well inside the 1 s requirement.
- If `updatedAt === lastOwnWriteAt`, it is this tab's own echo: ignore it.
- Otherwise:
  - update `persisted`, the segmented control and the switch;
  - update the pattern field **unless** the field holds an invalid draft (PRD: "the edit is left alone"), or the field is focused with a pending debounce (the user is typing, and their save will be the newest);
  - refresh the preview or the "Still using" line;
  - **no** `Saved` flash (that is reserved for this tab's own saves).

### Accessibility (index "Accessibility")
- The field has `aria-label` = `opt_folder_aria` ("Folder pattern"). When invalid: `aria-invalid="true"` and `aria-describedby="pattern-error"` (`role="alert"`).
- Chips are `<button type="button">`. The segmented control is `role="group"` with `aria-pressed` buttons. The switch is `role="switch"` + `aria-checked`. Reset is a `<button>`; Report is an `<a>`.
- The DOM order equals the PRD tab order: field → 4 chips → MP4 → WebM → ZIP only → switch → Reset to defaults → Report an issue.
- Every control shows a 2 px `#0096FA` `:focus-visible` ring. Help text is linked via `aria-describedby` on each section's primary control.
- Contrast: the Saved, validation and "Still using" colours are the PRD's AA values (CUJ-3 steps 3 and 5, R-004 S2; [system.md §11.5](system.md)). The chip hover (`#0096FA` on `#f0f8ff`, 2.90:1) shows only under the pointer and leaves the token text unchanged, which is the index's hover-tint case. Two PRD values are below 4.5:1 **at rest** and are covered by neither acceptance, because the index accepts pixiv blue with white only for the injected button's fill and Saved text:
  - the selected Ugoira segment, white semibold 14 px on `#0096FA`, 3.11:1 (CUJ-3 step 7);
  - the footer links, `#0096FA` 13 px on the page's `#f6f7f9`, 2.91:1 (CUJ-3 step 10).

  The page ships the PRD values. The conflict with the index rule is with pm, pending `/spec-sync` ([system.md §15](system.md) gap 2).

## Data Flow

```mermaid
sequenceDiagram
  participant U as User
  participant A as Settings tab A
  participant S as shared/settings
  participant ST as storage.sync/local
  participant B as Settings tab B
  participant CS as pixiv tab (idle ugoira)
  U->>A: click WebM
  A->>A: aria-pressed update
  A->>S: writeSettings({ugoiraOutput:'webm'})
  S->>ST: set sync + local (updatedAt t1)
  A->>A: lastOwnWriteAt = t1 · flash Saved (Ugoira)
  ST-->>A: onChanged (t1 = own echo → ignored)
  ST-->>B: onChanged → update segmented control (no Saved)
  ST-->>CS: onChanged → hint "Download · WebM" (≤ 1 s)
```

## Alternatives Considered

| Criteria | **Debounced autosave (400 ms), immediate for discrete controls** | Save on blur | Explicit Save button |
|---|---|---|---|
| PRD CUJ-3 steps 3/7/8 | Matches exactly | Contradicts | Contradicts ("no Save button") |
| Never stores invalid | Yes (validate before write) | Yes | Yes |
| Sync write quota | ≤ 2.5 writes/s worst case; local mirror covers quota errors | Lower | Lowest |
| **Verdict** | **Selected** | Rejected | Rejected |

| Criteria | **`options_ui.open_in_tab: true` + custom open/focus** | Embedded options (`open_in_tab: false`) | `runtime.openOptionsPage()` only |
|---|---|---|---|
| Full tab (PRD) | Yes | No (dialog in chrome://extensions) | Yes |
| Opens to the right of the current tab; focuses an existing tab and its window | Yes (`tabs.create` index; `getContexts` + `windows.update`) | — | Unspecified by Chrome docs |
| **Verdict** | **Selected** | Rejected | Rejected |

## Cross-Cutting Concerns

- **Error handling:** a storage failure on both areas means no `Saved` and a `warn` log; the value stays in the UI for the next attempt. There is no user-facing error copy for this case in the PRD (it is near-impossible: `storage.local` failing). Flagged as an open question.
- **Security:** static HTML. Dynamic text is set via `textContent` only. The Report link is a constant URL with `rel="noopener noreferrer"`. No remote resources: no web fonts, and Tailwind (used in the mocks) is not used.
- **Performance:** the page is static; validation and preview take < 1 ms per debounce. Bundle < 15 KB.
- **i18n:** every string comes from `_locales` (keys in PRD Appendix A "Settings page"). Placeholder parts are styled via `splitOnPlaceholder` ([system.md §11.4](system.md)). The layout must not clip in any locale: the segmented control widths are intrinsic, and the column wraps.
- **Testing:**
  - Unit (happy-dom, fake timers): `bindSingleLine` with synthetic `InputEvent`s: `insertFromPaste` of `pixiv/\n{artist}\r\n-{id}\n` into an empty field → `pixiv/{artist}-{id}`, caret at the end, one `input` event; the same over a selection replaces it; `insertFromDrop` at a caret inside the value; `insertText` with a newline; text without line breaks is not prevented; a non-cancelable event is not prevented; only newlines with a collapsed selection → no change and no `input`; the 200 cap with a surrogate pair at the cut; `stillUsingLine` returns the label span without trailing whitespace, a space text node, the pattern span and the muted sentence, in all 4 locales; debounce timing; each validation message rendered with the right ARIA, including `pixiv/{user` → `Unknown token {user. …` with no write; "Still using" shows the last valid pattern; a valid save then an invalid edit within 2 s leaves the folder indicator empty the moment the error renders; a write that resolves after the field turned invalid does not flash; `clear()` cancels a pending fade; chip insertion at caret, with a selection, never-focused append and the 200-char guard; reset's changed-section detection; cross-tab update rules (invalid-draft and typing exemptions; own-echo suppression).
  - E2E: real page in Chromium in light and dark (`emulateMedia`) × 4 locales (launch flag `--lang`), keyboard-only walkthrough in PRD tab order, reload persistence, two-tab sync ([design-test-harness.md](design-test-harness.md)); regression for the CUJ-3 bug: insert a chip (valid, saves), then within 2 s type `pixiv/{artst}-{id}` → no `Saved` beside Download folder while the error shows; computed colours of the Saved, error and "Still using" texts in light and dark equal the Styles table; QA's paste test (`pixiv/\n{artist}\r\n-{id}\n` → `pixiv/{artist}-{id}`, preview `Downloads/pixiv/みずき-135882741/135882741_p0.jpg`) plus a single-line paste with a trailing newline (no trailing space) and `keyboard.insertText` with a newline; `pixiv/{user` paused → the message, no `Saved`, reload shows the last valid pattern; `pixiv/a}b` saves; in the error state of all 4 locales the `.label` has one client rect and the default pattern one client rect.

## Dependencies & Integration Points

- **Depends on:** `src/shared/{settings, pattern, i18n, dom}`; `chrome.storage`; `chrome.runtime.getManifest`.
- **Depended on by:** the SW toolbar handler (opens it); content scripts and the SW consume the settings it writes.

## Open Questions & Risks

- **No PRD copy for a total storage failure** (both areas reject). The design shows no `Saved` and keeps the value. pm may want a message. Low priority.
- **Footer link and selected-segment contrast** (system.md §15 gap 2).
  - PRD CUJ-3 step 10's `#0096FA` links on `#f6f7f9` measure 2.91:1. Step 7's selected segment, white on `#0096FA`, measures 3.11:1.
  - The index requires 4.5:1 at rest for every pair outside the button's pixiv-blue acceptance, and it says CUJ-3's colours pass.
  - Both are kept as specified until pm's `/spec-sync`. pm recommends `#0b6fc2` for the light-mode links and for the selected segment in both modes. In `options.css` that is one text-accent variable used by `.link` and `.seg button[aria-pressed='true']`.
- **Drop placement is verified once by QA.** `bindSingleLine` reads the drop point from the selection, which Blink sets before `insertFromDrop` (Line breaks in inserted text, step 3). Synthesizing a native text drag in Playwright is fiddly, so the unit tests cover the handler and QA drags multi-line text into the field once per run. If the text ever lands at the old caret instead, leave `insertFromDrop` to the browser: the PRD names paste only.
