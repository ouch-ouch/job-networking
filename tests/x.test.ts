import test from "node:test";
import assert from "node:assert/strict";
import { discoverOnX } from "../extension/src/shared/x";
import { createDemoState } from "../extension/src/shared/mock";

const sample = () => ({
  recommendations: [{
    personId: "person", handle: "test_person", displayName: "Test Person",
    category: "practitioner", affiliation: { claim: "Engineer" },
    relevance: "Works on public API projects", openingSourceId: "post",
    score: { total: 88 }, uncertainties: [],
  }],
  sources: [{ id: "post", url: "https://x.com/test_person/status/123", kind: "post", excerpt: "A synthetic public post, never broadcast." }],
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const inputs = () => { const state = createDemoState(); return { target: state.targets[0], profile: state.profile }; };

async function withFetch(mock: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = original; }
}

test("X discovery returns failed-zero backend errors without an automatic paid retry", async () => {
  const { target, profile } = inputs();
  let posts = 0;
  let gets = 0;
  await withFetch(async (_url, options) => {
    assert.ok(options?.signal instanceof AbortSignal);
    if (options?.method === "POST") { posts++; return json({ jobId: "job" }, 202); }
    gets++;
    return json({ status: "failed", error: { message: "Provider search timed out before any usable results." }, recommendations: [] });
  }, async () => {
    await assert.rejects(discoverOnX(target, profile, "http://backend.test", async () => {}), /Provider search timed out before any usable results/);
  });
  assert.equal(posts, 1);
  assert.equal(gets, 1);
});

test("X discovery keeps partial contacts, backend warning, and terminal cancellation", async () => {
  const { target, profile } = inputs();
  for (const status of ["partial", "cancelled", "failed"] as const) {
    let requests = 0;
    await withFetch(async () => ++requests === 1 ? json({ jobId: "job" }, 202) : json({ status, error: { message: "A search stopped early." }, ...sample() }), async () => {
      const result = await discoverOnX(target, profile, "http://backend.test", async () => {});
      assert.equal(result.status, status === "failed" ? "partial" : status);
      assert.equal(result.contacts.length, 1);
      assert.equal(result.contacts[0].xHandle, "test_person");
      assert.equal(result.warning, "A search stopped early.");
    });
  }
});

test("X discovery broadcasts only stage metadata and counts on every poll", async () => {
  const { target, profile } = inputs();
  const globals = globalThis as unknown as { chrome?: unknown; window?: unknown; CustomEvent?: unknown };
  const previousChrome = globals.chrome;
  const previousWindow = globals.window;
  const previousCustomEvent = globals.CustomEvent;
  const runtimeMessages: unknown[] = [];
  const windowEvents: { type: string; detail: unknown }[] = [];
  globals.chrome = { runtime: { sendMessage: (message: unknown) => { runtimeMessages.push(message); return Promise.resolve(); } } };
  globals.CustomEvent = class { constructor(public type: string, public detailOptions: { detail: unknown }) {} get detail() { return this.detailOptions.detail; } };
  globals.window = { dispatchEvent: (event: { type: string; detail: unknown }) => { windowEvents.push(event); return true; } };
  let requests = 0;
  try {
    await withFetch(async () => {
      requests++;
      if (requests === 1) return json({ jobId: "job", status: "queued" }, 202);
      return json({ status: requests === 2 ? "running" : "succeeded", progress: { stage: requests === 2 ? "searching" : "done", message: requests === 2 ? "Finished one search." : "Found one person." }, ...sample() });
    }, async () => {
      const result = await discoverOnX(target, profile, "http://backend.test", async () => {});
      assert.equal(result.status, "succeeded");
    });
    assert.equal(runtimeMessages.length, 3);
    assert.equal(windowEvents.length, 3);
    assert.deepEqual(runtimeMessages[1], { type: "CCC_X_RESEARCH_PROGRESS", targetId: target.id, progress: { stage: "searching", message: "Finished one search.", completed: 1 } });
    assert.equal(windowEvents[1].type, "ccc-x-research-progress");
    assert.deepEqual(windowEvents[1].detail, { targetId: target.id, progress: { stage: "searching", message: "Finished one search.", completed: 1 } });
    const serialized = JSON.stringify(runtimeMessages);
    assert.ok(!serialized.includes(profile.background));
    assert.ok(!serialized.includes("synthetic public post"));
    assert.ok(!serialized.includes("test_person"));
  } finally { globals.chrome = previousChrome; globals.window = previousWindow; globals.CustomEvent = previousCustomEvent; }
});

test("X discovery uses a 10-second request timeout and does not retry a timed-out paid request", async () => {
  const { target, profile } = inputs();
  const originalTimeout = AbortSignal.timeout;
  let requests = 0;
  let timeoutMs = 0;
  AbortSignal.timeout = (ms: number) => {
    timeoutMs = ms;
    const controller = new AbortController();
    queueMicrotask(() => controller.abort(new DOMException("Synthetic timeout", "TimeoutError")));
    return controller.signal;
  };
  try {
    await withFetch(async (_url, options) => {
      requests++;
      return new Promise<Response>((_resolve, reject) => {
        if (options?.signal?.aborted) reject(options.signal.reason);
        else options?.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
      });
    }, async () => {
      await assert.rejects(discoverOnX(target, profile, "http://backend.test", async () => {}), /timed out.*no automatic retry/);
    });
    assert.equal(timeoutMs, 10_000);
    assert.equal(requests, 1);
  } finally { AbortSignal.timeout = originalTimeout; }
});

test("X discovery keeps completed results if a later status poll becomes unavailable", async () => {
  const { target, profile } = inputs();
  let requests = 0;
  let posts = 0;
  await withFetch(async (_url, options) => {
    requests++;
    if (options?.method === "POST") { posts++; return json({ jobId: "job" }, 202); }
    if (requests === 2) return json({ status: "running", progress: { stage: "searching", message: "One search finished." }, ...sample() });
    throw new DOMException("Synthetic timeout", "TimeoutError");
  }, async () => {
    const result = await discoverOnX(target, profile, "http://backend.test", async () => {});
    assert.equal(result.status, "partial");
    assert.equal(result.contacts.length, 1);
    assert.match(result.warning!, /final X research status.*timed out.*no automatic retry/);
  });
  assert.equal(posts, 1);
});
