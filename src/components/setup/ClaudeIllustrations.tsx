import type { ReactNode } from 'react';
import { LogoMark } from '@/components/common/Wordmark';

/**
 * Simplified drawings of the Claude Desktop screens the Claude step walks
 * through. Drawn, like the toolbar in PinIllustration, so they follow the app
 * theme and never show someone else's data, and deliberately generic: they
 * show which control to use, not a pixel copy of Claude's UI, which changes
 * between releases. The control to click pulses (`setup-click-hint`).
 *
 * The field titles are the companion's own (mcp-companion/manifest.json), so
 * those match what Claude shows exactly.
 */

function ClaudeWindow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-[360px] select-none overflow-hidden rounded-xl bg-surface-input text-left ring-1 ring-inset ring-edge"
    >
      <div className="flex items-center gap-1.5 border-b border-edge bg-surface-raised px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-[10px] font-medium text-fg-muted">{title}</span>
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}

function ClickHint({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`setup-click-hint relative inline-flex rounded-md ${className}`}>{children}</span>;
}

/** The install prompt Claude shows when the downloaded file is opened. */
export function InstallIllustration() {
  return (
    <ClaudeWindow title="Claude">
      <div className="flex items-start gap-3">
        <LogoMark size={36} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-fg-strong">inflow</p>
          <p className="text-[10px] leading-snug text-fg-muted">
            Your LinkedIn network and messages, for Claude. Reads and drafts; you always send.
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <span className="rounded-md px-2.5 py-1 text-[10px] text-fg-muted">Cancel</span>
        <ClickHint>
          <span className="rounded-md bg-[#c96442] px-3 py-1 text-[10px] font-semibold text-white">Install</span>
        </ClickHint>
      </div>
    </ClaudeWindow>
  );
}

/** The companion's settings form, with the user's own pairing code filled in. */
export function PairingIllustration({ code }: { code: string }) {
  return (
    <ClaudeWindow title="Claude › Settings › Extensions › inflow">
      <Field label="inflow pairing code" required value={code} highlight />
      <Field label="Anthropic API key (optional)" />
      <Field label="Gemini API key (optional)" />
      <div className="mt-2.5 flex justify-end">
        <ClickHint>
          <span className="rounded-md bg-[#c96442] px-3 py-1 text-[10px] font-semibold text-white">Save</span>
        </ClickHint>
      </div>
    </ClaudeWindow>
  );
}

function Field({ label, value, required, highlight }: { label: string; value?: string; required?: boolean; highlight?: boolean }) {
  return (
    <div className="mb-2">
      <p className="mb-1 text-[10px] font-medium text-fg-secondary">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </p>
      <div
        className={`h-6 rounded-md bg-surface px-2 font-mono text-[10px] leading-6 text-fg-strong ring-1 ring-inset ${
          highlight ? 'ring-2 ring-blue-500' : 'ring-edge'
        }`}
      >
        {value ?? ''}
      </div>
    </div>
  );
}

/** The extensions list, with inflow switched on. */
export function EnableIllustration() {
  return (
    <ClaudeWindow title="Claude › Settings › Extensions">
      <div className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2.5 ring-1 ring-inset ring-edge">
        <LogoMark size={24} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-fg-strong">inflow</p>
          <p className="text-[10px] text-fg-muted">Enabled</p>
        </div>
        <ClickHint className="rounded-full">
          <span className="relative inline-flex h-4 w-7 items-center rounded-full bg-[#c96442] px-0.5">
            <span className="h-3 w-3 translate-x-3 rounded-full bg-white" />
          </span>
        </ClickHint>
      </div>
    </ClaudeWindow>
  );
}

/** The permission prompt the first time Claude uses one of inflow's tools. */
export function PermissionIllustration() {
  return (
    <ClaudeWindow title="Claude">
      <p className="text-[11px] font-semibold text-fg-strong">Allow Claude to use inflow?</p>
      <p className="mt-0.5 text-[10px] text-fg-muted">Claude wants to search your connections.</p>
      <div className="mt-3 flex justify-end gap-2">
        <span className="rounded-md px-2.5 py-1 text-[10px] text-fg-muted ring-1 ring-inset ring-edge">Allow once</span>
        <ClickHint>
          <span className="rounded-md bg-[#c96442] px-3 py-1 text-[10px] font-semibold text-white">Allow always</span>
        </ClickHint>
      </div>
    </ClaudeWindow>
  );
}
