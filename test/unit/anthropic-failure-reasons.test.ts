/**
 * The direct browser call to Claude reports why it produced no text, rather
 * than returning null silently: Anthropic's own error message, an empty answer
 * by its stop reason, and a blocked browser call (an org that disallows
 * browser access), with what to do about it.
 */
import { predictAnthropic } from '@/lib/anthropic-client';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function run() {
  const onFailure = vi.fn();
  const out = await predictAnthropic('hi', 'sk-ant-test', 'claude-sonnet-5', { maxTokens: 512, onFailure });
  return { out, onFailure };
}

it("passes on Anthropic's own message for a failed request", async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) });
  const { out, onFailure } = await run();
  expect(out).toBeNull();
  expect(onFailure).toHaveBeenCalledWith('Claude refused the key: invalid x-api-key');
});

it('explains an empty answer by its stop reason', async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [], stop_reason: 'max_tokens' }) });
  const { onFailure } = await run();
  expect(onFailure).toHaveBeenCalledWith('Claude ran out of room before writing anything');
});

it('points a blocked browser call at the MCP connector', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  const { onFailure } = await run();
  expect(onFailure.mock.calls[0][0]).toMatch(/Couldn't reach Claude from the browser \(Failed to fetch\)/);
  expect(onFailure.mock.calls[0][0]).toMatch(/put the key in the MCP connector/);
});

it('reports nothing when it works', async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Sounds good' }] }) });
  const { out, onFailure } = await run();
  expect(out).toBe('Sounds good');
  expect(onFailure).not.toHaveBeenCalled();
});
