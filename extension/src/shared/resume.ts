// Read your name, school, major, year, skills, and past companies out of résumé text
// without AI. The file itself is read in the side panel (see resumeFile.ts) and never
// uploaded; only what you choose to save ends up in your profile.

import { plausibleCompany, ROLE_RE, SKILLS } from "./jobText";

export type ResumeBasics = {
  name: string;
  school: string;
  major: string;
  year: string;
  skills: string[];
  companies: string[];
  clubs: string[];
  background: string;
};

const EXTRA_SKILLS = [
  "HTML", "CSS", "MATLAB", "Pandas", "NumPy", "Scikit-learn", "Jupyter", "Firebase", "Supabase", "Unity",
  "Photoshop", "Illustrator", "Adobe XD", "Canva", "Salesforce", "HubSpot", "SEO", "Arduino", "SolidWorks",
  "AutoCAD", "Bloomberg", "Stata", "SPSS", "Looker", "Jira", "Notion", "OpenCV", "Hadoop", "Kafka", "FastAPI",
  "Express", "Tailwind", "Flutter", "React Native", "iOS", "Android", "Bash", "Verilog", "Embedded systems",
  "UX research", "User research", "Prototyping", "Wireframing", "Data visualization", "Computer vision",
];

const MAJORS = [
  "Computer Science", "Computer Engineering", "Electrical Engineering", "Mechanical Engineering",
  "Civil Engineering", "Chemical Engineering", "Biomedical Engineering", "Industrial Engineering",
  "Data Science", "Mathematics", "Applied Mathematics", "Statistics", "Physics", "Chemistry", "Biology",
  "Neuroscience", "Economics", "Finance", "Accounting", "Business Administration", "Business", "Marketing",
  "Management", "Information Systems", "Information Science", "Psychology", "Cognitive Science",
  "Political Science", "International Relations", "Philosophy", "History", "English", "Journalism",
  "Communications", "Media Studies", "Sociology", "Linguistics", "Graphic Design", "Interaction Design",
  "Integrated Design and Media", "Game Design", "Film", "Music", "Architecture", "Nursing", "Public Health",
];

const SECTION_RE =
  /^(education|experience|work experience|professional experience|employment|projects?|skills|technical skills|leadership|activities|involvement|extracurriculars?|awards|honors|certifications|publications|interests|summary|objective|profile|coursework|relevant coursework)\b[:\s]*$/i;

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
const DATE_RANGE_RE = new RegExp(
  `(?:${MONTH}\\s+)?(?:19|20)\\d\\d\\s*(?:[-–—]|to)\\s*(?:(?:${MONTH}\\s+)?(?:19|20)\\d\\d|Present|Current|Now)`,
  "i",
);

const clean = (value: string) =>
  value.replace(/\s+/g, " ").replace(/^[\s•·●▪\-–—|:,]+|[\s•·●▪\-–—|:,.]+$/g, "").trim();

const unique = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase();
    if (!v || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function hasSkill(lower: string, skill: string) {
  const s = skill.toLowerCase().replace(/[.+#/]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#])${s}($|[^a-z0-9+#])`).test(lower);
}

/** Split résumé lines into sections by their headings ("Education", "Experience", …). */
function sections(lines: string[]) {
  const out: Record<string, string[]> = { top: [] };
  let current = "top";
  for (const line of lines) {
    const heading = SECTION_RE.exec(line);
    if (heading && line.length < 40) {
      const name = heading[1].toLowerCase();
      current = /experience|employment/.test(name)
        ? "experience"
        : /leadership|activities|involvement|extracurricular/.test(name)
          ? "activities"
          : /skills/.test(name)
            ? "skills"
            : /education|coursework/.test(name)
              ? "education"
              : /project/.test(name)
                ? "projects"
                : name;
      out[current] ??= [];
      continue;
    }
    (out[current] ??= []).push(line);
  }
  return out;
}

function findName(lines: string[]) {
  for (const line of lines.slice(0, 5)) {
    const name = clean(line.split(/\s+[|•·]\s+/)[0]);
    if (
      /^[A-Za-zÀ-ÿ'.-]+(?:\s+[A-Za-zÀ-ÿ'.-]+){1,3}$/.test(name) &&
      !/@|\d|resume|curriculum|vitae/i.test(name) &&
      !ROLE_RE.test(name) &&
      !/University|College|Institute/i.test(name)
    )
      return name
        .split(" ")
        .map((w) => (w === w.toUpperCase() && w.length > 1 ? w.charAt(0) + w.slice(1).toLowerCase() : w))
        .join(" ");
  }
  return "";
}

function findSchool(lines: string[]) {
  for (const line of lines) {
    for (const part of line.split(/\s*[,|•·–—]\s*|\s{2,}|\s+-\s+/)) {
      const m = /((?:[A-Z][\w&.'-]*\s+){0,5}(?:University|College|Institute of Technology|Institute|Polytechnic|School of [A-Z][\w ]+)(?:\s+(?:of|at|for)\s+[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3})?)/.exec(part);
      if (m) return clean(m[1].replace(/\s+(?:19|20)\d\d.*$/, ""));
    }
  }
  return "";
}

function findMajor(text: string) {
  const labeled = /^(?:major|concentration|field of study)\s*[:\-–]\s*(.+)$/im.exec(text)?.[1];
  if (labeled) return clean(labeled.split(/[,;|]/)[0]);
  const degree =
    /\b(?:B\.?\s?S\.?|B\.?\s?A\.?|B\.?\s?Eng\.?|B\.?F\.?A\.?|BBA|M\.?\s?S\.?|M\.?\s?A\.?|M\.?Eng\.?|MBA|Ph\.?\s?D\.?|Bachelor(?:['’]s)?(?: of (?:Science|Arts|Engineering|Fine Arts))?|Master(?:['’]s)?(?: of (?:Science|Arts|Engineering))?)\s*(?:degree\s*)?(?:in|of|,)\s+([A-Z][A-Za-z&]+(?:\s+(?:and\s+|&\s+)?[A-Z][A-Za-z&]+){0,4})/.exec(text)?.[1];
  if (degree && !/University|College|Institute/.test(degree)) return clean(degree);
  return MAJORS.find((m) => new RegExp(`\\b${m}\\b`, "i").test(text)) || "";
}

function findYear(education: string[], text: string) {
  const level = /\b(?:Ph\.?\s?D|Doctor)/i.test(text)
    ? "PhD student"
    : /\b(?:M\.?\s?S\.?|M\.?\s?A\.?|MBA|M\.?Eng|Master)/.test(education.join(" "))
      ? "master’s student"
      : "";
  const scope = education.length ? education.join("\n") : text;
  const grad =
    /(?:expected|anticipated|graduat\w*|class of)[^\d\n]{0,20}((?:19|20)\d\d)/i.exec(scope)?.[1] ||
    new RegExp(`${MONTH}\\s+((?:19|20)\\d\\d)(?!\\s*[-–—])`, "i").exec(scope)?.[1] ||
    [...scope.matchAll(/\b((?:19|20)\d\d)\b/g)].map((m) => m[1]).sort().pop();
  if (level && grad) return `${level}, class of ${grad}`;
  if (grad) return `Class of ${grad}`;
  return level;
}

/** "Software Engineering Intern, Stripe  Jun 2024 – Aug 2024" → { company: "Stripe", role }. */
function findJobs(lines: string[], school: string) {
  const jobs: { company: string; role?: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[•·●▪-]/.test(line) || line.length > 120) continue;
    const withoutDates = line
      .replace(DATE_RANGE_RE, "")
      .replace(SEASON_RE, "")
      .replace(/\b(?:Remote|Hybrid)\b/gi, "");
    const at = /^(.+?)\s+(?:at|@)\s+(.+)$/.exec(withoutDates);
    const parts = at
      ? [at[1], at[2].split(/\s*[,|–—]\s*/)[0]].map(clean)
      : withoutDates.split(/\s*[,|–—]\s*|\s{2,}|\s+-\s+/).map(clean).filter(Boolean);
    if (!parts.length) continue;
    let role = parts.find((p) => ROLE_RE.test(p));
    let company = parts.find(
      (p) =>
        p !== role &&
        plausibleCompany(p) &&
        looksLikeCompany(p) &&
        !/^[A-Z][a-z]+,?\s+[A-Z]{2}$/.test(p) &&
        !MONTH_ONLY.test(p),
    );
    // "Stripe    New York, NY" with the role on the next line.
    const next = lines[i + 1] || "";
    if (!role && ROLE_RE.test(next) && !/^[•·●▪-]/.test(next)) {
      if (!company && parts.length === 1 && plausibleCompany(parts[0]) && looksLikeCompany(parts[0])) company = parts[0];
      if (company) role = clean(next.replace(DATE_RANGE_RE, "").split(/\s*[,|–—]\s*|\s{2,}/)[0]);
    }
    if (company && (role || DATE_RANGE_RE.test(line) || ROLE_RE.test(lines[i + 1] || "")) && company !== school)
      jobs.push({ company: clean(company), role: role && clean(role) });
  }
  return jobs;
}
const MONTH_ONLY = new RegExp(`^${MONTH}$`, "i");
// PDFs often drop bullet symbols, so a bullet like "Wrote SQL queries" can look like a
// company. Company names are capitalized throughout and don't start with an action verb.
const ACTION_VERB_RE =
  /^(?:Built|Wrote|Led|Developed|Designed|Created|Analy[sz]ed|Implemented|Managed|Worked|Improved|Increased|Reduced|Collaborated|Conducted|Organized|Launched|Automated|Researched|Taught|Helped|Supported|Partnered|Presented|Delivered|Maintained|Optimized|Prototyped|Shipped|Owned|Drove|Ran|Used)\b/;
const looksLikeCompany = (value: string) =>
  !ACTION_VERB_RE.test(value) &&
  value.split(" ").every((w) => /^(?:[A-Z0-9@&'.(]|of$|and$|the$|for$|de$|y$)/.test(w));
const SEASON_RE = /\b(?:Summer|Fall|Spring|Winter)\s+(?:19|20)\d\d\b/gi;
const CLUB_TITLE_RE =
  /\b(?:President|Vice|Treasurer|Secretary|Chair|Chairperson|Member|Captain|Founder|Co-Founder|Mentor|Tutor|Volunteer|Officer|Director|Organizer|Coordinator|Lead)\b/i;

function findClubs(lines: string[]) {
  return lines
    .filter((l) => !/^[•·●▪-]/.test(l) && l.length < 100)
    .map((l) => clean(l.replace(DATE_RANGE_RE, "").split(/\s*[,|–—]\s*|\s{2,}/)[0]))
    .filter((l) => l && /^[A-Z]/.test(l) && l.split(" ").length <= 7 && !ROLE_RE.test(l) && !CLUB_TITLE_RE.test(l))
    .slice(0, 4);
}

export function extractResumeBasics(raw: string): ResumeBasics {
  const text = raw.replace(/\r/g, "").replace(/ /g, " ");
  const lines = text.split("\n").map((l) => l.replace(/\s+$/g, "").trim()).filter(Boolean);
  const parts = sections(lines);
  const education = parts.education || [];
  const name = findName(lines);
  const school = findSchool(education.length ? education : lines);
  const major = findMajor(education.length ? education.join("\n") : text);
  const year = findYear(education, text);

  const lower = text.toLowerCase();
  const listed = (parts.skills || [])
    .map((l) => l.replace(/^[^:]{0,30}:/, ""))
    .join(", ")
    .split(/[,;•·|]|\s{2,}/)
    .map(clean)
    .filter((s) => s.length > 1 && s.length <= 30 && s.split(" ").length <= 3);
  const known = [...SKILLS, ...EXTRA_SKILLS].filter((s) => hasSkill(lower, s));
  const skills = unique([...known, ...listed.filter((s) => !known.some((k) => k.toLowerCase() === s.toLowerCase()))]).slice(0, 15);

  const jobs = findJobs(parts.experience || lines, school);
  const companies = unique(jobs.map((j) => j.company)).slice(0, 6);
  const clubs = unique(findClubs(parts.activities || [])).filter((c) => !companies.includes(c));

  const roles = unique(jobs.filter((j) => j.role).map((j) => `${j.role} at ${j.company}`)).slice(0, 3);
  const background = [
    [year, major && `studying ${major}`, school && `at ${school}`].filter(Boolean).join(" "),
    roles.length ? `Experience: ${roles.join("; ")}` : companies.length ? `Experience at ${companies.join(", ")}` : "",
    clubs.length ? `Involved in ${clubs.join(", ")}` : "",
    skills.length ? `Skills: ${skills.slice(0, 10).join(", ")}` : "",
  ]
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(". ")
    .concat(roles.length || companies.length || clubs.length || skills.length || school ? "." : "");

  return { name, school, major, year, skills, companies, clubs, background };
}

/** The keywords worth saving for searches: past companies and clubs first, then skills. */
export function resumeKeywords(basics: ResumeBasics) {
  return unique([...basics.companies, ...basics.clubs, ...basics.skills]).slice(0, 20);
}
