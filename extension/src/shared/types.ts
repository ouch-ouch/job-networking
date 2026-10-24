// Shared contract: a straight copy of SPEC.md §5.
// Owner: D. Rachel (A) wrote this copy so the UI and mock.ts could start
// before the scaffold landed. D: replace freely, but keep the field names.
// Fields marked PROPOSED are not in the spec yet; see docs/rachel-tasks.md.

export type Profile = {
  name: string; school: string; major: string; year: string;
  background: string;          // resume summary / blurb
  availability: string;        // e.g. "Weekdays 2–5pm ET" or a Calendly link
  signature: string;
};

export type Template = {
  id: string; name: string;
  channel: "email" | "linkedin_connect" | "linkedin_message";
  subject?: string;            // email only
  body: string;                // contains {{placeholders}}
};

export type Target = {         // a job you're networking toward
  id: string; company: string; role: string; team?: string;
  location?: string; skills: string[]; rawDescription: string; url?: string;
};

export type WarmPath = {
  type: "alumni" | "past_employer" | "shared_org" | "mutual_connection";
  detail: string;
};

export type ContactStage =
  | "found" | "drafted" | "sent" | "followed_up" | "replied"
  | "scheduled" | "met" | "thanked" | "cold";

export type Contact = {
  id: string; targetId: string;
  name: string; title: string; company: string;
  linkedinUrl?: string; email?: string; emailConfidence?: number;
  connectionDegree?: 1 | 2 | 3;
  warmPaths: WarmPath[];
  relevance: number;           // 0–100, warm paths boost it
  reason: string;              // "NYU alum on the payments team"
  stage: ContactStage;
  notes?: string;              // the user's post-chat notes
  followUpCount: number;
  nextActionAt?: number;       // epoch ms; read by the scheduler
};

export type Draft = {          // one item in the Approval Queue
  id: string; contactId: string;
  kind: "initial" | "follow_up" | "schedule_reply" | "confirmation" | "thank_you";
  channel: Template["channel"];
  subject?: string; body: string;
  filledKeywords: Record<string, string>;
  status: "pending" | "approved" | "rejected" | "sent" | "failed";
  createdAt: number;
};

export type ActivityEvent = {
  id: string; contactId: string; at: number;
  type: "draft_created" | "approved" | "sent" | "reply_received"
      | "follow_up_due" | "meeting_scheduled" | "agent_step" | "error";
  summary: string;
  threadId?: string;           // Gmail thread for the messages view
  sentiment?: "warm" | "neutral" | "cold"; // PROPOSED: AI_SENTIMENT badge on reply_received
  runId?: string;              // PROPOSED: groups agent_step events from one /agent/run
  detail?: string;             // PROPOSED: tool args/result, or the reply text
};

export type Meeting = {
  id: string; contactId: string; start: string; end: string;
  calendarEventId: string; meetLink?: string;
  prepBrief?: string;          // markdown, also written into the event description
  questionIds: string[];       // questions picked from the bank for this chat
};

export type QuestionCategory =
  | "role" | "team" | "career_path" | "culture" | "recruiting" | "advice";

export type Question = {       // question bank entry
  id: string; text: string;
  category: QuestionCategory;
  source: "ai_suggested" | "user_written";
  status: "suggested" | "approved" | "skipped";   // only "approved" questions can be picked
  timesUsed: number; landedWell?: number;          // from post-chat feedback
};

// PROPOSED: the spec has a demo-mode toggle (§7) but no place to store it.
export type Settings = {
  demoMode: boolean;
};

// Everything in chrome.storage.local, keyed the way the UI reads it.
export type AppState = {
  profile: Profile;
  templates: Template[];
  targets: Target[];
  contacts: Contact[];
  drafts: Draft[];
  activity: ActivityEvent[];
  meetings: Meeting[];
  questions: Question[];
  settings: Settings;
};
