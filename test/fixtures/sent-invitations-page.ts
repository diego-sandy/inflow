/**
 * A sentInvitationViewsV2 page in Voyager's normalized format, shaped like the
 * live answer recorded on 2026-10-30 (record kinds and field names from the
 * in-app check; people and ids made up). The sender's own MiniProfile is in
 * `included` too, linked as *fromMember, and must not show up as a row.
 */
const SELF = 'urn:li:fs_miniProfile:SELF';

function mini(id: string, first: string, last: string, occupation: string, publicIdentifier: string) {
  return {
    $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
    entityUrn: `urn:li:fs_miniProfile:${id}`,
    dashEntityUrn: `urn:li:fsd_profile:${id}`,
    objectUrn: `urn:li:member:${id.length}`,
    firstName: first,
    lastName: last,
    occupation,
    publicIdentifier,
    picture: {
      'com.linkedin.common.VectorImage': {
        rootUrl: `https://media.example.test/${id}/`,
        artifacts: [{ width: 100, height: 100, fileIdentifyingUrlPathSegment: '100.jpg' }],
      },
    },
    trackingId: 't',
  };
}

function invitation(id: string, toId: string, sentTime: number, message: string | null) {
  return {
    $type: 'com.linkedin.voyager.relationships.invitation.Invitation',
    entityUrn: `urn:li:fs_relInvitation:${id}`,
    '*fromMember': SELF,
    '*toMember': `urn:li:fs_miniProfile:${toId}`,
    customMessage: !!message,
    message,
    sentTime,
    sharedSecret: 'secret',
    invitationType: 'CONNECTION',
    unseen: false,
  };
}

function view(id: string) {
  return {
    $type: 'com.linkedin.voyager.relationships.invitation.SentInvitationViewV2',
    entityUrn: `urn:li:fs_sentInvitationViewV2:${id}`,
    '*invitation': `urn:li:fs_relInvitation:${id}`,
  };
}

export function sentPage(rows: { id: string; toId: string; first: string; last: string; sentTime: number; message?: string | null }[]) {
  return {
    data: { '*elements': rows.map((r) => `urn:li:fs_sentInvitationViewV2:${r.id}`), paging: { start: 0, count: 10, total: 0 } },
    included: [
      mini('SELF', 'Me', 'Myself', 'Founder', 'me'),
      ...rows.flatMap((r) => [
        view(r.id),
        invitation(r.id, r.toId, r.sentTime, r.message ?? null),
        mini(r.toId, r.first, r.last, `${r.first}'s headline`, `${r.first.toLowerCase()}-${r.last.toLowerCase()}`),
      ]),
    ],
  };
}

export const emptyPage = { data: { '*elements': [], paging: { start: 0, count: 10, total: 0 } }, included: [] };
