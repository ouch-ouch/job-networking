import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOutput } from "../backend/src/coffee/contracts";
import { demoResponse } from "../extension/src/shared/ai";
import { applyAction, type EngineServices } from "../extension/src/shared/engine";
import { createDemoState } from "../extension/src/shared/mock";

type Suggested = { text: string; category: string; contactId: string | null; why: string };

const state = createDemoState(1_800_000_000_000);
const contacts = state.contacts.map(({ id, targetId, name, title, company, warmPaths, notes }) => ({
  id, targetId, name, title, company, warmPaths, notes,
}));

test("demo suggestions are about the people in the network, not a fixed list", () => {
  const { questions } = demoResponse("suggest-questions", {
    profile: state.profile,
    targets: state.targets,
    existingBank: [],
    contacts,
  }) as { questions: Suggested[] };
  assert.ok(questions.length > 0);
  const ids = new Set(contacts.map((c) => c.id));
  for (const q of questions) {
    assert.ok(q.contactId && ids.has(q.contactId), `untagged: ${q.text}`);
    const person = contacts.find((c) => c.id === q.contactId)!;
    assert.ok(q.why.includes(person.name.split(" ")[0]), `why does not name the person: ${q.why}`);
  }
  const manager = contacts.find((c) => /manager/i.test(c.title))!;
  assert.ok(questions.some((q) => q.contactId === manager.id && q.category === "team"));
});

test("focusing on one contact tailors every suggestion to that person", () => {
  const focus = contacts[1];
  const { questions } = demoResponse("suggest-questions", {
    profile: state.profile,
    targets: state.targets,
    existingBank: [],
    contacts,
    focusContactId: focus.id,
  }) as { questions: Suggested[] };
  assert.ok(questions.length > 0);
  assert.ok(questions.every((q) => q.contactId === focus.id));
});

test("without a network, demo suggestions fall back to general questions", () => {
  const { questions } = demoResponse("suggest-questions", {
    profile: state.profile,
    targets: state.targets,
    existingBank: [],
    contacts: [],
  }) as { questions: Suggested[] };
  assert.ok(questions.length > 0);
  assert.ok(questions.every((q) => q.contactId === null));
});

test("the backend drops tags for people who were not supplied and removes duplicates", () => {
  const input = {
    profile: state.profile,
    targets: state.targets,
    existingBank: [{ id: "q1", text: "Already asked?", category: "role", status: "approved" }],
    contacts: contacts.slice(0, 1),
  };
  const result = normalizeOutput("suggest-questions", input, {
    questions: [
      { text: "Already asked?", category: "role", contactId: null, why: "dup" },
      { text: "How do you pick projects?", category: "team", contactId: contacts[0].id, why: "manager" },
      { text: "Invented person?", category: "role", contactId: "someone_else", why: "made up" },
    ],
  }) as { questions: Suggested[] };
  assert.deepEqual(
    result.questions.map((q) => [q.text, q.contactId]),
    [
      ["How do you pick projects?", contacts[0].id],
      ["Invented person?", null],
    ],
  );
});

function services(answer: (endpoint: string, payload: any) => unknown) {
  return { aiRequest: async <T>(endpoint: string, payload: unknown) => answer(endpoint, payload) as T } as unknown as EngineServices;
}

test("suggesting for one contact sends only that person and keeps only valid tags", async () => {
  const focus = state.contacts[2];
  let sent: any;
  const result = await applyAction(
    state,
    { type: "SUGGEST_QUESTIONS", contactId: focus.id },
    services((_, payload) => {
      sent = payload;
      return {
        questions: [
          { text: "What surprised you about your role?", category: "role", contactId: focus.id, why: "Their title" },
          { text: "Who else should I talk to?", category: "advice", contactId: "not_a_contact", why: "?" },
        ],
      };
    }),
  );
  assert.deepEqual(sent.contacts.map((c: { id: string }) => c.id), [focus.id]);
  assert.equal(sent.focusContactId, focus.id);
  const added = result.state.questions.slice(state.questions.length);
  assert.equal(added[0].contactId, focus.id);
  assert.equal(added[0].why, "Their title");
  assert.equal(added[1].contactId, undefined);
  assert.match(result.message ?? "", new RegExp(focus.name));
});

test("prep briefs offer the contact's own questions first", async () => {
  const contact = state.contacts[0];
  const s = structuredClone(state);
  s.questions.push(
    { id: "mine", text: "A question for this person", category: "role", source: "ai_suggested", status: "approved", timesUsed: 0, contactId: contact.id },
    { id: "theirs", text: "A question for someone else", category: "role", source: "ai_suggested", status: "approved", timesUsed: 0, contactId: state.contacts[1].id },
  );
  let bank: { id: string }[] = [];
  await applyAction(
    s,
    { type: "GENERATE_PREP_BRIEF", contactId: contact.id },
    services((endpoint, payload) => {
      if (endpoint === "/ai/prep-brief") bank = payload.approvedBank;
      return { summary: "s", warmPathTalkingPoint: "w", companyContext: "c", picked: [], newQuestions: [] };
    }),
  ).catch(() => undefined);
  assert.equal(bank[0]?.id, "mine");
  assert.equal(bank.at(-1)?.id, "theirs");
});
