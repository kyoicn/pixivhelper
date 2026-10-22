// Console error collection from every page, service worker and offscreen document. Playwright exposes
// neither the offscreen document (a `background_page` target it does not attach to) nor console
// messages logged before it attached, so this uses its own CDP connection with flat sessions;
// Runtime.enable replays the messages a context logged before the attach.

export type ConsoleSource = 'sw' | 'offscreen' | 'extension-page' | 'page';

export interface ConsoleEntry {
  at: number;
  source: ConsoleSource;
  /** URL of the target that logged it. */
  url: string;
  /** console.error/assert, an uncaught exception, or a browser log entry (network, security, …). */
  kind: 'console' | 'exception' | 'log';
  text: string;
}

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
}

interface RemoteObject {
  type: string;
  value?: unknown;
  description?: string;
  unserializableValue?: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: unknown;
  error?: { message: string };
}

const WATCHED_TYPES = new Set(['page', 'service_worker', 'background_page']);

function describe(object: RemoteObject): string {
  if (object.value !== undefined) {
    return typeof object.value === 'string' ? object.value : JSON.stringify(object.value);
  }
  return object.description ?? object.unserializableValue ?? `[${object.type}]`;
}

/** A minimal Chrome DevTools Protocol client over the browser WebSocket (flat session mode). */
class CdpConnection {
  readonly #socket: WebSocket;
  #nextId = 1;
  readonly #pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  #onEvent: (method: string, params: Record<string, unknown>, sessionId?: string) => void =
    () => {};

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => this.#dispatch(String(event.data)));
    socket.addEventListener('close', () => {
      for (const { reject } of this.#pending.values()) reject(new Error('CDP connection closed'));
      this.#pending.clear();
    });
  }

  static connect(url: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new CdpConnection(socket)), { once: true });
      socket.addEventListener('error', () => reject(new Error(`CDP: cannot connect to ${url}`)), {
        once: true,
      });
    });
  }

  onEvent(listener: (method: string, params: Record<string, unknown>, sessionId?: string) => void) {
    this.#onEvent = listener;
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  close(): void {
    this.#socket.close();
  }

  #dispatch(data: string): void {
    const message = JSON.parse(data) as CdpMessage;
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error.message));
      else pending?.resolve(message.result);
    } else if (message.method) {
      this.#onEvent(message.method, message.params ?? {}, message.sessionId);
    }
  }
}

export class ConsoleCollector {
  readonly entries: ConsoleEntry[] = [];
  readonly #connection: CdpConnection;
  readonly #extensionOrigin: string;
  /** targetId → sessionId of our attachment. */
  readonly #attached = new Map<string, string>();
  readonly #targets = new Map<string, TargetInfo>();

  private constructor(connection: CdpConnection, extensionId: string) {
    this.#connection = connection;
    this.#extensionOrigin = `chrome-extension://${extensionId}/`;
    connection.onEvent((method, params, sessionId) => this.#onEvent(method, params, sessionId));
  }

  static async start(wsEndpoint: string, extensionId: string): Promise<ConsoleCollector> {
    const collector = new ConsoleCollector(await CdpConnection.connect(wsEndpoint), extensionId);
    await collector.#connection.send('Target.setDiscoverTargets', { discover: true });
    return collector;
  }

  close(): void {
    this.#connection.close();
  }

  #source(target: TargetInfo): ConsoleSource {
    if (target.type === 'service_worker') return 'sw';
    // An MV3 extension has no background page: its only background_page targets are offscreen documents.
    if (target.type === 'background_page') return 'offscreen';
    return target.url.startsWith(this.#extensionOrigin) ? 'extension-page' : 'page';
  }

  #onEvent(method: string, params: Record<string, unknown>, sessionId?: string): void {
    switch (method) {
      case 'Target.targetCreated':
      case 'Target.targetInfoChanged': {
        const target = params.targetInfo as TargetInfo;
        if (!WATCHED_TYPES.has(target.type)) return;
        this.#targets.set(target.targetId, target);
        if (!this.#attached.has(target.targetId)) void this.#attach(target.targetId);
        return;
      }
      case 'Target.detachedFromTarget': {
        const targetId = params.targetId as string | undefined;
        if (targetId) this.#attached.delete(targetId);
        return;
      }
      case 'Runtime.consoleAPICalled': {
        const type = params.type as string;
        if (type !== 'error' && type !== 'assert') return;
        const args = (params.args as RemoteObject[] | undefined) ?? [];
        this.#add(sessionId, 'console', args.map(describe).join(' '));
        return;
      }
      case 'Runtime.exceptionThrown': {
        const details = params.exceptionDetails as {
          text: string;
          exception?: RemoteObject;
        };
        this.#add(sessionId, 'exception', details.exception?.description ?? details.text);
        return;
      }
      case 'Log.entryAdded': {
        const entry = params.entry as { level: string; text: string; url?: string };
        if (entry.level !== 'error') return;
        this.#add(sessionId, 'log', entry.url ? `${entry.text} (${entry.url})` : entry.text);
        return;
      }
    }
  }

  async #attach(targetId: string): Promise<void> {
    this.#attached.set(targetId, '');
    try {
      const { sessionId } = (await this.#connection.send('Target.attachToTarget', {
        targetId,
        flatten: true,
      })) as { sessionId: string };
      this.#attached.set(targetId, sessionId);
      await Promise.all([
        this.#connection.send('Runtime.enable', {}, sessionId),
        this.#connection.send('Log.enable', {}, sessionId),
      ]);
    } catch {
      // The target went away before the attach finished (closed tab, stopped worker).
      this.#attached.delete(targetId);
    }
  }

  #add(sessionId: string | undefined, kind: ConsoleEntry['kind'], text: string): void {
    const targetId = [...this.#attached].find(([, session]) => session === sessionId)?.[0];
    const target = targetId ? this.#targets.get(targetId) : undefined;
    if (!target) return;
    this.entries.push({
      at: Date.now(),
      source: this.#source(target),
      url: target.url,
      kind,
      text,
    });
  }
}
