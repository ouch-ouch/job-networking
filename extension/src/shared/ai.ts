import type {
  Contact,
  Profile,
  PeopleSearchPlan,
  Question,
  Settings,
  Target,
  Template,
} from "./types";

type DemoInput = {
  template?: Template;
  profile?: Profile;
  target?: Target;
  targets?: Target[];
  contact?: Contact;
  rawDescription?: string;
  originalDraft?: { subject?: string; body: string };
  replyText?: string;
  availability?: string;
  approvedBank?: Question[];
  existingBank?: Question[];
  userNotes?: string;
  usedQuestionIds?: string[];
};
const fallbackQuestions = [
  {
    text: "What helped you learn the systems your team owns when you first joined?",
    category: "role",
  },
  {
    text: "How does your team choose which technical problems to work on next?",
    category: "team",
  },
  {
    text: "What experience best prepared you for the role you have now?",
    category: "career_path",
  },
  {
    text: "How do engineers on your team share feedback and learn from each other?",
    category: "culture",
  },
  {
    text: "What would you look for in a student applying to your team?",
    category: "recruiting",
  },
  {
    text: "Which project would you suggest I build to explore this work?",
    category: "advice",
  },
] as const;

// Explicit sandbox mode: deterministic illustrations only, with no API calls.
export function demoResponse(endpoint: string, payload: unknown): unknown {
  const data = payload as DemoInput;
  const name = data.contact?.name.split(/\s+/)[0] || "there";
  switch (endpoint.replace(/^\/?ai\//, "")) {
    case "parse-job": {
      const raw = data.rawDescription || "";
      const company =
        raw.match(/(?:company|employer)\s*:\s*([^\n,]+)/i)?.[1]?.trim() ||
        raw.match(/\b([A-Z][\w.&-]+)\s+is hiring\b/)?.[1] ||
        raw.match(/\bat ([A-Z][\w.&-]+)/)?.[1] ||
        "Not specified";
      const role =
        raw.match(/(?:role|job title|position)\s*:\s*([^\n]+)/i)?.[1]?.trim() ||
        raw.match(
          /\b(?:Senior |Junior |Staff )?(?:Software Engineer|Product Manager|Data Scientist|Data Analyst|Business Analyst|Designer|Researcher)(?:, New Grad)?\b/i,
        )?.[0] ||
        "Not specified";
      return {
        company,
        role,
        team:
          raw.match(
            /\b(?:on|join|for) (?:the )?([A-Z][\w -]{1,30}) team\b/,
          )?.[1] || "",
        location:
          raw.match(/(?:location)\s*:\s*([^\n]+)/i)?.[1]?.trim() ||
          (raw.includes("New York") ? "New York, NY" : ""),
        skills: [
          "TypeScript",
          "JavaScript",
          "Python",
          "SQL",
          "React",
          "APIs",
          "distributed systems",
          "Figma",
        ].filter((skill) => raw.toLowerCase().includes(skill.toLowerCase())),
      };
    }
    case "people-search-plan": {
      const profile = data.profile;
      const target = data.target;
      if (!profile || !target) throw new Error("A profile and target job are required for a search plan.");
      const quote = (value: string) => `"${value.replace(/["\r\n]/g, " ").replace(/\s+/g, " ").trim()}"`;
      const base = `site:linkedin.com/in/ ${quote(target.company)}`;
      const queries: PeopleSearchPlan["queries"] = [];
      if (profile.school.trim()) queries.push({
        label: `${profile.school} alumni`,
        query: `${base} ${quote(profile.school)}`,
        rationale: `Find possible ${profile.school} alumni at ${target.company}. Verify the education and current employer shown on each profile.`,
        connectionType: "alumni",
      });
      const backgroundSkills = target.skills.filter((skill) => {
        const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(profile.background);
      }).slice(0, 2);
      const sharedBackground = backgroundSkills.length ? backgroundSkills : profile.major.trim() ? [profile.major] : [];
      if (sharedBackground.length) queries.push({
        label: "Shared background",
        query: `${base} (${sharedBackground.map(quote).join(" OR ")})`,
        rationale: backgroundSkills.length
          ? `Explore people connected to ${backgroundSkills.join(" or ")}, which appear in both your background and this role's skills. These are search leads, not confirmed connections.`
          : `Look for people with a ${profile.major} background, then check whether their experience gives you a useful shared starting point.`,
        connectionType: "shared_background",
      });
      const teamTerms = [target.team, ...target.skills].filter((value): value is string => Boolean(value?.trim())).slice(0, 3);
      queries.push({
        label: target.team ? `${target.team} and adjacent teams` : "Role and adjacent teams",
        query: teamTerms.length ? `${quote(target.company)} (${[...new Set(teamTerms)].map(quote).join(" OR ")}) (engineer OR speaker OR author)` : `${quote(target.company)} ${quote(target.role)} (team OR speaker OR author)`,
        rationale: `Explore engineering blogs, conference talks, and other public pages about the ${target.team || target.role} area and the skills named in the job description. Look for authors and adjacent teammates, then verify where they work.`,
        connectionType: "team",
      });
      queries.push({
        label: "Recruiting contacts",
        query: `${base} (recruiter OR "university recruiting" OR "talent acquisition")`,
        rationale: `Find potential recruiting contacts at ${target.company} who may understand the application process. The search does not confirm that anyone is hiring for this role.`,
        connectionType: "recruiting",
      });
      queries.push({
        label: "Broader company paths",
        query: `${quote(target.company)} (people OR team OR interview)${target.location?.trim() ? ` ${quote(target.location)}` : ""}`,
        rationale: `Search company pages, interviews, and other public sources beyond LinkedIn for people at ${target.company}${target.location?.trim() ? ` around ${target.location}` : ""}. Check current affiliations before reaching out.`,
        connectionType: "company",
      });
      return {
        summary: `Demo search ideas for ${target.role} at ${target.company}, grounded in the supplied profile and job details. These are suggested queries, not verified people or search results.`,
        queries,
      } satisfies PeopleSearchPlan;
    }
    case "fill-template": {
      const p = data.profile!;
      const t = data.target!;
      const c = data.contact!;
      const template = data.template!;
      const keywords: Record<string, string> = {
        first_name: name,
        name: c.name,
        their_name: c.name,
        my_name: p.name,
        my_school: p.school,
        school: p.school,
        my_year: p.year,
        my_major: p.major,
        company: t.company,
        role: t.role,
        team: t.team || "",
        their_team: c.title.split(",").slice(1).join(",").trim() || c.title,
        their_title: c.title,
        location: t.location || "",
        skills: t.skills.join(", "),
        availability: p.availability,
        my_availability: p.availability,
        signature: p.signature,
        background: p.background,
        personal_hook: c.warmPaths[0]
          ? `Your ${c.warmPaths[0].detail} connection stood out to me.`
          : c.xPost
            ? `I saw your post on X ("${c.xPost.excerpt.split(/[.!?]/)[0].slice(0, 90)}") and it stuck with me.`
            : "",
      };
      const filledKeywords: Record<string, string> = {};
      const fill = (source: string) =>
        source.replace(
          /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
          (_match, key: string) => {
            if (!Object.hasOwn(keywords, key))
              throw new Error(
                `No value for {{${key}}}. Add context or edit the template.`,
              );
            filledKeywords[key] = keywords[key];
            return filledKeywords[key];
          },
        );
      let body = fill(template.body);
      if (template.channel === "linkedin_connect" && body.length > 300) {
        keywords.personal_hook = "";
        body = fill(template.body);
      }
      if (template.channel === "linkedin_connect" && body.length > 300)
        throw new Error(
          "This connection template exceeds 300 characters after filling. Shorten the template first.",
        );
      const subject =
        template.subject === undefined ? undefined : fill(template.subject);
      if (/\{\{|\}\}/.test(body + (subject || "")))
        throw new Error(
          "A template placeholder is unresolved or malformed. Use {{keyword}} names and try again.",
        );
      return {
        ...(subject === undefined ? {} : { subject }),
        body,
        filledKeywords,
      };
    }
    case "follow-up":
      return {
        subject: data.originalDraft?.subject || "Following up on a coffee chat",
        body: `Hi ${name},\n\nJust following up on my note. If you have 15 minutes, I would love to learn about your work at ${data.contact?.company || "your company"}. No worries if now is not a good time.\n\nThanks,\n${data.profile?.name || "Alex"}\n\nIf you prefer no follow-ups, just let me know.`,
      };
    case "classify-reply": {
      const reply = data.replyText || "";
      const intent =
        /\b(?:not interested|unsubscribe|no thanks|remove me|don.t contact|do not contact)\b|\bstop\s*(?:[.!]|$)|\bstop (?:contacting|emailing|messaging|following up)\b/i.test(
          reply,
        )
          ? "not_interested"
          : /out of (the )?office|vacation|automatic reply/i.test(reply)
            ? "ooo"
            : /\b(?:refer|referral|referred|colleague)\b|\breach out to\b|\bconnect you\b/i.test(
                  reply,
                )
              ? "referral"
              : /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|\d{1,2}(?::\d{2})?\s*[ap]m)\b/i.test(
                    reply,
                  )
                ? "proposes_time"
                : "interested";
      return { intent, proposedTimes: [] };
    }
    case "schedule-reply":
      return {
        body: `Hi ${name},\n\nThanks for getting back to me! My availability is ${data.availability || "flexible this week"}. Would a 15-minute chat during that window work for you? Please confirm a date, time, and time zone.\n\nThanks!`,
      };
    case "suggest-questions": {
      const existing = new Set(
        (data.existingBank || []).map((q) => q.text.toLowerCase().trim()),
      );
      const questions = fallbackQuestions
        .filter((q) => !existing.has(q.text.toLowerCase()))
        .map((q) => ({ ...q }));
      if (!questions.length)
        throw new Error(
          "These demo suggestions are already in your bank. Write a question or enable live AI for more.",
        );
      return { questions };
    }
    case "prep-brief": {
      const bank = (data.approvedBank || [])
        .filter(
          (q) =>
            q.status === "approved" && !data.usedQuestionIds?.includes(q.id),
        )
        .slice(0, 5);
      return {
        summary: `${data.contact?.name || "Your contact"} works as ${data.contact?.title || "a professional"} at ${data.contact?.company || "the company"}. Ask about their path and daily work.`,
        warmPathTalkingPoint:
          data.contact?.warmPaths.map((path) => path.detail).join("; ") ||
          "No shared connection recorded. Start with your interest in their work.",
        companyContext: data.target
          ? `You are exploring ${data.target.role} at ${data.target.company}. Focus areas: ${data.target.skills.join(", ") || "ask about team priorities"}.`
          : "Ask about the team and its current work.",
        picked: bank.map((q) => ({ questionId: q.id, tailoredText: q.text })),
        newQuestions: fallbackQuestions
          .slice(0, Math.max(0, 5 - bank.length))
          .map((q) => ({ ...q })),
      };
    }
    case "thank-you":
      return {
        subject: `Thank you for the chat, ${name}`,
        body: `Hi ${name},\n\nThank you for taking the time to chat with me.${
          data.userNotes?.trim()
            ? ` One takeaway I wrote down was: “${data.userNotes
                .trim()
                .slice(0, 350)
                .replace(/[.!?]+$/, "")}.”`
            : " I appreciate your perspective and advice."
        }\n\nThanks again,\n${data.profile?.name || "Alex"}\n\nIf you prefer no follow-ups, just let me know.`,
        referralAsk: data.target
          ? `If you feel my background could fit the ${data.target.role} role at ${data.target.company}, would you be comfortable sharing a referral or pointing me to the right person? No pressure either way.`
          : "",
      };
    default:
      throw new Error(`Unknown AI task: ${endpoint}`);
  }
}

export async function aiRequest<T>(
  endpoint: string,
  payload: unknown,
  settings: Settings,
): Promise<T> {
  const task = endpoint.replace(/^\/?ai\//, "");
  if (!/^[a-z-]+$/.test(task)) throw new Error("Invalid AI endpoint.");
  if (settings.demoMode) return demoResponse(task, payload) as T;
  let base: URL;
  try {
    base = new URL(settings.backendUrl);
  } catch {
    throw new Error("Set a valid backend URL in Settings.");
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw new Error("Backend URL must use HTTP or HTTPS without credentials.");
  try {
    const response = await fetch(`${base.href.replace(/\/$/, "")}/ai/${task}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(65_000),
    });
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        "The backend returned an invalid response. Check the backend URL.",
      );
    }
    if (!response.ok)
      throw new Error(
        (result as { error?: string }).error ||
          `AI request failed (${response.status}).`,
      );
    return result as T;
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name))
    )
      throw new Error(
        "The AI backend is offline or timed out. Start npm run server and check Settings, or enable demo mode.",
      );
    throw error;
  }
}
