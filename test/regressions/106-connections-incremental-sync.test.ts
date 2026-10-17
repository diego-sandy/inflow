/**
 * Opening Connections re-read the viewer's entire connection list on every
 * visit: 27 requests for 1,041 people, about 250 for 10,000, fired within a few
 * seconds of each other. That volume and speed is what gets a LinkedIn account
 * flagged. The sync is now incremental, paced, budgeted and backs off:
 *
 *  - a visit within five minutes of the last check makes no request;
 *  - otherwise it reads from the top only until it meets someone already stored;
 *  - a full pass (the only thing that picks up changed headlines) is due daily,
 *    weekly on a large network, or never in manual mode, and is held to a daily
 *    page budget, resuming where it stopped;
 *  - pages are spaced like scrolling;
 *  - a 429 or 999 stops everything for a cooldown rather than being retried.
 */
import Dexie from 'dexie';
import { switchDatabase, db } from '@/db/database';
import { setFullRefreshMode } from '@/lib/connections-settings';
import {
  syncConnections,
  loadConnectionsSyncState,
  CHECK_FRESH_MS,
  PASS_PAGES_PER_DAY,
  PAGE_DELAY_MIN_MS,
  PAGE_DELAY_MAX_MS,
  THROTTLE_COOLDOWN_MS,
} from '../../entrypoints/background/sync/connections-sync';
import { ConnectionsFetchError } from '../../entrypoints/background/api/connections';

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** LinkedIn's side: profile ids newest first, served 40 at a time like the real endpoint. */
let linkedIn: string[] = [];
let failAt: { start: number; status: number } | null = null;
const fetchPage = vi.fn(async (count: number, start: number) => {
  if (failAt && failAt.start === start) throw new ConnectionsFetchError(failAt.status);
  const ids = linkedIn.slice(start, start + count);
  return {
    data: { '*elements': ids.map((id) => `urn:li:fsd_connection:${id}`) },
    included: ids.flatMap((id) => [
      {
        $type: 'com.linkedin.voyager.dash.relationships.Connection',
        entityUrn: `urn:li:fsd_connection:${id}`,
        createdAt: 1,
        connectedMember: `urn:li:fsd_profile:${id}`,
        '*connectedMemberResolutionResult': `urn:li:fsd_profile:${id}`,
      },
      {
        $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
        entityUrn: `urn:li:fsd_profile:${id}`,
        firstName: 'P',
        lastName: id,
        headline: `Headline ${id}`,
        publicIdentifier: id,
      },
    ]),
  };
});

const sleep = vi.fn(async (_ms: number) => {});
let t = 0;
const deps = () => ({ now: () => t, sleep, fetchPage, random: () => 0.5 });
const sync = (opts: { force?: boolean } = {}) => syncConnections(opts, deps());

function network(n: number, prefix = 'p'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

/** Start offsets requested since the last reset. */
const starts = () => fetchPage.mock.calls.map((c) => c[1]);

beforeEach(async () => {
  await switchDatabase('MEMBER_SYNC');
  linkedIn = [];
  failAt = null;
  fetchPage.mockClear();
  sleep.mockClear();
  t = 1_800_000_000_000;
});

afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_SYNC').catch(() => {});
});

describe('small network', () => {
  it('loads everything on the first visit, pausing between pages', async () => {
    linkedIn = network(92);
    const res = await sync();

    expect(starts()).toEqual([0, 40, 80]);
    expect(await db.connections.count()).toBe(92);
    expect(res.loadingMore).toBe(false);
    expect((await loadConnectionsSyncState()).lastFullAt).toBe(t);

    // Paced like scrolling: a pause before every page but the first.
    expect(sleep).toHaveBeenCalledTimes(2);
    for (const [ms] of sleep.mock.calls) {
      expect(ms).toBeGreaterThanOrEqual(PAGE_DELAY_MIN_MS);
      expect(ms).toBeLessThanOrEqual(PAGE_DELAY_MAX_MS);
    }
  });

  it('makes no request when revisited within a few minutes', async () => {
    linkedIn = network(92);
    await sync();
    fetchPage.mockClear();

    t += CHECK_FRESH_MS - 1;
    const res = await sync();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(res.skipped).toBe('fresh');
  });

  it('checks only the first page on a later visit', async () => {
    linkedIn = network(92);
    await sync();
    fetchPage.mockClear();

    t += 10 * MIN;
    await sync();
    expect(starts()).toEqual([0]);
  });

  it('picks up new connections from the top', async () => {
    linkedIn = network(92);
    await sync();
    fetchPage.mockClear();

    linkedIn = [...network(3, 'new'), ...linkedIn];
    t += 10 * MIN;
    await sync();
    expect(starts()).toEqual([0]);
    expect(await db.connections.get('urn:li:fsd_profile:new0')).toBeTruthy();
    expect(await db.connections.count()).toBe(95);
  });

  it('reads past the first page only while every person on it is new', async () => {
    linkedIn = network(92);
    await sync();
    fetchPage.mockClear();

    linkedIn = [...network(45, 'new'), ...linkedIn];
    t += 10 * MIN;
    await sync();
    // Page 0 is all new; page 1 holds the first known person, so it stops there.
    expect(starts()).toEqual([0, 40]);
    expect(await db.connections.count()).toBe(137);
  });

  it('re-reads the whole list once a day, which is what refreshes headlines', async () => {
    linkedIn = network(92);
    await sync();
    fetchPage.mockClear();

    t += DAY;
    await sync();
    expect(starts()).toEqual([0, 40, 80]);
  });

  it('handles a list that ends exactly on a full page', async () => {
    linkedIn = network(80);
    await sync();
    expect(starts()).toEqual([0, 40, 80]);
    expect((await loadConnectionsSyncState()).resumeAt).toBeUndefined();
  });
});

describe('large network', () => {
  it('spreads the first load over days, newest first, within a daily budget', async () => {
    linkedIn = network(10_000);
    const res = await sync();

    // One check page plus a day's budget of full-pass pages.
    expect(fetchPage).toHaveBeenCalledTimes(1 + PASS_PAGES_PER_DAY);
    expect(res.loadingMore).toBe(true);
    expect(await db.connections.count()).toBe((1 + PASS_PAGES_PER_DAY) * 40);
    expect(await db.connections.get('urn:li:fsd_profile:p0')).toBeTruthy();

    // Later the same day: the budget is spent, so just the cheap check.
    fetchPage.mockClear();
    t += 10 * MIN;
    expect((await sync()).loadingMore).toBe(true);
    expect(starts()).toEqual([0]);

    // Next day: carries on from where it stopped rather than starting over.
    fetchPage.mockClear();
    t += DAY;
    await sync();
    expect(starts()[1]).toBe((1 + PASS_PAGES_PER_DAY) * 40);
    expect(await db.connections.count()).toBe((1 + 2 * PASS_PAGES_PER_DAY) * 40);
  });

  it('finishes the pass eventually and stops reporting more to load', async () => {
    linkedIn = network(3_000);
    let res = await sync();
    for (let day = 0; day < 5 && res.loadingMore; day++) {
      t += DAY;
      res = await sync();
    }
    expect(res.loadingMore).toBe(false);
    expect(await db.connections.count()).toBe(3_000);
  });

  it('refreshes weekly rather than daily once the network is large', async () => {
    linkedIn = network(2_400);
    let res = await sync();
    while (res.loadingMore) {
      t += DAY;
      res = await sync();
    }

    fetchPage.mockClear();
    t += DAY;
    await sync();
    expect(starts()).toEqual([0]);

    fetchPage.mockClear();
    t += 7 * DAY;
    await sync();
    expect(fetchPage.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('settings', () => {
  it('manual mode never re-reads the whole list on its own', async () => {
    linkedIn = network(92);
    await sync();
    await setFullRefreshMode('manual');
    fetchPage.mockClear();

    t += 30 * DAY;
    await sync();
    expect(starts()).toEqual([0]);
  });

  it('"refresh now" skips the freshness window and runs a full pass', async () => {
    linkedIn = network(92);
    await sync();
    await setFullRefreshMode('manual');
    fetchPage.mockClear();

    t += MIN;
    await sync({ force: true });
    expect(starts()).toEqual([0, 40, 80]);
  });

  it('"refresh now" still honors the daily budget', async () => {
    linkedIn = network(10_000);
    await sync();
    fetchPage.mockClear();

    t += MIN;
    await sync({ force: true });
    expect(starts()).toEqual([0]);
  });
});

describe('when LinkedIn pushes back', () => {
  it.each([429, 999])('stops on a %i and leaves connections alone for a cooldown', async (status) => {
    linkedIn = network(10_000);
    failAt = { start: 80, status };
    const res = await sync();

    // Nothing after the refused page, and no retry of it.
    expect(starts()).toEqual([0, 40, 80]);
    expect(res.cooldownUntil).toBe(t + THROTTLE_COOLDOWN_MS);

    failAt = null;
    fetchPage.mockClear();
    t += HOUR;
    const during = await sync({ force: true });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(during.skipped).toBe('cooldown');

    // After the cooldown it resumes at the page that was refused.
    t += THROTTLE_COOLDOWN_MS;
    await sync();
    expect(starts()[1]).toBe(80);
  });

  it('rethrows any other failure without a cooldown', async () => {
    linkedIn = network(92);
    failAt = { start: 0, status: 500 };
    await expect(sync()).rejects.toThrow('500');
    expect((await loadConnectionsSyncState()).cooldownUntil).toBe(0);
  });
});

it('shares one run between overlapping calls', async () => {
  linkedIn = network(92);
  await Promise.all([sync(), sync()]);
  expect(starts()).toEqual([0, 40, 80]);
});

it('keeps progress per account', async () => {
  linkedIn = network(10_000);
  await sync();
  expect((await loadConnectionsSyncState()).resumeAt).toBeDefined();

  await switchDatabase('MEMBER_OTHER');
  try {
    expect((await loadConnectionsSyncState()).resumeAt).toBeUndefined();
  } finally {
    await Dexie.delete('InflowDB_MEMBER_OTHER').catch(() => {});
  }
});
