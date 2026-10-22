// ffprobe/ffmpeg helpers for ugoira video checks. Both tools are optional: a check that needs a
// missing tool skips the calling test with a clear reason instead of failing it.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from '@playwright/test';

export type MediaTool = 'ffprobe' | 'ffmpeg';

export interface FfprobeStream {
  index: number;
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  nb_frames?: string;
  duration?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
}

export interface FfprobeFrame {
  media_type: string;
  stream_index: number;
  key_frame?: number;
  pts_time?: string;
  best_effort_timestamp_time?: string;
  /** Per-frame duration in seconds; ffprobe ≥ 6 reports `duration_time`, older ones `pkt_duration_time`. */
  duration_time?: string;
  pkt_duration_time?: string;
  width?: number;
  height?: number;
}

export interface FfprobeResult {
  streams: FfprobeStream[];
  frames: FfprobeFrame[];
}

export interface SsimResult {
  /** Per-frame SSIM ("All" channel), in frame order. */
  perFrame: number[];
  mean: number;
  min: number;
}

const available = new Map<MediaTool, boolean>();

export function hasMediaTool(tool: MediaTool): boolean {
  let present = available.get(tool);
  if (present === undefined) {
    present = spawnSync(tool, ['-version'], { stdio: 'ignore' }).status === 0;
    available.set(tool, present);
  }
  return present;
}

/** Skips the current test when `tool` is not on PATH. */
export function requireMediaTool(tool: MediaTool): void {
  test.skip(!hasMediaTool(tool), `${tool} is not installed (not on PATH); this check is skipped`);
}

function run(command: MediaTool, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

/** `ffprobe -v error -show_frames -show_streams -of json <file>`. Skips the test without ffprobe. */
export async function ffprobe(file: string): Promise<FfprobeResult> {
  requireMediaTool('ffprobe');
  const output = await run('ffprobe', [
    '-v',
    'error',
    '-show_frames',
    '-show_streams',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(output) as Partial<FfprobeResult>;
  return { streams: parsed.streams ?? [], frames: parsed.frames ?? [] };
}

/**
 * Per-frame SSIM of `video` against the source frames (image files, in order), each source cropped
 * to even dimensions from the top-left as the encoder does. Frames are paired by index, not by
 * timestamp, so variable frame durations do not matter. Skips the test without ffmpeg.
 */
export async function ssim(video: string, frames: readonly string[]): Promise<SsimResult> {
  requireMediaTool('ffmpeg');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hfp-ssim-'));
  try {
    const list = path.join(dir, 'frames.txt');
    const stats = path.join(dir, 'ssim.log');
    const quote = (file: string) => `'${path.resolve(file).replace(/'/g, "'\\''")}'`;
    await writeFile(
      list,
      `ffconcat version 1.0\n${frames.map((f) => `file ${quote(f)}`).join('\n')}\n`,
    );
    const graph = [
      '[0:v]setpts=N/(25*TB),format=yuv420p[video]',
      '[1:v]crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0,setpts=N/(25*TB),format=yuv420p[source]',
      `[video][source]ssim=shortest=1:stats_file=${stats.replace(/([\\:'])/g, '\\$1')}`,
    ].join(';');
    await run('ffmpeg', [
      '-v',
      'error',
      '-nostdin',
      '-i',
      video,
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-filter_complex',
      graph,
      '-fps_mode',
      'passthrough',
      '-f',
      'null',
      '-',
    ]);
    const perFrame = (await readFile(stats, 'utf8'))
      .split('\n')
      .map((line) => /All:([\d.]+)/.exec(line)?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number);
    if (perFrame.length === 0) throw new Error(`ssim: no frames compared for ${video}`);
    return {
      perFrame,
      mean: perFrame.reduce((sum, value) => sum + value, 0) / perFrame.length,
      min: Math.min(...perFrame),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
