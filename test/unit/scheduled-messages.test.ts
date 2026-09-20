/**
 * Scheduling logic: due-message selection and queue ordering.
 */
import { dueMessages, sortForQueue, statusLabel } from '@/lib/scheduled-messages';
import type { ScheduledMessage } from '@/types/scheduled-message';

function m(over: Partial<ScheduledMessage>): ScheduledMessage {
  return {
    id: Math.random().toString(),
    recipientUrns: ['u'],
    recipientName: 'X',
    body: 'hi',
    status: 'scheduled',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('dueMessages', () => {
  it('returns only scheduled rows whose time has passed', () => {
    const rows = [
      m({ id: 'past', status: 'scheduled', scheduledAt: 100 }),
      m({ id: 'future', status: 'scheduled', scheduledAt: 300 }),
      m({ id: 'draft', status: 'draft' }),
      m({ id: 'sent', status: 'sent', scheduledAt: 100 }),
      m({ id: 'sending', status: 'sending', scheduledAt: 100 }),
    ];
    const due = dueMessages(rows, 200).map((r) => r.id);
    expect(due).toEqual(['past']);
  });

  it('ignores scheduled rows with no scheduledAt', () => {
    expect(dueMessages([m({ status: 'scheduled', scheduledAt: undefined })], 999)).toHaveLength(0);
  });
});

describe('sortForQueue', () => {
  it('orders scheduled (soonest) → draft → failed → sent', () => {
    const rows = [
      m({ id: 'sent', status: 'sent', updatedAt: 5 }),
      m({ id: 'draft', status: 'draft', updatedAt: 5 }),
      m({ id: 'sched-late', status: 'scheduled', scheduledAt: 900 }),
      m({ id: 'failed', status: 'failed', updatedAt: 5 }),
      m({ id: 'sched-soon', status: 'scheduled', scheduledAt: 100 }),
    ];
    expect(sortForQueue(rows).map((r) => r.id)).toEqual(['sched-soon', 'sched-late', 'draft', 'failed', 'sent']);
  });
});

describe('statusLabel', () => {
  it('is human-readable', () => {
    expect(statusLabel('scheduled')).toBe('Scheduled');
    expect(statusLabel('sent')).toBe('Sent');
    expect(statusLabel('failed')).toBe('Failed');
  });
});
