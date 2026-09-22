import type { Connection } from '@/types/connection';
import type { PredictFn } from './connection-classifier';

/**
 * Phase 1 "smart retrieval": instead of always stuffing the whole network into
 * the prompt, a cheap planner call decides whether a question targets a subset
 * (a role/industry/company/name) or the whole network. For targeted questions we
 * locally filter to the relevant connections and answer over just those —
 * cheaper, sharper, and it keeps the relevant people from being truncated out of
 * a large network. Broad questions still see everything.
 */

/** Below this many connections, skip the planner — the whole network is cheap. */
export const RETRIEVAL_MIN_CONNECTIONS = 200;
/** Cap on how many matched connections we serialize for a targeted question. */
export const RETRIEVAL_SUBSET_CAP = 800;
/** If fewer than this match, treat the signal as too weak and fall back to all. */
export const RETRIEVAL_MIN_MATCHES = 4;

export type RetrievalMode = 'all' | 'broad' | 'targeted';

export interface RetrievalInfo {
  mode: RetrievalMode;
  keywords: string[];
  /** Connections actually sent to the model. */
  used: number;
  /** Total connections in the network. */
  total: number;
  /** How many matched the keywords (targeted mode). */
  matched: number;
}

const RETRIEVAL_SYSTEM =
  'You route a question about someone\'s LinkedIn network. Decide if it targets a ' +
  'SUBSET of people (a role, industry, company, interest, or name) or the WHOLE ' +
  'network (summaries, counts, overall shape). Reply with ONLY a JSON object: ' +
  '{"scope":"targeted"|"broad","keywords":["..."]}. For targeted, list lowercase ' +
  'search terms AND close synonyms/related words (e.g. investor → investor, vc, ' +
  'venture, angel, capital, partner, gp; fintech → fintech, payments, banking). ' +
  'For broad questions use "broad" with an empty keywords array. JSON only, no prose.';

/** Lowercased searchable text for a connection. */
function searchableText(c: Connection): string {
  return [
    c.fullName,
    c.headline,
    c.roleCategory,
    c.interestTags?.join(' '),
    c.aiSummary,
    c.conversationSummary,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function normalizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    const t = (k || '').trim().toLowerCase();
    if (t.length >= 2 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Rank connections by how many of the keywords they match. Pure + testable.
 * Returns the matched connections (score-sorted, capped) and the match count.
 */
export function retrieveRelevant(
  connections: Connection[],
  keywords: string[],
  cap: number = RETRIEVAL_SUBSET_CAP,
): { subset: Connection[]; matched: number } {
  const terms = normalizeKeywords(keywords);
  if (terms.length === 0) return { subset: [], matched: 0 };

  const scored: { c: Connection; score: number }[] = [];
  for (const c of connections) {
    const text = searchableText(c);
    let score = 0;
    for (const t of terms) if (text.includes(t)) score += 1;
    if (score > 0) scored.push({ c, score });
  }
  // Highest score first; stable for ties (keeps the incoming order = recency).
  scored.sort((a, b) => b.score - a.score);
  return { subset: scored.slice(0, cap).map((s) => s.c), matched: scored.length };
}

/** Ask the model whether the question is targeted, and for search keywords. */
export async function planRetrieval(
  question: string,
  predict: PredictFn,
): Promise<{ scope: 'targeted' | 'broad'; keywords: string[] }> {
  try {
    const raw = await predict(question, {
      fullResponse: true,
      maxTokens: 200,
      temperature: 0,
      systemPrompt: RETRIEVAL_SYSTEM,
      tier: 'fast',
    });
    if (!raw) return { scope: 'broad', keywords: [] };
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { scope: 'broad', keywords: [] };
    const parsed = JSON.parse(match[0]);
    const scope = parsed?.scope === 'targeted' ? 'targeted' : 'broad';
    const keywords = Array.isArray(parsed?.keywords)
      ? parsed.keywords.filter((k: unknown): k is string => typeof k === 'string')
      : [];
    return { scope, keywords };
  } catch {
    return { scope: 'broad', keywords: [] };
  }
}

/**
 * Decide what subset of the network to answer over. Small networks and broad
 * questions use everything; targeted questions use the matched subset (with a
 * fallback to all when the match signal is too weak).
 */
export async function smartRetrieve(
  connections: Connection[],
  question: string,
  predict: PredictFn,
): Promise<{ subset: Connection[]; info: RetrievalInfo }> {
  const total = connections.length;

  if (total <= RETRIEVAL_MIN_CONNECTIONS) {
    return { subset: connections, info: { mode: 'all', keywords: [], used: total, total, matched: total } };
  }

  const plan = await planRetrieval(question, predict);
  if (plan.scope !== 'targeted' || plan.keywords.length === 0) {
    return { subset: connections, info: { mode: 'broad', keywords: [], used: total, total, matched: total } };
  }

  const { subset, matched } = retrieveRelevant(connections, plan.keywords);
  if (matched < RETRIEVAL_MIN_MATCHES) {
    // Weak/ambiguous signal — don't risk missing people; answer over everything.
    return { subset: connections, info: { mode: 'broad', keywords: plan.keywords, used: total, total, matched } };
  }

  return {
    subset,
    info: { mode: 'targeted', keywords: plan.keywords, used: subset.length, total, matched },
  };
}
