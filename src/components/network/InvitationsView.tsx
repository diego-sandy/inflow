import { useEffect, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { GroupAvatar } from '../common/GroupAvatar';
import { useInvitations } from '@/hooks/useInvitations';
import { useResizablePane } from '@/hooks/useResizablePane';
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

/** A compact profile row with inline Accept / Ignore; selecting it reads the note. */
function ProfileRow({ inv, selected, onSelect }: { inv: Invitation; selected: boolean; onSelect: () => void }) {
  const { respond } = useInvitations();
  const showToast = useUIStore((s) => s.showToast);
  const name = inv.name || 'LinkedIn Member';
  const mutual = mutualLine(inv);

  const act = async (e: React.MouseEvent, action: 'accept' | 'ignore') => {
    e.stopPropagation();
    const res = await respond(inv, action);
    showToast({
      message: res.success
        ? action === 'accept' ? `Connected with ${name}` : `Ignored ${name}`
        : res.error || `Could not ${action} invitation`,
    });
  };

  const openProfile = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(connectionProfileUrl(inv.publicId, name), '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={`flex cursor-pointer items-start gap-3 border-b border-edge px-3 py-2.5 transition-colors ${selected ? 'bg-surface-active' : 'hover:bg-surface-hover'}`}
    >
      <button onClick={openProfile} className="mt-0.5 shrink-0" title="Open LinkedIn profile">
        <GroupAvatar names={[name]} pictures={[inv.pictureUrl]} size={40} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-fg-strong">{name}</span>
          {inv.message && (
            <svg className="h-3.5 w-3.5 shrink-0 text-fg-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Has a note">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          )}
        </div>
        {inv.headline && <div className="truncate text-xs text-fg-secondary">{inv.headline}</div>}
        {mutual && (
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-muted">
            {inv.mutualPictures.length > 0 && <GroupAvatar names={inv.mutualNames} pictures={inv.mutualPictures} size={16} />}
            <span className="truncate">{mutual}</span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {inv.sentAt > 0 && <span className="text-[10px] text-fg-faint">{formatDistanceToNowStrict(new Date(inv.sentAt))}</span>}
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => act(e, 'ignore')}
            className="rounded-md px-3 py-1 text-xs font-medium text-fg-muted ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
          >
            Ignore
          </button>
          <button
            onClick={(e) => act(e, 'accept')}
            className="rounded-md bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

/** Invitations — a list of profiles with inline actions and a resizable note pane. */
export function InvitationsView() {
  const { invitations, syncing, error, refresh } = useInvitations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { width: noteWidth, isDragging, onDividerMouseDown, onDividerDoubleClick } = useResizablePane({
    storageKey: 'inflow-invitations-note-width',
    defaultWidth: 340,
  });

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* Left: profiles list (rows centered in a readable column) */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl">
            {error && <div className="px-4 py-8 text-center text-sm text-red-500 dark:text-red-400">{error}</div>}
            {!error && invitations.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                <p className="text-sm text-fg-muted">{syncing ? 'Loading invitations…' : 'No pending invitations.'}</p>
                {!syncing && <p className="max-w-xs text-xs text-fg-faint">New connection requests will show up here to accept or ignore.</p>}
              </div>
            )}
            {invitations.map((inv) => (
              <ProfileRow key={inv.id} inv={inv} selected={inv.id === selectedId} onSelect={() => setSelectedId(inv.id)} />
            ))}
          </div>
        </div>
      </div>

      {/* Draggable divider — move it to trade width between the list and the note. */}
      <div
        onMouseDown={onDividerMouseDown}
        onDoubleClick={onDividerDoubleClick}
        title="Drag to resize · double-click to reset"
        className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize"
      >
        <div className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${isDragging ? 'bg-blue-500' : 'bg-edge group-hover:bg-blue-500/60'}`} />
      </div>

      {/* Right: the selected request's note */}
      <div style={{ width: noteWidth }} className="flex h-full shrink-0 flex-col">
        <div className="flex items-center border-b border-edge px-5 py-2.5">
          <h3 className="truncate text-sm font-semibold text-fg-strong">
            {selected ? `Note from ${selected.name || 'LinkedIn Member'}` : 'Note'}
          </h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {selected?.message ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">{selected.message}</p>
          ) : (
            <p className="pt-8 text-center text-xs text-fg-faint">
              {selected ? 'No note came with this request.' : 'Select an invitation to read its note.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
