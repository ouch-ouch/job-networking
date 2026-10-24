// In-memory discovery jobs for the hackathon (docs/GROK-BACKEND-SPEC.md §5).
// A restart loses them; the client sees job_not_found, never an empty result.
import type { DiscoveryJob } from '../schemas';

export type JobRecord = {
  job: DiscoveryJob;
  controller: AbortController;
  createdAt: number;
  done: Promise<void>;
};

export class JobStore {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly idempotency = new Map<string, string>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  add(record: JobRecord, idempotencyKey?: string): void {
    this.sweep();
    this.jobs.set(record.job.jobId, record);
    if (idempotencyKey) this.idempotency.set(idempotencyKey, record.job.jobId);
  }

  get(jobId: string): JobRecord | undefined {
    this.sweep();
    return this.jobs.get(jobId);
  }

  byIdempotencyKey(key: string): JobRecord | undefined {
    const id = this.idempotency.get(key);
    return id ? this.get(id) : undefined;
  }

  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, r] of this.jobs) {
      const finished = r.job.status !== 'queued' && r.job.status !== 'running';
      if (finished && r.createdAt < cutoff) this.jobs.delete(id);
    }
    for (const [key, id] of this.idempotency) if (!this.jobs.has(id)) this.idempotency.delete(key);
  }
}
