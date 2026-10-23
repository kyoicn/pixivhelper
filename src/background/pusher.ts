// job/update pushes to a job's origin tab (design-download-engine.md "API / Interface Contract").
// Every push is a full JobView snapshot, so a dropped intermediate one costs nothing: byte progress
// is throttled to PUSH_INTERVAL_MS per job with a trailing push of the latest state.

import type { JobView } from '../shared/types';
import type { JobRecord } from '../shared/job';

/** At most 4 progress pushes per second per job. */
export const PUSH_INTERVAL_MS = 250;

export interface PusherDeps {
  send: (tabId: number, view: JobView) => Promise<void>;
  /** The running job, or undefined once it has ended (its final view is pushed by finalize). */
  getJob: (jobId: string) => JobRecord | undefined;
  view: (job: JobRecord) => JobView;
}

export interface Pusher {
  /**
   * Pushes the job's current view; with `throttle`, at most once per PUSH_INTERVAL_MS. Does
   * nothing once `getJob` no longer returns the job.
   */
  push(job: JobRecord, throttle?: boolean): void;
  /** Drops a pending trailing push (the job is ending). */
  cancel(jobId: string): void;
}

export function createPusher({ send, getJob, view }: PusherDeps): Pusher {
  const lastPushAt = new Map<string, number>();
  const trailing = new Map<string, ReturnType<typeof setTimeout>>();

  function clearTrailing(jobId: string): void {
    const timer = trailing.get(jobId);
    if (timer !== undefined) clearTimeout(timer);
    trailing.delete(jobId);
  }

  function pushNow(job: JobRecord): void {
    clearTrailing(job.jobId);
    lastPushAt.set(job.jobId, Date.now());
    void send(job.originTabId, view(job));
  }

  return {
    push(job, throttle = false) {
      // A running view must never follow the final one.
      if (!getJob(job.jobId)) return;
      const wait = (lastPushAt.get(job.jobId) ?? -Infinity) + PUSH_INTERVAL_MS - Date.now();
      if (!throttle || wait <= 0) {
        pushNow(job);
        return;
      }
      if (trailing.has(job.jobId)) return;
      trailing.set(
        job.jobId,
        setTimeout(() => {
          trailing.delete(job.jobId);
          const current = getJob(job.jobId);
          if (current) pushNow(current);
          else lastPushAt.delete(job.jobId);
        }, wait),
      );
    },
    cancel(jobId) {
      clearTrailing(jobId);
      lastPushAt.delete(jobId);
    },
  };
}
