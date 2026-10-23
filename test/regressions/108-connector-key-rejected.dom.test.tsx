// @vitest-environment jsdom
/**
 * Regression: drafts failed with "The MCP connector couldn't get an answer from
 * Claude: invalid x-api-key", which didn't say what to do, and Settings › AI
 * went on showing the connector's Claude key as "Active". The connector only
 * reports that it holds a key, not that the key works.
 *
 * Now a refused key gets a message that says where to fix it, Settings shows
 * the key as rejected, with Anthropic's words, until a call with it succeeds,
 * and the key can be checked from Settings without waiting for a draft to fail.
 */
import '../dom-setup';

const bridge = vi.hoisted(() => ({
  requestAnthropicViaCompanion: vi.fn(),
  requestGeminiViaCompanion: vi.fn(),
}));
vi.mock('@/lib/mcp/bridge-client', () => ({
  requestAnthropicViaCompanion: (...a: any[]) => bridge.requestAnthropicViaCompanion(...a),
  requestGeminiViaCompanion: (...a: any[]) => bridge.requestGeminiViaCompanion(...a),
  isCompanionConnected: () => true,
  companionHasKey: (p: string) => p === 'anthropic',
}));

import { render, screen, fireEvent, waitFor, act, renderHook } from '@testing-library/react';
import { useAISession, checkConnectorKey } from '@/hooks/useAISession';
import { AIKeySettings } from '@/components/settings/AIKeySettings';
import { useUIStore } from '@/store/ui-store';

beforeEach(async () => {
  bridge.requestAnthropicViaCompanion.mockReset();
  bridge.requestGeminiViaCompanion.mockReset();
  await chrome.storage.local.set({ aiFastProvider: 'anthropic', aiQualityProvider: 'anthropic' });
  act(() =>
    useUIStore.setState({ aiKeyIssues: {}, mcpStatus: 'connected', mcpKeys: { anthropic: true, gemini: false } } as any),
  );
});

async function draft() {
  const { result } = renderHook(() => useAISession());
  await waitFor(() => expect(result.current.available).toBe(true));
  let reason: string | null = null;
  const out = await result.current.predict('reply to Steve', {
    tier: 'quality',
    fullResponse: true,
    maxTokens: 512,
    onFailure: (r) => {
      reason = r;
    },
  });
  return { out, reason: reason as string | null };
}

it('says where to fix a key the connector holds, when Anthropic refuses it', async () => {
  bridge.requestAnthropicViaCompanion.mockRejectedValue(new Error('invalid x-api-key'));
  const { out, reason } = await draft();
  expect(out).toBeNull();
  expect(reason).toBe(
    'The Claude key in the MCP connector was rejected (invalid x-api-key). Update it in Claude › Settings › Extensions › inflow, or choose a different model for this in Settings › AI',
  );
  expect(useUIStore.getState().aiKeyIssues.anthropic).toMatchObject({ via: 'connector', detail: 'invalid x-api-key' });
});

it('leaves other connector failures worded as before, and records no key problem', async () => {
  bridge.requestAnthropicViaCompanion.mockRejectedValue(new Error('Companion request timed out'));
  const { reason } = await draft();
  expect(reason).toBe("The MCP connector couldn't get an answer from Claude: Companion request timed out");
  expect(useUIStore.getState().aiKeyIssues.anthropic).toBeUndefined();
});

it('clears the problem once a call with the key goes through', async () => {
  bridge.requestAnthropicViaCompanion.mockRejectedValueOnce(new Error('invalid x-api-key'));
  await draft();
  expect(useUIStore.getState().aiKeyIssues.anthropic).toBeDefined();

  bridge.requestAnthropicViaCompanion.mockResolvedValue({ content: [{ type: 'text', text: 'Tuesday works' }] });
  const { out } = await draft();
  expect(out).toBe('Tuesday works');
  expect(useUIStore.getState().aiKeyIssues.anthropic).toBeUndefined();
});

it('checks the connector key with the smallest possible request', async () => {
  bridge.requestAnthropicViaCompanion.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
  expect(await checkConnectorKey('anthropic')).toBeNull();
  expect(bridge.requestAnthropicViaCompanion.mock.calls[0][0]).toMatchObject({ max_tokens: 8 });
});

describe('Settings › AI', () => {
  it('shows the connector key as rejected, with what Anthropic said and where to fix it', async () => {
    act(() =>
      useUIStore.getState().setAIKeyIssue('anthropic', { via: 'connector', detail: 'invalid x-api-key', at: Date.now() }),
    );
    render(<AIKeySettings />);
    await screen.findByText('Claude rejected this key · in the MCP connector');
    expect(screen.getByText('invalid x-api-key')).toBeInTheDocument();
    expect(screen.getByText(/Update the key in Claude › Settings › Extensions › inflow/)).toBeInTheDocument();
    expect(screen.queryByText('Active · in the MCP connector')).not.toBeInTheDocument();
  });

  it('Check again clears the warning once the key works', async () => {
    act(() =>
      useUIStore.getState().setAIKeyIssue('anthropic', { via: 'connector', detail: 'invalid x-api-key', at: Date.now() }),
    );
    bridge.requestAnthropicViaCompanion.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    render(<AIKeySettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await screen.findByText('Active · in the MCP connector');
    expect(screen.getByText('The key works.')).toBeInTheDocument();
  });

  it('Check key on a healthy key turns it red if Anthropic refuses it', async () => {
    bridge.requestAnthropicViaCompanion.mockRejectedValue(new Error('invalid x-api-key'));
    render(<AIKeySettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check key' }));
    await screen.findByText('Claude rejected this key · in the MCP connector');
  });
});
