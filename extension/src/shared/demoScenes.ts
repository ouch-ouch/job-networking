// Presentation scenes for demo mode. Each scene is built by running the app's own
// actions on the fictional demo data, so what you see on stage is exactly what the
// app would produce. Nothing here sends anything: demo mode simulates every send.
import { createDemoState, demoXContacts } from "./mock";
import type { Action, ActionResult, AppState, DemoSceneId } from "./types";

export const DEMO_SCENES: { id: DemoSceneId; title: string; shows: string }[] = [
  {
    id: "start",
    title: "Start",
    shows: "Profile, template, and question bank are set up. No job yet: paste the sample posting.",
  },
  {
    id: "people",
    title: "People found",
    shows: "Stripe job added. 6 people from LinkedIn and 3 from X, ranked. Drafts waiting for approval.",
  },
  {
    id: "reply",
    title: "A reply came in",
    shows: "Maya's email went out and she replied “Thursday at 3pm?”. A scheduling reply is waiting.",
  },
  {
    id: "chat",
    title: "Chat scheduled",
    shows: "Coffee chat with Maya booked, 3 questions picked from the bank, prep brief ready.",
  },
  {
    id: "after",
    title: "After the chat",
    shows: "The chat with Maya just ended. Add notes to get a thank-you and referral ask.",
  },
];

/** Paste this into "Add a target" during the demo. The demo parser reads the labeled lines. */
export const SAMPLE_JOB_POSTING = `Company: Stripe
Role: Software Engineer, New Grad
Location: New York, NY

Stripe is hiring new grad engineers to join the Payments team in New York. You'll build reliable payments APIs used by millions of businesses, working in TypeScript and Ruby on distributed systems.

What you'll bring: a BS/MS in Computer Science or related field, experience with TypeScript or another typed language, curiosity about how money moves on the internet.`;

type Apply = (state: AppState, action: Action) => Promise<ActionResult>;

/** Thursday at 3pm local time, at least two days out, so it reads as "this week or next". */
function nextThursdayAt3(now: number): { start: string; end: string } {
  const d = new Date(now + 2 * 86_400_000);
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7));
  d.setHours(15, 0, 0, 0);
  return { start: d.toISOString(), end: new Date(d.getTime() + 20 * 60_000).toISOString() };
}

export async function buildDemoScene(id: DemoSceneId, now: number, apply: Apply): Promise<AppState> {
  let s = createDemoState(now);
  const step = async (action: Action) => {
    s = (await apply(s, action)).state;
  };

  if (id === "start")
    return { ...s, targets: [], contacts: [], drafts: [], activities: [], meetings: [] };

  // People found: the seeded LinkedIn people plus three found on X, one X draft waiting.
  s.contacts.push(...demoXContacts(s.targets[0]));
  const firstX = s.contacts.find((c) => c.xHandle)!;
  await step({ type: "GENERATE_DRAFTS", contactIds: [firstX.id] });
  if (id === "people") return s;

  // A reply came in: Maya's email is approved and sent, and she answers with a time.
  await step({ type: "APPROVE_DRAFT", draftId: "demo_draft_maya" });
  await step({ type: "SEND_EMAIL", draftId: "demo_draft_maya" });
  await step({
    type: "RECORD_REPLY",
    contactId: "demo_maya",
    replyText: "Hi Alex! Happy to chat. Does Thursday at 3pm ET work for you?",
  });
  if (id === "reply") return s;

  // Chat scheduled: booked for Thursday 3pm with three questions from the bank.
  await step({ type: "CREATE_MEETING", contactId: "demo_maya", ...nextThursdayAt3(now) });
  const meeting = s.meetings.find((m) => m.contactId === "demo_maya")!;
  await step({ type: "SET_CHAT_QUESTIONS", meetingId: meeting.id, questionIds: ["demo_q1", "demo_q2", "demo_q3"] });
  await step({ type: "GENERATE_PREP_BRIEF", contactId: "demo_maya" });
  if (id === "chat") return s;

  // After the chat: it ended an hour ago; the scheduler marks it met and asks how it went.
  const m = s.meetings.find((item) => item.contactId === "demo_maya")!;
  m.start = new Date(now - 80 * 60_000).toISOString();
  m.end = new Date(now - 60 * 60_000).toISOString();
  await step({ type: "RUN_SCHEDULER", now });
  return s;
}
