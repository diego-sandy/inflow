// @vitest-environment jsdom
// The Inbox Drafts/Scheduled views (the MCP connector queue reached from the
// tab row's "More" menu) and the menu itself.
import '../dom-setup';
import Dexie from 'dexie';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { switchDatabase, db } from '@/db/database';
import { InboxQueue } from '@/components/conversations/InboxQueue';
import { ConversationListHeader } from '@/components/conversations/ConversationListHeader';
import { useUIStore } from '@/store/ui-store';
import type { ScheduledMessage } from '@/types/scheduled-message';

vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn(async () => ({ success: true })) }));

function msg(over: Partial<ScheduledMessage>): ScheduledMessage {
  const now = Date.now();
  return {
    id: Math.random().toString(36).slice(2),
    recipientUrns: ['urn:li:fsd_profile:P'],
    recipientName: 'Ada Lovelace',
    body: 'Hello',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

beforeEach(async () => {
  await switchDatabase('MEMBER_QUEUE');
  await db!.scheduledMessages.clear();
  act(() => useUIStore.setState({ inboxTab: 'focused', toast: null, searchQuery: '' }));
});
afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_QUEUE').catch(() => {});
});

it('Drafts view shows drafts, not scheduled', async () => {
  await db!.scheduledMessages.bulkAdd([
    msg({ id: 'd1', body: 'A draft', status: 'draft' }),
    msg({ id: 's1', body: 'A scheduled', status: 'scheduled', scheduledAt: Date.now() + 3600_000 }),
  ]);
  render(<InboxQueue kind="drafts" />);
  expect(await screen.findByText('A draft')).toBeInTheDocument();
  expect(screen.queryByText('A scheduled')).not.toBeInTheDocument();
});

it('Scheduled view shows scheduled (incl. past-due as ready), not drafts', async () => {
  await db!.scheduledMessages.bulkAdd([
    msg({ id: 'd1', body: 'A draft', status: 'draft' }),
    msg({ id: 's1', body: 'Future note', status: 'scheduled', scheduledAt: Date.now() + 3600_000 }),
    msg({ id: 's2', body: 'Due note', status: 'scheduled', scheduledAt: Date.now() - 60_000 }),
  ]);
  render(<InboxQueue kind="scheduled" />);
  expect(await screen.findByText('Future note')).toBeInTheDocument();
  expect(screen.getByText('Due note')).toBeInTheDocument();
  expect(screen.getByText('Ready to send')).toBeInTheDocument();
  expect(screen.queryByText('A draft')).not.toBeInTheDocument();
});

it('the tab row "More" menu opens the Scheduled queue view', async () => {
  await db!.scheduledMessages.add(msg({ id: 's1', status: 'scheduled', scheduledAt: Date.now() + 3600_000 }));
  render(<ConversationListHeader />);

  fireEvent.click(await screen.findByRole('button', { name: /^More/ }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Scheduled/i }));
  await waitFor(() => expect(useUIStore.getState().inboxTab).toBe('scheduled'));
});
