import { useEffect, useState, type ReactNode } from 'react';
import { useUIStore } from '@/store/ui-store';
import { getOrCreatePairingCode, getMcpEnabled, setMcpEnabled } from '@/lib/mcp/pairing';
import { startMcpBridge } from '@/lib/mcp/bridge-client';
import { CheckBadge, StepFooter, StepTitle, Waiting, openTab } from './SetupSteps';
import { ConfigureAnimation, EnabledIllustration, InstallAnimation, PermissionsAnimation } from './ClaudeIllustrations';
import { SEND_LIMIT_PER_HOUR } from '@/lib/mcp/permissions';

/**
 * The setup wizard's MCP connector step: installing inflow.mcpb in Claude
 * Desktop as one checklist on one screen, following what Claude actually shows.
 *
 * Every instruction is visible at once as a numbered row with its action
 * inline (download, the pairing code with Copy, the live connection status).
 * The current row opens to show its animation and a Done button that ticks it
 * and opens the next; any row can be opened again. "Enabled" doesn't ask: it
 * ticks itself when the connector actually reaches inflow.
 *
 * This lives in the wizard only. The MCP connector section's Set up button
 * opens the wizard here rather than keeping a second copy.
 */
export type GuideRow = 'download' | 'install' | 'code' | 'enable' | 'allow';
export const GUIDE_ROWS: GuideRow[] = ['download', 'install', 'code', 'enable', 'allow'];

/** How long to wait for a connection before offering troubleshooting. */
export const CONNECT_HELP_AFTER_MS = 30_000;

const TRY_PROMPT = 'Who in my network have I not talked to in the last six months?';

function B({ children }: { children: string }) {
  return <b className="font-medium text-fg">{children}</b>;
}

interface Props {
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

export function ConnectorGuide({ onBack, onSkip, onFinish }: Props) {
  const connected = useUIStore((s) => s.mcpStatus === 'connected');
  // Why the connector can't connect, when inflow knows (an outdated connector,
  // or one that couldn't prove it has the pairing code).
  const problem = useUIStore((s) => (s.mcpStatus === 'error' ? s.mcpError : null));
  // Already connected: everything up to the connection is evidently done.
  const [done, setDone] = useState<Set<GuideRow>>(
    () => new Set(connected ? (['download', 'install', 'code', 'enable'] as GuideRow[]) : []),
  );
  const [open, setOpen] = useState<GuideRow | null>(connected ? 'allow' : 'download');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState<'code' | 'prompt' | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    getOrCreatePairingCode().then(setCode);
  }, []);

  // Connecting proves the earlier rows were done; tick them and move on.
  useEffect(() => {
    if (!connected) return;
    setDone((d) => new Set([...d, 'download', 'install', 'code', 'enable']));
    // Whatever row was open is now done; permissions is what's left.
    setOpen('allow');
  }, [connected]);

  // Waiting on the Enabled row: make sure inflow's side is listening (it can be
  // switched off with Disconnect), and offer help if nothing arrives.
  useEffect(() => {
    if (open !== 'enable' || connected) return;
    let alive = true;
    void (async () => {
      if (!(await getMcpEnabled())) {
        await setMcpEnabled(true);
        if (alive) startMcpBridge(await getOrCreatePairingCode());
      }
    })();
    setSlow(false);
    const t = setTimeout(() => alive && setSlow(true), CONNECT_HELP_AFTER_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, connected]);

  /** Tick a row and open the next one still to do. */
  const complete = (row: GuideRow) => {
    const nextDone = new Set([...done, row]);
    setDone(nextDone);
    setOpen(GUIDE_ROWS.find((r) => !nextDone.has(r)) ?? null);
  };

  const copy = (text: string, what: 'code' | 'prompt') => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const mcpbUrl = (() => {
    try {
      return chrome.runtime.getURL('inflow.mcpb');
    } catch {
      return '#';
    }
  })();

  const smallButton =
    'shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-edge text-fg-secondary transition-colors hover:text-fg-strong';

  return (
    <>
      <StepTitle title="Set up the MCP connector">
        The MCP connector lets Claude Desktop search your connections, read network stats, and draft messages into
        your Outbox. It sends nothing unless you allow it in Settings › AI › Claude. It needs the{' '}
        <button onClick={() => openTab('https://claude.ai/download')} className="font-medium text-blue-500 underline hover:text-blue-400">
          Claude Desktop app
        </button>
        .
      </StepTitle>

      {connected && (
        <p className="-mt-2 mb-4 inline-flex items-center gap-2 text-sm font-medium text-fg-strong">
          <CheckBadge /> Connected to Claude Desktop.
        </p>
      )}

      <ol aria-label="MCP connector steps" className="space-y-1.5">
        <Row
          n={1}
          title="Download inflow.mcpb"
          done={done.has('download')}
          open={open === 'download'}
          onToggle={() => setOpen(open === 'download' ? null : 'download')}
          action={
            <a href={mcpbUrl} download="inflow.mcpb" onClick={() => complete('download')} className={smallButton}>
              Download
            </a>
          }
        >
          <p>
            One small file that installs into Claude Desktop. It talks to inflow on this computer, and to Gemini or
            Anthropic only if you give it a key.
          </p>
        </Row>

        <Row
          n={2}
          title="Open it, and click Install twice"
          done={done.has('install')}
          open={open === 'install'}
          onToggle={() => setOpen(open === 'install' ? null : 'install')}
          onDone={() => complete('install')}
        >
          <p className="mb-3">
            Double-click <B>inflow.mcpb</B> in your Downloads. Claude Desktop opens on inflow's page: click{' '}
            <B>Install</B>, then <B>Install</B> again to confirm. Claude shows the same warning for any extension
            installed from a file.
          </p>
          <Drawing>
            <InstallAnimation />
          </Drawing>
        </Row>

        <Row
          n={3}
          title="Paste your pairing code"
          done={done.has('code')}
          open={open === 'code'}
          onToggle={() => setOpen(open === 'code' ? null : 'code')}
          onDone={() => complete('code')}
          action={
            <span className="flex items-center gap-1.5">
              <code className="rounded bg-surface px-2 py-0.5 font-mono text-xs tracking-widest text-fg-strong ring-1 ring-inset ring-edge">
                {code || '········'}
              </code>
              <button onClick={() => copy(code, 'code')} disabled={!code} className={smallButton}>
                {copied === 'code' ? 'Copied' : 'Copy'}
              </button>
            </span>
          }
        >
          <p className="mb-3">
            Claude asks you to configure inflow next. Paste the code into <B>inflow pairing code</B> and click{' '}
            <B>Save</B>. The two key fields are optional; a key pasted there stays out of the browser entirely.
          </p>
          <Drawing>
            <ConfigureAnimation />
          </Drawing>
        </Row>

        <Row
          n={4}
          title="Check it says Enabled"
          done={done.has('enable')}
          open={open === 'enable'}
          onToggle={() => setOpen(open === 'enable' ? null : 'enable')}
          action={
            connected ? (
              <span className="text-xs font-medium text-green-600 dark:text-green-400">Connected</span>
            ) : (
              <Waiting>
                <span className="text-xs">Waiting…</span>
              </Waiting>
            )
          }
        >
          <p className="mb-3">
            Back on inflow's page in Claude, the switch should read <B>Enabled</B>. This ticks itself once the
            connector reaches inflow.
          </p>
          <Drawing>
            <EnabledIllustration />
          </Drawing>
          {!connected && problem && (
            <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3.5 py-3 text-xs text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
              {problem}
            </p>
          )}
          {!connected && !problem && slow && (
            <div className="mt-3 rounded-lg bg-surface px-3.5 py-3 text-xs text-fg-secondary ring-1 ring-inset ring-edge">
              <p className="mb-1 font-medium text-fg-strong">Still waiting? Try these:</p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>In Claude, open Settings › Extensions › inflow and check the pairing code matches.</li>
                <li>Quit Claude Desktop completely and open it again.</li>
                <li>Keep this inflow tab open. The connector reaches inflow through it.</li>
              </ul>
            </div>
          )}
        </Row>

        <Row
          n={5}
          title="Set Tool permissions to Always allow"
          done={done.has('allow')}
          open={open === 'allow'}
          onToggle={() => setOpen(open === 'allow' ? null : 'allow')}
          onDone={() => complete('allow')}
        >
          <p className="mb-2">
            So Claude doesn't ask before every lookup: in Claude, open <B>Settings › Extensions › inflow</B>, and under{' '}
            <B>Tool permissions</B> set <B>Other tools</B> to <B>Always allow</B>.
          </p>
          <p className="mb-3">
            That also covers the actions you allow in inflow's <B>Settings › AI › Claude</B>, like archiving or
            sending: Claude won't ask before doing them. They're all off until you turn them on there, and sending is
            capped at {SEND_LIMIT_PER_HOUR} messages an hour.
          </p>
          <Drawing>
            <PermissionsAnimation />
          </Drawing>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-surface px-3.5 py-2.5 ring-1 ring-inset ring-edge">
            <p className="flex-1 text-xs text-fg-secondary">
              Then try asking Claude: <span className="text-fg-strong">“{TRY_PROMPT}”</span>
            </p>
            <button onClick={() => copy(TRY_PROMPT, 'prompt')} className="shrink-0 text-xs font-medium text-blue-500 hover:text-blue-400">
              {copied === 'prompt' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </Row>
      </ol>

      <StepFooter
        onBack={onBack}
        primary={{ label: 'Continue', onClick: onFinish, disabled: !connected }}
        secondary={connected ? undefined : { label: 'Skip for now', onClick: onSkip }}
      />
    </>
  );
}

function Row({
  n,
  title,
  done,
  open,
  onToggle,
  onDone,
  action,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  /** Shown as a Done button in the open row; rows that tick themselves omit it. */
  onDone?: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li
      aria-current={open ? 'step' : undefined}
      className={`rounded-lg ring-1 ring-inset transition-colors ${open ? 'bg-surface-input ring-edge' : 'ring-transparent'}`}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <button onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {done ? (
            <CheckBadge />
          ) : (
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                open ? 'bg-blue-500 text-white' : 'bg-surface-input text-fg-muted ring-1 ring-inset ring-edge'
              }`}
            >
              {n}
            </span>
          )}
          <span className={`truncate text-sm ${open ? 'font-medium text-fg-strong' : done ? 'text-fg-secondary' : 'text-fg-strong'}`}>
            {title}
          </span>
        </button>
        {action}
      </div>
      {open && (
        <div className="px-3 pb-3 pl-11 text-xs leading-relaxed text-fg-secondary">
          {children}
          {onDone && (
            <div className="mt-3 flex justify-end">
              <button onClick={onDone} className="rounded-md btn-primary px-3 py-1.5 text-xs font-medium">
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * A Claude Desktop drawing at checklist size. The drawings are laid out in
 * fixed pixels (their cursors move by coordinate), so they're scaled with
 * `zoom`, which scales the layout box and the animation together. At full
 * size an open row pushed the rest of the checklist out of view.
 */
function Drawing({ children }: { children: ReactNode }) {
  return <div style={{ zoom: 0.75 }}>{children}</div>;
}
