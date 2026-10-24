import { describe, expect, it } from 'vitest';
import { extractJson, parseResponsesBody } from '../src/provider/xai';
import { buildContext } from '../src/research/person';
import { planSearches, relevantFacts } from '../src/research/queries';
import { MIN_SCORE, qualifies, scoreEvidence } from '../src/research/rank';
import { CitedSources, normalizeUrl, postIdForTime, postTimestamp } from '../src/research/sources';
import { DiscoveryInput, PersonResearchOutput, type Recommendation } from '../src/schemas';
import { Budget } from '../src/usage';
import { VersionTracker } from '../src/versions';
import { lengthCheck, maxSimilarity } from '../src/writing/validate';
import { job, profile } from './helpers';

describe('sources', () => {
  it('normalizes X URLs across hosts, case, and tracking params', () => {
    expect(normalizeUrl('https://twitter.com/Dana_Infra/status/123?s=20&t=abc')).toEqual({
      url: 'https://x.com/dana_infra/status/123',
      kind: 'post',
      handle: 'dana_infra',
      postId: '123',
    });
    expect(normalizeUrl('https://mobile.x.com/dana_infra')?.url).toBe('https://x.com/dana_infra');
    expect(normalizeUrl('https://x.com/i/web/status/1')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('https://blog.example.com/post?utm_source=x#top')?.url).toBe('https://blog.example.com/post');
  });

  it('only resolves URLs the provider cited', () => {
    const cited = new CitedSources(['https://x.com/a/status/1']);
    expect(cited.resolve('https://twitter.com/A/status/1')).toBeDefined();
    expect(cited.resolve('https://x.com/a/status/2')).toBeUndefined();
  });

  it('round-trips post timestamps through snowflake IDs', () => {
    const d = new Date('2026-10-01T12:00:00Z');
    expect(postTimestamp(postIdForTime(d))?.toISOString()).toBe(d.toISOString());
  });
});

describe('ranking', () => {
  const none = { role: [], company: [], interests: [], recent: [], opening: [] };

  it('scores zero without evidence and ignores interests not tied to facts', () => {
    expect(scoreEvidence(none, { interestsTiedToFacts: true }).score.total).toBe(0);
    const s = scoreEvidence({ ...none, interests: ['a', 'b'] }, { interestsTiedToFacts: false });
    expect(s.score.total).toBe(0);
  });

  it('gives no company points for inferred affiliation', () => {
    const s = scoreEvidence({ ...none, company: ['a'] }, { affiliationBasis: 'inferred', interestsTiedToFacts: false });
    expect(s.score.factors.company.points).toBe(0);
  });

  it('requires minimum score plus supported affiliation or an opening', () => {
    const base = scoreEvidence({ ...none, role: ['a', 'b'], recent: ['c'] }, { interestsTiedToFacts: false });
    expect(base.score.total).toBeGreaterThanOrEqual(MIN_SCORE);
    const rec = { ...base, affiliation: null, openingSourceId: undefined } as unknown as Recommendation;
    expect(qualifies(rec)).toBe(false);
    expect(qualifies({ ...rec, openingSourceId: 'c' })).toBe(true);
  });
});

describe('query planning', () => {
  it('uses only overlapping approved facts and excludes the user and dismissed handles', () => {
    const input = DiscoveryInput.parse({ jobContext: job, profile: { ...profile, userXHandle: '@me' }, excludePersonHandles: ['gone'] });
    const facts = relevantFacts(input.profile.facts, job.description);
    expect(facts.map((f) => f.id)).toContain('f_retry');
    expect(facts.map((f) => f.id)).not.toContain('f_school');
    const plans = planSearches(input, new Date('2026-10-24T00:00:00Z'));
    expect(plans).toHaveLength(3);
    expect(plans[0].excludedHandles).toEqual(['me', 'gone']);
    expect(plans[2].fromDate).toBe('2026-09-09');
  });
});

describe('person research', () => {
  it('needs two cited posts per style dimension and drops trait claims', () => {
    const now = new Date();
    const p = (n: number) => `https://x.com/dana/status/${postIdForTime(new Date(now.getTime() - n * 86_400_000))}`;
    const output = PersonResearchOutput.parse({
      posts: [{ url: p(1), excerpt: 'a' }, { url: p(2), excerpt: 'b' }],
      threads: [{ url: p(1), topic: 'retries' }, { url: 'https://x.com/someoneelse/status/9', topic: 'x' }],
      style: {
        length: { value: 'short', postUrls: [p(1), p(2)] },
        formality: { value: 'casual', postUrls: [p(1)] },
        directness: { value: 'seems anxious about deadlines', postUrls: [p(1), p(2)] },
        humor: { value: 'dry', postUrls: [p(1), 'https://x.com/dana/status/1'] },
      },
    });
    const { context } = buildContext({ personId: 'handle:dana', handle: 'dana' }, output, new CitedSources([p(1), p(2)]), now);
    expect(context.style.length).not.toBe('insufficient_evidence');
    expect(context.style.formality).toBe('insufficient_evidence');
    expect(context.style.directness).toBe('insufficient_evidence');
    expect(context.style.humor).toBe('insufficient_evidence');
    expect(context.recentThreads).toHaveLength(1);
    expect(context.evidenceCoverage).toBeCloseTo(0.2);
  });
});

describe('draft checks', () => {
  it('flags near-duplicate openings', () => {
    const a = 'Thanks for sharing this, I have been thinking about retries and tail latency a lot lately';
    const b = 'Thanks for sharing this, I have been thinking about retries and tail latency in queues';
    expect(maxSimilarity(b, [a]).score).toBeGreaterThan(0.5);
    expect(maxSimilarity('What did you measure for p99?', [a]).score).toBeLessThan(0.5);
  });

  it('uses X weighted length for replies and reports unknown limits for DMs', () => {
    expect(lengthCheck('x'.repeat(281), 'reply', 280).ok).toBe(false);
    expect(lengthCheck('🙂'.repeat(140), 'reply', 280).weightedLength).toBe(280);
    expect(lengthCheck('hello', 'dm', 280).limit).toBeNull();
  });
});

describe('provider parsing', () => {
  it('extracts JSON around inline citation markers and collects citations', () => {
    const parsed = parseResponsesBody({
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: '```json\n{"candidates":[{"handle":"a [[1]](https://x.com/a)"}]}\n```',
              annotations: [{ type: 'url_citation', url: 'https://x.com/a' }],
            },
          ],
        },
      ],
      citations: ['https://x.com/a/status/1'],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(parsed.citations).toEqual(['https://x.com/a', 'https://x.com/a/status/1']);
    expect(extractJson(parsed.text)).toEqual({ candidates: [{ handle: 'a ' }] });
    expect(() => extractJson('no json here')).toThrow(/structured/);
  });
});

describe('budget and versions', () => {
  it('refuses reservations past the daily limit and resets the next day', () => {
    let now = new Date('2026-10-24T10:00:00Z');
    const b = new Budget(1, () => now);
    const r = b.reserve(0.6);
    expect(() => b.reserve(0.6)).toThrow(/budget/);
    b.settle(r, 0.1);
    expect(b.remainingUsd()).toBeCloseTo(0.9);
    now = new Date('2026-10-25T10:00:00Z');
    expect(b.remainingUsd()).toBe(1);
  });

  it('marks earlier versions stale once a newer one arrives', () => {
    const v = new VersionTracker();
    expect(v.observe('j', 'v1', 'p1')).toEqual({ staleJob: false, staleProfile: false });
    v.observe('j', 'v2', 'p1');
    expect(v.observe('j', 'v1', 'p1').staleJob).toBe(true);
    expect(v.observe('j', 'v2', 'p1').staleJob).toBe(false);
  });
});
