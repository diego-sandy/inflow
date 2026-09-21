/**
 * Minimal Anthropic Messages API client for the browser.
 *
 * The extension talks to Claude directly from the app page (no backend), so we
 * send the `anthropic-dangerous-direct-browser-access` header and rely on the
 * `https://api.anthropic.com/*` host permission (see wxt.config.ts) for CORS.
 *
 * `predictAnthropic` matches the same "return the text, or null on any failure"
 * contract as the Gemini path in useAISession, so it slots in behind the shared
 * `predict` seam without callers changing.
 */

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
/**
 * Output ceiling when the caller doesn't cap (maxTokens ≤ 0). High enough that
 * we never truncate an answer the user already paid for, and within every
 * current Claude model's supported max so it can't 400.
 */
const ANTHROPIC_UNCAPPED_MAX = 8192;

export interface AnthropicPredictOptions {
  signal?: AbortSignal;
  /** Cap on output tokens (floored so a response can't be truncated to nothing). */
  maxTokens?: number;
  /** System prompt (Anthropic top-level `system`). */
  systemPrompt?: string;
  /** When set, stream the response and call this with each text delta. */
  onToken?: (chunk: string) => void;
}

/**
 * Human-readable reason for a non-OK Anthropic response — used by the Settings
 * "verify key" flow. Kept here so the mapping lives next to the request shape.
 */
export function anthropicErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Bad request — the model or request was rejected';
    case 401:
      return 'Invalid API key';
    case 403:
      return 'API key not authorized for this model';
    case 404:
      return 'Model not found — check the selected Claude model';
    case 429:
      return 'Rate limit reached — try again in a minute';
    case 529:
      return 'Anthropic is overloaded — try again shortly';
    default:
      return `Request failed (HTTP ${status})`;
  }
}

/**
 * One-shot, non-streaming completion against the Messages API.
 *
 * Thinking: Haiku 4.5 has extended thinking OFF by default, so we omit the
 * field. The Claude 5 family turns adaptive thinking ON by default, which would
 * consume our (deliberately small) `max_tokens` before any answer text — so we
 * explicitly disable it for those models to keep responses fast and untruncated.
 *
 * Returns the concatenated text blocks, or null on any error (including a
 * non-OK status) so it drops into the same seam as the Gemini predictor.
 */
export async function predictAnthropic(
  prompt: string,
  key: string,
  model: string,
  options?: AnthropicPredictOptions,
): Promise<string | null> {
  // maxTokens ≤ 0 means "don't cap" → use the model's practical max so long
  // answers aren't truncated. A positive value is an explicit cap (floored so a
  // response can't be truncated to nothing).
  const requested = options?.maxTokens;
  const maxTokens = requested && requested > 0 ? Math.max(requested, 64) : ANTHROPIC_UNCAPPED_MAX;
  const thinking = /haiku/i.test(model) ? undefined : { type: 'disabled' as const };
  const stream = !!options?.onToken;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      signal: options?.signal,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(stream ? { stream: true } : {}),
        ...(thinking ? { thinking } : {}),
        ...(options?.systemPrompt ? { system: options.systemPrompt } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.warn('[inflow] Anthropic request failed:', res.status, anthropicErrorMessage(res.status));
      return null;
    }

    if (stream && res.body) {
      return await readAnthropicStream(res.body, options!.onToken!);
    }

    const data = await res.json();
    const text = Array.isArray(data?.content)
      ? data.content
          .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
          .map((b: any) => b.text)
          .join('')
      : '';
    return text.trim() || null;
  } catch (e: any) {
    if (e?.name === 'AbortError') return null;
    console.warn('[inflow] Anthropic request error:', e);
    return null;
  }
}

/**
 * Read the Messages API SSE stream, appending each `text_delta` and forwarding
 * it to `onToken`. Buffers across reads so a `data:` line split between network
 * chunks is never dropped (the same class of bug that truncated the Gemini path).
 */
async function readAnthropicStream(
  body: ReadableStream<Uint8Array>,
  onToken: (chunk: string) => void,
): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let buffer = '';

  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    try {
      const json = JSON.parse(payload);
      if (json?.type === 'content_block_delta' && json?.delta?.type === 'text_delta') {
        const t = json.delta.text;
        if (typeof t === 'string') {
          text += t;
          onToken(t);
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
      buffer = lines.pop() ?? '';
      for (const line of lines) consumeLine(line);
    }
    if (buffer) consumeLine(buffer);
  } finally {
    reader.releaseLock();
  }

  return text.trim() || null;
}
