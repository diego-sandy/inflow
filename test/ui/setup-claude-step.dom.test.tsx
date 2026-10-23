// @vitest-environment jsdom
// The MCP connector guide, as the setup wizard's step. It follows what Claude
// Desktop really shows when inflow.mcpb is opened: inflow's page with Install,
// a confirmation, Configure with the pairing code, the Enabled switch, and Tool
// permissions. The connection screen waits for the real connection.
import '../dom-setup';

const startMcpBridge = vi.fn();
vi.mock('@/lib/mcp/bridge-client', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  startMcpBridge: (...a: any[]) => startMcpBridge(...a),
}));

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SetupWizard } from '@/components/setup/SetupWizard';
import { useUIStore } from '@/store/ui-store';
import { markSetupPending, setSetupStep } from '@/lib/setup-state';
import { getMcpEnabled, getOrCreatePairingCode, setMcpEnabled } from '@/lib/mcp/pairing';
import { CONNECT_HELP_AFTER_MS } from '@/components/setup/ConnectorGuide';

beforeEach(() => {
  startMcpBridge.mockClear();
  act(() => useUIStore.setState({ setupOpen: false, setupFromStart: false, mcpStatus: 'disconnected' } as any));
});

async function openStep() {
  await markSetupPending();
  await setSetupStep('claude');
  render(<SetupWizard />);
  await screen.findByRole('dialog', { name: 'Set up inflow' });
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const heading = (name: string) => screen.findByRole('heading', { name });

/** From the intro to the connection screen. */
function toEnable() {
  click('Set it up');
  click('I have it');
  click('Installed');
  click('Saved');
}

it('walks the real Claude Desktop flow, from download to Always allow', async () => {
  await openStep();
  await heading('Set up the MCP connector');
  expect(screen.getByText(/Claude never sends; you do/)).toBeInTheDocument();

  click('Set it up');
  await heading('Download the connector');
  const link = screen.getByRole('link', { name: 'Download inflow.mcpb' });
  expect(link).toHaveAttribute('download', 'inflow.mcpb');
  expect(link.getAttribute('href')).toContain('inflow.mcpb');

  click('I have it');
  await heading('Open it, and install');
  // Install, then Install again on Claude's confirmation.
  expect(screen.getByText(/then/).textContent).toMatch(/Install, then Install again to confirm/);
  expect(screen.getByText(/same warning for every extension/)).toBeInTheDocument();
  click('Installed');

  await heading('Paste your pairing code');
  const code = await getOrCreatePairingCode();
  await screen.findByText(code);
  // Claude's own field title, so the user can match it on screen.
  expect(screen.getAllByText(/inflow pairing code/).length).toBeGreaterThan(0);
  click('Saved');

  await heading("Check it's enabled");
  expect(screen.getByText(/Waiting for the connector/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

  act(() => useUIStore.setState({ mcpStatus: 'connected' } as any));
  await screen.findByText('Connected to Claude Desktop.');
  click('Continue');

  await heading('Let Claude use it without asking');
  expect(screen.getByText('Tool permissions', { selector: 'b' })).toBeInTheDocument();
  expect(screen.getByText('Always allow', { selector: 'b' })).toBeInTheDocument();
  click('Continue');
  await heading("You're all set");
  expect(screen.getByText('MCP connector set up')).toBeInTheDocument();
});

it('copies the pairing code', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  await openStep();
  click('Set it up');
  click('I have it');
  click('Installed');
  await heading('Paste your pairing code');
  const code = await getOrCreatePairingCode();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled());
  click('Copy');
  expect(writeText).toHaveBeenCalledWith(code);
  await screen.findByRole('button', { name: 'Copied' });
});

it('switches inflow back on to listen for the connector if it had been turned off', async () => {
  await setMcpEnabled(false);
  await openStep();
  toEnable();
  await heading("Check it's enabled");
  await waitFor(() => expect(startMcpBridge).toHaveBeenCalledWith(expect.any(String)));
  expect(await getMcpEnabled()).toBe(true);
});

it('offers troubleshooting when the connection takes too long', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openStep();
    toEnable();
    await heading("Check it's enabled");
    expect(screen.queryByText(/Still waiting\?/)).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(CONNECT_HELP_AFTER_MS + 100);
    });
    expect(await screen.findByText(/Still waiting\?/)).toBeInTheDocument();
    expect(screen.getByText(/check the pairing code/)).toBeInTheDocument();
    expect(screen.getByText(/Keep this inflow tab open/)).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it('goes straight to the last screen when already connected', async () => {
  act(() => useUIStore.setState({ mcpStatus: 'connected' } as any));
  await openStep();
  await heading('Let Claude use it without asking');
});

it('ticks MCP connector in the step list only while connected', async () => {
  await openStep();
  const stepButton = () => screen.getByRole('button', { name: /MCP connector/ });
  expect(stepButton().querySelector('.animate-setup-check')).toBeNull();
  act(() => useUIStore.setState({ mcpStatus: 'connected' } as any));
  await waitFor(() => expect(stepButton().querySelector('.animate-setup-check')).not.toBeNull());
});

it('can be skipped from any screen', async () => {
  await openStep();
  click('Set it up');
  click('Skip for now');
  await heading("You're all set");
  expect(screen.getByText('Set up the MCP connector (optional)')).toBeInTheDocument();
});
