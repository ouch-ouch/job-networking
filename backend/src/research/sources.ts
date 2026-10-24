// Source records come only from the provider's citations. A URL that appears in
// model JSON but was never cited is dropped (docs/GROK-BACKEND-SPEC.md §6.4).
import { createHash } from 'node:crypto';
import type { SourceRecord } from '../schemas';

const X_HOSTS = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
const RESERVED_PATHS = new Set(['i', 'home', 'search', 'explore', 'messages', 'notifications', 'settings', 'intent', 'hashtag']);
const TRACKING_PARAMS = /^(utm_|s$|t$|ref_src$|ref_url$|fbclid$|gclid$)/;
const TWITTER_EPOCH_MS = 1288834974657n;

export type NormalizedUrl = Pick<SourceRecord, 'url' | 'kind' | 'handle' | 'postId'>;

export function normalizeUrl(raw: string): NormalizedUrl | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;

  const host = u.hostname.toLowerCase();
  if (X_HOSTS.has(host)) {
    const [handle, segment, id] = u.pathname.split('/').filter(Boolean);
    if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle) || RESERVED_PATHS.has(handle.toLowerCase())) return null;
    const h = handle.toLowerCase();
    if (segment === 'status' && id && /^\d{1,20}$/.test(id)) {
      return { url: `https://x.com/${h}/status/${id}`, kind: 'post', handle: h, postId: id };
    }
    if (!segment) return { url: `https://x.com/${h}`, kind: 'profile', handle: h };
    return null;
  }

  u.protocol = 'https:';
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  return { url: u.toString(), kind: 'web' };
}

export function sourceIdFor(normalizedUrl: string): string {
  return 'src_' + createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 16);
}

/** X post IDs are snowflakes: the top bits encode milliseconds since the Twitter epoch. */
export function postTimestamp(postId: string): Date | undefined {
  try {
    const ms = (BigInt(postId) >> 22n) + TWITTER_EPOCH_MS;
    const date = new Date(Number(ms));
    return Number.isFinite(date.getTime()) ? date : undefined;
  } catch {
    return undefined;
  }
}

export function postIdForTime(date: Date, sequence = 0): string {
  return (((BigInt(date.getTime()) - TWITTER_EPOCH_MS) << 22n) + BigInt(sequence)).toString();
}

/** The sources one provider response is allowed to reference, keyed by normalized URL. */
export class CitedSources {
  private readonly byUrl = new Map<string, SourceRecord>();

  constructor(citations: string[], retrievedAt = new Date()) {
    for (const raw of citations) {
      const n = normalizeUrl(raw);
      if (!n || this.byUrl.has(n.url)) continue;
      const published = n.postId ? postTimestamp(n.postId) : undefined;
      this.byUrl.set(n.url, {
        id: sourceIdFor(n.url),
        ...n,
        ...(published && { publishedAt: published.toISOString() }),
        verification: 'provider_cited',
        retrievedAt: retrievedAt.toISOString(),
      });
    }
  }

  /** Returns the cited record for a URL, or undefined when the model referenced something uncited. */
  resolve(raw: string | null | undefined): SourceRecord | undefined {
    if (!raw) return undefined;
    const n = normalizeUrl(raw);
    return n ? this.byUrl.get(n.url) : undefined;
  }

  resolveAll(urls: (string | null | undefined)[]): SourceRecord[] {
    const out = new Map<string, SourceRecord>();
    for (const url of urls) {
      const s = this.resolve(url);
      if (s) out.set(s.id, s);
    }
    return [...out.values()];
  }

  attachExcerpt(raw: string, excerpt: string): void {
    const s = this.resolve(raw);
    if (s && !s.excerpt) s.excerpt = excerpt.slice(0, 280);
  }

  get size(): number {
    return this.byUrl.size;
  }
}

/** Every source the backend has issued, so drafts can only reference known IDs. */
export class SourceRegistry {
  private readonly byId = new Map<string, SourceRecord>();

  add(records: Iterable<SourceRecord>): void {
    for (const r of records) {
      const existing = this.byId.get(r.id);
      this.byId.set(r.id, existing ? { ...existing, ...r, excerpt: r.excerpt ?? existing.excerpt } : r);
    }
  }

  get(id: string): SourceRecord | undefined {
    return this.byId.get(id);
  }

  forHandle(handle: string): SourceRecord[] {
    const h = handle.toLowerCase();
    return [...this.byId.values()].filter((s) => s.handle === h);
  }
}
