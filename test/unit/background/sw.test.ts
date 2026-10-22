import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTENSION_ORIGIN, installChromeFake, type ChromeFake } from '../../fakes/chrome';

const ARTWORK_URL = 'https://www.pixiv.net/artworks/135882741';

let fake: ChromeFake;

async function importSw(): Promise<typeof import('../../../src/background/sw')> {
  vi.resetModules();
  return import('../../../src/background/sw');
}

async function boot(): Promise<void> {
  const sw = await importSw();
  await sw.ready;
}

beforeEach(() => {
  fake = installChromeFake();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sw.ts', () => {
  it('sw: registers the toolbar click listener at import, before ready resolves', async () => {
    let booted = false;
    const sw = await importSw();
    void sw.ready.then(() => (booted = true));
    expect([fake.action.onClicked.hasListeners(), booted]).toEqual([true, false]);
  });

  it('sw: ready sets the badge colors', async () => {
    await boot();
    expect([fake.action.badgeBackgroundColor, fake.action.badgeTextColor]).toEqual([
      [31, 31, 31, 255],
      [255, 255, 255, 255],
    ]);
  });

  it('sw: ready renders an empty badge and the idle title', async () => {
    fake.action.badgeText = '12';
    fake.action.title = 'Helper for Pixiv — 12 files remaining';
    await boot();
    expect([fake.action.badgeText, fake.action.title]).toEqual([
      '',
      'Helper for Pixiv — click to open settings',
    ]);
  });

  it('sw: a toolbar click opens the settings tab', async () => {
    await boot();
    fake.action.click(fake.tabs.add({ url: ARTWORK_URL, active: true }).tab);
    await vi.waitFor(() => {
      expect(fake.tabs.all().map((t) => t.tab.url)).toContain(`${EXTENSION_ORIGIN}/options.html`);
    });
  });

  it('sw: a failure to open the settings tab is logged as a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fake.api.tabs.create.mockRejectedValueOnce(new Error('No window with id: 9.'));
    await boot();
    fake.action.click(fake.tabs.add({ url: ARTWORK_URL, active: true }).tab);
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        '[hfp:sw]',
        'could not open the settings tab',
        expect.any(Error),
      );
    });
  });
});
