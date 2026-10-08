# Project Status

> Auto-generated project status summary.
> Last updated: 2026-10-08 13:16:55 (UTC+8)

## Overview
**pixiv Downloader** is a planned Chrome extension (Manifest V3, desktop Chrome) that adds one Download button to every pixiv artwork page. One click saves the whole artwork into its own folder under Chrome's Downloads folder: originals, a `metadata.json`, and for ugoira the frame zip, `frames.json` timing list, and a video encoded in the browser. It replaces the personal terminal script `ref/pixiv-dl`.

Current phase: **just designed, nothing built.** The PRD (`docs/prd/prd-000-mvp.md`) and HTML mockups exist. There is no implementation code, no QA run, no PM review, no design docs, and no `docs/tasks.md` yet.

## Tech Stack
Planned, per the PRD. Nothing is installed and there is no `package.json`.

| Area | Choice (from PRD) |
|------|-------------------|
| Platform | Chrome extension, Manifest V3, desktop Chrome, Chrome Web Store |
| Runtime | Background service worker runs jobs; offscreen document does encoding; content script injects the button |
| Ugoira encoding | WebCodecs to MP4/H.264, WebM as fallback |
| Downloads | Chrome downloads API, at most 5 concurrent files per artwork, `conflictAction: "uniquify"`, no Save As prompt |
| Locales | `en`, `ja`, `zh_CN`, `zh_TW`, following Chrome's UI language |
| Language and build tooling | Not decided yet (engineering owns this) |

## Architecture
Not implemented. The PRD describes this intended shape:
- **Content script** on artwork pages injects the Download button into the action row (floating bottom-right fallback if the row is not found within 3 s). pixiv selectors are meant to live in one place.
- **Background service worker** runs each job: snapshot settings, fetch `/ajax/illust/{id}`, then `/pages` (illustType 0/1) or `/ugoira_meta` (illustType 2), resolve the folder, write `metadata.json`, hand files to Chrome in page order, report progress to the tab and the toolbar badge.
- **Offscreen document** encodes ugoira video.
- **Options page** opens in a full tab from the toolbar icon (no popup) and has exactly three settings: folder pattern, ugoira output (MP4 default, WebM, ZIP only), and `metadata.json` on/off.
- **Retry policy** (parity with `ref/pixiv-dl`): up to 4 attempts per request; retry on 429/500/502/503/504, network errors, 30 s timeout; no retry on 403 or other 4xx; backoff about 1.5 s, 3 s, 6 s.

## CUJ Status

The authoritative per-CUJ snapshot. Each row records the latest known state across three independent dimensions: **Impl** (does the code exist?), **QA** (engineering verification), **PM** (product judgment). `docs/qa-report.md` and `docs/pm-review.md` do not exist yet.

| CUJ | PRD | Priority | Impl | QA | PM |
|-----|-----|----------|------|----|----|
| CUJ-1: Download an illustration or manga from the artwork page | prd-000 | P0 | not started | — | — |
| CUJ-2: Download an ugoira | prd-000 | P0 | not started | — | — |
| CUJ-3: Configure the extension from the toolbar icon | prd-000 | P0 | not started | — | — |
| CUJ-4: Follow several downloads at once from the toolbar badge | prd-000 | P1 | not started | — | — |
| CUJ-5: Recover when a download can't start or breaks | prd-000 | P0 | not started | — | — |

**Column values:**
- `Impl`: `not started` | `in progress` | `merged`
- `QA`: `PASS` | `FAIL` | `BLOCKED` | `NOT_RUN` | `WAIVED` | `UNIMPLEMENTED` | `—` (no QA run yet)
- `PM`: `Satisfied` | `Caveats` | `Not done` | `—` (no PM review yet)

A CUJ is **fully done** when Impl=`merged`, QA=`PASS`, AND PM=`Satisfied`. None are done.

Dependencies (from PRD): CUJ-1 and CUJ-3 have none; CUJ-2 needs CUJ-1 and CUJ-3; CUJ-4 needs CUJ-1; CUJ-5 needs CUJ-1 and CUJ-2. Suggested order: CUJ-1 and CUJ-3 in parallel, then CUJ-2 and CUJ-4, then CUJ-5.

## Key Types & Interfaces
No code exists, so no types are defined. Concepts named in the PRD: **job** (one click on one artwork in one tab), settings snapshot (folder pattern, ugoira output, metadata on/off), button states (idle, downloading, needs login, error), `metadata.json` (same fields as `ref/pixiv-dl`), and `frames.json` (ugoira frame timing). Concrete type definitions will be an engineering design output.

## Data Flow
Intended flow (not built): click on the artwork page, content script messages the service worker, which fetches pixiv's ajax endpoints with the user's session, writes `metadata.json`, then queues originals through Chrome's downloads API. For ugoira, the frame zip is downloaded, encoded in the offscreen document, and the video is written. Progress goes back to the tab and to the toolbar badge (total files remaining).

## File Structure
```
/Users/xlw/workspace/codebase/pixivhelper
├── docs/
│   ├── prd/index.md                    product vision, personas, PRD and CUJ index
│   ├── prd/prd-000-mvp.md              MVP spec (CUJ-1 to CUJ-5)
│   └── ux/prd-000-mvp-mockups/         12 HTML mocks (cuj-1-* to cuj-5-*)
├── ref/pixiv-dl                        reference terminal script the product replaces
└── .claude/settings.local.json
```
No source directories, `package.json`, `CLAUDE.md`, `docs/qa-report.md`, `docs/pm-review.md`, `docs/tasks.md`, or design docs exist yet.

## Recent Activity
Git repository initialized, no commits yet, so there is no history to summarize. Activity so far is the design bootstrap (Route A): PRD index, PRD-000, and mockups were written. No implementation commits.

## Owner Queue
`Owner queue: 2 open (oldest R-001, since 2026-10-08) → docs/owner-queue.md`

## Known Issues & TODOs
- Next step: produce engineering design and a task plan (`docs/tasks.md`), then implement CUJ-1 and CUJ-3 first.
- Open assumption in the PRD (4.5.2): `Retry-After` handling depends on whether the chosen download mechanism can see response headers (marked "assumption — confirm").
- Known v1 limitation: Chrome's "Ask where to save each file before downloading" setting may force a Save dialog per file.
- Risk: pixiv DOM changes can break the action row selector; mitigated by the floating-button fallback.
Eng backlog: 0 open (`docs/eng-backlog.md` does not exist; no changes since a previous status.md, as this is the first one).
