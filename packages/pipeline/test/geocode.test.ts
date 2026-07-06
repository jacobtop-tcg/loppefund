import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheGeocode, getCachedGeocode, openDb } from '@loppefund/db';
import { geocode, inDenmark } from '../src/geocode.ts';

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

describe('Denmark land-bounds guard (offshore visueltcenter)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts every corner of real Denmark and rejects sea/foreign points', () => {
    // Real DK: Blåvand town, København, Skagen (N), Christiansø (far E), Esbjerg.
    for (const [lat, lng] of [
      [55.5548, 8.1261], [55.6761, 12.5683], [57.7364, 10.5806], [55.3225, 15.19], [55.4765, 8.4594],
    ] as const) {
      expect(inDenmark(lat, lng)).toBe(true);
    }
    // The exact 6857 Blåvand visueltcenter (in the North Sea), open sea, Germany.
    for (const [lat, lng] of [[55.4521, 6.6069], [55.8, 6.0], [54.0, 9.9]] as const) {
      expect(inDenmark(lat, lng)).toBe(false);
    }
  });

  it('replaces an offshore postcode centre with the mean of real addresses', async () => {
    const db = openDb(':memory:');
    // /postnumre/6857 gives a visueltcenter in the SEA; the address list is on land.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => {
          const u = String(url);
          if (u.includes('/postnumre/6857')) return { nr: '6857', navn: 'Blåvand', visueltcenter: [6.6069, 55.4521] };
          if (u.includes('/adgangsadresser')) return [ { x: 8.12, y: 55.55 }, { x: 8.13, y: 55.56 } ];
          return {};
        },
      })),
    );

    const r = await geocode(db, { postcode: '6857' });

    expect(r.quality).toBe('P');
    expect(inDenmark(r.lat!, r.lng!)).toBe(true); // no longer in the sea
    expect(r.lng).toBeCloseTo(8.125, 2);
    expect(r.lat).toBeCloseTo(55.555, 2);
  });

  it('bypasses a poisoned out-of-Denmark cached coordinate and re-geocodes', async () => {
    const db = openDb(':memory:');
    // A pre-guard poisoned entry: a real Blåvand address pinned in the sea.
    cacheGeocode(db, '6857, Blåvand', {
      lat: 55.4521, lng: 6.6069, quality: 'P', resolvedCity: 'Blåvand', resolvedPostcode: '6857',
    });
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => {
        const u = String(url);
        if (u.includes('/postnumre/6857')) return { nr: '6857', navn: 'Blåvand', visueltcenter: [6.6069, 55.4521] };
        if (u.includes('/adgangsadresser')) return [ { x: 8.12, y: 55.55 } ];
        return {};
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await geocode(db, { postcode: '6857', city: 'Blåvand' });

    expect(fetchMock).toHaveBeenCalled(); // the poisoned cache was bypassed
    expect(inDenmark(r.lat!, r.lng!)).toBe(true);
    expect(r.lng).toBeCloseTo(8.12, 2);
  });
});
