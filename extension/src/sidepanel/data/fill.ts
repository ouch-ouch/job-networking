// Mock-only stand-ins for C's /ai/* routes, so the UI flows work offline.
import type { Contact, Profile, Question, Target, Template } from "../../shared/types";

export const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export const KNOWN_PLACEHOLDERS = [
  "first_name", "my_name", "my_year", "my_major", "company", "role", "their_team", "personal_hook",
] as const;

export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))];
}

function hookFor(contact: Contact, profile: Profile): string {
  const path = contact.warmPaths[0];
  if (!path) return "";
  switch (path.type) {
    case "alumni": return `Fellow ${profile.school} student here (I saw you're ${path.detail}).`;
    case "past_employer": return `I saw you were at ${path.detail.split(",")[0]}, where I interned too.`;
    case "shared_org": return `I'm in ${path.detail.split(" (")[0]} now and saw you were too.`;
    case "mutual_connection": return `I noticed we're connected through ${path.detail.replace(/^Connected with /, "")}.`;
  }
}

/** Mock /ai/fill-template: replaces placeholders only, keeps the user's wording. */
export function mockFillTemplate(template: Template, profile: Profile, target: Target, contact: Contact) {
  const filledKeywords: Record<string, string> = {
    first_name: contact.name.split(" ")[0],
    my_name: profile.name,
    my_year: profile.year,
    my_major: profile.major,
    company: target.company,
    role: target.role,
    their_team: contact.title.split(", ")[1] ?? target.team ?? target.company,
    personal_hook: hookFor(contact, profile),
  };
  const fill = (s: string) =>
    s.replace(PLACEHOLDER_RE, (_, k: string) => filledKeywords[k] ?? "")
      .replace(/ {2,}/g, " ").trim();
  let body = fill(template.body);
  if (template.channel === "linkedin_connect" && body.length > 300) body = body.slice(0, 297) + "...";
  return { subject: template.subject ? fill(template.subject) : undefined, body, filledKeywords };
}

const SKILL_WORDS = ["TypeScript", "JavaScript", "Python", "Go", "Java", "SQL", "React", "AWS", "Distributed systems", "Machine learning", "Excel", "Financial modeling"];

/** Mock /ai/parse-job (AI_EXTRACT in the real thing). */
export function mockParseJob(raw: string): Omit<Target, "id" | "rawDescription" | "url"> {
  const first = raw.trim().split("\n")[0] ?? "";
  const [company = "Unknown company", role = "Unknown role", team] = first.split(/,\s*|\s+[-–]\s+/);
  const loc = raw.match(/(New York, NY|San Francisco, CA|Remote|Boston, MA|Seattle, WA)/)?.[1];
  const skills = SKILL_WORDS.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(raw));
  return { company, role, team: team?.replace(/\s*\(.*\)$/, ""), location: loc, skills };
}

/** Mock /ai/prep-brief: picks approved questions, favoring ones that landed well. */
export function mockPickQuestions(bank: Question[], team?: string): { id: string; text: string }[] {
  return bank
    .filter((q) => q.status === "approved")
    .sort((a, b) => (b.landedWell ?? 0) - (a.landedWell ?? 0) || a.timesUsed - b.timesUsed)
    .slice(0, 5)
    .map((q) => ({ id: q.id, text: team ? q.text.replace(/your team/, `the ${team} team`) : q.text }));
}
