// Chrome's download UI while jobs run (design-download-engine.md "Chrome's download UI
// (download-ui.ts, R-005, R-006)"; PRD §4.1 #3, D12). From a busy period's first hand-off until
// just before its last (the last file of the last running job), Chrome's download UI is off, so
// no file but that last one plays the fly-to-toolbar animation; a busy period that ends without
// such a hand-off gets the UI back at its end.
// Chrome keeps the setting per extension in the browser process, outlives this SW instance with it,
// and offers no getter, so nothing is persisted: each instance only remembers what it asked for.

import { createLogger } from '../shared/log';
import { exposeTestApi } from '../shared/test-hooks';

const log = createLogger('download-ui');

export interface DownloadUi {
  /** Before every hand-off but the busy period's last. Resolves once Chrome has applied the hide (or refused it); never rejects. */
  hideForHandOff(): Promise<void>;
  /**
   * Before the busy period's last hand-off (R-006), when the last running job ends, or when the SW starts with none
   * running. Resolves once Chrome has answered; never rejects. Makes no call when this instance last asked for `true`.
   */
  restore(): Promise<void>;
}

export type SetUiOptions = (options: chrome.downloads.UiOptions) => Promise<void>;

/** One settled `setUiOptions` call: what was asked, whether Chrome accepted it, and when it answered. */
export interface DownloadUiCall {
  enabled: boolean;
  ok: boolean;
  at: number;
}

/** `self.__hfpTest.downloadUi()` in `--e2e` builds: what the current SW instance asked Chrome for. */
export interface DownloadUiReport {
  requested: boolean | null;
  calls: DownloadUiCall[];
}

// A function referenced only from `if (__TEST_HOOKS__)`, like options-tab.ts, so prod sw.js carries
// no trace of the test API: it installs `downloadUi()` and returns `setUiOptions` wrapped to record
// each settled call.
function withTestApi(setUiOptions: SetUiOptions, requested: () => boolean | null): SetUiOptions {
  const calls: DownloadUiCall[] = [];
  exposeTestApi({
    downloadUi: (): DownloadUiReport => ({
      requested: requested(),
      calls: calls.map((call) => ({ ...call })),
    }),
  });
  return async (options) => {
    let ok = false;
    try {
      await setUiOptions(options);
      ok = true;
    } finally {
      calls.push({ enabled: options.enabled, ok, at: Date.now() });
    }
  };
}

export function createDownloadUi(
  setUiOptions: SetUiOptions = (options) => chrome.downloads.setUiOptions(options),
): DownloadUi {
  /** The `enabled` value last asked for; null until the first call, since an earlier instance may have left the UI either way. */
  let requested: boolean | null = null;
  /** Each call waits for the one before it, so Chrome applies them in request order. */
  let chain: Promise<void> = Promise.resolve();
  /** The only documented refusal of a hide (no `downloads.ui` permission) cannot be fixed by retrying. */
  let hideRefused = false;
  if (__TEST_HOOKS__) setUiOptions = withTestApi(setUiOptions, () => requested);

  async function apply(enabled: boolean): Promise<void> {
    if (!enabled && hideRefused) return;
    try {
      await setUiOptions({ enabled });
    } catch (error) {
      if (enabled) {
        // Expected while another extension keeps the UI off; Chrome removed our entry first.
        log.debug("Chrome's download UI stays off", error);
      } else {
        // Cosmetic: the hand-off goes on, and this instance stops asking.
        hideRefused = true;
        log.warn("could not hide Chrome's download UI", error);
      }
    }
  }

  // `requested` changes before the call is queued, so a caller arriving while it is in flight
  // waits for it instead of queuing another.
  function request(enabled: boolean): Promise<void> {
    requested = enabled;
    chain = chain.then(() => apply(enabled));
    return chain;
  }

  return {
    hideForHandOff() {
      if (hideRefused) return Promise.resolve();
      return requested === false ? chain : request(false);
    },
    restore() {
      return requested === true ? chain : request(true);
    },
  };
}
