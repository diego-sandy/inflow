/**
 * Regression (ported from upstream regression 113): an EMPTY categories array
 * was read as authoritative "Focused, un-archived, un-starred".
 *
 * normalizeConversations guarded sparse payloads with `conv.categories ? ...`
 * — a truthiness test an empty array passes. `[]` carries no category
 * information, but it produced archived: 0 / category: 'PRIMARY_INBOX' /
 * starred: 0, which mergeConversation writes through (it only skips
 * undefined) — popping an archived thread back into Focused and un-starring
 * it. That contradicts the function's own documented rule: "Absence is NOT a
 * value." New conversations still land in PRIMARY_INBOX via mergeConversation's
 * first-insert defaults.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { normalizeConversations } from '@/lib/voyager-normalizer';
import type { VoyagerResponse } from '@/types/voyager';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { mergeConversation } from '../../entrypoints/background/sync/merge-conversation';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_145_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

function conversationsResponse(categories: string[] | undefined): VoyagerResponse {
  const participantUrn = 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:OTHER';
  return {
    data: {},
    included: [
      {
        $type: 'com.linkedin.messenger.MessagingParticipant',
        entityUrn: participantUrn,
        hostIdentityUrn: 'urn:li:fsd_profile:OTHER',
        participantType: { member: { firstName: { text: 'Other' }, lastName: { text: 'User' } } },
      },
      {
        $type: 'com.linkedin.messenger.Conversation',
        entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,2-empty-cats)',
        lastActivityAt: 1000,
        ...(categories !== undefined ? { categories } : {}),
        '*conversationParticipants': [participantUrn],
      },
    ],
  } as VoyagerResponse;
}

it('treats an empty categories array as unknown, like a missing one', () => {
  const { conversations } = normalizeConversations(conversationsResponse([]));
  expect(conversations[0].archived).toBeUndefined();
  expect(conversations[0].category).toBeUndefined();
  expect(conversations[0].starred).toBeUndefined();
});

it('does not pop an archived, starred thread back into Focused on merge', async () => {
  const { conversations: [archived] } = normalizeConversations(conversationsResponse(['ARCHIVE', 'STARRED']));
  await mergeConversation(archived);

  const { conversations: [sparse] } = normalizeConversations(conversationsResponse([]));
  await mergeConversation({ ...sparse, lastActivityAt: 2000 });

  const stored = await testDb.conversations.get('2-empty-cats');
  expect(stored.category).toBe('ARCHIVE');
  expect(stored.archived).toBe(1);
  expect(stored.starred).toBe(1);
});

it('a brand-new conversation with empty categories still lands in Focused', async () => {
  const { conversations: [sparse] } = normalizeConversations(conversationsResponse([]));
  await mergeConversation(sparse);

  const stored = await testDb.conversations.get('2-empty-cats');
  expect(stored.category).toBe('PRIMARY_INBOX');
  expect(stored.archived).toBe(0);
});

it('still derives flags from a populated categories array', () => {
  const { conversations } = normalizeConversations(conversationsResponse(['ARCHIVE', 'STARRED']));
  expect(conversations[0].archived).toBe(1);
  expect(conversations[0].category).toBe('ARCHIVE');
  expect(conversations[0].starred).toBe(1);
});
