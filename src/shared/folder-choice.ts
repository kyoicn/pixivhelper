// The folder check's pure part (design-download-engine.md "Folder choice", PRD §4.3, D15): the
// filenameRegex that finds this artwork's files in `<folder>/` or `<folder> (n)/` in Chrome's
// download history, and the lowest free n. Pure: no chrome.* access.

/** RE2 and ECMAScript metacharacters; both escape them with a backslash. */
const REGEX_SPECIALS = /[\\^$.|?*+()[\]{}]/g;
/** A path separator on any OS, as regex text: the class of backslash and slash. */
const SEP = '[\\\\/]';

export const escapeRegex = (s: string): string => s.replace(REGEX_SPECIALS, '\\$&');

/**
 * The filenameRegex for "a file of `artworkId` directly in `<Downloads>/<folder>/` or
 * `<Downloads>/<folder> (n)/`": a suffix match on Chrome's absolute target path, either OS
 * separator, RE2 ∩ ECMAScript syntax only (Chrome runs it with RE2, folderIndexOf with JS).
 * Capture group 1 is n; it is absent for the plain folder. Only the last segment gets the suffix.
 */
export function folderCheckRegex(folder: string, artworkId: string): string {
  const segments = folder.split('/').map(escapeRegex).join(SEP);
  return `(?:^|${SEP})${segments}(?: \\((\\d+)\\))?${SEP}${artworkId}[_.][^\\\\/]*$`;
}

/** n of the folder a matching record sits in (0 = plain), or null when `filename` does not match. */
export function folderIndexOf(filename: string, folder: string, artworkId: string): number | null {
  const m = new RegExp(folderCheckRegex(folder, artworkId)).exec(filename);
  if (!m) return null;
  return m[1] === undefined ? 0 : Number(m[1]);
}

/** The lowest n ≥ 0 not in `taken`: gaps are reused (PRD §4.3 "Index"). */
export function lowestFreeIndex(taken: Iterable<number>): number {
  const set = new Set(taken);
  let n = 0;
  while (set.has(n)) n++;
  return n;
}

export const withFolderIndex = (folder: string, n: number): string =>
  n === 0 ? folder : `${folder} (${n})`;
