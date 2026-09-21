import type { Connection } from '@/types/connection';
import type { PredictFn } from './connection-classifier';

/**
 * "Ask about your network" — answers natural-language questions over the user's
 * connections. Retrieval is simple: we serialize a compact view of the
 * connections into the prompt context (the model has a large context window),
 * so answers are grounded in the actual list rather than the model's guesses.
 *
 * Provider-agnostic: takes a PredictFn. Today that's Gemini (the wired
 * provider); the same function can be pointed at Claude later without touching
 * callers.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * How many connections we serialize into one prompt. Most people have well over
 * 1,000 connections, so we ground answers in up to 10,000 — comfortably within
 * the 1M-token context windows of the models we route chat to. Lines for
 * connections without AI summaries are short (name + role + headline), so even
 * a full network stays well under the window.
 */
export const CHAT_CONTEXT_LIMIT = 10000;

/**
 * The default instructions the chat sends to the model. Surfaced verbatim in
 * Settings → AI so the user can read, edit, and reset them. The connection list
 * itself is always appended after these instructions (not shown here).
 */
export const DEFAULT_CHAT_INSTRUCTIONS =
  'You answer questions about the user\'s LinkedIn connections using ONLY the ' +
  'provided list. Each line is: "name (role) — headline [interests: …] — about: ' +
  '<what they do> — history: <recap of past messages with them>". Use the ' +
  '"about" and "history" notes to understand who each person is and the user\'s ' +
  'relationship with them.\n\n' +
  'Answer completely: when a question covers many people, include every relevant ' +
  'one — never stop early, cut the list short, or end with "and more". Give the ' +
  'full answer in one response.\n\n' +
  'Format for readability: use short Markdown bullets for lists (one person per ' +
  'bullet, their name in **bold**, then a few words of why), and brief prose ' +
  'otherwise. Be specific, and don\'t pad, repeat the question, or add filler ' +
  'preambles. If the list lacks the info to answer, say so plainly. Never invent ' +
  'connections or facts.';

/** Compact one-line-per-person serialization for the prompt context. */
export function buildConnectionContext(
  connections: Connection[],
  limit: number = CHAT_CONTEXT_LIMIT,
): { text: string; included: number; total: number } {
  const total = connections.length;
  const slice = connections.slice(0, limit);
  const lines = slice.map((c) => {
    const role = c.roleCategory && c.roleCategory !== 'Other' ? ` (${c.roleCategory})` : '';
    const headline = c.headline ? ` — ${c.headline}` : '';
    const interests = c.interestTags?.length ? ` [interests: ${c.interestTags.join(', ')}]` : '';
    // Ground answers in the AI summaries we already generate: the one-line
    // "about" summary and any conversation recap. This is what makes the chat
    // actually understand who people are and how the user knows them.
    const about = c.aiSummary ? ` — about: ${c.aiSummary}` : '';
    const history = c.conversationSummary ? ` — history: ${c.conversationSummary}` : '';
    return `- ${c.fullName}${role}${headline}${interests}${about}${history}`;
  });
  return { text: lines.join('\n'), included: slice.length, total };
}

/**
 * Ask one question, optionally with prior turns for follow-up context.
 * Returns the answer text, or null if the model returned nothing.
 */
export interface ChatAnswerOptions {
  /**
   * Output-token cap. Default 0 = uncapped (use the model's max), so we never
   * truncate an answer on screen — conciseness is steered via the prompt, not a
   * hard cutoff. A positive value caps explicitly.
   */
  maxTokens?: number;
  /**
   * The base instructions (system prompt) — the user's edited version, or the
   * default. The connection list is always appended after these.
   */
  instructions?: string;
  /** The user's additional instructions, layered on top of the base. */
  append?: string;
  /** Soft target length (words); appended as a hint when > 0. */
  targetWords?: number;
  /** Called with each text chunk as the answer streams in (for live display). */
  onToken?: (chunk: string) => void;
}

export async function answerConnectionQuestion(
  connections: Connection[],
  question: string,
  predict: PredictFn,
  history: ChatMessage[] = [],
  limit: number = CHAT_CONTEXT_LIMIT,
  opts: ChatAnswerOptions = {},
): Promise<string | null> {
  const { text, included, total } = buildConnectionContext(connections, limit);
  const note = total > included ? `\n\n(Showing ${included} of ${total} connections.)` : '';
  const base = opts.instructions?.trim() || DEFAULT_CHAT_INSTRUCTIONS;
  const append = opts.append?.trim()
    ? `\n\nAdditional instructions from the user (follow these):\n${opts.append.trim()}`
    : '';
  const wordsNote = opts.targetWords && opts.targetWords > 0
    ? `\n\nAim for approximately ${opts.targetWords} words.`
    : '';
  const system = `${base}${append}${wordsNote}\n\nConnections:\n${text}${note}`;

  const convo = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  const prompt = `${convo ? convo + '\n' : ''}User: ${question}\nAssistant:`;

  const answer = await predict(prompt, {
    fullResponse: true,
    maxTokens: opts.maxTokens ?? 0, // 0 = uncapped (model max)
    temperature: 0.3,
    systemPrompt: system,
    tier: 'quality', // reasoning over the network — route to the stronger model
    onToken: opts.onToken,
  });
  return (answer || '').trim() || null;
}
