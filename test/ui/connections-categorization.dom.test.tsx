// @vitest-environment jsdom
// The connections list surfaces AI categories: role/interest filter chips,
// badges on rows, and filtering the visible list.
import '../dom-setup';

const { sendBridgeMessage } = vi.hoisted(() => ({ sendBridgeMessage: vi.fn() }));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage }));

// Keep the auto-categorizer inert in these tests (no DB / AI).
vi.mock('@/hooks/useAutoCategorize', () => ({
  useAutoCategorize: () => ({ categorizing: false, remaining: 0 }),
}));
vi.mock('@/hooks/useAISession', () => ({ useAISession: () => ({ available: true, predict: vi.fn() }) }));

let mockConnections: any[] = [];
vi.mock('@/hooks/useConnections', () => ({
  useConnections: () => ({ connections: mockConnections, isLoading: false }),
}));

import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { ConnectionsList } from '@/components/connections/ConnectionsList';
import { useUIStore } from '@/store/ui-store';

function makeConn(over: Partial<any> = {}) {
  return {
    profileUrn: 'urn:li:fsd_profile:P1',
    connectionUrn: 'urn:li:fsd_connection:C1',
    connectedAt: Date.now(),
    publicId: 'p1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    fullName: 'Ada Lovelace',
    headline: 'Partner at Foo Ventures',
    pictureUrl: '',
    syncedAt: 0,
    ...over,
  };
}

beforeEach(() => {
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true, data: { count: 0 } });
  mockConnections = [];
  act(() => useUIStore.setState({ selectedConnectionUrn: null, connectionsFilter: { roles: [], interests: [] }, connectionsSearch: '' }));
});

it('lists role and interest options in the Filter menu', () => {
  mockConnections = [
    makeConn({ profileUrn: 'a', fullName: 'Ada Lovelace', roleCategory: 'Investor', interestTags: ['Investors'] }),
    makeConn({ profileUrn: 'b', fullName: 'Alan Turing', roleCategory: 'Engineering', interestTags: [] }),
  ];
  render(<ConnectionsList />);

  fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  const menu = within(screen.getByRole('menu', { name: /Filter connections/i }));
  expect(menu.getByRole('menuitemcheckbox', { name: /★ Investors/ })).toBeInTheDocument();
  expect(menu.getByRole('menuitemcheckbox', { name: /^Investor\s?\d/ })).toBeInTheDocument();
  expect(menu.getByRole('menuitemcheckbox', { name: /^Engineering/ })).toBeInTheDocument();
  expect(menu.getByRole('menuitem', { name: /Manage tags/i })).toBeInTheDocument();
});

it('filters the visible list when a menu option is toggled, shown as a pill', () => {
  mockConnections = [
    makeConn({ profileUrn: 'a', fullName: 'Ada Lovelace', roleCategory: 'Investor', interestTags: ['Investors'] }),
    makeConn({ profileUrn: 'b', fullName: 'Alan Turing', roleCategory: 'Engineering', interestTags: [] }),
  ];
  render(<ConnectionsList />);

  expect(screen.getByText('Alan Turing')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /★ Investors/ }));

  // The list narrows to the matching person…
  expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  expect(screen.queryByText('Alan Turing')).not.toBeInTheDocument();
  // …and an active-filter pill appears with a remove control.
  const bar = within(screen.getByTestId('connection-filters'));
  expect(bar.getByRole('button', { name: /Remove ★ Investors filter/i })).toBeInTheDocument();
});

it('combines role and interest filters (AND across facets) and clears all', () => {
  mockConnections = [
    makeConn({ profileUrn: 'a', fullName: 'Ada Lovelace', roleCategory: 'Investor', interestTags: ['Investors'] }),
    makeConn({ profileUrn: 'b', fullName: 'Alan Turing', roleCategory: 'Investor', interestTags: [] }),
    makeConn({ profileUrn: 'c', fullName: 'Grace Hopper', roleCategory: 'Engineering', interestTags: ['Investors'] }),
  ];
  render(<ConnectionsList />);

  fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Investor\s?\d/ })); // role: Investor
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /★ Investors/ })); // tag: Investors

  // Only the person who is BOTH an Investor role AND tagged Investors remains.
  expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  expect(screen.queryByText('Alan Turing')).not.toBeInTheDocument();
  expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument();

  // Clear all removes every pill and restores the full list.
  fireEvent.click(screen.getByRole('button', { name: /Clear all/i }));
  expect(screen.getByText('Alan Turing')).toBeInTheDocument();
  expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
  expect(screen.queryByTestId('connection-filters')).not.toBeInTheDocument();
});

it('opens the interests editor from Manage tags', () => {
  mockConnections = [
    makeConn({ profileUrn: 'a', fullName: 'Ada Lovelace', roleCategory: 'Investor', interestTags: ['Investors'] }),
  ];
  render(<ConnectionsList />);

  fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Manage tags/i }));
  expect(screen.getByPlaceholderText(/Add an interest/i)).toBeInTheDocument();
});

it('shows a role badge on categorized rows but hides Other', () => {
  mockConnections = [
    makeConn({ profileUrn: 'a', fullName: 'Ada Lovelace', roleCategory: 'Investor' }),
    makeConn({ profileUrn: 'b', fullName: 'Alan Turing', roleCategory: 'Other' }),
  ];
  render(<ConnectionsList />);

  const adaRow = screen.getByText('Ada Lovelace').closest('button')!;
  expect(within(adaRow).getByText('Investor')).toBeInTheDocument();

  const alanRow = screen.getByText('Alan Turing').closest('button')!;
  expect(within(alanRow).queryByText('Other')).not.toBeInTheDocument();
});

it('does not render the Filter control when nothing is categorized yet', () => {
  mockConnections = [makeConn({ profileUrn: 'a', fullName: 'Ada Lovelace' })];
  render(<ConnectionsList />);
  expect(screen.queryByRole('button', { name: /^Filter/ })).not.toBeInTheDocument();
  expect(screen.queryByTestId('connection-filters')).not.toBeInTheDocument();
});
