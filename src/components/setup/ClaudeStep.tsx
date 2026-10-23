import { useEffect, useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import { getOrCreatePairingCode, getMcpEnabled, setMcpEnabled } from '@/lib/mcp/pairing';
import { startMcpBridge } from '@/lib/mcp/bridge-client';
import { CheckBadge, StepFooter, StepTitle, Waiting, openTab, type StepContext } from './SetupSteps';
import { EnableIllustration, InstallIllustration, PairingIllustration, PermissionIllustration } from './ClaudeIllustrations';

/**
 * Connecting Claude Desktop, one action per screen. This was the hardest part
 * to get through before: a numbered list on the MCP connector page assumed the
 * user knew what an .mcpb was and where Claude keeps extensions.
 *
 * The last screen doesn't ask the user whether it worked: it watches the
 * bridge and turns green when the companion actually connects.
 */
type Phase = 'why' | 'download' | 'install' | 'code' | 'connect' | 'use';
const PHASES: Phase[] = ['why', 'download', 'install', 'code', 'connect', 'use'];

/** How long to wait for a connection before offering troubleshooting. */
export const CONNECT_HELP_AFTER_MS = 30_000;

const TRY_PROMPT = 'Who in my network have I not talked to in the last six months?';

export function ClaudeStep({ ctx }: { ctx: StepContext }) {
  const connected = useUIStore((s) => s.mcpStatus === 'connected');
  // Already connected (running setup again): go straight to the last screen.
  const [phase, setPhase] = useState<Phase>(connected ? 'use' : 'why');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState<'code' | 'prompt' | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    getOrCreatePairingCode().then(setCode);
  }, []);

  // Waiting for the connection: make sure inflow's side is listening for
  // Claude (it can be switched off on the connector page), then give the user
  // help if nothing arrives.
  useEffect(() => {
    if (phase !== 'connect' || connected) return;
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

  const i = PHASES.indexOf(phase);
  const next = () => setPhase(PHASES[Math.min(i + 1, PHASES.length - 1)]);
  const back = () => (i === 0 ? ctx.back() : setPhase(PHASES[i - 1]));
  const skip = { label: 'Skip Claude', onClick: ctx.next };

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
        Connect Claude · {i + 1} of {PHASES.length}
      </p>

      {phase === 'why' && (
        <>
          <StepTitle title="Work with your network in Claude">
            With Claude Desktop connected, you can ask Claude about your network and have it draft messages:
            “find the investors I haven't spoken to this year and draft a note to each.” Drafts land in your
            Outbox. Claude never sends; you do.
          </StepTitle>
          <p className="text-sm text-fg-secondary">
            Optional, and about two minutes. You'll need the Claude Desktop app.{' '}
            <button onClick={() => openTab('https://claude.ai/download')} className="font-medium text-blue-500 underline hover:text-blue-400">
              Get Claude Desktop
            </button>
          </p>
          <StepFooter onBack={back} primary={{ label: 'Set it up', onClick: next }} secondary={skip} />
        </>
      )}

      {phase === 'download' && (
        <>
          <StepTitle title="Download the inflow companion">
            It's a small file that lets Claude Desktop talk to inflow on this computer. Nothing goes through
            the internet between them.
          </StepTitle>
          <a href={mcpbUrl} download="inflow.mcpb" onClick={() => setTimeout(next, 400)} className="inline-block rounded-md btn-primary px-4 py-2 text-sm font-medium">
            Download inflow.mcpb
          </a>
          <StepFooter onBack={back} primary={{ label: 'I have it', onClick: next }} secondary={skip} />
        </>
      )}

      {phase === 'install' && (
        <>
          <StepTitle title="Open it, and install in Claude">
            Open the downloaded <b className="font-medium text-fg">inflow.mcpb</b> from your Downloads.
            Claude Desktop opens and offers to install it. Click <b className="font-medium text-fg">Install</b>.
          </StepTitle>
          <InstallIllustration />
          <p className="mt-3 text-xs text-fg-muted">
            Nothing happened? In Claude Desktop, open Settings › Extensions and drag the file in.
          </p>
          <StepFooter onBack={back} primary={{ label: 'Installed', onClick: next }} secondary={skip} />
        </>
      )}

      {phase === 'code' && (
        <>
          <StepTitle title="Paste your pairing code">
            Claude asks for it right after installing. It's how the companion proves it's talking to your
            inflow. Paste it into <b className="font-medium text-fg">inflow pairing code</b>, then Save.
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
          <PairingIllustration code={code} />
          <p className="mt-3 text-xs text-fg-muted">
            The two key fields are optional. A key pasted there stays in Claude Desktop, out of the browser
            entirely.
          </p>
          <StepFooter onBack={back} primary={{ label: 'Saved', onClick: next }} secondary={skip} />
        </>
      )}

      {phase === 'connect' && (
        <>
          <StepTitle title="Switch it on">
            In Claude Desktop, check that inflow is switched on under Settings › Extensions. This screen turns
            green on its own once Claude connects.
          </StepTitle>
          <EnableIllustration />
          <div className="mt-4 min-h-6">
            {connected ? (
              <p className="inline-flex items-center gap-2 text-sm font-medium text-fg-strong">
                <CheckBadge /> Claude is connected.
              </p>
            ) : (
              <Waiting>Waiting for Claude to connect…</Waiting>
            )}
          </div>
          {!connected && slow && (
            <div className="mt-3 rounded-lg bg-surface-input px-3.5 py-3 text-xs text-fg-secondary">
              <p className="mb-1 font-medium text-fg-strong">Still waiting? Try these:</p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>Quit Claude Desktop completely and open it again.</li>
                <li>Check the pairing code in Claude matches the one on the previous screen.</li>
                <li>Keep this inflow tab open. Claude connects through it.</li>
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

      {phase === 'use' && (
        <>
          <StepTitle title="Try it">
            The first time Claude uses inflow, it asks for permission. Choose{' '}
            <b className="font-medium text-fg">Allow always</b> so it doesn't ask every time.
          </StepTitle>
          <PermissionIllustration />
          <div className="mt-4 rounded-lg bg-surface-input px-3.5 py-3">
            <p className="text-xs text-fg-muted">Ask Claude something like:</p>
            <div className="mt-1 flex items-start gap-2">
              <p className="flex-1 text-sm text-fg-strong">“{TRY_PROMPT}”</p>
              <button onClick={() => copy(TRY_PROMPT, 'prompt')} className="shrink-0 text-xs font-medium text-blue-500 hover:text-blue-400">
                {copied === 'prompt' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          {connected && (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-fg-secondary">
              <CheckBadge /> Claude is connected.
            </p>
          )}
          <StepFooter onBack={back} primary={{ label: 'Continue', onClick: ctx.next }} />
        </>
      )}
    </>
  );
}
