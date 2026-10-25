import { test } from "node:test";
import assert from "node:assert/strict";
import { extractResumeBasics, resumeKeywords } from "../extension/src/shared/resume";

const NYU = `ALEX CHEN
New York, NY | alex.chen@nyu.edu | (555) 123-4567 | linkedin.com/in/alexchen

EDUCATION
New York University, Tandon School of Engineering    Brooklyn, NY
B.S. in Computer Science, Minor in Mathematics    Expected May 2027
GPA: 3.8 / 4.0

EXPERIENCE
Software Engineering Intern, Stripe    Jun 2025 – Aug 2025
• Built a payments dashboard in React and TypeScript used by 40 internal teams
• Wrote SQL pipelines in Airflow
Datadog    New York, NY
Data Analyst Intern    Jun 2024 – Aug 2024
• Analyzed customer churn with Python and Pandas

LEADERSHIP
Tech@NYU    Sep 2023 – Present
Vice President
NYU Women in Computing    2024 – Present

SKILLS
Languages: Python, Java, TypeScript, SQL, C++
Tools: Git, Docker, AWS, Figma
`;

test("reads name, school, major, year, companies, clubs, and skills", () => {
  const r = extractResumeBasics(NYU);
  assert.equal(r.name, "Alex Chen");
  assert.equal(r.school, "New York University");
  assert.equal(r.major, "Computer Science");
  assert.equal(r.year, "Class of 2027");
  assert.deepEqual(r.companies, ["Stripe", "Datadog"]);
  assert.deepEqual(r.clubs, ["Tech@NYU", "NYU Women in Computing"]);
  assert.ok(!r.skills.some((s) => s.includes(":")), r.skills.join("|"));
  assert.match(r.background, /Data Analyst Intern at Datadog/);
  for (const s of ["Python", "TypeScript", "SQL", "React", "Docker", "Figma", "C++"])
    assert.ok(r.skills.includes(s), `${s} missing from ${r.skills.join(", ")}`);
  assert.match(r.background, /Software Engineering Intern at Stripe/);
  assert.equal(resumeKeywords(r)[0], "Stripe");
});

test("handles a master's résumé with 'Role at Company' lines", () => {
  const r = extractResumeBasics(`Priya Patel
priya@columbia.edu

Education
Columbia University — M.S. Data Science, December 2026
University of Michigan — B.A. Economics, 2023

Work Experience
Product Analyst at Spotify, 2023 - Present
Marketing Intern at L'Oréal, Summer 2022

Technical Skills
Python, R, Tableau, Excel, A/B testing`);
  assert.equal(r.name, "Priya Patel");
  assert.equal(r.school, "Columbia University");
  assert.equal(r.major, "Data Science");
  assert.equal(r.year, "master’s student, class of 2026");
  assert.deepEqual(r.companies, ["Spotify", "L'Oréal"]);
  assert.ok(r.skills.includes("Tableau") && r.skills.includes("A/B testing"));
});

test("returns empty values for text that isn't a résumé", () => {
  const r = extractResumeBasics("");
  assert.equal(r.name, "");
  assert.deepEqual(resumeKeywords(r), []);
  assert.equal(r.background, "");
});

test("ignores bullet lines that lost their bullet symbol in a PDF", () => {
  const r = extractResumeBasics(`Jordan Rivera
EDUCATION
New York University
B.S. in Computer Engineering, Expected May 2027
EXPERIENCE
Software Engineering Intern, Ramp  Jun 2025 – Aug 2025
Built expense tools in TypeScript and React
Wrote PostgreSQL queries
Research Assistant at NYU Center for Data Science, 2024 - 2025
LEADERSHIP
NYU Robotics Club  Sep 2023 – Present`);
  assert.deepEqual(r.companies, ["Ramp", "NYU Center for Data Science"]);
  assert.deepEqual(r.clubs, ["NYU Robotics Club"]);
  assert.match(r.background, /Software Engineering Intern at Ramp; Research Assistant at NYU Center for Data Science\./);
});
