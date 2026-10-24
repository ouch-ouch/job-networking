import type { Contact, Profile, Target } from "../shared/types";
import { canonicalLinkedInProfile, contactFromSearchResult } from "./sourcing";
import type { SearchResultEvidence } from "./sourcing";

const actionLine = /^(?:connect|message|follow|following|pending|send (?:a )?message|view profile|invitation sent)[.!…]?$/i;
const degreeOnly = /^[•·]?\s*((?:1st|2nd|3rd)\+?)(?:\s+(?:degree(?:\s+connection)?|connection))?$/i;
const mutualLabel = /\b(?:is a|are) mutual connections?\.?$/i;
const narrativeLine = /^(?:education|school|current|past|summary|about)\s*:/i;

const visibleText = (element: Element | null | undefined): string => {
  if (!element || !element.getClientRects().length || element.closest("[hidden]")) return "";
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return "";
  return (element as HTMLElement).innerText || element.textContent || "";
};

function generatedSnippetRoots(card: Element): Element[] {
  return [...card.querySelectorAll('[aria-label="AI generated" i]')].map((marker) => {
    const snippet = marker.closest('[id^="SearchResultssnippet_"], [componentkey^="SearchResultssnippet_"]');
    // Current markup places the SVG label and generated paragraph beside each
    // other in a div. Exclude that whole snippet, not just the label.
    return snippet && snippet !== card ? snippet : marker.closest("p") || marker.parentElement || marker;
  });
}

function safeVisibleText(element: Element | null | undefined, excluded: Element[]): string {
  if (!element || excluded.some((snippet) => snippet === element || snippet.contains(element))) return "";
  let value = visibleText(element);
  for (const snippet of excluded) {
    if (!element.contains(snippet)) continue;
    const generated = visibleText(snippet);
    const index = generated ? value.lastIndexOf(generated) : -1;
    if (index >= 0) value = value.slice(0, index) + value.slice(index + generated.length);
  }
  return value;
}

const text = (element: Element | null | undefined, excluded: Element[] = []): string =>
  safeVisibleText(element, excluded).replace(/\s+/g, " ").trim();

/** Only the visible result header supplies name, headline, and location facts. */
export function parseLinkedInResultLines(
  value: string,
): Pick<SearchResultEvidence, "name" | "title" | "degreeText" | "location" | "sourceText"> | undefined {
  const lines = value.split(/\r\n|\n|\r/)
    .map((line) => line.replace(/[\u200b-\u200d\ufeff]/g, "").trim())
    .filter(Boolean);
  const first = lines[0];
  if (!first) return undefined;
  const inlineDegree = first.match(/^(.*?)\s*[•·]\s*((?:1st|2nd|3rd)\+?)(?:\s+(?:degree(?:\s+connection)?|connection))?$/i);
  const name = (inlineDegree?.[1] || first).trim();
  if (!name || name.length > 150 || degreeOnly.test(name) || actionLine.test(name) || /^linkedin member$/i.test(name)) return undefined;
  let degreeText = inlineDegree?.[2];
  let headlineIndex = 1;
  const sourceLines = [first];
  const separateDegree = lines[headlineIndex]?.match(degreeOnly);
  if (separateDegree) {
    degreeText ||= separateDegree[1];
    sourceLines.push(lines[headlineIndex]);
    headlineIndex++;
  }
  const isHeaderField = (line: string) => Boolean(line) && !actionLine.test(line) && !degreeOnly.test(line)
    && !mutualLabel.test(line) && !narrativeLine.test(line) && !/\bAI[ -]generated\b/i.test(line);
  const headline = lines[headlineIndex] || "";
  const title = headline !== name && isHeaderField(headline) ? headline : "";
  if (title) sourceLines.push(title);
  // Read one location line only. Never search later snippets for missing facts.
  const nextLine = title ? lines[headlineIndex + 1] || "" : "";
  const location = nextLine.length <= 160 && isHeaderField(nextLine) ? nextLine : undefined;
  if (location) sourceLines.push(location);
  return { name, title, ...(degreeText ? { degreeText } : {}), ...(location ? { location } : {}), sourceText: sourceLines.join("\n") };
}

function firstText(root: Element, selectors: string[], excluded: Element[]): string {
  for (const selector of selectors) {
    const value = text(root.querySelector(selector), excluded);
    if (value) return value;
  }
  return "";
}

function readHeader(root: Element, excluded: Element[]): string {
  const elements = [...root.querySelectorAll("p, a, button, [role=button]")];
  const actionIndex = elements.findIndex((element) => actionLine.test(text(element, excluded)));
  const action = actionIndex >= 0 ? elements[actionIndex] : undefined;
  const paragraphs = elements.slice(0, actionIndex >= 0 ? actionIndex : elements.length)
    .filter((element) => element.tagName.toLowerCase() === "p");
  const lines = paragraphs.map((paragraph) => safeVisibleText(paragraph, excluded).trim()).filter(Boolean);
  if (lines.length) return [...lines, ...(action ? [text(action, excluded)] : [])].join("\n");
  return safeVisibleText(root, excluded);
}

function readMutualConnections(card: Element, excluded: Element[]): string | undefined {
  for (const element of card.querySelectorAll('p, .entity-result__simple-insight, .entity-result__insight-text, [data-field="mutual-connections"]')) {
    const value = text(element, excluded);
    if (value && value.length <= 300 && mutualLabel.test(value)) return value;
  }
  return undefined;
}

/** Reads loaded, visible results on the page the user opened. Never navigates. */
export function scrapeLinkedInSearch(root: Document, target: Target, profile: Profile): Contact[] {
  const candidateCards = new Set<Element>();
  const cardSelector = 'li.reusable-search__result-container, .reusable-search__result-container, [data-view-name="search-entity-result-universal-template"], .entity-result, [data-chameleon-result-urn], [role="listitem"], [data-view-name="search-result"]';
  root.querySelectorAll(cardSelector).forEach((card) => candidateCards.add(card));
  root.querySelectorAll('main a[href*="/in/"], [role="main"] a[href*="/in/"], [role="list"] a[href*="/in/"]').forEach((link) => {
    candidateCards.add(link.closest(cardSelector) || link);
  });
  const contacts = new Map<string, Contact>();
  for (const card of candidateCards) {
    const excluded = generatedSnippetRoots(card);
    const legacyLink = card.querySelector<HTMLAnchorElement>('.entity-result__title-text a[href*="/in/"]');
    const profileLinks = [
      ...(card.matches('a[href*="/in/"]') ? [card as HTMLAnchorElement] : []),
      ...card.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'),
    ];
    const link = legacyLink || profileLinks.find((candidate) => canonicalLinkedInProfile(candidate.getAttribute("href") || "") && Boolean(text(candidate, excluded)));
    if (!link) continue;
    const linkedinUrl = canonicalLinkedInProfile(link.getAttribute("href") || "");
    if (!linkedinUrl || contacts.has(linkedinUrl)) continue;
    const header = parseLinkedInResultLines(readHeader(legacyLink ? link : card, excluded));
    const name = (legacyLink ? firstText(link, ['span[aria-hidden="true"]', '[data-anonymize="person-name"]', 'span[dir="ltr"]'], excluded) : "")
      || header?.name || firstText(link, ['[data-anonymize="person-name"]'], excluded);
    const title = firstText(card, ['.entity-result__primary-subtitle', '[data-anonymize="title"]', '.artdeco-entity-lockup__subtitle', '.subline-level-1'], excluded) || header?.title || "";
    const location = firstText(card, ['.entity-result__secondary-subtitle', '[data-anonymize="location"]', '[data-field="location"]'], excluded) || header?.location;
    const company = firstText(card, ['[data-anonymize="company-name"]', '[data-field="company"]'], excluded);
    const degreeText = firstText(card, ['.entity-result__badge-text', '.dist-value', '[aria-label*="degree connection"]'], excluded)
      || card.querySelector('[aria-label*="degree connection"]')?.getAttribute("aria-label") || header?.degreeText;
    const educationField = firstText(card, ['[data-anonymize="education"]', '[data-field="education"]', '[data-view-name="education"]'], excluded);
    const summary = firstText(card, [".entity-result__summary"], excluded);
    const education = educationField || (/^(?:education|school)\s*:/i.test(summary) ? summary : "");
    const sourceText = header?.title ? header.sourceText : [name, degreeText, title, location].filter(Boolean).join("\n");
    const mutualConnections = readMutualConnections(card, excluded);
    const sourceUrl = root.location?.href || root.URL || undefined;
    const contact = contactFromSearchResult({ name, title, location, company, linkedinUrl, degreeText, education, mutualConnections, sourceText, sourceUrl }, target, profile);
    if (contact) contacts.set(linkedinUrl, contact);
  }
  return [...contacts.values()].sort((a, b) => Number(b.warmPaths.length > 0) - Number(a.warmPaths.length > 0) || b.relevance - a.relevance);
}
