import { loadConfig, type Config } from '../src/config';
import type { ResearchProvider } from '../src/provider/types';
import { createApp, createDeps, type AppDeps } from '../src/server';

export const TOKEN = 'test-token-0123456789';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({ PROVIDER_MODE: 'fixture', BACKEND_TOKEN: TOKEN, ALLOWED_ORIGINS: 'chrome-extension://abc', ...overrides });
}

export function makeApp(provider: ResearchProvider, cfgOverrides: Record<string, string> = {}) {
  const cfg = testConfig(cfgOverrides);
  const deps: AppDeps = { ...createDeps(cfg, provider), modelStatus: () => 'fixture' };
  const app = createApp(deps);
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...headers },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: res.status, json: () => res.json() as Promise<any> };
  };
  return { app, deps, call };
}

export const job = {
  id: 'job_acme_123',
  version: 'v1',
  employer: 'Acme',
  employerDomain: 'acme.com',
  title: 'Backend Engineer, Platform',
  location: 'New York, NY',
  description:
    'Build and operate distributed backend services. Requirements: Go or Rust, Kubernetes, latency and reliability work, observability, queues and retries.',
  canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/123',
};

export const profile = {
  version: 'p1',
  facts: [
    { id: 'f_retry', text: 'Built a retry budget for a Go service that cut p99 latency under partial outages', kind: 'project' },
    { id: 'f_k8s', text: 'Operated Kubernetes clusters for a student research lab', kind: 'experience' },
    { id: 'f_school', text: 'BS Computer Science, NYU', kind: 'education' },
  ],
  targetRoles: ['Backend Engineer'],
};

export async function waitForJob(call: ReturnType<typeof makeApp>['call'], jobId: string) {
  for (let i = 0; i < 100; i++) {
    const res = await call('GET', `/v1/discovery-jobs/${jobId}`);
    const body = await res.json();
    if (!['queued', 'running'].includes(body.status)) return body;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('job did not finish');
}
