/**
 * Regression (ported from upstream regression 182): re-discovery re-paginated
 * every category in full, every 15 minutes, forever.
 *
 * A category that finishes is reset to phase 'discovering' with an empty
 * cursor once it is 15 minutes old, so a large archive was walked end to end
 * on that clock — hundreds of requests an hour whose every page enqueued
 * nothing, because everything below the head of the list was already known.
 * Conversations sort by last activity, so anything that changes comes back to
 * the top: the tail was re-read purely to re-read it, and sustained traffic
 * like that is what trips LinkedIn's rate limits.
 *
 * Fix: re-discovery is shallow — a few pages off the head — unless the last
 * walk that actually reached the end has aged out (6h). Only that kind of walk
 * can prove a server-side deletion, so it stays the only kind that sweeps.
 */
import Dexie from 'dexie';
import { applySchema, type SyncState } from '@/db/database';

let testDb: any;
const genState = vi.hoisted(() => ({ gen: 1 }));

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return { ...original, get db() { return testDb; }, getDbGeneration: () => genState.gen };
});

vi.mock('../../entrypoints/background/sync/sync-engine', () => ({
  syncConversations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../entrypoints/background/sync/sync-discovery', () => ({
  discoverPage: vi.fn(),
  enqueueConversations: vi.fn().mockResolvedValue({ enqueued: 0, skipped: 20 }),
}));

vi.mock('../../entrypoints/background/sync/sync-backfill', () => ({
  backfillBatch: vi.fn().mockResolvedValue(0),
  recoverStuckItems: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../entrypoints/background/sync/sweep-deleted', () => ({
  sweepDeletedConversations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../entrypoints/background/realtime/sse-client', () => ({
  isRealtimeConnected: vi.fn().mockReturnValue(false),
}));

vi.mock('../../entrypoints/background/action-queue', () => ({
  drainActionQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { discoverPage } from '../../entrypoints/background/sync/sync-discovery';
import { sweepDeletedConversations } from '../../entrypoints/background/sync/sweep-deleted';
import { burstDiscover, discoveryDepthFor, runDiscoveryRound } from '../../entrypoints/background/sync/sync-coordinator';

const HOUR = 60 * 60 * 1000;

function makeSyncState(overrides: Partial<SyncState> = {}): SyncState {
  return {
    category: 'PRIMARY_INBOX',
    phase: 'complete',
    cursor: '',
    totalDiscovered: 0,
    discoveryCompletedAt: 0,
    lastSyncStartedAt: Date.now(),
    lastSyncCompletedAt: 0,
    ...overrides,
  };
}

/** Only ARCHIVE is discovering; the rest are settled. */
async function seed(archive: Partial<SyncState>) {
  await testDb.syncState.bulkPut([
    makeSyncState({ category: 'PRIMARY_INBOX' }),
    makeSyncState({ category: 'SECONDARY_INBOX' }),
    makeSyncState({ category: 'SPAM' }),
    makeSyncState({ category: 'ARCHIVE', phase: 'discovering', ...archive }),
  ]);
}

/** Pagination that never ends — the shape a big archive presents. */
function endlessPages() {
  let page = 0;
  vi.mocked(discoverPage).mockImplementation(async () => ({
    conversations: [],
    profiles: [],
    isLastPage: false,
    nextCursor: `cursor-${++page}`,
  }));
}

const noDelay = () => Promise.resolve();

beforeEach(async () => {
  vi.clearAllMocks();
  genState.gen = 1;
  testDb = new Dexie(`TestDB_147_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

describe('re-discovery stops re-reading history', () => {
  it('walks deep while no walk has ever reached the end', () => {
    expect(discoveryDepthFor(makeSyncState(), Date.now())).toBe('deep');
  });

  it('goes shallow after a recent complete walk, deep once that ages out', () => {
    const now = Date.now();
    expect(discoveryDepthFor(makeSyncState({ fullDiscoveryCompletedAt: now - HOUR }), now)).toBe('shallow');
    expect(discoveryDepthFor(makeSyncState({ fullDiscoveryCompletedAt: now - 7 * HOUR }), now)).toBe('deep');
  });

  it('reads only the head of the list on a shallow round', async () => {
    await seed({ discoveryDepth: 'shallow', fullDiscoveryCompletedAt: Date.now() - HOUR });
    endlessPages();

    await runDiscoveryRound(20, noDelay);

    // Three pages, not twenty — and the round is done, not parked mid-walk.
    expect(discoverPage).toHaveBeenCalledTimes(3);
    const state = await testDb.syncState.get('ARCHIVE');
    expect(state.phase).toBe('backfilling');
    expect(state.cursor).toBe('');
  });

  it('does not claim coverage — or sweep — on a shallow round', async () => {
    const before = Date.now() - HOUR;
    await seed({ discoveryDepth: 'shallow', fullDiscoveryCompletedAt: before });
    endlessPages();

    await runDiscoveryRound(20, noDelay);

    const state = await testDb.syncState.get('ARCHIVE');
    expect(state.fullDiscoveryCompletedAt).toBe(before);
    expect(sweepDeletedConversations).not.toHaveBeenCalled();
  });

  it('walks a deep round to the end, records the coverage, and sweeps', async () => {
    await seed({ discoveryDepth: 'deep', fullDiscoveryCompletedAt: Date.now() - 7 * HOUR });

    let page = 0;
    vi.mocked(discoverPage).mockImplementation(async () => {
      page++;
      return { conversations: [], profiles: [], isLastPage: page >= 6, nextCursor: page >= 6 ? null : `cursor-${page}` };
    });

    await runDiscoveryRound(20, noDelay);

    expect(discoverPage).toHaveBeenCalledTimes(6);
    const state = await testDb.syncState.get('ARCHIVE');
    expect(state.phase).toBe('backfilling');
    expect(state.fullDiscoveryCompletedAt).toBeGreaterThan(Date.now() - 5000);
    expect(sweepDeletedConversations).toHaveBeenCalled();
  });

  it('a burst that reaches the end records the coverage too', async () => {
    await seed({});
    vi.mocked(discoverPage).mockResolvedValue({
      conversations: [], profiles: [], isLastPage: true, nextCursor: null,
    });

    await burstDiscover('ARCHIVE');

    const state = await testDb.syncState.get('ARCHIVE');
    expect(state.fullDiscoveryCompletedAt).toBeGreaterThan(Date.now() - 5000);
    expect(discoveryDepthFor(state, Date.now())).toBe('shallow');
  });

  it('treats a category with no depth recorded as deep — a first sync must cover it', async () => {
    await seed({});
    endlessPages();

    await runDiscoveryRound(8, noDelay);

    expect(discoverPage).toHaveBeenCalledTimes(8);
    expect((await testDb.syncState.get('ARCHIVE')).phase).toBe('discovering');
  });
});
