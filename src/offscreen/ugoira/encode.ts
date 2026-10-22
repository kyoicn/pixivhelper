// Ugoira zip → MP4 (H.264) or WebM (VP9) with exact per-frame timing (design-offscreen-worker.md
// "Ugoira encode", "Memory budget"). One decoded frame is alive at a time: it is extracted, drawn,
// handed to the encoder and closed before the next entry is read from the retained zip.

import {
  BufferTarget,
  Mp4OutputFormat,
  Output,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
  type VideoEncodingConfig,
  type VideoTrackMetadata,
} from 'mediabunny';
import { createLogger } from '../../shared/log';
import type { OffEncodeCommand } from '../../shared/messages';
import { MIN_SIDE_PX, QUALITY, even } from './codec';
import { buildTimeline, isValidFrames, type UgoiraFrames } from './timeline';
import { extractEntry } from './zip';

const log = createLogger('offscreen');

/** Becomes `Failure.detail` of the `encode` failure the offscreen task reports. */
export type EncodeFailureDetail = 'no-zip' | 'bad-frames' | 'zip' | 'encoder';

export class EncodeError extends Error {
  readonly detail: EncodeFailureDetail;

  constructor(detail: EncodeFailureDetail, options?: ErrorOptions) {
    super(`ugoira encode failed: ${detail}`, options);
    this.name = 'EncodeError';
    this.detail = detail;
  }
}

export interface EncodeUgoiraOptions {
  /** The zip task's retained bytes; `undefined` when it holds none. */
  zip: Uint8Array | undefined;
  frames: UgoiraFrames;
  format: OffEncodeCommand['format'];
  /** Probed H.264 codec string; mediabunny picks one when null. Ignored for WebM. */
  avcCodec: string | null;
  signal: AbortSignal;
  /** Called each time a frame's `add()` resolves; `done` counts those frames. */
  onProgress?: (done: number, total: number) => void;
}

type HardwareAcceleration = NonNullable<VideoEncodingConfig['hardwareAcceleration']>;

interface VideoTrack {
  ctx: OffscreenCanvasRenderingContext2D;
  source: VideoSampleSource;
  width: number;
  height: number;
}

/** MP4 track timescale: snaps timestamps to a 1 ms grid, so every ms delay is exact. */
const MP4_FRAME_RATE = 1000;
const KEY_FRAME_INTERVAL_S = 2;

const MIME_BY_EXT = new Map([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
]);

/** The image type for a frame file name; '' for unknown extensions, which the decoder sniffs. */
export function mimeFromExt(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot < 0 ? '' : (MIME_BY_EXT.get(file.slice(dot + 1).toLowerCase()) ?? '');
}

/**
 * Encodes the ugoira named by `frames` (looked up by file name in `zip`). Resolves with the finished
 * video only after the muxer finalized. An encoder failure is retried once with
 * `hardwareAcceleration: 'prefer-software'`; every failure rejects with an {@link EncodeError}.
 * After an abort it rejects with the signal's reason and never resolves with a Blob.
 */
export async function encodeUgoira(options: EncodeUgoiraOptions): Promise<Blob> {
  const { zip, frames, signal } = options;
  try {
    if (!zip) throw new EncodeError('no-zip');
    if (!isValidFrames(frames)) throw new EncodeError('bad-frames');
    const job: EncodeJob = { ...options, zip };
    try {
      return await encodeOnce(job, 'no-preference');
    } catch (error) {
      if (signal.aborted || error instanceof EncodeError) throw error;
      log.warn('encoder failed, retrying with prefer-software:', error);
      return await encodeOnce(job, 'prefer-software');
    }
  } catch (error) {
    signal.throwIfAborted();
    const failure =
      error instanceof EncodeError ? error : new EncodeError('encoder', { cause: error });
    log.error(failure);
    throw failure;
  }
}

type EncodeJob = EncodeUgoiraOptions & { zip: Uint8Array };

async function encodeOnce(
  job: EncodeJob,
  hardwareAcceleration: HardwareAcceleration,
): Promise<Blob> {
  const { zip, format, avcCodec, signal, onProgress } = job;
  const { frames } = buildTimeline(job.frames);
  const startedAt = performance.now();
  let encoderConfig: VideoEncoderConfig | undefined;
  const encoding: VideoEncodingConfig = {
    codec: format === 'mp4' ? 'avc' : 'vp9',
    quality: QUALITY,
    keyFrameInterval: KEY_FRAME_INTERVAL_S,
    latencyMode: 'quality',
    hardwareAcceleration,
    ...(format === 'mp4' && avcCodec ? { fullCodecString: avcCodec } : {}),
    onEncoderConfig: (config) => {
      encoderConfig = config;
    },
  };
  // WebM's native 1 ms TimestampScale is already exact; a frameRate would also write a misleading
  // DefaultDuration.
  const metadata: VideoTrackMetadata = format === 'mp4' ? { frameRate: MP4_FRAME_RATE } : {};
  const output = new Output({
    format:
      format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });

  let track: VideoTrack | undefined;
  let bitmap: ImageBitmap | undefined;
  try {
    for (const [i, frame] of frames.entries()) {
      signal.throwIfAborted();
      bitmap = await decodeFrame(zip, frame.file);
      track ??= await openTrack(output, encoding, metadata, bitmap);
      // Clearing gives every frame the same opaque black backdrop, so a transparent or smaller frame
      // never shows the previous one through.
      track.ctx.clearRect(0, 0, track.width, track.height);
      track.ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      bitmap = undefined;
      const sample = new VideoSample(
        new VideoFrame(track.ctx.canvas, {
          timestamp: frame.timestampUs,
          duration: frame.durationUs,
        }),
      );
      try {
        await track.source.add(sample, i === 0 ? { keyFrame: true } : undefined);
      } finally {
        sample.close();
      }
      onProgress?.(i + 1, frames.length);
    }
    signal.throwIfAborted();
    track?.source.close();
    await output.finalize();
  } catch (error) {
    bitmap?.close();
    await output.cancel();
    throw error;
  }
  signal.throwIfAborted();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error('finalized output has no buffer');
  log.info(
    `encoded ${encoderConfig?.codec ?? format} (${encoderConfig?.hardwareAcceleration ?? hardwareAcceleration})`,
    `${track?.width}x${track?.height}, ${frames.length} frames,`,
    `${Math.round(performance.now() - startedAt)} ms, ${buffer.byteLength} bytes`,
  );
  return new Blob([buffer], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' });
}

/** Missing, encrypted and undecodable entries are all a bad zip, which a software retry cannot fix. */
async function decodeFrame(zip: Uint8Array, file: string): Promise<ImageBitmap> {
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    bytes = extractEntry(zip, file);
  } catch (cause) {
    throw new EncodeError('zip', { cause });
  }
  if (!bytes) throw new EncodeError('zip', { cause: new Error(`no zip entry ${file}`) });
  try {
    return await createImageBitmap(new Blob([bytes], { type: mimeFromExt(file) }));
  } catch (cause) {
    throw new EncodeError('zip', { cause });
  }
}

/**
 * Sizes the video from the first decoded frame. Odd sizes are cropped to even: drawing at (0, 0) on
 * the smaller canvas drops the last column/row instead of resampling the whole frame.
 */
async function openTrack(
  output: Output,
  encoding: VideoEncodingConfig,
  metadata: VideoTrackMetadata,
  firstFrame: ImageBitmap,
): Promise<VideoTrack> {
  const width = even(firstFrame.width);
  const height = even(firstFrame.height);
  if (width < MIN_SIDE_PX || height < MIN_SIDE_PX) {
    throw new EncodeError('zip', { cause: new Error(`frame too small: ${width}x${height}`) });
  }
  const ctx = new OffscreenCanvas(width, height).getContext('2d', { alpha: false });
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  const source = new VideoSampleSource(encoding);
  output.addVideoTrack(source, metadata);
  await output.start();
  return { ctx, source, width, height };
}
