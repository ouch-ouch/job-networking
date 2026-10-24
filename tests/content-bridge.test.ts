import test from "node:test";
import assert from "node:assert/strict";
import { createPageBridge, scrapeSearch } from "../extension/src/content/index";
import { createDemoState } from "../extension/src/shared/mock";
import {
  PAGE_REQUEST_TYPE,
  PAGE_RESPONSE_TYPE,
  registerPageListener,
  type PageMessageListener,
} from "../extension/src/content/protocol";

const state = createDemoState(1_800_000_000_000);
const searchUrl = "https://www.linkedin.com/search/results/people/?keywords=Stripe";
const success = () => ({ type: PAGE_RESPONSE_TYPE, ok: true, data: state.contacts.slice(0, 2) });

function mockChrome(t: { after: (cleanup: () => void) => void }, options: {
  url?: string;
  send?: (message: unknown, attempt: number) => Promise<unknown>;
  inject?: () => Promise<unknown>;
} = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const calls = { messages: [] as unknown[], injections: [] as unknown[] };
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      tabs: {
        query: async () => [{ id: 42, url: options.url ?? searchUrl }],
        sendMessage: async (id: number, message: unknown) => {
          assert.equal(id, 42);
          calls.messages.push(message);
          return options.send ? options.send(message, calls.messages.length) : success();
        },
      },
      scripting: {
        executeScript: async (injection: unknown) => {
          calls.injections.push(injection);
          return options.inject ? options.inject() : [];
        },
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "chrome", previous);
    else Reflect.deleteProperty(globalThis, "chrome");
  });
  return calls;
}

test("public scrape wrapper sends the V2 action and uses a loaded reader without injection", async t => {
  const calls = mockChrome(t);
  assert.deepEqual(await scrapeSearch(state.targets[0], state.profile), state.contacts.slice(0, 2));
  assert.equal(calls.injections.length, 0);
  assert.deepEqual(calls.messages, [{ type: PAGE_REQUEST_TYPE, action: { type: "CCC_SCRAPE_SEARCH", target: state.targets[0], profile: state.profile } }]);
});

test("stale or missing receiver triggers one bundled reader injection and one retry", async t => {
  const calls = mockChrome(t, {
    send: async (_message, attempt) => attempt === 1 ? undefined : success(),
  });
  const bridge = createPageBridge({ messageTimeoutMs: 20, injectionTimeoutMs: 20 });
  assert.deepEqual(await bridge.scrapeSearch(state.targets[0], state.profile), state.contacts.slice(0, 2));
  assert.equal(calls.messages.length, 2);
  assert.deepEqual(calls.injections, [{ target: { tabId: 42 }, files: ["content.js"] }]);
});

test("a rejected or outdated unversioned response also gets exactly one recovery", async t => {
  for (const first of ["rejected", "legacy"] as const) {
    const calls = mockChrome(t, {
      send: async (_message, attempt) => {
        if (attempt > 1) return success();
        if (first === "rejected") throw new Error("Could not establish connection. Receiving end does not exist.");
        return { ok: true, data: [] };
      },
    });
    await createPageBridge().scrapeSearch(state.targets[0], state.profile);
    assert.equal(calls.messages.length, 2);
    assert.equal(calls.injections.length, 1);
  }
});

test("valid page errors stop immediately and never trigger reinjection", async t => {
  const calls = mockChrome(t, {
    send: async () => ({ type: PAGE_RESPONSE_TYPE, ok: false, error: "No visible contacts could be read." }),
  });
  await assert.rejects(scrapeSearch(state.targets[0], state.profile), /No visible contacts/);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.injections.length, 0);
});

test("wrong tab hosts, protocols and LinkedIn routes are rejected before any page message", async t => {
  for (const url of [
    "https://example.com/search/results/people/",
    "http://www.linkedin.com/search/results/people/",
    "https://www.linkedin.com/feed/",
    "https://www.linkedin.com/in/someone/",
    "https://www.linkedin.com/search/results/people/extra",
  ]) {
    const calls = mockChrome(t, { url });
    await assert.rejects(scrapeSearch(state.targets[0], state.profile), /LinkedIn people search/);
    assert.equal(calls.messages.length, 0);
    assert.equal(calls.injections.length, 0);
  }
});

test("people-search SPA route without a trailing slash remains supported", async t => {
  const calls = mockChrome(t, { url: "https://www.linkedin.com/search/results/people?keywords=Stripe" });
  await scrapeSearch(state.targets[0], state.profile);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.injections.length, 0);
});

test("unresponsive reads time out, retry once, and settle with actionable feedback", async t => {
  const calls = mockChrome(t, { send: () => new Promise(() => {}) });
  const bridge = createPageBridge({ messageTimeoutMs: 8, injectionTimeoutMs: 8 });
  await assert.rejects(bridge.scrapeSearch(state.targets[0], state.profile), /one recovery attempt.*Refresh/);
  assert.equal(calls.messages.length, 2);
  assert.equal(calls.injections.length, 1);
});

test("a stalled injection is bounded and never starts a second page request", async t => {
  const calls = mockChrome(t, {
    send: async () => undefined,
    inject: () => new Promise(() => {}),
  });
  const bridge = createPageBridge({ messageTimeoutMs: 8, injectionTimeoutMs: 8 });
  await assert.rejects(bridge.scrapeSearch(state.targets[0], state.profile), /one recovery attempt/);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.injections.length, 1);
});

test("a page application error returned after recovery is preserved without another injection", async t => {
  const calls = mockChrome(t, {
    send: async (_message, attempt) => attempt === 1 ? undefined : { type: PAGE_RESPONSE_TYPE, ok: false, error: "Open an approved draft first." },
  });
  await assert.rejects(scrapeSearch(state.targets[0], state.profile), /Open an approved draft/);
  assert.equal(calls.messages.length, 2);
  assert.equal(calls.injections.length, 1);
});

test("reinjected V2 registration removes its previous handler instead of stacking listeners", t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const active = new Set<PageMessageListener>();
  const removed: PageMessageListener[] = [];
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    runtime: { onMessage: {
      addListener: (listener: PageMessageListener) => active.add(listener),
      removeListener: (listener: PageMessageListener) => { removed.push(listener); active.delete(listener); },
    } },
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "chrome", previous);
    else Reflect.deleteProperty(globalThis, "chrome");
  });
  const first: PageMessageListener = () => false;
  const second: PageMessageListener = () => false;
  const isolatedScope = {};
  registerPageListener(first, isolatedScope);
  registerPageListener(second, isolatedScope);
  assert.deepEqual([...active], [second]);
  assert.deepEqual(removed, [first]);
});

test("actual content listener ignores legacy actions, rechecks SPA context and replaces itself", async t => {
  const chromeBefore = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const locationBefore = Object.getOwnPropertyDescriptor(globalThis, "location");
  const key = "__coffeeChatCopilotPageBridgeV2Listener__";
  const listenerBefore = Object.getOwnPropertyDescriptor(globalThis, key);
  const active = new Set<PageMessageListener>();
  const removed: PageMessageListener[] = [];
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    runtime: { onMessage: {
      addListener: (listener: PageMessageListener) => active.add(listener),
      removeListener: (listener: PageMessageListener) => { removed.push(listener); active.delete(listener); },
    } },
  } });
  Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "https://www.linkedin.com/feed/" } });
  t.after(() => {
    for (const [name, descriptor] of [["chrome", chromeBefore], ["location", locationBefore], [key, listenerBefore]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  const { installContentBridge } = await import("../extension/src/content/content-script");
  installContentBridge();
  assert.equal(active.size, 1);
  assert.equal(removed.length, 1);
  const listener = [...active][0];
  const responses: unknown[] = [];
  const respond = (value: unknown) => { responses.push(value); };
  assert.equal(listener({ type: "CCC_SCRAPE_SEARCH", target: state.targets[0], profile: state.profile }, {}, respond), false);
  assert.equal(listener({ type: PAGE_REQUEST_TYPE, action: { type: "SEND_EMAIL" } }, {}, respond), false);
  assert.deepEqual(responses, []);
  listener({ type: PAGE_REQUEST_TYPE, action: { type: "CCC_SCRAPE_SEARCH", target: state.targets[0], profile: state.profile } }, {}, respond);
  assert.deepEqual(responses, [{ type: PAGE_RESPONSE_TYPE, ok: false, error: "Open a LinkedIn people search in the active browser tab, wait for its results to load, then click Import LinkedIn results." }]);
  Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "https://www.linkedin.com/search/results/people" } });
  responses.length = 0;
  listener({ type: PAGE_REQUEST_TYPE, action: { type: "CCC_SCRAPE_SEARCH" } }, {}, respond);
  assert.deepEqual(responses, [{ type: PAGE_RESPONSE_TYPE, ok: false, error: "Select a target and save your profile first." }]);
});
