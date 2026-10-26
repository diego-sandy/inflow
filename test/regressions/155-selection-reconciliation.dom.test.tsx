// @vitest-environment jsdom
/**
 * Regression (ported from upstream regression 167): opening a thread that was
 * written to the database a moment ago could bounce the selection onto
 * whoever was at that position in the list instead.
 *
 * App keeps the selected conversation and the rendered list in agreement:
 * when the selected id is not in the list it recovers onto the row at the
 * same position. That is right for a thread that was archived, deleted or
 * moved, and wrong for one that simply is not listed YET — rows land in the
 * database a beat before the live query reports them, and a tab switch first
 * serves that tab's cached results, which predate the row. Reading that gap
 * as "removed" opened the wrong person's thread, with the composer focused.
 *
 * Fix: before recovering, check the database. A row that is still there and
 * belongs to this tab is coming, so wait for it; gone or headed elsewhere
 * still recovers at once. A search narrows the list below the tab, so while
 * one is active the old behaviour stays.
 *
 * Both halves pull in opposite directions, so both are pinned here.
 */
import '../dom-setup';
import { render, screen, waitFor, act } from '@testing-library/react';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Conversation } from '@/types/conversation';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: vi.fn(async (msg: any) => {
    switch (msg.type) {
      case 'CHECK_AUTH':
        return { success: true, data: { authenticated: true } };
      case 'GET_SYNC_PROGRESS':
        return { success: true, data: { categories: {}, queue: { pending: 0 } } };
      case 'GET_SSE_STATUS':
        return { success: true, data: { connected: true } };
      case 'SEARCH_CONVERSATIONS':
        return { success: true, data: { conversationIds: [] } };
      default:
        return { success: true, data: {} };
    }
  }),
}));

import { App } from '../../entrypoints/app/App';
import { useUIStore } from '@/store/ui-store';

function conv(id: string, over: Partial<Conversation> = {}): Conversation {
  return {
    id,
    participantUrns: [`urn:li:fsd_profile:${id}`],
    participantNames: [`Person ${id}`],
    participantPictures: [''],
    lastMessage: `message from ${id}`,
    lastActivityAt: 1_750_000_000_000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    ...over,
  } as Conversation;
}

const selected = () => useUIStore.getState().selectedConversationId;

/** Let effects, the live query and the database check all settle. */
async function settle(ms = 400) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_155_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({
    activeSection: 'inbox', inboxTab: 'focused', selectedConversationId: null,
    selectedIndex: 0, composeNewActive: false, searchQuery: '', _pendingRestore: null,
  });
  (globalThis as any).IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  // UpdateBanner reads the manifest version on mount.
  (chrome.runtime as any).getManifest ??= () => ({ version: '0.0.0' });
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

/** Render the inbox with two threads and the first one selected. */
async function openInbox() {
  await testDb.conversations.bulkPut([
    conv('first', { lastActivityAt: 2_000_000_000_000 }),
    conv('second', { lastActivityAt: 1_000_000_000_000 }),
  ]);
  render(<App />);
  await waitFor(() => expect(screen.getAllByText('Person second').length).toBeGreaterThan(0));
  act(() => { useUIStore.getState().openThread('first', 0); });
  await settle(100);
}

describe('gone vs not listed yet', () => {
  it('moves on when the selected thread is archived away', async () => {
    await openInbox();

    await act(async () => { await testDb.conversations.update('first', { archived: 1 }); });
    await settle();

    // Leaving it selected would keep an archived thread on screen in Focused.
    expect(selected()).toBe('second');
  });

  it('moves on when the selected thread is deleted outright', async () => {
    await openInbox();

    await act(async () => { await testDb.conversations.delete('first'); });
    await settle();

    expect(selected()).toBe('second');
  });

  it('moves on when the selected thread is moved to another folder', async () => {
    await openInbox();

    await act(async () => {
      await testDb.conversations.update('first', { category: 'SECONDARY_INBOX' });
    });
    await settle();

    expect(selected()).toBe('second');
  });

  it('waits for a thread written a beat ago instead of recovering off it', async () => {
    // The row is in the database and headed for this tab, but the live query
    // has not reported it yet.
    await openInbox();

    await act(async () => {
      await testDb.conversations.put(conv('brand-new', { lastActivityAt: 3_000_000_000_000 }));
      useUIStore.getState().openThread('brand-new', 0);
    });
    await settle();

    expect(selected()).toBe('brand-new');
  });

  it('never flickers through the previous thread while waiting', async () => {
    // One flip is enough to misfile a reply: the composer stays focused, so
    // whoever is selected during the gap is who gets typed to.
    await openInbox();

    await act(async () => {
      await testDb.conversations.put(conv('brand-new', { lastActivityAt: 3_000_000_000_000 }));
      useUIStore.getState().openThread('brand-new', 0);
    });
    for (let i = 0; i < 10; i++) {
      await settle(50);
      expect(selected()).toBe('brand-new');
    }
  });

  it('still recovers from a thread that never existed', async () => {
    // A stale id — from a restored view, or a row deleted in another window.
    // Waiting forever would strand the user on an empty pane.
    await openInbox();

    act(() => { useUIStore.getState().openThread('no-such-thread', 0); });
    await settle();

    expect(selected()).not.toBe('no-such-thread');
    expect(['first', 'second']).toContain(selected());
  });

  it('does not keep waiting on a 1:1 thread merged into a newer one', async () => {
    // Two threads with the same person are shown as one row (the newest).
    // The older one is still in the database and still "belongs" to Focused,
    // but it will never be listed on its own — waiting on it would strand the
    // selection on a row the list cannot show.
    await openInbox();

    await act(async () => {
      await testDb.conversations.put(
        conv('first-twin', {
          participantUrns: ['urn:li:fsd_profile:first'],
          lastActivityAt: 3_000_000_000_000,
        })
      );
    });
    await settle();

    expect(selected()).not.toBe('first');
  });
});

describe('jumping to a conversation', () => {
  it('clears a search that would hide the target', async () => {
    // A notification click while a search is active on the same tab: the tab
    // switch is a no-op, so the search stayed and hid the target, and the
    // reconciliation recovered onto whatever the search did list.
    const { navigateToConversation } = await import('@/lib/navigate-to-conversation');
    await openInbox();

    act(() => { useUIStore.setState({ searchQuery: 'Person second' }); });
    await settle();
    expect(selected()).toBe('second');

    await act(async () => { await navigateToConversation('first'); });
    await settle();

    expect(useUIStore.getState().searchQuery).toBe('');
    expect(selected()).toBe('first');
  });
});
