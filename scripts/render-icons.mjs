// One-off: renders assets/icon.svg to the committed src/icons/icon-{16,32,48,128}.png.
//
//   node scripts/render-icons.mjs                    Playwright's Chromium (npx playwright install chromium)
//   node scripts/render-icons.mjs --channel=chrome   an installed browser channel instead
//
// Each size is rasterized from the vector source (not downscaled from 128 px), with a transparent
// background outside the rounded square.

import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];

const channelArg = process.argv.slice(2).find((arg) => arg.startsWith('--channel='));
const svg = await readFile(path.join(ROOT, 'assets/icon.svg'));
const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;

const browser = await chromium.launch(
  channelArg ? { channel: channelArg.slice('--channel='.length) } : {},
);
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}img{display:block}</style>` +
        `<img src="${src}" width="${size}" height="${size}">`,
    );
    const out = path.join(ROOT, 'src/icons', `icon-${size}.png`);
    await page.screenshot({ path: out, omitBackground: true });
    await page.close();
    console.log(`wrote ${path.relative(ROOT, out)}`);
  }
} finally {
  await browser.close();
}
