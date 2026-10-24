import { z } from "zod/v4";

const text = z.string().max(20_000);
const short = z.string().max(1000);
export const categories = [
  "role",
  "team",
  "career_path",
  "culture",
  "recruiting",
  "advice",
] as const;
const profile = z.object({
  name: short,
  school: short,
  major: short,
  year: short,
  background: text,
  availability: text,
  signature: text,
});
const template = z.object({
  id: short.optional(),
  name: short.optional(),
  channel: z.enum(["email", "linkedin_connect", "linkedin_message", "x"]),
  subject: short.optional(),
  body: text.min(1),
});
const target = z.object({
  id: short.optional(),
  company: short,
  role: short,
  team: short.optional(),
  location: short.optional(),
  skills: z.array(short).max(100),
  rawDescription: text.optional(),
  url: short.optional(),
  domain: short.optional(),
});
const contact = z
  .object({
    id: short.optional(),
    name: short.min(1),
    title: short,
    company: short,
    warmPaths: z
      .array(z.object({ type: short, detail: short }))
      .max(50)
      .default([]),
    reason: short.optional(),
    notes: text.optional(),
  })
  .passthrough();
const question = z
  .object({
    id: short,
    text: short.min(1),
    category: z.enum(categories),
    status: z.enum(["approved", "suggested", "skipped"]),
    timesUsed: z.number().optional(),
  })
  .passthrough();
const draft = z
  .object({
    subject: short.optional(),
    body: text.min(1),
    channel: z
      .enum(["email", "linkedin_connect", "linkedin_message", "x"])
      .optional(),
  })
  .passthrough();
const proposedTimes = z.array(short).max(20).optional();
export const searchConnectionTypes = [
  "alumni",
  "shared_background",
  "team",
  "recruiting",
  "company",
] as const;
export const inputs = {
  "parse-job": z.object({ rawDescription: text.min(20) }),
  "people-search-plan": z.object({
    profile,
    target: target.extend({ company: short.trim().min(1) }),
  }),
  "fill-template": z.object({ template, profile, target, contact }),
  "follow-up": z.object({
    originalDraft: draft,
    followUpCount: z.number().int().min(0).max(2),
    daysSince: z.number().min(0).max(3650),
    contact,
    profile: profile.optional(),
  }),
  "classify-reply": z.object({ replyText: text.min(1) }),
  "schedule-reply": z.object({
    replyText: text.min(1),
    availability: text,
    proposedTimes,
    contact: contact.optional(),
  }),
  "suggest-questions": z.object({
    profile,
    targets: z.array(target).max(50),
    existingBank: z.array(question).max(500),
  }),
  "prep-brief": z.object({
    contact,
    target: target.optional(),
    profile,
    approvedBank: z.array(question).max(500),
    usedQuestionIds: z.array(short).max(500).optional(),
  }),
  "thank-you": z.object({
    contact,
    target: target.optional(),
    userNotes: text,
    profile: profile.optional(),
  }),
};
export type Endpoint = keyof typeof inputs;
export const outputs = {
  "people-search-plan": z
    .object({
      summary: z.string().trim().min(1).max(2000),
      queries: z
        .array(
          z
            .object({
              label: z.string().trim().min(1).max(100),
              query: z.string().trim().min(1).max(500),
              rationale: z.string().trim().min(1).max(1000),
              connectionType: z.enum(searchConnectionTypes),
            })
            .strict(),
        )
        .min(3)
        .max(6),
    })
    .strict(),
  "parse-job": z.object({
    company: short.min(1),
    role: short.min(1),
    team: short.optional(),
    location: short.optional(),
    skills: z.array(short).max(100),
  }),
  "fill-template": z.object({
    subject: short.optional(),
    body: text.min(1),
    filledKeywords: z.record(z.string(), text),
  }),
  "follow-up": z.object({ subject: short.optional(), body: text.min(1) }),
  "classify-reply": z.object({
    intent: z.enum([
      "interested",
      "proposes_time",
      "not_interested",
      "referral",
      "ooo",
    ]),
    proposedTimes,
  }),
  "schedule-reply": z.object({
    body: text.min(1),
    chosenSlot: z
      .object({
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
      })
      .optional(),
  }),
  "suggest-questions": z.object({
    questions: z
      .array(z.object({ text: short.min(1), category: z.enum(categories) }))
      .min(1)
      .max(10),
  }),
  "prep-brief": z.object({
    summary: text,
    warmPathTalkingPoint: text,
    companyContext: text,
    picked: z
      .array(z.object({ questionId: short, tailoredText: short }))
      .max(5),
    newQuestions: z
      .array(z.object({ text: short.min(1), category: z.enum(categories) }))
      .max(5)
      .optional(),
  }),
  "thank-you": z.object({
    subject: short,
    body: text.min(1),
    referralAsk: text,
  }),
};

type JsonSchema = Record<string, unknown>;
const str: JsonSchema = { type: "string" };
const array = (items: JsonSchema): JsonSchema => ({ type: "array", items });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const suggestedQuestion = obj({
  text: str,
  category: { type: "string", enum: [...categories] },
});
export function outputSchema(endpoint: Endpoint, input: unknown): JsonSchema {
  switch (endpoint) {
    case "people-search-plan":
      return obj({
        summary: { type: "string", minLength: 1, maxLength: 2000 },
        queries: {
          type: "array",
          minItems: 3,
          maxItems: 6,
          items: obj({
            label: { type: "string", minLength: 1, maxLength: 100 },
            query: { type: "string", minLength: 1, maxLength: 500 },
            rationale: { type: "string", minLength: 1, maxLength: 1000 },
            connectionType: {
              type: "string",
              enum: [...searchConnectionTypes],
            },
          }),
        },
      });
    case "parse-job":
      return obj({
        company: str,
        role: str,
        team: str,
        location: str,
        skills: array(str),
      });
    case "fill-template": {
      const parsed = inputs["fill-template"].parse(input);
      const keywords = [
        ...new Set(
          Array.from(
            `${parsed.template.subject || ""} ${parsed.template.body}`.matchAll(
              /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
            ),
            (match) => match[1],
          ),
        ),
      ];
      return obj({
        filledKeywords: obj(
          Object.fromEntries(keywords.map((keyword) => [keyword, str])),
        ),
      });
    }
    case "follow-up":
      return obj({ subject: str, body: str });
    case "classify-reply":
      return obj({
        intent: {
          type: "string",
          enum: [
            "interested",
            "proposes_time",
            "not_interested",
            "referral",
            "ooo",
          ],
        },
        proposedTimes: array(str),
      });
    case "schedule-reply":
      return obj({
        body: str,
        chosenSlot: {
          anyOf: [obj({ start: str, end: str }), { type: "null" }],
        },
      });
    case "suggest-questions":
      return obj({ questions: array(suggestedQuestion) });
    case "prep-brief":
      return obj({
        summary: str,
        warmPathTalkingPoint: str,
        companyContext: str,
        picked: array(obj({ questionId: str, tailoredText: str })),
        newQuestions: array(suggestedQuestion),
      });
    case "thank-you":
      return obj({ subject: str, body: str, referralAsk: str });
  }
}

export class ContractError extends Error {}

// Literal template text is assembled here, never entrusted to a model rewrite.
export function fillTemplate(
  input: z.infer<(typeof inputs)["fill-template"]>,
  replacements: Record<string, string>,
) {
  const { template: tpl, profile: p, target: t, contact: c } = input;
  const known: Record<string, string> = {
    first_name: c.name.split(/\s+/)[0],
    name: c.name,
    their_name: c.name,
    my_name: p.name,
    my_school: p.school,
    school: p.school,
    my_year: p.year,
    my_major: p.major,
    company: t.company,
    role: t.role,
    team: t.team || "",
    their_team: c.title.split(",").slice(1).join(",").trim() || c.title,
    their_title: c.title,
    location: t.location || "",
    skills: t.skills.join(", "),
    availability: p.availability,
    my_availability: p.availability,
    signature: p.signature,
    background: p.background,
  };
  const filledKeywords: Record<string, string> = {};
  const replace = (source: string) =>
    source.replace(
      /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
      (_match, keyword: string) => {
        const value = known[keyword] ?? replacements[keyword];
        if (
          typeof value !== "string" ||
          (!Object.hasOwn(known, keyword) &&
            keyword !== "personal_hook" &&
            !value.trim())
        )
          throw new ContractError(
            `No value for {{${keyword}}}. Add context or edit the template.`,
          );
        filledKeywords[keyword] = value;
        return value;
      },
    );
  let body = replace(tpl.body);
  const subject = tpl.subject === undefined ? undefined : replace(tpl.subject);
  if (/\{\{|\}\}/.test(body + (subject || "")))
    throw new ContractError(
      "A template placeholder is unresolved or malformed. Use {{keyword}} names and try again.",
    );
  if (
    tpl.channel === "linkedin_connect" &&
    body.length > 300 &&
    filledKeywords.personal_hook
  ) {
    replacements = { ...replacements, personal_hook: "" };
    body = replace(tpl.body);
  }
  if (tpl.channel === "linkedin_connect" && body.length > 300)
    throw new ContractError(
      "This connection template exceeds 300 characters after filling. Shorten the template before generating.",
    );
  return {
    ...(subject === undefined ? {} : { subject }),
    body,
    filledKeywords,
  };
}

export function normalizeOutput(
  endpoint: Endpoint,
  input: unknown,
  output: unknown,
): unknown {
  if (!output || typeof output !== "object")
    throw new ContractError("AI returned an invalid response. Try again.");
  const candidate = { ...output } as Record<string, unknown>;
  if (endpoint === "fill-template") {
    const replacements = z
      .record(z.string(), text)
      .parse(candidate.filledKeywords);
    return outputs[endpoint].parse(
      fillTemplate(inputs[endpoint].parse(input), replacements),
    );
  }
  if (endpoint === "schedule-reply" && candidate.chosenSlot === null)
    delete candidate.chosenSlot;
  const parsed = outputs[endpoint].parse(candidate);
  if (endpoint === "people-search-plan") {
    const data = inputs[endpoint].parse(input);
    const result = parsed as z.infer<
      (typeof outputs)["people-search-plan"]
    >;
    const meaningful = (value: string | undefined) =>
      !!value?.trim() &&
      !/^(?:not specified|unknown|n\/?a|none)$/i.test(value.trim());
    const normalized = (value: string) =>
      value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const school = normalized(data.profile.school);
    const company = normalized(data.target.company);
    const role = normalized(data.target.role);
    const seen = new Set<string>();
    for (const item of result.queries) {
      if (
        /[\u0000-\u001f\u007f]/.test(item.query) ||
        /\b[a-z][a-z0-9+.-]*:\/\//i.test(item.query) ||
        /^(?:javascript|data|file|mailto):/i.test(item.query) ||
        /^(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(
          item.query,
        )
      )
        throw new ContractError(
          "The people-search plan contained a URL or invalid search text. Try generating it again.",
        );
      item.query = item.query.replace(/\s+/g, " ").trim();
      const key = normalized(item.query);
      if (seen.has(key))
        throw new ContractError(
          "The people-search plan repeated the same query. Try generating a more varied plan.",
        );
      seen.add(key);
      if (
        item.connectionType === "alumni" &&
        (!meaningful(data.profile.school) ||
          !normalized(item.query).includes(school))
      )
        throw new ContractError(
          "An alumni search requires your saved school in the query. Add your school or regenerate a broader plan.",
        );
      if (
        item.connectionType === "shared_background" &&
        !meaningful(data.profile.major) &&
        !meaningful(data.profile.background) &&
        !meaningful(data.profile.school) &&
        !meaningful(data.profile.year)
      )
        throw new ContractError(
          "A shared-background search requires saved school, major, year, or background details. Add them or regenerate a broader plan.",
        );
    }
    const broadQuery = result.queries.some((item) => {
      const query = normalized(item.query);
      return (
        ["company", "team"].includes(item.connectionType) &&
        !/\bsite\s*:/i.test(item.query) &&
        (!meaningful(data.target.company) || query.includes(company)) &&
        (!meaningful(data.profile.school) ||
          school === company ||
          !query.includes(school)) &&
        !(role.split(" ").length > 5 && query.includes(role))
      );
    });
    if (!broadQuery)
      throw new ContractError(
        "The people-search plan needs one broad company or team query without school or site restrictions. Try generating it again.",
      );
  }
  if (endpoint === "schedule-reply") {
    const { chosenSlot } = parsed as z.infer<
      (typeof outputs)["schedule-reply"]
    >;
    if (
      chosenSlot &&
      Date.parse(chosenSlot.end) <= Date.parse(chosenSlot.start)
    )
      throw new ContractError(
        "AI proposed an invalid meeting interval. Choose a time manually.",
      );
  }
  if (endpoint === "follow-up") {
    const original = inputs[endpoint].parse(input).originalDraft;
    if (
      original.channel === "linkedin_connect" &&
      (parsed as { body: string }).body.length > 300
    )
      throw new ContractError(
        "AI connection note exceeds 300 characters. Shorten it and try again.",
      );
  }
  if (endpoint === "suggest-questions") {
    const existing = new Set(
      inputs[endpoint]
        .parse(input)
        .existingBank.map((q) => q.text.trim().toLowerCase()),
    );
    const result = parsed as z.infer<(typeof outputs)["suggest-questions"]>;
    result.questions = result.questions.filter((q) => {
      const key = q.text.trim().toLowerCase();
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    if (!result.questions.length)
      throw new ContractError(
        "All suggestions duplicate your bank. Try again with more context.",
      );
  }
  if (endpoint === "prep-brief") {
    const data = inputs[endpoint].parse(input);
    const eligible = data.approvedBank.filter(
      (q) => q.status === "approved" && !data.usedQuestionIds?.includes(q.id),
    );
    const bank = new Map(eligible.map((q) => [q.id, q]));
    const result = parsed as z.infer<(typeof outputs)["prep-brief"]>;
    const selected = [
      ...new Set([
        ...result.picked.map((q) => q.questionId),
        ...eligible.map((q) => q.id),
      ]),
    ]
      .filter((id) => bank.has(id))
      .slice(0, 5);
    // Preserve approved wording. Template placeholders may supply specific context.
    result.picked = selected.map((questionId) => ({
      questionId,
      tailoredText: bank
        .get(questionId)!
        .text.replace(
          /\{\{\s*(company|role|team)\s*\}\}/g,
          (_match, field: "company" | "role" | "team") =>
            data.target?.[field] || field,
        ),
    }));
    result.newQuestions = (result.newQuestions || []).slice(
      0,
      Math.max(0, 5 - result.picked.length),
    );
  }
  return parsed;
}
