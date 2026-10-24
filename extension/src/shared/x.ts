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
  progress?: { stage?: string; message?: string };
};

export type XDiscoveryResult = {
  contacts: Contact[];
  status: "succeeded" | "partial" | "cancelled";
  warning?: string;
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
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${backendToken}`, ...init?.headers },
    });
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
      throw new Error("The X research request timed out. The backend may still be processing the existing job; no automatic retry was started.");
    throw error;
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401)
    throw new Error("The backend rejected the extension's token. Set BACKEND_TOKEN in .env, rebuild, and restart the server.");
  if (!res.ok) throw new Error(body?.error?.message || `Backend error ${res.status}`);
  return body;
}

function publishProgress(targetId: string, job: DiscoveryJob): void {
  const progress = {
    stage: (job.progress?.stage || (job.status === "queued" ? "planning" : job.status)).slice(0, 80),
    message: (job.progress?.message || (job.status === "queued" ? "X research is queued." : "Checking X research progress.")).slice(0, 500),
    completed: job.recommendations?.length ?? 0,
  };
  // Only stage metadata and a count cross contexts; never profile facts or post text.
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      const response = chrome.runtime.sendMessage({ type: "CCC_X_RESEARCH_PROGRESS", targetId, progress });
      if (response && typeof response.catch === "function") void response.catch(() => undefined);
    } catch { /* A closed panel must not interrupt the research job. */ }
  }
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent("ccc-x-research-progress", { detail: { targetId, progress } }));
  }
}

function completedResult(job: DiscoveryJob, target: Target): XDiscoveryResult {
  const contacts = recommendationsToContacts(job, target);
  if (job.status === "failed") {
    if (!contacts.length) throw new Error(job.error?.message || "X research failed before any completed results were available.");
    return { contacts, status: "partial", warning: job.error?.message || "X research failed before all searches finished. Only completed results were kept." };
  }
  if (job.status === "cancelled") return {
    contacts, status: "cancelled",
    warning: job.error?.message || "X research was cancelled. Only completed results were kept.",
  };
  if (job.status === "partial") return {
    contacts, status: "partial",
    warning: job.error?.message || "X research did not finish completely. Only completed results were kept.",
  };
  return { contacts, status: "succeeded" };
}

export async function discoverOnX(
  target: Target,
  profile: Profile,
  backendUrl: string,
  wait = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): Promise<XDiscoveryResult> {
  const { jobId, status = "queued" } = await backendFetch(backendUrl, "/v1/discovery-jobs", {
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
  if (typeof jobId !== "string" || !jobId) throw new Error("The backend did not return an X research job ID. No automatic retry was started.");
  publishProgress(target.id, { status });
  // One paid job only. Status requests have a separate 10s timeout; stop polling after
  // roughly 200s and keep any completed recommendations without starting another job.
  const deadline = Date.now() + 200_000;
  let job: DiscoveryJob | undefined;
  for (let attempt = 0; attempt < 100 && Date.now() < deadline; attempt++) {
    await wait(2000);
    try {
      const update = (await backendFetch(backendUrl, `/v1/discovery-jobs/${encodeURIComponent(jobId)}`)) as DiscoveryJob;
      if (!["queued", "running", "succeeded", "failed", "partial", "cancelled"].includes(update.status))
        throw new Error("The backend returned an invalid X research status.");
      job = update;
    } catch (error) {
      const contacts = job ? recommendationsToContacts(job, target) : [];
      if (contacts.length) return {
        contacts, status: "partial",
        warning: `The final X research status could not be retrieved. ${error instanceof Error ? error.message : "The backend was unavailable."} Only completed results were kept; no automatic retry was started.`,
      };
      throw error;
    }
    publishProgress(target.id, job);
    if (["succeeded", "failed", "partial", "cancelled"].includes(job.status)) return completedResult(job, target);
  }
  const contacts = job ? recommendationsToContacts(job, target) : [];
  if (contacts.length) return {
    contacts, status: "partial",
    warning: "X research has not finished. Showing completed results from the existing job; no new research job was started.",
  };
  throw new Error("X research did not finish within the wait window. The existing job may still be running; no new research job was started.");
}
