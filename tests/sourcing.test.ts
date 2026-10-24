import test from "node:test";
import assert from "node:assert/strict";
import type {
  Contact,
  Draft,
  Profile,
  Target,
} from "../extension/src/shared/types";
import {
  buildLinkedInSearchQuery,
  buildLinkedInSearchUrl,
  buildWebSearchUrl,
  canonicalLinkedInProfile,
  contactFromSearchResult,
  guessEmails,
  rankContact,
} from "../extension/src/content/sourcing";
import { fillLinkedInComposer } from "../extension/src/content/linkedin-profile";

const profile: Profile = {
  name: "Alex Kim",
  school: "NYU",
  major: "Computer Science",
  year: "Master’s student",
  background: "",
  availability: "",
  signature: "",
};
const target: Target = {
  id: "target",
  company: "Acme",
  role: "Software Engineer",
  team: "Payments",
  skills: ["TypeScript"],
  rawDescription: "",
  domain: "acme.example",
};
const contact: Contact = {
  id: "contact",
  targetId: target.id,
  name: "Sam Chen",
  title: "Software Engineer at Acme",
  company: "Acme",
  warmPaths: [],
  relevance: 0,
  reason: "",
  stage: "found",
  followUpCount: 0,
};

test("people search starts broadly without forcing the exact job title or school", () => {
  const url = new URL(buildLinkedInSearchUrl(target, profile));
  assert.equal(url.origin, "https://www.linkedin.com");
  assert.equal(url.pathname, "/search/results/people/");
  assert.equal(url.searchParams.get("keywords"), "Acme");
  assert.equal(url.searchParams.has("schoolFilter"), false);
  assert.equal(url.searchParams.has("currentCompany"), false);
});

test("role and alumni searches narrow independently instead of requiring both", () => {
  assert.equal(
    buildLinkedInSearchQuery(target, profile, "role"),
    "Acme Software Engineer",
  );
  assert.equal(
    buildLinkedInSearchQuery(target, profile, "alumni"),
    'Acme "NYU"',
  );
  assert.equal(
    new URL(buildLinkedInSearchUrl(target, profile, { scope: "alumni" }))
      .searchParams.get("keywords"),
    'Acme "NYU"',
  );
});

test("unknown parsed fields never become default people-search keywords", () => {
  for (const company of ["", "  ", "Not specified", "Unknown", "N/A"]) {
    const incomplete = { ...target, company };
    assert.equal(buildLinkedInSearchQuery(incomplete, profile), "");
    assert.throws(() => buildLinkedInSearchUrl(incomplete, profile), /company name/);
  }
  assert.equal(
    buildLinkedInSearchQuery({ ...target, role: "Not specified" }, profile, "role"),
    "",
  );
  assert.equal(
    buildLinkedInSearchQuery(target, { ...profile, school: "" }, "alumni"),
    "",
  );
  assert.equal(buildLinkedInSearchQuery({ ...target, role: "Unknown" }, profile), "Acme");
});

test("editable search can correct a parsed brand and encodes keywords safely", () => {
  const url = new URL(buildLinkedInSearchUrl(target, profile, {
    keywords: '  Acme Labs  "machine learning"  ',
  }));
  assert.equal(url.searchParams.get("keywords"), 'Acme Labs "machine learning"');
  assert.equal(url.searchParams.size, 1);
  assert.throws(() => buildLinkedInSearchUrl(target, profile, { keywords: "  " }), /keywords/);
  assert.equal(
    buildLinkedInSearchQuery({ ...target, company: ' Acme\n"Labs"\u0000 ' }, profile),
    "Acme Labs",
  );
});

test("AI search text cannot change the browser search destination", () => {
  const query = 'Acme "NYU" &url=https://example.invalid/#profile';
  for (const engine of ["google", "bing"] as const) {
    const url = new URL(buildWebSearchUrl(query, engine));
    assert.equal(url.hostname, engine === "google" ? "www.google.com" : "www.bing.com");
    assert.equal(url.searchParams.get("q"), query);
    assert.equal(url.searchParams.size, 1);
    assert.equal(url.hash, "");
  }
  assert.throws(() => buildWebSearchUrl("  "), /keywords/);
});

test("email patterns require an explicit valid domain and remain unverified guesses", () => {
  const guesses = guessEmails("Dr. María O’Neil", "acme.example");
  assert.deepEqual(
    guesses.map((guess) => guess.email),
    ["maria.oneil@acme.example", "moneil@acme.example", "maria@acme.example"],
  );
  assert(
    guesses.every((guess) => guess.confidence > 0 && guess.confidence <= 0.6),
  );
  for (const domain of [
    "",
    "Acme Inc",
    "https://acme.example",
    "acme.example/path",
    "person@acme.example",
    "-bad.example",
  ])
    assert.deepEqual(guessEmails("Sam Chen", domain), []);
  assert.deepEqual(guessEmails("Prince", "acme.example"), [
    { email: "prince@acme.example", confidence: 0.3 },
  ]);
});

test("ranking uses supplied warm path evidence and does not mutate the contact", () => {
  const plain = rankContact(contact, profile, target);
  const alumni = rankContact(
    {
      ...contact,
      warmPaths: [{ type: "alumni", detail: "NYU listed in education" }],
    },
    profile,
    target,
  );
  assert(alumni.relevance > plain.relevance);
  assert.match(alumni.reason, /^NYU listed in education/);
  assert.deepEqual(contact.warmPaths, []);
  const secondDegree = rankContact(
    { ...contact, connectionDegree: 2 },
    profile,
    target,
  );
  assert.equal(secondDegree.warmPaths[0].type, "mutual_connection");
  assert(secondDegree.relevance > plain.relevance);
  assert.equal(
    rankContact({ ...contact, title: "", company: "" }, profile, target)
      .warmPaths.length,
    0,
  );
});

test("search result parser keeps only visible education evidence and explicit company information", () => {
  const parsed = contactFromSearchResult(
    {
      name: "Sam Chen",
      title: "Software Engineer at Acme",
      linkedinUrl: "/in/sam-chen/?miniProfileUrn=123",
      degreeText: "2nd",
      education: "New York University",
    },
    target,
    profile,
  )!;
  assert.equal(parsed.name, "Sam Chen");
  assert.equal(parsed.company, "Acme");
  assert.equal(parsed.linkedinUrl, "https://www.linkedin.com/in/sam-chen/");
  assert.equal(parsed.stage, "found");
  assert.equal(parsed.connectionDegree, 2);
  assert.equal(
    parsed.warmPaths.find((path) => path.type === "alumni")?.type,
    "alumni",
  );
  assert.equal(parsed.emailVerified, false);
  assert.equal(parsed.email, "sam.chen@acme.example");
  assert(parsed.id.length > 10);
  const unknown = contactFromSearchResult(
    {
      name: "Jamie Lee",
      title: "Engineer",
      linkedinUrl: "https://linkedin.com/in/jamie-lee",
    },
    { ...target, domain: undefined },
    profile,
  )!;
  assert.equal(unknown.company, "");
  assert.deepEqual(unknown.warmPaths, []);
  assert.equal(unknown.email, undefined);
});

test("profile URLs reject non-profile pages and outside origins", () => {
  assert.equal(
    canonicalLinkedInProfile("https://linkedin.com/in/sam/?tracking=1"),
    "https://www.linkedin.com/in/sam/",
  );
  for (const url of [
    "https://evil.example/in/sam",
    "https://www.linkedin.com/company/acme",
    "https://www.linkedin.com/in/sam/details/experience/",
    "http://www.linkedin.com/in/sam",
  ])
    assert.equal(canonicalLinkedInProfile(url), undefined);
  assert.equal(
    contactFromSearchResult(
      { name: "LinkedIn Member", title: "", linkedinUrl: "/in/member/" },
      target,
      profile,
    ),
    undefined,
  );
});

test("LinkedIn fill refuses unapproved drafts, wrong contacts, and overlong connection notes before reading the page", () => {
  const draft: Draft = {
    id: "draft",
    contactId: contact.id,
    kind: "initial",
    channel: "linkedin_connect",
    body: "Hello Sam",
    filledKeywords: {},
    status: "pending",
    createdAt: 0,
  };
  const unreadablePage = {
    querySelectorAll() {
      throw new Error("The page should not be read");
    },
  } as unknown as Document;
  assert.throws(
    () => fillLinkedInComposer(contact, draft, unreadablePage),
    /Approve this draft/,
  );
  assert.throws(
    () =>
      fillLinkedInComposer(
        contact,
        { ...draft, status: "approved", contactId: "someone-else" },
        unreadablePage,
      ),
    /different contact/,
  );
  assert.throws(
    () =>
      fillLinkedInComposer(
        contact,
        { ...draft, status: "approved", body: "a".repeat(301) },
        unreadablePage,
      ),
    /300 characters/,
  );
});

test("LinkedIn fill requires the matching open profile and an existing composer", () => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const draft: Draft = {
    id: "draft",
    contactId: contact.id,
    kind: "initial",
    channel: "linkedin_connect",
    body: "Hello Sam",
    filledKeywords: {},
    status: "approved",
    createdAt: 0,
  };
  const linkedContact = {
    ...contact,
    linkedinUrl: "https://www.linkedin.com/in/sam-chen/",
  };
  const emptyPage = { querySelectorAll: () => [] } as unknown as Document;
  try {
    Object.defineProperty(globalThis, "window", {
      value: {
        location: { href: "https://www.linkedin.com/in/someone-else/" },
      },
      configurable: true,
    });
    assert.throws(
      () => fillLinkedInComposer(linkedContact, draft, emptyPage),
      /Open Sam Chen's LinkedIn profile/,
    );
    Object.defineProperty(globalThis, "window", {
      value: { location: { href: linkedContact.linkedinUrl } },
      configurable: true,
    });
    assert.throws(
      () => fillLinkedInComposer(linkedContact, draft, emptyPage),
      /Open Connect → Add a note/,
    );
  } finally {
    if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
