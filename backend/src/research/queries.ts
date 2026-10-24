// Search plans are built in code from the job and approved facts, so the model
// never decides what personal data to search with (docs/GROK-BACKEND-SPEC.md §6.2).
import type { ApprovedFact, DiscoveryInput } from '../schemas';

export type SearchIntent = 'team' | 'hiring' | 'conversation';

export type SearchPlan = {
  intent: SearchIntent;
  focus: string;
  terms: string[];
  factIds: string[];
  fromDate: string;
  excludedHandles: string[];
};

const MAX_EXCLUDED_PER_CALL = 20;
const STOPWORDS = new Set(
  `a about above after again all also an and any are as at be because been being both but by can could did do does doing
  for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not
  of off on once only or other our out over own same she should so some such than that the their them then there these they
  this those through to too under until up very was we were what when where which while who whom why will with you your
  role team work working join looking experience years ability strong skills including across within plus preferred required
  requirements responsibilities qualifications company candidates candidate we're you'll you're etc using use new help build`
    .split(/\s+/)
    .filter(Boolean),
);

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9+#.-]{1,30}/g) ?? [])
    .map((t) => t.replace(/[.-]+$/, ''))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export function keyTerms(description: string, limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const t of tokens(description)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t]) => t);
}

/** Facts that overlap the job description, best first; falls back to skills/experience. */
export function relevantFacts(facts: ApprovedFact[], description: string, limit = 6): ApprovedFact[] {
  const jobTokens = new Set(tokens(description));
  const scored = facts
    .map((f) => ({ f, overlap: tokens(f.text).filter((t) => jobTokens.has(t)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);
  if (scored.length > 0) return scored.slice(0, limit).map((x) => x.f);
  return facts.filter((f) => f.kind === 'skill' || f.kind === 'experience' || f.kind === 'project').slice(0, Math.min(limit, 4));
}

function isoDaysAgo(today: Date, days: number): string {
  return new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export function planSearches(input: DiscoveryInput, today = new Date()): SearchPlan[] {
  const { jobContext: job, profile } = input;
  const facts = relevantFacts(profile.facts, job.description);
  const factIds = facts.map((f) => f.id);
  const terms = keyTerms(job.description);
  const excludedHandles = [
    ...(profile.userXHandle ? [profile.userXHandle] : []),
    ...input.excludePersonHandles,
  ].slice(0, MAX_EXCLUDED_PER_CALL);

  const base = { factIds, excludedHandles };
  return [
    {
      ...base,
      intent: 'team',
      focus: `People who currently work at ${job.employer} on work related to the "${job.title}" role (practitioners, team members, hiring managers).`,
      terms: [job.employer, job.title, ...terms],
      fromDate: isoDaysAgo(today, 180),
    },
    {
      ...base,
      intent: 'hiring',
      focus: `Recruiters or hiring-team members at ${job.employer} who post about hiring for roles like "${job.title}".`,
      terms: [job.employer, 'hiring', job.title],
      fromDate: isoDaysAgo(today, 180),
    },
    {
      ...base,
      intent: 'conversation',
      focus: `People at ${job.employer} having recent public conversations about topics in this job that the user's approved background connects to.`,
      terms: [job.employer, ...terms.slice(0, 3)],
      fromDate: isoDaysAgo(today, 45),
    },
  ];
}
