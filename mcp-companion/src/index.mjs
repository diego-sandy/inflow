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

const PAIRING_CODE = ensurePairingCode();

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

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });

wss.on('listening', () => log(`listening on ws://127.0.0.1:${PORT}`));
wss.on('error', (e) => {
  if (e?.code === 'EADDRINUSE') log(`port ${PORT} is in use — is another companion already running?`);
  else log('WebSocket server error:', e?.message);
});

wss.on('connection', (socket) => {
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
});

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
