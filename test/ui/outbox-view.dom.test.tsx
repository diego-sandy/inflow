// @vitest-environment jsdom
// The MCP connector's queue: a split view, the queue on the left and the
// selected message in full on the right. Groups drafts/scheduled/failed,
// resurfaces due messages as "Ready to send" (never auto-sends), one-click
// send, edit in place, delete.
import '../dom-setup';
import Dexie from 'dexie';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { switchDatabase, db } from '@/db/database';
import { OutboxView } from '@/components/outbox/OutboxView';
import { useUIStore } from '@/store/ui-store';
import type { ScheduledMessage } from '@/types/scheduled-message';

const sendBridgeMessage = vi.fn();
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: (...a: any[]) => sendBridgeMessage(...a) }));

function row(over: Partial<ScheduledMessage>): ScheduledMessage {
  return {
    id: Math.random().toString(36).slice(2),
    recipientUrns: ['urn:li:fsd_profile:P'],
    recipientName: 'Ada Lovelace',
    body: 'Hey Ada!',
    status: 'draft',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

beforeEach(async () => {
  sendBridgeMessage.mockReset().mockResolvedValue({ success: true });
  await switchDatabase('MEMBER_OB');
  await db!.scheduledMessages.clear();
  await db!.conversations.clear();
  await db!.draftAttachments.clear();
  act(() => useUIStore.setState({ toast: null, activeSection: 'outbox', composeNewActive: false, selectedConversationId: null }));
});
afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_OB').catch(() => {});
});

const queue = () => screen.getByRole('listbox', { name: 'Queue' });
const pane = () => screen.getByRole('region', { name: 'Selected message' });
/** Wait for a name to be listed in the queue. */
const listed = async (name: string) => within(await screen.findByRole('listbox', { name: 'Queue' })).findByText(name);
const item = (name: string) => within(queue()).getByText(name).closest('[role="option"]') as HTMLElement;

it('shows an empty state when the outbox is empty', async () => {
  render(<OutboxView />);
  expect(await screen.findByText(/No drafts or scheduled sends yet/i)).toBeInTheDocument();
});

it('lists a draft under Drafts and sends it now from the reading pane', async () => {
  await db!.scheduledMessages.add(row({ id: 'd1', body: 'Hey Ada!' }));
  render(<OutboxView />);

  await listed('Ada Lovelace');
  expect(within(queue()).getByRole('group', { name: 'Drafts' })).toBeInTheDocument();

  fireEvent.click(within(pane()).getByRole('button', { name: /send now/i }));
  await waitFor(() =>
    expect(sendBridgeMessage).toHaveBeenCalledWith({
      type: 'CREATE_CONVERSATION',
      recipientUrns: ['urn:li:fsd_profile:P'],
      body: 'Hey Ada!',
    }),
  );
  await waitFor(async () => expect((await db!.scheduledMessages.get('d1'))!.status).toBe('sent'));
});

it('sends a scheduled reply into its thread via SEND_MESSAGE (not CREATE_CONVERSATION)', async () => {
  await db!.scheduledMessages.add(
    row({ id: 'r1', conversationId: 'urn:li:msg_conversation:THREAD', body: 'Following up!' }),
  );
  render(<OutboxView />);
  await listed('Ada Lovelace');

  fireEvent.click(within(pane()).getByRole('button', { name: /send now/i }));
  await waitFor(() =>
    expect(sendBridgeMessage).toHaveBeenCalledWith({
      type: 'SEND_MESSAGE',
      conversationId: 'urn:li:msg_conversation:THREAD',
      body: 'Following up!',
    }),
  );
  await waitFor(async () => expect((await db!.scheduledMessages.get('r1'))!.status).toBe('sent'));
});

it('Edit on a scheduled reply stays in the Outbox and leaves the thread alone', async () => {
  // This used to navigate to the real thread and stash the body in that
  // conversation's draft, which silently emptied the queue row.
  await db!.scheduledMessages.add(
    row({ id: 'r2', conversationId: 'urn:li:msg_conversation:T2', body: 'Reopen reply' }),
  );
  render(<OutboxView />);
  await listed('Ada Lovelace');

  fireEvent.click(within(pane()).getByRole('button', { name: /^Edit$/i }));

  expect(await db!.scheduledMessages.get('r2')).toBeTruthy();
  expect(useUIStore.getState().selectedConversationId).not.toBe('urn:li:msg_conversation:T2');
  expect(await db!.draftAttachments.get('urn:li:msg_conversation:T2')).toBeUndefined();
  expect(screen.getByLabelText(/Message body/i)).toBeTruthy();
});

it('resurfaces a past-due scheduled message as Ready to send (does not auto-send)', async () => {
  await db!.scheduledMessages.add(row({ id: 's1', status: 'scheduled', scheduledAt: Date.now() - 60_000 }));
  render(<OutboxView />);

  await listed('Ada Lovelace');
  expect(within(queue()).getByRole('group', { name: 'Ready to send' })).toBeInTheDocument();
  expect(within(pane()).getByText('Ready to send')).toBeInTheDocument();
  expect(sendBridgeMessage).not.toHaveBeenCalled();
  expect((await db!.scheduledMessages.get('s1'))!.status).toBe('scheduled');
});

it('deletes a draft, once the discard question is answered', async () => {
  await db!.scheduledMessages.add(row({ id: 'd2' }));
  render(<OutboxView />);
  await listed('Ada Lovelace');

  // Delete asks first by default — it sits beside Send and cannot be undone.
  fireEvent.click(within(pane()).getByRole('button', { name: /^Delete$/i }));
  expect(await db!.scheduledMessages.get('d2')).toBeTruthy();

  fireEvent.click(await within(pane()).findByRole('button', { name: /^Delete$/i }));
  await waitFor(async () => expect(await db!.scheduledMessages.get('d2')).toBeUndefined());
});

it('Edit keeps the draft in the Outbox instead of minting an inbox conversation', async () => {
  // It used to create a draft: 1 conversation in PRIMARY_INBOX and drop the
  // queue row, so the draft appeared to vanish and landed among real threads.
  await db!.scheduledMessages.add(row({ id: 'd3', body: 'Reopen me', recipientUrns: ['urn:li:fsd_profile:Z'], recipientName: 'Zack Allen' }));
  render(<OutboxView />);
  await listed('Zack Allen');

  fireEvent.click(within(pane()).getByRole('button', { name: /^Edit$/i }));

  expect(await db!.scheduledMessages.get('d3')).toBeTruthy();
  expect(await db!.conversations.get('draft-Z')).toBeUndefined();
  expect(await db!.draftAttachments.get('draft-Z')).toBeUndefined();

  // The body is editable where it sits.
  const field = screen.getByLabelText(/Message body/i) as HTMLTextAreaElement;
  expect(field.value).toBe('Reopen me');
});

it('explains why a long-overdue message did not send itself', async () => {
  // Auto-send is on and the time has passed, so without a word the silence
  // looks like a bug rather than a deliberate hold.
  useUIStore.setState({ autoSendScheduled: true });
  await db!.scheduledMessages.add(
    row({ id: 's9', status: 'scheduled', scheduledAt: Date.now() - 30 * 3600_000 }),
  );
  render(<OutboxView />);

  expect(await screen.findByText(/Too far past its time to send itself/i)).toBeTruthy();
});

it('says nothing of the sort about a message that is only a little late', async () => {
  useUIStore.setState({ autoSendScheduled: true });
  await db!.scheduledMessages.add(
    row({ id: 's10', status: 'scheduled', scheduledAt: Date.now() - 60_000 }),
  );
  render(<OutboxView />);

  await listed('Ada Lovelace');
  expect(screen.queryByText(/Too far past its time/i)).toBeNull();
});

describe('split view', () => {
  it('lists each message as one line, and shows only the selected one in full with buttons', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    await db!.scheduledMessages.bulkAdd([
      row({ id: 'a', recipientName: 'Ada Lovelace', body: long, updatedAt: 3 }),
      row({ id: 'b', recipientName: 'Grace Hopper', body: 'Short note', updatedAt: 2 }),
    ]);
    render(<OutboxView />);
    await listed('Grace Hopper');

    // The queue holds names and one-line previews, and no actions.
    expect(within(queue()).queryByRole('button', { name: /send now/i })).toBeNull();
    const preview = within(item('Ada Lovelace')).getByText(/line 0 line 1/);
    expect(preview.className).toMatch(/truncate/);

    // Exactly one message is open, with one set of actions.
    await waitFor(() => expect(within(pane()).getAllByRole('button', { name: /send now/i })).toHaveLength(1));
  });

  it('shows the selected message in full, never clamped', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    await db!.scheduledMessages.add(row({ id: 'long1', body: long }));
    render(<OutboxView />);
    await listed('Ada Lovelace');

    const body = await within(pane()).findByText(/line 29/);
    expect(body.className).not.toMatch(/line-clamp/);
    expect(within(pane()).queryByRole('button', { name: /Show more/i })).toBeNull();
  });

  it('selects the first message, and clicking a row opens it', async () => {
    await db!.scheduledMessages.bulkAdd([
      row({ id: 'r', recipientName: 'Ready Rita', status: 'scheduled', scheduledAt: Date.now() - 60_000, body: 'ready body' }),
      row({ id: 'd', recipientName: 'Draft Dan', body: 'draft body' }),
    ]);
    render(<OutboxView />);
    await listed('Draft Dan');

    // Ready to send comes first, so it is what opens.
    await waitFor(() => expect(item('Ready Rita').getAttribute('aria-selected')).toBe('true'));
    expect(within(pane()).getByText('ready body')).toBeInTheDocument();

    fireEvent.click(item('Draft Dan'));
    expect(item('Draft Dan').getAttribute('aria-selected')).toBe('true');
    expect(within(pane()).getByText('draft body')).toBeInTheDocument();
    expect(within(pane()).queryByText('ready body')).toBeNull();
  });

  it('j and k move through the queue, across groups', async () => {
    await db!.scheduledMessages.bulkAdd([
      row({ id: 'r', recipientName: 'Ready Rita', status: 'scheduled', scheduledAt: Date.now() - 60_000 }),
      row({ id: 'd', recipientName: 'Draft Dan' }),
      row({ id: 'f', recipientName: 'Failed Fay', status: 'failed', error: 'nope' }),
    ]);
    render(<OutboxView />);
    await listed('Failed Fay');
    await waitFor(() => expect(item('Ready Rita').getAttribute('aria-selected')).toBe('true'));

    fireEvent.keyDown(window, { key: 'j' });
    expect(item('Draft Dan').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(item('Failed Fay').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(window, { key: 'j' }); // stops at the end
    expect(item('Failed Fay').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(window, { key: 'k' });
    expect(item('Draft Dan').getAttribute('aria-selected')).toBe('true');
  });

  it('j and k do nothing while typing in the filter or an edit', async () => {
    await db!.scheduledMessages.bulkAdd([
      row({ id: 'a', recipientName: 'Ada Lovelace', updatedAt: 2 }),
      row({ id: 'b', recipientName: 'Grace Hopper', updatedAt: 1 }),
    ]);
    render(<OutboxView />);
    await listed('Grace Hopper');
    const first = screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')!;

    fireEvent.keyDown(screen.getByLabelText(/Filter the queue/i), { key: 'j' });
    expect(first.getAttribute('aria-selected')).toBe('true');
  });

  it('after sending, the next message opens rather than jumping back to the top', async () => {
    await db!.scheduledMessages.bulkAdd([
      row({ id: 'a', recipientName: 'Anna One', body: 'first', createdAt: 1, updatedAt: 1 }),
      row({ id: 'b', recipientName: 'Ben Two', body: 'second', createdAt: 2, updatedAt: 2 }),
      row({ id: 'c', recipientName: 'Cleo Three', body: 'third', createdAt: 3, updatedAt: 3 }),
    ]);
    render(<OutboxView />);
    await listed('Cleo Three');
    const names = () => screen.getAllByRole('option').map((o) => o.textContent);
    const order = names();

    // Open the middle one and send it.
    const middle = screen.getAllByRole('option')[1];
    fireEvent.click(middle);
    const middleName = order[1]!;
    fireEvent.click(within(pane()).getByRole('button', { name: /send now/i }));

    // It leaves the queue, and the one that was below it opens.
    await waitFor(() => expect(names().some((n) => n === middleName)).toBe(false));
    await waitFor(() => {
      const sel = screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true');
      expect(sel?.textContent).toBe(order[2]);
    });
  });

  it('says who drafted it', async () => {
    await db!.scheduledMessages.add(row({ id: 'm', source: 'mcp' }));
    render(<OutboxView />);
    await listed('Ada Lovelace');
    expect(within(pane()).getByText(/Drafted by Claude/)).toBeInTheDocument();
  });
});

describe('filtering', () => {
  it('filters across every group at once, not within one bucket', async () => {
    // What you remember is who it is to, not which status it sits under.
    await db!.scheduledMessages.bulkAdd([
      row({ id: 'f1', recipientName: 'Dana Whitfield', status: 'draft' }),
      row({ id: 'f2', recipientName: 'Owen Pratt', status: 'scheduled', scheduledAt: Date.now() + 9e6 }),
    ]);
    render(<OutboxView />);
    await listed('Dana Whitfield');

    fireEvent.change(screen.getByLabelText(/Filter the queue/i), { target: { value: 'pratt' } });

    expect(within(queue()).queryByText('Dana Whitfield')).toBeNull();
    expect(within(queue()).getByText('Owen Pratt')).toBeTruthy();
    // And what is open follows the filter.
    await waitFor(() => expect(item('Owen Pratt').getAttribute('aria-selected')).toBe('true'));
  });

  it('matches on the message text and the InMail subject too', async () => {
    await db!.scheduledMessages.add(
      row({ id: 'f3', recipientName: 'Someone', body: 'about revenue cycle', inMailSubject: 'Built for billing teams' }),
    );
    render(<OutboxView />);
    await listed('Someone');
    const box = screen.getByLabelText(/Filter the queue/i);

    fireEvent.change(box, { target: { value: 'revenue' } });
    expect(within(queue()).getByText('Someone')).toBeTruthy();

    fireEvent.change(box, { target: { value: 'billing teams' } });
    expect(within(queue()).getByText('Someone')).toBeTruthy();

    fireEvent.change(box, { target: { value: 'zzz nothing' } });
    expect(screen.getByText(/Nothing in the queue matches/i)).toBeTruthy();
  });

  it('hides the filter while there is nothing queued', async () => {
    render(<OutboxView />);
    await screen.findByText(/No drafts or scheduled sends yet/i);
    expect(screen.queryByLabelText(/Filter the queue/i)).toBeNull();
  });
});
