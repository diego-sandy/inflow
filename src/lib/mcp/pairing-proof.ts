/**
 * The extension's half of mutual pairing with the companion (see
 * mcp-companion/src/pairing.mjs for the protocol). Same proof, computed with
 * Web Crypto, which the extension page has and the service worker would too:
 *
 *   proof(role) = HMAC-SHA256(code, "inflow-pair-v2|<role>|<serverNonce>|<clientNonce>"), hex
 *
 * The pairing code itself is never sent.
 */

const encoder = new TextEncoder();

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

export async function pairingProof(
  code: string,
  role: 'client' | 'server',
  serverNonce: string,
  clientNonce: string,
): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(code), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`inflow-pair-v2|${role}|${serverNonce}|${clientNonce}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether the server's proof is right. Compared without bailing at the first
 * difference, so how long it takes says nothing about how close a guess was.
 */
export async function verifyServerProof(
  code: string,
  serverNonce: string,
  clientNonce: string,
  proof: unknown,
): Promise<boolean> {
  if (typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return false;
  const expected = await pairingProof(code, 'server', serverNonce, clientNonce);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ proof.charCodeAt(i);
  return diff === 0;
}
