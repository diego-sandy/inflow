// @vitest-environment jsdom
/**
 * Regression: Open conversation on a contact (and the Outbox's link to a
 * reply) switched to Messages but kept whichever tab was open last. With
 * Archive, Other or Spam open, the thread wasn't in the list, so the inbox
 * fell back to that tab's top conversation instead.
 *
 * Fix: both go through navigateToConversation, which picks the tab the
 * conversation lives in before opening it, as notification clicks already did.
 */
import '../dom-setup';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
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
import { navigateToConversation } from '@/lib/navigate-to-conversation';

function conv(id: string, name: string, over: Partial<Conversation> = {}): Conversation {
  return {
    id,
    participantUrns: [`urn:li:fsd_profile:${id}`],
    participantNames: [name],
    participantPictures: [''],
    lastMessage: `message from ${name}`,
    lastActivityAt: 1_750_000_000_000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    ...over,
  } as Conversation;
}

async function settle(ms = 400) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_157_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.conversations.bulkPut([
    conv('dana', 'Dana Whitfield', { lastActivityAt: 2_000_000_000_000 }),
    conv('sam', 'Sam Reyes', { lastActivityAt: 1_900_000_000_000, archived: 1 }),
    conv('harbor', 'Harbor Lane Billing', { lastActivityAt: 1_800_000_000_000, archived: 1 }),
    conv('kit', 'Kit Moreno', { lastActivityAt: 1_700_000_000_000, category: 'SECONDARY_INBOX' }),
  ]);
  useUIStore.setState({
    activeSection: 'inbox', inboxTab: 'focused', selectedConversationId: null,
    selectedIndex: 0, composeNewActive: false, searchQuery: '', _pendingRestore: null,
  });
  (globalThis as any).IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  (chrome.runtime as any).getManifest ??= () => ({ version: '0.0.0' });
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

/** Leave Messages on Archive, then go to Connections, as the user did. */
async function lastOnArchiveThenConnections() {
  render(<App />);
  act(() => { useUIStore.getState().setInboxTab('archived'); });
  await waitFor(() => expect(screen.getAllByText('Sam Reyes').length).toBeGreaterThan(0));
  act(() => { useUIStore.getState().setActiveSection('connections'); });
  await settle(100);
}

it('opens a Primary conversation from Connections when Archive was the last tab', async () => {
  await lastOnArchiveThenConnections();

  await act(async () => { await navigateToConversation('dana'); });
  await settle();

  const s = useUIStore.getState();
  expect(s.activeSection).toBe('inbox');
  expect(s.inboxTab).toBe('focused');
  // Not Sam, the top of Archive.
  expect(s.selectedConversationId).toBe('dana');
});

it('opens an Other conversation in Other', async () => {
  await lastOnArchiveThenConnections();

  await act(async () => { await navigateToConversation('kit'); });
  await settle();

  expect(useUIStore.getState().inboxTab).toBe('other');
  expect(useUIStore.getState().selectedConversationId).toBe('kit');
});

it('opens an archived conversation that is not the top of Archive', async () => {
  render(<App />);
  await waitFor(() => expect(screen.getAllByText('Dana Whitfield').length).toBeGreaterThan(0));
  act(() => { useUIStore.getState().setActiveSection('connections'); });
  await settle(100);

  await act(async () => { await navigateToConversation('harbor'); });
  await settle();

  expect(useUIStore.getState().inboxTab).toBe('archived');
  expect(useUIStore.getState().selectedConversationId).toBe('harbor');
});
