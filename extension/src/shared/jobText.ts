// Read company, role, team, location, and skills out of a pasted job posting without AI.
// Used in demo mode and whenever Grok is unavailable. Tries many common posting
// layouts and falls back to "Not specified" only when nothing plausible is found.

export type JobBasics = {
  company: string;
  role: string;
  team: string;
  location: string;
  skills: string[];
};

const ROLE_WORDS =
  "Engineer|Developer|Scientist|Analyst|Designer|Manager|Intern|Internship|Associate|Consultant|Researcher|Specialist|Coordinator|Architect|Lead|Director|Representative|Recruiter|Accountant|Administrator|Technician|Writer|Strategist|Programmer|Officer|Fellow|Assistant|Producer|Editor|Marketer|Advocate|Partner|Owner";
export const ROLE_RE = new RegExp(`\\b(${ROLE_WORDS})s?\\b`, "i");

// Words that look like names but aren't companies.
const NOT_COMPANY = new Set(
  (
    "The A An We Our You Your About Job Jobs Role Position Team Company Overview Description Responsibilities " +
    "Requirements Qualifications Benefits Location Remote Hybrid Apply Applicants Candidates Join Us This It They " +
    "Who What Why How When Where Full Part Time Senior Junior Staff Principal New York San Francisco Los Angeles " +
    "Seattle Boston Austin Chicago London United States America USA US Equal Opportunity Employer EEO LinkedIn " +
    "Greenhouse Lever Ashby Workday Indeed Glassdoor Software Engineer Engineering Product Design Data Summer Fall " +
    "Spring Winter Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June " +
    "July August September October November December Bachelor Bachelors Master Masters PhD BS MS Computer Science " +
    "Python Java JavaScript TypeScript React SQL AWS Google Cloud Microsoft Excel Salary Pay Compensation Visa"
  ).split(" "),
);

export const SKILLS = [
  "TypeScript", "JavaScript", "Python", "Java", "Go", "Rust", "C++", "C#", "Ruby", "Kotlin", "Swift", "Scala",
  "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "GraphQL", "REST", "APIs", "React", "Next.js", "Vue",
  "Angular", "Node.js", "Django", "Flask", "Spring", "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform",
  "Linux", "Git", "CI/CD", "Distributed systems", "Microservices", "Machine learning", "Deep learning", "PyTorch",
  "TensorFlow", "NLP", "LLMs", "Data analysis", "Statistics", "Excel", "Tableau", "Power BI", "Figma",
  "Financial modeling", "Product management", "A/B testing", "Spark", "Airflow", "dbt", "Snowflake",
];

const clean = (value: string) =>
  value.replace(/\s+/g, " ").replace(/^[\s"'“”•·\-–—|:,]+|[\s"'“”•·\-–—|:,.]+$/g, "").trim();

const titleCase = (slug: string) =>
  slug
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** A plausible company name: 1-4 capitalized-ish words, not a generic word. */
export function plausibleCompany(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const name = clean(value).replace(/\s*\((?:remote|hybrid|on-?site)\)$/i, "");
  if (!name || name.length > 50 || /^\d/.test(name)) return undefined;
  const words = name.split(" ");
  if (words.length > 5) return undefined;
  if (words.every((w) => NOT_COMPANY.has(w.replace(/[^A-Za-z]/g, "")))) return undefined;
  if (!/^[A-Z0-9&]/.test(name)) return undefined;
  if (ROLE_RE.test(name) && words.length > 1) return undefined; // "Software Engineer" isn't a company
  return name;
}

/** A plausible role: short, contains a job word. */
function plausibleRole(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const role = clean(value)
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\s+(?:to join|who|that|with|in|at|for our|on our)\b.*$/i, "");
  if (!role || role.length > 90 || !ROLE_RE.test(role)) return undefined;
  if (role.split(" ").length > 12) return undefined;
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function companyFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const first = u.pathname.split("/").filter(Boolean)[0];
    if (/(^|\.)greenhouse\.io$|(^|\.)lever\.co$|(^|\.)ashbyhq\.com$|(^|\.)workable\.com$|(^|\.)smartrecruiters\.com$/.test(host) && first)
      return titleCase(first);
    const workday = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/.exec(host);
    if (workday) return titleCase(workday[1]);
    if (/linkedin\.com$|indeed\.com$|glassdoor\.com$|google\.com$/.test(host)) return undefined;
    const parts = host.split(".");
    const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    const name = base?.replace(/(?:hq|inc|jobs|careers)$/i, "");
    if (name && !["careers", "jobs", "apply", "boards"].includes(name)) return titleCase(name);
  } catch {
    // not a URL
  }
  return undefined;
}

export function extractJobBasics(raw: string, url?: string): JobBasics {
  const text = raw.replace(/\r/g, "");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const top = lines.slice(0, 8);
  const label = (names: string) =>
    new RegExp(`^(?:${names})\\s*[:\\-–]\\s*(.+)$`, "im").exec(text)?.[1];

  // ---- role ----
  let role = plausibleRole(label("role|job title|title|position|job|opening"));
  let company = plausibleCompany(label("company|employer|organization|organisation|company name"));

  // "Software Engineer at Stripe" / "Software Engineer - Stripe" / "Stripe | Software Engineer"
  for (const line of top) {
    if (role && company) break;
    const at = /^(.{3,90}?)\s+(?:at|@)\s+([A-Z][\w&.' -]{1,48})$/.exec(line);
    if (at && plausibleRole(at[1])) {
      role ??= plausibleRole(at[1]);
      company ??= plausibleCompany(at[2]);
      continue;
    }
    const sep = line.split(/\s+[|–—-]\s+/);
    if (sep.length === 2) {
      const [a, b] = sep;
      if (plausibleRole(a) && plausibleCompany(b)) {
        role ??= plausibleRole(a);
        company ??= plausibleCompany(b);
      } else if (plausibleRole(b) && plausibleCompany(a)) {
        role ??= plausibleRole(b);
        company ??= plausibleCompany(a);
      }
    }
  }

  // LinkedIn paste: "Software Engineer\nStripe · New York, NY · 2 weeks ago"
  if (!company) {
    const dotted = top.find((l) => l.includes(" · "));
    if (dotted) company = plausibleCompany(dotted.split(" · ")[0]);
  }

  // Sentences.
  const sentence = (re: RegExp) => re.exec(text)?.[1];
  company ??=
    plausibleCompany(sentence(/^About\s+(?!the\b|us\b|this\b|you\b|the role\b)([A-Z][\w&.' -]{1,40})\s*$/m)) ??
    plausibleCompany(sentence(/\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\s+(?:is|are)\s+(?:hiring|looking for|seeking|growing|building)\b/)) ??
    plausibleCompany(sentence(/\b[Jj]oin\s+(?:us at\s+|the team at\s+)?([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,2})(?=[\s,.!])/)) ??
    plausibleCompany(sentence(/\b(?:At|at)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,2}),\s+(?:we|our)\b/)) ??
    plausibleCompany(sentence(/\b(?:work|working|career|careers|life)\s+at\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,2})/));

  role ??=
    plausibleRole(sentence(/\b(?:hiring|looking for|seeking|searching for)\s+(?:an?\s+|our next\s+|a new\s+)?([A-Za-z][\w,/&+() -]{3,80}?(?:Engineer|Developer|Scientist|Analyst|Designer|Manager|Intern|Associate|Consultant|Researcher|Specialist|Coordinator|Architect|Lead|Recruiter|Writer|Strategist)s?)\b/i)) ??
    plausibleRole(sentence(/\bAs (?:an?|our)\s+([A-Za-z][\w,/&+() -]{3,80}?(?:Engineer|Developer|Scientist|Analyst|Designer|Manager|Intern|Associate|Consultant|Researcher|Specialist|Coordinator|Architect|Lead|Recruiter|Writer|Strategist)),/i));

  // A short line near the top that names a job.
  role ??= plausibleRole(top.find((l) => l.length <= 80 && ROLE_RE.test(l) && !/[.!?]$/.test(l)));

  // The job's own web address.
  company ??= companyFromUrl(url);

  // Last resort: the capitalized name the posting mentions most.
  if (!company) {
    const counts = new Map<string, number>();
    for (const m of text.matchAll(/\b([A-Z][a-zA-Z0-9&]+(?:\s+[A-Z][a-zA-Z0-9&]+){0,2})\b/g)) {
      const name = plausibleCompany(m[1]);
      if (name && !ROLE_RE.test(name)) counts.set(name, (counts.get(name) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2) company = best[0];
  }

  // ---- team, location, skills ----
  const team =
    clean(label("team|department|org") || "") ||
    clean(sentence(/\b(?:[Oo]n|[Jj]oin|[Jj]oining|[Ff]or)\s+(?:the|our)\s+([A-Z][\w&/ -]{1,40}?)\s+team\b/) || "");
  const location =
    clean(label("location|locations|office|based in") || "") ||
    clean(sentence(/\b((?:New York|San Francisco|Los Angeles|Seattle|Boston|Austin|Chicago|Denver|Atlanta|Miami|Washington|London|Toronto)(?:,\s*[A-Z]{2})?)\b/) || "") ||
    clean(sentence(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC))\b/) || "") ||
    (/\bremote\b/i.test(text) ? "Remote" : "");
  const lower = text.toLowerCase();
  const skills = SKILLS.filter((skill) => {
    const s = skill.toLowerCase();
    return s.length <= 3
      ? new RegExp(`(^|[^a-z0-9+#])${s.replace(/[+#]/g, "\\$&")}($|[^a-z0-9+#])`).test(lower)
      : lower.includes(s);
  }).slice(0, 12);

  return {
    company: company || "Not specified",
    role: role || "Not specified",
    team,
    location,
    skills,
  };
}
