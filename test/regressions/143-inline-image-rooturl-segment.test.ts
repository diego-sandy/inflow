/**
 * Regression (ported from upstream regression 111): an inline image whose
 * vectorImage carries its URL as rootUrl + fileIdentifyingUrlPathSegment lost
 * its attachment entirely.
 *
 * The image branch of extractAttachments only read `img.rootUrl` (whole URL)
 * or `artifacts[0].fileUrl`; it never joined rootUrl with an artifact's
 * fileIdentifyingUrlPathSegment — a shape getParticipantPicture already
 * handles — and only ever looked at the first artifact. The `if (imageUrl)`
 * guard then skipped the push, so the message rendered as an empty bubble
 * while the conversation preview still said "Sent an image".
 *
 * The fix must not regress the shapes that already worked: a complete
 * rootUrl is used as-is, never with a relative segment appended to it.
 */
import { normalizeMessages } from '@/lib/voyager-normalizer';
import type { VoyagerResponse } from '@/types/voyager';

function responseWithImage(vectorImage: any): VoyagerResponse {
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
        $type: 'com.linkedin.messenger.Message',
        entityUrn: 'urn:li:msg_message:(2-img,1)',
        body: { text: '' },
        deliveredAt: 1000,
        renderContent: [{ vectorImage }],
        '*sender': participantUrn,
      },
    ],
  } as VoyagerResponse;
}

function imageUrlOf(vectorImage: any) {
  return normalizeMessages(responseWithImage(vectorImage), '2-img')[0].attachments;
}

it('joins a directory rootUrl with the artifact path segment', () => {
  expect(
    imageUrlOf({
      rootUrl: 'https://media.licdn.com/dms/',
      artifacts: [{ width: 800, fileIdentifyingUrlPathSegment: 'image/v2/xyz' }],
    }),
  ).toEqual([{ type: 'image', imageUrl: 'https://media.licdn.com/dms/image/v2/xyz' }]);
});

it('uses a full-URL path segment when rootUrl is empty (messaging media shape)', () => {
  expect(
    imageUrlOf({
      rootUrl: '',
      artifacts: [{ width: 800, fileIdentifyingUrlPathSegment: 'https://media.licdn.com/dms/image/v2/abc' }],
    }),
  ).toEqual([{ type: 'image', imageUrl: 'https://media.licdn.com/dms/image/v2/abc' }]);
});

it('falls back to a sibling artifact fileUrl when the first artifact is bare', () => {
  // LinkedIn ships partially-populated artifact rows: one may carry neither a
  // fileUrl nor a path segment while a sibling has a working fileUrl.
  expect(
    imageUrlOf({
      rootUrl: '',
      artifacts: [{ width: 1200 }, { width: 200, fileUrl: 'https://cdn.example/small.jpg' }],
    }),
  ).toEqual([{ type: 'image', imageUrl: 'https://cdn.example/small.jpg' }]);
});

it('does not corrupt a complete rootUrl by appending a relative segment', () => {
  expect(
    imageUrlOf({
      rootUrl: 'https://media.licdn.com/dms/image/v2/WHOLE.jpg',
      artifacts: [{ width: 800, fileIdentifyingUrlPathSegment: 'seg-800' }],
    }),
  ).toEqual([{ type: 'image', imageUrl: 'https://media.licdn.com/dms/image/v2/WHOLE.jpg' }]);
});

it('still uses a whole-URL rootUrl when there are no artifacts', () => {
  expect(imageUrlOf({ rootUrl: 'https://media.licdn.com/whole.jpg' })).toEqual([
    { type: 'image', imageUrl: 'https://media.licdn.com/whole.jpg' },
  ]);
});
