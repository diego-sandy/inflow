/**
 * Sent invitations come from Voyager's relationships/sentInvitationViewsV2,
 * not from LinkedIn's web page (upstream concluded the API no longer served
 * them, but never tried V2; it answered on a live account). The reader follows
 * view → invitation → recipient; the walk pages without trusting short pages.
 */
import { normalizeSentInvitations } from '@/lib/invitation-normalizer';
import { walkSentInvitations } from '@/../entrypoints/background/sync/sent-invitations';
import { sentPage, emptyPage } from '../fixtures/sent-invitations-page';

const NOW = Date.UTC(2026, 9, 30);

describe('normalizeSentInvitations', () => {
  it('reads each request in page order: recipient, headline, photo, link, note, time', () => {
    const { invitations, rawCount } = normalizeSentInvitations(sentPage([
      { id: '1', toId: 'DANA', first: 'Dana', last: 'Whitfield', sentTime: NOW, message: 'Hi Dana, met at the summit.' },
      { id: '2', toId: 'OWEN', first: 'Owen', last: 'Pratt', sentTime: NOW - 86400_000 },
    ]));
    expect(rawCount).toBe(2);
    expect(invitations).toEqual([
      {
        id: '1', toUrn: 'urn:li:fsd_profile:DANA', name: 'Dana Whitfield', headline: "Dana's headline",
        pictureUrl: 'https://media.example.test/DANA/100.jpg', publicId: 'dana-whitfield',
        message: 'Hi Dana, met at the summit.', sentAt: NOW,
      },
      {
        id: '2', toUrn: 'urn:li:fsd_profile:OWEN', name: 'Owen Pratt', headline: "Owen's headline",
        pictureUrl: 'https://media.example.test/OWEN/100.jpg', publicId: 'owen-pratt', message: '', sentAt: NOW - 86400_000,
      },
    ]);
  });

  it('never lists the sender, whose own profile rides along in the response', () => {
    const { invitations } = normalizeSentInvitations(sentPage([{ id: '1', toId: 'DANA', first: 'Dana', last: 'Whitfield', sentTime: NOW }]));
    expect(invitations.map((i) => i.name)).not.toContain('Me Myself');
  });

  it('copes with a missing recipient record or an unexpected shape', () => {
    const page = sentPage([{ id: '1', toId: 'DANA', first: 'Dana', last: 'Whitfield', sentTime: NOW }]);
    page.included = page.included.filter((e: any) => e.entityUrn !== 'urn:li:fs_miniProfile:DANA');
    expect(normalizeSentInvitations(page).invitations[0]).toMatchObject({ id: '1', name: 'LinkedIn Member', toUrn: 'urn:li:fsd_profile:DANA' });
    expect(normalizeSentInvitations({}).invitations).toEqual([]);
    expect(normalizeSentInvitations(null).rawCount).toBe(0);
  });
});

describe('walkSentInvitations', () => {
  const rows = (from: number, n: number) =>
    Array.from({ length: n }, (_, k) => ({ id: String(from + k), toId: `P${from + k}`, first: 'P', last: String(from + k), sentTime: NOW - (from + k) }));

  it('keeps going past a short page, and stops at an empty one', async () => {
    const fetchPage = vi.fn(async (start: number) =>
      start === 0 ? sentPage(rows(0, 9)) : start === 40 ? sentPage(rows(9, 3)) : emptyPage,
    );
    const res = await walkSentInvitations(fetchPage);
    expect(res).toMatchObject({ complete: true });
    expect(res.invitations).toHaveLength(12);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 40, 80]);
  });

  it('stops when a page only repeats what it already has', async () => {
    const fetchPage = vi.fn(async () => sentPage(rows(0, 5)));
    const res = await walkSentInvitations(fetchPage);
    expect(res.invitations).toHaveLength(5);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('drops to the page size known to work when 40 is refused', async () => {
    const fetchPage = vi.fn(async (start: number, count: number) => {
      if (count === 40) throw Object.assign(new Error('400'), { status: 400 });
      return start === 0 ? sentPage(rows(0, 9)) : emptyPage;
    });
    const res = await walkSentInvitations(fetchPage);
    expect(res.invitations).toHaveLength(9);
    expect(fetchPage.mock.calls.map((c) => c.slice(0, 2))).toEqual([[0, 40], [0, 10], [10, 10]]);
  });

  it('a throttle part-way returns what it has, marked incomplete, without retrying', async () => {
    const fetchPage = vi.fn(async (start: number) => {
      if (start === 0) return sentPage(rows(0, 9));
      throw Object.assign(new Error('429'), { status: 429 });
    });
    const res = await walkSentInvitations(fetchPage);
    expect(res).toMatchObject({ complete: false });
    expect(res.invitations).toHaveLength(9);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('a failure before anything arrived is an error, not an empty list', async () => {
    await expect(walkSentInvitations(async () => { throw Object.assign(new Error('fetchSentInvitations failed: 429'), { status: 429 }); }))
      .rejects.toThrow(/429/);
  });
});
