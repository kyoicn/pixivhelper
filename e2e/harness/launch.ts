// Chromium launcher for the e2e harness (design-test-harness.md "Launcher (e2e/harness/launch.ts)").
// Spawns Playwright's bundled Chromium (Chrome for Testing, which still honors --load-extension)
// with the extension and a temp profile, maps pixiv's hosts to the fake server, connects over CDP
// and resets Playwright's download handling so Chrome saves files under their real names.

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Worker,
} from '@playwright/test';
import type { FakePixiv } from '../server/server';
import { ConsoleCollector, type ConsoleEntry } from './console';

export interface LaunchOptions {
  /** Fake pixiv to map www.pixiv.net, i.pximg.net and accounts.pixiv.net to. Omit for real pixiv. */
  server?: FakePixiv;
  /** Chrome UI language (what chrome.i18n uses), e.g. 'en', 'ja', 'zh_CN', 'zh_TW'. Default 'en'. */
  locale?: string;
  /** Default: headless when CI is set or HFP_HEADLESS=1, headed otherwise (HFP_HEADLESS=0 forces headed). */
  headless?: boolean;
  /** Unpacked extension. Default: dist-e2e/ with a server, dist/ without (the dev build). */
  extensionDir?: string;
  /** Persistent profile directory. Default: a fresh temp dir, deleted on close(). */
  profileDir?: string;
  /** Chrome's download directory. Default: a fresh temp dir, deleted on close(). */
  downloadsDir?: string;
}

export interface DownloadedFile {
  /** Relative to the downloads directory, '/'-separated. */
  path: string;
  size: number;
}

export interface Downloads {
  readonly dir: string;
  /** Every file under the downloads directory (recursive), sorted by path. */
  files(): Promise<DownloadedFile[]>;
  /** Resolves when `relativePath` exists (Chrome renames a download to its final name only when complete). */
  waitForFile(relativePath: string, options?: { timeout?: number }): Promise<DownloadedFile>;
}

const LAUNCH_TIMEOUT_MS = 30_000;
const SW_START_TIMEOUT_MS = 10_000;
const SW_STOP_TIMEOUT_MS = 5_000;
const POLL_MS = 50;

/** A subset of the switches Playwright passes to Chromium (never --disable-extensions): a quiet, stable browser. */
const QUIET_SWITCHES = [
  '--disable-field-trial-config',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-back-forward-cache',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-component-extensions-with-background-pages',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-dev-shm-usage',
  '--disable-features=Translate,OptimizationHints,MediaRouter,LensOverlay',
  '--disable-hang-monitor',
  '--disable-ipc-flooding-protection',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding',
  '--disable-search-engine-choice-screen',
  '--disable-sync',
  '--force-color-profile=srgb',
  '--metrics-recording-only',
  '--no-default-browser-check',
  '--no-first-run',
  '--no-service-autorun',
  '--password-store=basic',
  '--use-mock-keychain',
];

function findRepoRoot(): string {
  // Walk up instead of a fixed relative path: e2e/qa/run.mjs bundles this module into .qa/.
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('launch: package.json not found above e2e/harness');
    dir = parent;
  }
  return dir;
}

export const REPO_ROOT = findRepoRoot();
export const E2E_EXTENSION_DIR = path.join(REPO_ROOT, 'dist-e2e');
export const DEV_EXTENSION_DIR = path.join(REPO_ROOT, 'dist');

/** The ID Chrome gives an unpacked extension: SHA-256 of its absolute path, first 32 hex digits mapped to a–p. */
export function unpackedExtensionId(extensionDir: string): string {
  const absolute = realpathSync(extensionDir);
  const bytes = Buffer.from(absolute, process.platform === 'win32' ? 'utf16le' : 'utf8');
  const hex = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('');
}

function defaultHeadless(): boolean {
  const flag = process.env.HFP_HEADLESS;
  if (flag !== undefined && flag !== '') return flag !== '0';
  return Boolean(process.env.CI);
}

/** Chrome's UI language: --lang on Linux/Windows (plus LANGUAGE on Linux), AppleLanguages on macOS. */
function localeArgs(locale: string): { args: string[]; env: NodeJS.ProcessEnv } {
  const tag = locale.replace('_', '-');
  const args = [`--lang=${tag}`];
  const env: NodeJS.ProcessEnv = {};
  if (process.platform === 'darwin') args.push('-AppleLanguages', `(${tag})`);
  if (process.platform === 'linux') env.LANGUAGE = locale.replace('-', '_');
  return { args, env };
}

async function writeDownloadPrefs(profileDir: string, downloadsDir: string): Promise<void> {
  const file = path.join(profileDir, 'Default', 'Preferences');
  await mkdir(path.dirname(file), { recursive: true });
  let prefs: Record<string, unknown> = {};
  try {
    prefs = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    // No profile yet: start from empty preferences.
  }
  const section = (name: string) => (prefs[name] ?? {}) as Record<string, unknown>;
  prefs.download = {
    ...section('download'),
    default_directory: downloadsDir,
    prompt_for_download: false,
    directory_upgrade: true,
  };
  prefs.savefile = { ...section('savefile'), default_directory: downloadsDir };
  await writeFile(file, JSON.stringify(prefs));
}

function waitForDevTools(child: ChildProcess, stderrTail: () => string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`launch: Chromium printed no DevTools endpoint\n${stderrTail()}`)),
      LAUNCH_TIMEOUT_MS,
    );
    child.stderr?.on('data', () => {
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderrTail());
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(
        new Error(`launch: Chromium exited (${code}) before DevTools was ready\n${stderrTail()}`),
      );
    });
  });
}

async function listFiles(root: string): Promise<DownloadedFile[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const absolute = path.join(entry.parentPath, entry.name);
        return {
          path: path.relative(root, absolute).split(path.sep).join('/'),
          size: (await stat(absolute)).size,
        };
      }),
  );
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Harness {
  readonly browser: Browser;
  /** The default (and only) browser context: the profile the extension is installed in. */
  readonly context: BrowserContext;
  /** Browser-level CDP session. */
  readonly cdp: CDPSession;
  readonly wsEndpoint: string;
  readonly extensionId: string;
  /** `chrome-extension://<id>/sw.js` (the manifest's background.service_worker). */
  readonly serviceWorkerUrl: string;
  readonly profileDir: string;
  readonly downloads: Downloads;
  readonly #process: ChildProcess;
  readonly #console: ConsoleCollector;
  readonly #allowedConsoleErrors: RegExp[] = [];
  readonly #tempDirs: string[];
  readonly #killOnExit: () => void;
  /** Keeps a window open, so closing a spec's last tab never quits Chrome; hosts ServiceWorker.* calls. */
  readonly #anchor: CDPSession;
  #closed = false;

  constructor(init: {
    browser: Browser;
    cdp: CDPSession;
    anchor: CDPSession;
    process: ChildProcess;
    console: ConsoleCollector;
    wsEndpoint: string;
    serviceWorkerUrl: string;
    profileDir: string;
    downloadsDir: string;
    tempDirs: string[];
  }) {
    this.browser = init.browser;
    const context = init.browser.contexts()[0];
    if (!context) throw new Error('launch: no default browser context');
    this.context = context;
    this.cdp = init.cdp;
    this.#anchor = init.anchor;
    this.#process = init.process;
    this.#console = init.console;
    this.wsEndpoint = init.wsEndpoint;
    this.serviceWorkerUrl = init.serviceWorkerUrl;
    this.extensionId = new URL(init.serviceWorkerUrl).host;
    this.profileDir = init.profileDir;
    this.#tempDirs = init.tempDirs;
    const dir = init.downloadsDir;
    this.downloads = {
      dir,
      files: () => listFiles(dir),
      waitForFile: async (relativePath, { timeout = 10_000 } = {}) => {
        const deadline = Date.now() + timeout;
        for (;;) {
          const file = (await listFiles(dir)).find((candidate) => candidate.path === relativePath);
          if (file) return file;
          if (Date.now() > deadline) {
            throw new Error(`downloads: ${relativePath} did not appear within ${timeout} ms`);
          }
          await sleep(POLL_MS);
        }
      },
    };
    this.#killOnExit = () => init.process.kill('SIGKILL');
    process.once('exit', this.#killOnExit);
  }

  newPage(): Promise<Page> {
    return this.context.newPage();
  }

  /** True while the extension's service worker target exists (i.e. the worker is running). */
  async isServiceWorkerRunning(): Promise<boolean> {
    return (await this.#swTargetId()) !== null;
  }

  /** The running extension service worker, starting it first if it is stopped. */
  async serviceWorker(): Promise<Worker> {
    if (!(await this.isServiceWorkerRunning())) await this.#startServiceWorker();
    const known = this.context.serviceWorkers().find((w) => w.url() === this.serviceWorkerUrl);
    if (known) return known;
    return this.context.waitForEvent('serviceworker', {
      predicate: (w) => w.url() === this.serviceWorkerUrl,
      timeout: SW_START_TIMEOUT_MS,
    });
  }

  /** Evaluates `fn` in the extension service worker (waking it if stopped), e.g. `() => chrome.action.getBadgeText({})`. */
  swEval<R>(fn: () => R | Promise<R>): Promise<R>;
  swEval<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  async swEval<R, A>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    const worker = await this.serviceWorker();
    // Playwright types `arg` through its handle-unboxing mapper; a plain serializable value passes as-is.
    return worker.evaluate(fn as (arg: unknown) => R | Promise<R>, arg);
  }

  /**
   * Stops the extension service worker, like "Stop" in chrome://serviceworker-internals: CDP
   * Target.closeTarget on its target, falling back to ServiceWorker.stopAllWorkers. Resolves once
   * the target is gone. Chrome restarts the worker on its next event; swEval() also restarts it.
   */
  async stopServiceWorker(): Promise<void> {
    const targetId = await this.#swTargetId();
    if (targetId === null) return;
    const closed = await this.cdp
      .send('Target.closeTarget', { targetId })
      .then(({ success }) => success)
      .catch(() => false);
    if (closed && (await this.#waitForSwTarget(false, SW_STOP_TIMEOUT_MS / 2))) return;
    // ServiceWorker.* commands fail with "domain not enabled" until it is.
    await this.#anchor.send('ServiceWorker.enable');
    await this.#anchor.send('ServiceWorker.stopAllWorkers');
    if (!(await this.#waitForSwTarget(false, SW_STOP_TIMEOUT_MS / 2))) {
      throw new Error('stopServiceWorker: the service worker target did not go away');
    }
  }

  /** Console errors, uncaught exceptions and browser error logs from every page, the SW and the offscreen document. */
  consoleErrors(): ConsoleEntry[] {
    return [...this.#console.entries];
  }

  /** Marks console errors matching `patterns` as expected (e.g. the network error of an injected fault). */
  allowConsoleErrors(...patterns: RegExp[]): void {
    this.#allowedConsoleErrors.push(...patterns);
  }

  /** Console errors not covered by allowConsoleErrors(); the test fixture fails a test that has any. */
  unexpectedConsoleErrors(): ConsoleEntry[] {
    return this.#console.entries.filter(
      (entry) => !this.#allowedConsoleErrors.some((pattern) => pattern.test(entry.text)),
    );
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    process.off('exit', this.#killOnExit);
    this.#console.close();
    const running = this.#process.exitCode === null && this.#process.signalCode === null;
    const exited = new Promise((resolve) => {
      if (running) this.#process.once('exit', resolve);
      else resolve(undefined);
    });
    // A clean quit lets a persistent profile save its state; browser.close() only disconnects.
    await this.cdp.send('Browser.close').catch(() => undefined);
    await this.browser.close().catch(() => undefined);
    const timer = setTimeout(() => this.#process.kill('SIGKILL'), 5_000);
    await exited;
    clearTimeout(timer);
    for (const dir of this.#tempDirs) {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    }
  }

  async #swTargetId(): Promise<string | null> {
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    const target = targetInfos.find(
      (info) => info.type === 'service_worker' && info.url === this.serviceWorkerUrl,
    );
    return target?.targetId ?? null;
  }

  async #waitForSwTarget(running: boolean, timeout: number): Promise<boolean> {
    const deadline = Date.now() + timeout;
    for (;;) {
      if ((await this.isServiceWorkerRunning()) === running) return true;
      if (Date.now() > deadline) return false;
      await sleep(POLL_MS);
    }
  }

  async #startServiceWorker(): Promise<void> {
    await this.#anchor.send('ServiceWorker.enable');
    await this.#anchor.send('ServiceWorker.startWorker', {
      scopeURL: `chrome-extension://${this.extensionId}/`,
    });
    if (!(await this.#waitForSwTarget(true, SW_START_TIMEOUT_MS))) {
      throw new Error('serviceWorker: the extension service worker did not start');
    }
  }
}

async function serviceWorkerScript(extensionDir: string): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(extensionDir, 'manifest.json'), 'utf8')) as {
    background?: { service_worker?: string };
  };
  const script = manifest.background?.service_worker;
  if (!script)
    throw new Error(`launch: ${extensionDir}/manifest.json has no background.service_worker`);
  return script;
}

/**
 * Launches Chromium with the extension. With `server`, pixiv's hosts resolve to the fake server and
 * its self-signed certificate is accepted; without it, Chromium talks to the real pixiv.
 */
export async function launch(options: LaunchOptions = {}): Promise<Harness> {
  const { server, locale = 'en' } = options;
  const extensionDir = path.resolve(
    options.extensionDir ?? (server ? E2E_EXTENSION_DIR : DEV_EXTENSION_DIR),
  );
  if (!existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error(
      `launch: no extension at ${extensionDir}; run \`npm run ${server ? 'build:e2e' : 'build'}\` first`,
    );
  }
  const swScript = await serviceWorkerScript(extensionDir);
  const tempDirs: string[] = [];
  const tempDir = async (prefix: string) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  };
  const profileDir = options.profileDir ?? (await tempDir('hfp-profile-'));
  const downloadsDir = options.downloadsDir ?? (await tempDir('hfp-downloads-'));
  await mkdir(downloadsDir, { recursive: true });
  await writeDownloadPrefs(profileDir, downloadsDir);

  const headless = options.headless ?? defaultHeadless();
  const lang = localeArgs(locale);
  const args = [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    // No startup tab: loose arguments (such as macOS's "(ja)" AppleLanguages value) would open as URLs.
    '--no-startup-window',
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--window-size=1280,960',
    ...QUIET_SWITCHES,
    ...(server
      ? [`--host-resolver-rules=${server.hostResolverRules}`, '--ignore-certificate-errors']
      : []),
    ...(headless ? ['--headless=new'] : []),
    // As Playwright's own Chromium launches do: CI runners often lack the user namespaces the sandbox needs.
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ...lang.args,
  ];
  const child = spawn(chromium.executablePath(), args, {
    env: { ...process.env, ...lang.env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-16_384);
  });

  try {
    const wsEndpoint = await waitForDevTools(child, () => stderr);
    const browser = await chromium.connectOverCDP(wsEndpoint);
    const cdp = await browser.newBrowserCDPSession();
    // Playwright routes downloads to its artifacts dir under GUID names; restore Chrome's own behavior.
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
    const context = browser.contexts()[0];
    if (!context) throw new Error('launch: no default browser context');
    const isOurs = (worker: Worker) =>
      /^chrome-extension:\/\/[a-p]{32}\//.test(worker.url()) &&
      worker.url().endsWith(`/${swScript}`);
    const worker =
      context.serviceWorkers().find(isOurs) ??
      (await context.waitForEvent('serviceworker', {
        predicate: isOurs,
        timeout: SW_START_TIMEOUT_MS,
      }));
    const consoleCollector = await ConsoleCollector.start(wsEndpoint, new URL(worker.url()).host);
    const anchorPage = await context.newPage();
    const anchor = await context.newCDPSession(anchorPage);
    return new Harness({
      browser,
      cdp,
      anchor,
      process: child,
      console: consoleCollector,
      wsEndpoint,
      serviceWorkerUrl: worker.url(),
      profileDir,
      downloadsDir,
      tempDirs,
    });
  } catch (error) {
    child.kill('SIGKILL');
    for (const dir of tempDirs)
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
