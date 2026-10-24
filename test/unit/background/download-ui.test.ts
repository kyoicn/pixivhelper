// design-download-engine.md "Chrome's download UI (download-ui.ts, R-005, R-006)": the call table,
// call ordering, error handling and the e2e test API, against a scripted setUiOptions.

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDownloadUi,
  type DownloadUiReport,
  type SetUiOptions,
} from '../../../src/background/download-ui';

const DOWNLOAD_UI_SOURCE = fileURLToPath(
  new URL('../../../src/background/download-ui.ts', import.meta.url),
);

/** A setUiOptions whose calls stay pending until settled, oldest first. */
function scriptedChrome() {
  const pending: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  const setUiOptions = vi.fn<SetUiOptions>(
    () => new Promise<void>((resolve, reject) => pending.push({ resolve, reject })),
  );
  return {
    setUiOptions,
    asked: () => setUiOptions.mock.calls.map(([options]) => options.enabled),
    accept(): void {
      pending.shift()?.resolve();
    },
    refuse(message = 'refused'): void {
      pending.shift()?.reject(new Error(message));
    },
  };
}

/** Lets every queued call reach the scripted Chrome. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function tracked(promise: Promise<void>): { done: boolean } {
  const state = { done: false };
  void promise.then(() => (state.done = true));
  return state;
}

function report(): DownloadUiReport {
  const api = (globalThis as { __hfpTest?: { downloadUi?: () => DownloadUiReport } }).__hfpTest;
  if (!api?.downloadUi) throw new Error('__hfpTest.downloadUi is not installed');
  return api.downloadUi();
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('downloadUi: call table', () => {
  it('hideForHandOff: concurrent calls make one Chrome call', async () => {
    const chrome = scriptedChrome();
    const ui = createDownloadUi(chrome.setUiOptions);
    void ui.hideForHandOff();
    void ui.hideForHandOff();
    void ui.hideForHandOff();
    await flush();
    expect(chrome.asked()).toEqual([false]);
  });

  it('hideForHandOff: no concurrent caller resolves before Chrome has applied the hide', async () => {
    const chrome = scriptedChrome();
    const ui = createDownloadUi(chrome.setUiOptions);
    const callers = [ui.hideForHandOff(), ui.hideForHandOff(), ui.hideForHandOff()].map(tracked);
    await flush();
    expect(callers.map((caller) => caller.done)).toEqual([false, false, false]);
  });

  it('hideForHandOff: every concurrent caller resolves once Chrome has applied the hide', async () => {
    const chrome = scriptedChrome();
    const ui = createDownloadUi(chrome.setUiOptions);
    const callers = [ui.hideForHandOff(), ui.hideForHandOff(), ui.hideForHandOff()].map(tracked);
    await flush();
    chrome.accept();
    await flush();
    expect(callers.map((caller) => caller.done)).toEqual([true, true, true]);
  });

  it('hideForHandOff: after an applied hide, a later hand-off calls Chrome no more', async () => {
    const chrome = scriptedChrome();
    const ui = createDownloadUi(chrome.setUiOptions);
    const first = ui.hideForHandOff();
    await flush();
    chrome.accept();
    await first;
    await ui.hideForHandOff();
    expect(chrome.asked()).toEqual([false]);
  });

  it('restore: then hideForHandOff in the same tick reach Chrome in that order', async () => {
    const chrome = scriptedChrome();
    const ui = createDownloadUi(chrome.setUiOptions);
    void ui.restore();
    void ui.hideForHandOff();
    await flush();
    chrome.accept();
    await flush();
    expect(chrome.asked()).toEqual([true, false]);
  });

  it('restore: a hide queued behind it waits for the restore to settle first', async () => {
    const chrome = scriptedChrome();
    const ui = createDownloadUi(chrome.setUiOptions);
    void ui.restore();
    void ui.hideForHandOff();
    await flush();
    expect(chrome.asked()).toEqual([true]);
  });

  // R-006: the last hand-off of a busy period whose first hide is still in flight.
  it('hideForHandOff: then restore in the same tick reach Chrome in that order', async () => {
    const chrome = scriptedChrome();
    const ui = createDownloadUi(chrome.setUiOptions);
    void ui.hideForHandOff();
    void ui.restore();
    await flush();
    chrome.accept();
    await flush();
    expect(chrome.asked()).toEqual([false, true]);
  });

  it('hideForHandOff: a restore queued behind it waits for the hide to settle first', async () => {
    const chrome = scriptedChrome();
    const ui = createDownloadUi(chrome.setUiOptions);
    void ui.hideForHandOff();
    const restore = tracked(ui.restore());
    await flush();
    expect([chrome.asked(), restore.done]).toEqual([[false], false]);
  });

  it('restore: a second restore while the UI is back makes no call', async () => {
    const chrome = scriptedChrome();
    const ui = createDownloadUi(chrome.setUiOptions);
    const first = ui.restore();
    await flush();
    chrome.accept();
    await first;
    await ui.restore();
    expect(chrome.asked()).toEqual([true]);
  });

  it('restore: after a hide, turns the UI back on', async () => {
    const chrome = scriptedChrome();
    const ui = createDownloadUi(chrome.setUiOptions);
    const hide = ui.hideForHandOff();
    await flush();
    chrome.accept();
    await hide;
    const restore = ui.restore();
    await flush();
    chrome.accept();
    await restore;
    expect(chrome.asked()).toEqual([false, true]);
  });

  it('requested null at start: hideForHandOff calls Chrome', async () => {
    const setUiOptions = vi.fn<SetUiOptions>(() => Promise.resolve());
    await createDownloadUi(setUiOptions).hideForHandOff();
    expect(setUiOptions).toHaveBeenCalledWith({ enabled: false });
  });

  it('requested null at start: restore calls Chrome', async () => {
    const setUiOptions = vi.fn<SetUiOptions>(() => Promise.resolve());
    await createDownloadUi(setUiOptions).restore();
    expect(setUiOptions).toHaveBeenCalledWith({ enabled: true });
  });
});

describe('downloadUi: errors', () => {
  it('hideForHandOff: a refused hide still resolves', async () => {
    const ui = createDownloadUi(() => Promise.reject(new Error('no permission')));
    await expect(ui.hideForHandOff()).resolves.toBeUndefined();
  });

  it('hideForHandOff: a refused hide warns once, however many hand-offs follow', async () => {
    const ui = createDownloadUi(() => Promise.reject(new Error('no permission')));
    await ui.hideForHandOff();
    await ui.restore();
    await ui.hideForHandOff();
    await ui.hideForHandOff();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('hideForHandOff: the warning names what failed', async () => {
    const error = new Error('no permission');
    const ui = createDownloadUi(() => Promise.reject(error));
    await ui.hideForHandOff();
    expect(console.warn).toHaveBeenCalledWith(
      '[hfp:download-ui]',
      "could not hide Chrome's download UI",
      error,
    );
  });

  it('hideForHandOff: after a refusal, later hand-offs stop asking Chrome', async () => {
    const setUiOptions = vi.fn<SetUiOptions>(() => Promise.reject(new Error('no permission')));
    const ui = createDownloadUi(setUiOptions);
    await ui.hideForHandOff();
    await ui.restore();
    await ui.hideForHandOff();
    expect(setUiOptions.mock.calls.map(([options]) => options.enabled)).toEqual([false, true]);
  });

  it('hideForHandOff: a hide queued before the refusal settled is not sent', async () => {
    const chrome = scriptedChrome();
    const ui = createDownloadUi(chrome.setUiOptions);
    void ui.hideForHandOff();
    void ui.restore();
    const last = ui.hideForHandOff();
    await flush();
    chrome.refuse();
    await flush();
    chrome.accept();
    await last;
    expect(chrome.asked()).toEqual([false, true]);
  });

  it('hideForHandOff: resolves when setUiOptions throws synchronously', async () => {
    const ui = createDownloadUi(() => {
      throw new TypeError('chrome.downloads.setUiOptions is not a function');
    });
    await expect(ui.hideForHandOff()).resolves.toBeUndefined();
  });

  it('restore: a refused restore still resolves', async () => {
    const ui = createDownloadUi(() => Promise.reject(new Error('Another extension')));
    await expect(ui.restore()).resolves.toBeUndefined();
  });

  it('restore: a refused restore logs at debug, not warn', async () => {
    const error = new Error('Another extension has disabled the download UI');
    const ui = createDownloadUi(() => Promise.reject(error));
    await ui.restore();
    expect([vi.mocked(console.debug).mock.calls, vi.mocked(console.warn).mock.calls]).toEqual([
      [['[hfp:download-ui]', "Chrome's download UI stays off", error]],
      [],
    ]);
  });

  it('restore: after a refused restore, requested stays true and a second restore makes no call', async () => {
    const setUiOptions = vi.fn<SetUiOptions>(() => Promise.reject(new Error('Another extension')));
    const ui = createDownloadUi(setUiOptions);
    await ui.restore();
    await ui.restore();
    expect(setUiOptions).toHaveBeenCalledTimes(1);
  });

  it('hideForHandOff: still hides after a refused restore', async () => {
    const setUiOptions = vi
      .fn<SetUiOptions>()
      .mockRejectedValueOnce(new Error('Another extension'))
      .mockResolvedValue(undefined);
    const ui = createDownloadUi(setUiOptions);
    await ui.restore();
    await ui.hideForHandOff();
    expect(setUiOptions.mock.calls.map(([options]) => options.enabled)).toEqual([true, false]);
  });
});

describe('downloadUi: test API (__hfpTest.downloadUi)', () => {
  it('__hfpTest.downloadUi: requested is null before any call', () => {
    createDownloadUi(() => Promise.resolve());
    expect(report()).toEqual({ requested: null, calls: [] });
  });

  it('__hfpTest.downloadUi: requested changes as soon as a call is queued', () => {
    const chrome = scriptedChrome();
    void createDownloadUi(chrome.setUiOptions).hideForHandOff();
    expect(report()).toEqual({ requested: false, calls: [] });
  });

  it('__hfpTest.downloadUi: each settled call with Chrome’s answer and when it came', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const setUiOptions = vi
      .fn<SetUiOptions>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Another extension'));
    const ui = createDownloadUi(setUiOptions);
    vi.setSystemTime(1_000);
    await ui.hideForHandOff();
    vi.setSystemTime(2_000);
    await ui.restore();
    expect(report()).toEqual({
      requested: true,
      calls: [
        { enabled: false, ok: true, at: 1_000 },
        { enabled: true, ok: false, at: 2_000 },
      ],
    });
  });

  it('__hfpTest.downloadUi: reports the newest instance (the running SW)', async () => {
    await createDownloadUi(() => Promise.resolve()).hideForHandOff();
    createDownloadUi(() => Promise.resolve());
    expect(report()).toEqual({ requested: null, calls: [] });
  });

  it('__hfpTest.downloadUi: keeps the other members of __hfpTest', () => {
    const holder = globalThis as { __hfpTest?: Record<string, unknown> };
    const clickAction = (): Promise<void> => Promise.resolve();
    holder.__hfpTest = { clickAction };
    createDownloadUi(() => Promise.resolve());
    expect(holder.__hfpTest.clickAction).toBe(clickAction);
  });
});

describe('downloadUi: test API in builds', () => {
  /** download-ui.ts bundled as scripts/build.mjs does, with `__TEST_HOOKS__` as given. */
  async function bundle(testHooks: boolean): Promise<string> {
    const result = await build({
      entryPoints: [DOWNLOAD_UI_SOURCE],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      define: { __TEST_HOOKS__: JSON.stringify(testHooks), __DEBUG__: 'true' },
      logLevel: 'silent',
    });
    return result.outputFiles.map((file) => file.text).join('');
  }

  it('__hfpTest.downloadUi: a build without test hooks carries no trace of it', async () => {
    expect(await bundle(false)).not.toContain('__hfpTest');
  });

  it('__hfpTest.downloadUi: an e2e build installs it', async () => {
    expect(await bundle(true)).toContain('__hfpTest');
  });
});
