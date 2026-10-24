import type { ApprovedFact, DraftKind, JobContextInput, StyleDimension } from '../schemas';
import type { SearchPlan } from '../research/queries';

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number; // provider-reported, when present
  free?: boolean; // fixture responses cost nothing
};

/** Raw provider output: parsed JSON plus the URLs the provider actually cited. Not yet trusted. */
export type ProviderResult = { output: unknown; citations: string[]; usage: ProviderUsage };

export type ModelStatus = 'listed' | 'not_listed' | 'error' | 'fixture';

export type DiscoverRequest = {
  plan: SearchPlan;
  job: JobContextInput;
  facts: ApprovedFact[];
  maxCandidates: number;
  today: string;
};

export type PersonRequest = {
  handle: string;
  employer: string;
  title: string;
  topicHints: string[];
  fromDate: string;
  today: string;
};

export type DraftPrompt = {
  kind: DraftKind;
  job: Pick<JobContextInput, 'employer' | 'title'>;
  facts: ApprovedFact[];
  person: { handle: string; displayName?: string; relevance: string; affiliationClaim?: string };
  threads: { sourceId: string; topic: string; openQuestion?: string; excerpt?: string }[];
  style: Partial<Record<StyleDimension, { value: string; sourceIds: string[] }>>;
  selectedSource?: { sourceId: string; excerpt?: string };
  userGoal?: string;
  voice: { sampleText?: string; preferences: string[] };
  sparseEvidence: boolean;
  maxWeightedLength: number | null;
  revisionNote?: string;
};

/** NetworkingResearchProvider from the main spec §4, at the raw-output level so every provider shares one validation path. */
export interface ResearchProvider {
  readonly mode: 'live' | 'fixture';
  checkModel(): Promise<ModelStatus>;
  discoverCandidates(req: DiscoverRequest, signal: AbortSignal): Promise<ProviderResult>;
  researchPerson(req: PersonRequest, signal: AbortSignal): Promise<ProviderResult>;
  composeDraft(req: DraftPrompt, signal: AbortSignal): Promise<ProviderResult>;
}
