// @vitest-environment jsdom
// Signed out after a fresh install, the sign-in gate shows the setup wizard's
// opening steps; signed out otherwise, it keeps its plain sign-in screen.
import '../dom-setup';

const sendBridgeMessage = vi.fn();
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: (...a: any[]) => sendBridgeMessage(...a) }));

import { render, screen } from '@testing-library/react';
import { AuthGate } from '@/components/common/AuthGate';
import { markSetupPending } from '@/lib/setup-state';

beforeEach(() => {
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true, data: { authenticated: false } });
});

it('shows the setup wizard when signed out right after installing', async () => {
  await markSetupPending();
  render(<AuthGate><div>app</div></AuthGate>);
  await screen.findByRole('dialog', { name: 'Set up inflow' });
  expect(screen.getByRole('heading', { name: 'Welcome to inflow' })).toBeInTheDocument();
  expect(screen.queryByText('app')).not.toBeInTheDocument();
});

it('keeps the plain sign-in screen otherwise', async () => {
  render(<AuthGate><div>app</div></AuthGate>);
  await screen.findByRole('heading', { name: 'Sign in to LinkedIn' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
