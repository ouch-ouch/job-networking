# Coffee Chat Copilot / networkMAX — Unified Project Spec

> NYU Shipyard hackathon · 4 people · 3 hours
> A browser extension modeled on Tsenta's Networking dashboard: it recognizes the job you're applying for, finds people worth a coffee chat (on LinkedIn, by email, and on X), writes the outreach, sends or hands it off once you approve, and keeps following up until a meeting is on the calendar.

Status: merged specification, v0.4. Union of the original hackathon spec (`SPEC.md`, LinkedIn + email + template workflow) and the personal X/Grok spec (`X-NETWORKING-SPEC.md` v0.3, job-triggered, person-specific X networking)
Prepared: 2026-10-24
Primary user: Sushant (personal X branch); NYU students generally (hackathon framing)
Platform: Chrome MV3 extension on job portals, LinkedIn, Gmail, and X; Chromium/Brave compatibility to be verified

**How to read this spec.** Requirements are tagged by channel where they differ: **[Email]**, **[LinkedIn]**, **[X]**. Untagged requirements apply to every channel. Where the two source specs contradict each other, both positions are kept and the conflict is listed in §0 for the team to decide. Until a decision is made, the "Working resolution" column says how this merged spec treats it.

---

## 0. Conflicts between the source specs (decisions needed)

| # | Topic | Original hackathon spec | X/Grok spec | Working resolution in this doc |
|---|---|---|---|---|
| 1 | Product name | "Coffee Chat Copilot" (placeholder) | "networkMAX" | Both names kept; pick one (§20) |
| 2 | Target user | NYU students (template says "at NYU") | Sushant personally; no facts prefilled until supplied | Both; profile data comes from onboarding |
| 3 | Channels | LinkedIn + email | X only; the X spec says it "takes precedence over the separate hackathon proposal's template/LinkedIn workflow" | All three channels, tagged per requirement |
| 4 | Message templates | Write **one** template with `{{placeholders}}`; AI only fills placeholders and keeps your wording | **No** reusable message bodies or placeholder templates; every message is composed fresh for the person, job, and thread | Template mode for [Email]/[LinkedIn]; per-person composition for [X] (§7) |
| 5 | Sending | Email sends through the Gmail API after approval | "No endpoint for posting or sending exists in MVP"; the user sends in native X | Gmail send exists for [Email] only; [LinkedIn] and [X] are always sent by the user in the native site |
| 6 | Finding emails | Guess work emails from patterns (`first.last@` etc.) with a confidence score (P0) | "Contact-email harvesting" is outside the build | Email guessing kept for [Email]; never used on X data |
| 7 | Scraping | Scrape LinkedIn people-search results and profiles the user opens | No private-account scraping, no cookie extraction, no continuous timeline/DM reading | LinkedIn reading follows the §13 approval and page-access rules; X capture is user-invoked, public pages only |
| 8 | AI provider + model | Grok `grok-4.7` via Snowflake Cortex REST; fallback `claude-sonnet-4-6`; Cortex AI SQL functions | xAI API with X Search; model configured server-side and validated at setup, never hardcoded across the app | Cortex for the agent loop, drafting, and SQL AI functions; xAI X Search adapter for X research. (The hackathon spec doesn't establish that Cortex offers X Search, so X research needs the xAI API.) |
| 9 | Backend + storage | `chrome.storage.local` as source of truth + Snowflake tables via `/sync`; Vercel backend | Node/TS backend, PostgreSQL, durable background-job runner; hosting vendor not fixed | Hackathon tier = storage.local + Snowflake on Vercel; production tier = Postgres + durable jobs (§10) |
| 10 | Follow-up cadence | No reply after 3 days, then 7; max 2 follow-ups, then "cold"; drafts auto-queued for approval | Reminder suggested after 7 days; at most 1 gentle follow-up, then pause until resumed; reminders only | Per channel: [Email]/[LinkedIn] use 3/7/max 2; [X] uses 7/max 1 (§9) |
| 11 | Contact stages | `found → drafted → sent → followed_up → replied → scheduled → met → thanked / cold` | `saved, engaging, contacted, replied, chat_planned, chat_completed, keep_in_touch, archived` + `do_not_contact` flag | Both lists kept with a mapping (§9.3) |
| 12 | Stage changes | Automatic (scheduler and reply detection move contacts forward) | Explicit user actions only in MVP | Automatic for [Email]; explicit user action for [LinkedIn] sent-marking and all [X] stages |
| 13 | Shortlist size | "Top N"; demo shows 6 contacts and 6 drafts | Up to 3 initial matches, never padded; "Find more" for more | [Email]/[LinkedIn] top N (demo 6); [X] up to 3 |
| 14 | Ranking signals | Warm paths first: NYU alumni, shared employers, shared orgs, 2nd-degree connections | 0–100 evidence score (role, company, shared interests, recent activity, conversation opening); never claim "in my network" from shared interests alone; no follower count | Both scoring schemes, per channel (§6) |
| 15 | Prep-brief questions | 5 picked from the user's approved question bank | 3 relevant questions | Default 5 from the bank; decide whether X chats use 3 |
| 16 | Calendar | P1: create Google Calendar event with Meet link + invite once a time is agreed | "Later"; a pasted booking link or proposed time does not count as a confirmed booking; team plan cuts calendar first | Calendar is P1 for [Email]; for [X] a chat is only confirmed when the user records it |
| 17 | Reply detection | Gmail thread polling (P1), LinkedIn messaging scrape (P2) | Never read private inboxes; native sends aren't observable; team plan cuts inbox/reply detection first | Gmail polling kept for [Email]; no inbox reading on X |
| 18 | Team split | Rachel = A (UI + demo + Snowflake/GCP setup); B, C, D = unnamed master's students | Julia = job capture, Rachel = extension core/integration, Sushant = UI, Maryam = Grok backend | Both splits listed (§15); pick one |

---

## 1. Problem, pitch & product intent

Cold outreach for coffee chats is repetitive: find the right people, find their email, write a message that doesn't sound like a template, remember to follow up, go back and forth to schedule, then prep for the chat. Most people give up after the first message.

**Coffee Chat Copilot** does all of it from a Chrome side panel. For [Email]/[LinkedIn] you write your message **once** and the AI fills in the details for each person and job, so every message reads like you wrote it. Nothing goes out until you approve it.

**networkMAX (X direction).** While I am applying for a job, the extension recognizes the company and specific posting in my open job portal. Grok uses that job context and my resume to find relevant people on X, understand their public conversational style, and help me interact naturally with each person. Those interactions can lead to coffee chats and job opportunities.

The X core loop:

**Open a job posting → recognize company and role → match my resume → research relevant people on X → choose a useful conversation → write for that person and context → coffee chat → follow-through.**

Optimize for meaningful reciprocal conversations and relevant opportunities. Follower counts and interaction volume are secondary diagnostics. The product cannot promise a job, a reply, or a referral.

**Demo line:** "Paste a job link, approve 5 messages, and the extension keeps going until you have coffee chats on your calendar, with your questions ready."

---

## 2. Reference and evidence boundary

Requested reference: https://dashboard.tsenta.com/dashboard/networking

On retry, native browser control worked: Chrome redirected to login, while an existing Brave networking tab exposed no readable page content. Public HTML and frontend bundles were successfully retrieved and inspected. They establish company search, applied-company navigation, three-contact outreach-bundle requests, contact categories, email/LinkedIn drafting, company news, and daily usage UI. Rendered behavior, authenticated data, backend algorithms, and actual delivery remain unverified. Claude Code was consulted but its CLI was not logged in. See [the detailed evidence record](TSENTA-RESEARCH.md).

This is an original implementation specification informed by static reverse engineering of the public frontend and the user's networking goals. It is not a complete reconstruction of Tsenta's backend or a claim of runtime feature parity. Do not copy its branding/assets or depend on its private API.

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

---

## 3. Scope and feature list

### P0 — must work in the demo
- [ ] Chrome MV3 extension with a **side panel** UI
- [ ] Profile + **single message template** with `{{keyword}}` placeholders **[Email]/[LinkedIn]**
- [ ] Paste a job description → AI extracts job fields
- [ ] Contact list scraped from a LinkedIn people search results page (fallback: add by hand) **[LinkedIn]**
- [ ] Email guess per contact from common patterns (`first.last@`, `flast@`, `first@` + company domain), with a confidence score. Required: scraping gives no emails. **[Email]**
- [ ] AI fills the template per contact (keywords + personalized hook) **[Email]/[LinkedIn]**
- [ ] **Approval Queue**: edit / approve / reject / regenerate
- [ ] Send email via Gmail API after approval **[Email]**
- [ ] **Activity / Messages bar**: timeline + per-contact status
- [ ] Follow-up scheduler (`chrome.alarms`) that queues AI follow-up drafts for approval

### P1 — strong demo additions
- [ ] LinkedIn fill: after approval, the content script fills the connect note / message box. The user clicks Send, and a "Mark sent" button (or a detected click on Send) logs it. **[LinkedIn]**
- [ ] **Warm-path ranking:** detect NYU alumni, shared employers, shared orgs, and 2nd-degree connections from the scraped profile; boost relevance and feed the warm path into `{{personal_hook}}` **[LinkedIn]**
- [ ] Gmail reply detection (poll threads) + AI reply classification **[Email]**
- [ ] Google Calendar event creation with a Meet link + invite once a time is confirmed
- [ ] **Question bank:** the AI suggests questions as Add / Skip cards (editable), the user can write their own, and questions are tagged by category
- [ ] **Pre-chat prep brief** that picks 5 questions from the approved bank for each scheduled chat (on demand from a contact card; auto-attached to the calendar event)
- [ ] **Post-chat thank-you + referral ask** (triggered once the event's end time passes)
- [ ] Contact pipeline board: `Found → Drafted → Sent → Followed up → Replied → Scheduled → Met → Thanked / Cold`

### P2 — stretch
- [ ] Email verification via the Hunter.io API (swap in for the guessed email when a key is set) **[Email]**
- [ ] LinkedIn reply detection (scrape the messaging page) **[LinkedIn]**
- [ ] Question ranking by post-chat feedback ("landed well" questions get picked more)
- [ ] Analytics: reply rate per template, best send times

### X channel MVP **[X]**
- Job-portal recognition of the current company, posting, role, job ID, description, and location, with source evidence and correction controls.
- Resume import and editable professional profile.
- Target roles, companies, locations, interests, and exclusions.
- Grok-assisted person and conversation discovery with source links.
- Company workspace with name/domain disambiguation, optional role/job context, an initial three-person shortlist, and a bounded "Find more" action excluding prior results.
- Explainable candidate ranking and manual save/dismiss.
- Individually composed reply, DM, coffee-chat, and follow-up drafts informed by the person's public communication style; no reusable message bodies or placeholder templates.
- Relationship history, reminders, chat preparation, and outcome tracking.
- Daily action queue inside a side panel while browsing X.
- Copy drafts and open the relevant X page; the user sends in native X.
- Persistent full-page extension workspace for the relationship board and settings.

### Later
- Optional supported X API integration for verified interaction history, subject to access, permissions, and policy review.
- Calendar integration for availability and confirmed bookings on the X flow (already P1 for [Email]; see §0 #16).
- Optional direct Grok Bot adapter if a documented, supported integration becomes available.
- Multi-device sync and richer reporting after validating the personal workflow.

### Outside this build
Job auto-application, ATS form filling, bulk messaging, automated likes/follows, automatic cold replies, contact-email harvesting (see §0 #6 for how this relates to [Email] guessing), private-account scraping, account-cookie extraction, and guaranteed job placement.

---

## 4. User journeys

### 4.1 Onboarding: teach it who I am

1. **Connect accounts.** Connect Google (Gmail + Calendar), make sure you're logged into LinkedIn, and add a short profile: name, school, background, a resume summary, and a scheduling link or your availability.
2. **Import the resume.** Import a text-based PDF or paste resume text. Offer paste fallback for scans; OCR and DOCX can follow later.
3. Parse locally where practical. Show extracted facts for editing and confirmation before remote processing.
4. Capture skills, experience, education, projects, portfolio links, and evidence excerpts. Never invent metrics or experience.
5. Ask for target roles/seniority, companies, locations/time zone, remote preference, interests, X handle, and preferred tone.
6. Let the user select which professional facts may be shared with the model and which may appear in outreach. Default phone, street address, personal email, and other private fields to excluded.
7. Save a versioned profile. Discovery and drafts use the latest confirmed version; changing the resume marks older results/drafts as potentially stale.
8. **Seed the question bank** by clicking Add on a few AI-suggested questions (§4.8).
9. **[Email]/[LinkedIn] Write your template once.** Example:
   > Hi {{first_name}}, I'm {{my_name}}, a {{my_year}} at NYU studying {{my_major}}. I saw {{company}} is hiring for {{role}} and noticed you work on {{their_team}}. {{personal_hook}} Would you be open to a 15-minute coffee chat?

No specific roles, companies, degree, employment history, or skills should be prefilled as Sushant's facts until supplied.

### 4.2 Add a target: I am applying for this job

1. **Add a target.** Paste a job description or job URL, or open a job posting with the extension active. The AI extracts company, role, team, key skills, and location.
2. I open the employer's job portal or a specific job posting and open the extension. With optional site permission enabled for a supported portal, the extension can recognize subsequent postings automatically on that site.
3. The panel shows the detected company, title, job ID/canonical URL, location, requirements, and a short summary. It distinguishes the ATS provider from the employer. Each extracted field retains a page/structured-data evidence reference; ambiguity is flagged for correction.
4. The extension combines this posting with my confirmed resume, showing relevant experience and any gaps. It never invents fit or edits/submits my application.

Detection starts with supported adapters for Greenhouse, Lever, and Ashby, plus generic job pages with usable `JobPosting` structured data or clearly identified visible job content. Treat adapter coverage as a build target until tested. For the hackathon, `document.body.innerText` on LinkedIn / Greenhouse / Lever is enough to grab the description. On application forms, capture only the posting/header context, never form field values, resume uploads, account data, or application answers. If the page is only a company portal landing page or has several jobs, identify the company and ask the user to open/select a posting instead of guessing a role. Embedded frames, inaccessible descriptions, scans, login-only content, and unknown layouts fall back to a pasted description/URL or manual correction. Do not claim support for arbitrary portals without verifying them.

Use canonical URL + employer job ID when available for deduplication. Re-evaluate on supported SPA route/job changes, cancel or mark obsolete work after a job switch, and never show one job's drafts as belonging to another. Existing relationships persist across applications, so the assistant can flag prior contact with someone at the same company.

### 4.3 [Email]/[LinkedIn] Template outreach flow

1. **Find people.** The extension opens a LinkedIn people search for the company (e.g. `"<company>" <role keywords>`, plus an NYU alumni filter) and reads all currently visible, readable contacts on that results page, without a per-import cap or app daily profile quota. The user opens each additional results page before importing it. Contacts are ranked with **warm paths first**: NYU alumni, shared past employers, shared clubs or orgs, and 2nd-degree connections. Each gets a relevance score and a one-line reason ("NYU '22, same team as the role"). The extension then finds or guesses each contact's work email.
2. **Generate messages.** For each contact, the AI fills the `{{keywords}}` from the job description and the person's profile, and writes `{{personal_hook}}` itself. Output: a LinkedIn note (300 characters max for connection requests) and/or an email (subject + body).
3. **Approve.** Every draft lands in the **Approval Queue**. The user can edit, regenerate, approve, or skip. **Nothing sends without approval.**
4. **Send.** Email goes out through the Gmail API. LinkedIn: after approval, the content script opens the profile and fills in the connect note or message box. **The user clicks Send in LinkedIn**, and the extension then marks the message as sent. This keeps the LinkedIn account safe.
5. **Follow up.** If there's no reply after N days (default 3, then 7), the AI drafts a follow-up and puts it back in the Approval Queue. Max 2 follow-ups per contact, then the contact is marked "cold".
6. **Reply → schedule.** When a reply arrives, the AI classifies it (interested / proposes time / not interested / referral / out of office). If they're interested, it drafts a scheduling reply. When a time is agreed, it creates a Google Calendar event with a Meet link, invites the contact, and sends a confirmation email (also approved by the user).
7. Continue with the question bank, prep brief, and thank-you (§4.8–4.9).
8. **Activity / Messages bar.** One timeline of everything: sent, replied, follow-up due, scheduled, thank-you sent, plus a per-contact thread view.

### 4.4 [X] Find people for this job

1. I select "Find people for this job." Grok or a bounded research swarm searches X for relevant team members, hiring contacts, recruiters, and professional connections, returning up to three strong initial matches.
2. Each person card explains their relevance to this exact job, cites their identity/affiliation, and identifies a recent substantive post or other legitimate conversation opening.
3. I choose a person. Grok reads enough recent relevant public writing to propose an interaction that fits this person's conversational style, the actual thread, and my own voice. It recommends a useful reply, a direct question, or a coffee-chat invitation depending on context; a fixed warm-up sequence is not required.
4. I review and edit the draft, open X, and send. The relationship, draft, and subsequent coffee-chat/outcome records stay linked to this job and person.

### 4.5 [X] Daily session: a small, useful queue

Open the extension on X. "Today" shows a configurable queue, initially five relevant posts, three people worth researching, and due follow-ups. These are workload defaults, not promises of platform-safe sending limits. The user can skip, save, or act on each item.

### 4.6 [X] Company session: people at a company I care about

Search a company by name or domain, confirm ambiguous matches, and optionally attach a target role/job URL or manually recorded application. Generate an initial shortlist of up to three evidenced X contacts, grouped where useful into relevant practitioners/hiring team, recruiters, and shared professional connections. Never label someone "in my network" based on shared interests alone. If fewer than three supported matches exist, show fewer. Each card includes an affiliation source, relevance to confirmed resume facts, recent conversation context, and recommended next action. "Find more" starts a separately budgeted search excluding previous results. This flow works without importing Tsenta applications or building an ATS tracker.

Every recommendation answers:

- Why this person or conversation fits my goals.
- What public evidence supports that assessment, with dates and links.
- What I can usefully contribute from my actual background.
- What action makes sense now: read, reply, save, ask a question, or draft an invitation.

### 4.7 [X] Build a relationship

The user opens a source post, reads it, and requests a draft. The assistant offers a concise contribution or specific question, plus a brief explanation of the relevant resume connection. The user edits and copies the text, sends it in X, then optionally records the sent-post URL.

The extension must not mark a copied draft as sent. "Mark sent" is a separate action, with optional evidence URL. Native sends are not automatically observable in the MVP.

A prior exchange can support a coffee-chat recommendation, but is not a mandatory sequence or proof of friendship. Direct invitations may also make sense when there is a specific shared interest. Never manufacture familiarity or ask for a referral by default.

### 4.8 Question bank

The AI suggests coffee-chat questions based on your profile, your targets, and the kinds of people you're meeting (e.g. "What does a first-year analyst's week look like on your team?"). Each suggestion shows up as a card with **Add / Skip** buttons, and you can edit any question before adding it or write your own. Added questions go into your bank, tagged by category (role, team, career path, company culture, recruiting process, advice).

### 4.9 Coffee chat and follow-through

- **Invitation.** Generate a short invitation proposing a 15–20 minute chat, with a specific reason and optional virtual/in-person preference. After the recipient agrees, help draft scheduling text. **[X]** A pasted booking link or proposed time does not count as a confirmed booking.
- **Confirmed chat.** Record time zone and date. **[Email]** When a time is agreed, create the Google Calendar event with a Meet link and invite (§4.3 step 6).
- **Prep brief.** Once a chat is scheduled (and on demand), the AI **picks 5 questions from your approved bank** that fit this contact and job, lightly tailoring the wording ("...on the payments team?"). It only writes a new question if the bank has nothing relevant, and marks that one "new: add to bank?". The brief also covers the contact's background, the warm path you share, and recent company news or the job's focus, and it's attached to the calendar event description. The X spec's version is a one-page preparation view with public background, three relevant questions, a short self-introduction, and optional goals (see §0 #15).
- **Thank-you + referral ask.** After the meeting ends, the extension asks "How did it go?" and lets you jot quick notes (and mark which questions landed well) and record commitments. The AI then drafts a thank-you that references something from your notes, plus a soft referral ask for the target role. Both go to the Approval Queue. **[X]** Never ask for a referral by default; the referral paragraph is optional and off unless selected.
- Schedule follow-up reminders only; never send unattended.

---

## 5. Screens and UI behavior

Side panel (React + Vite + Tailwind) sections from the hackathon spec: Onboarding / Profile / Template editor (highlight `{{placeholders}}`), Targets (job descriptions) & Contacts, **Approval Queue** (edit / approve / reject / regenerate), **Question Bank** (Add / Skip / edit cards), prep-brief view, post-chat notes prompt, **Activity / Messages bar** (including the expandable Grok agent trace and reply-sentiment badges), pipeline board.

| Surface | Required content and actions |
| --- | --- |
| Current job | Detected employer/role/posting evidence, correction, resume match, find-people action, research progress, job-switch warning |
| Today | Job-linked recommendations, due reminders, next action, refresh/cancel research |
| Discover | Natural-language query; company, role, topic, recency filters; source-backed people/posts; save/dismiss |
| Companies | Target-company list/search, disambiguation, optional role/job context, three-person shortlist, evidence-backed company/post context, find-more and usage states |
| Person detail | Handle, bio, professional evidence, match reasons, unknowns, source posts, history, notes, draft actions |
| Draft editor | Draft type, editable text, source context, facts used, regenerate, copy, open X, mark sent separately |
| Approval Queue | Every pending draft across channels; edit, approve, reject, regenerate; email-guess confidence shown on email drafts |
| Question Bank | AI-suggested question cards (Add / Skip / edit), user-written questions, categories |
| Activity / Messages | Timeline of all events, per-contact thread view, Grok agent trace, reply-sentiment badges |
| Relationships | Searchable board/list; last contact, stage, next action, reminders, linked career outcomes; pipeline board for template-flow contacts |
| Coffee chat | Invitation, confirmed logistics, preparation, notes, commitments, thank-you/follow-up drafts |
| My profile | Resume import, confirmed facts, targets, public summary, tone, excluded facts, template editor |
| Settings | Research connection, spending limit, retention, export/delete, permissions, provider status, demo-mode toggle |

Side panel: target roughly 360–440 px width with a single-column layout, accessible labels, keyboard navigation, and readable source links. The full-page workspace supports larger lists and board navigation. Refresh must show loading, partial results, last successful run, error, and retry states. Empty results should suggest broadening a filter without inventing contacts.

MVP supports user-invoked capture of the current job posting or public X profile/post. Automatic portal detection is available only on supported origins with explicit optional site access. Support URL/description paste as a fallback. Do not continuously read the timeline or private DM inbox. X SPA navigation requires rechecking the current URL and context before capture; if the selected profile/post is ambiguous, ask the user to choose or paste its URL.

---

## 6. Discovery and ranking

### 6.1 [LinkedIn] Warm-path ranking

- Build the search URL from a `Target` (company + role keywords + NYU filter) and scrape the results page → `Contact[]` (name, title, profile URL, degree).
- Scrape education + experience from profiles → `warmPaths` (`alumni`, `past_employer`, `shared_org`, `mutual_connection`).
- Warm paths boost `relevance` (0–100); each contact gets a one-line `reason`.
- Snowflake ranking: `AI_EMBED` + `AI_SIMILARITY` of the job description to each contact's headline + experience, plus a warm-path boost in SQL (§8.2).

### 6.2 [X] Evidence-based discovery

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

---

## 7. Messaging

### 7.1 [Email]/[LinkedIn] Template mode — rules for `/ai/fill-template`

- Keep the user's wording. Only replace `{{placeholders}}`; don't rewrite the rest.
- `{{personal_hook}}`: one sentence that ties the contact's profile to the job or the user's background. **Lead with the strongest warm path** if there is one ("Fellow NYU Stern grad here"). No flattery and no made-up facts. If there's nothing real to say, leave it out.
- LinkedIn connect notes: 300 characters max, hard limit (enforced in code, not just the prompt).
- No em dashes, no "I hope this finds you well". Write the way a student actually writes.

### 7.2 [X] Per-person drafting contract

Inputs: confirmed profile facts, originating job context, selected person/post evidence, observed public communication preferences with source references, goal, user-selected relationship context, the user's voice preferences, and selected prior exchanges supplied by the user. Private conversation text is remote-processed only after explicit selection and disclosure.

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
- Adapt observable features such as brevity, formality, technical depth, directness, and light humor when supported by public examples. Match the current thread first; keep the user's own voice and avoid copying signature phrases or pretending to be the recipient.
- Treat "vibe" as a tentative communication preference, not a diagnosis or hidden personality score. Do not infer private feelings, sensitive traits, vulnerabilities, or willingness to help.
- With sparse or conflicting evidence, use the user's natural neutral voice and show the uncertainty. Never force slang, jokes, or false familiarity.
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

Draft review should expose "Why this approach": the specific post/context, supported style observations, and relevant user fact. This explanation stays outside the outgoing text. A technical practitioner asking a detailed design question may warrant a compact technical contribution; a concise recruiter post may warrant a direct role-specific question. These are strategy examples, never reusable message scripts.

---

## 8. AI layer

### 8.1 AI endpoints (backend contracts, hackathon tier)

All endpoints return JSON. Generative routes call Grok through the Cortex REST API with `response_format: { type: "json_schema", ... }` so the result always parses. Routes marked **SQL** run a Cortex AI SQL function instead (see §8.3).

| Endpoint | Input | Output |
|---|---|---|
| `/ai/parse-job` **SQL** | `rawDescription` | `{ company, role, team, location, skills[] }` |
| `/ai/fill-template` | `template, profile, target, contact` | `{ subject?, body, filledKeywords }` |
| `/ai/follow-up` | `originalDraft, followUpCount, daysSince, contact` | `{ subject?, body }` |
| `/ai/classify-reply` **SQL** | `replyText` | `{ intent: "interested" \| "proposes_time" \| "not_interested" \| "referral" \| "ooo", proposedTimes?: string[] }` |
| `/ai/schedule-reply` | `replyText, availability, proposedTimes?` | `{ body, chosenSlot?: { start, end } }` |
| `/ai/suggest-questions` | `profile, targets[], existingBank[]` | `{ questions: { text, category }[] }`: 5–10 new ones, no duplicates of the bank |
| `/ai/prep-brief` | `contact (scraped profile), target, profile, approvedBank[]` | `{ summary, warmPathTalkingPoint, companyContext, picked: { questionId, tailoredText }[5], newQuestions?: { text, category }[] }`: picks from the bank first; adds new questions only to fill gaps |
| `/ai/thank-you` | `contact, target, userNotes` | `{ subject, body, referralAsk }`: the referral ask is a separate, optional paragraph the user can turn off |

**Rules for `/ai/prep-brief` questions:**
- Only pick questions with `status: "approved"`, and avoid repeating questions already used with the same company.
- Tailoring may only swap in specifics (team, role, company); the question has to stay recognizable as the user's.
- Shortlist candidates with **`AI_SIMILARITY`** (question text vs. contact profile + job) first, then let Grok pick the final 5 from the top 15.

### 8.2 Grok agent (via Snowflake Cortex)

Grok (`grok-4.7`, called through Cortex REST `POST /api/v2/cortex/v1/chat/completions` with `tools`) is the agent that runs the outreach loop. The backend runs a standard tool-calling loop: send messages + tools, run whatever tool Grok calls, append the result, repeat until Grok returns a final answer (max 8 steps). (The X spec asks that the model be configured server-side and validated at setup rather than hardcoded throughout the app; keep `grok-4.7` in one config value.)

**When it runs** (`POST /agent/run` with a trigger):

| Trigger | What Grok does |
|---|---|
| `new_target` | Parse the job, rank the scraped contacts, pick the top N, draft an initial message for each |
| `tick` (scheduler) | Look at contacts that are due, decide follow up / wait / mark cold, draft follow-ups |
| `reply_received` | Classify the reply, then draft a scheduling reply, propose a slot, or stop |
| `meeting_soon` | Build the prep brief from the question bank |
| `meeting_done` | Draft the thank-you + referral ask from the user's notes |

**Tools Grok can call** (all implemented in the backend):
`get_profile`, `get_template`, `get_contacts(targetId)`, `rank_contacts(targetId)` (runs the `AI_SIMILARITY` query), `fill_template(contactId)`, `classify_reply(text)` (runs `AI_CLASSIFY`), `get_availability()`, `search_question_bank(contactId)` (runs `AI_SIMILARITY`), `queue_draft(draft)`, `set_next_action(contactId, at)`, `log_activity(event)`.

**Guardrail:** there is **no send tool**. The most Grok can do is `queue_draft`, which puts the message in the Approval Queue. Sending only happens when the user clicks Approve in the extension.

**Agent trace in the UI:** every tool call is logged to `activity` with `type: "agent_step"`, so the Activity bar can show "Grok ranked 12 contacts → drafted 5 messages" with an expandable trace. Judges like seeing the agent's steps.

### 8.3 How else we use Snowflake AI

Each one replaces a hand-written prompt with a Snowflake-native feature, which is cheaper, faster, and easy to show in the demo.

| Feature | Snowflake AI used | How |
|---|---|---|
| Parse job description | `AI_EXTRACT` | `AI_EXTRACT(text => :jd, responseFormat => ['company','role','team','location','skills'])` |
| Reply intent | `AI_CLASSIFY` | Categories: `interested`, `proposes_time`, `not_interested`, `referral`, `ooo` |
| Proposed meeting times | `AI_EXTRACT` | Pull `proposed_times` from the reply, then Grok picks a slot that matches the user's availability |
| Reply warmth | `AI_SENTIMENT` | Show a warm / neutral / cold badge on each reply in the Messages bar |
| Contact ranking | `AI_EMBED` + `AI_SIMILARITY` | Similarity of the job description to each contact's headline + experience, plus a warm-path boost in SQL |
| Question bank picking | `AI_SIMILARITY` | Shortlist relevant approved questions for each meeting |
| Duplicate questions | `AI_SIMILARITY` | Skip AI-suggested questions with similarity above 0.9 to one already in the bank |
| Insights panel (P2) | `AI_AGG` | "What do my replied-to messages have in common?" over `drafts` joined to `activity` |
| Privacy (P2) | `AI_REDACT` | Strip personal info from message bodies before they're stored for analytics |

**Data sync:** `chrome.storage.local` stays the live cache for the UI. The backend writes every contact, draft, question, meeting, and activity event to Snowflake (`POST /sync`), so the SQL AI functions above can run on real rows. Tables mirror the types in §11.1, one table per type, with a `user_id` column.

**Setup checklist (first 20 minutes):**
1. Create a Snowflake trial account (or use the hackathon-provided one).
2. Turn on cross-region inference, which Grok needs: `ALTER ACCOUNT SET CORTEX_ENABLED_CROSS_REGION = 'ANY_REGION';` (needs ACCOUNTADMIN).
3. Create a role with `SNOWFLAKE.CORTEX_USER`, a warehouse, and a database `COFFEE_CHAT` with the tables.
4. Create a programmatic access token (PAT) for the backend and put it in Vercel env vars with the account URL.
5. Smoke test: one `AI_COMPLETE('grok-4.7', 'say hi')` in a worksheet, then one REST call from the backend.

**Fallback:** if Grok isn't available on the account, switch the model string to `claude-sonnet-4-6` on the same Cortex endpoint. Nothing else changes.

> **⚠️ Blocker found 2026-10-24: the current Snowflake account is a trial, and trials can't use any Cortex AI.** Setup (`snowflake/setup.sql`) and the token work, but every AI call fails:
>
> | Check | Result |
> |---|---|
> | Token + SQL API connection (8 tables visible) | ✅ works |
> | Cortex REST `/v1/chat/completions`, `grok-4.7` | ❌ 403 "This account is not allowed to access this endpoint" |
> | Same endpoint, `claude-sonnet-4-6` fallback | ❌ same 403, so the fallback above does not help |
> | `AI_COMPLETE('grok-4.7', ...)` | ❌ "not available for trial accounts" |
> | `AI_EXTRACT`, `AI_CLASSIFY`, `AI_SENTIMENT`, `AI_SIMILARITY` / `AI_EMBED` | ❌ "not available for trial accounts" |
>
> This blocks the never-cut items (Grok agent loop, `AI_EXTRACT`, `AI_CLASSIFY`). Next steps:
> 1. Ask the organizers for a hackathon Snowflake account or credits (the real fix). On a new account, re-run `setup.sql`, update `.env` / Vercel env vars, and re-run the check.
> 2. C needs to know now; the whole backend depends on this.
> 3. Converting the trial to a paid account may unlock Cortex. Unconfirmed: check before paying.
> 4. Backup plan: call Grok directly through the xAI API (needs an xAI key) and replace the SQL AI functions with prompts. This is the same xAI adapter the X channel uses (§8.4).

### 8.4 [X] Grok research integration (xAI API + X Search)

Use a backend adapter to the **xAI API with X Search** as the default research engine. Its documented search tools include keyword, semantic, user, and thread search [S2]. Configure the model server-side; validate a tool-compatible model during setup rather than embedding a model name throughout the application.

Do not assume a consumer Grok subscription supplies API access or credits. Show separate connection and billing status for the backend's configured API access.

**Grok Bot is a separate integration option.** X describes @bot as forwarding public requests to a connected Grok Bot [S3]. This does not establish an API that a Chrome extension can invoke. MVP may offer "Copy research prompt for Grok Bot," using only the approved public professional summary, but must not publish that prompt or the resume. Do not automate Grok's website, use private endpoints, or treat an @bot mention as a private channel.

Provider interface:

```ts
interface NetworkingResearchProvider {
  discover(input: DiscoveryInput): Promise<DiscoveryResult>;
  researchPerson(input: PersonResearchInput): Promise<PersonResearch>;
  draft(input: DraftInput): Promise<ValidatedDraft>;
}
```

Implement `XaiResearchProvider` first. A future `GrokBotProvider` must satisfy the same contract using verified supported interfaces. The shipped UI should call the feature "Grok research" and accurately identify which provider is connected.

### 8.5 [X] Optional bot swarm orchestration

The user may run one Grok research worker or a bounded swarm behind the same interface. A swarm is an implementation option, not a user requirement to manage several bots. Begin with one worker and enable parallel research only when it improves relevance or latency within the configured budget.

| Worker role | Input | Output |
| --- | --- | --- |
| Job reader | Captured job evidence | Company identity, role, requirements, unknowns |
| People researcher | Confirmed job context and approved resume facts | Relevant X identities with affiliation and role evidence |
| Conversation researcher | Selected people and recent public threads | Useful conversation openings and observed communication preferences |
| Writer/reviewer | One person, thread, job, approved user facts | A fresh draft and checks for grounding, tone, and duplication |

A coordinator shares source references and job/profile versions, merges duplicates, cancels superseded work, and enforces an aggregate budget/concurrency limit. Conflicting findings remain visible as uncertainty. Workers cannot independently send messages, start unlimited child workers, or promote one another's unsupported claims to facts. All output attaches to the originating job context and person. Parallelize independent people research; writing waits for the relevant evidence.

---

## 9. Follow-up engine and relationship tracking

### 9.1 Scheduler (`chrome.alarms`)

- `chrome.alarms` runs every 15 minutes (every 1 minute in demo mode) and calls `POST /agent/run` with the matching trigger. The steps below are what the Grok agent is instructed to do; the hard limits (max follow-ups, intervals) are also checked in code.
- **[Email]/[LinkedIn]** For each contact where `stage ∈ {sent, followed_up}` and `nextActionAt <= now`:
  1. Check Gmail for a reply on the thread. If there is one, set `stage = replied` and classify it.
  2. If there's no reply and `followUpCount < MAX_FOLLOW_UPS (2)`: generate a follow-up draft, put it in the Approval Queue, and set `nextActionAt = now + interval[followUpCount]` (3 days, then 7).
  3. Otherwise set `stage = cold`.
- For each `Meeting` whose start is less than 24 hours away and has no `prepBrief` yet: generate the brief from the question bank and patch the calendar event description.
- For each `Meeting` whose end time has passed: set `stage = met`, show a "How did it go?" notes prompt, and once notes are saved (or after 2 hours, with no notes), queue a thank-you draft.
- **Demo mode toggle:** shrinks intervals to minutes so the full loop can be shown live.

The service worker is not a durable job runner in production (§10.3); the alarm only triggers server-side work.

### 9.2 [X] Relationship rules

Relationship stages: `saved`, `engaging`, `contacted`, `replied`, `chat_planned`, `chat_completed`, `keep_in_touch`, `archived`.

Stage changes are explicit user actions in MVP. An "engaging" event may be recorded without implying a reciprocal relationship. `chat_planned` requires user confirmation of agreed logistics; `chat_completed` requires user confirmation. Allow corrections and store stage-change history. `do_not_contact` is an independent flag that suppresses all suggested outreach and reminders.

Track career outcomes separately: introduction, referral offered, referral received, role discovered, interview, offer, or closed. Each outcome links to a person and optionally a role/company and user notes. Do not force a strictly linear funnel; multiple people may contribute to one opportunity.

Follow-ups: user-configurable reminder, initially suggested after seven days. If the user records no reply, suggest at most one gentle follow-up, then pause until explicitly resumed. Seven days is a product default, not a platform rule. Respect declines immediately. Tasks must be deduplicated, snoozable, dismissible, and canceled when the contact is archived or flagged do-not-contact.

### 9.3 Stage mapping between the two pipelines

| Template pipeline (`Contact.stage`) | X relationship stage |
|---|---|
| `found` | `saved` |
| `drafted` | `saved` (draft exists) |
| — | `engaging` (public reply, no DM yet) |
| `sent`, `followed_up` | `contacted` |
| `replied` | `replied` |
| `scheduled` | `chat_planned` |
| `met` | `chat_completed` |
| `thanked` | `keep_in_touch` |
| `cold` | `archived` (or paused follow-up) |
| — | `do_not_contact` flag (applies to both) |

---

## 10. Architecture

### 10.1 Hackathon tier

```
┌──────────────────────── Chrome Extension (MV3) ─────────────────────────┐
│                                                                         │
│  Side Panel (React + Vite + Tailwind)                                   │
│   ├─ Onboarding / Profile / Template editor                             │
│   ├─ Current job / Targets (job descriptions) & Contacts                │
│   ├─ Approval Queue                                                     │
│   ├─ Question Bank                                                      │
│   └─ Activity / Messages bar                                            │
│                                                                         │
│  Service Worker (background.ts)                                         │
│   ├─ chrome.storage.local  (single source of truth)                     │
│   ├─ chrome.alarms         (follow-up + reply-poll scheduler)           │
│   ├─ chrome.identity       (Google OAuth → Gmail + Calendar APIs)       │
│   └─ message router between panel ↔ content scripts ↔ backend           │
│                                                                         │
│  Content Scripts                                                        │
│   ├─ linkedin-search.ts   scrape people search results                  │
│   ├─ linkedin-profile.ts  scrape a profile; fill connect note/message   │
│   ├─ job-page.ts          grab job description text from the open page  │
│   └─ x-capture.ts         user-invoked capture of a public X post       │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │ HTTPS
                     ┌────────────────▼────────────────┐
                     │  Backend (Vercel, Node/TS)      │
                     │   POST /agent/run   ← Grok loop │
                     │   POST /ai/*        (8 routes)  │
                     │   POST /sync        → Snowflake │
                     │   /v1/*   X research + drafts   │
                     │  Holds Snowflake PAT + xAI key  │
                     └───────┬─────────────────┬───────┘
         Cortex REST + SQL API│                 │ xAI API
  ┌──────────────────────────▼───────────────┐ ┌▼─────────────────────┐
  │  Snowflake                               │ │  xAI + X Search      │
  │   Cortex REST /v1/chat/completions       │ │   X person discovery │
  │     model: grok-4.7 (agent + drafting)   │ │   conversation       │
  │   Cortex AI SQL functions                │ │   research, X drafts │
  │     AI_EXTRACT, AI_CLASSIFY,             │ └──────────────────────┘
  │     AI_SENTIMENT, AI_EMBED /             │
  │     AI_SIMILARITY, AI_AGG                │
  │   Tables: contacts, drafts, activity,    │
  │     questions, meetings, targets         │
  └──────────────────────────────────────────┘
```

**Why a backend at all?** It keeps the Snowflake token and xAI key out of the extension bundle and is the only thing that talks to Snowflake and xAI.

**Stack:** TypeScript, React, Vite + `@crxjs/vite-plugin` (extension build with hot reload), Tailwind, **Snowflake Cortex AI** (Grok `grok-4.7` as the agent, Cortex AI SQL functions for extraction, classification, and similarity), Snowflake tables as the system of record, xAI API with X Search, Gmail API, Google Calendar API.

### 10.2 Production tier (from the X spec)

Suggested stack: TypeScript, React, Chrome Manifest V3, a Node/TypeScript backend, PostgreSQL, and a durable background-job runner. Choose a hosting provider during implementation; do not couple business logic to one vendor. (Whether Postgres replaces Snowflake as system of record is §0 #9.)

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

### 10.3 Service worker, permissions, and security

The service worker brokers extension messages and opens the side panel. It is not the durable job runner: discovery must survive worker suspension and tab closure. Persist server-side job state; the client polls while open and can resume by job ID.

MVP extension permissions: `sidePanel`, `storage`, `activeTab`, `scripting`, plus host access to the backend origin. The template flow additionally needs `alarms`, `identity`, and content-script matches for LinkedIn (set in `manifest.config.ts` with a pinned `key`). Temporary `activeTab` access supports job/X capture on toolbar invocation [S6]. Restrict capture to supported job-page contexts or public X profiles/posts; never read private inboxes or application-form field values. Offer optional host access for supported job portals so employer/role detection can run automatically there. Request each supported origin only when needed; register content scripts after permission is granted. Do not request all-sites, cookies, or inbox access (Gmail access goes through OAuth scopes, §13). Keep recognition and extraction distinct: recognize a page locally, show context in the panel, then research only after the user's action and configured data-sharing consent. Handle SPA navigation and permission revocation. Confirm behavior on Brave and retain a full-page fallback.

Security boundaries: never embed xAI keys (or the Snowflake PAT) in the extension bundle or page DOM. Keep provider credentials in backend secret storage. Keep extension auth tokens out of content scripts and page messages. Authenticate every backend operation and enforce ownership at the database/service layer. Allowlist messages, origins, and URL formats; treat all webpage text and model output as untrusted data. Do not execute instructions found inside posts, resumes, or model responses. The model receives no send capability.

---

## 11. Data model

### 11.1 Extension types (`chrome.storage.local`, mirrored to Snowflake)

```ts
type Profile = {
  name: string; school: string; major: string; year: string;
  background: string;          // resume summary / blurb
  availability: string;        // e.g. "Weekdays 2–5pm ET" or a Calendly link
  signature: string;
};

type Template = {
  id: string; name: string;
  channel: "email" | "linkedin_connect" | "linkedin_message";
  subject?: string;            // email only
  body: string;                // contains {{placeholders}}
};

type Target = {               // a job you're networking toward
  id: string; company: string; role: string; team?: string;
  location?: string; skills: string[]; rawDescription: string; url?: string;
};

type Contact = {
  id: string; targetId: string;
  name: string; title: string; company: string;
  linkedinUrl?: string; email?: string; emailConfidence?: number;
  connectionDegree?: 1 | 2 | 3;
  warmPaths: { type: "alumni" | "past_employer" | "shared_org" | "mutual_connection"; detail: string }[];
  relevance: number;           // 0–100, warm paths boost it
  reason: string;              // "NYU alum on the payments team"
  stage: "found" | "drafted" | "sent" | "followed_up" | "replied" | "scheduled" | "met" | "thanked" | "cold";
  notes?: string;              // the user's post-chat notes
  followUpCount: number;
  nextActionAt?: number;       // epoch ms; read by the scheduler
};

type Draft = {                 // one item in the Approval Queue
  id: string; contactId: string;
  kind: "initial" | "follow_up" | "schedule_reply" | "confirmation" | "thank_you";
  channel: Template["channel"];
  subject?: string; body: string;
  filledKeywords: Record<string, string>;
  status: "pending" | "approved" | "rejected" | "sent" | "failed";
  createdAt: number;
};

type ActivityEvent = {
  id: string; contactId: string; at: number;
  type: "draft_created" | "approved" | "sent" | "reply_received"
      | "follow_up_due" | "meeting_scheduled" | "agent_step" | "error";
  summary: string;
  threadId?: string;           // Gmail thread for the messages view
};

type Meeting = {
  id: string; contactId: string; start: string; end: string;
  calendarEventId: string; meetLink?: string;
  prepBrief?: string;          // markdown, also written into the event description
  questionIds: string[];       // questions picked from the bank for this chat
};

type Question = {              // question bank entry
  id: string; text: string;
  category: "role" | "team" | "career_path" | "culture" | "recruiting" | "advice";
  source: "ai_suggested" | "user_written";
  status: "suggested" | "approved" | "skipped";   // only "approved" questions can be picked
  timesUsed: number; landedWell?: number;          // from post-chat feedback
};
```

X drafts use `ValidatedDraft` (§7.2).

### 11.2 Server entities (production tier)

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

### 11.3 Overlap between the two models

| Extension type | Closest server entity |
|---|---|
| `Profile` | `ProfileVersion` |
| `Target` | `JobContext` / `TargetCompany` |
| `Contact` | `Person` + `Relationship` + `Recommendation` |
| `Draft` | `Draft` |
| `ActivityEvent` | `Interaction` / `Task` |
| `Meeting` | `CoffeeChat` |
| `Question` | (no X equivalent yet) |

---

## 12. Backend contracts (X / production) and failure handling

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

All endpoints require authentication. Use ownership checks, bounded pagination, schema validation, and idempotency on creation. No endpoint for posting or sending to X exists in MVP (Gmail sending for [Email] happens in the extension via the Gmail API after approval).

Retry transient provider errors with bounded exponential backoff and jitter; respect provider retry signals. Do not retry authentication, schema, or exhausted-budget errors blindly. Preserve drafts and partial research through failures. Show a clear distinction between no matches, incomplete research, unavailable sources, disconnected provider, exhausted budget, and invalid resume text. If X capture breaks, URL paste and manually entered context remain available.

---

## 13. Safety, privacy, cost, and platform constraints

**Sending and automation**
- **A human approves every send.** No auto-send, including follow-ups. Never send unattended.
- **LinkedIn: the extension fills, the user sends.** The extension never clicks Send on LinkedIn. Scraping only reads pages the user has opened themselves, one at a time.
- **X: the user sends in native X.** MVP research and drafting never clicks Send, Reply, Follow, or Like and never uses unattended action queues. Copying a draft never marks it sent.
- X restricts unsolicited automated replies/DMs, automated likes, and AI reply bots; current guidance requires written approval for AI reply bots [S4]. Any later sending integration needs a fresh access and policy review; user review alone is not evidence that every automation pattern is permitted.
- **App quotas:** no app-imposed daily email or profile-import quotas. Import all currently visible, readable contacts on the user-opened results page; do not paginate or navigate automatically. Provider-imposed restrictions still apply.
- **LinkedIn ToS:** LinkedIn's User Agreement prohibits scraping and automation, so the account could still be flagged. Keep volume low, use a test account for the demo, and be ready to explain the human-in-the-loop design if judges ask.
- **Email guesses:** only send to guessed addresses above a confidence threshold, and show the confidence in the approval card so the user decides.
- Stop following up as soon as someone replies or says no. Every email includes an easy opt-out line. Respect declines immediately.
- Gmail scopes: request only `gmail.send`, `gmail.readonly`, and `calendar.events`.

**Privacy and retention**
- Before the first remote request, disclose which approved profile fields go to xAI (and Snowflake) via the application's backend. Keep the original resume local by default and do not log raw resumes, private messages, or model prompts containing personal data.
- Store confirmed profile facts and user relationship records until deleted. Default external-source cache expiry to 30 days, subject to any shorter provider/platform obligations; expire cached excerpts while retaining permitted user notes and source links. Recheck sources before fresh outreach.
- Provide export and deletion controls. Deletion cancels pending jobs, clears local caches, and removes active server records; document backup expiry (target maximum 30 days) and any provider retention separately. Do not claim deletion from external providers without a supported mechanism.
- P2: `AI_REDACT` strips personal info from message bodies before they're stored for analytics.

**Cost**
- Set a user-configurable monthly research budget during setup; do not silently authorize unlimited usage. Track provider-reported consumption, current pricing version, and estimates separately.
- Bound query count, tool turns, concurrency, and result size. Reserve estimated request cost before dispatch and reconcile usage afterward. Explain that in-flight/tool-expanded requests can cause bounded overshoot; do not advertise an exact hard monetary cap unless the provider supports enforcement.
- Cache/deduplicate research and let users refresh explicitly. Stop scheduling new work at the configured limit. Reverify provider billing units and limits at implementation; do not hardcode prices from this document.

---

## 14. Metrics

Primary: meaningful reciprocal professional conversations per week, completed coffee chats, relevant introductions/referrals, and interviews associated with relationships.

Secondary: useful recommendations saved, draft-to-user-marked-sent conversion, reply rate among user-recorded outreach, reply rate per template (P2), best send times (P2), follow-up completion, research cost per useful recommendation, and time spent per session. Show sample sizes and unknown/unrecorded outcomes. Report association with job outcomes, not proof of causation. Never invent impressions, profile visits, or follower changes; those require supported data or explicit user entry.

---

## 15. Team split (4 people) — two proposals, pick one

### Option 1: original hackathon split (roles A–D)

The three master's students take the hardest parts: extension internals, DOM scraping, and the AI + Google APIs. Rachel owns the UI and the demo, which are self-contained and can be built against mock data the whole time.

**D — Extension core + engine** *(master's student, integration lead)*. The hardest role: everything else plugs into it.
- Vite + `@crxjs` scaffold, `manifest.config.ts` (permissions, side panel, content-script matches, pinned `key`)
- `src/shared/`: `types.ts`, `messages.ts`, `storage.ts` (typed get/set helpers + a `useStore` hook for the UI)
- Service worker message router: wires every action in `messages.ts` to B's and C's functions
- Draft state machine: `pending → approved → sent / failed`, and moving `Contact.stage` forward
- `chrome.alarms` scheduler: follow-ups, reply polling, prep-brief trigger, post-meeting thank-you trigger, demo-mode intervals
- Import deduplication + "stop on reply" logic; no app daily email/profile quotas
- **Hour 0 deliverable:** scaffold + shared types pushed by 0:20 so everyone can start

**B — LinkedIn + Google channels** *(master's student)*. LinkedIn's DOM is messy and changes often, so this role takes the most debugging. It also owns the Gmail and Calendar integration, since those are the other outreach channels.
- `linkedin-search.ts`: scrape people-search results → `Contact[]` (name, title, profile URL, degree)
- `linkedin-profile.ts`: scrape education + experience → `warmPaths`; fill the connect note / message box; "Mark sent" button
- Warm-path scoring → `relevance` + `reason`
- Email pattern guesser + company-domain lookup, with a confidence score
- Build the search URL from a `Target` (company + role keywords + NYU filter)
- `src/google/`: `chrome.identity` token flow, `gmail.ts` (send, list threads, fetch replies), `calendar.ts` (create event with Meet link + invite, patch the description)

**C — Snowflake AI + Grok agent** *(master's student)*
- `backend/`: the Cortex REST client, the Grok tool-calling loop (`/agent/run`) and its tools (§8.2), all 8 `/ai/*` endpoints and their prompts
- The Snowflake SQL behind `AI_EXTRACT`, `AI_CLASSIFY`, `AI_SENTIMENT`, and the `AI_EMBED` / `AI_SIMILARITY` ranking queries (§8.3)
- `/sync` route that writes extension state into the Snowflake tables
- Make sure the 300-character LinkedIn limit, "no send tool", and "picked questions must be approved" rules are enforced in code, not just in the prompt
- Deploy the backend (Vercel) and share the URL by 1:00

**A — Side panel UI + demo** *(Rachel)*. Builds against mock data from minute 0, then switches to D's `useStore` once it exists.
- React screens: Onboarding/Profile, Template editor (highlight `{{placeholders}}`), Targets + Contacts list, **Approval Queue** (edit / approve / reject / regenerate), **Question Bank** (Add / Skip / edit cards), prep-brief view, post-chat notes prompt, **Activity / Messages bar** (including the expandable Grok agent trace and reply-sentiment badges), pipeline board
- Mock data file (`src/shared/mock.ts`) that other people can reuse for testing
- `job-page.ts`: grab job description text from the open posting (`document.body.innerText` on LinkedIn / Greenhouse / Lever is enough)
- **Snowflake setup** (§8.3 checklist): account, cross-region inference, role, warehouse, tables (the table SQL is a straight copy of §11.1), and the PAT. Hand the account URL + PAT to C.
- Google Cloud project + OAuth client setup (a click-through task, done in the first 20 minutes, then hand the client ID to B)
- Demo: seed data, the test LinkedIn account + test inboxes, the backup video, and the pitch

| From → To | What | By |
|---|---|---|
| D → everyone | Scaffold, `types.ts`, `messages.ts` | 0:20 |
| A → B | OAuth client ID | 0:20 |
| A → C | Snowflake account URL + PAT, tables created | 0:25 |
| A → everyone | `mock.ts` | 0:30 |
| C → D | Backend URL with `/agent/run` + `/ai/*` working | 1:00 |
| B → D | Scrape + fill + `google/*` functions callable from the router | 1:15 |
| D → A | `useStore` hook with live data | 1:15 |

If Rachel finishes the UI early, the next most useful thing is writing and testing prompts with C in a Snowflake worksheet (`AI_COMPLETE('grok-4.7', ...)`), since that doesn't need deep code context.

### Option 2: X/Grok split (named owners)

| Person | Primary responsibility |
| --- | --- |
| Julia | Job-portal recognition, posting extraction, navigation changes, capture fallback |
| Rachel | Extension core, shared contracts, state, routing, end-to-end integration |
| Sushant | Side-panel UI, resume/profile review, draft review, relationship and coffee-chat screens |
| Maryam | Grok backend, X person discovery, public conversational research, individual writing |

See [the four-person build plan](TEAM-PLAN.md) for feature checklists, handoffs, demo scope, acceptance checks, and a proposed three-hour schedule for this option.

### Shared contract (agree on this in the first 20 minutes)

The types in §11.1 live in `src/shared/types.ts`, and the message-router actions in `src/shared/messages.ts`:

- Template/LinkedIn/email flow: `PARSE_JOB`, `SCRAPE_SEARCH`, `SCRAPE_PROFILE`, `GENERATE_DRAFTS`, `APPROVE_DRAFT`, `SEND_EMAIL`, `FILL_LINKEDIN`, `MARK_SENT`, `POLL_REPLIES`, `CREATE_MEETING`, `SUGGEST_QUESTIONS`, `UPDATE_QUESTION`, `GENERATE_PREP_BRIEF`, `SAVE_MEETING_NOTES`.
- X flow (from TEAM-PLAN): `CAPTURE_JOB`, `SAVE_PROFILE`, `START_RESEARCH`, `GET_RESEARCH`, `GENERATE_DRAFT`, `COPY_DRAFT`, `OPEN_X`, `MARK_SENT` (shared), `UPDATE_RELATIONSHIP`.

---

## 16. Timeline and delivery plan

### 16.1 Hackathon timeline (3 hours)

| Time | Milestone |
|---|---|
| 0:00–0:20 | Repo scaffold, `types.ts` + `messages.ts` agreed, Google Cloud OAuth client created, Snowflake account + cross-region inference + tables ready, xAI API access/model/tool support verified, mock data in storage |
| 0:20–1:30 | Everyone builds their area against mocks |
| 1:30 | **Checkpoint:** paste job description → drafts in the queue → approve → email sends; real job recognized → evidence-linked X draft for a real person |
| 1:30–2:15 | LinkedIn fill, warm-path ranking, reply detection, calendar booking, question bank + prep brief, follow-up + thank-you loop in demo mode; stale-job protection, copy/open-X/mark-sent, compare two people's X drafts |
| 2:15–2:40 | Integration, bug bash, polish the Activity bar |
| 2:40–3:00 | Freeze. Record a backup demo video, rehearse the pitch |

**Cut order if behind (template flow):** `AI_AGG` insights / `AI_REDACT` → Hunter verification → LinkedIn reply detection → automatic prep brief (keep the on-demand button) → question-bank categories/feedback (keep plain Add / Skip) → automatic thank-you trigger (keep a manual "Draft thank-you" button) → LinkedIn fill (fall back to "copy + open profile") → calendar (fall back to sending availability). **Never cut:** the Grok agent loop and at least `AI_EXTRACT` + `AI_CLASSIFY`. If `/sync` is slow, call the SQL functions on the text directly without storing rows.

**Cut order if behind (X flow, from TEAM-PLAN):** swarm, automatic scheduling/calendar integration, background follow-up engine, analytics, multi-device sync, and inbox/reply detection. **Never cut:** evidence display, or person-specific writing replaced with templates.

### 16.2 Production delivery plan (X spec)

1. **Foundation:** MV3 side panel/full-page shell, backend authentication, local resume parsing, editable confirmed profile, export/delete basics. Done when a user can restart the browser and recover the confirmed profile without exposing provider keys.
2. **Research:** supported job-page adapters and context versioning, current-job view, xAI adapter, bounded durable jobs, source records, deduplication, evidence-based scoring, discover/person views, budget controls. Done when real returned sources and honest empty/error states work end-to-end.
3. **Engagement:** public URL/context capture, grounded drafts, copy/open-X flow, manual sent recording, relationship board. Done when no capture or draft action can publish to X.
4. **Coffee-chat loop:** invitation drafts, timezone-aware confirmed logistics, preparation, notes, reminders, opportunity outcomes. Done when the complete relationship loop can be recorded and corrected.
5. **Pilot:** test with the user's supplied resume and targets, check Brave compatibility, measure recommendation usefulness and daily friction, fix issues, then prepare extension packaging and disclosures.

---

## 17. Repo layout

```
coffee-chat-copilot/
├─ SPEC.md
├─ extension/
│  ├─ manifest.config.ts
│  ├─ src/
│  │  ├─ sidepanel/        (A / Sushant) React app
│  │  ├─ profile/          (Sushant) resume import + profile review
│  │  ├─ background/       (D / Rachel) service worker, scheduler, router
│  │  ├─ content/          (B / Julia) linkedin-search, linkedin-profile, job-page, x-capture
│  │  ├─ jobs/             (Julia) job-portal adapters (Greenhouse, Lever, Ashby, JobPosting)
│  │  ├─ google/           (B) gmail.ts, calendar.ts, auth.ts
│  │  └─ shared/           types.ts, messages.ts, storage.ts, mock.ts
│  └─ package.json
├─ backend/                (C / Maryam) Vercel API
│  ├─ agent/               grok loop + tools
│  ├─ ai/                  /ai/* routes
│  ├─ research/            xAI X Search provider, swarm coordinator, /v1/* routes
│  └─ snowflake/           cortex REST client, SQL queries
└─ snowflake/              (A) setup.sql: role, warehouse, tables
```

---

## 18. Demo script (about 2–3 minutes)

**Template flow**
1. During onboarding, click **Add** on a few AI-suggested questions to seed the question bank.
2. Open a real job posting, then open the side panel and click "Network for this job".
3. Show the 6 contacts it found, with NYU alumni ranked first and a reason on each ("NYU '22, same team"). Expand the agent trace in the Activity bar: "Grok called `rank_contacts` (Snowflake `AI_SIMILARITY`) → drafted 6 messages".
4. Show the one template, then the 6 personalized drafts. Highlight the filled keywords and the warm-path hook.
5. Approve 2. One email sends live, and a LinkedIn note is filled in on a test account for the user to click Send.
6. Turn on demo mode. A follow-up draft appears in the queue on its own.
7. Reply from a teammate's inbox: "Sure, Thursday at 3?" Snowflake `AI_CLASSIFY` tags it `proposes_time` and `AI_SENTIMENT` shows it as warm, Grok drafts a confirmation, you approve it, and the calendar event with a Meet link shows up. Its description holds the prep brief, with 5 questions picked from the bank you approved in step 1.
8. Fast-forward past the meeting. Type a quick note, and a thank-you + referral ask appears in the queue.
9. End on the Activity bar showing the whole timeline.

**X flow (shared demo acceptance check from TEAM-PLAN)**
1. Open a real supported job; confirm the detected company and role.
2. Load confirmed resume facts and request relevant people on X.
3. Show why two people are relevant and the actual sources behind the recommendations.
4. Generate two individually composed interactions and explain how each responds to the person's public post/style while retaining the user's voice.
5. Edit/copy a draft and open the exact X post/profile. Sending is a user action.
6. Record an interaction, add a coffee-chat next step, and recover it after reopening the panel.
7. Switch jobs and verify old results remain associated with their original posting.

---

## 19. Acceptance criteria and verification

- Opening a supported job posting and invoking the extension identifies the employer and role with evidence, handles ATS/employer distinction, and offers corrections. Portal landing pages never cause an invented job match.
- Optional portal access enables detection only on permitted origins; revocation stops it. Application answers and other form values never enter capture/model payloads.
- Switching jobs on an SPA invalidates active context safely; stale research/drafts remain labeled with their originating job and cannot silently attach to the new one.
- One-worker and swarm modes respect the same global budget, cancellation, deduplication, and source validation; worker completion order does not change job/person ownership.
- Compare drafts for people with different evidenced communication styles: strategy and wording respond to their posts, preserve the user's voice, and do not reuse a message skeleton. Sparse evidence falls back to a neutral voice; unsupported personality claims fail review.
- [Email]/[LinkedIn] template drafts change only `{{placeholders}}`; LinkedIn connect notes over 300 characters are rejected in code.
- Nothing sends without approval; the Grok agent has no send tool; prep briefs only pick `approved` questions.
- LinkedIn import reads all currently visible, readable contacts on the open results page without a per-import cap or app daily profile quota. Email sends have no app daily quota. Deduplication and explicit approval remain enforced.
- A text PDF or pasted resume produces editable facts; unsupported/scanned files present a useful fallback. Unconfirmed or excluded facts do not appear in research/draft payloads.
- A discovery run returns source-linked results or an honest empty state; missing company evidence is displayed as unknown. A fabricated source ID/URL in model narrative fails validation.
- Company lookup handles ambiguous names, supports an optional job/role, and returns up to three source-backed contacts without padding weak results. Find-more excludes existing results; shared interests alone never imply a personal connection.
- Duplicate handles/results merge safely. Do-not-contact, dismissed sources, and archived contacts are excluded from outreach queues.
- Every X draft identifies its profile version and referenced facts/sources. Unknown IDs are rejected, and drafts based on an old resume show a stale warning.
- Copying a draft does not mark it sent, advance a contact to contacted, or create an X action. Sending occurs only in native X by the user.
- An invitation does not become a confirmed coffee chat until the user records confirmation. Times render correctly across time zones and daylight-saving changes.
- Follow-ups stop at the channel limit ([Email]/[LinkedIn]: 2, then cold; [X]: 1, then pause); replies, declines, and do-not-contact cancel pending outreach tasks.
- Discovery survives service-worker suspension and panel closure. Cancellation prevents further requests, identifies in-flight work, and preserves completed results.
- Provider rate limiting, outage, invalid credentials, malformed output, unavailable sources, and exhausted budgets have distinct recoverable states.
- Requests from another authenticated user cannot read or modify a person's profile, notes, jobs, or drafts. Page content cannot access auth/provider secrets or trigger arbitrary backend operations.
- Export includes user-owned data; deletion clears live records/local cache and cancels work according to the stated retention policy.
- Verify permission prompts, side-panel behavior, X SPA navigation, keyboard access, and URL-paste fallback in Chrome and the target Brave installation.

Use focused unit tests for ranking, reference validation, state transitions, deduplication, budgets, and timezone logic; API integration tests for ownership and idempotency; and browser tests for the user journey and absence of send automation. Use fixture resumes and mocked providers in CI; run a small, explicitly budgeted live research smoke test during setup.

---

## 20. Open questions and inputs needed

**Open questions**
- Branding/name: "Coffee Chat Copilot" is a placeholder; the X spec uses "networkMAX".
- Which team split (§15 Option 1 or 2)? Under Option 1, which master's student takes which of roles B, C, and D?
- Which test LinkedIn account and test inboxes will we use for the live demo?
- **Blocker:** where do we get a Snowflake account that can run Cortex AI? The current trial can't (§8.3).
- Every row in §0.

**Inputs needed at implementation** (onboarding inputs, not reasons to delay the specification):
- Current resume and approved public professional summary.
- Target roles/seniority, companies, location/remote preferences, X handle, and portfolio links.
- Preferred outreach voice and weekly time commitment.
- xAI API access and research budget.
- Whether "Grok Bot" means a specific existing connected account/product. A direct adapter requires verified integration documentation before commitment.

---

## Sources

Official pages checked 2026-10-24. Recheck integrations, model availability, billing, and policies before implementation/release.

- [S1 — Tsenta public product page](https://tsenta.com/)
- [S2 — xAI X Search](https://docs.x.ai/developers/tools/x-search)
- [S3 — X: About @bot and Grok Bot](https://help.x.com/en/using-x/about-bot)
- [S4 — X automation rules](https://help.x.com/en/rules-and-policies/x-automation)
- [S5 — Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [S6 — Chrome activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [S7 — Public frontend inspection, asset links, and evidence limits](TSENTA-RESEARCH.md)
