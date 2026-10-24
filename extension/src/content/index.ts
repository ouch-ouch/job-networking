import type { Contact, Draft, Profile, Target } from "../shared/types";
import {
  PAGE_REQUEST_TYPE,
  isPageResponse,
  validatePageActionUrl,
  type PageAction,
  type PageResponse,
} from "./protocol";

export { buildLinkedInSearchUrl, guessEmails, rankContact } from "./sourcing";

type BridgeOptions = { messageTimeoutMs?: number; injectionTimeoutMs?: number };
const recoveryMessage =
  "The page reader could not connect after one recovery attempt. Refresh the tab after loading the extension and try again, or add a contact manually.";

function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The page reader timed out.")),
      milliseconds,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function requestActivePage<T>(action: PageAction, options: BridgeOptions): Promise<T> {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) {
    throw new Error(
      "Live page reading requires the Chrome extension. Load the built extension and open the page yourself, or add a contact manually in this preview.",
    );
  }
  const messageTimeout = options.messageTimeoutMs ?? 4000;
  const injectionTimeout = options.injectionTimeoutMs ?? 4000;
  const [tab] = await bounded(
    chrome.tabs.query({ active: true, currentWindow: true }),
    messageTimeout,
  );
  if (typeof tab?.id !== "number" || tab.id < 0 || !tab.url)
    throw new Error("Open the page you want to use in the active browser tab.");
  validatePageActionUrl(action.type, tab.url);
  const tabId = tab.id;
  const read = async (): Promise<PageResponse<T>> => {
    const response: unknown = await bounded(
      chrome.tabs.sendMessage(tabId, { type: PAGE_REQUEST_TYPE, action }),
      messageTimeout,
    );
    if (
      !isPageResponse<T>(response) ||
      (response.ok && action.type !== "CCC_FILL_LINKEDIN" && response.data === undefined)
    )
      throw new Error("The page did not answer with the current reader protocol.");
    return response;
  };
  let response: PageResponse<T>;
  try {
    response = await read();
  } catch {
    if (!chrome.scripting?.executeScript) throw new Error(recoveryMessage);
    try {
      await bounded(
        chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }),
        injectionTimeout,
      );
      response = await read();
    } catch {
      throw new Error(recoveryMessage);
    }
  }
  // Valid page errors (wrong context, no loaded results, no composer) are final.
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** Optional short deadlines let tests exercise the actual public wrapper paths. */
export function createPageBridge(options: BridgeOptions = {}) {
  return {
    scrapeSearch: (target: Target, profile: Profile) =>
      requestActivePage<Contact[]>({ type: "CCC_SCRAPE_SEARCH", target, profile }, options),
    fillLinkedIn: (contact: Contact, draft: Draft) =>
      requestActivePage<void>({ type: "CCC_FILL_LINKEDIN", contact, draft }, options),
    grabJobPage: () => requestActivePage<string>({ type: "CCC_GRAB_JOB" }, options),
  };
}

const bridge = createPageBridge();
export const scrapeSearch = bridge.scrapeSearch;
export const fillLinkedIn = bridge.fillLinkedIn;
export const grabJobPage = bridge.grabJobPage;
