// @vitest-environment jsdom
// The Outbox MCP status bar: connection state, a click-to-reveal log, and setup
// instructions where inflow shows the pairing code + a one-click .mcpb download.
import '../dom-setup';

const { stopMcpBridge } = vi.hoisted(() => ({ stopMcpBridge: vi.fn() }));
vi.mock('@/lib/mcp/bridge-client', () => ({ startMcpBridge: vi.fn(), stopMcpBridge }));

const { getOrCreatePairingCode } = vi.hoisted(() => ({ getOrCreatePairingCode: vi.fn(async () => 'A1B2-C3D4') }));
vi.mock('@/lib/mcp/pairing', () => ({ getOrCreatePairingCode }));

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { McpStatusBar } from '@/components/outbox/McpStatusBar';
import { useUIStore } from '@/store/ui-store';

beforeEach(() => {
  stopMcpBridge.mockClear();
  act(() => useUIStore.setState({ mcpStatus: 'disconnected', mcpError: null, mcpActivity: [] }));
});

it('shows the disconnected state and reveals setup with the pairing code + download', async () => {
  render(<McpStatusBar />);
  expect(screen.getByText(/Claude not connected/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Connect Claude/i }));
  expect(screen.getByText(/Claude Desktop extension/i)).toBeInTheDocument();
  // inflow owns and displays the pairing code.
  expect(await screen.findByText('A1B2-C3D4')).toBeInTheDocument();
  // One-click download of the bundled companion.
  const dl = screen.getByRole('link', { name: /Download inflow\.mcpb/i });
  expect(dl).toHaveAttribute('download', 'inflow.mcpb');
  // No manual paste-a-code step anymore.
  expect(screen.queryByPlaceholderText(/Pairing code/i)).not.toBeInTheDocument();
});

it('reveals CLI-client instructions under the Advanced toggle', () => {
  render(<McpStatusBar />);
  fireEvent.click(screen.getByRole('button', { name: /Connect Claude/i }));
  // Hidden until expanded.
  expect(screen.queryByText(/copy config/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Advanced · CLI/i }));
  expect(screen.getByText(/copy config/i)).toBeInTheDocument();
  expect(screen.getByText(/npx -y inflow-mcp/)).toBeInTheDocument();
});

it('shows connected state and disconnects (keeps the code)', () => {
  act(() => useUIStore.setState({ mcpStatus: 'connected' }));
  render(<McpStatusBar />);
  expect(screen.getByText(/Claude connected/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Disconnect/i }));
  expect(stopMcpBridge).toHaveBeenCalled();
});

it('reveals the connection log when the status is clicked', () => {
  act(() => useUIStore.setState({
    mcpStatus: 'connected',
    mcpActivity: [{ id: '1', at: Date.now(), text: 'Claude searched your connections for “investors”' }],
  }));
  render(<McpStatusBar />);
  expect(screen.queryByText(/searched your connections/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Claude connected/i }));
  expect(screen.getByText(/searched your connections/i)).toBeInTheDocument();
});
