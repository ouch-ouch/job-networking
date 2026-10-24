import type { Contact, Profile, Target } from "../shared/types";
import { canonicalLinkedInProfile, contactFromSearchResult } from "./sourcing";
import type { SearchResultEvidence } from "./sourcing";

const visibleText = (element: Element | null | undefined): string => {
  if (!element) return "";
  if (!element.getClientRects().length || element.closest("[hidden]"))
    return "";
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return "";
  return (element as HTMLElement).innerText || element.textContent || "";
};

const text = (element: Element | null | undefined): string =>
  visibleText(element).replace(/\s+/g, " ").trim();

/**
 * Newer result cards make the whole card a profile link. Read only its header:
 * name, an optional degree line, then the immediately following headline.
 * Later snippets can contain generated narratives, so they supply no evidence.
 */
export function parseLinkedInResultLines(
  value: string,
): Pick<SearchResultEvidence, "name" | "title" | "degreeText"> | undefined {
  const lines = value
    .split(/\r\n|\n|\r/)
    .map((line) => line.replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const first = lines[0];
  if (!first) return undefined;
  const degreeOnly = /^[•·]?\s*((?:1st|2nd|3rd)\+?)(?:\s+(?:degree(?:\s+connection)?|connection))?$/i;
  const inlineDegree = first.match(/^(.*?)\s*[•·]\s*((?:1st|2nd|3rd)\+?)(?:\s+(?:degree(?:\s+connection)?|connection))?$/i);
  const name = (inlineDegree?.[1] || first).trim();
  if (!name || degreeOnly.test(name) || /^(?:connect|message|follow|pending|linkedin member)$/i.test(name)) return undefined;
  let degreeText = inlineDegree?.[2];
  let headlineIndex = 1;
  const separateDegree = lines[headlineIndex]?.match(degreeOnly);
  if (separateDegree) {
    degreeText ||= separateDegree[1];
    headlineIndex++;
  }
  const headline = lines[headlineIndex] || "";
  // Do not hunt through later lines when the headline is absent.
  const title = headline !== name && !/^(?:connect|message|follow|pending|send (?:a )?message|view profile|about (?:this|these) results?)\b/i.test(headline)
    && !/\bAI[ -]generated\b/i.test(headline) ? headline : "";
  return { name, title, ...(degreeText ? { degreeText } : {}) };
}

function firstText(root: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const value = text(root.querySelector(selector));
    if (value) return value;
  }
  return "";
}

/** Reads one results page already opened by the user. Never scrolls or navigates. */
export function scrapeLinkedInSearch(
  root: Document,
  target: Target,
  profile: Profile,
): Contact[] {
  const candidateCards = new Set<Element>();
  const cardSelectors = [
    "li.reusable-search__result-container",
    ".reusable-search__result-container",
    '[data-view-name="search-entity-result-universal-template"]',
    ".entity-result",
    "[data-chameleon-result-urn]",
    '[role="listitem"]',
  ];
  for (const selector of cardSelectors)
    root.querySelectorAll(selector).forEach((card) => candidateCards.add(card));
  // New LinkedIn layouts can drop their historical class names; retain only profile links in result lists.
  if (!candidateCards.size) {
    root
      .querySelectorAll('main a[href*="/in/"], [role="main"] a[href*="/in/"], [role="list"] a[href*="/in/"]')
      .forEach((link) => {
        const card = link.closest('li, [role="listitem"], [data-view-name="search-result"]');
        if (card) candidateCards.add(card);
      });
  }
  const contacts = new Map<string, Contact>();
  for (const card of candidateCards) {
    const profileLinks = [
      ...card.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'),
    ];
    const link =
      card.querySelector<HTMLAnchorElement>(
        '.entity-result__title-text a[href*="/in/"]',
      ) || profileLinks.find((candidate) => Boolean(text(candidate)));
    if (!link) continue;
    const linkedinUrl = canonicalLinkedInProfile(
      link.getAttribute("href") || "",
    );
    if (!linkedinUrl || contacts.has(linkedinUrl)) continue;
    const header = card.getAttribute("role") === "listitem"
      ? parseLinkedInResultLines(visibleText(link)) : undefined;
    const name =
      header?.name || firstText(link, [
        'span[aria-hidden="true"]',
        '[data-anonymize="person-name"]',
        'span[dir="ltr"]',
      ]) || text(link).replace(/\s+View .*?profile.*$/i, "");
    const title = firstText(card, [
      ".entity-result__primary-subtitle",
      '[data-anonymize="title"]',
      ".artdeco-entity-lockup__subtitle",
      ".subline-level-1",
    ]) || header?.title || "";
    const company = firstText(card, [
      '[data-anonymize="company-name"]',
      '[data-field="company"]',
    ]);
    const degreeText =
      firstText(card, [
        ".entity-result__badge-text",
        ".dist-value",
        '[aria-label*="degree connection"]',
      ]) ||
      card
        .querySelector('[aria-label*="degree connection"]')
        ?.getAttribute("aria-label") ||
      text(card.querySelector(".entity-result__title-text")) || header?.degreeText;
    const educationField = firstText(card, [
      '[data-anonymize="education"]',
      '[data-field="education"]',
      '[data-view-name="education"]',
    ]);
    const summary = firstText(card, [".entity-result__summary"]);
    const education =
      educationField ||
      (!header && /\b(?:education|school)\s*:/i.test(summary) ? summary : "");
    const contact = contactFromSearchResult(
      { name, title, company, linkedinUrl, degreeText, education },
      target,
      profile,
    );
    if (contact) contacts.set(linkedinUrl, contact);
    if (contacts.size >= 20) break;
  }
  return [...contacts.values()].sort(
    (a, b) =>
      Number(b.warmPaths.length > 0) - Number(a.warmPaths.length > 0) ||
      b.relevance - a.relevance,
  );
}
