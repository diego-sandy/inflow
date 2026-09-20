// @vitest-environment jsdom
// The Insights overview shows network composition (the "40% investors" stat),
// firm clustering, and an empty state.
import '../dom-setup';

let mockConnections: any[] = [];
vi.mock('@/hooks/useConnections', () => ({
  useConnections: () => ({ connections: mockConnections, isLoading: false }),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { InsightsView } from '@/components/insights/InsightsView';
import { useUIStore } from '@/store/ui-store';

function c(over: any = {}) {
  return {
    profileUrn: Math.random().toString(),
    connectionUrn: '',
    connectedAt: 0,
    publicId: '',
    firstName: '',
    lastName: '',
    fullName: 'X',
    headline: '',
    pictureUrl: '',
    syncedAt: 0,
    ...over,
  };
}

beforeEach(() => {
  mockConnections = [];
  try { localStorage.clear(); } catch {}
  useUIStore.setState({
    activeSection: 'insights',
    connectionsFilter: { roles: [], interests: [] },
    connectionsSearch: '',
  });
});

it('shows an empty state with no connections', () => {
  render(<InsightsView />);
  expect(screen.getByText(/No connections yet/i)).toBeInTheDocument();
});

it('leads with the dominant-role composition stat', () => {
  mockConnections = [
    c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Partner at Acme Ventures' }),
    c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Principal at Acme Ventures' }),
    c({ roleCategory: 'Founder', categorizedAt: 1, headline: 'CEO at Solo Co' }),
    c({ roleCategory: 'Engineering', categorizedAt: 1, headline: 'Eng at Solo Co' }),
  ];
  render(<InsightsView />);
  expect(screen.getByText(/Your network is 50% investors/i)).toBeInTheDocument();
  // Firm clustering surfaces the 2-person firm.
  expect(screen.getByText(/Clustered around Acme Ventures/i)).toBeInTheDocument();
});

it('organizes insights into tabs, with Charts as the default (pie)', () => {
  mockConnections = [c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Partner at Acme' })];
  const { container } = render(<InsightsView />);
  // Tabs exist.
  expect(screen.getByRole('tab', { name: 'Charts' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Follow up' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /AI suggestions/ })).toBeInTheDocument();
  // Charts tab is active by default → composition chart shown, defaulting to pie.
  expect(screen.getByRole('tab', { name: 'Charts' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Composition by role')).toBeInTheDocument();
  expect(container.querySelector('[data-chart="pie"]')).toBeTruthy();
});

it('drills into Connections filtered by role when a composition bar is clicked', () => {
  mockConnections = [
    c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Partner at Acme' }),
    c({ roleCategory: 'Founder', categorizedAt: 1, headline: 'CEO at Solo' }),
  ];
  render(<InsightsView />);
  fireEvent.click(screen.getByRole('button', { name: /Show Investor/i }));
  const s = useUIStore.getState();
  expect(s.activeSection).toBe('connections');
  expect(s.connectionsFilter).toEqual({ roles: ['Investor'], interests: [] });
});

it('drills into Connections filtered by interest tag when a tag bar is clicked', () => {
  mockConnections = [
    c({ roleCategory: 'Investor', categorizedAt: 1, interestTags: ['Investors'] }),
  ];
  render(<InsightsView />);
  fireEvent.click(screen.getByRole('button', { name: /Show ★ Investors/i }));
  const s = useUIStore.getState();
  expect(s.activeSection).toBe('connections');
  expect(s.connectionsFilter).toEqual({ roles: [], interests: ['Investors'] });
});

it('drills into Connections searched by firm when a firm bar is clicked', () => {
  mockConnections = [
    c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Partner at Acme Ventures' }),
    c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Principal at Acme Ventures' }),
  ];
  render(<InsightsView />);
  fireEvent.click(screen.getByRole('button', { name: /Show Acme Ventures/i }));
  const s = useUIStore.getState();
  expect(s.activeSection).toBe('connections');
  expect(s.connectionsSearch).toBe('Acme Ventures');
});

it('switches to the Follow up tab, hiding the charts', () => {
  mockConnections = [c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Partner at Acme' })];
  render(<InsightsView />);
  expect(screen.getByText('Composition by role')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'Follow up' }));

  expect(screen.getByRole('tab', { name: 'Follow up' })).toHaveAttribute('aria-selected', 'true');
  // Charts are no longer rendered on the Follow up tab.
  expect(screen.queryByText('Composition by role')).not.toBeInTheDocument();
});

it('nudges to categorize when some are uncategorized', () => {
  mockConnections = [
    c({ roleCategory: 'Investor', categorizedAt: 1 }),
    c({}), // uncategorized
  ];
  render(<InsightsView />);
  const nudge = screen.getByText(/1 of 2 not categorized yet/i);
  fireEvent.click(nudge);
  expect(useUIStore.getState().activeSection).toBe('connections');
});
