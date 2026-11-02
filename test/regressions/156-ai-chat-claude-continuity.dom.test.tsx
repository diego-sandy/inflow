// @vitest-environment jsdom
// Regression: with Claude through the companion, AI Chat sent only the new
// question, so a follow-up ("which of them…") reached Claude with no idea what
// "them" was. The Gemini path always carried the transcript; now both do.
import '../dom-setup';
import { renderHook, act } from '@testing-library/react';
import Dexie from 'dexie';
import { switchDatabase } from '@/db/database';
import { useConnectionChat } from '@/hooks/useConnectionChat';
import { useInsightChatStore } from '@/store/insight-chat-store';

const requests: any[] = [];
const answers = ['Dana Whitfield and Sam Reyes are investors.', 'Sam Reyes, at Harbor Lane.'];

vi.mock('@/hooks/useAISession', () => ({
  useAISession: () => ({ available: true, predict: vi.fn() }),
}));
vi.mock('@/hooks/useConnections', () => ({
  useConnections: () => ({ connections: [], isLoading: false }),
}));
vi.mock('@/lib/ai-settings', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getTierProvider: async () => 'anthropic',
  getAnthropicModel: async () => 'claude-test',
}));
vi.mock('@/lib/mcp/bridge-client', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  companionHasKey: () => true,
  requestAnthropicViaCompanion: async (req: any) => {
    requests.push(JSON.parse(JSON.stringify(req)));
    return { content: [{ type: 'text', text: answers[requests.length - 1] ?? 'ok' }], stop_reason: 'end_turn' };
  },
}));

beforeEach(() => {
  requests.length = 0;
  useInsightChatStore.getState().reset();
});
afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_CONTINUITY').catch(() => {});
});

it('sends the earlier turns with a follow-up question', async () => {
  await switchDatabase('MEMBER_CONTINUITY');
  const { result } = renderHook(() => useConnectionChat());

  await act(async () => { await result.current.ask('Who are my investors?'); });
  await act(async () => { await result.current.ask('Which of them is in Boston?'); });

  expect(requests).toHaveLength(2);
  expect(requests[0].messages).toEqual([{ role: 'user', content: 'Who are my investors?' }]);
  expect(requests[1].messages).toEqual([
    { role: 'user', content: 'Who are my investors?' },
    { role: 'assistant', content: answers[0] },
    { role: 'user', content: 'Which of them is in Boston?' },
  ]);
});

it('a resumed chat keeps its context', async () => {
  await switchDatabase('MEMBER_CONTINUITY');
  const { result } = renderHook(() => useConnectionChat());

  await act(async () => { await result.current.ask('Who are my investors?'); });
  const id = result.current.activeId!;
  act(() => result.current.newChat());
  await act(async () => { await result.current.selectChat(id); });
  await act(async () => { await result.current.ask('And the second one?'); });

  const last = requests[requests.length - 1].messages;
  expect(last.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(last[1].content).toBe(answers[0]);
});
