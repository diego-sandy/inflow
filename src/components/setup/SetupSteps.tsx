import { useEffect, useState, type ReactNode } from 'react';
import { useUIStore } from '@/store/ui-store';
import { Toggle } from '@/components/common/Toggle';
import { LogoMark } from '@/components/common/Wordmark';
import { useToolbarPinned } from '@/hooks/useToolbarPinned';
import { useHasAIKey } from '@/hooks/useHasAIKey';
import { useCategorizeMode } from '@/hooks/useCategorizeMode';
import {
  getAISuggestionsEnabled,
  setAISuggestionsEnabled,
  getConnectionInterests,
  setConnectionInterests,
  getGeminiApiKey,
  setGeminiApiKey,
  getAnthropicApiKey,
  setAnthropicApiKey,
  getGeminiModel,
  getAnthropicModel,
  setTierProvider,
} from '@/lib/ai-settings';
import { verifyAnthropicKey, verifyGeminiKey } from '@/lib/ai-key-verify';
import { isDirectoryPickerSupported, pickBackupDirectory, getSavedDirectoryName } from '@/lib/backup-fs';
import { setAutoBackupEnabled } from '@/lib/backup-service';
import { PinIllustration } from './PinIllustration';
import type { SetupStep } from '@/lib/setup-state';

export interface StepContext {
  auth: 'authenticated' | 'unauthenticated';
  onCheckAuth?: () => void;
  go: (step: SetupStep) => void;
  next: () => void;
  back: () => void;
  finish: () => void;
  /** Set when the user chose to skip AI, so later steps can say so. */
  aiSkipped: boolean;
  setAiSkipped: (v: boolean) => void;
}

// --- Shared pieces -----------------------------------------------------------

export function StepFooter({
  onBack,
  primary,
  secondary,
}: {
  onBack?: () => void;
  primary: { label: string; onClick: () => void; disabled?: boolean };
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mt-auto flex items-center gap-2 border-t border-edge pt-4">
      {onBack && (
        <button
          onClick={onBack}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary"
        >
          Back
        </button>
      )}
      <div className="ml-auto flex items-center gap-2">
        {secondary && (
          <button
            onClick={secondary.onClick}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-strong"
          >
            {secondary.label}
          </button>
        )}
        <button
          onClick={primary.onClick}
          disabled={primary.disabled}
          className="rounded-md btn-primary px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
        >
          {primary.label}
        </button>
      </div>
    </div>
  );
}

export function CheckBadge({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`animate-setup-check inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500 text-white ${className}`}
    >
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

export function Waiting({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 text-sm text-fg-muted">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
      </span>
      {children}
    </p>
  );
}

export function StepTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-semibold text-fg-strong">{title}</h2>
      {children && <p className="mt-1.5 text-sm leading-relaxed text-fg-secondary">{children}</p>}
    </div>
  );
}

export function openTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

// --- 1. Welcome --------------------------------------------------------------

export function WelcomeStep({ ctx }: { ctx: StepContext }) {
  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <LogoMark size={44} />
        <div>
          <h2 className="text-xl font-semibold text-fg-strong">Welcome to inflow</h2>
          <p className="text-sm text-fg-muted">Setup takes about three minutes.</p>
        </div>
      </div>
      <ul className="space-y-3 text-sm text-fg-secondary">
        <Point title="Your LinkedIn messages, keyboard first">
          A faster inbox for the messages you already have. No new account.
        </Point>
        <Point title="Your network, sorted for you">
          Optionally, AI tags your connections by role and by what you care about.
        </Point>
        <Point title="Everything stays on this computer">
          Messages, connections and anything the AI works out are stored in your browser. There is no
          inflow server.
        </Point>
      </ul>
      <StepFooter primary={{ label: 'Get started', onClick: ctx.next }} />
    </>
  );
}

function Point({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-lg bg-surface-input px-3.5 py-3">
      <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br from-[#52d8fd] to-[#7b3cf0]" />
      <span>
        <span className="block font-medium text-fg-strong">{title}</span>
        {children}
      </span>
    </li>
  );
}

// --- 2. LinkedIn -------------------------------------------------------------

export function LinkedInStep({ ctx }: { ctx: StepContext }) {
  const signedIn = ctx.auth === 'authenticated';
  let name: string | null = null;
  let picture: string | null = null;
  try {
    name = localStorage.getItem('inflow-account-name');
    picture = localStorage.getItem('inflow-account-picture');
  } catch {}

  return (
    <>
      <StepTitle title="Sign in to LinkedIn">
        inflow uses the LinkedIn session already in this browser, so there is no password to give it.
        Sign in on LinkedIn as you normally would, then come back to this tab.
      </StepTitle>

      {signedIn ? (
        <div className="flex items-center gap-3 rounded-lg bg-green-500/10 px-4 py-3 ring-1 ring-inset ring-green-500/20">
          {picture ? (
            <img src={picture} alt="" className="h-9 w-9 rounded-full" />
          ) : (
            <span className="h-9 w-9 rounded-full bg-surface-input" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg-strong">Signed in{name ? ` as ${name}` : ''}</p>
            <p className="text-xs text-fg-muted">inflow can now read your messages.</p>
          </div>
          <CheckBadge />
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => openTab('https://www.linkedin.com/login')}
            className="rounded-md btn-primary px-4 py-2 text-sm font-medium"
          >
            Open LinkedIn
          </button>
          <div className="flex items-center justify-between gap-3">
            <Waiting>Waiting for you to sign in. This page notices when you come back.</Waiting>
            {ctx.onCheckAuth && (
              <button onClick={ctx.onCheckAuth} className="shrink-0 text-xs text-fg-muted underline hover:text-fg-secondary">
                Check now
              </button>
            )}
          </div>
        </div>
      )}

      <StepFooter
        onBack={ctx.back}
        primary={{ label: 'Continue', onClick: ctx.next, disabled: !signedIn }}
      />
    </>
  );
}

// --- 3. Pin ------------------------------------------------------------------

export function PinStep({ ctx }: { ctx: StepContext }) {
  const pinned = useToolbarPinned(true);

  return (
    <>
      <StepTitle title="Pin inflow to your toolbar">
        Chrome tucks new extensions away in the puzzle-piece menu, where they're easy to lose. Click the
        puzzle piece next to the address bar, then the pin next to inflow.
      </StepTitle>

      <PinIllustration />

      <div className="mt-4 min-h-6">
        {pinned === true && (
          <p className="inline-flex items-center gap-2 text-sm font-medium text-fg-strong">
            <CheckBadge /> Pinned. inflow is one click away now.
          </p>
        )}
        {pinned === false && <Waiting>Waiting for the pin. This ticks itself when you click it.</Waiting>}
      </div>

      <StepFooter
        onBack={ctx.back}
        primary={{ label: 'Continue', onClick: ctx.next, disabled: pinned === false }}
        secondary={pinned === false ? { label: 'Skip', onClick: ctx.next } : undefined}
      />
    </>
  );
}

// --- 4. What AI is for -------------------------------------------------------

export function AIStep({ ctx }: { ctx: StepContext }) {
  const [categorizeMode, setCategorizeMode] = useCategorizeMode();
  const [suggestions, setSuggestions] = useState(true);
  const [interests, setInterests] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    getAISuggestionsEnabled().then(setSuggestions);
    getConnectionInterests().then(setInterests);
  }, []);

  const toggleSuggestions = (on: boolean) => {
    setSuggestions(on);
    void setAISuggestionsEnabled(on);
  };
  const saveInterests = (next: string[]) => {
    setInterests(next);
    void setConnectionInterests(next);
  };
  const addInterest = () => {
    const tag = draft.trim();
    setDraft('');
    if (!tag || interests.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    saveInterests([...interests, tag]);
  };

  return (
    <>
      <StepTitle title="What should AI help with?">
        AI is optional, and you choose what it does. It only ever sees what a job needs: for your
        connections, that's each person's name and headline. Nothing goes back to LinkedIn.
      </StepTitle>

      <div className="space-y-3">
        <ChoiceRow
          title="Sort and tag my connections"
          detail="Gives each person a role, like Founder, Investor or Engineering, and your own tags. This is what powers Connections and Insights."
        >
          <Toggle
            label="Sort and tag my connections"
            checked={categorizeMode === 'auto'}
            onChange={(on) => setCategorizeMode(on ? 'auto' : 'manual')}
          />
        </ChoiceRow>

        {categorizeMode === 'auto' && (
          <div className="rounded-lg bg-surface-input px-3.5 py-3">
            <p className="text-sm font-medium text-fg-strong">Tags to look out for</p>
            <p className="text-xs text-fg-muted">The kinds of people you want found in your network. You can change these any time.</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {interests.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-300">
                  {tag}
                  <button
                    aria-label={`Remove ${tag}`}
                    onClick={() => saveInterests(interests.filter((t) => t !== tag))}
                    className="text-blue-400 hover:text-blue-600"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addInterest();
                  }
                }}
                onBlur={addInterest}
                placeholder="Add a tag, like Hiring"
                className="min-w-[140px] flex-1 bg-transparent px-1 py-1 text-xs text-fg placeholder-fg-faint focus:outline-none"
              />
            </div>
          </div>
        )}

        <ChoiceRow title="Suggest replies as I type" detail="Offers a reply and finishes your sentences while you compose.">
          <Toggle label="Suggest replies as I type" checked={suggestions} onChange={toggleSuggestions} />
        </ChoiceRow>

        <ChoiceRow
          title="Chat and drafting"
          detail="Ask questions about your network and draft messages. Always available once there's a key."
        >
          <span className="text-xs font-medium text-fg-muted">Included</span>
        </ChoiceRow>
      </div>

      <StepFooter
        onBack={ctx.back}
        primary={{
          label: 'Continue',
          onClick: () => {
            ctx.setAiSkipped(false);
            ctx.next();
          },
        }}
        secondary={{
          label: 'Skip AI for now',
          onClick: () => {
            ctx.setAiSkipped(true);
            // Past the key step, not to the end: connecting Claude needs no key.
            ctx.go('claude');
          },
        }}
      />
    </>
  );
}

function ChoiceRow({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg px-1 py-1">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg-strong">{title}</p>
        <p className="text-xs text-fg-muted">{detail}</p>
      </div>
      {children}
    </div>
  );
}

// --- 5. Key ------------------------------------------------------------------

type KeyState = 'idle' | 'testing' | 'error';

export function KeyStep({ ctx }: { ctx: StepContext }) {
  const mcpConnected = useUIStore((s) => s.mcpStatus === 'connected');
  const mcpKeys = useUIStore((s) => s.mcpKeys);
  const [saved, setSaved] = useState<{ gemini: boolean; anthropic: boolean }>({ gemini: false, anthropic: false });
  const [showClaude, setShowClaude] = useState(false);

  useEffect(() => {
    Promise.all([getGeminiApiKey(), getAnthropicApiKey()]).then(([g, a]) => setSaved({ gemini: !!g, anthropic: !!a }));
  }, []);

  const hasGemini = saved.gemini || (mcpConnected && mcpKeys.gemini);
  const hasClaude = saved.anthropic || (mcpConnected && mcpKeys.anthropic);
  const hasKey = hasGemini || hasClaude;

  return (
    <>
      <StepTitle title="Add an AI key">
        A key lets inflow use an AI provider on your behalf. Gemini's is free and covers everything here.
        Keys are stored on this computer and sent only to the provider they belong to.
      </StepTitle>

      <div className="space-y-3">
        <KeyCard
          name="Gemini"
          badge="Recommended · free"
          done={hasGemini}
          steps={[
            <>
              Open{' '}
              <button onClick={() => openTab('https://aistudio.google.com/apikey')} className="font-medium text-blue-500 underline hover:text-blue-400">
                Google AI Studio
              </button>{' '}
              and sign in with a Google account.
            </>,
            <>
              Click <b className="font-medium text-fg">Create API key</b>, then copy it.
            </>,
            <>Paste it here.</>,
          ]}
          placeholder="Paste your Gemini key (AIza…)"
          verify={async (key) => verifyGeminiKey(key, await getGeminiModel('fast'))}
          save={async (key) => {
            await setGeminiApiKey(key);
            setSaved((s) => ({ ...s, gemini: true }));
          }}
        />

        {!showClaude && !hasClaude ? (
          <button onClick={() => setShowClaude(true)} className="text-xs font-medium text-fg-muted underline hover:text-fg-secondary">
            Prefer Claude? Use an Anthropic key instead
          </button>
        ) : (
          <KeyCard
            name="Claude"
            badge="Paid · best writing"
            done={hasClaude}
            steps={[
              <>
                Open{' '}
                <button onClick={() => openTab('https://console.anthropic.com/settings/keys')} className="font-medium text-blue-500 underline hover:text-blue-400">
                  the Anthropic Console
                </button>
                . It needs a little billing credit.
              </>,
              <>
                Click <b className="font-medium text-fg">Create Key</b> and copy it. It's only shown once.
              </>,
              <>Paste it here.</>,
            ]}
            placeholder="Paste your Claude key (sk-ant-…)"
            verify={async (key) => verifyAnthropicKey(key, await getAnthropicModel('fast'))}
            save={async (key) => {
              await setAnthropicApiKey(key);
              // Point the jobs at Claude so the key is actually used: everything,
              // if it's the only key; just the writing, if Gemini is set too.
              if (!saved.gemini) await setTierProvider('fast', 'anthropic');
              await setTierProvider('quality', 'anthropic');
              setSaved((s) => ({ ...s, anthropic: true }));
            }}
          />
        )}
      </div>

      <StepFooter
        onBack={ctx.back}
        primary={{ label: 'Continue', onClick: ctx.next, disabled: !hasKey }}
        secondary={!hasKey ? { label: 'Do this later', onClick: ctx.next } : undefined}
      />
    </>
  );
}

function KeyCard({
  name,
  badge,
  done,
  steps,
  placeholder,
  verify,
  save,
}: {
  name: string;
  badge: string;
  done: boolean;
  steps: ReactNode[];
  placeholder: string;
  verify: (key: string) => Promise<void>;
  save: (key: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [state, setState] = useState<KeyState>('idle');
  const [error, setError] = useState('');

  const submit = async () => {
    const key = value.trim();
    if (!key) return;
    setState('testing');
    setError('');
    try {
      await verify(key);
      await save(key);
      setValue('');
      setState('idle');
    } catch (e: any) {
      setState('error');
      setError(e?.message || 'That key did not work');
    }
  };

  return (
    <div className="rounded-lg bg-surface-input p-3.5 ring-1 ring-inset ring-edge">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-fg-strong">{name}</p>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-fg-muted ring-1 ring-inset ring-edge">{badge}</span>
        {done && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-fg-strong">
            <CheckBadge /> Key added
          </span>
        )}
      </div>
      {!done && (
        <>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-fg-secondary marker:text-fg-faint">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setState('idle');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder={placeholder}
              aria-label={`${name} API key`}
              className="min-w-0 flex-1 rounded-md bg-surface px-3 py-1.5 text-sm text-fg placeholder-fg-faint ring-1 ring-ring focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => void submit()}
              aria-label={`Check and save ${name} key`}
              disabled={!value.trim() || state === 'testing'}
              className="shrink-0 rounded-md btn-primary px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              {state === 'testing' ? 'Checking…' : 'Check and save'}
            </button>
          </div>
          {state === 'error' && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </>
      )}
    </div>
  );
}

// --- 6. Done -----------------------------------------------------------------

export function DoneStep({ ctx }: { ctx: StepContext }) {
  const pinned = useToolbarPinned(true);
  const hasKey = useHasAIKey();
  const mcpConnected = useUIStore((s) => s.mcpStatus === 'connected');
  const [backupFolder, setBackupFolder] = useState<string | null>(null);
  const backupSupported = isDirectoryPickerSupported();

  useEffect(() => {
    getSavedDirectoryName().then(setBackupFolder).catch(() => {});
  }, []);

  const chooseBackup = async () => {
    const picked = await pickBackupDirectory().catch(() => null);
    if (!picked) return;
    setAutoBackupEnabled(true);
    setBackupFolder(picked.name);
  };

  return (
    <>
      <StepTitle title="You're all set">Here's what's ready. Anything skipped can be finished in Settings.</StepTitle>

      <ul className="space-y-2">
        <ChecklistRow
          done={ctx.auth === 'authenticated'}
          label={ctx.auth === 'authenticated' ? 'Signed in to LinkedIn' : 'Sign in to LinkedIn'}
          onFix={() => ctx.go('linkedin')}
        />
        <ChecklistRow
          done={pinned !== false}
          label={pinned !== false ? 'Pinned to the toolbar' : 'Pin inflow to the toolbar'}
          onFix={() => ctx.go('pin')}
        />
        <ChecklistRow
          done={!ctx.aiSkipped && hasKey}
          label={ctx.aiSkipped ? 'AI is off. Turn it on any time' : hasKey ? 'AI key added' : 'Add an AI key'}
          onFix={() => ctx.go(ctx.aiSkipped ? 'ai' : 'key')}
        />
        <ChecklistRow
          done={mcpConnected}
          label={mcpConnected ? 'Claude Desktop connected' : 'Connect Claude Desktop (optional)'}
          onFix={() => ctx.go('claude')}
        />
        {backupSupported && (
          <li className="flex items-center gap-3 rounded-lg bg-surface-input px-3.5 py-2.5">
            {backupFolder ? <CheckBadge /> : <span className="h-5 w-5 shrink-0 rounded-full ring-2 ring-inset ring-fg-faint/40" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg-strong">{backupFolder ? `Backing up to “${backupFolder}”` : 'Back up your AI work'}</p>
              {!backupFolder && <p className="text-xs text-fg-muted">Optional. Saves your connections and their tags to a folder you choose.</p>}
            </div>
            {!backupFolder && (
              <button onClick={() => void chooseBackup()} className="shrink-0 text-xs font-medium text-blue-500 hover:text-blue-400">
                Choose folder
              </button>
            )}
          </li>
        )}
      </ul>

      <div className="mt-4 rounded-lg px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Three keys worth knowing</p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-fg-secondary">
          <Shortcut keys={['J', 'K']}>move up and down</Shortcut>
          <Shortcut keys={['⌘', 'K']}>do anything</Shortcut>
          <Shortcut keys={['?']}>see every shortcut</Shortcut>
        </div>
      </div>

      <StepFooter onBack={ctx.back} primary={{ label: 'Start using inflow', onClick: ctx.finish }} />
    </>
  );
}

function ChecklistRow({ done, label, onFix }: { done: boolean; label: string; onFix: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-lg bg-surface-input px-3.5 py-2.5">
      {done ? <CheckBadge /> : <span className="h-5 w-5 shrink-0 rounded-full ring-2 ring-inset ring-fg-faint/40" />}
      <p className={`min-w-0 flex-1 text-sm ${done ? 'text-fg-strong' : 'text-fg-secondary'}`}>{label}</p>
      {!done && (
        <button onClick={onFix} className="shrink-0 text-xs font-medium text-blue-500 hover:text-blue-400">
          Finish
        </button>
      )}
    </li>
  );
}

function Shortcut({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((k) => (
        <kbd key={k} className="min-w-[1.5rem] rounded border border-edge bg-surface px-1.5 py-0.5 text-center font-mono text-[11px] text-fg-strong shadow-[0_1px_0] shadow-edge">
          {k}
        </kbd>
      ))}
      <span className="text-xs">{children}</span>
    </span>
  );
}
