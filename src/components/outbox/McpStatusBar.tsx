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
 * The MCP (Claude co-worker) status + live activity feed, shown at the top of
 * the Outbox. Reflects the local bridge state and lists what Claude has been
 * doing (searches, drafts) as it happens. Setup is a companion app the user runs.
 */
export function McpStatusBar() {
  const status = useUIStore((s) => s.mcpStatus);
  const error = useUIStore((s) => s.mcpError);
  const activity = useUIStore((s) => s.mcpActivity);
  const [showSetup, setShowSetup] = useState(false);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  const CLAUDE_CONFIG = JSON.stringify(
    { mcpServers: { inflow: { command: 'npx', args: ['-y', 'inflow-mcp'] } } },
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
        <span className="flex items-center gap-1.5 text-sm font-medium text-fg-strong">
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
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

      {showSetup && !connected && (
        <div className="border-t border-edge px-3 py-2.5 text-xs leading-relaxed text-fg-secondary">
          <p className="font-medium text-fg-strong">Let Claude work with your network</p>
          <ol className="mt-1.5 ml-4 list-decimal space-y-1.5 marker:text-fg-faint">
            <li>
              In a terminal, run{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono">npx inflow-mcp</code> — it prints a pairing code.
            </li>
            <li>
              Add inflow to Claude Desktop’s config, then restart it:{' '}
              <button
                onClick={copyConfig}
                className="cursor-pointer rounded bg-surface px-1 py-0.5 font-mono text-blue-600 hover:underline dark:text-blue-300"
              >
                {copied ? 'copied ✓' : 'copy config'}
              </button>
            </li>
            <li>Paste the pairing code below and connect.</li>
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

      {activity.length > 0 && (
        <div className="border-t border-edge px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Recent activity</p>
          <ul className="space-y-1">
            {activity.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-baseline gap-2 text-xs text-fg-secondary">
                <span className="min-w-0 flex-1 truncate">{a.text}</span>
                <span className="shrink-0 text-[10px] text-fg-faint">
                  {formatDistanceToNowStrict(new Date(a.at), { addSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
