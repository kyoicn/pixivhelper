import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EncodeError,
  encodeUgoira,
  mimeFromExt,
  type EncodeUgoiraOptions,
} from '../../../src/offscreen/ugoira/encode';

// ── mediabunny fake: records what the pipeline hands to the muxer/encoder ──

const mb = vi.hoisted(() => {
  interface Frame {
    content: string;
    init: { timestamp: number; duration: number };
    close(): void;
  }

  const state = {
    outputs: [] as FakeOutput[],
    sources: [] as FakeSource[],
    /** Event order across decode and add(), to prove one frame in flight. */
    events: [] as string[],
    /** Throw from add() for this (attempt, frame index); attempt = 0-based source index. */
    failAdd: (() => false) as (attempt: number, index: number) => boolean,
    failFinalize: (() => false) as (attempt: number) => boolean,
    finalBytes: new Uint8Array([0x66, 0x74, 0x79, 0x70]),
  };

  class FakeQuality {
    constructor(readonly level: string) {}
  }
  class FakeBufferTarget {
    buffer: ArrayBuffer | null = null;
  }
  class FakeMp4OutputFormat {
    readonly kind = 'mp4';
    constructor(readonly options?: unknown) {}
  }
  class FakeWebMOutputFormat {
    readonly kind = 'webm';
    constructor(readonly options?: unknown) {}
  }
  class FakeVideoSample {
    closed = false;
    constructor(readonly frame: Frame) {}
    close(): void {
      this.closed = true;
      this.frame.close();
    }
  }
  class FakeSource {
    readonly attempt: number;
    readonly added: Array<{ sample: FakeVideoSample; options: unknown }> = [];
    closed = false;
    constructor(readonly config: Record<string, unknown>) {
      this.attempt = state.sources.length;
      state.sources.push(this);
    }
    async add(sample: FakeVideoSample, options?: unknown): Promise<void> {
      const index = this.added.length;
      this.added.push({ sample, options });
      state.events.push(`add-start ${index}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (state.failAdd(this.attempt, index)) throw new Error('EncodingError: encoder crashed');
      state.events.push(`add-end ${index}`);
    }
    close(): void {
      this.closed = true;
    }
  }
  class FakeOutput {
    state = 'pending';
    readonly attempt: number;
    readonly tracks: Array<{ source: FakeSource; metadata: unknown }> = [];
    readonly format: unknown;
    readonly target: FakeBufferTarget;
    readonly finalize = vi.fn(() => {
      if (state.failFinalize(this.attempt)) return Promise.reject(new Error('muxer failed'));
      this.state = 'finalized';
      this.target.buffer = state.finalBytes.slice().buffer;
      return Promise.resolve();
    });
    readonly cancel = vi.fn(() => {
      this.state = 'canceled';
      return Promise.resolve();
    });
    constructor(options: { format: unknown; target: FakeBufferTarget }) {
      this.attempt = state.outputs.length;
      this.format = options.format;
      this.target = options.target;
      state.outputs.push(this);
    }
    addVideoTrack(source: FakeSource, metadata: unknown): void {
      this.tracks.push({ source, metadata });
    }
    start(): Promise<void> {
      this.state = 'started';
      return Promise.resolve();
    }
  }

  return {
    state,
    FakeQuality,
    FakeBufferTarget,
    FakeMp4OutputFormat,
    FakeWebMOutputFormat,
    FakeVideoSample,
    FakeSource,
    FakeOutput,
  };
});

vi.mock('mediabunny', () => ({
  Quality: mb.FakeQuality,
  canEncodeVideo: vi.fn(),
  BufferTarget: mb.FakeBufferTarget,
  Mp4OutputFormat: mb.FakeMp4OutputFormat,
  WebMOutputFormat: mb.FakeWebMOutputFormat,
  VideoSample: mb.FakeVideoSample,
  VideoSampleSource: mb.FakeSource,
  Output: mb.FakeOutput,
}));

// ── Browser globals the offscreen document has and Node lacks ──

interface FakeBitmap {
  width: number;
  height: number;
  content: string;
  close: ReturnType<typeof vi.fn>;
}

const browser = {
  bitmapSize: { width: 600, height: 600 },
  bitmaps: [] as FakeBitmap[],
  blobTypes: [] as string[],
  canvases: [] as FakeCanvas[],
  videoFrames: [] as FakeVideoFrame[],
  failDecode: (() => false) as (content: string) => boolean,
};

class FakeContext {
  drawn = '';
  readonly clearRect = vi.fn();
  readonly drawImage = vi.fn((bitmap: FakeBitmap, x: number, y: number) => {
    this.drawn = `${bitmap.content}@${x},${y}`;
  });
  constructor(readonly canvas: FakeCanvas) {}
}

class FakeCanvas {
  contextArgs: unknown[] = [];
  readonly ctx = new FakeContext(this);
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    browser.canvases.push(this);
  }
  getContext(...args: unknown[]): FakeContext {
    this.contextArgs = args;
    return this.ctx;
  }
}

class FakeVideoFrame {
  readonly content: string;
  closed = false;
  constructor(
    canvas: FakeCanvas,
    readonly init: { timestamp: number; duration: number },
  ) {
    this.content = canvas.ctx.drawn;
    browser.videoFrames.push(this);
  }
  close(): void {
    this.closed = true;
  }
}

async function fakeCreateImageBitmap(blob: Blob): Promise<FakeBitmap> {
  const content = await blob.text();
  browser.blobTypes.push(blob.type);
  mb.state.events.push(`decode ${content}`);
  if (browser.failDecode(content)) throw new DOMException('decode failed', 'InvalidStateError');
  const bitmap = { ...browser.bitmapSize, content, close: vi.fn() };
  browser.bitmaps.push(bitmap);
  return bitmap;
}

// ── Fixtures ──

const FRAMES = [
  { file: '000000.jpg', delay: 40 },
  { file: '000001.jpg', delay: 40 },
  { file: '000002.jpg', delay: 500 },
  { file: '000003.jpg', delay: 40 },
];

/** Each entry's bytes are its own name, so a decoded frame reveals which entry it came from. */
function zipOf(names: string[]): Uint8Array {
  return zipSync(Object.fromEntries(names.map((name) => [name, strToU8(name)])));
}

function options(overrides: Partial<EncodeUgoiraOptions> = {}): EncodeUgoiraOptions {
  return {
    zip: zipOf(FRAMES.map((f) => f.file)),
    frames: FRAMES,
    format: 'mp4',
    avcCodec: 'avc1.64001e',
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

function firstOutput(): InstanceType<typeof mb.FakeOutput> {
  const output = mb.state.outputs[0];
  if (!output) throw new Error('no Output was created');
  return output;
}

function firstSource(): InstanceType<typeof mb.FakeSource> {
  const source = mb.state.sources[0];
  if (!source) throw new Error('no VideoSampleSource was created');
  return source;
}

beforeEach(() => {
  mb.state.outputs.length = 0;
  mb.state.sources.length = 0;
  mb.state.events.length = 0;
  mb.state.failAdd = () => false;
  mb.state.failFinalize = () => false;
  browser.bitmapSize = { width: 600, height: 600 };
  browser.bitmaps.length = 0;
  browser.blobTypes.length = 0;
  browser.canvases.length = 0;
  browser.videoFrames.length = 0;
  browser.failDecode = () => false;
  vi.stubGlobal('createImageBitmap', fakeCreateImageBitmap);
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.stubGlobal('VideoFrame', FakeVideoFrame);
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('encodeUgoira: timing and frames', () => {
  it('encodeUgoira: passes integer-µs timestamps per sample (40/40/500/40 → 0/40/80/580 ms)', async () => {
    await encodeUgoira(options());
    expect(browser.videoFrames.map((f) => f.init.timestamp)).toEqual([0, 40_000, 80_000, 580_000]);
  });

  it('encodeUgoira: passes integer-µs durations per sample', async () => {
    await encodeUgoira(options());
    expect(browser.videoFrames.map((f) => f.init.duration)).toEqual([
      40_000, 40_000, 500_000, 40_000,
    ]);
  });

  it('encodeUgoira: forces a key frame on the first sample only', async () => {
    await encodeUgoira(options());
    expect(firstSource().added.map((a) => a.options)).toEqual([
      { keyFrame: true },
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('encodeUgoira: looks frames up by name in frames.json order, not zip order', async () => {
    const zip = zipOf(['000003.jpg', '000001.jpg', '000002.jpg', '000000.jpg']);
    await encodeUgoira(options({ zip }));
    expect(browser.videoFrames.map((f) => f.content)).toEqual(FRAMES.map((f) => `${f.file}@0,0`));
  });

  it('encodeUgoira: decodes the next frame only after the previous add() resolved', async () => {
    await encodeUgoira(options({ frames: FRAMES.slice(0, 3) }));
    expect(mb.state.events).toEqual([
      'decode 000000.jpg',
      'add-start 0',
      'add-end 0',
      'decode 000001.jpg',
      'add-start 1',
      'add-end 1',
      'decode 000002.jpg',
      'add-start 2',
      'add-end 2',
    ]);
  });

  it('encodeUgoira: closes every decoded bitmap', async () => {
    await encodeUgoira(options());
    expect(browser.bitmaps.every((b) => b.close.mock.calls.length === 1)).toBe(true);
  });

  it('encodeUgoira: closes every sample (and with it its VideoFrame)', async () => {
    await encodeUgoira(options());
    expect(browser.videoFrames.every((f) => f.closed)).toBe(true);
  });

  it('encodeUgoira: decodes with the MIME type of the frame extension', async () => {
    await encodeUgoira(options());
    expect(browser.blobTypes).toEqual(['image/jpeg', 'image/jpeg', 'image/jpeg', 'image/jpeg']);
  });

  it('encodeUgoira: reports progress after each add() resolves', async () => {
    const onProgress = vi.fn();
    await encodeUgoira(options({ onProgress }));
    expect(onProgress.mock.calls).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  it('encodeUgoira: closes the source before finalizing', async () => {
    await encodeUgoira(options());
    expect(firstSource().closed).toBe(true);
  });
});

describe('encodeUgoira: canvas', () => {
  it('encodeUgoira: crops a 601×451 frame to a 600×450 canvas', async () => {
    browser.bitmapSize = { width: 601, height: 451 };
    await encodeUgoira(options());
    expect(browser.canvases.map((c) => [c.width, c.height])).toEqual([[600, 450]]);
  });

  it('encodeUgoira: draws on an opaque 2d context (alpha: false)', async () => {
    await encodeUgoira(options());
    expect(browser.canvases[0]?.contextArgs).toEqual(['2d', { alpha: false }]);
  });

  it('encodeUgoira: clears the canvas before drawing each frame', async () => {
    await encodeUgoira(options());
    expect(browser.canvases[0]?.ctx.clearRect.mock.calls).toEqual(
      FRAMES.map(() => [0, 0, 600, 600]),
    );
  });
});

describe('encodeUgoira: MP4', () => {
  it('encodeUgoira: MP4 output uses fastStart in-memory', async () => {
    await encodeUgoira(options());
    expect(firstOutput().format).toEqual(new mb.FakeMp4OutputFormat({ fastStart: 'in-memory' }));
  });

  it('encodeUgoira: MP4 track declares frameRate 1000 (1 ms timescale)', async () => {
    await encodeUgoira(options());
    expect(firstOutput().tracks[0]?.metadata).toEqual({ frameRate: 1000 });
  });

  it('encodeUgoira: MP4 encodes avc with the probed codec string, very-high quality and 2 s key frames', async () => {
    await encodeUgoira(options());
    expect(firstSource().config).toMatchObject({
      codec: 'avc',
      fullCodecString: 'avc1.64001e',
      quality: new mb.FakeQuality('very-high'),
      keyFrameInterval: 2,
      latencyMode: 'quality',
    });
  });

  it('encodeUgoira: MP4 without a probed codec string lets mediabunny choose', async () => {
    await encodeUgoira(options({ avcCodec: null }));
    expect(firstSource().config).not.toHaveProperty('fullCodecString');
  });

  it('encodeUgoira: MP4 resolves with a video/mp4 Blob of the finalized buffer', async () => {
    const blob = await encodeUgoira(options());
    expect([blob.type, new Uint8Array(await blob.arrayBuffer())]).toEqual([
      'video/mp4',
      mb.state.finalBytes,
    ]);
  });
});

describe('encodeUgoira: WebM', () => {
  it('encodeUgoira: WebM output uses the WebM format', async () => {
    await encodeUgoira(options({ format: 'webm' }));
    expect(firstOutput().format).toBeInstanceOf(mb.FakeWebMOutputFormat);
  });

  it('encodeUgoira: WebM track declares no frameRate', async () => {
    await encodeUgoira(options({ format: 'webm' }));
    expect(firstOutput().tracks[0]?.metadata).toEqual({});
  });

  it('encodeUgoira: WebM encodes vp9 without the avc codec string', async () => {
    await encodeUgoira(options({ format: 'webm' }));
    expect([firstSource().config.codec, firstSource().config.fullCodecString]).toEqual([
      'vp9',
      undefined,
    ]);
  });

  it('encodeUgoira: WebM resolves with a video/webm Blob', async () => {
    const blob = await encodeUgoira(options({ format: 'webm' }));
    expect(blob.type).toBe('video/webm');
  });
});

describe('encodeUgoira: abort', () => {
  function abortAfterFirstFrame(): EncodeUgoiraOptions {
    const controller = new AbortController();
    return options({
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 1) controller.abort();
      },
    });
  }

  it('encodeUgoira: abort between frames cancels the output', async () => {
    await failureOf(encodeUgoira(abortAfterFirstFrame()));
    expect(firstOutput().cancel).toHaveBeenCalledTimes(1);
  });

  it('encodeUgoira: abort rejects with the abort reason instead of a Blob', async () => {
    const error = await failureOf(encodeUgoira(abortAfterFirstFrame()));
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('encodeUgoira: abort stops feeding frames and never finalizes', async () => {
    await failureOf(encodeUgoira(abortAfterFirstFrame()));
    expect([firstSource().added.length, firstOutput().finalize.mock.calls.length]).toEqual([1, 0]);
  });

  it('encodeUgoira: abort is not retried', async () => {
    await failureOf(encodeUgoira(abortAfterFirstFrame()));
    expect(mb.state.sources).toHaveLength(1);
  });

  it('encodeUgoira: an already-aborted signal decodes nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    await failureOf(encodeUgoira(options({ signal: controller.signal })));
    expect(browser.bitmaps).toHaveLength(0);
  });

  it('encodeUgoira: abort during finalize still yields no Blob', async () => {
    const controller = new AbortController();
    mb.state.failFinalize = () => {
      controller.abort();
      return false;
    };
    const error = await failureOf(encodeUgoira(options({ signal: controller.signal })));
    expect(error).toMatchObject({ name: 'AbortError' });
  });
});

describe('encodeUgoira: software retry', () => {
  it('encodeUgoira: the first attempt has no hardware preference', async () => {
    await encodeUgoira(options());
    expect(firstSource().config.hardwareAcceleration).toBe('no-preference');
  });

  it('encodeUgoira: an encoder failure is retried with prefer-software', async () => {
    mb.state.failAdd = (attempt, index) => attempt === 0 && index === 2;
    await encodeUgoira(options());
    expect(mb.state.sources.map((s) => s.config.hardwareAcceleration)).toEqual([
      'no-preference',
      'prefer-software',
    ]);
  });

  it('encodeUgoira: the failed attempt is cancelled before the retry', async () => {
    mb.state.failAdd = (attempt) => attempt === 0;
    await encodeUgoira(options());
    expect(mb.state.outputs.map((o) => o.cancel.mock.calls.length)).toEqual([1, 0]);
  });

  it('encodeUgoira: the retry re-encodes every frame from the start', async () => {
    mb.state.failAdd = (attempt, index) => attempt === 0 && index === 2;
    await encodeUgoira(options());
    expect(mb.state.sources[1]?.added.map((a) => a.options)).toEqual([
      { keyFrame: true },
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('encodeUgoira: the software retry resolves with the video', async () => {
    mb.state.failAdd = (attempt) => attempt === 0;
    const blob = await encodeUgoira(options());
    expect(blob.type).toBe('video/mp4');
  });

  it('encodeUgoira: a finalize failure is retried too', async () => {
    mb.state.failFinalize = (attempt) => attempt === 0;
    await encodeUgoira(options());
    expect(mb.state.sources).toHaveLength(2);
  });

  it('encodeUgoira: a second encoder failure rejects with detail "encoder"', async () => {
    mb.state.failAdd = () => true;
    const error = await failureOf(encodeUgoira(options()));
    expect(error).toMatchObject({ name: 'EncodeError', detail: 'encoder' });
  });

  it('encodeUgoira: retries only once', async () => {
    mb.state.failAdd = () => true;
    await failureOf(encodeUgoira(options()));
    expect(mb.state.sources).toHaveLength(2);
  });

  it('encodeUgoira: a missing 2d context is an encoder failure', async () => {
    vi.spyOn(FakeCanvas.prototype, 'getContext').mockReturnValue(null as unknown as FakeContext);
    const error = await failureOf(encodeUgoira(options()));
    expect(error).toMatchObject({ detail: 'encoder' });
  });
});

describe('encodeUgoira: input failures', () => {
  it('encodeUgoira: no retained zip rejects with detail "no-zip"', async () => {
    const error = await failureOf(encodeUgoira(options({ zip: undefined })));
    expect(error).toMatchObject({ detail: 'no-zip' });
  });

  it('encodeUgoira: empty frames reject with detail "bad-frames"', async () => {
    const error = await failureOf(encodeUgoira(options({ frames: [] })));
    expect(error).toMatchObject({ detail: 'bad-frames' });
  });

  it('encodeUgoira: a zero delay rejects with detail "bad-frames"', async () => {
    const frames = [{ file: '000000.jpg', delay: 0 }];
    const error = await failureOf(encodeUgoira(options({ frames })));
    expect(error).toMatchObject({ detail: 'bad-frames' });
  });

  it('encodeUgoira: rejects with an EncodeError', async () => {
    const error = await failureOf(encodeUgoira(options({ zip: undefined })));
    expect(error).toBeInstanceOf(EncodeError);
  });

  it('encodeUgoira: a frame missing from the zip rejects with detail "zip"', async () => {
    const zip = zipOf(['000000.jpg', '000001.jpg', '000003.jpg']);
    const error = await failureOf(encodeUgoira(options({ zip })));
    expect(error).toMatchObject({ detail: 'zip' });
  });

  it('encodeUgoira: a zip failure is not retried', async () => {
    const zip = zipOf(['000000.jpg', '000001.jpg', '000003.jpg']);
    await failureOf(encodeUgoira(options({ zip })));
    expect(mb.state.sources).toHaveLength(1);
  });

  it('encodeUgoira: a zip failure mid-encode cancels the output', async () => {
    const zip = zipOf(['000000.jpg', '000001.jpg', '000003.jpg']);
    await failureOf(encodeUgoira(options({ zip })));
    expect(firstOutput().cancel).toHaveBeenCalledTimes(1);
  });

  it('encodeUgoira: bytes that are not a zip reject with detail "zip"', async () => {
    const error = await failureOf(encodeUgoira(options({ zip: strToU8('not a zip') })));
    expect(error).toMatchObject({ detail: 'zip' });
  });

  it('encodeUgoira: an undecodable frame rejects with detail "zip"', async () => {
    browser.failDecode = (content) => content === '000001.jpg';
    const error = await failureOf(encodeUgoira(options()));
    expect(error).toMatchObject({ detail: 'zip' });
  });

  it('encodeUgoira: a frame under 2×2 pixels rejects with detail "zip"', async () => {
    browser.bitmapSize = { width: 1, height: 600 };
    const error = await failureOf(encodeUgoira(options()));
    expect(error).toMatchObject({ detail: 'zip' });
  });

  it('encodeUgoira: the bitmap of a rejected first frame is closed', async () => {
    browser.bitmapSize = { width: 1, height: 600 };
    await failureOf(encodeUgoira(options()));
    expect(browser.bitmaps[0]?.close).toHaveBeenCalledTimes(1);
  });
});

describe('mimeFromExt', () => {
  it.each([
    ['000000.jpg', 'image/jpeg'],
    ['000000.JPEG', 'image/jpeg'],
    ['000000.png', 'image/png'],
    ['000000.gif', 'image/gif'],
    ['000000.webp', 'image/webp'],
    ['000000.bmp', ''],
    ['000000', ''],
    ['000000.constructor', ''],
  ])('mimeFromExt: %s → "%s"', (file, expected) => {
    expect(mimeFromExt(file)).toBe(expected);
  });
});
