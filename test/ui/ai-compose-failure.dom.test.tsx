// @vitest-environment jsdom
// When an AI draft can't be written, the draft says why, rather than always
// suggesting the user rephrase.
import '../dom-setup';

const predict = vi.fn();
vi.mock('@/hooks/useAISession', () => ({ useAISession: () => ({ available: true, predict }) }));

import { renderHook, act } from '@testing-library/react';
import { useAiCompose } from '@/hooks/useAiCompose';
import { useAiComposeStore } from '@/store/ai-compose-store';

beforeEach(() => {
  predict.mockReset();
  act(() => useAiComposeStore.setState({ draft: null, status: 'idle', error: null, instruction: '' } as any));
});

function compose() {
  const { result } = renderHook(() => useAiCompose({ conversationId: 'c1', messages: [], participantNames: ['Steve'] }));
  act(() => useAiComposeStore.getState().setInstruction('Tuesday morning works, send my Calendly'));
  return result;
}

it('shows the reason the AI gave no draft', async () => {
  predict.mockImplementation(async (_p: string, opts: any) => {
    opts.onFailure('Gemini is rate-limiting requests; wait a minute and try again');
    return null;
  });
  const result = compose();
  await act(async () => {
    await result.current.generate();
  });
  expect(useAiComposeStore.getState().status).toBe('error');
  expect(useAiComposeStore.getState().error).toBe('Gemini is rate-limiting requests; wait a minute and try again.');
});

it('suggests rephrasing only when there is no other explanation', async () => {
  predict.mockResolvedValue(null);
  const result = compose();
  await act(async () => {
    await result.current.generate();
  });
  expect(useAiComposeStore.getState().error).toBe('The AI returned nothing. Try rephrasing your instruction.');
});
