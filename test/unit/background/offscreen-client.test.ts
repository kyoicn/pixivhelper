import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFSCREEN_CLOSE_GRACE_MS } from '../../../src/shared/constants';
import {
  EXTENSION_ORIGIN,
  RECEIVING_END_ERROR,
  installChromeFake,
  type ChromeFake,
} from '../../fakes/chrome';

type Client = typeof import('../../../src/background/offscreen-client');

const PROBE = { type: 'off/probe', width: 600, height: 600 } as const;
const CAPS = { avc: 'avc1.64001e', vp9: true };

let fake: ChromeFake;
let client: Client;
let received: unknown[];

beforeEach(async () => {
  fake = installChromeFake();
  received = [];
  fake.offscreen.setHandler((message) => {
    received.push(message);
    return { ok: true, caps: CAPS };
  });
  // Fresh module state (shared creating promise, close timer) per test.
  vi.resetModules();
  client = await import('../../../src/background/offscreen-client');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ensureOffscreen', () => {
  it('ensureOffscreen: creates offscreen.html with reason BLOBS and a justification', async () => {
    await client.ensureOffscreen();
    expect(fake.api.offscreen.createDocument).toHaveBeenCalledWith({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification:
        'Fetch pixiv originals into Blob URLs for chrome.downloads and encode ugoira videos with WebCodecs.',
    });
  });

  it('ensureOffscreen: the document exists afterwards', async () => {
    await client.ensureOffscreen();
    expect(fake.offscreen.document?.url).toBe(`${EXTENSION_ORIGIN}/offscreen.html`);
  });

  it('ensureOffscreen: concurrent calls create the document once', async () => {
    await Promise.all([
      client.ensureOffscreen(),
      client.ensureOffscreen(),
      client.ensureOffscreen(),
    ]);
    expect(fake.api.offscreen.createDocument).toHaveBeenCalledTimes(1);
  });

  it('ensureOffscreen: does not create a second document when one exists', async () => {
    await client.ensureOffscreen();
    await client.ensureOffscreen();
    expect(fake.api.offscreen.createDocument).toHaveBeenCalledTimes(1);
  });

  it('ensureOffscreen: creates a new document after the previous one was closed', async () => {
    await client.ensureOffscreen();
    fake.offscreen.destroy();
    await client.ensureOffscreen();
    expect(fake.api.offscreen.createDocument).toHaveBeenCalledTimes(2);
  });
});

describe('send', () => {
  it('send: delivers the command with target offscreen', async () => {
    await client.send(PROBE);
    expect(received).toEqual([{ target: 'offscreen', ...PROBE }]);
  });

  it('send: resolves with the document response', async () => {
    await expect(client.send(PROBE)).resolves.toEqual({ ok: true, caps: CAPS });
  });

  it('send: concurrent commands create the document once', async () => {
    await Promise.all([client.send(PROBE), client.send(PROBE), client.send(PROBE)]);
    expect([fake.api.offscreen.createDocument.mock.calls.length, received.length]).toEqual([1, 3]);
  });

  it('send: re-ensures the document and resends once when the receiving end is gone', async () => {
    await client.ensureOffscreen();
    fake.api.runtime.sendMessage.mockImplementationOnce(() => {
      fake.offscreen.destroy();
      return Promise.reject(new Error(RECEIVING_END_ERROR));
    });
    await expect(client.send(PROBE)).resolves.toEqual({ ok: true, caps: CAPS });
    expect(fake.api.offscreen.createDocument).toHaveBeenCalledTimes(2);
  });

  it('send: gives up after one re-ensure', async () => {
    fake.api.runtime.sendMessage.mockRejectedValue(new Error(RECEIVING_END_ERROR));
    await expect(client.send(PROBE)).rejects.toThrow(RECEIVING_END_ERROR);
    expect(fake.api.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('send: other errors are not retried', async () => {
    fake.api.runtime.sendMessage.mockRejectedValueOnce(new Error('boom'));
    await expect(client.send(PROBE)).rejects.toThrow('boom');
    expect(fake.api.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleClose', () => {
  beforeEach(async () => {
    await client.ensureOffscreen();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  it('scheduleClose: keeps the document open during the grace period', async () => {
    client.scheduleClose();
    await vi.advanceTimersByTimeAsync(OFFSCREEN_CLOSE_GRACE_MS - 1);
    expect(fake.offscreen.document).not.toBeNull();
  });

  it('scheduleClose: closes the document after the 5 s grace', async () => {
    client.scheduleClose();
    await vi.advanceTimersByTimeAsync(OFFSCREEN_CLOSE_GRACE_MS);
    expect(fake.offscreen.document).toBeNull();
  });

  it('scheduleClose: a new command during the grace cancels the close', async () => {
    client.scheduleClose();
    await vi.advanceTimersByTimeAsync(OFFSCREEN_CLOSE_GRACE_MS - 1000);
    await client.send(PROBE);
    await vi.advanceTimersByTimeAsync(OFFSCREEN_CLOSE_GRACE_MS);
    expect(fake.api.offscreen.closeDocument).not.toHaveBeenCalled();
  });

  it('scheduleClose: scheduling again restarts the grace', async () => {
    client.scheduleClose();
    await vi.advanceTimersByTimeAsync(OFFSCREEN_CLOSE_GRACE_MS - 1000);
    client.scheduleClose();
    await vi.advanceTimersByTimeAsync(OFFSCREEN_CLOSE_GRACE_MS - 1);
    expect(fake.offscreen.document).not.toBeNull();
  });

  it('cancelScheduledClose: keeps the document open', async () => {
    client.scheduleClose();
    client.cancelScheduledClose();
    await vi.advanceTimersByTimeAsync(OFFSCREEN_CLOSE_GRACE_MS);
    expect(fake.offscreen.document).not.toBeNull();
  });

  it('scheduleClose: a document that is already gone is logged at debug only', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    fake.offscreen.destroy();
    client.scheduleClose();
    await vi.advanceTimersByTimeAsync(OFFSCREEN_CLOSE_GRACE_MS);
    expect(debug).toHaveBeenCalledWith(
      '[hfp:offscreen-client]',
      'offscreen document already closed',
      expect.any(Error),
    );
  });
});
