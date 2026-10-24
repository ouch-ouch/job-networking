import type { Contact, Draft, Profile, Target } from "../shared/types";

export const PAGE_REQUEST_TYPE = "CCC_PAGE_REQUEST_V2";
export const PAGE_RESPONSE_TYPE = "CCC_PAGE_RESPONSE_V2";

export type PageAction =
  | { type: "CCC_SCRAPE_SEARCH"; target: Target; profile: Profile }
  | { type: "CCC_FILL_LINKEDIN"; contact: Contact; draft: Draft }
  | { type: "CCC_GRAB_JOB" };
export type PageRequest = {
  type: typeof PAGE_REQUEST_TYPE;
  action: PageAction;
};
export type PageResponse<T> =
  | { type: typeof PAGE_RESPONSE_TYPE; ok: true; data: T }
  | { type: typeof PAGE_RESPONSE_TYPE; ok: false; error: string };

export function isPageRequest(value: unknown): value is PageRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<PageRequest>;
  return (
    request.type === PAGE_REQUEST_TYPE &&
    !!request.action &&
    typeof request.action === "object" &&
    ["CCC_SCRAPE_SEARCH", "CCC_FILL_LINKEDIN", "CCC_GRAB_JOB"].includes(
      request.action.type,
    )
  );
}

export function isPageResponse<T>(value: unknown): value is PageResponse<T> {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<PageResponse<T>>;
  return (
    response.type === PAGE_RESPONSE_TYPE &&
    (response.ok === true ||
      (response.ok === false && typeof response.error === "string"))
  );
}

/** Validate in both worlds: a tab may navigate between selection and delivery. */
export function validatePageActionUrl(action: PageAction["type"], value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Open the page you want to use in the active browser tab.");
  }
  const linkedIn = ["linkedin.com", "www.linkedin.com"].includes(url.hostname);
  if (action === "CCC_SCRAPE_SEARCH") {
    if (
      url.protocol !== "https:" ||
      !linkedIn ||
      !/^\/search\/results\/people\/?$/.test(url.pathname)
    )
      throw new Error(
        "Open a LinkedIn people search in the active browser tab, wait for its results to load, then click Import LinkedIn results.",
      );
  } else if (action === "CCC_FILL_LINKEDIN") {
    if (
      url.protocol !== "https:" ||
      !linkedIn ||
      !/^\/in\/[^/]+(?:\/.*)?$/.test(url.pathname)
    )
      throw new Error(
        "Open this contact's LinkedIn profile in the active browser tab before filling the approved draft.",
      );
  } else if (
    url.protocol !== "https:" ||
    !(
      (linkedIn && /^\/jobs(?:\/|$)/.test(url.pathname)) ||
      ["boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co"].includes(
        url.hostname,
      )
    )
  ) {
    throw new Error(
      "Open a job posting on LinkedIn, Greenhouse, or Lever in the active tab, or paste its description in Targets.",
    );
  }
  return url;
}

export type PageMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0];
const listenerKey = "__coffeeChatCopilotPageBridgeV2Listener__";
type ListenerScope = { [listenerKey]?: PageMessageListener };

/** Reinjection replaces the current V2 handler rather than stacking readers. */
export function registerPageListener(
  listener: PageMessageListener,
  scope: ListenerScope = globalThis as ListenerScope,
): void {
  const previous = scope[listenerKey];
  if (previous) {
    try {
      chrome.runtime.onMessage.removeListener(previous);
    } catch {
      // A listener retained from a reloaded extension may have an invalid context.
    }
  }
  chrome.runtime.onMessage.addListener(listener);
  scope[listenerKey] = listener;
}
