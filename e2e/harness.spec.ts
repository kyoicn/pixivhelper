// Harness self-test: the six acceptance points of ENG-004, and ENG-009's prebuilt fixture zips
// (docs/eng-backlog.md).

import { request } from 'node:https';
import { STALL_TIMEOUT_MS } from '../src/shared/constants';
import {
  artworkUrl,
  originalUrl,
  PIXIV_REFERER,
  requireWork,
  ugoiraZipUrl,
  type IllustWork,
  type UgoiraWork,
} from './fixtures/works';
import { E2E_EXTENSION_DIR, unpackedExtensionId } from './harness/launch';
import { expect, test } from './harness/test';
import { artworkPageTitle } from './server/page';
import { HARNESS_BLOB, HARNESS_BLOB_PATH, startFakePixiv, type FakePixiv } from './server/server';

const EXAMPLE = requireWork('135882741') as IllustWork;
/** 1920×1080, 300 frames: the fixture zip that takes longest to build. */
const LONG = requireWork('136004517') as UgoiraWork;
/** dist-e2e's __RETRY_TIME_SCALE__ (scripts/build.mjs): its stall timeout is 300 ms. */
const E2E_TIME_SCALE = 0.01;

/** GETs `url` from `server` with the pixiv Referer; `ms` runs from the request until its headers. */
function timeToHeaders(server: FakePixiv, url: string): Promise<{ status: number; ms: number }> {
  const { host, pathname } = new URL(url);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const outgoing = request(
      {
        host: '127.0.0.1',
        port: server.port,
        servername: host,
        path: pathname,
        headers: { host, referer: PIXIV_REFERER },
        agent: false,
        // The fake server's certificate is self-signed.
        rejectUnauthorized: false,
      },
      (response) => {
        const ms = Date.now() - started;
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode ?? 0, ms }));
        response.resume();
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test.describe('e2e harness', { tag: '@harness' }, () => {
  test('1: the extension service worker loads from dist-e2e and its ID resolves', async ({
    harness,
  }) => {
    // Chrome derives an unpacked extension's ID from its directory, so a match proves which build loaded.
    expect(harness.extensionId).toBe(unpackedExtensionId(E2E_EXTENSION_DIR));
    expect(harness.serviceWorkerUrl).toBe(`chrome-extension://${harness.extensionId}/sw.js`);
    expect(await harness.isServiceWorkerRunning()).toBe(true);
    expect(await harness.swEval(() => chrome.runtime.id)).toBe(harness.extensionId);
  });

  test('2: www.pixiv.net artwork pages come from the fake server through host mapping', async ({
    harness,
    server,
  }) => {
    const page = await harness.newPage();
    const response = await page.goto(artworkUrl(EXAMPLE.id));
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(artworkPageTitle(EXAMPLE));
    expect(page.url()).toBe(artworkUrl(EXAMPLE.id));
    const request = await server.waitForRequest(`https://www.pixiv.net/artworks/${EXAMPLE.id}`);
    expect(request.status).toBe(200);
  });

  test('3: chrome.downloads from the SW saves under the real name with the served size', async ({
    harness,
    server,
  }) => {
    const url = `https://i.pximg.net${HARNESS_BLOB_PATH}`;
    await harness.swEval(
      (source) => chrome.downloads.download({ url: source, filename: 'harness/ok.bin' }),
      url,
    );
    const file = await harness.downloads.waitForFile('harness/ok.bin');
    const served = await server.waitForRequest(url);
    expect(served.bytes).toBe(HARNESS_BLOB.length);
    expect(file.size).toBe(HARNESS_BLOB.length);
    // Nothing else (no GUID-named copy in the downloads dir).
    expect(await harness.downloads.files()).toEqual([
      { path: 'harness/ok.bin', size: HARNESS_BLOB.length },
    ]);
  });

  test('4: stopServiceWorker() makes the SW target disappear within 2 s', async ({ harness }) => {
    expect(await harness.isServiceWorkerRunning()).toBe(true);
    const started = Date.now();
    await harness.stopServiceWorker();
    expect(await harness.isServiceWorkerRunning()).toBe(false);
    // Right after launch Chrome can drop a stop request; the helper repeats it every 300 ms, so a
    // stop takes well under 0.5 s (max 361 ms over 48 parallel runs) and 2 s leaves ample margin.
    expect(Date.now() - started).toBeLessThan(2_000);
    // The helpers wake it again.
    expect(await harness.swEval(() => chrome.runtime.id)).toBe(harness.extensionId);
  });

  test.describe('in Japanese', () => {
    test.use({ uiLocale: 'ja' });

    test('5: launch({ locale: "ja" }) sets the UI language the extension sees', async ({
      harness,
    }) => {
      const language = await harness.swEval(() => chrome.i18n.getUILanguage());
      if (process.platform === 'darwin' && !language.startsWith('ja')) {
        const reason = `macOS ignored -AppleLanguages (UI language is ${language}); locale checks run on Linux`;
        console.log(`skipped: ${reason}`);
        test.skip(true, reason);
      }
      expect(language).toMatch(/^ja/);
    });
  });

  test('6: i.pximg.net originals without the pixiv Referer get 403', async ({
    harness,
    server,
  }) => {
    const url = originalUrl(EXAMPLE, 0);
    harness.allowConsoleErrors(/status of 403/);
    const page = await harness.newPage();
    const refused = await page.goto(url);
    expect(refused?.status()).toBe(403);
    const [first] = server.requests(url);
    expect(first?.referer).toBeNull();
    expect(first?.status).toBe(403);

    // Control: the same URL with the Referer the extension's DNR rule sets is served.
    const served = await page.goto(url, { referer: PIXIV_REFERER });
    expect(served?.status()).toBe(200);
    expect(server.requests(url).at(-1)?.referer).toBe(PIXIV_REFERER);
  });

  test('fake server: fixture zips are prebuilt', async () => {
    // Zips are cached per worker process. Run alone, as ENG-009's Verify does, this worker has built
    // none yet, so only a server that builds them at start answers the 1080p zip in time.
    const fresh = await startFakePixiv();
    try {
      const first = await timeToHeaders(fresh, ugoiraZipUrl(LONG));
      expect(first.status).toBe(200);
      expect(first.ms).toBeLessThan(STALL_TIMEOUT_MS * E2E_TIME_SCALE);
    } finally {
      await fresh.close();
    }
  });
});
