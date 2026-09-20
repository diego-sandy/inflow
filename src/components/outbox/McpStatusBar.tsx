import { useEffect, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useUIStore, type McpStatus } from '@/store/ui-store';
import { SparkleIcon } from '@/components/common/SparkleIcon';
import { getOrCreatePairingCode } from '@/lib/mcp/pairing';
import { stopMcpBridge } from '@/lib/mcp/bridge-client';

const STATUS_META: Record<McpStatus, { label: string; dot: string }> = {
  disconnected: { label: 'Claude not connected', dot: 'bg-fg-faint' },
  connecting: { label: 'Connecting to Claude…', dot: 'bg-amber-500 animate-pulse' },
  connected: { label: 'Claude connected', dot: 'bg-emerald-500' },
  error: { label: 'Claude connection error', dot: 'bg-red-500' },
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
  const [showSetup, setShowSetup] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getOrCreatePairingCode().then((c) => { if (!cancelled) setPairCode(c); });
    return () => { cancelled = true; };
  }, []);

  const meta = STATUS_META[status];
  const connected = status === 'connected';

  // The companion bundle ships inside the extension for a one-click download.
  const mcpbUrl = (() => {
    try {
      return chrome.runtime.getURL('inflow.mcpb');
    } catch {
      return '#';
    }
  })();

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(pairCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="rounded-xl border border-edge bg-surface-raised">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <SparkleIcon className="h-4 w-4 text-blue-500 dark:text-blue-300" />
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
            onClick={() => stopMcpBridge()}
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
        <div className="space-y-3 border-t border-edge px-3 py-2.5 text-xs leading-relaxed text-fg-secondary">
          <p className="font-medium text-fg-strong">Connect Claude to your network</p>

          {/* The code inflow owns — the user hands it to Claude at install. */}
          <div className="rounded-lg bg-surface-input px-2.5 py-2 ring-1 ring-inset ring-edge">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Your pairing code</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="font-mono text-sm font-semibold tracking-widest text-fg-strong">{pairCode || '····-····'}</code>
              <button
                onClick={copyCode}
                className="ml-auto rounded-md bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
              >
                {copied ? 'copied ✓' : 'Copy'}
              </button>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              Recommended · Claude Desktop extension
            </p>
            <ol className="mt-1 ml-4 list-decimal space-y-1 marker:text-fg-faint">
              <li>Download the inflow companion below.</li>
              <li>In Claude Desktop → Settings → Extensions, install the downloaded <code className="rounded bg-surface px-1 py-0.5 font-mono">inflow.mcpb</code>.</li>
              <li>When it asks for the pairing code, paste the one above, then restart Claude. No terminal.</li>
            </ol>
            <a
              href={mcpbUrl}
              download="inflow.mcpb"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-blue-500/15 px-2.5 py-1.5 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
              </svg>
              Download inflow.mcpb
            </a>
          </div>

          <p className="text-[11px] text-fg-faint">
            inflow connects automatically once Claude has the code. Claude only reads your network and drafts messages — it never sends. You always send from the Outbox.
          </p>
        </div>
      )}
    </div>
  );
}
