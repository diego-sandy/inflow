// @vitest-environment jsdom
/**
 * Regression (ported from upstream regression 135): the new-message recipient
 * picker loaded the ENTIRE profiles and conversations tables from IndexedDB
 * on every typing pause.
 *
 * doSearch ran `Promise.all([db.profiles.toArray(), db.conversations
 * .toArray()])` after each 300ms debounce — on a mature inbox that is
 * thousands of rows materialized again and again while typing one name.
 *
 * Fix: the two tables are snapshotted once and reused for a few seconds;
 * seconds of staleness are invisible while typing a recipient's name.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applySchema } from '@/db/database';
import { makeProfile } from '../fixtures/factories';

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

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

import { NewMessageComposer } from '@/components/composer/NewMessageComposer';
import { useUIStore } from '@/store/ui-store';

// jsdom doesn't implement scrollIntoView; TypeaheadRow calls it in an effect.
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(async () => {
  testDb = new Dexie(`Composer154_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.profiles.bulkPut([
    makeProfile({ urn: 'urn:li:fsd_profile:SARAH', fullName: 'Sarah Chen', firstName: 'Sarah', lastName: 'Chen' }),
  ]);
  useUIStore.setState({ inboxTab: 'focused', composeNewActive: true });
  mockSendBridgeMessage.mockReset().mockImplementation(async (msg: any) => {
    if (msg.type === 'CHECK_AUTH') return { success: true, data: { memberUrn: 'urn:li:fsd_profile:SELF' } };
    if (msg.type === 'TYPEAHEAD_SEARCH') return { success: true, data: [] };
    return { success: true };
  });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('reuses one table snapshot across successive typing pauses', async () => {
  render(<NewMessageComposer />);
  const input = screen.getByPlaceholderText('Search for a person...');

  const profilesScan = vi.spyOn(testDb.profiles, 'toArray');
  const convsScan = vi.spyOn(testDb.conversations, 'toArray');

  // Two separate typing pauses → two debounced searches. Each search fires
  // the remote typeahead after its local pass, so waiting on that call means
  // both local searches have run.
  await userEvent.type(input, 'sa');
  await waitFor(() =>
    expect(mockSendBridgeMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'TYPEAHEAD_SEARCH', query: 'sa' })),
  );
  // The local match still shows from the snapshot.
  expect(await screen.findByText('Sarah Chen')).toBeInTheDocument();
  await userEvent.type(input, 'ra');
  await waitFor(() =>
    expect(mockSendBridgeMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'TYPEAHEAD_SEARCH', query: 'sara' })),
  );
  expect(screen.getByText('Sarah Chen')).toBeInTheDocument();

  expect(profilesScan.mock.calls.length).toBeLessThanOrEqual(1);
  expect(convsScan.mock.calls.length).toBeLessThanOrEqual(1);
});
