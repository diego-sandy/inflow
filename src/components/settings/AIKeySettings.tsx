import { useState, useEffect } from 'react';
import { useUIStore } from '@/store/ui-store';
import {
  getGeminiApiKey,
  setGeminiApiKey,
  clearGeminiApiKey,
  getAnthropicApiKey,
  setAnthropicApiKey,
  clearAnthropicApiKey,
  getTierProvider,
  setTierProvider,
  getAnthropicModel,
  setAnthropicModel,
  getGeminiModel,
  setGeminiModel,
  getAISuggestionsEnabled,
  setAISuggestionsEnabled,
  AI_MODEL_CATALOG,
  type AIProvider,
  type AIModelTier,
  type ProviderModelOption,
} from '@/lib/ai-settings';
import { ANTHROPIC_URL, anthropicErrorMessage } from '@/lib/anthropic-client';
import { useCategorizeMode } from '@/hooks/useCategorizeMode';
import { Toggle } from '@/components/common/Toggle';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

/** Small on/off switch row. */
function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg-strong">{label}</p>
        <p className="text-xs text-fg-muted">{description}</p>
      </div>
      <Toggle label={label} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

/** Small provider mark (approximate — not the exact brand logos). */
function ProviderGlyph({ provider, className }: { provider: AIProvider; className?: string }) {
  if (provider === 'anthropic') {
    // Clay burst for Claude / Anthropic.
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="#c96442" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19" />
      </svg>
    );
  }
  // Four-point sparkle for Gemini / Google.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#3b82f6" aria-hidden="true">
      <path d="M12 2c.5 4.5 3 7 7.5 7.5-4.5.5-7 3-7.5 7.5-.5-4.5-3-7-7.5-7.5C9 9 11.5 6.5 12 2Z" />
    </svg>
  );
}

const providerName = (p: AIProvider) => (p === 'anthropic' ? 'Claude' : 'Gemini');

/** Custom dropdown to pick a provider+model together, grouped, with logos + tags. */
function ProviderModelSelect({
  tier,
  provider,
  value,
  onSelect,
}: {
  tier: AIModelTier;
  provider: AIProvider;
  value: string;
  onSelect: (provider: AIProvider, modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current: ProviderModelOption =
    AI_MODEL_CATALOG.find((m) => m.provider === provider && m.id === value) ??
    AI_MODEL_CATALOG.find((m) => m.provider === provider) ??
    AI_MODEL_CATALOG[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg bg-surface-input px-3 py-2 text-left text-sm ring-1 ring-inset ring-edge transition-colors hover:ring-fg-faint"
      >
        <ProviderGlyph provider={current.provider} className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-fg-strong">{current.label}</span>
        <span className="shrink-0 text-xs text-fg-faint">{providerName(current.provider)}</span>
        <svg className={`h-3.5 w-3.5 shrink-0 text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-xl border border-edge bg-surface-raised p-1 shadow-lg">
            {(['gemini', 'anthropic'] as const).map((prov) => (
              <div key={prov}>
                <p className="flex items-center gap-1.5 px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
                  <ProviderGlyph provider={prov} className="h-3 w-3" />
                  {providerName(prov)}{prov === 'gemini' ? ' · Google' : ' · Anthropic'}
                </p>
                {AI_MODEL_CATALOG.filter((m) => m.provider === prov).map((m) => {
                  const active = m.provider === provider && m.id === value;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => { onSelect(m.provider, m.id); setOpen(false); }}
                      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${active ? 'bg-blue-500/15' : 'hover:bg-surface-hover'}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-fg-strong">{m.label}</span>
                          {m.recommendedFor === tier && (
                            <span className="rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">recommended</span>
                          )}
                        </span>
                        <span className="block text-[11px] text-fg-muted">{m.blurb}</span>
                      </span>
                      {active && (
                        <svg className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The AI settings section: pick a provider (Claude or Gemini), manage that
 * provider's API key (with get-a-key instructions), and — for Claude — choose a
 * cheap model for bulk work and a stronger one for writing. Also holds the
 * categorize mode and reply-suggestions toggles. Rendered inside the Settings
 * modal; contains no modal chrome of its own.
 */
export function AIKeySettings() {
  const showToast = useUIStore((s) => s.showToast);

  const [fastProvider, setFastProviderState] = useState<AIProvider>('gemini');
  const [qualityProvider, setQualityProviderState] = useState<AIProvider>('gemini');

  // Gemini key state
  const [geminiInput, setGeminiInput] = useState('');
  const [geminiSaved, setGeminiSaved] = useState<string | null>(null);
  const [geminiShow, setGeminiShow] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<TestStatus>('idle');
  const [geminiError, setGeminiError] = useState('');
  const [geminiFastModel, setGeminiFastModel] = useState('gemini-3.1-flash-lite');
  const [geminiQualityModel, setGeminiQualityModel] = useState('gemini-3.1-flash-lite');

  // Anthropic key state
  const [anthInput, setAnthInput] = useState('');
  const [anthSaved, setAnthSaved] = useState<string | null>(null);
  const [anthShow, setAnthShow] = useState(false);
  const [anthStatus, setAnthStatus] = useState<TestStatus>('idle');
  const [anthError, setAnthError] = useState('');
  const [fastModel, setFastModel] = useState('claude-haiku-4-5');
  const [qualityModel, setQualityModel] = useState('claude-sonnet-5');

  const [suggestionsOn, setSuggestionsOn] = useState(true);
  const [categorizeMode, setCategorizeMode] = useCategorizeMode();

  useEffect(() => {
    getTierProvider('fast').then(setFastProviderState);
    getTierProvider('quality').then(setQualityProviderState);
    getGeminiApiKey().then(setGeminiSaved);
    getAnthropicApiKey().then(setAnthSaved);
    getAnthropicModel('fast').then(setFastModel);
    getAnthropicModel('quality').then(setQualityModel);
    getGeminiModel('fast').then(setGeminiFastModel);
    getGeminiModel('quality').then(setGeminiQualityModel);
    getAISuggestionsEnabled().then(setSuggestionsOn);
  }, []);

  const usesGemini = fastProvider === 'gemini' || qualityProvider === 'gemini';
  const usesAnthropic = fastProvider === 'anthropic' || qualityProvider === 'anthropic';

  // Pick a provider+model for one tier (persists both, updates local state).
  const chooseModel = (tier: AIModelTier, provider: AIProvider, modelId: string) => {
    setTierProvider(tier, provider);
    if (provider === 'anthropic') {
      setAnthropicModel(tier, modelId);
      if (tier === 'fast') setFastModel(modelId); else setQualityModel(modelId);
    } else {
      setGeminiModel(tier, modelId);
      if (tier === 'fast') setGeminiFastModel(modelId); else setGeminiQualityModel(modelId);
    }
    if (tier === 'fast') setFastProviderState(provider); else setQualityProviderState(provider);
  };

  const tierModelId = (tier: AIModelTier): string => {
    const p = tier === 'fast' ? fastProvider : qualityProvider;
    if (p === 'anthropic') return tier === 'fast' ? fastModel : qualityModel;
    return tier === 'fast' ? geminiFastModel : geminiQualityModel;
  };

  // --- Gemini save / remove ------------------------------------------------
  const saveGemini = async () => {
    const key = geminiInput.trim();
    if (!key) return;
    setGeminiStatus('testing');
    setGeminiError('');
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiFastModel}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Say "ok" and nothing else.' }] }],
            generationConfig: { maxOutputTokens: 5 },
          }),
        },
      );
      if (!res.ok) {
        if (res.status === 400) throw new Error('Invalid API key');
        if (res.status === 403) throw new Error('API key not authorized — check AI Studio');
        if (res.status === 429) throw new Error('Rate limit reached — try again in a minute');
        throw new Error(`Request failed (HTTP ${res.status})`);
      }
      await setGeminiApiKey(key);
      setGeminiSaved(key);
      setGeminiInput('');
      setGeminiStatus('idle');
      showToast({ message: 'Gemini API key saved' });
    } catch (e: any) {
      setGeminiStatus('error');
      setGeminiError(e?.message || 'Connection failed');
    }
  };

  const removeGemini = async () => {
    await clearGeminiApiKey();
    setGeminiSaved(null);
    setGeminiInput('');
    setGeminiStatus('idle');
    setGeminiError('');
    showToast({ message: 'Gemini API key removed' });
  };

  // --- Anthropic save / remove ---------------------------------------------
  const saveAnthropic = async () => {
    const key = anthInput.trim();
    if (!key) return;
    setAnthStatus('testing');
    setAnthError('');
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: fastModel,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
        }),
      });
      if (!res.ok) {
        // Surface Anthropic's actual reason (e.g. "credit balance is too low")
        // instead of a generic status message, so the fix is obvious.
        let detail = '';
        try {
          const body = await res.json();
          detail = typeof body?.error?.message === 'string' ? body.error.message : '';
        } catch {}
        throw new Error(detail || anthropicErrorMessage(res.status));
      }
      await setAnthropicApiKey(key);
      setAnthSaved(key);
      setAnthInput('');
      setAnthStatus('idle');
      showToast({ message: 'Claude API key saved' });
    } catch (e: any) {
      setAnthStatus('error');
      setAnthError(e?.message || 'Connection failed');
    }
  };

  const removeAnthropic = async () => {
    await clearAnthropicApiKey();
    setAnthSaved(null);
    setAnthInput('');
    setAnthStatus('idle');
    setAnthError('');
    showToast({ message: 'Claude API key removed' });
  };

  const toggleSuggestions = (next: boolean) => {
    setSuggestionsOn(next);
    setAISuggestionsEnabled(next);
  };

  const mask = (k: string) => k.slice(0, 6) + '…' + k.slice(-4);
  // Reply suggestions (a fast-tier feature) need whatever the Fast tier uses.
  const hasAnyKey = !!geminiSaved || !!anthSaved;

  return (
    <div className="space-y-6">
      {/* Model picker — one provider+model per job */}
      <div>
        <h3 className="text-sm font-semibold text-fg-strong">AI models</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          Pick which model powers each job. Mix providers freely, or use one for both. Gemini runs in the browser; Claude runs through the companion.
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-fg-strong">Fast — cheap, high-volume</span>
              <span className="text-[11px] text-fg-faint">categorization · summaries · autocomplete</span>
            </div>
            <div className="mt-1.5">
              <ProviderModelSelect tier="fast" provider={fastProvider} value={tierModelId('fast')} onSelect={(p, m) => chooseModel('fast', p, m)} />
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-fg-strong">Quality — chat &amp; drafting</span>
              <span className="text-[11px] text-fg-faint">AI Chat · message drafts</span>
            </div>
            <div className="mt-1.5">
              <ProviderModelSelect tier="quality" provider={qualityProvider} value={tierModelId('quality')} onSelect={(p, m) => chooseModel('quality', p, m)} />
            </div>
          </div>
        </div>
      </div>

      {/* Claude (Anthropic) */}
      {usesAnthropic && (
        <div className="space-y-5 border-t border-edge pt-5">
          <div>
            <h3 className="text-sm font-semibold text-fg-strong">Claude API key</h3>
            {anthSaved ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="rounded-md bg-surface px-3 py-1.5 font-mono text-sm text-fg-secondary ring-1 ring-ring">
                  {mask(anthSaved)}
                </span>
                <span className="text-xs text-green-500">Active</span>
                <button
                  onClick={removeAnthropic}
                  className="ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="mt-3">
                <div className="rounded-lg bg-surface p-3 ring-1 ring-ring">
                  <p className="text-xs font-semibold text-fg-strong">Get an API key</p>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs text-fg-secondary marker:text-fg-faint">
                    <li>
                      Open{' '}
                      <a
                        href="https://console.anthropic.com/settings/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-500 underline hover:text-blue-400"
                      >
                        the Anthropic Console
                      </a>{' '}
                      and sign in.
                    </li>
                    <li>
                      Click <span className="font-medium text-fg">Create Key</span> and copy it.
                    </li>
                    <li>Paste it below and click Save.</li>
                  </ol>
                  <p className="mt-2 text-[11px] text-fg-faint">
                    Requires a small amount of billing credit. Your key is stored only on this device
                    and sent directly to Anthropic.
                  </p>
                </div>

                <div className="relative mt-3">
                  <input
                    type={anthShow ? 'text' : 'password'}
                    value={anthInput}
                    onChange={(e) => {
                      setAnthInput(e.target.value);
                      setAnthStatus('idle');
                      setAnthError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && anthInput.trim()) saveAnthropic();
                    }}
                    placeholder="Paste your Claude API key (sk-ant-…)"
                    className="w-full rounded-md bg-surface px-3 py-2 pr-16 text-sm text-fg placeholder-fg-faint ring-1 ring-ring focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setAnthShow((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:text-fg-secondary"
                  >
                    {anthShow ? 'Hide' : 'Show'}
                  </button>
                </div>

                {anthStatus === 'error' && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-red-500">{anthError || 'Test failed'}</p>
                    {/CORS/i.test(anthError) && (
                      <p className="text-[11px] leading-relaxed text-fg-muted">
                        inflow calls Claude directly from your browser, which your Anthropic organization blocks.
                        Enable browser access in the Anthropic Console (Settings → Organization), or use a personal-account
                        key. Gemini works from the browser without this restriction.
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-3 flex justify-end">
                  <button
                    onClick={saveAnthropic}
                    disabled={!anthInput.trim() || anthStatus === 'testing'}
                    className="rounded-md btn-primary px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
                  >
                    {anthStatus === 'testing' ? 'Verifying…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gemini */}
      {usesGemini && (
        <div className="border-t border-edge pt-5">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-fg-strong">Gemini API key</h3>
            <span className="group/warn relative inline-flex">
              <svg className="h-3.5 w-3.5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Storage warning">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 w-56 -translate-x-1/2 rounded-lg bg-surface-raised px-2.5 py-1.5 text-[11px] leading-snug text-fg-secondary opacity-0 shadow-lg ring-1 ring-inset ring-edge transition-opacity group-hover/warn:opacity-100">
                Stored unencrypted on this device. Need it secure? Move this key to the MCP companion.
              </span>
            </span>
          </div>
          <p className="mt-1 text-sm text-fg-secondary">
            Bring your own key&nbsp;&mdash; it&rsquo;s free and takes a minute.
          </p>

          {geminiSaved ? (
            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-md bg-surface px-3 py-1.5 font-mono text-sm text-fg-secondary ring-1 ring-ring">
                {mask(geminiSaved)}
              </span>
              <span className="text-xs text-green-500">Active</span>
              <button
                onClick={removeGemini}
                className="ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <div className="rounded-lg bg-surface p-3 ring-1 ring-ring">
                <p className="text-xs font-semibold text-fg-strong">Get a free API key</p>
                <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs text-fg-secondary marker:text-fg-faint">
                  <li>
                    Open{' '}
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-500 underline hover:text-blue-400"
                    >
                      Google AI Studio
                    </a>{' '}
                    and sign in with a Google account.
                  </li>
                  <li>
                    Click <span className="font-medium text-fg">Create API key</span> (accept the
                    terms if prompted).
                  </li>
                  <li>Copy the generated key.</li>
                  <li>Paste it below and click Save.</li>
                </ol>
                <p className="mt-2 text-[11px] text-fg-faint">
                  Free tier: 500 requests/day. Your key is stored only on this device and sent
                  directly to Google.
                </p>
              </div>

              <div className="relative mt-3">
                <input
                  type={geminiShow ? 'text' : 'password'}
                  value={geminiInput}
                  onChange={(e) => {
                    setGeminiInput(e.target.value);
                    setGeminiStatus('idle');
                    setGeminiError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && geminiInput.trim()) saveGemini();
                  }}
                  placeholder="Paste your Gemini API key"
                  className="w-full rounded-md bg-surface px-3 py-2 pr-16 text-sm text-fg placeholder-fg-faint ring-1 ring-ring focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setGeminiShow((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:text-fg-secondary"
                >
                  {geminiShow ? 'Hide' : 'Show'}
                </button>
              </div>

              {geminiStatus === 'error' && (
                <p className="mt-2 text-xs text-red-500">{geminiError || 'Test failed'}</p>
              )}

              <div className="mt-3 flex justify-end">
                <button
                  onClick={saveGemini}
                  disabled={!geminiInput.trim() || geminiStatus === 'testing'}
                  className="rounded-md btn-primary px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
                >
                  {geminiStatus === 'testing' ? 'Verifying…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Shared behavior toggles */}
      <div className="space-y-3 border-t border-edge pt-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg-strong">Categorize connections</p>
            <p className="text-xs text-fg-muted">
              {categorizeMode === 'auto'
                ? 'Automatically tag new connections after each sync.'
                : 'Only categorize when you ask (Categorize now / per-connection refresh).'}
            </p>
          </div>
          <div className="inline-flex shrink-0 rounded-lg bg-surface p-0.5 ring-1 ring-ring">
            {(['auto', 'manual'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setCategorizeMode(m)}
                aria-pressed={categorizeMode === m}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  categorizeMode === m ? 'bg-blue-500/15 text-blue-700 ring-1 ring-inset ring-blue-500/30 dark:text-blue-200' : 'text-fg-secondary hover:text-fg-strong'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <ToggleRow
          label="AI reply suggestions"
          description="Suggest replies and inline autocomplete while composing."
          checked={suggestionsOn}
          disabled={!hasAnyKey}
          onChange={toggleSuggestions}
        />
        {!hasAnyKey && (
          <p className="mt-2 text-[11px] text-fg-faint">Add an API key above to enable.</p>
        )}
      </div>
    </div>
  );
}
