// Packages the Chrome Web Store upload (system.md §12, ENG-006).
//
//   node scripts/zip.mjs    build:prod, then dist/ → helper-for-pixiv-<package.json version>.zip
//
// Writes dist/THIRD_PARTY_NOTICES.txt with the license text of every bundled package, then zips the
// contents of dist/ at the archive root, without source maps. Entries are sorted and carry a fixed
// timestamp, so the same commit always produces the same archive bytes.

import { execSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ARCHIVE_PREFIX = 'helper-for-pixiv';
const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';
// The runtime dependencies esbuild bundles into the extension; neither has runtime dependencies.
const BUNDLED_PACKAGES = ['mediabunny', 'fflate'];
// ZIP (DOS) timestamps start in 1980. fflate encodes the local-time fields, so a local-time date
// gives the same bytes in every time zone.
const FIXED_MTIME = new Date(1980, 0, 1);
const RULE = '='.repeat(80);

function fail(message) {
  console.error(`zip: ${message}`);
  process.exit(1);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

// MPL-2.0 §3.2 asks to tell recipients where the source is. npm's repository field is either a
// string or { url: 'git+https://….git' }.
function sourceUrl(repository) {
  const url = typeof repository === 'string' ? repository : repository?.url;
  if (!url) return null;
  return url.replace(/^git\+/, '').replace(/\.git$/, '');
}

async function noticeSection(name) {
  const dir = path.join(ROOT, 'node_modules', name);
  const pkg = await readJson(path.join(dir, 'package.json'));
  const source = sourceUrl(pkg.repository);
  if (!pkg.license || !source) fail(`${name}/package.json lacks a license or repository field`);
  const license = await readFile(path.join(dir, 'LICENSE'), 'utf8');
  return [
    RULE,
    `${pkg.name} ${pkg.version}`,
    `SPDX-License-Identifier: ${pkg.license}`,
    `Source: ${source}`,
    RULE,
    '',
    license.trimEnd(),
    '',
  ].join('\n');
}

async function notices(version) {
  const sections = await Promise.all(BUNDLED_PACKAGES.map(noticeSection));
  return [
    `Helper for Pixiv ${version}: third-party notices`,
    '',
    'This extension bundles the following packages, unmodified.',
    '',
    ...sections,
  ].join('\n');
}

/** Archive paths of every file under dist/ except source maps, '/'-separated and sorted. */
async function distFiles() {
  const entries = await readdir(DIST, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.endsWith('.map'))
    .map((entry) => path.relative(DIST, path.join(entry.parentPath, entry.name)))
    .map((file) => file.split(path.sep).join('/'))
    .sort();
}

const pkg = await readJson(path.join(ROOT, 'package.json'));
execSync('npm run build:prod', { cwd: ROOT, stdio: 'inherit' });

const manifest = await readJson(path.join(DIST, 'manifest.json'));
if (manifest.version !== pkg.version) {
  fail(`dist/manifest.json version ${manifest.version} differs from package.json ${pkg.version}`);
}
await writeFile(path.join(DIST, NOTICES_FILE), await notices(pkg.version));

const files = await distFiles();
const data = {};
for (const file of files) data[file] = await readFile(path.join(DIST, file));
const archive = zipSync(data, { mtime: FIXED_MTIME });
const name = `${ARCHIVE_PREFIX}-${pkg.version}.zip`;
await writeFile(path.join(ROOT, name), archive);
console.log(`packed ${name}: ${files.length} files, ${(archive.length / 1024).toFixed(1)} KB`);
