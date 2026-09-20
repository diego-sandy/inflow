import { useOutbox } from '@/hooks/useOutbox';
import { useUIStore } from '@/store/ui-store';
import { McpStatusBar } from './McpStatusBar';
import { OutboxRow } from './OutboxRow';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{title}</h3>
        {hint && <span className="text-[11px] text-fg-faint">{hint}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/**
 * The Outbox — a status view of the local outbound pipeline. It never composes
 * (that happens in the one message composer) and never auto-sends: a scheduled
 * message whose time has arrived is *resurfaced* as "Ready to send" for a
 * one-click send. Composing a new message opens the shared composer.
 */
export function OutboxView() {
  const { ready, scheduled, drafts, failed, sent } = useOutbox();

  const openComposer = () => {
    const store = useUIStore.getState();
    store.setActiveSection('inbox');
    store.setSelectedConversationId(null);
    store.setComposeNewActive(true);
  };

  const isEmpty = ready.length + scheduled.length + drafts.length + failed.length + sent.length === 0;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-6 py-3">
        <h2 className="text-base font-semibold text-fg-strong">MCP connector</h2>
        <span className="text-[11px] text-fg-faint">Claude drafts land here as drafts &amp; scheduled — you always send.</span>
        <span className="flex-1" />
        <button
          onClick={openComposer}
          className="rounded-md bg-blue-500/15 px-3 py-1.5 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
        >
          New message
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 px-6 py-5">
          <McpStatusBar />

          {isEmpty && (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-sm text-fg-muted">Nothing here yet.</p>
              <p className="max-w-xs text-xs text-fg-faint">
                Compose a message and choose “Save as draft” or “Schedule”, or start one from a follow-up — it’ll show up here to review and send.
              </p>
            </div>
          )}

          {ready.length > 0 && (
            <Section title="Ready to send" hint="Scheduled time reached — send when you’re ready">
              {ready.map((m) => <OutboxRow key={m.id} msg={m} ready />)}
            </Section>
          )}
          {scheduled.length > 0 && (
            <Section title="Scheduled">
              {scheduled.map((m) => <OutboxRow key={m.id} msg={m} />)}
            </Section>
          )}
          {drafts.length > 0 && (
            <Section title="Drafts">
              {drafts.map((m) => <OutboxRow key={m.id} msg={m} />)}
            </Section>
          )}
          {failed.length > 0 && (
            <Section title="Failed">
              {failed.map((m) => <OutboxRow key={m.id} msg={m} />)}
            </Section>
          )}
          {sent.length > 0 && (
            <Section title="Sent">
              {sent.slice(0, 20).map((m) => <OutboxRow key={m.id} msg={m} />)}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
