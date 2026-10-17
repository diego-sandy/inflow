import { useEffect, useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import { sendBridgeMessage } from '@/lib/bridge';
import {
  connectionsSyncNotice,
  getFullRefreshMode,
  setFullRefreshMode,
  type FullRefreshMode,
} from '@/lib/connections-settings';

const OPTIONS: { value: FullRefreshMode; label: string; detail: string }[] = [
  {
    value: 'auto',
    label: 'Automatically',
    detail: 'Daily, or weekly once you have more than 2,000 connections.',
  },
  { value: 'weekly', label: 'Weekly', detail: 'Once a week, whatever the size of your network.' },
  {
    value: 'manual',
    label: 'Only when I ask',
    detail: 'New connections still appear; changed headlines wait for the button below.',
  },
];

/**
 * How often the whole connection list is re-read. Everything else about
 * syncing connections is automatic, because a user cannot know what a safe
 * number of requests is; this is the one choice that is genuinely theirs.
 */
export function ConnectionsSettings() {
  const showToast = useUIStore((s) => s.showToast);
  const [mode, setMode] = useState<FullRefreshMode>('auto');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    getFullRefreshMode().then(setMode);
  }, []);

  const choose = (next: FullRefreshMode) => {
    setMode(next);
    void setFullRefreshMode(next);
  };

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      const res = await sendBridgeMessage({ type: 'FETCH_CONNECTIONS', force: true });
      if (!res.success) {
        showToast({ message: res.error || 'Could not refresh connections' });
        return;
      }
      showToast({ message: connectionsSyncNotice(res.data) ?? 'Connections are up to date' });
    } catch (e: any) {
      showToast({ message: String(e?.message || e) });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-fg-strong">Refreshing the whole list</h3>
        <p className="mt-1 text-xs text-fg-muted">
          Each visit to Connections only checks for new people, usually with a single request.
          Re-reading the whole list is what picks up new jobs and titles, and it takes one
          request per 40 people, so it happens rarely, paced like scrolling and spread over
          several days on a large network.
        </p>
      </div>

      <div role="radiogroup" aria-label="Refresh the whole list" className="space-y-1">
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-hover"
          >
            <input
              type="radio"
              name="connections-full-refresh"
              value={o.value}
              checked={mode === o.value}
              onChange={() => choose(o.value)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg-strong">{o.label}</span>
              <span className="block text-xs text-fg-muted">{o.detail}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="border-t border-edge pt-4">
        <button
          onClick={refreshNow}
          disabled={refreshing}
          className="rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'Refresh all connections now'}
        </button>
        <p className="mt-2 text-xs text-fg-muted">
          Still held to the daily limit, so on a large network it carries on over the next few days.
        </p>
      </div>
    </div>
  );
}
