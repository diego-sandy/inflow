import { ANTHROPIC_URL, anthropicErrorMessage } from './anthropic-client';

/**
 * Prove a pasted key works before saving it, with the cheapest possible call.
 * Shared by Settings and the setup wizard so both accept and reject keys the
 * same way. Each throws an Error whose message is fit to show the user.
 */

export async function verifyGeminiKey(key: string, model: string): Promise<void> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say "ok" and nothing else.' }] }],
        generationConfig: { maxOutputTokens: 5 },
      }),
    },
  );
  if (!res.ok) {
    if (res.status === 400) throw new Error('Invalid API key');
    if (res.status === 403) throw new Error('API key not authorized — check AI Studio');
    if (res.status === 429) throw new Error('Rate limit reached — try again in a minute');
    throw new Error(`Request failed (HTTP ${res.status})`);
  }
}

export async function verifyAnthropicKey(key: string, model: string): Promise<void> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
    }),
  });
  if (!res.ok) {
    // Surface Anthropic's actual reason (e.g. "credit balance is too low")
    // instead of a generic status message, so the fix is obvious.
    let detail = '';
    try {
      const body = await res.json();
      detail = typeof body?.error?.message === 'string' ? body.error.message : '';
    } catch {}
    throw new Error(detail || anthropicErrorMessage(res.status));
  }
}
