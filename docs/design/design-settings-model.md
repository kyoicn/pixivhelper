# Settings Model & Folder Paths (shared domain logic)

> Last updated: 2026-10-23 16:31:01 (UTC-7)
> Serves: prd-000 — §4.4 (folder pattern & sanitization, incl. the Chrome path-safety pass per R-004 S8), §4.9 (settings model), CUJ-1 (folder resolution), CUJ-3 (validation incl. the unclosed `{` per R-004 S5, preview, persistence), CUJ-5 (retry into the same folder)

## Overview

This chapter specifies the pure, shared modules every context uses:

- `src/shared/settings.ts`: settings schema, defaults, read/merge/write across `storage.sync` and `storage.local`, and change observation;
- `src/shared/pattern.ts`: folder-pattern validation (CUJ-3 messages), resolution with token sanitization (script parity + PRD extension), and the Chrome path-safety pass that guarantees `chrome.downloads` accepts the result.

Users are the options page ([design-options-page.md](design-options-page.md)): editing, preview, validation. The download engine ([design-download-engine.md](design-download-engine.md)) uses it for the snapshot and resolution. The content script ([design-artwork-button.md](design-artwork-button.md)) uses it for the ugoira hint. The rules live here once, so the preview, the job and the hint can never disagree (PRD CUJ-3 step 2: "run through the real resolution rules").

## Goals & Non-Goals

**Goals**
- **Parity:** token sanitization reproduces `safe_component` in `ref/pixiv-dl` exactly, before the PRD's and Chrome's additions. This is proven by golden vectors generated from the script (ENG-003).
- **Totality:** for any valid pattern and any pixiv data, `resolveFolder` returns a path that Chrome's `IsSafePortableRelativePath` accepts. A download must never fail with "Invalid filename".
- **Persistence:** an invalid pattern is never stored. The newest valid save wins across `sync`/`local` (PRD §4.9, CUJ-3 edges).

**Non-Goals**
- Filesystem length limits beyond the PRD's bounds (60-byte tokens, 200-character field). Longer real paths surface as a `disk` error ([system.md §15](system.md) risks).
- More than the three settings (PRD Goal 3).

## System Context

```mermaid
flowchart LR
  OPT["Options page"] -- "validatePattern · resolveFolder(SAMPLE) · writeSettings" --> M
  SW["Service worker"] -- "readSettings (snapshot) · resolveFolder(work) · isSafeRelativeFolder" --> M
  CS["Content script"] -- "readSettings · onSettingsChanged" --> M
  subgraph M["src/shared/settings.ts + pattern.ts (pure)"]
    V[validatePattern]
    R[resolveFolder]
    ST[sanitizeToken]
    CSS[chromeSafeSegment]
    RS[readSettings / writeSettings]
  end
  R --> ST
  R --> CSS
  RS <--> SYNC[("storage.sync · settings")]
  RS <--> LOCAL[("storage.local · settings (mirror)")]
```

## Detailed Design

### Data Model

```ts
export interface Settings { folderPattern: string; ugoiraOutput: 'mp4' | 'webm' | 'zip'; saveMetadata: boolean; }
export const DEFAULT_SETTINGS: Settings = { folderPattern: 'pixiv/{artist}-{id}', ugoiraOutput: 'mp4', saveMetadata: true };
export const PATTERN_MAX_CHARS = 200;                 // PRD §4.9 (UTF-16 code units, as <input maxlength> counts)

interface StoredSettings extends Settings { v: 1; updatedAt: number }   // key 'settings' in storage.sync AND storage.local
```

- **One key per area.** One write operation per change keeps well inside `storage.sync` limits (`QUOTA_BYTES_PER_ITEM` 8192, `MAX_WRITE_OPERATIONS_PER_MINUTE` 120). The record is < 400 bytes.
- **Field-wise parsing on read.** Each field is validated independently. An invalid or unknown-type field takes its default, so a corrupt or future-version record degrades per field instead of resetting everything. A stored pattern that fails `validatePattern` (impossible through the UI, but defensive) is treated as absent.

### API / Interface Contract

```ts
// settings.ts
export function readSettings(): Promise<Settings & { updatedAt: number }>;
export function writeSettings(next: Settings): Promise<{ ok: boolean; updatedAt: number }>;
// rejects (programming error) if next.folderPattern is invalid; updatedAt is the stamp written, which the options
// page keeps as lastOwnWriteAt to recognize its own storage.onChanged echo (design-options-page.md "Two settings tabs")
export function onSettingsChanged(cb: (s: Settings) => void): () => void;   // storage.onChanged for 'settings' in sync|local → re-read merged
export function effectiveFormat(setting: Settings['ugoiraOutput'], caps: { avc: string | null; vp9: boolean }): 'mp4' | 'webm' | 'zip';

// pattern.ts
export type PatternError =
  | { code: 'empty' } | { code: 'absolute' } | { code: 'backslash' } | { code: 'dotdot' }
  | { code: 'unknownToken'; token: string } | { code: 'illegalChars' }
  | { code: 'tooLong' };   // defensive only: > PATTERN_MAX_CHARS; the field's maxlength keeps user input within it, so it has no UI copy
export function validatePattern(p: string): PatternError | null;
export interface TokenValues { artist: string | null; id: string; title: string | null; userId: string | null; }
export function resolveFolder(pattern: string, v: TokenValues): string;     // precondition: validatePattern(pattern) === null
export function sanitizeToken(s: string, opts?: { parityOnly?: boolean }): string;
export function chromeSafeSegment(seg: string): string;                     // '' means "drop this segment"
export function isSafeRelativeFolder(folder: string): boolean;
export const SAMPLE: TokenValues = { artist: 'みずき', id: '135882741', title: '雨上がりの渋谷', userId: '40285173' };  // PRD CUJ-3 step 2
```

### Logic & Behavior

#### Read / write algorithm

```mermaid
flowchart TD
  W[writeSettings next] --> V{validatePattern ok?}
  V -- no --> E[throw: caller bug — UI never calls with invalid]
  V -- yes --> S["rec = {...next, v:1, updatedAt: Date.now()}"]
  S --> A["sync.set({settings: rec}) — ok1 (catch: quota / disabled → false)"]
  A --> B["local.set({settings: rec}) — ok2"]
  B --> C{"ok1 || ok2"}
  C -- yes --> OK["{ok:true} → UI shows Saved"]
  C -- no --> F["{ok:false} → UI keeps the value, no Saved, warn log"]
  R[readSettings] --> G["allSettled(sync.get, local.get)"]
  G --> H[parse each field-wise]
  H --> I{both present?}
  I -- yes --> J["newest updatedAt wins (tie → sync)"]
  I -- one --> K[that one]
  I -- none --> D[DEFAULT_SETTINGS]
```

- **Why dual-write + newest-wins.** The PRD says "falls back to `chrome.storage.local` if sync is unavailable or over quota" and "Reads prefer sync and fall back to local" (CUJ-3 edge). A literal "read sync first" would return a **stale** sync value after a write that only reached local (e.g. the per-minute write quota was hit), which breaks "Reloading the settings page shows the most recently saved values" (CUJ-3 AC). Newest-wins with a sync tie-break keeps sync preferred and is always current. Values synced from another device arrive in sync with a newer `updatedAt` and win, as intended.
- **The user sees `Saved` whenever at least one area stored the value** (PRD CUJ-3 edge: "the user still sees Saved").
- **Snapshot:** the SW calls `readSettings()` once at `job/start` and stores the result in `JobRecord.snapshot` (PRD §4.1 #8).

#### Pattern validation (CUJ-3 step 5; first failing rule wins, in this order)

| # | Rule | Implementation | Message key |
|---|---|---|---|
| 1 | Empty after trimming whitespace | `p.trim() === ''` | `err_empty` |
| 2 | Absolute / not inside Downloads | `p.startsWith('/') \|\| /^[A-Za-z]:/.test(p) \|\| /^~(\/\|$)/.test(p) \|\| p.startsWith('\\\\')` | `err_absolute` |
| 3 | Contains `\` | `p.includes('\\')` | `err_backslash` |
| 4 | A `..` segment | `p.split('/').some(s => s.trim() === '..')` | `err_dotdot` |
| 5 | Unknown `{…}` token, or a `{` that is never closed (R-004 S5) | scan `/\{[^{}]*(?:\}\|(?=\{)\|$)/g` (the `\|` are the regex's alternations, escaped for this table) left to right; the first match that does not end in `}` (unclosed), or ends in `}` but is not `{artist}`, `{id}`, `{title}` or `{userId}` (case-sensitive), is the error | `err_unknown_token` with that fragment |
| 6 | Literal text contains `: * ? " < > \|` | test `p` with the known tokens removed against `/[:*?"<>\|]/` | `err_illegal_chars` |
| 7 | Longer than 200 UTF-16 units (defensive; unreachable from the field) | `p.length > PATTERN_MAX_CHARS` → `{ code: 'tooLong' }` | none (renders `err_illegal_chars` if ever shown) |

- **Rule 5 fragments** (PRD CUJ-3 step 5). A `{` is unclosed when another `{` or the end of the pattern comes before any `}`. The fragment then runs from that `{` up to the next `{` (exclusive) or to the end, and the message names it: `pixiv/{user` → `Unknown token {user. Available tokens: …`; `a{b{id}` → `{b`; `pixiv/{artst}-{` → `{artst}` (the leftmost offending fragment wins). Because an unclosed `{` is invalid, the 400 ms autosave can never store a fragment typed mid-token; chips insert whole tokens and never produce one.
- **A `}` that closes no `{` is a literal character**: `pixiv/a}b` and `}{id}` are valid, saved, and resolve with the `}` kept (Chrome accepts `}` in a folder name; the shell-extension check in step e looks only at a `.{…}` extension).
- Rule 6 then sees only literal text: once rule 5 passes, every `{` belongs to a known token, so removing the known tokens leaves the literal characters (including any lone `}`).
- Length is enforced by the field (`maxlength=200`), not by the validator. The validator additionally rejects `> 200` as rule 7, `{ code: 'tooLong' }`, for defense against programmatic writes (`writeSettings` and a corrupt stored record). It runs last, so a too-long pattern that also breaks rules 1–6 reports that rule. It has no message key of its own (the PRD has no copy, and the page cannot produce it: `maxlength` and the chip guard keep the field within 200); should it ever reach the options page, it renders `err_illegal_chars` and, like every error, is never stored. `readSettings` treats a stored too-long pattern as absent, the same path as any invalid stored pattern.

#### Resolution (PRD §4.4 "Resolution at job start")

```
resolveFolder(pattern, v):
  s = pattern with each known token replaced by sanitizeToken(value ?? '')    // id is digits; null fields sanitize to 'unknown'
  segs = s.split('/').map(chromeSafeSegment).filter(seg => seg !== '')         // empty segments and trailing '/' dropped (PRD §4.4.3)
  return segs.length ? segs.join('/') : 'unknown'
```

#### Token sanitization: `sanitizeToken(s)`

Steps 1–6 are `safe_component` in `ref/pixiv-dl`. The marked steps are additions.

| Step | Operation | Source |
|---|---|---|
| 1 | `s.normalize('NFC')` | script |
| 2 | Remove `[\x00-\x1f\x7f/:\\]` | script |
| 2+ | Also remove `[*?"<>\|]` | **PRD §4.4.2 extension** |
| 3 | Replace runs of Python-`str.isspace` characters with one `_`: `/[\t\n\v\f\r\x1c-\x1f \x85\xa0  -     　]+/g` (not JS `\s`, which differs: it includes U+FEFF and lacks U+0085/U+001C–1F) | script (Python `re` `\s` semantics) |
| 3+ | Remove the remaining Chrome-illegal characters: Unicode general categories **Cc** and **Cf** (e.g. U+0080–U+009F, U+200B–U+200F, U+200D ZWJ, U+2060–U+2064, U+FEFF, U+E0001–U+E007F) and **noncharacters**. Implemented per code point: drop if `/[\p{Cc}\p{Cf}]/u` matches, or `(cp >= 0xFDD0 && cp <= 0xFDEF) || (cp & 0xFFFE) === 0xFFFE` (U+FDD0–U+FDEF and U+nFFFE/U+nFFFF in every plane) | **Chrome extension (D8)** |
| 4 | Strip leading/trailing `.`, `_`, space (`/^[._ ]+\|[._ ]+$/g`) | script |
| 4+ | In the same edge trim, also strip `~`: the class becomes `[._ ~]` (`/^[._ ~]+\|[._ ~]+$/g`), here and in step 5's re-trim | **Chrome extension (D8)** |
| 5 | Truncate to ≤ 60 UTF-8 bytes on a code-point boundary (accumulate per code point: 1/2/3/4 bytes; lone surrogates count as U+FFFD = 3, matching `TextEncoder`), then strip `._ ` again | script |
| 6 | Empty → `'unknown'` | script |

- Step 3+ runs **after** step 3, so whitespace-class controls such as U+0085 still become `_` exactly as in the script. Only non-whitespace format/control characters are removed.
- **Why step 4+ (iteration 2).** Chrome refuses a path component that begins or ends with `~` (segment pass step b). In the first design only the segment pass trimmed it, so a token value made only of `~` and `.` (artist `~`, title `.~.`) survived steps 1–6 as non-empty (`~`), became an empty **segment** in step b, and the segment was dropped: `resolveFolder('pixiv/{artist}/{title}', artist '~')` returned `pixiv/<title>`, losing a folder level (code review W3, PM iteration-1 review). That contradicts PRD §4.4 step 1.6 ("If the result is empty, use `unknown`") and the CUJ-1 edge "A name that sanitizes to nothing becomes `unknown` … The folder never gets an empty segment", because for Chrome such a value *is* empty. Trimming `~` inside the token's own edge trim makes such values empty there, so step 6 turns them into `unknown`: `pixiv/unknown/<title>`. It also strips a token's edge `~` when the token shares a segment with literal text (`~sora~` → `sora`), which the segment pass would have done for the leading `~` anyway; a `~` inside a value is kept (`so~ra`). After step 4+, steps 1–5 can leave no Chrome-refused character at a token's edges: Python whitespace became `_` in step 3 and is a superset of ICU White_Space, Cc/Cf/noncharacters went in step 3+, and `.`/`~` go here. The segment pass still runs on whole segments for literal text and for reserved names, shell extensions and 8.3 shapes.
- `{ parityOnly: true }` skips the PRD and Chrome steps, giving a byte-for-byte reimplementation of `safe_component`. It is used only by the golden parity test.

#### Chrome path-safety pass: `chromeSafeSegment(seg)` (D8)

Chrome's `chrome.downloads.download` rejects a `filename` unless every path component passes `net::IsSafePortablePathComponent`. Per Chromium source (`net/base/filename_util_icu.cc`, `base/i18n/file_util_icu.cc`, `base/files/file_util.cc`), a component must:
- contain no `"*/:<>?\|`, Cc, Cf or noncharacters;
- not begin or end with White_Space, `.` or `~`;
- not be a Windows reserved name, even on macOS/Linux;
- not end in a shell-integrated extension;
- on Windows only, not be a short-name-shaped string containing `~`.

PRD §4.4 step 2 lists only part of this; step 3 adopts the pass on every whole folder segment, literal text and token values together, and the preview shows the exact result (R-004 S8). The pass:

| Step | Operation | Example |
|---|---|---|
| a | Remove `["*:<>?\|]`, Cc, Cf, noncharacters (literal text could still carry e.g. a pasted TAB or ZWJ) | `pixiv\t` → `pixiv` |
| b | Repeatedly trim leading/trailing ICU White_Space (same set as step 3 plus U+0085/U+00A0 …), `.` and `~` | `~sora~-123` → `sora~-123`; `pixiv ` → `pixiv`; `...` → `` (dropped) |
| c | Empty → `''` (segment dropped) | |
| d | Windows reserved name → **prefix** `_`, as Chrome's own `GenerateSafeFileName` does. Test: lowercase, trim trailing ` .`, take the part before the first `.`, check against `con prn aux nul com1–com9 lpt1–lpt9 clock$`; or the whole lowercase name against `desktop.ini thumbs.db conin$ conout$` | `CON` → `_CON`; `nul.txt` → `_nul.txt` |
| e | Shell-integrated extension (text after the last `.`, lowercase, ∈ {`local`, `lnk`, `scf`, `url`} or wrapped in `{}`) → **append** `_` | `My.url` → `My.url_` |
| f | Windows 8.3-shaped segment containing `~` (≤ 12 UTF-16 units, none of White_Space `"\/[]:+\|<>=;?,*`, valid 8.3 dot position) → replace `~` with `_`. Applied on **every** platform, so a synced archive gets identical folder names on Mac and Windows. | `ab~c` → `ab_c` |

`isSafeRelativeFolder(f)`:
- `f` is non-empty and ≤ 1024 chars;
- `!f.startsWith('/')`;
- every `/`-separated segment is non-empty, not `.`/`..`, and satisfies `chromeSafeSegment(seg) === seg`.

The SW uses it to re-validate folders echoed back by the tab in retry requests.

Golden examples (unit-tested):

| Input | Result |
|---|---|
| pattern `pixiv/{artist}-{id}`, artist `みずき`, id `135882741` | `pixiv/みずき-135882741` (PRD) |
| artist `  Sora / 空 :: 2nd  ` | `{artist}` → `Sora_空_2nd` (PRD) |
| artist `...` | `unknown` (PRD) |
| artist `👩‍🎨Mika` (with ZWJ) | `👩🎨Mika` (ZWJ removed; Chrome would refuse it) |
| artist `~sora~`, pattern `{artist}-{id}`, id `1` | parity `safe_component` → `~sora~`; full `sanitizeToken` → `sora` (step 4+); folder `sora-1` |
| artist `so~ra`, pattern `{artist}-{id}`, id `1` | `{artist}` → `so~ra`; segment `so~ra-1` is 8.3-shaped (7 units, no excluded character), so step f → `so_ra-1` |
| artist `~`, pattern `pixiv/{artist}/{title}`, title `T` | `{artist}` → `unknown` (step 4+ then 6); folder `pixiv/unknown/T` (was `pixiv/T`) |
| title `.~.`, pattern `{title}` | `unknown` |
| literal pattern `~sora~-1` (no token) | segment step b → `sora~-1`, 8.3-shaped → step f → `sora_-1` (the first design's table wrongly said `sora~-1`; step f is normative) |
| pattern `pixiv` | `pixiv` (all works in one folder; PRD example) |
| pattern `a//b/` | `a/b` (PRD §4.4.3) |
| pattern `{title}`, title `CON` | `_CON` |

## Data Flow

```mermaid
sequenceDiagram
  participant U as User (options)
  participant O as Options page
  participant P as pattern.ts
  participant S as settings.ts
  participant SY as storage.sync
  participant LO as storage.local
  participant CS as Content scripts
  participant SW as Service worker
  U->>O: types "pixiv/{artist}/{title}"
  O->>O: debounce 400 ms
  O->>P: validatePattern → null
  O->>P: resolveFolder(pattern, SAMPLE) → preview
  O->>S: writeSettings
  S->>SY: set settings (v, updatedAt)
  S->>LO: set settings (mirror)
  SY-->>CS: storage.onChanged → readSettings → idle ugoira hint
  Note over SW: later click
  SW->>S: readSettings → snapshot
  SW->>P: resolveFolder(snapshot.folderPattern, work) → folder
```

## Alternatives Considered

| Criteria | **Dual-write, newest-wins** | Sync-only, local on error, read sync-then-local | Local only |
|---|---|---|---|
| PRD: sync with local fallback | Yes | Yes | No |
| Always returns the most recent save (CUJ-3 AC) | Yes | **No** (stale sync after a quota-hit local write) | Yes |
| Cross-device sync | Yes | Yes | No |
| Complexity | Low (+ `updatedAt`) | Low | Lowest |
| **Verdict** | **Selected** | Rejected | Rejected |

| Criteria | **Silent Chrome-safety pass (D8)** | New validation messages for unsafe literal text | Do nothing beyond PRD §4.4 |
|---|---|---|---|
| Artist names with ZWJ / `~` / reserved words download | Yes | Only literal text is covered, so artist data still fails | **No** (every file fails "Invalid filename") |
| Needs new PRD copy | No (PRD §4.4 step 3 adopts the pass, R-004 S8) | Yes (pm, 4 locales) | No |
| User sees the effect | Yes, in the preview | Yes | — |
| **Verdict** | **Selected** | Possible later for literal text if pm prefers (would shrink step a/b's scope) | Rejected |

## Cross-Cutting Concerns

- **Error handling:** `writeSettings` never throws for storage errors; it reports `{ ok }`. It throws only on a precondition violation (an invalid pattern is a caller bug). `readSettings` never throws (missing or invalid → defaults per field).
- **Security:**
  - Resolution output is passed to `chrome.downloads` only as `folder + '/' + basename`, where `basename` is allowlisted ([system.md §11.1](system.md)).
  - Traversal is impossible: `..` is rejected by validation, every segment is re-checked by `chromeSafeSegment`, and `isSafeRelativeFolder` guards echoed folders.
- **Performance:** resolution is O(pattern length), < 0.1 ms. Validation runs once per debounce.
- **Observability:** `debug` log of the resolved folder per job (local only).
- **Testing:**
  - Golden parity: `sanitizeToken(s, { parityOnly: true }) === safe_component(s)` for every vector in `test/golden/safe_component.json`. ENG-003 generates ≥ 200 vectors: all PRD examples, every Python whitespace char, controls, emoji/ZWJ, NFC/NFD pairs, 59/60/61-byte CJK boundaries, 4-byte characters at the boundary, `.`/`_`/space edges, empty strings.
  - Unit: each validation rule and its precedence (e.g. `/a\..` → rule 2 wins; a 201-character pattern with a stray `:` → rule 6, not 7), rule 5's fragments (`pixiv/{user` → `{user`, `pixiv/{artist` → `{artist`, `{id}{` → `{`, `a{b{id}` → `{b`, `pixiv/{artst}-{` → `{artst}`; `pixiv/a}b` and `}{id}` valid), each D8 step with the table above, every Golden example row (including `~` → `unknown`, `.~.` → `unknown`, `~sora~` → `sora`, `so~ra-1` → `so_ra-1`, literal `~sora~-1` → `sora_-1`), `isSafeRelativeFolder`, newest-wins merging (sync newer, local newer, tie, one missing, corrupt fields), `writeSettings` returning the `updatedAt` it stored, `effectiveFormat` truth table.
  - Golden parity is unaffected by step 4+: `parityOnly` keeps the script's `[._ ]` edge class, and `test/golden/safe_component.json` does not change.
  - Property test (fast-check is optional; a seeded random generator is enough): for 10 000 random Unicode strings, every segment of `resolveFolder('{artist}/{title}', …)` satisfies a JS port of Chrome's `IsSafePortablePathComponent` predicate.

## Dependencies & Integration Points

- **Depends on:** `chrome.storage.sync`, `chrome.storage.local`, `chrome.storage.onChanged` (settings.ts only; pattern.ts is fully pure).
- **Depended on by:** options page, service worker (snapshot, resolution, retry folder validation), content script (hint, reactivity), golden tests.

## Open Questions & Risks

- **Stored fragments from earlier builds.** A pattern with an unclosed `{` that an iteration-1/2 build autosaved now fails `validatePattern`, so `readSettings` treats it as absent and the default pattern applies. No released build exists, so no user can be affected; the rule is noted for completeness.
- The ICU White_Space set used in step b must match Chrome's exactly. It is pinned as a constant with a unit test listing every code point (U+0009–U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000).
