// Compile-time constants, replaced by scripts/build.mjs (esbuild `define`) and vitest.config.ts.

/** False in `--prod` builds, which compiles `debug` logging out. */
declare const __DEBUG__: boolean;

/** Multiplier for retry delays and the stall timeout: 1 in every shipped build, 0.01 only with `--e2e`. */
declare const __RETRY_TIME_SCALE__: number;

/** True only in `--e2e` builds and unit tests; enables `__testHook` instrumentation. */
declare const __TEST_HOOKS__: boolean;
