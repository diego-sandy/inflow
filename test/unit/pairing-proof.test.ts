/**
 * The extension (Web Crypto) and the companion (node:crypto) compute the same
 * pairing proofs, or no one could ever connect. Also: the two roles' proofs
 * differ, a proof depends on both nonces and on the code, and only the right
 * one verifies.
 */
import * as ext from '@/lib/mcp/pairing-proof';
import * as companion from '../../mcp-companion/src/pairing.mjs';

const CODE = 'A1B2-C3D4';
const NS = 'a'.repeat(32);
const NC = 'b'.repeat(32);

it('the extension and the companion compute identical proofs', async () => {
  for (const role of ['client', 'server'] as const) {
    expect(await ext.pairingProof(CODE, role, NS, NC)).toBe(companion.pairingProof(CODE, role, NS, NC));
  }
});

it('a client proof is not a server proof, so one cannot be replayed as the other', async () => {
  expect(await ext.pairingProof(CODE, 'client', NS, NC)).not.toBe(await ext.pairingProof(CODE, 'server', NS, NC));
});

it('depends on the code and on both nonces', async () => {
  const base = await ext.pairingProof(CODE, 'client', NS, NC);
  expect(await ext.pairingProof('Z9Y8-X7W6', 'client', NS, NC)).not.toBe(base);
  expect(await ext.pairingProof(CODE, 'client', 'c'.repeat(32), NC)).not.toBe(base);
  expect(await ext.pairingProof(CODE, 'client', NS, 'c'.repeat(32))).not.toBe(base);
});

it('verifies only the right proof, on both sides', async () => {
  const server = companion.pairingProof(CODE, 'server', NS, NC);
  expect(await ext.verifyServerProof(CODE, NS, NC, server)).toBe(true);
  expect(await ext.verifyServerProof('WRONG-CODE', NS, NC, server)).toBe(false);
  expect(await ext.verifyServerProof(CODE, NS, NC, undefined)).toBe(false);
  expect(await ext.verifyServerProof(CODE, NS, NC, 'not-hex')).toBe(false);

  const client = await ext.pairingProof(CODE, 'client', NS, NC);
  expect(companion.verifyPairingProof(CODE, 'client', NS, NC, client)).toBe(true);
  expect(companion.verifyPairingProof(CODE, 'server', NS, NC, client)).toBe(false);
  expect(companion.verifyPairingProof(CODE, 'client', NS, NC, '0'.repeat(64))).toBe(false);
});

it('makes fresh 128-bit nonces', () => {
  expect(ext.isNonce(ext.newNonce())).toBe(true);
  expect(companion.isNonce(companion.newNonce())).toBe(true);
  expect(ext.newNonce()).not.toBe(ext.newNonce());
});
