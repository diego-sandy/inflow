// @vitest-environment jsdom
/**
 * Regression: an AI draft failed with "The AI returned nothing — try rephrasing
 * your instruction", and nothing anywhere said why. Every provider path caught
 * its error and returned null, and AI calls run in the page, whose log the
 * debug panel never showed.
 *
 * Now each path reports the real reason (HTTP error with the provider's own
 * message, safety block, missing key, unreachable connector), the reason is
 * logged and shown on the draft, and the most likely cause, Gemini spending a
 * small output cap on thinking before writing anything, is retried uncapped.
 */
import '../dom-setup';

vi.mock('@/lib/anthropic-client', async (importOriginal) => ({ ...((await importOriginal()) as any) }));

const settings = vi.hoisted(() => ({ geminiKey: 'gm-key' as string | null, provider: 'gemini' }));
vi.mock('@/lib/ai-settings', () => ({
  DEFAULT_ANTHROPIC_FAST_MODEL: 'claude-haiku-5-5',
  DEFAULT_ANTHROPIC_QUALITY_MODEL: 'claude-sonnet-5-5',
  getGeminiApiKey: async () => settings.geminiKey,
  getAIProvider: async () => settings.provider,
  getTierProvider: async () => settings.provider,
  getAnthropicApiKey: async () => null,
  getAnthropicModel: async () => 'claude-sonnet-5',
  getGeminiModel: async () => 'gemini-3.6-flash',
  DEFAULT_GEMINI_FAST_MODEL: 'gemini-3.1-flash-lite',
  DEFAULT_GEMINI_QUALITY_MODEL: 'gemini-3.6-flash',
}));

import { renderHook, waitFor, act } from '@testing-library/react';
import { useAISession } from '@/hooks/useAISession';
import { clearDebugLogs, getDebugLogs, mergeLogs } from '@/lib/debug-log';
import { describeEmptyGemini, describeHttpFailure } from '@/lib/ai-failure';

/** An SSE response whose events carry these Gemini stream chunks. */
function sse(...chunks: object[]): Response {
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(ch)}\n`));
      c.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}
const text = (t: string) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });
const finished = (finishReason: string) => ({ candidates: [{ finishReason, content: { parts: [] } }] });
const httpError = (status: number, message: string) =>
  ({ ok: false, status, body: null, json: async () => ({ error: { message } }) }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  settings.geminiKey = 'gm-key';
  settings.provider = 'gemini';
  clearDebugLogs();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function session() {
  const { result } = renderHook(() => useAISession());
  await waitFor(() => expect(result.current.available).toBe(true));
  return result.current;
}

/** Run a full-answer prediction and collect what it reported. */
async function draft(predict: Awaited<ReturnType<typeof session>>['predict']) {
  let reason: string | null = null;
  const out = await predict('write a reply', {
    tier: 'quality',
    fullResponse: true,
    maxTokens: 512,
    onFailure: (r) => {
      reason = r;
    },
  });
  return { out, reason: reason as string | null };
}

it("reports Gemini's own error message instead of nothing", async () => {
  fetchMock.mockResolvedValue(httpError(429, 'Resource has been exhausted'));
  const { out, reason } = await draft((await session()).predict);
  expect(out).toBeNull();
  expect(reason).toBe('Gemini is rate-limiting requests; wait a minute and try again: Resource has been exhausted');
});

it('logs the reason, where the debug panel can show it', async () => {
  fetchMock.mockResolvedValue(httpError(403, 'API key not valid'));
  await draft((await session()).predict);
  expect(getDebugLogs().some((e) => e.message.includes('[AI] Gemini rejected the key saved in inflow (API key not valid)'))).toBe(true);
});

it('retries without the cap when thinking used it up before any text', async () => {
  fetchMock
    .mockResolvedValueOnce(sse(finished('MAX_TOKENS')))
    .mockResolvedValueOnce(sse(text('Tuesday 8am works for me.')));
  const { out, reason } = await draft((await session()).predict);

  expect(out).toBe('Tuesday 8am works for me.');
  expect(reason).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const capped = JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig;
  const retried = JSON.parse(fetchMock.mock.calls[1][1].body).generationConfig;
  expect(capped.maxOutputTokens).toBe(512);
  expect(retried.maxOutputTokens).toBeUndefined();
});

it('retries only once, then says it ran out of room', async () => {
  fetchMock.mockImplementation(async () => sse(finished('MAX_TOKENS')));
  const { out, reason } = await draft((await session()).predict);
  expect(out).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(reason).toBe('Gemini ran out of room before writing anything');
});

it('names a safety block', async () => {
  fetchMock.mockResolvedValue(sse(finished('SAFETY')));
  const { reason } = await draft((await session()).predict);
  expect(reason).toBe("Gemini's safety filter stopped the answer");
});

it('names a blocked prompt', async () => {
  fetchMock.mockResolvedValue(sse({ promptFeedback: { blockReason: 'OTHER' } }));
  const { reason } = await draft((await session()).predict);
  expect(reason).toBe('Gemini blocked the request (other)');
});

it('names a network failure', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  const { reason } = await draft((await session()).predict);
  expect(reason).toBe("Couldn't reach Gemini: Failed to fetch");
});

it('keeps autocomplete quiet: a miss on a keystroke is not logged', async () => {
  fetchMock.mockResolvedValue(sse(finished('STOP')));
  const predict = (await session()).predict;
  await predict('partial message'); // the autocomplete call shape
  expect(getDebugLogs().filter((e) => e.message.startsWith('[AI]'))).toHaveLength(0);
});

it('says so when the provider has no key anywhere', async () => {
  // The AI config is loaded once per module, so start a fresh one with no key.
  settings.geminiKey = null;
  vi.resetModules();
  const { useAISession: freshSession } = await import('@/hooks/useAISession');
  const { result } = renderHook(() => freshSession());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  const { out, reason } = await draft(result.current.predict);
  expect(out).toBeNull();
  expect(reason).toMatch(/no Gemini key in the browser and the MCP connector isn't connected/);
  expect(fetchMock).not.toHaveBeenCalled();
});

describe('wording', () => {
  it('turns HTTP statuses into plain reasons', () => {
    expect(describeHttpFailure('Claude', 401)).toBe('Claude refused the key');
    expect(describeHttpFailure('Gemini', 404)).toBe("Gemini doesn't recognise the model");
    expect(describeHttpFailure('Gemini', 503)).toMatch(/having trouble \(error 503\)/);
  });

  it('explains an empty Gemini answer by its finish reason', () => {
    expect(describeEmptyGemini('RECITATION')).toMatch(/resembled existing text/);
    expect(describeEmptyGemini(undefined)).toBe('Gemini returned no text');
  });
});

it('the debug panel merges the page log with the background log, in time order', () => {
  const merged = mergeLogs(
    [{ ts: 3, level: 'info', message: 'bg late' }, { ts: 1, level: 'info', message: 'bg early' }],
    [{ ts: 2, level: 'warn', message: '[AI] page' }],
  );
  expect(merged.map((e) => e.message)).toEqual(['bg early', '[AI] page', 'bg late']);
});
