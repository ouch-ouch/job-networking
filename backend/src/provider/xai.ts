// xAI Responses API adapter with the server-side x_search tool.
// Docs checked 2026-10-24: https://docs.x.ai/developers/tools/x-search and /tools/citations
import type { Config } from '../config';
import { BackendFailure } from '../errors';
import { DISCOVERY_SYSTEM, DRAFT_SYSTEM, PERSON_SYSTEM, discoveryUser, draftUser, personUser } from './prompts';
import type { DiscoverRequest, DraftPrompt, ModelStatus, PersonRequest, ProviderResult, ResearchProvider } from './types';

type XSearchTool = {
  type: 'x_search';
  allowed_x_handles?: string[];
  excluded_x_handles?: string[];
  from_date?: string;
  to_date?: string;
};

/** Pulls the JSON object out of model text, dropping inline [[N]](url) citation markers. */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/\[\[\d+\]\]\([^)\s]*\)/g, '')
    .replace(/```(?:json)?/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new BackendFailure('malformed_output', 'The research model did not return structured output.');
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new BackendFailure('malformed_output', 'The research model returned malformed output.');
  }
}

function failureForStatus(status: number, retryAfter: string | null, bodyText: string): BackendFailure {
  const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
  if (status === 401 || status === 403) {
    return new BackendFailure('invalid_credentials', 'The xAI API key was rejected or lacks access. Check XAI_API_KEY and credits.');
  }
  if (status === 429) return new BackendFailure('rate_limited', 'xAI is rate limiting requests.', true, retryAfterMs);
  if (status === 404 || (status === 400 && /model/i.test(bodyText))) {
    return new BackendFailure('model_unsupported', 'The configured model is unavailable or does not support x_search.');
  }
  if (status >= 500) return new BackendFailure('provider_unavailable', `xAI returned ${status}.`, true, retryAfterMs);
  return new BackendFailure('provider_unavailable', `xAI rejected the request (${status}).`);
}

type ResponsesBody = {
  output?: { type?: string; content?: { type?: string; text?: string; annotations?: { type?: string; url?: string }[] }[] }[];
  output_text?: string;
  citations?: (string | { url?: string })[];
  usage?: { input_tokens?: number; output_tokens?: number; cost_in_usd_ticks?: number };
};

export function parseResponsesBody(body: ResponsesBody): { text: string; citations: string[]; usage: ProviderResult['usage'] } {
  const texts: string[] = [];
  const citations: string[] = [];
  for (const item of body.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type !== 'output_text' || typeof part.text !== 'string') continue;
      texts.push(part.text);
      for (const a of part.annotations ?? []) if (a.type === 'url_citation' && a.url) citations.push(a.url);
    }
  }
  if (texts.length === 0 && typeof body.output_text === 'string') texts.push(body.output_text);
  for (const c of body.citations ?? []) {
    if (typeof c === 'string') citations.push(c);
    else if (c?.url) citations.push(c.url);
  }
  const ticks = body.usage?.cost_in_usd_ticks;
  return {
    text: texts.join('\n'),
    citations,
    usage: {
      inputTokens: body.usage?.input_tokens,
      outputTokens: body.usage?.output_tokens,
      // Assumes 1 tick = 1e-10 USD; callProvider never charges less than the reservation regardless.
      ...(typeof ticks === 'number' && { costUsd: ticks / 1e10 }),
    },
  };
}

export class XaiResearchProvider implements ResearchProvider {
  readonly mode = 'live' as const;

  constructor(
    private readonly cfg: Pick<Config, 'XAI_API_KEY' | 'XAI_BASE_URL' | 'XAI_MODEL'>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async checkModel(): Promise<ModelStatus> {
    try {
      const res = await this.fetchImpl(`${this.cfg.XAI_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${this.cfg.XAI_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return 'error';
      const body = (await res.json()) as { data?: { id?: string }[] };
      return body.data?.some((m) => m.id === this.cfg.XAI_MODEL) ? 'listed' : 'not_listed';
    } catch {
      return 'error';
    }
  }

  discoverCandidates(req: DiscoverRequest, signal: AbortSignal): Promise<ProviderResult> {
    const tool: XSearchTool = { type: 'x_search', from_date: req.plan.fromDate };
    if (req.plan.excludedHandles.length) tool.excluded_x_handles = req.plan.excludedHandles;
    return this.respond(DISCOVERY_SYSTEM, discoveryUser(req), tool, signal);
  }

  researchPerson(req: PersonRequest, signal: AbortSignal): Promise<ProviderResult> {
    return this.respond(PERSON_SYSTEM, personUser(req), { type: 'x_search', allowed_x_handles: [req.handle], from_date: req.fromDate }, signal);
  }

  // Drafting has no tools, so it cannot pull in new, unvalidated sources.
  composeDraft(req: DraftPrompt, signal: AbortSignal): Promise<ProviderResult> {
    return this.respond(DRAFT_SYSTEM, draftUser(req), undefined, signal);
  }

  private async respond(system: string, user: string, tool: XSearchTool | undefined, signal: AbortSignal): Promise<ProviderResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.XAI_BASE_URL}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.XAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.cfg.XAI_MODEL,
          input: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          ...(tool && { tools: [tool] }),
          store: false,
        }),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw signal.reason;
      throw new BackendFailure('provider_unavailable', 'Could not reach xAI.', true);
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw failureForStatus(res.status, res.headers.get('retry-after'), bodyText);
    }

    const parsed = parseResponsesBody((await res.json()) as ResponsesBody);
    return { output: extractJson(parsed.text), citations: parsed.citations, usage: parsed.usage };
  }
}
