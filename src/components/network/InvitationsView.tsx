import { useEffect } from 'react';
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

function InvitationRow({ inv }: { inv: Invitation }) {
  const { respond } = useInvitations();
  const showToast = useUIStore((s) => s.showToast);
  const name = inv.name || 'LinkedIn Member';

  const act = async (action: 'accept' | 'ignore') => {
    const res = await respond(inv, action);
    if (res.success) showToast({ message: action === 'accept' ? `Connected with ${name}` : `Ignored ${name}` });
    else showToast({ message: res.error || `Could not ${action} invitation` });
  };

  const mutual = mutualLine(inv);

  return (
    <div className="rounded-xl border border-edge px-4 py-3">
      <div className="flex items-start gap-3">
        <button
          onClick={() => window.open(connectionProfileUrl(inv.publicId, name), '_blank', 'noopener,noreferrer')}
          className="shrink-0"
          title="Open LinkedIn profile"
        >
          <GroupAvatar names={[name]} pictures={[inv.pictureUrl]} size={44} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-fg-strong">{name}</div>
          {inv.headline && <div className="truncate text-xs text-fg-secondary">{inv.headline}</div>}
          {mutual && (
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-muted">
              {inv.mutualPictures.length > 0 && (
                <GroupAvatar names={inv.mutualNames} pictures={inv.mutualPictures} size={16} />
              )}
              <span className="truncate">{mutual}</span>
            </div>
          )}
          {inv.message && (
            <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-surface-input px-2.5 py-1.5 text-xs text-fg-secondary">
              {inv.message}
            </p>
          )}
          {inv.sentAt > 0 && (
            <div className="mt-1 text-[11px] text-fg-faint">{formatDistanceToNowStrict(new Date(inv.sentAt), { addSuffix: true })}</div>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          onClick={() => act('ignore')}
          className="rounded-md px-3 py-1 text-xs font-medium text-fg-muted ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
        >
          Ignore
        </button>
        <button
          onClick={() => act('accept')}
          className="rounded-md bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
        >
          Accept
        </button>
      </div>
    </div>
  );
}

/** The Invitations section — pending "someone wants to connect" requests. */
export function InvitationsView() {
  const { invitations, syncing, error, refresh } = useInvitations();

  // Pull the current pending set when the section opens.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-6 py-3">
        <h2 className="text-base font-semibold text-fg-strong">Invitations</h2>
        {invitations.length > 0 && (
          <span className="rounded-full bg-surface-input px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
            {invitations.length}
          </span>
        )}
        {syncing && (
          <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-fg-muted border-t-transparent" title="Refreshing invitations" />
        )}
        <span className="flex-1" />
        <button
          onClick={() => void refresh()}
          disabled={syncing}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-2.5 px-6 py-5">
          {error && <div className="py-8 text-center text-sm text-red-500 dark:text-red-400">{error}</div>}

          {!error && invitations.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-sm text-fg-muted">{syncing ? 'Loading invitations…' : 'No pending invitations.'}</p>
              {!syncing && <p className="max-w-xs text-xs text-fg-faint">New connection requests will show up here to accept or ignore.</p>}
            </div>
          )}

          {invitations.map((inv) => (
            <InvitationRow key={inv.id} inv={inv} />
          ))}
        </div>
      </div>
    </div>
  );
}
