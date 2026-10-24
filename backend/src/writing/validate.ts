// Draft checks that run before a draft is returned as ready (docs/GROK-BACKEND-SPEC.md §8).
import twitterText from 'twitter-text';
import type { DraftKind } from '../schemas';

export const DUPLICATE_THRESHOLD = 0.5;
const OPENING_WORDS = 12;

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

function trigrams(ws: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 < ws.length; i++) out.add(`${ws[i]} ${ws[i + 1]} ${ws[i + 2]}`);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Highest similarity to any earlier draft, over the whole text and over the opening words. */
export function maxSimilarity(text: string, others: string[]): { score: number; opening: boolean } {
  const ws = words(text);
  const whole = trigrams(ws);
  const open = trigrams(ws.slice(0, OPENING_WORDS));
  let best = { score: 0, opening: false };
  for (const other of others) {
    const ow = words(other);
    const w = jaccard(whole, trigrams(ow));
    const o = jaccard(open, trigrams(ow.slice(0, OPENING_WORDS)));
    if (w > best.score) best = { score: w, opening: false };
    if (o > best.score) best = { score: o, opening: true };
  }
  return best;
}

export function lengthCheck(text: string, kind: DraftKind, replyLimit: number) {
  const surface = kind === 'reply' ? ('x_reply' as const) : ('x_dm' as const);
  const weightedLength = twitterText.parseTweet(text).weightedLength;
  // DM and long-post limits depend on the account; report unknown instead of guessing.
  const limit = surface === 'x_reply' ? replyLimit : null;
  return { surface, weightedLength, limit, ok: limit === null || weightedLength <= limit };
}

export function unknownIds(ids: string[], allowed: Set<string>): string[] {
  return ids.filter((id) => !allowed.has(id));
}
