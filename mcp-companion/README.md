# inflow-mcp

Local MCP companion for the [inflow](../) LinkedIn extension. It lets **Claude Desktop** use your inflow data as a toolbox — searching your connections, reading network stats, and drafting messages into your Outbox.

**inflow is the toolbox; Claude is the brain.** This companion is a thin relay: the real tools live in the inflow browser extension, which connects out to this process over `127.0.0.1`. Claude connects to this process over stdio (MCP).

## Safety

Claude can **see** your network and **draft** messages into your Outbox — it can **never send**. Sending always stays a manual action inside inflow.

## How it works

```
Claude Desktop  ──stdio (MCP)──▶  inflow-mcp  ──ws://127.0.0.1:8123──▶  inflow extension tab
   (client)                        (relay)                               (tools + your data)
```

The extension sends `hello` (pairing token + tool descriptors); the companion exposes those tools to Claude and relays each `tools/call`. It notifies Claude when tools appear/disappear, exits when Claude quits (no orphaned port holders), and retries the port if a stale instance is still up.

---

## Distribution

Two ways to ship this to users. Both end with the same experience in inflow: open **MCP connector**, and it connects.

### 1. Claude Desktop Extension (`.mcpb`) — recommended, no terminal

A one-click bundle users install from Claude Desktop (**Settings → Extensions**). It carries the server + bundled `node_modules` and auto-configures Claude — no npm, no config editing.

```bash
cd mcp-companion
npm install
npm run pack        # -> inflow.mcpb  (validate first with: npm run validate)
```

Attach `inflow.mcpb` to a GitHub Release. Users download it and open it in Claude Desktop to install.

### 2. npm (`npx`) — for power users / other MCP clients (Codex, etc.)

```bash
cd mcp-companion
npm publish         # publishes `inflow-mcp` (needs an npm account; name must be free)
```

Then users add this to Claude Desktop's `claude_desktop_config.json` and restart Claude:

```json
{ "mcpServers": { "inflow": { "command": "npx", "args": ["-y", "inflow-mcp"] } } }
```

### Local dev (no publish)

```bash
cd mcp-companion && npm install
npx inflow-mcp --config   # prints your pairing code + a local config block (node + this path)
```

## Pairing

The companion prints a pairing code (persisted at `~/.inflow-mcp/token`). Paste it into inflow → **MCP connector → Connect Claude**. After the first pair, inflow reconnects automatically. Run `npx inflow-mcp --config` (or `node src/index.mjs --config`) any time to see the code.

Port override: `INFLOW_MCP_PORT` (default `8123`) — keep it in sync with the extension.
