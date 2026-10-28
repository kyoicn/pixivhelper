import { describe, expect, it } from 'vitest';
import {
  escapeRegex,
  folderCheckRegex,
  folderIndexOf,
  lowestFreeIndex,
  withFolderIndex,
} from '../../../src/shared/folder-choice';

const ID = '135882741';
const FOLDER = 'pixiv/みずき-135882741';
const MAC = '/Users/aoi/Downloads';

const indexOf = (filename: string, folder = FOLDER, id = ID) => folderIndexOf(filename, folder, id);

describe('escapeRegex', () => {
  it('escapeRegex: escapes every RE2 and ECMAScript metacharacter with a backslash', () => {
    expect(escapeRegex('\\^$.|?*+()[]{}')).toBe('\\\\\\^\\$\\.\\|\\?\\*\\+\\(\\)\\[\\]\\{\\}');
  });

  it('escapeRegex: leaves other text alone', () => {
    expect(escapeRegex('みずき-135882741 _~')).toBe('みずき-135882741 _~');
  });
});

describe('folderCheckRegex', () => {
  it('folderCheckRegex: is the design text for the PRD example', () => {
    expect(folderCheckRegex(FOLDER, ID)).toBe(
      '(?:^|[\\\\/])pixiv[\\\\/]みずき-135882741(?: \\((\\d+)\\))?[\\\\/]135882741[_.][^\\\\/]*$',
    );
  });

  it.each(['(?=', '(?!', '(?<', '\\Q', '\\1', '\\2', '\\k'])(
    'folderCheckRegex: uses no %s (RE2 ∩ ECMAScript only)',
    (construct) => {
      expect(folderCheckRegex('pixiv/(sora)+[x]-1', ID)).not.toContain(construct);
    },
  );

  it('folderCheckRegex: has no backreference of any number', () => {
    expect(folderCheckRegex(FOLDER, ID)).not.toMatch(/\\[1-9]/);
  });
});

describe('folderIndexOf: matches', () => {
  it('folderIndexOf: a page in the plain folder on macOS is n = 0', () => {
    expect(indexOf(`${MAC}/${FOLDER}/${ID}_p0.jpg`)).toBe(0);
  });

  it('folderIndexOf: a page in a (2) folder on Windows is n = 2', () => {
    expect(indexOf(`C:\\Users\\aoi\\Downloads\\pixiv\\みずき-135882741 (2)\\${ID}_p11.png`)).toBe(
      2,
    );
  });

  it.each([`${ID}_ugoira.zip`, `${ID}.mp4`, `${ID}.webm`])(
    'folderIndexOf: counts %s as a file of the artwork',
    (name) => {
      expect(indexOf(`${MAC}/${FOLDER}/${name}`)).toBe(0);
    },
  );

  it('folderIndexOf: counts a safety-net name such as _p0 (1).jpg', () => {
    expect(indexOf(`${MAC}/${FOLDER}/${ID}_p0 (1).jpg`)).toBe(0);
  });

  it('folderIndexOf: matches a path that is exactly the folder and file', () => {
    expect(indexOf(`${FOLDER} (3)/${ID}_p0.jpg`)).toBe(3);
  });
});

describe('folderIndexOf: rejects', () => {
  it.each(['metadata.json', 'frames.json'])('folderIndexOf: never counts %s', (name) => {
    expect(indexOf(`${MAC}/${FOLDER}/${name}`)).toBeNull();
  });

  it('folderIndexOf: rejects another artwork whose id starts with this one', () => {
    expect(indexOf(`${MAC}/${FOLDER}/1358827411_p0.jpg`)).toBeNull();
  });

  it('folderIndexOf: rejects a folder whose first segment only ends with the pattern’s', () => {
    expect(indexOf(`${MAC}/mypixiv/みずき-135882741/${ID}_p0.jpg`)).toBeNull();
  });

  it('folderIndexOf: rejects a suffix on a parent segment', () => {
    expect(indexOf(`${MAC}/pixiv (1)/みずき-135882741/${ID}_p0.jpg`)).toBeNull();
  });

  it('folderIndexOf: rejects a file in a subfolder', () => {
    expect(indexOf(`${MAC}/${FOLDER}/sub/${ID}_p0.jpg`)).toBeNull();
  });

  it('folderIndexOf: rejects a suffix written without the space', () => {
    expect(indexOf(`${MAC}/${FOLDER}(1)/${ID}_p0.jpg`)).toBeNull();
  });
});

describe('folderIndexOf: folders with regex specials', () => {
  const SPECIAL = 'pixiv/(sora)+[x]-1';

  it('folderIndexOf: matches a folder made of regex metacharacters literally', () => {
    expect(indexOf(`${MAC}/pixiv/(sora)+[x]-1 (1)/${ID}_p0.jpg`, SPECIAL)).toBe(1);
  });

  it('folderIndexOf: does not read the metacharacters as regex syntax', () => {
    expect(indexOf(`${MAC}/pixiv/soraa[x]-1/${ID}_p0.jpg`, SPECIAL)).toBeNull();
  });

  it('folderIndexOf: a {title} segment with "." and "$" matches only itself', () => {
    const folder = 'pixiv/a.b$c';
    expect([
      indexOf(`${MAC}/pixiv/a.b$c/${ID}_p0.jpg`, folder),
      indexOf(`${MAC}/pixiv/aXb$c/${ID}_p0.jpg`, folder),
    ]).toEqual([0, null]);
  });

  it('folderIndexOf: a last segment already ending in (2) is n = 0 there', () => {
    expect(indexOf(`${MAC}/pixiv/sora (2)/${ID}_p0.jpg`, 'pixiv/sora (2)')).toBe(0);
  });

  it('folderIndexOf: a last segment already ending in (2) gets n = 1 from (2) (1)', () => {
    expect(indexOf(`${MAC}/pixiv/sora (2) (1)/${ID}_p0.jpg`, 'pixiv/sora (2)')).toBe(1);
  });
});

describe('lowestFreeIndex', () => {
  it.each<[string, number[], number]>([
    ['nothing taken', [], 0],
    ['{0}', [0], 1],
    ['{1} (gap reused)', [1], 0],
    ['{0, 2} (gap reused)', [0, 2], 1],
    ['{0, 1, 2}', [0, 1, 2], 3],
    ['duplicates', [0, 0, 1, 1, 1], 2],
    ['unsorted input', [2, 0, 3, 1, 5], 4],
  ])('lowestFreeIndex: %s → %i', (_label, taken, expected) => {
    expect(lowestFreeIndex(taken)).toBe(expected);
  });

  it('lowestFreeIndex: accepts any iterable', () => {
    expect(lowestFreeIndex(new Set([0, 1]))).toBe(2);
  });
});

describe('withFolderIndex', () => {
  it('withFolderIndex: n = 0 is the plain folder', () => {
    expect(withFolderIndex(FOLDER, 0)).toBe(FOLDER);
  });

  it('withFolderIndex: n ≥ 1 appends " (n)" to the last segment', () => {
    expect(withFolderIndex(FOLDER, 12)).toBe(`${FOLDER} (12)`);
  });
});
