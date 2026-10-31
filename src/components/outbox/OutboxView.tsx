import { useRef, useState } from 'react';
import { useOutbox } from '@/hooks/useOutbox';
import { useResizablePane } from '@/hooks/useResizablePane';
import type { ScheduledMessage } from '@/types/scheduled-message';
import { useUIStore } from '@/store/ui-store';
import { McpStatusBar } from './McpStatusBar';
import { OutboxRow } from './OutboxRow';
import { GROUPS, QueueItem, useQueueList } from './queue';

/**
 * The MCP connector section: the connector's status, then the local outbound
 * queue as a split view — the queue on the left, the selected message in full
 * on the right with its actions. It never composes (that happens in the one
 * message composer) and never auto-sends on its own say-so: a scheduled
 * message whose time has arrived is *resurfaced* as "Ready to send".
 *
 * Split rather than a grid of cards: with every message open at once, each
 * with its own row of buttons, the queue was hard to scan. Now a row is one
 * line, and only the message being read has buttons. It matches the Inbox and
 * Invitations, so j/k move through it the same way.
 */
export function OutboxView() {
  const { ready, scheduled, drafts, failed, holds } = useOutbox();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { width: listWidth, isDragging, onDividerMouseDown, onDividerDoubleClick } = useResizablePane({
    storageKey: 'inflow-outbox-list-width',
    defaultWidth: 380,
    min: 280,
    side: 'left',
    originRef: containerRef,
  });

  // Filters across every group at once: the thing you remember about a
  // queued message is who it is to or what it says, not which status it is in.
  const q = query.trim().toLowerCase();
  const match = (m: ScheduledMessage) =>
    !q ||
    (m.recipientName || '').toLowerCase().includes(q) ||
    (m.inMailSubject || '').toLowerCase().includes(q) ||
    m.body.toLowerCase().includes(q);

  const { shown, ordered, selected, listRef } = useQueueList({
    lists: { ready, scheduled, drafts, failed },
    holds,
    match,
    selectedId,
    setSelectedId,
  });

  // Sent history lives in the connector's activity log, not as a queue section.
  const queueEmpty = ready.length + scheduled.length + drafts.length + failed.length === 0;

  const goToInboxTab = (tab: 'drafts' | 'scheduled') => {
    const store = useUIStore.getState();
    store.setActiveSection('inbox');
    store.setInboxTab(tab);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-6 py-3">
        <h2 className="text-base font-semibold text-fg-strong">MCP connector</h2>
        <span className="text-[11px] text-fg-faint">It reads your network and executes actions from Claude via MCP.</span>

        {/* Only once there is a queue worth searching. */}
        {!queueEmpty && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or text"
            aria-label="Filter the queue"
            className="ml-auto w-52 rounded-md bg-surface-input px-2.5 py-1 text-xs text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
          />
        )}
      </div>

      {/* The connector's own status, above the queue. Capped so an open
          activity log can't squeeze the queue off the screen. */}
      <div className="max-h-[45%] shrink-0 overflow-y-auto px-6 pt-4 pb-3">
        <McpStatusBar />
      </div>

      {queueEmpty ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
          <div className="rounded-xl border border-dashed border-edge px-4 py-10 text-center">
            <p className="text-sm text-fg-muted">No drafts or scheduled sends yet.</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-fg-faint">
              Ask Claude to draft outreach, or save a draft from the composer. It’ll show up here — and in your Inbox — to review and send.
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                onClick={() => goToInboxTab('drafts')}
                className="rounded-md bg-surface-input px-3 py-1.5 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
              >
                Open Drafts in Inbox
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="flex min-h-0 flex-1 border-t border-edge">
          {/* Left: the queue, one line per message. */}
          <div
            ref={listRef}
            role="listbox"
            aria-label="Queue"
            style={{ width: listWidth }}
            className="h-full shrink-0 space-y-4 overflow-y-auto px-3 py-3"
          >
            {ordered.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-fg-muted">Nothing in the queue matches “{query.trim()}”.</p>
            )}
            {GROUPS.filter((g) => shown[g.key].length > 0).map((g) => (
              <div key={g.key} role="group" aria-label={g.title}>
                <div className="mb-1 flex items-baseline gap-2 px-2.5">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">{g.title}</h3>
                  <span className="text-[11px] tabular-nums text-fg-faint">{shown[g.key].length}</span>
                </div>
                <div className="space-y-0.5">
                  {shown[g.key].map((m) => (
                    <QueueItem key={m.id} msg={m} group={g.key} selected={m.id === selectedId} onSelect={() => setSelectedId(m.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Draggable divider: trade width between the queue and the message. */}
          <div
            onMouseDown={onDividerMouseDown}
            onDoubleClick={onDividerDoubleClick}
            title="Drag to resize · double-click to reset"
            className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize"
          >
            <div className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${isDragging ? 'bg-blue-500' : 'bg-edge group-hover:bg-blue-500/60'}`} />
          </div>

          {/* Right: the selected message in full, with its actions. */}
          <section aria-label="Selected message" className="h-full min-w-0 flex-1 overflow-y-auto px-8 py-6">
            {selected ? (
              <>
                {/* Keyed so per-message state (Edit, Reschedule, the delete
                    question) never carries over to the next message. */}
                <OutboxRow
                  key={selected.msg.id}
                  msg={selected.msg}
                  ready={selected.group === 'ready'}
                  hold={holds.get(selected.msg.id)}
                  expanded
                />
                <p className="mt-6 pl-[52px] text-[11px] text-fg-faint">j / k to move through the queue</p>
              </>
            ) : (
              <p className="pt-8 text-center text-xs text-fg-faint">Select a message to read it.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
