// `npm run qa:fake`: the fake pixiv plus headed Chromium with dist-e2e/ and a persistent profile at
// .qa/profile, for the QA role to walk CUJs and inject faults (design-test-harness.md "QA role usage").

import path from 'node:path';
import { artworkUrl, WORKS } from '../fixtures/works';
import { launch, REPO_ROOT } from '../harness/launch';
import { startFakePixiv } from '../server/server';
import { runSession } from './session';

const QA_DIR = path.join(REPO_ROOT, '.qa');

const server = await startFakePixiv();
const harness = await launch({
  server,
  headless: process.env.HFP_HEADLESS === '1',
  profileDir: path.join(QA_DIR, 'profile'),
  downloadsDir: path.join(QA_DIR, 'downloads'),
});
const page = await harness.newPage();
await page.goto(artworkUrl('135882741'));

runSession({
  banner: [
    `fake pixiv:   127.0.0.1:${server.port} (www.pixiv.net, i.pximg.net, accounts.pixiv.net)`,
    `CDP endpoint: ${harness.wsEndpoint}   (chromium.connectOverCDP(endpoint))`,
    `extension:    ${harness.extensionId} (dist-e2e/)`,
    `profile:      ${harness.profileDir}`,
    `downloads:    ${harness.downloads.dir}`,
    '',
    'fixtures:',
    ...WORKS.map((work) => `  ${artworkUrl(work.id)}  ${work.purpose}`),
    '',
    'globals: server, harness, page, works',
    "  server.fault({ match: '_p3.', responses: [503, 503, 200] })   server.clearFaults()",
    "  server.patchWork('145892669', { r18Hidden: true })   server.log   server.maxInFlight('135882741')",
    '  await harness.swEval(() => chrome.action.getBadgeText({}))   await harness.stopServiceWorker()',
    '  await harness.downloads.files()   harness.consoleErrors()',
  ],
  globals: { server, harness, page, works: WORKS },
  async close() {
    await harness.close();
    await server.close();
  },
});
