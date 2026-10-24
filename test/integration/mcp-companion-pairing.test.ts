/**
 * Mutual pairing against the real companion process. Before, the extension
 * sent the pairing code itself in `hello`, so whatever held the port was handed
 * it. Now neither side sends the code: each proves it holds it.
 *
 * Checks the companion: challenges first, accepts the right proof and proves
 * itself back, refuses a wrong one, tells an old extension (one that still
 * sends the code) to update, turns away web pages by Origin, and, as a peer,
 * refuses to relay through a program on the port that can't prove itself.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newNonce, pairingProof, verifyPairingProof } from '../../mcp-companion/src/pairing.mjs';

const COMPANION_DIR = join(process.cwd(), 'mcp-companion');
const COMPANION = join(COMPANION_DIR, 'src', 'index.mjs');
const PORT = 8196;
const CODE = 'TEST-PAIR';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The companion needs its own dependencies installed to run at all.
const hasDeps = existsSync(join(COMPANION_DIR, 'node_modules', 'ws'));

function startCompanion(home: string) {
  const proc = spawn('node', [COMPANION], {
    env: { ...process.env, HOME: home, INFLOW_MCP_PORT: String(PORT), INFLOW_PAIRING_CODE: CODE },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.on('error', () => {});
  proc.stdin.on('error', () => {});
  let out = '';
  let err = '';
  proc.stdout.on('data', (d) => (out += String(d)));
  proc.stderr.on('data', (d) => (err += String(d)));
  return {
    proc,
    send: (o: object) => {
      if (proc.killed || !proc.stdin.writable) return;
      proc.stdin.write(JSON.stringify(o) + '\n');
    },
    messages: () =>
      out.split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean) as any[],
    stderr: () => err,
  };
}

/** Connect, collect every frame, and let the test script the replies. */
function client(onMessage: (msg: any, ws: WebSocket) => void) {
  const frames: any[] = [];
  let closed = false;
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.addEventListener('error', () => {});
  ws.addEventListener('close', () => (closed = true));
  ws.addEventListener('message', (ev: any) => {
    const msg = JSON.parse(String(ev.data));
    frames.push(msg);
    onMessage(msg, ws);
  });
  return { ws, frames, closed: () => closed };
}

const TOOLS = [{ name: 'search_messages', description: 'd', inputSchema: { type: 'object' } }];

describe.skipIf(!hasDeps)('mutual pairing with the real companion', () => {
  let home: string;
  let companion: ReturnType<typeof startCompanion> | undefined;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'inflow-pair-'));
    companion = startCompanion(home);
    await wait(900);
  });
  afterAll(() => {
    companion?.proc.kill('SIGINT');
    rmSync(home, { recursive: true, force: true });
  });

  it('challenges first, accepts the right proof, and proves itself back', async () => {
    let nonce = '';
    let serverNonce = '';
    const c = client((msg, ws) => {
      if (msg.type !== 'challenge') return;
      serverNonce = msg.nonce;
      nonce = newNonce();
      ws.send(JSON.stringify({ type: 'hello', v: 2, nonce, proof: pairingProof(CODE, 'client', msg.nonce, nonce), tools: TOOLS }));
    });
    await wait(600);
    try {
      expect(c.frames[0]).toMatchObject({ type: 'challenge', v: 2 });
      const ack = c.frames.find((m) => m.type === 'hello_ack');
      expect(ack).toBeTruthy();
      expect(verifyPairingProof(CODE, 'server', serverNonce, nonce, ack.serverProof)).toBe(true);
      // The code never crosses the wire, in either direction.
      expect(JSON.stringify(c.frames)).not.toContain(CODE);
    } finally {
      c.ws.close();
    }
  });

  it('refuses a wrong proof and hangs up', async () => {
    const c = client((msg, ws) => {
      if (msg.type !== 'challenge') return;
      const nonce = newNonce();
      ws.send(JSON.stringify({ type: 'hello', v: 2, nonce, proof: pairingProof('WRONG-CODE', 'client', msg.nonce, nonce), tools: TOOLS }));
    });
    await wait(600);
    expect(c.frames.find((m) => m.type === 'hello_ack')).toBeUndefined();
    expect(c.frames.find((m) => m.type === 'error')?.message).toBe('Wrong pairing code');
    expect(c.closed()).toBe(true);
  });

  it('tells an old extension, which still sends the code, to update', async () => {
    // Old builds speak first and ignore the challenge.
    const c = client(() => {});
    c.ws.addEventListener('open', () => c.ws.send(JSON.stringify({ type: 'hello', token: CODE, tools: TOOLS })));
    await wait(600);
    expect(c.frames.find((m) => m.type === 'hello_ack')).toBeUndefined();
    expect(c.frames.find((m) => m.type === 'error')?.message).toMatch(/inflow needs updating/);
    expect(c.closed()).toBe(true);
  });

  it('turns a web page away before it can even try', async () => {
    const status = await new Promise<number>((resolve) => {
      const req = request({
        host: '127.0.0.1', port: PORT, path: '/',
        headers: {
          Connection: 'Upgrade', Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          Origin: 'https://example.com',
        },
      });
      req.on('upgrade', (_res, socket) => { socket.destroy(); resolve(101); });
      req.on('response', (res) => resolve(res.statusCode ?? 0));
      req.on('error', () => resolve(0));
      req.end();
    });
    expect(status).not.toBe(101);
  });

  it('lets the extension\'s own origin through', async () => {
    const status = await new Promise<number>((resolve) => {
      const req = request({
        host: '127.0.0.1', port: PORT, path: '/',
        headers: {
          Connection: 'Upgrade', Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        },
      });
      req.on('upgrade', (_res, socket) => { socket.destroy(); resolve(101); });
      req.on('response', (res) => resolve(res.statusCode ?? 0));
      req.on('error', () => resolve(0));
      req.end();
    });
    expect(status).toBe(101);
  });
});

describe.skipIf(!hasDeps)('a peer companion and an impostor on the port', () => {
  it('will not relay through something that cannot prove it has the code', async () => {
    const { WebSocketServer } = await import('../../mcp-companion/node_modules/ws/wrapper.mjs');
    const home = mkdtempSync(join(tmpdir(), 'inflow-impostor-'));
    const seen: any[] = [];
    // Grabs the port first, accepts any peer, and "proves" itself with junk.
    const impostor = new WebSocketServer({ host: '127.0.0.1', port: PORT });
    impostor.on('connection', (sock: any) => {
      sock.send(JSON.stringify({ type: 'challenge', v: 2, nonce: 'e'.repeat(32) }));
      sock.on('message', (raw: any) => {
        const msg = JSON.parse(String(raw));
        seen.push(msg);
        if (msg.type === 'peer_hello') {
          sock.send(JSON.stringify({ type: 'peer_ack', serverProof: '0'.repeat(64), tools: TOOLS }));
        }
      });
    });
    await wait(200);
    const peer = startCompanion(home);
    try {
      await wait(1500);
      expect(peer.stderr()).toMatch(/is BUSY/);
      expect(peer.stderr()).toMatch(/could not prove it has the pairing code/);
      expect(peer.stderr()).not.toMatch(/relaying through the companion that owns the bridge/);

      peer.send({
        jsonrpc: '2.0', id: 0, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      });
      await wait(300);
      peer.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      peer.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_messages', arguments: { query: 'x' } } });
      await wait(800);

      // The call was never handed to the impostor...
      expect(seen.filter((m) => m.type === 'peer_call')).toEqual([]);
      // ...and the peer's proof was one the impostor can't reuse or reverse.
      expect(JSON.stringify(seen)).not.toContain(CODE);
      const call = peer.messages().find((m) => m.id === 2);
      expect(call?.result?.isError).toBe(true);
    } finally {
      peer.proc.kill('SIGINT');
      await new Promise((r) => impostor.close(r));
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});
