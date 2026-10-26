// @vitest-environment jsdom
/**
 * Regression (ported from upstream regression 139): acting on a
 * display-merged conversation left its twin behind, so an archived, deleted
 * or moved conversation popped straight back into the list, and a star on a
 * merged row would not turn off.
 *
 * LinkedIn can hold several 1:1 threads with the same person. Observed live:
 * an old INMAIL thread from 2023 (starred, state ACCEPTED) and a second thread
 * created the moment an invitation carrying a note was accepted. useConversations
 * folds them into one row and hangs the others off `mergedIds`.
 *
 * Only markRead was ever taught about that list. Archive, star, delete, spam and
 * the category moves each acted on `conversation.id` alone — the primary, which
 * is merely whichever thread has the latest activity. So archiving the row
 * archived one thread, the twin stayed in Focused, and the next render brought
 * the conversation straight back: "inflow isn't syncing this".
 *
 * Every conversation-level action must now apply to every thread the row stands
 * for. Each thread gets its own pendingActions row (with its own rollback
 * snapshot): hasPendingAction guards per conversation, and the offline drainer
 * replays per row, so a single row for the primary would leave the twin
 * unguarded during the call and never sent at all when offline.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { renderHook, waitFor } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';
import { settleOptimistic } from '../helpers/settle';

let testDb: any;
const { mockSendBridgeMessage } = vi.hoisted(() => ({ mockSendBridgeMessage: vi.fn() }));
let bridgeCalls: any[] = [];

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return { ...original, get db() { return testDb; } };
});
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: mockSendBridgeMessage }));

import { useOptimisticAction } from '@/hooks/useOptimisticAction';

/** The shape useConversations produces: primary row carrying its twin's id. */
const PRIMARY = '2-katarina-invite';   // newer thread — wins on lastActivityAt
const TWIN = '2-katarina-inmail';      // the long-running thread

async function seedMergedPair(overrides: { starred?: number } = {}) {
  const shared = 'urn:li:fsd_profile:katarina';
  await testDb.conversations.bulkPut([
    makeConversation({
      id: PRIMARY, participantUrns: [shared],
      lastActivityAt: 2_000, archived: 0, category: 'PRIMARY_INBOX',
      starred: 0, read: 1,
    }),
    makeConversation({
      id: TWIN, participantUrns: [shared],
      lastActivityAt: 1_000, archived: 0, category: 'PRIMARY_INBOX',
      starred: overrides.starred ?? 0, read: 1,
    }),
  ]);
  // What the list hands an action: the primary, with the twin merged in.
  return { ...(await testDb.conversations.get(PRIMARY)), mergedIds: [TWIN] };
}

const rows = async () => ({
  primary: await testDb.conversations.get(PRIMARY),
  twin: await testDb.conversations.get(TWIN),
});

beforeEach(async () => {
  testDb = new Dexie(`TestDB_138_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  bridgeCalls = [];
  mockSendBridgeMessage.mockReset().mockImplementation(async (msg: any) => {
    bridgeCalls.push(msg);
    return { success: true };
  });
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(async () => {
  if (testDb) {
    await settleOptimistic(testDb);
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

const idsFor = (type: string) =>
  bridgeCalls.filter((m) => m.type === type).map((m) => m.conversationId).sort();

describe('merged twin threads — actions cover every thread', () => {
  it('archives the twin too, so the row cannot come back', async () => {
    const merged = await seedMergedPair();
    const { result } = renderHook(() => useOptimisticAction());

    await result.current.archiveConversation(merged);

    const { primary, twin } = await rows();
    expect(primary.archived).toBe(1);
    expect(twin.archived, 'the twin stays in Focused and the row reappears').toBe(1);
    expect(twin.category).toBe('ARCHIVE');
    await waitFor(() => expect(idsFor('ARCHIVE')).toEqual([PRIMARY, TWIN].sort()));
  });

  it('deletes every thread the row stands for', async () => {
    const merged = await seedMergedPair();
    const { result } = renderHook(() => useOptimisticAction());

    await result.current.deleteConversation(merged);

    const { primary, twin } = await rows();
    expect(primary).toBeUndefined();
    expect(twin, 'a surviving twin resurrects the conversation').toBeUndefined();
    await waitFor(() => expect(idsFor('DELETE_CONVERSATION')).toEqual([PRIMARY, TWIN].sort()));
  });

  it('stars every thread, so the star survives a re-merge', async () => {
    const merged = await seedMergedPair();
    const { result } = renderHook(() => useOptimisticAction());

    await result.current.starConversation(merged);

    const { primary, twin } = await rows();
    expect(primary.starred).toBe(1);
    expect(twin.starred).toBe(1);
  });

  it('unstars every thread — the merged row shows starred if ANY thread is', async () => {
    // useConversations ORs `starred` across the group, so leaving one starred
    // means the star visibly refuses to turn off.
    const merged = { ...(await seedMergedPair({ starred: 1 })), starred: 1 };
    const { result } = renderHook(() => useOptimisticAction());

    await result.current.starConversation(merged);

    const { primary, twin } = await rows();
    expect(primary.starred).toBe(0);
    expect(twin.starred).toBe(0);
  });

  it('moves every thread out of the inbox together', async () => {
    const merged = await seedMergedPair();
    const { result } = renderHook(() => useOptimisticAction());

    await result.current.moveToOther(merged);

    await waitFor(async () => {
      const { primary, twin } = await rows();
      expect(primary.category).toBe('SECONDARY_INBOX');
      expect(twin.category).toBe('SECONDARY_INBOX');
    });
  });

  it('marks every thread as spam together', async () => {
    const merged = await seedMergedPair();
    const { result } = renderHook(() => useOptimisticAction());

    await result.current.moveToSpam(merged);

    await waitFor(async () => {
      const { primary, twin } = await rows();
      expect(primary.category).toBe('SPAM');
      expect(twin.category).toBe('SPAM');
    });
  });

  it('leaves an unmerged conversation exactly as it was', async () => {
    // The common case must not grow extra writes or bridge calls.
    const solo = makeConversation({ id: '2-solo', archived: 0 });
    await testDb.conversations.put(solo);
    const { result } = renderHook(() => useOptimisticAction());

    await result.current.archiveConversation(solo);

    expect((await testDb.conversations.get('2-solo')).archived).toBe(1);
    await waitFor(() => expect(idsFor('ARCHIVE')).toEqual(['2-solo']));
  });
it('guards the twin from server merges while the call is in flight', async () => {
    const merged = await seedMergedPair();
    mockSendBridgeMessage.mockImplementation((msg: any) => {
      bridgeCalls.push(msg);
      return new Promise(() => {}); // never settles: the call is in flight
    });
    const { result } = renderHook(() => useOptimisticAction());

    await result.current.archiveConversation(merged);

    const pending = (await testDb.pendingActions.toArray())
      .filter((a: any) => a.status === 'pending')
      .map((a: any) => a.conversationId)
      .sort();
    expect(pending).toEqual([PRIMARY, TWIN].sort());
    // Nothing will settle these; clear them so teardown doesn't wait.
    await testDb.pendingActions.clear();
  });

  it('queues the twin for the offline drainer too', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    const merged = await seedMergedPair();
    const { result } = renderHook(() => useOptimisticAction());

    await result.current.archiveConversation(merged);

    const queued = (await testDb.pendingActions.toArray()).filter((a: any) => a.status === 'queued');
    expect(queued.map((a: any) => a.bridgeMessage).sort((a: any, b: any) => a.conversationId.localeCompare(b.conversationId)))
      .toEqual([PRIMARY, TWIN].sort().map((id) => ({ type: 'ARCHIVE', conversationId: id })));
    expect(bridgeCalls).toEqual([]);
  });

  it('a failed move puts each thread back where IT was', async () => {
    // In the InMail tab the twins can sit in different folders.
    const merged = await seedMergedPair();
    await testDb.conversations.update(TWIN, { category: 'SECONDARY_INBOX' });
    mockSendBridgeMessage.mockImplementation(async (msg: any) => {
      bridgeCalls.push(msg);
      return { success: false };
    });
    const { result } = renderHook(() => useOptimisticAction());

    await result.current.moveToSpam(merged);

    await waitFor(async () => {
      const statuses = (await testDb.pendingActions.toArray()).map((a: any) => a.status);
      expect(statuses).toEqual(['failed', 'failed']);
    });
    const { primary, twin } = await rows();
    expect(primary.category).toBe('PRIMARY_INBOX');
    expect(twin.category).toBe('SECONDARY_INBOX');
  });

  it('a failed delete restores every thread', async () => {
    const merged = await seedMergedPair();
    mockSendBridgeMessage.mockImplementation(async (msg: any) => {
      bridgeCalls.push(msg);
      return { success: false };
    });
    const { result } = renderHook(() => useOptimisticAction());

    await result.current.deleteConversation(merged);

    await waitFor(async () => {
      const { primary, twin } = await rows();
      expect(primary).toBeTruthy();
      expect(twin).toBeTruthy();
    });
    expect(await testDb.tombstones.count()).toBe(0);
    expect('mergedIds' in (await testDb.conversations.get(PRIMARY))).toBe(false);
  });
});
