import { readLocal } from '@/lib/storage';

const TOKEN_KEY = 'mcpPairingToken';

/** Default localhost endpoint the companion listens on. */
export const DEFAULT_MCP_URL = 'ws://127.0.0.1:8123';

/** The pairing code the user copied from the companion, if any. */
export async function getPairingToken(): Promise<string | null> {
  return (await readLocal<string>(TOKEN_KEY)) || null;
}

export async function setPairingToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token.trim() });
}

export async function clearPairingToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}
