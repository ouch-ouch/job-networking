// Conversational research for one selected person (docs/GROK-BACKEND-SPEC.md §7).
import { randomUUID } from 'node:crypto';
import { BackendFailure } from '../errors';
import type { ResearchProvider } from '../provider/types';
import {
  PersonResearchOutput,
  STYLE_DIMENSIONS,
  type CommunicationContext,
  type PersonResearchInput,
  type SourceRecord,
} from '../schemas';
import { callProvider, type CallDeps, type UsageMeter } from '../usage';
import { CitedSources, type SourceRegistry } from './sources';

const LOOKBACK_DAYS = 60;
const CACHE_MS = 7 * 86_400_000;
const MIN_POSTS_PER_DIMENSION = 2;
const SPARSE_COVERAGE = 0.4;

// Observations about inner states or traits are dropped even if the model returns them.
const DISALLOWED =
  /\b(anxious|anxiety|depress\w*|lonely|insecure|vulnerab\w*|desperate|needy|emotional\w*|feel(s|ing)?|mood|personality|introvert\w*|extrovert\w*|narcissis\w*|mbti|enneagram|trauma\w*|mental|religio\w*|politic\w*|sexual\w*|health|willing\w*|generous|kind-hearted|easy to (approach|persuade)|gullible)\b/i;

export function isSparse(ctx: CommunicationContext): boolean {
  return ctx.evidenceCoverage < SPARSE_COVERAGE;
}

export class ContextCache {
  private readonly byId = new Map<string, CommunicationContext>();
  private readonly byPerson = new Map<string, string>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  put(ctx: CommunicationContext): void {
    this.byId.set(ctx.id, ctx);
    this.byPerson.set(ctx.personId, ctx.id);
  }

  private fresh(ctx: CommunicationContext | undefined): CommunicationContext | undefined {
    return ctx && Date.parse(ctx.expiresAt) > this.now().getTime() ? ctx : undefined;
  }

  get(id: string): CommunicationContext | undefined {
    return this.fresh(this.byId.get(id));
  }

  forPerson(personId: string): CommunicationContext | undefined {
    const id = this.byPerson.get(personId);
    return id ? this.get(id) : undefined;
  }
}

export function buildContext(
  input: Pick<PersonResearchInput, 'personId' | 'handle'>,
  output: PersonResearchOutput,
  cited: CitedSources,
  now: Date,
): { context: CommunicationContext; sources: SourceRecord[] } {
  const handle = input.handle.toLowerCase();
  const sources = new Map<string, SourceRecord>();
  const ownPosts = (urls: (string | null | undefined)[]) => {
    const found = cited.resolveAll(urls).filter((s) => s.kind === 'post' && s.handle === handle);
    for (const s of found) sources.set(s.id, s);
    return found.map((s) => s.id);
  };

  for (const p of output.posts) cited.attachExcerpt(p.url, p.excerpt);
  ownPosts(output.posts.map((p) => p.url));

  const recentThreads = output.threads.flatMap((t) => {
    const [sourceId] = ownPosts([t.url]);
    return sourceId ? [{ sourceId, topic: t.topic, ...(t.openQuestion && { openQuestion: t.openQuestion }) }] : [];
  });

  const style = {} as CommunicationContext['style'];
  for (const dim of STYLE_DIMENSIONS) {
    const obs = output.style[dim];
    const ids = obs ? ownPosts(obs.postUrls) : [];
    style[dim] = obs && ids.length >= MIN_POSTS_PER_DIMENSION && !DISALLOWED.test(obs.value) ? { value: obs.value, sourceIds: ids } : 'insufficient_evidence';
  }
  const supported = STYLE_DIMENSIONS.filter((d) => style[d] !== 'insufficient_evidence').length;

  return {
    context: {
      id: `ctx_${randomUUID()}`,
      personId: input.personId,
      handle,
      recentThreads,
      style,
      evidenceCoverage: supported / STYLE_DIMENSIONS.length,
      expiresAt: new Date(now.getTime() + CACHE_MS).toISOString(),
    },
    sources: [...sources.values()],
  };
}

export type PersonDeps = CallDeps & { provider: ResearchProvider; registry: SourceRegistry; contexts: ContextCache; now?: () => Date };

export async function researchPerson(
  input: PersonResearchInput & { employer: string; title: string },
  deps: PersonDeps,
  meter: UsageMeter,
  signal: AbortSignal,
): Promise<{ context: CommunicationContext; sources: SourceRecord[]; cached: boolean }> {
  if (!input.refresh) {
    const cached = deps.contexts.forPerson(input.personId);
    if (cached) {
      const ids = new Set([...cached.recentThreads.map((t) => t.sourceId), ...Object.values(cached.style).flatMap((s) => (s === 'insufficient_evidence' ? [] : s.sourceIds))]);
      const sources = [...ids].flatMap((id) => deps.registry.get(id) ?? []);
      return { context: cached, sources, cached: true };
    }
  }

  const now = deps.now?.() ?? new Date();
  const fromDate = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (let attempt = 0; ; attempt++) {
    const result = await callProvider(deps, 'search', meter, signal, (s) =>
      deps.provider.researchPerson(
        { handle: input.handle, employer: input.employer, title: input.title, topicHints: input.topicHints, fromDate, today: now.toISOString().slice(0, 10) },
        s,
      ),
    );
    const parsed = PersonResearchOutput.safeParse(result.output);
    if (!parsed.success) {
      if (attempt >= 1) throw new BackendFailure('malformed_output', 'The research model returned an unexpected shape.');
      continue;
    }
    const built = buildContext(input, parsed.data, new CitedSources(result.citations, now), now);
    deps.registry.add(built.sources);
    deps.contexts.put(built.context);
    return { ...built, cached: false };
  }
}
