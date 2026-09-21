import { useCallback, useEffect, useState } from 'react';
import { useUIStore, type SettingsSection, type Theme } from '@/store/ui-store';
import { DEFAULT_INBOX_LABELS } from '@/lib/inbox-labels';
import { isDemoMode, enableDemoMode, disableDemoMode } from '@/lib/demo-mode';
import { checkForUpdateAndToast } from '@/lib/check-update';
import { AIKeySettings } from './AIKeySettings';
import { BackupSettings } from './BackupSettings';
import { Logo } from '@/components/common/Wordmark';

interface SectionDef {
  id: SettingsSection;
  label: string;
}

const SECTIONS: SectionDef[] = [
  { id: 'ai', label: 'AI' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'backup', label: 'Backup' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'about', label: 'About' },
];

function AppearanceSettings() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const options: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
    { value: 'purple', label: 'Purple' },
  ];
  return (
    <div>
      <h3 className="text-sm font-semibold text-fg-strong">Theme</h3>
      <p className="mt-1 text-sm text-fg-secondary">Choose how inflow looks.</p>
      <div className="mt-3 inline-flex rounded-lg bg-surface p-1 ring-1 ring-ring">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => setTheme(o.value)}
            aria-pressed={theme === o.value}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              theme === o.value
                ? 'bg-blue-500/20 text-blue-200'
                : 'text-fg-secondary hover:text-fg-strong'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <InboxLabelSettings />
    </div>
  );
}

function InboxLabelSettings() {
  const inboxLabels = useUIStore((s) => s.inboxLabels);
  const setInboxLabels = useUIStore((s) => s.setInboxLabels);
  // Local draft so the user can clear a field while typing; committed on blur
  // (empty falls back to the default via the store's normalizer).
  const [draft, setDraft] = useState(inboxLabels);
  useEffect(() => setDraft(inboxLabels), [inboxLabels]);

  const commit = (next: { focused: string; other: string }) => setInboxLabels(next);
  const isDefault =
    inboxLabels.focused === DEFAULT_INBOX_LABELS.focused &&
    inboxLabels.other === DEFAULT_INBOX_LABELS.other;

  const fields: { key: 'focused' | 'other'; heading: string; hint: string }[] = [
    { key: 'focused', heading: 'Primary tab', hint: 'LinkedIn’s primary inbox — your main conversations.' },
    { key: 'other', heading: 'Secondary tab', hint: 'InMail, connection requests, and lower-priority threads.' },
  ];

  return (
    <div className="mt-8 border-t border-edge pt-6">
      <h3 className="text-sm font-semibold text-fg-strong">Inbox tab names</h3>
      <p className="mt-1 text-sm text-fg-secondary">
        Rename the two LinkedIn inbox tabs to whatever fits how you work.
      </p>
      <div className="mt-3 space-y-3">
        {fields.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg-strong">{f.heading}</p>
              <p className="text-xs text-fg-muted">{f.hint}</p>
            </div>
            <input
              value={draft[f.key]}
              maxLength={24}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              onBlur={() => commit(draft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              placeholder={DEFAULT_INBOX_LABELS[f.key]}
              className="w-40 shrink-0 rounded-lg bg-surface-input px-2.5 py-1.5 text-sm text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
            />
          </div>
        ))}
      </div>
      {!isDefault && (
        <button
          onClick={() => commit(DEFAULT_INBOX_LABELS)}
          className="mt-3 rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg-secondary"
        >
          Reset to {DEFAULT_INBOX_LABELS.focused} / {DEFAULT_INBOX_LABELS.other}
        </button>
      )}
    </div>
  );
}

function AdvancedSettings() {
  // demoMode from the store keeps this in sync if toggled elsewhere.
  const demoMode = useUIStore((s) => s.demoMode);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-strong">Demo mode</p>
          <p className="text-xs text-fg-muted">
            Browse a synthetic inbox with fake data — nothing touches your real LinkedIn account.
          </p>
        </div>
        <button
          onClick={() => (isDemoMode() ? disableDemoMode() : enableDemoMode())}
          className="shrink-0 rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
        >
          {demoMode ? 'Exit demo mode' : 'Enter demo mode'}
        </button>
      </div>
    </div>
  );
}

function AboutSettings() {
  const showToast = useUIStore((s) => s.showToast);
  const [checking, setChecking] = useState(false);
  const version = (() => {
    try {
      return chrome?.runtime?.getManifest?.().version ?? '';
    } catch {
      return '';
    }
  })();

  const check = async () => {
    setChecking(true);
    try {
      await checkForUpdateAndToast(showToast);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Logo />
        {version && <p className="mt-1 text-sm text-fg-secondary">Version {version}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={check}
          disabled={checking}
          className="rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong disabled:opacity-40"
        >
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        <button
          onClick={() => {
            useUIStore.getState().closeSettings();
            useUIStore.getState().setWhatsNewOpen(true);
          }}
          className="rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
        >
          What&rsquo;s new
        </button>
      </div>
      <div className="flex flex-col gap-2 border-t border-edge pt-4 text-sm">
        <a
          href="https://github.com/grinich/inflow/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-blue-500 hover:text-blue-400"
        >
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="8" y="6" width="8" height="14" rx="4" />
            <path d="M19 7l-3 2M5 7l3 2M12 20v-8M20 13h-4M8 13H4M19 18l-3-2M5 18l3-2M9 3l1 3h4l1-3" />
          </svg>
          Report a bug
        </a>
        <a
          href="https://chat.whatsapp.com/Cgj71APZz0uBkW5Y4WOhQO"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-blue-500 hover:text-blue-400"
        >
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
          </svg>
          Join the WhatsApp group
        </a>
      </div>
    </div>
  );
}

export function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen);
  const section = useUIStore((s) => s.settingsSection);
  const close = useUIStore((s) => s.closeSettings);
  const setSection = useCallback(
    (s: SettingsSection) => useUIStore.getState().openSettings(s),
    [],
  );

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-label="Settings"
        className="flex h-[32rem] max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl bg-surface-raised shadow-2xl ring-1 ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Section nav */}
        <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-edge bg-surface p-2">
          <p className="px-2 pb-1 pt-1 text-sm font-semibold text-fg-strong">Settings</p>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? 'page' : undefined}
              className={`rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors ${
                section === s.id
                  ? 'bg-blue-500/15 text-fg-strong ring-1 ring-inset ring-blue-500/30'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg-secondary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Section content */}
        <div className="relative min-w-0 flex-1 overflow-y-auto p-6">
          <button
            onClick={close}
            aria-label="Close settings"
            className="absolute right-4 top-4 rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>

          {section === 'ai' && <AIKeySettings />}
          {section === 'appearance' && <AppearanceSettings />}
          {section === 'backup' && <BackupSettings />}
          {section === 'advanced' && <AdvancedSettings />}
          {section === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  );
}
