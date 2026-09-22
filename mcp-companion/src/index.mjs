#!/usr/bin/env node
/**
 * inflow MCP companion — the local "MCP server" that Claude Desktop connects to.
 *
 * It is a *generic relay*: the real toolbox lives in the inflow browser extension.
 * This process:
 *   1. Speaks MCP to Claude Desktop over stdio (stdout = JSON-RPC; keep it clean).
 *   2. Runs a localhost WebSocket server the inflow tab dials out to.
 *   3. Learns the available tools from the extension's `hello`, exposes them to
 *      Claude, and relays each `tools/call` to the extension, returning results.
 *
 * Security: the extension must present the pairing code (printed to stderr and
 * persisted). Only 127.0.0.1 is bound. Read-only in this version — the extension
 * only advertises read tools, and this relay adds nothing.
 *
 * NOTE: run `npm install` in this folder before first use. This file was authored
 * without an end-to-end run in the dev sandbox — verify against a live Claude
 * Desktop once (see README).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer } from 'ws';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const PORT = Number(process.env.INFLOW_MCP_PORT || 8123);
const CONFIG_DIR = join(homedir(), '.inflow-mcp');
const TOKEN_FILE = join(CONFIG_DIR, 'token');
const CALL_TIMEOUT_MS = 30_000;

// --- Anthropic proxy (for the in-app Claude agent) ------------------------
// The companion calls Anthropic server-side, so the browser's CORS restriction
// (which blocks BAA/enterprise orgs) never applies and the API key stays OUT of
// the browser. The key is read from the companion's own environment — set
// ANTHROPIC_API_KEY (via the .mcpb install prompt or the shell), never sent from
// the extension.
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim() || '';

/** All logging goes to stderr — stdout is reserved for the MCP protocol. */
const log = (...a) => console.error('[inflow-mcp]', ...a);

/** Load the persisted pairing code, or generate + save one on first run. */
function ensurePairingCode() {
  try {
    if (existsSync(TOKEN_FILE)) {
      const code = readFileSync(TOKEN_FILE, 'utf8').trim();
      if (code) return code;
    }
  } catch {}
  const code = randomBytes(4).toString('hex').toUpperCase().replace(/(.{4})(.{4})/, '$1-$2');
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(TOKEN_FILE, code, { mode: 0o600 });
  } catch (e) {
    log('Could not persist pairing code:', e?.message);
  }
  return code;
}

// Prefer the code Claude injects from the .mcpb install prompt (which the user
// copied from inflow); fall back to a locally-persisted code for `npx` runs.
const PAIRING_CODE = process.env.INFLOW_PAIRING_CODE?.trim() || ensurePairingCode();

function printSetup() {
  const cfg = {
    mcpServers: {
      inflow: { command: 'npx', args: ['-y', 'inflow-mcp'] },
    },
  };
  console.error('');
  console.error('  inflow MCP companion');
  console.error('  ─────────────────────');
  console.error(`  Pairing code:  ${PAIRING_CODE}`);
  console.error(`  Claude agent:  ${ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY set ✓' : 'no ANTHROPIC_API_KEY (in-app Claude agent disabled)'}`);
  console.error('  Paste this code into inflow → Outbox → Connect Claude.');
  console.error('');
  console.error('  Add to Claude Desktop config (claude_desktop_config.json):');
  console.error(JSON.stringify(cfg, null, 2).split('\n').map((l) => '    ' + l).join('\n'));
  console.error('');
}

if (process.argv.includes('--config') || process.argv.includes('--setup')) {
  printSetup();
  process.exit(0);
}

// --- Extension bridge (WebSocket) -----------------------------------------
/** The currently paired extension socket, if any. */
let extension = null;
/**
 * Tell Claude the tool list changed (set once the MCP server exists). Claude
 * calls tools/list once at startup — before the extension has paired — so we
 * must nudge it to re-fetch when the extension connects (or drops), otherwise
 * it caches an empty toolset and reports "no inflow connector".
 */
let notifyToolsChanged = () => {};
/** Tools advertised by the extension (MCP tool descriptors). */
let advertisedTools = [];
/** Pending relayed calls, id → { resolve, reject, timer }. */
const pending = new Map();

let wss = null;

/**
 * Bind the localhost WebSocket server, retrying on EADDRINUSE instead of dying.
 * Claude Desktop can briefly run two instances during a relaunch; the loser used
 * to give up and the whole connection collapsed. Now the live instance keeps
 * trying until the port frees up, then grabs it and pairs.
 */
function bindWs() {
  wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
  wss.on('listening', () => log(`listening on ws://127.0.0.1:${PORT}`));
  wss.on('connection', onConnection);
  wss.on('error', (e) => {
    if (e?.code === 'EADDRINUSE') {
      log(`port ${PORT} in use — another companion is still up; retrying in 2s`);
      try { wss.close(); } catch {}
      setTimeout(bindWs, 2000);
    } else {
      log('WebSocket server error:', e?.message);
    }
  });
}

function onConnection(socket) {
  let authed = false;
  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'hello') {
      if (msg.token !== PAIRING_CODE) {
        socket.send(JSON.stringify({ type: 'error', message: 'Wrong pairing code' }));
        socket.close();
        return;
      }
      authed = true;
      extension = socket;
      advertisedTools = Array.isArray(msg.tools) ? msg.tools : [];
      socket.send(JSON.stringify({ type: 'hello_ack' }));
      log(`extension paired; ${advertisedTools.length} tools available`);
      notifyToolsChanged(); // Claude re-fetches tools/list now that they exist
      return;
    }
    if (!authed) return;

    if (msg.type === 'result') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error || 'Tool failed'));
      return;
    }
    // Extension → companion → Anthropic (the in-app Claude agent's transport).
    if (msg.type === 'anthropic') {
      void handleAnthropic(socket, msg);
      return;
    }
    if (msg.type === 'pong') return;
  });

  socket.on('close', () => {
    if (extension === socket) {
      extension = null;
      advertisedTools = [];
      log('extension disconnected');
      notifyToolsChanged();
    }
  });
}

bindWs();

/**
 * Proxy one Messages API request for the extension's Claude agent. The key is
 * added here (server-side) — the extension only sends the request body. Replies
 * with `anthropic_result` { id, ok, data|error } on the same socket.
 */
async function handleAnthropic(socket, msg) {
  const id = msg.id;
  const reply = (obj) => {
    try { socket.send(JSON.stringify({ type: 'anthropic_result', id, ...obj })); } catch {}
  };
  if (!ANTHROPIC_API_KEY) {
    reply({ ok: false, error: 'No Anthropic key in the companion. Set ANTHROPIC_API_KEY and restart it.' });
    return;
  }
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(msg.payload || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      reply({ ok: false, error: data?.error?.message || `Anthropic HTTP ${res.status}` });
      return;
    }
    reply({ ok: true, data });
  } catch (e) {
    reply({ ok: false, error: e?.message || 'Anthropic request failed' });
  }
}

/** Relay a tool call to the paired extension and await its result. */
function relayCall(name, args) {
  return new Promise((resolve, reject) => {
    if (!extension || extension.readyState !== extension.OPEN) {
      reject(new Error('inflow is not connected. Open the inflow tab and pair the companion (Outbox → Connect Claude).'));
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('inflow did not respond in time.'));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    extension.send(JSON.stringify({ type: 'call', id, name, args: args || {} }));
  });
}

// --- MCP server (stdio to Claude Desktop) ---------------------------------
const server = new Server(
  { name: 'inflow', version: '0.1.0' },
  { capabilities: { tools: { listChanged: true } } },
);

// Now that the server exists, wire the "tools changed" nudge. Prefer the SDK
// helper; fall back to a raw notification for older SDKs.
notifyToolsChanged = () => {
  try {
    if (typeof server.sendToolListChanged === 'function') server.sendToolListChanged();
    else server.notification({ method: 'notifications/tools/list_changed' });
  } catch (e) {
    log('tools/list_changed notify failed:', e?.message);
  }
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: advertisedTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema || { type: 'object' },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const data = await relayCall(name, args);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e?.message || 'call failed'}` }], isError: true };
  }
});

printSetup();
await server.connect(new StdioServerTransport());
log('MCP server ready (stdio).');

// Exit when Claude disconnects so we never orphan a process that keeps holding
// the WS port (which would block the next launch from binding). Cover the MCP
// transport close, a closed stdin, and the usual termination signals.
server.onclose = () => { log('Claude disconnected — exiting'); process.exit(0); };
process.stdin.on('close', () => process.exit(0));
process.stdin.on('end', () => process.exit(0));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
