// @vitest-environment jsdom
// The wizard's MCP connector step: installing inflow.mcpb in Claude Desktop as
// one checklist on one screen. Each row has its action inline; the open row
// shows its animation and a Done button; "Enabled" ticks itself when the
// connector really connects.
import '../dom-setup';

const startMcpBridge = vi.fn();
vi.mock('@/lib/mcp/bridge-client', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  startMcpBridge: (...a: any[]) => startMcpBridge(...a),
}));

import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { SetupWizard } from '@/components/setup/SetupWizard';
import { useUIStore } from '@/store/ui-store';
import { markSetupPending, setSetupStep } from '@/lib/setup-state';
import { getMcpEnabled, getOrCreatePairingCode, setMcpEnabled } from '@/lib/mcp/pairing';
import { CONNECT_HELP_AFTER_MS } from '@/components/setup/ConnectorGuide';
import { OLD_COMPANION_MESSAGE } from '@/lib/mcp/bridge-protocol';

beforeEach(() => {
  startMcpBridge.mockClear();
  act(() =>
    useUIStore.setState({ setupOpen: false, setupFromStart: false, setupStartStep: null, mcpStatus: 'disconnected', mcpError: null } as any),
  );
});

async function openStep() {
  await markSetupPending();
  await setSetupStep('claude');
  render(<SetupWizard />);
  await screen.findByRole('heading', { name: 'Set up the MCP connector' });
}

const list = () => screen.getByRole('list', { name: 'MCP connector steps' });
const rows = () => within(list()).getAllByRole('listitem');
const rowTitled = (title: string) => rows().find((r) => r.textContent?.includes(title))!;
const isOpen = (title: string) => rowTitled(title).getAttribute('aria-current') === 'step';
const isTicked = (title: string) => rowTitled(title).querySelector('.animate-setup-check') !== null;
const header = (title: string) => within(rowTitled(title)).getAllByRole('button')[0];

it('shows every instruction on one screen, in order', async () => {
  await openStep();
  expect(rows().map((r) => within(r).getAllByRole('button')[0].textContent)).toEqual([
    '1Download inflow.mcpb',
    '2Open it, and click Install twice',
    '3Paste your pairing code',
    '4Check it says Enabled',
    '5Set Tool permissions to Always allow',
  ]);
  // No separate screens or tabs: the first row is simply open.
  expect(isOpen('Download inflow.mcpb')).toBe(true);
});

it('keeps each action on its row: download, the code with Copy, the live status', async () => {
  await openStep();
  const download = within(rowTitled('Download inflow.mcpb')).getByRole('link', { name: 'Download' });
  expect(download).toHaveAttribute('download', 'inflow.mcpb');
  const code = await getOrCreatePairingCode();
  await waitFor(() => expect(within(rowTitled('Paste your pairing code')).getByText(code)).toBeInTheDocument());
  expect(within(rowTitled('Check it says Enabled')).getByText('Waiting…')).toBeInTheDocument();
});

it('downloading ticks the row and opens the next', async () => {
  await openStep();
  fireEvent.click(within(rowTitled('Download inflow.mcpb')).getByRole('link', { name: 'Download' }));
  expect(isTicked('Download inflow.mcpb')).toBe(true);
  expect(isOpen('Open it, and click Install twice')).toBe(true);
  expect(rowTitled('Open it, and click Install twice').textContent).toMatch(/click Install, then Install again to confirm/);
});

it('Done ticks a row and opens the next one still to do', async () => {
  await openStep();
  fireEvent.click(within(rowTitled('Download inflow.mcpb')).getByRole('link', { name: 'Download' }));
  fireEvent.click(within(rowTitled('Open it, and click Install twice')).getByRole('button', { name: 'Done' }));
  expect(isTicked('Open it, and click Install twice')).toBe(true);
  expect(isOpen('Paste your pairing code')).toBe(true);
});

it('any row can be opened again by clicking it', async () => {
  await openStep();
  fireEvent.click(header('Set Tool permissions to Always allow'));
  expect(isOpen('Set Tool permissions to Always allow')).toBe(true);
  expect(isOpen('Download inflow.mcpb')).toBe(false);
});

it('copies the pairing code', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  await openStep();
  const code = await getOrCreatePairingCode();
  const row = rowTitled('Paste your pairing code');
  await waitFor(() => expect(within(row).getByRole('button', { name: 'Copy' })).toBeEnabled());
  fireEvent.click(within(row).getByRole('button', { name: 'Copy' }));
  expect(writeText).toHaveBeenCalledWith(code);
});

it('ticks Enabled on its own when the connector connects, and moves to permissions', async () => {
  await openStep();
  fireEvent.click(header('Check it says Enabled'));
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

  act(() => useUIStore.setState({ mcpStatus: 'connected' } as any));
  await waitFor(() => expect(isTicked('Check it says Enabled')).toBe(true));
  // Connecting proves the earlier rows were done too.
  expect(isTicked('Download inflow.mcpb')).toBe(true);
  expect(isOpen('Set Tool permissions to Always allow')).toBe(true);
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
});

it('switches inflow back on to listen for the connector if it had been turned off', async () => {
  await setMcpEnabled(false);
  await openStep();
  fireEvent.click(header('Check it says Enabled'));
  await waitFor(() => expect(startMcpBridge).toHaveBeenCalledWith(expect.any(String)));
  expect(await getMcpEnabled()).toBe(true);
});

it('offers troubleshooting when the connection takes too long', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openStep();
    fireEvent.click(header('Check it says Enabled'));
    expect(screen.queryByText(/Still waiting\?/)).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(CONNECT_HELP_AFTER_MS + 100);
    });
    expect(await screen.findByText(/Still waiting\?/)).toBeInTheDocument();
    expect(screen.getByText(/Keep this inflow tab open/)).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it('says why when the connector cannot connect, such as an outdated one', async () => {
  await openStep();
  fireEvent.click(header('Check it says Enabled'));
  act(() => useUIStore.setState({ mcpStatus: 'error', mcpError: OLD_COMPANION_MESSAGE } as any));
  const alert = await within(rowTitled('Check it says Enabled')).findByRole('alert');
  expect(alert).toHaveTextContent('Reinstall inflow.mcpb');
  // The reason replaces the generic tips rather than sitting beside them.
  expect(screen.queryByText(/Still waiting\?/)).not.toBeInTheDocument();
});

it('when already connected, shows the rows up to it ticked and opens permissions', async () => {
  act(() => useUIStore.setState({ mcpStatus: 'connected' } as any));
  await openStep();
  expect(screen.getByText('Connected to Claude Desktop.')).toBeInTheDocument();
  expect(isTicked('Paste your pairing code')).toBe(true);
  expect(isOpen('Set Tool permissions to Always allow')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: "You're all set" });
  expect(screen.getByText('MCP connector set up')).toBeInTheDocument();
});

it('can be skipped', async () => {
  await openStep();
  fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
  await screen.findByRole('heading', { name: "You're all set" });
  expect(screen.getByText('Set up the MCP connector (optional)')).toBeInTheDocument();
});

it('opens straight at this step when asked to (the MCP connector section)', async () => {
  render(<SetupWizard />);
  act(() => useUIStore.getState().openSetup({ step: 'claude' }));
  await screen.findByRole('heading', { name: 'Set up the MCP connector' });
});

it('says Always allow also covers the actions allowed in inflow, and how many tools there are', async () => {
  const { toolDescriptors } = await import('@/lib/mcp/tools');
  const { SEND_LIMIT_PER_HOUR } = await import('@/lib/mcp/permissions');
  await openStep();
  fireEvent.click(header('Set Tool permissions to Always allow'));
  const row = rowTitled('Set Tool permissions to Always allow');
  expect(row).toHaveTextContent(/covers the actions you allow in inflow's Settings › AI › Claude/);
  expect(row).toHaveTextContent(new RegExp(`capped at ${SEND_LIMIT_PER_HOUR} messages an hour`));
  // The drawing counts the tools Claude really lists, not a number from when there were fewer.
  expect(row).toHaveTextContent(`Other tools ${toolDescriptors().length}`);
});

it("draws inflow's page in Claude with the extension's real description", async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'mcp-companion', 'manifest.json'), 'utf8'));
  await openStep();
  fireEvent.click(header('Open it, and click Install twice'));
  expect(within(rowTitled('Open it, and click Install twice')).getAllByText(manifest.description).length).toBeGreaterThan(0);
  // It says Claude can act, and that inflow decides.
  expect(manifest.description).toMatch(/once you allow it in inflow/);
});
