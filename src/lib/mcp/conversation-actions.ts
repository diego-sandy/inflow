import { nanoid } from 'nanoid';
import { db } from '@/db/database';
import { sendBridgeMessage } from '@/lib/bridge';
import type { PendingAction } from '@/db/database';
import type { BridgeMessage } from '@/types/bridge';
import type { Conversation } from '@/types/conversation';

/**
 * The inbox actions Claude can take through the connector, without React.
 *
 * They do what useOptimisticAction does for a click — patch the stored row,
 * guard it with a pendingActions row so a sync page can't undo it mid-flight,
 * and roll back if LinkedIn says no — but they wait for LinkedIn's answer
 * instead of firing and forgetting, because Claude needs to know whether it
 * worked before it tells the user it did.
 */

export type TidyAction = 'archive' | 'unarchive' | 'markRead' | 'markUnread' | 'focused' | 'other' | 'star' | 'unstar';

export interface ActionOutcome {
  conversationId: string;
  with?: string[];
  ok: boolean;
  error?: string;
}

const PLAN: Record<
  TidyAction,
  { bridge: BridgeMessage['type']; type: PendingAction['type']; patch: Partial<Conversation> }
> = {
  archive: { bridge: 'ARCHIVE', type: 'archive', patch: { archived: 1, category: 'ARCHIVE' } },
  // The inverse of archive in the UI's undo: back to Focused.
  unarchive: { bridge: 'UNARCHIVE', type: 'unarchive', patch: { archived: 0, category: 'PRIMARY_INBOX' } },
  markRead: { bridge: 'MARK_READ', type: 'markRead', patch: { read: 1 } },
  markUnread: { bridge: 'MARK_UNREAD', type: 'markUnread', patch: { read: 0 } },
  focused: { bridge: 'MOVE_TO_FOCUSED', type: 'move_to_focused', patch: { archived: 0, category: 'PRIMARY_INBOX' } },
  other: { bridge: 'MOVE_TO_OTHER', type: 'move_to_other', patch: { archived: 0, category: 'SECONDARY_INBOX' } },
  star: { bridge: 'STAR', type: 'star', patch: { starred: 1 } },
  unstar: { bridge: 'UNSTAR', type: 'unstar', patch: { starred: 0 } },
};

/**
 * The stored conversation and its 1:1 twins in the same folder.
 *
 * LinkedIn can keep several threads with one person (an old InMail and the
 * thread an accepted invitation opened), and the inbox shows them as one row.
 * Acting on only the newest leaves the twin behind, and the row comes straight
 * back. Only twins in the same folder count, matching how the list merges them
 * per tab — an archived twin is not part of the Focused row.
 */
export async function conversationThreads(conversationId: string): Promise<Conversation[]> {
  if (!db) throw new Error('Database unavailable');
  const conv = await db.conversations.get(conversationId);
  if (!conv) throw new Error(`No conversation ${conversationId} — list_conversations shows the ids`);
  if (conv.draft === 1 || conv.id.startsWith('draft-')) {
    throw new Error('That is an unsent draft inside inflow, not a LinkedIn conversation');
  }
  if (conv.participantUrns.length !== 1) return [conv];
  const urn = conv.participantUrns[0];
  const twins = await db.conversations
    .filter(
      (c) =>
        c.id !== conv.id &&
        c.participantUrns.length === 1 &&
        c.participantUrns[0] === urn &&
        (c.archived ?? 0) === (conv.archived ?? 0) &&
        (c.category || 'PRIMARY_INBOX') === (conv.category || 'PRIMARY_INBOX'),
    )
    .toArray();
  return [conv, ...twins];
}

async function call(msg: BridgeMessage): Promise<string | null> {
  try {
    const res = await sendBridgeMessage(msg);
    return res.success ? null : res.error || 'LinkedIn refused it';
  } catch (e: any) {
    return e?.message || 'LinkedIn could not be reached';
  }
}

/** Apply one tidy action to a conversation (and its twins), and say how it went. */
export async function tidyConversation(conversationId: string, action: TidyAction): Promise<ActionOutcome> {
  let threads: Conversation[];
  try {
    threads = await conversationThreads(conversationId);
  } catch (e: any) {
    return { conversationId, ok: false, error: e.message };
  }
  const plan = PLAN[action];
  // Marking read only needs the twins that are unread; the rest are already there.
  if (action === 'markRead') threads = threads.filter((t, i) => i === 0 || t.read === 0);

  let error: string | null = null;
  for (const t of threads) {
    const previous: Partial<Conversation> = {};
    for (const k of Object.keys(plan.patch) as (keyof Conversation)[]) {
      (previous as any)[k] = k === 'category' ? t.category || 'PRIMARY_INBOX' : (t[k] ?? 0);
    }
    const actionId = nanoid();
    await db.conversations.update(t.id, plan.patch);
    await db.pendingActions.put({
      id: actionId,
      type: plan.type,
      conversationId: t.id,
      status: 'pending',
      timestamp: Date.now(),
      rollbackData: previous,
    });
    const failed = await call({ type: plan.bridge, conversationId: t.id } as BridgeMessage);
    if (failed) {
      await db.conversations.update(t.id, previous);
      await db.pendingActions.update(actionId, { status: 'failed' });
      error ??= failed;
    } else {
      await db.pendingActions.update(actionId, { status: 'confirmed' });
    }
  }
  return { conversationId, with: threads[0].participantNames, ok: !error, ...(error ? { error } : {}) };
}

/**
 * Delete a conversation (and its twins) on LinkedIn and here. The tombstone
 * keeps a sync page fetched before the delete from bringing it back; a
 * refusal puts everything back as it was.
 */
export async function deleteConversation(conversationId: string): Promise<ActionOutcome> {
  let threads: Conversation[];
  try {
    threads = await conversationThreads(conversationId);
  } catch (e: any) {
    return { conversationId, ok: false, error: e.message };
  }
  let error: string | null = null;
  for (const stored of threads) {
    const messages = await db.messages.where('conversationId').equals(stored.id).toArray();
    const queueItem = await db.syncQueue.get(stored.id).catch(() => undefined);
    const bridgeMessage = { type: 'DELETE_CONVERSATION' as const, conversationId: stored.id };
    await db.transaction('rw', [db.conversations, db.messages, db.syncQueue, db.tombstones], async () => {
      await db.conversations.delete(stored.id);
      await db.messages.where('conversationId').equals(stored.id).delete();
      await db.syncQueue.delete(stored.id).catch(() => {});
      await db.tombstones.put({ conversationId: stored.id, deletedAt: Date.now() });
    });
    const actionId = nanoid();
    await db.pendingActions.put({
      id: actionId,
      type: 'delete',
      conversationId: stored.id,
      status: 'pending',
      timestamp: Date.now(),
      rollbackData: { conversation: stored, messages },
      bridgeMessage,
    });
    const failed = await call(bridgeMessage);
    if (failed) {
      await db.tombstones.delete(stored.id).catch(() => {});
      await db.conversations.put(stored);
      if (messages.length > 0) await db.messages.bulkPut(messages);
      if (queueItem) await db.syncQueue.put(queueItem).catch(() => {});
      await db.pendingActions.update(actionId, { status: 'failed' });
      error ??= failed;
    } else {
      await db.pendingActions.update(actionId, { status: 'confirmed' });
    }
  }
  return { conversationId, with: threads[0].participantNames, ok: !error, ...(error ? { error } : {}) };
}
