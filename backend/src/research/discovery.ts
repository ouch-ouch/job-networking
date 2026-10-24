// Discovery pipeline: plan → search → validate against citations → merge → score → select
// (docs/GROK-BACKEND-SPEC.md §6).
import { BackendFailure, toBackendFailure } from '../errors';
import type { ResearchProvider } from '../provider/types';
import {
  CandidateOutput,
  CandidatesEnvelope,
  type AffiliationBasis,
  type DiscoveryInput,
  type DiscoveryJob,
  type Recommendation,
  type SourceRecord,
} from '../schemas';
import { callProvider, type CallDeps, type UsageMeter } from '../usage';
import { planSearches, relevantFacts, type SearchPlan } from './queries';
import { scoreEvidence, selectTop, type FactorEvidence } from './rank';
import { CitedSources, type SourceRegistry } from './sources';

const SEARCH_PARALLELISM = 2;
const RECENT_DAYS = 45;
const CANDIDATES_PER_SEARCH = 5;
const BASIS_STRENGTH: Record<AffiliationBasis, number> = { bio: 3, own_post: 2, third_party: 1, inferred: 0 };

export type DiscoveryDeps = CallDeps & { provider: ResearchProvider; registry: SourceRegistry; now?: () => Date };

type Progress = (stage: DiscoveryJob['progress']['stage'], message: string, partial?: Recommendation[], sources?: SourceRecord[]) => void;

export type DiscoveryOutcome = {
  recommendations: Recommendation[];
  sources: SourceRecord[];
  failure?: BackendFailure; // set when some searches failed but results exist
};

/** A validated candidate before scoring, with its evidence expressed as source IDs. */
type Resolved = {
  rec: Omit<Recommendation, 'score' | 'evidenceCoverage'>;
  evidence: FactorEvidence;
  sources: Map<string, SourceRecord>;
};

export function resolveCandidate(
  raw: CandidateOutput,
  cited: CitedSources,
  approvedFactIds: Set<string>,
  now: Date,
): Resolved {
  const handle = raw.handle.toLowerCase();
  const sources = new Map<string, SourceRecord>();
  const keep = (records: SourceRecord[]) => {
    for (const r of records) sources.set(r.id, r);
    return records.map((r) => r.id);
  };
  // Posts must belong to this person to count as their activity.
  const ownPosts = (urls: (string | null | undefined)[]) =>
    cited.resolveAll(urls).filter((s) => s.kind === 'post' && s.handle === handle);

  for (const p of raw.posts) cited.attachExcerpt(p.url, p.excerpt);

  const uncertainties = [...raw.uncertainties];
  let affiliation: Recommendation['affiliation'] = null;
  if (raw.affiliation) {
    const ids = keep(cited.resolveAll(raw.affiliation.sourceUrls));
    if (ids.length > 0) {
      affiliation = { claim: raw.affiliation.claim, basis: raw.affiliation.basis, sourceIds: ids };
    } else {
      affiliation = { claim: raw.affiliation.claim, basis: 'inferred', sourceIds: [] };
      uncertainties.push('Affiliation is not supported by a cited source.');
    }
  }

  const cutoff = now.getTime() - RECENT_DAYS * 86_400_000;
  const recent = ownPosts(raw.recentPostUrls).filter((s) => s.publishedAt && Date.parse(s.publishedAt) >= cutoff);
  const opening = ownPosts([raw.openingPostUrl]);
  const factIdsUsed = raw.factIdsUsed.filter((id) => approvedFactIds.has(id));

  const evidence: FactorEvidence = {
    role: keep(cited.resolveAll(raw.roleEvidenceUrls)),
    company: affiliation?.sourceIds ?? [],
    interests: keep(cited.resolveAll(raw.interestEvidenceUrls)),
    recent: keep(recent),
    opening: keep(opening),
  };

  return {
    rec: {
      personId: raw.xUserId ? `x:${raw.xUserId}` : `handle:${handle}`,
      handle,
      ...(raw.displayName && { displayName: raw.displayName }),
      category: raw.category,
      affiliation,
      relevance: raw.relevance,
      userContribution: raw.userContribution,
      factIdsUsed,
      ...(evidence.opening[0] && { openingSourceId: evidence.opening[0] }),
      suggestedAction: raw.suggestedAction,
      uncertainties,
    },
    evidence,
    sources,
  };
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/** Merges the same person found by several searches; keeps the strongest affiliation. */
export function mergeResolved(items: Resolved[]): Resolved[] {
  const byHandle = new Map<string, Resolved>();
  for (const item of items) {
    const prev = byHandle.get(item.rec.handle);
    if (!prev) {
      // Copy so partial rankings during the job never mutate the collected results.
      const evidence = Object.fromEntries(Object.entries(item.evidence).map(([k, v]) => [k, [...v]])) as FactorEvidence;
      byHandle.set(item.rec.handle, { rec: { ...item.rec }, evidence, sources: new Map(item.sources) });
      continue;
    }
    const strongerAffiliation =
      (item.rec.affiliation && !prev.rec.affiliation) ||
      (item.rec.affiliation && prev.rec.affiliation && BASIS_STRENGTH[item.rec.affiliation.basis] > BASIS_STRENGTH[prev.rec.affiliation.basis]);
    prev.rec = {
      ...prev.rec,
      personId: prev.rec.personId.startsWith('x:') ? prev.rec.personId : item.rec.personId,
      affiliation: strongerAffiliation ? item.rec.affiliation : prev.rec.affiliation,
      factIdsUsed: union(prev.rec.factIdsUsed, item.rec.factIdsUsed),
      openingSourceId: prev.rec.openingSourceId ?? item.rec.openingSourceId,
      uncertainties: union(prev.rec.uncertainties, item.rec.uncertainties),
    };
    for (const k of Object.keys(prev.evidence) as (keyof FactorEvidence)[]) {
      prev.evidence[k] = union(prev.evidence[k], item.evidence[k]);
    }
    prev.evidence.company = prev.rec.affiliation?.sourceIds ?? [];
    for (const [id, s] of item.sources) prev.sources.set(id, s);
  }
  return [...byHandle.values()];
}

function parseCandidates(output: unknown): CandidateOutput[] {
  const envelope = CandidatesEnvelope.safeParse(output);
  if (!envelope.success) throw new BackendFailure('malformed_output', 'The research model returned an unexpected shape.');
  // One bad candidate does not discard the others.
  return envelope.data.candidates.flatMap((c) => {
    const parsed = CandidateOutput.safeParse(c);
    return parsed.success ? [parsed.data] : [];
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function runDiscovery(
  input: DiscoveryInput,
  deps: DiscoveryDeps,
  meter: UsageMeter,
  signal: AbortSignal,
  progress: Progress,
): Promise<DiscoveryOutcome> {
  const now = deps.now?.() ?? new Date();
  const plans = planSearches(input, now);
  const facts = relevantFacts(input.profile.facts, input.jobContext.description);
  const approvedFactIds = new Set(input.profile.facts.map((f) => f.id));
  const excluded = new Set([...input.excludePersonHandles, input.profile.userXHandle ?? ''].map((h) => h.toLowerCase()));

  progress('searching', `Searching X (${plans.length} searches)…`);
  const resolved: Resolved[] = [];

  const searchOne = async (plan: SearchPlan) => {
    // Malformed output gets one regeneration; transient errors are retried inside callProvider.
    for (let attempt = 0; ; attempt++) {
      const result = await callProvider(deps, 'search', meter, signal, (s) =>
        deps.provider.discoverCandidates(
          { plan, job: input.jobContext, facts, maxCandidates: CANDIDATES_PER_SEARCH, today: now.toISOString().slice(0, 10) },
          s,
        ),
      );
      try {
        const cited = new CitedSources(result.citations, now);
        const found = parseCandidates(result.output)
          .filter((c) => !excluded.has(c.handle.toLowerCase()))
          .map((c) => resolveCandidate(c, cited, approvedFactIds, now));
        resolved.push(...found);
        const partial = rank(mergeResolved([...resolved]), input.maxResults);
        progress('searching', `Finished the ${plan.intent} search.`, partial.recommendations, partial.sources);
        return;
      } catch (err) {
        if (attempt >= 1 || !(err instanceof BackendFailure) || err.code !== 'malformed_output') throw err;
      }
    }
  };

  const settled = await mapLimit(plans, SEARCH_PARALLELISM, searchOne);
  if (signal.aborted) throw toBackendFailure(signal.reason);
  const failures = settled.flatMap((s) => (s.status === 'rejected' ? [toBackendFailure(s.reason)] : []));

  progress('validating', 'Checking sources…');
  if (failures.length === plans.length) throw failures[0];

  progress('ranking', 'Ranking people…');
  const ranked = rank(mergeResolved(resolved), input.maxResults);
  deps.registry.add(ranked.sources);
  return { ...ranked, ...(failures.length > 0 && { failure: failures[0] }) };
}

function rank(items: Resolved[], max: number): { recommendations: Recommendation[]; sources: SourceRecord[] } {
  const scored = items.map((item) => ({
    item,
    rec: {
      ...item.rec,
      ...scoreEvidence(item.evidence, {
        affiliationBasis: item.rec.affiliation?.basis,
        interestsTiedToFacts: item.rec.factIdsUsed.length > 0,
      }),
    } satisfies Recommendation,
  }));
  const top = selectTop(
    scored.map((s) => s.rec),
    max,
  );
  const topHandles = new Set(top.map((r) => r.handle));
  const sources = new Map<string, SourceRecord>();
  for (const s of scored) if (topHandles.has(s.rec.handle)) for (const [id, src] of s.item.sources) sources.set(id, src);
  return { recommendations: top, sources: [...sources.values()] };
}
