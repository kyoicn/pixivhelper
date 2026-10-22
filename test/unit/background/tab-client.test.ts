import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobView, RetryResult } from '../../../src/shared/types';
import { installChromeFake, SW_URL, type ChromeFake, type FakeTab } from '../../fakes/chrome';

type TabClient = typeof import('../../../src/background/tab-client');

const API_URL = 'https://www.pixiv.net/ajax/illust/135882741/pages';
const TAB_RESULT: RetryResult<unknown> = {
  ok: true,
  value: { from: 'tab' },
  status: 200,
  attempts: 1,
};
const OFFSCREEN_RESULT: RetryResult<unknown> = {
  ok: true,
  value: { from: 'offscreen' },
  status: 200,
  attempts: 1,
};
const VIEW: JobView = {
  jobId: 'job-1',
  artworkId: '135882741',
  kind: 'pages',
  status: 'running',
  progress: { kind: 'pages', done: 7, total: 12 },
  format: null,
  folder: 'pixiv/みずき-135882741',
  outcome: null,
};

let fake: ChromeFake;
let client: TabClient;
let page: FakeTab;
let offscreenReceived: unknown[];

beforeEach(async () => {
  fake = installChromeFake();
  page = fake.tabs.add({ url: 'https://www.pixiv.net/artworks/135882741', active: true });
  offscreenReceived = [];
  fake.offscreen.setHandler((message) => {
    offscreenReceived.push(message);
    return { ok: true, result: OFFSCREEN_RESULT };
  });
  vi.resetModules();
  client = await import('../../../src/background/tab-client');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pushView', () => {
  it('pushView: sends job/update with the full view to the tab', async () => {
    const received: unknown[] = [];
    page.onMessage.addListener((message) => {
      received.push(message);
    });
    await client.pushView(page.id, VIEW);
    expect(received).toEqual([{ target: 'tab', type: 'job/update', view: VIEW }]);
  });

  it('pushView: addresses the top frame only', async () => {
    page.onMessage.addListener(() => undefined);
    await client.pushView(page.id, VIEW);
    expect(fake.api.tabs.sendMessage).toHaveBeenCalledWith(page.id, expect.anything(), {
      frameId: 0,
    });
  });

  it('pushView: a closed tab is logged at debug and does not reject', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    page.close();
    await client.pushView(page.id, VIEW);
    expect(debug).toHaveBeenCalledWith(
      '[hfp:tab-client]',
      'job/update not delivered to tab',
      page.id,
      expect.any(Error),
    );
  });
});

describe('apiFetchJson', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  it('apiFetchJson: asks the tab first, with api/fetchJson from the SW', async () => {
    const received: Array<[unknown, chrome.runtime.MessageSender]> = [];
    page.handle((message, sender) => {
      received.push([message, sender]);
      return { ok: true, result: TAB_RESULT };
    });
    await client.apiFetchJson(page.id, API_URL);
    expect(received).toEqual([
      [
        { target: 'tab', type: 'api/fetchJson', url: API_URL },
        expect.objectContaining({ url: SW_URL }),
      ],
    ]);
  });

  it('apiFetchJson: returns the tab result without the offscreen document', async () => {
    page.handle(() => ({ ok: true, result: TAB_RESULT }));
    const result = await client.apiFetchJson(page.id, API_URL);
    expect([result, fake.api.offscreen.createDocument.mock.calls.length]).toEqual([TAB_RESULT, 0]);
  });

  it('apiFetchJson: returns a failed fetch from the tab as is', async () => {
    const refused: RetryResult<unknown> = {
      ok: false,
      failure: { kind: 'pixivError', status: 400, attempts: 1 },
    };
    page.handle(() => ({ ok: true, result: refused }));
    const result = await client.apiFetchJson(page.id, API_URL);
    expect([result, offscreenReceived]).toEqual([refused, []]);
  });

  it('apiFetchJson: falls back to off/fetchJson when the tab is closed', async () => {
    page.close();
    const result = await client.apiFetchJson(page.id, API_URL);
    expect([result, offscreenReceived]).toEqual([
      OFFSCREEN_RESULT,
      [{ target: 'offscreen', type: 'off/fetchJson', url: API_URL, credentials: 'include' }],
    ]);
  });

  it('apiFetchJson: falls back when the tab has no content script', async () => {
    await expect(client.apiFetchJson(page.id, API_URL)).resolves.toEqual(OFFSCREEN_RESULT);
  });

  it('apiFetchJson: falls back when the tab answers with an error', async () => {
    page.handle(() => ({ ok: false, error: 'INTERNAL' }));
    await expect(client.apiFetchJson(page.id, API_URL)).resolves.toEqual(OFFSCREEN_RESULT);
  });

  it('apiFetchJson: falls back when the tab does not answer', async () => {
    page.onMessage.addListener(() => undefined);
    await expect(client.apiFetchJson(page.id, API_URL)).resolves.toEqual(OFFSCREEN_RESULT);
  });

  it('apiFetchJson: rejects when the offscreen fallback refuses the request', async () => {
    fake.offscreen.setHandler(() => ({ ok: false, error: 'BAD_REQUEST' }));
    page.close();
    await expect(client.apiFetchJson(page.id, API_URL)).rejects.toThrow(
      'off/fetchJson failed: BAD_REQUEST',
    );
  });
});
