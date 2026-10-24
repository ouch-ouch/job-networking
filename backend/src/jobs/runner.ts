// Starts discovery jobs with a global concurrency limit, a whole-job timeout,
// and cancellation that keeps completed results (docs/GROK-BACKEND-SPEC.md §9).
import { randomUUID } from 'node:crypto';
import { BackendFailure, toBackendFailure } from '../errors';
import { runDiscovery, type DiscoveryDeps } from '../research/discovery';
import type { DiscoveryInput, DiscoveryJob } from '../schemas';
import { UsageMeter } from '../usage';
import type { JobStore } from './store';

export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw signal.reason;
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const i = this.waiters.indexOf(grant);
        if (i !== -1) this.waiters.splice(i, 1);
        reject(signal.reason);
      };
      const grant = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      this.waiters.push(grant);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Hands the slot straight to the next waiter, if any. */
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }
}

export type RunnerDeps = DiscoveryDeps & { store: JobStore; slots: Semaphore };

function log(event: string, fields: Record<string, unknown>): void {
  // IDs, stages, and counts only: never prompts, facts, or draft text.
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

export function startDiscovery(input: DiscoveryInput, deps: RunnerDeps, idempotencyKey?: string): DiscoveryJob {
  if (idempotencyKey) {
    const existing = deps.store.byIdempotencyKey(idempotencyKey);
    if (existing) return existing.job;
  }

  const controller = new AbortController();
  const meter = new UsageMeter(deps.cfg.PRICING_VERSION);
  const job: DiscoveryJob = {
    jobId: `dj_${randomUUID()}`,
    jobContextId: input.jobContext.id,
    jobContextVersion: input.jobContext.version,
    profileVersion: input.profile.version,
    status: 'queued',
    progress: { stage: 'planning', message: 'Waiting for a research slot…' },
    recommendations: [],
    sources: [],
    usage: meter.toJSON(),
    mode: deps.provider.mode,
  };

  const run = async () => {
    const timeout = AbortSignal.timeout(deps.cfg.JOB_TIMEOUT_MS);
    const signal = AbortSignal.any([controller.signal, timeout]);
    const started = Date.now();
    try {
      await deps.slots.acquire(signal);
    } catch (err) {
      finish(controller.signal.aborted ? 'cancelled' : 'failed', toBackendFailure(signal.reason ?? err));
      return;
    }
    try {
      job.status = 'running';
      log('discovery.start', { jobId: job.jobId, mode: job.mode });
      const outcome = await runDiscovery(input, deps, meter, signal, (stage, message, partial, sources) => {
        job.progress = { stage, message };
        if (partial) job.recommendations = partial;
        if (sources) job.sources = sources;
        job.usage = meter.toJSON();
      });
      job.recommendations = outcome.recommendations;
      job.sources = outcome.sources;
      job.progress = {
        stage: 'done',
        message:
          outcome.recommendations.length === 0
            ? 'No well-supported people found. Try a broader role title or a related team.'
            : `Found ${outcome.recommendations.length} ${outcome.recommendations.length === 1 ? 'person' : 'people'}.`,
      };
      finish(outcome.failure ? 'partial' : 'succeeded', outcome.failure);
    } catch (err) {
      const failure = controller.signal.aborted
        ? new BackendFailure('cancelled', 'Research was cancelled.')
        : timeout.aborted
          ? new BackendFailure('timeout', 'Research timed out.', true)
          : toBackendFailure(err);
      const keptResults = job.recommendations.length > 0;
      finish(failure.code === 'cancelled' ? 'cancelled' : keptResults ? 'partial' : 'failed', failure);
    } finally {
      deps.slots.release();
      log('discovery.end', { jobId: job.jobId, status: job.status, ms: Date.now() - started, ...meter.toJSON() });
    }
  };

  const finish = (status: DiscoveryJob['status'], failure?: BackendFailure) => {
    job.status = status;
    job.usage = meter.toJSON();
    if (failure?.code === 'timeout' || failure?.code === 'cancelled') {
      const action = failure.code === 'timeout' ? 'Research timed out' : 'Research was cancelled';
      const count = job.recommendations.length;
      const message = count > 0
        ? `${action}. Kept ${count} verified ${count === 1 ? 'person' : 'people'} and their sources.`
        : `${action} before any people could be verified. No results were kept.`;
      failure = new BackendFailure(failure.code, message, failure.retryable, failure.retryAfterMs);
      job.progress = { stage: 'done', message };
    }
    if (failure) job.error = failure.toJSON();
    if (status !== 'succeeded' && job.progress.stage !== 'done') job.progress = { ...job.progress, message: failure?.message ?? job.progress.message };
    if (job.recommendations.length > 0) deps.registry.add(job.sources);
  };

  deps.store.add({ job, controller, createdAt: Date.now(), done: run() }, idempotencyKey);
  return job;
}

export function cancelDiscovery(jobId: string, store: JobStore): DiscoveryJob {
  const record = store.get(jobId);
  if (!record) throw new BackendFailure('job_not_found', 'This research job no longer exists. Start a new search.');
  if (record.job.status === 'queued' || record.job.status === 'running') {
    record.controller.abort(new BackendFailure('cancelled', 'Research was cancelled.'));
  }
  return record.job;
}
