import { useOutbox } from '@/hooks/useOutbox';
import { OutboxRow } from '../outbox/OutboxRow';

/**
 * The Inbox's Drafts / Scheduled views — the same outbound queue as the MCP
 * connector, reachable from the tab row's "More" menu. Drafts shows unsent
 * drafts; Scheduled shows scheduled items (past-due ones surface as ready).
 */
export function InboxQueue({ kind }: { kind: 'drafts' | 'scheduled' }) {
  const { drafts, scheduled, ready } = useOutbox();
  const readyIds = new Set(ready.map((r) => r.id));
  const items = kind === 'drafts' ? drafts : [...ready, ...scheduled];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <p className="text-sm text-fg-muted">
            {kind === 'drafts' ? 'No drafts yet.' : 'Nothing scheduled.'}
          </p>
          <p className="max-w-xs text-xs text-fg-faint">
            {kind === 'drafts'
              ? 'Save a message as a draft — from a thread, a follow-up, or Claude — and it shows here.'
              : 'Schedule a message and it waits here, ready for a one-click send when the time comes.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2 p-3">
          {items.map((m) => (
            <OutboxRow key={m.id} msg={m} ready={readyIds.has(m.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
