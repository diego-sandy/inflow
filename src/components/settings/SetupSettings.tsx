import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { useUIStore } from '@/store/ui-store';
import { useToolbarPinned } from '@/hooks/useToolbarPinned';
import { useHasAIKey } from '@/hooks/useHasAIKey';
import { getSetupCompletedAt, type SetupStep } from '@/lib/setup-state';
import { StatusLight, type StatusTone } from '@/components/common/StatusLight';

/**
 * Settings › Setup: where the setup wizard lives once the first run is over.
 * Shows where each part of setup stands, checked against the real state (the
 * same checks the wizard ticks from), and opens the wizard at any step, or
 * from the start. It used to be a single button tucked into About.
 */
export function SetupSettings() {
  const openSetup = useUIStore((s) => s.openSetup);
  const pinned = useToolbarPinned(true);
  const hasKey = useHasAIKey();
  const mcpConnected = useUIStore((s) => s.mcpStatus === 'connected');
  const keyIssues = useUIStore((s) => s.aiKeyIssues);
  const rejected = keyIssues.anthropic ? 'Claude' : keyIssues.gemini ? 'Gemini' : null;
  const [completedAt, setCompletedAt] = useState<number | null>(null);

  useEffect(() => {
    getSetupCompletedAt().then(setCompletedAt);
  }, []);

  const rows: { step: SetupStep; label: string; tone: StatusTone | 'none'; status: string }[] = [
    // Settings is inside the app, which only runs once signed in.
    { step: 'linkedin', label: 'Sign in to LinkedIn', tone: 'green', status: 'Signed in' },
    {
      step: 'pin',
      label: 'Pin inflow to the toolbar',
      tone: pinned === true ? 'green' : pinned === false ? 'yellow' : 'none',
      status: pinned === true ? 'Pinned' : pinned === false ? 'Not pinned' : "Chrome can't say",
    },
    {
      step: 'ai',
      label: 'Choose what AI does',
      tone: hasKey || completedAt ? 'green' : 'yellow',
      status: hasKey || completedAt ? 'Chosen' : 'Not yet',
    },
    {
      step: 'key',
      label: 'Add an AI key',
      // A key that's there but refused isn't set up, whatever "added" says.
      tone: rejected ? 'red' : hasKey ? 'green' : 'yellow',
      status: rejected ? `${rejected} rejected a key · see Settings › AI` : hasKey ? 'Added' : 'No key yet',
    },
    {
      step: 'claude',
      label: 'MCP connector',
      tone: mcpConnected ? 'green' : 'none',
      status: mcpConnected ? 'Connected to Claude Desktop' : 'Optional · not connected',
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg-strong">Setup</h3>
          <p className="mt-1 text-xs text-fg-muted">
            {completedAt
              ? `You finished setup on ${format(completedAt, 'MMMM d, yyyy')}. Open any step to change it.`
              : "Setup isn't finished yet. Open a step to carry on, or run it from the start."}
          </p>
        </div>
        <button
          onClick={() => openSetup({ fromStart: true })}
          className="shrink-0 rounded-md btn-primary px-3 py-1.5 text-sm font-medium"
        >
          Run setup from the start
        </button>
      </div>

      <ul aria-label="Setup steps" className="divide-y divide-edge rounded-lg ring-1 ring-inset ring-edge">
        {rows.map((r) => (
          <li key={r.step} className="flex items-center gap-3 px-3.5 py-2.5">
            {r.tone === 'none' ? (
              <span className="h-2 w-2 shrink-0 rounded-full bg-fg-faint/40" aria-hidden="true" />
            ) : (
              <StatusLight tone={r.tone} />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg-strong">{r.label}</p>
              <p className="text-xs text-fg-muted">{r.status}</p>
            </div>
            <button
              onClick={() => openSetup({ step: r.step })}
              aria-label={`Open ${r.label} in setup`}
              className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
            >
              Open
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
