// @vitest-environment jsdom
// The Inbox Drafts/Scheduled views (the MCP connector queue), the folder menu
// that reaches them, and the Unread switch beside it.
import '../dom-setup';
import Dexie from 'dexie';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
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

it('one folder menu lists every folder, Primary first, with queue counts', async () => {
  await db!.scheduledMessages.add(msg({ id: 'd1', status: 'draft' }));
  await db!.scheduledMessages.add(msg({ id: 's1', status: 'scheduled', scheduledAt: Date.now() + 3600_000 }));
  render(<ConversationListHeader />);

  fireEvent.click(screen.getByRole('button', { name: 'Folder' }));
  const names = () => screen.getAllByRole('menuitemradio').map((b) => b.textContent);
  await waitFor(() => expect(names()).toEqual(['Primary', 'Other', 'Drafts1', 'Scheduled1', 'Archive', 'Spam']));
  // Grouped: inbox, the outbound queue, then the rarely visited.
  expect(screen.getAllByRole('group').map((g) => within(g).getAllByRole('menuitemradio').length)).toEqual([2, 2, 2]);

  fireEvent.click(screen.getByRole('menuitemradio', { name: /Scheduled/ }));
  await waitFor(() => expect(useUIStore.getState().inboxTab).toBe('scheduled'));
  expect(screen.getByRole('button', { name: 'Folder' })).toHaveTextContent('Scheduled');
});

it('Unread is a switch that shows when it is on', () => {
  render(<ConversationListHeader />);
  const unread = screen.getByRole('switch', { name: /Unread/ });
  expect(unread).toHaveAttribute('aria-checked', 'false');

  fireEvent.click(unread);
  expect(useUIStore.getState().searchQuery).toBe('is:unread');
  expect(unread).toHaveAttribute('aria-checked', 'true');

  fireEvent.click(unread);
  expect(useUIStore.getState().searchQuery).toBe('');
  expect(unread).toHaveAttribute('aria-checked', 'false');
});
