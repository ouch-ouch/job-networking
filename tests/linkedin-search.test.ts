import test from "node:test";
import assert from "node:assert/strict";
import type { Profile, Target } from "../extension/src/shared/types";
import { parseLinkedInResultLines } from "../extension/src/content/linkedin-search";
import { contactFromSearchResult } from "../extension/src/content/sourcing";

test("whole-card result links preserve the name, degree, and immediate headline only", () => {
  const result = parseLinkedInResultLines(`Sam Example
 • 2nd

swe @ spacex

Los Angeles Metropolitan Area

Connect

Software Engineer II at Fictional Narrative Co. Education: NYU. AI-generated summary.

Someone is a mutual connection`);
  assert.deepEqual(result, {
    name: "Sam Example",
    title: "swe @ spacex",
    degreeText: "2nd",
  });
  assert.equal(result && "education" in result, false);
  assert.equal(result && "company" in result, false);
});

test("narrative employer and education do not become contact evidence", () => {
  const profile: Profile = {
    name: "Alex Example", school: "NYU", major: "CS", year: "Student",
    background: "", availability: "", signature: "",
  };
  const target: Target = {
    id: "fictional-target", company: "Fictional Narrative Co", role: "Engineer",
    skills: [], rawDescription: "",
  };
  const header = parseLinkedInResultLines(`Sam Example
• 3rd+
swe @ spacex
Los Angeles Metropolitan Area
Connect
Education: NYU. Sam works at Fictional Narrative Co. AI-generated summary.`)!;
  const contact = contactFromSearchResult({ ...header, linkedinUrl: "https://www.linkedin.com/in/fictional-sam-example/" }, target, profile)!;
  assert.equal(contact.name, "Sam Example");
  assert.equal(contact.company, "spacex");
  assert.equal(contact.connectionDegree, 3);
  assert.deepEqual(contact.warmPaths, []);
});

test("inline degrees and Windows line endings are supported", () => {
  assert.deepEqual(parseLinkedInResultLines("Taylor Example • 1st\r\nProduct Designer at Fictional Studio\r\nNew York\r\nMessage"), {
    name: "Taylor Example", title: "Product Designer at Fictional Studio", degreeText: "1st",
  });
});

test("a missing headline never causes scanning into a later narrative", () => {
  assert.deepEqual(parseLinkedInResultLines("Sam Example\n• 2nd\nConnect\nEducation: NYU. Sam works at Narrative Co."), {
    name: "Sam Example", title: "", degreeText: "2nd",
  });
  assert.deepEqual(parseLinkedInResultLines("Sam Example\n• 3rd\nAI-generated summary: Engineer at Narrative Co.\nConnect"), {
    name: "Sam Example", title: "", degreeText: "3rd",
  });
});

test("empty results and standalone degree or action labels do not create names", () => {
  for (const value of ["", " \n\t", "• 2nd\nConnect", "Connect\nEngineer", "LinkedIn Member\n3rd"]) {
    assert.equal(parseLinkedInResultLines(value), undefined);
  }
});
