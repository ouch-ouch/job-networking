// "x": found through Grok X research; you copy the approved message and send it on X yourself.
export type Channel = "email" | "linkedin_connect" | "linkedin_message" | "x";
export type Stage =
  | "found"
  | "drafted"
  | "sent"
  | "followed_up"
  | "replied"
  | "scheduled"
  | "met"
  | "thanked"
  | "cold";
export type Profile = {
  name: string;
  school: string;
  major: string;
  year: string;
  background: string;
  availability: string;
  signature: string;
  /** Skills, past companies, and clubs read from your résumé, used as search keywords. */
  keywords?: string[];
};
export type Template = {
  id: string;
  name: string;
  channel: Channel;
  subject?: string;
  body: string;
};
export type Target = {
  id: string;
  company: string;
  role: string;
  team?: string;
  location?: string;
  skills: string[];
  rawDescription: string;
  url?: string;
  domain?: string;
};
export type WarmPath = {
  type: "alumni" | "past_employer" | "shared_org" | "mutual_connection";
  detail: string;
};
export type Contact = {
  id: string;
  targetId: string;
  name: string;
  title: string;
  company: string;
  linkedinUrl?: string;
  email?: string;
  emailConfidence?: number;
  emailVerified?: boolean;
  connectionDegree?: 1 | 2 | 3;
  warmPaths: WarmPath[];
  relevance: number;
  reason: string;
  stage: Stage;
  notes?: string;
  followUpCount: number;
  nextActionAt?: number;
  threadId?: string;
  optedOut?: boolean;
  emailGuesses?: { email: string; confidence: number }[];
  xHandle?: string;
  xUrl?: string;
  /** The person's real post that made them relevant; grounds {{personal_hook}}. */
  xPost?: { url: string; excerpt: string };
};
export type Draft = {
  id: string;
  contactId: string;
  kind:
    "initial" | "follow_up" | "schedule_reply" | "confirmation" | "thank_you";
  channel: Channel;
  subject?: string;
  body: string;
  filledKeywords: Record<string, string>;
  status: "pending" | "approved" | "rejected" | "sending" | "sent" | "failed";
  createdAt: number;
  error?: string;
  sentAt?: number;
  referralAsk?: string;
};
export type ActivityEvent = {
  id: string;
  contactId: string;
  at: number;
  type:
    | "draft_created"
    | "approved"
    | "sent"
    | "reply_received"
    | "follow_up_due"
    | "meeting_scheduled"
    | "error"
    | "contact_added"
    | "notes_saved";
  summary: string;
  threadId?: string;
};
export type Meeting = {
  id: string;
  contactId: string;
  start: string;
  end: string;
  calendarEventId: string;
  meetLink?: string;
  prepBrief?: string;
  questionIds: string[];
};
export type QuestionCategory =
  "role" | "team" | "career_path" | "culture" | "recruiting" | "advice";
export type Question = {
  id: string;
  text: string;
  category: QuestionCategory;
  source: "ai_suggested" | "user_written";
  status: "suggested" | "approved" | "skipped";
  timesUsed: number;
  landedWell?: number;
  contactId?: string; // the person in your network this question was tailored for
  why?: string; // which fact about them makes it fit
};
export type Settings = {
  demoMode: boolean;
  backendUrl: string;
  googleConnected: boolean;
  /** The signed-in Google account, shown in the header and Settings. */
  googleEmail?: string;
  googleName?: string;
  googlePicture?: string;
  /** Chose "Continue without Google" on the sign-in screen. */
  signInSkipped?: boolean;
  emailThreshold: number;
  dailyEmailLimit: number;
  dailyScrapeLimit: number;
};
export type AppState = {
  version: 1;
  profile: Profile;
  template: Template;
  targets: Target[];
  contacts: Contact[];
  drafts: Draft[];
  activities: ActivityEvent[];
  meetings: Meeting[];
  questions: Question[];
  settings: Settings;
  usage: { date: string; emails: number; profiles: number };
};
export type PrepBrief = {
  summary: string;
  warmPathTalkingPoint: string;
  companyContext: string;
  picked: { questionId: string; tailoredText: string }[];
  newQuestions?: { text: string; category: QuestionCategory }[];
};
export type PeopleSearchPlan = {
  summary: string;
  queries: Array<{
    label: string;
    query: string;
    rationale: string;
    connectionType: "alumni" | "shared_background" | "team" | "recruiting" | "company";
  }>;
};
/** Presentation scenes for demo mode (see shared/demoScenes.ts). */
export type DemoSceneId = "start" | "people" | "reply" | "chat" | "after";
export type ReplyIntent =
  "interested" | "proposes_time" | "not_interested" | "referral" | "ooo";
export type Action =
  | { type: "SAVE_PROFILE"; profile: Profile }
  | { type: "SAVE_TEMPLATE"; template: Template }
  | { type: "UPDATE_SETTINGS"; settings: Partial<Settings> }
  | { type: "PARSE_JOB"; rawDescription: string; url?: string; domain?: string }
  | {
      type: "ADD_CONTACT";
      contact: Partial<Contact> & {
        name: string;
        targetId: string;
        title: string;
        company: string;
      };
    }
  | {
      type: "UPDATE_CONTACT";
      contactId: string;
      patch: Pick<
        Partial<Contact>,
        "email" | "emailVerified" | "emailConfidence"
      >;
    }
  | { type: "GENERATE_SEARCH_PLAN"; targetId: string }
  | { type: "SCRAPE_SEARCH"; targetId: string }
  | { type: "FIND_ON_X"; targetId: string }
  | { type: "GENERATE_DRAFTS"; contactIds: string[] }
  | { type: "UPDATE_DRAFT"; draftId: string; body: string; subject?: string }
  | { type: "REGENERATE_DRAFT"; draftId: string }
  | { type: "APPROVE_DRAFT"; draftId: string }
  | { type: "REJECT_DRAFT"; draftId: string }
  | { type: "SEND_EMAIL"; draftId: string }
  | { type: "RESOLVE_SEND"; draftId: string; sent: boolean }
  | { type: "FILL_LINKEDIN"; draftId: string }
  | { type: "MARK_SENT"; draftId: string }
  | { type: "POLL_REPLIES" }
  | { type: "RECORD_REPLY"; contactId: string; replyText: string }
  | { type: "CREATE_MEETING"; contactId: string; start: string; end: string }
  | { type: "SUGGEST_QUESTIONS"; contactId?: string }
  | { type: "UPDATE_QUESTION"; question: Question }
  | { type: "GENERATE_PREP_BRIEF"; contactId: string }
  | { type: "SET_CHAT_QUESTIONS"; meetingId: string; questionIds: string[] }
  | {
      type: "SAVE_MEETING_NOTES";
      contactId: string;
      notes: string;
      includeReferral?: boolean;
    }
  | { type: "RUN_SCHEDULER"; now?: number }
  | { type: "CONNECT_GOOGLE" }
  | { type: "DISCONNECT_GOOGLE" }
  | { type: "RESET_DEMO" }
  | { type: "LOAD_DEMO_SCENE"; scene: DemoSceneId };
export type ActionResult = {
  state: AppState;
  message?: string;
  data?: unknown;
};
