// @vitest-environment jsdom
// The Outbox MCP status bar: a real on/off toggle (persisted), a click-to-reveal
// connection log, and setup instructions (code + .mcpb download + advanced CLI).
import '../dom-setup';

const { startMcpBridge, stopMcpBridge } = vi.hoisted(() => ({ startMcpBridge: vi.fn(), stopMcpBridge: vi.fn() }));
vi.mock('@/lib/mcp/bridge-client', () => ({ startMcpBridge, stopMcpBridge }));

const { getOrCreatePairingCode, getMcpEnabled, setMcpEnabled } = vi.hoisted(() => ({
  getOrCreatePairingCode: vi.fn(async () => 'A1B2-C3D4'),
  getMcpEnabled: vi.fn(async () => true),
  setMcpEnabled: vi.fn(async () => {}),
}));
vi.mock('@/lib/mcp/pairing', () => ({ getOrCreatePairingCode, getMcpEnabled, setMcpEnabled }));

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { McpStatusBar } from '@/components/outbox/McpStatusBar';
import { useUIStore } from '@/store/ui-store';

beforeEach(() => {
  startMcpBridge.mockClear();
  stopMcpBridge.mockClear();
  setMcpEnabled.mockClear();
  getMcpEnabled.mockResolvedValue(true);
  act(() => useUIStore.setState({ mcpStatus: 'disconnected', mcpError: null, mcpActivity: [] }));
});

it('Set up opens the setup wizard at its MCP connector step, rather than a second copy here', () => {
  act(() => useUIStore.setState({ setupOpen: false, setupStartStep: null } as any));
  render(<McpStatusBar />);
  fireEvent.click(screen.getByRole('button', { name: /^Set up$/ }));
  expect(useUIStore.getState().setupOpen).toBe(true);
  expect(useUIStore.getState().setupStartStep).toBe('claude');
  // No guide is rendered in this card any more.
  expect(screen.queryByRole('list', { name: 'MCP connector steps' })).not.toBeInTheDocument();
});

it('reads as on while connected, even if its own copy of the setting is stale', async () => {
  // The wizard can switch the bridge back on behind this card.
  getMcpEnabled.mockResolvedValue(false);
  act(() => useUIStore.setState({ mcpStatus: 'connected' } as any));
  render(<McpStatusBar />);
  expect(await screen.findByRole('button', { name: /^Disconnect$/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Connect$/ })).not.toBeInTheDocument();
});

it('reveals CLI-client instructions under the Advanced toggle', () => {
  render(<McpStatusBar />);
  expect(screen.queryByText(/copy config/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Advanced · CLI/i }));
  expect(screen.getByText(/copy config/i)).toBeInTheDocument();
  expect(screen.getByText(/npx -y inflow-mcp/)).toBeInTheDocument();
});

it('Disconnect turns the bridge off and persists it', async () => {
  render(<McpStatusBar />);
  // Enabled by default → the toggle reads "Disconnect".
  fireEvent.click(await screen.findByRole('button', { name: /^Disconnect$/ }));
  await waitFor(() => expect(setMcpEnabled).toHaveBeenCalledWith(false));
  expect(stopMcpBridge).toHaveBeenCalled();
});

it('Connect turns the bridge on and persists it', async () => {
  getMcpEnabled.mockResolvedValue(false); // came back from a prior Disconnect
  render(<McpStatusBar />);
  fireEvent.click(await screen.findByRole('button', { name: /^Connect$/ }));
  await waitFor(() => expect(setMcpEnabled).toHaveBeenCalledWith(true));
  expect(startMcpBridge).toHaveBeenCalledWith('A1B2-C3D4');
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

it('makes Setup look like the control it is, not a label', () => {
  render(<McpStatusBar />);
  const setup = screen.getByRole('button', { name: /^Set up$/ });

  // Its neighbours carry weight at rest (Connect is filled and ringed,
  // Disconnect is ringed). Set up used to gain a border only on hover, so at
  // rest it read as plain text; it now has its surface and outline at rest too.
  expect(setup.className).toMatch(/(^|\s)ring-edge(\s|$)/);
  expect(setup.className).toMatch(/(^|\s)bg-surface(\s|$)/);
  expect(setup.className).not.toMatch(/ring-transparent/);
  expect(setup.className).toMatch(/hover:bg-surface-hover/);
});
