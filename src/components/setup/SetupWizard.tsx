import { useCallback, useEffect, useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useToolbarPinned } from '@/hooks/useToolbarPinned';
import { useHasAIKey } from '@/hooks/useHasAIKey';
import {
  SETUP_STEPS,
  completeSetup,
  dismissSetup,
  getSetupStep,
  getSetupCompletedAt,
  isSetupPending,
  setSetupStep,
  type SetupStep,
} from '@/lib/setup-state';
import { AIStep, CheckBadge, DoneStep, KeyStep, LinkedInStep, PinStep, WelcomeStep, type StepContext } from './SetupSteps';
import { ClaudeStep } from './ClaudeStep';

const STEP_LABELS: Record<SetupStep, string> = {
  welcome: 'Welcome',
  linkedin: 'Sign in to LinkedIn',
  pin: 'Pin to the toolbar',
  ai: 'Choose what AI does',
  key: 'Add an AI key',
  claude: 'MCP connector',
  done: 'All set',
};

interface Props {
  /**
   * Rendered by the sign-in gate before there is an app: always open, can't be
   * closed (nothing works without LinkedIn), and stops at the LinkedIn step.
   * Once sign-in succeeds the app mounts and its own wizard carries on from the
   * saved step.
   */
  standalone?: boolean;
  auth?: 'authenticated' | 'unauthenticated';
  onCheckAuth?: () => void;
}

/**
 * First-run setup: one decision per screen, every step skippable but LinkedIn,
 * and steps that are already done show as done. It opens on its own only after
 * a fresh install, resumes where it was left, and Settings › About can run it
 * again from the start.
 */
export function SetupWizard({ standalone = false, auth = 'authenticated', onCheckAuth }: Props) {
  const storeOpen = useUIStore((s) => s.setupOpen);
  const fromStart = useUIStore((s) => s.setupFromStart);
  const startStep = useUIStore((s) => s.setupStartStep);
  const openSetup = useUIStore((s) => s.openSetup);
  const closeSetup = useUIStore((s) => s.closeSetup);
  const open = standalone || storeOpen;

  const [step, setStep] = useState<SetupStep | null>(null);
  const [aiSkipped, setAiSkipped] = useState(false);

  // In the app, open on our own after a fresh install.
  useEffect(() => {
    if (standalone) return;
    isSetupPending().then((pending) => {
      if (pending) openSetup();
    });
  }, [standalone, openSetup]);

  // Where to start each time it opens: a step asked for by name (the MCP
  // connector section's Set up), Welcome when running setup again, otherwise
  // the saved step. The standalone wizard never goes past LinkedIn.
  useEffect(() => {
    if (!open) {
      setStep(null);
      return;
    }
    if (startStep && !standalone) {
      setStep(startStep);
      return;
    }
    if (fromStart) {
      setStep('welcome');
      return;
    }
    getSetupStep().then((saved) => {
      const i = SETUP_STEPS.indexOf(saved);
      setStep(standalone && i > SETUP_STEPS.indexOf('linkedin') ? 'linkedin' : saved);
    });
  }, [open, fromStart, startStep, standalone]);

  const go = useCallback(
    (next: SetupStep) => {
      if (standalone && SETUP_STEPS.indexOf(next) > SETUP_STEPS.indexOf('linkedin')) return;
      setStep(next);
      void setSetupStep(next);
    },
    [standalone],
  );

  const index = step ? SETUP_STEPS.indexOf(step) : 0;
  const ctx: StepContext = {
    auth,
    onCheckAuth,
    go,
    next: () => go(SETUP_STEPS[Math.min(index + 1, SETUP_STEPS.length - 1)]),
    back: () => go(SETUP_STEPS[Math.max(index - 1, 0)]),
    finish: () => {
      void completeSetup();
      closeSetup();
    },
    aiSkipped,
    setAiSkipped,
  };

  const close = useCallback(() => {
    void dismissSetup();
    closeSetup();
  }, [closeSetup]);

  // Escape closes, except before sign-in, where there is nothing to go back to.
  useEffect(() => {
    if (!open || standalone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, standalone, close]);

  const pinned = useToolbarPinned(open);
  const hasKey = useHasAIKey();
  const mcpConnected = useUIStore((s) => s.mcpStatus === 'connected');
  const [completedBefore, setCompletedBefore] = useState(false);
  useEffect(() => {
    if (open) getSetupCompletedAt().then((at) => setCompletedBefore(at !== null));
  }, [open]);
  if (!open || !step) return null;

  // Ticks reflect what's actually true, so running setup again on a working
  // install shows it as working, rather than ticking only what was clicked
  // past this time.
  const isDone = (s: SetupStep): boolean => {
    const passed = SETUP_STEPS.indexOf(s) < index;
    switch (s) {
      case 'welcome':
        return passed || completedBefore;
      case 'linkedin':
        return auth === 'authenticated';
      case 'pin':
        return pinned === true;
      case 'ai':
        // A working key means AI was set up; so does finishing setup before.
        return passed || hasKey || completedBefore;
      case 'key':
        return hasKey;
      case 'claude':
        return mcpConnected;
      case 'done':
        // Everything that matters is in place. Pinning counts when Chrome
        // can't report it (null), since the user can't be held to it then.
        return auth === 'authenticated' && pinned !== false && (hasKey || aiSkipped);
    }
  };

  return (
    <div
      className={`flex items-center justify-center p-4 ${
        standalone ? 'h-screen bg-surface' : 'fixed inset-0 z-[60] bg-black/60'
      }`}
      // Clicking outside closes, like Settings. Progress is kept either way.
      onClick={standalone ? undefined : (e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Set up inflow"
        className="flex h-[min(660px,100%)] w-[min(780px,100%)] overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-ring"
      >
        {/* Step list */}
        <nav aria-label="Setup steps" className="hidden w-56 shrink-0 flex-col gap-1 border-r border-edge bg-surface-raised p-4 sm:flex">
          <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">Set up inflow</p>
          {SETUP_STEPS.map((s, i) => {
            const current = s === step;
            const reachable = !standalone || i <= SETUP_STEPS.indexOf('linkedin');
            return (
              <button
                key={s}
                onClick={() => reachable && go(s)}
                disabled={!reachable}
                aria-current={current ? 'step' : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  current ? 'bg-surface-hover font-medium text-fg-strong' : 'text-fg-secondary hover:bg-surface-hover'
                }`}
              >
                {isDone(s) ? (
                  <CheckBadge />
                ) : (
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                      current ? 'bg-blue-500 text-white' : 'bg-surface-input text-fg-muted'
                    }`}
                  >
                    {i + 1}
                  </span>
                )}
                {STEP_LABELS[s]}
              </button>
            );
          })}
        </nav>

        {/* Current step */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {!standalone && (
            <button
              onClick={close}
              aria-label="Close setup"
              title="Close. You can finish setup later in Settings."
              // z-10: each step animates in with a transform, which lifts it into its
              // own layer above anything earlier in the DOM. Without this the step
              // covered the button and clicks never reached it.
              className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
          <p className="px-7 pt-6 text-xs text-fg-faint sm:hidden">
            Step {index + 1} of {SETUP_STEPS.length}
          </p>
          <div key={step} className="animate-setup-step flex min-h-0 flex-1 flex-col overflow-y-auto px-7 pb-6 pt-6">
            {step === 'welcome' && <WelcomeStep ctx={ctx} />}
            {step === 'linkedin' && <LinkedInStep ctx={ctx} />}
            {step === 'pin' && <PinStep ctx={ctx} />}
            {step === 'ai' && <AIStep ctx={ctx} />}
            {step === 'key' && <KeyStep ctx={ctx} />}
            {step === 'claude' && <ClaudeStep ctx={ctx} />}
            {step === 'done' && <DoneStep ctx={ctx} />}
          </div>
        </div>
      </div>
    </div>
  );
}
