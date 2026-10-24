import type { Contact, Draft, Profile, Target } from "../shared/types";

export { buildLinkedInSearchUrl, guessEmails, rankContact } from "./sourcing";

type PageResponse<T> = { ok: true; data: T } | { ok: false; error: string };

async function requestActivePage<T>(
  message: Record<string, unknown>,
  linkedinOnly: boolean,
): Promise<T> {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) {
    throw new Error(
      "Live page reading requires the Chrome extension. Load the built extension and open the page yourself, or add a contact manually in this preview.",
    );
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url)
    throw new Error("Open the page you want to use in the active browser tab.");
  const url = new URL(tab.url);
  if (
    linkedinOnly &&
    !["linkedin.com", "www.linkedin.com"].includes(url.hostname)
  )
    throw new Error("Open a LinkedIn page in the active browser tab first.");
  let response: PageResponse<T>;
  try {
    response = (await chrome.tabs.sendMessage(
      tab.id,
      message,
    )) as PageResponse<T>;
  } catch {
    throw new Error(
      "The extension could not read this page. Refresh the tab after loading the extension, then try again. You can also paste the job text or add a contact manually.",
    );
  }
  if (!response || !response.ok)
    throw new Error(
      response && "error" in response
        ? response.error
        : "No response from this page. Refresh it and try again.",
    );
  return response.data;
}

export function scrapeSearch(
  target: Target,
  profile: Profile,
): Promise<Contact[]> {
  return requestActivePage<Contact[]>(
    { type: "CCC_SCRAPE_SEARCH", target, profile },
    true,
  );
}

export function fillLinkedIn(contact: Contact, draft: Draft): Promise<void> {
  return requestActivePage<void>(
    { type: "CCC_FILL_LINKEDIN", contact, draft },
    true,
  );
}

export function grabJobPage(): Promise<string> {
  return requestActivePage<string>({ type: "CCC_GRAB_JOB" }, false);
}
