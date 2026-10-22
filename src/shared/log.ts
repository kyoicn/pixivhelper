// Leveled console logger (system.md §11.3). Never log cookies, headers, or URLs with query strings.

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Returns a logger whose lines are prefixed `[hfp:<context>]`. `debug` is compiled out of
 * `--prod` builds (`__DEBUG__ = false`); `warn` and `error` always print, so they reach
 * chrome://extensions → Errors.
 */
export function createLogger(context: string): Logger {
  const prefix = `[hfp:${context}]`;
  return {
    debug(...args) {
      if (__DEBUG__) console.debug(prefix, ...args);
    },
    info(...args) {
      console.info(prefix, ...args);
    },
    warn(...args) {
      console.warn(prefix, ...args);
    },
    error(...args) {
      console.error(prefix, ...args);
    },
  };
}
