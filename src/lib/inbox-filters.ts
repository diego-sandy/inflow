import type { Conversation } from '@/types/conversation';
import type { InboxTab } from '@/store/ui-store';

/**
 * The single definition of the Focused tab's category rule: PRIMARY_INBOX,
 * legacy 'INBOX' rows, and rows with no category at all (old data). Shared by
 * the conversation list and the toolbar badge so they can never disagree.
 */
export function isFocusedCategory(category: string | undefined): boolean {
  return !category || category === 'PRIMARY_INBOX' || category === 'INBOX';
}

/**
 * "Belongs to the Focused tab" for badge purposes: focused category, not
 * archived, and not a compose draft. (The list itself still SHOWS drafts —
 * they just never count as unread.)
 */
export function isFocusedConversation(
  c: Pick<Conversation, 'archived' | 'category' | 'draft'>
): boolean {
  if (c.draft === 1) return false;
  if (c.archived === 1) return false;
  return isFocusedCategory(c.category);
}

/**
 * "Belongs to the Other tab" for badge purposes: SECONDARY_INBOX, not archived,
 * not a compose draft. Mirrors the list query (useConversations) so the badge
 * and the list agree on what counts.
 */
export function isOtherConversation(
  c: Pick<Conversation, 'archived' | 'category' | 'draft'>
): boolean {
  if (c.draft === 1) return false;
  if (c.archived === 1) return false;
  return c.category === 'SECONDARY_INBOX';
}

/**
 * Whether a conversation will appear in a given tab's list — mirroring the
 * per-tab queries in useConversations, which are the authority.
 *
 * Used to tell "this row is gone" apart from "this row is not listed YET". A
 * row written a moment ago is in the database before the live query reports
 * it, and treating that gap as removal makes the app recover from a selection
 * that was perfectly good.
 *
 * InMail and the outbox tabs can't be answered from the row alone (InMail is
 * selected by its messages; the outbox tabs list no conversations), so they
 * answer false — "not coming", the safe default.
 */
export function belongsToTab(
  c: Pick<Conversation, 'archived' | 'category'>,
  tab: InboxTab
): boolean {
  if (tab === 'archived') return c.archived === 1;
  if (tab === 'spam') return c.category === 'SPAM';
  if (tab === 'other') return c.category === 'SECONDARY_INBOX';
  if (tab === 'focused') return c.archived !== 1 && isFocusedCategory(c.category);
  return false;
}

/** Count unread Focused-tab conversations (drives the toolbar badge). */
export async function countUnreadFocused(db: {
  conversations: { where(index: string): { equals(v: number): { filter(f: (c: Conversation) => boolean): { count(): Promise<number> } } } };
}): Promise<number> {
  return db.conversations
    .where('read')
    .equals(0)
    .filter((c) => isFocusedConversation(c))
    .count();
}
