// Phase 1 smart retrieval: local relevance ranking + the planner-driven
// subset/fallback decision.
import {
  retrieveRelevant,
  smartRetrieve,
  RETRIEVAL_MIN_CONNECTIONS,
} from '@/lib/connection-retrieval';
import type { Connection } from '@/types/connection';

function c(over: Partial<Connection>): Connection {
  return {
    profileUrn: Math.random().toString(36).slice(2),
    connectionUrn: 'c',
    connectedAt: 0,
    publicId: '',
    firstName: '',
    lastName: '',
    fullName: 'Someone',
    headline: '',
    pictureUrl: '',
    syncedAt: 0,
    ...over,
  } as Connection;
}

describe('retrieveRelevant', () => {
  const people = [
    c({ fullName: 'Ada Invest', headline: 'Partner at a VC fund' }),
    c({ fullName: 'Bob Build', headline: 'Founder, fintech payments' }),
    c({ fullName: 'Cara Care', headline: 'Nurse' }),
    c({ fullName: 'Dan Data', roleCategory: 'Investor', interestTags: ['Angel'] }),
  ];

  it('matches across name, headline, role, and interests; ranks by hit count', () => {
    const { subset, matched } = retrieveRelevant(people, ['investor', 'vc', 'angel']);
    // Ada (vc), Dan (investor + angel) match; Bob/Cara don't.
    expect(matched).toBe(2);
    const names = subset.map((p) => p.fullName);
    expect(names).toContain('Ada Invest');
    expect(names).toContain('Dan Data');
    // Dan matches two terms → ranked before Ada (one term).
    expect(names[0]).toBe('Dan Data');
  });

  it('returns nothing for empty/too-short keywords', () => {
    expect(retrieveRelevant(people, []).matched).toBe(0);
    expect(retrieveRelevant(people, ['a']).matched).toBe(0);
  });

  it('caps the subset size', () => {
    const many = Array.from({ length: 50 }, () => c({ headline: 'investor' }));
    expect(retrieveRelevant(many, ['investor'], 10).subset).toHaveLength(10);
  });
});

describe('smartRetrieve', () => {
  const small = Array.from({ length: 10 }, (_, i) => c({ fullName: `P${i}`, headline: 'investor' }));

  it('skips the planner for small networks (uses all)', async () => {
    const predict = vi.fn();
    const { subset, info } = await smartRetrieve(small, 'who are my investors?', predict);
    expect(predict).not.toHaveBeenCalled();
    expect(info.mode).toBe('all');
    expect(subset).toHaveLength(10);
  });

  it('narrows to matches for a targeted question on a large network', async () => {
    const big = [
      ...Array.from({ length: RETRIEVAL_MIN_CONNECTIONS + 10 }, () => c({ headline: 'nurse' })),
      ...Array.from({ length: 6 }, (_, i) => c({ fullName: `Inv${i}`, headline: 'venture investor' })),
    ];
    const predict = vi.fn().mockResolvedValue('{"scope":"targeted","keywords":["investor","venture"]}');
    const { subset, info } = await smartRetrieve(big, 'who are my investors?', predict);
    expect(predict).toHaveBeenCalledTimes(1);
    expect(info.mode).toBe('targeted');
    expect(subset.length).toBe(6);
    expect(subset.every((p) => p.headline.includes('venture'))).toBe(true);
  });

  it('falls back to all on a broad question', async () => {
    const big = Array.from({ length: RETRIEVAL_MIN_CONNECTIONS + 50 }, () => c({ headline: 'investor' }));
    const predict = vi.fn().mockResolvedValue('{"scope":"broad","keywords":[]}');
    const { info } = await smartRetrieve(big, 'summarize my network', predict);
    expect(info.mode).toBe('broad');
    expect(info.used).toBe(big.length);
  });

  it('falls back to all when the match signal is too weak', async () => {
    const big = Array.from({ length: RETRIEVAL_MIN_CONNECTIONS + 50 }, () => c({ headline: 'nurse' }));
    const predict = vi.fn().mockResolvedValue('{"scope":"targeted","keywords":["astronaut"]}');
    const { info } = await smartRetrieve(big, 'who are my astronauts?', predict);
    expect(info.mode).toBe('broad'); // 0 matches < floor → answer over everything
  });

  it('falls back to all when the planner call fails', async () => {
    const big = Array.from({ length: RETRIEVAL_MIN_CONNECTIONS + 50 }, () => c({ headline: 'investor' }));
    const predict = vi.fn().mockResolvedValue(null);
    const { info } = await smartRetrieve(big, 'who are my investors?', predict);
    expect(info.mode).toBe('broad');
  });
});
