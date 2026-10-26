import { useEffect, useRef, useState } from 'react';
import { format, isToday } from 'date-fns';
import { useOutbox } from '@/hooks/useOutbox';
import { useResizablePane } from '@/hooks/useResizablePane';
import type { ScheduledMessage } from '@/types/scheduled-message';
import { useUIStore } from '@/store/ui-store';
import { GroupAvatar } from '../common/GroupAvatar';
import { McpStatusBar } from './McpStatusBar';
import { OutboxRow } from './OutboxRow';

type Group = 'ready' | 'scheduled' | 'drafts' | 'failed';

/** Shown in this order, which is also the order j/k walk through them. */
const GROUPS: { key: Group; title: string }[] = [
  { key: 'ready', title: 'Ready to send' },
  { key: 'scheduled', title: 'Scheduled' },
  { key: 'drafts', title: 'Drafts' },
  { key: 'failed', title: 'Failed' },
];

function chip(group: Group, msg: ScheduledMessage): { label: string; className: string } {
  if (msg.status === 'sending') return { label: 'Sending…', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' };
  switch (group) {
    case 'ready':
      return { label: 'Ready', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' };
    case 'scheduled':
      return { label: 'Scheduled', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' };
    case 'failed':
      return { label: 'Failed', className: 'bg-red-500/15 text-red-700 dark:text-red-300' };
    default:
      return { label: 'Draft', className: 'bg-surface-input text-fg-muted' };
  }
}

/** The time worth showing on a row: when it goes out, or when it was last touched. */
function rowTime(group: Group, msg: ScheduledMessage): string {
  const at = group === 'scheduled' && msg.scheduledAt ? msg.scheduledAt : msg.updatedAt;
  if (!at || at < 1000) return '';
  const d = new Date(at);
  return isToday(d) ? format(d, 'h:mm a') : format(d, 'MMM d');
}

/** One line in the queue: who, its state, and the start of the message. */
function QueueItem({
  msg,
  group,
  selected,
  onSelect,
}: {
  msg: ScheduledMessage;
  group: Group;
  selected: boolean;
  onSelect: () => void;
}) {
  const c = chip(group, msg);
  const preview = (msg.inMailSubject || msg.body).replace(/\s+/g, ' ').trim();
  return (
    <button
      role="option"
      aria-selected={selected}
      data-outbox-id={msg.id}
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
        selected ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-500/25' : 'hover:bg-surface-hover'
      }`}
    >
      <GroupAvatar names={[msg.recipientName || 'Unknown']} pictures={['']} size={28} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-fg-strong">{msg.recipientName || 'Unknown'}</span>
          {msg.inMailSubject !== undefined && (
            <span className="shrink-0 text-[10px] font-medium text-amber-700 dark:text-amber-300">InMail</span>
          )}
          <span className="flex-1" />
          <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${c.className}`}>{c.label}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{preview}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-fg-faint">{rowTime(group, msg)}</span>
        </span>
      </span>
    </button>
  );
}

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
  const { ready, scheduled, drafts, failed } = useOutbox();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The queue's order as last rendered, to find what follows a message that
  // has just left it.
  const prevOrder = useRef<string[]>([]);
  // Where each message was last seen. A message being sent is 'sending',
  // which useOutbox files under Scheduled; left alone, a draft would jump
  // groups for the second it takes to send, and the selection with it.
  const groupOf = useRef(new Map<string, Group>());
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
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

  const shown: Record<Group, ScheduledMessage[]> = { ready: [], scheduled: [], drafts: [], failed: [] };
  const held: { g: Group; m: ScheduledMessage }[] = [];
  for (const [group, list] of [['ready', ready], ['scheduled', scheduled], ['drafts', drafts], ['failed', failed]] as const) {
    for (const m of list) {
      const g = (m.status === 'sending' && groupOf.current.get(m.id)) || group;
      groupOf.current.set(m.id, g);
      if (!match(m)) continue;
      if (g !== group) held.push({ g, m });
      else shown[g].push(m);
    }
  }
  // A message held in its old group goes back where it was in that group,
  // not to the end of it.
  for (const { g, m } of held) {
    const was = prevOrder.current.indexOf(m.id);
    const at = shown[g].findIndex((o) => prevOrder.current.indexOf(o.id) > was);
    shown[g].splice(at === -1 ? shown[g].length : at, 0, m);
  }
  const ordered = GROUPS.flatMap((g) => shown[g.key].map((msg) => ({ msg, group: g.key })));
  const orderKey = ordered.map((o) => o.msg.id).join(',');

  // Sent history lives in the connector's activity log, not as a queue section.
  const queueEmpty = ready.length + scheduled.length + drafts.length + failed.length === 0;

  // Keep something selected. When the selected message leaves the list (sent,
  // deleted, filtered out), open the one that was below it, or else above it,
  // so working down the queue never sends you back to the top.
  useEffect(() => {
    const ids = ordered.map((o) => o.msg.id);
    const before = prevOrder.current;
    prevOrder.current = ids;
    if (ids.length === 0 || (selectedId && ids.includes(selectedId))) return;
    const present = new Set(ids);
    const at = selectedId ? before.indexOf(selectedId) : -1;
    const after = at >= 0 ? before.slice(at + 1).find((id) => present.has(id)) : undefined;
    const above = at >= 0 ? before.slice(0, at).reverse().find((id) => present.has(id)) : undefined;
    setSelectedId(after ?? above ?? ids[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, selectedId]);

  const selected = ordered.find((o) => o.msg.id === selectedId) ?? null;

  const move = (delta: number) => {
    if (ordered.length === 0) return;
    const idx = Math.max(0, ordered.findIndex((o) => o.msg.id === selectedId));
    const next = ordered[Math.max(0, Math.min(ordered.length - 1, idx + delta))];
    setSelectedId(next.msg.id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-outbox-id="${CSS.escape(next.msg.id)}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  };
  const moveRef = useRef(move);
  moveRef.current = move;

  // j/k and the arrow keys, as in the Inbox. The global keyboard manager leaves
  // this section's navigation to it. Not while typing (filter, Edit) or while
  // something is open over the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const s = useUIStore.getState();
      if (s.settingsOpen || s.paletteOpen || s.shortcutOverlayOpen) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        moveRef.current(1);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveRef.current(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
                <OutboxRow key={selected.msg.id} msg={selected.msg} ready={selected.group === 'ready'} expanded />
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
