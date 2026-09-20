// @vitest-environment jsdom
// The Invitations section lists pending requests, refreshes on mount, and
// accepts/ignores optimistically via the bridge.
import '../dom-setup';
import Dexie from 'dexie';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { switchDatabase, db } from '@/db/database';
import { InvitationsView } from '@/components/network/InvitationsView';
import { useUIStore } from '@/store/ui-store';
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
  expect(await screen.findByText(/No pending invitations/i)).toBeInTheDocument();
});

it('lists an invitation with its mutual line', async () => {
  await db!.invitations.add(inv({ id: 'i1', name: 'Ada Lovelace', mutualCount: 3, mutualNames: ['Grace Hopper'] }));
  render(<InvitationsView />);
  expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  expect(screen.getByText(/Grace Hopper and 2 other shared connections/i)).toBeInTheDocument();
});

it('accepts an invitation (optimistic remove + bridge call)', async () => {
  await db!.invitations.add(inv({ id: 'i2', name: 'Alan Turing', sharedSecret: 'XYZ' }));
  render(<InvitationsView />);
  await screen.findByText('Alan Turing');

  fireEvent.click(screen.getByRole('button', { name: /^Accept$/i }));
  await waitFor(async () => expect(await db!.invitations.get('i2')).toBeUndefined());
  expect(sendBridgeMessage).toHaveBeenCalledWith({
    type: 'RESPOND_INVITATION',
    invitationId: 'i2',
    sharedSecret: 'XYZ',
    action: 'accept',
  });
});

it('ignores an invitation', async () => {
  await db!.invitations.add(inv({ id: 'i3', name: 'Grace Hopper' }));
  render(<InvitationsView />);
  await screen.findByText('Grace Hopper');
  fireEvent.click(screen.getByRole('button', { name: /^Ignore$/i }));
  await waitFor(() =>
    expect(sendBridgeMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'RESPOND_INVITATION', action: 'ignore' })),
  );
});
