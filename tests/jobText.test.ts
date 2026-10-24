import test from "node:test";
import assert from "node:assert/strict";
import { extractJobBasics } from "../extension/src/shared/jobText";

const cases: { name: string; text: string; url?: string; company: string; role: string }[] = [
  { name: "labeled lines", text: "Company: Stripe\nRole: Software Engineer, New Grad\nLocation: New York, NY\nJoin the Payments team.", company: "Stripe", role: "Software Engineer, New Grad" },
  { name: "LinkedIn paste", text: "Software Engineer, New Grad\nStripe · New York, NY · 2 weeks ago · Over 100 applicants\n\nAbout the job\nWe build payments infrastructure.", company: "Stripe", role: "Software Engineer, New Grad" },
  { name: "role at company", text: "Product Designer at Figma\nSan Francisco, CA (Hybrid)\n\nAbout the role\nYou will design collaborative tools.", company: "Figma", role: "Product Designer" },
  { name: "role - company", text: "Data Analyst - Spotify\nNew York, NY\nWe use SQL, Python and Tableau.", company: "Spotify", role: "Data Analyst" },
  { name: "prose", text: "Ramp is hiring a Software Engineering Intern to join our Growth team in New York. At Ramp, we build finance software.", company: "Ramp", role: "Software Engineering Intern" },
  { name: "About heading", text: "About Duolingo\nDuolingo is the world's most popular language app.\n\nThe role\nWe're looking for a Machine Learning Engineer to help personalize lessons.", company: "Duolingo", role: "Machine Learning Engineer" },
  { name: "Greenhouse link", text: "Associate Product Manager\n\nWhat you'll do\nShip features with engineering and design.", url: "https://boards.greenhouse.io/notion/jobs/123456", company: "Notion", role: "Associate Product Manager" },
  { name: "careers site", text: "Backend Engineer\nWe run distributed systems at scale with Go and Kubernetes.", url: "https://careers.datadoghq.com/detail/123/", company: "Datadog", role: "Backend Engineer" },
];

for (const c of cases)
  test(`job reader finds company and role: ${c.name}`, () => {
    const got = extractJobBasics(c.text, c.url);
    assert.equal(got.company, c.company);
    assert.equal(got.role, c.role);
  });

test("job reader picks up team, location and skills, and admits when it finds nothing", () => {
  const ramp = extractJobBasics("Ramp is hiring a Software Engineering Intern to join our Growth team in New York. You'll work in TypeScript and React.");
  assert.equal(ramp.team, "Growth");
  assert.equal(ramp.location, "New York");
  assert.deepEqual(ramp.skills, ["TypeScript", "React"]);
  const labeled = extractJobBasics("Company: Stripe\nRole: Software Engineer\nJoin the Payments team.");
  assert.equal(labeled.team, "Payments");
  const none = extractJobBasics("We are hiring someone great to join our growing team soon. Apply now!");
  assert.equal(none.company, "Not specified");
  assert.equal(none.role, "Not specified");
});
