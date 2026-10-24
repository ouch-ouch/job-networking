import type { Contact } from "../shared/types";
import { extractJobPage } from "./job-page";
import { scrapeLinkedInSearch } from "./linkedin-search";
import { fillLinkedInComposer } from "./linkedin-profile";
import {
  PAGE_RESPONSE_TYPE,
  isPageRequest,
  registerPageListener,
  validatePageActionUrl,
  type PageMessageListener,
} from "./protocol";

export function installContentBridge(): void {
  const listener: PageMessageListener = (envelope: unknown, _sender, sendResponse) => {
    if (!isPageRequest(envelope)) return false;
    const request = envelope.action;
    try {
      validatePageActionUrl(request.type, location.href);
      let data: unknown;
      if (request.type === "CCC_SCRAPE_SEARCH") {
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
      sendResponse({ type: PAGE_RESPONSE_TYPE, ok: true, data });
    } catch (error) {
      sendResponse({
        type: PAGE_RESPONSE_TYPE,
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "The page could not be read.",
      });
    }
    return false;
  };
  registerPageListener(listener);
}

installContentBridge();
