import { useEffect, useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import { getOrCreatePairingCode, getMcpEnabled, setMcpEnabled } from '@/lib/mcp/pairing';
import { startMcpBridge } from '@/lib/mcp/bridge-client';
import { CheckBadge, StepFooter, StepTitle, Waiting, openTab } from './SetupSteps';
import { ConfigureAnimation, EnabledIllustration, InstallAnimation, PermissionsAnimation } from './ClaudeIllustrations';

/**
 * Setting up the MCP connector in Claude Desktop, one action per screen,
 * following what Claude actually shows when inflow.mcpb is opened: inflow's
 * page with Install, a confirmation, the Configure form for the pairing
 * code, the Enabled switch, and Tool permissions.
 *
 * Used twice: as the setup wizard's MCP connector step, and in the MCP
 * connector section's Setup panel, so a user who skipped it, or comes back
 * later, gets the same guide rather than a terse list.
 *
 * The connection screen doesn't ask whether it worked: it watches the bridge
 * and turns green when the companion actually connects.
 */
export type GuidePhase = 'why' | 'download' | 'install' | 'configure' | 'enable' | 'permissions';
export const GUIDE_PHASES: GuidePhase[] = ['why', 'download', 'install', 'configure', 'enable', 'permissions'];

/** How long to wait for a connection before offering troubleshooting. */
export const CONNECT_HELP_AFTER_MS = 30_000;

const TRY_PROMPT = 'Who in my network have I not talked to in the last six months?';

function B({ children }: { children: string }) {
  return <b className="font-medium text-fg">{children}</b>;
}

interface Props {
  /** Leave the guide from its first screen (the wizard's previous step). */
  onBack?: () => void;
  /** Leave without finishing; omitted where there's nothing to skip to. */
  onSkip?: () => void;
  onFinish: () => void;
  finishLabel?: string;
  /** Start past the intro, where the surrounding page already explains it. */
  skipIntro?: boolean;
}

export function ConnectorGuide({ onBack, onSkip, onFinish, finishLabel = 'Continue', skipIntro = false }: Props) {
  const connected = useUIStore((s) => s.mcpStatus === 'connected');
  const phases = skipIntro ? GUIDE_PHASES.filter((p) => p !== 'why') : GUIDE_PHASES;
  // Already connected (running setup again): only the last screen is left.
  const [phase, setPhase] = useState<GuidePhase>(connected ? 'permissions' : phases[0]);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState<'code' | 'prompt' | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    getOrCreatePairingCode().then(setCode);
  }, []);

  // Waiting for the connection: make sure inflow's side is listening (it can
  // be switched off with Disconnect), and offer help if nothing arrives.
  useEffect(() => {
    if (phase !== 'enable' || connected) return;
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
  }, [phase, connected]);

  const i = phases.indexOf(phase);
  const next = () => setPhase(phases[Math.min(i + 1, phases.length - 1)]);
  const back = i === 0 ? onBack : () => setPhase(phases[i - 1]);
  const skip = onSkip ? { label: 'Skip for now', onClick: onSkip } : undefined;

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

  return (
    <>
      <p className="mb-2 text-[11px] font-medium text-fg-faint">
        MCP connector · {i + 1} of {phases.length}
      </p>

      {phase === 'why' && (
        <>
          <StepTitle title="Set up the MCP connector">
            The MCP connector lets Claude Desktop work with inflow: search your connections, read network
            stats, and draft messages into your Outbox. Claude never sends; you do.
          </StepTitle>
          <p className="text-sm text-fg-secondary">
            Optional, and about two minutes. It needs the Claude Desktop app.{' '}
            <button onClick={() => openTab('https://claude.ai/download')} className="font-medium text-blue-500 underline hover:text-blue-400">
              Get Claude Desktop
            </button>
          </p>
          <StepFooter onBack={back} primary={{ label: 'Set it up', onClick: next }} secondary={skip} />
        </>
      )}

      {phase === 'download' && (
        <>
          <StepTitle title="Download the connector">
            It's one small file, <B>inflow.mcpb</B>, that installs into Claude Desktop. It talks to inflow on this
            computer, and to Gemini or Anthropic only if you give it a key.
          </StepTitle>
          <a href={mcpbUrl} download="inflow.mcpb" onClick={() => setTimeout(next, 400)} className="inline-block rounded-md btn-primary px-4 py-2 text-sm font-medium">
            Download inflow.mcpb
          </a>
          <StepFooter onBack={back} primary={{ label: 'I have it', onClick: next }} secondary={skip} />
        </>
      )}

      {phase === 'install' && (
        <>
          <StepTitle title="Open it, and install">
            Double-click <B>inflow.mcpb</B> in your Downloads. Claude Desktop opens on inflow's page. Click{' '}
            <B>Install</B>, then <B>Install</B> again to confirm.
          </StepTitle>
          <InstallAnimation />
          <p className="mt-3 text-xs text-fg-muted">
            Claude shows the same warning for every extension installed from a file rather than its directory.
          </p>
          <StepFooter onBack={back} primary={{ label: 'Installed', onClick: next }} secondary={skip} />
        </>
      )}

      {phase === 'configure' && (
        <>
          <StepTitle title="Paste your pairing code">
            Claude then asks you to configure inflow. Paste this into <B>inflow pairing code</B> and click{' '}
            <B>Save</B>. It's how the connector proves it's talking to your inflow.
          </StepTitle>
          <div className="mb-3 flex items-center gap-2">
            <code className="rounded-lg bg-surface-input px-4 py-2 font-mono text-lg tracking-widest text-fg-strong ring-1 ring-inset ring-edge">
              {code || '········'}
            </code>
            <button
              onClick={() => copy(code, 'code')}
              disabled={!code}
              className="rounded-md btn-primary px-3 py-2 text-sm font-medium disabled:opacity-40"
            >
              {copied === 'code' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ConfigureAnimation />
          <p className="mt-3 text-xs text-fg-muted">
            The two key fields are optional. A key pasted there stays in Claude Desktop, out of the browser entirely.
          </p>
          <StepFooter onBack={back} primary={{ label: 'Saved', onClick: next }} secondary={skip} />
        </>
      )}

      {phase === 'enable' && (
        <>
          <StepTitle title="Check it's enabled">
            Back on inflow's page in Claude, the switch should read <B>Enabled</B>. This screen turns green on its
            own once the connector reaches inflow.
          </StepTitle>
          <EnabledIllustration />
          <div className="mt-4 min-h-6">
            {connected ? (
              <p className="inline-flex items-center gap-2 text-sm font-medium text-fg-strong">
                <CheckBadge /> Connected to Claude Desktop.
              </p>
            ) : (
              <Waiting>Waiting for the connector…</Waiting>
            )}
          </div>
          {!connected && slow && (
            <div className="mt-3 rounded-lg bg-surface-input px-3.5 py-3 text-xs text-fg-secondary">
              <p className="mb-1 font-medium text-fg-strong">Still waiting? Try these:</p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>
                  In Claude, open Settings › Extensions › inflow and check the pairing code is the one on the
                  previous screen.
                </li>
                <li>Quit Claude Desktop completely and open it again.</li>
                <li>Keep this inflow tab open. The connector reaches inflow through it.</li>
              </ul>
            </div>
          )}
          <StepFooter
            onBack={back}
            primary={{ label: 'Continue', onClick: next, disabled: !connected }}
            secondary={connected ? undefined : skip}
          />
        </>
      )}

      {phase === 'permissions' && (
        <>
          <StepTitle title="Let Claude use it without asking">
            Otherwise Claude asks before every lookup. In Claude, open <B>Settings › Extensions › inflow</B>, and
            under <B>Tool permissions</B> set <B>Other tools</B> to <B>Always allow</B>.
          </StepTitle>
          <PermissionsAnimation />
          <div className="mt-4 rounded-lg bg-surface-input px-3.5 py-3">
            <p className="text-xs text-fg-muted">Then ask Claude something like:</p>
            <div className="mt-1 flex items-start gap-2">
              <p className="flex-1 text-sm text-fg-strong">“{TRY_PROMPT}”</p>
              <button onClick={() => copy(TRY_PROMPT, 'prompt')} className="shrink-0 text-xs font-medium text-blue-500 hover:text-blue-400">
                {copied === 'prompt' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          {connected && (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-fg-secondary">
              <CheckBadge /> Connected to Claude Desktop.
            </p>
          )}
          <StepFooter onBack={back} primary={{ label: finishLabel, onClick: onFinish }} />
        </>
      )}
    </>
  );
}
