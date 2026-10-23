import { useEffect, useState } from 'react';
import {
  getGeminiApiKey,
  getAnthropicApiKey,
  getAnthropicModel,
  getGeminiModel,
  getTierProvider,
  DEFAULT_GEMINI_FAST_MODEL,
  DEFAULT_GEMINI_QUALITY_MODEL,
  type AIProvider,
  type AIModelTier,
} from '@/lib/ai-settings';
import { predictAnthropic } from '@/lib/anthropic-client';
import { requestAnthropicViaCompanion, requestGeminiViaCompanion, isCompanionConnected, companionHasKey } from '@/lib/mcp/bridge-client';
import {
  describeEmptyAnthropic,
  describeEmptyGemini,
  describeHttpFailure,
  describeKeyRejection,
  isKeyRejection,
  reportAIFailure,
  type AIFailureReporter,
} from '@/lib/ai-failure';
import { useUIStore } from '@/store/ui-store';

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
  /**
   * Called with the reason when the call produces no text, so the caller can
   * show it. The reason is also logged to the debug panel either way.
   */
  onFailure?: AIFailureReporter;
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
  /** Per-tier provider selection (fast = bulk, quality = chat/drafting). */
  fastProvider: AIProvider;
  qualityProvider: AIProvider;
  geminiKey: string | null;
  anthropicKey: string | null;
  fastModel: string;
  qualityModel: string;
  geminiFastModel: string;
  geminiQualityModel: string;
}

// Cache config in memory so we don't hit chrome.storage on every keystroke.
const config: AIConfig = {
  fastProvider: 'gemini',
  qualityProvider: 'gemini',
  geminiKey: null,
  anthropicKey: null,
  fastModel: 'claude-haiku-4-5',
  qualityModel: 'claude-sonnet-5',
  geminiFastModel: DEFAULT_GEMINI_FAST_MODEL,
  geminiQualityModel: DEFAULT_GEMINI_QUALITY_MODEL,
};
let initialized = false;
const availabilitySubscribers = new Set<(available: boolean) => void>();

/** A provider is usable if it can actually run: either a browser key is set, or
 * the companion is connected AND holds that provider's key (so it can run the
 * request server-side). This is symmetric across Claude and Gemini. */
function providerUsable(p: AIProvider): boolean {
  return p === 'anthropic'
    ? !!config.anthropicKey || companionHasKey('anthropic')
    : !!config.geminiKey || companionHasKey('gemini');
}

/** True when at least one tier can run. */
function isAvailable(): boolean {
  return providerUsable(config.fastProvider) || providerUsable(config.qualityProvider);
}

function notifyAvailability(): void {
  const available = isAvailable();
  for (const cb of availabilitySubscribers) cb(available);
}

/** Reload all AI settings into the in-memory cache, then notify subscribers. */
async function reloadConfig(): Promise<void> {
  const [fastProvider, qualityProvider, geminiKey, anthropicKey, fastModel, qualityModel, geminiFastModel, geminiQualityModel] =
    await Promise.all([
      getTierProvider('fast'),
      getTierProvider('quality'),
      getGeminiApiKey(),
      getAnthropicApiKey(),
      getAnthropicModel('fast'),
      getAnthropicModel('quality'),
      getGeminiModel('fast'),
      getGeminiModel('quality'),
    ]);
  config.fastProvider = fastProvider;
  config.qualityProvider = qualityProvider;
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
    'aiFastProvider',
    'aiQualityProvider',
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
  const onFailure = isOpts ? options.onFailure : undefined;
  // Report only for calls that want a whole answer, or that asked to hear: autocomplete
  // runs on nearly every keystroke and would flood the log with the same miss.
  const fail: AIFailureReporter = (reason) => {
    if (fullResponse || onFailure) reportAIFailure(onFailure, reason);
  };

  const provider = tier === 'quality' ? config.qualityProvider : config.fastProvider;

  if (provider === 'anthropic') {
    const model = tier === 'quality' ? config.qualityModel : config.fastModel;
    // Prefer the companion when it holds the key (server-side — works on
    // BAA/CORS orgs, key off-browser).
    if (companionHasKey('anthropic')) {
      return predictAnthropicViaCompanion(prompt, model, { maxTokens, systemPrompt, onToken, onFailure: fail });
    }
    // Fall back to a direct browser call (only works if the org allows CORS).
    if (!config.anthropicKey) {
      fail(
        "This uses Claude, but there's no Claude key in the browser and the MCP connector isn't connected to provide one",
      );
      return null;
    }
    return predictAnthropic(prompt, config.anthropicKey, model, {
      signal,
      maxTokens,
      systemPrompt,
      onToken,
      onFailure: fail,
      onKeyResult: (rejected) => noteKeyResult('anthropic', 'browser', rejected),
    });
  }

  const model = tier === 'quality' ? config.geminiQualityModel : config.geminiFastModel;
  // Prefer the companion when it holds the Gemini key (key off-browser); else the
  // direct browser call. Only one path streams (the browser); the companion
  // returns the full answer once — see predictGeminiViaCompanion.
  if (companionHasKey('gemini')) {
    return predictGeminiViaCompanion(prompt, model, { maxTokens, systemPrompt, temperature, onToken, onFailure: fail });
  }
  if (!config.geminiKey) {
    fail(
      "This uses Gemini, but there's no Gemini key in the browser and the MCP connector isn't connected to provide one",
    );
    return null;
  }
  return predictGemini(prompt, { signal, fullResponse, maxTokens, systemPrompt, temperature, model, onToken, onFailure: fail });
}

type KeyProvider = 'anthropic' | 'gemini';
const PROVIDER_NAME = { anthropic: 'Claude', gemini: 'Gemini' } as const;

/**
 * Record whether a provider accepted its key, for Settings › AI to show.
 * `rejected` is what the provider said, or null after a call with the key went
 * through, which clears a rejection recorded for the same place (connector or
 * browser) and leaves one for the other place alone.
 */
function noteKeyResult(provider: KeyProvider, via: 'connector' | 'browser', rejected: string | null): void {
  const store = useUIStore.getState();
  if (rejected !== null) {
    store.setAIKeyIssue(provider, { via, detail: rejected, at: Date.now() });
  } else if (store.aiKeyIssues[provider]?.via === via) {
    store.setAIKeyIssue(provider, null);
  }
}

/** Why a request through the connector failed, recording a rejected key. */
function connectorFailure(provider: KeyProvider, e: unknown): string {
  const message = (e as any)?.message || 'unknown error';
  if (isKeyRejection(undefined, message)) {
    noteKeyResult(provider, 'connector', message);
    return describeKeyRejection(PROVIDER_NAME[provider], 'connector', message);
  }
  return `The MCP connector couldn't get an answer from ${PROVIDER_NAME[provider]}: ${message}`;
}

/**
 * Ask the connector to make the smallest possible request with its key, so
 * Settings can check a key without waiting for a draft to fail. Resolves null
 * when the key works, or the reason it doesn't.
 */
export async function checkConnectorKey(provider: KeyProvider): Promise<string | null> {
  ensureConfigSync();
  try {
    if (provider === 'anthropic') {
      await requestAnthropicViaCompanion({
        model: config.fastModel,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      });
    } else {
      await requestGeminiViaCompanion(config.geminiFastModel, {
        contents: [{ parts: [{ text: 'Say "ok" and nothing else.' }] }],
      });
    }
    noteKeyResult(provider, 'connector', null);
    return null;
  } catch (e) {
    return connectorFailure(provider, e);
  }
}

/** Text from a Gemini candidate's parts (thought parts, if any, are not text). */
function geminiText(candidate: any): string {
  const parts = candidate?.content?.parts;
  let text = '';
  if (Array.isArray(parts)) {
    for (const p of parts) if (typeof p?.text === 'string' && !p.thought) text += p.text;
  }
  return text;
}

/**
 * Run one Gemini generateContent request through the companion (non-streaming; it
 * returns the full response). Used when the Gemini key lives in the companion
 * instead of the browser. Returns the text, or null on any failure.
 */
async function predictGeminiViaCompanion(
  prompt: string,
  model: string,
  opts: {
    maxTokens: number;
    systemPrompt: string;
    temperature: number;
    onToken?: (chunk: string) => void;
    onFailure?: AIFailureReporter;
  },
): Promise<string | null> {
  let data: any;
  try {
    const body = {
      system_instruction: { parts: [{ text: opts.systemPrompt }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        ...(opts.maxTokens > 0 ? { maxOutputTokens: opts.maxTokens } : {}),
        temperature: opts.temperature,
      },
    };
    data = await requestGeminiViaCompanion(model, body);
  } catch (e: any) {
    opts.onFailure?.(connectorFailure('gemini', e));
    return null;
  }
  noteKeyResult('gemini', 'connector', null);
  const candidate = data?.candidates?.[0];
  const out = geminiText(candidate).trim() || null;
  if (!out) {
    // Thinking can spend a small cap before any text is written; one retry
    // without the cap gets the answer rather than nothing.
    if (candidate?.finishReason === 'MAX_TOKENS' && opts.maxTokens > 0) {
      return predictGeminiViaCompanion(prompt, model, { ...opts, maxTokens: 0 });
    }
    opts.onFailure?.(describeEmptyGemini(candidate?.finishReason, data?.promptFeedback?.blockReason));
    return null;
  }
  opts.onToken?.(out); // non-streaming: deliver once
  return out;
}

/**
 * Run one Anthropic completion through the companion (non-streaming; it returns
 * the full message). Used for bulk/fast Anthropic work so it works on orgs that
 * block browser CORS. Returns the text, or null on any failure.
 */
async function predictAnthropicViaCompanion(
  prompt: string,
  model: string,
  opts: { maxTokens: number; systemPrompt: string; onToken?: (chunk: string) => void; onFailure?: AIFailureReporter },
): Promise<string | null> {
  let data: any;
  try {
    const maxTokens = opts.maxTokens && opts.maxTokens > 0 ? Math.max(opts.maxTokens, 64) : 1024;
    const payload: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
      ...(/haiku/i.test(model) ? {} : { thinking: { type: 'disabled' } }),
    };
    data = await requestAnthropicViaCompanion(payload);
  } catch (e: any) {
    opts.onFailure?.(connectorFailure('anthropic', e));
    return null;
  }
  noteKeyResult('anthropic', 'connector', null);
  const text = Array.isArray(data?.content)
    ? data.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('')
    : '';
  const out = text.trim() || null;
  if (!out) {
    opts.onFailure?.(describeEmptyAnthropic(data?.stop_reason));
    return null;
  }
  opts.onToken?.(out); // non-streaming: deliver once
  return out;
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
    onFailure?: AIFailureReporter;
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

    if (!res.ok || !res.body) {
      let detail = '';
      try {
        const body = await res.json();
        detail = typeof body?.error?.message === 'string' ? body.error.message : '';
      } catch {}
      if (isKeyRejection(res.status, detail)) {
        noteKeyResult('gemini', 'browser', detail || `error ${res.status}`);
        opts.onFailure?.(describeKeyRejection('Gemini', 'browser', detail));
      } else {
        opts.onFailure?.(describeHttpFailure('Gemini', res.status, detail));
      }
      return null;
    }
    noteKeyResult('gemini', 'browser', null);

    // Read SSE stream. Buffer across reads: a single `data: {...}` line can be
    // split between two network chunks, so we only parse complete lines and keep
    // any trailing partial line for the next read. (Parsing per-chunk dropped
    // split lines, which truncated long answers mid-word.)
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let buffer = '';
    // The last finish/block reason seen, to explain an answer that never came.
    let finishReason: string | undefined;
    let blockReason: string | undefined;

    const consumeLine = (line: string) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const candidate = json?.candidates?.[0];
        if (candidate?.finishReason) finishReason = candidate.finishReason;
        if (json?.promptFeedback?.blockReason) blockReason = json.promptFeedback.blockReason;
        const chunk = geminiText(candidate);
        if (chunk) {
          text += chunk;
          opts.onToken?.(chunk);
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

    const out = text.trim() || null;
    if (!out) {
      // Newer Gemini models think before answering, and the thinking counts
      // against maxOutputTokens: a small cap can be spent before a word of the
      // answer. Retry a full answer once without the cap rather than fail.
      if (finishReason === 'MAX_TOKENS' && opts.maxTokens > 0 && opts.fullResponse) {
        return predictGemini(prompt, { ...opts, maxTokens: 0 });
      }
      opts.onFailure?.(describeEmptyGemini(finishReason, blockReason));
    }
    return out;
  } catch (e: any) {
    if (e?.name === 'AbortError') return null;
    console.warn('[inflow] AI autocomplete error:', e);
    opts.onFailure?.(`Couldn't reach Gemini: ${e?.message || 'network error'}`);
    return null;
  }
}
