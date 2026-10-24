# networkMAX — X networking extension

Status: proposed build specification, v0.3; job-triggered, person-specific X networking  
Prepared: 2026-10-24  
Primary user: Sushant  
Platform: Chrome extension on job portals and X; Chromium/Brave compatibility to be verified

## 1. Product intent

While I am applying for a job, the extension recognizes the company and specific posting in my open job portal. Grok uses that job context and my resume to find relevant people on X, understand their public conversational style, and help me interact naturally with each person. Those interactions can lead to coffee chats and job opportunities.

This personal-branch spec defines the X/Grok direction. The separate `docs/SPEC.md` records the GitHub hackathon proposal; its reusable message-template requirement does not apply here.

The core loop is:

**Open a job posting → recognize company and role → match my resume → research relevant people on X → choose a useful conversation → write for that person and context → coffee chat → follow-through.**

Optimize for meaningful reciprocal conversations and relevant opportunities. Follower counts and interaction volume are secondary diagnostics. The product cannot promise a job, a reply, or a referral.

## 2. Reference and evidence boundary

Requested reference: https://dashboard.tsenta.com/dashboard/networking

On retry, native browser control worked: Chrome redirected to login, while an existing Brave networking tab exposed no readable page content. Public HTML and frontend bundles were successfully retrieved and inspected. They establish company search, applied-company navigation, three-contact outreach-bundle requests, contact categories, email/LinkedIn drafting, company news, and daily usage UI. Rendered behavior, authenticated data, backend algorithms, and actual delivery remain unverified. Claude Code was consulted but its CLI was not logged in. See [the detailed evidence record](TSENTA-RESEARCH.md).

This is an original implementation specification informed by static reverse engineering of the public frontend and the user's X networking goals. It is not a complete reconstruction of Tsenta's backend or a claim of runtime feature parity. Do not copy its branding/assets or depend on its private API.

| Evidence | What it establishes | What remains unknown |
| --- | --- | --- |
| User request | Resume-aware X networking, Grok, coffee chats, job-search outcomes | Target roles, companies, current resume, outreach tone |
| Tsenta public homepage [S1] | Broader resume-aware job-search product with tracking | Exact networking module and its internals |
| Tsenta public networking frontend [S7] | Company search, contact bundles, categories, channel drafts, news, usage states | Backend implementation, runtime results, resume influence, actual delivery |
| xAI X Search docs [S2] | API-supported search over X posts, users, and threads | Account-specific availability, quality, costs at deployment |
| X Grok Bot help [S3] | A separate Grok Bot product can connect to X | A supported extension-to-Grok-Bot integration contract |
| Chrome docs [S5–S6] | MV3 side panel and temporary active-tab access | Brave behavior on the target user's installed version |

To finish a fidelity audit later, verify the rendered search/contact/draft flows with authenticated access and inspect runtime requests available through authorized access. The static inspection already establishes the core company-first pattern; saved-contact lifecycle, follow-up behavior, coffee chats, and exact quotas remain unknown.

### Reference-to-X adaptation

Make a company workspace a first-class entry point alongside topic/person discovery. The reference starts with applied companies or company-name search, then asks its agent for a small contact bundle. In networkMAX, the user selects a target company and optional role, reviews three source-backed X contacts, and picks a relevant conversation or draft. Source-backed recent posts supply conversation context. Email verification and LinkedIn notes become X identity/affiliation evidence and reply/DM/coffee-chat drafts. Coffee-chat preparation, relationship reminders, and outcome tracking are additions requested for networkMAX, not verified Tsenta features.

## 3. Scope and product decisions

### MVP

- Job-portal recognition of the current company, posting, role, job ID, description, and location, with source evidence and correction controls.
- Resume import and editable professional profile.
- Target roles, companies, locations, interests, and exclusions.
- Grok-assisted person and conversation discovery with source links.
- Company workspace with name/domain disambiguation, optional role/job context, an initial three-person shortlist, and a bounded “Find more” action excluding prior results.
- Explainable candidate ranking and manual save/dismiss.
- Individually composed reply, DM, coffee-chat, and follow-up drafts informed by the person’s public communication style; no reusable message bodies or placeholder templates.
- Relationship history, reminders, chat preparation, and outcome tracking.
- Daily action queue inside a side panel while browsing X.
- Copy drafts and open the relevant X page; the user sends in native X.
- Persistent full-page extension workspace for the relationship board and settings.

### Later

- Optional supported X API integration for verified interaction history, subject to access, permissions, and policy review.
- Calendar integration for availability and confirmed bookings.
- Optional direct Grok Bot adapter if a documented, supported integration becomes available.
- Multi-device sync and richer reporting after validating the personal workflow.

### Outside this build

Job auto-application, ATS form filling, bulk messaging, automated likes/follows, automatic cold replies, contact-email harvesting, private-account scraping, account-cookie extraction, and guaranteed job placement.

## 4. Grok integration decision

Use a backend adapter to the **xAI API with X Search** as the default research engine. Its documented search tools include keyword, semantic, user, and thread search [S2]. Configure the model server-side; validate a tool-compatible model during setup rather than embedding a model name throughout the application.

Do not assume a consumer Grok subscription supplies API access or credits. Show separate connection and billing status for the backend's configured API access.

**Grok Bot is a separate integration option.** X describes @bot as forwarding public requests to a connected Grok Bot [S3]. This does not establish an API that a Chrome extension can invoke. MVP may offer “Copy research prompt for Grok Bot,” using only the approved public professional summary, but must not publish that prompt or the resume. Do not automate Grok's website, use private endpoints, or treat an @bot mention as a private channel.

Provider interface:

```ts
interface NetworkingResearchProvider {
  discover(input: DiscoveryInput): Promise<DiscoveryResult>;
  researchPerson(input: PersonResearchInput): Promise<PersonResearch>;
  draft(input: DraftInput): Promise<ValidatedDraft>;
}
```

Implement `XaiResearchProvider` first. A future `GrokBotProvider` must satisfy the same contract using verified supported interfaces. The shipped UI should call the feature “Grok research” and accurately identify which provider is connected.

### Optional bot swarm orchestration

The user may run one Grok research worker or a bounded swarm behind the same interface. A swarm is an implementation option, not a user requirement to manage several bots. Begin with one worker and enable parallel research only when it improves relevance or latency within the configured budget.

| Worker role | Input | Output |
| --- | --- | --- |
| Job reader | Captured job evidence | Company identity, role, requirements, unknowns |
| People researcher | Confirmed job context and approved resume facts | Relevant X identities with affiliation and role evidence |
| Conversation researcher | Selected people and recent public threads | Useful conversation openings and observed communication preferences |
| Writer/reviewer | One person, thread, job, approved user facts | A fresh draft and checks for grounding, tone, and duplication |

A coordinator shares source references and job/profile versions, merges duplicates, cancels superseded work, and enforces an aggregate budget/concurrency limit. Conflicting findings remain visible as uncertainty. Workers cannot independently send messages, start unlimited child workers, or promote one another’s unsupported claims to facts. All output attaches to the originating job context and person. Parallelize independent people research; writing waits for the relevant evidence.

## 5. User journey

### Onboarding: teach it who I am

1. Import a text-based PDF or paste resume text. Offer paste fallback for scans; OCR and DOCX can follow later.
2. Parse locally where practical. Show extracted facts for editing and confirmation before remote processing.
3. Capture skills, experience, education, projects, portfolio links, and evidence excerpts. Never invent metrics or experience.
4. Ask for target roles/seniority, companies, locations/time zone, remote preference, interests, X handle, and preferred tone.
5. Let the user select which professional facts may be shared with the model and which may appear in outreach. Default phone, street address, personal email, and other private fields to excluded.
6. Save a versioned profile. Discovery and drafts use the latest confirmed version; changing the resume marks older results/drafts as potentially stale.

No specific roles, companies, degree, employment history, or skills should be prefilled as Sushant's facts until supplied.

### Primary session: I am applying for this job

1. I open the employer’s job portal or a specific job posting and open the extension. With optional site permission enabled for a supported portal, the extension can recognize subsequent postings automatically on that site.
2. The panel shows the detected company, title, job ID/canonical URL, location, requirements, and a short summary. It distinguishes the ATS provider from the employer. Each extracted field retains a page/structured-data evidence reference; ambiguity is flagged for correction.
3. The extension combines this posting with my confirmed resume, showing relevant experience and any gaps. It never invents fit or edits/submits my application.
4. I select “Find people for this job.” Grok or a bounded research swarm searches X for relevant team members, hiring contacts, recruiters, and professional connections, returning up to three strong initial matches.
5. Each person card explains their relevance to this exact job, cites their identity/affiliation, and identifies a recent substantive post or other legitimate conversation opening.
6. I choose a person. Grok reads enough recent relevant public writing to propose an interaction that fits this person’s conversational style, the actual thread, and my own voice. It recommends a useful reply, a direct question, or a coffee-chat invitation depending on context; a fixed warm-up sequence is not required.
7. I review and edit the draft, open X, and send. The relationship, draft, and subsequent coffee-chat/outcome records stay linked to this job and person.

Detection starts with supported adapters for Greenhouse, Lever, and Ashby, plus generic job pages with usable `JobPosting` structured data or clearly identified visible job content. Treat adapter coverage as a build target until tested. On application forms, capture only the posting/header context, never form field values, resume uploads, account data, or application answers. If the page is only a company portal landing page or has several jobs, identify the company and ask the user to open/select a posting instead of guessing a role. Embedded frames, inaccessible descriptions, scans, login-only content, and unknown layouts fall back to a pasted description/URL or manual correction. Do not claim support for arbitrary portals without verifying them.

Use canonical URL + employer job ID when available for deduplication. Re-evaluate on supported SPA route/job changes, cancel or mark obsolete work after a job switch, and never show one job’s drafts as belonging to another. Existing relationships persist across applications, so the assistant can flag prior contact with someone at the same company.

### Daily session: a small, useful queue

Open the extension on X. “Today” shows a configurable queue, initially five relevant posts, three people worth researching, and due follow-ups. These are workload defaults, not promises of platform-safe sending limits. The user can skip, save, or act on each item.

### Company session: people at a company I care about

Search a company by name or domain, confirm ambiguous matches, and optionally attach a target role/job URL or manually recorded application. Generate an initial shortlist of up to three evidenced X contacts, grouped where useful into relevant practitioners/hiring team, recruiters, and shared professional connections. Never label someone “in my network” based on shared interests alone. If fewer than three supported matches exist, show fewer. Each card includes an affiliation source, relevance to confirmed resume facts, recent conversation context, and recommended next action. “Find more” starts a separately budgeted search excluding previous results. This flow works without importing Tsenta applications or building an ATS tracker.

Every recommendation answers:

- Why this person or conversation fits my goals.
- What public evidence supports that assessment, with dates and links.
- What I can usefully contribute from my actual background.
- What action makes sense now: read, reply, save, ask a question, or draft an invitation.

### Build a relationship

The user opens a source post, reads it, and requests a draft. The assistant offers a concise contribution or specific question, plus a brief explanation of the relevant resume connection. The user edits and copies the text, sends it in X, then optionally records the sent-post URL.

The extension must not mark a copied draft as sent. “Mark sent” is a separate action, with optional evidence URL. Native sends are not automatically observable in the MVP.

A prior exchange can support a coffee-chat recommendation, but is not a mandatory sequence or proof of friendship. Direct invitations may also make sense when there is a specific shared interest. Never manufacture familiarity or ask for a referral by default.

### Coffee chat and follow-through

Generate a short invitation proposing a 15–20 minute chat, with a specific reason and optional virtual/in-person preference. After the recipient agrees, help draft scheduling text. A pasted booking link or proposed time does not count as a confirmed booking.

For a confirmed chat, record time zone and date, produce a one-page preparation view with public background, three relevant questions, a short self-introduction, and optional goals. After the chat, the user records notes, commitments, and a thank-you draft. Schedule follow-up reminders only; never send unattended.

## 6. Screens and UI behavior

| Surface | Required content and actions |
| --- | --- |
| Current job | Detected employer/role/posting evidence, correction, resume match, find-people action, research progress, job-switch warning |
| Today | Job-linked recommendations, due reminders, next action, refresh/cancel research |
| Discover | Natural-language query; company, role, topic, recency filters; source-backed people/posts; save/dismiss |
| Companies | Target-company list/search, disambiguation, optional role/job context, three-person shortlist, evidence-backed company/post context, find-more and usage states |
| Person detail | Handle, bio, professional evidence, match reasons, unknowns, source posts, history, notes, draft actions |
| Draft editor | Draft type, editable text, source context, facts used, regenerate, copy, open X, mark sent separately |
| Relationships | Searchable board/list; last contact, stage, next action, reminders, linked career outcomes |
| Coffee chat | Invitation, confirmed logistics, preparation, notes, commitments, thank-you/follow-up drafts |
| My profile | Resume import, confirmed facts, targets, public summary, tone, excluded facts |
| Settings | Research connection, spending limit, retention, export/delete, permissions, provider status |

Side panel: target roughly 360–440 px width with a single-column layout, accessible labels, keyboard navigation, and readable source links. The full-page workspace supports larger lists and board navigation. Refresh must show loading, partial results, last successful run, error, and retry states. Empty results should suggest broadening a filter without inventing contacts.

MVP supports user-invoked capture of the current job posting or public X profile/post. Automatic portal detection is available only on supported origins with explicit optional site access. Support URL/description paste as a fallback. Do not continuously read the timeline or private DM inbox. X SPA navigation requires rechecking the current URL and context before capture; if the selected profile/post is ambiguous, ask the user to choose or paste its URL.

## 7. Discovery and ranking

1. Convert confirmed profile facts and explicit goals into bounded search queries. Prioritize peers, relevant practitioners, hiring managers with evidence, recruiters in the target field, and people discussing relevant work.
2. Run bounded X research and collect public source URLs, timestamps, excerpts, and provider identifiers when available.
3. Validate returned URL structure; retain only source references associated with the research response. Mark sources as unverified if the underlying content could not be independently checked. Never let generated narrative create a source record by itself.
4. Deduplicate by stable X user ID when available; otherwise normalized handle, with explicit handling for possible handle changes and merges.
5. Apply exclusions and relationship history before ranking. Suppress archived/do-not-contact people and previously dismissed source items.
6. Compute the score in application code from evidence-backed features; Grok extracts evidence and explains context, rather than inventing an opaque likelihood of getting hired.

Initial configurable score, 0–100:

| Factor | Maximum | Evidence examples |
| --- | ---: | --- |
| Role/domain relevance | 30 | Explicit bio or relevant public work |
| Target-company relevance | 20 | Current affiliation supported by a source |
| Shared professional interests | 20 | Similar project, technique, school, or community when actually evidenced |
| Relevant recent activity | 15 | Recent substantive post on a target topic |
| Conversation opening | 15 | Specific question, discussion, or opportunity the user can contribute to |

Missing evidence contributes zero and lowers separately displayed evidence coverage. The score is a prioritization heuristic, not a probability. Store factor evidence and score version. Do not rank by protected traits, perceived vulnerability, or follower count. Keep the score separate from relationship stage. A hiring post is a signal, not proof that a role is still open; show its date and recheck before using it in a draft.

## 8. Drafting contract

Inputs: confirmed profile facts, originating job context, selected person/post evidence, observed public communication preferences with source references, goal, user-selected relationship context, the user’s voice preferences, and selected prior exchanges supplied by the user. Private conversation text is remote-processed only after explicit selection and disclosure.

Output:

```ts
type ValidatedDraft = {
  kind: 'reply' | 'dm' | 'coffee_invite' | 'follow_up' | 'thank_you' | 'original_post';
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
```

Generation rules:

- Compose each message from the actual person, job, and conversation; do not fill or lightly paraphrase a saved template.
- Adapt observable features such as brevity, formality, technical depth, directness, and light humor when supported by public examples. Match the current thread first; keep the user’s own voice and avoid copying signature phrases or pretending to be the recipient.
- Treat “vibe” as a tentative communication preference, not a diagnosis or hidden personality score. Do not infer private feelings, sensitive traits, vulnerabilities, or willingness to help.
- With sparse or conflicting evidence, use the user’s natural neutral voice and show the uncertainty. Never force slang, jokes, or false familiarity.
- If the thread does not naturally connect to the job, contribute to its topic without inserting an application pitch.
- Check near-duplicate drafts across contacts; regenerate generic repeated openings or asks. Structural validation schemas are allowed; fixed outreach-message templates are not.
- Be specific, concise, and appropriate to the source conversation.
- Use only confirmed resume facts; phrase uncertain external facts as uncertain or omit them.
- Do not fabricate having read a project, attended an event, used a product, or met the person.
- A useful reply contributes an idea, example, or question; avoid generic praise and immediate job requests.
- A DM has one clear reason for contacting this person and one low-pressure ask.
- Do not include a full resume, private contact details, scheduling link, or job/referral request unless selected by the user.
- Original-post suggestions may draw on actual projects, but do not invent experience, results, or announcements.
- Respect the configured composition length for the chosen surface; public-post validation must account for X's text rules rather than JavaScript string length alone. Warn and preserve the editable draft if limits cannot be verified.

Validate the output schema and referenced fact/source IDs server-side. Missing references, malformed output, or obsolete profile versions must be surfaced before presenting the draft as ready. Evidence validation reduces errors but does not replace user review of claims.

Draft review should expose “Why this approach”: the specific post/context, supported style observations, and relevant user fact. This explanation stays outside the outgoing text. A technical practitioner asking a detailed design question may warrant a compact technical contribution; a concise recruiter post may warrant a direct role-specific question. These are strategy examples, never reusable message scripts.

## 9. Relationship and opportunity tracking

Relationship stages: `saved`, `engaging`, `contacted`, `replied`, `chat_planned`, `chat_completed`, `keep_in_touch`, `archived`.

Stage changes are explicit user actions in MVP. An “engaging” event may be recorded without implying a reciprocal relationship. `chat_planned` requires user confirmation of agreed logistics; `chat_completed` requires user confirmation. Allow corrections and store stage-change history. `do_not_contact` is an independent flag that suppresses all suggested outreach and reminders.

Track career outcomes separately: introduction, referral offered, referral received, role discovered, interview, offer, or closed. Each outcome links to a person and optionally a role/company and user notes. Do not force a strictly linear funnel; multiple people may contribute to one opportunity.

Follow-ups: user-configurable reminder, initially suggested after seven days. If the user records no reply, suggest at most one gentle follow-up, then pause until explicitly resumed. Seven days is a product default, not a platform rule. Respect declines immediately. Tasks must be deduplicated, snoozable, dismissible, and canceled when the contact is archived or flagged do-not-contact.

## 10. Architecture

Suggested stack: TypeScript, React, Chrome Manifest V3, a Node/TypeScript backend, PostgreSQL, and a durable background-job runner. Choose a hosting provider during implementation; do not couple business logic to one vendor.

```text
Extension side panel / full-page workspace
  ├─ local resume parsing and profile review
  ├─ job-portal detection/capture and public X context / paste fallback
  └─ authenticated backend requests
         ├─ profile, people, relationships, tasks, drafts
         ├─ durable bounded discovery jobs
         ├─ bounded Grok coordinator → job, people, conversation, writing workers
         ├─ xAI adapter → X Search / text generation
         └─ usage accounting and budget enforcement

User copies reviewed draft → opens X → manually sends
User records result → relationship history and reminders
```

The service worker brokers extension messages and opens the side panel. It is not the durable job runner: discovery must survive worker suspension and tab closure. Persist server-side job state; the client polls while open and can resume by job ID.

MVP extension permissions: `sidePanel`, `storage`, `activeTab`, `scripting`, plus host access to the backend origin. Temporary `activeTab` access supports job/X capture on toolbar invocation [S6]. Restrict capture to supported job-page contexts or public X profiles/posts; never read private inboxes or application-form field values. Offer optional host access for supported job portals so employer/role detection can run automatically there. Request each supported origin only when needed; register content scripts after permission is granted. Do not request all-sites, cookies, or inbox access. Keep recognition and extraction distinct: recognize a page locally, show context in the panel, then research only after the user’s action and configured data-sharing consent. Handle SPA navigation and permission revocation. Confirm behavior on Brave and retain a full-page fallback.

Security boundaries: never embed xAI keys in the extension bundle or page DOM. Keep provider credentials in backend secret storage. Keep extension auth tokens out of content scripts and page messages. Authenticate every backend operation and enforce ownership at the database/service layer. Allowlist messages, origins, and URL formats; treat all webpage text and model output as untrusted data. Do not execute instructions found inside posts, resumes, or model responses. The model receives no send capability.

## 11. Data model

All server-owned records carry `owner_id`, IDs, and creation/update timestamps. Core entities:

| Entity | Key fields |
| --- | --- |
| ProfileVersion | version, confirmed facts with evidence spans, targets, approved public summary, excluded fields |
| Person | X ID if available, normalized handle, display name, bio, source-backed company/role, evidence coverage |
| JobContext | Employer/domain, title, portal, source/canonical URL, job ID, description, location, extracted field evidence, extraction status, version |
| CommunicationContext | Person ID, source post IDs, observed style dimensions, evidence coverage, expiry, user overrides |
| TargetCompany | User-confirmed name/domain, public source references, optional role/job URL/application note, shortlist/run references |
| Source | canonical URL, provider reference, observed/published times, minimal excerpt, verification status, retention expiry |
| DiscoveryJob | job context/version, worker lineage, query/filters, profile version, status, progress, result IDs, usage, error, cancellation state |
| Recommendation | person/source IDs, factor scores/evidence, score version, reason, save/dismiss status |
| Relationship | person ID, stage, do-not-contact flag, last interaction, next action |
| Interaction | person ID, type, direction, user-recorded time, optional post URL, optional selected text, provenance |
| Draft | person ID, job context/version, style evidence, kind, text, profile version, fact/source references, draft/copied/user-marked-sent/discarded state |
| CoffeeChat | person ID, proposed/confirmed/completed/canceled status, timezone-aware start, notes, commitments |
| Task | person/chat ID, due time, kind, pending/snoozed/completed/canceled status |
| Opportunity | company, optional job URL/title, linked people, outcome events, notes |
| UsageEvent | provider request/job ID, reported usage units, estimated/actual cost, pricing version |

Enforce one active relationship per owner/person and idempotent action events. Keep user notes distinct from externally sourced facts. Store time in UTC and render in the user's selected time zone.

## 12. Backend contracts and failure handling

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/job-contexts` | Validate captured posting evidence and save/correct a versioned job context; no application submission |
| `PUT /v1/profile` | Validate and save a confirmed profile version |
| `POST /v1/discovery-jobs` | Start a bounded search using query, filters, profile version, and idempotency key |
| `POST /v1/target-companies` | Save a user-confirmed company identity and optional role/job context; discovery jobs accept its ID and excluded person IDs |
| `GET /v1/discovery-jobs/:id` | Return status, partial results, usage, errors |
| `POST /v1/discovery-jobs/:id/cancel` | Stop scheduling more work; report any in-flight requests |
| `POST /v1/people` | Save a validated person/source result |
| `POST /v1/drafts` | Generate and validate an editable draft with references |
| `PATCH /v1/relationships/:id` | Update stage, next action, or do-not-contact |
| `POST /v1/interactions` | Record a user-confirmed action or reply |
| `POST /v1/coffee-chats` | Create/update chat details and confirmations |
| `GET /v1/today` | Get deduplicated recommendations and due tasks |
| `GET /v1/export` | Export owned profile, contacts, history, notes, and drafts |
| `DELETE /v1/account-data` | Delete owned application data and cancel pending work |

All endpoints require authentication. Use ownership checks, bounded pagination, schema validation, and idempotency on creation. No endpoint for posting or sending exists in MVP.

Retry transient provider errors with bounded exponential backoff and jitter; respect provider retry signals. Do not retry authentication, schema, or exhausted-budget errors blindly. Preserve drafts and partial research through failures. Show a clear distinction between no matches, incomplete research, unavailable sources, disconnected provider, exhausted budget, and invalid resume text. If X capture breaks, URL paste and manually entered context remain available.

## 13. Privacy, cost, and platform constraints

- Before the first remote request, disclose which approved profile fields go to xAI via the application's backend. Keep the original resume local by default and do not log raw resumes, private messages, or model prompts containing personal data.
- Store confirmed profile facts and user relationship records until deleted. Default external-source cache expiry to 30 days, subject to any shorter provider/platform obligations; expire cached excerpts while retaining permitted user notes and source links. Recheck sources before fresh outreach.
- Provide export and deletion controls. Deletion cancels pending jobs, clears local caches, and removes active server records; document backup expiry (target maximum 30 days) and any provider retention separately. Do not claim deletion from external providers without a supported mechanism.
- Set a user-configurable monthly research budget during setup; do not silently authorize unlimited usage. Track provider-reported consumption, current pricing version, and estimates separately.
- Bound query count, tool turns, concurrency, and result size. Reserve estimated request cost before dispatch and reconcile usage afterward. Explain that in-flight/tool-expanded requests can cause bounded overshoot; do not advertise an exact hard monetary cap unless the provider supports enforcement.
- Cache/deduplicate research and let users refresh explicitly. Stop scheduling new work at the configured limit. Reverify provider billing units and limits at implementation; do not hardcode prices from this document.
- X restricts unsolicited automated replies/DMs, automated likes, and AI reply bots; current guidance requires written approval for AI reply bots [S4]. MVP research and drafting never clicks Send, Reply, Follow, or Like and never uses unattended action queues. Any later sending integration needs a fresh access and policy review; user review alone is not evidence that every automation pattern is permitted.

## 14. Metrics

Primary: meaningful reciprocal professional conversations per week, completed coffee chats, relevant introductions/referrals, and interviews associated with relationships.

Secondary: useful recommendations saved, draft-to-user-marked-sent conversion, reply rate among user-recorded outreach, follow-up completion, research cost per useful recommendation, and time spent per session. Show sample sizes and unknown/unrecorded outcomes. Report association with job outcomes, not proof of causation. Never invent impressions, profile visits, or follower changes; those require supported data or explicit user entry.

## 15. Delivery plan

1. **Foundation:** MV3 side panel/full-page shell, backend authentication, local resume parsing, editable confirmed profile, export/delete basics. Done when a user can restart the browser and recover the confirmed profile without exposing provider keys.
2. **Research:** supported job-page adapters and context versioning, current-job view, xAI adapter, bounded durable jobs, source records, deduplication, evidence-based scoring, discover/person views, budget controls. Done when real returned sources and honest empty/error states work end-to-end.
3. **Engagement:** public URL/context capture, grounded drafts, copy/open-X flow, manual sent recording, relationship board. Done when no capture or draft action can publish to X.
4. **Coffee-chat loop:** invitation drafts, timezone-aware confirmed logistics, preparation, notes, reminders, opportunity outcomes. Done when the complete relationship loop can be recorded and corrected.
5. **Pilot:** test with the user's supplied resume and targets, check Brave compatibility, measure recommendation usefulness and daily friction, fix issues, then prepare extension packaging and disclosures.

### Four-person feature ownership

| Person | Primary responsibility |
| --- | --- |
| Julia | Job-portal recognition, posting extraction, navigation changes, capture fallback |
| Rachel | Extension core, shared contracts, state, routing, end-to-end integration |
| Sushant | Side-panel UI, resume/profile review, draft review, relationship and coffee-chat screens |
| Maryam | Grok backend, X person discovery, public conversational research, individual writing ([detail](GROK-BACKEND-SPEC.md)) |

See [the four-person build plan](TEAM-PLAN.md) for feature checklists, handoffs, demo scope, acceptance checks, and a proposed three-hour schedule. The personal X/Grok spec takes precedence over the separate hackathon proposal’s template/LinkedIn workflow.

## 16. Acceptance criteria and verification

- Opening a supported job posting and invoking the extension identifies the employer and role with evidence, handles ATS/employer distinction, and offers corrections. Portal landing pages never cause an invented job match.
- Optional portal access enables detection only on permitted origins; revocation stops it. Application answers and other form values never enter capture/model payloads.
- Switching jobs on an SPA invalidates active context safely; stale research/drafts remain labeled with their originating job and cannot silently attach to the new one.
- One-worker and swarm modes respect the same global budget, cancellation, deduplication, and source validation; worker completion order does not change job/person ownership.
- Compare drafts for people with different evidenced communication styles: strategy and wording respond to their posts, preserve the user’s voice, and do not reuse a message skeleton. Sparse evidence falls back to a neutral voice; unsupported personality claims fail review.
- A text PDF or pasted resume produces editable facts; unsupported/scanned files present a useful fallback. Unconfirmed or excluded facts do not appear in research/draft payloads.
- A discovery run returns source-linked results or an honest empty state; missing company evidence is displayed as unknown. A fabricated source ID/URL in model narrative fails validation.
- Company lookup handles ambiguous names, supports an optional job/role, and returns up to three source-backed contacts without padding weak results. Find-more excludes existing results; shared interests alone never imply a personal connection.
- Duplicate handles/results merge safely. Do-not-contact, dismissed sources, and archived contacts are excluded from outreach queues.
- Every draft identifies its profile version and referenced facts/sources. Unknown IDs are rejected, and drafts based on an old resume show a stale warning.
- Copying a draft does not mark it sent, advance a contact to contacted, or create an X action. Sending occurs only in native X by the user.
- An invitation does not become a confirmed coffee chat until the user records confirmation. Times render correctly across time zones and daylight-saving changes.
- No-reply follow-up reminders pause after the configured single follow-up; declines and do-not-contact cancel pending outreach tasks.
- Discovery survives service-worker suspension and panel closure. Cancellation prevents further requests, identifies in-flight work, and preserves completed results.
- Provider rate limiting, outage, invalid credentials, malformed output, unavailable sources, and exhausted budgets have distinct recoverable states.
- Requests from another authenticated user cannot read or modify a person's profile, notes, jobs, or drafts. Page content cannot access auth/provider secrets or trigger arbitrary backend operations.
- Export includes user-owned data; deletion clears live records/local cache and cancels work according to the stated retention policy.
- Verify permission prompts, side-panel behavior, X SPA navigation, keyboard access, and URL-paste fallback in Chrome and the target Brave installation.

Use focused unit tests for ranking, reference validation, state transitions, deduplication, budgets, and timezone logic; API integration tests for ownership and idempotency; and browser tests for the user journey and absence of send automation. Use fixture resumes and mocked providers in CI; run a small, explicitly budgeted live research smoke test during setup.

## 17. Inputs needed at implementation

These are onboarding inputs, not reasons to delay the specification:

- Current resume and approved public professional summary.
- Target roles/seniority, companies, location/remote preferences, X handle, and portfolio links.
- Preferred outreach voice and weekly time commitment.
- xAI API access and research budget.
- Whether “Grok Bot” means a specific existing connected account/product. A direct adapter requires verified integration documentation before commitment.

## Sources

Official pages checked 2026-10-24. Recheck integrations, model availability, billing, and policies before implementation/release.

- [S1 — Tsenta public product page](https://tsenta.com/)
- [S2 — xAI X Search](https://docs.x.ai/developers/tools/x-search)
- [S3 — X: About @bot and Grok Bot](https://help.x.com/en/using-x/about-bot)
- [S4 — X automation rules](https://help.x.com/en/rules-and-policies/x-automation)
- [S5 — Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [S6 — Chrome activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [S7 — Public frontend inspection, asset links, and evidence limits](TSENTA-RESEARCH.md)
