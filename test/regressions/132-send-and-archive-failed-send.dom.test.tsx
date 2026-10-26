// @vitest-environment jsdom
/**
 * Regression (ported from upstream regression 115): a failed send in
 * sendAndArchive left the conversation archived with no rollback — the
 * message never went out, yet the thread vanished from the inbox.
 *
 * The conversation is archived optimistically BEFORE the send. When the send
 * failed, the function only toasted and returned — never un-archived, never
 * marked the pending action failed. Net effect: message not sent, thread
 * gone from the inbox locally, server never told to archive, and the
 * stranded 'pending' row guarded the conversation from server merges
 * indefinitely. Every other failure branch in the file rolls back.
 *
 * Follow-up (upstream 0341266): the rollbacks in sendAndArchive and
 * archiveConversation hardcoded archived: 0. On a thread that was ALREADY
 * archived (replying from the Archived tab, or pressing E on an archived
 * InMail in the InMail tab) that wrote {archived: 0, category: 'ARCHIVE'},
 * which matches no tab query — the conversation disappeared from every list.
 * Rollbacks now restore the archived flag they snapshotted.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { renderHook, waitFor } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

let testDb: any;
const { mockSendBridgeMessage } = vi.hoisted(() => ({ mockSendBridgeMessage: vi.fn() }));
let bridgeCalls: any[] = [];
let bridgeResolvers: Array<(value: any) => void> = [];

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: mockSendBridgeMessage,
}));

import { useOptimisticAction } from '@/hooks/useOptimisticAction';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_132_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.conversations.put(makeConversation({
    id: 'conv-115',
    category: 'PRIMARY_INBOX',
    archived: 0,
  }));

  bridgeCalls = [];
  bridgeResolvers = [];
  mockSendBridgeMessage.mockReset().mockImplementation((msg: any) => {
    bridgeCalls.push(msg);
    return new Promise((resolve) => bridgeResolvers.push(resolve));
  });
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(async () => {
  for (const resolve of bridgeResolvers) resolve({ success: true });
  await Promise.resolve();
  await Promise.resolve();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('rolls back the optimistic archive when the send fails', async () => {
  const { result } = renderHook(() => useOptimisticAction());

  const done = result.current.sendAndArchive('conv-115', 'hello there');
  await waitFor(() => expect(bridgeCalls.some((m) => m.type === 'SEND_MESSAGE')).toBe(true));

  // The send fails.
  bridgeResolvers[bridgeCalls.findIndex((m) => m.type === 'SEND_MESSAGE')]({ success: false, error: 'nope' });
  await done;

  const conv = await testDb.conversations.get('conv-115');
  expect(conv.archived).toBe(0);
  expect(conv.category).toBe('PRIMARY_INBOX');

  // The archive action is not left stranded at 'pending' (which would guard
  // the conversation from server merges forever).
  const actions = (await testDb.pendingActions.toArray()).filter((a: any) => a.conversationId === 'conv-115');
  const archiveAction = actions.find((a: any) => a.type === 'archive');
  expect(archiveAction?.status).toBe('failed');

  // And the archive bridge call never fired.
  expect(bridgeCalls.some((m) => m.type === 'ARCHIVE')).toBe(false);
});

it('a failed send on an ALREADY-archived thread leaves it archived (not vanished)', async () => {
  // The rollback must restore the archived flag it saw, not hardcode
  // archived: 0 — {archived: 0, category: 'ARCHIVE'} matches NO tab query and
  // the conversation disappears from the entire UI until a sync heals it.
  const { result } = renderHook(() => useOptimisticAction());
  await testDb.conversations.put(makeConversation({
    id: 'conv-115b',
    category: 'ARCHIVE',
    archived: 1,
  }));

  const done = result.current.sendAndArchive('conv-115b', 'reply from the archive');
  await waitFor(() => expect(bridgeCalls.some((m) => m.type === 'SEND_MESSAGE' && m.conversationId === 'conv-115b')).toBe(true));
  bridgeResolvers[bridgeCalls.findIndex((m) => m.type === 'SEND_MESSAGE' && m.conversationId === 'conv-115b')]({ success: false });
  await done;

  const conv = await testDb.conversations.get('conv-115b');
  expect(conv.archived).toBe(1);
  expect(conv.category).toBe('ARCHIVE');
});

it('a failed archive of an ALREADY-archived thread leaves it archived (not vanished)', async () => {
  // The InMail tab lists InMail threads regardless of folder, so E can call
  // archiveConversation on a thread that is already archived.
  const { result } = renderHook(() => useOptimisticAction());
  const conv = makeConversation({ id: 'conv-115c', category: 'ARCHIVE', archived: 1 });
  await testDb.conversations.put(conv);

  await result.current.archiveConversation(conv);
  await waitFor(() => expect(bridgeCalls.some((m) => m.type === 'ARCHIVE' && m.conversationId === 'conv-115c')).toBe(true));
  bridgeResolvers[bridgeCalls.findIndex((m) => m.type === 'ARCHIVE' && m.conversationId === 'conv-115c')]({ success: false });

  await waitFor(async () => {
    const action = (await testDb.pendingActions.toArray()).find((a: any) => a.conversationId === 'conv-115c');
    expect(action?.status).toBe('failed');
  });
  const stored = await testDb.conversations.get('conv-115c');
  expect(stored.archived).toBe(1);
  expect(stored.category).toBe('ARCHIVE');
});
