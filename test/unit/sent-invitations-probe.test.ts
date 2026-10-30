/**
 * The one-off "does Voyager still serve sent invitations?" check. It decides
 * whether a Sent tab can use the regular API, so it must make exactly one
 * read-only request, report only the response's shape (never a name), and say
 * plainly what each outcome means.
 */
const voyagerFetch = vi.fn();
vi.mock('@/../entrypoints/background/api/client', () => ({
  voyagerFetch: (...a: any[]) => voyagerFetch(...a),
}));

import {
  probeSentInvitations,
  summarizeSentProbe,
  SENT_INVITATIONS_PROBE_PATH,
} from '@/../entrypoints/background/api/relationships';
import { describeSentProbe } from '@/lib/sent-invitations-check';

const reply = (status: number, body: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => {
    if (body === undefined) throw new Error('not json');
    return body;
  },
});

beforeEach(() => voyagerFetch.mockReset());

it('makes one GET to sentInvitationViewsV2 and nothing else', async () => {
  voyagerFetch.mockResolvedValue(reply(404, undefined));
  await probeSentInvitations();
  expect(voyagerFetch).toHaveBeenCalledTimes(1);
  const [path, opts] = voyagerFetch.mock.calls[0];
  expect(path).toBe(SENT_INVITATIONS_PROBE_PATH);
  expect(path).toContain('/relationships/sentInvitationViewsV2?q=invitationType&invitationType=CONNECTION');
  expect(opts?.method ?? 'GET').toBe('GET');
});

it('reports the shape of a working answer, with no names in it', async () => {
  voyagerFetch.mockResolvedValue(reply(200, {
    data: {
      paging: { start: 0, count: 10, total: 37 },
      elements: [
        { invitation: 'urn:li:fsd_invitation:1', sentTime: 1, toMember: 'urn:li:fs_miniProfile:A' },
        { invitation: 'urn:li:fsd_invitation:2', sentTime: 2, toMember: 'urn:li:fs_miniProfile:B' },
      ],
    },
    included: [{ firstName: 'Dana', lastName: 'Whitfield' }, { firstName: 'Owen', lastName: 'Pratt' }],
  }));
  const probe = await probeSentInvitations();
  expect(probe).toMatchObject({ status: 200, ok: true, rows: 2, total: 37, included: 2, fields: ['invitation', 'sentTime', 'toMember'] });
  const text = describeSentProbe(probe);
  expect(text).toMatch(/It works: 2 sent invitations on the first page \(of 37\)/);
  expect(text).not.toMatch(/Dana|Whitfield|Owen|Pratt/);
});

it('says plainly when the address is gone, or the query was refused', () => {
  expect(describeSentProbe(summarizeSentProbe(404, false, null))).toMatch(/HTTP 404\nLinkedIn no longer serves this address/);
  expect(describeSentProbe(summarizeSentProbe(400, false, null))).toMatch(/HTTP 400\n.*rejected the request/);
  expect(describeSentProbe(summarizeSentProbe(429, false, null))).toMatch(/Throttled.*nothing is known yet/);
});

it('does not call an empty or unrecognised answer a success', () => {
  expect(describeSentProbe(summarizeSentProbe(200, true, { elements: [] }))).toMatch(/empty list/);
  expect(describeSentProbe(summarizeSentProbe(200, true, { something: 'else' }))).toMatch(/not with a list inflow recognises/);
});

it('reads the normalized format: references in *elements, records by kind in included, names never shown', () => {
  const probe = summarizeSentProbe(200, true, {
    data: { '*elements': ['urn:li:fsd_invitationView:1', 'urn:li:fsd_invitationView:2'], paging: { total: 0 } },
    included: [
      { $type: 'com.linkedin.voyager.relationships.invitation.SentInvitationView', entityUrn: 'urn:1', sentTime: 1, '*invitation': 'urn:x' },
      { $type: 'com.linkedin.voyager.relationships.invitation.SentInvitationView', entityUrn: 'urn:2', sentTime: 2, '*invitation': 'urn:y' },
      { $type: 'com.linkedin.voyager.identity.shared.MiniProfile', firstName: 'Dana', lastName: 'Whitfield', publicIdentifier: 'dana-w' },
    ],
  });
  expect(probe.rows).toBe(2);
  expect(probe.kinds).toEqual([
    { type: 'SentInvitationView', count: 2, fields: ['$type', '*invitation', 'entityUrn', 'sentTime'] },
    { type: 'MiniProfile', count: 1, fields: ['$type', 'firstName', 'lastName', 'publicIdentifier'] },
  ]);
  const text = describeSentProbe(probe);
  expect(text).toMatch(/It works: 2 sent invitations/);
  expect(text).toMatch(/SentInvitationView × 2: \$type, \*invitation, entityUrn, sentTime/);
  expect(text).not.toMatch(/Dana|Whitfield|dana-w/);
});
