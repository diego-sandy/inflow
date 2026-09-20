import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { useDbGeneration } from '@/hooks/useDbGeneration';
import { dueMessages } from '@/lib/scheduled-messages';
import type { ScheduledMessage } from '@/types/scheduled-message';

export interface OutboxGroups {
  /** Scheduled messages whose time has arrived — surfaced for a one-click send. */
  ready: ScheduledMessage[];
  /** Scheduled for a future time. */
  scheduled: ScheduledMessage[];
  /** Drafts with no send time yet. */
  drafts: ScheduledMessage[];
  /** Failed sends (retryable). */
  failed: ScheduledMessage[];
  /** Sent history, most recent first. */
  sent: ScheduledMessage[];
  /** Count that needs the user's attention now (ready + failed). */
  attention: number;
}

/**
 * Groups the local outbound queue for the Outbox section. "Scheduled" messages
 * whose time has passed are *resurfaced* as `ready` (we never auto-send — the
 * user sends with one click), so we re-evaluate on a slow tick while mounted.
 */
export function useOutbox(): OutboxGroups {
  const dbGen = useDbGeneration();
  const rows = useLiveQuery(async () => {
    if (!db) return [] as ScheduledMessage[];
    return db.scheduledMessages.toArray();
  }, [dbGen]) ?? [];

  // Re-evaluate "ready" as time passes, even without a DB change.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const dueIds = new Set(dueMessages(rows, now).map((r) => r.id));

  const ready: ScheduledMessage[] = [];
  const scheduled: ScheduledMessage[] = [];
  const drafts: ScheduledMessage[] = [];
  const failed: ScheduledMessage[] = [];
  const sent: ScheduledMessage[] = [];

  for (const r of rows) {
    if (r.status === 'sent') sent.push(r);
    else if (r.status === 'failed') failed.push(r);
    else if (r.status === 'draft') drafts.push(r);
    else if (dueIds.has(r.id)) ready.push(r); // scheduled + due
    else scheduled.push(r); // scheduled (future) or sending
  }

  ready.sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  scheduled.sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  drafts.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  failed.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  sent.sort((a, b) => (b.sentAt ?? b.updatedAt ?? 0) - (a.sentAt ?? a.updatedAt ?? 0));

  return { ready, scheduled, drafts, failed, sent, attention: ready.length + failed.length };
}
