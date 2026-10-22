import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Only refusal paths are exercised here: they exit before anything is written to disk.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function build(...args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, ['scripts/build.mjs', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr };
}

describe('scripts/build.mjs', () => {
  it('build.mjs: --prod refuses a __RETRY_TIME_SCALE__ other than 1', () => {
    const result = build('--prod', '--define:__RETRY_TIME_SCALE__=0.01');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing __RETRY_TIME_SCALE__=0.01');
  });

  it('build.mjs: a dev build refuses __TEST_HOOKS__=true', () => {
    const result = build('--define:__TEST_HOOKS__=true');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('__TEST_HOOKS__=true without --e2e');
  });

  it('build.mjs: --prod and --e2e are mutually exclusive', () => {
    expect(build('--prod', '--e2e').status).toBe(1);
  });

  it('build.mjs: rejects an unknown define', () => {
    expect(build('--define:__OTHER__=1').status).toBe(1);
  });

  it('build.mjs: rejects a non-numeric __RETRY_TIME_SCALE__', () => {
    expect(build('--e2e', '--define:__RETRY_TIME_SCALE__=fast').status).toBe(1);
  });
});
