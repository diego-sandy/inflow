/**
 * The setup wizard's saved state, and the install hook that starts it. Only a
 * fresh install marks setup pending; an update must never spring the wizard on
 * someone already using the app.
 */
import {
  completeSetup,
  dismissSetup,
  getSetupCompletedAt,
  getSetupStep,
  isSetupPending,
  markSetupPending,
  setSetupStep,
} from '@/lib/setup-state';

const openAppTab = vi.fn(async () => {});
vi.mock('../../entrypoints/background/open-app-tab', () => ({ openAppTab: () => openAppTab() }));

import { handleInstalled } from '../../entrypoints/background/on-installed';

beforeEach(() => openAppTab.mockClear());

describe('setup state', () => {
  it('is not pending until an install says so', async () => {
    expect(await isSetupPending()).toBe(false);
    expect(await getSetupStep()).toBe('welcome');
    expect(await getSetupCompletedAt()).toBeNull();
  });

  it('remembers the step, and ignores one it does not know', async () => {
    await setSetupStep('key');
    expect(await getSetupStep()).toBe('key');
    await chrome.storage.local.set({ setupStep: 'teleport' });
    expect(await getSetupStep()).toBe('welcome');
  });

  it('closing early stops it opening on its own but keeps the step to resume', async () => {
    await markSetupPending();
    await setSetupStep('pin');
    await dismissSetup();
    expect(await isSetupPending()).toBe(false);
    expect(await getSetupStep()).toBe('pin');
  });

  it('finishing clears it and records when', async () => {
    await markSetupPending();
    await setSetupStep('done');
    await completeSetup(1234);
    expect(await isSetupPending()).toBe(false);
    expect(await getSetupStep()).toBe('welcome');
    expect(await getSetupCompletedAt()).toBe(1234);
  });
});

describe('on install', () => {
  it('a fresh install marks setup pending and opens the app', async () => {
    await handleInstalled({ reason: 'install' });
    expect(await isSetupPending()).toBe(true);
    expect(openAppTab).toHaveBeenCalledTimes(1);
  });

  it('an update reopens the app without starting setup', async () => {
    await handleInstalled({ reason: 'update' });
    expect(await isSetupPending()).toBe(false);
    expect(openAppTab).toHaveBeenCalledTimes(1);
  });

  it('ignores other reasons', async () => {
    await handleInstalled({ reason: 'chrome_update' });
    expect(openAppTab).not.toHaveBeenCalled();
  });
});
