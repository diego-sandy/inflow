import { useCallback, useEffect } from 'react';
import { useAISession } from './useAISession';
import { useAiComposeStore, type AiComposeStatus } from '@/store/ai-compose-store';
import { buildComposePrompt, COMPOSE_SYSTEM_PROMPT, COMPOSE_MAX_TOKENS } from '@/lib/ai-compose-prompt';
import type { Message } from '@/types/message';

export interface AiComposeApi {
  /** Whether any AI provider is usable (a key or the companion). */
  available: boolean;
  enabled: boolean;
  instruction: string;
  draft: string | null;
  status: AiComposeStatus;
  error: string | null;
  setEnabled: (v: boolean) => void;
  setInstruction: (v: string) => void;
  /** Generate (or regenerate) a draft from the current instruction. */
  generate: () => Promise<void>;
  /** Approve the draft: send it now (one click). Never sends without this click. */
  approve: () => void;
  /** Discard the pending draft (stay in AI mode). */
  discard: () => void;
}

/**
 * AI Compose for the open thread. Owns generation (via the Quality-tier model)
 * and the approve/discard handoff. Approve dispatches `inflow:ai-compose-approve`
 * with { conversationId, text }; the ComposeBox listens and loads the text so the
 * user can edit and send it — the message is never sent automatically.
 */
export function useAiCompose({
  conversationId,
  messages,
  participantNames,
}: {
  conversationId: string;
  messages: Message[];
  participantNames: string[];
}): AiComposeApi {
  const { available, predict } = useAISession();
  const enabled = useAiComposeStore((s) => s.enabled);
  const instruction = useAiComposeStore((s) => s.instruction);
  const draft = useAiComposeStore((s) => s.draft);
  const status = useAiComposeStore((s) => s.status);
  const error = useAiComposeStore((s) => s.error);
  const setEnabled = useAiComposeStore((s) => s.setEnabled);
  const setInstruction = useAiComposeStore((s) => s.setInstruction);
  const discard = useAiComposeStore((s) => s.discard);

  // Point the store at this thread; clears any pending draft from a prior one.
  useEffect(() => {
    useAiComposeStore.getState().focusConversation(conversationId);
  }, [conversationId]);

  const generate = useCallback(async () => {
    const store = useAiComposeStore.getState();
    const text = store.instruction.trim();
    if (!text || store.status === 'generating') return;
    store.setStatus('generating');
    store.setDraft('');

    let streamed = '';
    try {
      const prompt = buildComposePrompt(messages, participantNames, text);
      const result = await predict(prompt, {
        tier: 'quality',
        systemPrompt: COMPOSE_SYSTEM_PROMPT,
        maxTokens: COMPOSE_MAX_TOKENS,
        fullResponse: true,
        temperature: 0.7,
        onToken: (chunk) => {
          streamed += chunk;
          useAiComposeStore.getState().setDraft(streamed);
        },
      });
      const final = (result || streamed).trim();
      if (!final) {
        useAiComposeStore.getState().setDraft(null);
        useAiComposeStore.getState().setStatus('error', 'The AI returned nothing — try rephrasing your instruction.');
        return;
      }
      useAiComposeStore.getState().setDraft(final);
      useAiComposeStore.getState().setStatus('idle');
    } catch (e: any) {
      useAiComposeStore.getState().setDraft(null);
      useAiComposeStore.getState().setStatus('error', e?.message || 'Could not generate a draft.');
    }
  }, [messages, participantNames, predict]);

  const approve = useCallback(() => {
    const text = (useAiComposeStore.getState().draft || '').trim();
    if (!text) return;
    // One click: send it now, through the composer's normal send path (the user's
    // explicit approval IS the human-in-the-loop confirmation — nothing sends
    // without this click). Clear the pending draft; keep AI mode on for the next.
    document.dispatchEvent(
      new CustomEvent('inflow:ai-compose-send', { detail: { conversationId, text } }),
    );
    useAiComposeStore.setState({ draft: null, instruction: '', status: 'idle', error: null });
  }, [conversationId]);

  return {
    available,
    enabled,
    instruction,
    draft,
    status,
    error,
    setEnabled,
    setInstruction,
    generate,
    approve,
    discard,
  };
}
