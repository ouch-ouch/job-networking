# Four-person build plan — networkMAX

Team: Julia, Sushant, Rachel, Maryam. Personal X/Grok direction; companion to [the product spec](X-NETWORKING-SPEC.md).

Sushant owns the side-panel UI by preference. Rachel takes extension core and integration in this proposed split; Julia and Maryam retain their existing areas. Use the GitHub proposal’s three-hour hackathon window as the initial planning assumption. The full production specification is larger than this demo.

## What the four of us are building

**Open a job posting → identify company/role → match the resume → find relevant people on X → understand the conversation → compose a fresh interaction → review/copy/open X → record the relationship.**

The demo must show that two different people get different, evidence-grounded approaches. There is no reusable message template. One Grok worker is sufficient initially; a swarm is stretch work after the core flow works.

## Feature ownership

| Person | Owns | Demo deliverable | Primary files |
| --- | --- | --- | --- |
| **Julia** | Job-portal recognition and page capture | Open a supported posting and obtain company, title, description, URL/job ID, and evidence; handle job changes and paste fallback | `extension/src/content/`, `extension/src/jobs/` |
| **Rachel** | Extension core, shared contracts, state, integration | Working MV3 side panel, panel/worker/content routing, backend client, stored job/profile/contact/draft state, copy/open-X and explicit mark-sent | `extension/manifest.config.ts`, `extension/src/background/`, `extension/src/shared/`, root build configuration |
| **Sushant** | User interface, resume/profile experience, relationship flow | Resume review, detected-job card, ranked people, editable draft with evidence, coffee-chat status/notes; loading/error/empty states | `extension/src/sidepanel/`, `extension/src/profile/`, demo fixtures |
| **Maryam** | Grok backend, person discovery, conversational research and writing | Job + confirmed resume → up to three evidenced X matches → person-specific interaction draft with sources | `backend/`, backend provider setup and deployment |

### Julia — recognize the job I am applying for

- Start with one working portal adapter, preferably Greenhouse, plus structured-data/visible-text fallback; Lever/Ashby follow when time permits.
- Identify the employer separately from the ATS vendor; capture role, job ID, canonical URL, location, requirements, and evidence references.
- Capture the job description only. Never collect application answers, form values, credentials, or uploaded files.
- Detect SPA/job navigation and notify Rachel to replace/version context. A portal landing page must not produce an invented role.
- Support a pasted description when capture fails; Sushant provides the input UI.
- Test two real postings and one unsupported/ambiguous page.
- **Done:** Rachel can call `CAPTURE_JOB` and receive typed evidence-backed data or an actionable fallback status.

### Rachel — make the pieces work together

- Create the extension scaffold, side-panel entry, service worker, minimal permissions, and backend configuration.
- Publish shared types, message contracts, and one fixture early so everyone can develop independently.
- Own local persistence and state transitions: capture → review → research → select person → draft → copied → user-marked-sent.
- Attach job ID/version, profile version, and person ID to research/drafts. Discard or label outdated responses after a job switch.
- Wire Julia’s capture, Maryam’s research/drafting, and Sushant’s UI; implement copy/open-X and manual sent recording.
- Keep provider secrets on the backend. Report network/provider errors without losing state.
- **Done:** a new user can complete the whole demo flow, close/reopen the panel, and recover the current job and saved work.

### Sushant — make the workflow usable

- Build against fixtures immediately: profile/resume review, current-job card with corrections, people cards, draft editor, and compact relationship view.
- Support resume text paste first; add text-PDF parsing if time remains. The user confirms extracted facts before AI use.
- Show why each person matches this job, the source post, and a brief explanation of the draft’s tone/approach outside the outgoing text.
- Provide edit/regenerate/copy/open-X/mark-sent controls; never equate copying with sending.
- Add coffee-chat status, a notes field, and a manual follow-up action once the main path works.
- Own fixtures and the two-minute demo script; label mocked data honestly.
- **Done:** the flow works with both fixtures and live typed results, including missing evidence and failed research.

### Maryam — find people and write for the person

- Implement bounded xAI X Search research using the confirmed job and approved resume facts; return up to three supported people without padding.
- Verify identity/affiliation as far as sources allow; expose uncertainty and relevance to this role. Return source IDs and canonical links.
- Research recent relevant public posts/threads for the selected person, extracting tentative communication preferences such as brevity, formality, and technical depth.
- Compose a fresh reply, DM, or coffee-chat invitation grounded in the actual conversation. Preserve the user’s voice; do not copy signature phrases, invent familiarity, or use a fixed message skeleton.
- Return why this approach, facts/sources used, and warnings; validate schemas and references in code.
- Enforce request bounds, cancellation/timeout handling, and configured usage limits. Deploy the backend and share its URL with Rachel.
- **Done:** two people with different public conversational styles receive distinct grounded drafts, and sparse evidence falls back to a neutral voice.
- **Detailed spec:** [Grok backend specification](GROK-BACKEND-SPEC.md). It covers endpoints and schemas, the discovery/research/drafting pipelines, citation-based source validation, bounds and budget, fixture mode, tests, and deployment.

## Agree on contracts in the first 20 minutes

Rachel owns the shared definitions; each owner proposes changes there before changing a payload. UI code must not import private implementation details from content scripts or backend modules.

| Contract | Owner → consumer | Required result |
| --- | --- | --- |
| `CAPTURE_JOB` | Julia → Rachel → Sushant | `JobContext`: ID/version, employer, role, URL/job ID, description, source evidence, extraction status |
| `SAVE_PROFILE` | Sushant → Rachel | Confirmed `ProfileVersion` with approved facts, excluded facts, user voice |
| `START_RESEARCH` / `GET_RESEARCH` | Rachel ↔ Maryam | Job/profile versions, progress, up to three recommendations, source records, usage/errors |
| `GENERATE_DRAFT` | Rachel ↔ Maryam | Job/person IDs, selected post, facts, observed style evidence → text, references, approach, warnings |
| `COPY_DRAFT` / `OPEN_X` / `MARK_SENT` | Sushant → Rachel | Separate copy/open/sent events, optional sent URL; no automatic send |
| `UPDATE_RELATIONSHIP` | Sushant → Rachel | Stage, notes, confirmed chat details, next action |

For the hackathon, Rachel may keep user state in `chrome.storage.local`; Maryam keeps provider requests bounded and exposes a simple polling job contract. Production authentication, durable jobs, server persistence, deletion, and spending controls remain release requirements in the main spec. A fixture job runner must be explicitly labeled and never presented as live research.

## Three-hour sequence and handoffs

| Time | Julia | Rachel | Sushant | Maryam |
| --- | --- | --- | --- | --- |
| 0:00–0:20 | Confirm first portal and capture fields | Scaffold + types + messages + backend contract | UI shell + fixtures + resume paste | Verify API access/model/tool support; agree schemas |
| 0:20–1:00 | Working capture adapter + fallback | Persistence/router + fixture end-to-end path | Job/profile/people/draft screens | First real discovery results and drafting endpoint |
| 1:00–1:30 | SPA change detection and edge cases | Wire capture and live backend | Replace fixtures through shared state | Source validation + tone evidence + deploy |
| 1:30 checkpoint | Real job recognized | Integrated job → people → draft | Editable result visible | Evidence-linked draft for a real person |
| 1:30–2:15 | Second posting; optional second adapter | Stale-job protection, copy/open/mark-sent | Relationship notes and coffee-chat action | Compare two people’s drafts; sparse-evidence fallback |
| 2:15–2:40 | Capture bug fixes | Integration checks and package build | UX fixes and demo rehearsal | Failure/budget checks and grounding fixes |
| 2:40–3:00 | Support demo | Freeze working build | Lead demo + backup recording | Prepare live research result and clear fallback |

Critical handoffs: Rachel shares contracts by 0:20; Sushant shares fixtures by 0:30; Julia shares callable capture and Maryam shares endpoint schemas by 1:00; all four run the integrated flow together at 1:30. Pair on integration failures rather than adding more features.

## Keep the demo small

**Required:** one portal, confirmed resume text, role-specific X discovery, up to three people, source-backed context, fresh person-specific writing, review/copy/open X, and saved relationship notes.

**Add after that:** text-PDF import, more portal adapters, coffee-chat preparation, manual follow-up reminder, and a richer relationship board.

**Cut first:** swarm, automatic scheduling/calendar integration, background follow-up engine, analytics, multi-device sync, and inbox/reply detection. Never cut evidence display or replace person-specific writing with templates to save time.

## Shared demo acceptance check

1. Open a real supported job; confirm the detected company and role.
2. Load confirmed resume facts and request relevant people on X.
3. Show why two people are relevant and the actual sources behind the recommendations.
4. Generate two individually composed interactions and explain how each responds to the person’s public post/style while retaining the user’s voice.
5. Edit/copy a draft and open the exact X post/profile. Sending is a user action.
6. Record an interaction, add a coffee-chat next step, and recover it after reopening the panel.
7. Switch jobs and verify old results remain associated with their original posting.

No application submission, outreach sending, calendar invitation, or public publishing is part of this planning task.
