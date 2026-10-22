// Playwright `test` for e2e specs: one fake pixiv per worker, and a fresh Chromium (profile, downloads
// dir) per test. On failure the trace, server log, console errors and downloads listing are attached.
// A test that leaves unexpected console errors fails (allow expected ones with
// harness.allowConsoleErrors()).

import { writeFile } from 'node:fs/promises';
import { test as base, type TestInfo } from '@playwright/test';
import { startFakePixiv, type FakePixiv } from '../server/server';
import type { ConsoleEntry } from './console';
import { launch, type Harness } from './launch';

export { expect } from '@playwright/test';

interface HarnessTestFixtures {
  /** Chrome UI language for `harness`; override with `test.use({ uiLocale: 'ja' })`. */
  uiLocale: string;
  harness: Harness;
}

interface HarnessWorkerFixtures {
  server: FakePixiv;
}

/** Written as a file in the test's output dir, so CI can upload test-results/ as is. */
async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  const file = testInfo.outputPath(name);
  await writeFile(file, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path: file, contentType: 'application/json' });
}

export const test = base.extend<HarnessTestFixtures, HarnessWorkerFixtures>({
  server: [
    async ({}, use) => {
      const server = await startFakePixiv();
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  uiLocale: ['en', { option: true }],

  harness: async ({ server, uiLocale }, use, testInfo) => {
    server.reset();
    const harness = await launch({ server, locale: uiLocale });
    await harness.context.tracing.start({ screenshots: true, snapshots: true });
    let unexpected: ConsoleEntry[] = [];
    try {
      await use(harness);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        const trace = testInfo.outputPath('trace.zip');
        const traced = await harness.context.tracing.stop({ path: trace }).then(
          () => true,
          () => false,
        );
        if (traced) await testInfo.attach('trace', { path: trace, contentType: 'application/zip' });
        await attachJson(testInfo, 'server-log.json', server.log);
        await attachJson(testInfo, 'console-errors.json', harness.consoleErrors());
        await attachJson(testInfo, 'downloads.json', await harness.downloads.files());
      } else {
        await harness.context.tracing.stop().catch(() => undefined);
        unexpected = harness.unexpectedConsoleErrors();
      }
      await harness.close();
    }
    if (unexpected.length > 0) {
      const lines = unexpected.map((entry) => `[${entry.source}] ${entry.text} (${entry.url})`);
      throw new Error(`unexpected console errors:\n${lines.join('\n')}`);
    }
  },
});
