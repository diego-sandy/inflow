// @vitest-environment jsdom
// useAISession maps the requested tier to the configured Gemini model, the same
// way it does for Anthropic — the model id ends up in the request URL.
import '../dom-setup';

vi.mock('@/lib/anthropic-client', () => ({ predictAnthropic: vi.fn() }));

vi.mock('@/lib/ai-settings', () => ({
  getGeminiApiKey: async () => 'gm-test-key',
  getAIProvider: async () => 'gemini',
  getAnthropicApiKey: async () => null,
  getAnthropicModel: async () => 'claude-haiku-4-5',
  getGeminiModel: async (tier: string) =>
    tier === 'quality' ? 'gemini-3.1-pro-preview' : 'gemini-3.1-flash-lite',
  DEFAULT_GEMINI_FAST_MODEL: 'gemini-3.1-flash-lite',
  DEFAULT_GEMINI_QUALITY_MODEL: 'gemini-3.1-pro-preview',
}));

import { renderHook, waitFor } from '@testing-library/react';
import { useAISession } from '@/hooks/useAISession';

/** A Response whose body streams a single SSE chunk with the given text. */
function sseResponse(text: string): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n`,
        ),
      );
      controller.close();
    },
  });
  return { ok: true, body } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => sseResponse('ok'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it('routes the fast tier (default) to the fast Gemini model', async () => {
  const { result } = renderHook(() => useAISession());
  await waitFor(() => expect(result.current.available).toBe(true));

  await result.current.predict('classify these');
  const url = String(fetchMock.mock.calls[0][0]);
  expect(url).toContain('/models/gemini-3.1-flash-lite:streamGenerateContent');
});

it('routes the quality tier to the quality Gemini model', async () => {
  const { result } = renderHook(() => useAISession());
  await waitFor(() => expect(result.current.available).toBe(true));

  await result.current.predict('write a message', { tier: 'quality' });
  const url = String(fetchMock.mock.calls[0][0]);
  expect(url).toContain('/models/gemini-3.1-pro-preview:streamGenerateContent');
});
