import { readLocal } from '@/lib/storage';

const TOKEN_KEY = 'mcpPairingToken';
const ENABLED_KEY = 'mcpEnabled';

/** Default localhost endpoint the companion listens on. */
export const DEFAULT_MCP_URL = 'ws://127.0.0.1:8123';

/**
 * Whether the user wants the bridge on. A real on/off toggle: Disconnect turns
 * it off and it stays off across refreshes until Connect turns it back on.
 * Defaults to on when unset.
 */
export async function getMcpEnabled(): Promise<boolean> {
  return (await readLocal<boolean>(ENABLED_KEY)) !== false;
}

export async function setMcpEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [ENABLED_KEY]: enabled });
}

/** The extension's pairing code (its identity to the companion), if set. */
export async function getPairingToken(): Promise<string | null> {
  return (await readLocal<string>(TOKEN_KEY)) || null;
}

export async function setPairingToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token.trim() });
}

export async function clearPairingToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}

/** A short human-friendly code like "A1B2-C3D4". */
function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return hex.replace(/(.{4})(.{4})/, '$1-$2');
}

/**
 * The extension owns the pairing code: generate + persist one on first use, then
 * reuse it. The user hands this code to Claude when installing the companion
 * (the .mcpb install prompt), and the companion validates the WS handshake
 * against it — no terminal, no file to read.
 */
export async function getOrCreatePairingCode(): Promise<string> {
  const existing = await getPairingToken();
  if (existing) return existing;
  const code = generateCode();
  await setPairingToken(code);
  return code;
}
