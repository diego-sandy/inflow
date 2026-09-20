import { useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useUIStore, type McpStatus } from '@/store/ui-store';
import { SparkleIcon } from '@/components/common/SparkleIcon';
import { setPairingToken, clearPairingToken } from '@/lib/mcp/pairing';
import { startMcpBridge, stopMcpBridge } from '@/lib/mcp/bridge-client';

const STATUS_META: Record<McpStatus, { label: string; dot: string }> = {
  disconnected: { label: 'Claude not connected', dot: 'bg-fg-faint' },
  connecting: { label: 'Connecting to Claude…', dot: 'bg-amber-500 animate-pulse' },
  connected: { label: 'Claude connected', dot: 'bg-emerald-500' },
  error: { label: 'Claude connection error', dot: 'bg-red-500' },
};

/**
 * The MCP (Claude co-worker) status bar at the top of the connector section.
 * Click the status to reveal an inline log of what's happening (connection
 * events + what Claude did), like the inbox's "Up to date" popover — no window.
 */
export function McpStatusBar() {
  const status = useUIStore((s) => s.mcpStatus);
  const error = useUIStore((s) => s.mcpError);
  const activity = useUIStore((s) => s.mcpActivity);
  const [showSetup, setShowSetup] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  // Not published to npm yet — the companion runs from the local inflow checkout.
  const CLAUDE_CONFIG = JSON.stringify(
    { mcpServers: { inflow: { command: 'node', args: ['/absolute/path/to/inflow/mcp-companion/src/index.mjs'] } } },
    null,
    2,
  );

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(CLAUDE_CONFIG);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const meta = STATUS_META[status];
  const connected = status === 'connected';

  const pairAndConnect = async () => {
    const token = code.trim();
    if (!token) return;
    await setPairingToken(token);
    startMcpBridge(token);
    setCode('');
    setShowSetup(false);
  };

  const disconnect = async () => {
    stopMcpBridge();
    await clearPairingToken();
  };

  return (
    <div className="rounded-xl border border-edge bg-surface-raised">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <SparkleIcon className="h-4 w-4 text-blue-500 dark:text-blue-300" />
        {/* Click the status to open the inline log. */}
        <button
          onClick={() => setLogsOpen((v) => !v)}
          aria-expanded={logsOpen}
          title="Show connection log"
          className="flex items-center gap-1.5 text-sm font-medium text-fg-strong"
        >
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          {meta.label}
          <svg className={`h-3 w-3 text-fg-faint transition-transform ${logsOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <span className="flex-1" />
        {connected ? (
          <button
            onClick={disconnect}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-fg-muted ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={() => setShowSetup((v) => !v)}
            aria-expanded={showSetup}
            className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
          >
            Connect Claude
          </button>
        )}
      </div>

      {status === 'error' && error && (
        <p className="px-3 pb-2 text-[11px] text-red-500 dark:text-red-400">{error}</p>
      )}

      {/* Inline log — connection events + what Claude did. */}
      {logsOpen && (
        <div className="border-t border-edge px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Connection log</p>
          {activity.length === 0 ? (
            <p className="py-1 text-xs text-fg-faint">No activity yet.</p>
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

      {showSetup && !connected && (
        <div className="border-t border-edge px-3 py-2.5 text-xs leading-relaxed text-fg-secondary">
          <p className="font-medium text-fg-strong">Let Claude work with your network</p>
          <p className="mt-1 text-[11px] text-fg-faint">
            The inflow companion isn’t on npm yet, so for now it runs from your inflow checkout.
          </p>
          <ol className="mt-1.5 ml-4 list-decimal space-y-1.5 marker:text-fg-faint">
            <li>
              In <code className="rounded bg-surface px-1 py-0.5 font-mono">inflow/mcp-companion</code>, run{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono">npm install</code> once.
            </li>
            <li>
              Add inflow to Claude Desktop’s config (
              <button
                onClick={copyConfig}
                className="cursor-pointer rounded bg-surface px-1 py-0.5 font-mono text-blue-600 hover:underline dark:text-blue-300"
              >
                {copied ? 'copied ✓' : 'copy config'}
              </button>
              ) — set the path to your checkout — then restart Claude.
            </li>
            <li>It connects automatically; if not, paste the companion’s pairing code below.</li>
          </ol>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void pairAndConnect(); }}
              placeholder="Pairing code"
              className="min-w-0 flex-1 rounded-md bg-surface-input px-2.5 py-1.5 text-xs text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
            />
            <button
              onClick={() => void pairAndConnect()}
              disabled={!code.trim()}
              className="shrink-0 rounded-md bg-blue-500/15 px-2.5 py-1.5 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 disabled:opacity-40 dark:text-blue-300"
            >
              Pair &amp; connect
            </button>
          </div>
          <p className="mt-2 text-[11px] text-fg-faint">
            Claude only reads your network and drafts messages — it never sends. You always send from the Outbox.
          </p>
        </div>
      )}
    </div>
  );
}
