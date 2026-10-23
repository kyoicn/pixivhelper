// Checks the content script against its size budget (system.md §11.6, ENG-010).
//
//   node scripts/size.mjs                                  fail above 40 KB minified or 15 KB gzip
//   node scripts/size.mjs --max-min-kb N --max-gzip-kb N   override either limit
//
// build:prod ships unminified for Web Store review, so this bundles content.ts separately, minified
// with the prod defines, in memory. 1 KB = 1024 bytes.

import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'src/content/content.ts';
const DEFAULT_MAX_MIN_KB = 40;
const DEFAULT_MAX_GZIP_KB = 15;
const PROD_DEFINES = { __DEBUG__: 'false', __RETRY_TIME_SCALE__: '1', __TEST_HOOKS__: 'false' };

function fail(message) {
  console.error(`size: ${message}`);
  process.exit(1);
}

function parseLimit(flag, raw) {
  const value = Number(raw);
  if (raw === undefined || !Number.isFinite(value) || value <= 0) {
    fail(`${flag} needs a positive number, got "${raw ?? ''}"`);
  }
  return value;
}

function parseArgs(argv) {
  const limits = { minKb: DEFAULT_MAX_MIN_KB, gzipKb: DEFAULT_MAX_GZIP_KB };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--max-min-kb') limits.minKb = parseLimit(arg, argv[++i]);
    else if (arg === '--max-gzip-kb') limits.gzipKb = parseLimit(arg, argv[++i]);
    else fail(`unknown argument ${arg}`);
  }
  return limits;
}

const limits = parseArgs(process.argv.slice(2));

const result = await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: [ENTRY],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome116',
  minify: true,
  define: PROD_DEFINES,
  write: false,
  logLevel: 'warning',
});
const minified = result.outputFiles[0].contents;
const gzipped = gzipSync(minified, { level: 9 });

const checks = [
  { name: 'minified', kb: minified.length / 1024, limit: limits.minKb },
  { name: 'gzip', kb: gzipped.length / 1024, limit: limits.gzipKb },
];
for (const { name, kb, limit } of checks) {
  console.log(`${ENTRY} ${name}: ${kb.toFixed(1)} KB (limit ${limit} KB)`);
}
const over = checks.filter(({ kb, limit }) => kb > limit);
if (over.length > 0) {
  fail(`over budget: ${over.map(({ name }) => name).join(', ')} (system.md §11.6)`);
}
