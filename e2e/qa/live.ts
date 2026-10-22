// `npm run qa:live`: headed Chromium with the dev build (dist/) against the real pixiv, with a
// persistent profile at .qa/profile-live so a human can log in once to cover R-18 paths. Kept apart
// from .qa/profile, whose pixiv cookie is the fake one.

import path from 'node:path';
import { launch, REPO_ROOT } from '../harness/launch';
import { runSession } from './session';

const QA_DIR = path.join(REPO_ROOT, '.qa');

const harness = await launch({
  headless: process.env.HFP_HEADLESS === '1',
  profileDir: path.join(QA_DIR, 'profile-live'),
  downloadsDir: path.join(QA_DIR, 'downloads-live'),
});
const page = await harness.newPage();
await page.goto('https://www.pixiv.net/');

runSession({
  banner: [
    'real pixiv (no host mapping)',
    `CDP endpoint: ${harness.wsEndpoint}   (chromium.connectOverCDP(endpoint))`,
    `extension:    ${harness.extensionId} (dist/)`,
    `profile:      ${harness.profileDir}`,
    `downloads:    ${harness.downloads.dir}`,
    '',
    'globals: harness, page',
    '  await harness.swEval(() => chrome.action.getBadgeText({}))   await harness.downloads.files()',
  ],
  globals: { harness, page },
  close: () => harness.close(),
});
