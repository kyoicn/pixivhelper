// Single source for hosts, limits, timings, colors and storage keys. Pure: no chrome.* access.

import type { UgoiraOutput } from './types';

// ── Origins and URLs ──
export const PIXIV_ORIGIN = 'https://www.pixiv.net';
export const PXIMG_ORIGIN = 'https://i.pximg.net';
/** Referer the DNR session rule sets on the extension's own i.pximg.net requests (system.md §8.2). */
export const PIXIV_REFERER = 'https://www.pixiv.net/';
export const PIXIV_LOGIN_URL = 'https://accounts.pixiv.net/login';
/** Options-page "Report an issue" link and store support URL (R-001). */
export const REPORT_ISSUE_URL = 'https://github.com/kyoicn/pixivhelper/issues';

// ── Login walls (system.md §8.5, R-003) ──
/**
 * pixiv's sanity level from which it walls a work off from logged-out visitors. Only a fallback
 * for an `/ajax/illust` body whose `urls` shape is missing or unrecognized.
 */
export const WITHHELD_MIN_SANITY_LEVEL = 4;

// ── Allowlists (system.md §11.1) ──
export const PIXIV_API_URL_RE =
  /^https:\/\/www\.pixiv\.net\/ajax\/illust\/\d{1,12}(\/pages|\/ugoira_meta)?$/;
export const PXIMG_URL_PREFIX = 'https://i.pximg.net/';
/** File names come from the source URL's basename and must match this. */
export const FILE_BASENAME_RE = /^[0-9A-Za-z_.-]{1,128}$/;

// ── Retry policy (system.md §9) ──
export const MAX_ATTEMPTS = 4;
/** Backoff before retry n (n = 0, 1, 2): RETRY_BASE_MS · 2ⁿ + U(0, RETRY_JITTER_MS). */
export const RETRY_BASE_MS = 1500;
export const RETRY_JITTER_MS = 500;
export const RETRY_AFTER_CAP_MS = 30_000;
/** Inactivity timeout: headers, then every body chunk. */
export const STALL_TIMEOUT_MS = 30_000;

// ── Extension pages ──
/** The offscreen document, relative to the extension root (chrome.runtime.getURL). */
export const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

// ── Settings values ──
/** Every ugoiraOutput value, in the options page's order. */
export const UGOIRA_OUTPUTS: readonly UgoiraOutput[] = ['mp4', 'webm', 'zip'];

// ── Limits ──
export const MAX_IN_FLIGHT_PER_JOB = 5;
/** Most pages a pixiv work has: bounds retry page lists and the badge hint while resolving. */
export const MAX_PAGES_PER_WORK = 200;
/** Longest relative download folder accepted (resolved, or echoed back by a retry). */
export const MAX_FOLDER_CHARS = 1024;
/** Folder pattern length in UTF-16 code units, as `<input maxlength>` counts. */
export const PATTERN_MAX_CHARS = 200;
/** Token value limit in UTF-8 bytes after sanitization. */
export const TOKEN_MAX_BYTES = 60;

// ── Storage keys (system.md §6 storage inventory) ──
export const SETTINGS_KEY = 'settings';
export const JOB_KEY_PREFIX = 'job:';
export const CAPS_KEY_PREFIX = 'caps:';

// ── Timings ──
/** Options page: folder-pattern autosave debounce. */
export const SETTINGS_DEBOUNCE_MS = 400;
/** Options page: the "Saved" indicator stays visible this long, then fades out over SAVED_FADE_MS. */
export const SAVED_VISIBLE_MS = 2000;
export const SAVED_FADE_MS = 300;
/** Button falls back to floating if no action row appears within this time of entering an artwork route. */
export const FLOAT_FALLBACK_MS = 3000;
/**
 * The fallback timer fires this much before FLOAT_FALLBACK_MS, so placing and painting the pill
 * still lands inside the PRD's 3 s (system.md D14).
 */
export const FLOAT_PLACEMENT_BUDGET_MS = 250;
/** Double-click guard: a click on a busy button this soon after the job started is ignored. */
export const CLICK_GUARD_MS = 500;
/** Live-region progress announcements are throttled to one per interval. */
export const LIVE_PROGRESS_THROTTLE_MS = 5000;
/** The offscreen document is closed this long after the last job ends. */
export const OFFSCREEN_CLOSE_GRACE_MS = 5000;
/** Badge/title renders are coalesced with this trailing delay. */
export const BADGE_COALESCE_MS = 50;
/** Caps the wait for earlier in-progress files to finish before the UI restore (R-006 rev. 3). */
export const HANDOFF_SETTLE_WAIT_MS = 2000;

// ── Toolbar badge ──
export const BADGE_BACKGROUND_COLOR = '#1f1f1f';
export const BADGE_TEXT_COLOR = '#FFFFFF';
