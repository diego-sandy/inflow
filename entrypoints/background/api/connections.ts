import { voyagerFetch } from './client';
import { debugLog } from '@/lib/debug-log';

// Decoration that inlines the connected member's Profile (name, headline,
// picture) alongside each Connection so a single request has everything the
// list needs.
const DECORATION =
  'com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16';

// LinkedIn caps this endpoint's page size; 40 is the largest it reliably honors.
export const CONNECTIONS_PAGE_SIZE = 40;

// LinkedIn's own limit on first-degree connections. The pager stops on a short
// page long before this; it is only a backstop against a response that keeps
// returning full pages forever.
export const MAX_CONNECTIONS = 30_000;

/**
 * A connections page LinkedIn refused. Carries the status so the caller can
 * tell being throttled, which calls for backing off, from any other failure.
 */
export class ConnectionsFetchError extends Error {
  constructor(public readonly status: number) {
    super(`Fetch connections failed: ${status}`);
    this.name = 'ConnectionsFetchError';
  }
}

/**
 * LinkedIn saying "slow down": 429 is the standard rate limit, and 999 is what
 * LinkedIn returns once it has decided the traffic looks automated.
 */
export function isThrottleStatus(status: number): boolean {
  return status === 429 || status === 999;
}

/**
 * Fetch one page of the viewer's connections, most-recently-added first.
 * Returns the raw normalized+json response for {@link normalizeConnections}.
 */
export async function fetchConnectionsPage(
  count: number = CONNECTIONS_PAGE_SIZE,
  start: number = 0,
): Promise<any> {
  const path =
    `/relationships/dash/connections?decorationId=${DECORATION}` +
    `&count=${count}&q=search&sortType=RECENTLY_ADDED&start=${start}`;

  // First page is user-initiated (panel open) — skip the human-like jitter.
  const res = await voyagerFetch(path, { skipJitter: start === 0 });
  if (!res.ok) {
    debugLog('error', `fetchConnectionsPage failed: ${res.status}`);
    throw new ConnectionsFetchError(res.status);
  }
  return res.json();
}
