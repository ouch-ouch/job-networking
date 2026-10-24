// Coffee-chat AI routes (Julia's /ai/* endpoints), mounted on the main Hono app.
// Template filling, question suggestions, prep briefs, job parsing, reply handling.
// Each call is one Grok request with strict JSON Schema output, validated in code.
// Like the /v1 routes, nothing here sends a message or takes an external action.
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod/v4";
import { ContractError, inputs, normalizeOutput, outputSchema, type Endpoint } from "./contracts";
import { prompts, systemPrompt } from "./prompts";

export type CoffeeConfig = {
  apiKey?: string;
  draftModel?: string;
  classifyModel?: string;
  allowedExtensionIds?: string[];
  fetch?: typeof fetch;
};

export const defaultModels = { draft: "grok-4.7", classify: "grok-4.7" };

export function isAllowedOrigin(origin: string | undefined, allowedExtensionIds: string[] = []) {
  if (!origin) return true; // CLI health checks and extension service workers may omit Origin.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  const extension = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  return !!extension && (!allowedExtensionIds.length || allowedExtensionIds.includes(extension[1]));
}

const Envelope = z.object({
  status: z.string(),
  output: z.array(
    z.object({
      type: z.string(),
      role: z.string().optional(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
    }),
  ),
});

function providerError(status: number): string {
  if (status === 401 || status === 403) return "Grok (xAI) rejected the API key. Check XAI_API_KEY and restart the backend.";
  if (status === 429) return "Grok (xAI) rate limit or billing limit reached. Check your API account and try again.";
  if (status === 404) return "The configured Grok (xAI) model is unavailable for this account. Check the model names in .env.";
  return `Grok (xAI) request failed (${status}). Check your API account and try again.`;
}

export function mountCoffeeRoutes(app: Hono, config: CoffeeConfig, extra: () => Record<string, unknown> = () => ({})) {
  const models = {
    draft: config.draftModel || defaultModels.draft,
    classify: config.classifyModel || defaultModels.classify,
  };
  const allowed = (origin: string | undefined) => isAllowedOrigin(origin, config.allowedExtensionIds);

  for (const path of ["/health", "/ai/*"]) {
    app.use(
      path,
      cors({
        origin: (origin) => (allowed(origin) ? origin : null),
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type"],
        maxAge: 600,
      }),
    );
    app.use(path, async (c, next) => {
      if (!allowed(c.req.header("origin"))) return c.json({ error: "Origin is not allowed." }, 403);
      return next();
    });
  }

  const requests = new Map<string, { count: number; resetAt: number }>();
  app.use("/ai/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    if (c.req.method === "POST" && !c.req.header("content-type")?.includes("application/json"))
      return c.json({ error: "Use application/json." }, 415);
    const now = Date.now();
    const key = c.req.header("x-forwarded-for") || "local";
    const current = requests.get(key);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + 60_000 };
    bucket.count += 1;
    requests.set(key, bucket);
    if (bucket.count > 30) return c.json({ error: "Too many AI requests. Wait a minute and try again." }, 429);
    return next();
  });
  app.use(
    "/ai/*",
    bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: "Request is too large (maximum 256 KB)." }, 413) }),
  );

  app.get("/health", (c) => c.json({ ok: true, provider: "xai", configured: !!config.apiKey, models, ...extra() }));

  app.post("/ai/:endpoint", async (c) => {
    const endpoint = c.req.param("endpoint") as Endpoint;
    if (!Object.hasOwn(inputs, endpoint)) return c.json({ error: "Unknown AI endpoint." }, 404);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON request." }, 400);
    }
    const parsed = inputs[endpoint].safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid request.",
          details: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
        },
        400,
      );
    }
    if (!config.apiKey) {
      return c.json(
        {
          error:
            "Grok (xAI) API key is not configured. Add XAI_API_KEY to .env and restart npm run server, or use demo mode.",
        },
        503,
      );
    }
    const model = endpoint === "classify-reply" ? models.classify : models.draft;
    try {
      const result = await (config.fetch || fetch)("https://api.x.ai/v1/responses", {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model,
          max_output_tokens: 8192,
          store: false,
          ...(model === "grok-4.7" ? { reasoning: { effort: "low" } } : {}),
          input: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `${prompts[endpoint]}\n\nUNTRUSTED INPUT DATA:\n${JSON.stringify(parsed.data)}`,
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "coffee_chat_result",
              strict: true,
              schema: outputSchema(endpoint, parsed.data),
            },
          },
        }),
      });
      if (!result.ok) return c.json({ error: providerError(result.status) }, result.status === 429 ? 429 : 502);
      const envelope = Envelope.parse(await result.json());
      if (envelope.status !== "completed")
        throw new ContractError("Grok did not complete a structured response. Try again.");
      const content = envelope.output
        .filter((item) => item.type === "message" && item.role === "assistant")
        .flatMap((item) => item.content || []);
      if (content.some((item) => item.type === "refusal"))
        throw new ContractError("Grok could not complete this request. Review the supplied context and try again.");
      const json = content
        .filter((item) => item.type === "output_text")
        .map((item) => item.text || "")
        .join("");
      if (!json.trim()) throw new ContractError("Grok returned no structured result. Try again.");
      let output: unknown;
      try {
        output = JSON.parse(json);
      } catch {
        throw new ContractError("Grok returned invalid JSON. Try again.");
      }
      return c.json(normalizeOutput(endpoint, parsed.data, output) as Record<string, unknown>);
    } catch (error) {
      if (error instanceof ContractError) return c.json({ error: error.message }, 422);
      if (error instanceof z.ZodError)
        return c.json({ error: "AI returned fields that failed validation. Try again." }, 502);
      return c.json(
        { error: "Could not reach Grok (xAI) or the request timed out. Check the backend connection and try again." },
        502,
      );
    }
  });
}
