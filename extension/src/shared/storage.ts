import type { AppState } from "./types";
import { createDemoState } from "./mock";

export const STORAGE_KEY = "coffee-chat-copilot:v1";
export const modeStorageKey = (demoMode: boolean) =>
  `${STORAGE_KEY}:${demoMode ? "demo" : "live"}`;
const memory = new Map<string, AppState>();
const listeners = new Set<() => void>();
let attached = false;
const hasChromeStorage = () =>
  typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const notify = () => {
  for (const listener of listeners) listener();
};

function validState(value: unknown): value is AppState {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as AppState).version === 1 &&
    Array.isArray((value as AppState).contacts) &&
    (value as AppState).settings,
  );
}

async function readState(key: string): Promise<AppState | null> {
  let value: unknown;
  if (hasChromeStorage()) value = (await chrome.storage.local.get(key))[key];
  else if (typeof localStorage !== "undefined") {
    try {
      value = JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      value = null;
    }
  } else value = memory.get(key);
  return validState(value) ? clone(value) : null;
}

async function writeStates(
  entries: Record<string, AppState>,
  emit = true,
): Promise<void> {
  const values = clone(entries);
  if (hasChromeStorage()) await chrome.storage.local.set(values);
  else if (typeof localStorage !== "undefined") {
    for (const [key, value] of Object.entries(values))
      localStorage.setItem(key, JSON.stringify(value));
  }
  for (const [key, value] of Object.entries(values)) memory.set(key, value);
  if (emit) notify();
}

export async function getState(): Promise<AppState> {
  const existing = await readState(STORAGE_KEY);
  if (existing && !existing.settings.demoMode) return existing;
  // Demo mode is retired: open your saved live workspace, or start an empty one.
  return existing ? switchMode(existing, false) : startLive();
}

/** Keep the active key for subscribers and an independent backup for this mode. */
export async function saveState(state: AppState): Promise<void> {
  await writeStates({
    [modeStorageKey(state.settings.demoMode)]: state,
    [STORAGE_KEY]: state,
  });
}

async function startLive(): Promise<AppState> {
  const initial = createLiveState(createDemoState());
  await saveState(initial);
  return clone(initial);
}

export function createLiveState(source: AppState): AppState {
  return {
    version: 1,
    profile:
      JSON.stringify(source.profile) ===
      JSON.stringify(createDemoState().profile)
        ? {
            name: "",
            school: "",
            major: "",
            year: "",
            background: "",
            availability: "",
            signature: "",
          }
        : clone(source.profile),
    template: clone(source.template),
    targets: [],
    contacts: [],
    drafts: [],
    activities: [],
    meetings: [],
    questions: [],
    settings: { ...source.settings, demoMode: false, googleConnected: false },
    usage: {
      date: new Date().toISOString().slice(0, 10),
      emails: 0,
      profiles: 0,
    },
  };
}

/** Called within the action queue so the outgoing workspace is saved before changing modes. */
export async function switchMode(
  current: AppState,
  demoMode: boolean,
): Promise<AppState> {
  if (current.settings.demoMode === demoMode) return clone(current);
  await writeStates(
    { [modeStorageKey(current.settings.demoMode)]: current },
    false,
  );
  const saved = await readState(modeStorageKey(demoMode));
  const next =
    saved && saved.settings.demoMode === demoMode
      ? saved
      : demoMode
        ? createDemoState()
        : createLiveState(current);
  if (demoMode && !saved)
    next.settings.backendUrl = current.settings.backendUrl;
  await saveState(next);
  return clone(next);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!attached) {
    attached = true;
    if (hasChromeStorage())
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes[STORAGE_KEY]) notify();
      });
    if (typeof window !== "undefined")
      window.addEventListener("storage", (event) => {
        if (event.key === STORAGE_KEY) notify();
      });
  }
  return () => {
    listeners.delete(listener);
  };
}
