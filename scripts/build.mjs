// Builds the extension: esbuild bundles plus static files.
//
//   node scripts/build.mjs           dev build → dist/ (inline sourcemaps, __DEBUG__ = true)
//   node scripts/build.mjs --prod    prod build → dist/ (unminified, no sourcemaps, __DEBUG__ = false)
//   node scripts/build.mjs --watch   rebuild on change (combinable with --prod or --e2e)
//   node scripts/build.mjs --e2e     e2e build → dist-e2e/ (__RETRY_TIME_SCALE__ = 0.01, __TEST_HOOKS__ = true)
//   --define:NAME=VALUE              override __DEBUG__, __RETRY_TIME_SCALE__ or __TEST_HOOKS__
//
// Test-only values (__RETRY_TIME_SCALE__ other than 1, __TEST_HOOKS__ = true) are refused without
// --e2e, so no shipped build can carry them.

import * as esbuild from 'esbuild';
import { watch } from 'node:fs';
import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

// The content script must be a classic script; the other contexts load ES modules.
const ESM_ENTRIES = {
  sw: 'src/background/sw.ts',
  offscreen: 'src/offscreen/offscreen.ts',
  options: 'src/options/options.ts',
};
const IIFE_ENTRIES = { content: 'src/content/content.ts' };

const STATIC_FILE_RE = /\.(html|css|json|png)$/;

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

function parseDefine(name, raw) {
  switch (name) {
    case '__DEBUG__':
    case '__TEST_HOOKS__':
      if (raw !== 'true' && raw !== 'false') fail(`${name} must be true or false, got "${raw}"`);
      return raw === 'true';
    case '__RETRY_TIME_SCALE__': {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        fail(`${name} must be a positive number, got "${raw}"`);
      }
      return value;
    }
    default:
      return fail(`unknown define ${name}`);
  }
}

function parseArgs(argv) {
  const opts = { prod: false, watch: false, e2e: false, overrides: {} };
  for (const arg of argv) {
    if (arg === '--prod') opts.prod = true;
    else if (arg === '--watch') opts.watch = true;
    else if (arg === '--e2e') opts.e2e = true;
    else if (arg.startsWith('--define:')) {
      const match = /^--define:(\w+)=(.*)$/.exec(arg);
      if (!match) fail(`malformed ${arg}, expected --define:NAME=VALUE`);
      opts.overrides[match[1]] = parseDefine(match[1], match[2]);
    } else fail(`unknown argument ${arg}`);
  }
  if (opts.prod && opts.e2e) fail('--prod and --e2e are mutually exclusive');
  return opts;
}

function resolveDefines({ prod, e2e, overrides }) {
  const defines = {
    __DEBUG__: !prod,
    __RETRY_TIME_SCALE__: e2e ? 0.01 : 1,
    __TEST_HOOKS__: e2e,
    ...overrides,
  };
  if (!e2e && (defines.__RETRY_TIME_SCALE__ !== 1 || defines.__TEST_HOOKS__)) {
    fail(
      `refusing __RETRY_TIME_SCALE__=${defines.__RETRY_TIME_SCALE__}, ` +
        `__TEST_HOOKS__=${defines.__TEST_HOOKS__} without --e2e (test-only values; shipped builds use 1 and false)`,
    );
  }
  return defines;
}

function esbuildOptions({ prod, watch: watching }, defines, outdir) {
  const common = {
    absWorkingDir: ROOT,
    bundle: true,
    platform: 'browser',
    target: 'chrome116',
    sourcemap: prod ? false : 'inline',
    define: Object.fromEntries(Object.entries(defines).map(([k, v]) => [k, JSON.stringify(v)])),
    outdir,
    logLevel: watching ? 'info' : 'warning',
  };
  return [
    { ...common, entryPoints: ESM_ENTRIES, format: 'esm' },
    { ...common, entryPoints: IIFE_ENTRIES, format: 'iife' },
  ];
}

/** Every *.html and *.css under src/, flattened into the output root where the manifest expects them. */
async function pageAssets() {
  const entries = await readdir(SRC, { recursive: true, withFileTypes: true });
  const byName = new Map();
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(html|css)$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    if (byName.has(entry.name))
      fail(`duplicate page asset name: ${byName.get(entry.name)} and ${file}`);
    byName.set(entry.name, file);
  }
  return [...byName.values()];
}

async function copyStatic(outdir) {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(SRC, 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(path.join(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(path.join(SRC, '_locales'), path.join(outdir, '_locales'), { recursive: true });
  await cp(path.join(SRC, 'icons'), path.join(outdir, 'icons'), { recursive: true });
  for (const file of await pageAssets()) {
    await copyFile(file, path.join(outdir, path.basename(file)));
  }
}

const opts = parseArgs(process.argv.slice(2));
const defines = resolveDefines(opts);
const outdir = path.join(ROOT, opts.e2e ? 'dist-e2e' : 'dist');
const label = `${path.relative(ROOT, outdir)}/ (${opts.e2e ? 'e2e' : opts.prod ? 'prod' : 'dev'})`;

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

if (opts.watch) {
  const contexts = await Promise.all(
    esbuildOptions(opts, defines, outdir).map((options) => esbuild.context(options)),
  );
  await copyStatic(outdir);
  await Promise.all(contexts.map((context) => context.watch()));
  // esbuild only watches the module graph; manifest, locales, pages and icons are re-copied here.
  watch(SRC, { recursive: true }, (_event, file) => {
    if (file && STATIC_FILE_RE.test(file)) {
      copyStatic(outdir).then(
        () => console.log(`copied static files → ${label}`),
        (error) => console.error(`build: static copy failed: ${error}`),
      );
    }
  });
  console.log(`watching src/ → ${label}`);
} else {
  await Promise.all(esbuildOptions(opts, defines, outdir).map((options) => esbuild.build(options)));
  await copyStatic(outdir);
  console.log(`built ${label}`);
}
