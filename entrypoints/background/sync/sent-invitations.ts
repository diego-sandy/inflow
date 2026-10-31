import { normalizeSentInvitations } from '@/lib/invitation-normalizer';
import { debugLog } from '@/lib/debug-log';
import type { SentInvitation } from '@/types/network';

/** Asked for first; LinkedIn's received endpoint takes 40. */
const PAGE = 40;
/** The size verified to work on this endpoint, used if 40 is refused. */
const FALLBACK_PAGE = 10;
/** Bounds the walk at a few hundred pending invitations, plenty in practice. */
const MAX_PAGES = 40;

export interface SentInvitationsResult {
  invitations: SentInvitation[];
  /** False when the walk stopped early (throttled, or hit MAX_PAGES). */
  complete: boolean;
}

type FetchPage = (start: number, count: number) => Promise<any>;

const statusOf = (e: unknown) => (e as { status?: number })?.status;

/**
 * Page through the user's pending sent invitations.
 *
 * Stops on an empty page or one that adds nobody new. Not on a short page:
 * LinkedIn returned 9 rows for a request of 10 on an account with more, so a
 * short page is not the end. A throttle (429/999) ends the walk with what it
 * has, marked incomplete, rather than retrying unattended.
 */
export async function walkSentInvitations(fetchPage: FetchPage): Promise<SentInvitationsResult> {
  const seen = new Set<string>();
  const invitations: SentInvitation[] = [];
  let count = PAGE;
  let start = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    let raw: any;
    try {
      raw = await fetchPage(start, count);
    } catch (e) {
      // Some endpoints refuse a page size they don't allow; drop to the size
      // known to work, once, from the top.
      if (page === 0 && count !== FALLBACK_PAGE && statusOf(e) === 400) {
        debugLog('info', `sent invitations: page size ${count} refused, using ${FALLBACK_PAGE}`);
        count = FALLBACK_PAGE;
        page = -1;
        continue;
      }
      const s = statusOf(e);
      if (invitations.length && (s === 429 || s === 999)) {
        debugLog('error', `sent invitations: throttled after ${invitations.length}; stopping`);
        return { invitations, complete: false };
      }
      throw e;
    }
    const { invitations: rows, rawCount } = normalizeSentInvitations(raw);
    if (rawCount === 0) return { invitations, complete: true };
    const fresh = rows.filter((r) => !seen.has(r.id));
    if (fresh.length === 0) return { invitations, complete: true };
    for (const r of fresh) {
      seen.add(r.id);
      invitations.push(r);
    }
    // Advance by what was asked for, not what came back: a short page still
    // covered `count` positions.
    start += count;
  }
  return { invitations, complete: false };
}
