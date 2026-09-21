import { useEffect, useState } from 'react';
import {
  getGeminiApiKey,
  getAIProvider,
  getAnthropicApiKey,
  getAnthropicModel,
  getGeminiModel,
  DEFAULT_GEMINI_FAST_MODEL,
  DEFAULT_GEMINI_QUALITY_MODEL,
  type AIProvider,
  type AIModelTier,
} from '@/lib/ai-settings';
import { predictAnthropic } from '@/lib/anthropic-client';

const SYSTEM_PROMPT =
  'You are an autocomplete assistant. Given conversation history and a partial message, predict the next few words. Output ONLY the completion text. Keep it short (2-8 words). If unsure, output nothing.';

/** Build the Gemini streaming endpoint for a specific model id. */
function geminiStreamUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;
}

interface PredictOptions {
  signal?: AbortSignal;
  /** Read the full streamed response instead of bailing after the first chunk. */
  fullResponse?: boolean;
  /** Override maxOutputTokens (default: 20). */
  maxTokens?: number;
  /** Override the system prompt. */
  systemPrompt?: string;
  /** Override temperature (default: 0.3). Ignored by the Anthropic provider. */
  temperature?: number;
  /** Model tier — 'fast' (default) or 'quality'. Only Anthropic honors it. */
  tier?: AIModelTier;
  /** Called with each text chunk as it streams in (for live display). */
  onToken?: (chunk: string) => void;
}

interface AISession {
  available: boolean;
  predict: (prompt: string, options?: AbortSignal | PredictOptions) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Module-level singleton: resolve the provider + keys once and register a
// single chrome.storage listener for the whole app, rather than one per hook.
// Hooks subscribe for `available` updates; `predict` reads the cached config.
// ---------------------------------------------------------------------------

interface AIConfig {
  provider: AIProvider;
  geminiKey: string | null;
  anthropicKey: string | null;
  fastModel: string;
  qualityModel: string;
  geminiFastModel: string;
  geminiQualityModel: string;
}

// Cache config in memory so we don't hit chrome.storage on every keystroke.
const config: AIConfig = {
  provider: 'gemini',
  geminiKey: null,
  anthropicKey: null,
  fastModel: 'claude-haiku-4-5',
  qualityModel: 'claude-sonnet-5',
  geminiFastModel: DEFAULT_GEMINI_FAST_MODEL,
  geminiQualityModel: DEFAULT_GEMINI_QUALITY_MODEL,
};
let initialized = false;
const availabilitySubscribers = new Set<(available: boolean) => void>();

/** True when the *active* provider has a usable API key. */
function isAvailable(): boolean {
  return config.provider === 'anthropic' ? !!config.anthropicKey : !!config.geminiKey;
}

function notifyAvailability(): void {
  const available = isAvailable();
  for (const cb of availabilitySubscribers) cb(available);
}

/** Reload all AI settings into the in-memory cache, then notify subscribers. */
async function reloadConfig(): Promise<void> {
  const [provider, geminiKey, anthropicKey, fastModel, qualityModel, geminiFastModel, geminiQualityModel] =
    await Promise.all([
      getAIProvider(),
      getGeminiApiKey(),
      getAnthropicApiKey(),
      getAnthropicModel('fast'),
      getAnthropicModel('quality'),
      getGeminiModel('fast'),
      getGeminiModel('quality'),
    ]);
  config.provider = provider;
  config.geminiKey = geminiKey;
  config.anthropicKey = anthropicKey;
  config.fastModel = fastModel;
  config.qualityModel = qualityModel;
  config.geminiFastModel = geminiFastModel;
  config.geminiQualityModel = geminiQualityModel;
  notifyAvailability();
}

/** Lazily resolve config and attach the single storage listener (idempotent). */
function ensureConfigSync(): void {
  if (initialized) return;
  initialized = true;

  reloadConfig();

  // Any AI-related storage change re-reads config; one listener serves every hook.
  const WATCHED = [
    'aiProvider',
    'geminiApiKey',
    'anthropicApiKey',
    'anthropicFastModel',
    'anthropicQualityModel',
    'geminiFastModel',
    'geminiQualityModel',
  ];
  chrome?.storage?.local?.onChanged?.addListener?.(
    (changes: Record<string, chrome.storage.StorageChange>) => {
      if (WATCHED.some((k) => k in changes)) reloadConfig();
    },
  );
}

export function useAISession(): AISession {
  const [available, setAvailable] = useState(isAvailable());

  useEffect(() => {
    ensureConfigSync();
    const cb = (a: boolean) => setAvailable(a);
    availabilitySubscribers.add(cb);
    // Sync immediately in case config already resolved before this mount.
    cb(isAvailable());
    return () => {
      availabilitySubscribers.delete(cb);
    };
  }, []);

  return { available, predict };
}

/**
 * Run a prediction against the active provider. Module-scoped (reads only the
 * cached config), so its identity is stable across renders. Supports both the
 * legacy AbortSignal argument and the newer options object.
 */
async function predict(prompt: string, options?: AbortSignal | PredictOptions): Promise<string | null> {
  const isOpts = options && !(options instanceof AbortSignal);
  const signal = isOpts ? options.signal : (options as AbortSignal | undefined);
  const fullResponse = isOpts ? options.fullResponse ?? false : false;
  const maxTokens = isOpts ? options.maxTokens ?? 20 : 20;
  const systemPrompt = isOpts ? options.systemPrompt ?? SYSTEM_PROMPT : SYSTEM_PROMPT;
  const temperature = isOpts ? options.temperature ?? 0.3 : 0.3;
  const tier: AIModelTier = isOpts ? options.tier ?? 'fast' : 'fast';
  const onToken = isOpts ? options.onToken : undefined;

  if (config.provider === 'anthropic') {
    if (!config.anthropicKey) return null;
    const model = tier === 'quality' ? config.qualityModel : config.fastModel;
    return predictAnthropic(prompt, config.anthropicKey, model, { signal, maxTokens, systemPrompt, onToken });
  }

  const model = tier === 'quality' ? config.geminiQualityModel : config.geminiFastModel;
  return predictGemini(prompt, { signal, fullResponse, maxTokens, systemPrompt, temperature, model, onToken });
}

/** Gemini streaming prediction (the original provider). */
async function predictGemini(
  prompt: string,
  opts: {
    signal?: AbortSignal;
    fullResponse: boolean;
    maxTokens: number;
    systemPrompt: string;
    temperature: number;
    model: string;
    onToken?: (chunk: string) => void;
  },
): Promise<string | null> {
  try {
    const key = config.geminiKey;
    if (!key) return null;

    const res = await fetch(`${geminiStreamUrl(opts.model)}?alt=sse&key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: opts.systemPrompt }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          // maxTokens ≤ 0 → omit the cap so the model returns its full answer
          // (up to the model's own maximum) instead of being cut off.
          ...(opts.maxTokens > 0 ? { maxOutputTokens: opts.maxTokens } : {}),
          temperature: opts.temperature,
        },
      }),
    });

    if (!res.ok || !res.body) return null;

    // Read SSE stream. Buffer across reads: a single `data: {...}` line can be
    // split between two network chunks, so we only parse complete lines and keep
    // any trailing partial line for the next read. (Parsing per-chunk dropped
    // split lines, which truncated long answers mid-word.)
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let buffer = '';

    const consumeLine = (line: string) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const parts = json?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (typeof p?.text === 'string') {
              text += p.text;
              opts.onToken?.(p.text);
            }
          }
        }
      } catch {
        // skip malformed SSE lines
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // keep the (possibly partial) last line
        for (const line of lines) consumeLine(line);

        // For autocomplete we only need a few words — bail after first meaningful text
        if (!opts.fullResponse && text.trim().length > 0) {
          reader.cancel().catch(() => {});
          break;
        }
      }
      // Flush any complete line left in the buffer at stream end.
      if (buffer) consumeLine(buffer);
    } finally {
      reader.releaseLock();
    }

    return text.trim() || null;
  } catch (e: any) {
    if (e?.name === 'AbortError') return null;
    console.warn('[inflow] AI autocomplete error:', e);
    return null;
  }
}
