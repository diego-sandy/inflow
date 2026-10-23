// @vitest-environment jsdom
// Settings › Setup: the setup wizard's home once the first run is over. Shows
// where each step stands, from the real state, and opens the wizard at any
// step or from the start.
import '../dom-setup';
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import { SetupSettings } from '@/components/settings/SetupSettings';
import { useUIStore } from '@/store/ui-store';

beforeEach(() => {
  act(() =>
    useUIStore.setState({ setupOpen: false, setupFromStart: false, setupStartStep: null, mcpStatus: 'disconnected' } as any),
  );
  (chrome.action.getUserSettings as any).mockResolvedValue({ isOnToolbar: false });
});

const row = (label: string) =>
  within(screen.getByRole('list', { name: 'Setup steps' }))
    .getAllByRole('listitem')
    .find((li) => li.textContent?.includes(label))!;

it('lists every step with where it stands', async () => {
  render(<SetupSettings />);
  await waitFor(() => expect(within(row('Pin inflow to the toolbar')).getByText('Not pinned')).toBeInTheDocument());
  expect(within(row('Sign in to LinkedIn')).getByText('Signed in')).toBeInTheDocument();
  expect(within(row('Add an AI key')).getByText('No key yet')).toBeInTheDocument();
  expect(within(row('MCP connector')).getByText('Optional · not connected')).toBeInTheDocument();
  expect(screen.getByText(/Setup isn't finished yet/)).toBeInTheDocument();
});

it('reflects the real state: a key, the pin, the connector', async () => {
  (chrome.action.getUserSettings as any).mockResolvedValue({ isOnToolbar: true });
  await chrome.storage.local.set({ geminiApiKey: 'AIzaSAVED', setupCompletedAt: new Date(2026, 9, 20).getTime() });
  act(() => useUIStore.setState({ mcpStatus: 'connected' } as any));
  render(<SetupSettings />);
  await waitFor(() => expect(within(row('Add an AI key')).getByText('Added')).toBeInTheDocument());
  expect(within(row('Pin inflow to the toolbar')).getByText('Pinned')).toBeInTheDocument();
  expect(within(row('MCP connector')).getByText('Connected to Claude Desktop')).toBeInTheDocument();
  expect(await screen.findByText(/You finished setup on October 20, 2026/)).toBeInTheDocument();
});

it('opens the wizard at the step chosen', () => {
  render(<SetupSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Open MCP connector in setup' }));
  expect(useUIStore.getState().setupOpen).toBe(true);
  expect(useUIStore.getState().setupStartStep).toBe('claude');
});

it('runs setup from the start', () => {
  render(<SetupSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Run setup from the start' }));
  expect(useUIStore.getState().setupOpen).toBe(true);
  expect(useUIStore.getState().setupFromStart).toBe(true);
});

it('does not call a key added while the provider is rejecting it', async () => {
  await chrome.storage.local.set({ geminiApiKey: 'AIzaSAVED' });
  act(() => useUIStore.getState().setAIKeyIssue('anthropic', { via: 'connector', detail: 'invalid x-api-key', at: Date.now() }));
  try {
    render(<SetupSettings />);
    expect(await within(row('Add an AI key')).findByText('Claude rejected a key · see Settings › AI')).toBeInTheDocument();
  } finally {
    act(() => useUIStore.getState().setAIKeyIssue('anthropic', null));
  }
});
