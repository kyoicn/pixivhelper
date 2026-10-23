// JobView projection (system.md §6): the full, idempotent snapshot pushed to the origin tab.

import { jobProgress } from '../shared/progress';
import type { JobOutcome, JobView } from '../shared/types';
import type { JobRecord } from '../shared/job';

/** `outcome` is the classified end state of an ended job, and null while the job runs. */
export function toView(job: JobRecord, outcome: JobOutcome | null): JobView {
  return {
    jobId: job.jobId,
    artworkId: job.artworkId,
    kind: job.kind,
    status: outcome ? 'ended' : 'running',
    progress: jobProgress(job),
    format: job.ugoira?.format ?? null,
    folder: job.folder,
    outcome,
  };
}
