import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskTable, type ZipBytes } from '../../../src/offscreen/tasks';

const ZIP: ZipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

let table: TaskTable;

beforeEach(() => {
  table = new TaskTable();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskTable: lifecycle', () => {
  it('TaskTable: a started task is running and live', () => {
    const task = table.start('t1', 'bytes');
    expect([task.state, table.isLive(task)]).toEqual(['running', true]);
  });

  it('TaskTable: markReady exposes the Blob under a blob: URL', () => {
    const task = table.start('t1', 'bytes');
    const blobUrl = table.markReady(task, new Blob(['x']));
    expect([task.state, task.blobUrl]).toEqual(['ready', blobUrl]);
    expect(blobUrl).toMatch(/^blob:/);
  });

  it('TaskTable: markReady keeps the bytes of a saved zip', () => {
    const task = table.start('z', 'zip');
    table.markReady(task, new Blob([ZIP]), ZIP);
    expect(task.zipBytes).toBe(ZIP);
  });

  it('TaskTable: markRetained keeps only the zip bytes', () => {
    const task = table.start('z', 'zip');
    table.markRetained(task, ZIP);
    expect([task.state, task.zipBytes, task.blobUrl]).toEqual(['retained', ZIP, undefined]);
  });

  it('TaskTable: markFailed drops whatever the task held', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const task = table.start('z', 'zip');
    const blobUrl = table.markReady(task, new Blob([ZIP]), ZIP);
    table.markFailed(task);
    expect([task.state, task.blob, task.zipBytes]).toEqual(['failed', undefined, undefined]);
    expect(revoke).toHaveBeenCalledWith(blobUrl);
  });

  it('TaskTable: starting an id that is in use disposes of the old task', () => {
    const old = table.start('t1', 'bytes');
    const next = table.start('t1', 'bytes');
    expect([old.abort.signal.aborted, table.isLive(old), table.get('t1')]).toEqual([
      true,
      false,
      next,
    ]);
  });
});

describe('TaskTable: abort', () => {
  it('TaskTable: abort cancels the task signal', () => {
    const task = table.start('t1', 'bytes');
    table.abort('t1');
    expect(task.abort.signal.aborted).toBe(true);
  });

  it('TaskTable: an aborted task is deleted and no longer live', () => {
    const task = table.start('t1', 'bytes');
    table.abort('t1');
    expect([table.get('t1'), table.isLive(task)]).toEqual([undefined, false]);
  });

  it('TaskTable: aborting a ready task revokes its Blob URL', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const blobUrl = table.markReady(table.start('t1', 'bytes'), new Blob(['x']));
    table.abort('t1');
    expect(revoke).toHaveBeenCalledWith(blobUrl);
  });

  it('TaskTable: aborting an unknown task is a no-op', () => {
    table.start('t1', 'bytes');
    table.abort('nope');
    expect(table.snapshot()).toEqual([{ taskId: 't1', state: 'running' }]);
  });
});

describe('TaskTable: release', () => {
  it('TaskTable: release revokes the Blob URL', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const blobUrl = table.markReady(table.start('t1', 'bytes'), new Blob(['x']));
    table.release('t1', false);
    expect(revoke).toHaveBeenCalledWith(blobUrl);
  });

  it('TaskTable: a full release drops the zip bytes and deletes the task', () => {
    const task = table.start('z', 'zip');
    table.markReady(task, new Blob([ZIP]), ZIP);
    table.release('z', false);
    expect([table.get('z'), task.zipBytes, task.blob]).toEqual([undefined, undefined, undefined]);
  });

  it('TaskTable: a keepRetained release drops the Blob but keeps the zip bytes', () => {
    const task = table.start('z', 'zip');
    table.markReady(task, new Blob([ZIP]), ZIP);
    table.release('z', true);
    expect([table.get('z'), task.state, task.zipBytes, task.blob, task.blobUrl]).toEqual([
      task,
      'retained',
      ZIP,
      undefined,
      undefined,
    ]);
  });

  it('TaskTable: a keepRetained release revokes the zip Blob URL', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const task = table.start('z', 'zip');
    const blobUrl = table.markReady(task, new Blob([ZIP]), ZIP);
    table.release('z', true);
    expect(revoke).toHaveBeenCalledWith(blobUrl);
  });

  it('TaskTable: a keepRetained release deletes a task without zip bytes', () => {
    table.markReady(table.start('t1', 'bytes'), new Blob(['x']));
    table.release('t1', true);
    expect(table.get('t1')).toBeUndefined();
  });

  it('TaskTable: releasing a running task cancels it', () => {
    const task = table.start('t1', 'bytes');
    table.release('t1', false);
    expect([task.abort.signal.aborted, table.isLive(task)]).toEqual([true, false]);
  });

  it('TaskTable: releasing an unknown task is a no-op', () => {
    table.start('t1', 'bytes');
    table.release('nope', false);
    expect(table.snapshot()).toEqual([{ taskId: 't1', state: 'running' }]);
  });
});

describe('TaskTable: snapshot', () => {
  it('TaskTable: the snapshot lists running, ready and retained tasks with their Blob URLs', () => {
    table.start('run', 'bytes');
    const blobUrl = table.markReady(table.start('ready', 'text'), new Blob(['{}']));
    table.markRetained(table.start('zip', 'zip'), ZIP);
    expect(table.snapshot()).toEqual([
      { taskId: 'run', state: 'running' },
      { taskId: 'ready', state: 'ready', blobUrl },
      { taskId: 'zip', state: 'retained' },
    ]);
  });

  it('TaskTable: the snapshot leaves out failed tasks', () => {
    table.markFailed(table.start('t1', 'bytes'));
    expect(table.snapshot()).toEqual([]);
  });

  it('TaskTable: an empty table has an empty snapshot', () => {
    expect(table.snapshot()).toEqual([]);
  });
});
