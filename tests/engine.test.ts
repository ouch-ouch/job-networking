import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  executeAction,
  validateSend,
  type EngineServices,
} from "../extension/src/shared/engine";
import { createDemoState } from "../extension/src/shared/mock";
import type { AppState, Contact } from "../extension/src/shared/types";
import { getState, saveState } from "../extension/src/shared/storage";

function harness() {
  const calls = { emails: 0, linkedin: 0, calendar: 0, ai: 0 };
  const services: EngineServices = {
    aiRequest: async <T>(endpoint: string): Promise<T> => {
      calls.ai++;
      const answers: Record<string, unknown> = {
        "/ai/fill-template": {
          subject: "Coffee chat",
          body: "Hello from NYU.",
          filledKeywords: {},
        },
        "/ai/follow-up": {
          subject: "Following up",
          body: "Hi! Following up on my coffee chat note.",
        },
        "/ai/classify-reply": { intent: "interested" },
        "/ai/schedule-reply": { body: "Thanks! Would Tuesday at 3 pm work?" },
        "/ai/thank-you": {
          subject: "Thank you",
          body: "Thanks for chatting.",
          referralAsk: "Could you share advice on applying?",
        },
        "/ai/prep-brief": {
          summary: "A useful conversation.",
          warmPathTalkingPoint: "NYU",
          companyContext: "Payments",
          picked: [
            {
              questionId: "demo_q6",
              tailoredText: "DO NOT INCLUDE UNAPPROVED",
            },
          ],
        },
      };
      return answers[endpoint] as T;
    },
    connectGoogle: async () => ({ email: "me@real-company.com" }),
    sendEmail: async () => {
      calls.emails++;
      return { id: "message", threadId: "thread" };
    },
    getThreadReplies: async () => [],
    createMeeting: async () => {
      calls.calendar++;
      return {
        id: "calendar-event",
        meetLink: "https://meet.google.com/example",
      };
    },
    updateMeetingDescription: async () => {},
    scrapeSearch: async () => [],
    fillLinkedIn: async () => {
      calls.linkedin++;
    },
    discoverOnX: async () => ({ contacts: [], status: "succeeded" }),
  };
  return { services, calls };
}

function liveState(): AppState {
  const state = createDemoState();
  state.settings.demoMode = false;
  state.settings.googleConnected = true;
  state.contacts[0].id = "real_contact";
  state.contacts[0].email = "maya@real-company.com";
  state.drafts[0].contactId = "real_contact";
  return state;
}

test("sending requires approval of the current wording and editing revokes approval", async () => {
  const { services, calls } = harness();
  let state = createDemoState();
  const draftId = state.drafts[0].id;
  await assert.rejects(
    applyAction(state, { type: "SEND_EMAIL", draftId }, services),
    /Approve this exact draft/,
  );
  state = (
    await applyAction(state, { type: "APPROVE_DRAFT", draftId }, services)
  ).state;
  assert.equal(state.drafts[0].status, "approved");
  state = (
    await applyAction(
      state,
      { type: "UPDATE_DRAFT", draftId, body: "Edited after approval." },
      services,
    )
  ).state;
  assert.equal(state.drafts[0].status, "pending");
  assert.match(state.drafts[0].body, /no follow-ups/);
  await assert.rejects(
    applyAction(state, { type: "SEND_EMAIL", draftId }, services),
    /Approve this exact draft/,
  );
  assert.equal(calls.emails, 0);
});

test("demo sends are explicitly simulated and never call live integrations", async () => {
  const { services, calls } = harness();
  let state = createDemoState();
  const draftId = state.drafts[0].id;
  state = (
    await applyAction(state, { type: "APPROVE_DRAFT", draftId }, services)
  ).state;
  const result = await applyAction(
    state,
    { type: "SEND_EMAIL", draftId },
    services,
  );
  assert.equal(result.state.drafts[0].status, "sent");
  assert.match(result.message!, /No email was sent/);
  assert.match(result.state.activities[0].summary, /simulated/);
  assert.equal(calls.emails, 0);
  assert.equal(result.state.usage.emails, 0);
  await assert.rejects(
    applyAction(result.state, { type: "SEND_EMAIL", draftId }, services),
    /Approve this exact draft/,
  );
});

test("turning off demo mode cannot send fictional contacts", async () => {
  const { services, calls } = harness();
  let state = createDemoState();
  state = (
    await applyAction(
      state,
      { type: "APPROVE_DRAFT", draftId: state.drafts[0].id },
      services,
    )
  ).state;
  state = (
    await applyAction(
      state,
      { type: "UPDATE_SETTINGS", settings: { demoMode: false } },
      services,
    )
  ).state;
  await assert.rejects(
    applyAction(
      state,
      { type: "SEND_EMAIL", draftId: state.drafts[0].id },
      services,
    ),
    /fictional demo contact/,
  );
  assert.equal(calls.emails, 0);
});

test("confidence and opt-out gates remain enforced without daily send quotas", () => {
  const state = liveState();
  const draft = state.drafts[0];
  draft.status = "approved";
  const contact = state.contacts[0];
  contact.emailConfidence = 0.5;
  assert.throws(() => validateSend(state, draft), /confidence threshold/);
  contact.emailConfidence = 0.95;
  state.usage.emails = 1000;
  (state.settings as AppState["settings"] & { dailyEmailLimit: number }).dailyEmailLimit = 1;
  assert.doesNotThrow(() => validateSend(state, draft));
  contact.optedOut = true;
  assert.throws(() => validateSend(state, draft), /opted out/);
});

test("live sends remain allowed at high usage despite an old saved email quota", async () => {
  const { services, calls } = harness();
  const state = liveState();
  state.drafts[0].status = "approved";
  state.usage.emails = 1000;
  (state.settings as AppState["settings"] & { dailyEmailLimit: number }).dailyEmailLimit = 1;
  const result = await applyAction(
    state,
    { type: "SEND_EMAIL", draftId: state.drafts[0].id },
    services,
  );
  assert.equal(calls.emails, 1);
  assert.equal(result.state.contacts[0].threadId, "thread");
  assert.equal(result.state.contacts[0].stage, "sent");
  assert.equal(result.state.usage.emails, 1001);
});

test("scheduler queues one draft, never sends, and a reply cancels queued follow-ups", async () => {
  const { services, calls } = harness();
  let state = createDemoState();
  const now = Date.now() + 8 * 86_400_000;
  state = (await applyAction(state, { type: "RUN_SCHEDULER", now }, services))
    .state;
  state = (await applyAction(state, { type: "RUN_SCHEDULER", now }, services))
    .state;
  let followUps = state.drafts.filter(
    (draft) => draft.kind === "follow_up" && draft.contactId === "demo_jordan",
  );
  assert.equal(followUps.length, 1);
  assert.equal(followUps[0].status, "pending");
  assert.equal(calls.emails, 0);
  state = (
    await applyAction(
      state,
      { type: "APPROVE_DRAFT", draftId: followUps[0].id },
      services,
    )
  ).state;
  state = (
    await applyAction(
      state,
      {
        type: "RECORD_REPLY",
        contactId: "demo_jordan",
        replyText: "Sure, let us meet.",
      },
      services,
    )
  ).state;
  assert.equal(
    state.contacts.find((contact) => contact.id === "demo_jordan")!.stage,
    "replied",
  );
  followUps = state.drafts.filter(
    (draft) => draft.kind === "follow_up" && draft.contactId === "demo_jordan",
  );
  assert.equal(followUps[0].status, "rejected");
  state = (await applyAction(state, { type: "RUN_SCHEDULER", now }, services))
    .state;
  assert.equal(
    state.drafts.filter(
      (draft) =>
        draft.kind === "follow_up" && draft.contactId === "demo_jordan",
    ).length,
    1,
  );
  assert.equal(
    state.contacts.find((contact) => contact.id === "demo_jordan")!
      .nextActionAt,
    undefined,
  );
});

test("at most two follow-ups can be sent, then the contact becomes cold", async () => {
  const { services } = harness();
  let state = createDemoState();
  for (let count = 0; count < 2; count++) {
    state = (
      await applyAction(
        state,
        { type: "RUN_SCHEDULER", now: Date.now() + 8 * 86_400_000 },
        services,
      )
    ).state;
    const followUp = state.drafts.find(
      (draft) =>
        draft.contactId === "demo_jordan" &&
        draft.kind === "follow_up" &&
        draft.status === "pending",
    )!;
    state = (
      await applyAction(
        state,
        { type: "APPROVE_DRAFT", draftId: followUp.id },
        services,
      )
    ).state;
    state = (
      await applyAction(
        state,
        { type: "SEND_EMAIL", draftId: followUp.id },
        services,
      )
    ).state;
  }
  state = (
    await applyAction(
      state,
      { type: "RUN_SCHEDULER", now: Date.now() + 8 * 86_400_000 },
      services,
    )
  ).state;
  assert.equal(
    state.contacts.find((contact) => contact.id === "demo_jordan")!
      .followUpCount,
    2,
  );
  assert.equal(
    state.contacts.find((contact) => contact.id === "demo_jordan")!.stage,
    "cold",
  );
  assert.equal(
    state.drafts.filter(
      (draft) =>
        draft.contactId === "demo_jordan" && draft.kind === "follow_up",
    ).length,
    2,
  );
});

test("prep briefs include approved bank entries only, even if AI returns an unapproved ID", async () => {
  const { services } = harness();
  const result = await applyAction(
    createDemoState(),
    { type: "GENERATE_PREP_BRIEF", contactId: "demo_leo" },
    services,
  );
  const meeting = result.state.meetings[0];
  assert.equal(meeting.questionIds.length, 5);
  assert.ok(
    meeting.questionIds.every(
      (questionId) =>
        result.state.questions.find((question) => question.id === questionId)
          ?.status === "approved",
    ),
  );
  assert.doesNotMatch(meeting.prepBrief!, /DO NOT INCLUDE UNAPPROVED/);
});

test("manual LinkedIn marks also require approval and enforce the 300 character limit", async () => {
  const { services, calls } = harness();
  const state = createDemoState();
  state.drafts[0].channel = "linkedin_connect";
  const draftId = state.drafts[0].id;
  await assert.rejects(
    applyAction(state, { type: "MARK_SENT", draftId }, services),
    /Approve this exact draft/,
  );
  state.drafts[0].status = "approved";
  state.drafts[0].body = "x".repeat(301);
  await assert.rejects(
    applyAction(state, { type: "MARK_SENT", draftId }, services),
    /300 characters/,
  );
  state.drafts[0].body =
    "Hi Maya! Fellow NYU student here. Open to a coffee chat?";
  const result = await applyAction(
    state,
    { type: "MARK_SENT", draftId },
    services,
  );
  assert.equal(result.state.drafts[0].status, "sent");
  assert.equal(calls.linkedin, 0);
});

test("failed sends require human approval again before retry", async () => {
  const { services } = harness();
  services.sendEmail = async () => {
    throw new Error("Gmail temporarily unavailable");
  };
  const state = liveState();
  state.drafts[0].status = "approved";
  const result = await applyAction(
    state,
    { type: "SEND_EMAIL", draftId: state.drafts[0].id },
    services,
  );
  assert.equal(result.state.drafts[0].status, "failed");
  assert.match(result.message!, /approve again/);
  await assert.rejects(
    applyAction(
      result.state,
      { type: "SEND_EMAIL", draftId: state.drafts[0].id },
      services,
    ),
    /Approve this exact draft/,
  );
});

test("failed reply polls prevent follow-ups while preserving other state", async () => {
  const { services } = harness();
  const state = liveState();
  const contact = state.contacts[0];
  contact.stage = "sent";
  contact.threadId = "thread";
  contact.nextActionAt = Date.now() - 1000;
  state.drafts[0].status = "sent";
  state.drafts[0].sentAt = Date.now() - 4 * 86_400_000;
  services.getThreadReplies = async () => {
    throw new Error("Gmail unavailable");
  };
  const result = await applyAction(state, { type: "RUN_SCHEDULER" }, services);
  assert.equal(
    result.state.drafts.filter(
      (draft) => draft.contactId === contact.id && draft.kind === "follow_up",
    ).length,
    0,
  );
  assert.ok(
    result.state.activities.some((activity) =>
      activity.summary.includes("follow-up paused"),
    ),
  );
});

test("manual addresses need verification and recipient changes revoke every unsent approval", async () => {
  const { services } = harness();
  let state = liveState();
  state.drafts[0].status = "approved";
  state.contacts[0].threadId = "old-thread";
  state = (
    await applyAction(
      state,
      {
        type: "UPDATE_CONTACT",
        contactId: "real_contact",
        patch: { email: "corrected@real-company.com", emailConfidence: 1 },
      },
      services,
    )
  ).state;
  assert.equal(state.contacts[0].emailConfidence, 0.5);
  assert.equal(state.contacts[0].emailVerified, false);
  assert.equal(state.contacts[0].threadId, undefined);
  assert.equal(state.drafts[0].status, "pending");
  state = (
    await applyAction(
      state,
      {
        type: "UPDATE_CONTACT",
        contactId: "real_contact",
        patch: { emailVerified: true },
      },
      services,
    )
  ).state;
  assert.equal(state.contacts[0].emailConfidence, 1);
  assert.equal(state.contacts[0].emailVerified, true);
  state = (
    await applyAction(
      state,
      { type: "APPROVE_DRAFT", draftId: state.drafts[0].id },
      services,
    )
  ).state;
  state = (
    await applyAction(
      state,
      {
        type: "UPDATE_CONTACT",
        contactId: "real_contact",
        patch: { emailVerified: false, emailConfidence: 0.99 },
      },
      services,
    )
  ).state;
  assert.equal(state.contacts[0].emailConfidence, 0.5);
  assert.equal(state.drafts[0].status, "pending");
  state = (
    await applyAction(
      state,
      {
        type: "ADD_CONTACT",
        contact: {
          targetId: state.targets[0].id,
          name: "New Person",
          title: "Engineer",
          company: "Example",
          email: "person@real-company.com",
          emailConfidence: 1,
          stage: "sent",
        },
      },
      services,
    )
  ).state;
  const added = state.contacts.at(-1)!;
  assert.equal(added.emailConfidence, 0.5);
  assert.equal(added.emailVerified, false);
  assert.equal(added.stage, "found");
});

test("demo and live workspaces persist independently through switches and demo reset", async () => {
  const demo = createDemoState();
  demo.profile.name = "My personal profile";
  demo.settings.backendUrl = "http://localhost:8787";
  await saveState(demo);
  let result = await executeAction({
    type: "UPDATE_SETTINGS",
    settings: { demoMode: false },
  });
  assert.equal(result.state.settings.demoMode, false);
  assert.equal(result.state.contacts.length, 0);
  assert.equal(result.state.targets.length, 0);
  assert.equal(result.state.drafts.length, 0);
  assert.equal(result.state.activities.length, 0);
  assert.equal(result.state.meetings.length, 0);
  assert.equal(result.state.questions.length, 0);
  assert.equal(result.state.profile.name, "My personal profile");
  assert.equal(result.state.settings.backendUrl, "http://localhost:8787");
  assert.equal(result.state.settings.googleConnected, false);
  const live = result.state;
  live.targets.push({
    id: "live_target",
    company: "Live Company",
    role: "Engineer",
    skills: [],
    rawDescription: "My real opportunity",
  });
  live.contacts.push({
    id: "live_contact",
    name: "Real Contact",
    company: "Live Company",
    title: "Engineer",
    targetId: "live_target",
    warmPaths: [],
    relevance: 80,
    reason: "Added by me",
    stage: "found",
    followUpCount: 0,
  });
  live.usage.emails = 3;
  await saveState(live);
  await assert.rejects(
    executeAction({ type: "RESET_DEMO" }),
    /Switch to Demo mode/,
  );
  assert.equal((await getState()).contacts[0].id, "live_contact");
  result = await executeAction({
    type: "UPDATE_SETTINGS",
    settings: { demoMode: true },
  });
  assert.equal(result.state.contacts.length, 6);
  assert.ok(
    result.state.contacts.every((contact) => contact.id.startsWith("demo_")),
  );
  assert.equal(result.state.profile.name, "My personal profile");
  await executeAction({ type: "RESET_DEMO" });
  result = await executeAction({
    type: "UPDATE_SETTINGS",
    settings: { demoMode: false },
  });
  assert.equal(result.state.contacts.length, 1);
  assert.equal(result.state.contacts[0].id, "live_contact");
  assert.equal(result.state.targets[0].id, "live_target");
  assert.equal(result.state.usage.emails, 3);
});

test("new replies preserve scheduled, met, and thanked stages without stale scheduling drafts", async () => {
  const { services } = harness();
  for (const stage of ["scheduled", "met", "thanked"] as const) {
    const state = createDemoState();
    state.contacts.find((contact) => contact.id === "demo_leo")!.stage = stage;
    const result = await applyAction(
      state,
      {
        type: "RECORD_REPLY",
        contactId: "demo_leo",
        replyText: "Thanks, looking forward to it!",
      },
      services,
    );
    assert.equal(
      result.state.contacts.find((contact) => contact.id === "demo_leo")!.stage,
      stage,
    );
    assert.equal(
      result.state.drafts.filter(
        (draft) =>
          draft.contactId === "demo_leo" && draft.kind === "schedule_reply",
      ).length,
      0,
    );
  }
});

test("booking and meeting notes retire obsolete drafts and refuse stale persisted scheduling sends", async () => {
  const { services } = harness();
  let state = createDemoState();
  state = (
    await applyAction(
      state,
      {
        type: "RECORD_REPLY",
        contactId: "demo_maya",
        replyText: "Yes, let us meet.",
      },
      services,
    )
  ).state;
  const schedulingId = state.drafts.find(
    (draft) =>
      draft.contactId === "demo_maya" && draft.kind === "schedule_reply",
  )!.id;
  state = (
    await applyAction(
      state,
      {
        type: "CREATE_MEETING",
        contactId: "demo_maya",
        start: new Date(Date.now() + 3_600_000).toISOString(),
        end: new Date(Date.now() + 4_500_000).toISOString(),
      },
      services,
    )
  ).state;
  assert.equal(
    state.drafts.find((draft) => draft.id === schedulingId)!.status,
    "rejected",
  );
  state.drafts.find((draft) => draft.id === schedulingId)!.status = "approved";
  assert.throws(
    () =>
      validateSend(
        state,
        state.drafts.find((draft) => draft.id === schedulingId)!,
      ),
    /obsolete/,
  );
  state = (
    await applyAction(
      state,
      {
        type: "SAVE_MEETING_NOTES",
        contactId: "demo_maya",
        notes: "We talked about reliable APIs.",
      },
      services,
    )
  ).state;
  assert.ok(
    state.drafts
      .filter(
        (draft) =>
          draft.contactId === "demo_maya" &&
          ["initial", "follow_up", "schedule_reply", "confirmation"].includes(
            draft.kind,
          ),
      )
      .every((draft) => ["sent", "rejected"].includes(draft.status)),
  );
  assert.ok(
    state.drafts.some(
      (draft) =>
        draft.contactId === "demo_maya" &&
        draft.kind === "thank_you" &&
        draft.status === "pending",
    ),
  );
});

test("notes persist when optional thank-you AI fails", async () => {
  const { services } = harness();
  services.aiRequest = async () => {
    throw new Error("Backend offline");
  };
  const result = await applyAction(
    createDemoState(),
    {
      type: "SAVE_MEETING_NOTES",
      contactId: "demo_leo",
      notes: "Useful advice on payment APIs.",
    },
    services,
  );
  const contact = result.state.contacts.find(
    (contact) => contact.id === "demo_leo",
  )!;
  assert.equal(contact.notes, "Useful advice on payment APIs.");
  assert.equal(contact.stage, "met");
  assert.match(result.message!, /Notes saved/);
  assert.ok(
    result.state.activities.some((activity) =>
      activity.summary.includes("Thank-you drafting failed"),
    ),
  );
});

test("sending an approved live follow-up rechecks replies and cancels before network send", async () => {
  const { services, calls } = harness();
  const state = liveState();
  state.contacts[0].stage = "sent";
  state.contacts[0].threadId = "thread";
  state.drafts[0].kind = "follow_up";
  state.drafts[0].status = "approved";
  services.getThreadReplies = async () => [
    {
      id: "new-reply",
      from: "maya@real-company.com",
      text: "Yes, happy to chat.",
    },
  ];
  const result = await applyAction(
    state,
    { type: "SEND_EMAIL", draftId: state.drafts[0].id },
    services,
  );
  assert.equal(calls.emails, 0);
  assert.equal(
    result.state.drafts.find((draft) => draft.id === state.drafts[0].id)!
      .status,
    "rejected",
  );
  assert.equal(result.state.contacts[0].stage, "replied");
  assert.match(result.message!, /cancelled/);
});

test("follow-up send fails closed if its final reply check is unavailable", async () => {
  const { services, calls } = harness();
  const state = liveState();
  state.contacts[0].stage = "sent";
  state.contacts[0].threadId = "thread";
  state.drafts[0].kind = "follow_up";
  state.drafts[0].status = "approved";
  services.getThreadReplies = async () => {
    throw new Error("Gmail offline");
  };
  const result = await applyAction(
    state,
    { type: "SEND_EMAIL", draftId: state.drafts[0].id },
    services,
  );
  assert.equal(calls.emails, 0);
  assert.equal(result.state.drafts[0].status, "pending");
  assert.match(result.message!, /Nothing was sent/);
});

test("live email checkpoints an unresolved send before the network request", async () => {
  const { services } = harness();
  const state = liveState();
  state.drafts[0].status = "approved";
  const order: string[] = [];
  services.sendEmail = async () => {
    order.push("send");
    return { id: "message", threadId: "thread" };
  };
  const result = await applyAction(
    state,
    { type: "SEND_EMAIL", draftId: state.drafts[0].id },
    services,
    async (checkpoint) => {
      order.push("checkpoint");
      assert.equal(checkpoint.drafts[0].status, "sending");
      assert.equal(checkpoint.usage.emails, 1);
      await assert.rejects(
        applyAction(
          checkpoint,
          { type: "SEND_EMAIL", draftId: checkpoint.drafts[0].id },
          services,
        ),
        /Approve this exact draft/,
      );
    },
  );
  assert.deepEqual(order, ["checkpoint", "send"]);
  assert.equal(result.state.drafts[0].status, "sent");
});

test("a failed pre-send checkpoint prevents external delivery", async () => {
  const { services, calls } = harness();
  const state = liveState();
  state.drafts[0].status = "approved";
  await assert.rejects(
    applyAction(
      state,
      { type: "SEND_EMAIL", draftId: state.drafts[0].id },
      services,
      async () => {
        throw new Error("Storage is full");
      },
    ),
    /Storage is full/,
  );
  assert.equal(calls.emails, 0);
  assert.equal(state.drafts[0].status, "approved");
});

test("unresolved sends need explicit reconciliation and keep their original recipient", async () => {
  const { services, calls } = harness();
  const state = liveState();
  state.drafts[0].status = "sending";
  await assert.rejects(
    applyAction(
      state,
      {
        type: "UPDATE_CONTACT",
        contactId: "real_contact",
        patch: { email: "changed@real-company.com" },
      },
      services,
    ),
    /reconcile/,
  );
  await assert.rejects(
    applyAction(
      state,
      { type: "APPROVE_DRAFT", draftId: state.drafts[0].id },
      services,
    ),
    /pending or failed/,
  );
  const delivered = await applyAction(
    state,
    { type: "RESOLVE_SEND", draftId: state.drafts[0].id, sent: true },
    services,
  );
  assert.equal(delivered.state.drafts[0].status, "sent");
  assert.equal(delivered.state.contacts[0].nextActionAt, undefined);
  const notDelivered = await applyAction(
    state,
    { type: "RESOLVE_SEND", draftId: state.drafts[0].id, sent: false },
    services,
  );
  assert.equal(notDelivered.state.drafts[0].status, "pending");
  assert.equal(calls.emails, 0);
});

test("an unresolved send blocks duplicate drafts and other messages to the same contact", async () => {
  const { services } = harness();
  const state = liveState();
  state.drafts[0].status = "sending";
  const generated = await applyAction(
    state,
    { type: "GENERATE_DRAFTS", contactIds: ["real_contact"] },
    services,
  );
  assert.equal(
    generated.state.drafts.filter((draft) => draft.contactId === "real_contact")
      .length,
    1,
  );
  const another = {
    ...state.drafts[0],
    id: "another",
    status: "approved" as const,
  };
  state.drafts.push(another);
  assert.throws(() => validateSend(state, another), /unresolved send/);
});

test("a detected reply checkpoints the follow-up stop before optional AI work", async () => {
  const { services } = harness();
  const order: string[] = [];
  const original = services.aiRequest;
  services.aiRequest = async (...args) => {
    order.push("ai");
    return original(...args);
  };
  const result = await applyAction(
    createDemoState(),
    {
      type: "RECORD_REPLY",
      contactId: "demo_jordan",
      replyText: "Yes, let us chat.",
    },
    services,
    async (checkpoint) => {
      order.push("checkpoint");
      assert.equal(
        checkpoint.contacts.find((contact) => contact.id === "demo_jordan")!
          .stage,
        "replied",
      );
      assert.equal(
        checkpoint.contacts.find((contact) => contact.id === "demo_jordan")!
          .nextActionAt,
        undefined,
      );
    },
  );
  assert.equal(order[0], "checkpoint");
  assert.equal(
    result.state.contacts.find((contact) => contact.id === "demo_jordan")!
      .stage,
    "replied",
  );
});

test("a fresh live workspace requires a personal identity instead of the fictional demo profile", async () => {
  const { createLiveState } = await import("../extension/src/shared/storage");
  const blank = createLiveState(createDemoState());
  assert.equal(blank.profile.name, "");
  assert.equal(blank.contacts.length, 0);
  const personalized = createDemoState();
  personalized.profile.name = "My real name";
  assert.equal(createLiveState(personalized).profile.name, "My real name");
});

test("a reply draft displays the existing Gmail subject before human approval", async () => {
  const state = liveState();
  const { services } = harness();
  const contact = state.contacts[0];
  contact.threadId = "gmail-thread";
  contact.stage = "sent";
  state.drafts[0].status = "sent";
  state.drafts[0].subject = "The approved original subject";
  const result = await applyAction(
    state,
    {
      type: "RECORD_REPLY",
      contactId: contact.id,
      replyText: "Happy to chat!",
    },
    services,
  );
  const draft = result.state.drafts.find(
    (item) => item.kind === "schedule_reply",
  );
  assert.equal(draft?.subject, "The approved original subject");
  assert.equal(draft?.status, "pending");
});

test("people search planning passes full job and profile context without changing the workspace", async () => {
  const { services, calls } = harness();
  const state = createDemoState();
  state.settings.demoMode = false;
  state.profile.background = "Previously built community payment tools at a student volunteer organization. Interested in developer adoption and accessibility.";
  state.targets[0].rawDescription = "Company: Example Payments\nRole: Developer Advocate\nFull description: Help developers integrate financial APIs, write educational guides, lead workshops, and collaborate with engineering, product, and support. This detail must reach the model even when absent from the extracted title.";
  state.usage.date = "2000-01-01";
  const original = structuredClone(state);
  const plan = {
    summary: "Find people through shared background and adjacent teams.",
    queries: [{ label: "Developer education", query: 'site:linkedin.com/in/ "Example Payments" "developer education"', rationale: "The full description calls for workshops and educational guides.", connectionType: "team" as const }],
  };
  let requested = false;
  services.aiRequest = async <T>(endpoint: string, payload: unknown, settings: AppState["settings"]): Promise<T> => {
    requested = true;
    assert.equal(endpoint, "/ai/people-search-plan");
    assert.deepEqual(payload, { profile: original.profile, target: original.targets[0] });
    assert.equal((payload as { target: { rawDescription: string } }).target.rawDescription, original.targets[0].rawDescription);
    assert.equal((payload as { profile: { background: string } }).profile.background, original.profile.background);
    assert.equal(settings.demoMode, false);
    return plan as T;
  };
  const result = await applyAction(state, { type: "GENERATE_SEARCH_PLAN", targetId: state.targets[0].id }, services);
  assert.equal(requested, true);
  assert.deepEqual(result.data, plan);
  assert.deepEqual(result.state, original);
  assert.deepEqual(state, original);
  assert.equal(calls.emails, 0);
  assert.equal(calls.linkedin, 0);
  assert.equal(calls.calendar, 0);
});

test("people search planning rejects an unknown target without calling AI", async () => {
  const { services, calls } = harness();
  await assert.rejects(applyAction(createDemoState(), { type: "GENERATE_SEARCH_PLAN", targetId: "missing" }, services), /Select a target job/);
  assert.equal(calls.ai, 0);
  assert.equal(calls.emails, 0);
});

test("demo search plans are deterministic, grounded query ideas with no network or fabricated contacts", async () => {
  const state = createDemoState();
  state.profile.school = "Example University";
  state.profile.background = "I build TypeScript APIs for student organizations.";
  state.targets[0].company = "Fictional Payments";
  state.targets[0].team = "Developer Tools";
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error("Demo must not fetch"); };
  try {
    const action = { type: "GENERATE_SEARCH_PLAN" as const, targetId: state.targets[0].id };
    const first = await applyAction(state, action);
    const second = await applyAction(state, action);
    const plan = first.data as { summary: string; queries: { query: string; connectionType: string; rationale: string }[] };
    assert.deepEqual(first.data, second.data);
    assert.equal(plan.queries.length, 5);
    assert.deepEqual(new Set(plan.queries.map(query => query.connectionType)), new Set(["alumni", "shared_background", "team", "recruiting", "company"]));
    assert.ok(plan.queries.every(query => query.query.includes('"Fictional Payments"') && query.rationale));
    assert.ok(plan.queries.filter(query => !query.query.includes("site:")).length >= 2);
    assert.ok(!plan.queries.find(query => query.connectionType === "team")!.query.includes("site:"));
    assert.ok(!plan.queries.find(query => query.connectionType === "company")!.query.includes("site:"));
    assert.ok(plan.queries.find(query => query.connectionType === "alumni")!.query.includes('"Example University"'));
    assert.ok(plan.queries.find(query => query.connectionType === "shared_background")!.query.includes('"TypeScript"'));
    assert.ok(plan.queries.find(query => query.connectionType === "team")!.query.includes('"Developer Tools"'));
    assert.match(plan.summary, /not verified people or search results/);
    assert.deepEqual(first.state, state);
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("X: demo discovery adds labeled people with evidence; drafts use the template and only send by hand", async () => {
  const { services, calls } = harness();
  let state = createDemoState();
  const targetId = state.targets[0].id;
  let result = await applyAction(state, { type: "FIND_ON_X", targetId }, services);
  state = result.state;
  const found = state.contacts.filter((c) => c.xHandle);
  assert.equal(found.length, 3);
  assert.match(result.message || "", /Demo mode: no X search ran/);
  for (const c of found) {
    assert.ok(c.id.startsWith("demo_"), "demo X people must be marked fictional");
    assert.ok(c.xPost?.excerpt, "each person carries the post that made them relevant");
  }
  // Running it again does not duplicate people.
  state = (await applyAction(state, { type: "FIND_ON_X", targetId }, services)).state;
  assert.equal(state.contacts.filter((c) => c.xHandle).length, 3);

  const person = found[0];
  state = (await applyAction(state, { type: "GENERATE_DRAFTS", contactIds: [person.id] }, services)).state;
  const draft = state.drafts.find((d) => d.contactId === person.id)!;
  assert.equal(draft.channel, "x");
  assert.ok(!/no follow-ups/.test(draft.body), "the email opt-out line is not added to X messages");
  await assert.rejects(applyAction(state, { type: "MARK_SENT", draftId: draft.id }, services), /Approve this exact draft/);
  await assert.rejects(
    applyAction(state, { type: "FILL_LINKEDIN", draftId: draft.id }, services),
    /send it on X yourself/,
  );
  state = (await applyAction(state, { type: "APPROVE_DRAFT", draftId: draft.id }, services)).state;
  result = await applyAction(state, { type: "MARK_SENT", draftId: draft.id }, services);
  assert.match(result.message || "", /Demo X send simulated/);
  assert.equal(result.state.drafts.find((d) => d.id === draft.id)!.status, "sent");
  assert.equal(calls.emails + calls.linkedin, 0, "nothing was sent automatically");
});

test("X: live discovery goes through the backend service and skips people already found", async () => {
  const { services } = harness();
  const state = createDemoState();
  state.settings.demoMode = false;
  const target = state.targets[0];
  const person = {
    id: "contact_x_ana_real",
    targetId: target.id,
    name: "Ana Real",
    title: "Engineer",
    company: target.company,
    xHandle: "ana_real",
    xUrl: "https://x.com/ana_real",
    warmPaths: [],
    relevance: 77,
    reason: "Posts about the team's work",
    stage: "found" as const,
    followUpCount: 0,
  };
  let asked = 0;
  services.discoverOnX = async (t, _profile, backendUrl) => {
    asked++;
    assert.equal(t.id, target.id);
    assert.equal(backendUrl, state.settings.backendUrl);
    return { contacts: [person], status: "succeeded" };
  };
  const first = await applyAction(state, { type: "FIND_ON_X", targetId: target.id }, services);
  assert.match(first.message || "", /1 people found on X/);
  const second = await applyAction(first.state, { type: "FIND_ON_X", targetId: target.id }, services);
  assert.match(second.message || "", /already on this target/);
  assert.equal(asked, 2);
});

test("live search import reports new and already-added people, including repeated imports", async () => {
  const { services, calls } = harness();
  let state = liveState();
  const targetId = state.targets[0].id;
  const duplicate = { ...state.contacts[0], linkedinUrl: "https://www.linkedin.com/in/existing-person/" };
  state.contacts[0] = duplicate;
  const incoming = {
    ...duplicate, id: "new-live-person", name: "New Person",
    linkedinUrl: "https://www.linkedin.com/in/new-person/", email: undefined,
    stage: "found" as const, followUpCount: 0,
  };
  services.scrapeSearch = async () => [duplicate, incoming];
  const originalDrafts = structuredClone(state.drafts);
  const first = await applyAction(state, { type: "SCRAPE_SEARCH", targetId }, services);
  const visiblePeople = [duplicate, incoming].map(person => ({ id: person.id, name: person.name, title: person.title, linkedinUrl: person.linkedinUrl }));
  assert.deepEqual(first.data, { imported: 1, scanned: 2, alreadyAdded: 1, refreshed: 0, people: visiblePeople });
  assert.equal(first.state.contacts.length, state.contacts.length + 1);
  assert.equal(first.state.usage.profiles, state.usage.profiles + 1);
  assert.deepEqual(first.state.drafts, originalDrafts);
  state = first.state;
  const repeated = await applyAction(state, { type: "SCRAPE_SEARCH", targetId }, services);
  assert.deepEqual(repeated.data, { imported: 0, scanned: 2, alreadyAdded: 2, refreshed: 0, people: visiblePeople });
  assert.match(repeated.message!, /All 2 visible people are already added to this target/);
  assert.match(repeated.message!, /Open another results page/);
  assert.equal(repeated.state.contacts.length, state.contacts.length);
  assert.equal(repeated.state.usage.profiles, state.usage.profiles);
  assert.deepEqual(repeated.state.drafts, originalDrafts);
  assert.equal(calls.emails, 0);
  assert.equal(calls.calendar, 0);
  assert.equal(calls.linkedin, 0);
  assert.equal(calls.ai, 0);
});

test("live imports exceed 20 people despite high usage and an old saved profile quota", async () => {
  const { services, calls } = harness();
  const state = liveState();
  const targetId = state.targets[0].id;
  state.usage.profiles = 1000;
  (state.settings as AppState["settings"] & { dailyScrapeLimit: number }).dailyScrapeLimit = 1;
  services.scrapeSearch = async () => Array.from({ length: 35 }, (_, index) => ({
    ...state.contacts[0], id: `new-person-${index}`, name: `New Person ${index}`,
    linkedinUrl: `https://www.linkedin.com/in/new-person-${index}/`,
  }));
  const result = await applyAction(state, { type: "SCRAPE_SEARCH", targetId }, services);
  assert.deepEqual(result.data, {
    imported: 35, scanned: 35, alreadyAdded: 0, refreshed: 0,
    people: Array.from({ length: 35 }, (_, index) => ({
      id: `new-person-${index}`, name: `New Person ${index}`, title: state.contacts[0].title,
      linkedinUrl: `https://www.linkedin.com/in/new-person-${index}/`,
    })),
  });
  assert.equal(result.state.usage.profiles, 1035);
  assert.equal(result.state.contacts.length, state.contacts.length + 35);
  assert.doesNotMatch(result.message!, /Daily (?:import|profile) limit/);
  assert.deepEqual(result.state.drafts, state.drafts);
  assert.equal(calls.emails + calls.linkedin + calls.calendar, 0);
});

test("empty live imports explain unreadable results instead of reporting duplicate people", async () => {
  const { services, calls } = harness();
  const state = liveState();
  await assert.rejects(applyAction(state, { type: "SCRAPE_SEARCH", targetId: state.targets[0].id }, services), /No readable people.*results to load/);
  assert.equal(calls.emails, 0);
});

test("demo import metadata describes fictional examples and does not read a page or send", async () => {
  const { services, calls } = harness();
  services.scrapeSearch = async () => { throw new Error("Demo must not read a live page"); };
  const state = createDemoState();
  const first = await applyAction(state, { type: "SCRAPE_SEARCH", targetId: state.targets[0].id }, services);
  assert.deepEqual(first.data, { imported: 0, scanned: 6, alreadyAdded: 6 });
  assert.match(first.message!, /fictional demo people.*No LinkedIn page was read/);
  state.contacts = [];
  const added = await applyAction(state, { type: "SCRAPE_SEARCH", targetId: state.targets[0].id }, services);
  assert.deepEqual(added.data, { imported: 6, scanned: 6, alreadyAdded: 0 });
  assert.equal(added.state.contacts.length, 6);
  assert.equal(added.state.usage.profiles, 0);
  assert.match(added.message!, /fictional demo people added.*No LinkedIn page was read/);
  assert.equal(calls.emails, 0);
  assert.equal(calls.linkedin, 0);
  assert.equal(calls.calendar, 0);
});

test("X: incomplete discovery keeps contacts and warnings, including duplicate results", async () => {
  const { services, calls } = harness();
  const state = liveState();
  const person = { ...state.contacts[0], id: "partial_x_person", xHandle: "partial_person", xUrl: "https://x.com/partial_person" };
  services.discoverOnX = async () => ({ contacts: [person], status: "partial", warning: "One provider search timed out." });
  const action = { type: "FIND_ON_X" as const, targetId: state.targets[0].id };
  const first = await applyAction(state, action, services);
  assert.deepEqual(first.data, { complete: false, imported: 1, warning: "One provider search timed out." });
  assert.ok(first.state.contacts.some(contact => contact.id === person.id));
  assert.match(first.message!, /incomplete.*1 completed person.*One provider search timed out/);
  const repeated = await applyAction(first.state, action, services);
  assert.deepEqual(repeated.data, { complete: false, imported: 0, warning: "One provider search timed out." });
  assert.match(repeated.message!, /already on this target.*One provider search timed out/);
  assert.doesNotMatch(repeated.message!, /Grok found no one/);
  assert.equal(calls.emails + calls.linkedin + calls.calendar, 0);
});

test("X: cancellation with zero contacts stays cancellation feedback instead of claiming no matches", async () => {
  const { services, calls } = harness();
  const state = liveState();
  services.discoverOnX = async () => ({ contacts: [], status: "cancelled", warning: "Research was cancelled by the user." });
  const result = await applyAction(state, { type: "FIND_ON_X", targetId: state.targets[0].id }, services);
  assert.deepEqual(result.data, { complete: false, imported: 0, warning: "Research was cancelled by the user." });
  assert.match(result.message!, /cancelled.*No completed people/);
  assert.doesNotMatch(result.message!, /Grok found no one/);
  assert.equal(result.state.contacts.length, state.contacts.length);
  assert.equal(calls.emails + calls.linkedin + calls.calendar, 0);
});


test("LinkedIn reimports refresh observed details using canonical URLs without changing outreach or manual fields", async () => {
  const { services, calls } = harness();
  const state = liveState();
  const saved = state.contacts[0];
  saved.linkedinUrl = "https://www.linkedin.com/in/observed-person/?trk=old";
  saved.name = "Old display name";
  saved.title = "Old headline";
  saved.company = "Old Company";
  saved.location = "Old Location";
  saved.connectionDegree = 3;
  saved.warmPaths = [{ type: "past_employer", detail: "Manually entered shared employer" }];
  saved.notes = "My private conversation notes";
  saved.email = "confirmed@real-company.com";
  saved.emailVerified = true;
  saved.emailConfidence = 1;
  saved.stage = "scheduled";
  saved.followUpCount = 2;
  saved.nextActionAt = Date.now() + 1000;
  saved.threadId = "original-thread";
  saved.linkedinEvidence = { headline: "Old headline", sourceText: "Old visible card", capturedAt: 100 };
  state.drafts[0].status = "approved";
  const originalDrafts = structuredClone(state.drafts);
  const originalMeetings = structuredClone(state.meetings);
  const observed: Contact = {
    ...saved, id: "fresh-page-id", linkedinUrl: "https://linkedin.com/in/observed-person#new",
    name: "Actual Visible Name", title: "Engineering Manager at Real Company", company: "Real Company",
    location: "New York Metropolitan Area", connectionDegree: 2,
    warmPaths: [{ type: "alumni", detail: "Example University in visible education" }],
    notes: "Incoming page notes must not overwrite mine", email: "guessed@wrong-company.com",
    emailVerified: false, emailConfidence: 0.3, stage: "found", followUpCount: 0,
    nextActionAt: undefined, threadId: undefined,
    linkedinEvidence: {
      headline: "Engineering Manager at Real Company", location: "New York Metropolitan Area",
      education: "Example University", mutualConnections: "A visible mutual connection",
      sourceText: "Actual Visible Name\nEngineering Manager at Real Company\nNew York Metropolitan Area",
      sourceUrl: "https://www.linkedin.com/search/results/people/?keywords=company", capturedAt: 200,
    },
  };
  services.scrapeSearch = async () => [observed];
  const result = await applyAction(state, { type: "SCRAPE_SEARCH", targetId: state.targets[0].id }, services);
  const updated = result.state.contacts.find(contact => contact.id === saved.id)!;
  assert.equal(result.state.contacts.length, state.contacts.length);
  assert.deepEqual(result.data, {
    imported: 0, scanned: 1, alreadyAdded: 1, refreshed: 1,
    people: [{ id: saved.id, name: observed.name, title: observed.title, linkedinUrl: "https://www.linkedin.com/in/observed-person/", location: observed.location }],
  });
  assert.match(result.message!, /Updated visible LinkedIn details/);
  assert.equal(updated.id, saved.id);
  assert.equal(updated.name, observed.name);
  assert.equal(updated.title, observed.title);
  assert.equal(updated.company, observed.company);
  assert.equal(updated.location, observed.location);
  assert.equal(updated.connectionDegree, 2);
  assert.deepEqual(updated.linkedinEvidence, observed.linkedinEvidence);
  assert.ok(saved.warmPaths.every(path => updated.warmPaths.some(updatedPath => updatedPath.type === path.type && updatedPath.detail === path.detail)));
  assert.ok(observed.warmPaths.every(path => updated.warmPaths.some(updatedPath => updatedPath.type === path.type && updatedPath.detail === path.detail)));
  assert.match(updated.reason, /Example University in visible education/);
  assert.notEqual(updated.reason, saved.reason);
  assert.notEqual(updated.relevance, saved.relevance);
  for (const field of ["notes", "email", "emailVerified", "emailConfidence", "stage", "followUpCount", "nextActionAt", "threadId", "linkedinUrl"] as const) assert.deepEqual(updated[field], saved[field]);
  assert.deepEqual(result.state.drafts, originalDrafts);
  assert.deepEqual(result.state.meetings, originalMeetings);
  assert.equal(result.state.usage.profiles, state.usage.profiles);
  assert.equal(calls.emails + calls.linkedin + calls.calendar + calls.ai, 0);
});

test("LinkedIn reimports keep known details when new visible fields are empty and do not count timestamp-only refreshes", async () => {
  const { services } = harness();
  const state = liveState();
  const saved = state.contacts[0];
  saved.linkedinUrl = "https://www.linkedin.com/in/known-person/";
  saved.location = "Known Location";
  saved.connectionDegree = 2;
  saved.warmPaths = [{ type: "shared_org", detail: "A manually supplied club" }];
  saved.linkedinEvidence = { headline: saved.title, location: saved.location, education: "Known education", sourceText: "Known visible text", capturedAt: 100 };
  const empty: Contact = { ...saved, id: "new-reader-id", name: " ", title: "", company: "", location: "", connectionDegree: undefined, warmPaths: [], linkedinEvidence: { headline: " ", sourceText: "", capturedAt: 200 } };
  services.scrapeSearch = async () => [empty];
  const unchanged = await applyAction(state, { type: "SCRAPE_SEARCH", targetId: state.targets[0].id }, services);
  assert.deepEqual(unchanged.state.contacts[0], saved);
  assert.equal((unchanged.data as { refreshed: number }).refreshed, 0);
  assert.match(unchanged.message!, /visible details are unchanged/);
  services.scrapeSearch = async () => [{ ...saved, id: "another-reader-id", linkedinEvidence: { ...saved.linkedinEvidence!, capturedAt: 300 } }];
  const timestampOnly = await applyAction(state, { type: "SCRAPE_SEARCH", targetId: state.targets[0].id }, services);
  assert.equal((timestampOnly.data as { refreshed: number }).refreshed, 0);
  assert.equal(timestampOnly.state.contacts[0].linkedinEvidence!.capturedAt, 300);
  assert.deepEqual(timestampOnly.state.contacts[0].warmPaths, saved.warmPaths);
});

test("LinkedIn canonical matching keeps the same person separate across different target jobs", async () => {
  const { services } = harness();
  const state = liveState();
  const saved = state.contacts[0];
  saved.linkedinUrl = "https://www.linkedin.com/in/same-person/";
  const otherTarget = { ...state.targets[0], id: "other-target" };
  state.targets.push(otherTarget);
  services.scrapeSearch = async () => [{ ...saved, id: "new-target-person", targetId: otherTarget.id, name: "Observed Person", linkedinUrl: "https://linkedin.com/in/same-person/?tracking=new" }];
  const result = await applyAction(state, { type: "SCRAPE_SEARCH", targetId: otherTarget.id }, services);
  assert.equal((result.data as { imported: number; refreshed: number }).imported, 1);
  assert.equal((result.data as { imported: number; refreshed: number }).refreshed, 0);
  assert.deepEqual(result.state.contacts[0], saved);
  assert.equal(result.state.contacts.at(-1)!.targetId, otherTarget.id);
  assert.equal(result.state.contacts.at(-1)!.linkedinUrl, "https://www.linkedin.com/in/same-person/");
});


test("LinkedIn import returns one visible person when duplicate cards resolve to the same canonical profile", async () => {
  const { services } = harness();
  const state = liveState();
  const person = { ...state.contacts[0], id: "new-unique-person", name: "One Visible Person", linkedinUrl: "https://www.linkedin.com/in/one-visible-person/" };
  services.scrapeSearch = async () => [person, { ...person, id: "duplicate-reader-id", linkedinUrl: "https://linkedin.com/in/one-visible-person?trk=duplicate" }];
  const result = await applyAction(state, { type: "SCRAPE_SEARCH", targetId: state.targets[0].id }, services);
  const data = result.data as { imported: number; scanned: number; people: { id: string; name: string; linkedinUrl: string }[] };
  assert.equal(data.imported, 1);
  assert.equal(data.scanned, 2);
  assert.equal(data.people.length, 1);
  assert.equal(data.people[0].id, person.id);
  assert.equal(data.people[0].name, person.name);
  assert.equal(data.people[0].linkedinUrl, person.linkedinUrl);
  assert.equal(result.state.contacts.filter(contact => contact.id === person.id).length, 1);
});
