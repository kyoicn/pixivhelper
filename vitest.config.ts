import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DEBUG__: JSON.stringify(true),
    __RETRY_TIME_SCALE__: JSON.stringify(1),
    __TEST_HOOKS__: JSON.stringify(true),
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
