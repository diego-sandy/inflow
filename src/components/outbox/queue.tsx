import { useEffect, useRef } from 'react';
import { format, isToday } from 'date-fns';
import type { QueueHold } from '@/lib/queue-holds';
import type { ScheduledMessage } from '@/types/scheduled-message';
import { useUIStore } from '@/store/ui-store';
import { GroupAvatar } from '../common/GroupAvatar';

/**
 * The outbound queue as a list: one line per message, grouped by what it needs.
 * Shared by the MCP connector's split view and Messages › Drafts / Scheduled,
 * which show the same queue in the same way.
 */

export type Group = 'ready' | 'review' | 'scheduled' | 'drafts' | 'waiting' | 'failed';

/** Where useOutbox files a message, before any hold moves it. */
export type Home = 'ready' | 'scheduled' | 'drafts' | 'failed';

/**
 * Shown in this order, which is also the order j/k walk through them. The two
 * held groups (lib/queue-holds) sit by what they need: "They replied" wants
 * the user's eyes now, "Waiting for their reply" wants nothing until it moves.
 */
export const GROUPS: { key: Group; title: string }[] = [
  { key: 'ready', title: 'Ready to send' },
  { key: 'review', title: 'They replied' },
  { key: 'scheduled', title: 'Scheduled' },
  { key: 'drafts', title: 'Drafts' },
  { key: 'waiting', title: 'Waiting for their reply' },
  { key: 'failed', title: 'Failed' },
];

function chip(group: Group, msg: ScheduledMessage): { label: string; className: string } {
  if (msg.status === 'sending') return { label: 'Sending…', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' };
  switch (group) {
    case 'ready':
      return { label: 'Ready', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' };
    case 'review':
      return { label: 'Replied', className: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' };
    case 'waiting':
      return { label: 'Waiting', className: 'bg-surface-input text-fg-muted' };
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
export function QueueItem({
  msg,
  group,
  selected,
  onSelect,
  compact,
}: {
  msg: ScheduledMessage;
  group: Group;
  selected: boolean;
  onSelect: () => void;
  /** Avatar only, for the narrow-window rail. */
  compact?: boolean;
}) {
  const c = chip(group, msg);
  const name = msg.recipientName || 'Unknown';
  const preview = (msg.inMailSubject || msg.body).replace(/\s+/g, ' ').trim();
  if (compact) {
    return (
      <button
        role="option"
        aria-selected={selected}
        aria-label={`${name}, ${c.label}`}
        title={`${name} · ${c.label}\n${preview}`}
        data-outbox-id={msg.id}
        onClick={onSelect}
        className={`flex w-full justify-center rounded-md py-1.5 transition-colors ${
          selected ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-500/25' : 'hover:bg-surface-hover'
        }`}
      >
        <GroupAvatar names={[name]} pictures={['']} size={32} />
      </button>
    );
  }
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
      <GroupAvatar names={[name]} pictures={['']} size={28} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-fg-strong">{name}</span>
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

export interface QueueEntry {
  msg: ScheduledMessage;
  group: Group;
}

/**
 * Group, order and select the queue, and move through it with j/k.
 *
 * `include` picks which messages this view shows, by where useOutbox files
 * them (Messages › Drafts shows only drafts). A message being sent is
 * 'sending', which useOutbox files under Scheduled; left alone, a draft would
 * jump groups, or out of a Drafts-only view, for the second it takes to send,
 * and the selection with it. So both its home and its group stick until it is
 * gone, and it keeps its place in the list.
 *
 * When the selected message leaves (sent, deleted, filtered out), the one that
 * was below it opens, or else the one above, so working down the queue never
 * sends you back to the top.
 */
export function useQueueList({
  lists,
  holds,
  match = () => true,
  include = () => true,
  selectedId,
  setSelectedId,
  keyboard = true,
}: {
  lists: Record<Home, ScheduledMessage[]>;
  holds: Map<string, QueueHold>;
  match?: (m: ScheduledMessage) => boolean;
  include?: (home: Home) => boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** Whether j/k move the selection (off while the view isn't showing). */
  keyboard?: boolean;
}) {
  const prevOrder = useRef<string[]>([]);
  const homeOf = useRef(new Map<string, Home>());
  const groupOf = useRef(new Map<string, Group>());
  const listRef = useRef<HTMLDivElement>(null);

  const shown: Record<Group, ScheduledMessage[]> = { ready: [], review: [], scheduled: [], drafts: [], waiting: [], failed: [] };
  const inFlight: { g: Group; m: ScheduledMessage }[] = [];
  for (const home of ['ready', 'scheduled', 'drafts', 'failed'] as const) {
    for (const m of lists[home]) {
      const sending = m.status === 'sending';
      const h: Home = (sending && homeOf.current.get(m.id)) || home;
      homeOf.current.set(m.id, h);
      const hold = holds.get(m.id);
      const g: Group = (sending && groupOf.current.get(m.id)) || (hold ? (hold.kind === 'waiting' ? 'waiting' : 'review') : h);
      groupOf.current.set(m.id, g);
      if (!include(h) || !match(m)) continue;
      if (sending && g !== home) inFlight.push({ g, m });
      else shown[g].push(m);
    }
  }
  for (const { g, m } of inFlight) {
    const was = prevOrder.current.indexOf(m.id);
    const at = shown[g].findIndex((o) => prevOrder.current.indexOf(o.id) > was);
    shown[g].splice(at === -1 ? shown[g].length : at, 0, m);
  }
  const ordered: QueueEntry[] = GROUPS.flatMap((g) => shown[g.key].map((msg) => ({ msg, group: g.key })));
  const orderKey = ordered.map((o) => o.msg.id).join(',');

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

  // j/k and the arrow keys, as in the Inbox. Not while typing (a filter, an
  // edit) or while something is open over the page.
  useEffect(() => {
    if (!keyboard) return;
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
  }, [keyboard]);

  return { shown, ordered, selected, listRef };
}
