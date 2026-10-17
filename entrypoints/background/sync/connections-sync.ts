import { db, mergeConnections, mergeProfiles } from '@/db/database';
import { debugLog } from '@/lib/debug-log';
import { normalizeConnections } from '@/lib/connections-normalizer';
import { getFullRefreshMode } from '@/lib/connections-settings';
import {
  CONNECTIONS_PAGE_SIZE,
  ConnectionsFetchError,
  MAX_CONNECTIONS,
  fetchConnectionsPage,
  isThrottleStatus,
} from '../api/connections';

/**
 * Keeps the local connection list current while asking LinkedIn as little as
 * possible. Opening Connections used to re-read the whole list every time: 27
 * requests for 1,041 people, 250 for 10,000, in about as many seconds. That is
 * the shape of traffic that gets an account flagged. Now a visit costs:
 *
 *  - nothing, if the list was checked in the last few minutes;
 *  - usually one request otherwise. The list comes back newest first, so new
 *    connections are all on the first page(s), and the check stops at the
 *    first person already stored;
 *  - and occasionally a full pass, which is the only way to pick up changed
 *    headlines. It is paced like someone scrolling, held to a daily budget, and
 *    resumes where it left off — so a large network loads over several days
 *    rather than in one burst, newest people first.
 *
 * If LinkedIn pushes back (429, or its 999 "this looks automated"), nothing is
 * retried: connections are left alone for a cooldown, then picked up again.
 */

/** A visit within this long of the last check makes no request at all. */
export const CHECK_FRESH_MS = 5 * 60 * 1000;
/** Most pages the check for new connections reads before leaving the rest to a full pass. */
export const HEAD_MAX_PAGES = 5;
/** Pages a full pass may read per day: 1,200 people. */
export const PASS_PAGES_PER_DAY = 30;
/** Pause between pages, randomized within this range, so paging reads as scrolling. */
export const PAGE_DELAY_MIN_MS = 1500;
export const PAGE_DELAY_MAX_MS = 4000;
/** How long connections are left alone after LinkedIn throttles a request. */
export const THROTTLE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** At or above this many stored connections, `auto` refreshes weekly instead of daily. */
export const LARGE_NETWORK = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface ConnectionsSyncState {
  /** Last successful check for new connections. */
  lastCheckAt: number;
  /** Last time a full pass reached the end of the list; 0 = never. */
  lastFullAt: number;
  /** Offset an unfinished full pass resumes from; absent when none is under way. */
  resumeAt?: number;
  /** Pages full passes have read in the current budget window. */
  budgetPages: number;
  budgetWindowStart: number;
  /** No requests until this time, after LinkedIn throttled one. */
  cooldownUntil: number;
}

export interface ConnectionsSyncResult {
  /** Requests made to LinkedIn by this run. */
  requests: number;
  /** Connections written (new or refreshed). */
  stored: number;
  /** A full pass is under way and will continue on a later visit. */
  loadingMore: boolean;
  /** Set while connections are paused after LinkedIn throttled a request. */
  cooldownUntil?: number;
  /** Why nothing was fetched, when nothing was. */
  skipped?: 'fresh' | 'cooldown';
}

export interface SyncDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  fetchPage?: (count: number, start: number) => Promise<any>;
}

const EMPTY_STATE: ConnectionsSyncState = {
  lastCheckAt: 0,
  lastFullAt: 0,
  budgetPages: 0,
  budgetWindowStart: 0,
  cooldownUntil: 0,
};

/**
 * Keyed by database name, which is per LinkedIn account, so switching accounts
 * never inherits another account's progress or cooldown.
 */
function stateKey(): string {
  return `connectionsSync:${db.name}`;
}

export async function loadConnectionsSyncState(): Promise<ConnectionsSyncState> {
  try {
    const key = stateKey();
    const got = await chrome.storage.local.get(key);
    return { ...EMPTY_STATE, ...(got[key] ?? {}) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function saveState(state: ConnectionsSyncState): Promise<void> {
  try {
    await chrome.storage.local.set({ [stateKey()]: state });
  } catch {
    // Storage unavailable: the next run starts over, which is safe, just slower.
  }
}

async function fullPassDue(state: ConnectionsSyncState, now: number): Promise<boolean> {
  if (state.resumeAt !== undefined) return true; // one is already under way
  if (state.lastFullAt === 0) return true; // the first load always runs
  const mode = await getFullRefreshMode();
  if (mode === 'manual') return false;
  const large = (await db.connections.count()) >= LARGE_NETWORK;
  const interval = mode === 'weekly' || large ? WEEK_MS : DAY_MS;
  return now - state.lastFullAt >= interval;
}

let inflight: Promise<ConnectionsSyncResult> | null = null;

/**
 * Bring the local connection list up to date. Concurrent calls share one run,
 * so a section mounting twice can never double the traffic.
 *
 * `force` is "Refresh all connections now": it skips the freshness window and
 * starts a full pass, but it still honors the daily budget and any cooldown —
 * those exist to protect the account, and a button should not bypass them.
 */
export function syncConnections(
  opts: { force?: boolean } = {},
  deps: SyncDeps = {},
): Promise<ConnectionsSyncResult> {
  if (!inflight) {
    inflight = runSync(opts, deps).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function runSync(opts: { force?: boolean }, deps: SyncDeps): Promise<ConnectionsSyncResult> {
  if (!db) throw new Error('Not authenticated');
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const fetchPage = deps.fetchPage ?? fetchConnectionsPage;

  const state = await loadConnectionsSyncState();
  const result: ConnectionsSyncResult = { requests: 0, stored: 0, loadingMore: false };

  if (state.cooldownUntil > now()) {
    return { ...result, loadingMore: state.resumeAt !== undefined, cooldownUntil: state.cooldownUntil, skipped: 'cooldown' };
  }

  if (opts.force && state.resumeAt === undefined) state.resumeAt = 0;
  if (now() - state.budgetWindowStart >= DAY_MS) {
    state.budgetWindowStart = now();
    state.budgetPages = 0;
  }
  // A pass that is due but has spent today's budget cannot run, so it is no
  // reason to skip the freshness window either.
  const passCanRun = (await fullPassDue(state, now())) && state.budgetPages < PASS_PAGES_PER_DAY;
  if (!opts.force && !passCanRun && now() - state.lastCheckAt < CHECK_FRESH_MS) {
    return { ...result, loadingMore: state.resumeAt !== undefined, skipped: 'fresh' };
  }

  const pause = () => sleep(PAGE_DELAY_MIN_MS + random() * (PAGE_DELAY_MAX_MS - PAGE_DELAY_MIN_MS));

  /** Fetch + persist one page. Returns how many rows it held and whether any were already stored. */
  const readPage = async (start: number): Promise<{ rows: number; anyKnown: boolean }> => {
    const raw = await fetchPage(CONNECTIONS_PAGE_SIZE, start);
    result.requests++;
    const rows = (raw?.data?.['*elements'] ?? []).length as number;
    const { connections, profiles } = normalizeConnections(raw);
    if (connections.length === 0) return { rows, anyKnown: false };
    const existing = await db.connections.bulkGet(connections.map((c) => c.profileUrn));
    await db.transaction('rw', [db.connections, db.profiles], async () => {
      // mergeConnections preserves AI categorization across re-syncs.
      await mergeConnections(connections);
      await mergeProfiles(profiles);
    });
    result.stored += connections.length;
    return { rows, anyKnown: existing.some(Boolean) };
  };

  try {
    // 1. New connections. On a first load there is nothing to recognize, so
    //    every page would look new: read one and leave the rest to the pass.
    const headLimit = (await db.connections.count()) === 0 ? 1 : HEAD_MAX_PAGES;
    let start = 0;
    let reachedEnd = false;
    for (let page = 0; page < headLimit; page++) {
      if (page > 0) await pause();
      const { rows, anyKnown } = await readPage(start);
      start += CONNECTIONS_PAGE_SIZE;
      if (rows < CONNECTIONS_PAGE_SIZE) {
        reachedEnd = true;
        break;
      }
      if (anyKnown) break;
    }
    state.lastCheckAt = now();

    if (reachedEnd) {
      // The whole list fit in the check: that was a full pass.
      state.lastFullAt = now();
      delete state.resumeAt;
    } else if (passCanRun || opts.force) {
      // 2. Full pass, continuing an unfinished one or starting after the check.
      //    A resumed offset can only drift down as people connect (they join
      //    at the top), so resuming re-reads a few rather than skipping any.
      if (state.resumeAt === undefined || state.resumeAt < start) state.resumeAt = start;
      while (state.budgetPages < PASS_PAGES_PER_DAY && state.resumeAt! < MAX_CONNECTIONS) {
        await pause();
        const { rows } = await readPage(state.resumeAt!);
        state.budgetPages++;
        if (rows < CONNECTIONS_PAGE_SIZE) {
          state.lastFullAt = now();
          delete state.resumeAt;
          break;
        }
        state.resumeAt! += CONNECTIONS_PAGE_SIZE;
        // Saved every page, so a closed tab or restarted worker resumes here.
        await saveState(state);
      }
    }
  } catch (e) {
    if (e instanceof ConnectionsFetchError && isThrottleStatus(e.status)) {
      state.cooldownUntil = now() + THROTTLE_COOLDOWN_MS;
      await saveState(state);
      debugLog('warn', `[CONNECTIONS] LinkedIn throttled (${e.status}); pausing connections sync until ${new Date(state.cooldownUntil).toISOString()}`);
      return { ...result, loadingMore: state.resumeAt !== undefined, cooldownUntil: state.cooldownUntil };
    }
    await saveState(state);
    throw e;
  }

  await saveState(state);
  result.loadingMore = state.resumeAt !== undefined;
  debugLog('info', `[CONNECTIONS] ${result.requests} request(s), ${result.stored} stored${result.loadingMore ? `, full pass resumes at ${state.resumeAt}` : ''}`);
  return result;
}
