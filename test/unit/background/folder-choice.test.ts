import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { chooseFolder, type FolderChoiceDeps } from '../../../src/background/folder-choice';
import { FOLDER_CHECK_RECHECK_WAIT_MS } from '../../../src/shared/constants';
import { folderCheckRegex } from '../../../src/shared/folder-choice';
import { installChromeFake, type ChromeFake } from '../../fakes/chrome';

type Item = chrome.downloads.DownloadItem;

const ID = '135882741';
const FOLDER = 'pixiv/みずき-135882741';
const DIR = '/Users/aoi/Downloads/pixiv';

const item = (filename: string, exists = true): Item => ({ filename, exists }) as Item;
const page = (n: number, exists = true, id = ID): Item =>
  item(`${DIR}/みずき-135882741${n === 0 ? '' : ` (${n})`}/${id}_p0.jpg`, exists);

/** Stubbed deps: search call i answers with `answers[i]` (an Error rejects), then with []. */
function stubs(...answers: unknown[]) {
  let calls = 0;
  const search = vi.fn<FolderChoiceDeps['search']>(() => {
    const answer = calls < answers.length ? answers[calls] : [];
    calls++;
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as Item[]);
  });
  const sleep = vi.fn<FolderChoiceDeps['sleep']>(() => Promise.resolve());
  return { search, sleep } satisfies FolderChoiceDeps;
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('chooseFolder: present', () => {
  it('chooseFolder: files of the artwork in the plain folder → (1)', async () => {
    const deps = stubs([page(0)], [page(0)]);
    expect(await chooseFolder(FOLDER, ID, deps)).toBe(`${FOLDER} (1)`);
  });

  it('chooseFolder: searches twice for complete records of the artwork, without a limit', async () => {
    const deps = stubs([page(0)], [page(0)]);
    await chooseFolder(FOLDER, ID, deps);
    const query = { filenameRegex: folderCheckRegex(FOLDER, ID), state: 'complete', limit: 0 };
    expect(deps.search.mock.calls).toEqual([[query], [query]]);
  });

  it('chooseFolder: waits for the existence re-check between the two searches', async () => {
    const deps = stubs([page(0)], [page(0)]);
    const order: string[] = [];
    deps.search.mockImplementation(() => {
      order.push('search');
      return Promise.resolve([page(0)]);
    });
    deps.sleep.mockImplementation((ms: number) => {
      order.push(`sleep ${ms}`);
      return Promise.resolve();
    });
    await chooseFolder(FOLDER, ID, deps);
    expect(order).toEqual(['search', `sleep ${FOLDER_CHECK_RECHECK_WAIT_MS}`, 'search']);
  });

  it('chooseFolder: the plain folder and (1) present → (2)', async () => {
    const deps = stubs([page(0)], [page(0), page(1)]);
    expect(await chooseFolder(FOLDER, ID, deps)).toBe(`${FOLDER} (2)`);
  });

  it('chooseFolder: logs only the relative chosen folder, never Chrome’s absolute paths', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    await chooseFolder(FOLDER, ID, stubs([page(0)], [page(0), page(1, false)]));
    expect(debug.mock.calls).toEqual([
      [
        '[hfp:folder-choice]',
        'folder choice',
        { artworkId: ID, records: 2, surviving: 1, chosen: `${FOLDER} (1)` },
      ],
    ]);
  });
});

describe('chooseFolder: absent', () => {
  it('chooseFolder: no record → the plain folder', async () => {
    expect(await chooseFolder(FOLDER, ID, stubs([]))).toBe(FOLDER);
  });

  it('chooseFolder: no record → one search and no wait', async () => {
    const deps = stubs([]);
    await chooseFolder(FOLDER, ID, deps);
    expect([deps.search.mock.calls.length, deps.sleep.mock.calls.length]).toEqual([1, 0]);
  });

  it('chooseFolder: every record gone after the re-check → the plain folder', async () => {
    const deps = stubs([page(0), page(1)], [page(0, false), page(1, false)]);
    expect(await chooseFolder(FOLDER, ID, deps)).toBe(FOLDER);
  });

  it('chooseFolder: the second result replaces the first', async () => {
    const deps = stubs([page(0)], []);
    expect(await chooseFolder(FOLDER, ID, deps)).toBe(FOLDER);
  });

  it('chooseFolder: a record without the exists field counts as present', async () => {
    const bare = { filename: page(0).filename } as Item;
    expect(await chooseFolder(FOLDER, ID, stubs([bare], [bare]))).toBe(`${FOLDER} (1)`);
  });
});

describe('chooseFolder: gaps', () => {
  it('chooseFolder: surviving {1} → the plain folder', async () => {
    const deps = stubs([page(0), page(1)], [page(0, false), page(1)]);
    expect(await chooseFolder(FOLDER, ID, deps)).toBe(FOLDER);
  });

  it('chooseFolder: surviving {0, 2} → (1)', async () => {
    const deps = stubs([page(0), page(1), page(2)], [page(0), page(1, false), page(2)]);
    expect(await chooseFolder(FOLDER, ID, deps)).toBe(`${FOLDER} (1)`);
  });
});

describe('chooseFolder: records that are not files of the artwork', () => {
  it('chooseFolder: another artwork’s records are ignored', async () => {
    const other = [page(0, true, '1358827411'), item(`${DIR}/みずき-135882741/metadata.json`)];
    expect(await chooseFolder(FOLDER, ID, stubs(other, other))).toBe(FOLDER);
  });
});

describe('chooseFolder: failures', () => {
  it('chooseFolder: the first search rejects → the plain folder', async () => {
    expect(await chooseFolder(FOLDER, ID, stubs(new Error('boom')))).toBe(FOLDER);
  });

  it('chooseFolder: the first search rejects → a warn', async () => {
    const error = new Error('boom');
    await chooseFolder(FOLDER, ID, stubs(error));
    expect(warn.mock.calls).toEqual([
      ['[hfp:folder-choice]', 'folder check failed, using the plain folder', error],
    ]);
  });

  it('chooseFolder: the second search rejects → the plain folder', async () => {
    const deps = stubs([page(0)], new Error('boom'));
    expect(await chooseFolder(FOLDER, ID, deps)).toBe(FOLDER);
  });

  it('chooseFolder: a first result that is not an array → the plain folder', async () => {
    expect(await chooseFolder(FOLDER, ID, stubs(undefined))).toBe(FOLDER);
  });

  it('chooseFolder: a second result that is not an array → the plain folder and a warn', async () => {
    const result = await chooseFolder(FOLDER, ID, stubs([page(0)], { items: [] }));
    expect([result, warn.mock.calls.length]).toEqual([FOLDER, 1]);
  });

  it('chooseFolder: a sleep that rejects → the plain folder', async () => {
    const deps = stubs([page(0)], [page(0)]);
    deps.sleep.mockRejectedValue(new Error('timer'));
    expect(await chooseFolder(FOLDER, ID, deps)).toBe(FOLDER);
  });
});

describe('chooseFolder: validation belt', () => {
  it('chooseFolder: a chosen folder that fails isSafeRelativeFolder → the plain folder and a warn', async () => {
    const folder = 'pixiv/~a';
    const record = item(`${DIR}/~a/${ID}_p0.jpg`);
    const result = await chooseFolder(folder, ID, stubs([record], [record]));
    expect([result, warn.mock.calls]).toEqual([
      folder,
      [
        [
          '[hfp:folder-choice]',
          'chosen folder failed validation, using the plain folder',
          `${folder} (1)`,
        ],
      ],
    ]);
  });
});

describe('chooseFolder: default deps', () => {
  it('chooseFolder: uses the chrome.downloads installed after import', async () => {
    const fake = installChromeFake();
    expect([await chooseFolder(FOLDER, ID), fake.api.downloads.search.mock.calls.length]).toEqual([
      FOLDER,
      1,
    ]);
  });
});

describe('chooseFolder: the fake chrome.downloads (default deps)', () => {
  const REL = 'pixiv/みずき-135882741';
  const file = (n: number, name = `${ID}_p0.jpg`) => `${REL}${n === 0 ? '' : ` (${n})`}/${name}`;

  let fake: ChromeFake;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fake = installChromeFake();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** chooseFolder with Chrome's real-world timing: the 250 ms wait runs on fake time. */
  async function choose(): Promise<string> {
    const pending = chooseFolder(FOLDER, ID);
    await vi.advanceTimersByTimeAsync(1000);
    return pending;
  }

  it('chooseFolder: the earlier run’s files removed before the call → the plain folder', async () => {
    const ids = [file(0), file(0, `${ID}_p1.jpg`)].map(
      (path) => fake.downloads.addCompleted(path).id,
    );
    for (const id of ids) fake.downloads.removeFile(id);
    expect(await choose()).toBe(FOLDER);
  });

  it('chooseFolder: the plain folder deleted and (1) kept → the plain folder', async () => {
    fake.downloads.addCompleted(file(0), { exists: false });
    fake.downloads.addCompleted(file(1));
    expect(await choose()).toBe(FOLDER);
  });

  it('chooseFolder: the plain folder and (2) kept, (1) deleted → (1)', async () => {
    fake.downloads.addCompleted(file(0));
    fake.downloads.addCompleted(file(1), { exists: false });
    fake.downloads.addCompleted(file(2));
    expect(await choose()).toBe(`${FOLDER} (1)`);
  });

  it('chooseFolder: in-progress and interrupted records are ignored → the plain folder', async () => {
    const download = (path: string) =>
      fake.downloads.download({
        url: `blob:x/${path}`,
        filename: path,
        conflictAction: 'uniquify',
      });
    await download(file(0));
    const interrupted = await download(file(1));
    fake.downloads.interrupt(interrupted, 'NETWORK_FAILED');
    expect(await choose()).toBe(FOLDER);
  });

  it('chooseFolder: a re-check landing after the 250 ms wait leaves the stale flag → (2) (the bound’s residual)', async () => {
    fake.downloads.existenceCheckDelay(400);
    const plain = fake.downloads.addCompleted(file(0)).id;
    fake.downloads.addCompleted(file(1));
    fake.downloads.removeFile(plain);
    expect(await choose()).toBe(`${FOLDER} (2)`);
  });
});
