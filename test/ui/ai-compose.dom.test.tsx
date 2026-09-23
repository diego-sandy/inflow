// @vitest-environment jsdom
// AI Compose: a toggle flips the composer into "describe it" mode; the model
// writes a pending draft bubble the user approves (→ loads into the composer to
// edit and send) or discards. Nothing here ever sends automatically.
import '../dom-setup';

import Dexie from 'dexie';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';
import { useUIStore } from '@/store/ui-store';
import type { AiComposeApi } from '@/hooks/useAiCompose';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return { ...original, get db() { return testDb; } };
});
vi.mock('@/hooks/useOptimisticAction', () => ({
  useOptimisticAction: () => ({ sendMessage: vi.fn(), sendAndArchive: vi.fn(), archiveConversation: vi.fn() }),
}));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('@/hooks/useAutocomplete', () => ({
  useAutocomplete: () => ({ suggestion: null, accept: vi.fn(), dismiss: vi.fn(), isOpen: false, isLoading: false }),
}));
vi.mock('@/hooks/useReplySuggestions', () => ({
  useReplySuggestions: () => ({ suggestions: [], isLoading: false, clear: vi.fn() }),
}));

function mockAi(over: Partial<AiComposeApi> = {}): AiComposeApi {
  return {
    available: true,
    enabled: false,
    instruction: '',
    draft: null,
    status: 'idle',
    error: null,
    setEnabled: vi.fn(),
    setInstruction: vi.fn(),
    generate: vi.fn(),
    approve: vi.fn(),
    discard: vi.fn(),
    ...over,
  };
}

beforeEach(async () => {
  testDb = new Dexie(`AiCompose_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  act(() => useUIStore.setState({ toast: null }));
});
afterEach(async () => {
  if (testDb) { testDb.close(); await Dexie.delete(testDb.name); }
});

async function renderCompose(ai: AiComposeApi) {
  const { ComposeBox } = await import('@/components/thread/ComposeBox');
  await testDb.conversations.put(makeConversation({ id: 'c1', participantUrns: ['u1'], participantNames: ['Ada'] }));
  render(<ComposeBox conversationId="c1" messages={[]} participantNames={['Ada']} ai={ai} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

it('shows the AI toggle when a provider is available; toggling calls setEnabled', async () => {
  const ai = mockAi();
  await renderCompose(ai);
  const toggle = screen.getByRole('button', { name: /AI compose/i });
  fireEvent.click(toggle);
  expect(ai.setEnabled).toHaveBeenCalledWith(true);
});

it('hides the AI toggle when no provider is available', async () => {
  await renderCompose(mockAi({ available: false }));
  expect(screen.queryByRole('button', { name: /AI compose/i })).not.toBeInTheDocument();
});

it('when enabled, shows the instruction field and Generate runs generation', async () => {
  const ai = mockAi({ enabled: true, instruction: 'Thank them and offer times' });
  await renderCompose(ai);
  const input = screen.getByLabelText(/Describe the message/i);
  expect(input).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Generate$/i }));
  expect(ai.generate).toHaveBeenCalled();
});

it('approving a draft loads the text into the composer (never auto-sends)', async () => {
  await renderCompose(mockAi());
  act(() => {
    document.dispatchEvent(
      new CustomEvent('inflow:ai-compose-approve', { detail: { conversationId: 'c1', text: 'Hi Ada — great to connect!' } }),
    );
  });
  const textarea = await screen.findByDisplayValue('Hi Ada — great to connect!');
  expect(textarea).toHaveAttribute('data-compose-input');
});

it('ignores an approve event addressed to a different conversation', async () => {
  await renderCompose(mockAi());
  act(() => {
    document.dispatchEvent(
      new CustomEvent('inflow:ai-compose-approve', { detail: { conversationId: 'OTHER', text: 'nope' } }),
    );
  });
  await waitFor(() => Promise.resolve());
  expect(screen.queryByDisplayValue('nope')).not.toBeInTheDocument();
});
