// @vitest-environment jsdom
// Messages › Drafts / Scheduled show the outbound queue the way the MCP
// connector does: one line per message in the list column, the selected one
// open like an email in the reading pane, j/k to move. These used to be full
// cards crammed into the list column while the reading pane kept showing
// whatever conversation was open before.
import '../dom-setup';
import Dexie from 'dexie';
import { render, screen, fireEvent, act, waitFor, within, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { switchDatabase, db } from '@/db/database';
import { InboxQueue, QueueReadingPane } from '@/components/conversations/InboxQueue';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';
import type { ScheduledMessage } from '@/types/scheduled-message';

vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn(async () => ({ success: true })) }));

function row(over: Partial<ScheduledMessage>): ScheduledMessage {
  return {
    id: Math.random().toString(36).slice(2),
    recipientUrns: ['urn:li:fsd_profile:P'],
    recipientName: 'Dana Whitfield',
    body: 'Hello there',
    status: 'draft',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

beforeEach(async () => {
  await switchDatabase('MEMBER_IQ');
  await db!.scheduledMessages.clear();
  await db!.conversations.clear();
  await db!.messages.clear();
  act(() => useUIStore.setState({ selectedQueueId: null, inboxTab: 'drafts', activeSection: 'inbox', settingsOpen: false, paletteOpen: false, shortcutOverlayOpen: false } as any));
});
afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_IQ').catch(() => {});
});

const both = (kind: 'drafts' | 'scheduled') => render(<><InboxQueue kind={kind} /><QueueReadingPane /></>);
const list = (name: string) => screen.getByRole('listbox', { name });
const pane = () => screen.getByRole('region', { name: 'Selected message' });
const option = (name: string) => within(screen.getAllByRole('listbox')[0]).getByText(name).closest('[role="option"]') as HTMLElement;

it('Drafts lists drafts as one-line rows, and opens the first in the reading pane', async () => {
  await db!.scheduledMessages.bulkAdd([
    row({ id: 'a', recipientName: 'Dana Whitfield', body: 'A long first draft\nwith a second line', updatedAt: 3 }),
    row({ id: 'b', recipientName: 'Owen Pratt', body: 'Second draft', updatedAt: 2 }),
    row({ id: 's', recipientName: 'Theo Marsh', status: 'scheduled', scheduledAt: Date.now() + 9e6 }),
  ]);
  both('drafts');
  await within(await screen.findByRole('listbox', { name: 'Drafts' })).findByText('Owen Pratt');

  // Only drafts, no actions in the list itself.
  expect(within(list('Drafts')).queryByText('Theo Marsh')).toBeNull();
  expect(within(list('Drafts')).queryByRole('button', { name: /send now/i })).toBeNull();

  // The first is open, in full, with its actions.
  await waitFor(() => expect(option('Dana Whitfield').getAttribute('aria-selected')).toBe('true'));
  expect(within(pane()).getByRole('heading', { name: 'New message to Dana Whitfield' })).toBeInTheDocument();
  expect(within(pane()).getByText(/A long first draft/)).toBeInTheDocument();
  expect(within(pane()).getByRole('button', { name: /send now/i })).toBeInTheDocument();
});

it('clicking a row, or j / k, changes what the reading pane shows', async () => {
  await db!.scheduledMessages.bulkAdd([
    row({ id: 'a', recipientName: 'Dana Whitfield', body: 'first body', updatedAt: 3 }),
    row({ id: 'b', recipientName: 'Owen Pratt', body: 'second body', updatedAt: 2 }),
  ]);
  both('drafts');
  await within(await screen.findByRole('listbox', { name: 'Drafts' })).findByText('Owen Pratt');
  await waitFor(() => expect(within(pane()).getByText('first body')).toBeInTheDocument());

  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(within(pane()).getByText('second body')).toBeInTheDocument());
  fireEvent.keyDown(window, { key: 'k' });
  await waitFor(() => expect(within(pane()).getByText('first body')).toBeInTheDocument());

  fireEvent.click(option('Owen Pratt'));
  await waitFor(() => expect(within(pane()).getByText('second body')).toBeInTheDocument());
});

it('Scheduled lists what is due and what is coming, grouped', async () => {
  await db!.scheduledMessages.bulkAdd([
    row({ id: 'due', recipientName: 'Dana Whitfield', status: 'scheduled', scheduledAt: Date.now() - 60_000 }),
    row({ id: 'later', recipientName: 'Owen Pratt', status: 'scheduled', scheduledAt: Date.now() + 9e6 }),
    row({ id: 'd', recipientName: 'Theo Marsh' }),
  ]);
  both('scheduled');
  const l = await screen.findByRole('listbox', { name: 'Scheduled' });
  await within(l).findByText('Owen Pratt');
  expect(within(l).getByRole('group', { name: 'Ready to send' })).toHaveTextContent('Dana Whitfield');
  expect(within(l).getByRole('group', { name: 'Scheduled' })).toHaveTextContent('Owen Pratt');
  expect(within(l).queryByText('Theo Marsh')).toBeNull();
});

it('a held draft sits in its own group, and the pane says why', async () => {
  await db!.conversations.put(makeConversation({ id: 'conv-d', participantUrns: ['urn:li:fsd_profile:D'] }));
  await db!.messages.put({
    id: 'm1', conversationId: 'conv-d', isFromMe: true, createdAt: 1000, subject: 'Hello from us',
    senderUrn: 'me', senderName: 'Me', senderPicture: '', body: 'first InMail',
  } as any);
  await db!.scheduledMessages.add(row({ id: 'h', recipientUrns: ['urn:li:fsd_profile:D'], recipientName: 'Dana Whitfield', inMailSubject: 'Re: Hello from us', createdAt: 2000, updatedAt: 2000 }));
  both('drafts');
  const l = await screen.findByRole('listbox', { name: 'Drafts' });
  await waitFor(() => expect(within(l).getByRole('group', { name: 'Waiting for their reply' })).toBeInTheDocument());
  expect(await within(pane()).findByRole('note')).toHaveTextContent(/hasn’t replied to your InMail/);
});

it('an empty tab says so', async () => {
  both('drafts');
  expect(await screen.findByText('No drafts yet.')).toBeInTheDocument();
});

it('j in Drafts no longer walks the hidden conversation list', () => {
  const conversations = [makeConversation({ id: '2-x-1' }), makeConversation({ id: '2-x-2' })];
  act(() => useUIStore.setState({ inboxTab: 'drafts', selectedConversationId: '2-x-1', selectedIndex: 0 } as any));
  renderHook(() => useKeyboard(conversations, createRef<HTMLTextAreaElement>()));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
  expect(useUIStore.getState().selectedConversationId).toBe('2-x-1');
});
