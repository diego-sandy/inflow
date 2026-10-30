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
 * One-off check: does Voyager still serve SENT invitations?
 *
 * Upstream concluded it doesn't and built its Sent tab by reading LinkedIn's
 * web page instead, but only tried `sentInvitationViews` (404) and a few other
 * REST routes. Reverse-engineered clients use `sentInvitationViewsV2`, which
 * nobody here had tried. This makes that single read-only GET, the same way
 * fetchInvitationsRaw reads received ones, and reports only its shape: the
 * status, how many rows came back, and field names. No names or other values
 * leave this function.
 */
export const SENT_INVITATIONS_PROBE_PATH =
  '/relationships/sentInvitationViewsV2?q=invitationType&invitationType=CONNECTION&start=0&count=10';

export interface SentInvitationsProbe {
  status: number;
  ok: boolean;
  /** Rows on the first page (`elements`), when the body parsed. */
  rows?: number;
  /** `paging.total`, when present (LinkedIn sometimes reports 0 regardless). */
  total?: number;
  /** Entities in `included` (normalized responses put profiles there). */
  included?: number;
  /** Field names of the first row, sorted. Structure only. */
  fields?: string[];
}

/** Reduce a probe response to its shape. Pure, so it can be tested. */
export function summarizeSentProbe(status: number, ok: boolean, body: unknown): SentInvitationsProbe {
  const out: SentInvitationsProbe = { status, ok };
  if (!body || typeof body !== 'object') return out;
  const b = body as any;
  const data = b.data && typeof b.data === 'object' ? b.data : b; // normalized JSON wraps in `data`
  const elements = Array.isArray(data.elements) ? data.elements : Array.isArray(b.elements) ? b.elements : undefined;
  if (elements) {
    out.rows = elements.length;
    const first = elements[0];
    if (first && typeof first === 'object') out.fields = Object.keys(first).sort();
  }
  const paging = data.paging ?? b.paging;
  if (paging && typeof paging.total === 'number') out.total = paging.total;
  if (Array.isArray(b.included)) out.included = b.included.length;
  return out;
}

export async function probeSentInvitations(): Promise<SentInvitationsProbe> {
  const res = await voyagerFetch(SENT_INVITATIONS_PROBE_PATH, { skipJitter: true });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* an HTML or empty error page: the status says enough */
  }
  const summary = summarizeSentProbe(res.status, res.ok, body);
  debugLog(res.ok ? 'info' : 'error', `probeSentInvitations: ${JSON.stringify(summary)}`);
  return summary;
}
