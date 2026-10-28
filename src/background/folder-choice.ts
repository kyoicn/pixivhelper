// The folder actually used by a `full` job (design-download-engine.md "Folder choice", PRD §4.3
// "Folder choice", D15): the resolved folder, or `<folder> (n)` when Chrome's download history
// shows files of this artwork still present in it or in a sibling.

import { FOLDER_CHECK_RECHECK_WAIT_MS } from '../shared/constants';
import {
  folderCheckRegex,
  folderIndexOf,
  lowestFreeIndex,
  withFolderIndex,
} from '../shared/folder-choice';
import { createLogger } from '../shared/log';
import { isSafeRelativeFolder } from '../shared/pattern';

const log = createLogger('folder-choice');

export interface FolderChoiceDeps {
  search: (query: chrome.downloads.DownloadQuery) => Promise<chrome.downloads.DownloadItem[]>;
  sleep: (ms: number) => Promise<void>;
}

// Looked up per call, so a test's chrome fake installed after import is the one used.
const DEFAULT_DEPS: FolderChoiceDeps = {
  search: (query) => chrome.downloads.search(query),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Never rejects: on any failure it returns `folder`, the pre-refinement behaviour. */
export async function chooseFolder(
  folder: string,
  artworkId: string,
  deps: FolderChoiceDeps = DEFAULT_DEPS,
): Promise<string> {
  const query: chrome.downloads.DownloadQuery = {
    filenameRegex: folderCheckRegex(folder, artworkId),
    state: 'complete',
    limit: 0,
  };
  try {
    // The first search makes Chrome start its asynchronous existence re-check; it has no
    // completion signal, so the flags are read by the same search after a fixed wait.
    const first = await search(deps, query);
    if (first.length === 0) return folder;
    await deps.sleep(FOLDER_CHECK_RECHECK_WAIT_MS);
    const settled = await search(deps, query);
    const taken = settled
      // Not `=== true`: Chrome always sets the field, but the fakes and older typings may not.
      .filter((item) => item.exists !== false)
      .map((item) => folderIndexOf(item.filename, folder, artworkId))
      .filter((n): n is number => n !== null);
    const chosen = withFolderIndex(folder, lowestFreeIndex(taken));
    if (!isSafeRelativeFolder(chosen)) {
      log.warn('chosen folder failed validation, using the plain folder', chosen);
      return folder;
    }
    log.debug('folder choice', {
      artworkId,
      records: settled.length,
      surviving: taken.length,
      chosen,
    });
    return chosen;
  } catch (error) {
    log.warn('folder check failed, using the plain folder', error);
    return folder;
  }
}

async function search(
  deps: FolderChoiceDeps,
  query: chrome.downloads.DownloadQuery,
): Promise<chrome.downloads.DownloadItem[]> {
  const items: unknown = await deps.search(query);
  if (!Array.isArray(items)) throw new TypeError('downloads.search returned no list');
  return items as chrome.downloads.DownloadItem[];
}
