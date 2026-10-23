import { markSetupPending } from '@/lib/setup-state';
import { openAppTab } from './open-app-tab';

/**
 * What happens when Chrome installs or updates the extension.
 *
 * A fresh install opens straight into setup. Without this nothing happens at
 * all: the icon lands in Chrome's puzzle-piece menu and the user has to go
 * looking for it. An update (or a dev-mode reload) just reopens the app tab;
 * existing users never get the wizard on their own.
 */
export async function handleInstalled(details: { reason: string }): Promise<void> {
  if (details.reason === 'install') {
    await markSetupPending();
    await openAppTab();
  } else if (details.reason === 'update') {
    await openAppTab();
  }
}
