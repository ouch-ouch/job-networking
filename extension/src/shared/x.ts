// Find people on X through the backend's Grok X Search research (backend/src/server.ts,
// POST /v1/discovery-jobs, then poll). Maps each recommendation into a Contact whose
// evidence (their real post) feeds {{personal_hook}} when the template is filled.
// Ported from Sushant's side-panel wiring; contract: backend/src/schemas.ts.
import type { Contact, Profile, Target } from "./types";

declare const __BACKEND_TOKEN__: string | undefined;
const backendToken = typeof __BACKEND_TOKEN__ === "string" ? __BACKEND_TOKEN__ : "";

type Recommendation = {
  personId: string;
  handle: string;
  displayName?: string;
  category: string;
  affiliation: { claim: string } | null;
  relevance: string;
  openingSourceId?: string;
  score: { total: number };
  uncertainties: string[];
};
type Source = { id: string; url: string; kind: string; handle?: string; excerpt?: string };
type DiscoveryJob = {
  status: "queued" | "running" | "succeeded" | "failed" | "partial" | "cancelled";
  recommendations?: Recommendation[];
  sources?: Source[];
  mode?: "live" | "fixture";
  error?: { message: string };
};

const categoryLabels: Record<string, string> = {
  practitioner: "Works on this kind of role",
  hiring_team: "Likely on the hiring team",
  recruiter: "Recruiter",
  professional_connection: "Relevant professional",
};

export function recommendationsToContacts(job: DiscoveryJob, target: Target): Contact[] {
  const sources = job.sources ?? [];
  return (job.recommendations ?? []).map((rec) => {
    const post = sources.find((s) => s.id === rec.openingSourceId);
    const handle = rec.handle.replace(/^@/, "");
    return {
      id: `contact_x_${handle}_${target.id}`,
      targetId: target.id,
      name: rec.displayName || `@${handle}`,
      title: rec.affiliation?.claim || categoryLabels[rec.category] || rec.category,
      company: target.company,
      xHandle: handle,
      xUrl: `https://x.com/${handle}`,
      ...(post?.excerpt && { xPost: { url: post.url, excerpt: post.excerpt } }),
      warmPaths: [],
      relevance: Math.max(0, Math.min(100, Math.round(rec.score.total))),
      reason: rec.relevance,
      stage: "found",
      followUpCount: 0,
      ...(rec.uncertainties.length && { notes: `Unverified: ${rec.uncertainties.join("; ")}` }),
    };
  });
}

async function backendFetch(base: string, path: string, init?: RequestInit) {
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${backendToken}`, ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401)
    throw new Error("The backend rejected the extension's token. Set BACKEND_TOKEN in .env, rebuild, and restart the server.");
  if (!res.ok) throw new Error(body?.error?.message || `Backend error ${res.status}`);
  return body;
}

export async function discoverOnX(
  target: Target,
  profile: Profile,
  backendUrl: string,
  wait = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): Promise<Contact[]> {
  const { jobId } = await backendFetch(backendUrl, "/v1/discovery-jobs", {
    method: "POST",
    body: JSON.stringify({
      jobContext: {
        id: target.id,
        version: "v1",
        employer: target.company,
        title: target.role,
        location: target.location,
        description: target.rawDescription.slice(0, 20_000),
        canonicalUrl: target.url || `https://example.com/jobs/${target.id}`,
      },
      profile: {
        version: "v1",
        facts: [
          { id: "f_school", text: `${profile.year} at ${profile.school} studying ${profile.major}`.slice(0, 500), kind: "education" },
          { id: "f_background", text: profile.background.slice(0, 500) || "Student", kind: "experience" },
        ],
        targetRoles: [target.role],
      },
      maxResults: 3,
    }),
  });
  // Live X Search takes 25-150s across several searches; poll every 2s for up to ~200s.
  let job: DiscoveryJob | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    await wait(2000);
    job = (await backendFetch(backendUrl, `/v1/discovery-jobs/${jobId}`)) as DiscoveryJob;
    if (["succeeded", "failed", "partial", "cancelled"].includes(job.status)) break;
  }
  if (!job || job.status === "queued" || job.status === "running")
    throw new Error("X research did not finish in time. Try again.");
  if (job.status === "failed") throw new Error(job.error?.message || "X research failed.");
  return recommendationsToContacts(job, target);
}
