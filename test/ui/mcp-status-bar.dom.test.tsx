// @vitest-environment jsdom
// The Outbox MCP status bar: shows connection state, setup instructions with the
// npx command + pairing input, wires Pair & connect, and lists activity.
import '../dom-setup';

const { startMcpBridge, stopMcpBridge } = vi.hoisted(() => ({ startMcpBridge: vi.fn(), stopMcpBridge: vi.fn() }));
vi.mock('@/lib/mcp/bridge-client', () => ({ startMcpBridge, stopMcpBridge }));

const { setPairingToken, clearPairingToken } = vi.hoisted(() => ({
  setPairingToken: vi.fn(async () => {}),
  clearPairingToken: vi.fn(async () => {}),
}));
vi.mock('@/lib/mcp/pairing', () => ({ setPairingToken, clearPairingToken }));

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { McpStatusBar } from '@/components/outbox/McpStatusBar';
import { useUIStore } from '@/store/ui-store';

beforeEach(() => {
  startMcpBridge.mockClear();
  stopMcpBridge.mockClear();
  setPairingToken.mockClear();
  clearPairingToken.mockClear();
  act(() => useUIStore.setState({ mcpStatus: 'disconnected', mcpError: null, mcpActivity: [] }));
});

it('shows the disconnected state and reveals setup instructions', () => {
  render(<McpStatusBar />);
  expect(screen.getByText(/Claude not connected/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Connect Claude/i }));
  expect(screen.getByText(/Claude Desktop extension/i)).toBeInTheDocument();
  expect(screen.getByText(/inflow\.mcpb/)).toBeInTheDocument();
  expect(screen.getByText(/copy config/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/Pairing code/i)).toBeInTheDocument();
});

it('pairs and connects with the entered code', async () => {
  render(<McpStatusBar />);
  fireEvent.click(screen.getByRole('button', { name: /Connect Claude/i }));
  fireEvent.change(screen.getByPlaceholderText(/Pairing code/i), { target: { value: 'ABCD-1234' } });
  fireEvent.click(screen.getByRole('button', { name: /Pair & connect/i }));

  await waitFor(() => expect(setPairingToken).toHaveBeenCalledWith('ABCD-1234'));
  expect(startMcpBridge).toHaveBeenCalledWith('ABCD-1234');
});

it('shows connected state and disconnects', async () => {
  act(() => useUIStore.setState({ mcpStatus: 'connected' }));
  render(<McpStatusBar />);
  expect(screen.getByText(/Claude connected/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Disconnect/i }));
  expect(stopMcpBridge).toHaveBeenCalled();
  await waitFor(() => expect(clearPairingToken).toHaveBeenCalled());
});

it('reveals the connection log when the status is clicked', () => {
  act(() => useUIStore.setState({
    mcpStatus: 'connected',
    mcpActivity: [{ id: '1', at: Date.now(), text: 'Claude searched your connections for “investors”' }],
  }));
  render(<McpStatusBar />);
  // Hidden until the status is clicked (like the inbox "Up to date" popover).
  expect(screen.queryByText(/searched your connections/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Claude connected/i }));
  expect(screen.getByText(/searched your connections/i)).toBeInTheDocument();
});
