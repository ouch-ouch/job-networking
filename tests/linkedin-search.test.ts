import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import type { Profile, Target } from "../extension/src/shared/types";
import { parseLinkedInResultLines, scrapeLinkedInSearch } from "../extension/src/content/linkedin-search";
import { contactFromSearchResult } from "../extension/src/content/sourcing";

const profile: Profile = {
  name: "Alex Example", school: "NYU", major: "CS", year: "Student",
  background: "", availability: "", signature: "",
};
const target: Target = {
  id: "fictional-target", company: "Fictional Space Co", role: "Engineer",
  skills: [], rawDescription: "", domain: "fictional-space.example",
};
const searchUrl = "https://www.linkedin.com/search/results/people/?keywords=fictional";

function withDocument(html: string, run: (document: Document) => void): void {
  const { document, window: domWindow } = parseHTML("<html><body>" + html + "</body></html>");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const elementPrototype = domWindow.Element.prototype;
  const previousRects = Object.getOwnPropertyDescriptor(elementPrototype, "getClientRects");
  Object.defineProperty(elementPrototype, "getClientRects", {
    configurable: true,
    value(this: Element) { return this.closest("[hidden]") ? [] : [{ width: 100, height: 20 }]; },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      getComputedStyle(element: Element) {
        const inline = element.getAttribute("style") || "";
        return { display: /display\s*:\s*none/i.test(inline) ? "none" : "block", visibility: /visibility\s*:\s*hidden/i.test(inline) ? "hidden" : "visible" };
      },
    },
  });
  Object.defineProperty(document, "URL", { configurable: true, value: searchUrl });
  try { run(document as unknown as Document); }
  finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousRects) Object.defineProperty(elementPrototype, "getClientRects", previousRects);
    else Reflect.deleteProperty(elementPrototype, "getClientRects");
  }
}

test("whole-card lines retain the visible header and location without later narrative", () => {
  const result = parseLinkedInResultLines("Sam Example\n • 2nd\n\nswe @ Fictional Space Co\n\nLos Angeles Metropolitan Area\n\nConnect\n\nSoftware Engineer II at Narrative Co. Education: NYU.\n\nPat Example is a mutual connection");
  assert.deepEqual(result, {
    name: "Sam Example", title: "swe @ Fictional Space Co", degreeText: "2nd",
    location: "Los Angeles Metropolitan Area",
    sourceText: "Sam Example\n• 2nd\nswe @ Fictional Space Co\nLos Angeles Metropolitan Area",
  });
  assert.equal(result && "education" in result, false);
  assert.equal(result && "company" in result, false);
  assert.equal(result && "mutualConnections" in result, false);
});

test("narrative employer and education never become contact facts", () => {
  const header = parseLinkedInResultLines("Sam Example\n• 3rd+\nswe @ Fictional Space Co\nLos Angeles Metropolitan Area\nConnect\nEducation: NYU. Sam works at Narrative Co.")!;
  const contact = contactFromSearchResult({ ...header, linkedinUrl: "https://www.linkedin.com/in/fictional-sam-example/" }, target, profile)!;
  assert.equal(contact.company, "Fictional Space Co");
  assert.equal(contact.location, "Los Angeles Metropolitan Area");
  assert.equal(contact.connectionDegree, 3);
  assert.deepEqual(contact.warmPaths, []);
});

test("inline degrees, visible punctuation, accents, and Windows line endings survive", () => {
  assert.deepEqual(parseLinkedInResultLines("Taylor Example • 1st\r\nProduct Designer @ Fictional Studio | Accessibility\r\nMontréal, Québec, Canada\r\nMessage"), {
    name: "Taylor Example", title: "Product Designer @ Fictional Studio | Accessibility", degreeText: "1st",
    location: "Montréal, Québec, Canada",
    sourceText: "Taylor Example • 1st\nProduct Designer @ Fictional Studio | Accessibility\nMontréal, Québec, Canada",
  });
});

test("missing header fields never cause scanning through action or narrative lines", () => {
  assert.deepEqual(parseLinkedInResultLines("Sam Example\n• 2nd\nConnect\nEducation: NYU. Sam works at Narrative Co."), {
    name: "Sam Example", title: "", degreeText: "2nd", sourceText: "Sam Example\n• 2nd",
  });
  assert.deepEqual(parseLinkedInResultLines("Sam Example\n• 3rd\nEngineer\nConnect\nSeattle, Washington"), {
    name: "Sam Example", title: "Engineer", degreeText: "3rd", sourceText: "Sam Example\n• 3rd\nEngineer",
  });
  assert.deepEqual(parseLinkedInResultLines("Sam Example\n• 3rd\nAI-generated summary: Engineer at Narrative Co.\nConnect"), {
    name: "Sam Example", title: "", degreeText: "3rd", sourceText: "Sam Example\n• 3rd",
  });
});

test("empty results, standalone UI labels, and flattened long cards do not create names", () => {
  for (const value of ["", " \n\t", "• 2nd\nConnect", "Connect\nEngineer", "LinkedIn Member\n3rd", "a".repeat(151)]) {
    assert.equal(parseLinkedInResultLines(value), undefined);
  }
});

test("actual-shaped DOM imports exact names/headlines/location and explicit mutual labels", () => {
  withDocument('<div role="list"><div role="listitem"><div data-display-contents><a href="https://www.linkedin.com/in/fictional-sam-example/">' +
    '<span hidden>View Sam Example’s profile</span><div><p><a href="https://www.linkedin.com/in/fictional-sam-example/">Sam Example</a><span> • 2nd</span></p></div>' +
    '<div><p><span>swe @ Fictional Space Co | Avionics</span></p></div><div><p><span>Los Angeles Metropolitan Area</span></p></div>' +
    '<a href="/preload/connect/">Connect</a>' +
    '<div id="SearchResultssnippet_example" componentkey="SearchResultssnippet_example"><div><svg role="img" aria-label="AI generated"></svg>' +
    '<p>Education: NYU. Works at Narrative Co. Fabricated Person is a mutual connection</p></div></div>' +
    '<p>Pat Example is a mutual connection</p></a></div></div></div>', (document) => {
    const contacts = scrapeLinkedInSearch(document, target, profile);
    assert.equal(contacts.length, 1);
    const contact = contacts[0];
    assert.equal(contact.name, "Sam Example");
    assert.equal(contact.title, "swe @ Fictional Space Co | Avionics");
    assert.equal(contact.company, "Fictional Space Co");
    assert.equal(contact.location, "Los Angeles Metropolitan Area");
    assert.equal(contact.linkedinUrl, "https://www.linkedin.com/in/fictional-sam-example/");
    assert.equal(contact.connectionDegree, 2);
    assert.equal(contact.linkedinEvidence?.headline, contact.title);
    assert.equal(contact.linkedinEvidence?.mutualConnections, "Pat Example is a mutual connection");
    assert.equal(contact.linkedinEvidence?.education, undefined);
    assert.equal(contact.linkedinEvidence?.sourceUrl, searchUrl);
    assert.equal(contact.linkedinEvidence?.sourceText, "Sam Example • 2nd\nswe @ Fictional Space Co | Avionics\nLos Angeles Metropolitan Area");
    assert(contact.linkedinEvidence!.capturedAt > 0);
    assert.equal(contact.warmPaths.some(path => path.type === "alumni"), false);
    assert.doesNotMatch(contact.linkedinEvidence!.sourceText, /Narrative|Fabricated|Connect|View Sam/);
  });
});

test("AI-marked sibling paragraphs cannot fill missing education, employer, or location", () => {
  withDocument('<div role="listitem"><a href="/in/fictional-jamie-example/">' +
    '<div><p>Jamie Example <span>• 3rd</span></p></div><div><p>Independent builder</p></div>' +
    '<div componentkey="SearchResultssnippet_other"><div><svg aria-label="AI generated"></svg>' +
    '<p data-field="location" data-anonymize="company-name">Narrative Co, New York. Morgan Example is a mutual connection</p>' +
    '<p data-field="education">NYU</p></div></div>' +
    '<button>Message</button></a></div>', (document) => {
    const [contact] = scrapeLinkedInSearch(document, target, profile);
    assert.equal(contact.name, "Jamie Example");
    assert.equal(contact.title, "Independent builder");
    assert.equal(contact.company, "");
    assert.equal(contact.location, undefined);
    assert.deepEqual(contact.warmPaths, []);
    assert.equal(contact.email, undefined);
    assert.equal(contact.linkedinEvidence?.education, undefined);
    assert.equal(contact.linkedinEvidence?.mutualConnections, undefined);
    assert.equal(contact.linkedinEvidence?.sourceText, "Jamie Example • 3rd\nIndependent builder");
  });
});

test("anchor-as-card and whole links in other recognized containers are supported", () => {
  withDocument('<div role="list"><a role="listitem" href="/in/fictional-anchor-card/"><p>Robin Example • 1st</p><p>Research Engineer at Fictional Space Co</p><p>Berlin, Germany</p><button>Message</button></a>' +
    '<div data-view-name="search-result"><a href="/in/fictional-container-card/"><p>Casey Example • 3rd</p><p>Designer</p><p>London, England</p><button>Connect</button></a></div></div>', (document) => {
    const contacts = scrapeLinkedInSearch(document, target, profile);
    assert.equal(contacts.length, 2);
    const robin = contacts.find(contact => contact.name === "Robin Example")!;
    const casey = contacts.find(contact => contact.name === "Casey Example")!;
    assert.equal(robin.location, "Berlin, Germany");
    assert.equal(casey.title, "Designer");
    assert.equal(casey.location, "London, England");
    assert.equal(casey.company, "");
  });
});

test("legacy result selectors still retain visible education/location and skip hidden cards", () => {
  withDocument('<main><li class="reusable-search__result-container"><div class="entity-result">' +
    '<div class="entity-result__title-text"><a href="/in/fictional-legacy/"><span aria-hidden="true">Avery Example</span></a><span class="entity-result__badge-text">2nd</span></div>' +
    '<div class="entity-result__primary-subtitle">Engineer at Fictional Space Co</div><div class="entity-result__secondary-subtitle">Boston, Massachusetts</div>' +
    '<div class="entity-result__summary">Education: New York University</div></div></li>' +
    '<div role="listitem" hidden><a href="/in/fictional-hidden/"><p>Hidden Example</p><p>Engineer</p><button>Connect</button></a></div></main>', (document) => {
    const contacts = scrapeLinkedInSearch(document, target, profile);
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].name, "Avery Example");
    assert.equal(contacts[0].location, "Boston, Massachusetts");
    assert.equal(contacts[0].linkedinEvidence?.sourceText, "Avery Example\n2nd\nEngineer at Fictional Space Co\nBoston, Massachusetts");
    assert.match(contacts[0].linkedinEvidence!.education!, /New York University/);
    assert(contacts[0].warmPaths.some(path => path.type === "alumni"));
  });
});

test("all loaded visible result cards import without a fixed cap or duplicate links", () => {
  const cards = Array.from({ length: 25 }, (_, index) => '<div role="listitem"><a href="/in/fictional-bulk-' + index + '/"><p>Example Person ' + index + ' • 3rd</p><p>Engineer</p><p>Example City</p><button>Connect</button></a></div>').join("");
  withDocument('<div role="list">' + cards + '</div>', (document) => {
    const contacts = scrapeLinkedInSearch(document, target, profile);
    assert.equal(contacts.length, 25);
    assert.equal(new Set(contacts.map(contact => contact.linkedinUrl)).size, 25);
  });
});
