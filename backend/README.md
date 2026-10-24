# networkMAX Grok backend

Finds relevant people on X for a job, reads a selected person's recent public conversation, and writes a person-specific draft. Built to [docs/GROK-BACKEND-SPEC.md](../docs/GROK-BACKEND-SPEC.md). It never posts, replies, likes, follows, or sends anything on X.

## Run

From the **repo root** (this folder is an npm workspace; there is one install and one `.env`):

```bash
npm install
cp .env.example .env        # set BACKEND_TOKEN; set XAI_API_KEY for live mode
npm run server              # http://127.0.0.1:8787, reads the root .env
```

The same server also hosts the coffee-chat AI routes (`/health`, `/ai/*`: template filling, questions, prep briefs) in `src/coffee/`.

To run without an xAI key, use `PROVIDER_MODE=fixture`. Fixture responses are demo data and carry `mode: "fixture"`; label them as such in the UI.

```bash
npm test          # unit + API tests (fixture and mocked xAI, no network)
npm run typecheck
```

## Endpoints

All routes except `/v1/health` need `Authorization: Bearer $BACKEND_TOKEN`.

| Route | Extension message | Notes |
| --- | --- | --- |
| `POST /v1/discovery-jobs` | `START_RESEARCH` | 202 `{ jobId }`; optional `Idempotency-Key` header |
| `GET /v1/discovery-jobs/:id` | `GET_RESEARCH` | Poll every ~2 s; partial results appear as searches finish |
| `POST /v1/discovery-jobs/:id/cancel` | `CANCEL_RESEARCH` | Keeps completed results |
| `POST /v1/person-research` | part of `GENERATE_DRAFT` | Recent threads + style evidence; cached 7 days |
| `POST /v1/drafts` | `GENERATE_DRAFT` | Validated draft with fact/source IDs, approach, warnings |
| `GET /v1/health` | — | Mode, model check, remaining budget |

Request and response types are in `src/schemas.ts`. Errors are `{ error: { code, message, retryable, retryAfterMs? } }`.

## Layout

```text
src/
  server.ts             routes, auth, CORS, error mapping
  config.ts             env parsing
  schemas.ts            contracts + model-output schemas
  usage.ts              budget, retries, per-call timeout
  jobs/                 in-memory job store, runner, concurrency limit
  provider/xai.ts       xAI Responses API + x_search
  provider/fixture.ts   labeled demo provider
  provider/prompts.ts   model instructions (rules, not message templates)
  research/             query planning, citation-based sources, scoring, person research
  writing/              drafting and draft validation
```

## Hackathon limits

- Jobs, sources, and research caches live in memory. Run **one instance**; a restart loses jobs (clients get `job_not_found`).
- `BACKEND_TOKEN` is a shared secret, not user authentication.
- Budget amounts are conservative per-call reservations. A call is charged the larger of the reservation and any provider-reported cost.
- The live xAI path is covered by tests against a mocked HTTP layer only. Before the demo, run one real discovery with a small `BUDGET_USD_DAILY` to confirm the account has `x_search` access and the response shape matches.
