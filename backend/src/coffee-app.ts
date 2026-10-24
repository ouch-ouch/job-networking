import express from "express";
import cors from "cors";
import { z } from "zod";
import {
  ContractError,
  inputs,
  normalizeOutput,
  outputSchema,
  type Endpoint,
} from "./contracts";
import { prompts, systemPrompt } from "./prompts";

export type BackendConfig = {
  apiKey?: string;
  draftModel?: string;
  classifyModel?: string;
  allowedExtensionIds?: string[];
  fetch?: typeof fetch;
};
export const defaultModels = {
  draft: "grok-4.7",
  classify: "grok-4.7",
};

export function isAllowedOrigin(
  origin: string | undefined,
  allowedExtensionIds: string[] = [],
) {
  if (!origin) return true; // CLI health checks and extension service workers may omit Origin.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  const extension = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  return (
    !!extension &&
    (!allowedExtensionIds.length || allowedExtensionIds.includes(extension[1]))
  );
}

export function createApp(config: BackendConfig = {}) {
  const app = express();
  const models = {
    draft: config.draftModel || defaultModels.draft,
    classify: config.classifyModel || defaultModels.classify,
  };
  app.disable("x-powered-by");
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, isAllowedOrigin(origin, config.allowedExtensionIds));
      },
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
      maxAge: 600,
    }),
  );
  app.use((req, res, next) => {
    if (!isAllowedOrigin(req.get("origin"), config.allowedExtensionIds)) {
      res.status(403).json({ error: "Origin is not allowed." });
      return;
    }
    if (req.method === "POST" && !req.is("application/json")) {
      res.status(415).json({ error: "Use application/json." });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  const requests = new Map<string, { count: number; resetAt: number }>();
  app.use("/ai", (req, res, next) => {
    const now = Date.now();
    const key = req.ip || "local";
    const current = requests.get(key);
    const bucket =
      current && current.resetAt > now
        ? current
        : { count: 0, resetAt: now + 60_000 };
    bucket.count += 1;
    requests.set(key, bucket);
    if (bucket.count > 30) {
      res
        .status(429)
        .json({ error: "Too many AI requests. Wait a minute and try again." });
      return;
    }
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({
      ok: true,
      provider: "xai",
      configured: !!config.apiKey,
      models,
    }),
  );
  app.post("/ai/:endpoint", async (req, res) => {
    const endpoint = req.params.endpoint as Endpoint;
    if (!Object.hasOwn(inputs, endpoint)) {
      res.status(404).json({ error: "Unknown AI endpoint." });
      return;
    }
    const parsed = inputs[endpoint].safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request.",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }
    if (!config.apiKey) {
      res.status(503).json({
        error:
          "Grok (xAI) API key is not configured. Add XAI_API_KEY to the backend .env and restart npm run server, or use demo mode.",
      });
      return;
    }
    try {
      const result = await (config.fetch || fetch)(
        "https://api.x.ai/v1/responses",
        {
          method: "POST",
          signal: AbortSignal.timeout(60_000),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model:
              endpoint === "classify-reply" ? models.classify : models.draft,
            max_output_tokens: 8192,
            store: false,
            ...((endpoint === "classify-reply"
              ? models.classify
              : models.draft) === "grok-4.7"
              ? { reasoning: { effort: "low" } }
              : {}),
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
        },
      );
      if (!result.ok) {
        const message =
          result.status === 401 || result.status === 403
            ? "Grok (xAI) rejected the API key. Check XAI_API_KEY and restart the backend."
            : result.status === 429
              ? "Grok (xAI) rate limit or billing limit reached. Check your API account and try again."
              : result.status === 404
                ? "The configured Grok (xAI) model is unavailable for this account. Check the model names in .env."
                : `Grok (xAI) request failed (${result.status}). Check your API account and try again.`;
        res.status(result.status === 429 ? 429 : 502).json({ error: message });
        return;
      }
      const envelope = z
        .object({
          status: z.string(),
          output: z.array(
            z.object({
              type: z.string(),
              role: z.string().optional(),
              content: z
                .array(
                  z.object({
                    type: z.string(),
                    text: z.string().optional(),
                  }),
                )
                .optional(),
            }),
          ),
        })
        .parse(await result.json());
      if (envelope.status !== "completed")
        throw new ContractError(
          "Grok did not complete a structured response. Try again.",
        );
      const content = envelope.output
        .filter((item) => item.type === "message" && item.role === "assistant")
        .flatMap((item) => item.content || []);
      if (content.some((item) => item.type === "refusal"))
        throw new ContractError(
          "Grok could not complete this request. Review the supplied context and try again.",
        );
      const json = content
        .filter((item) => item.type === "output_text")
        .map((item) => item.text || "")
        .join("");
      if (!json.trim())
        throw new ContractError(
          "Grok returned no structured result. Try again.",
        );
      let output: unknown;
      try {
        output = JSON.parse(json);
      } catch {
        throw new ContractError("Grok returned invalid JSON. Try again.");
      }
      res.json(normalizeOutput(endpoint, parsed.data, output));
    } catch (error) {
      if (error instanceof ContractError) {
        res.status(422).json({ error: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(502).json({
          error: "AI returned fields that failed validation. Try again.",
        });
        return;
      }
      res.status(502).json({
        error:
          "Could not reach Grok (xAI) or the request timed out. Check the backend connection and try again.",
      });
    }
  });
  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  app.use(
    (
      error: { type?: string; status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.type === "entity.too.large" ? 413 : 400).json({
        error:
          error.type === "entity.too.large"
            ? "Request is too large (maximum 256 KB)."
            : "Invalid JSON request.",
      });
    },
  );
  return app;
}
