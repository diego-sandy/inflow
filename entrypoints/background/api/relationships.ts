import { voyagerFetch } from './client';
import { debugLog } from '@/lib/debug-log';

/**
 * Received connection invitations (classic relationships API — the same
 * endpoint voyager-web's My Network page uses).
 *
 * `includeInsights=true` carries the shared-connections insight ("Sarah Chen and
 * 11 other shared connections") shown under each request — same request, one
 * response, no extra cost.
 */
export async function fetchInvitationsRaw(start = 0, count = 40): Promise<any> {
  const res = await voyagerFetch(
    `/relationships/invitationViews?q=receivedInvitation&start=${start}&count=${count}&includeInsights=true`,
  );
  if (!res.ok) {
    debugLog('error', `fetchInvitationsRaw failed: ${res.status}`);
    throw new Error(`fetchInvitations failed: ${res.status}`);
  }
  return res.json();
}

/** Accept or ignore an invitation. Requires the sharedSecret from the list response. */
export async function respondToInvitation(
  invitationId: string,
  sharedSecret: string,
  action: 'accept' | 'ignore',
): Promise<void> {
  const res = await voyagerFetch(`/relationships/invitations/${invitationId}?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      invitationId,
      invitationSharedSecret: sharedSecret,
      isGenericInvitation: false,
    }),
    skipJitter: true,
  });
  if (!res.ok) {
    debugLog('error', `respondToInvitation (${action}) failed: ${res.status}`);
    throw new Error(`Invitation ${action} failed: ${res.status}`);
  }
}

/**
 * One page of the user's pending SENT invitations. Upstream concluded Voyager
 * no longer serves these and read LinkedIn's web page instead, but only tried
 * `sentInvitationViews` (404); the V2 view answers, in the same normalized
 * format as the other relationship endpoints. Verified live on 2026-10-30.
 */
export async function fetchSentInvitationsRaw(start = 0, count = 10): Promise<any> {
  const res = await voyagerFetch(
    `/relationships/sentInvitationViewsV2?q=invitationType&invitationType=CONNECTION&start=${start}&count=${count}`,
  );
  if (!res.ok) {
    debugLog('error', `fetchSentInvitationsRaw failed: ${res.status}`);
    const err = new Error(`fetchSentInvitations failed: ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}
