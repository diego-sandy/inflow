import { useEffect, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { GroupAvatar } from '../common/GroupAvatar';
import { useInvitations } from '@/hooks/useInvitations';
import { useUIStore } from '@/store/ui-store';
import { connectionProfileUrl } from '@/components/connections/connection-format';
import type { Invitation } from '@/types/network';

function mutualLine(inv: Invitation): string | null {
  if (!inv.mutualCount) return null;
  const first = inv.mutualNames[0];
  if (first && inv.mutualCount > 1) return `${first} and ${inv.mutualCount - 1} other shared connection${inv.mutualCount - 1 === 1 ? '' : 's'}`;
  if (first) return `${first} is a shared connection`;
  return `${inv.mutualCount} shared connection${inv.mutualCount === 1 ? '' : 's'}`;
}

/** Left column: a compact, selectable list row. */
function ListRow({ inv, selected, onSelect }: { inv: Invitation; selected: boolean; onSelect: () => void }) {
  const name = inv.name || 'LinkedIn Member';
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${selected ? 'bg-surface-active' : 'hover:bg-surface-hover'}`}
    >
      <GroupAvatar names={[name]} pictures={[inv.pictureUrl]} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-fg-strong">{name}</div>
        {inv.headline && <div className="truncate text-xs text-fg-secondary">{inv.headline}</div>}
      </div>
      {inv.sentAt > 0 && (
        <span className="shrink-0 text-[10px] text-fg-faint">{formatDistanceToNowStrict(new Date(inv.sentAt))}</span>
      )}
    </button>
  );
}

/** Right column: full detail for the selected invitation. */
function Detail({ inv, onDone }: { inv: Invitation; onDone: () => void }) {
  const { respond } = useInvitations();
  const showToast = useUIStore((s) => s.showToast);
  const name = inv.name || 'LinkedIn Member';
  const mutual = mutualLine(inv);

  const act = async (action: 'accept' | 'ignore') => {
    onDone(); // advance selection immediately (optimistic)
    const res = await respond(inv, action);
    showToast({
      message: res.success
        ? action === 'accept' ? `Connected with ${name}` : `Ignored ${name}`
        : res.error || `Could not ${action} invitation`,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-lg">
          <div className="flex items-center gap-4">
            <button
              onClick={() => window.open(connectionProfileUrl(inv.publicId, name), '_blank', 'noopener,noreferrer')}
              title="Open LinkedIn profile"
            >
              <GroupAvatar names={[name]} pictures={[inv.pictureUrl]} size={64} />
            </button>
            <div className="min-w-0">
              <div className="text-lg font-semibold text-fg-strong">{name}</div>
              {inv.headline && <div className="text-sm text-fg-secondary">{inv.headline}</div>}
              {inv.sentAt > 0 && (
                <div className="mt-0.5 text-xs text-fg-faint">Requested {formatDistanceToNowStrict(new Date(inv.sentAt), { addSuffix: true })}</div>
              )}
            </div>
          </div>

          {mutual && (
            <div className="mt-4 flex items-center gap-2 text-xs text-fg-muted">
              {inv.mutualPictures.length > 0 && <GroupAvatar names={inv.mutualNames} pictures={inv.mutualPictures} size={20} />}
              <span>{mutual}</span>
            </div>
          )}

          {inv.message && (
            <p className="mt-4 whitespace-pre-wrap rounded-xl bg-surface-input px-4 py-3 text-sm text-fg-secondary">{inv.message}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-edge px-6 py-3">
        <button
          onClick={() => act('ignore')}
          className="rounded-lg px-4 py-1.5 text-sm font-medium text-fg-muted ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
        >
          Ignore
        </button>
        <button
          onClick={() => act('accept')}
          className="rounded-lg bg-blue-500/15 px-4 py-1.5 text-sm font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
        >
          Accept
        </button>
      </div>
    </div>
  );
}

/** Invitations — a two-pane inbox for pending connection requests. */
export function InvitationsView() {
  const { invitations, syncing, error, refresh } = useInvitations();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a valid selection as the list changes (accept/ignore removes rows).
  useEffect(() => {
    if (invitations.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !invitations.some((i) => i.id === selectedId)) {
      setSelectedId(invitations[0].id);
    }
  }, [invitations, selectedId]);

  const selected = invitations.find((i) => i.id === selectedId) ?? null;

  const selectNext = () => {
    const idx = invitations.findIndex((i) => i.id === selectedId);
    const next = invitations[idx + 1] ?? invitations[idx - 1] ?? null;
    setSelectedId(next?.id ?? null);
  };

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* Left: list */}
      <div className="flex h-full w-72 shrink-0 flex-col border-r border-edge">
        <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5">
          <h2 className="text-sm font-semibold text-fg-strong">Invitations</h2>
          {invitations.length > 0 && (
            <span className="rounded-full bg-surface-input px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">{invitations.length}</span>
          )}
          {syncing && <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-fg-muted border-t-transparent" title="Refreshing" />}
          <span className="flex-1" />
          <button
            onClick={() => void refresh()}
            disabled={syncing}
            aria-label="Refresh invitations"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary disabled:opacity-40"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {invitations.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-muted">{syncing ? 'Loading…' : 'No pending invitations.'}</p>
          ) : (
            invitations.map((inv) => (
              <ListRow key={inv.id} inv={inv} selected={inv.id === selectedId} onSelect={() => setSelectedId(inv.id)} />
            ))
          )}
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-500 dark:text-red-400">{error}</div>
        ) : selected ? (
          <Detail key={selected.id} inv={selected} onDone={selectNext} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-fg-muted">{syncing ? 'Loading invitations…' : 'No pending invitations.'}</p>
            {!syncing && <p className="max-w-xs text-xs text-fg-faint">New connection requests will show up here to accept or ignore.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
