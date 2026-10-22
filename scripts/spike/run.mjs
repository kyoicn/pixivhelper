#!/usr/bin/env node
// ENG-002 platform spike runner (docs/eng-backlog.md). Throwaway; never shipped.
//
// Loads scripts/spike/ext into Playwright's bundled Chromium (real network, logged out)
// and prints one `<name>: PASS|FAIL <detail>` line per check. Lines starting with `#`
// are informational. Exit code 0 iff checks 2–4 pass and either check 1
// (referer-rule-offscreen) or its fallback (check 7) passes.
//
// Also writes the live DOM captures test/fixtures/pixiv/artwork-live-*.html when they
// are missing (or always with --capture).
//
// Usage: node scripts/spike/run.mjs [--capture] [--headed] [--keep]

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT_SRC = path.join(ROOT, 'scripts', 'spike', 'ext');
const MEDIABUNNY_BUNDLE = path.join(ROOT, 'node_modules', 'mediabunny', 'dist', 'bundles', 'mediabunny.mjs');
const FIXTURE_DIR = path.join(ROOT, 'test', 'fixtures', 'pixiv');

const PIXIV = 'https://www.pixiv.net';
const RANKING_URL = (content) => `${PIXIV}/ranking.php?mode=daily&content=${content}&format=json`;
const ILLUST_TYPE = { illust: 0, ugoira: 2 };
const MAX_CANDIDATES = 10;
const DEVTOOLS_PORT_TIMEOUT_MS = 20_000;
const ACTION_ROW_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1_500;
const DEBUG_EVENT_SETTLE_MS = 500;
const WORKER_ATTEMPTS = 50;
const WORKER_RETRY_MS = 200;
const SPIKE_DOWNLOAD_NAME = 'spike/x.jpg';

const args = new Set(process.argv.slice(2));
const FORCE_CAPTURE = args.has('--capture');
const HEADED = args.has('--headed');
const KEEP = args.has('--keep');

const results = new Map();
function report(name, pass, detail) {
  results.set(name, pass);
  console.log(`${name}: ${pass ? 'PASS' : 'FAIL'} ${detail}`);
}
function info(line) {
  console.log(`# ${line}`);
}
async function check(name, fn) {
  try {
    const { pass, detail } = await fn();
    report(name, pass, detail);
  } catch (e) {
    report(name, false, `threw: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  return results.get(name);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Browser ────────────────────────────────────────────────────────────────

async function prepare() {
  const tmp = await mkdtemp(path.join(tmpdir(), 'hfp-spike-'));
  const ext = path.join(tmp, 'ext');
  const profile = path.join(tmp, 'profile');
  const downloads = path.join(tmp, 'downloads');
  await cp(EXT_SRC, ext, { recursive: true });
  await mkdir(path.join(ext, 'vendor'));
  await cp(MEDIABUNNY_BUNDLE, path.join(ext, 'vendor', 'mediabunny.mjs'));
  await mkdir(path.join(profile, 'Default'), { recursive: true });
  await mkdir(downloads);
  // Chrome's own download naming (uniquify) must stay in charge, so no Playwright
  // download interception: the profile points Chrome at a temp folder instead.
  await writeFile(
    path.join(profile, 'Default', 'Preferences'),
    JSON.stringify({
      download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true },
      savefile: { default_directory: downloads },
    }),
  );
  return { tmp, ext, profile, downloads };
}

async function launch({ ext, profile }) {
  const argv = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    '--lang=en-US',
    '--window-size=1366,900',
  ];
  if (!HEADED) argv.push('--headless=new');
  argv.push('about:blank');
  const child = spawn(chromium.executablePath(), argv, { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + DEVTOOLS_PORT_TIMEOUT_MS;
  let port = null;
  while (!port && Date.now() < deadline) {
    // The file can exist before its first line is written.
    const first = await readFile(portFile, 'utf8').then((t) => t.split('\n')[0], () => '');
    if (/^\d+$/.test(first)) port = first;
    else await sleep(100);
  }
  if (!port) {
    child.kill();
    throw new Error('Chromium did not publish DevToolsActivePort');
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
  return { child, browser, context: browser.contexts()[0] };
}

// Chrome also runs component extensions' workers (e.g. Google Hangouts' thunk.js),
// and ours may not have run sw.js yet when first seen, so poll for the worker
// that exposes self.spike.
async function extensionWorker(context) {
  const isSpike = (w) => w.url().startsWith('chrome-extension://') && w.url().endsWith('/sw.js');
  let lastError = null;
  for (let attempt = 0; attempt < WORKER_ATTEMPTS; attempt++) {
    for (const sw of context.serviceWorkers().filter(isSpike)) {
      try {
        if (await sw.evaluate(() => typeof self.spike === 'object')) return sw;
      } catch (e) {
        lastError = e;
      }
    }
    await sleep(WORKER_RETRY_MS);
  }
  throw new Error(`spike service worker unavailable: ${lastError?.message ?? 'never started'}`);
}

// ── Work selection ─────────────────────────────────────────────────────────

async function getJson(page, url) {
  const res = await page.goto(url);
  if (!res || !res.ok()) throw new Error(`${url} → HTTP ${res?.status()}`);
  return res.json();
}

async function pickWork(page, content) {
  const ranking = await getJson(page, RANKING_URL(content));
  for (const entry of ranking.contents.slice(0, MAX_CANDIDATES)) {
    const id = String(entry.illust_id);
    const ajax = await getJson(page, `${PIXIV}/ajax/illust/${id}`);
    if (!ajax.error && ajax.body.xRestrict === 0 && ajax.body.illustType === ILLUST_TYPE[content]) {
      return { id, original: ajax.body.urls.original, pageCount: ajax.body.pageCount };
    }
  }
  throw new Error(`no all-ages ${content} in the first ${MAX_CANDIDATES} of ${RANKING_URL(content)}`);
}

// ── DOM inspection and capture (both run in the pixiv page's main world) ───

// The selector proposals from FINDINGS.md, executed live. Stable hooks only:
// ARIA/data-* attributes, element structure, the html[data-theme] marker and
// the __NEXT_DATA__ JSON; never pixiv's generated class names.
function inspectArtworkDom() {
  const main = document.querySelector('main');
  if (!main) return { group: false };
  const figure = [...main.querySelectorAll('figure')].find((f) => !f.closest('a')) ?? null;
  const roleOf = (child) => {
    const button = child.querySelector(':scope > button');
    if (!button) return 'none';
    if (button.getAttribute('aria-haspopup') === 'true') return 'menu';
    if (button.querySelector('svg mask')) return 'bookmark';
    const label = button.querySelector(':scope > span');
    if (button.querySelector(':scope > svg') && label && label.textContent.trim() !== '') return 'like';
    return 'other';
  };
  let group = null;
  let roles = [];
  for (const section of main.querySelectorAll('section')) {
    if (!figure || !(figure.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const r = [...section.children].map(roleOf);
    if (r.includes('like') && r.filter((x) => x !== 'none').length >= 2) {
      group = section;
      roles = r;
      break;
    }
  }
  const out = { group: !!group };
  if (group) {
    const cs = getComputedStyle(group);
    const kids = [...group.children];
    const rect = group.getBoundingClientRect();
    out.domOrder = roles.join(',');
    const visual = kids
      .map((k, i) => ({ rect: k.getBoundingClientRect(), role: roles[i] }))
      .sort((a, b) => a.rect.left - b.rect.left);
    out.visualOrder = visual.map((k) => k.role).join(',');
    out.spacing = visual
      .slice(1)
      .map((k, i) => `${visual[i].role}→${k.role} ${Math.round(k.rect.left - visual[i].rect.right)}px`)
      .join(', ');
    const likeCs = getComputedStyle(kids[roles.indexOf('like')]);
    out.likeMargin = `${likeCs.marginLeft} ${likeCs.marginRight}`;
    out.layout =
      `display=${cs.display} flex-direction=${cs.flexDirection} justify-content=${cs.justifyContent} ` +
      `column-gap=${cs.columnGap}`;
    out.box = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
  }
  if (figure) {
    const rect = figure.getBoundingClientRect();
    const media = figure.querySelector('canvas') ? 'canvas' : figure.querySelector('img') ? 'img' : 'none';
    out.area = `figure(${media}) ${Math.round(rect.width)}x${Math.round(rect.height)}`;
  }
  out.theme = document.documentElement.dataset.theme ?? null;
  out.bodyBg = getComputedStyle(document.body).backgroundColor;
  const nextData = document.querySelector('script#__NEXT_DATA__[type="application/json"]');
  try {
    out.isLoggedIn = nextData ? JSON.parse(nextData.textContent).props.pageProps.isLoggedIn : null;
  } catch {
    out.isLoggedIn = 'unparseable';
  }
  const bootstrap = [...document.querySelectorAll('script:not([src]):not([type])')]
    .map((s) => s.textContent)
    .find((t) => t.includes('"rootAttribute"'));
  const flags = bootstrap ? /"isLoggedIn":(true|false).*"allowNologinDarkTheme":(true|false)/.exec(bootstrap) : null;
  out.bootstrap = flags ? `isLoggedIn=${flags[1]} allowNologinDarkTheme=${flags[2]}` : 'absent';
  return out;
}

function serializeArtworkDom(provenance) {
  const escape = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const attrs = (el) => [...el.attributes].map((a) => ` ${a.name}="${escape(a.value)}"`).join('');
  const main = document.querySelector('main').cloneNode(true);
  for (const s of main.querySelectorAll('script')) s.remove();
  const data = [...document.querySelectorAll('script')].find(
    (s) => s.type === 'application/json' && s.textContent.includes('"isLoggedIn"'),
  );
  // The anonymous session's API token is zeroed so no token-shaped value is committed.
  const dataHtml = data
    ? data.outerHTML.replace(/(\\"token\\":\\")[0-9a-f]+/g, (_, key) => key + '0'.repeat(32))
    : '<!-- no application/json script carrying "isLoggedIn" was found -->';
  return [
    '<!DOCTYPE html>',
    `<!-- ${provenance} -->`,
    `<html${attrs(document.documentElement)}>`,
    '<head><meta charset="utf-8"></head>',
    `<body${attrs(document.body)}>`,
    main.outerHTML,
    dataHtml,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

async function openArtwork(page, id) {
  await page.goto(`${PIXIV}/artworks/${id}`, { waitUntil: 'domcontentloaded' });
  await page
    .waitForFunction(`(${inspectArtworkDom.toString()})().group`, null, { timeout: ACTION_ROW_TIMEOUT_MS })
    .catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await sleep(SETTLE_MS);
  return page.evaluate(inspectArtworkDom);
}

function describe(dom) {
  if (!dom.group) return `action row NOT found; area=${dom.area ?? 'none'}; theme=${dom.theme}; isLoggedIn=${dom.isLoggedIn}`;
  return [
    `action-row DOM order=${dom.domOrder} visual L→R=${dom.visualOrder} (${dom.layout}, box ${dom.box}; ` +
      `gaps ${dom.spacing}; like wrapper margin-left/right ${dom.likeMargin})`,
    `area=${dom.area}`,
    `html[data-theme]=${dom.theme} body bg=${dom.bodyBg}`,
    `__NEXT_DATA__ isLoggedIn=${dom.isLoggedIn}; theme bootstrap ${dom.bootstrap}`,
  ].join('; ');
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function capture(page, work, kind, dom) {
  const file = path.join(FIXTURE_DIR, `artwork-live-${kind}.html`);
  const rel = path.relative(ROOT, file);
  if (!FORCE_CAPTURE && (await exists(file))) {
    info(`capture ${rel}: kept existing file (pass --capture to refresh)`);
    return;
  }
  const provenance =
    `ENG-002 live capture of ${page.url()} (artwork ${work.id}, ${kind}), logged out, ` +
    `${new Date().toISOString().slice(0, 10)}, by scripts/spike/run.mjs. Contents: html and body attributes, ` +
    `the main subtree with script elements removed, and the application/json script carrying "isLoggedIn" ` +
    `(serverSerializedPreloadedState api.token zeroed). No pixiv CSS is included.`;
  const html = await page.evaluate(serializeArtworkDom, provenance);
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(file, html);
  info(`capture ${rel}: written (${html.length} chars) — ${describe(dom)}`);
}

// ── Checks ─────────────────────────────────────────────────────────────────

async function main() {
  const dirs = await prepare();
  const { child, browser, context } = await launch(dirs);
  try {
    const sw = await extensionWorker(context);
    const spike = (fn, ...a) => sw.evaluate(([f, x]) => self.spike[f](...x), [fn, a]);
    const extensionId = await spike('extensionId');
    info(`Chromium ${browser.version()}, extension ${extensionId}, headless=${!HEADED}`);

    const nav = await context.newPage();
    const illust = await pickWork(nav, 'illust');
    const ugoira = await pickWork(nav, 'ugoira');
    info(`illust ${illust.id} (${illust.pageCount}p) original ${illust.original}`);
    info(`ugoira ${ugoira.id}`);

    const offscreenFetch = (url) => spike('offscreen', { cmd: 'fetchStatus', url });

    async function refererRuleCheck(variant) {
      await spike('setRule', variant);
      await spike('clearMatches');
      const withRule = await offscreenFetch(illust.original);
      await sleep(DEBUG_EVENT_SETTLE_MS);
      const matched = await spike('matches');
      await spike('setRule', null);
      const withoutRule = await offscreenFetch(illust.original);
      const m = matched[0];
      const how = m ? `initiator=${m.initiator} tabId=${m.tabId} type=${m.type}` : 'none';
      return {
        pass: withRule.status === 200 && withoutRule.status === 403,
        detail:
          `with rule ${withRule.status} (${withRule.size} B), without rule ${withoutRule.status}; ` +
          `rule matches ${matched.length} (${how})`,
      };
    }

    // 1 + 7: which DNR variant gets the Referer onto offscreen fetches.
    let variant = null;
    if (await check('referer-rule-offscreen', () => refererRuleCheck('spec'))) {
      variant = 'spec';
    } else if (await check('referer-rule-offscreen-fallback', () => refererRuleCheck('fallback'))) {
      variant = 'fallback';
    }
    const activeVariant = variant ?? 'spec';

    // 2: the rule never touches tab traffic (navigation, nor a tab's own fetch).
    await check('referer-rule-not-on-tab-traffic', async () => {
      await spike('setRule', activeVariant);
      await spike('clearMatches');
      const tab = await context.newPage();
      const res = await tab.goto(illust.original);
      const navStatus = res?.status() ?? null;
      await tab.close();
      const tabFetch = await nav.evaluate(async (url) => {
        const r = await fetch(url, { mode: 'no-cors', referrerPolicy: 'no-referrer', cache: 'no-store' });
        return r.type;
      }, illust.original);
      await sleep(DEBUG_EVENT_SETTLE_MS);
      const tabMatches = (await spike('matches')).filter((m) => m.tabId >= 0);
      return {
        pass: navStatus === 403 && tabMatches.length === 0,
        detail:
          `tab navigation ${navStatus}; tab fetch (xmlhttprequest from a www.pixiv.net tab, ${tabFetch}) ` +
          `rule matches with tabId>=0: ${tabMatches.length} (rule variant ${activeVariant})`,
      };
    });

    // 3: offscreen blob: URL → SW downloads.download twice → Chrome uniquifies.
    await check('blob-download-uniquify', async () => {
      await spike('setRule', activeVariant);
      const blob = await spike('offscreen', { cmd: 'fetchBlob', url: illust.original });
      if (!blob.blobUrl) return { pass: false, detail: `offscreen fetch ${blob.status}, no blob URL` };
      const first = await spike('downloadAndWait', blob.blobUrl, SPIKE_DOWNLOAD_NAME);
      const second = await spike('downloadAndWait', blob.blobUrl, SPIKE_DOWNLOAD_NAME);
      const files = [];
      for (const name of ['x.jpg', 'x (1).jpg']) {
        const file = path.join(dirs.downloads, 'spike', name);
        files.push({ name, size: (await exists(file)) ? (await stat(file)).size : -1 });
      }
      const pass =
        first.state === 'complete' &&
        second.state === 'complete' &&
        path.basename(first.filename) === 'x.jpg' &&
        path.basename(second.filename) === 'x (1).jpg' &&
        files.every((f) => f.size === blob.size);
      return {
        pass,
        detail:
          `fetch ${blob.size} B (${blob.type}); ` +
          files.map((f) => `spike/${f.name} ${f.size} B`).join(', ') +
          `; download states ${first.state}/${second.state}`,
      };
    });

    // 4: content-script ajax is first-party.
    const artPage = await context.newPage();
    const ajaxUrl = `${PIXIV}/ajax/illust/${illust.id}`;
    let listening = false;
    const seen = [];
    artPage.on('request', (req) => {
      if (listening && req.url() === ajaxUrl) seen.push(req);
    });
    const lightDom = await openArtwork(artPage, illust.id);
    await check('cs-ajax-first-party', async () => {
      listening = true;
      let r = null;
      for (let attempt = 0; attempt < 10 && !r; attempt++) {
        try {
          // pixiv may redirect to a locale-prefixed path such as /en/artworks/<id>.
          r = await spike('tabAjax', `${PIXIV}/*artworks/${illust.id}*`, `/ajax/illust/${illust.id}`);
        } catch {
          await sleep(300);
        }
      }
      listening = false;
      if (!r || r.exception) return { pass: false, detail: `content script unreachable or threw: ${r?.exception}` };
      let headers = 'request not observed';
      if (seen.length > 0) {
        const h = await seen[seen.length - 1].allHeaders();
        const phpsessid = /(?:^|;\s*)PHPSESSID=/.test(h.cookie ?? '');
        headers = `sec-fetch-site=${h['sec-fetch-site']} cookie PHPSESSID sent=${phpsessid}`;
      }
      return {
        pass: r.status === 200 && r.error === false,
        detail: `status ${r.status} error=${r.error} illustType=${r.illustType} xRestrict=${r.xRestrict}; ${headers}`,
      };
    });

    // 5 (informational): the offscreen fallback for API calls.
    await check('offscreen-ajax', async () => {
      const r = await spike('offscreen', { cmd: 'ajax', url: ajaxUrl });
      if (r.exception) return { pass: false, detail: `threw ${r.exception}` };
      return {
        pass: r.status === 200 && r.parsed && r.error === false,
        detail: `credentials:'include' status ${r.status} error=${r.error} (informational)`,
      };
    });

    // 6 (informational): mediabunny canEncodeVideo in this Chromium.
    await check('codec-probe', async () => {
      const r = await spike('offscreen', { cmd: 'probe' });
      if (r.exception) return { pass: false, detail: `threw ${r.exception}` };
      return {
        pass: r.videoEncoder,
        detail: r.results.map((x) => `${x.label}=${x.ok}`).join(' ') + ' (informational)',
      };
    });

    // DOM captures.
    info(`live artwork ${illust.id}: ${describe(lightDom)}`);
    await capture(artPage, illust, 'light', lightDom);

    const ugoiraPage = await context.newPage();
    const ugoiraDom = await openArtwork(ugoiraPage, ugoira.id);
    info(`live ugoira ${ugoira.id}: ${describe(ugoiraDom)}`);
    await capture(ugoiraPage, ugoira, 'ugoira', ugoiraDom);

    await artPage.evaluate(() => localStorage.setItem('theme', 'dark'));
    const darkDom = await openArtwork(artPage, illust.id);
    if (darkDom.theme === 'dark') {
      await capture(artPage, illust, 'dark', darkDom);
    } else {
      info(
        `capture test/fixtures/pixiv/artwork-live-dark.html: not possible logged out — with localStorage ` +
          `theme=dark the page still sets html[data-theme]=${darkDom.theme} (theme bootstrap ${darkDom.bootstrap})`,
      );
    }
    await artPage.evaluate(() => localStorage.removeItem('theme'));
  } finally {
    await browser.close().catch(() => {});
    child.kill();
    if (KEEP) info(`kept ${dirs.tmp}`);
    else await rm(dirs.tmp, { recursive: true, force: true }).catch(() => {});
  }

  const dnrOk = results.get('referer-rule-offscreen') || results.get('referer-rule-offscreen-fallback');
  const ok =
    dnrOk &&
    results.get('referer-rule-not-on-tab-traffic') &&
    results.get('blob-download-uniquify') &&
    results.get('cs-ajax-first-party');
  const chosen = results.get('referer-rule-offscreen')
    ? 'system.md §8.2 as written (initiatorDomains + tabIds + resourceTypes)'
    : results.get('referer-rule-offscreen-fallback')
      ? 'fallback without initiatorDomains'
      : 'none works';
  info(`DNR rule variant: ${chosen}`);
  info(`result: ${ok ? 'OK' : 'FAILED'}`);
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
