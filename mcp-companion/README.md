# inflow-mcp

Local MCP companion for the [inflow](../) LinkedIn extension. It lets **Claude** (and other MCP clients) use your inflow data as a toolbox — searching your connections, reading network stats, and drafting messages into your Outbox.

**inflow is the toolbox; the AI is the brain.** This companion is a thin relay: the real tools live in the inflow browser extension, which connects out to this process over `127.0.0.1`. The MCP client connects to this process over stdio.

## Safety

The AI can **see** your network and **draft** messages into your Outbox — it can **never send**. Sending always stays a manual action inside inflow.

## How it works

```
MCP client  ──stdio (MCP)──▶  inflow-mcp  ──ws://127.0.0.1:8123──▶  inflow extension tab
 (the brain)                   (relay)                                (tools + your data)
```

inflow generates a **pairing code** and shows it in the app (MCP connector → Connect Claude). The client passes that code to the companion (`INFLOW_PAIRING_CODE`); the companion only accepts the extension's WebSocket handshake when the codes match. It notifies the client when tools appear/disappear, exits when the client quits (no orphaned port holders), and retries the port if a stale instance is still up.

### Running AI keys through the companion (optional)

The companion can also run inflow's AI requests **server-side**, so your API key stays **out of the browser**. This is optional for both providers — inflow works with keys pasted directly into the app — but routing through the companion is more secure, and for **Claude** it's the only path when your Anthropic org blocks browser/CORS access (e.g. BAA/enterprise orgs).

- `ANTHROPIC_API_KEY` — powers inflow's **in-app AI Chat agent** (Claude calling inflow's tools directly, without Claude Desktop) and any other Claude work. Required to run Claude on CORS-blocked orgs.
- `GEMINI_API_KEY` — runs Gemini server-side instead of from the browser.

Set either (or both) in the companion's environment — via the `.mcpb` install prompts, or export them before `node src/index.mjs`. The extension sends each request over the localhost socket; the companion adds the matching key and relays it. On connect, the companion tells the extension which keys it holds, so inflow routes a provider through the companion only when the key is actually set there — otherwise it uses the key you pasted in the app. Leave both unset to use browser keys only (Claude Desktop / MCP tool-relay still work).

```
inflow extension  ──ws (anthropic request)──▶  inflow-mcp  ──https──▶  api.anthropic.com
inflow extension  ──ws (gemini request)─────▶  inflow-mcp  ──https──▶  generativelanguage.googleapis.com
```

---

## Install

### A · Claude Desktop app — recommended, no terminal

Use the bundled extension. This is the whole story for the desktop app — no npm, no config editing.

1. In inflow → **MCP connector → Connect Claude**, copy your **pairing code** and click **Download inflow.mcpb**.
2. In Claude Desktop → **Settings → Extensions**, install the downloaded `inflow.mcpb`.
3. When prompted, paste the **pairing code**. Optionally, paste an **Anthropic API key** and/or a **Gemini API key** in the fields below it to run those providers server-side (required for Claude on orgs that block browser access). Leave them blank if you only want the Claude Desktop integration or you keep your keys in the app.
4. Restart Claude.

inflow connects on its own. Any keys you set stay inside the companion — they're never sent to the browser.

### B · CLI / other MCP clients (Claude Code CLI, Codex, Cline, …)

These clients don't take a `.mcpb` — they run a **command**. Two ways:

**B1 · From a clone (works today, no publish):**

```bash
git clone <inflow repo>
cd inflow/mcp-companion
npm install
npm install -g .      # puts `inflow-mcp` on your PATH (or use `node <path>` below)
```

Then point the client at it, with your pairing code from inflow (and, optionally, an Anthropic and/or Gemini key to run those providers server-side):

```json
{
  "mcpServers": {
    "inflow": {
      "command": "inflow-mcp",
      "env": {
        "INFLOW_PAIRING_CODE": "PASTE-YOUR-CODE",
        "ANTHROPIC_API_KEY": "sk-ant-...   (optional — server-side Claude / in-app agent)",
        "GEMINI_API_KEY": "AIza...         (optional — server-side Gemini)"
      }
    }
  }
}
```

If you skip the global install, use the file directly:

```json
{
  "mcpServers": {
    "inflow": {
      "command": "node",
      "args": ["/absolute/path/to/inflow/mcp-companion/src/index.mjs"],
      "env": {
        "INFLOW_PAIRING_CODE": "PASTE-YOUR-CODE",
        "ANTHROPIC_API_KEY": "sk-ant-...   (optional)",
        "GEMINI_API_KEY": "AIza...         (optional)"
      }
    }
  }
}
```

`ANTHROPIC_API_KEY` and `GEMINI_API_KEY` are both optional — set either to run that provider server-side (Claude requires it on browser/CORS-blocked orgs); omit both to keep your keys in the app or for Claude Desktop / tool-relay use. Whatever you set stays in the companion's environment — never sent to the browser.

**Run it standalone (in-app agent without Claude Desktop):** the companion binds its localhost socket whenever it runs, so you can start it directly and inflow's AI features will use it:

```bash
INFLOW_PAIRING_CODE=PASTE-YOUR-CODE ANTHROPIC_API_KEY=sk-ant-... GEMINI_API_KEY=AIza... inflow-mcp
# or, from a clone: … node mcp-companion/src/index.mjs
```

**B2 · Via npm (only after publishing — see below):** once `inflow-mcp` is on npm, the command becomes `npx -y inflow-mcp` (same `env`). No clone needed.

Restart the client after editing its config.

---

## Building & releasing (maintainers)

### Build the `.mcpb`

```bash
cd mcp-companion
npm install
npm run validate      # check manifest.json
npm run pack          # -> inflow.mcpb (bundles node_modules)
```

From the repo root, `npm run pack:companion` packs it and copies it into `public/inflow.mcpb` so the extension serves the one-click download. Re-run it whenever the companion changes.

### Publish to npm (optional — only to enable `npx inflow-mcp` for CLI clients)

```bash
cd mcp-companion
npm login
npm publish           # public registry; the name `inflow-mcp` must be free
```

Skip this unless you specifically want the `npx inflow-mcp` convenience for non-Desktop clients — the `.mcpb` and the from-a-clone path don't need it.

## Pairing & config

- The code is generated by inflow and shown in **MCP connector → Connect Claude**. After the client has it once, inflow reconnects automatically.
- Port override: `INFLOW_MCP_PORT` (default `8123`) — keep it in sync with the extension.
