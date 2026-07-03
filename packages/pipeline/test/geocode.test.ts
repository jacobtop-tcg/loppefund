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

  it('trusts a null-cached address with no postcode (does not re-hit DAWA)', async () => {
    const db = openDb(':memory:');
    cacheGeocode(db, 'Et sted, En by', NULL_RESULT);
    const fetchMock = stubDawa();

    const r = await geocode(db, { street: 'Et sted', city: 'En by' });

    expect(r.lat).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled(); // a genuine miss stays cached
  });

  it('does not cache a null result when the address has a postcode', async () => {
    const db = openDb(':memory:');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })), // no centroid comes back
    );

    const r = await geocode(db, { postcode: '9999' });

    expect(r.lat).toBeNull();
    expect(getCachedGeocode(db, '9999')).toBeNull(); // not poisoned — retried next run
  });
});
