import { useOutbox } from '@/hooks/useOutbox';
import { useUIStore } from '@/store/ui-store';
import { OutboxRow } from '../outbox/OutboxRow';
import { GROUPS, QueueItem, useQueueList } from '../outbox/queue';

/**
 * Messages › Drafts / Scheduled — the same outbound queue as the MCP
 * connector, shown the same way: one line per message here in the list
 * column, and the selected one open in the reading pane (QueueReadingPane),
 * where a conversation would otherwise be. j/k move through it.
 */
export function InboxQueue({ kind, compact }: { kind: 'drafts' | 'scheduled'; compact?: boolean }) {
  const { ready, scheduled, drafts, failed, holds } = useOutbox();
  const selectedId = useUIStore((s) => s.selectedQueueId);
  const setSelectedId = useUIStore((s) => s.setSelectedQueueId);
  const { shown, ordered, listRef } = useQueueList({
    lists: { ready, scheduled, drafts, failed },
    holds,
    include: (home) => (kind === 'drafts' ? home === 'drafts' : home === 'ready' || home === 'scheduled'),
    selectedId,
    setSelectedId,
  });

  if (ordered.length === 0) {
    if (compact) return <div className="min-h-0 flex-1" />;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <p className="text-sm text-fg-muted">{kind === 'drafts' ? 'No drafts yet.' : 'Nothing scheduled.'}</p>
          <p className="max-w-xs text-xs text-fg-faint">
            {kind === 'drafts'
              ? 'Save a message as a draft — from a thread, a follow-up, or Claude — and it shows here.'
              : 'Schedule a message and it waits here, ready for a one-click send when the time comes.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={kind === 'drafts' ? 'Drafts' : 'Scheduled'}
      className={`min-h-0 flex-1 overflow-y-auto ${compact ? 'space-y-1 px-1.5 py-2' : 'space-y-4 px-2 py-3'}`}
    >
      {GROUPS.filter((g) => shown[g.key].length > 0).map((g) => (
        <div key={g.key} role="group" aria-label={g.title}>
          {!compact && (
            <div className="mb-1 flex items-baseline gap-2 px-2.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">{g.title}</h3>
              <span className="text-[11px] tabular-nums text-fg-faint">{shown[g.key].length}</span>
            </div>
          )}
          <div className="space-y-0.5">
            {shown[g.key].map((m) => (
              <QueueItem key={m.id} msg={m} group={g.key} compact={compact} selected={m.id === selectedId} onSelect={() => setSelectedId(m.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The reading pane for Messages › Drafts / Scheduled: the selected queued
 * message opened like an email, with its actions, as in the MCP connector.
 */
export function QueueReadingPane() {
  const { ready, scheduled, drafts, failed, holds } = useOutbox();
  const selectedId = useUIStore((s) => s.selectedQueueId);
  const msg = [...ready, ...scheduled, ...drafts, ...failed].find((m) => m.id === selectedId);
  if (!msg) {
    return <p className="pt-16 text-center text-xs text-fg-faint">Select a message to read it.</p>;
  }
  return (
    <section aria-label="Selected message" className="h-full min-w-0 flex-1 overflow-y-auto px-8 py-6">
      {/* Keyed so per-message state (Edit, Reschedule, the delete question)
          never carries over to the next message. */}
      <OutboxRow key={msg.id} msg={msg} ready={ready.some((r) => r.id === msg.id)} hold={holds.get(msg.id)} expanded />
      <p className="mt-6 pl-[52px] text-[11px] text-fg-faint">j / k to move through the list</p>
    </section>
  );
}
