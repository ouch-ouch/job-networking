// Budget reservations, retries, and per-request usage accounting (docs/GROK-BACKEND-SPEC.md §9).
import type { Config } from './config';
import { BackendFailure, toBackendFailure } from './errors';
import type { ProviderResult } from './provider/types';
import type { Usage } from './schemas';

type Reservation = { usd: number; day: string };

/** Daily spend guard. Stops scheduling new calls at the limit; in-flight calls can overshoot slightly. */
export class Budget {
  private day = '';
  private spent = 0;
  private reserved = 0;

  constructor(
    private readonly limitUsd: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private roll(): string {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.spent = 0;
      this.reserved = 0;
    }
    return today;
  }

  reserve(usd: number): Reservation {
    const day = this.roll();
    if (this.spent + this.reserved + usd > this.limitUsd) {
      throw new BackendFailure('budget_exhausted', 'The daily research budget is used up. Raise BUDGET_USD_DAILY or try tomorrow.');
    }
    this.reserved += usd;
    return { usd, day };
  }

  settle(r: Reservation, actualUsd: number): void {
    if (this.roll() !== r.day) return;
    this.reserved = Math.max(0, this.reserved - r.usd);
    this.spent += actualUsd;
  }

  remainingUsd(): number {
    this.roll();
    return Math.max(0, this.limitUsd - this.spent - this.reserved);
  }
}

export class UsageMeter {
  providerCalls = 0;
  estimatedUsd = 0;

  constructor(private readonly pricingVersion: string) {}

  toJSON(): Usage {
    return {
      providerCalls: this.providerCalls,
      estimatedUsd: Math.round(this.estimatedUsd * 10_000) / 10_000,
      pricingVersion: this.pricingVersion,
    };
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Retries transient provider failures at most twice, honoring retry-after. */
export async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, attempts = 3, baseMs = 500): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const f = toBackendFailure(err);
      if (!f.retryable || i >= attempts - 1 || signal.aborted) throw f;
      const backoff = baseMs * 2 ** i * (0.5 + Math.random());
      await sleep(f.retryAfterMs ?? backoff, signal);
    }
  }
}

export type CallDeps = { cfg: Config; budget: Budget };

/**
 * One budgeted provider call with a per-call timeout and bounded retries.
 * Charges the larger of the reservation and the provider-reported cost, so
 * an unverified usage field can never make spend look smaller than estimated.
 */
export async function callProvider(
  deps: CallDeps,
  kind: 'search' | 'generation',
  meter: UsageMeter,
  signal: AbortSignal,
  fn: (signal: AbortSignal) => Promise<ProviderResult>,
): Promise<ProviderResult> {
  const estimate = kind === 'search' ? deps.cfg.EST_SEARCH_CALL_USD : deps.cfg.EST_GENERATION_CALL_USD;
  return withRetry(async () => {
    if (signal.aborted) throw toBackendFailure(signal.reason);
    const reservation = deps.budget.reserve(estimate);
    meter.providerCalls++;
    const callSignal = AbortSignal.any([signal, AbortSignal.timeout(deps.cfg.PROVIDER_TIMEOUT_MS)]);
    try {
      const result = await fn(callSignal);
      const charged = result.usage.free ? 0 : Math.max(estimate, result.usage.costUsd ?? 0);
      deps.budget.settle(reservation, charged);
      meter.estimatedUsd += charged;
      return result;
    } catch (err) {
      const failure = signal.aborted ? toBackendFailure(signal.reason) : toBackendFailure(err);
      // A timed-out call may still have been billed; refused calls were not.
      const charged = failure.code === 'timeout' || failure.code === 'cancelled' ? estimate : 0;
      deps.budget.settle(reservation, charged);
      meter.estimatedUsd += charged;
      throw failure;
    }
  }, signal);
}
