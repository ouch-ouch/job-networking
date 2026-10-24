// Content script: grabs the job description text from the posting the user has open.
// Owner: A (Rachel). Spec §9: document.body.innerText is enough; we try the known
// description container first so the text is cleaner, then fall back to the whole page.
//
// D: add to manifest content_scripts with these matches:
//   "https://www.linkedin.com/jobs/*", "https://boards.greenhouse.io/*",
//   "https://job-boards.greenhouse.io/*", "https://jobs.lever.co/*"
// The panel asks for the text with: chrome.tabs.sendMessage(tabId, { type: "GRAB_JOB_PAGE" })

export type JobPageResult = { url: string; title: string; text: string; source: "linkedin" | "greenhouse" | "lever" | "page" };

const SELECTORS: { source: JobPageResult["source"]; host: RegExp; selectors: string[] }[] = [
  { source: "linkedin", host: /linkedin\.com$/, selectors: [".jobs-description__content", ".jobs-search__job-details--container", ".job-view-layout"] },
  { source: "greenhouse", host: /greenhouse\.io$/, selectors: ["#content", ".job__description", "main"] },
  { source: "lever", host: /lever\.co$/, selectors: [".posting-page", ".content", "main"] },
];

const MAX_CHARS = 20_000; // keeps the AI_EXTRACT input reasonable

function clean(text: string): string {
  return text.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_CHARS);
}

export function grabJobPage(): JobPageResult {
  const host = location.hostname.replace(/^www\./, "");
  const site = SELECTORS.find((s) => s.host.test(host));
  const header = [document.querySelector("h1")?.textContent?.trim(), document.title].filter(Boolean).join("\n");
  if (site) {
    for (const sel of site.selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el && el.innerText.trim().length > 200) {
        return { url: location.href, title: document.title, text: clean(`${header}\n\n${el.innerText}`), source: site.source };
      }
    }
  }
  return { url: location.href, title: document.title, text: clean(document.body.innerText), source: "page" };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GRAB_JOB_PAGE") {
    sendResponse(grabJobPage());
  }
  return false;
});
