// @vitest-environment jsdom
/**
 * Regression (ported from upstream regression 101): inbound videos were
 * invisible.
 *
 * LinkedIn delivers received videos as a `*video` REFERENCE to a
 * com.linkedin.videocontent.VideoPlayMetadata entity in included[] — not as
 * an inline `video` object. extractAttachments (and the realtime handler's
 * drifted copy of it) only handled the inline shape, so a video message got
 * no attachment; with an empty body MessageBubble rendered a blank bubble and
 * the video could not be opened at all. The conversation-list preview was
 * blank for the same reason.
 *
 * Fix: resolve `*video` references (stream URL, poster, duration), still
 * yield a "Video" attachment when the reference can't be resolved, and have
 * the realtime handler share the normalizer's extractAttachments. The
 * existing video link in MessageBubble then plays it.
 */
import '../dom-setup';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

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

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: vi.fn().mockResolvedValue({ data: {}, included: [] }),
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { render } from '@testing-library/react';
import { normalizeMessages, normalizeConversations } from '@/lib/voyager-normalizer';
import { MessageBubble } from '@/components/thread/MessageBubble';
import { handleRealtimeEvent } from '../../entrypoints/background/realtime/event-handler';
import type { VoyagerResponse } from '@/types/voyager';

const STREAM_URL = 'https://www.linkedin.com/dms/prv/vid/v2/D4E23AQF/video.mp4';
const THUMB_URL = 'https://www.linkedin.com/dms/prv/image/v2/D4E23AQF/thumb.jpg';
const PARTICIPANT = 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:OSCAR';

// Real shape observed from messengerMessages: the renderContent item is only
// {"*video": urn}; the metadata lives in included[] with rootUrl='' and the
// full thumbnail URL inside fileIdentifyingUrlPathSegment.
const videoPlayMetadata = {
  $type: 'com.linkedin.videocontent.VideoPlayMetadata',
  entityUrn: 'urn:li:digitalmediaAsset:D4E23AQF',
  media: 'urn:li:digitalmediaAsset:D4E23AQF',
  duration: 34775,
  aspectRatio: 1.7777778,
  thumbnail: {
    $type: 'com.linkedin.common.VectorImage',
    rootUrl: '',
    artifacts: [{ width: 1280, height: 720, fileIdentifyingUrlPathSegment: THUMB_URL }],
  },
  progressiveStreams: [
    {
      streamingLocations: [{ url: STREAM_URL, expiresAt: null }],
      width: 640,
      height: 360,
      mediaType: 'video/mp4',
    },
  ],
  adaptiveStreams: [],
};

const participant = {
  $type: 'com.linkedin.messenger.MessagingParticipant',
  entityUrn: PARTICIPANT,
  hostIdentityUrn: 'urn:li:fsd_profile:OSCAR',
  participantType: { member: { firstName: { text: 'Oscar' }, lastName: { text: 'W' } } },
};

function videoMessage(overrides: Record<string, any> = {}) {
  return {
    $type: 'com.linkedin.messenger.Message',
    entityUrn: 'urn:li:msg_message:(2-conv,100)',
    '*sender': PARTICIPANT,
    body: { text: '' },
    deliveredAt: 1787297149024,
    renderContent: [{ '*video': videoPlayMetadata.entityUrn }],
    ...overrides,
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_148_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('normalizeMessages() with a *video reference', () => {
  it('resolves the VideoPlayMetadata entity into a playable video attachment', () => {
    const response = { data: {}, included: [participant, videoMessage(), videoPlayMetadata] } as VoyagerResponse;

    const [message] = normalizeMessages(response, '2-conv');
    expect(message.attachments).toHaveLength(1);
    const att = message.attachments![0];
    expect(att.type).toBe('video');
    expect(att.externalUrl).toBe(STREAM_URL);
    expect(att.imageUrl).toBe(THUMB_URL);
    expect(att.durationMs).toBe(34775);
  });

  it('still yields a video attachment when the reference cannot be resolved', () => {
    const response = { data: {}, included: [participant, videoMessage()] } as VoyagerResponse;

    const [message] = normalizeMessages(response, '2-conv');
    expect(message.attachments).toEqual([{ type: 'video', fallbackText: 'Video' }]);
  });
});

it('previews a *video-only last message as "Sent a video"', () => {
  const convUrn = 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,2-conv)';
  const response = {
    data: {},
    included: [
      participant,
      videoMessage({ '*conversation': convUrn }),
      videoPlayMetadata,
      {
        $type: 'com.linkedin.messenger.Conversation',
        entityUrn: convUrn,
        '*conversationParticipants': [PARTICIPANT],
        lastActivityAt: 1787297149024,
        unreadCount: 1,
        categories: ['INBOX', 'PRIMARY_INBOX'],
      },
    ],
  } as VoyagerResponse;

  const { conversations } = normalizeConversations(response);
  expect(conversations[0].lastMessage).toBe('Sent a video');
});

it('a video arriving over realtime is stored with its attachment', async () => {
  const convUrn = 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,2-conv)';
  await handleRealtimeEvent('event', {
    'com.linkedin.realtimefrontend.DecoratedEvent': {
      topic: '/messaging',
      payload: {
        data: {
          included: [participant, videoMessage({ '*conversation': convUrn }), videoPlayMetadata],
        },
      },
    },
  });

  const stored = await testDb.messages.get('urn:li:msg_message:(2-conv,100)');
  expect(stored).toBeDefined();
  expect(stored.attachments).toHaveLength(1);
  expect(stored.attachments[0].type).toBe('video');
  expect(stored.attachments[0].externalUrl).toBe(STREAM_URL);
});

it('a body-less inbound video renders as a link that plays it', () => {
  const response = { data: {}, included: [participant, videoMessage(), videoPlayMetadata] } as VoyagerResponse;
  const [message] = normalizeMessages(response, '2-conv');

  const { container } = render(
    <MessageBubble message={message} grouped={false} isLastInGroup={false} senderProfileUrl={null} />
  );

  const link = container.querySelector(`a[href="${STREAM_URL}"]`);
  expect(link).not.toBeNull();
  expect(link!.textContent).toContain('Video');
});
