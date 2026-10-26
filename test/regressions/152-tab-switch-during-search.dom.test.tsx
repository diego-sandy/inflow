// @vitest-environment jsdom
/**
 * Regression (ported from upstream regression 121): switching tabs while a
 * search was active showed the previous tab's SEARCH RESULTS as the new tab's
 * content, and cached them as that tab's results.
 *
 * useConversations guards the tab switch by comparing "tab changed AND the
 * live-query value is the same one seen last time" — but the tracker only
 * updated while NOT searching, so it froze at the pre-search value.
 * setInboxTab clears the query and switches the tab in ONE update, so the next
 * render compared the still-pending search results against that old array:
 * different, so "not stale", and the old tab's search leftovers rendered as
 * the new tab's list (an empty search showed an empty folder) with no spinner.
 *
 * Fix: keep the identity tracker current while searching too, without ever
 * storing search results as a tab's own content.
 */
import '../dom-setup';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversations } from '@/hooks/useConversations';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_152_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({ searchQuery: '', inboxTab: 'focused' });
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

it("shows the target tab's cached results, not search leftovers, when switching tabs mid-search", async () => {
  await testDb.conversations.bulkPut([
    makeConversation({ id: 'focused-a', category: 'PRIMARY_INBOX', archived: 0 }),
    makeConversation({ id: 'other-b', category: 'SECONDARY_INBOX', archived: 0 }),
  ]);

  const { result } = renderHook(() => useConversations());
  const ids = () => result.current.conversations.map((c) => c.id);

  // Visit Other so it has cached results, then return to Focused.
  await act(async () => { useUIStore.getState().setInboxTab('other'); });
  await waitFor(() => expect(ids()).toEqual(['other-b']));
  await act(async () => { useUIStore.getState().setInboxTab('focused'); });
  await waitFor(() => expect(ids()).toEqual(['focused-a']));

  // A search on Focused that matches nothing.
  await act(async () => { useUIStore.setState({ searchQuery: 'zzz-no-match' }); });
  await waitFor(() => expect(result.current.conversations).toEqual([]));

  // The real tab switch: setInboxTab clears the query and changes the tab in
  // one update.
  await act(async () => { useUIStore.getState().setInboxTab('other'); });

  // The first paint after the switch must serve Other's own cached results,
  // not Focused's empty search leftovers.
  expect(ids()).toEqual(['other-b']);
});
