import { defineConfig } from '@playwright/test';

// E2E runs against the built extension in dist-e2e/ (`npm run test:e2e` builds it first). Specs use
// the fixtures in e2e/harness/test.ts, which launch their own Chromium; Playwright's built-in
// browser fixtures are not used. design-test-harness.md "L3: E2E harness".
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // L4 live smoke talks to the real pixiv: opt-in with HFP_LIVE=1.
  testIgnore: process.env.HFP_LIVE ? [] : ['**/live/**'],
  timeout: 60_000,
  expect: { timeout: 5_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
});
