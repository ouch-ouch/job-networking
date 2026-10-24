// Labeled demo data (docs/GROK-BACKEND-SPEC.md §10). Every response that uses it
// carries mode: "fixture"; never present it as live research.
// Three people with deliberately different evidence: a terse technical practitioner,
// a friendly recruiter, and a sparse-evidence engineer. A fourth candidate cites an
// uncited URL to exercise source validation.
import { postIdForTime } from '../research/sources';
import type { DiscoverRequest, DraftPrompt, ModelStatus, PersonRequest, ProviderResult, ResearchProvider } from './types';

const DAY = 86_400_000;

function post(handle: string, daysAgo: number, now: Date, seq: number): string {
  return `https://x.com/${handle}/status/${postIdForTime(new Date(now.getTime() - daysAgo * DAY), seq)}`;
}

function people(now: Date) {
  const dana = 'fx_dana';
  const maya = 'fx_maya_hires';
  const sam = 'fx_sam';
  return {
    dana: {
      handle: dana,
      profile: `https://x.com/${dana}`,
      posts: [post(dana, 2, now, 1), post(dana, 5, now, 2), post(dana, 9, now, 3), post(dana, 20, now, 4)],
    },
    maya: { handle: maya, profile: `https://x.com/${maya}`, posts: [post(maya, 1, now, 5), post(maya, 6, now, 6), post(maya, 12, now, 7)] },
    sam: { handle: sam, profile: `https://x.com/${sam}`, posts: [post(sam, 3, now, 8)] },
  };
}

export class FixtureResearchProvider implements ResearchProvider {
  readonly mode = 'fixture' as const;

  private readonly base: Date;

  // Post IDs are derived from one fixed time so the same post keeps the same ID across calls.
  constructor(now: () => Date = () => new Date()) {
    this.base = now();
  }

  async checkModel(): Promise<ModelStatus> {
    return 'fixture';
  }

  async discoverCandidates(req: DiscoverRequest): Promise<ProviderResult> {
    const p = people(this.base);
    const employer = req.job.employer;
    const factId = req.facts[0]?.id;
    const factIds = factId ? [factId] : [];
    const candidates = [
      {
        handle: p.dana.handle,
        displayName: 'Dana (fixture)',
        category: 'practitioner',
        affiliation: { claim: `Engineer at ${employer} (bio)`, basis: 'bio', sourceUrls: [p.dana.profile] },
        relevance: `Posts in detail about the systems this ${req.job.title} role works on.`,
        userContribution: 'Your approved project experience overlaps the tradeoff Dana raised this week.',
        factIdsUsed: factIds,
        roleEvidenceUrls: [p.dana.profile, p.dana.posts[1]],
        interestEvidenceUrls: [p.dana.posts[2]],
        recentPostUrls: [p.dana.posts[0]],
        openingPostUrl: p.dana.posts[0],
        suggestedAction: 'reply',
        posts: [
          { url: p.dana.posts[0], excerpt: 'Anyone measured p99 impact of moving retries client-side? Ours got worse, not better.' },
          { url: p.dana.posts[1], excerpt: 'Hot take: most queue backpressure bugs are config bugs.' },
        ],
        uncertainties: [],
      },
      {
        handle: p.maya.handle,
        displayName: 'Maya (fixture)',
        category: 'recruiter',
        affiliation: { claim: `Technical recruiter at ${employer} (bio)`, basis: 'bio', sourceUrls: [p.maya.profile] },
        relevance: `Recently posted that ${employer} is hiring for roles like this one.`,
        userContribution: 'A specific question about the team behind this posting.',
        factIdsUsed: [],
        roleEvidenceUrls: [p.maya.posts[0]],
        interestEvidenceUrls: [],
        recentPostUrls: [p.maya.posts[0]],
        openingPostUrl: p.maya.posts[0],
        suggestedAction: 'ask_question',
        posts: [{ url: p.maya.posts[0], excerpt: `We're growing the platform team at ${employer}! Happy to answer questions about what the work looks like 🙂` }],
        uncertainties: ['Not confirmed which team this posting belongs to.'],
      },
      {
        handle: p.sam.handle,
        displayName: 'Sam (fixture)',
        category: 'practitioner',
        affiliation: { claim: `Mentions working at ${employer}`, basis: 'own_post', sourceUrls: [p.sam.posts[0]] },
        relevance: 'Works in a related area; posts rarely.',
        userContribution: 'Shared tooling interest.',
        factIdsUsed: [],
        roleEvidenceUrls: [p.sam.posts[0]],
        interestEvidenceUrls: [],
        recentPostUrls: [p.sam.posts[0]],
        openingPostUrl: null,
        suggestedAction: 'read',
        posts: [{ url: p.sam.posts[0], excerpt: `First month at ${employer} done. Learned a lot about our build pipeline.` }],
        uncertainties: ['Very little public activity.'],
      },
      {
        handle: 'fx_uncited',
        displayName: 'Uncited (fixture)',
        category: 'professional_connection',
        affiliation: { claim: `Leads hiring at ${employer}`, basis: 'bio', sourceUrls: ['https://x.com/fx_uncited'] },
        relevance: 'Model narrative only; none of these URLs were cited, so validation should drop this person.',
        userContribution: '',
        factIdsUsed: factIds,
        roleEvidenceUrls: ['https://x.com/fx_uncited/status/1'],
        interestEvidenceUrls: [],
        recentPostUrls: [],
        openingPostUrl: 'https://x.com/fx_uncited/status/2',
        suggestedAction: 'dm',
        posts: [],
        uncertainties: [],
      },
    ];
    const citations = [p.dana.profile, ...p.dana.posts, p.maya.profile, ...p.maya.posts, ...p.sam.posts];
    return { output: { candidates }, citations, usage: { free: true } };
  }

  async researchPerson(req: PersonRequest): Promise<ProviderResult> {
    const p = people(this.base);
    const obs = (value: string, postUrls: string[]) => ({ value, postUrls });
    if (req.handle === p.dana.handle) {
      const [a, b, c, d] = p.dana.posts;
      return {
        output: {
          posts: [
            { url: a, excerpt: 'Anyone measured p99 impact of moving retries client-side? Ours got worse, not better.', topic: 'retries and tail latency' },
            { url: b, excerpt: 'Hot take: most queue backpressure bugs are config bugs.', topic: 'backpressure' },
            { url: c, excerpt: 'Wrote up our load-shedding numbers. Short version: shed earlier.', topic: 'load shedding' },
            { url: d, excerpt: 'If your dashboard has 40 graphs you have zero graphs.', topic: 'observability' },
          ],
          threads: [{ url: a, topic: 'client-side retries and p99 latency', openQuestion: 'Has anyone measured p99 after moving retries client-side?' }],
          style: {
            length: obs('one or two short sentences', [a, b, d]),
            formality: obs('informal, no greetings', [a, b]),
            technical_depth: obs('names specific metrics and mechanisms', [a, c]),
            directness: obs('states opinions plainly', [b, d]),
            humor: obs('dry one-liners', [b, d]),
          },
        },
        citations: [a, b, c, d],
        usage: { free: true },
      };
    }
    if (req.handle === p.maya.handle) {
      const [a, b, c] = p.maya.posts;
      return {
        output: {
          posts: [
            { url: a, excerpt: "We're growing the platform team! Happy to answer questions about what the work looks like 🙂", topic: 'hiring' },
            { url: b, excerpt: 'Tip for applicants: tell me which problem on the team excites you, not just the stack.', topic: 'applicant advice' },
            { url: c, excerpt: 'Loved meeting everyone at the career fair today, thank you for the great questions!', topic: 'events' },
          ],
          threads: [{ url: a, topic: 'platform team hiring', openQuestion: 'Questions about what the work looks like' }],
          style: {
            length: obs('a few friendly sentences', [a, b, c]),
            formality: obs('warm and conversational', [a, c]),
            technical_depth: null,
            directness: obs('gives concrete advice', [b, a]),
            humor: obs('light, uses an emoji occasionally', [a, c]),
          },
        },
        citations: [a, b, c],
        usage: { free: true },
      };
    }
    const [a] = p.sam.posts;
    return {
      output: {
        posts: [{ url: a, excerpt: 'First month done. Learned a lot about our build pipeline.', topic: 'build tooling' }],
        threads: [{ url: a, topic: 'build pipeline', openQuestion: null }],
        style: { length: obs('short', [a]), formality: obs('casual', [a]), technical_depth: null, directness: null, humor: null },
      },
      citations: a ? [a] : [],
      usage: { free: true },
    };
  }

  async composeDraft(req: DraftPrompt): Promise<ProviderResult> {
    const sourceId = req.selectedSource?.sourceId ?? req.threads[0]?.sourceId;
    const styleIds = [...new Set(Object.values(req.style).flatMap((s) => s?.sourceIds ?? []))];
    const factIds = req.facts.slice(0, 1).map((f) => f.id);
    const text = fixtureText(req.person.handle, req.kind);
    return {
      output: {
        text,
        factIdsUsed: factIds,
        sourceIdsUsed: sourceId ? [sourceId] : [],
        styleEvidenceIds: styleIds.slice(0, 4),
        approach: `[fixture] Responds to @${req.person.handle}'s recent post${req.sparseEvidence ? ' in a neutral voice because style evidence is sparse' : ', matching their observed length and tone'}.`,
        warnings: [],
      },
      citations: [],
      usage: { free: true },
    };
  }
}

function fixtureText(handle: string, kind: DraftPrompt['kind']): string {
  if (handle === 'fx_dana') {
    return kind === 'reply'
      ? 'We saw the same thing: client-side retries without a budget doubled our p99 under partial outages. Capping retries per request fixed most of it. Did you try a retry budget?'
      : 'Your retries post matched something I hit on a project. Would you be up for a 15-minute chat about how your team handles tail latency?';
  }
  if (handle === 'fx_maya_hires') {
    return kind === 'reply'
      ? "Thanks for offering! What's the biggest problem the platform team is working on this year? I'm applying for the open role and want to make sure my experience lines up with it."
      : "Hi Maya, I saw your post about the platform team. I'm applying for the open role and would love to hear which problems the team is most focused on. Would a quick 15-minute chat work sometime?";
  }
  return 'Congrats on the first month. What surprised you most about the build pipeline?';
}
