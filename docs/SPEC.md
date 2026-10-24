# Coffee Chat Copilot — Project Spec

> NYU Shipyard hackathon · 4 people · 3 hours
> A browser extension modeled on Tsenta's Networking dashboard: it finds people worth a coffee chat, writes the outreach, sends it once you approve, and keeps following up until a meeting is on the calendar.

---

## 1. Problem & pitch

Cold outreach for coffee chats is repetitive: find the right people, find their email, write a message that doesn't sound like a template, remember to follow up, go back and forth to schedule, then prep for the chat. Most people give up after the first message.

**Coffee Chat Copilot** does all of it from a Chrome side panel. You write your message **once**. The AI fills in the details for each person and job, so every message reads like you wrote it. Nothing goes out until you approve it.

**Demo line:** "Paste a job link, approve 5 messages, and the extension keeps going until you have coffee chats on your calendar, with your questions ready."

---

## 2. Core user flow

1. **Onboarding.** Connect Google (Gmail + Calendar), make sure you're logged into LinkedIn, and add a short profile: name, school, background, a resume summary, and a scheduling link or your availability.
2. **Write your template once.** Example:
   > Hi {{first_name}}, I'm {{my_name}}, a {{my_year}} at NYU studying {{my_major}}. I saw {{company}} is hiring for {{role}} and noticed you work on {{their_team}}. {{personal_hook}} Would you be open to a 15-minute coffee chat?
3. **Add a target.** Paste a job description or job URL, or open a job posting with the extension active. The AI extracts company, role, team, key skills, and location.
4. **Find people.** The extension opens a LinkedIn people search for the company (e.g. `"<company>" <role keywords>`, plus an NYU alumni filter) and scrapes the results page. Contacts are ranked with **warm paths first**: NYU alumni, shared past employers, shared clubs or orgs, and 2nd-degree connections. Each gets a relevance score and a one-line reason ("NYU '22, same team as the role"). The extension then finds or guesses each contact's work email.
5. **Generate messages.** For each contact, the AI fills the `{{keywords}}` from the job description and the person's profile, and writes `{{personal_hook}}` itself. Output: a LinkedIn note (300 characters max for connection requests) and/or an email (subject + body).
6. **Approve.** Every draft lands in the **Approval Queue**. The user can edit, regenerate, approve, or skip. **Nothing sends without approval.**
7. **Send.** Email goes out through the Gmail API. LinkedIn: after approval, the content script opens the profile and fills in the connect note or message box. **The user clicks Send in LinkedIn**, and the extension then marks the message as sent. This keeps the LinkedIn account safe.
8. **Follow up.** If there's no reply after N days (default 3, then 7), the AI drafts a follow-up and puts it back in the Approval Queue. Max 2 follow-ups per contact, then the contact is marked "cold".
9. **Reply → schedule.** When a reply arrives, the AI classifies it (interested / proposes time / not interested / referral / out of office). If they're interested, it drafts a scheduling reply. When a time is agreed, it creates a Google Calendar event with a Meet link, invites the contact, and sends a confirmation email (also approved by the user).
10. **Question bank.** The AI suggests coffee-chat questions based on your profile, your targets, and the kinds of people you're meeting (e.g. "What does a first-year analyst's week look like on your team?"). Each suggestion shows up as a card with **Add / Skip** buttons, and you can edit any question before adding it or write your own. Added questions go into your bank, tagged by category (role, team, career path, company culture, recruiting process, advice).
11. **Prep brief.** Once a chat is scheduled (and on demand), the AI **picks 5 questions from your approved bank** that fit this contact and job, lightly tailoring the wording ("...on the payments team?"). It only writes a new question if the bank has nothing relevant, and marks that one "new: add to bank?". The brief also covers the contact's background, the warm path you share, and recent company news or the job's focus, and it's attached to the calendar event description.
12. **Thank-you + referral ask.** After the meeting ends, the extension asks "How did it go?" and lets you jot quick notes (and mark which questions landed well). The AI then drafts a thank-you that references something from your notes, plus a soft referral ask for the target role. Both go to the Approval Queue.
13. **Activity / Messages bar.** One timeline of everything: sent, replied, follow-up due, scheduled, thank-you sent, plus a per-contact thread view.

---

## 3. Feature list (prioritized for 3 hours)

### P0 — must work in the demo
- [ ] Chrome MV3 extension with a **side panel** UI
- [ ] Profile + **single message template** with `{{keyword}}` placeholders
- [ ] Paste a job description → AI extracts job fields
- [ ] Contact list scraped from a LinkedIn people search results page (fallback: add by hand)
- [ ] Email guess per contact from common patterns (`first.last@`, `flast@`, `first@` + company domain), with a confidence score. Required: scraping gives no emails.
- [ ] AI fills the template per contact (keywords + personalized hook)
- [ ] **Approval Queue**: edit / approve / reject / regenerate
- [ ] Send email via Gmail API after approval
- [ ] **Activity / Messages bar**: timeline + per-contact status
- [ ] Follow-up scheduler (`chrome.alarms`) that queues AI follow-up drafts for approval

### P1 — strong demo additions
- [ ] LinkedIn fill: after approval, the content script fills the connect note / message box. The user clicks Send, and a "Mark sent" button (or a detected click on Send) logs it.
- [ ] **Warm-path ranking:** detect NYU alumni, shared employers, shared orgs, and 2nd-degree connections from the scraped profile; boost relevance and feed the warm path into `{{personal_hook}}`
- [ ] Gmail reply detection (poll threads) + AI reply classification
- [ ] Google Calendar event creation with a Meet link + invite once a time is confirmed
- [ ] **Question bank:** the AI suggests questions as Add / Skip cards (editable), the user can write their own, and questions are tagged by category
- [ ] **Pre-chat prep brief** that picks 5 questions from the approved bank for each scheduled chat (on demand from a contact card; auto-attached to the calendar event)
- [ ] **Post-chat thank-you + referral ask** (triggered once the event's end time passes)
- [ ] Contact pipeline board: `Found → Drafted → Sent → Followed up → Replied → Scheduled → Met → Thanked / Cold`

### P2 — stretch
- [ ] Email verification via the Hunter.io API (swap in for the guessed email when a key is set)
- [ ] LinkedIn reply detection (scrape the messaging page)
- [ ] Question ranking by post-chat feedback ("landed well" questions get picked more)
- [ ] Analytics: reply rate per template, best send times

---

## 4. Architecture

```
┌──────────────────────── Chrome Extension (MV3) ─────────────────────────┐
│                                                                         │
│  Side Panel (React + Vite + Tailwind)                                   │
│   ├─ Onboarding / Profile / Template editor                             │
│   ├─ Targets (job descriptions) & Contacts                              │
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
│   └─ job-page.ts          grab job description text from the open page  │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │ HTTPS
                     ┌────────────────▼────────────────┐
                     │  Backend (Vercel, Node/TS)      │
                     │   POST /agent/run   ← Grok loop │
                     │   POST /ai/*        (8 routes)  │
                     │   POST /sync        → Snowflake │
                     │  Holds the xAI key + Snowflake  │
                     │  PAT                            │
                     └───────┬────────────────┬────────┘
              chat/completions│                │ SQL API
           ┌──────────────────▼─────┐  ┌──────▼──────────────────────┐
           │  xAI API (Grok)        │  │  Snowflake (trial account)  │
           │   agent + drafting +   │  │   Tables: contacts, drafts, │
           │   extract / classify   │  │    activity, questions,     │
           │   / sentiment (JSON)   │  │    meetings, targets, ...   │
           └────────────────────────┘  │   Plain SQL for analytics   │
                                       └─────────────────────────────┘
```

> **Status (Oct 24): Cortex AI is blocked on our Snowflake trial account.** Every Cortex function (`AI_COMPLETE`, `AI_EXTRACT`, `AI_CLASSIFY`, `AI_SENTIMENT`, `AI_SIMILARITY`) fails with *"not available for trial accounts"*. The tables, warehouse, role, and service user are all set up and work.
> **Current plan:** call Grok directly through the xAI API. It uses the same OpenAI-style `chat/completions` format as Cortex REST (tools + `response_format: json_schema`). Snowflake stays the system of record (`/sync`, analytics in plain SQL).
> **Upgrade path:** we're asking the Snowflake sponsor for an account with Cortex enabled. If we get one, set `AI_PROVIDER=cortex`, run `snowflake/setup.sql` on that account, and the original Cortex design in §6b applies again. Nothing outside the backend changes either way.

**Why a backend at all?** It keeps the xAI key and the Snowflake token out of the extension bundle, and it's the only thing that talks to either.

**Stack:** TypeScript, React, Vite + `@crxjs/vite-plugin` (extension build with hot reload), Tailwind, **Grok via the xAI API** (agent, drafting, extraction, classification), **Snowflake** tables as the system of record (Cortex AI SQL functions if we get a non-trial account), Gmail API, Google Calendar API.

**One AI client, two providers.** The backend has a single `chat()` function that reads `AI_PROVIDER`:

| `AI_PROVIDER` | Base URL | Auth | Model |
|---|---|---|---|
| `xai` (current) | `https://api.x.ai/v1/chat/completions` | `XAI_API_KEY` | Current Grok model ID from console.x.ai (check docs; may differ from `grok-4.7`) |
| `cortex` (if sponsor account) | `<SNOWFLAKE_ACCOUNT_URL>/api/v2/cortex/v1/chat/completions` | `SNOWFLAKE_PAT` | `grok-4.7` (fallback `claude-sonnet-4-6`) |

---

## 5. Data model (`chrome.storage.local`)

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

---

## 6. AI endpoints (backend contracts)

All endpoints return JSON. Every route calls Grok through the backend's `chat()` client (§4) with `response_format: { type: "json_schema", ... }` so the result always parses. Routes marked **SQL** use a Cortex AI SQL function instead **only when `AI_PROVIDER=cortex`**; on the trial account they're Grok JSON calls with the same input and output (see §6b).

| Endpoint | Input | Output |
|---|---|---|
| `/ai/parse-job` **SQL** | `rawDescription` | `{ company, role, team, location, skills[] }` |
| `/ai/fill-template` | `template, profile, target, contact` | `{ subject?, body, filledKeywords }` |
| `/ai/follow-up` | `originalDraft, followUpCount, daysSince, contact` | `{ subject?, body }` |
| `/ai/classify-reply` **SQL** | `replyText` | `{ intent: "interested" \| "proposes_time" \| "not_interested" \| "referral" \| "ooo", proposedTimes?: string[], sentiment: "warm" \| "neutral" \| "cold" }` (sentiment folded in so one Grok call covers what `AI_CLASSIFY` + `AI_SENTIMENT` did) |
| `/ai/schedule-reply` | `replyText, availability, proposedTimes?` | `{ body, chosenSlot?: { start, end } }` |
| `/ai/suggest-questions` | `profile, targets[], existingBank[]` | `{ questions: { text, category }[] }`: 5–10 new ones, no duplicates of the bank |
| `/ai/prep-brief` | `contact (scraped profile), target, profile, approvedBank[]` | `{ summary, warmPathTalkingPoint, companyContext, picked: { questionId, tailoredText }[5], newQuestions?: { text, category }[] }`: picks from the bank first; adds new questions only to fill gaps |
| `/ai/thank-you` | `contact, target, userNotes` | `{ subject, body, referralAsk }`: the referral ask is a separate, optional paragraph the user can turn off |

**Rules for `/ai/fill-template`:**
- Keep the user's wording. Only replace `{{placeholders}}`; don't rewrite the rest.
- `{{personal_hook}}`: one sentence that ties the contact's profile to the job or the user's background. **Lead with the strongest warm path** if there is one ("Fellow NYU Stern grad here"). No flattery and no made-up facts. If there's nothing real to say, leave it out.
- LinkedIn connect notes: 300 characters max, hard limit.
- No em dashes, no "I hope this finds you well". Write the way a student actually writes.

**Rules for `/ai/prep-brief` questions:**
- Only pick questions with `status: "approved"`, and avoid repeating questions already used with the same company.
- Tailoring may only swap in specifics (team, role, company); the question has to stay recognizable as the user's.
- Shortlist candidates first, then let Grok pick the final 5 from the top 15. Shortlist with keyword overlap (question text vs. contact title + team + job skills) plus `landedWell`; use **`AI_SIMILARITY`** instead if we're on Cortex.

---

## 6a. Grok agent

Grok (called through the backend's `chat()` client with `tools`: the xAI API now, Cortex REST if we get a sponsor account, see §4) is the agent that runs the outreach loop. The backend runs a standard tool-calling loop: send messages + tools, run whatever tool Grok calls, append the result, repeat until Grok returns a final answer (max 8 steps).

**When it runs** (`POST /agent/run` with a trigger):
| Trigger | What Grok does |
|---|---|
| `new_target` | Parse the job, rank the scraped contacts, pick the top N, draft an initial message for each |
| `tick` (scheduler) | Look at contacts that are due, decide follow up / wait / mark cold, draft follow-ups |
| `reply_received` | Classify the reply, then draft a scheduling reply, propose a slot, or stop |
| `meeting_soon` | Build the prep brief from the question bank |
| `meeting_done` | Draft the thank-you + referral ask from the user's notes |

**Tools Grok can call** (all implemented in the backend):
`get_profile`, `get_template`, `get_contacts(targetId)`, `rank_contacts(targetId)` (warm-path + keyword scoring; `AI_SIMILARITY` on Cortex), `fill_template(contactId)`, `classify_reply(text)` (Grok JSON call; `AI_CLASSIFY` on Cortex), `get_availability()`, `search_question_bank(contactId)` (keyword shortlist; `AI_SIMILARITY` on Cortex), `queue_draft(draft)`, `set_next_action(contactId, at)`, `log_activity(event)`.

**Guardrail:** there is **no send tool**. The most Grok can do is `queue_draft`, which puts the message in the Approval Queue. Sending only happens when the user clicks Approve in the extension.

**Agent trace in the UI:** every tool call is logged to `activity` with `type: "agent_step"`, so the Activity bar can show "Grok ranked 12 contacts → drafted 5 messages" with an expandable trace. Judges like seeing the agent's steps.

## 6b. Snowflake AI features (Cortex) and what we do on the trial account

The original plan replaced hand-written prompts with Snowflake-native Cortex functions. **On the trial account none of them run**, so each has a trial-account version that the backend uses while `AI_PROVIDER=xai`. Keep both behind the same function so switching is one env var.

| Feature | With Cortex (sponsor account) | Now (trial account) |
|---|---|---|
| Parse job description | `AI_EXTRACT(text => :jd, responseFormat => ['company','role','team','location','skills'])` | Grok JSON call, same 5 fields |
| Reply intent | `AI_CLASSIFY`: `interested`, `proposes_time`, `not_interested`, `referral`, `ooo` | Same Grok call as sentiment, returns `intent` |
| Proposed meeting times | `AI_EXTRACT` of `proposed_times`, then Grok picks a slot | Same Grok call, returns `proposedTimes` |
| Reply warmth | `AI_SENTIMENT` → warm / neutral / cold badge | Same Grok call, returns `sentiment` |
| Contact ranking | `AI_EMBED` + `AI_SIMILARITY` of the job vs. headline + experience, plus a warm-path boost in SQL | Backend scoring: warm-path boost + keyword overlap of job skills/team vs. title. Enough for ~20 contacts |
| Question bank picking | `AI_SIMILARITY` shortlist | Keyword shortlist + `landedWell`, Grok picks 5 |
| Duplicate questions | `AI_SIMILARITY` > 0.9 | Pass the bank to Grok and say "no duplicates", plus an exact normalized-text check in code |
| Insights panel (P2) | `AI_AGG` over `drafts` joined to `activity` | Plain SQL reply-rate stats in Snowflake (still on the trial) |
| Privacy (P2) | `AI_REDACT` | Cut |

**Data sync:** `chrome.storage.local` stays the live cache for the UI. The backend writes every contact, draft, question, meeting, and activity event to Snowflake (`POST /sync`). Tables mirror the types in §5, one table per type, with a `user_id` column (see `snowflake/setup.sql` for the 4 column renames).

**Setup checklist:**
1. ✅ Snowflake trial account created.
2. ✅ `snowflake/setup.sql`: role, warehouse, `COFFEE_CHAT.APP` database + tables, service user `COFFEE_CHAT_SVC`.
   ✅ PAT for the backend created. Account URL + PAT go to C privately → Vercel env vars `SNOWFLAKE_ACCOUNT_URL`, `SNOWFLAKE_PAT`.
3. ❌ Cortex smoke tests (`snowflake/smoke-tests.sql`): all fail on trial. Asking the sponsor for an account.
4. ☐ xAI API key (console.x.ai) in Vercel env vars as `XAI_API_KEY`, plus the current Grok model ID. Needs a card or sponsor credits.
5. ☐ Backend smoke test: one `chat()` call through xAI, one `/sync` insert into Snowflake.

**If the sponsor gives us a Cortex account:** run `setup.sql` there, run `smoke-tests.sql`, hand C the new URL + PAT, set `AI_PROVIDER=cortex`. If Grok isn't on that account, use `claude-sonnet-4-6` on the same Cortex endpoint.

**Prize note:** "Best use of Snowflake" judges will most likely want Cortex AI running in Snowflake. On the trial we can only show Snowflake as the data store plus SQL analytics, so getting a sponsor account matters for that prize.

---

## 7. Follow-up engine

- `chrome.alarms` runs every 15 minutes (every 1 minute in demo mode) and calls `POST /agent/run` with the matching trigger. The steps below are what the Grok agent is instructed to do; the hard limits (max follow-ups, intervals) are also checked in code.
- For each contact where `stage ∈ {sent, followed_up}` and `nextActionAt <= now`:
  1. Check Gmail for a reply on the thread. If there is one, set `stage = replied` and classify it.
  2. If there's no reply and `followUpCount < MAX_FOLLOW_UPS (2)`: generate a follow-up draft, put it in the Approval Queue, and set `nextActionAt = now + interval[followUpCount]` (3 days, then 7).
  3. Otherwise set `stage = cold`.
- For each `Meeting` whose start is less than 24 hours away and has no `prepBrief` yet: generate the brief from the question bank and patch the calendar event description.
- For each `Meeting` whose end time has passed: set `stage = met`, show a "How did it go?" notes prompt, and once notes are saved (or after 2 hours, with no notes), queue a thank-you draft.
- **Demo mode toggle:** shrinks intervals to minutes so the full loop can be shown live.

---

## 8. Safety & compliance

- **A human approves every send.** No auto-send, including follow-ups.
- **LinkedIn: the extension fills, the user sends.** The extension never clicks Send on LinkedIn. Scraping only reads pages the user has opened themselves, one at a time.
- **Rate limits:** cap scraping at about 20 profiles/day and email at about 30/day.
- **LinkedIn ToS:** LinkedIn's User Agreement prohibits scraping and automation, so the account could still be flagged. Keep volume low, use a test account for the demo, and be ready to explain the human-in-the-loop design if judges ask.
- **Email guesses:** only send to guessed addresses above a confidence threshold, and show the confidence in the approval card so the user decides.
- Stop following up as soon as someone replies or says no. Every email includes an easy opt-out line.
- Gmail scopes: request only `gmail.send`, `gmail.readonly`, and `calendar.events`.

---

## 9. Team split (4 people)

The three master's students take the hardest parts: extension internals, DOM scraping, and the AI + Google APIs. Rachel owns the UI and the demo, which are self-contained and can be built against mock data the whole time.

### D — Extension core + engine *(master's student, integration lead)*
The hardest role: everything else plugs into it.
- Vite + `@crxjs` scaffold, `manifest.config.ts` (permissions, side panel, content-script matches, pinned `key`)
- `src/shared/`: `types.ts`, `messages.ts`, `storage.ts` (typed get/set helpers + a `useStore` hook for the UI)
- Service worker message router: wires every action in `messages.ts` to B's and C's functions
- Draft state machine: `pending → approved → sent / failed`, and moving `Contact.stage` forward
- `chrome.alarms` scheduler: follow-ups, reply polling, prep-brief trigger, post-meeting thank-you trigger, demo-mode intervals
- Rate limits + "stop on reply" logic
- **Hour 0 deliverable:** scaffold + shared types pushed by 0:20 so everyone can start

### B — LinkedIn + Google channels *(master's student)*
LinkedIn's DOM is messy and changes often, so this role takes the most debugging. It also owns the Gmail and Calendar integration, since those are the other outreach channels.
- `linkedin-search.ts`: scrape people-search results → `Contact[]` (name, title, profile URL, degree)
- `linkedin-profile.ts`: scrape education + experience → `warmPaths`; fill the connect note / message box; "Mark sent" button
- Warm-path scoring → `relevance` + `reason`
- Email pattern guesser + company-domain lookup, with a confidence score
- Build the search URL from a `Target` (company + role keywords + NYU filter)
- `src/google/`: `chrome.identity` token flow, `gmail.ts` (send, list threads, fetch replies), `calendar.ts` (create event with Meet link + invite, patch the description)

### C — Snowflake AI + Grok agent *(master's student)*
- `backend/`: the `chat()` client with `AI_PROVIDER=xai|cortex` (§4), the Grok tool-calling loop (`/agent/run`) and its tools (§6a), all 8 `/ai/*` endpoints and their prompts
- The trial-account versions in §6b (Grok JSON for extract/classify/sentiment, keyword scoring for ranking). The Cortex SQL (`AI_EXTRACT`, `AI_CLASSIFY`, `AI_SENTIMENT`, `AI_SIMILARITY`) only if we get a sponsor account
- `/sync` route that writes extension state into the Snowflake tables
- Make sure the 300-character LinkedIn limit, "no send tool", and "picked questions must be approved" rules are enforced in code, not just in the prompt
- Deploy the backend (Vercel) and share the URL by 1:00

### A — Side panel UI + demo *(Rachel)*
Builds against mock data from minute 0, then switches to D's `useStore` once it exists.
- React screens: Onboarding/Profile, Template editor (highlight `{{placeholders}}`), Targets + Contacts list, **Approval Queue** (edit / approve / reject / regenerate), **Question Bank** (Add / Skip / edit cards), prep-brief view, post-chat notes prompt, **Activity / Messages bar** (including the expandable Grok agent trace and reply-sentiment badges), pipeline board
- Mock data file (`src/shared/mock.ts`) that other people can reuse for testing
- `job-page.ts`: grab job description text from the open posting (`document.body.innerText` on LinkedIn / Greenhouse / Lever is enough)
- **Snowflake setup** (§6b checklist): account, cross-region inference, role, warehouse, tables (the table SQL is a straight copy of §5), and the PAT. Hand the account URL + PAT to C. Ask the Snowflake sponsor for a Cortex-enabled account (trial blocks Cortex).
- Google Cloud project + OAuth client setup (a click-through task, done in the first 20 minutes, then hand the client ID to B)
- Demo: seed data, the test LinkedIn account + test inboxes, the backup video, and the pitch

### Handoffs
| From → To | What | By |
|---|---|---|
| D → everyone | Scaffold, `types.ts`, `messages.ts` | 0:20 |
| A → B | OAuth client ID | 0:20 |
| A → C | Snowflake account URL + PAT, tables created | 0:25 |
| A → everyone | `mock.ts` | 0:30 |
| C → D | Backend URL with `/agent/run` + `/ai/*` working | 1:00 |
| B → D | Scrape + fill + `google/*` functions callable from the router | 1:15 |
| D → A | `useStore` hook with live data | 1:15 |

If Rachel finishes the UI early, the next most useful thing is writing and testing prompts with C (in the xAI console playground for now, or a Snowflake worksheet with `AI_COMPLETE` if we get a Cortex account), since that doesn't need deep code context.

**Shared contract (agree on this in the first 20 minutes):** the types in §5 live in `src/shared/types.ts`, and the message-router actions in `src/shared/messages.ts`:
`PARSE_JOB`, `SCRAPE_SEARCH`, `SCRAPE_PROFILE`, `GENERATE_DRAFTS`, `APPROVE_DRAFT`, `SEND_EMAIL`, `FILL_LINKEDIN`, `MARK_SENT`, `POLL_REPLIES`, `CREATE_MEETING`, `SUGGEST_QUESTIONS`, `UPDATE_QUESTION`, `GENERATE_PREP_BRIEF`, `SAVE_MEETING_NOTES`.

---

## 10. Timeline (3 hours)

| Time | Milestone |
|---|---|
| 0:00–0:20 | Repo scaffold, `types.ts` + `messages.ts` agreed, Google Cloud OAuth client created, Snowflake account + cross-region inference + tables ready, mock data in storage |
| 0:20–1:30 | Everyone builds their area against mocks |
| 1:30 | **Checkpoint:** paste job description → drafts in the queue → approve → email sends |
| 1:30–2:15 | LinkedIn fill, warm-path ranking, reply detection, calendar booking, question bank + prep brief, follow-up + thank-you loop in demo mode |
| 2:15–2:40 | Integration, bug bash, polish the Activity bar |
| 2:40–3:00 | Freeze. Record a backup demo video, rehearse the pitch |

**Cut order if behind:** `AI_AGG` insights / `AI_REDACT` → Hunter verification → LinkedIn reply detection → automatic prep brief (keep the on-demand button) → question-bank categories/feedback (keep plain Add / Skip) → automatic thank-you trigger (keep a manual "Draft thank-you" button) → LinkedIn fill (fall back to "copy + open profile") → calendar (fall back to sending availability). **Never cut:** the Grok agent loop and job parsing + reply classification (Grok JSON calls now; `AI_EXTRACT` + `AI_CLASSIFY` on Cortex). If `/sync` is slow, skip storing rows; the extension's local storage is enough for the demo.

---

## 11. Repo layout

```
coffee-chat-copilot/
├─ SPEC.md
├─ extension/
│  ├─ manifest.config.ts
│  ├─ src/
│  │  ├─ sidepanel/        (A) React app
│  │  ├─ background/       (D) service worker, scheduler, router
│  │  ├─ content/          (B) linkedin-search, linkedin-profile, job-page
│  │  ├─ google/           (C) gmail.ts, calendar.ts, auth.ts
│  │  └─ shared/           types.ts, messages.ts, storage.ts
│  └─ package.json
├─ backend/                (C) Vercel API
│  ├─ agent/               grok loop + tools
│  ├─ ai/                  /ai/* routes
│  └─ snowflake/           cortex REST client, SQL queries
└─ snowflake/              (A) setup.sql: role, warehouse, tables
```

---

## 12. Demo script (about 2 minutes)

1. During onboarding, click **Add** on a few AI-suggested questions to seed the question bank.
2. Open a real job posting, then open the side panel and click "Network for this job".
3. Show the 6 contacts it found, with NYU alumni ranked first and a reason on each ("NYU '22, same team"). Expand the agent trace in the Activity bar: "Grok called `rank_contacts` → drafted 6 messages" (on Cortex: "Snowflake `AI_SIMILARITY`").
4. Show the one template, then the 6 personalized drafts. Highlight the filled keywords and the warm-path hook.
5. Approve 2. One email sends live, and a LinkedIn note is filled in on a test account for the user to click Send.
6. Turn on demo mode. A follow-up draft appears in the queue on its own.
7. Reply from a teammate's inbox: "Sure, Thursday at 3?" Grok tags it `proposes_time` and shows it as warm (on Cortex: Snowflake `AI_CLASSIFY` + `AI_SENTIMENT`), Grok drafts a confirmation, you approve it, and the calendar event with a Meet link shows up. Its description holds the prep brief, with 5 questions picked from the bank you approved in step 1.
8. Fast-forward past the meeting. Type a quick note, and a thank-you + referral ask appears in the queue.
9. End on the Activity bar showing the whole timeline.

---

## 13. Open questions

- Branding/name: "Coffee Chat Copilot" is a placeholder.
- Which master's student takes which of roles B, C, and D?
- Which test LinkedIn account and test inboxes will we use for the live demo?
