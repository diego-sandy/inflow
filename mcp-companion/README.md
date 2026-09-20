# inflow-mcp

Local MCP companion for the [inflow](../) LinkedIn extension. It lets **Claude Desktop** use your inflow data as a toolbox — searching your connections, reading network stats, and drafting messages into your Outbox.

**inflow is the toolbox; Claude is the brain.** This companion is a thin relay: the real tools live in the inflow browser extension, which connects out to this process over `127.0.0.1`. Claude connects to this process over stdio (MCP).

## Safety

Claude can **see** your network and **draft** messages into your Outbox — it can **never send**. Sending always stays a manual action inside inflow.

## Setup

1. Install deps and see your pairing code + config snippet:
   ```bash
   cd mcp-companion && npm install
   npx inflow-mcp --config
   ```
2. Add the printed block to Claude Desktop's `claude_desktop_config.json`, then restart Claude Desktop. Claude will launch the companion itself.
3. In inflow, open **Outbox → Connect Claude**, run `npx inflow-mcp` once to read the pairing code (printed to stderr), and paste it in. The status bar turns green when connected.

The pairing code is generated once and persisted at `~/.inflow-mcp/token`, so Claude's launched instance and your inflow use the same code.

## How it works

```
Claude Desktop  ──stdio (MCP)──▶  inflow-mcp  ──ws://127.0.0.1:8123──▶  inflow extension tab
   (client)                        (relay)                               (tools + your data)
```

- The extension sends `hello` with the pairing token and its tool descriptors.
- The companion exposes those tools to Claude via `tools/list`.
- Each `tools/call` is relayed to the extension and the result returned to Claude.

Port override: `INFLOW_MCP_PORT` (default `8123`). Keep it in sync with the extension's default.

## Status

Authored alongside the extension bridge but **not yet run against a live Claude Desktop** — verify the MCP handshake and a `tools/call` round-trip once, then publish to npm as `inflow-mcp`.
