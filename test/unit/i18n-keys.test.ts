// Copy-deck coverage: every key the source names exists in the en deck, and every en key is used.
// The other locales' key sets are checked against en in locales.test.ts.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../helpers/i18n-stub';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

/** Named by manifest.json (`__MSG_…__`) or read by localeTag(), never through t(). */
const ALLOWED_UNUSED: readonly string[] = ['ext_name', 'ext_description', 'locale_tag'];

/** A literal first argument of t() or splitOnPlaceholder(), possibly on the next line. */
const CALL_KEY_RE = /\b(?:t|splitOnPlaceholder)\(\s*(['"])([^'"]*)\1/g;
/** data-i18n, data-i18n-title, data-i18n-aria-label, … */
const DATA_I18N_RE = /\bdata-i18n(?:-[a-z]+)*=(['"])([^'"]*)\1/g;
/** Any quoted identifier-like string: how a key appears in a lookup table or a ternary. */
const QUOTED_NAME_RE = /(['"])([a-z][a-z0-9_]*)\1/g;

interface SourceFile {
  file: string;
  text: string;
}

function sourceFiles(): SourceFile[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|html)$/.test(entry.name))
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return { file: path.relative(SRC, file), text: readFileSync(file, 'utf8') };
    });
}

function matches(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map((match) => match[2] ?? '');
}

/** Each key named by a t()/splitOnPlaceholder() literal or a data-i18n* attribute, with its file. */
function namedKeys(files: readonly SourceFile[]): Array<{ key: string; file: string }> {
  return files.flatMap(({ file, text }) =>
    [...matches(CALL_KEY_RE, text), ...matches(DATA_I18N_RE, text)].map((key) => ({ key, file })),
  );
}

const files = sourceFiles();
const en = loadMessages('en');

describe('i18n keys', () => {
  it('i18n keys: the scan finds keys in t(), splitOnPlaceholder() and data-i18n attributes', () => {
    const keys = new Set(namedKeys(files).map(({ key }) => key));
    expect(
      ['opt_tab_title', 'err_unknown_token', 'opt_reset', 'tok_id_tip'].filter(
        (key) => !keys.has(key),
      ),
    ).toEqual([]);
  });

  it('i18n keys: every key named in src/ exists in the en messages.json', () => {
    const missing = namedKeys(files).filter(({ key }) => !(key in en));
    expect(missing).toEqual([]);
  });

  it('i18n keys: every en key is used in src/', () => {
    const used = new Set([
      ...namedKeys(files).map(({ key }) => key),
      ...files.flatMap(({ text }) => matches(QUOTED_NAME_RE, text)),
    ]);
    const unused = Object.keys(en).filter((key) => !used.has(key) && !ALLOWED_UNUSED.includes(key));
    expect(unused).toEqual([]);
  });
});
