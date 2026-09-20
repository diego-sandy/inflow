import type { ScheduledMessage, ScheduledStatus } from '@/types/scheduled-message';

/** Scheduled messages whose send time has arrived. */
export function dueMessages(rows: ScheduledMessage[], now: number): ScheduledMessage[] {
  return rows.filter(
    (r) => r.status === 'scheduled' && typeof r.scheduledAt === 'number' && r.scheduledAt <= now,
  );
}

/** Sort for the queue: pending first (soonest scheduled, then drafts), then sent/failed. */
export function sortForQueue(rows: ScheduledMessage[]): ScheduledMessage[] {
  const rank: Record<ScheduledStatus, number> = {
    scheduled: 0,
    sending: 0,
    draft: 1,
    failed: 2,
    sent: 3,
  };
  return [...rows].sort((a, b) => {
    const r = rank[a.status] - rank[b.status];
    if (r !== 0) return r;
    // Within scheduled: soonest first. Otherwise most recently touched first.
    if (a.status === 'scheduled' && b.status === 'scheduled') {
      return (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0);
    }
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
}

export function statusLabel(status: ScheduledStatus): string {
  switch (status) {
    case 'draft': return 'Draft';
    case 'scheduled': return 'Scheduled';
    case 'sending': return 'Sending…';
    case 'sent': return 'Sent';
    case 'failed': return 'Failed';
  }
}
