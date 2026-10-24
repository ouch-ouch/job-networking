import { serve } from '@hono/node-server';

// One .env for the whole repo, at the root. Variables already set in the shell win.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // No root .env: fall back to the shell environment.
}
import { loadConfig } from './config';
import { FixtureResearchProvider } from './provider/fixture';
import type { ModelStatus } from './provider/types';
import { XaiResearchProvider } from './provider/xai';
import { createApp, createDeps } from './server';

const cfg = loadConfig();
const provider = cfg.PROVIDER_MODE === 'fixture' ? new FixtureResearchProvider() : new XaiResearchProvider(cfg);

let modelStatus: ModelStatus | 'checking' = 'checking';
void provider.checkModel().then((status) => {
  modelStatus = status;
  const level = status === 'not_listed' ? 'error' : 'log';
  console[level](JSON.stringify({ event: 'model_check', mode: provider.mode, model: cfg.XAI_MODEL, status }));
});

const app = createApp({ ...createDeps(cfg, provider), modelStatus: () => modelStatus });

serve({ fetch: app.fetch, port: cfg.PORT }, ({ port }) => {
  console.log(JSON.stringify({ event: 'listening', port, mode: provider.mode }));
  if (provider.mode === 'fixture') console.log('FIXTURE MODE: responses are demo data labeled mode: "fixture".');
});
