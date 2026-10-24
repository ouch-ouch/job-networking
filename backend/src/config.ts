import { z } from 'zod';

const Env = z
  .object({
    PORT: z.coerce.number().int().positive().default(8787),
    PROVIDER_MODE: z.enum(['live', 'fixture']).default('live'),
    XAI_API_KEY: z.string().optional(),
    XAI_BASE_URL: z.string().url().default('https://api.x.ai/v1'),
    XAI_MODEL: z.string().min(1).default('grok-4.7'),
    BACKEND_TOKEN: z.string().min(16, 'BACKEND_TOKEN must be at least 16 characters'),
    ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
    BUDGET_USD_DAILY: z.coerce.number().nonnegative().default(5),
    EST_SEARCH_CALL_USD: z.coerce.number().nonnegative().default(0.25),
    EST_GENERATION_CALL_USD: z.coerce.number().nonnegative().default(0.05),
    PRICING_VERSION: z.string().default('xai-docs-2026-10-24'),
    MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(2),
    PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(150_000),
    JOB_TTL_MS: z.coerce.number().int().positive().default(2 * 60 * 60 * 1000),
    X_REPLY_LIMIT: z.coerce.number().int().positive().default(280),
  })
  .refine((e) => e.PROVIDER_MODE === 'fixture' || !!e.XAI_API_KEY, {
    message: 'XAI_API_KEY is required when PROVIDER_MODE=live',
    path: ['XAI_API_KEY'],
  });

export type Config = z.infer<typeof Env>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return parsed.data;
}
