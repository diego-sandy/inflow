// @vitest-environment jsdom
// Settings › Connections: the one choice about connection syncing that is the
// user's (how often the whole list is re-read), plus a refresh-now button that
// asks the background for a forced pass and reports what happened.
import '../dom-setup';

const { sendBridgeMessage } = vi.hoisted(() => ({ sendBridgeMessage: vi.fn() }));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectionsSettings } from '@/components/settings/ConnectionsSettings';
import { getFullRefreshMode, setFullRefreshMode } from '@/lib/connections-settings';
import { useUIStore } from '@/store/ui-store';

beforeEach(() => {
  sendBridgeMessage.mockReset();
});

it('defaults to automatic', async () => {
  render(<ConnectionsSettings />);
  expect(await screen.findByRole('radio', { name: /Automatically/ })).toBeChecked();
  expect(await getFullRefreshMode()).toBe('auto');
});

it('shows and saves the chosen mode', async () => {
  await setFullRefreshMode('weekly');
  render(<ConnectionsSettings />);
  await waitFor(() => expect(screen.getByRole('radio', { name: /Weekly/ })).toBeChecked());

  fireEvent.click(screen.getByRole('radio', { name: /Only when I ask/ }));
  await waitFor(async () => expect(await getFullRefreshMode()).toBe('manual'));
});

it('ignores a stored value it does not recognize', async () => {
  await chrome.storage.local.set({ connectionsFullRefresh: 'hourly' });
  expect(await getFullRefreshMode()).toBe('auto');
});

it('"Refresh all connections now" forces a pass and reports the outcome', async () => {
  const showToast = vi.fn();
  useUIStore.setState({ showToast } as any);
  sendBridgeMessage.mockResolvedValue({ success: true, data: { requests: 31, stored: 1240, loadingMore: true } });

  render(<ConnectionsSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh all connections now' }));

  await waitFor(() =>
    expect(showToast).toHaveBeenCalledWith({ message: expect.stringMatching(/Still loading your connections/) }),
  );
  expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'FETCH_CONNECTIONS', force: true });
});
