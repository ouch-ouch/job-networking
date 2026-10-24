// Real call to Maryam's Grok backend (backend/src/server.ts), replacing the
// SCRAPE_SEARCH mock. Maps POST /v1/discovery-jobs (poll until done) into
// the UI's Contact shape. Backend contract: backend/src/schemas.ts.
import type { Contact, Profile, Target } from "../../shared/types";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8787";
const BACKEND_TOKEN = import.meta.env.VITE_BACKEND_TOKEN || "";

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

async function backendFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BACKEND_TOKEN}`, ...init?.headers },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message || `Backend error ${res.status}`);
  return body;
}

export async function discoverViaBackend(target: Target, profile: Profile): Promise<{ contacts: Contact[]; mode: string }> {
  const { jobId } = await backendFetch("/v1/discovery-jobs", {
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
        facts: [{ id: "f_background", text: profile.background.slice(0, 500), kind: "experience" }],
        targetRoles: [target.role],
      },
      maxResults: 3,
    }),
  });

  // Live X Search can take 1-3 minutes across several searches; poll generously
  // but fail loudly if the backend's own JOB_TIMEOUT_MS is somehow exceeded.
  let job: DiscoveryJob | undefined;
  const maxAttempts = 100; // 100 * 2s = ~200s, under the backend's 240s job timeout
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    job = await backendFetch(`/v1/discovery-jobs/${jobId}`);
    if (["succeeded", "failed", "partial", "cancelled"].includes(job!.status)) break;
  }
  if (!job || job.status === "queued" || job.status === "running") {
    throw new Error("Discovery job did not finish in time (polling gave up)");
  }
  if (job.status === "failed") throw new Error(job.error?.message || "Discovery job failed");

  const contacts: Contact[] = (job.recommendations ?? []).map((rec) => {
    const profileSource = (job.sources ?? []).find((s) => s.handle === rec.handle && s.kind === "profile");
    return {
      id: `c_${rec.handle}`,
      targetId: target.id,
      name: rec.displayName,
      title: `${rec.category} — ${rec.affiliation.claim}`,
      company: target.company,
      linkedinUrl: profileSource?.url ?? `https://x.com/${rec.handle}`,
      warmPaths: [],
      relevance: rec.score.total,
      reason: rec.relevance,
      stage: "found",
      followUpCount: 0,
      notes: rec.uncertainties.length ? `Uncertain: ${rec.uncertainties.join("; ")}` : undefined,
    };
  });
  return { contacts, mode: job.mode ?? "live" };
}
