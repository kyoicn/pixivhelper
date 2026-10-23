import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  createRegistry,
  type Effect,
  type EffectRunner,
  type SessionStore,
} from '../../src/background/registry';
import type { FileRole, FileState, FileTask, JobRecord } from '../../src/shared/job';
import { __testHook, setTestHookHandler } from '../../src/shared/test-hooks';

afterEach(() => {
  setTestHookHandler(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Minimal storage.session stand-in: values are copied on write, as Chrome serializes them. */
function memoryStorage(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: vi.fn(() => Promise.resolve(Object.fromEntries(data))),
    set: vi.fn((items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
      return Promise.resolve();
    }),
    remove: vi.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
  };
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const noEffects: EffectRunner = () => Promise.resolve();

function file(
  idx: number,
  role: FileRole,
  state: FileState,
  extra: Partial<FileTask> = {},
): FileTask {
  return { idx, role, name: `file${idx}`, save: true, dependsOn: [], state, ...extra };
}

function job(jobId = 'job-1', files: FileTask[] = []): JobRecord {
  return {
    v: 1,
    jobId,
    artworkId: '135882741',
    originTabId: 7,
    createdAt: 0,
    mode: 'full',
    request: { mode: 'full', artworkId: '135882741', expectedFiles: 2 },
    kind: 'pages',
    phase: 'transferring',
    snapshot: {
      folderPattern: 'pixiv/{artist}-{id}',
      ugoiraOutput: 'mp4',
      saveMetadata: false,
      effectiveFormat: null,
    },
    expectedFiles: 2,
    metaBody: null,
    folder: 'pixiv/みずき-135882741',
    pagesTotal: 2,
    pagesOffset: 0,
    files,
    ugoira: null,
    stopReason: null,
    apiFailure: null,
  };
}

const twoPages = () => [
  file(0, 'page', 'queued', { page: 0 }),
  file(1, 'page', 'queued', { page: 1 }),
];
const first = (record: JobRecord) => record.files[0] as FileTask;

describe('registry: create / get / list', () => {
  it('create: persists the record as job:<jobId>', async () => {
    const storage = memoryStorage();
    await createRegistry({ storage, run: noEffects }).create(job());
    expect(storage.data.get('job:job-1')).toEqual(job());
  });

  it('get: returns a created job', async () => {
    const registry = createRegistry({ storage: memoryStorage(), run: noEffects });
    await registry.create(job());
    expect(registry.get('job-1')?.artworkId).toBe('135882741');
  });

  it('list: returns every running job', async () => {
    const registry = createRegistry({ storage: memoryStorage(), run: noEffects });
    await Promise.all([registry.create(job('a')), registry.create(job('b'))]);
    expect(registry.list().map((record) => record.jobId)).toEqual(['a', 'b']);
  });

  it('create: indexes files by taskId and downloadId', async () => {
    const registry = createRegistry({ storage: memoryStorage(), run: noEffects });
    const files = [
      file(0, 'page', 'fetching', { taskId: 't0' }),
      file(1, 'page', 'saving', { downloadId: 41 }),
    ];
    await registry.create(job('job-1', files));
    expect([registry.findByTaskId('t0'), registry.findByDownloadId(41)]).toEqual([
      { jobId: 'job-1', idx: 0 },
      { jobId: 'job-1', idx: 1 },
    ]);
  });
});

describe('registry: mutate', () => {
  it('mutate: persists the change', async () => {
    const storage = memoryStorage();
    const registry = createRegistry({ storage, run: noEffects });
    await registry.create(job('job-1', twoPages()));
    await registry.mutate('job-1', (record) => {
      first(record).state = 'fetching';
      return [];
    });
    expect((storage.data.get('job:job-1') as JobRecord).files[0]?.state).toBe('fetching');
  });

  it('mutate: persists before the effects reach the runner', async () => {
    const storage = memoryStorage();
    let storedAtRun: unknown;
    const registry = createRegistry({
      storage,
      run: () => {
        storedAtRun = structuredClone(storage.data.get('job:job-1'));
        return Promise.resolve();
      },
    });
    await registry.create(job('job-1', twoPages()));
    await registry.mutate('job-1', (record) => {
      first(record).state = 'fetching';
      first(record).taskId = 't0';
      return [{ type: 'dispatch', idx: 0 }];
    });
    expect((storedAtRun as JobRecord).files[0]).toMatchObject({ state: 'fetching', taskId: 't0' });
  });

  it('mutate: hands the effects and the record to the runner', async () => {
    const run = vi.fn<EffectRunner>(() => Promise.resolve());
    const registry = createRegistry({ storage: memoryStorage(), run });
    await registry.create(job());
    const effects: Effect[] = [{ type: 'push' }, { type: 'badge' }];
    await registry.mutate('job-1', () => effects);
    expect(run).toHaveBeenCalledWith(registry.get('job-1'), effects);
  });

  it('mutate: resolves true for a running job', async () => {
    const registry = createRegistry({ storage: memoryStorage(), run: noEffects });
    await registry.create(job());
    await expect(registry.mutate('job-1', () => [])).resolves.toBe(true);
  });

  it('mutate: resolves false without calling fn for an unknown job', async () => {
    const fn = vi.fn(() => []);
    const registry = createRegistry({ storage: memoryStorage(), run: noEffects });
    const found = await registry.mutate('gone', fn);
    expect({ found, calls: fn.mock.calls.length }).toEqual({ found: false, calls: 0 });
  });

  it('mutate: a concurrent call waits until the previous one has persisted', async () => {
    const storage = memoryStorage();
    const registry = createRegistry({ storage, run: noEffects });
    await registry.create(job('job-1', twoPages()));
    const gate = deferred();
    storage.set.mockImplementationOnce(async (items) => {
      await gate.promise;
      for (const [key, value] of Object.entries(items))
        storage.data.set(key, structuredClone(value));
    });
    const calls: string[] = [];
    const record = (name: string) => () => {
      calls.push(name);
      return [];
    };
    const a = registry.mutate('job-1', record('a'));
    const b = registry.mutate('job-1', record('b'));
    await settle();
    const whileFirstPersists = [...calls];
    gate.resolve();
    await Promise.all([a, b]);
    expect({ whileFirstPersists, calls }).toEqual({ whileFirstPersists: ['a'], calls: ['a', 'b'] });
  });

  it('mutate: concurrent calls never lose an update', async () => {
    const storage = memoryStorage();
    const registry = createRegistry({ storage, run: noEffects });
    await registry.create(job());
    await Promise.all(
      Array.from({ length: 10 }, () =>
        registry.mutate('job-1', (record) => {
          record.expectedFiles += 1;
          return [];
        }),
      ),
    );
    expect((storage.data.get('job:job-1') as JobRecord).expectedFiles).toBe(12);
  });

  it('mutate: runners start in mutation order', async () => {
    const started: string[] = [];
    const registry = createRegistry({
      storage: memoryStorage(),
      run: (_record, effects) => {
        started.push(effects.map((effect) => effect.type).join());
        return Promise.resolve();
      },
    });
    await registry.create(job());
    await Promise.all([
      registry.mutate('job-1', () => [{ type: 'dispatch', idx: 0 }]),
      registry.mutate('job-1', () => [{ type: 'abort', taskIds: ['t0'] }]),
    ]);
    expect(started).toEqual(['dispatch', 'abort']);
  });

  it('mutate: a runner may call mutate without deadlocking', async () => {
    const storage = memoryStorage();
    const registry = createRegistry({
      storage,
      run: async (record, effects) => {
        if (effects.some((effect) => effect.type === 'download')) {
          await registry.mutate(record.jobId, (again) => {
            first(again).downloadId = 41;
            return [];
          });
        }
      },
    });
    await registry.create(job('job-1', twoPages()));
    await registry.mutate('job-1', (record) => {
      first(record).state = 'saving';
      return [{ type: 'download', idx: 0 }];
    });
    expect(registry.findByDownloadId(41)).toEqual({ jobId: 'job-1', idx: 0 });
  });

  it('mutate: a throwing fn rejects that call and later calls still run', async () => {
    const registry = createRegistry({ storage: memoryStorage(), run: noEffects });
    await registry.create(job());
    const broken = registry.mutate('job-1', () => {
      throw new Error('boom');
    });
    const next = registry.mutate('job-1', () => []);
    await expect(broken).rejects.toThrow('boom');
    await expect(next).resolves.toBe(true);
  });

  it('mutate: re-indexes a file whose taskId changed', async () => {
    const registry = createRegistry({ storage: memoryStorage(), run: noEffects });
    await registry.create(job('job-1', [file(0, 'page', 'fetching', { taskId: 'old' })]));
    await registry.mutate('job-1', (record) => {
      first(record).taskId = 'new';
      return [];
    });
    expect([registry.findByTaskId('old'), registry.findByTaskId('new')]).toEqual([
      undefined,
      { jobId: 'job-1', idx: 0 },
    ]);
  });

  describe('when the job ends', () => {
    async function endJob() {
      const storage = memoryStorage();
      const run = vi.fn<EffectRunner>(() => Promise.resolve());
      const registry = createRegistry({ storage, run });
      const files = [file(0, 'page', 'saving', { taskId: 't0', downloadId: 41 })];
      await registry.create(job('job-1', files));
      await registry.mutate('job-1', (record) => {
        first(record).state = 'done';
        record.phase = 'ended';
        return [{ type: 'finalize' }];
      });
      return { storage, run, registry };
    }

    it('mutate: deletes the record from storage.session', async () => {
      const { storage } = await endJob();
      expect(storage.data.has('job:job-1')).toBe(false);
    });

    it('mutate: drops the job from memory', async () => {
      const { registry } = await endJob();
      expect([registry.get('job-1'), registry.list()]).toEqual([undefined, []]);
    });

    it('mutate: drops the job from the indexes', async () => {
      const { registry } = await endJob();
      expect([registry.findByTaskId('t0'), registry.findByDownloadId(41)]).toEqual([
        undefined,
        undefined,
      ]);
    });

    it('mutate: still hands the ended record to the runner', async () => {
      const { run } = await endJob();
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ phase: 'ended' }), [
        { type: 'finalize' },
      ]);
    });

    it('mutate: later calls for the ended job resolve false', async () => {
      const { registry } = await endJob();
      await expect(registry.mutate('job-1', () => [])).resolves.toBe(false);
    });
  });

  describe('display-only progress', () => {
    async function ugoiraRegistry() {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(10_000);
      const storage = memoryStorage();
      const registry = createRegistry({ storage, run: noEffects });
      await registry.create({
        ...job(),
        kind: 'ugoira',
        ugoira: {
          frames: [{ file: '000000.jpg', delay: 100 }],
          format: 'mp4',
          avcCodec: 'avc1.64001e',
          width: 600,
          height: 600,
          zipLoaded: 0,
          zipTotal: 1000,
          encDone: 0,
          percent: 0,
        },
      });
      const progress = (loaded: number) =>
        registry.mutate(
          'job-1',
          (record) => {
            if (record.ugoira) record.ugoira.zipLoaded = loaded;
            return [{ type: 'push' }];
          },
          { displayOnly: true },
        );
      return { storage, registry, progress };
    }

    it('mutate: display-only changes within a second of the last write are not persisted', async () => {
      const { storage, progress } = await ugoiraRegistry();
      vi.setSystemTime(10_500);
      await progress(200);
      expect(storage.set).toHaveBeenCalledTimes(1);
    });

    it('mutate: a display-only change a second after the last write is persisted', async () => {
      const { storage, progress } = await ugoiraRegistry();
      vi.setSystemTime(10_500);
      await progress(200);
      vi.setSystemTime(11_000);
      await progress(400);
      expect((storage.data.get('job:job-1') as JobRecord).ugoira?.zipLoaded).toBe(400);
    });

    it('mutate: display-only effects still run when the write is skipped', async () => {
      const run = vi.fn<EffectRunner>(() => Promise.resolve());
      vi.useFakeTimers({ toFake: ['Date'] });
      const registry = createRegistry({ storage: memoryStorage(), run });
      await registry.create(job());
      await registry.mutate('job-1', () => [{ type: 'push' }], { displayOnly: true });
      expect(run).toHaveBeenCalledWith(expect.anything(), [{ type: 'push' }]);
    });

    it('mutate: the next regular write carries skipped display-only changes', async () => {
      const { storage, registry, progress } = await ugoiraRegistry();
      await progress(200);
      await registry.mutate('job-1', (record) => {
        record.expectedFiles = 1;
        return [];
      });
      expect((storage.data.get('job:job-1') as JobRecord).ugoira?.zipLoaded).toBe(200);
    });
  });
});

describe('registry: hydrate', () => {
  function stored() {
    const a = job('a', [file(0, 'page', 'fetching', { taskId: 'ta' })]);
    const b = job('b', [file(0, 'page', 'saving', { taskId: 'tb', downloadId: 7 })]);
    return memoryStorage({
      'job:a': a,
      'job:b': b,
      'caps:600x600': { avc: 'avc1.64001e', vp9: true },
      settings: { v: 1 },
    });
  }

  it('hydrate: loads every job:* record and nothing else', async () => {
    const registry = createRegistry({ storage: stored(), run: noEffects });
    await registry.hydrate();
    expect(registry.list().map((record) => record.jobId)).toEqual(['a', 'b']);
  });

  it('hydrate: rebuilds the taskId index', async () => {
    const registry = createRegistry({ storage: stored(), run: noEffects });
    await registry.hydrate();
    expect(registry.findByTaskId('tb')).toEqual({ jobId: 'b', idx: 0 });
  });

  it('hydrate: rebuilds the downloadId index', async () => {
    const registry = createRegistry({ storage: stored(), run: noEffects });
    await registry.hydrate();
    expect(registry.findByDownloadId(7)).toEqual({ jobId: 'b', idx: 0 });
  });

  it('hydrate: a restarted registry continues the stored jobs', async () => {
    const storage = memoryStorage();
    const before = createRegistry({ storage, run: noEffects });
    await before.create(job('job-1', twoPages()));
    await before.mutate('job-1', (record) => {
      first(record).state = 'fetching';
      first(record).taskId = 't0';
      return [];
    });
    const after = createRegistry({ storage, run: noEffects });
    await after.hydrate();
    expect(after.get('job-1')?.files[0]).toMatchObject({ state: 'fetching', taskId: 't0' });
  });

  it('hydrate: replaces jobs held in memory', async () => {
    const registry = createRegistry({ storage: stored(), run: noEffects });
    await registry.hydrate();
    await registry.hydrate();
    expect(registry.list()).toHaveLength(2);
  });
});

describe('registry: test hooks', () => {
  it('mutate: reports its await points in order', async () => {
    const names: string[] = [];
    const registry = createRegistry({ storage: memoryStorage(), run: noEffects });
    await registry.create(job());
    setTestHookHandler((name) => {
      names.push(name);
    });
    await registry.mutate('job-1', () => []);
    expect(names).toEqual(['await:registry.persist', 'await:registry.effects']);
  });

  it('create: reports its await point', async () => {
    const names: string[] = [];
    setTestHookHandler((name) => {
      names.push(name);
    });
    await createRegistry({ storage: memoryStorage(), run: noEffects }).create(job());
    expect(names).toEqual(['await:registry.create']);
  });

  it('mutate: a hook that never settles freezes the call before the write (SW death)', async () => {
    const storage = memoryStorage();
    const run = vi.fn<EffectRunner>(() => Promise.resolve());
    const registry = createRegistry({ storage, run });
    await registry.create(job());
    setTestHookHandler((name) =>
      name === 'await:registry.persist' ? new Promise<void>(() => undefined) : undefined,
    );
    void registry.mutate('job-1', (record) => {
      record.phase = 'ended';
      return [{ type: 'finalize' }];
    });
    await settle();
    expect({ stored: storage.data.has('job:job-1'), ran: run.mock.calls.length }).toEqual({
      stored: true,
      ran: 0,
    });
  });

  it('__testHook: is a no-op without a handler', () => {
    expect(__testHook('await:registry.persist')).toBeUndefined();
  });

  it('__testHook: is a no-op when __TEST_HOOKS__ is false', () => {
    const handler = vi.fn();
    setTestHookHandler(handler);
    vi.stubGlobal('__TEST_HOOKS__', false);
    void __testHook('await:registry.persist');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('SessionStore', () => {
  it('SessionStore: chrome.storage.session satisfies it', () => {
    expectTypeOf<chrome.storage.SessionStorageArea>().toExtend<SessionStore>();
  });
});
