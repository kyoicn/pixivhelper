import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isApiFetchJsonMessage,
  isCapsGetMessage,
  isContentScriptSender,
  isContentToSwMessage,
  isForTarget,
  isJobCancelMessage,
  isJobListForTabMessage,
  isJobStartMessage,
  isJobUpdateMessage,
  isNonTabSender,
  isOffAbortCommand,
  isOffEncodeCommand,
  isOffFailedEvent,
  isOffFetchBytesCommand,
  isOffFetchJsonCommand,
  isOffFetchZipCommand,
  isOffMakeTextCommand,
  isOffProbeCommand,
  isOffProgressEvent,
  isOffReadyEvent,
  isOffReleaseCommand,
  isOffscreenSender,
  isOffscreenToSwEvent,
  isOffTasksCommand,
  isSwToOffscreenMessage,
  isSwToTabMessage,
  type Message,
} from '../../src/shared/messages';
import type { JobOutcome, JobView } from '../../src/shared/types';

type Guard = (m: unknown) => boolean;
type Cases = Array<[label: string, override: Record<string, unknown>]>;

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const OFFSCREEN_URL = `chrome-extension://${EXT_ID}/offscreen.html`;
const JOB_ID = '0b7c6f5e-3d2a-4c1b-9e8f-7a6b5c4d3e2f';
const TASK_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ORIGINAL = 'https://i.pximg.net/img-original/img/2025/10/02/03/00/00/135882741_p0.jpg';
const ZIP =
  'https://i.pximg.net/img-zip-ugoira/img/2025/10/05/21/00/00/136004512_ugoira1920x1080.zip';
const API = 'https://www.pixiv.net/ajax/illust/135882741';
const FOLDER = 'pixiv/みずき-135882741';
const FRAMES = [
  { file: '000000.jpg', delay: 40 },
  { file: '000001.jpg', delay: 500 },
];

const RUNNING_VIEW: JobView = {
  jobId: JOB_ID,
  artworkId: '135882741',
  kind: 'pages',
  status: 'running',
  progress: { kind: 'pages', done: 3, total: 12 },
  format: null,
  folder: FOLDER,
  outcome: null,
};
const ENDED_VIEW: JobView = {
  ...RUNNING_VIEW,
  status: 'ended',
  outcome: { type: 'saved', folder: FOLDER, pages: 12 },
};

// One valid sample per message type (and per StartRequest mode / progress phase).
const VALID = {
  startFull: {
    target: 'sw',
    type: 'job/start',
    mode: 'full',
    artworkId: '135882741',
    expectedFiles: 12,
    loggedIn: false,
  },
  startRetryPages: {
    target: 'sw',
    type: 'job/start',
    mode: 'retryPages',
    artworkId: '135882741',
    folder: FOLDER,
    pages: [0, 4, 11],
    total: 12,
  },
  startRetryEncode: {
    target: 'sw',
    type: 'job/start',
    mode: 'retryEncode',
    artworkId: '136004512',
    folder: FOLDER,
    format: 'mp4',
  },
  startRetryMetadata: {
    target: 'sw',
    type: 'job/start',
    mode: 'retryMetadata',
    artworkId: '135882741',
    folder: FOLDER,
  },
  cancel: { target: 'sw', type: 'job/cancel', jobId: JOB_ID },
  listForTab: { target: 'sw', type: 'job/listForTab' },
  capsGet: { target: 'sw', type: 'caps/get', width: 600, height: 600 },
  jobUpdate: { target: 'tab', type: 'job/update', view: RUNNING_VIEW },
  apiFetchJson: { target: 'tab', type: 'api/fetchJson', url: API },
  fetchBytes: { target: 'offscreen', type: 'off/fetchBytes', taskId: TASK_ID, url: ORIGINAL },
  makeText: {
    target: 'offscreen',
    type: 'off/makeText',
    taskId: TASK_ID,
    text: '{}',
    mime: 'application/json',
  },
  fetchZip: { target: 'offscreen', type: 'off/fetchZip', taskId: TASK_ID, url: ZIP, save: true },
  encode: {
    target: 'offscreen',
    type: 'off/encode',
    taskId: TASK_ID,
    zipTaskId: JOB_ID,
    frames: FRAMES,
    format: 'mp4',
    avcCodec: 'avc1.64001e',
    artworkId: '136004512',
  },
  abort: { target: 'offscreen', type: 'off/abort', taskIds: [TASK_ID, JOB_ID] },
  release: { target: 'offscreen', type: 'off/release', taskIds: [TASK_ID], keepRetained: true },
  offFetchJson: {
    target: 'offscreen',
    type: 'off/fetchJson',
    url: `${API}/pages`,
    credentials: 'include',
  },
  probe: { target: 'offscreen', type: 'off/probe', width: 1920, height: 1080 },
  tasks: { target: 'offscreen', type: 'off/tasks' },
  ready: { target: 'sw', type: 'off/ready', taskId: TASK_ID, blobUrl: 'blob:x/1', size: 10 },
  failed: {
    target: 'sw',
    type: 'off/failed',
    taskId: TASK_ID,
    failure: { kind: 'http', status: 503, attempts: 4 },
  },
  progressZip: {
    target: 'sw',
    type: 'off/progress',
    taskId: TASK_ID,
    phase: 'zip',
    loaded: 512,
    total: 2048,
  },
  progressEncode: {
    target: 'sw',
    type: 'off/progress',
    taskId: TASK_ID,
    phase: 'encode',
    done: 3,
    total: 48,
  },
} satisfies Record<string, Message>;

function expectAccepts(guard: Guard, base: object, cases: Cases): void {
  it.each(cases)(`${guard.name}: accepts %s`, (_label, override) => {
    expect(guard({ ...base, ...override })).toBe(true);
  });
}

function expectRejects(guard: Guard, base: object, cases: Cases): void {
  it.each(cases)(`${guard.name}: rejects %s`, (_label, override) => {
    expect(guard({ ...base, ...override })).toBe(false);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isForTarget', () => {
  it('isForTarget: accepts an envelope for its target', () => {
    expect(isForTarget(VALID.cancel, 'sw')).toBe(true);
  });

  it.each([
    ['another target', VALID.cancel, 'offscreen'],
    ['a missing type', { target: 'sw' }, 'sw'],
    ['a non-object', 'job/cancel', 'sw'],
    ['null', null, 'sw'],
  ] as const)('isForTarget: rejects %s', (_label, m, target) => {
    expect(isForTarget(m, target)).toBe(false);
  });
});

describe('isJobStartMessage', () => {
  expectAccepts(isJobStartMessage, VALID.startFull, [
    ['full', {}],
    ['full with expectedFiles 0', { expectedFiles: 0 }],
    ['full with expectedFiles over 200 (the SW clamps it)', { expectedFiles: 500 }],
    ['a 12-digit artwork id', { artworkId: '123456789012' }],
    ['full logged in', { loggedIn: true }],
    ['full with an unknown login state', { loggedIn: null }],
  ]);
  expectAccepts(isJobStartMessage, VALID.startRetryPages, [
    ['retryPages', {}],
    ['retryPages with the last of 200 pages', { pages: [199], total: 200 }],
    ['retryPages with pages out of order', { pages: [5, 0, 3] }],
  ]);
  expectAccepts(isJobStartMessage, VALID.startRetryEncode, [
    ['retryEncode mp4', {}],
    ['retryEncode webm', { format: 'webm' }],
    ['a folder of exactly 1024 chars', { folder: 'a'.repeat(1024) }],
  ]);
  expectAccepts(isJobStartMessage, VALID.startRetryMetadata, [['retryMetadata', {}]]);

  expectRejects(isJobStartMessage, VALID.startFull, [
    ['another target', { target: 'tab' }],
    ['another type', { type: 'job/cancel' }],
    ['an unknown mode', { mode: 'retryAll' }],
    ['a missing mode', { mode: undefined }],
    ['a non-digit artwork id', { artworkId: '12a' }],
    ['a 13-digit artwork id', { artworkId: '1234567890123' }],
    ['an empty artwork id', { artworkId: '' }],
    ['a numeric artwork id', { artworkId: 135882741 }],
    ['a negative expectedFiles', { expectedFiles: -1 }],
    ['a fractional expectedFiles', { expectedFiles: 1.5 }],
    ['a string expectedFiles', { expectedFiles: '12' }],
    ['full without loggedIn', { loggedIn: undefined }],
    ["full with loggedIn 'yes'", { loggedIn: 'yes' }],
    ['full with loggedIn 0', { loggedIn: 0 }],
  ]);
  expectRejects(isJobStartMessage, VALID.startRetryPages, [
    ['no pages', { pages: [] }],
    ['duplicate pages', { pages: [1, 1] }],
    ['a negative page', { pages: [-1] }],
    ['a page equal to total', { pages: [12] }],
    ['a fractional page', { pages: [0.5] }],
    ['a string page', { pages: ['1'] }],
    ['pages that are not an array', { pages: 3 }],
    ['a total over 200', { pages: [0], total: 201 }],
    ['a zero total', { pages: [0], total: 0 }],
    ['a missing total', { total: undefined }],
    ['a missing folder', { folder: undefined }],
    ['an empty folder', { folder: '' }],
    ['a folder with a leading slash', { folder: '/pixiv' }],
    ['a folder over 1024 chars', { folder: 'a'.repeat(1025) }],
    ['a non-string folder', { folder: ['pixiv'] }],
  ]);
  expectRejects(isJobStartMessage, VALID.startRetryEncode, [
    ['the zip format', { format: 'zip' }],
    ['an unknown format', { format: 'gif' }],
    ['a missing folder', { folder: undefined }],
  ]);
  expectRejects(isJobStartMessage, VALID.startRetryMetadata, [
    ['a missing folder', { folder: undefined }],
    ['a leading-slash folder', { folder: '/x' }],
  ]);

  it('isJobStartMessage: rejects a non-object', () => {
    expect(isJobStartMessage('job/start')).toBe(false);
  });
});

describe('isJobCancelMessage', () => {
  expectAccepts(isJobCancelMessage, VALID.cancel, [['a job id', {}]]);
  expectRejects(isJobCancelMessage, VALID.cancel, [
    ['an empty job id', { jobId: '' }],
    ['a missing job id', { jobId: undefined }],
    ['a numeric job id', { jobId: 7 }],
    ['another target', { target: 'offscreen' }],
  ]);
});

describe('isJobListForTabMessage', () => {
  expectAccepts(isJobListForTabMessage, VALID.listForTab, [['an empty payload', {}]]);
  expectRejects(isJobListForTabMessage, VALID.listForTab, [
    ['another target', { target: 'tab' }],
    ['another type', { type: 'job/list' }],
  ]);
});

describe('isCapsGetMessage', () => {
  expectAccepts(isCapsGetMessage, VALID.capsGet, [
    ['600×600', {}],
    ['the 1×1 minimum', { width: 1, height: 1 }],
    ['the 16384×16384 maximum', { width: 16384, height: 16384 }],
  ]);
  expectRejects(isCapsGetMessage, VALID.capsGet, [
    ['a zero width', { width: 0 }],
    ['a height over 16384', { height: 16385 }],
    ['a fractional width', { width: 600.5 }],
    ['a string height', { height: '600' }],
    ['a missing height', { height: undefined }],
    ['a negative width', { width: -600 }],
  ]);
});

describe('isJobUpdateMessage', () => {
  const view = (patch: Partial<Record<keyof JobView, unknown>>): Record<string, unknown> => ({
    view: { ...RUNNING_VIEW, ...patch },
  });
  const ended = (outcome: unknown): Record<string, unknown> => ({
    view: { ...ENDED_VIEW, outcome },
  });
  const OUTCOMES: JobOutcome[] = [
    { type: 'saved', folder: FOLDER },
    { type: 'saved', folder: FOLDER, pages: 12 },
    { type: 'saved', folder: FOLDER, format: 'webm' },
    { type: 'partial', folder: FOLDER, total: 12, saved: 10, failedPages: [3, 7] },
    { type: 'metadataOnly', folder: FOLDER, total: 12 },
    { type: 'encodeFailed', folder: FOLDER, format: 'mp4' },
    { type: 'error', cause: 'offline' },
    { type: 'error', cause: 'disk' },
    { type: 'needsLogin' },
    { type: 'unavailable' },
    { type: 'cancelled' },
  ];

  expectAccepts(isJobUpdateMessage, VALID.jobUpdate, [
    ['a running pages view', {}],
    ['a resolving view', view({ kind: 'unknown', progress: null, folder: null })],
    [
      'a ugoira percent view',
      view({
        kind: 'ugoira',
        format: 'mp4',
        progress: { kind: 'percent', percent: 40, phase: 'encode', indeterminate: false },
      }),
    ],
    [
      'an indeterminate zip phase',
      view({
        kind: 'ugoira',
        format: 'zip',
        progress: { kind: 'percent', percent: 0, phase: 'frames', indeterminate: true },
      }),
    ],
    ...OUTCOMES.map((o): Cases[number] => [`an ended view with ${JSON.stringify(o)}`, ended(o)]),
  ]);
  expectRejects(isJobUpdateMessage, VALID.jobUpdate, [
    ['a missing view', { view: undefined }],
    ['a null view', { view: null }],
    ['a running view with an outcome', view({ outcome: { type: 'cancelled' } })],
    ['an ended view without an outcome', view({ status: 'ended' })],
    ['an unknown status', view({ status: 'paused' })],
    ['an unknown kind', view({ kind: 'novel' })],
    ['an empty job id', view({ jobId: '' })],
    ['a bad artwork id', view({ artworkId: 'x1' })],
    ['an unknown format', view({ format: 'gif' })],
    ['a leading-slash folder', view({ folder: '/pixiv' })],
    ['a negative pages done', view({ progress: { kind: 'pages', done: -1, total: 12 } })],
    [
      'a percent over 100',
      view({ progress: { kind: 'percent', percent: 101, phase: 'encode', indeterminate: false } }),
    ],
    [
      'an unknown percent phase',
      view({ progress: { kind: 'percent', percent: 5, phase: 'zip', indeterminate: false } }),
    ],
    [
      'a missing indeterminate flag',
      view({ progress: { kind: 'percent', percent: 5, phase: 'frames' } }),
    ],
    ['an unknown progress kind', view({ progress: { kind: 'bytes', done: 1, total: 2 } })],
    ['an unknown outcome type', ended({ type: 'done' })],
    ['an unknown error cause', ended({ type: 'error', cause: 'timeout' })],
    ['a saved outcome without a folder', ended({ type: 'saved' })],
    ['a saved outcome with a bad format', ended({ type: 'saved', folder: FOLDER, format: 'gif' })],
    [
      'a partial outcome with string failed pages',
      ended({ type: 'partial', folder: FOLDER, total: 2, saved: 1, failedPages: ['1'] }),
    ],
    [
      'an encodeFailed outcome with the zip format',
      ended({ type: 'encodeFailed', folder: FOLDER, format: 'zip' }),
    ],
    ['a metadataOnly outcome without a total', ended({ type: 'metadataOnly', folder: FOLDER })],
    ['another target', { target: 'sw' }],
  ]);
});

describe('isApiFetchJsonMessage', () => {
  expectAccepts(isApiFetchJsonMessage, VALID.apiFetchJson, [
    ['the illust endpoint', {}],
    ['the pages endpoint', { url: `${API}/pages` }],
    ['the ugoira_meta endpoint', { url: `${API}/ugoira_meta` }],
  ]);
  expectRejects(isApiFetchJsonMessage, VALID.apiFetchJson, [
    ['a bytes URL', { url: ORIGINAL }],
    ['a query string', { url: `${API}?lang=ja` }],
    ['another pixiv endpoint', { url: 'https://www.pixiv.net/ajax/user/1' }],
    ['another host', { url: 'https://evil.com/ajax/illust/1' }],
    ['a missing URL', { url: undefined }],
  ]);
});

describe('isOffFetchBytesCommand', () => {
  expectAccepts(isOffFetchBytesCommand, VALID.fetchBytes, [['an original', {}]]);
  expectRejects(isOffFetchBytesCommand, VALID.fetchBytes, [
    ['an API URL', { url: API }],
    ['a plain-http URL', { url: 'http://i.pximg.net/a.jpg' }],
    ['a look-alike host', { url: 'https://i.pximg.net.evil.com/a.jpg' }],
    ['a missing task id', { taskId: undefined }],
    ['another target', { target: 'sw' }],
  ]);
});

describe('isOffMakeTextCommand', () => {
  expectAccepts(isOffMakeTextCommand, VALID.makeText, [
    ['JSON text', {}],
    ['empty text', { text: '' }],
  ]);
  expectRejects(isOffMakeTextCommand, VALID.makeText, [
    ['non-string text', { text: { a: 1 } }],
    ['an empty mime', { mime: '' }],
    ['a missing mime', { mime: undefined }],
    ['an empty task id', { taskId: '' }],
  ]);
});

describe('isOffFetchZipCommand', () => {
  expectAccepts(isOffFetchZipCommand, VALID.fetchZip, [
    ['save: true', {}],
    ['save: false', { save: false }],
  ]);
  expectRejects(isOffFetchZipCommand, VALID.fetchZip, [
    ['a non-boolean save', { save: 'yes' }],
    ['a missing save', { save: undefined }],
    ['a URL off the allowlist', { url: 'https://evil.com/a.zip' }],
  ]);
});

describe('isOffEncodeCommand', () => {
  expectAccepts(isOffEncodeCommand, VALID.encode, [
    ['mp4 with a codec string', {}],
    ['webm without a codec string', { format: 'webm', avcCodec: null }],
    ['frames with extra keys', { frames: [{ file: 'a.jpg', delay: 10, extra: 1 }] }],
  ]);
  expectRejects(isOffEncodeCommand, VALID.encode, [
    ['the zip format', { format: 'zip' }],
    ['an empty codec string', { avcCodec: '' }],
    ['a missing codec string', { avcCodec: undefined }],
    ['frames that are not an array', { frames: {} }],
    ['a frame without delay', { frames: [{ file: 'a.jpg' }] }],
    ['a frame with a numeric file', { frames: [{ file: 1, delay: 10 }] }],
    ['a bad artwork id', { artworkId: '13600451x' }],
    ['a missing zip task id', { zipTaskId: undefined }],
  ]);
});

describe('isOffAbortCommand', () => {
  expectAccepts(isOffAbortCommand, VALID.abort, [
    ['two task ids', {}],
    ['no task ids', { taskIds: [] }],
  ]);
  expectRejects(isOffAbortCommand, VALID.abort, [
    ['an empty task id', { taskIds: [''] }],
    ['a numeric task id', { taskIds: [1] }],
    ['a single string', { taskIds: TASK_ID }],
  ]);
});

describe('isOffReleaseCommand', () => {
  expectAccepts(isOffReleaseCommand, VALID.release, [
    ['keepRetained', {}],
    ['no keepRetained', { keepRetained: undefined }],
    ['keepRetained: false', { keepRetained: false }],
  ]);
  expectRejects(isOffReleaseCommand, VALID.release, [
    ['a non-boolean keepRetained', { keepRetained: 'true' }],
    ['missing task ids', { taskIds: undefined }],
  ]);
});

describe('isOffFetchJsonCommand', () => {
  expectAccepts(isOffFetchJsonCommand, VALID.offFetchJson, [['credentials: include', {}]]);
  expectRejects(isOffFetchJsonCommand, VALID.offFetchJson, [
    ['credentials: omit', { credentials: 'omit' }],
    ['missing credentials', { credentials: undefined }],
    ['a bytes URL', { url: ORIGINAL }],
  ]);
});

describe('isOffProbeCommand', () => {
  expectAccepts(isOffProbeCommand, VALID.probe, [
    ['1920×1080', {}],
    ['an odd size', { width: 601, height: 451 }],
  ]);
  expectRejects(isOffProbeCommand, VALID.probe, [
    ['a zero height', { height: 0 }],
    ['a width over 16384', { width: 20000 }],
    ['a missing width', { width: undefined }],
  ]);
});

describe('isOffTasksCommand', () => {
  expectAccepts(isOffTasksCommand, VALID.tasks, [['an empty payload', {}]]);
  expectRejects(isOffTasksCommand, VALID.tasks, [
    ['another target', { target: 'sw' }],
    ['another type', { type: 'off/task' }],
  ]);
});

describe('isOffReadyEvent', () => {
  expectAccepts(isOffReadyEvent, VALID.ready, [
    ['a blob URL and size', {}],
    ['a zip kept without a blob URL', { blobUrl: undefined, size: undefined }],
  ]);
  expectRejects(isOffReadyEvent, VALID.ready, [
    ['a non-blob URL', { blobUrl: ORIGINAL }],
    ['a negative size', { size: -1 }],
    ['a missing task id', { taskId: undefined }],
    ['another target', { target: 'offscreen' }],
  ]);
});

describe('isOffFailedEvent', () => {
  expectAccepts(isOffFailedEvent, VALID.failed, [
    ['an http failure', {}],
    ['an encode failure with detail', { failure: { kind: 'encode', detail: 'zip', attempts: 1 } }],
    ['an aborted failure with 0 attempts', { failure: { kind: 'aborted', attempts: 0 } }],
    ['an internal failure', { failure: { kind: 'internal', detail: 'exception', attempts: 1 } }],
    [
      'a network failure with lastStatus',
      { failure: { kind: 'network', lastStatus: 503, attempts: 4 } },
    ],
    [
      'a timeout failure with lastStatus',
      { failure: { kind: 'timeout', lastStatus: 429, attempts: 4 } },
    ],
  ]);
  expectRejects(isOffFailedEvent, VALID.failed, [
    ['an unknown failure kind', { failure: { kind: 'oops', attempts: 1 } }],
    ['missing attempts', { failure: { kind: 'network' } }],
    ['a string status', { failure: { kind: 'http', status: '503', attempts: 1 } }],
    ['a fractional lastStatus', { failure: { kind: 'network', lastStatus: 503.5, attempts: 4 } }],
    ['a string lastStatus', { failure: { kind: 'network', lastStatus: '503', attempts: 4 } }],
    ['a negative lastStatus', { failure: { kind: 'network', lastStatus: -1, attempts: 4 } }],
    ['a numeric detail', { failure: { kind: 'encode', detail: 3, attempts: 1 } }],
    ['a null failure', { failure: null }],
  ]);
});

describe('isOffProgressEvent', () => {
  expectAccepts(isOffProgressEvent, VALID.progressZip, [
    ['zip progress with a total', {}],
    ['zip progress without Content-Length', { total: null }],
  ]);
  expectAccepts(isOffProgressEvent, VALID.progressEncode, [['encode progress', {}]]);
  expectRejects(isOffProgressEvent, VALID.progressZip, [
    ['an unknown phase', { phase: 'video' }],
    ['a missing zip total', { total: undefined }],
    ['a fractional loaded', { loaded: 1.5 }],
  ]);
  expectRejects(isOffProgressEvent, VALID.progressEncode, [
    ['a negative done', { done: -1 }],
    ['a missing encode total', { total: undefined }],
  ]);
});

describe('direction guards', () => {
  const CONTENT_TO_SW = [
    VALID.startFull,
    VALID.startRetryPages,
    VALID.startRetryEncode,
    VALID.startRetryMetadata,
    VALID.cancel,
    VALID.listForTab,
    VALID.capsGet,
  ];
  const OFFSCREEN_TO_SW = [VALID.ready, VALID.failed, VALID.progressZip, VALID.progressEncode];
  const SW_TO_TAB = [VALID.jobUpdate, VALID.apiFetchJson];
  const SW_TO_OFFSCREEN = [
    VALID.fetchBytes,
    VALID.makeText,
    VALID.fetchZip,
    VALID.encode,
    VALID.abort,
    VALID.release,
    VALID.offFetchJson,
    VALID.probe,
    VALID.tasks,
  ];
  const DIRECTIONS: Array<[string, Guard, object[]]> = [
    ['isContentToSwMessage', isContentToSwMessage, CONTENT_TO_SW],
    ['isOffscreenToSwEvent', isOffscreenToSwEvent, OFFSCREEN_TO_SW],
    ['isSwToTabMessage', isSwToTabMessage, SW_TO_TAB],
    ['isSwToOffscreenMessage', isSwToOffscreenMessage, SW_TO_OFFSCREEN],
  ];
  const ALL = [...CONTENT_TO_SW, ...OFFSCREEN_TO_SW, ...SW_TO_TAB, ...SW_TO_OFFSCREEN];

  it.each(DIRECTIONS)('%s: accepts exactly its own messages', (_name, guard, own) => {
    expect(ALL.filter((m) => guard(m))).toEqual(own);
  });

  it.each(DIRECTIONS)('%s: rejects a malformed payload of its own type', (_name, guard, own) => {
    const [first] = own;
    expect(guard({ ...first, target: undefined })).toBe(false);
  });

  it.each(DIRECTIONS)('%s: rejects an unknown type', (_name, guard, own) => {
    const [first] = own;
    expect(guard({ ...first, type: 'toString' })).toBe(false);
  });

  it('isContentToSwMessage: rejects a job/start with a bad artwork id', () => {
    expect(isContentToSwMessage({ ...VALID.startFull, artworkId: '../1' })).toBe(false);
  });
});

describe('sender checks', () => {
  const tab = { id: 7 } as chrome.tabs.Tab;

  it('isContentScriptSender: accepts a tab of this extension', () => {
    expect(isContentScriptSender({ id: EXT_ID, tab, frameId: 0 }, EXT_ID)).toBe(true);
  });

  it.each([
    ['no tab', { id: EXT_ID }],
    ['a tab without an id', { id: EXT_ID, tab: {} as chrome.tabs.Tab }],
    ['another extension', { id: 'otherextension', tab }],
    ['no extension id', { tab }],
  ])('isContentScriptSender: rejects %s', (_label, sender) => {
    expect(isContentScriptSender(sender, EXT_ID)).toBe(false);
  });

  it('isContentScriptSender: defaults to chrome.runtime.id', () => {
    vi.stubGlobal('chrome', { runtime: { id: EXT_ID } });
    expect(isContentScriptSender({ id: EXT_ID, tab })).toBe(true);
  });

  it('isOffscreenSender: accepts the offscreen document URL', () => {
    expect(isOffscreenSender({ id: EXT_ID, url: OFFSCREEN_URL }, OFFSCREEN_URL)).toBe(true);
  });

  it.each([
    ['another extension page', { id: EXT_ID, url: `chrome-extension://${EXT_ID}/options.html` }],
    ['a content script', { id: EXT_ID, url: 'https://www.pixiv.net/artworks/1', tab }],
    ['no URL', { id: EXT_ID }],
  ])('isOffscreenSender: rejects %s', (_label, sender) => {
    expect(isOffscreenSender(sender, OFFSCREEN_URL)).toBe(false);
  });

  it('isOffscreenSender: defaults to chrome.runtime.getURL("offscreen.html")', () => {
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => `chrome-extension://${EXT_ID}/${path}` },
    });
    expect(isOffscreenSender({ id: EXT_ID, url: OFFSCREEN_URL })).toBe(true);
  });

  it('isNonTabSender: accepts a sender without a tab (the SW)', () => {
    expect(isNonTabSender({ id: EXT_ID, url: `chrome-extension://${EXT_ID}/sw.js` })).toBe(true);
  });

  it('isNonTabSender: rejects a sender with a tab', () => {
    expect(isNonTabSender({ id: EXT_ID, tab })).toBe(false);
  });
});
