import { readLocal } from './storage';

const STORAGE_KEY = 'geminiApiKey';
const SUGGESTIONS_KEY = 'aiSuggestionsEnabled';
const INTERESTS_KEY = 'connectionInterests';
const CATEGORIZE_MODE_KEY = 'categorizeMode';
const PROVIDER_KEY = 'aiProvider';
const ANTHROPIC_KEY = 'anthropicApiKey';
const ANTHROPIC_FAST_MODEL_KEY = 'anthropicFastModel';
const ANTHROPIC_QUALITY_MODEL_KEY = 'anthropicQualityModel';
const GEMINI_FAST_MODEL_KEY = 'geminiFastModel';
const GEMINI_QUALITY_MODEL_KEY = 'geminiQualityModel';
const CHAT_MAX_WORDS_KEY = 'aiChatMaxWords';
const CHAT_INSTRUCTIONS_KEY = 'aiChatInstructions';
const CHAT_PROMPTS_KEY = 'aiChatPrompts';

/** Default interest tags the connection classifier matches against. */
export const DEFAULT_CONNECTION_INTERESTS = ['Investors'];

/**
 * Which AI provider powers inference. Both support a two-tier model ladder
 * (see {@link AIModelTier}).
 *  - 'gemini'    — Google Gemini
 *  - 'anthropic' — Claude
 */
export type AIProvider = 'gemini' | 'anthropic';

/**
 * A "tier" lets us route cheap/bulk work to a small model and reserve a stronger
 * one for writing. Callers pass `tier` on predict; each provider maps it to its
 * own configured model.
 *  - 'fast'    — categorization, summaries, autocomplete (default)
 *  - 'quality' — drafting messages, the insights chat
 */
export type AIModelTier = 'fast' | 'quality';

/** One selectable model in a provider's picker. */
export interface ModelOption {
  id: string;
  label: string;
  /** Short cost/quality hint shown in the model picker. */
  blurb: string;
}
/** @deprecated Use {@link ModelOption}. Kept for existing imports. */
export type AnthropicModelOption = ModelOption;

/** Claude models offered in Settings, cheapest → most capable. */
export const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', blurb: 'Fastest & cheapest — best for bulk tagging' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', blurb: 'Balanced quality and cost' },
  { id: 'claude-opus-5', label: 'Opus 5', blurb: 'Most capable — best writing' },
];

const ANTHROPIC_MODEL_IDS = new Set(ANTHROPIC_MODELS.map((m) => m.id));

/** Cheap tier default: Haiku for bulk categorization/summaries. */
export const DEFAULT_ANTHROPIC_FAST_MODEL = 'claude-haiku-4-5';
/** Quality tier default: Sonnet for drafting and the insights chat. */
export const DEFAULT_ANTHROPIC_QUALITY_MODEL = 'claude-sonnet-5';

/** Gemini models offered in Settings, cheapest → most capable. */
export const GEMINI_MODELS: ModelOption[] = [
  { id: 'gemini-3.1-flash-lite', label: 'Flash-Lite', blurb: 'Fastest & cheapest — best for bulk tagging' },
  { id: 'gemini-3.5-flash', label: 'Flash', blurb: 'Balanced quality and cost' },
  { id: 'gemini-3.1-pro-preview', label: 'Pro', blurb: 'Most capable — best writing' },
];

const GEMINI_MODEL_IDS = new Set(GEMINI_MODELS.map((m) => m.id));

/**
 * Both tiers default to Flash-Lite — the single model the app originally used
 * for everything, so out of the box behavior is unchanged. Users can bump the
 * quality tier up to Flash or Pro in Settings if they want stronger writing.
 */
export const DEFAULT_GEMINI_FAST_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_GEMINI_QUALITY_MODEL = 'gemini-3.1-flash-lite';

export async function getAIProvider(): Promise<AIProvider> {
  return (await readLocal<AIProvider>(PROVIDER_KEY)) === 'anthropic' ? 'anthropic' : 'gemini';
}

export async function setAIProvider(provider: AIProvider): Promise<void> {
  await chrome.storage.local.set({ [PROVIDER_KEY]: provider });
}

export async function getAnthropicApiKey(): Promise<string | null> {
  return (await readLocal<string>(ANTHROPIC_KEY)) || null;
}

export async function setAnthropicApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [ANTHROPIC_KEY]: key });
}

export async function clearAnthropicApiKey(): Promise<void> {
  await chrome.storage.local.remove(ANTHROPIC_KEY);
}

/** Resolve the configured model for a tier, validating against the known set. */
export async function getAnthropicModel(tier: AIModelTier): Promise<string> {
  const stored = await readLocal<string>(
    tier === 'quality' ? ANTHROPIC_QUALITY_MODEL_KEY : ANTHROPIC_FAST_MODEL_KEY,
  );
  if (stored && ANTHROPIC_MODEL_IDS.has(stored)) return stored;
  return tier === 'quality' ? DEFAULT_ANTHROPIC_QUALITY_MODEL : DEFAULT_ANTHROPIC_FAST_MODEL;
}

export async function setAnthropicModel(tier: AIModelTier, modelId: string): Promise<void> {
  if (!ANTHROPIC_MODEL_IDS.has(modelId)) return;
  await chrome.storage.local.set({
    [tier === 'quality' ? ANTHROPIC_QUALITY_MODEL_KEY : ANTHROPIC_FAST_MODEL_KEY]: modelId,
  });
}

/** Resolve the configured Gemini model for a tier, validating the known set. */
export async function getGeminiModel(tier: AIModelTier): Promise<string> {
  const stored = await readLocal<string>(
    tier === 'quality' ? GEMINI_QUALITY_MODEL_KEY : GEMINI_FAST_MODEL_KEY,
  );
  if (stored && GEMINI_MODEL_IDS.has(stored)) return stored;
  return tier === 'quality' ? DEFAULT_GEMINI_QUALITY_MODEL : DEFAULT_GEMINI_FAST_MODEL;
}

export async function setGeminiModel(tier: AIModelTier, modelId: string): Promise<void> {
  if (!GEMINI_MODEL_IDS.has(modelId)) return;
  await chrome.storage.local.set({
    [tier === 'quality' ? GEMINI_QUALITY_MODEL_KEY : GEMINI_FAST_MODEL_KEY]: modelId,
  });
}

/**
 * Friendly name of the model the chat actually uses (the active provider's
 * quality tier), e.g. "Sonnet 5" or "Flash-Lite" — for the "working…" status.
 */
export async function getActiveChatModelLabel(): Promise<string> {
  const provider = await getAIProvider();
  if (provider === 'anthropic') {
    const id = await getAnthropicModel('quality');
    return ANTHROPIC_MODELS.find((m) => m.id === id)?.label ?? id;
  }
  const id = await getGeminiModel('quality');
  return GEMINI_MODELS.find((m) => m.id === id)?.label ?? id;
}

/**
 * How connections get categorized:
 *  - 'auto'   — classify new connections automatically after each sync (default)
 *  - 'manual' — only when the user asks ("Categorize now" / per-connection refresh)
 */
export type CategorizeMode = 'auto' | 'manual';

export async function getCategorizeMode(): Promise<CategorizeMode> {
  return (await readLocal<CategorizeMode>(CATEGORIZE_MODE_KEY)) === 'manual' ? 'manual' : 'auto';
}

export async function setCategorizeMode(mode: CategorizeMode): Promise<void> {
  await chrome.storage.local.set({ [CATEGORIZE_MODE_KEY]: mode });
}

export async function getGeminiApiKey(): Promise<string | null> {
  return (await readLocal<string>(STORAGE_KEY)) || null;
}

export async function setGeminiApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: key });
}

export async function clearGeminiApiKey(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

// --- AI Chat advanced options (apply to whichever provider is active) --------

/**
 * A *soft* target length for a chat answer, in words. This is guidance folded
 * into the prompt (the model tries to comply) — it never truncates the response
 * on screen. 0 = no target: the model answers at whatever length it needs.
 */
export const DEFAULT_CHAT_MAX_WORDS = 0;
export const CHAT_MAX_WORDS_MIN = 0;
export const CHAT_MAX_WORDS_MAX = 8000;
/** Cap on the instructions text, to keep the prompt bounded. */
export const CHAT_INSTRUCTIONS_MAX_CHARS = 4000;

function clampWords(words: number): number {
  return Math.min(Math.max(Math.round(words), CHAT_MAX_WORDS_MIN), CHAT_MAX_WORDS_MAX);
}

/** Target word count the chat should aim for (0 = no target). */
export async function getAIChatMaxWords(): Promise<number> {
  const stored = await readLocal<number>(CHAT_MAX_WORDS_KEY);
  return typeof stored === 'number' && Number.isFinite(stored) ? clampWords(stored) : DEFAULT_CHAT_MAX_WORDS;
}

export async function setAIChatMaxWords(words: number): Promise<void> {
  await chrome.storage.local.set({ [CHAT_MAX_WORDS_KEY]: clampWords(words) });
}

/** Extra user instructions appended to the chat system prompt (tone, format, …). */
export async function getAIChatInstructions(): Promise<string> {
  return (await readLocal<string>(CHAT_INSTRUCTIONS_KEY)) || '';
}

export async function setAIChatInstructions(text: string): Promise<void> {
  await chrome.storage.local.set({ [CHAT_INSTRUCTIONS_KEY]: text.slice(0, CHAT_INSTRUCTIONS_MAX_CHARS) });
}

// --- Starter questions shown in an empty chat (user-editable) ----------------

/** The built-in starter questions, used until the user customizes them. */
export const DEFAULT_CHAT_PROMPTS = [
  'Which of my connections are investors?',
  'Who works at a fintech company?',
  'Summarize the kinds of people in my network.',
  'Who might be a good intro to a founder?',
];
export const CHAT_PROMPT_MAX_CHARS = 200;
export const CHAT_PROMPTS_MAX = 12;

/** Trim, drop blanks, and bound length/count. An explicit empty list is allowed. */
export function normalizeChatPrompts(list: unknown): string[] {
  if (!Array.isArray(list)) return [...DEFAULT_CHAT_PROMPTS];
  return list
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim().slice(0, CHAT_PROMPT_MAX_CHARS))
    .filter(Boolean)
    .slice(0, CHAT_PROMPTS_MAX);
}

/** The user's starter questions (falls back to the defaults until customized). */
export async function getChatPrompts(): Promise<string[]> {
  const stored = await readLocal<string[]>(CHAT_PROMPTS_KEY);
  if (stored === undefined) return [...DEFAULT_CHAT_PROMPTS];
  return normalizeChatPrompts(stored);
}

export async function setChatPrompts(list: string[]): Promise<void> {
  await chrome.storage.local.set({ [CHAT_PROMPTS_KEY]: normalizeChatPrompts(list) });
}

export async function getAISuggestionsEnabled(): Promise<boolean> {
  // Default to true if not set (and on read error, readLocal yields undefined).
  return (await readLocal<boolean>(SUGGESTIONS_KEY)) !== false;
}

export async function setAISuggestionsEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [SUGGESTIONS_KEY]: enabled });
}

/**
 * The interest tags the AI matches each connection against (e.g. "Investors").
 * Falls back to {@link DEFAULT_CONNECTION_INTERESTS} when unset.
 */
export async function getConnectionInterests(): Promise<string[]> {
  const stored = await readLocal<string[]>(INTERESTS_KEY);
  if (!Array.isArray(stored)) return [...DEFAULT_CONNECTION_INTERESTS];
  // Drop blanks/dupes so a stray empty tag can't reach the prompt.
  return stored.map((t) => t.trim()).filter((t, i, a) => t && a.indexOf(t) === i);
}

export async function setConnectionInterests(interests: string[]): Promise<void> {
  const clean = interests.map((t) => t.trim()).filter((t, i, a) => t && a.indexOf(t) === i);
  await chrome.storage.local.set({ [INTERESTS_KEY]: clean });
}
