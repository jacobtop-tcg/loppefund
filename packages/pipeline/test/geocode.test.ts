import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheGeocode, getCachedGeocode, openDb } from '@loppefund/db';
import { geocode } from '../src/geocode.ts';

const NULL_RESULT = {
  lat: null,
  lng: null,
  quality: null,
  resolvedCity: null,
  resolvedPostcode: null,
};

// Minimal DAWA stub: the /postnumre/<nr> endpoint returns a postcode centroid,
// everything else an empty object. Returns the spy so tests can assert whether
// the network was hit (i.e. whether the cache was bypassed).
function stubDawa() {
  const mock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      String(url).includes('/postnumre/')
        ? { nr: '1200', navn: 'København K', visueltcenter: [12.58, 55.678] }
        : {},
  }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('geocode negative-cache handling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('re-geocodes a null-cached address that carries a postcode, and heals the entry', async () => {
    const db = openDb(':memory:');
    // A stale negative entry — cached before the postcode-centroid fallback existed.
    cacheGeocode(db, '1200, København K', NULL_RESULT);
    const fetchMock = stubDawa();

    const r = await geocode(db, { postcode: '1200', city: 'København K' });

    expect(r.quality).toBe('P');
    expect(r.lat).toBeCloseTo(55.678, 2);
    expect(fetchMock).toHaveBeenCalled(); // the poisoned cache was bypassed
    // the healed result overwrote the null entry, so next time it's a real hit
    expect(getCachedGeocode(db, '1200, København K')?.lat).toBeCloseTo(55.678, 2);
  });

  it('re-geocodes a null-cached town name — e.g. a bare "Faaborg" now resolves', async () => {
    // The exact Facebook-feed case: a post whose only place was "Faaborg" was
    // cached as a miss before the town-centroid fallback existed. It must not
    // stay pinned nowhere — re-geocode and heal it.
    const db = openDb(':memory:');
    cacheGeocode(db, 'Faaborg', NULL_RESULT);
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes('/postnumre?navn=')
          ? [{ nr: '5600', navn: 'Faaborg', visueltcenter: [10.24, 55.1] }]
          : { kategori: 'C', resultater: [] }, // datavask finds no street address
    }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await geocode(db, { street: 'Faaborg' });

    expect(r.lat).not.toBeNull();
    expect(r.resolvedPostcode).toBe('5600');
    expect(fetchMock).toHaveBeenCalled(); // the stale null was bypassed
  });

  it('never caches a null result (misses stay retryable)', async () => {
    const db = openDb(':memory:');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })), // nothing resolves
    );

    const r = await geocode(db, { postcode: '9999' });

    expect(r.lat).toBeNull();
    expect(getCachedGeocode(db, '9999')).toBeNull(); // not poisoned — retried next run
  });
});
