// Drafting: compose from evidence, then validate references, duplicates, and length
// (docs/GROK-BACKEND-SPEC.md §8). At most three generation calls per draft.
import { BackendFailure } from '../errors';
import { isSparse, researchPerson, type PersonDeps } from '../research/person';
import { relevantFacts } from '../research/queries';
import { DraftOutput, STYLE_DIMENSIONS, type DraftInput, type DraftResult } from '../schemas';
import type { DraftPrompt } from '../provider/types';
import { callProvider, type UsageMeter } from '../usage';
import type { VersionTracker } from '../versions';
import { DUPLICATE_THRESHOLD, lengthCheck, maxSimilarity, unknownIds } from './validate';

const MAX_GENERATIONS = 3;
const SPARSE_WARNING = 'Little public style evidence; written in your neutral voice.';

export type DraftDeps = PersonDeps & { versions: VersionTracker };

export async function generateDraft(input: DraftInput, deps: DraftDeps, meter: UsageMeter, signal: AbortSignal): Promise<DraftResult> {
  const { jobContext: job, profile, person } = input;

  const stale = deps.versions.observe(job.id, job.version, profile.version);
  if (stale.staleJob || stale.staleProfile) {
    throw new BackendFailure(
      'stale_context',
      stale.staleJob ? 'This job posting has a newer version. Refresh before drafting.' : 'Your profile has changed. Refresh before drafting.',
    );
  }

  const context =
    (input.communicationContextId && deps.contexts.get(input.communicationContextId)) ||
    (
      await researchPerson(
        {
          personId: person.personId,
          handle: person.handle,
          jobContextId: job.id,
          jobContextVersion: job.version,
          topicHints: [job.title],
          refresh: false,
          employer: job.employer,
          title: job.title,
        },
        deps,
        meter,
        signal,
      )
    ).context;
  if (context.personId !== person.personId) {
    throw new BackendFailure('invalid_input', 'The research context belongs to a different person.');
  }

  // The only source IDs a draft may cite: ones this backend issued for this person.
  const knownSources = new Map(deps.registry.forHandle(person.handle).map((s) => [s.id, s]));
  if (input.selectedSourceId && !knownSources.has(input.selectedSourceId)) {
    throw new BackendFailure('invalid_input', 'The selected post is not a known source for this person.');
  }
  const allowedSourceIds = new Set(knownSources.keys());
  const approvedFactIds = new Set(profile.facts.map((f) => f.id));
  const sparse = isSparse(context);

  const style: DraftPrompt['style'] = {};
  for (const dim of STYLE_DIMENSIONS) {
    const s = context.style[dim];
    if (s !== 'insufficient_evidence') style[dim] = s;
  }
  const selected = input.selectedSourceId ? knownSources.get(input.selectedSourceId) : undefined;
  const prompt: DraftPrompt = {
    kind: input.kind,
    job: { employer: job.employer, title: job.title },
    facts: relevantFacts(profile.facts, `${job.title} ${job.description} ${selected?.excerpt ?? ''}`, 8),
    person: {
      handle: person.handle,
      ...(person.displayName && { displayName: person.displayName }),
      relevance: person.relevance,
      ...(person.affiliationClaim && { affiliationClaim: person.affiliationClaim }),
    },
    threads: context.recentThreads.map((t) => ({ ...t, excerpt: knownSources.get(t.sourceId)?.excerpt })),
    style: sparse ? {} : style,
    ...(selected && { selectedSource: { sourceId: selected.id, excerpt: selected.excerpt } }),
    ...(input.userGoal && { userGoal: input.userGoal }),
    voice: profile.voice,
    sparseEvidence: sparse,
    maxWeightedLength: input.kind === 'reply' ? deps.cfg.X_REPLY_LIMIT : null,
  };

  let malformedOnce = false;
  let lastProblem: BackendFailure | undefined;
  for (let generation = 1; generation <= MAX_GENERATIONS; generation++) {
    const result = await callProvider(deps, 'generation', meter, signal, (s) => deps.provider.composeDraft(prompt, s));
    const parsed = DraftOutput.safeParse(result.output);
    if (!parsed.success) {
      if (malformedOnce) throw new BackendFailure('malformed_output', 'The writing model returned malformed output twice.');
      malformedOnce = true;
      continue;
    }
    const out = parsed.data;
    const badFacts = unknownIds(out.factIdsUsed, approvedFactIds);
    const badSources = unknownIds([...out.sourceIdsUsed, ...out.styleEvidenceIds], allowedSourceIds);
    if (badFacts.length || badSources.length) {
      lastProblem = new BackendFailure('reference_invalid', 'The draft referenced facts or sources that are not on record, so it was not marked ready.');
      prompt.revisionNote = 'Use only the fact IDs and source IDs provided in the data blocks.';
      continue;
    }

    const warnings = [...out.warnings];
    const isLast = generation === MAX_GENERATIONS;
    const similar = maxSimilarity(out.text, input.otherDraftTexts);
    if (similar.score > DUPLICATE_THRESHOLD) {
      if (!isLast) {
        prompt.revisionNote = similar.opening
          ? 'The opening is too similar to another draft for this job. Open differently, from this person\'s post.'
          : 'This draft is too similar to another draft for this job. Write it fresh from this person\'s post and ask a different question.';
        continue;
      }
      warnings.push('This draft is similar to another draft for this job; edit it before sending.');
    }

    const length = lengthCheck(out.text, input.kind, deps.cfg.X_REPLY_LIMIT);
    if (!length.ok) {
      if (!isLast) {
        prompt.revisionNote = `Shorten to under ${length.limit} characters as X counts them.`;
        continue;
      }
      warnings.push(`Longer than ${length.limit} characters as X counts them; shorten before sending.`);
    }
    if (length.limit === null) warnings.push('Length limit for this surface depends on the account; check before sending.');
    if (sparse) warnings.push(SPARSE_WARNING);

    return {
      kind: input.kind,
      text: out.text,
      profileVersion: profile.version,
      jobContextId: job.id,
      jobContextVersion: job.version,
      personId: person.personId,
      styleEvidenceIds: sparse ? [] : out.styleEvidenceIds,
      factIdsUsed: out.factIdsUsed,
      sourceIdsUsed: out.sourceIdsUsed,
      warnings: [...new Set(warnings)],
      approach: out.approach,
      lengthCheck: length,
      sparseEvidence: sparse,
      mode: deps.provider.mode,
    };
  }
  throw lastProblem ?? new BackendFailure('malformed_output', 'The writing model did not return a usable draft.');
}
