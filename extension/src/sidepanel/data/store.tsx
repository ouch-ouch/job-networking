// The side panel's only data layer. Every screen calls useApp() and nothing else.
//
// Right now this is a MOCK: state lives in React (persisted to localStorage for dev),
// and each action fakes what the service worker will do. Action names match the
// router actions in SPEC §9 (PARSE_JOB, SCRAPE_SEARCH, ...).
//
// Switching to live data (D's useStore + messages.ts) means replacing the bodies
// in this file only: read `state` from useStore(), and make each action
// `chrome.runtime.sendMessage({ type: "<ACTION>", ... })`.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ActivityEvent, AppState, Contact, Draft, Meeting, Profile, Question, QuestionCategory, Target, Template,
} from "../../shared/types";
import { createMockState, MOCK_JOB_DESCRIPTION, mockSuggestionPool } from "../../shared/mock";
import { mockFillTemplate, mockParseJob, mockPickQuestions } from "./fill";
import { discoverViaBackend } from "./backend";

export const EMAIL_CONFIDENCE_THRESHOLD = 0.5; // SPEC §8: below this, the user must confirm the address
export const EMAIL_DAILY_CAP = 30;
export const LINKEDIN_CONNECT_LIMIT = 300;
export const MAX_FOLLOW_UPS = 2;

const STORAGE_KEY = "ccc-mock-state-v1";
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;
const wait = (ms = 600) => new Promise((r) => setTimeout(r, ms));

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppState;
  } catch { /* storage blocked: fall through to fresh mock */ }
  return createMockState();
}

export type Actions = ReturnType<typeof useMockActions>;
type Ctx = { state: AppState; actions: Actions; busy: Record<string, boolean> };
const AppContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  const actions = useMockActions(setState, stateRef, setBusy);

  // Mock scheduler (D's chrome.alarms in the real build). Demo mode ticks fast.
  useEffect(() => {
    const id = setInterval(actions.tick, state.settings.demoMode ? 10_000 : 60_000);
    return () => clearInterval(id);
  }, [state.settings.demoMode, actions.tick]);

  const value = useMemo(() => ({ state, actions, busy }), [state, actions, busy]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function useMockActions(
  setState: React.Dispatch<React.SetStateAction<AppState>>,
  stateRef: React.MutableRefObject<AppState>,
  setBusy: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
) {
  const update = useCallback((fn: (s: AppState) => AppState) => setState(fn), [setState]);

  const withBusy = useCallback(
    <A extends unknown[], R>(key: string | ((first: NoInfer<A>[0]) => string), fn: (...a: A) => Promise<R>) =>
      async (...a: A): Promise<R> => {
        const k = typeof key === "string" ? key : key(a[0]);
        setBusy((b) => ({ ...b, [k]: true }));
        try { return await fn(...a); } finally { setBusy((b) => ({ ...b, [k]: false })); }
      },
    [setBusy],
  );

  return useMemo(() => {
    const log = (s: AppState, e: Omit<ActivityEvent, "id" | "at">): AppState => ({
      ...s, activity: [...s.activity, { id: uid("a"), at: Date.now(), ...e }],
    });
    const patchContact = (s: AppState, id: string, p: Partial<Contact>): AppState => ({
      ...s, contacts: s.contacts.map((c) => (c.id === id ? { ...c, ...p } : c)),
    });
    const patchDraft = (s: AppState, id: string, p: Partial<Draft>): AppState => ({
      ...s, drafts: s.drafts.map((d) => (d.id === id ? { ...d, ...p } : d)),
    });
    const contactName = (s: AppState, id: string) => s.contacts.find((c) => c.id === id)?.name ?? "contact";
    const followUpInterval = (s: AppState, n: number) =>
      s.settings.demoMode ? (n === 0 ? 1 : 2) * MIN : (n === 0 ? 3 : 7) * DAY;

    function draftFor(s: AppState, contact: Contact, channel: Template["channel"] = "email"): Draft | null {
      const target = s.targets.find((t) => t.id === contact.targetId);
      const template = s.templates.find((t) => t.channel === channel) ?? s.templates[0];
      if (!target || !template) return null;
      const out = mockFillTemplate(template, s.profile, target, contact);
      return {
        id: uid("d"), contactId: contact.id, kind: "initial", channel: template.channel,
        ...out, status: "pending", createdAt: Date.now(),
      };
    }

    function buildBrief(s: AppState, meeting: Meeting): { prepBrief: string; questionIds: string[] } {
      const c = s.contacts.find((x) => x.id === meeting.contactId);
      const t = s.targets.find((x) => x.id === c?.targetId);
      const team = c?.title.split(", ")[1] ?? t?.team;
      const picked = mockPickQuestions(s.questions, team);
      const path = c?.warmPaths[0];
      const prepBrief = [
        `## ${c?.name}, ${c?.title} at ${c?.company}`,
        c?.reason ?? "",
        "",
        "## Warm path",
        path ? `${path.detail}. Open with that.` : "No shared background found. Open with the role.",
        "",
        "## Company and role context",
        `- ${t?.role} on **${t?.team ?? "the team"}** (${t?.skills.join(", ")}).`,
        "",
        "## Questions",
        ...picked.map((q, i) => `${i + 1}. ${q.text}`),
      ].join("\n");
      return { prepBrief, questionIds: picked.map((q) => q.id) };
    }

    function bookMeeting(s: AppState, contactId: string, start: Date): AppState {
      const meeting: Meeting = {
        id: uid("m"), contactId, start: start.toISOString(),
        end: new Date(start.getTime() + 30 * MIN).toISOString(),
        calendarEventId: uid("evt"), meetLink: "https://meet.google.com/mock-meet-link", questionIds: [],
      };
      Object.assign(meeting, buildBrief(s, meeting));
      s = { ...s, meetings: [...s.meetings, meeting] };
      s = patchContact(s, contactId, { stage: "scheduled", nextActionAt: undefined });
      return log(s, { contactId, type: "meeting_scheduled", summary: `Coffee chat with ${contactName(s, contactId)} booked, prep brief attached` });
    }

    // ---- Profile / template / settings (direct storage writes) ----
    const saveProfile = (profile: Profile) => update((s) => ({ ...s, profile }));
    const saveTemplate = (t: Template) =>
      update((s) => ({ ...s, templates: s.templates.some((x) => x.id === t.id) ? s.templates.map((x) => (x.id === t.id ? t : x)) : [...s.templates, t] }));
    const setDemoMode = (demoMode: boolean) => update((s) => ({ ...s, settings: { ...s.settings, demoMode } }));
    const resetMock = () => { setState(createMockState()); };

    // ---- Targets & contacts ----
    /** job-page.ts: grab the open posting's text. */
    const grabJobPage = withBusy("grab", async (): Promise<{ text: string; url?: string }> => {
      await wait(300);
      return { text: MOCK_JOB_DESCRIPTION, url: "https://jobs.lever.co/ledgerly-example/swe-intern-payments" };
    });

    /** PARSE_JOB */
    const parseJob = withBusy("parse", async (rawDescription: string, url?: string): Promise<Target> => {
      await wait(900);
      const target: Target = { id: uid("tgt"), rawDescription, url, ...mockParseJob(rawDescription) };
      update((s) => log({ ...s, targets: [...s.targets, target] }, {
        contactId: "", type: "agent_step", runId: uid("run"),
        summary: "Grok called parse_job (Snowflake AI_EXTRACT)",
        detail: `→ ${target.company} · ${target.role}${target.team ? ` · ${target.team}` : ""} · ${target.skills.length} skills`,
      }));
      return target;
    });

    /** SCRAPE_SEARCH: calls the real Grok backend (backend/src/server.ts). Falls
     * back to a logged error (no fake contacts) if the backend is unreachable. */
    const scrapeSearch = withBusy((tid: string) => `scrape:${tid}`, async (targetId: string) => {
      const t = stateRef.current.targets.find((x) => x.id === targetId);
      if (!t) return;
      const runId = uid("run");
      try {
        const { contacts: fresh, mode } = await discoverViaBackend(t, stateRef.current.profile);
        update((s) => log({ ...s, contacts: [...s.contacts, ...fresh] }, {
          contactId: "", type: "agent_step", runId,
          summary: `Grok discovery (${mode}): found ${fresh.length} people on X`,
          detail: fresh.map((c) => `${c.name} — ${c.reason}`).join("\n") || "No evidenced matches.",
        }));
      } catch (e) {
        update((s) => log(s, {
          contactId: "", type: "error", runId,
          summary: "Grok discovery failed", detail: e instanceof Error ? e.message : String(e),
        }));
      }
    });

    const addContact = (c: Omit<Contact, "id" | "stage" | "followUpCount" | "warmPaths" | "relevance" | "reason"> & Partial<Contact>) =>
      update((s) => ({
        ...s,
        contacts: [...s.contacts, { warmPaths: [], relevance: 50, reason: "Added by hand", ...c, id: uid("c"), stage: "found", followUpCount: 0 }],
      }));

    /** GENERATE_DRAFTS: one initial draft per contact still in "found". */
    const generateDrafts = withBusy((tid: string) => `gen:${tid}`, async (targetId: string, channel: Template["channel"] = "email") => {
      await wait(1500);
      update((s) => {
        const runId = uid("run");
        const todo = s.contacts.filter((c) => c.targetId === targetId && c.stage === "found");
        let next = s;
        for (const c of todo) {
          const d = draftFor(next, c, channel);
          if (!d) continue;
          next = patchContact({ ...next, drafts: [...next.drafts, d] }, c.id, { stage: "drafted" });
        }
        next = log(next, { contactId: "", type: "agent_step", runId, summary: `Grok called fill_template ×${todo.length}`, detail: "→ keywords filled from the job + profile, hooks lead with warm paths" });
        return log(next, { contactId: "", type: "agent_step", runId, summary: `Grok called queue_draft ×${todo.length}`, detail: `→ ${todo.length} drafts in the Approval Queue. No send tool: waiting for you.` });
      });
    });

    // ---- Approval Queue ----
    const updateDraft = (id: string, p: Pick<Draft, "body"> & Partial<Pick<Draft, "subject">>) => update((s) => patchDraft(s, id, p));
    const updateContactEmail = (contactId: string, email: string) =>
      update((s) => patchContact(s, contactId, { email, emailConfidence: 1 }));
    const rejectDraft = (id: string) => update((s) => patchDraft(s, id, { status: "rejected" }));

    /** GENERATE_DRAFTS for a single draft. */
    const regenerateDraft = withBusy((id: string) => `regen:${id}`, async (id: string) => {
      await wait(1000);
      update((s) => {
        const d = s.drafts.find((x) => x.id === id);
        const c = s.contacts.find((x) => x.id === d?.contactId);
        if (!d || !c) return s;
        const fresh = d.kind === "initial" ? draftFor(s, c, d.channel) : null;
        const body = fresh?.body ?? d.body.replace(/^Hi (\w+),/, "Hey $1,");
        return patchDraft(s, id, { body, subject: fresh?.subject ?? d.subject, filledKeywords: fresh?.filledKeywords ?? d.filledKeywords, createdAt: Date.now() });
      });
    });

    function afterSend(s: AppState, d: Draft): AppState {
      const now = Date.now();
      s = patchDraft(s, d.id, { status: "sent" });
      const c = s.contacts.find((x) => x.id === d.contactId)!;
      const via = d.channel === "email" ? "Email" : "LinkedIn note";
      s = log(s, { contactId: c.id, type: "sent", summary: `${via} sent to ${c.name}`, threadId: d.channel === "email" ? `thr_${c.id}` : undefined });
      switch (d.kind) {
        case "initial":
          return patchContact(s, c.id, { stage: "sent", nextActionAt: now + followUpInterval(s, 0) });
        case "follow_up": {
          const n = c.followUpCount + 1;
          return patchContact(s, c.id, { stage: "followed_up", followUpCount: n, nextActionAt: n < MAX_FOLLOW_UPS ? now + followUpInterval(s, n) : now + followUpInterval(s, 1) });
        }
        case "schedule_reply": {
          // Mock of "time agreed → CREATE_MEETING": books the next Thursday at 3pm.
          const start = new Date(); start.setDate(start.getDate() + ((4 - start.getDay() + 7) % 7 || 7)); start.setHours(15, 0, 0, 0);
          return bookMeeting(s, c.id, start);
        }
        case "thank_you":
          return patchContact(s, c.id, { stage: "thanked", nextActionAt: undefined });
        default:
          return s;
      }
    }

    /** APPROVE_DRAFT → SEND_EMAIL (email) or FILL_LINKEDIN (LinkedIn, then the user clicks Send). */
    const approveDraft = withBusy((id: string) => `approve:${id}`, async (id: string) => {
      const d = stateRef.current.drafts.find((x) => x.id === id);
      if (!d) return;
      update((s) => log(patchDraft(s, id, { status: "approved" }), { contactId: d.contactId, type: "approved", summary: `Approved ${d.kind.replace("_", "-")} for ${contactName(s, d.contactId)}` }));
      await wait(900);
      if (d.channel === "email") update((s) => afterSend(s, s.drafts.find((x) => x.id === id)!));
      // LinkedIn: stays "approved" until MARK_SENT.
    });

    /** MARK_SENT: the user clicked Send in LinkedIn. */
    const markSent = (id: string) => update((s) => afterSend(s, s.drafts.find((x) => x.id === id)!));

    // ---- Replies, meetings ----
    /** POLL_REPLIES: mock pretends the first contacted person replied "Sure, Thursday at 3?". */
    const pollReplies = withBusy("poll", async () => {
      await wait(800);
      update((s) => {
        const c = s.contacts.find((x) => x.stage === "sent" || x.stage === "followed_up");
        if (!c) return s;
        const first = c.name.split(" ")[0];
        s = patchContact(s, c.id, { stage: "replied", nextActionAt: undefined });
        // Stop on reply: drop any pending follow-ups for this contact.
        s = { ...s, drafts: s.drafts.map((d) => (d.contactId === c.id && d.kind === "follow_up" && d.status === "pending" ? { ...d, status: "rejected" } : d)) };
        s = log(s, { contactId: c.id, type: "reply_received", summary: `${first} replied: proposes_time`, sentiment: "warm", threadId: `thr_${c.id}`, detail: "Sure, Thursday at 3?" });
        const draft: Draft = {
          id: uid("d"), contactId: c.id, kind: "schedule_reply", channel: "email",
          subject: "Re: coffee chat",
          body: `Hi ${first}, thank you! Thursday at 3pm ET works great. I'll send a calendar invite with a Meet link. Looking forward to it.`,
          filledKeywords: { first_name: first }, status: "pending", createdAt: Date.now(),
        };
        return log({ ...s, drafts: [...s.drafts, draft] }, { contactId: c.id, type: "draft_created", summary: `Scheduling reply drafted for ${c.name}` });
      });
    });

    /** CREATE_MEETING */
    const createMeeting = (contactId: string, start: Date) => update((s) => bookMeeting(s, contactId, start));

    /** GENERATE_PREP_BRIEF */
    const generatePrepBrief = withBusy((mid: string) => `brief:${mid}`, async (meetingId: string) => {
      await wait(1200);
      update((s) => {
        const m = s.meetings.find((x) => x.id === meetingId);
        if (!m) return s;
        const brief = buildBrief(s, m);
        return {
          ...log(s, { contactId: m.contactId, type: "agent_step", runId: uid("run"), summary: "Grok called search_question_bank (Snowflake AI_SIMILARITY)", detail: `→ picked ${brief.questionIds.length} approved questions` }),
          meetings: s.meetings.map((x) => (x.id === meetingId ? { ...x, ...brief } : x)),
        };
      });
    });

    /** SAVE_MEETING_NOTES: stores notes + feedback, then queues a thank-you + referral ask. */
    const saveMeetingNotes = withBusy((mid: string) => `notes:${mid}`, async (meetingId: string, notes: string, landedWellIds: string[]) => {
      await wait(1000);
      update((s) => {
        const m = s.meetings.find((x) => x.id === meetingId);
        const c = s.contacts.find((x) => x.id === m?.contactId);
        const t = s.targets.find((x) => x.id === c?.targetId);
        if (!m || !c) return s;
        const first = c.name.split(" ")[0];
        const firstNote = notes.split(/[.\n]/)[0]?.trim();
        const draft: Draft = {
          id: uid("d"), contactId: c.id, kind: "thank_you", channel: "email", subject: "Thank you for the chat!",
          body:
            `Hi ${first}, thanks again for taking the time to chat. ` +
            (firstNote ? `What you said about ${firstNote.charAt(0).toLowerCase() + firstNote.slice(1)} really stuck with me.` : "") +
            `\n\nIf you think I'd be a fit, I'd be grateful if you'd be open to referring me for the ${t?.role ?? "role"}. No pressure at all.`,
          filledKeywords: { first_name: first }, status: "pending", createdAt: Date.now(),
        };
        s = patchContact(s, c.id, { notes, stage: "met" });
        s = {
          ...s,
          drafts: [...s.drafts, draft],
          questions: s.questions.map((q) => (m.questionIds.includes(q.id)
            ? { ...q, timesUsed: q.timesUsed + 1, landedWell: (q.landedWell ?? 0) + (landedWellIds.includes(q.id) ? 1 : 0) }
            : q)),
        };
        return log(s, { contactId: c.id, type: "draft_created", summary: `Thank-you + referral ask drafted for ${c.name}` });
      });
    });

    // ---- Question bank ----
    /** SUGGEST_QUESTIONS */
    const suggestQuestions = withBusy("suggest", async () => {
      await wait(1000);
      update((s) => {
        const have = new Set(s.questions.map((q) => q.text.toLowerCase()));
        const fresh: Question[] = mockSuggestionPool
          .filter((q) => !have.has(q.text.toLowerCase()))
          .slice(0, 3)
          .map((q) => ({ ...q, id: uid("q"), source: "ai_suggested", status: "suggested", timesUsed: 0 }));
        return { ...s, questions: [...s.questions, ...fresh] };
      });
    });

    /** UPDATE_QUESTION (Add = approved, Skip = skipped, edit text/category) */
    const updateQuestion = (id: string, p: Partial<Pick<Question, "text" | "category" | "status">>) =>
      update((s) => ({ ...s, questions: s.questions.map((q) => (q.id === id ? { ...q, ...p } : q)) }));
    const addQuestion = (text: string, category: QuestionCategory) =>
      update((s) => ({ ...s, questions: [...s.questions, { id: uid("q"), text, category, source: "user_written", status: "approved", timesUsed: 0 }] }));

    // ---- Scheduler tick (D's chrome.alarms; mocked here) ----
    const tick = () => update((s) => {
      const now = Date.now();
      for (const c of s.contacts) {
        if (!(c.stage === "sent" || c.stage === "followed_up") || !c.nextActionAt || c.nextActionAt > now) continue;
        const hasPending = s.drafts.some((d) => d.contactId === c.id && d.kind === "follow_up" && d.status === "pending");
        if (hasPending) continue;
        if (c.followUpCount >= MAX_FOLLOW_UPS) {
          s = log(patchContact(s, c.id, { stage: "cold", nextActionAt: undefined }), { contactId: c.id, type: "follow_up_due", summary: `${c.name} marked cold after ${MAX_FOLLOW_UPS} follow-ups` });
          continue;
        }
        const first = c.name.split(" ")[0];
        const draft: Draft = {
          id: uid("d"), contactId: c.id, kind: "follow_up", channel: "email", subject: "Re: coffee chat",
          body: `Hi ${first}, just bumping this in case it got buried. If you have 15 minutes in the next couple of weeks I'd really appreciate it. Thanks either way!`,
          filledKeywords: { first_name: first }, status: "pending", createdAt: now,
        };
        s = log({ ...s, drafts: [...s.drafts, draft] }, { contactId: c.id, type: "follow_up_due", summary: `No reply from ${first}: follow-up #${c.followUpCount + 1} drafted` });
      }
      for (const m of s.meetings) {
        const c = s.contacts.find((x) => x.id === m.contactId);
        if (c?.stage === "scheduled" && new Date(m.end).getTime() < now) s = patchContact(s, c.id, { stage: "met" });
      }
      return s;
    });

    /** Demo helper: move a meeting into the past so the "How did it go?" prompt shows. */
    const fastForwardMeeting = (meetingId: string) => update((s) => {
      const m = s.meetings.find((x) => x.id === meetingId);
      if (!m) return s;
      const start = new Date(Date.now() - 45 * MIN);
      s = { ...s, meetings: s.meetings.map((x) => (x.id === meetingId ? { ...x, start: start.toISOString(), end: new Date(start.getTime() + 30 * MIN).toISOString() } : x)) };
      return patchContact(s, m.contactId, { stage: "met" });
    });

    return {
      saveProfile, saveTemplate, setDemoMode, resetMock,
      grabJobPage, parseJob, scrapeSearch, addContact, generateDrafts,
      updateDraft, updateContactEmail, rejectDraft, regenerateDraft, approveDraft, markSent,
      pollReplies, createMeeting, generatePrepBrief, saveMeetingNotes, fastForwardMeeting,
      suggestQuestions, updateQuestion, addQuestion, tick,
    };
  }, [update, withBusy, setState, stateRef]);
}
