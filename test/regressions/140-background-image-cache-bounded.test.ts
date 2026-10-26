// @vitest-environment jsdom
/**
 * Regression (ported from upstream regression 106): the background
 * profile-photo prefetch grew the imageCache table without limit.
 *
 * The durable image cache has a 1000-row cap, but the eviction only ran from
 * the UI read-through path (useCachedImage, every 50th hook write). The
 * background sync's cacheProfilePhotos writes far more rows — on every sync
 * page — and never pruned; because it pre-caches everything, the UI path
 * rarely writes at all, so the cap was practically never enforced. LinkedIn
 * CDN photo URLs are signed and rotate, so the same photo re-enters the cache
 * under a new key every rotation (~50KB a row by the DebugPanel's estimate).
 *
 * Fix: pruneImageCache lives in src/lib/image-cache.ts and runs after the
 * background bulkPut too.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { mockFetch, resetFetchMock } from '../mocks/fetch';

let testDb: any;

// cacheProfilePhotos only reads `ok` and `blob()`. A real Response built from a
// jsdom Blob trips undici on some Node versions, so hand it a jsdom Blob
// directly — what a browser would give it.
const imageResponse = () =>
  ({
    ok: true,
    blob: async () => new Blob(['img-bytes'], { type: 'image/jpeg' }),
  }) as unknown as Response;

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

import { cacheProfilePhotos } from '../../entrypoints/background/sync/sync-engine';
import { IMAGE_CACHE_MAX } from '@/lib/image-cache';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_140_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  resetFetchMock();
  mockFetch('cdn.example', async () => imageResponse());
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('background photo caching evicts the oldest entries beyond the cap', async () => {
  // Cache already at the cap, oldest first.
  const seed = Array.from({ length: IMAGE_CACHE_MAX }, (_, i) => ({
    url: `https://cdn.example/old-${i}.jpg`,
    dataUrl: 'data:image/jpeg;base64,AAAA',
    cachedAt: 1_000_000 + i,
  }));
  await testDb.imageCache.bulkPut(seed);

  await cacheProfilePhotos(['https://cdn.example/new-1.jpg', 'https://cdn.example/new-2.jpg']);

  expect(await testDb.imageCache.count()).toBeLessThanOrEqual(IMAGE_CACHE_MAX);
  // The new photos are cached (assert the data URL, so a broken fetch mock that
  // cached nothing can't pass as "evicted correctly")...
  expect((await testDb.imageCache.get('https://cdn.example/new-1.jpg'))?.dataUrl)
    .toMatch(/^data:image\/jpeg;base64,/);
  expect((await testDb.imageCache.get('https://cdn.example/new-2.jpg'))?.dataUrl)
    .toMatch(/^data:image\/jpeg;base64,/);
  // ...and the two oldest made room for them.
  expect(await testDb.imageCache.get('https://cdn.example/old-0.jpg')).toBeUndefined();
  expect(await testDb.imageCache.get('https://cdn.example/old-1.jpg')).toBeUndefined();
});
