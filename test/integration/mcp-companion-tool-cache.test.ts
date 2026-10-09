/**
 * Regression: the companion advertised tools ONLY while the extension was
 * paired, and emptied the list the moment it disconnected. Claude Desktop calls
 * tools/list at startup — before the inflow tab is open — so it saw a tool-less
 * server and cached that snapshot ("no_tools"), and a second chat/instance
 * never recovered. The catalog is now cached to ~/.inflow-mcp/tools.json and
 * served regardless of whether the extension is currently connected.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COMPANION = join(process.cwd(), 'mcp-companion', 'src', 'index.mjs');

/** Drive the companion over stdio MCP and return the tools/list result. */
function listToolsWithoutExtension(cachedTools: unknown[]): Promise<string[]> {
  const home = mkdtempSync(join(tmpdir(), 'inflow-home-'));
  mkdirSync(join(home, '.inflow-mcp'), { recursive: true });
  writeFileSync(join(home, '.inflow-mcp', 'tools.json'), JSON.stringify(cachedTools));

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [COMPANION], {
      // Isolated HOME (own config dir) and an unused port so this never touches
      // a real companion the developer is running on 8123.
      env: { ...process.env, HOME: home, INFLOW_MCP_PORT: '8193', INFLOW_PAIRING_CODE: 'TEST-0000' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    proc.stdout.on('data', (d) => (out += String(d)));
    proc.on('error', reject);

    const send = (o: object) => proc.stdin.write(JSON.stringify(o) + '\n');
    send({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    setTimeout(() => {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    }, 400);

    setTimeout(() => {
      proc.kill('SIGINT');
      rmSync(home, { recursive: true, force: true });
      const msgs = out.split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean) as any[];
      const res = msgs.find((m) => m.id === 1);
      resolve((res?.result?.tools ?? []).map((t: any) => t.name));
    }, 1800);
  });
}

it('serves the cached tool catalog when no extension is connected', async () => {
  const names = await listToolsWithoutExtension([
    { name: 'search_messages', description: 'd', inputSchema: { type: 'object' } },
    { name: 'create_draft', description: 'd', inputSchema: { type: 'object' } },
  ]);
  expect(names).toEqual(['search_messages', 'create_draft']);
}, 15_000);

it('reports an empty list only when nothing has ever been cached', async () => {
  const names = await listToolsWithoutExtension([]);
  expect(names).toEqual([]);
}, 15_000);
