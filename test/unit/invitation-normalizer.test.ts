/**
 * normalizeInvitations turns a raw Voyager relationships payload into typed
 * Invitation records, including the shared-connections insight.
 */
import { normalizeInvitations, invitationPaging } from '@/lib/invitation-normalizer';

const raw = {
  included: [
    {
      $type: 'com.linkedin.voyager.relationships.invitation.Invitation',
      entityUrn: 'urn:li:fs_relInvitation:12345',
      sharedSecret: 'SECRET',
      '*fromMember': 'urn:li:fs_miniProfile:ABC',
      message: "Hi, let's connect",
      sentTime: 1700000000000,
    },
    {
      $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
      entityUrn: 'urn:li:fs_miniProfile:ABC',
      firstName: 'Ada',
      lastName: 'Lovelace',
      occupation: 'Mathematician',
      publicIdentifier: 'adalovelace',
    },
    {
      $type: 'com.linkedin.voyager.relationships.invitation.InvitationView',
      entityUrn: 'urn:li:fs_invitationView:999',
      '*invitation': 'urn:li:fs_relInvitation:12345',
      insights: [{ sharedInsight: { totalCount: 3, '*connections': ['urn:li:fs_miniProfile:M1'] } }],
    },
    {
      $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
      entityUrn: 'urn:li:fs_miniProfile:M1',
      firstName: 'Grace',
      lastName: 'Hopper',
    },
  ],
  data: { paging: { total: 1 } },
};

it('parses an invitation with sender + insight', () => {
  const { invitations, profiles, rawCount } = normalizeInvitations(raw);
  expect(rawCount).toBe(1);
  expect(invitations).toHaveLength(1);
  const inv = invitations[0];
  expect(inv).toMatchObject({
    id: '12345',
    sharedSecret: 'SECRET',
    name: 'Ada Lovelace',
    headline: 'Mathematician',
    publicId: 'adalovelace',
    fromUrn: 'urn:li:fsd_profile:ABC',
    message: "Hi, let's connect",
    sentAt: 1700000000000,
    status: 'pending',
    mutualCount: 3,
  });
  expect(inv.mutualNames).toEqual(['Grace Hopper']);
  expect(profiles[0].urn).toBe('urn:li:fsd_profile:ABC');
});

it('reads server paging total', () => {
  expect(invitationPaging(raw)).toEqual({ total: 1 });
  expect(invitationPaging({})).toBeNull();
});

it('is defensive against an empty payload', () => {
  const { invitations, rawCount } = normalizeInvitations({});
  expect(invitations).toEqual([]);
  expect(rawCount).toBe(0);
});
