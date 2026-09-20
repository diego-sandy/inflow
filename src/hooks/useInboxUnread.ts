import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { useDbGeneration } from '@/hooks/useDbGeneration';
import { isFocusedConversation, isOtherConversation } from '@/lib/inbox-filters';

export interface InboxUnread {
  /** Unread in the Focused/Primary tab. */
  focused: number;
  /** Unread in the Other/InMail tab. */
  other: number;
  /** focused + other — the number shown on the Inbox parent. */
  total: number;
}

const EMPTY: InboxUnread = { focused: 0, other: 0, total: 0 };

/**
 * Live unread counts per inbox tab, for the nav badges. Loads only unread rows
 * (indexed `read=0`) and partitions them the same way the list queries do, so a
 * badge can never disagree with the folder it points at.
 */
export function useInboxUnread(): InboxUnread {
  const dbGen = useDbGeneration();
  return (
    useLiveQuery(async () => {
      if (!db) return EMPTY;
      const unread = await db.conversations.where('read').equals(0).toArray();
      let focused = 0;
      let other = 0;
      for (const c of unread) {
        if (isFocusedConversation(c)) focused += 1;
        else if (isOtherConversation(c)) other += 1;
      }
      return { focused, other, total: focused + other };
    }, [dbGen]) ?? EMPTY
  );
}
