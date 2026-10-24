// Request/response contracts for the Grok backend (docs/GROK-BACKEND-SPEC.md §5).
// Rachel owns the shared copies in extension/src/shared; change both together.
import { z } from 'zod';
import type { BackendError } from './errors';

export const XHandle = z
  .string()
  .transform((s) => s.trim().replace(/^@/, ''))
  .pipe(z.string().regex(/^[A-Za-z0-9_]{1,15}$/, 'Invalid X handle'));

export const ApprovedFact = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(500),
  kind: z.enum(['skill', 'experience', 'project', 'education', 'interest', 'link']),
});
export type ApprovedFact = z.infer<typeof ApprovedFact>;

export const JobContextInput = z.object({
  id: z.string().min(1).max(128),
  version: z.string().min(1).max(64),
  employer: z.string().trim().min(1).max(200),
  employerDomain: z.string().max(253).optional(),
  title: z.string().trim().min(1).max(200),
  location: z.string().max(200).optional(),
  description: z.string().trim().min(1).max(20_000),
  canonicalUrl: z.string().url().max(2048),
});
export type JobContextInput = z.infer<typeof JobContextInput>;

export const ProfileInput = z.object({
  version: z.string().min(1).max(64),
  facts: z
    .array(ApprovedFact)
    .min(1)
    .max(100)
    .refine((facts) => new Set(facts.map((f) => f.id)).size === facts.length, 'Fact IDs must be unique'),
  targetRoles: z.array(z.string().max(200)).max(20).default([]),
  userXHandle: XHandle.optional(),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export const DiscoveryInput = z.object({
  jobContext: JobContextInput,
  profile: ProfileInput,
  excludePersonHandles: z.array(XHandle).max(500).default([]),
  maxResults: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(3),
});
export type DiscoveryInput = z.infer<typeof DiscoveryInput>;

export type SourceRecord = {
  id: string;
  url: string;
  kind: 'post' | 'profile' | 'web';
  handle?: string;
  postId?: string;
  publishedAt?: string;
  excerpt?: string;
  verification: 'provider_cited' | 'unverified';
  retrievedAt: string;
};

export const AffiliationBasis = z.enum(['bio', 'own_post', 'third_party', 'inferred']);
export type AffiliationBasis = z.infer<typeof AffiliationBasis>;

export type AffiliationEvidence = { claim: string; basis: AffiliationBasis; sourceIds: string[] };

export const PersonCategory = z.enum(['practitioner', 'hiring_team', 'recruiter', 'professional_connection']);
export const SuggestedAction = z.enum(['read', 'reply', 'ask_question', 'dm', 'coffee_invite', 'save']);

export type ScoreFactor = 'role' | 'company' | 'interests' | 'recent' | 'opening';

export type Recommendation = {
  personId: string;
  handle: string;
  displayName?: string;
  category: z.infer<typeof PersonCategory>;
  affiliation: AffiliationEvidence | null;
  relevance: string;
  userContribution: string;
  factIdsUsed: string[];
  openingSourceId?: string;
  suggestedAction: z.infer<typeof SuggestedAction>;
  score: { total: number; version: string; factors: Record<ScoreFactor, { points: number; sourceIds: string[] }> };
  evidenceCoverage: number;
  uncertainties: string[];
};

export type Usage = {
  providerCalls: number;
  postsFetched?: number;
  profilesFetched?: number;
  estimatedUsd: number;
  pricingVersion: string;
};

export type DiscoveryJob = {
  jobId: string;
  jobContextId: string;
  jobContextVersion: string;
  profileVersion: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
  progress: { stage: 'planning' | 'searching' | 'validating' | 'ranking' | 'done'; message: string };
  recommendations: Recommendation[];
  sources: SourceRecord[];
  usage: Usage;
  error?: BackendError;
  mode: 'live' | 'fixture';
};

export const PersonResearchInput = z.object({
  personId: z.string().min(1).max(64),
  handle: XHandle,
  jobContextId: z.string().min(1).max(128),
  jobContextVersion: z.string().min(1).max(64),
  topicHints: z.array(z.string().max(100)).max(10).default([]),
  refresh: z.boolean().default(false),
});
export type PersonResearchInput = z.infer<typeof PersonResearchInput>;

export const STYLE_DIMENSIONS = ['length', 'formality', 'technical_depth', 'directness', 'humor'] as const;
export type StyleDimension = (typeof STYLE_DIMENSIONS)[number];

export type CommunicationContext = {
  id: string;
  personId: string;
  handle: string;
  recentThreads: { sourceId: string; topic: string; openQuestion?: string }[];
  style: Record<StyleDimension, { value: string; sourceIds: string[] } | 'insufficient_evidence'>;
  evidenceCoverage: number;
  expiresAt: string;
};

export const DraftKind = z.enum(['reply', 'dm', 'coffee_invite', 'follow_up', 'thank_you']);
export type DraftKind = z.infer<typeof DraftKind>;

// The draft request carries only what the writer needs; source IDs are checked
// against the backend's own registry, never trusted from the client.
export const DraftInput = z.object({
  kind: DraftKind,
  jobContext: JobContextInput,
  profile: ProfileInput.extend({
    voice: z
      .object({ sampleText: z.string().max(2000).optional(), preferences: z.array(z.string().max(200)).max(10).default([]) })
      .default({ preferences: [] }),
  }),
  person: z.object({
    personId: z.string().min(1).max(64),
    handle: XHandle,
    displayName: z.string().max(100).optional(),
    relevance: z.string().max(600).default(''),
    affiliationClaim: z.string().max(300).optional(),
  }),
  communicationContextId: z.string().max(64).optional(),
  selectedSourceId: z.string().max(64).optional(),
  userGoal: z.string().max(500).optional(),
  otherDraftTexts: z.array(z.string().max(4000)).max(50).default([]),
});
export type DraftInput = z.infer<typeof DraftInput>;

export type ValidatedDraft = {
  kind: DraftKind;
  text: string;
  profileVersion: string;
  jobContextId: string;
  jobContextVersion: string;
  personId: string;
  styleEvidenceIds: string[];
  factIdsUsed: string[];
  sourceIdsUsed: string[];
  warnings: string[];
};

export type DraftResult = ValidatedDraft & {
  approach: string;
  lengthCheck: { surface: 'x_reply' | 'x_dm'; weightedLength: number; limit: number | null; ok: boolean };
  sparseEvidence: boolean;
  mode: 'live' | 'fixture';
};

// ---- Model output shapes (parsed leniently, then validated against citations) ----

const UrlList = z.array(z.string().max(2048)).max(20).default([]);

export const CandidateOutput = z.object({
  handle: XHandle,
  xUserId: z.string().regex(/^\d+$/).nullish(),
  displayName: z.string().max(100).nullish(),
  category: PersonCategory,
  affiliation: z.object({ claim: z.string().max(300), basis: AffiliationBasis, sourceUrls: UrlList }).nullable(),
  relevance: z.string().max(600),
  userContribution: z.string().max(600),
  factIdsUsed: z.array(z.string()).max(20).default([]),
  roleEvidenceUrls: UrlList,
  interestEvidenceUrls: UrlList,
  recentPostUrls: UrlList,
  openingPostUrl: z.string().max(2048).nullish(),
  suggestedAction: SuggestedAction,
  posts: z.array(z.object({ url: z.string().max(2048), excerpt: z.string().max(500) })).max(20).default([]),
  uncertainties: z.array(z.string().max(300)).max(10).default([]),
});
export type CandidateOutput = z.infer<typeof CandidateOutput>;

export const CandidatesEnvelope = z.object({ candidates: z.array(z.unknown()).max(10) });

const StyleObservation = z.object({ value: z.string().max(200), postUrls: UrlList }).nullable().default(null);

export const PersonResearchOutput = z.object({
  posts: z
    .array(z.object({ url: z.string().max(2048), excerpt: z.string().max(500), topic: z.string().max(200).default('') }))
    .max(12)
    .default([]),
  threads: z
    .array(z.object({ url: z.string().max(2048), topic: z.string().max(200), openQuestion: z.string().max(300).nullish() }))
    .max(8)
    .default([]),
  style: z
    .object({
      length: StyleObservation,
      formality: StyleObservation,
      technical_depth: StyleObservation,
      directness: StyleObservation,
      humor: StyleObservation,
    })
    .default({}),
});
export type PersonResearchOutput = z.infer<typeof PersonResearchOutput>;

export const DraftOutput = z.object({
  text: z.string().trim().min(1).max(4000),
  factIdsUsed: z.array(z.string()).max(20).default([]),
  sourceIdsUsed: z.array(z.string()).max(20).default([]),
  styleEvidenceIds: z.array(z.string()).max(20).default([]),
  approach: z.string().max(1000).default(''),
  warnings: z.array(z.string().max(300)).max(10).default([]),
});
export type DraftOutput = z.infer<typeof DraftOutput>;
