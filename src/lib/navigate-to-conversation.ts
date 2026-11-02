import { db } from '@/db/database';
import { useUIStore } from '@/store/ui-store';
import { belongsToTab } from '@/lib/inbox-filters';

/** The tabs in the order navigation should prefer them. */
const TABS = ['archived', 'spam', 'other', 'focused'] as const;

/**
 * Navigate the app to a conversation and open its thread.
 *
 * Switches to the inbox tab the conversation lives in FIRST so it's present in
 * the rendered (tab-filtered) list — otherwise App's auto-select effect can't
 * find it and lands on an unrelated fallback conversation. A search hides it
 * just as effectively as the wrong tab, so that is cleared too: every caller
 * here is an external jump (a notification click, the incoming-message toast,
 * Open conversation on a contact, a reply link in the Outbox), and being taken
 * to a thread you cannot see is the same bug. For the same reason it switches
 * to the inbox section: a jump from Connections or the Outbox starts elsewhere.
 *
 * If the conversation isn't in the local DB yet (e.g. a brand-new thread still
 * syncing), we leave the current tab and let App reconcile once it appears.
 */
export async function navigateToConversation(conversationId: string): Promise<void> {
  const conv = db ? await db.conversations.get(conversationId) : undefined;
  useUIStore.getState().setActiveSection('inbox');
  if (conv) {
    // Same rule App uses to decide a selected row is still coming, so the two
    // can't disagree about where a conversation lives.
    const tab = TABS.find((t) => belongsToTab(conv, t)) ?? 'focused';
    useUIStore.getState().setInboxTab(tab);
  }
  // Don't let setInboxTab's remembered-selection restore hijack our target,
  // and don't leave a search in place that would hide it.
  useUIStore.setState({ _pendingRestore: null, searchQuery: '' });
  // The index is reconciled by App's auto-select effect once the conv is listed.
  useUIStore.getState().openThread(conversationId, 0);
}
