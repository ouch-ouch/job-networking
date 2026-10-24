import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import {
  createApp,
  isAllowedOrigin,
  type BackendConfig,
} from "../backend/src/app";
import {
  fillTemplate,
  inputs,
  normalizeOutput,
  outputSchema,
  outputs,
} from "../backend/src/contracts";
import { demoResponse, aiRequest } from "../extension/src/shared/ai";
import { createDemoState } from "../extension/src/shared/mock";
import {
  buildMime,
  decodeBase64Url,
  incomingReplies,
  latestReplyText,
  optOutLine,
  utf8Base64,
} from "../extension/src/google/gmail";
import { validateMeeting } from "../extension/src/google/calendar";

const state = createDemoState(1_800_000_000_000);
const fillInput = {
  template: state.template,
  profile: state.profile,
  target: state.targets[0],
  contact: state.contacts[0],
};

test("literal template wording survives AI replacements; known facts cannot be overwritten", () => {
  const input = inputs["fill-template"].parse({
    ...fillInput,
    template: {
      channel: "email",
      subject: "Hello {{first_name}}!",
      body: "Keep   my wording!\n{{company}} / {{personal_hook}} / {{my_availability}}",
    },
  });
  const result = fillTemplate(input, {
    company: "Invented company",
    personal_hook: "Fellow NYU student here.",
  });
  assert.equal(
    result.body,
    "Keep   my wording!\nStripe / Fellow NYU student here. / Weekdays 2–5 pm ET",
  );
  assert.equal(result.subject, "Hello Maya!");
  const recruiter = {
    ...input,
    contact: { ...input.contact, title: "University Recruiter" },
    template: { ...input.template, body: "{{their_team}} / {{team}}" },
  };
  assert.equal(
    fillTemplate(recruiter, {}).body,
    "University Recruiter / Payments",
  );
});

test("unknown and malformed placeholders produce an actionable error instead of disappearing", () => {
  const input = inputs["fill-template"].parse({
    ...fillInput,
    template: { channel: "email", body: "Keep {{unknown_fact}}." },
  });
  assert.throws(
    () => fillTemplate(input, { unknown_fact: "" }),
    /No value for/,
  );
  assert.throws(
    () =>
      demoResponse("fill-template", {
        ...fillInput,
        template: { ...state.template, body: "{{unknown_fact}}" },
      }),
    /No value for/,
  );
  assert.throws(
    () =>
      fillTemplate(
        { ...input, template: { ...input.template, body: "{{invalid name}}" } },
        {},
      ),
    /malformed/,
  );
});

test("availability aliases and long supplied background work in live template normalization", () => {
  const background = "a".repeat(1001);
  const input = {
    ...fillInput,
    profile: { ...fillInput.profile, background },
    template: {
      channel: "email",
      body: "{{background}}\n{{availability}}\n{{my_availability}}",
    },
  };
  const result = normalizeOutput("fill-template", input, {
    filledKeywords: { background: "", availability: "", my_availability: "" },
  }) as { body: string };
  assert.equal(
    result.body,
    `${background}\nWeekdays 2–5 pm ET\nWeekdays 2–5 pm ET`,
  );
});

test("LinkedIn hard limit removes optional hook first and refuses an oversized literal template", () => {
  const input = inputs["fill-template"].parse({
    ...fillInput,
    template: {
      channel: "linkedin_connect",
      body: "Hello {{first_name}}. {{personal_hook}}",
    },
  });
  assert.equal(
    fillTemplate(input, { personal_hook: "x".repeat(400) }).body,
    "Hello Maya. ",
  );
  assert.throws(
    () =>
      fillTemplate(
        { ...input, template: { ...input.template, body: "x".repeat(301) } },
        {},
      ),
    /300 characters/,
  );
});

test("prep brief rejects unapproved IDs and preserves approved wording", () => {
  const result = normalizeOutput(
    "prep-brief",
    {
      ...fillInput,
      approvedBank: state.questions,
      usedQuestionIds: ["demo_q1"],
    },
    {
      summary: "A chat",
      warmPathTalkingPoint: "NYU",
      companyContext: "Payments",
      picked: [
        { questionId: "demo_q6", tailoredText: "Unapproved question" },
        {
          questionId: "demo_q2",
          tailoredText: "Rewritten to change its meaning",
        },
      ],
      newQuestions: [{ text: "A new question?", category: "advice" }],
    },
  ) as {
    picked: { questionId: string; tailoredText: string }[];
    newQuestions: unknown[];
  };
  assert.equal(result.picked[0].questionId, "demo_q2");
  assert.equal(result.picked[0].tailoredText, state.questions[1].text);
  assert.ok(
    result.picked.every((q) => !["demo_q1", "demo_q6"].includes(q.questionId)),
  );
  assert.equal(result.newQuestions.length, 1);
});

test("MIME preserves Unicode, includes opt-out, and refuses header injection", () => {
  const mime = decodeBase64Url(
    buildMime({
      to: "hello@example.com",
      subject: "Café ☕ with Júlia",
      body: "Olá, café?",
    }),
  );
  assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
  const body = decodeBase64Url(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""));
  assert.match(body, /Olá, café\?/);
  assert.ok(body.includes(optOutLine));
  assert.throws(
    () =>
      buildMime({
        to: "hello@example.com",
        subject: "Hi\r\nBcc: bad@example.com",
        body: "test",
      }),
    /headers are invalid/,
  );
  const ordinaryText = decodeBase64Url(
    buildMime({
      to: "hello@example.com",
      subject: "Notes",
      body: "I prefer notebooks for notes.",
    }),
  );
  assert.ok(
    decodeBase64Url(
      ordinaryText.split("\r\n\r\n")[1].replace(/\r\n/g, ""),
    ).includes(optOutLine),
  );
});

test("reply detection excludes self, aliases, drafts, spam and messages before our outreach", () => {
  const message = (
    id: string,
    from: string,
    at: number,
    labelIds: string[] = [],
  ) => ({
    id,
    internalDate: String(at),
    labelIds,
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "From", value: from }],
      body: { data: utf8Base64(`Body ${id}`) },
    },
  });
  const replies = incomingReplies(
    {
      messages: [
        message("old", "person@example.com", 1),
        message("sent", "My Alias <alias@example.com>", 10, ["SENT"]),
        message("self", "Me <me@example.com>", 20),
        message("alias", "alias@example.com", 20),
        message("draft", "person@example.com", 20, ["DRAFT"]),
        message("spam", "person@example.com", 20, ["SPAM"]),
        message("inbound", "Person <person@example.com>", 30, ["INBOX"]),
      ],
    },
    "me@example.com",
  );
  assert.deepEqual(
    replies.map((reply) => reply.id),
    ["inbound"],
  );
  assert.equal(replies[0].text, "Body inbound");
});

test("quoted original outreach is excluded from the authored reply", () => {
  assert.equal(
    latestReplyText(
      "Yes, happy to chat!\n\nOn Friday Alex wrote:\n> Hi there\n> If you'd prefer no follow-ups, just let me know.",
    ),
    "Yes, happy to chat!",
  );
  assert.equal(
    latestReplyText(
      "No thanks, please stop contacting me.\n> Previous message",
    ),
    "No thanks, please stop contacting me.",
  );
});

test("demo AI performs no network and all fixtures remain deterministic", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("unexpected network");
  };
  try {
    assert.deepEqual(
      await aiRequest("/ai/fill-template", fillInput, state.settings),
      demoResponse("fill-template", fillInput),
    );
    const brief = demoResponse("prep-brief", {
      ...fillInput,
      approvedBank: state.questions,
    }) as { picked: { questionId: string }[] };
    assert.equal(brief.picked.length, 5);
    assert.ok(
      brief.picked.every(
        (pick) =>
          state.questions.find((q) => q.id === pick.questionId)?.status ===
          "approved",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("demo reply classification distinguishes preference from referral and requests to stop", () => {
  assert.equal(
    (
      demoResponse("classify-reply", {
        replyText: "I prefer Tuesday at 3pm.",
      }) as { intent: string }
    ).intent,
    "proposes_time",
  );
  assert.equal(
    (
      demoResponse("classify-reply", {
        replyText: "Can you stop by Tuesday?",
      }) as { intent: string }
    ).intent,
    "proposes_time",
  );
  assert.equal(
    (
      demoResponse("classify-reply", {
        replyText: "Please stop emailing me.",
      }) as { intent: string }
    ).intent,
    "not_interested",
  );
});

test("meeting validation requires explicit zone and forward interval", () => {
  assert.throws(
    () =>
      validateMeeting(
        "2026-10-25T12:00",
        "2026-10-25T12:15",
        "test@example.com",
      ),
    /time zone/,
  );
  assert.throws(
    () =>
      validateMeeting(
        "2026-10-25T12:00:00Z",
        "2026-10-25T11:00:00Z",
        "test@example.com",
      ),
    /after start/,
  );
  assert.throws(
    () =>
      validateMeeting(
        "2026-02-30T12:00:00Z",
        "2026-02-30T12:15:00Z",
        "test@example.com",
      ),
    /valid meeting/,
  );
  assert.doesNotThrow(() =>
    validateMeeting(
      "2026-10-25T12:00:00-04:00",
      "2026-10-25T12:15:00-04:00",
      "test@example.com",
    ),
  );
});

test("local API refuses foreign websites and can pin the extension origin", () => {
  const id = "a".repeat(32);
  assert.ok(isAllowedOrigin("http://127.0.0.1:5173"));
  assert.ok(isAllowedOrigin(`chrome-extension://${id}`, [id]));
  assert.ok(!isAllowedOrigin("https://example.com"));
  assert.ok(!isAllowedOrigin(`chrome-extension://${"b".repeat(32)}`, [id]));
});

const searchPlanInput = { profile: state.profile, target: state.targets[0] };
const createSearchPlan = () => ({
  summary:
    "Explore the payments team, possible NYU alumni, shared API interests, and early-career recruiting. Review each result before assuming a connection.",
  queries: [
    {
      label: "Payments team",
      query: 'Stripe payments engineers',
      rationale: "Look for people whose work relates to the team's payments APIs.",
      connectionType: "team",
    },
    {
      label: "Possible NYU alumni",
      query: 'site:linkedin.com/in/ Stripe NYU',
      rationale: "Explore whether anyone at the company shares your saved school.",
      connectionType: "alumni",
    },
    {
      label: "Shared API interests",
      query: 'Stripe TypeScript API engineers',
      rationale: "Look for work related to your supplied TypeScript and API projects.",
      connectionType: "shared_background",
    },
    {
      label: "Early-career recruiting",
      query: 'Stripe university recruiter',
      rationale: "Find people who may explain the early-career recruiting process.",
      connectionType: "recruiting",
    },
  ],
});

test("people-search plans accept diverse, bounded candidate searches with a broad query", () => {
  const plan = createSearchPlan();
  const result = normalizeOutput("people-search-plan", searchPlanInput, plan);
  assert.deepEqual(result, plan);
  const schema = outputSchema("people-search-plan", searchPlanInput) as {
    properties: { queries: { minItems: number; maxItems: number } };
  };
  assert.equal(schema.properties.queries.minItems, 3);
  assert.equal(schema.properties.queries.maxItems, 6);
  assert.ok(
    inputs["people-search-plan"].safeParse({
      ...searchPlanInput,
      target: {
        ...searchPlanInput.target,
        rawDescription: `${searchPlanInput.target.rawDescription}\nBuild low-latency fraud detection and risk tooling.`,
      },
    }).success,
  );
});

test("people-search plan bounds and exact fields are validated before use", () => {
  const invalidPlans = [
    { ...createSearchPlan(), queries: createSearchPlan().queries.slice(0, 2) },
    {
      ...createSearchPlan(),
      queries: Array.from({ length: 7 }, () => createSearchPlan().queries[0]),
    },
    { ...createSearchPlan(), summary: "x".repeat(2001) },
    { ...createSearchPlan(), url: "https://example.com" },
  ];
  for (const invalid of invalidPlans)
    assert.equal(outputs["people-search-plan"].safeParse(invalid).success, false);
  for (const [field, value] of [
    ["label", "x".repeat(101)],
    ["query", "x".repeat(501)],
    ["rationale", "x".repeat(1001)],
    ["connectionType", "verified_colleague"],
    ["query", "   "],
  ]) {
    const plan = createSearchPlan();
    plan.queries[0] = { ...plan.queries[0], [field]: value };
    assert.equal(outputs["people-search-plan"].safeParse(plan).success, false);
  }
});

test("people-search plans reject URLs, repeated searches and every-query site restrictions", () => {
  for (const query of [
    "https://example.com/redirect",
    "javascript:alert(1)",
    "linkedin.com/in/a-person",
    "Stripe\nengineers",
  ]) {
    const plan = createSearchPlan();
    plan.queries[0].query = query;
    assert.throws(
      () => normalizeOutput("people-search-plan", searchPlanInput, plan),
      /URL or invalid search text/,
    );
  }
  const duplicate = createSearchPlan();
  duplicate.queries[2].query = '"Stripe"   PAYMENTS engineers';
  assert.throws(
    () => normalizeOutput("people-search-plan", searchPlanInput, duplicate),
    /repeated the same query/,
  );
  const restricted = createSearchPlan();
  restricted.queries = restricted.queries.map(item => ({
    ...item,
    query: item.query.startsWith("site:")
      ? item.query
      : `site:linkedin.com/in/ ${item.query}`,
  }));
  assert.throws(
    () => normalizeOutput("people-search-plan", searchPlanInput, restricted),
    /broad company or team query/,
  );
});

test("people-search plans require a company/team route without school or exact long-role constraints", () => {
  const withSchool = createSearchPlan();
  withSchool.queries[0].query = "Stripe payments NYU engineers";
  assert.throws(
    () => normalizeOutput("people-search-plan", searchPlanInput, withSchool),
    /broad company or team query/,
  );
  const longRole = "Senior Software Engineer Distributed Systems Payments Infrastructure";
  const withLongRole = createSearchPlan();
  withLongRole.queries[0].query = `Stripe "${longRole}"`;
  assert.throws(
    () => normalizeOutput("people-search-plan", {
      ...searchPlanInput,
      target: { ...searchPlanInput.target, role: longRole },
    }, withLongRole),
    /broad company or team query/,
  );
});

test("sparse profiles use broad plans and cannot claim unsupported alumni/background angles", () => {
  const sparse = {
    ...searchPlanInput,
    profile: { name: "Alex", school: "", major: "", year: "", background: "", availability: "", signature: "" },
  };
  assert.throws(
    () => normalizeOutput("people-search-plan", sparse, createSearchPlan()),
    /alumni search requires/,
  );
  const plan = createSearchPlan();
  plan.queries[1] = { label: "Company perspective", query: "Stripe engineering careers", rationale: "Explore the company and its engineering staff.", connectionType: "company" };
  assert.throws(
    () => normalizeOutput("people-search-plan", sparse, plan),
    /shared-background search requires/,
  );
  plan.queries[2] = { label: "Engineering function", query: "Stripe software engineers", rationale: "Look for people in the job's general function.", connectionType: "team" };
  assert.doesNotThrow(() => normalizeOutput("people-search-plan", sparse, plan));
  const majorOnly = { ...sparse, profile: { ...sparse.profile, major: "Computer Science" } };
  plan.queries[2] = { label: "Computer science background", query: 'Stripe "Computer Science" engineer', rationale: "Explore a possible major in common, then verify profiles.", connectionType: "shared_background" };
  assert.doesNotThrow(() => normalizeOutput("people-search-plan", majorOnly, plan));
});

async function withBackend(
  config: BackendConfig,
  run: (url: string) => Promise<void>,
) {
  const server = await new Promise<Server>((resolve) => {
    const started = createApp(config).listen(0, "127.0.0.1", () =>
      resolve(started),
    );
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("API validates requests, reports missing keys, and never exposes key material", async () => {
  await withBackend({}, async (url) => {
    const invalid = await fetch(`${url}/ai/parse-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(invalid.status, 400);
    const missingKey = await fetch(`${url}/ai/parse-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawDescription:
          "Company: Test\nRole: Engineer. Build things with TypeScript.",
      }),
    });
    assert.equal(missingKey.status, 503);
    assert.match(
      ((await missingKey.json()) as { error: string }).error,
      /XAI_API_KEY/,
    );
    const denied = await fetch(`${url}/health`, {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(denied.status, 403);
  });
});

function xaiResult(output: unknown, status = "completed") {
  return {
    status,
    output: [
      { type: "reasoning", encrypted_content: "ignored-reasoning" },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify(output) }],
      },
    ],
  };
}

test("people-search API passes the full job and saved profile to Grok and validates its plan", async () => {
  let malformed = false;
  const input = {
    ...searchPlanInput,
    target: {
      ...searchPlanInput.target,
      rawDescription: `${searchPlanInput.target.rawDescription}\nFocus: low-latency fraud detection and risk tooling.`,
    },
  };
  const providerFetch = (async (providerUrl: unknown, init?: RequestInit) => {
    assert.equal(providerUrl, "https://api.x.ai/v1/responses");
    const request = JSON.parse(String(init?.body));
    const prompt = request.input[1].content as string;
    const data = JSON.parse(prompt.split("UNTRUSTED INPUT DATA:\n")[1]);
    assert.equal(data.target.rawDescription, input.target.rawDescription);
    assert.equal(data.target.role, input.target.role);
    assert.equal(data.profile.school, input.profile.school);
    assert.equal(data.profile.background, input.profile.background);
    assert.equal(request.text.format.schema.properties.queries.minItems, 3);
    assert.equal(request.text.format.schema.properties.queries.maxItems, 6);
    const plan = createSearchPlan();
    if (malformed) plan.queries[0].query = "https://example.com/direct-url";
    return new Response(JSON.stringify(xaiResult(plan)), { status: 200 });
  }) as typeof fetch;
  await withBackend({ apiKey: "synthetic-test-key", fetch: providerFetch }, async url => {
    const request = (payload: unknown) => fetch(`${url}/ai/people-search-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await request(input);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), createSearchPlan());
    malformed = true;
    const badPlan = await request(input);
    assert.equal(badPlan.status, 422);
    assert.match(await badPlan.text(), /URL or invalid search text/);
    const invalidInput = await request({ profile: input.profile });
    assert.equal(invalidInput.status, 400);
  });
});

test("API uses xAI Responses with bearer auth and strict JSON output", async () => {
  const providerFetch = (async (
    providerUrl: string | URL | Request,
    init?: RequestInit,
  ) => {
    assert.equal(providerUrl, "https://api.x.ai/v1/responses");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer server-only-test-key");
    assert.equal(headers.has("x-api-key"), false);
    assert.equal(headers.has("anthropic-version"), false);
    const request = JSON.parse(String(init?.body));
    assert.equal(request.text.format.type, "json_schema");
    assert.equal(request.text.format.strict, true);
    assert.equal(request.text.format.schema.additionalProperties, false);
    assert.ok(request.text.format.schema.properties.company);
    assert.equal(request.store, false);
    assert.equal(request.input[0].role, "system");
    assert.equal(request.input[1].role, "user");
    assert.match(request.input[1].content, /UNTRUSTED INPUT DATA/);
    assert.equal(request.model, "grok-4.7");
    assert.equal(request.tools, undefined);
    return new Response(
      JSON.stringify(
        xaiResult({
          company: "Test",
          role: "Engineer",
          skills: ["TypeScript"],
        }),
      ),
      { status: 200 },
    );
  }) as typeof fetch;
  await withBackend(
    { apiKey: "server-only-test-key", fetch: providerFetch },
    async (url) => {
      const result = await fetch(`${url}/ai/parse-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawDescription:
            "Company: Test\nRole: Engineer. Build things with TypeScript.",
        }),
      });
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), {
        company: "Test",
        role: "Engineer",
        skills: ["TypeScript"],
      });
      const health = (await (await fetch(`${url}/health`)).json()) as {
        provider: string;
        configured: boolean;
      };
      assert.equal(health.provider, "xai");
      assert.equal(health.configured, true);
      assert.ok(!JSON.stringify(health).includes("server-only-test-key"));
    },
  );
});

test("API reports xAI failure and malformed structured output without fake success", async () => {
  let malformed = false;
  const providerFetch = (async () =>
    malformed
      ? new Response(
          JSON.stringify(xaiResult({ intent: "make_something_up" })),
          { status: 200 },
        )
      : new Response(
          JSON.stringify({ error: { message: "private provider context" } }),
          { status: 401 },
        )) as typeof fetch;
  await withBackend(
    { apiKey: "server-only-test-key", fetch: providerFetch },
    async (url) => {
      const request = () =>
        fetch(`${url}/ai/classify-reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ replyText: "Yes, happy to chat." }),
        });
      const rejected = await request();
      assert.equal(rejected.status, 502);
      const error = await rejected.text();
      assert.match(error, /rejected the API key/);
      assert.ok(!error.includes("private provider context"));
      malformed = true;
      const invalid = await request();
      assert.equal(invalid.status, 502);
      assert.match(await invalid.text(), /failed validation/);
    },
  );
});

test("Grok incomplete, refused, empty and invalid JSON responses never become drafts", async () => {
  let response: unknown = xaiResult({ intent: "interested" }, "incomplete");
  const providerFetch = (async () =>
    new Response(JSON.stringify(response), { status: 200 })) as typeof fetch;
  await withBackend(
    { apiKey: "test-key", fetch: providerFetch },
    async (url) => {
      for (const invalid of [
        xaiResult({ intent: "interested" }, "incomplete"),
        {
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "refusal", refusal: "private refusal reason" }],
            },
          ],
        },
        { status: "completed", output: [] },
        {
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "invalid JSON" }],
            },
          ],
        },
      ]) {
        response = invalid;
        const result = await fetch(`${url}/ai/classify-reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ replyText: "Interested in a chat." }),
        });
        assert.equal(result.status, 422);
        const body = await result.text();
        assert.match(body, /Grok/);
        assert.ok(!body.includes("private refusal reason"));
      }
    },
  );
});

test("Grok uses the configured draft and classification models separately", async () => {
  const models: string[] = [];
  const providerFetch = (async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    models.push(request.model);
    assert.equal(request.reasoning, undefined);
    const output = request.text.format.schema.properties.intent
      ? { intent: "interested", proposedTimes: [] }
      : { company: "Test", role: "Engineer", skills: [] };
    return new Response(JSON.stringify(xaiResult(output)), { status: 200 });
  }) as typeof fetch;
  await withBackend(
    {
      apiKey: "test-key",
      draftModel: "custom-grok-draft",
      classifyModel: "custom-grok-classifier",
      fetch: providerFetch,
    },
    async (url) => {
      for (const [endpoint, payload] of [
        [
          "parse-job",
          {
            rawDescription:
              "Company: Test. Role: Software Engineer. Build APIs.",
          },
        ],
        ["classify-reply", { replyText: "Yes, interested!" }],
      ] as const) {
        const result = await fetch(`${url}/ai/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        assert.equal(result.status, 200);
      }
      assert.deepEqual(models, ["custom-grok-draft", "custom-grok-classifier"]);
    },
  );
});

test("calendar retry IDs are stable for the same contact and instant, preventing duplicate invitations", async () => {
  const { calendarEventIdFor } =
    await import("../extension/src/google/calendar");
  const id = await calendarEventIdFor(
    "contact_123",
    "2026-10-25T15:00:00Z",
    "2026-10-25T15:15:00Z",
  );
  assert.match(id, /^[a-v0-9]{5,1024}$/);
  assert.equal(
    id,
    await calendarEventIdFor(
      "contact_123",
      "2026-10-25T11:00:00-04:00",
      "2026-10-25T11:15:00-04:00",
    ),
  );
  assert.notEqual(
    id,
    await calendarEventIdFor(
      "contact_456",
      "2026-10-25T15:00:00Z",
      "2026-10-25T15:15:00Z",
    ),
  );
});

test("calendar creation recovers an existing event after an ambiguous earlier response", async (t) => {
  const { createMeeting, calendarEventIdFor } =
    await import("../extension/src/google/calendar");
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method: string; body: string }[] = [];
  const contact = {
    ...state.contacts[0],
    id: "real_contact",
    email: "recipient@real-company.com",
  };
  const start = "2026-10-25T15:00:00Z",
    end = "2026-10-25T15:15:00Z";
  const eventId = await calendarEventIdFor(contact.id, start, end);
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({
        oauth2: { client_id: "test.apps.googleusercontent.com", scopes: [] },
      }),
    },
    identity: {
      getAuthToken: (
        _details: unknown,
        callback: (token: string, scopes: string[]) => void,
      ) => callback("test-token", []),
    },
  } as unknown as typeof chrome;
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method || "GET",
      body: String(init?.body || ""),
    });
    return init?.method === "POST"
      ? new Response("{}", { status: 409 })
      : new Response(
          JSON.stringify({
            id: eventId,
            hangoutLink: "https://meet.google.com/test-meeting",
          }),
          { status: 200 },
        );
  };
  t.after(() => {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  });
  const result = await createMeeting({ contact, start, end });
  assert.equal(result.id, eventId);
  assert.equal(JSON.parse(calls[0].body).id, eventId);
  assert.equal(calls[1].method, "GET");
  assert.ok(calls[1].url.endsWith(eventId));
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});
