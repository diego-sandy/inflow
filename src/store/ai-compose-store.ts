import { create } from 'zustand';

/**
 * State for AI Compose in the thread: the user flips the mode on, types an
 * instruction, and the model writes a pending draft shown as a bubble in the
 * thread that the user approves (→ loads into the composer) or discards.
 *
 * One active conversation at a time (the open thread). `enabled` is sticky across
 * thread switches within the session; the per-thread instruction/draft reset when
 * the conversation changes so a draft never leaks into the wrong thread.
 */
export type AiComposeStatus = 'idle' | 'generating' | 'error';

interface AiComposeState {
  conversationId: string | null;
  enabled: boolean;
  instruction: string;
  /** The generated draft (streams in). null = nothing pending. */
  draft: string | null;
  status: AiComposeStatus;
  error: string | null;

  /** Point the store at a conversation, clearing per-thread ephemeral state. */
  focusConversation: (id: string) => void;
  setEnabled: (v: boolean) => void;
  setInstruction: (v: string) => void;
  setDraft: (v: string | null) => void;
  setStatus: (status: AiComposeStatus, error?: string | null) => void;
  /** Clear the pending draft (Discard), keeping the mode on to rewrite. */
  discard: () => void;
}

export const useAiComposeStore = create<AiComposeState>((set) => ({
  conversationId: null,
  enabled: false,
  instruction: '',
  draft: null,
  status: 'idle',
  error: null,

  focusConversation: (id) =>
    set((s) =>
      s.conversationId === id
        ? {}
        : { conversationId: id, instruction: '', draft: null, status: 'idle', error: null },
    ),
  setEnabled: (v) => set({ enabled: v }),
  setInstruction: (v) => set({ instruction: v }),
  setDraft: (v) => set({ draft: v }),
  setStatus: (status, error = null) => set({ status, error: status === 'error' ? error : null }),
  discard: () => set({ draft: null, status: 'idle', error: null }),
}));
