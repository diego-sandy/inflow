// @vitest-environment jsdom
// The Invitations section: a two-pane inbox that refreshes on mount, shows the
// selected request's detail, and accepts/ignores optimistically via the bridge.
import '../dom-setup';
import Dexie from 'dexie';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { switchDatabase, db } from '@/db/database';
import { InvitationsView } from '@/components/network/InvitationsView';
import { useUIStore } from '@/store/ui-store';
import { resetSentInvitationsCache } from '@/hooks/useSentInvitations';
import type { Invitation } from '@/types/network';

const sendBridgeMessage = vi.fn();
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: (...a: any[]) => sendBridgeMessage(...a) }));

function inv(over: Partial<Invitation>): Invitation {
  return {
    id: Math.random().toString(36).slice(2),
    sharedSecret: 'S',
    fromUrn: 'urn:li:fsd_profile:P',
    name: 'Ada Lovelace',
    headline: 'Mathematician',
    pictureUrl: '',
    publicId: 'ada',
    message: '',
    sentAt: Date.now(),
    status: 'pending',
    mutualCount: 0,
    mutualNames: [],
    mutualPictures: [],
    ...over,
  };
}

beforeEach(async () => {
  sendBridgeMessage.mockReset().mockResolvedValue({ success: true, data: { count: 0 } });
  await switchDatabase('MEMBER_INV');
  await db!.invitations.clear();
  act(() => useUIStore.setState({ toast: null }));
});
afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_INV').catch(() => {});
});

it('refreshes on mount and shows an empty state', async () => {
  render(<InvitationsView />);
  await waitFor(() => expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'FETCH_INVITATIONS' }));
  expect((await screen.findAllByText(/No pending invitations/i)).length).toBeGreaterThan(0);
});

it('auto-selects the first invitation and shows its detail with the mutual line', async () => {
  await db!.invitations.add(inv({ id: 'i1', name: 'Ada Lovelace', message: 'Hi Diego', mutualCount: 3, mutualNames: ['Grace Hopper'] }));
  render(<InvitationsView />);
  // The note pane renders once the first row is auto-selected.
  expect(await screen.findByText('Hi Diego')).toBeInTheDocument();
  // The mutual line renders on the profile row itself.
  expect(screen.getByText(/Grace Hopper and 2 other shared connections/i)).toBeInTheDocument();
  // The note pane is headed by the sender.
  expect(screen.getByText(/Note from Ada Lovelace/i)).toBeInTheDocument();
});

it('accepts the selected invitation (optimistic remove + bridge call)', async () => {
  await db!.invitations.add(inv({ id: 'i2', name: 'Alan Turing', sharedSecret: 'XYZ' }));
  render(<InvitationsView />);
  // Wait for the detail pane (where the actions live) to mount for the selection.
  fireEvent.click(await screen.findByRole('button', { name: /^Accept$/i }));
  await waitFor(async () => expect(await db!.invitations.get('i2')).toBeUndefined());
  expect(sendBridgeMessage).toHaveBeenCalledWith({
    type: 'RESPOND_INVITATION',
    invitationId: 'i2',
    sharedSecret: 'XYZ',
    action: 'accept',
  });
});

it('ignores the selected invitation', async () => {
  await db!.invitations.add(inv({ id: 'i3', name: 'Grace Hopper' }));
  render(<InvitationsView />);
  fireEvent.click(await screen.findByRole('button', { name: /^Ignore$/i }));
  await waitFor(() =>
    expect(sendBridgeMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'RESPOND_INVITATION', action: 'ignore' })),
  );
});

describe('Sent', () => {
  const NOW = Date.now();
  const sentRows = [
    { id: 's1', toUrn: 'urn:li:fsd_profile:DANA', name: 'Dana Whitfield', headline: 'Billing lead', pictureUrl: '', publicId: 'dana-w', message: 'Hi Dana, great meeting you.', sentAt: NOW - 2 * 86400_000 },
    { id: 's2', toUrn: 'urn:li:fsd_profile:OWEN', name: 'Owen Pratt', headline: 'Founder', pictureUrl: '', publicId: 'owen-p', message: '', sentAt: NOW - 5 * 86400_000 },
  ];

  beforeEach(() => {
    resetSentInvitationsCache();
    sendBridgeMessage.mockImplementation(async (msg: any) =>
      msg.type === 'FETCH_SENT_INVITATIONS'
        ? { success: true, data: { invitations: sentRows, complete: true } }
        : { success: true, data: { count: 0 } },
    );
  });
  const sentCalls = () => sendBridgeMessage.mock.calls.filter((c) => c[0].type === 'FETCH_SENT_INVITATIONS').length;

  it('loads only when opened, and lists who you invited with when, and no Accept or Ignore', async () => {
    render(<InvitationsView />);
    await screen.findByRole('tab', { name: /Received/ });
    expect(sentCalls()).toBe(0);

    fireEvent.click(screen.getByRole('tab', { name: /Sent/ }));
    expect(await screen.findByText('Dana Whitfield')).toBeInTheDocument();
    expect(screen.getByText('Owen Pratt')).toBeInTheDocument();
    expect(screen.getByText('Sent 2 days ago')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ignore' })).toBeNull();
    expect(screen.getByRole('tab', { name: /Sent/ })).toHaveTextContent('2');
    expect(sentCalls()).toBe(1);
  });

  it('shows your note on the right, and says when there was none', async () => {
    render(<InvitationsView />);
    fireEvent.click(await screen.findByRole('tab', { name: /Sent/ }));
    expect(await screen.findByText('Your note to Dana Whitfield')).toBeInTheDocument();
    expect(screen.getByText('Hi Dana, great meeting you.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Owen Pratt'));
    expect(screen.getByText('You sent this request without a note.')).toBeInTheDocument();
  });

  it('switching back and forth reuses the list; refresh fetches it again', async () => {
    render(<InvitationsView />);
    fireEvent.click(await screen.findByRole('tab', { name: /Sent/ }));
    await screen.findByText('Dana Whitfield');
    fireEvent.click(screen.getByRole('tab', { name: /Received/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Sent/ }));
    await screen.findByText('Dana Whitfield');
    expect(sentCalls()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh sent invitations' }));
    await waitFor(() => expect(sentCalls()).toBe(2));
  });

  it('says so when LinkedIn stopped answering part-way', async () => {
    sendBridgeMessage.mockImplementation(async (msg: any) =>
      msg.type === 'FETCH_SENT_INVITATIONS'
        ? { success: true, data: { invitations: sentRows, complete: false } }
        : { success: true, data: { count: 0 } },
    );
    render(<InvitationsView />);
    fireEvent.click(await screen.findByRole('tab', { name: /Sent/ }));
    expect(await screen.findByText(/may be missing some/)).toBeInTheDocument();
  });

  it('shows an error rather than an empty list when the fetch fails', async () => {
    sendBridgeMessage.mockImplementation(async (msg: any) =>
      msg.type === 'FETCH_SENT_INVITATIONS'
        ? { success: false, error: 'fetchSentInvitations failed: 429' }
        : { success: true, data: { count: 0 } },
    );
    render(<InvitationsView />);
    fireEvent.click(await screen.findByRole('tab', { name: /Sent/ }));
    expect(await screen.findByText(/fetchSentInvitations failed: 429/)).toBeInTheDocument();
    expect(screen.queryByText('No pending sent invitations.')).toBeNull();
  });
});
