import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUSH_INTERVAL_MS, createPusher } from '../../../src/background/pusher';
import type { JobRecord } from '../../../src/shared/job';
import type { JobView } from '../../../src/shared/types';

function job(jobId = 'job-1', percent = 0): JobRecord {
  return {
    jobId,
    originTabId: 7,
    ugoira: { percent },
  } as unknown as JobRecord;
}

function setup(running: Map<string, JobRecord> = new Map([['job-1', job()]])) {
  const send = vi.fn<(tabId: number, view: JobView) => Promise<void>>(() => Promise.resolve());
  const pusher = createPusher({
    send,
    getJob: (jobId) => running.get(jobId),
    view: (record) =>
      ({ jobId: record.jobId, percent: record.ugoira?.percent }) as unknown as JobView,
  });
  return { send, pusher, running };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pusher', () => {
  it('push: sends the job’s view to its origin tab at once', () => {
    const { send, pusher, running } = setup();
    pusher.push(running.get('job-1') as JobRecord);
    expect(send.mock.calls).toEqual([[7, { jobId: 'job-1', percent: 0 }]]);
  });

  it('push: unthrottled pushes are never delayed', () => {
    const { send, pusher, running } = setup();
    const record = running.get('job-1') as JobRecord;
    pusher.push(record);
    pusher.push(record);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('push: a throttled push right after another waits for the interval', () => {
    const { send, pusher, running } = setup();
    const record = running.get('job-1') as JobRecord;
    pusher.push(record);
    pusher.push(record, true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('push: the trailing push carries the latest state', () => {
    const { send, pusher, running } = setup();
    const record = running.get('job-1') as JobRecord;
    pusher.push(record);
    pusher.push(record, true);
    (record.ugoira as { percent: number }).percent = 30;
    pusher.push(record, true);
    vi.advanceTimersByTime(PUSH_INTERVAL_MS);
    expect(send.mock.calls.map(([, view]) => view)).toEqual([
      { jobId: 'job-1', percent: 0 },
      { jobId: 'job-1', percent: 30 },
    ]);
  });

  it('push: progress reaches the tab at most 4 times in any second', () => {
    const { send, pusher, running } = setup();
    const record = running.get('job-1') as JobRecord;
    const sentAt: number[] = [];
    send.mockImplementation(() => {
      sentAt.push(Date.now());
      return Promise.resolve();
    });
    for (let ms = 0; ms < 3000; ms += 10) {
      pusher.push(record, true);
      vi.advanceTimersByTime(10);
    }
    const fifthWithinASecond = sentAt.some((t, i) => (sentAt[i + 4] ?? Infinity) - t < 1000);
    expect([sentAt.length, fifthWithinASecond]).toEqual([13, false]);
  });

  it('push: nothing is sent for a job that has ended', () => {
    const { send, pusher } = setup(new Map());
    pusher.push(job());
    expect(send).not.toHaveBeenCalled();
  });

  it('push: a trailing push is dropped when the job ends meanwhile', () => {
    const { send, pusher, running } = setup();
    const record = running.get('job-1') as JobRecord;
    pusher.push(record);
    pusher.push(record, true);
    running.clear();
    vi.advanceTimersByTime(PUSH_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('cancel: drops a pending trailing push', () => {
    const { send, pusher, running } = setup();
    const record = running.get('job-1') as JobRecord;
    pusher.push(record);
    pusher.push(record, true);
    pusher.cancel('job-1');
    vi.advanceTimersByTime(PUSH_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('push: jobs are throttled independently', () => {
    const running = new Map([
      ['a', job('a')],
      ['b', job('b')],
    ]);
    const { send, pusher } = setup(running);
    pusher.push(running.get('a') as JobRecord, true);
    pusher.push(running.get('b') as JobRecord, true);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
