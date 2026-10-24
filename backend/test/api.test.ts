import { describe, expect, it } from 'vitest';
import { BackendFailure } from '../src/errors';
import { FixtureResearchProvider } from '../src/provider/fixture';
import type { ResearchProvider } from '../src/provider/types';
import { job, makeApp, profile, waitForJob } from './helpers';

async function discover(call: ReturnType<typeof makeApp>['call']) {
  const start = await call('POST', '/v1/discovery-jobs', { jobContext: job, profile });
  expect(start.status).toBe(202);
  const { jobId } = await start.json();
  return waitForJob(call, jobId);
}

describe('fixture end-to-end flow', () => {
  it('finds up to three evidenced people and drops the uncited one', async () => {
    const { call } = makeApp(new FixtureResearchProvider());
    const result = await discover(call);

    expect(result.status).toBe('succeeded');
    expect(result.mode).toBe('fixture');
    const handles = result.recommendations.map((r: { handle: string }) => r.handle);
    expect(handles).toEqual(['fx_dana', 'fx_maya_hires', 'fx_sam']);
    expect(handles).not.toContain('fx_uncited');

    const sourceIds = new Set(result.sources.map((s: { id: string }) => s.id));
    for (const rec of result.recommendations) {
      expect(rec.affiliation.sourceIds.length).toBeGreaterThan(0);
      for (const f of Object.values(rec.score.factors) as { sourceIds: string[] }[]) {
        for (const id of f.sourceIds) expect(sourceIds.has(id)).toBe(true);
      }
    }
    expect(result.recommendations[0].score.total).toBeGreaterThan(result.recommendations[1].score.total);
  });

  it('writes distinct drafts for different styles and a neutral, warned draft for sparse evidence', async () => {
    const { call } = makeApp(new FixtureResearchProvider());
    const result = await discover(call);
    const [dana, maya, sam] = result.recommendations;

    const draftFor = async (rec: typeof dana, otherDraftTexts: string[] = []) => {
      const res = await call('POST', '/v1/drafts', {
        kind: 'reply',
        jobContext: job,
        profile,
        person: { personId: rec.personId, handle: rec.handle, relevance: rec.relevance },
        selectedSourceId: rec.openingSourceId,
        otherDraftTexts,
      });
      expect(res.status).toBe(200);
      return (await res.json()).draft;
    };

    const d1 = await draftFor(dana);
    const d2 = await draftFor(maya, [d1.text]);
    expect(d1.text).not.toEqual(d2.text);
    expect(d1.sparseEvidence).toBe(false);
    expect(d1.styleEvidenceIds.length).toBeGreaterThan(0);
    expect(d1.sourceIdsUsed).toEqual([dana.openingSourceId]);
    expect(d1.lengthCheck.ok).toBe(true);
    expect(d1.mode).toBe('fixture');

    const d3 = await draftFor(sam, [d1.text, d2.text]);
    expect(d3.sparseEvidence).toBe(true);
    expect(d3.styleEvidenceIds).toEqual([]);
    expect(d3.warnings).toContain('Little public style evidence; written in your neutral voice.');
  });

  it('rejects drafting against a replaced job version', async () => {
    const { call } = makeApp(new FixtureResearchProvider());
    const result = await discover(call);
    await call('POST', '/v1/discovery-jobs', { jobContext: { ...job, version: 'v2' }, profile });
    const rec = result.recommendations[0];
    const res = await call('POST', '/v1/drafts', {
      kind: 'dm',
      jobContext: job,
      profile,
      person: { personId: rec.personId, handle: rec.handle },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('stale_context');
  });
});

describe('validation and safety', () => {
  it('rejects a draft that cites a source the backend never issued', async () => {
    const fixture = new FixtureResearchProvider();
    const lying: ResearchProvider = {
      mode: 'fixture',
      checkModel: () => fixture.checkModel(),
      discoverCandidates: (r) => fixture.discoverCandidates(r),
      researchPerson: (r) => fixture.researchPerson(r),
      composeDraft: async () => ({
        output: { text: 'Hello', factIdsUsed: ['f_retry'], sourceIdsUsed: ['src_madeup'], styleEvidenceIds: [], approach: '', warnings: [] },
        citations: [],
        usage: { free: true },
      }),
    };
    const { call } = makeApp(lying);
    const result = await discover(call);
    const rec = result.recommendations[0];
    const res = await call('POST', '/v1/drafts', { kind: 'reply', jobContext: job, profile, person: { personId: rec.personId, handle: rec.handle } });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('reference_invalid');
  });

  it('requires the bearer token and does not echo submitted content on bad input', async () => {
    const { call } = makeApp(new FixtureResearchProvider());
    expect((await call('GET', '/v1/discovery-jobs/x', undefined, { Authorization: 'Bearer wrong' })).status).toBe(401);
    const bad = await call('POST', '/v1/discovery-jobs', { jobContext: { ...job, title: '' }, profile: { ...profile, facts: [] } });
    expect(bad.status).toBe(400);
    const text = JSON.stringify(await bad.json());
    expect(text).toContain('jobContext.title');
    expect(text).not.toContain('retry budget');
  });

  it('returns job_not_found for unknown jobs and health without auth', async () => {
    const { app, call } = makeApp(new FixtureResearchProvider());
    expect((await call('GET', '/v1/discovery-jobs/dj_nope')).status).toBe(404);
    const health = await app.request('/v1/health');
    expect(health.status).toBe(200);
    expect(((await health.json()) as { mode: string }).mode).toBe('fixture');
  });

  it('stops at the budget and reports budget_exhausted', async () => {
    const paid: ResearchProvider = {
      mode: 'live',
      checkModel: async () => 'listed',
      discoverCandidates: async () => ({ output: { candidates: [] }, citations: [], usage: {} }),
      researchPerson: async () => {
        throw new Error('unused');
      },
      composeDraft: async () => {
        throw new Error('unused');
      },
    };
    const { call } = makeApp(paid, { BUDGET_USD_DAILY: '0.5', EST_SEARCH_CALL_USD: '0.25' });
    const result = await discover(call);
    // Two searches fit the budget, the third is refused; the empty searches still count as success.
    expect(result.usage.providerCalls).toBe(2);
    expect(result.status).toBe('partial');
    expect(result.error.code).toBe('budget_exhausted');
    expect(result.recommendations).toEqual([]);
  });

  it('cancels a running job and keeps its state', async () => {
    const slow: ResearchProvider = {
      mode: 'live',
      checkModel: async () => 'listed',
      discoverCandidates: (_r, signal) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
      researchPerson: async () => {
        throw new BackendFailure('provider_unavailable', 'unused');
      },
      composeDraft: async () => {
        throw new BackendFailure('provider_unavailable', 'unused');
      },
    };
    const { call } = makeApp(slow);
    const { jobId } = await (await call('POST', '/v1/discovery-jobs', { jobContext: job, profile })).json();
    await new Promise((r) => setTimeout(r, 20));
    expect((await call('POST', `/v1/discovery-jobs/${jobId}/cancel`)).status).toBe(200);
    const result = await waitForJob(call, jobId);
    expect(result.status).toBe('cancelled');
    expect(result.error.code).toBe('cancelled');
  });

  it('reuses a job for the same idempotency key', async () => {
    const { call } = makeApp(new FixtureResearchProvider());
    const headers = { 'Idempotency-Key': 'abc-1' };
    const a = await (await call('POST', '/v1/discovery-jobs', { jobContext: job, profile }, headers)).json();
    const b = await (await call('POST', '/v1/discovery-jobs', { jobContext: job, profile }, headers)).json();
    expect(a.jobId).toBe(b.jobId);
  });
});

describe('fixture scoring', () => {
  it('counts the same post once across searches', async () => {
    const { call } = makeApp(new FixtureResearchProvider());
    const result = await discover(call);
    expect(result.recommendations.map((r: { score: { total: number } }) => r.score.total)).toEqual([92, 68, 53]);
  });
});
