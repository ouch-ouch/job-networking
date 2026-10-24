// Mock data for building and testing without the backend, LinkedIn, or Google.
// Owner: A (Rachel). Anyone can import it:
//
//   import { createMockState } from "../shared/mock";
//   await chrome.storage.local.set(createMockState());
//
// Every contact is fictional and every email uses the reserved `.example`
// domain, so a Gmail send test with this data can never reach a real person.
// For live send tests, swap in your own test inbox (see MOCK_TEST_INBOX).

import type {
  ActivityEvent, AppState, Contact, Draft, Meeting, Profile, Question, Target, Template,
} from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Replace with a teammate's inbox for live Gmail tests. */
export const MOCK_TEST_INBOX = "teammate-test-inbox@example.com";

export const MOCK_JOB_DESCRIPTION = `Ledgerly, Software Engineer Intern, Payments Platform (Summer 2027)
New York, NY (Hybrid)

About the team
The Payments Platform team builds the APIs that move money for 40,000 small businesses: card acquiring, ACH payouts, and real-time ledgering.

What you'll do
- Build and ship features in our TypeScript and Go services
- Work on idempotent payment APIs and reconciliation jobs
- Write tests, review code, and present your project at the end of summer

What we're looking for
- Pursuing a BS/MS in Computer Science or a related field, graduating 2027 or 2028
- Experience with TypeScript, Go, or Java
- Familiarity with SQL and distributed systems
- Curious about fintech and how payments actually work`;

export const mockProfile: Profile = {
  name: "Rachel Chen",
  school: "NYU",
  major: "Computer Science",
  year: "junior",
  background:
    "CS junior at NYU Courant. Interned at Capital One on the card disputes team (TypeScript, Postgres). " +
    "Member of Tech@NYU and the NYU Fintech Club. Built a budgeting app used by 300 students.",
  availability: "Weekdays 2–5pm ET",
  signature: "Rachel Chen\nNYU '28, Computer Science",
};

export const mockTemplates: Template[] = [
  {
    id: "tpl_email",
    name: "Coffee chat email",
    channel: "email",
    subject: "NYU student interested in {{company}}'s {{their_team}} team",
    body:
      "Hi {{first_name}}, I'm {{my_name}}, a {{my_year}} at NYU studying {{my_major}}. " +
      "I saw {{company}} is hiring for {{role}} and noticed you work on {{their_team}}. " +
      "{{personal_hook}} Would you be open to a 15-minute coffee chat?",
  },
  {
    id: "tpl_connect",
    name: "LinkedIn connect note",
    channel: "linkedin_connect",
    body:
      "Hi {{first_name}}, I'm {{my_name}}, an NYU {{my_major}} {{my_year}}. {{personal_hook}} " +
      "I'm applying for {{role}} at {{company}} and would love 15 minutes to hear about {{their_team}}.",
  },
];

export const mockTargets: Target[] = [
  {
    id: "tgt_ledgerly",
    company: "Ledgerly",
    role: "Software Engineer Intern",
    team: "Payments Platform",
    location: "New York, NY",
    skills: ["TypeScript", "Go", "SQL", "Distributed systems", "Payments APIs"],
    rawDescription: MOCK_JOB_DESCRIPTION,
    url: "https://jobs.lever.co/ledgerly-example/swe-intern-payments",
  },
];

const now = Date.now();

export const mockContacts: Contact[] = [
  {
    id: "c_priya",
    targetId: "tgt_ledgerly",
    name: "Priya Raman",
    title: "Software Engineer, Payments Platform",
    company: "Ledgerly",
    linkedinUrl: "https://www.linkedin.com/in/priya-raman-example",
    email: "priya.raman@ledgerly.example",
    emailConfidence: 0.82,
    connectionDegree: 2,
    warmPaths: [
      { type: "alumni", detail: "NYU Courant, CS '22" },
      { type: "mutual_connection", detail: "3 mutual connections" },
    ],
    relevance: 96,
    reason: "NYU '22, same team as the role",
    stage: "sent",
    followUpCount: 0,
    nextActionAt: now - 5 * MIN, // due: the scheduler should draft a follow-up
  },
  {
    id: "c_marcus",
    targetId: "tgt_ledgerly",
    name: "Marcus Ellison",
    title: "Senior Software Engineer, Payments",
    company: "Ledgerly",
    linkedinUrl: "https://www.linkedin.com/in/marcus-ellison-example",
    email: "marcus.ellison@ledgerly.example",
    emailConfidence: 0.74,
    connectionDegree: 2,
    warmPaths: [
      { type: "alumni", detail: "NYU Tandon, CS '19" },
      { type: "shared_org", detail: "Tech@NYU" },
    ],
    relevance: 91,
    reason: "NYU Tandon '19, Tech@NYU alum, senior on Payments",
    stage: "replied",
    followUpCount: 0,
  },
  {
    id: "c_jordan",
    targetId: "tgt_ledgerly",
    name: "Jordan Okafor",
    title: "University Recruiter",
    company: "Ledgerly",
    linkedinUrl: "https://www.linkedin.com/in/jordan-okafor-example",
    email: "jordan@ledgerly.example",
    emailConfidence: 0.55,
    connectionDegree: 2,
    warmPaths: [{ type: "mutual_connection", detail: "Connected with your NYU career advisor" }],
    relevance: 84,
    reason: "Recruits for engineering interns; shared connection",
    stage: "scheduled",
    followUpCount: 1,
  },
  {
    id: "c_elena",
    targetId: "tgt_ledgerly",
    name: "Elena Vasquez",
    title: "Engineering Manager, Risk & Disputes",
    company: "Ledgerly",
    linkedinUrl: "https://www.linkedin.com/in/elena-vasquez-example",
    email: "evasquez@ledgerly.example",
    emailConfidence: 0.61,
    connectionDegree: 3,
    warmPaths: [{ type: "past_employer", detail: "Capital One, card disputes (2018–2021)" }],
    relevance: 78,
    reason: "Ex-Capital One disputes, like your internship",
    stage: "drafted",
    followUpCount: 0,
  },
  {
    id: "c_sam",
    targetId: "tgt_ledgerly",
    name: "Sam Whitfield",
    title: "Product Manager, Payouts",
    company: "Ledgerly",
    linkedinUrl: "https://www.linkedin.com/in/sam-whitfield-example",
    email: "sam.whitfield@ledgerly.example",
    emailConfidence: 0.48,
    connectionDegree: 2,
    warmPaths: [],
    relevance: 63,
    reason: "PM on a sister team to Payments Platform",
    stage: "drafted",
    followUpCount: 0,
  },
  {
    id: "c_daniel",
    targetId: "tgt_ledgerly",
    name: "Daniel Kim",
    title: "Software Engineer, Ledger Infrastructure",
    company: "Ledgerly",
    linkedinUrl: "https://www.linkedin.com/in/daniel-kim-example",
    email: "daniel.kim@ledgerly.example",
    emailConfidence: 0.79,
    connectionDegree: 2,
    warmPaths: [{ type: "shared_org", detail: "NYU Fintech Club (2019–2021)" }],
    relevance: 72,
    reason: "Fintech Club alum, works on the ledger the role touches",
    stage: "met",
    followUpCount: 0,
  },
];

export const mockDrafts: Draft[] = [
  {
    id: "d_elena_initial",
    contactId: "c_elena",
    kind: "initial",
    channel: "email",
    subject: "NYU student interested in Ledgerly's Risk & Disputes team",
    body:
      "Hi Elena, I'm Rachel Chen, a junior at NYU studying Computer Science. " +
      "I saw Ledgerly is hiring for Software Engineer Intern and noticed you work on Risk & Disputes. " +
      "I interned on Capital One's card disputes team last summer and saw you were there too, so I'd love to hear how disputes work differs at Ledgerly. " +
      "Would you be open to a 15-minute coffee chat?",
    filledKeywords: {
      first_name: "Elena",
      my_name: "Rachel Chen",
      my_year: "junior",
      my_major: "Computer Science",
      company: "Ledgerly",
      role: "Software Engineer Intern",
      their_team: "Risk & Disputes",
      personal_hook:
        "I interned on Capital One's card disputes team last summer and saw you were there too, so I'd love to hear how disputes work differs at Ledgerly.",
    },
    status: "pending",
    createdAt: now - 40 * MIN,
  },
  {
    id: "d_sam_connect",
    contactId: "c_sam",
    kind: "initial",
    channel: "linkedin_connect",
    body:
      "Hi Sam, I'm Rachel Chen, an NYU Computer Science junior. I've been reading about how Ledgerly handles instant payouts. " +
      "I'm applying for Software Engineer Intern at Ledgerly and would love 15 minutes to hear about Payouts.",
    filledKeywords: {
      first_name: "Sam",
      my_name: "Rachel Chen",
      my_major: "Computer Science",
      my_year: "junior",
      personal_hook: "I've been reading about how Ledgerly handles instant payouts.",
      role: "Software Engineer Intern",
      company: "Ledgerly",
      their_team: "Payouts",
    },
    status: "pending",
    createdAt: now - 39 * MIN,
  },
  {
    id: "d_priya_initial",
    contactId: "c_priya",
    kind: "initial",
    channel: "email",
    subject: "NYU student interested in Ledgerly's Payments Platform team",
    body:
      "Hi Priya, I'm Rachel Chen, a junior at NYU studying Computer Science. " +
      "I saw Ledgerly is hiring for Software Engineer Intern and noticed you work on Payments Platform. " +
      "Fellow Courant CS student here, and I'd love to hear how you made the jump from NYU to payments infrastructure. " +
      "Would you be open to a 15-minute coffee chat?",
    filledKeywords: {
      first_name: "Priya",
      my_name: "Rachel Chen",
      my_year: "junior",
      my_major: "Computer Science",
      company: "Ledgerly",
      role: "Software Engineer Intern",
      their_team: "Payments Platform",
      personal_hook:
        "Fellow Courant CS student here, and I'd love to hear how you made the jump from NYU to payments infrastructure.",
    },
    status: "sent",
    createdAt: now - 3 * DAY - HOUR,
  },
  {
    id: "d_priya_followup",
    contactId: "c_priya",
    kind: "follow_up",
    channel: "email",
    subject: "Re: NYU student interested in Ledgerly's Payments Platform team",
    body:
      "Hi Priya, just bumping this in case it got buried. I know things get busy. " +
      "If you have 15 minutes in the next couple of weeks I'd really appreciate hearing about Payments Platform. Thanks either way!",
    filledKeywords: { first_name: "Priya", their_team: "Payments Platform" },
    status: "pending",
    createdAt: now - 4 * MIN,
  },
  {
    id: "d_marcus_initial",
    contactId: "c_marcus",
    kind: "initial",
    channel: "email",
    subject: "NYU student interested in Ledgerly's Payments team",
    body:
      "Hi Marcus, I'm Rachel Chen, a junior at NYU studying Computer Science. " +
      "I saw Ledgerly is hiring for Software Engineer Intern and noticed you work on Payments. " +
      "I'm on the Tech@NYU board now, and I saw you were part of it at Tandon. " +
      "Would you be open to a 15-minute coffee chat?",
    filledKeywords: {
      first_name: "Marcus",
      my_name: "Rachel Chen",
      my_year: "junior",
      my_major: "Computer Science",
      company: "Ledgerly",
      role: "Software Engineer Intern",
      their_team: "Payments",
      personal_hook: "I'm on the Tech@NYU board now, and I saw you were part of it at Tandon.",
    },
    status: "sent",
    createdAt: now - 2 * DAY,
  },
  {
    id: "d_marcus_schedule",
    contactId: "c_marcus",
    kind: "schedule_reply",
    channel: "email",
    subject: "Re: NYU student interested in Ledgerly's Payments team",
    body:
      "Hi Marcus, thank you so much! Thursday at 3pm ET works great. " +
      "I'll send a calendar invite with a Meet link. Looking forward to it.",
    filledKeywords: { first_name: "Marcus" },
    status: "pending",
    createdAt: now - 2 * MIN,
  },
];

export const mockQuestions: Question[] = [
  { id: "q1", text: "What does a first-year engineer's week look like on your team?", category: "role", source: "ai_suggested", status: "approved", timesUsed: 1, landedWell: 1 },
  { id: "q2", text: "What's the hardest technical problem your team is working on right now?", category: "team", source: "ai_suggested", status: "approved", timesUsed: 0 },
  { id: "q3", text: "How did you decide to move into payments after school?", category: "career_path", source: "user_written", status: "approved", timesUsed: 1 },
  { id: "q4", text: "What separates interns who get return offers from the ones who don't?", category: "recruiting", source: "ai_suggested", status: "approved", timesUsed: 0 },
  { id: "q5", text: "How do engineers and PMs split decisions on your team?", category: "culture", source: "ai_suggested", status: "approved", timesUsed: 0 },
  { id: "q6", text: "If you were a junior at NYU again, what would you do differently?", category: "advice", source: "user_written", status: "approved", timesUsed: 1, landedWell: 1 },
  { id: "q7", text: "What's on-call like for your team?", category: "team", source: "ai_suggested", status: "approved", timesUsed: 0 },
  { id: "q8", text: "What does the intern interview process look like this year?", category: "recruiting", source: "ai_suggested", status: "approved", timesUsed: 0 },
  { id: "q9", text: "Which skills from school turned out to matter most on the job?", category: "career_path", source: "ai_suggested", status: "suggested", timesUsed: 0 },
  { id: "q10", text: "How does your team measure whether a launch went well?", category: "team", source: "ai_suggested", status: "suggested", timesUsed: 0 },
  { id: "q11", text: "What's something about the company culture that surprised you after joining?", category: "culture", source: "ai_suggested", status: "suggested", timesUsed: 0 },
  { id: "q12", text: "What's your favorite thing about working remotely?", category: "culture", source: "ai_suggested", status: "skipped", timesUsed: 0 },
];

function dayAt(offsetDays: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const jordanStart = dayAt(1, 15);
const danielStart = dayAt(-1, 14);

export const mockMeetings: Meeting[] = [
  {
    id: "m_jordan",
    contactId: "c_jordan",
    start: jordanStart.toISOString(),
    end: new Date(jordanStart.getTime() + 30 * MIN).toISOString(),
    calendarEventId: "evt_mock_jordan",
    meetLink: "https://meet.google.com/abc-defg-hij",
    prepBrief: [
      "## Jordan Okafor, University Recruiter at Ledgerly",
      "Runs engineering intern recruiting for New York. Previously recruited at a Series B fintech for 3 years.",
      "",
      "## Warm path",
      "You're both connected to your NYU career advisor. Open with that.",
      "",
      "## Company and role context",
      "- The Software Engineer Intern role sits on **Payments Platform** (TypeScript, Go, SQL).",
      "- Ledgerly recently launched instant payouts for small businesses.",
      "",
      "## Questions",
      "1. What does the intern interview process look like this year for **Payments Platform**?",
      "2. What separates interns who get return offers from the ones who don't?",
      "3. How do engineers and PMs split decisions on the payments teams?",
      "4. If you were a junior at NYU again, what would you do differently?",
      "5. What does a first-year engineer's week look like at Ledgerly?",
    ].join("\n"),
    questionIds: ["q8", "q4", "q5", "q6", "q1"],
  },
  {
    id: "m_daniel",
    contactId: "c_daniel",
    start: danielStart.toISOString(),
    end: new Date(danielStart.getTime() + 30 * MIN).toISOString(),
    calendarEventId: "evt_mock_daniel",
    meetLink: "https://meet.google.com/klm-nopq-rst",
    questionIds: ["q1", "q2", "q3", "q6", "q7"],
  },
];

const RUN = "run_new_target_1";

export const mockActivity: ActivityEvent[] = [
  { id: "a1", contactId: "", at: now - 3 * DAY - 2 * HOUR, type: "agent_step", runId: RUN, summary: "Grok called parse_job (Snowflake AI_EXTRACT)", detail: "→ Ledgerly · Software Engineer Intern · Payments Platform · 5 skills" },
  { id: "a2", contactId: "", at: now - 3 * DAY - 2 * HOUR + 4_000, type: "agent_step", runId: RUN, summary: "Grok called get_contacts(tgt_ledgerly)", detail: "→ 12 contacts scraped from LinkedIn search" },
  { id: "a3", contactId: "", at: now - 3 * DAY - 2 * HOUR + 9_000, type: "agent_step", runId: RUN, summary: "Grok called rank_contacts (Snowflake AI_SIMILARITY)", detail: "→ ranked 12 contacts; top 6 kept (3 NYU alumni)" },
  { id: "a4", contactId: "", at: now - 3 * DAY - 2 * HOUR + 15_000, type: "agent_step", runId: RUN, summary: "Grok called fill_template ×6", detail: "→ 6 drafts with personal hooks" },
  { id: "a5", contactId: "", at: now - 3 * DAY - 2 * HOUR + 18_000, type: "agent_step", runId: RUN, summary: "Grok called queue_draft ×6", detail: "→ 6 drafts in the Approval Queue. No send tool: waiting for you." },
  { id: "a6", contactId: "c_priya", at: now - 3 * DAY - HOUR, type: "sent", summary: "Email sent to Priya Raman", threadId: "thr_priya" },
  { id: "a7", contactId: "c_jordan", at: now - 3 * DAY - HOUR + 30_000, type: "sent", summary: "Email sent to Jordan Okafor", threadId: "thr_jordan" },
  { id: "a8", contactId: "c_marcus", at: now - 2 * DAY, type: "sent", summary: "Email sent to Marcus Ellison", threadId: "thr_marcus" },
  { id: "a9", contactId: "c_jordan", at: now - 2 * DAY + 3 * HOUR, type: "reply_received", summary: "Jordan replied: interested", sentiment: "warm", threadId: "thr_jordan", detail: "Happy to chat! Grab any slot on my calendar this week." },
  { id: "a10", contactId: "c_jordan", at: now - 2 * DAY + 4 * HOUR, type: "meeting_scheduled", summary: "Coffee chat with Jordan booked, Meet link attached" },
  { id: "a11", contactId: "c_daniel", at: now - 1 * DAY - 2 * HOUR, type: "meeting_scheduled", summary: "Coffee chat with Daniel booked" },
  { id: "a12", contactId: "c_priya", at: now - 5 * MIN, type: "follow_up_due", summary: "No reply from Priya after 3 days: follow-up drafted" },
  { id: "a13", contactId: "c_marcus", at: now - 3 * MIN, type: "reply_received", summary: "Marcus replied: proposes_time", sentiment: "warm", threadId: "thr_marcus", detail: "Sure, Thursday at 3?" },
  { id: "a14", contactId: "c_marcus", at: now - 2 * MIN, type: "draft_created", summary: "Scheduling reply drafted for Marcus" },
];

/** A fresh, independent copy of the full app state. Safe to mutate. */
export function createMockState(): AppState {
  return structuredClone({
    profile: mockProfile,
    templates: mockTemplates,
    targets: mockTargets,
    contacts: mockContacts,
    drafts: mockDrafts,
    activity: mockActivity,
    meetings: mockMeetings,
    questions: mockQuestions,
    settings: { demoMode: false },
  });
}

/** Extra AI-suggested questions, used by the mock SUGGEST_QUESTIONS. */
export const mockSuggestionPool: Pick<Question, "text" | "category">[] = [
  { text: "What do you wish you'd known before your first payments incident?", category: "team" },
  { text: "How much do interns get to own end to end?", category: "role" },
  { text: "What made you pick Ledgerly over other offers?", category: "career_path" },
  { text: "Who on the team would be good for me to talk to next?", category: "advice" },
  { text: "How are intern projects chosen?", category: "recruiting" },
  { text: "How does the team handle disagreements in code review?", category: "culture" },
];
