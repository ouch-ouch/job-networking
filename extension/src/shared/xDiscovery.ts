// Real live X/Twitter discovery via Maryam's backend (separate process, port 8788),
// which calls xAI's x_search tool for real. Julia's own backend (port 8787, /ai/*)
// only does direct Grok completions — it never actually searches X.
import type { Contact, Profile, Target } from "./types";

const X_BACKEND_URL = import.meta.env.VITE_X_BACKEND_URL || "http://localhost:8788";
const X_BACKEND_TOKEN = import.meta.env.VITE_X_BACKEND_TOKEN || "";

type DiscoveryRecommendation = {
  handle: string;
  displayName: string;
  category: string;
  affiliation: { claim: string };
  relevance: string;
  score: { total: number };
  uncertainties: string[];
};
type DiscoverySource = { id: string; url: string; kind: string; handle?: string };
type DiscoveryJob = {
  status: "queued" | "running" | "succeeded" | "failed" | "partial" | "cancelled";
  recommendations?: DiscoveryRecommendation[];
  sources?: DiscoverySource[];
  mode?: "live" | "fixture";
  error?: { message: string };
};

async function xFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${X_BACKEND_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${X_BACKEND_TOKEN}`, ...init?.headers },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message || `X search backend error ${res.status}`);
  return body;
}

export async function discoverPeopleOnX(
  target: Target,
  profile: Profile,
  excludeXHandles: string[] = [],
): Promise<Omit<Contact, "id" | "targetId" | "stage" | "followUpCount">[]> {
  const { jobId } = await xFetch("/v1/discovery-jobs", {
    method: "POST",
    body: JSON.stringify({
      jobContext: {
        id: target.id, version: "v1", employer: target.company, title: target.role,
        location: target.location, description: (target.rawDescription || `${target.role} at ${target.company}`).slice(0, 20_000),
        canonicalUrl: target.url || `https://example.com/jobs/${target.id}`,
      },
      profile: {
        version: "v1",
        facts: [{ id: "f_background", text: (profile.background || `${profile.major} at ${profile.school}`).slice(0, 500), kind: "experience" }],
        targetRoles: [target.role],
      },
      excludePersonHandles: excludeXHandles,
      maxResults: 3,
    }),
  });

  let job: DiscoveryJob | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    job = await xFetch(`/v1/discovery-jobs/${jobId}`);
    if (["succeeded", "failed", "partial", "cancelled"].includes(job!.status)) break;
  }
  if (!job || job.status === "queued" || job.status === "running") {
    throw new Error("X search did not finish in time.");
  }
  if (job.status === "failed") throw new Error(job.error?.message || "X search failed");

  return (job.recommendations ?? []).map((rec) => {
    const profileSource = (job!.sources ?? []).find((s) => s.handle === rec.handle && s.kind === "profile");
    return {
      name: rec.displayName,
      title: `${rec.category} — ${rec.affiliation.claim}`,
      company: target.company,
      linkedinUrl: profileSource?.url ?? `https://x.com/${rec.handle}`,
      warmPaths: [],
      relevance: rec.score.total,
      reason: rec.relevance,
      notes: rec.uncertainties.length ? `Uncertain: ${rec.uncertainties.join("; ")}` : undefined,
    };
  });
}
