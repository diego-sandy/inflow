import { readLocal } from './storage';

/**
 * Where the first-run setup wizard is up to. In chrome.storage rather than
 * localStorage because the background worker writes `pending` on install, and
 * because the wizard has to survive a remount: it starts on the signed-out
 * screen, and once LinkedIn sign-in succeeds the whole app mounts fresh and
 * the wizard has to carry on at the same step.
 */

export type SetupStep = 'welcome' | 'linkedin' | 'pin' | 'ai' | 'key' | 'done';

export const SETUP_STEPS: SetupStep[] = ['welcome', 'linkedin', 'pin', 'ai', 'key', 'done'];

const PENDING_KEY = 'setupPending';
const STEP_KEY = 'setupStep';
const COMPLETED_KEY = 'setupCompletedAt';

/**
 * Whether the wizard should open on its own. Only a fresh install sets this
 * (see the background's onInstalled), so people updating from an older version
 * are never ambushed by a setup flow for an app they already use. Finishing or
 * closing the wizard clears it; Settings can always run it again.
 */
export async function isSetupPending(): Promise<boolean> {
  return (await readLocal<boolean>(PENDING_KEY)) === true;
}

export async function markSetupPending(): Promise<void> {
  try {
    await chrome.storage.local.set({ [PENDING_KEY]: true, [STEP_KEY]: 'welcome' });
  } catch {
    // Storage unavailable: the user simply doesn't get the wizard on its own.
  }
}

export async function getSetupStep(): Promise<SetupStep> {
  const v = await readLocal<string>(STEP_KEY);
  return SETUP_STEPS.includes(v as SetupStep) ? (v as SetupStep) : 'welcome';
}

export async function setSetupStep(step: SetupStep): Promise<void> {
  try {
    await chrome.storage.local.set({ [STEP_KEY]: step });
  } catch {
    // Not fatal: a remount would restart at Welcome, with done steps ticked.
  }
}

/** Closing early: stop opening on its own, but remember the step for a resume. */
export async function dismissSetup(): Promise<void> {
  try {
    await chrome.storage.local.set({ [PENDING_KEY]: false });
  } catch {}
}

export async function completeSetup(now = Date.now()): Promise<void> {
  try {
    await chrome.storage.local.set({ [PENDING_KEY]: false, [STEP_KEY]: 'welcome', [COMPLETED_KEY]: now });
  } catch {}
}

export async function getSetupCompletedAt(): Promise<number | null> {
  return (await readLocal<number>(COMPLETED_KEY)) ?? null;
}
