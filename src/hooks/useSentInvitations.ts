import { useCallback, useEffect, useState } from 'react';
import { sendBridgeMessage } from '@/lib/bridge';
import type { SentInvitation } from '@/types/network';

interface SentState {
  invitations: SentInvitation[];
  /** False when LinkedIn stopped answering part-way (throttled). */
  complete: boolean;
  loaded: boolean;
}

// Kept for the session: the list is fetched on demand (it is not stored in the
// database), and flipping between Received and Sent shouldn't refetch it.
let cache: SentState = { invitations: [], complete: true, loaded: false };

/** For tests. */
export function resetSentInvitationsCache() {
  cache = { invitations: [], complete: true, loaded: false };
}

/**
 * The user's pending sent connection requests, read-only. Fetched the first
 * time it's needed (`active`), then on refresh.
 */
export function useSentInvitations(active: boolean) {
  const [state, setState] = useState<SentState>(cache);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await sendBridgeMessage({ type: 'FETCH_SENT_INVITATIONS' });
      if (res.success && res.data) {
        const list = [...(res.data.invitations as SentInvitation[])].sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0));
        cache = { invitations: list, complete: res.data.complete !== false, loaded: true };
        setState(cache);
      } else {
        setError(res.error || 'Failed to load sent invitations');
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (active && !cache.loaded) void refresh();
  }, [active, refresh]);

  return { ...state, syncing, error, refresh };
}
