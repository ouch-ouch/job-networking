import type { AppState, Contact, Draft, Question } from "./types";

export const DEFAULT_TEMPLATE = {
  id: "default",
  name: "My coffee chat note",
  channel: "email" as const,
  subject: "{{my_school}} student curious about {{company}}",
  body: "Hi {{first_name}},\n\nI'm {{my_name}}, a {{my_year}} at {{my_school}} studying {{my_major}}. I'm exploring the {{role}} role at {{company}} and came across your work as {{their_title}}. {{personal_hook}}\n\nWould you be open to a 15-minute coffee chat? {{my_availability}}\n\nThanks,\n{{my_name}}",
};

export function createDemoState(now = Date.now()): AppState {
  const contact = (
    id: string,
    name: string,
    title: string,
    stage: Contact["stage"],
    relevance: number,
    reason: string,
    alumni = false,
  ): Contact => ({
    id: `demo_${id}`,
    targetId: "demo_target",
    name,
    title,
    company: "Stripe",
    email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
    emailConfidence: 0.92,
    emailVerified: false,
    linkedinUrl:
      "https://www.linkedin.com/search/results/people/?keywords=" +
      encodeURIComponent(name + " Stripe"),
    connectionDegree: alumni ? 2 : 3,
    warmPaths: alumni
      ? [{ type: "alumni", detail: "NYU alumni (fictional demo profile)" }]
      : [],
    relevance,
    reason,
    stage,
    followUpCount: 0,
  });
  const contacts: Contact[] = [
    contact(
      "maya",
      "Maya Patel",
      "Software Engineer, Payments",
      "drafted",
      97,
      "NYU alum · works on payments infrastructure",
      true,
    ),
    contact(
      "daniel",
      "Daniel Kim",
      "Engineering Manager, Payments",
      "drafted",
      93,
      "NYU alum · leads the team you are exploring",
      true,
    ),
    contact(
      "sofia",
      "Sofia Rivera",
      "Developer Experience Engineer",
      "found",
      87,
      "Developer tools experience matches your background",
    ),
    contact(
      "jordan",
      "Jordan Brooks",
      "Product Engineer, Billing",
      "sent",
      84,
      "Building APIs used by growing businesses",
    ),
    contact(
      "avery",
      "Avery Thompson",
      "University Recruiter",
      "found",
      79,
      "Can offer perspective on the early-career process",
    ),
    contact(
      "leo",
      "Leo Nguyen",
      "Senior Software Engineer",
      "scheduled",
      91,
      "NYU alum · coffee chat scheduled",
      true,
    ),
  ];
  contacts[3].nextActionAt = now + 60_000;
  const draft = (
    id: string,
    contactId: string,
    firstName: string,
    status: Draft["status"],
  ): Draft => ({
    id: `demo_draft_${id}`,
    contactId: `demo_${contactId}`,
    kind: "initial",
    channel: "email",
    subject: "NYU student curious about payments at Stripe",
    body: `Hi ${firstName},\n\nI'm Alex Chen, a master's student at NYU studying Computer Science. I saw Stripe is hiring for Software Engineer, New Grad and noticed you work on payments. ${firstName === "Maya" || firstName === "Daniel" ? "As a fellow member of the NYU community, I would love to hear how you found your path into the team." : "I am building API projects and would love to learn more about your work."}\n\nWould you be open to a 15-minute coffee chat? I'm available weekdays 2–5 pm ET.\n\nThanks,\nAlex\n\nIf you'd prefer no follow-ups, just let me know.`,
    filledKeywords: {
      first_name: firstName,
      company: "Stripe",
      role: "Software Engineer, New Grad",
      their_team: "payments",
      personal_hook: "A shared NYU connection.",
    },
    status,
    createdAt: now - 30 * 60_000,
    ...(status === "sent" ? { sentAt: now - 3 * 86_400_000 } : {}),
  });
  const questions: Question[] = [
    {
      id: "demo_q1",
      text: "What does a typical week look like for an engineer on your team?",
      category: "role",
      status: "approved",
      source: "user_written",
      timesUsed: 0,
    },
    {
      id: "demo_q2",
      text: "Which technical problems is your team most focused on right now?",
      category: "team",
      status: "approved",
      source: "ai_suggested",
      timesUsed: 0,
    },
    {
      id: "demo_q3",
      text: "How did your time at NYU shape your first career decisions?",
      category: "career_path",
      status: "approved",
      source: "user_written",
      timesUsed: 0,
    },
    {
      id: "demo_q4",
      text: "What helped you stand out during the early-career recruiting process?",
      category: "recruiting",
      status: "approved",
      source: "ai_suggested",
      timesUsed: 0,
    },
    {
      id: "demo_q5",
      text: "What would you focus on learning if you were in my position?",
      category: "advice",
      status: "approved",
      source: "ai_suggested",
      timesUsed: 0,
    },
    {
      id: "demo_q6",
      text: "How do engineers collaborate with product and design on your team?",
      category: "culture",
      status: "suggested",
      source: "ai_suggested",
      timesUsed: 0,
    },
    {
      id: "demo_q7",
      text: "What surprised you most when you joined the company?",
      category: "career_path",
      status: "suggested",
      source: "ai_suggested",
      timesUsed: 0,
    },
    {
      id: "demo_q8",
      text: "How does your team balance reliability with shipping new features?",
      category: "team",
      status: "suggested",
      source: "ai_suggested",
      timesUsed: 0,
    },
  ];
  const tomorrow = new Date(now + 25 * 3_600_000);
  tomorrow.setMinutes(0, 0, 0);
  return {
    version: 1,
    profile: {
      name: "Alex Chen",
      school: "NYU",
      major: "Computer Science",
      year: "master's student",
      background:
        "Building useful tools with TypeScript and Python. Interested in developer experience, reliable APIs, and payments.",
      availability: "Weekdays 2–5 pm ET",
      signature: "Alex Chen | NYU",
    },
    template: { ...DEFAULT_TEMPLATE },
    targets: [
      {
        id: "demo_target",
        company: "Stripe",
        role: "Software Engineer, New Grad",
        team: "Payments",
        location: "New York, NY",
        skills: ["TypeScript", "APIs", "Distributed systems"],
        domain: "stripe.com",
        rawDescription:
          "DEMO JOB: Stripe is hiring a Software Engineer, New Grad in New York to build reliable payments APIs. Work with TypeScript and distributed systems on the Payments team. This job and all contacts in the demo are illustrative.",
      },
    ],
    contacts,
    drafts: [
      draft("maya", "maya", "Maya", "pending"),
      draft("daniel", "daniel", "Daniel", "pending"),
      draft("jordan", "jordan", "Jordan", "sent"),
      draft("leo", "leo", "Leo", "sent"),
    ],
    activities: [
      {
        id: "demo_a1",
        contactId: "demo_leo",
        at: now - 10 * 60_000,
        type: "meeting_scheduled",
        summary: "Demo coffee chat with Leo scheduled for tomorrow.",
      },
      {
        id: "demo_a2",
        contactId: "demo_maya",
        at: now - 20 * 60_000,
        type: "draft_created",
        summary: "A personalized note for Maya is ready for your review.",
      },
      {
        id: "demo_a3",
        contactId: "demo_jordan",
        at: now - 3 * 86_400_000,
        type: "sent",
        summary: "Demo email simulated for Jordan. No email was sent.",
      },
    ],
    meetings: [
      {
        id: "demo_meeting",
        contactId: "demo_leo",
        start: tomorrow.toISOString(),
        end: new Date(tomorrow.getTime() + 15 * 60_000).toISOString(),
        calendarEventId: "demo_event",
        questionIds: [],
      },
    ],
    questions,
    settings: {
      demoMode: true,
      backendUrl: "http://127.0.0.1:8787",
      googleConnected: false,
      emailThreshold: 0.8,
    },
    usage: {
      date: new Date(now).toISOString().slice(0, 10),
      emails: 0,
      profiles: 0,
    },
  };
}

export const mockState = createDemoState();
