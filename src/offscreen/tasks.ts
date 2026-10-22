// Offscreen task table (design-offscreen-worker.md "Data Model"). Memory-only: if the document dies,
// the SW reads an empty table through off/tasks and re-queues the work.

import type { OffTaskSnapshot } from '../shared/messages';

export type TaskKind = 'bytes' | 'text' | 'zip' | 'encode';
export type TaskState = 'running' | 'ready' | 'retained' | 'failed';
/** Zip bytes live in a plain ArrayBuffer, which a Blob part requires. */
export type ZipBytes = Uint8Array<ArrayBuffer>;

export interface Task {
  taskId: string;
  kind: TaskKind;
  state: TaskState;
  abort: AbortController;
  blob?: Blob; // held until release (or a keepRetained release for a zip)
  blobUrl?: string; // URL.createObjectURL(blob)
  zipBytes?: ZipBytes; // kind 'zip' only; kept for a later encode until a full release
}

export class TaskTable {
  readonly #tasks = new Map<string, Task>();

  /** Registers a running task. A task already holding `taskId` is disposed of first. */
  start(taskId: string, kind: TaskKind): Task {
    const existing = this.#tasks.get(taskId);
    if (existing) this.#dispose(existing);
    const task: Task = { taskId, kind, state: 'running', abort: new AbortController() };
    this.#tasks.set(taskId, task);
    return task;
  }

  get(taskId: string): Task | undefined {
    return this.#tasks.get(taskId);
  }

  /** False once the task was aborted, released or replaced: whatever it produces is swallowed. */
  isLive(task: Task): boolean {
    return this.#tasks.get(task.taskId) === task && !task.abort.signal.aborted;
  }

  /** Exposes `blob` under a new Blob URL, which it returns. A saved zip also keeps its bytes. */
  markReady(task: Task, blob: Blob, zipBytes?: ZipBytes): string {
    task.blob = blob;
    task.blobUrl = URL.createObjectURL(blob);
    if (zipBytes) task.zipBytes = zipBytes;
    task.state = 'ready';
    return task.blobUrl;
  }

  /** A zip fetched without `save`: only its bytes are kept, for a later encode. */
  markRetained(task: Task, zipBytes: ZipBytes): void {
    task.zipBytes = zipBytes;
    task.state = 'retained';
  }

  /** A failed task holds nothing; it stays in the table until the SW releases it. */
  markFailed(task: Task): void {
    revoke(task);
    delete task.zipBytes;
    task.state = 'failed';
  }

  /** Cancels the task's work and deletes it; nothing it produces later is reported. */
  abort(taskId: string): void {
    const task = this.#tasks.get(taskId);
    if (task) this.#dispose(task);
  }

  /**
   * Revokes the Blob URL and drops the Blob. With `keepRetained`, a task holding zip bytes keeps
   * them (state `retained`) for a pending encode; every other task is deleted, which also cancels
   * one still running.
   */
  release(taskId: string, keepRetained: boolean): void {
    const task = this.#tasks.get(taskId);
    if (!task) return;
    if (keepRetained && task.zipBytes) {
      revoke(task);
      task.state = 'retained';
      return;
    }
    this.#dispose(task);
  }

  /** The tasks still running or holding a result, for the SW's reconciliation after a restart. */
  snapshot(): OffTaskSnapshot[] {
    const live: OffTaskSnapshot[] = [];
    for (const task of this.#tasks.values()) {
      if (task.state === 'failed') continue;
      const { taskId, state, blobUrl } = task;
      live.push(blobUrl === undefined ? { taskId, state } : { taskId, state, blobUrl });
    }
    return live;
  }

  #dispose(task: Task): void {
    task.abort.abort();
    revoke(task);
    delete task.zipBytes;
    this.#tasks.delete(task.taskId);
  }
}

function revoke(task: Task): void {
  if (task.blobUrl !== undefined) URL.revokeObjectURL(task.blobUrl);
  delete task.blobUrl;
  delete task.blob;
}
