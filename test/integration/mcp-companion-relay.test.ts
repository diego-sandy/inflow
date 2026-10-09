/**
 * Only one companion can own the localhost bridge the inflow tab dials into,
 * but every MCP client (Claude Desktop, Claude Code, …) starts its own. The
 * loser used to be dead weight: it listed tools but every call failed, so a
 * second client appeared connected and broken.
 *
 * It now attaches to the owner as a peer and relays tool calls through it. This
 * drives the real thing end to end: a fake extension pairs with the owner, a
 * second companion starts on the same port, and a tools/call issued to THAT
 * second companion must reach the extension and come back with its result.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COMPANION = join(process.cwd(), 'mcp-companion', 'src', 'index.mjs');
const PORT = '8195';
const CODE = 'TEST-RELAY';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function startCompanion(home: string, relayOnly = false) {
  const proc = spawn('node', [COMPANION], {
    env: {
      ...process.env, HOME: home, INFLOW_MCP_PORT: PORT, INFLOW_PAIRING_CODE: CODE,
      ...(relayOnly ? { INFLOW_RELAY_ONLY: '1' } : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // Killing these processes mid-flight makes Node emit async errors on the
  // child and its stdin (EPIPE on a write that races teardown). With no
  // listener those surface as unhandled and fail the whole run at random,
  // without any test reporting a failure.
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

/** Stand-in for the browser extension: pairs, then answers tool calls. */
function fakeExtension(onCall: (name: string) => void, onAck?: (ack: any) => void) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  // Killing the owner in a test's finally block resets this socket; without a
  // listener that surfaces as an unhandled error and fails the run at random.
  ws.addEventListener('error', () => {});
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      type: 'hello',
      token: CODE,
      tools: [
        { name: 'search_messages', description: 'd', inputSchema: { type: 'object' } },
        { name: 'create_draft', description: 'd', inputSchema: { type: 'object' } },
      ],
    }));
  });
  ws.addEventListener('message', (ev: any) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.type === 'hello_ack') { onAck?.(msg); return; }
    if (msg.type === 'call') {
      onCall(msg.name);
      ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: true, data: { ranOnExtension: msg.name } }));
    }
  });
  return ws;
}

it('relays a peer companion\'s tool call through the bridge owner', async () => {
  const home = mkdtempSync(join(tmpdir(), 'inflow-relay-'));
  const calls: string[] = [];
  let owner: ReturnType<typeof startCompanion> | undefined;
  let peer: ReturnType<typeof startCompanion> | undefined;
  let ext: WebSocket | undefined;

  try {
    owner = startCompanion(home);
    await wait(900);
    let ack: any;
    ext = fakeExtension((n) => calls.push(n), (a) => (ack = a));
    await wait(700);

    // The companion reports its own state so inflow can show it in-app, rather
    // than that detail only ever reaching the MCP client's log file.
    expect(ack?.status).toMatchObject({ port: Number(PORT), ownsBridge: true });
    expect(ack.status.tools).toBeGreaterThan(0);
    // Build identity, so the feed can say which build is actually live.
    expect(typeof ack.status.version).toBe('string');
    expect(ack.status.version.length).toBeGreaterThan(0);

    // Second companion on the same port — it must become a peer, not a dud.
    peer = startCompanion(home);
    await wait(1500);
    expect(peer.stderr()).toMatch(/is BUSY/);
    expect(peer.stderr()).toMatch(/relaying through the companion that owns the bridge/);

    peer.send({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    await wait(300);
    peer.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    peer.send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    await wait(500);

    // The call goes to the PEER, which has no extension of its own.
    peer.send({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'search_messages', arguments: { query: 'pricing' } },
    });
    await wait(1800);

    const msgs = peer.messages();
    const list = msgs.find((m) => m.id === 1);
    expect(list?.result?.tools?.map((t: any) => t.name)).toEqual(['search_messages', 'create_draft']);

    // It reached the real extension...
    expect(calls).toEqual(['search_messages']);
    // ...and its result came back out of the peer, not an error.
    const call = msgs.find((m) => m.id === 2);
    expect(call?.result?.isError).toBeFalsy();
    expect(JSON.stringify(call?.result?.content)).toContain('ranOnExtension');
  } finally {
    try { ext?.close(); } catch {}
    owner?.proc.kill('SIGINT');
    peer?.proc.kill('SIGINT');
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

it('a peer takes over the bridge when the owner exits', async () => {
  const home = mkdtempSync(join(tmpdir(), 'inflow-takeover-'));
  let owner: ReturnType<typeof startCompanion> | undefined;
  let peer: ReturnType<typeof startCompanion> | undefined;
  try {
    owner = startCompanion(home);
    await wait(900);
    peer = startCompanion(home);
    await wait(1400);
    expect(peer.stderr()).toMatch(/is BUSY/);

    // The owner goes away (quitting Claude, or a stale process finally exiting).
    owner.proc.kill('SIGINT');
    await wait(3500); // the peer retries the bind every 2s

    expect(peer.stderr()).toMatch(/is FREE/);
    expect(peer.stderr()).toMatch(/took over the bridge/);
  } finally {
    owner?.proc.kill('SIGINT');
    peer?.proc.kill('SIGINT');
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

it('a relay-only instance never owns the bridge, even when the port is free', async () => {
  const home = mkdtempSync(join(tmpdir(), 'inflow-relayonly-'));
  const calls: string[] = [];
  let relay: ReturnType<typeof startCompanion> | undefined;
  let owner: ReturnType<typeof startCompanion> | undefined;
  let ext: WebSocket | undefined;
  try {
    // Start it FIRST, with nothing holding the port — it must still refuse to bind.
    relay = startCompanion(home, true);
    await wait(1200);
    expect(relay.stderr()).toMatch(/relay-only/);
    expect(relay.stderr()).not.toMatch(/is FREE/);

    // The real owner (the one with the provider keys) comes up and takes it.
    owner = startCompanion(home);
    await wait(900);
    expect(owner.stderr()).toMatch(/is FREE/);
    ext = fakeExtension((n) => calls.push(n));
    await wait(1600); // relay reattaches on its 2s loop

    relay.send({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    await wait(300);
    relay.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    relay.send({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'create_draft', arguments: {} },
    });
    await wait(1800);

    // Routed through the owner to the extension, and answered.
    expect(calls).toEqual(['create_draft']);
    const call = relay.messages().find((m) => m.id === 2);
    expect(JSON.stringify(call?.result?.content)).toContain('ranOnExtension');
  } finally {
    try { ext?.close(); } catch {}
    relay?.proc.kill('SIGINT');
    owner?.proc.kill('SIGINT');
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
