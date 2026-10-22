// Fake pixiv: one HTTPS server (HTTP/2 with HTTP/1.1 fallback) on 127.0.0.1 that answers for
// www.pixiv.net, i.pximg.net and accounts.pixiv.net, routed by Host. Chromium reaches it through
// --host-resolver-rules (e2e/harness/launch.ts). Specs drive it in-process: faults, request log,
// per-artwork concurrency. design-test-harness.md "Fake pixiv server (e2e/server/)".

import http2, { type Http2ServerRequest, type Http2ServerResponse } from 'node:http2';
import type { Socket } from 'node:net';
import { generate } from 'selfsigned';
import { masterBytes, pageBytes, ugoiraZip } from '../fixtures/assets';
import {
  masterUrl,
  originalUrl,
  PIXIV_REFERER,
  ugoiraSmallZipUrl,
  ugoiraZipUrl,
  WORKS,
  type Work,
  type WorkPatch,
} from '../fixtures/works';
import {
  failure,
  illustBody,
  MESSAGE_NOT_FOUND,
  MESSAGE_NOT_UGOIRA,
  MESSAGE_RESTRICTED,
  ok,
  pagesBody,
  ugoiraMetaBody,
  type AjaxEnvelope,
} from './ajax';
import { artworkPageTitle, loginPage, notFoundPage, wwwPage, type CatalogEntry } from './page';

export const FAKE_HOSTS = ['www.pixiv.net', 'i.pximg.net', 'accounts.pixiv.net'] as const;
export type FakeHost = (typeof FAKE_HOSTS)[number];

/** The cookie the fake login sets on `.pixiv.net`; its presence is what "logged in" means. */
export const SESSION_COOKIE_NAME = 'PHPSESSID';
export const SESSION_COOKIE_VALUE = 'fake-session';

/** `https://i.pximg.net/__harness/ok.bin`: served without a Referer check, for harness self-tests. */
export const HARNESS_BLOB_PATH = '/__harness/ok.bin';
export const HARNESS_BLOB = Uint8Array.from({ length: 70_001 }, (_, i) => i % 251);

const ARTWORK_PAGE_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?artworks\/(\d{1,12})\/?$/;
const USER_PAGE_RE = /^\/users\/(\d+)\/?$/;
const AJAX_RE = /^\/ajax\/illust\/(\d{1,12})(\/pages|\/ugoira_meta)?$/;
const ORIGINAL_RE = /^\/img-original\/img\/[\d/]+\/(\d+)_p(\d+)\.(jpg|png)$/;
const MASTER_RE = /^\/img-master\/img\/[\d/]+\/(\d+)_p0_master1200\.jpg$/;
const ZIP_RE = /^\/img-zip-ugoira\/img\/[\d/]+\/(\d+)_ugoira\d+x\d+\.zip$/;
/** Byte requests counted by maxInFlight(): originals and frame zips. */
const BYTES_RE = /^\/(?:img-original|img-zip-ugoira)\/.*\/(\d+)_[^/]*$/;
const CHUNK_BYTES = 16 * 1024;
/** A held response sends one body byte this often: well inside the e2e build's 300 ms stall timeout. */
const HOLD_TRICKLE_MS = 100;

/**
 * One scripted answer. A number is shorthand for `{ status }`. Status 200 (or none) means "answer
 * normally", optionally after `delayHeadersMs` or cut off after `stallAfterBytes` body bytes (the
 * connection then stays open and silent). `reset` drops the request without a response (an HTTP/2
 * stream reset, or a socket destroy on HTTP/1.1), which the browser reports as a network error.
 */
export type FaultResponse =
  | number
  | {
      status?: number;
      /** Retry-After header value (seconds or an HTTP date), sent with a non-200 status. */
      retryAfter?: number | string;
      delayHeadersMs?: number;
      stallAfterBytes?: number;
      reset?: boolean;
    };

export interface FaultRule {
  /** Substring of, or RegExp tested against, the full request URL (`https://host/path?query`). */
  match: string | RegExp;
  /**
   * One response: applies to every matching request until clearFaults(). An array: consumed one per
   * matching request (e.g. `[503, 503, 200]` per attempt), after which the rule is gone.
   */
  responses: FaultResponse | readonly FaultResponse[];
}

export interface LoggedRequest {
  /** Date.now() when the request arrived. */
  at: number;
  method: string;
  host: string;
  /** Path and query. */
  path: string;
  url: string;
  referer: string | null;
  /** The request carried PHPSESSID=fake-session. */
  loggedIn: boolean;
  /** Response status; null while pending or when a reset fault dropped the request. */
  status: number | null;
  /** Length of the response body (the full length, also when a stall fault cut it short). */
  bytes: number | null;
  /** For i.pximg.net original/zip requests: the artwork ID the file belongs to. */
  artworkId: string | null;
  /** A fault rule answered or shaped this request. */
  fault: boolean;
}

export type RequestMatcher = string | RegExp | ((request: LoggedRequest) => boolean);

interface Reply {
  status: number;
  headers: Record<string, string | string[]>;
  body: Uint8Array;
  /** Send chunked, without Content-Length. */
  omitLength?: boolean;
}

interface ActiveFault {
  match: string | RegExp;
  responses: FaultResponse[];
  /** A single response applies until clearFaults(); a sequence is consumed. */
  persistent: boolean;
}

/**
 * A hold from FakePixiv.hold(): matching 200 answers send their headers, then trickle the body one
 * byte at a time (so the client's inactivity timeout never fires) and finish only on release().
 */
export interface Hold {
  /** Matching requests being held right now. */
  readonly held: number;
  /** Finishes every held request and lets later matching requests through. Idempotent. */
  release(): void;
}

interface ActiveHold {
  matches: (request: LoggedRequest) => boolean;
  /** One finisher per held response: sends the rest of its body. */
  finishers: Set<() => void>;
  release: () => void;
}

interface Waiter {
  matches: (request: LoggedRequest) => boolean;
  resolve: (request: LoggedRequest) => void;
}

const encoder = new TextEncoder();

function urlMatches(match: string | RegExp, url: string): boolean {
  return typeof match === 'string' ? url.includes(match) : match.test(url);
}

function toMatcher(match: RequestMatcher): (request: LoggedRequest) => boolean {
  if (typeof match === 'function') return match;
  return (request) => urlMatches(match, request.url);
}

function isSequence(responses: FaultRule['responses']): responses is readonly FaultResponse[] {
  return Array.isArray(responses);
}

function normalizeFault(response: FaultResponse): Exclude<FaultResponse, number> {
  return typeof response === 'number' ? { status: response } : response;
}

function html(
  status: number,
  text: string,
  headers: Record<string, string | string[]> = {},
): Reply {
  return {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
    body: encoder.encode(text),
  };
}

function json(status: number, envelope: AjaxEnvelope): Reply {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: encoder.encode(JSON.stringify(envelope)),
  };
}

function text(status: number, message: string): Reply {
  return {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: encoder.encode(`${message}\n`),
  };
}

function image(body: Uint8Array, contentType: string, omitLength: boolean): Reply {
  return {
    status: 200,
    headers: { 'content-type': contentType, 'cache-control': 'max-age=31536000' },
    body,
    omitLength,
  };
}

function redirect(location: string, headers: Record<string, string | string[]> = {}): Reply {
  return {
    status: 302,
    headers: { location, 'cache-control': 'no-store', ...headers },
    body: new Uint8Array(0),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.join('; ');
  return value ?? null;
}

export class FakePixiv {
  /** Every request since start or the last reset(), in arrival order. */
  readonly log: LoggedRequest[] = [];
  readonly #server: http2.Http2SecureServer;
  readonly #sockets = new Set<Socket>();
  readonly #sessions = new Set<http2.ServerHttp2Session>();
  #faults: ActiveFault[] = [];
  readonly #patches = new Map<string, WorkPatch>();
  readonly #inFlight = new Map<string, number>();
  readonly #peak = new Map<string, number>();
  #waiters: Waiter[] = [];
  #holds: ActiveHold[] = [];

  private constructor(key: string, cert: string) {
    this.#server = http2.createSecureServer({ key, cert, allowHTTP1: true }, (req, res) => {
      this.#handle(req, res).catch((error: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(String(error));
        }
      });
    });
    this.#server.on('secureConnection', (socket: Socket) => {
      this.#sockets.add(socket);
      socket.on('close', () => this.#sockets.delete(socket));
    });
    this.#server.on('session', (session) => {
      this.#sessions.add(session);
      session.on('close', () => this.#sessions.delete(session));
    });
  }

  static async start(port = 0): Promise<FakePixiv> {
    const now = Date.now();
    const pems = await generate([{ name: 'commonName', value: 'www.pixiv.net' }], {
      keyType: 'ec',
      algorithm: 'sha256',
      notBeforeDate: new Date(now - 24 * 3600_000),
      notAfterDate: new Date(now + 30 * 24 * 3600_000),
      extensions: [
        { name: 'subjectAltName', altNames: FAKE_HOSTS.map((host) => ({ type: 2, value: host })) },
      ],
    });
    const server = new FakePixiv(pems.private, pems.cert);
    await new Promise<void>((resolve, reject) => {
      server.#server.once('error', reject);
      server.#server.listen(port, '127.0.0.1', () => resolve());
    });
    return server;
  }

  get port(): number {
    const address = this.#server.address();
    if (!address || typeof address === 'string') throw new Error('fake pixiv is not listening');
    return address.port;
  }

  /** Value for Chromium's --host-resolver-rules: every fake host → 127.0.0.1:port. */
  get hostResolverRules(): string {
    return FAKE_HOSTS.map((host) => `MAP ${host} 127.0.0.1:${this.port}`).join(', ');
  }

  fault(rule: FaultRule): void {
    const persistent = !isSequence(rule.responses);
    const responses = isSequence(rule.responses) ? [...rule.responses] : [rule.responses];
    if (responses.length > 0) this.#faults.push({ match: rule.match, responses, persistent });
  }

  /**
   * Holds matching requests that would be answered 200 with a Content-Length (e.g. originals): the
   * headers go out at once, then the body trickles one byte every HOLD_TRICKLE_MS, keeping the last
   * byte back, until release(). The transfer stays in flight without ever stalling, which neither
   * delayHeadersMs nor stallAfterBytes can do under the e2e build's 300 ms stall timeout. A body of
   * n bytes can be held for about (n − 1) × HOLD_TRICKLE_MS (the smallest fixture page, 239 bytes,
   * for ~24 s); after that it stalls and the client's retry starts a fresh hold.
   */
  hold(match: RequestMatcher): Hold {
    const active: ActiveHold = {
      matches: toMatcher(match),
      finishers: new Set(),
      release: () => {
        this.#holds = this.#holds.filter((other) => other !== active);
        for (const finish of [...active.finishers]) finish();
      },
    };
    this.#holds.push(active);
    return {
      get held() {
        return active.finishers.size;
      },
      release: active.release,
    };
  }

  clearFaults(): void {
    this.#faults = [];
  }

  /** Overrides fixture fields for this server until reset(). */
  patchWork(id: string, patch: WorkPatch): void {
    this.#patches.set(id, { ...this.#patches.get(id), ...patch });
  }

  /** The fixture as currently served (with patches). */
  work(id: string): Work | undefined {
    const work = WORKS.find((candidate) => candidate.id === id);
    return work ? { ...work, ...this.#patches.get(id) } : undefined;
  }

  /** Peak number of concurrent original/zip requests for one artwork since start or reset(). */
  maxInFlight(artworkId: string): number {
    return this.#peak.get(artworkId) ?? 0;
  }

  requests(match?: RequestMatcher): LoggedRequest[] {
    return match === undefined ? [...this.log] : this.log.filter(toMatcher(match));
  }

  /** Resolves with the first logged request (already logged or future) that matches. */
  waitForRequest(match: RequestMatcher, { timeout = 10_000 } = {}): Promise<LoggedRequest> {
    const matches = toMatcher(match);
    const logged = this.log.find(matches);
    if (logged) return Promise.resolve(logged);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        matches,
        resolve: (request) => {
          clearTimeout(timer);
          resolve(request);
        },
      };
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((other) => other !== waiter);
        reject(new Error(`fake pixiv: no request matching ${String(match)} within ${timeout} ms`));
      }, timeout);
      this.#waiters.push(waiter);
    });
  }

  /** Clears the log, faults, work patches and in-flight peaks. */
  reset(): void {
    this.log.length = 0;
    this.#faults = [];
    this.#patches.clear();
    this.#peak.clear();
    for (const hold of [...this.#holds]) hold.release();
  }

  async close(): Promise<void> {
    for (const session of this.#sessions) session.destroy();
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  #takeFault(url: string): Exclude<FaultResponse, number> | null {
    const index = this.#faults.findIndex((fault) => urlMatches(fault.match, url));
    const fault = this.#faults[index];
    if (!fault) return null;
    const response = (fault.persistent ? fault.responses[0] : fault.responses.shift()) ?? 200;
    if (fault.responses.length === 0) this.#faults.splice(index, 1);
    return normalizeFault(response);
  }

  #record(request: LoggedRequest): void {
    this.log.push(request);
    const ready = this.#waiters.filter((waiter) => waiter.matches(request));
    this.#waiters = this.#waiters.filter((waiter) => !ready.includes(waiter));
    for (const waiter of ready) waiter.resolve(request);
  }

  #track(artworkId: string, res: Http2ServerResponse): void {
    const count = (this.#inFlight.get(artworkId) ?? 0) + 1;
    this.#inFlight.set(artworkId, count);
    this.#peak.set(artworkId, Math.max(this.#peak.get(artworkId) ?? 0, count));
    res.once('close', () =>
      this.#inFlight.set(artworkId, (this.#inFlight.get(artworkId) ?? 1) - 1),
    );
  }

  async #handle(req: Http2ServerRequest, res: Http2ServerResponse): Promise<void> {
    const host = (headerValue(req.headers[':authority']) ?? headerValue(req.headers.host) ?? '')
      .replace(/:\d+$/, '')
      .toLowerCase();
    const path = req.url || '/';
    const cookies = (headerValue(req.headers.cookie) ?? '').split(/;\s*/);
    const pathname = new URL(path, 'https://fake.invalid').pathname;
    const request: LoggedRequest = {
      at: Date.now(),
      method: req.method,
      host,
      path,
      url: `https://${host}${path}`,
      referer: headerValue(req.headers.referer),
      loggedIn: cookies.includes(`${SESSION_COOKIE_NAME}=${SESSION_COOKIE_VALUE}`),
      status: null,
      bytes: null,
      artworkId: host === 'i.pximg.net' ? (BYTES_RE.exec(pathname)?.[1] ?? null) : null,
      fault: false,
    };
    this.#record(request);
    if (request.artworkId) this.#track(request.artworkId, res);
    let closed = false;
    res.once('close', () => {
      closed = true;
    });

    const fault = this.#takeFault(request.url);
    request.fault = fault !== null;
    if (fault?.delayHeadersMs) await sleep(fault.delayHeadersMs);
    if (closed) return;
    if (fault?.reset) {
      if (req.httpVersionMajor === 2) req.stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
      else req.socket.destroy();
      return;
    }
    const reply =
      fault?.status !== undefined && fault.status !== 200
        ? this.#faultReply(fault.status, fault.retryAfter, pathname)
        : this.#route(req.method, host, path, request);
    request.status = reply.status;
    request.bytes = reply.body.length;
    const hold =
      reply.status === 200 && !reply.omitLength && fault?.stallAfterBytes === undefined
        ? this.#holds.find((candidate) => candidate.matches(request))
        : undefined;
    if (hold && reply.body.length > 1) {
      this.#sendHeld(res, reply, hold);
      return;
    }
    this.#send(res, reply, fault?.stallAfterBytes);
  }

  #faultReply(status: number, retryAfter: number | string | undefined, pathname: string): Reply {
    const reply = pathname.startsWith('/ajax/')
      ? json(status, failure(`fake-pixiv fault ${status}`))
      : text(status, `fake-pixiv fault ${status}`);
    if (retryAfter !== undefined) reply.headers['retry-after'] = String(retryAfter);
    return reply;
  }

  #sendHeld(res: Http2ServerResponse, reply: Reply, hold: ActiveHold): void {
    res.writeHead(reply.status, {
      ...reply.headers,
      'content-length': String(reply.body.length),
    });
    let sent = 0;
    const trickle = (): void => {
      if (sent >= reply.body.length - 1) return;
      res.write(reply.body.subarray(sent, sent + 1));
      sent++;
    };
    const timer = setInterval(trickle, HOLD_TRICKLE_MS);
    const finish = (): void => {
      clearInterval(timer);
      hold.finishers.delete(finish);
      if (!res.writableEnded && !res.destroyed) res.end(reply.body.subarray(sent));
    };
    hold.finishers.add(finish);
    res.once('close', () => {
      clearInterval(timer);
      hold.finishers.delete(finish);
    });
    trickle();
  }

  #send(res: Http2ServerResponse, reply: Reply, stallAfterBytes: number | undefined): void {
    const headers = { ...reply.headers };
    if (!reply.omitLength) headers['content-length'] = String(reply.body.length);
    res.writeHead(reply.status, headers);
    if (stallAfterBytes !== undefined) {
      res.write(reply.body.subarray(0, stallAfterBytes));
      return;
    }
    if (!reply.omitLength) {
      res.end(reply.body);
      return;
    }
    for (let offset = 0; offset < reply.body.length; offset += CHUNK_BYTES) {
      res.write(reply.body.subarray(offset, offset + CHUNK_BYTES));
    }
    res.end();
  }

  #route(method: string, host: string, path: string, request: LoggedRequest): Reply {
    const url = new URL(path, `https://${host}`);
    // Browsers ask every host for a favicon; answering keeps 404s out of the console.
    if (url.pathname === '/favicon.ico')
      return { status: 204, headers: {}, body: new Uint8Array(0) };
    if (host === 'www.pixiv.net') return this.#www(method, url, request.loggedIn);
    if (host === 'i.pximg.net') return this.#pximg(method, url, request.referer);
    if (host === 'accounts.pixiv.net') return this.#accounts(method, url, request.loggedIn);
    return text(421, `fake pixiv does not serve ${host}`);
  }

  #catalog(): Record<string, CatalogEntry> {
    const catalog: Record<string, CatalogEntry> = {};
    for (const { id } of WORKS) {
      const work = this.work(id);
      if (!work) continue;
      catalog[id] = {
        id,
        title: work.title,
        userName: work.userName,
        userId: work.userId,
        xRestrict: work.xRestrict,
        pageCount: work.illustType === 2 ? 1 : work.pages.length,
        description: work.description,
        tags: work.tags,
        master: masterUrl(work),
        width: work.width,
        height: work.height,
        pageTitle: artworkPageTitle(work),
      };
    }
    return catalog;
  }

  #www(method: string, url: URL, loggedIn: boolean): Reply {
    if (method !== 'GET') return text(405, 'method not allowed');
    const { pathname } = url;
    const ajax = AJAX_RE.exec(pathname);
    if (ajax?.[1]) return this.#ajax(ajax[1], ajax[2] ?? '', loggedIn);

    const illustId = ARTWORK_PAGE_RE.exec(pathname)?.[1] ?? null;
    const userId = USER_PAGE_RE.exec(pathname)?.[1] ?? null;
    if (!illustId && !userId && pathname !== '/') return html(404, notFoundPage());
    const title = this.#pageTitle(illustId, userId);
    return html(200, wwwPage({ title, loggedIn, illustId, works: this.#catalog() }));
  }

  #pageTitle(illustId: string | null, userId: string | null): string {
    if (illustId) {
      const work = this.work(illustId);
      return work ? artworkPageTitle(work) : 'pixiv';
    }
    const owner = userId ? WORKS.find((work) => work.userId === userId) : undefined;
    return owner ? `${owner.userName} - pixiv` : 'pixiv';
  }

  #ajax(id: string, endpoint: string, loggedIn: boolean): Reply {
    const work = this.work(id);
    if (!work || work.deleted) return json(404, failure(MESSAGE_NOT_FOUND));
    const restricted = work.xRestrict > 0 && (!loggedIn || work.r18Hidden === true);
    if (endpoint === '') return json(200, ok(illustBody(work, work.xRestrict > 0 && !loggedIn)));
    if (restricted) return json(200, failure(MESSAGE_RESTRICTED));
    if (endpoint === '/pages') return json(200, ok(pagesBody(work)));
    if (work.illustType !== 2) return json(200, failure(MESSAGE_NOT_UGOIRA));
    return json(200, ok(ugoiraMetaBody(work)));
  }

  #pximg(method: string, url: URL, referer: string | null): Reply {
    if (method !== 'GET') return text(405, 'method not allowed');
    const { pathname } = url;
    if (pathname === HARNESS_BLOB_PATH)
      return image(HARNESS_BLOB, 'application/octet-stream', false);
    if (!pathname.startsWith('/img-')) return text(404, 'not found');
    // i.pximg.net refuses image requests that do not come from pixiv.
    if (referer !== PIXIV_REFERER) return text(403, 'Forbidden');

    const fullUrl = `https://i.pximg.net${pathname}`;
    const original = ORIGINAL_RE.exec(pathname);
    if (original?.[1]) {
      const work = this.work(original[1]);
      const page = Number(original[2]);
      if (work && work.illustType !== 2 && fullUrl === originalUrl(work, page)) {
        const type = work.pages[page] === 'png' ? 'image/png' : 'image/jpeg';
        return image(pageBytes(work, page), type, work.noContentLength === true);
      }
    }
    const master = MASTER_RE.exec(pathname);
    if (master?.[1]) {
      const work = this.work(master[1]);
      if (work && fullUrl === masterUrl(work)) return image(masterBytes(work), 'image/jpeg', false);
    }
    const zip = ZIP_RE.exec(pathname);
    if (zip?.[1]) {
      const work = this.work(zip[1]);
      if (
        work?.illustType === 2 &&
        (fullUrl === ugoiraZipUrl(work) || fullUrl === ugoiraSmallZipUrl(work))
      ) {
        return image(ugoiraZip(work), 'application/zip', work.noContentLength === true);
      }
    }
    return text(404, 'not found');
  }

  #accounts(method: string, url: URL, loggedIn: boolean): Reply {
    if (url.pathname !== '/login') return text(404, 'not found');
    const requested = url.searchParams.get('return_to') ?? '';
    const returnTo = requested.startsWith(PIXIV_REFERER) ? requested : PIXIV_REFERER;
    if (method === 'POST') {
      return redirect(returnTo, {
        'set-cookie': `${SESSION_COOKIE_NAME}=${SESSION_COOKIE_VALUE}; Domain=.pixiv.net; Path=/; Secure; HttpOnly; SameSite=Lax`,
      });
    }
    if (method !== 'GET') return text(405, 'method not allowed');
    // pixiv sends an already logged-in visitor straight back.
    return loggedIn ? redirect(returnTo) : html(200, loginPage(returnTo));
  }
}

export function startFakePixiv(port?: number): Promise<FakePixiv> {
  return FakePixiv.start(port);
}
