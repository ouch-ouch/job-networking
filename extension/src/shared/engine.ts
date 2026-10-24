import type {
  Action,
  ActionResult,
  AppState,
  Contact,
  Draft,
  Meeting,
  PrepBrief,
  PeopleSearchPlan,
  Question,
  ReplyIntent,
  Target,
} from "./types";
import { getState, saveState, switchMode } from "./storage";
import { createDemoState } from "./mock";
import { aiRequest } from "./ai";
import { connectGoogle } from "../google/auth";
import { sendEmail, getThreadReplies } from "../google/gmail";
import { createMeeting, updateMeetingDescription } from "../google/calendar";
import { scrapeSearch, fillLinkedIn } from "../content/index";
import { discoverOnX } from "./x";

const DAY = 86_400_000;
const OPT_OUT = "If you'd prefer no follow-ups, just let me know.";
const id = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const today = (now: number) => new Date(now).toISOString().slice(0, 10);
const optOut = (body: string) =>
  body.toLowerCase().includes("no follow-ups")
    ? body
    : `${body.trim()}\n\n${OPT_OUT}`;
const initialStages = new Set(["found", "drafted"]);
const followUpStages = new Set(["sent", "followed_up"]);
const advancedStages = new Set(["scheduled", "met", "thanked"]);
const defaultServices = {
  aiRequest,
  connectGoogle,
  sendEmail,
  getThreadReplies,
  createMeeting,
  updateMeetingDescription,
  scrapeSearch,
  fillLinkedIn,
  discoverOnX,
};
export type EngineServices = typeof defaultServices;

function requireContact(state: AppState, contactId: string): Contact {
  const contact = state.contacts.find((item) => item.id === contactId);
  if (!contact) throw new Error("Contact not found.");
  return contact;
}
function requireDraft(state: AppState, draftId: string): Draft {
  const draft = state.drafts.find((item) => item.id === draftId);
  if (!draft) throw new Error("Draft not found.");
  return draft;
}
function targetFor(state: AppState, contact: Contact): Target {
  const target = state.targets.find((item) => item.id === contact.targetId);
  if (!target) throw new Error("Add a target job before creating outreach.");
  return target;
}
function event(
  state: AppState,
  contactId: string,
  type: AppState["activities"][number]["type"],
  summary: string,
  at = Date.now(),
  eventId?: string,
): void {
  state.activities.unshift({
    id: eventId || id("activity"),
    contactId,
    type,
    summary,
    at,
  });
  state.activities = state.activities.slice(0, 1000);
}
function interval(state: AppState, followUpCount: number): number {
  return state.settings.demoMode
    ? followUpCount === 0
      ? 60_000
      : 120_000
    : (followUpCount === 0 ? 3 : 7) * DAY;
}
function resetUsage(state: AppState, now: number): void {
  if (state.usage.date !== today(now))
    state.usage = { date: today(now), emails: 0, profiles: 0 };
}
/** Fictional people for demo mode's "Find people on X". No X search runs. */
function demoXContacts(target: Target): Contact[] {
  const people = [
    {
      handle: "devon_builds_demo",
      name: "Devon Reyes",
      title: `Engineer at ${target.company} (per their X bio)`,
      reason: `Posts about the systems behind ${target.team || target.role} and answers student questions.`,
      post: "Hot take: the best intern projects are the boring reliability ones. You learn the whole stack.",
      relevance: 88,
    },
    {
      handle: "priya_recruits_demo",
      name: "Priya Shah",
      title: `University recruiting at ${target.company} (per their X bio)`,
      reason: `Shared that ${target.company} is hiring early-career ${target.role} candidates this season.`,
      post: "Early-career apps are open! Tip: a short note about a real project beats a perfect cover letter.",
      relevance: 81,
    },
    {
      handle: "sam_ships_demo",
      name: "Sam Okafor",
      title: `Former ${target.company} engineer (per their X posts)`,
      reason: "Writes threads about breaking into the industry from a non-target background.",
      post: "Thread: 5 things I wish I knew before my first engineering internship.",
      relevance: 70,
    },
  ];
  return people.map((p) => ({
    id: id("demo_contact"),
    targetId: target.id,
    name: p.name,
    title: p.title,
    company: target.company,
    xHandle: p.handle,
    xUrl: `https://x.com/${p.handle}`,
    xPost: { url: `https://x.com/${p.handle}`, excerpt: p.post },
    warmPaths: [],
    relevance: p.relevance,
    reason: p.reason,
    stage: "found" as const,
    followUpCount: 0,
  }));
}

function isDemoContact(contact: Contact): boolean {
  return (
    contact.id.startsWith("demo_") ||
    /@(example\.(com|org|net)|[^@]+\.(example|invalid|test))$/i.test(
      contact.email || "",
    )
  );
}
function requireLiveContact(contact: Contact): void {
  if (isDemoContact(contact))
    throw new Error(
      "This is a fictional demo contact. Add a real contact before using live integrations.",
    );
}

/** Shared gate for email and manual LinkedIn sent events. Editing always returns drafts to pending. */
export function validateSend(state: AppState, draft: Draft): Contact {
  const contact = requireContact(state, draft.contactId);
  if (draft.status !== "approved")
    throw new Error("Approve this exact draft before sending.");
  if (
    state.drafts.some(
      (item) => item.contactId === contact.id && item.status === "sending",
    )
  )
    throw new Error(
      "Reconcile this contact’s unresolved send in Gmail Sent before sending another message.",
    );
  if (
    !draft.body.trim() ||
    /{{[^}]+}}/.test(draft.body + (draft.subject || ""))
  )
    throw new Error("Complete all message placeholders before sending.");
  if (contact.optedOut)
    throw new Error("This contact opted out. Further outreach is stopped.");
  if (
    draft.kind === "follow_up" &&
    (!followUpStages.has(contact.stage) || contact.followUpCount >= 2)
  )
    throw new Error("Follow-ups stop after a reply or two follow-ups.");
  if (draft.kind === "initial" && !initialStages.has(contact.stage))
    throw new Error("Initial outreach was already sent to this contact.");
  if (draft.kind === "schedule_reply" && advancedStages.has(contact.stage))
    throw new Error(
      "This chat is already scheduled or complete. The scheduling draft is obsolete.",
    );
  if (
    draft.kind === "confirmation" &&
    ["met", "thanked"].includes(contact.stage)
  )
    throw new Error(
      "This chat is already complete. The confirmation draft is obsolete.",
    );
  if (draft.channel === "linkedin_connect" && draft.body.length > 300)
    throw new Error(
      "LinkedIn connection notes must be 300 characters or fewer.",
    );
  if (draft.channel === "x" && !contact.xHandle)
    throw new Error("This contact has no X handle. Add one or use another channel.");
  if (draft.channel === "email") {
    if (!contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email))
      throw new Error("Add a valid email address first.");
    if (
      !contact.emailVerified &&
      (contact.emailConfidence ?? 0) < state.settings.emailThreshold
    )
      throw new Error(
        `This email is unverified and below the ${Math.round(state.settings.emailThreshold * 100)}% confidence threshold.`,
      );
    if (state.usage.emails >= Math.min(30, state.settings.dailyEmailLimit))
      throw new Error("Daily email limit reached. Try again tomorrow.");
  }
  if (!state.settings.demoMode) {
    requireLiveContact(contact);
    if (draft.channel === "email" && !state.settings.googleConnected)
      throw new Error("Connect Google in Settings before sending email.");
  }
  return contact;
}

function addDraft(
  state: AppState,
  contact: Contact,
  kind: Draft["kind"],
  output: {
    subject?: string;
    body: string;
    filledKeywords?: Record<string, string>;
    referralAsk?: string;
  },
  channel = state.template.channel,
): Draft {
  if (!output.body?.trim())
    throw new Error("The draft was empty. Try generating it again.");
  const body = channel === "email" ? optOut(output.body) : output.body;
  if (channel === "linkedin_connect" && body.length > 300)
    throw new Error(
      "Generated LinkedIn note exceeded 300 characters. Please shorten the template.",
    );
  const threadSubject =
    channel === "email" && kind !== "initial" && contact.threadId
      ? state.drafts.find(
          (item) =>
            item.contactId === contact.id &&
            item.channel === "email" &&
            item.status === "sent",
        )?.subject
      : undefined;
  const draft: Draft = {
    id: id(state.settings.demoMode ? "demo_draft" : "draft"),
    contactId: contact.id,
    kind,
    channel,
    subject: threadSubject || output.subject,
    body,
    filledKeywords: output.filledKeywords || {},
    status: "pending",
    createdAt: Date.now(),
    referralAsk: output.referralAsk,
  };
  state.drafts.unshift(draft);
  if (kind === "initial" && initialStages.has(contact.stage))
    contact.stage = "drafted";
  event(
    state,
    contact.id,
    "draft_created",
    `${kind === "initial" ? "Outreach" : kind.replaceAll("_", " ")} draft for ${contact.name} is ready for review.`,
  );
  return draft;
}

function markSent(
  state: AppState,
  draft: Draft,
  contact: Contact,
  now: number,
): void {
  draft.status = "sent";
  draft.sentAt = now;
  delete draft.error;
  if (draft.kind === "initial") {
    if (initialStages.has(contact.stage)) {
      contact.stage = "sent";
      contact.nextActionAt = now + interval(state, 0);
    }
  } else if (draft.kind === "follow_up") {
    contact.followUpCount++;
    if (followUpStages.has(contact.stage)) {
      contact.stage = "followed_up";
      contact.nextActionAt = now + interval(state, contact.followUpCount);
    }
  } else if (draft.kind === "thank_you") contact.stage = "thanked";
  const prefix = state.settings.demoMode
    ? "Demo: simulated"
    : draft.channel === "email"
      ? "Sent"
      : "You marked as sent";
  event(
    state,
    contact.id,
    "sent",
    `${prefix} ${draft.kind.replaceAll("_", " ")} ${draft.channel === "email" ? "email" : "LinkedIn note"} for ${contact.name}.${state.settings.demoMode ? " No message was sent." : ""}`,
    now,
  );
}

export async function applyAction(
  input: AppState,
  action: Action,
  services: EngineServices = defaultServices,
  checkpoint: (state: AppState) => Promise<void> = async () => {},
): Promise<ActionResult> {
  let state = structuredClone(input);
  const now = Date.now();
  if (action.type !== "GENERATE_SEARCH_PLAN") resetUsage(state, now);
  let message: string | undefined;
  let data: unknown;
  const ai = <T>(endpoint: string, payload: unknown) =>
    services.aiRequest<T>(endpoint, payload, state.settings);
  const replyCheckFailed = new Set<string>();

  async function recordReply(
    contact: Contact,
    replyText: string,
    replyId?: string,
  ): Promise<void> {
    if (!replyText.trim()) throw new Error("Enter a reply first.");
    if (
      replyId &&
      state.activities.some((item) => item.id === `reply_${replyId}`)
    )
      return;
    // Persist the stop even if optional classification fails.
    if (!advancedStages.has(contact.stage)) contact.stage = "replied";
    delete contact.nextActionAt;
    for (const draft of state.drafts)
      if (
        draft.contactId === contact.id &&
        ["initial", "follow_up"].includes(draft.kind) &&
        ["pending", "approved", "failed"].includes(draft.status)
      )
        draft.status = "rejected";
    event(
      state,
      contact.id,
      "reply_received",
      `${contact.name} replied: ${replyText.slice(0, 260)}`,
      now,
      replyId ? `reply_${replyId}` : undefined,
    );
    await checkpoint(structuredClone(state));
    try {
      const result = await ai<{
        intent: ReplyIntent;
        proposedTimes?: string[];
      }>("/ai/classify-reply", { replyText });
      if (result.intent === "not_interested") {
        contact.optedOut = true;
        for (const draft of state.drafts)
          if (
            draft.contactId === contact.id &&
            ["pending", "approved", "failed"].includes(draft.status)
          )
            draft.status = "rejected";
      }
      if (
        !advancedStages.has(contact.stage) &&
        !state.meetings.some(
          (meeting) =>
            meeting.contactId === contact.id && Date.parse(meeting.end) > now,
        ) &&
        ["interested", "proposes_time", "referral"].includes(result.intent) &&
        !state.drafts.some(
          (item) =>
            item.contactId === contact.id &&
            item.kind === "schedule_reply" &&
            ["pending", "approved", "sending"].includes(item.status),
        )
      ) {
        const reply = await ai<{ body: string }>("/ai/schedule-reply", {
          replyText,
          availability: state.profile.availability,
          proposedTimes: result.proposedTimes,
          contact,
          profile: state.profile,
        });
        addDraft(
          state,
          contact,
          "schedule_reply",
          { ...reply, subject: `Re: Coffee chat with ${state.profile.name}` },
          "email",
        );
      }
    } catch (error) {
      event(
        state,
        contact.id,
        "error",
        `Reply saved and follow-ups stopped. Drafting the scheduling reply failed: ${error instanceof Error ? error.message : "AI unavailable"}`,
      );
    }
  }

  async function pollReplies(): Promise<void> {
    if (state.settings.demoMode) {
      message =
        "Demo mode: use “Simulate reply” on a contact to continue the story.";
      return;
    }
    if (!state.settings.googleConnected) return;
    for (const contact of state.contacts.filter(
      (item) => item.threadId && !item.optedOut && !isDemoContact(item),
    )) {
      try {
        const replies = await services.getThreadReplies(contact.threadId!);
        for (const reply of replies)
          await recordReply(contact, reply.text, reply.id);
      } catch (error) {
        replyCheckFailed.add(contact.id);
        event(
          state,
          contact.id,
          "error",
          `Reply check failed; follow-up paused: ${error instanceof Error ? error.message : "Gmail unavailable"}`,
        );
      }
    }
  }

  async function generatePrep(
    contact: Contact,
    selectedMeeting?: Meeting,
  ): Promise<string> {
    const meeting =
      selectedMeeting ||
      state.meetings.filter((item) => item.contactId === contact.id).at(-1);
    const approved = state.questions.filter(
      (item) => item.status === "approved",
    );
    const previouslyUsed = new Set(
      state.meetings
        .filter(
          (item) =>
            item.id !== meeting?.id &&
            state.contacts.find((person) => person.id === item.contactId)
              ?.company === contact.company,
        )
        .flatMap((item) => item.questionIds),
    );
    const available = approved.filter(
      (question) => !previouslyUsed.has(question.id),
    );
    const brief = await ai<PrepBrief>("/ai/prep-brief", {
      contact,
      target: targetFor(state, contact),
      profile: state.profile,
      approvedBank: available,
      usedQuestionIds: [...previouslyUsed],
    });
    const allowed = new Map(
      available.map((question) => [question.id, question]),
    );
    const picked = brief.picked
      .filter((item) => allowed.has(item.questionId))
      .filter(
        (item, index, all) =>
          all.findIndex((other) => other.questionId === item.questionId) ===
          index,
      )
      .slice(0, 5);
    // A backend cannot smuggle unapproved questions into the approved bank selection.
    for (const question of available)
      if (
        picked.length < 5 &&
        !picked.some((item) => item.questionId === question.id)
      )
        picked.push({ questionId: question.id, tailoredText: question.text });
    const additions =
      picked.length < 5
        ? (brief.newQuestions || []).slice(0, 5 - picked.length)
        : [];
    for (const question of additions)
      if (
        !state.questions.some(
          (item) => item.text.toLowerCase() === question.text.toLowerCase(),
        )
      )
        state.questions.push({
          ...question,
          id: id("question"),
          source: "ai_suggested",
          status: "suggested",
          timesUsed: 0,
        });
    const text = [
      `Coffee chat with ${contact.name}`,
      brief.summary,
      `Shared connection: ${brief.warmPathTalkingPoint || contact.reason}`,
      `Company / role context: ${brief.companyContext}`,
      "Your approved questions:",
      ...picked.map((item, i) => `${i + 1}. ${item.tailoredText}`),
      ...additions.map((item) => `New suggestion (add to bank?): ${item.text}`),
    ]
      .filter(Boolean)
      .join("\n\n");
    if (meeting) {
      if (
        !state.settings.demoMode &&
        !meeting.calendarEventId.startsWith("demo_")
      )
        await services.updateMeetingDescription(meeting.calendarEventId, text);
      for (const pickedQuestion of picked)
        if (!meeting.questionIds.includes(pickedQuestion.questionId))
          allowed.get(pickedQuestion.questionId)!.timesUsed++;
      meeting.prepBrief = text;
      meeting.questionIds = picked.map((item) => item.questionId);
    }
    return text;
  }

  async function queueThankYou(
    contact: Contact,
    includeReferral = true,
  ): Promise<void> {
    if (contact.optedOut) return;
    if (
      state.drafts.some(
        (item) =>
          item.contactId === contact.id &&
          item.kind === "thank_you" &&
          item.status !== "rejected",
      )
    )
      return;
    const result = await ai<{
      subject: string;
      body: string;
      referralAsk?: string;
    }>("/ai/thank-you", {
      contact,
      target: targetFor(state, contact),
      userNotes: contact.notes || "",
      profile: state.profile,
    });
    const body =
      includeReferral && result.referralAsk
        ? `${result.body.trim()}\n\n${result.referralAsk}`
        : result.body;
    addDraft(state, contact, "thank_you", { ...result, body }, "email");
  }

  switch (action.type) {
    case "SAVE_PROFILE":
      if (!action.profile.name.trim())
        throw new Error("Your name is required.");
      state.profile = { ...action.profile };
      message = "Profile saved.";
      break;
    case "SAVE_TEMPLATE":
      if (!action.template.body.trim())
        throw new Error("Write a template first.");
      state.template = { ...action.template };
      message =
        "Template saved. Existing drafts keep their wording until regenerated.";
      break;
    case "UPDATE_SETTINGS":
      state.settings = {
        ...state.settings,
        ...action.settings,
        emailThreshold: Math.max(
          0.8,
          Math.min(
            1,
            action.settings.emailThreshold ?? state.settings.emailThreshold,
          ),
        ),
        dailyEmailLimit: Math.max(
          1,
          Math.min(
            30,
            action.settings.dailyEmailLimit ?? state.settings.dailyEmailLimit,
          ),
        ),
        dailyScrapeLimit: Math.max(
          1,
          Math.min(
            20,
            action.settings.dailyScrapeLimit ?? state.settings.dailyScrapeLimit,
          ),
        ),
      };
      // A stored flag is never sufficient to establish a Google connection.
      if ("googleConnected" in action.settings)
        state.settings.googleConnected = input.settings.googleConnected;
      message = state.settings.demoMode
        ? "Demo mode active. All sends are simulated."
        : "Live mode active. Add real contacts and connect Google to send.";
      break;
    case "PARSE_JOB": {
      if (action.rawDescription.trim().length < 30)
        throw new Error("Paste a job description with at least 30 characters.");
      const parsed = await ai<Omit<Target, "id" | "rawDescription">>(
        "/ai/parse-job",
        { rawDescription: action.rawDescription },
      );
      if (!parsed.company?.trim() || !parsed.role?.trim())
        throw new Error(
          "The job needs a company and role. Add them to the description and try again.",
        );
      const target: Target = {
        ...parsed,
        skills: parsed.skills || [],
        id: id(state.settings.demoMode ? "demo_target" : "target"),
        rawDescription: action.rawDescription,
        url: action.url,
        domain: action.domain || parsed.domain,
      };
      state.targets.push(target);
      data = target;
      message = `${target.company} target added.`;
      break;
    }
    case "GENERATE_SEARCH_PLAN": {
      const target = state.targets.find((item) => item.id === action.targetId);
      if (!target) throw new Error("Select a target job before generating a people search plan.");
      data = await ai<PeopleSearchPlan>("/ai/people-search-plan", {
        profile: state.profile,
        target,
      });
      message = "People search plan ready. Open a query and verify people before importing them.";
      break;
    }
    case "ADD_CONTACT": {
      if (!action.contact.name.trim() || !action.contact.title.trim())
        throw new Error("Name and title are required.");
      if (!state.targets.some((item) => item.id === action.contact.targetId))
        throw new Error("Select a target job first.");
      const existing = state.contacts.find(
        (item) =>
          item.targetId === action.contact.targetId &&
          ((item.email && item.email === action.contact.email) ||
            (item.linkedinUrl &&
              item.linkedinUrl === action.contact.linkedinUrl)),
      );
      if (existing)
        throw new Error(
          "This contact is already on your list for this target.",
        );
      const { name, title, company, targetId } = action.contact;
      const contact: Contact = {
        warmPaths: [],
        relevance: 65,
        reason: "Added by you",
        ...action.contact,
        id: id(state.settings.demoMode ? "demo_contact" : "contact"),
        name: name.trim(),
        title: title.trim(),
        company: company.trim(),
        targetId,
        stage: "found",
        followUpCount: 0,
      };
      // State-machine fields are managed by the engine, never a form payload.
      delete contact.nextActionAt;
      delete contact.threadId;
      if (contact.email) {
        contact.email = contact.email.trim().toLowerCase();
        contact.emailVerified = contact.emailVerified === true;
        contact.emailConfidence = contact.emailVerified
          ? 1
          : Math.min(
              0.5,
              Math.max(
                0,
                Number.isFinite(contact.emailConfidence)
                  ? contact.emailConfidence!
                  : 0.5,
              ),
            );
      }
      state.contacts.push(contact);
      event(
        state,
        contact.id,
        "contact_added",
        `${contact.name} added to ${company}.`,
      );
      message = "Contact added.";
      break;
    }
    case "UPDATE_CONTACT": {
      const contact = requireContact(state, action.contactId);
      if (
        state.drafts.some(
          (draft) =>
            draft.contactId === contact.id && draft.status === "sending",
        )
      )
        throw new Error(
          "Check Gmail Sent and reconcile the unresolved send before changing this recipient.",
        );
      const email =
        action.patch.email === undefined
          ? contact.email
          : action.patch.email.trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error("Enter a valid email address.");
      const recipientChanged = email !== contact.email;
      const verified =
        action.patch.emailVerified === undefined
          ? recipientChanged
            ? false
            : contact.emailVerified === true
          : action.patch.emailVerified === true;
      const verificationChanged = verified !== (contact.emailVerified === true);
      contact.email = email || undefined;
      contact.emailVerified = Boolean(email && verified);
      const requestedConfidence =
        action.patch.emailConfidence ?? contact.emailConfidence ?? 0.5;
      contact.emailConfidence = contact.emailVerified
        ? 1
        : Math.min(
            0.5,
            Math.max(
              0,
              Number.isFinite(requestedConfidence) ? requestedConfidence : 0.5,
            ),
          );
      if (recipientChanged || verificationChanged) {
        for (const draft of state.drafts)
          if (
            draft.contactId === contact.id &&
            ["approved", "failed"].includes(draft.status)
          ) {
            draft.status = "pending";
            delete draft.error;
          }
        if (recipientChanged) delete contact.threadId;
      }
      message =
        recipientChanged || verificationChanged
          ? "Email updated. Review and approve existing drafts again before sending."
          : "Contact email saved.";
      break;
    }
    case "SCRAPE_SEARCH": {
      const target = state.targets.find((item) => item.id === action.targetId);
      if (!target) throw new Error("Select a target job first.");
      if (state.settings.demoMode) {
        const examples = createDemoState(now).contacts;
        const existingNames = new Set(
          state.contacts
            .filter((item) => item.targetId === target.id)
            .map((item) => item.name),
        );
        const additions = examples
          .filter((item) => !existingNames.has(item.name))
          .map((item) => ({
            ...item,
            id: id("demo_contact"),
            targetId: target.id,
            company: target.company,
            stage: "found" as const,
            nextActionAt: undefined,
          }));
        state.contacts.push(...additions);
        message = additions.length
          ? `${additions.length} fictional demo contacts added. No LinkedIn page was read.`
          : "The six demo contacts are already on this target.";
      } else {
        const remaining =
          Math.min(20, state.settings.dailyScrapeLimit) - state.usage.profiles;
        if (remaining <= 0)
          throw new Error(
            "Daily profile limit reached. You can add a contact by hand.",
          );
        const contacts = await services.scrapeSearch(target, state.profile);
        const additions = contacts
          .filter(
            (person) =>
              !state.contacts.some(
                (existing) =>
                  existing.targetId === target.id &&
                  existing.linkedinUrl === person.linkedinUrl,
              ),
          )
          .slice(0, remaining);
        state.contacts.push(...additions);
        state.usage.profiles += additions.length;
        for (const contact of additions)
          event(
            state,
            contact.id,
            "contact_added",
            `${contact.name} imported from your open LinkedIn page.`,
          );
        message = `${additions.length} contacts imported.`;
      }
      break;
    }
    case "FIND_ON_X": {
      const target = state.targets.find((item) => item.id === action.targetId);
      if (!target) throw new Error("Select a target job first.");
      const found = state.settings.demoMode
        ? demoXContacts(target)
        : await services.discoverOnX(target, state.profile, state.settings.backendUrl);
      const additions = found.filter(
        (person) =>
          !state.contacts.some(
            (existing) => existing.targetId === target.id && existing.xHandle === person.xHandle,
          ),
      );
      state.contacts.push(...additions);
      for (const contact of additions)
        event(state, contact.id, "contact_added", `${contact.name} (@${contact.xHandle}) found on X by Grok research.`);
      message = state.settings.demoMode
        ? `${additions.length} fictional X people added. Demo mode: no X search ran.`
        : additions.length
          ? `${additions.length} people found on X, each with the post that makes them relevant.`
          : found.length
            ? "Those people are already on this target."
            : "Grok found no one on X with real evidence for this job. Try a broader posting.";
      break;
    }
    case "GENERATE_DRAFTS": {
      if (!state.profile.name.trim())
        throw new Error(
          "Add your own name in Settings before generating live outreach.",
        );
      let count = 0;
      for (const contactId of [...new Set(action.contactIds)]) {
        const contact = requireContact(state, contactId);
        if (contact.optedOut || !initialStages.has(contact.stage)) continue;
        if (
          state.drafts.some(
            (item) =>
              item.contactId === contact.id &&
              item.kind === "initial" &&
              ["pending", "approved", "sending", "sent"].includes(item.status),
          )
        )
          continue;
        const output = await ai<{
          subject?: string;
          body: string;
          filledKeywords: Record<string, string>;
        }>("/ai/fill-template", {
          template: contact.xHandle ? { ...state.template, channel: "x", subject: undefined } : state.template,
          profile: state.profile,
          target: targetFor(state, contact),
          contact,
        });
        // People found on X get an X draft; everyone else uses the template's channel.
        addDraft(state, contact, "initial", output, contact.xHandle ? "x" : state.template.channel);
        count++;
      }
      message = count
        ? `${count} ${count === 1 ? "draft is" : "drafts are"} ready for approval.`
        : "Those contacts already have outreach drafts or have already been contacted.";
      break;
    }
    case "UPDATE_DRAFT": {
      const draft = requireDraft(state, action.draftId);
      if (["sent", "sending"].includes(draft.status))
        throw new Error(
          "Sent or unresolved messages cannot be edited. Check Gmail Sent first.",
        );
      if (!action.body.trim()) throw new Error("The message cannot be empty.");
      draft.body =
        draft.channel === "email" ? optOut(action.body) : action.body;
      if (action.subject !== undefined) draft.subject = action.subject;
      draft.status = "pending";
      delete draft.error;
      message = "Draft saved. Review and approve the updated wording.";
      break;
    }
    case "REGENERATE_DRAFT": {
      const draft = requireDraft(state, action.draftId);
      if (["sent", "sending"].includes(draft.status))
        throw new Error(
          "Sent or unresolved messages cannot be regenerated. Check Gmail Sent first.",
        );
      const contact = requireContact(state, draft.contactId);
      const output =
        draft.kind === "initial"
          ? await ai<{
              subject?: string;
              body: string;
              filledKeywords?: Record<string, string>;
            }>("/ai/fill-template", {
              template: { ...state.template, channel: draft.channel },
              profile: state.profile,
              target: targetFor(state, contact),
              contact,
            })
          : draft.kind === "thank_you"
            ? await ai<{ subject?: string; body: string }>("/ai/thank-you", {
                contact,
                target: targetFor(state, contact),
                userNotes: contact.notes || "",
                profile: state.profile,
              })
            : draft.kind === "schedule_reply"
              ? await ai<{ subject?: string; body: string }>(
                  "/ai/schedule-reply",
                  {
                    replyText:
                      state.activities.find(
                        (item) =>
                          item.contactId === contact.id &&
                          item.type === "reply_received",
                      )?.summary || draft.body,
                    contact,
                    availability: state.profile.availability,
                    profile: state.profile,
                  },
                )
              : draft.kind === "confirmation"
                ? { subject: draft.subject, body: draft.body }
                : await ai<{ subject?: string; body: string }>(
                    "/ai/follow-up",
                    {
                      originalDraft: draft,
                      contact,
                      followUpCount: contact.followUpCount,
                      daysSince: 3,
                      profile: state.profile,
                    },
                  );
      if (!output.body?.trim()) throw new Error("Generated draft was empty.");
      draft.body =
        draft.channel === "email" ? optOut(output.body) : output.body;
      if (draft.kind === "initial" || !contact.threadId)
        draft.subject = output.subject || draft.subject;
      if ("filledKeywords" in output && output.filledKeywords)
        draft.filledKeywords = output.filledKeywords as Record<string, string>;
      draft.status = "pending";
      delete draft.error;
      message = "Draft regenerated. Review it before approving.";
      break;
    }
    case "APPROVE_DRAFT": {
      const draft = requireDraft(state, action.draftId);
      if (!["pending", "failed"].includes(draft.status))
        throw new Error("Only a pending or failed draft can be approved.");
      if (
        !draft.body.trim() ||
        /{{[^}]+}}/.test(draft.body + (draft.subject || ""))
      )
        throw new Error("Complete every placeholder before approving.");
      if (draft.channel === "linkedin_connect" && draft.body.length > 300)
        throw new Error("Connection notes must be 300 characters or fewer.");
      if (requireContact(state, draft.contactId).optedOut)
        throw new Error("This contact opted out. Further outreach is stopped.");
      draft.status = "approved";
      delete draft.error;
      event(
        state,
        draft.contactId,
        "approved",
        `You approved the ${draft.kind.replaceAll("_", " ")} draft.`,
      );
      message = "Approved. Choose Send when you are ready.";
      break;
    }
    case "REJECT_DRAFT": {
      const draft = requireDraft(state, action.draftId);
      if (["sent", "sending"].includes(draft.status))
        throw new Error(
          "A sent or unresolved message cannot be rejected. Check Gmail Sent first.",
        );
      draft.status = "rejected";
      if (draft.kind === "follow_up")
        delete requireContact(state, draft.contactId).nextActionAt;
      message = "Draft skipped.";
      break;
    }
    case "SEND_EMAIL": {
      const draft = requireDraft(state, action.draftId);
      if (draft.channel !== "email")
        throw new Error("Use the LinkedIn workflow for this draft.");
      const contact = validateSend(state, draft);
      if (!state.settings.demoMode && draft.kind === "follow_up") {
        if (!contact.threadId) {
          draft.status = "pending";
          message =
            "This follow-up has no confirmed Gmail thread to check for replies. Nothing was sent.";
          break;
        }
        try {
          const replies = await services.getThreadReplies(contact.threadId);
          for (const reply of replies)
            await recordReply(contact, reply.text, reply.id);
          if (replies.length || !followUpStages.has(contact.stage)) {
            // Return normally so the reply and cancelled follow-up persist before UI notification.
            message =
              "A reply arrived. This follow-up was cancelled and nothing was sent.";
            break;
          }
        } catch (error) {
          draft.status = "pending";
          event(
            state,
            contact.id,
            "error",
            `Follow-up was not sent because its reply check failed: ${error instanceof Error ? error.message : "Gmail unavailable"}`,
          );
          message =
            "Reply check failed. Nothing was sent. Check Gmail, then review and approve again.";
          break;
        }
      }
      if (!state.settings.demoMode) {
        // Persist intent before an external side effect. A stopped worker leaves an un-sendable
        // 'sending' record that the user must reconcile against Gmail Sent before another attempt.
        draft.status = "sending";
        draft.error =
          "Delivery status is unresolved. Check Gmail Sent before trying again.";
        state.usage.emails++;
        await checkpoint(structuredClone(state));
      }
      try {
        if (!state.settings.demoMode) {
          const sent = await services.sendEmail({
            to: contact.email!,
            subject: draft.subject || "Coffee chat",
            body: draft.body,
            threadId: contact.threadId,
          });
          contact.threadId = sent.threadId;
        }
        markSent(state, draft, contact, now);
        message = state.settings.demoMode
          ? "Demo send simulated. No email was sent."
          : `Email sent to ${contact.name}.`;
      } catch (error) {
        draft.status = "failed";
        draft.error = `Delivery was not confirmed. Check Gmail Sent before retrying. ${error instanceof Error ? error.message : "Email failed."}`;
        event(state, contact.id, "error", `Email failed: ${draft.error}`);
        // Return the failed state so the UI can explain recovery; no automatic retry.
        message = `Email failed: ${draft.error}. Review and approve again to retry.`;
      }
      break;
    }
    case "RESOLVE_SEND": {
      const draft = requireDraft(state, action.draftId);
      if (draft.status !== "sending")
        throw new Error("Only an unresolved send can be reconciled.");
      const contact = requireContact(state, draft.contactId);
      if (action.sent) {
        markSent(state, draft, contact, now);
        // The Gmail thread ID was not confirmed. Keep any existing mapping; do not guess one.
        if (
          !state.settings.demoMode &&
          draft.channel === "email" &&
          !contact.threadId
        ) {
          delete contact.nextActionAt;
          event(
            state,
            contact.id,
            "error",
            "Delivery confirmed by you, but automatic follow-ups are paused because the Gmail thread ID was not confirmed.",
          );
        }
        message =
          "Delivery recorded from your Gmail Sent check. No new email was sent.";
      } else {
        draft.status = "pending";
        delete draft.error;
        message =
          "Returned to review after your Gmail Sent check. Approve again before sending.";
      }
      break;
    }
    case "FILL_LINKEDIN": {
      const draft = requireDraft(state, action.draftId);
      if (draft.channel === "email") throw new Error("This draft is an email.");
      if (draft.channel === "x") throw new Error("Copy this message and send it on X yourself.");
      const contact = validateSend(state, draft);
      if (!state.settings.demoMode) await services.fillLinkedIn(contact, draft);
      message = state.settings.demoMode
        ? "Demo: note ready. No LinkedIn page was changed. Use Mark sent to simulate your Send click."
        : "The LinkedIn note is filled. Review it and click Send on LinkedIn, then Mark sent here.";
      break;
    }
    case "MARK_SENT": {
      const draft = requireDraft(state, action.draftId);
      if (draft.channel === "email")
        throw new Error("Emails are sent through the approved Gmail action.");
      const contact = validateSend(state, draft);
      markSent(state, draft, contact, now);
      const where = draft.channel === "x" ? "X" : "LinkedIn";
      message = state.settings.demoMode
        ? `Demo ${where} send simulated. No message was sent.`
        : `Your manual ${where} send was recorded.`;
      break;
    }
    case "POLL_REPLIES":
      await pollReplies();
      message ||= "Replies checked. Follow-ups stop when a reply arrives.";
      break;
    case "RECORD_REPLY":
      await recordReply(
        requireContact(state, action.contactId),
        action.replyText,
      );
      message = "Reply recorded. Follow-ups stopped.";
      break;
    case "CREATE_MEETING": {
      const contact = requireContact(state, action.contactId);
      if (contact.optedOut) throw new Error("This contact opted out.");
      if (
        !Number.isFinite(Date.parse(action.start)) ||
        !Number.isFinite(Date.parse(action.end)) ||
        Date.parse(action.end) <= Date.parse(action.start)
      )
        throw new Error("Choose a valid meeting start and end time.");
      if (Date.parse(action.start) < now)
        throw new Error("Choose a meeting time in the future.");
      if (
        state.meetings.some(
          (item) =>
            item.contactId === contact.id && item.start === action.start,
        )
      )
        throw new Error("This meeting is already on your calendar.");
      if (!state.settings.demoMode) {
        requireLiveContact(contact);
        if (!state.settings.googleConnected)
          throw new Error("Connect Google to create a calendar invitation.");
        if (
          !contact.email ||
          (!contact.emailVerified &&
            (contact.emailConfidence ?? 0) < state.settings.emailThreshold)
        )
          throw new Error(
            "A confirmed contact email is required for a calendar invitation.",
          );
      }
      const created = state.settings.demoMode
        ? { id: id("demo_event") }
        : await services.createMeeting({
            contact,
            start: action.start,
            end: action.end,
            description: `Coffee chat about ${targetFor(state, contact).role}.`,
          });
      const meeting: Meeting = {
        id: id("meeting"),
        contactId: contact.id,
        start: action.start,
        end: action.end,
        calendarEventId: created.id,
        meetLink: "meetLink" in created ? created.meetLink : undefined,
        questionIds: [],
      };
      state.meetings.push(meeting);
      contact.stage = "scheduled";
      delete contact.nextActionAt;
      for (const draft of state.drafts)
        if (
          draft.contactId === contact.id &&
          ["initial", "follow_up", "schedule_reply"].includes(draft.kind) &&
          ["pending", "approved", "failed"].includes(draft.status)
        )
          draft.status = "rejected";
      event(
        state,
        contact.id,
        "meeting_scheduled",
        `${state.settings.demoMode ? "Demo: simulated" : "Created"} coffee chat with ${contact.name} for ${new Date(action.start).toLocaleString()}.`,
      );
      addDraft(
        state,
        contact,
        "confirmation",
        {
          subject: `Coffee chat confirmed: ${state.profile.name} + ${contact.name}`,
          body: `Hi ${contact.name.split(" ")[0]},\n\nLooking forward to our coffee chat on ${new Date(action.start).toLocaleString()}.${meeting.meetLink ? `\n\nJoin here: ${meeting.meetLink}` : ""}\n\nThanks,\n${state.profile.name}`,
        },
        "email",
      );
      try {
        await generatePrep(contact, meeting);
      } catch (error) {
        event(
          state,
          contact.id,
          "error",
          `Meeting saved. Generate the prep brief when AI is available: ${error instanceof Error ? error.message : "AI unavailable"}`,
        );
      }
      data = meeting;
      message = state.settings.demoMode
        ? "Demo meeting created. No calendar invitation was sent. Confirmation draft is ready for review."
        : "Calendar invitation created. Review the confirmation email.";
      break;
    }
    case "SUGGEST_QUESTIONS": {
      const result = await ai<{
        questions: { text: string; category: Question["category"] }[];
      }>("/ai/suggest-questions", {
        profile: state.profile,
        targets: state.targets,
        existingBank: state.questions,
      });
      let count = 0;
      for (const question of result.questions)
        if (
          question.text.trim() &&
          !state.questions.some(
            (existing) =>
              existing.text.trim().toLowerCase() ===
              question.text.trim().toLowerCase(),
          )
        ) {
          state.questions.push({
            ...question,
            id: id("question"),
            source: "ai_suggested",
            status: "suggested",
            timesUsed: 0,
          });
          count++;
        }
      message = `${count} new question suggestions. Add the ones you like to your bank.`;
      break;
    }
    case "UPDATE_QUESTION": {
      if (!action.question.text.trim())
        throw new Error("Write a question first.");
      const index = state.questions.findIndex(
        (item) => item.id === action.question.id,
      );
      if (index >= 0) state.questions[index] = { ...action.question };
      else
        state.questions.push({
          ...action.question,
          id: action.question.id || id("question"),
          source: "user_written",
          timesUsed: 0,
        });
      message =
        action.question.status === "approved"
          ? "Question added to your bank."
          : "Question updated.";
      break;
    }
    case "GENERATE_PREP_BRIEF":
      data = await generatePrep(requireContact(state, action.contactId));
      message = "Prep brief ready, using your approved question bank first.";
      break;
    case "SAVE_MEETING_NOTES": {
      const contact = requireContact(state, action.contactId);
      if (!action.notes.trim())
        throw new Error("Add a note about your conversation first.");
      contact.notes = action.notes.trim();
      if (contact.stage !== "thanked") contact.stage = "met";
      delete contact.nextActionAt;
      for (const draft of state.drafts)
        if (
          draft.contactId === contact.id &&
          ["initial", "follow_up", "schedule_reply", "confirmation"].includes(
            draft.kind,
          ) &&
          ["pending", "approved", "failed"].includes(draft.status)
        )
          draft.status = "rejected";
      event(
        state,
        contact.id,
        "notes_saved",
        `Notes saved for your chat with ${contact.name}.`,
      );
      try {
        await queueThankYou(contact, action.includeReferral !== false);
        message = "Notes saved. Your thank-you draft is ready for review.";
      } catch (error) {
        event(
          state,
          contact.id,
          "error",
          `Notes saved. Thank-you drafting failed: ${error instanceof Error ? error.message : "AI unavailable"}`,
        );
        message =
          "Notes saved. Thank-you drafting is unavailable; try again when AI is connected.";
      }
      break;
    }
    case "RUN_SCHEDULER": {
      const tick = state.settings.demoMode ? (action.now ?? now) : now;
      await pollReplies();
      let queued = 0;
      for (const contact of state.contacts) {
        if (
          !followUpStages.has(contact.stage) ||
          contact.optedOut ||
          replyCheckFailed.has(contact.id) ||
          !contact.nextActionAt ||
          contact.nextActionAt > tick
        )
          continue;
        if (
          state.drafts.some(
            (draft) =>
              draft.contactId === contact.id &&
              draft.kind === "follow_up" &&
              ["pending", "approved", "sending", "failed"].includes(
                draft.status,
              ),
          )
        )
          continue;
        if (contact.followUpCount >= 2) {
          contact.stage = "cold";
          delete contact.nextActionAt;
          continue;
        }
        if (!state.settings.demoMode && isDemoContact(contact)) continue;
        const originalDraft = state.drafts.find(
          (draft) =>
            draft.contactId === contact.id &&
            draft.kind === "initial" &&
            draft.status === "sent",
        );
        if (!originalDraft) continue;
        if (
          !state.settings.demoMode &&
          originalDraft.channel === "email" &&
          !contact.threadId
        )
          continue;
        try {
          const result = await ai<{ subject?: string; body: string }>(
            "/ai/follow-up",
            {
              originalDraft,
              contact,
              followUpCount: contact.followUpCount,
              daysSince: Math.floor(
                (tick - (originalDraft.sentAt || originalDraft.createdAt)) /
                  DAY,
              ),
              profile: state.profile,
            },
          );
          addDraft(state, contact, "follow_up", result, originalDraft.channel);
          event(
            state,
            contact.id,
            "follow_up_due",
            `Follow-up ${contact.followUpCount + 1} for ${contact.name} is waiting for approval.`,
            tick,
          );
          queued++;
        } catch (error) {
          event(
            state,
            contact.id,
            "error",
            `Could not prepare follow-up: ${error instanceof Error ? error.message : "AI unavailable"}`,
          );
        }
      }
      for (const meeting of state.meetings) {
        const contact = requireContact(state, meeting.contactId);
        if (!state.settings.demoMode && isDemoContact(contact)) continue;
        const start = Date.parse(meeting.start),
          end = Date.parse(meeting.end);
        if (end <= tick && contact.stage === "scheduled") {
          contact.stage = "met";
          event(
            state,
            contact.id,
            "notes_saved",
            `Your chat with ${contact.name} ended. Add notes to personalize a thank-you.`,
            tick,
          );
        }
        if (!meeting.prepBrief && start > tick && start - tick < DAY) {
          try {
            await generatePrep(contact, meeting);
          } catch (error) {
            event(
              state,
              contact.id,
              "error",
              `Prep brief unavailable: ${error instanceof Error ? error.message : "AI unavailable"}`,
            );
          }
        }
        if (
          contact.stage === "met" &&
          (Boolean(contact.notes) || end + 2 * 3_600_000 <= tick)
        ) {
          try {
            await queueThankYou(contact);
          } catch (error) {
            event(
              state,
              contact.id,
              "error",
              `Thank-you draft unavailable: ${error instanceof Error ? error.message : "AI unavailable"}`,
            );
          }
        }
      }
      message = `${queued} follow-up ${queued === 1 ? "draft" : "drafts"} queued for approval. Nothing was automatically sent.`;
      break;
    }
    case "CONNECT_GOOGLE":
      if (state.settings.demoMode) {
        message =
          "Switch to Live mode in Settings to connect a real Google account. Demo mode never opens OAuth.";
      } else {
        const account = await services.connectGoogle();
        state.settings.googleConnected = true;
        message = `Google connected${account.email ? ` as ${account.email}` : ""}.`;
      }
      break;
    case "RESET_DEMO":
      if (!state.settings.demoMode)
        throw new Error(
          "Switch to Demo mode before resetting demo data. Your live workspace was preserved.",
        );
      state = createDemoState(now);
      message =
        "Demo reset. All contacts and messages are fictional. No emails will be sent.";
      break;
    default: {
      const exhaustive: never = action;
      throw new Error(`Unknown action: ${String((exhaustive as Action).type)}`);
    }
  }
  return { state, message, data };
}

// Every panel and alarm enters this queue in the background, preventing lost updates.
let actionQueue: Promise<unknown> = Promise.resolve();
export function executeAction(action: Action): Promise<ActionResult> {
  const next = actionQueue.then(async () => {
    const run = async () => {
      const state = await getState();
      if (
        action.type === "UPDATE_SETTINGS" &&
        action.settings.demoMode !== undefined &&
        action.settings.demoMode !== state.settings.demoMode
      ) {
        // Apply any other settings to the outgoing workspace, then load the saved destination.
        const updated = await applyAction(state, {
          type: "UPDATE_SETTINGS",
          settings: { ...action.settings, demoMode: state.settings.demoMode },
        });
        const nextState = await switchMode(
          updated.state,
          action.settings.demoMode,
        );
        return {
          state: nextState,
          message: nextState.settings.demoMode
            ? "Demo workspace restored. All sends are simulated."
            : "Live workspace restored. Demo contacts and activity are kept separately.",
        };
      }
      const result = await applyAction(
        state,
        action,
        defaultServices,
        saveState,
      );
      await saveState(result.state);
      return result;
    };
    // Browser previews may be open in several tabs. Web Locks also serialize those writers.
    if (typeof navigator !== "undefined" && navigator.locks)
      return navigator.locks.request("coffee-chat-copilot-action", run);
    return run();
  });
  actionQueue = next.catch(() => undefined);
  return next;
}
