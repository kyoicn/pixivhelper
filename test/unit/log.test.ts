import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/shared/log';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createLogger', () => {
  it.each(['info', 'warn', 'error'] as const)(
    'log: %s prefixes the line with [hfp:<context>]',
    (level) => {
      const spy = vi.spyOn(console, level).mockImplementation(() => undefined);
      createLogger('sw')[level]('job start', 135882741);
      expect(spy).toHaveBeenCalledWith('[hfp:sw]', 'job start', 135882741);
    },
  );

  it('log: debug prints when __DEBUG__ is true', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    createLogger('offscreen').debug('attempt', 2);
    expect(spy).toHaveBeenCalledWith('[hfp:offscreen]', 'attempt', 2);
  });

  it('log: debug is silent when __DEBUG__ is false (prod builds)', () => {
    vi.stubGlobal('__DEBUG__', false);
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    createLogger('offscreen').debug('attempt', 2);
    expect(spy).not.toHaveBeenCalled();
  });
});
