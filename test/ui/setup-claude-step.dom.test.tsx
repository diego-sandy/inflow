// @vitest-environment jsdom
// The wizard's Claude Desktop step: one action per screen, the user's real
// pairing code, and a last screen that waits for the companion to actually
// connect rather than asking whether it did.
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
import { CONNECT_HELP_AFTER_MS } from '@/components/setup/ClaudeStep';

beforeEach(() => {
  startMcpBridge.mockClear();
  act(() => useUIStore.setState({ setupOpen: false, setupFromStart: false, mcpStatus: 'disconnected' } as any));
});

async function openClaudeStep() {
  await markSetupPending();
  await setSetupStep('claude');
  render(<SetupWizard />);
  await screen.findByRole('dialog', { name: 'Set up inflow' });
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const heading = (name: string) => screen.findByRole('heading', { name });

it('walks from why, to download, install, pairing code, connection and first use', async () => {
  await openClaudeStep();
  await heading('Work with your network in Claude');
  expect(screen.getByText(/Claude never sends; you do/)).toBeInTheDocument();

  click('Set it up');
  await heading('Download the inflow companion');
  const link = screen.getByRole('link', { name: 'Download inflow.mcpb' });
  expect(link).toHaveAttribute('download', 'inflow.mcpb');
  expect(link.getAttribute('href')).toContain('inflow.mcpb');

  click('I have it');
  await heading('Open it, and install in Claude');
  click('Installed');

  await heading('Paste your pairing code');
  const code = await getOrCreatePairingCode();
  // The real code, both in the copy box and drawn into Claude's form.
  await waitFor(() => expect(screen.getAllByText(code).length).toBeGreaterThanOrEqual(2));
  click('Saved');

  await heading('Switch it on');
  expect(screen.getByText(/Waiting for Claude to connect/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

  act(() => useUIStore.setState({ mcpStatus: 'connected' } as any));
  await screen.findByText('Claude is connected.');
  click('Continue');

  await heading('Try it');
  expect(screen.getByText('Allow always', { selector: 'b' })).toBeInTheDocument();
  click('Continue');
  await heading("You're all set");
  expect(screen.getByText('Claude Desktop connected')).toBeInTheDocument();
});

it('copies the pairing code', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  await markSetupPending();
  await setSetupStep('claude');
  render(<SetupWizard />);
  await heading('Work with your network in Claude');
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

it('switches inflow back on to listen for Claude if it had been turned off', async () => {
  await setMcpEnabled(false);
  await openClaudeStep();
  click('Set it up');
  click('I have it');
  click('Installed');
  click('Saved');
  await heading('Switch it on');
  await waitFor(() => expect(startMcpBridge).toHaveBeenCalledWith(expect.any(String)));
  expect(await getMcpEnabled()).toBe(true);
});

it('offers troubleshooting when Claude takes too long', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openClaudeStep();
    click('Set it up');
    click('I have it');
    click('Installed');
    click('Saved');
    await heading('Switch it on');
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

it('goes straight to the last screen when Claude is already connected', async () => {
  act(() => useUIStore.setState({ mcpStatus: 'connected' } as any));
  await openClaudeStep();
  await heading('Try it');
});

it('ticks Connect Claude in the step list only while Claude is connected', async () => {
  await openClaudeStep();
  const stepButton = () => screen.getByRole('button', { name: /Connect Claude/ });
  expect(stepButton().querySelector('.animate-setup-check')).toBeNull();
  act(() => useUIStore.setState({ mcpStatus: 'connected' } as any));
  await waitFor(() => expect(stepButton().querySelector('.animate-setup-check')).not.toBeNull());
});

it('can be skipped from any screen', async () => {
  await openClaudeStep();
  click('Set it up');
  click('Skip Claude');
  await heading("You're all set");
  expect(screen.getByText('Connect Claude Desktop (optional)')).toBeInTheDocument();
});
