// Single source for hosts, limits, timings, colors and storage keys. Pure: no chrome.* access.

// ── Origins and URLs ──
export const PIXIV_ORIGIN = 'https://www.pixiv.net';
export const PXIMG_ORIGIN = 'https://i.pximg.net';
/** Referer the DNR session rule sets on the extension's own i.pximg.net requests (system.md §8.2). */
export const PIXIV_REFERER = 'https://www.pixiv.net/';
export const PIXIV_LOGIN_URL = 'https://accounts.pixiv.net/login';
/** Options-page "Report an issue" link and store support URL (R-001). */
export const REPORT_ISSUE_URL = 'https://github.com/kyoicn/pixivhelper/issues';

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

// ── Limits ──
export const MAX_IN_FLIGHT_PER_JOB = 5;
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
/** Double-click guard: a click on a busy button this soon after the job started is ignored. */
export const CLICK_GUARD_MS = 500;
/** Live-region progress announcements are throttled to one per interval. */
export const LIVE_PROGRESS_THROTTLE_MS = 5000;
/** The offscreen document is closed this long after the last job ends. */
export const OFFSCREEN_CLOSE_GRACE_MS = 5000;
/** Badge/title renders are coalesced with this trailing delay. */
export const BADGE_COALESCE_MS = 50;

// ── Toolbar badge ──
export const BADGE_BACKGROUND_COLOR = '#1f1f1f';
export const BADGE_TEXT_COLOR = '#FFFFFF';
