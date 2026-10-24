import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActionTestApi, openOrFocusOptions } from '../../../src/background/options-tab';
import { exposeTestApi } from '../../../src/shared/test-hooks';
import { EXTENSION_ORIGIN, installChromeFake, type ChromeFake } from '../../fakes/chrome';

const OPTIONS_URL = `${EXTENSION_ORIGIN}/options.html`;
const ARTWORK_URL = 'https://www.pixiv.net/artworks/135882741';
const OPTIONS_TAB_SOURCE = fileURLToPath(
  new URL('../../../src/background/options-tab.ts', import.meta.url),
);

let fake: ChromeFake;

beforeEach(() => {
  fake = installChromeFake();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openOrFocusOptions', () => {
  it('openOrFocusOptions: opens the settings tab right of the current tab, in its window', async () => {
    const current = fake.tabs.add({ url: ARTWORK_URL, active: true });
    fake.tabs.add({ url: 'https://www.pixiv.net/' });
    await openOrFocusOptions(current.tab);
    expect(fake.api.tabs.create).toHaveBeenCalledWith({
      url: OPTIONS_URL,
      index: 1,
      windowId: current.tab.windowId,
      openerTabId: current.id,
      active: true,
    });
  });

  it('openOrFocusOptions: the new settings tab is active, before the tabs that were right of it', async () => {
    const current = fake.tabs.add({ url: ARTWORK_URL, active: true });
    fake.tabs.add({ url: 'https://www.pixiv.net/' });
    await openOrFocusOptions(current.tab);
    const strip = fake.tabs.inWindow(current.tab.windowId);
    expect(strip.map((t) => [t.tab.url, t.tab.active])).toEqual([
      [ARTWORK_URL, false],
      [OPTIONS_URL, true],
      ['https://www.pixiv.net/', false],
    ]);
  });

  it('openOrFocusOptions: opens in the window of the clicked tab, not the focused one', async () => {
    const other = fake.tabs.addWindow({ focused: false });
    const current = fake.tabs.add({ url: ARTWORK_URL, windowId: other, active: true });
    await openOrFocusOptions(current.tab);
    expect(fake.tabs.inWindow(other).map((t) => t.tab.url)).toEqual([ARTWORK_URL, OPTIONS_URL]);
  });

  it('openOrFocusOptions: activates an existing settings tab instead of opening another', async () => {
    const settings = fake.tabs.add({ url: OPTIONS_URL });
    const current = fake.tabs.add({ url: ARTWORK_URL, active: true });
    await openOrFocusOptions(current.tab);
    expect([fake.api.tabs.create.mock.calls.length, settings.tab.active]).toEqual([0, true]);
  });

  it('openOrFocusOptions: focuses the window of a settings tab in another window', async () => {
    const settingsWindow = fake.tabs.addWindow({ focused: false });
    const settings = fake.tabs.add({ url: OPTIONS_URL, windowId: settingsWindow });
    fake.tabs.add({ url: 'https://www.pixiv.net/', windowId: settingsWindow, active: true });
    const current = fake.tabs.add({ url: ARTWORK_URL, windowId: 1, active: true });
    await openOrFocusOptions(current.tab);
    expect([
      settings.tab.active,
      fake.tabs.isFocused(settingsWindow),
      fake.tabs.isFocused(1),
    ]).toEqual([true, true, false]);
  });

  it('openOrFocusOptions: looks the settings tab up as a TAB context by its URL', async () => {
    const current = fake.tabs.add({ url: ARTWORK_URL, active: true });
    await openOrFocusOptions(current.tab);
    expect(fake.api.runtime.getContexts).toHaveBeenCalledWith({
      contextTypes: ['TAB'],
      documentUrls: [OPTIONS_URL],
    });
  });

  it('openOrFocusOptions: opens a tab when the settings context is not in a tab', async () => {
    fake.api.runtime.getContexts.mockResolvedValueOnce([
      {
        contextId: 'ctx',
        contextType: 'TAB',
        documentUrl: OPTIONS_URL,
        frameId: 0,
        tabId: -1,
        windowId: -1,
        incognito: false,
      },
    ]);
    const current = fake.tabs.add({ url: ARTWORK_URL, active: true });
    await openOrFocusOptions(current.tab);
    expect(fake.api.tabs.create).toHaveBeenCalledTimes(1);
  });
});

describe('__hfpTest (e2e toolbar trigger)', () => {
  /** chrome.tabs.get over the fake's tabs (the fake itself has no tabs.get). */
  function stubTabsGet(): void {
    const get = vi.fn((tabId: number): Promise<chrome.tabs.Tab> => {
      const found = fake.tabs.get(tabId);
      return found
        ? Promise.resolve({ ...found.tab })
        : Promise.reject(new Error(`No tab with id: ${tabId}.`));
    });
    vi.stubGlobal('chrome', { ...fake.api, tabs: { ...fake.api.tabs, get } });
  }

  function testApi(): ActionTestApi {
    const api = (globalThis as { __hfpTest?: ActionTestApi }).__hfpTest;
    if (!api) throw new Error('__hfpTest is not installed');
    return api;
  }

  it('__hfpTest: is installed when test hooks are compiled in', () => {
    expect(typeof testApi().clickAction).toBe('function');
  });

  it('__hfpTest.clickAction: opens the settings tab right of the given tab', async () => {
    fake.tabs.add({ url: 'https://www.pixiv.net/' });
    const current = fake.tabs.add({ url: ARTWORK_URL, active: true });
    stubTabsGet();
    await testApi().clickAction(current.id);
    expect(fake.api.tabs.create).toHaveBeenCalledWith({
      url: OPTIONS_URL,
      index: 2,
      windowId: current.tab.windowId,
      openerTabId: current.id,
      active: true,
    });
  });

  it('__hfpTest.clickAction: focuses an existing settings tab instead of opening another', async () => {
    const settings = fake.tabs.add({ url: OPTIONS_URL });
    const current = fake.tabs.add({ url: ARTWORK_URL, active: true });
    stubTabsGet();
    await testApi().clickAction(current.id);
    expect([fake.api.tabs.create.mock.calls.length, settings.tab.active]).toEqual([0, true]);
  });

  it('__hfpTest.clickAction: rejects for a tab that does not exist', async () => {
    stubTabsGet();
    await expect(testApi().clickAction(99)).rejects.toThrow('No tab with id: 99.');
  });
});

describe('exposeTestApi (shared __hfpTest)', () => {
  const holder = globalThis as { __hfpTest?: Record<string, unknown> };

  it('exposeTestApi: merges a new member beside clickAction', () => {
    const downloadUi = (): null => null;
    exposeTestApi({ downloadUi });
    expect([typeof holder.__hfpTest?.clickAction, holder.__hfpTest?.downloadUi]).toEqual([
      'function',
      downloadUi,
    ]);
  });

  it('exposeTestApi: replaces a member of the same name', () => {
    const first = (): number => 1;
    const second = (): number => 2;
    exposeTestApi({ probe: first });
    exposeTestApi({ probe: second });
    expect(holder.__hfpTest?.probe).toBe(second);
  });

  it('exposeTestApi: options-tab keeps the members installed before it', async () => {
    const downloadUi = (): null => null;
    holder.__hfpTest = { downloadUi };
    vi.resetModules();
    await import('../../../src/background/options-tab');
    expect([holder.__hfpTest?.downloadUi, typeof holder.__hfpTest?.clickAction]).toEqual([
      downloadUi,
      'function',
    ]);
  });
});

describe('__hfpTest in builds', () => {
  /** options-tab.ts bundled as scripts/build.mjs does, with `__TEST_HOOKS__` as given. */
  async function bundle(testHooks: boolean): Promise<string> {
    const result = await build({
      entryPoints: [OPTIONS_TAB_SOURCE],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      define: { __TEST_HOOKS__: JSON.stringify(testHooks) },
      logLevel: 'silent',
    });
    return result.outputFiles.map((file) => file.text).join('');
  }

  it('__hfpTest: a build without test hooks carries no trace of it', async () => {
    expect(await bundle(false)).not.toContain('__hfpTest');
  });

  it('__hfpTest: an e2e build installs it', async () => {
    expect(await bundle(true)).toContain('__hfpTest');
  });
});
