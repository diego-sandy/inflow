import { useEffect, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useUIStore, type McpStatus } from '@/store/ui-store';
import { SparkleIcon } from '@/components/common/SparkleIcon';
import { StatusLight, type StatusTone } from '@/components/common/StatusLight';
import { getOrCreatePairingCode, getMcpEnabled, setMcpEnabled } from '@/lib/mcp/pairing';
import { startMcpBridge, stopMcpBridge } from '@/lib/mcp/bridge-client';

const STATUS_META: Record<McpStatus, { label: string; tone: StatusTone }> = {
  disconnected: { label: 'Claude not connected', tone: 'red' },
  connecting: { label: 'Connecting to Claude…', tone: 'yellow' },
  connected: { label: 'Claude connected', tone: 'green' },
  error: { label: 'Claude connection error', tone: 'red' },
};

/**
 * The MCP (Claude co-worker) status bar at the top of the connector section.
 * Click the status to reveal an inline connection log (no separate window).
 * inflow owns the pairing code; the user hands it to Claude at install time.
 */
export function McpStatusBar() {
  const status = useUIStore((s) => s.mcpStatus);
  const error = useUIStore((s) => s.mcpError);
  const activity = useUIStore((s) => s.mcpActivity);
  const [logsOpen, setLogsOpen] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copied, setCopied] = useState<null | 'config'>(null);

  useEffect(() => {
    let cancelled = false;
    getOrCreatePairingCode().then((c) => { if (!cancelled) setPairCode(c); });
    getMcpEnabled().then((e) => { if (!cancelled) setEnabled(e); });
    return () => { cancelled = true; };
  }, []);

  const meta = STATUS_META[status];
  const connected = status === 'connected';
  // Shown as on while connected or connecting, even if this card's copy of the
  // setting is stale: the wizard can switch the bridge back on behind it.
  const on = enabled || status === 'connected' || status === 'connecting';

  const turnOn = async () => {
    setEnabled(true);
    await setMcpEnabled(true);
    startMcpBridge(await getOrCreatePairingCode());
  };
  const turnOff = async () => {
    setEnabled(false);
    await setMcpEnabled(false);
    stopMcpBridge();
  };

  // Config for CLI / other MCP clients that run a command (not the .mcpb).
  const cliConfig = JSON.stringify(
    {
      mcpServers: {
        inflow: {
          command: 'node',
          args: ['/absolute/path/to/inflow/mcp-companion/src/index.mjs'],
          env: {
            INFLOW_PAIRING_CODE: pairCode,
            // Optional — only for inflow's in-app AI Chat agent.
            ANTHROPIC_API_KEY: 'sk-ant-...',
          },
        },
      },
    },
    null,
    2,
  );

  // The pairing code itself is copied from the guide; this is the CLI config.
  const copy = async (what: 'config') => {
    try {
      await navigator.clipboard.writeText(cliConfig);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  };

  return (
    <div className="rounded-xl border border-edge bg-surface-raised">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <SparkleIcon className="h-4 w-4 text-blue-500 dark:text-blue-300" />
        <button
          onClick={() => setLogsOpen((v) => !v)}
          aria-expanded={logsOpen}
          title="Show activity log"
          className="flex items-center gap-1.5 text-sm font-medium text-fg-strong"
        >
          <StatusLight tone={meta.tone} />
          {meta.label}
          {activity.length > 0 && (
            <span className="rounded-full bg-surface-input px-1.5 text-[10px] font-semibold tabular-nums text-fg-muted">
              {activity.length}
            </span>
          )}
          <svg className={`h-3 w-3 text-fg-faint transition-transform ${logsOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <span className="flex-1" />
        {!connected && (
          <button
            // The setup guide lives in the wizard, so it exists in one place only.
            onClick={() => useUIStore.getState().openSetup({ step: 'claude' })}
            // Outlined and on a surface at rest, so it reads as a button next to the
            // filled Connect even before the pointer is over it.
            className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-xs font-medium text-fg-secondary shadow-sm ring-1 ring-inset ring-edge transition-colors hover:bg-surface-hover hover:text-fg-strong"
          >
            Set up
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        )}
        {on ? (
          <button
            onClick={turnOff}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-fg-muted ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={turnOn}
            className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
          >
            Connect
          </button>
        )}
      </div>

      {status === 'error' && error && (
        <p className="px-3 pb-2 text-[11px] text-red-500 dark:text-red-400">{error}</p>
      )}

      {/* Inline log — connection events + what Claude did. */}
      {logsOpen && (
        <div className="border-t border-edge px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Activity</p>
          {activity.length === 0 ? (
            <p className="py-1 text-xs text-fg-faint">Connection events, Claude’s reads and drafts, and your sends show up here.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {activity.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 text-xs text-fg-secondary">
                  <span className="min-w-0 flex-1">{a.text}</span>
                  <span className="shrink-0 text-[10px] text-fg-faint">
                    {formatDistanceToNowStrict(new Date(a.at), { addSuffix: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Advanced: CLI / other MCP clients run a command instead of a .mcpb.
          Claude Desktop setup is in the wizard (Set up, above). */}
      {!connected && (
        <div className="border-t border-edge px-3 py-2 text-xs leading-relaxed text-fg-secondary">
          <div>
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted transition-colors hover:text-fg-secondary"
            >
              <svg className={`h-3 w-3 transition-transform ${advancedOpen ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              Advanced · CLI / other MCP clients
            </button>
            {advancedOpen && (
              <div className="mt-1.5 space-y-1.5">
                <p className="text-[11px] text-fg-faint">
                  Claude Code, Codex, and other CLI clients run a command instead of installing a bundle. From a clone:
                </p>
                <ol className="ml-4 list-decimal space-y-1 text-[11px] marker:text-fg-faint">
                  <li>
                    <code className="rounded bg-surface px-1 py-0.5 font-mono">cd inflow/mcp-companion &amp;&amp; npm install</code>
                  </li>
                  <li>
                    Add this to the client’s MCP config (
                    <button
                      onClick={() => copy('config')}
                      className="cursor-pointer rounded bg-surface px-1 py-0.5 font-mono text-blue-600 hover:underline dark:text-blue-300"
                    >
                      {copied === 'config' ? 'copied ✓' : 'copy config'}
                    </button>
                    ) — set the path to your checkout — then restart it.
                  </li>
                </ol>
                <p className="text-[11px] text-fg-faint">
                  It carries your pairing code. (If you later publish <code className="rounded bg-surface px-1 py-0.5 font-mono">inflow-mcp</code> to npm, the command becomes <code className="rounded bg-surface px-1 py-0.5 font-mono">npx -y inflow-mcp</code>.)
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
