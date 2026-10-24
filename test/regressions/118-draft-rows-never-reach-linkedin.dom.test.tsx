// @vitest-environment jsdom
/**
 * Regression (ported from upstream 2e2d3a6): actions on a new-message draft
 * row went to LinkedIn.
 *
 * The composer mints a local `draft-…` conversation to hold its recipients,
 * and it sits in the list like any other row. Archive, star, move, mark
 * read/unread all sent its id to Voyager, which answered 400 ("The EntityKey
 * draft-… is in an invalid format"), so the user saw a failure and a rollback
 * on a row that looked real. They now stop locally. Sending still goes
 * through: that is what turns a draft into a real thread.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { act, renderHook } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { settleOptimistic } from '../helpers/settle';
import { makeConversation } from '../fixtures/factories';

let testDb: any;
const { mockSendBridgeMessage } = vi.hoisted(() => ({ mockSendBridgeMessage: vi.fn() }));

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

const DRAFT_ID = 'draft-ACoAAtest';

beforeEach(async () => {
  testDb = new Dexie(`DraftNeverLinkedIn_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.conversations.put(makeConversation({
    id: DRAFT_ID,
    draft: 1,
    read: 1,
    starred: 0,
    archived: 0,
    category: 'PRIMARY_INBOX',
    participantUrns: ['urn:li:fsd_profile:ACoAAtest'],
    participantNames: ['Recipient'],
  }));
  mockSendBridgeMessage.mockReset().mockResolvedValue({ success: true });
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(async () => {
  await settleOptimistic(testDb);
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

const draft = () => testDb.conversations.get(DRAFT_ID);

it.each([
  ['archive', (a: any, c: any) => a.archiveConversation(c)],
  ['star', (a: any, c: any) => a.starConversation(c)],
  ['move to Other', (a: any, c: any) => a.moveToOther(c)],
  ['move to spam', (a: any, c: any) => a.moveToSpam(c)],
  ['mark read', (a: any, c: any) => a.markRead(c.id)],
  ['mark unread', (a: any, c: any) => a.markUnread(c.id)],
])('%s on a draft row never calls LinkedIn and leaves the row alone', async (_label, run) => {
  const { result } = renderHook(() => useOptimisticAction());
  const before = await draft();
  await act(async () => {
    await run(result.current, before);
  });
  expect(mockSendBridgeMessage).not.toHaveBeenCalled();
  expect(await draft()).toEqual(before);
  expect(await testDb.pendingActions.count()).toBe(0);
});

it('send+archive on a draft still sends, and skips only the archive', async () => {
  const { result } = renderHook(() => useOptimisticAction());
  await act(async () => {
    await result.current.sendAndArchive(DRAFT_ID, 'hello there');
  });
  const types = mockSendBridgeMessage.mock.calls.map((c) => c[0].type);
  expect(types).not.toContain('ARCHIVE');
  expect(types.length).toBeGreaterThan(0);
});
