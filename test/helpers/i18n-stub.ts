// chrome.i18n.getMessage over the real src/_locales files, with Chrome's semantics:
// - message names are case-insensitive; a missing key falls back to the default locale (en), then '';
// - `$name$` expands to the named placeholder's `content` (names are case-insensitive);
// - then `$1`…`$9` take the substitutions (a missing one becomes ''), and `$$` becomes `$`;
// - a substitution ends at its first U+0000, as Chrome passes it on as a C string.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

export type Locale = 'en' | 'ja' | 'zh_CN' | 'zh_TW';
export const LOCALES: readonly Locale[] = ['en', 'ja', 'zh_CN', 'zh_TW'];

export interface MessageEntry {
  message: string;
  description?: string;
  placeholders?: Record<string, { content: string; example?: string }>;
}
export type Messages = Record<string, MessageEntry>;
export type GetMessage = (key: string, substitutions?: string | Array<string | number>) => string;

export function loadMessages(locale: Locale): Messages {
  // Not `new URL(…, import.meta.url)`: under happy-dom, Vite rewrites that to a server URL.
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    `../../src/_locales/${locale}/messages.json`,
  );
  return JSON.parse(readFileSync(file, 'utf8')) as Messages;
}

function compile(messages: Messages, locale: Locale): Map<string, string> {
  const compiled = new Map<string, string>();
  for (const [key, entry] of Object.entries(messages)) {
    const placeholders = new Map(
      Object.entries(entry.placeholders ?? {}).map(([name, p]) => [name.toLowerCase(), p.content]),
    );
    const message = entry.message.replace(/\$([A-Za-z0-9_@]+)\$/g, (_, name: string) => {
      const content = placeholders.get(name.toLowerCase());
      if (content === undefined) {
        throw new Error(`${locale}/${key}: undefined placeholder $${name}$`);
      }
      return content;
    });
    compiled.set(key.toLowerCase(), message);
  }
  return compiled;
}

function substitute(message: string, subs: readonly string[]): string {
  return message.replace(/\$(\$+|[1-9]|[\s\S])?/g, (_, next: string | undefined) => {
    if (next === undefined) return '';
    if (next.startsWith('$')) return next;
    if (next >= '1' && next <= '9') return subs[Number(next) - 1] ?? '';
    return '';
  });
}

/** A getMessage bound to `locale`, falling back to `en` for missing keys. */
export function createGetMessage(locale: Locale = 'en'): GetMessage {
  const own = compile(loadMessages(locale), locale);
  const fallback = locale === 'en' ? own : compile(loadMessages('en'), 'en');
  return (key, substitutions) => {
    const message = own.get(key.toLowerCase()) ?? fallback.get(key.toLowerCase());
    if (message === undefined) return '';
    const subs =
      substitutions === undefined
        ? []
        : (Array.isArray(substitutions) ? substitutions : [substitutions]).map(
            (sub) => String(sub).split('\u0000')[0] ?? '',
          );
    return substitute(message, subs);
  };
}

/**
 * Installs `chrome.i18n.getMessage` for `locale` with vi.stubGlobal, keeping any other `chrome`
 * members already installed (e.g. the chrome fakes). Undo with vi.unstubAllGlobals().
 */
export function stubChromeI18n(locale: Locale = 'en'): GetMessage {
  const getMessage = createGetMessage(locale);
  const current = (globalThis as { chrome?: object }).chrome;
  vi.stubGlobal('chrome', { ...current, i18n: { getMessage } });
  return getMessage;
}
