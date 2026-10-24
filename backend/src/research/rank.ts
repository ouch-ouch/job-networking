// Evidence-based score from the main spec §7. Computed in code; the model only
// supplies evidence. Missing evidence scores zero. Never uses follower counts.
import type { AffiliationBasis, Recommendation, ScoreFactor } from '../schemas';

export const SCORE_VERSION = 'rank-v1';
export const MIN_SCORE = 35;

export type FactorEvidence = Record<ScoreFactor, string[]>;

export function scoreEvidence(
  evidence: FactorEvidence,
  opts: { affiliationBasis?: AffiliationBasis; interestsTiedToFacts: boolean },
): Pick<Recommendation, 'score' | 'evidenceCoverage'> {
  const points: Record<ScoreFactor, number> = {
    role: evidence.role.length >= 2 ? 30 : evidence.role.length === 1 ? 18 : 0,
    company:
      evidence.company.length === 0 || opts.affiliationBasis === 'inferred'
        ? 0
        : opts.affiliationBasis === 'third_party'
          ? 12
          : 20,
    interests: !opts.interestsTiedToFacts ? 0 : evidence.interests.length >= 2 ? 20 : evidence.interests.length === 1 ? 12 : 0,
    recent: evidence.recent.length > 0 ? 15 : 0,
    opening: evidence.opening.length > 0 ? 15 : 0,
  };

  const factors = Object.fromEntries(
    (Object.keys(points) as ScoreFactor[]).map((f) => [f, { points: points[f], sourceIds: points[f] > 0 ? evidence[f] : [] }]),
  ) as Recommendation['score']['factors'];

  const total = Object.values(points).reduce((a, b) => a + b, 0);
  const covered = Object.values(points).filter((p) => p > 0).length;
  return { score: { total, version: SCORE_VERSION, factors }, evidenceCoverage: covered / 5 };
}

export function qualifies(rec: Recommendation): boolean {
  const supportedAffiliation = !!rec.affiliation && rec.affiliation.sourceIds.length > 0;
  return rec.score.total >= MIN_SCORE && (supportedAffiliation || !!rec.openingSourceId);
}

export function selectTop(recs: Recommendation[], max: number): Recommendation[] {
  return recs
    .filter(qualifies)
    .sort((a, b) => b.score.total - a.score.total || b.evidenceCoverage - a.evidenceCoverage)
    .slice(0, max);
}
