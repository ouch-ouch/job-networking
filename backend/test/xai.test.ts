import { describe, expect, it } from 'vitest';
import { BackendFailure } from '../src/errors';
import { XaiResearchProvider } from '../src/provider/xai';
import type { DiscoverRequest } from '../src/provider/types';
import { job, profile } from './helpers';

const cfg = { XAI_API_KEY: 'k', XAI_BASE_URL: 'https://api.example.test/v1', XAI_MODEL: 'grok-test' };

const req: DiscoverRequest = {
  plan: { intent: 'team', focus: 'f', terms: ['Acme'], factIds: ['f_retry'], fromDate: '2026-04-27', excludedHandles: ['me'] },
  job,
  facts: [profile.facts[0] as DiscoverRequest['facts'][number]],
  maxCandidates: 5,
  today: '2026-10-24',
};

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('XaiResearchProvider', () => {
  it('sends an x_search request with bounds, no storage, and the key only in the header', async () => {
    const { impl, calls } = fakeFetch(200, {
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"candidates":[]}', annotations: [] }] }],
      citations: ['https://x.com/a/status/1'],
    });
    const result = await new XaiResearchProvider(cfg, impl).discoverCandidates(req, new AbortController().signal);

    expect(calls[0].url).toBe('https://api.example.test/v1/responses');
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.model).toBe('grok-test');
    expect(sent.store).toBe(false);
    expect(sent.max_output_tokens).toBe(8192);
    expect(sent.reasoning).toBeUndefined(); // unrecognized models keep their supported defaults
    expect(sent.tools).toEqual([{ type: 'x_search', from_date: '2026-04-27', excluded_x_handles: ['me'] }]);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.stringify(sent)).not.toContain('NYU'); // fact not selected for this plan
    expect(result.citations).toEqual(['https://x.com/a/status/1']);
  });

  it('uses low reasoning only for documented grok-4.7 search calls, without changing generation settings', async () => {
    const search = fakeFetch(200, { output_text: '{"candidates":[]}' });
    await new XaiResearchProvider({ ...cfg, XAI_MODEL: 'grok-4.7' }, search.impl)
      .discoverCandidates({ ...req, maxCandidates: 3 }, new AbortController().signal);
    const sent = JSON.parse(search.calls[0].init.body as string);
    expect(sent.reasoning).toEqual({ effort: 'low' });
    expect(sent.max_output_tokens).toBe(8192);
    expect(sent.tools[0].type).toBe('x_search');

    const generation = fakeFetch(200, { output_text: '{"text":"Synthetic draft"}' });
    await new XaiResearchProvider({ ...cfg, XAI_MODEL: 'grok-4.7' }, generation.impl).composeDraft({
      kind: 'reply', job: { employer: 'Acme', title: 'Engineer' }, facts: [], person: { handle: 'synthetic', relevance: 'Synthetic test context' },
      threads: [], style: {}, voice: { preferences: [] }, sparseEvidence: true, maxWeightedLength: 280,
    }, new AbortController().signal);
    const draft = JSON.parse(generation.calls[0].init.body as string);
    expect(draft.reasoning).toBeUndefined();
    expect(draft.max_output_tokens).toBeUndefined();
    expect(draft.tools).toBeUndefined();
  });

  it('maps HTTP failures to distinct recoverable errors', async () => {
    const run = async (status: number, headers: Record<string, string> = {}, body = '{}') => {
      const { impl } = fakeFetch(status, body, headers);
      try {
        await new XaiResearchProvider(cfg, impl).discoverCandidates(req, new AbortController().signal);
      } catch (err) {
        return err as BackendFailure;
      }
      throw new Error('expected failure');
    };
    expect((await run(401)).code).toBe('invalid_credentials');
    const limited = await run(429, { 'retry-after': '3' });
    expect([limited.code, limited.retryable, limited.retryAfterMs]).toEqual(['rate_limited', true, 3000]);
    expect((await run(400, {}, '{"error":"model not found"}')).code).toBe('model_unsupported');
    expect((await run(503)).retryable).toBe(true);
  });

  it('checks the configured model against the model list', async () => {
    const listed = fakeFetch(200, { data: [{ id: 'grok-test' }] });
    expect(await new XaiResearchProvider(cfg, listed.impl).checkModel()).toBe('listed');
    const missing = fakeFetch(200, { data: [{ id: 'other' }] });
    expect(await new XaiResearchProvider(cfg, missing.impl).checkModel()).toBe('not_listed');
  });
});
