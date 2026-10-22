// Codec capabilities per frame size (design-download-engine.md "Codec capabilities (caps.ts)").
// Cached in storage.session for the browser session (PRD §4.6); the probe runs in the offscreen
// document, the same context as the encoder, so the hint shown and the format produced agree.

import { CAPS_KEY_PREFIX } from '../shared/constants';
import type { CodecCaps } from '../shared/messages';
import { send } from './offscreen-client';

const inFlight = new Map<string, Promise<CodecCaps>>();

const even = (n: number): number => n - (n % 2);

export function capsKey(width: number, height: number): string {
  return `${CAPS_KEY_PREFIX}${even(width)}x${even(height)}`;
}

function isCodecCaps(value: unknown): value is CodecCaps {
  if (typeof value !== 'object' || value === null) return false;
  const { avc, vp9 } = value as Partial<CodecCaps>;
  return (avc === null || typeof avc === 'string') && typeof vp9 === 'boolean';
}

async function lookupOrProbe(key: string, width: number, height: number): Promise<CodecCaps> {
  const stored = (await chrome.storage.session.get(key))[key];
  if (isCodecCaps(stored)) return stored;
  const response = await send({ type: 'off/probe', width, height });
  if (!response.ok) throw new Error(`off/probe failed: ${response.error}`);
  await chrome.storage.session.set({ [key]: response.caps });
  return response.caps;
}

/** Encoder support for frames of `width`×`height`, cropped to even size. */
export function getCaps(width: number, height: number): Promise<CodecCaps> {
  const key = capsKey(width, height);
  let caps = inFlight.get(key);
  if (!caps) {
    caps = lookupOrProbe(key, even(width), even(height)).finally(() => inFlight.delete(key));
    inFlight.set(key, caps);
  }
  return caps;
}

/** True while a lookup or probe is running; the offscreen close policy waits for none pending. */
export function probePending(): boolean {
  return inFlight.size > 0;
}
