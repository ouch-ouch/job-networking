// HTTP routes (docs/GROK-BACKEND-SPEC.md §5). No route posts to X or sends a message.
import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { z } from 'zod';
import type { Config } from './config';
import { BackendFailure, HTTP_STATUS, toBackendFailure } from './errors';
import { cancelDiscovery, Semaphore, startDiscovery } from './jobs/runner';
import { JobStore } from './jobs/store';
import type { ModelStatus, ResearchProvider } from './provider/types';
import { ContextCache, researchPerson } from './research/person';
import { SourceRegistry } from './research/sources';
import { DiscoveryInput, DraftInput, JobContextInput, PersonResearchInput } from './schemas';
import { Budget, UsageMeter } from './usage';
import { VersionTracker } from './versions';
import { generateDraft } from './writing/draft';

export type AppDeps = {
  cfg: Config;
  provider: ResearchProvider;
  budget: Budget;
  store: JobStore;
  slots: Semaphore;
  registry: SourceRegistry;
  contexts: ContextCache;
  versions: VersionTracker;
  modelStatus: () => ModelStatus | 'checking';
  now?: () => Date;
};

export function createDeps(cfg: Config, provider: ResearchProvider, now?: () => Date): Omit<AppDeps, 'modelStatus'> {
  return {
    cfg,
    provider,
    budget: new Budget(cfg.BUDGET_USD_DAILY, now),
    store: new JobStore(cfg.JOB_TTL_MS),
    slots: new Semaphore(cfg.MAX_CONCURRENT_JOBS),
    registry: new SourceRegistry(),
    contexts: new ContextCache(now),
    versions: new VersionTracker(),
    ...(now && { now }),
  };
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function body<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new BackendFailure('invalid_input', 'Request body must be JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Field paths only; never echo submitted content.
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))].slice(0, 10);
    throw new BackendFailure('invalid_input', `Invalid fields: ${fields.join(', ')}`);
  }
  return parsed.data;
}

function requireModel(deps: AppDeps): void {
  if (deps.modelStatus() === 'not_listed') {
    throw new BackendFailure('model_unsupported', `Model ${deps.cfg.XAI_MODEL} is not available to this API key.`);
  }
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use(
    '/v1/*',
    cors({
      origin: (origin) => (deps.cfg.ALLOWED_ORIGINS.includes(origin) ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.get('/v1/health', (c) =>
    c.json({
      ok: true,
      mode: deps.provider.mode,
      model: deps.provider.mode === 'live' ? deps.cfg.XAI_MODEL : null,
      modelCheck: deps.modelStatus(),
      budget: {
        dailyLimitUsd: deps.cfg.BUDGET_USD_DAILY,
        remainingUsd: Math.round(deps.budget.remainingUsd() * 100) / 100,
        note: 'Estimates. In-flight requests can overshoot the limit slightly.',
        pricingVersion: deps.cfg.PRICING_VERSION,
      },
    }),
  );

  app.use('/v1/*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    if (!tokenMatches(c.req.header('Authorization'), deps.cfg.BACKEND_TOKEN)) {
      throw new BackendFailure('unauthorized', 'Missing or invalid backend token.');
    }
    return next();
  });

  app.post('/v1/discovery-jobs', async (c) => {
    requireModel(deps);
    const input = await body(c, DiscoveryInput);
    deps.versions.observe(input.jobContext.id, input.jobContext.version, input.profile.version);
    const job = startDiscovery(input, deps, c.req.header('Idempotency-Key') ?? undefined);
    return c.json({ jobId: job.jobId, status: job.status, mode: job.mode }, 202);
  });

  app.get('/v1/discovery-jobs/:id', (c) => {
    const record = deps.store.get(c.req.param('id'));
    if (!record) throw new BackendFailure('job_not_found', 'This research job no longer exists. Start a new search.');
    return c.json(record.job);
  });

  app.post('/v1/discovery-jobs/:id/cancel', (c) => c.json(cancelDiscovery(c.req.param('id'), deps.store)));

  app.post('/v1/person-research', async (c) => {
    requireModel(deps);
    const input = await body(c, PersonResearchInput.extend({ jobContext: JobContextInput.pick({ employer: true, title: true }) }));
    const meter = new UsageMeter(deps.cfg.PRICING_VERSION);
    const result = await researchPerson({ ...input, ...input.jobContext }, deps, meter, c.req.raw.signal);
    return c.json({ ...result, usage: meter.toJSON(), mode: deps.provider.mode });
  });

  app.post('/v1/drafts', async (c) => {
    requireModel(deps);
    const input = await body(c, DraftInput);
    const meter = new UsageMeter(deps.cfg.PRICING_VERSION);
    const draft = await generateDraft(input, deps, meter, c.req.raw.signal);
    return c.json({ draft, usage: meter.toJSON() });
  });

  app.notFound((c) => c.json({ error: { code: 'invalid_input', message: 'Unknown endpoint.', retryable: false } }, 404));

  app.onError((err, c) => {
    const failure = toBackendFailure(err);
    if (!(err instanceof BackendFailure)) console.error(JSON.stringify({ event: 'unhandled_error', name: (err as Error).name }));
    return c.json({ error: failure.toJSON() }, HTTP_STATUS[failure.code] as 400);
  });

  return app;
}
