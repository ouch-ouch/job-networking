import { describe, expect, it, vi } from 'vitest';
import { BackendFailure } from '../src/errors';
import { FixtureResearchProvider } from '../src/provider/fixture';
import type { DiscoverRequest, ProviderResult, ResearchProvider } from '../src/provider/types';
import { Budget, callProvider, UsageMeter } from '../src/usage';
import { job, makeApp, profile, testConfig } from './helpers';

const neverCompletes = () => new Promise<ProviderResult>(() => {});

function provider(discoverCandidates: ResearchProvider['discoverCandidates']): ResearchProvider {
  return {
    mode: 'live',
    checkModel: async () => 'listed',
    discoverCandidates,
    researchPerson: async () => { throw new Error('unused'); },
    composeDraft: async () => { throw new Error('unused'); },
  };
}

function callSetup() {
  const cfg = testConfig({ PROVIDER_TIMEOUT_MS: '12' });
  const budget = new Budget(cfg.BUDGET_USD_DAILY);
  return { cfg, budget, meter: new UsageMeter(cfg.PRICING_VERSION) };
}

describe('provider timeout policy', () => {
  it('does not restart an ambiguous timed-out search and reserves its possible charge', async () => {
    const deps = callSetup();
    const request = vi.fn(neverCompletes);
    await expect(callProvider(deps, 'search', deps.meter, new AbortController().signal, request))
      .rejects.toMatchObject({ code: 'timeout', retryable: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(deps.meter.providerCalls).toBe(1);
    expect(deps.meter.estimatedUsd).toBe(deps.cfg.EST_SEARCH_CALL_USD);
    expect(deps.budget.remainingUsd()).toBe(deps.cfg.BUDGET_USD_DAILY - deps.cfg.EST_SEARCH_CALL_USD);
  });

  it('still retries transient rate limits and server failures within the existing three-attempt bound', async () => {
    const deps = callSetup();
    const response: ProviderResult = { output: { candidates: [] }, citations: [], usage: {} };
    const request = vi.fn()
      .mockRejectedValueOnce(new BackendFailure('rate_limited', 'Synthetic rate limit', true, 1))
      .mockRejectedValueOnce(new BackendFailure('provider_unavailable', 'Synthetic server failure', true, 1))
      .mockResolvedValueOnce(response);
    await expect(callProvider(deps, 'search', deps.meter, new AbortController().signal, request)).resolves.toEqual(response);
    expect(request).toHaveBeenCalledTimes(3);
    expect(deps.meter.providerCalls).toBe(3);
    expect(deps.meter.estimatedUsd).toBe(deps.cfg.EST_SEARCH_CALL_USD);

    const rejected = vi.fn().mockRejectedValue(new BackendFailure('rate_limited', 'Synthetic rate limit', true, 1));
    await expect(callProvider(deps, 'search', deps.meter, new AbortController().signal, rejected)).rejects.toMatchObject({ code: 'rate_limited' });
    expect(rejected).toHaveBeenCalledTimes(3);
  });

  it('retains the generation retry policy for retryable timeouts', async () => {
    const deps = callSetup();
    const response: ProviderResult = { output: { text: 'Synthetic draft' }, citations: [], usage: {} };
    const request = vi.fn()
      .mockRejectedValueOnce(new BackendFailure('timeout', 'Synthetic timeout', true, 1))
      .mockResolvedValueOnce(response);
    await expect(callProvider(deps, 'generation', deps.meter, new AbortController().signal, request)).resolves.toEqual(response);
    expect(request).toHaveBeenCalledTimes(2);
    expect(deps.meter.estimatedUsd).toBe(deps.cfg.EST_GENERATION_CALL_USD * 2);
  });
});

describe('discovery deadlines preserve only completed verified results', () => {
  it('reports zero completed people accurately and stops dispatching searches after the deadline', async () => {
    const request = vi.fn(neverCompletes);
    const { call, deps } = makeApp(provider(request), { JOB_TIMEOUT_MS: '30', PROVIDER_TIMEOUT_MS: '200' });
    const response = await call('POST', '/v1/discovery-jobs', { jobContext: job, profile });
    const { jobId } = await response.json();
    const record = deps.store.get(jobId)!;
    await record.done;
    expect(record.job.status).toBe('failed');
    expect(record.job.recommendations).toEqual([]);
    expect(record.job.sources).toEqual([]);
    expect(record.job.error).toMatchObject({ code: 'timeout' });
    expect(record.job.error?.message).toBe('Research timed out before any people could be verified. No results were kept.');
    expect(record.job.progress.message).toBe(record.job.error?.message);
    expect(request).toHaveBeenCalledTimes(2);
    expect(record.job.usage.providerCalls).toBe(2);
  });

  it('keeps a previously published candidate and source IDs when a later search hangs', async () => {
    const fixture = new FixtureResearchProvider();
    let published: (() => void) | undefined;
    const firstResponse = new Promise<void>((resolve) => { published = resolve; });
    const request = vi.fn(async (req: DiscoverRequest) => {
      expect(req.maxCandidates).toBe(3);
      if (req.plan.intent !== 'team') return neverCompletes();
      const result = await fixture.discoverCandidates(req);
      const output = result.output as { candidates: unknown[] };
      published!();
      return { ...result, output: { candidates: output.candidates.slice(0, 1) } };
    });
    const { call, deps } = makeApp(provider(request), { JOB_TIMEOUT_MS: '100', PROVIDER_TIMEOUT_MS: '500' });
    const { jobId } = await (await call('POST', '/v1/discovery-jobs', { jobContext: job, profile })).json();
    await firstResponse;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const before = await (await call('GET', `/v1/discovery-jobs/${jobId}`)).json();
    expect(before.status).toBe('running');
    expect(before.recommendations).toHaveLength(1);
    const record = deps.store.get(jobId)!;
    await record.done;
    const result = await (await call('GET', `/v1/discovery-jobs/${jobId}`)).json();
    expect(result.status).toBe('partial');
    expect(result.error).toMatchObject({ code: 'timeout' });
    expect(result.error.message).toBe('Research timed out. Kept 1 verified person and their sources.');
    expect(result.recommendations.map((person: { personId: string }) => person.personId))
      .toEqual(before.recommendations.map((person: { personId: string }) => person.personId));
    expect(result.sources.map((source: { id: string }) => source.id))
      .toEqual(before.sources.map((source: { id: string }) => source.id));
    for (const source of result.sources) expect(deps.registry.get(source.id)?.id).toBe(source.id);
  });

  it('accurately reports cancellation before any candidate has completed', async () => {
    const { call, deps } = makeApp(provider(neverCompletes));
    const { jobId } = await (await call('POST', '/v1/discovery-jobs', { jobContext: job, profile })).json();
    const record = deps.store.get(jobId)!;
    await call('POST', `/v1/discovery-jobs/${jobId}/cancel`);
    await record.done;
    expect(record.job.status).toBe('cancelled');
    expect(record.job.recommendations).toEqual([]);
    expect(record.job.error?.message).toBe('Research was cancelled before any people could be verified. No results were kept.');
  });

  it('keeps completed candidates and their sources when the user cancels remaining searches', async () => {
    const fixture = new FixtureResearchProvider();
    const request = async (req: DiscoverRequest) => {
      if (req.plan.intent !== 'team') return neverCompletes();
      const result = await fixture.discoverCandidates(req);
      const output = result.output as { candidates: unknown[] };
      return { ...result, output: { candidates: output.candidates.slice(0, 1) } };
    };
    const { call, deps } = makeApp(provider(request));
    const { jobId } = await (await call('POST', '/v1/discovery-jobs', { jobContext: job, profile })).json();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const record = deps.store.get(jobId)!;
    expect(record.job.recommendations).toHaveLength(1);
    const ids = record.job.recommendations.map(person => person.personId);
    const sourceIds = record.job.sources.map(source => source.id);
    await call('POST', `/v1/discovery-jobs/${jobId}/cancel`);
    await record.done;
    expect(record.job.status).toBe('cancelled');
    expect(record.job.error?.message).toBe('Research was cancelled. Kept 1 verified person and their sources.');
    expect(record.job.recommendations.map(person => person.personId)).toEqual(ids);
    expect(record.job.sources.map(source => source.id)).toEqual(sourceIds);
  });
});
