import type { Contact, Draft, Profile, Target } from "../shared/types";
import { extractJobPage } from "./job-page";
import { scrapeLinkedInSearch } from "./linkedin-search";
import { fillLinkedInComposer } from "./linkedin-profile";

type PageRequest =
  | { type: "CCC_SCRAPE_SEARCH"; target: Target; profile: Profile }
  | { type: "CCC_FILL_LINKEDIN"; contact: Contact; draft: Draft }
  | { type: "CCC_GRAB_JOB" };

chrome.runtime.onMessage.addListener(
  (request: PageRequest, _sender, sendResponse) => {
    if (
      !request ||
      !["CCC_SCRAPE_SEARCH", "CCC_FILL_LINKEDIN", "CCC_GRAB_JOB"].includes(
        request.type,
      )
    )
      return false;
    try {
      let data: unknown;
      if (request.type === "CCC_SCRAPE_SEARCH") {
        if (
          !["linkedin.com", "www.linkedin.com"].includes(location.hostname) ||
          !/^\/search\/results\/people\//.test(location.pathname)
        ) {
          throw new Error(
            "Open a LinkedIn people search yourself, wait for its results to load, then click Read open search.",
          );
        }
        if (!request.target?.id || !request.profile)
          throw new Error("Select a target and save your profile first.");
        data = scrapeLinkedInSearch(document, request.target, request.profile);
        if (!(data as Contact[]).length)
          throw new Error(
            "No visible contacts could be read. Open a people search with loaded results, or add a contact manually.",
          );
      } else if (request.type === "CCC_FILL_LINKEDIN") {
        if (!request.contact || !request.draft)
          throw new Error("Select an approved draft first.");
        fillLinkedInComposer(request.contact, request.draft);
      } else data = extractJobPage();
      sendResponse({ ok: true, data });
    } catch (error) {
      sendResponse({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "The page could not be read.",
      });
    }
    return false;
  },
);
