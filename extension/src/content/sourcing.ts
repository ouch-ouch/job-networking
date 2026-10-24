import type { Contact, Profile, Target, WarmPath } from "../shared/types";

const noiseWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "at",
  "of",
  "to",
  "in",
  "a",
  "an",
  "on",
]);

const compact = (value: string) => value.replace(/\s+/g, " ").trim();
const normalized = (value: string) =>
  compact(
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " "),
  );
const words = (value: string) => [
  ...new Set(
    normalized(value)
      .split(" ")
      .filter((word) => word.length > 2 && !noiseWords.has(word)),
  ),
];

export type LinkedInSearchScope = "company" | "role" | "alumni";

const searchTerm = (value: string) => {
  const term = compact(value.replace(/[\u0000-\u001f\u007f"“”]/g, " "));
  return /^(?:not specified|unknown|n\/?a|none)$/i.test(term) ? "" : term;
};

/** Start broadly; a job's full title and school can exclude relevant people. */
export function buildLinkedInSearchQuery(
  target: Target,
  profile: Profile,
  scope: LinkedInSearchScope = "company",
): string {
  const company = searchTerm(target.company);
  if (!company) return "";
  if (scope === "company") return company;
  const extra = searchTerm(scope === "role" ? target.role : profile.school);
  if (!extra) return "";
  return scope === "alumni"
    ? `${company} "${extra}"`
    : `${company} ${extra}`;
}

/** A link for the user to open. No LinkedIn company/school IDs are invented. */
export function buildLinkedInSearchUrl(
  target: Target,
  profile: Profile,
  options: { scope?: LinkedInSearchScope; keywords?: string } = {},
): string {
  const keywords = compact(
    options.keywords ?? buildLinkedInSearchQuery(target, profile, options.scope),
  );
  if (!keywords)
    throw new Error("Enter a company name or search keywords first.");
  const url = new URL("https://www.linkedin.com/search/results/people/");
  url.searchParams.set("keywords", keywords);
  return url.toString();
}

/** Generated queries become search parameters, never model-supplied destinations. */
export function buildWebSearchUrl(
  keywords: string,
  engine: "google" | "bing" = "google",
): string {
  const query = compact(keywords);
  if (!query) throw new Error("Enter search keywords first.");
  const url = new URL(
    engine === "bing"
      ? "https://www.bing.com/search"
      : "https://www.google.com/search",
  );
  url.searchParams.set("q", query);
  return url.toString();
}

/** Guesses are deliberately unverified and stay below the default send threshold. */
export function guessEmails(
  name: string,
  domain: string,
): { email: string; confidence: number }[] {
  const cleanDomain = domain.trim().toLowerCase().replace(/^@/, "");
  if (
    cleanDomain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      cleanDomain,
    )
  )
    return [];
  const nameParts = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, "")
    .split(/\s+/)
    .map((part) => part.replace(/['-]/g, ""))
    .filter(
      (part) =>
        part &&
        ![
          "mr",
          "mrs",
          "ms",
          "dr",
          "prof",
          "jr",
          "sr",
          "ii",
          "iii",
          "iv",
          "phd",
        ].includes(part),
    );
  if (!nameParts.length) return [];
  const first = nameParts[0];
  const last = nameParts.at(-1)!;
  const patterns: [string, number][] =
    nameParts.length > 1
      ? [
          [`${first}.${last}`, 0.55],
          [`${first[0]}${last}`, 0.45],
          [first, 0.35],
        ]
      : [[first, 0.3]];
  return patterns
    .filter(
      ([local], index, all) =>
        all.findIndex(([candidate]) => candidate === local) === index,
    )
    .map(([local, confidence]) => ({
      email: `${local}@${cleanDomain}`,
      confidence,
    }));
}

/** Ranking uses only supplied contact evidence; it does not infer shared employers/orgs. */
export function rankContact(
  contact: Contact,
  _profile: Profile,
  target: Target,
): Contact {
  const company = normalized(target.company);
  const companyMatches = Boolean(
    company && normalized(contact.company) === company,
  );
  const contactWords = new Set(words(contact.title));
  const roleHits = words(
    [target.role, target.team ?? "", ...target.skills].join(" "),
  ).filter((word) => contactWords.has(word));
  const paths = [...contact.warmPaths];
  if (
    contact.connectionDegree === 2 &&
    !paths.some((path) => path.type === "mutual_connection")
  ) {
    paths.push({
      type: "mutual_connection",
      detail: "2nd-degree LinkedIn connection",
    });
  }
  const boosts: Record<WarmPath["type"], number> = {
    alumni: 35,
    past_employer: 25,
    shared_org: 20,
    mutual_connection: 12,
  };
  const strongest = [...paths].sort(
    (a, b) => boosts[b.type] - boosts[a.type],
  )[0];
  const warmBoost = Math.min(
    50,
    paths.reduce((total, path) => total + boosts[path.type], 0),
  );
  const relevance = Math.min(
    100,
    15 +
      (companyMatches ? 25 : 0) +
      Math.min(25, roleHits.length * 8) +
      warmBoost +
      (contact.connectionDegree === 1 ? 5 : 0),
  );
  const reasons = [
    strongest?.detail,
    roleHits.length ? `Title matches ${roleHits.slice(0, 2).join(" / ")}` : "",
    companyMatches ? `Works at ${target.company}` : "",
  ].filter(Boolean);
  return {
    ...contact,
    warmPaths: paths,
    relevance,
    reason:
      reasons.join(" · ") || "Review the visible profile before reaching out",
  };
}

export function canonicalLinkedInProfile(value: string): string | undefined {
  try {
    const url = new URL(value, "https://www.linkedin.com");
    if (
      !["linkedin.com", "www.linkedin.com"].includes(
        url.hostname.toLowerCase(),
      ) ||
      url.protocol !== "https:"
    )
      return undefined;
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/);
    if (!match) return undefined;
    return `https://www.linkedin.com/in/${match[1]}/`;
  } catch {
    return undefined;
  }
}

export type SearchResultEvidence = {
  name: string;
  title: string;
  company?: string;
  linkedinUrl?: string;
  degreeText?: string;
  /** Only pass text from a visible education field or an explicitly labeled alumni summary. */
  education?: string;
};

function hasSchool(education: string, school: string): boolean {
  const evidence = ` ${normalized(education)} `;
  const requested = normalized(school);
  if (!requested) return false;
  const alternatives = ["nyu", "new york university"].includes(requested)
    ? ["nyu", "new york university"]
    : [requested];
  return alternatives.some((value) => evidence.includes(` ${value} `));
}

export function contactFromSearchResult(
  evidence: SearchResultEvidence,
  target: Target,
  profile: Profile,
): Contact | undefined {
  const name = compact(
    evidence.name.replace(/\s*[•·]\s*(?:1st|2nd|3rd).*$/i, ""),
  );
  const linkedinUrl =
    evidence.linkedinUrl && canonicalLinkedInProfile(evidence.linkedinUrl);
  if (
    !name ||
    name.length > 150 ||
    /^(?:linkedin member|view profile|connect|message)$/i.test(name) ||
    !linkedinUrl
  )
    return undefined;
  const title = compact(evidence.title);
  const company = compact(
    evidence.company ||
      title
        .split(/\s+(?:at|@)\s+/i)
        .slice(1)
        .join(" at "),
  );
  const degreeMatch = evidence.degreeText?.match(
    /\b([123])(?:st|nd|rd)(?:\+)?\b/i,
  );
  const connectionDegree = degreeMatch
    ? (Number(degreeMatch[1]) as 1 | 2 | 3)
    : undefined;
  const warmPaths: WarmPath[] = [];
  if (evidence.education && hasSchool(evidence.education, profile.school)) {
    warmPaths.push({
      type: "alumni",
      detail: `${profile.school} listed in visible education / alumni information`,
    });
  }
  const emailGuesses = target.domain ? guessEmails(name, target.domain) : [];
  return rankContact(
    {
      id: crypto.randomUUID(),
      targetId: target.id,
      name,
      title,
      company,
      linkedinUrl,
      connectionDegree,
      warmPaths,
      relevance: 0,
      reason: "",
      stage: "found",
      followUpCount: 0,
      ...(emailGuesses.length
        ? {
            email: emailGuesses[0].email,
            emailConfidence: emailGuesses[0].confidence,
            emailVerified: false,
            emailGuesses,
          }
        : {}),
    },
    profile,
    target,
  );
}
