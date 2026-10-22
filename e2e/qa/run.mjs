// Runs a QA session entry (e2e/qa/<name>.ts) under plain Node: bundles it with esbuild into .qa/
// (git-ignored), keeping packages external, then imports it.
//
//   node e2e/qa/run.mjs fake    fake pixiv + headed Chromium with dist-e2e/ (npm run qa:fake)
//   node e2e/qa/run.mjs live    headed Chromium with dist/ against the real pixiv (npm run qa:live)

import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SESSIONS = ['fake', 'live'];

const name = process.argv[2];
if (!SESSIONS.includes(name)) {
  console.error(`usage: node e2e/qa/run.mjs ${SESSIONS.join('|')}`);
  process.exit(1);
}

const outfile = path.join(ROOT, '.qa', `${name}.mjs`);
await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: [`e2e/qa/${name}.ts`],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  outfile,
  logLevel: 'warning',
});
await import(pathToFileURL(outfile).href);
