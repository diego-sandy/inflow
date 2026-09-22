import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useConnections } from './useConnections';
import { useAISession } from './useAISession';
import { useDbGeneration } from './useDbGeneration';
import { useUIStore } from '@/store/ui-store';
import { db } from '@/db/database';
import { useInsightChatStore } from '@/store/insight-chat-store';
import { answerConnectionQuestion, CHAT_CONTEXT_LIMIT, DEFAULT_CHAT_INSTRUCTIONS, type ChatMessage } from '@/lib/connection-chat';
import { smartRetrieve } from '@/lib/connection-retrieval';
import { answerWithClaudeAgent } from '@/lib/agent/network-agent';
import { isCompanionConnected } from '@/lib/mcp/bridge-client';
import { activityLabel } from '@/lib/mcp/bridge-protocol';
import { getAIChatMaxWords, getAIChatInstructions, getAIChatAppendInstructions, getTierProvider, getAnthropicModel } from '@/lib/ai-settings';
import type { InsightChat } from '@/types/insight-chat';

export interface ConnectionChatState {
  /** Transcript of the active conversation. */
  messages: ChatMessage[];
  loading: boolean;
  available: boolean;
  error: string | null;
  /** Live phase text while a turn is in flight (retrieval → answering). */
  status: string;
  connectionCount: number;
  /** All saved conversations, most recent first (for the history sidebar). */
  chats: InsightChat[];
  /** The active conversation's id (null = unsaved new chat). */
  activeId: string | null;
  ask: (question: string) => Promise<void>;
  /** Start a new, empty conversation. */
  newChat: () => void;
  /** Load a saved conversation into the active view. */
  selectChat: (id: string) => Promise<void>;
  /** Delete a saved conversation. */
  deleteChat: (id: string) => Promise<void>;
  /** Alias of newChat (kept for older call sites). */
  clear: () => void;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `chat-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

/** Upsert a chat, preserving createdAt/title unless explicitly set. */
async function persist(id: string, messages: ChatMessage[], title?: string): Promise<void> {
  if (!db) return;
  const now = Date.now();
  const existing = await db.insightChats.get(id);
  await db.insightChats.put({
    id,
    title: title ?? existing?.title ?? 'New chat',
    messages,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/**
 * Persistent, multi-conversation chat for "Ask your network". The active thread
 * lives in a shared store (so the card and the expanded overlay stay in sync);
 * every turn is written to IndexedDB so past conversations show in the sidebar
 * and can be resumed. Answers are grounded in the connection list + the AI
 * summaries we generate (see buildConnectionContext).
 */
export function useConnectionChat(): ConnectionChatState {
  const { connections } = useConnections();
  const { available: aiAvailable, predict } = useAISession();
  const dbGen = useDbGeneration();
  const { messages, loading, error, activeId, status } = useInsightChatStore();

  // The Claude agent (Phase 2) runs through the companion, so the chat is usable
  // when the provider is Claude and the companion is connected — even with no
  // browser-stored key (the key lives in the companion). Otherwise fall back to
  // the normal "active provider has a key" availability.
  const mcpConnected = useUIStore((s) => s.mcpStatus) === 'connected';
  const [isAnthropic, setIsAnthropic] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => getTierProvider('quality').then((p) => { if (!cancelled) setIsAnthropic(p === 'anthropic'); }).catch(() => {});
    load();
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('aiQualityProvider' in changes || 'aiProvider' in changes) load();
    };
    chrome?.storage?.local?.onChanged?.addListener?.(listener);
    return () => { cancelled = true; chrome?.storage?.local?.onChanged?.removeListener?.(listener); };
  }, []);
  const available = aiAvailable || (isAnthropic && mcpConnected);

  const chats = useLiveQuery(async () => {
    if (!db) return [] as InsightChat[];
    return db.insightChats.orderBy('updatedAt').reverse().toArray();
  }, [dbGen]) ?? [];

  const ask = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      const store = useInsightChatStore.getState();
      if (!question || store.loading) return;
      store.setError(null);

      // Resolve (or create) the active chat.
      let id = store.activeId;
      let title: string | undefined;
      if (!id) {
        id = newId();
        title = question.length > 60 ? question.slice(0, 60) + '…' : question;
        store.setActiveId(id);
      }

      const history = store.messages;
      const withUser: ChatMessage[] = [...history, { role: 'user', content: question }];
      store.setMessages(withUser);
      store.setLoading(true);
      await persist(id, withUser, title);

      try {
        // Phase 2: when Claude is the provider AND the companion is connected,
        // run the tool-use agent (Claude calls inflow's tools via the companion —
        // no CORS, key stays out of the browser). Otherwise use the Phase 1
        // retrieval + single-call path (Gemini, or Claude without the companion).
        const provider = await getTierProvider('quality');
        const useAgent = provider === 'anthropic' && isCompanionConnected();

        let finalText = '';
        if (useAgent) {
          const model = await getAnthropicModel('quality');
          store.setStatus('Claude is working…');
          finalText = await answerWithClaudeAgent({
            question,
            model,
            onStep: (s) => useInsightChatStore.getState().setStatus(activityLabel(s.tool, s.input)),
          });
        } else {
          // Apply the user's Advanced AI settings (base prompt, on-top
          // instructions, soft word target). Output is never capped.
          const [targetWords, storedInstructions, append] = await Promise.all([
            getAIChatMaxWords(),
            getAIChatInstructions(),
            getAIChatAppendInstructions(),
          ]);
          const instructions = storedInstructions.trim() || DEFAULT_CHAT_INSTRUCTIONS;

          // Phase 1 retrieval: narrow to the relevant connections for a targeted
          // question (broad questions still see everything). Surface the step.
          store.setStatus('Searching your network…');
          const { subset, info } = await smartRetrieve(connections, question, predict);
          if (info.mode === 'targeted') {
            store.setStatus(`Focused on ${info.used} of ${info.total} connections · ${info.keywords.slice(0, 4).join(', ')}`);
          } else {
            store.setStatus(`Reading your ${info.total.toLocaleString()} connections…`);
          }

          // Stream the answer in live so the user sees it build.
          let streamed = '';
          const renderStream = () => {
            useInsightChatStore.getState().setMessages([
              ...withUser,
              { role: 'assistant', content: streamed },
            ]);
          };
          const answer = await answerConnectionQuestion(subset, question, predict, history, CHAT_CONTEXT_LIMIT, {
            maxTokens: 0, // uncapped — never truncate the answer on screen
            instructions,
            append,
            targetWords,
            onToken: (chunk) => {
              streamed += chunk;
              renderStream();
            },
          });
          finalText = answer || streamed;
        }

        // Empty result: give a reason instead of a dead-end. A Claude request
        // that returned nothing without the companion is almost always the org's
        // browser/CORS block — point at the fix.
        let fallback = "I couldn't find an answer in your connections.";
        if (!finalText && provider === 'anthropic' && !useAgent) {
          fallback = 'Claude couldn’t be reached from the browser (your org may block it). Open the MCP connector and connect the companion to run Claude.';
        }

        const withAnswer: ChatMessage[] = [
          ...withUser,
          { role: 'assistant', content: finalText || fallback },
        ];
        useInsightChatStore.getState().setMessages(withAnswer);
        await persist(id, withAnswer);
      } catch (e: any) {
        // Surface the real reason (no key in companion, Anthropic error, companion
        // dropped, timeout…) so failures are debuggable, not a generic message.
        const reason = e?.message || 'Something went wrong.';
        useInsightChatStore.getState().setError(reason);
        const withErr: ChatMessage[] = [
          ...withUser,
          { role: 'assistant', content: `Sorry — that request failed.\n\n${reason}` },
        ];
        useInsightChatStore.getState().setMessages(withErr);
        await persist(id, withErr);
      } finally {
        useInsightChatStore.getState().setLoading(false);
        useInsightChatStore.getState().setStatus('');
      }
    },
    [connections, predict],
  );

  const newChat = useCallback(() => {
    useInsightChatStore.getState().reset();
  }, []);

  const selectChat = useCallback(async (id: string) => {
    if (!db) return;
    const chat = await db.insightChats.get(id);
    if (!chat) return;
    const store = useInsightChatStore.getState();
    store.setActiveId(id);
    store.setMessages(chat.messages || []);
    store.setError(null);
  }, []);

  const deleteChat = useCallback(async (id: string) => {
    if (!db) return;
    await db.insightChats.delete(id);
    if (useInsightChatStore.getState().activeId === id) useInsightChatStore.getState().reset();
  }, []);

  return {
    messages,
    loading,
    available,
    error,
    status,
    connectionCount: connections.length,
    chats,
    activeId,
    ask,
    newChat,
    selectChat,
    deleteChat,
    clear: newChat,
  };
}
