// Content script entry (classic script, top frame of every www.pixiv.net page;
// design-artwork-button.md "Startup"). Owns the per-artwork entries and wires the router, the
// placement, the button and the SW messages together. It never downloads anything itself.

import { localeTag } from '../shared/i18n';
import { createLogger } from '../shared/log';
import {
  type CodecCaps,
  type ContentToSwMessage,
  isForTarget,
  isJobUpdateMessage,
  type ResponseFor,
} from '../shared/messages';
import { illustUrl, parseIllust, requiresLogin } from '../shared/pixiv-api';
import { fetchWithRetry } from '../shared/retry';
import {
  DEFAULT_SETTINGS,
  effectiveFormat,
  onSettingsChanged,
  readSettings,
} from '../shared/settings';
import type { JobView, Settings, WorkInfo } from '../shared/types';
import { proxyFetchJson } from './api-proxy';
import { announcementFor } from './button/labels';
import {
  type ButtonEvent,
  type ClickAction,
  clickAction,
  type Entry,
  reduce,
} from './button/model';
import { createButton } from './button/view';
import { createMount, HOST_TAG } from './mount';
import { detectTheme, observeTheme, readIsLoggedIn } from './pixiv-dom';
import { createRouter } from './router';
import { createTabMemory } from './tab-memory';

declare global {
  interface Window {
    __hfpInit?: boolean;
  }
}

const log = createLogger('content');

/** What chrome.* throws once the extension was updated or reloaded under this page. */
const CONTEXT_INVALIDATED = 'Extension context invalidated';

function init(): void {
  // The script can be injected twice into one document (e.g. after an extension reload).
  if (window.__hfpInit) return;
  window.__hfpInit = true;
  log.debug('init');

  // pixiv's login state can only change through a full load (PRD CUJ-5 edge cases).
  const loggedIn = readIsLoggedIn(document);
  const memory = createTabMemory();
  /** Encoder support per ugoira artwork, from caps/get. */
  const caps = new Map<string, CodecCaps>();
  const metadataInFlight = new Set<string>();
  let settings: Settings = DEFAULT_SETTINGS;
  let displayed: string | null = null;
  let alive = true;

  const host = document.createElement(HOST_TAG);
  const button = createButton(host, { locale: localeTag(), onActivate });
  button.setTheme(detectTheme(document));
  const router = createRouter({ enter, leave });
  const mount = createMount({
    host,
    artworkId: () => displayed,
    onMutation: () => router.check(),
    onPlaced: measure,
  });
  const stopTheme = observeTheme(document, (theme) => button.setTheme(theme));
  const stopSettings = onSettingsChanged(applySettings);
  chrome.runtime.onMessage.addListener(onMessage);
  router.start();
  void readSettings().then(applySettings);
  // Reload reattach (PRD §4.7.6): this tab's running jobs.
  void send({ target: 'sw', type: 'job/listForTab' }).then((response) => {
    if (response?.ok) response.views.forEach(applyView);
  });
  // The width is measured at placement; a late web font can only widen it, before interaction.
  void document.fonts.ready.then(measure);

  function enter(artworkId: string): void {
    displayed = artworkId;
    const entry = memory.getOrCreate(artworkId);
    show(entry, entry);
    void loadMetadata(artworkId);
    mount.show();
  }

  function leave(): void {
    displayed = null;
    mount.hide();
  }

  /** Stores `next` and, if it is the displayed artwork, renders it and announces the change. */
  function show(prev: Entry, next: Entry): void {
    if (!alive) return;
    const entry = withCurrentFormat(next);
    memory.set(entry);
    if (entry.artworkId !== displayed) return;
    button.render(entry, settings);
    const announcement = announcementFor(prev.state, entry);
    if (announcement) button.announce(announcement);
  }

  function update(artworkId: string, event: ButtonEvent): void {
    const prev = memory.getOrCreate(artworkId);
    show(prev, reduce(prev, event));
  }

  function applyView(view: JobView): void {
    if (!alive) return;
    const { prev, next } = memory.applyView(view);
    show(prev, next);
  }

  /** Locks (or widens once, before interaction) the displayed entry's width; needs layout. */
  function measure(): void {
    if (!alive || displayed === null || !host.isConnected) return;
    const entry = memory.getOrCreate(displayed);
    const width = button.lockWidth(entry);
    if (width !== entry.width) show(entry, { ...entry, width });
  }

  /**
   * An idle ugoira shows the format the current settings produce on this machine (design
   * "Settings and codec reactivity"); busy, saved and error entries keep their job's snapshot.
   */
  function withCurrentFormat(entry: Entry): Entry {
    if (entry.state.s !== 'idle' || entry.work?.illustType !== 2) return entry;
    const known = caps.get(entry.artworkId);
    if (!known) return entry;
    const format = effectiveFormat(settings.ugoiraOutput, known);
    return format === entry.format ? entry : reduce(entry, { type: 'format', format });
  }

  function applySettings(next: Settings): void {
    settings = next;
    if (displayed !== null) {
      const entry = memory.getOrCreate(displayed);
      show(entry, entry);
    }
  }

  /** Render-time metadata (design "Render-time metadata"); never awaited before first render. */
  async function loadMetadata(artworkId: string): Promise<void> {
    const entry = memory.getOrCreate(artworkId);
    if (entry.work !== null || entry.state.s === 'unavailable') return;
    if (metadataInFlight.has(artworkId)) return;
    metadataInFlight.add(artworkId);
    const result = parseIllust(
      await fetchWithRetry(illustUrl(artworkId), { responseType: 'json' }),
    );
    metadataInFlight.delete(artworkId);
    if (!result.ok) {
      const { kind, status } = result.failure;
      // Any other failure stays pending: a click runs the job and the SW classifies it.
      if (status === 404 || kind === 'pixivError') update(artworkId, { type: 'unavailable' });
      return;
    }
    const work = result.value;
    if (requiresLogin(work, loggedIn)) {
      log.debug('needs login', artworkId, work.xRestrict >= 1 ? 'xRestrict' : 'withheld');
    }
    update(artworkId, { type: 'metadata', work, loggedIn });
    if (artworkId === displayed) measure();
    if (work.illustType === 2) await loadCaps(artworkId, work);
  }

  async function loadCaps(artworkId: string, work: WorkInfo): Promise<void> {
    const response = await send({
      target: 'sw',
      type: 'caps/get',
      width: work.width,
      height: work.height,
    });
    if (!response?.ok) return;
    caps.set(artworkId, response.caps);
    update(artworkId, {
      type: 'format',
      format: effectiveFormat(settings.ugoiraOutput, response.caps),
    });
  }

  function onActivate(): void {
    if (displayed === null) return;
    const entry = memory.getOrCreate(displayed);
    const now = performance.now();
    const action = clickAction(entry, now, location.href, loggedIn);
    // Busy (or the optimistic cancel) shows synchronously, before the SW answers (PRD NFR).
    show(entry, reduce(entry, { type: 'click', now }));
    void run(entry.artworkId, action);
  }

  async function run(artworkId: string, action: ClickAction): Promise<void> {
    switch (action.type) {
      case 'start': {
        const response = await send({ target: 'sw', type: 'job/start', ...action.request });
        update(
          artworkId,
          response?.ok ? { type: 'started', jobId: response.view.jobId } : { type: 'startFailed' },
        );
        return;
      }
      case 'cancel':
        await send({ target: 'sw', type: 'job/cancel', jobId: action.jobId });
        return;
      case 'login':
        location.assign(action.url);
        return;
      case 'ignore':
        return;
    }
  }

  function onMessage(
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean | undefined {
    if (!isForTarget(message, 'tab')) return undefined;
    switch (message.type) {
      case 'job/update':
        if (isJobUpdateMessage(message)) applyView(message.view);
        else log.warn('invalid job/update ignored');
        return undefined;
      case 'api/fetchJson':
        void proxyFetchJson(message).then(sendResponse);
        return true;
      default:
        return undefined;
    }
  }

  /** Sends to the SW; null when it fails or gives no answer. Tears down on context invalidation. */
  async function send<M extends ContentToSwMessage>(message: M): Promise<ResponseFor<M> | null> {
    try {
      const response = (await chrome.runtime.sendMessage(message)) as ResponseFor<M> | undefined;
      return response ?? null;
    } catch (error) {
      if (error instanceof Error && error.message.includes(CONTEXT_INVALIDATED)) teardown();
      else log.debug(`${message.type} failed:`, error);
      return null;
    }
  }

  /**
   * The extension was updated or reloaded under this page (design "Extension update / context
   * invalidation"): leave no dead button behind. The next page load runs the new version.
   */
  function teardown(): void {
    if (!alive) return;
    alive = false;
    log.debug('extension context invalidated: tearing down');
    router.stop();
    mount.destroy();
    stopTheme();
    button.destroy();
    try {
      stopSettings();
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // chrome.* may itself throw in an invalidated context; nothing is left to clean up then.
    }
  }
}

init();
