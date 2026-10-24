/**
 * Mutual pairing between the companion and whoever connects to its bridge
 * (the inflow extension, or another companion relaying through this one).
 *
 * Both sides prove they hold the pairing code without either one sending it:
 *
 *   server → { type:'challenge', v:2, nonce: Ns }
 *   client → { type:'hello' | 'peer_hello', v:2, nonce: Nc, proof: P(client) }
 *   server → { type:'hello_ack' | 'peer_ack', serverProof: P(server), … }
 *
 *   P(role) = HMAC-SHA256(code, "inflow-pair-v2|<role>|<Ns>|<Nc>"), hex
 *
 * The server checks the client's proof before accepting anything else from
 * it, and the client checks the server's proof before it answers a single
 * tool call. The role in the message means one side's proof can't be replayed
 * as the other's, and the two fresh nonces mean a proof seen once is useless
 * on the next connection.
 *
 * This replaces sending the code itself in `hello`: anything else on the
 * computer that bound the port first was then handed the code, and the
 * extension would answer its tool calls.
 *
 * The extension computes the same thing with Web Crypto in
 * src/lib/mcp/pairing-proof.ts; a test checks the two agree.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const PAIRING_VERSION = 2;

const NONCE_RE = /^[0-9a-f]{32}$/;

export function newNonce() {
  return randomBytes(16).toString('hex');
}

export function isNonce(value) {
  return typeof value === 'string' && NONCE_RE.test(value);
}

/** The proof one side gives for a connection, as hex. */
export function pairingProof(code, role, serverNonce, clientNonce) {
  return createHmac('sha256', String(code)).update(`inflow-pair-v2|${role}|${serverNonce}|${clientNonce}`).digest('hex');
}

/** Whether `proof` is the right one, compared in constant time. */
export function verifyPairingProof(code, role, serverNonce, clientNonce, proof) {
  if (typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return false;
  const expected = Buffer.from(pairingProof(code, role, serverNonce, clientNonce), 'hex');
  return timingSafeEqual(expected, Buffer.from(proof, 'hex'));
}
