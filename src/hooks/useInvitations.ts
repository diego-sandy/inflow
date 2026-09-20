import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { useDbGeneration } from '@/hooks/useDbGeneration';
import { sendBridgeMessage } from '@/lib/bridge';
import type { Invitation } from '@/types/network';

/**
 * Received connection invitations, live from the local table, with a refresh
 * that pulls the current pending set from LinkedIn and accept/ignore actions
 * (optimistic — the row is removed immediately, then the API call fires).
 */
export function useInvitations() {
  const dbGen = useDbGeneration();
  const invitations = useLiveQuery(async () => {
    if (!db) return [] as Invitation[];
    const rows = await db.invitations.toArray();
    return rows.sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0));
  }, [dbGen]) ?? [];

  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await sendBridgeMessage({ type: 'FETCH_INVITATIONS' });
      if (!res.success) setError(res.error || 'Failed to load invitations');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSyncing(false);
    }
  };

  const respond = async (inv: Invitation, action: 'accept' | 'ignore') => {
    if (db) await db.invitations.delete(inv.id).catch(() => {}); // optimistic
    return sendBridgeMessage({
      type: 'RESPOND_INVITATION',
      invitationId: inv.id,
      sharedSecret: inv.sharedSecret,
      action,
    });
  };

  return { invitations, count: invitations.length, syncing, error, refresh, respond };
}
