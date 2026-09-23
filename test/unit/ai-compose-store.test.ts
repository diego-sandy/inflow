import { useAiComposeStore } from '@/store/ai-compose-store';

beforeEach(() => {
  useAiComposeStore.setState({
    conversationId: null,
    enabled: false,
    instruction: '',
    draft: null,
    status: 'idle',
    error: null,
  });
});

it('focusConversation clears per-thread state but keeps the mode sticky', () => {
  const s = useAiComposeStore.getState();
  s.setEnabled(true);
  s.focusConversation('c1');
  s.setInstruction('thank them');
  s.setDraft('Hi there');
  s.setStatus('idle');

  // Switching threads clears the pending draft + instruction, keeps enabled.
  useAiComposeStore.getState().focusConversation('c2');
  const after = useAiComposeStore.getState();
  expect(after.conversationId).toBe('c2');
  expect(after.instruction).toBe('');
  expect(after.draft).toBeNull();
  expect(after.enabled).toBe(true);
});

it('focusConversation is a no-op when already on that conversation', () => {
  const s = useAiComposeStore.getState();
  s.focusConversation('c1');
  s.setDraft('keep me');
  useAiComposeStore.getState().focusConversation('c1');
  expect(useAiComposeStore.getState().draft).toBe('keep me');
});

it('setStatus only keeps an error message in the error state', () => {
  const s = useAiComposeStore.getState();
  s.setStatus('error', 'boom');
  expect(useAiComposeStore.getState().error).toBe('boom');
  s.setStatus('idle', 'boom');
  expect(useAiComposeStore.getState().error).toBeNull();
});

it('discard clears the draft but leaves the instruction to rewrite', () => {
  const s = useAiComposeStore.getState();
  s.setInstruction('keep this');
  s.setDraft('to discard');
  s.setStatus('idle');
  useAiComposeStore.getState().discard();
  const after = useAiComposeStore.getState();
  expect(after.draft).toBeNull();
  expect(after.instruction).toBe('keep this');
});
