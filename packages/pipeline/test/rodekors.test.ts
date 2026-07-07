import { describe, expect, it } from 'vitest';
import { openDb, listVenues } from '@loppefund/db';
import { parseRodekorsShops } from '../src/adapters/rodekors.ts';
import { ingestChainVenues } from '../src/chain-venues.ts';

const settings = {
  rk_maps: [
    [
      {
        category: 'store',
        department: 'Langeland',
        type: { type: 'Røde Kors Butik' },
        location: { lat: '54.93626', lng: '10.71436' },
        address: ['Ørstedgade 6', '5900 Rudkøbing', 'Tlf nr.: 22371418'],
        url: '/afdelinger/langeland',
      },
    ],
    [
      {
        category: 'container', // clothing container — must be excluded
        location: { lat: '54.9362', lng: '10.71157' },
        address: ['Østergade 6', '5900 Rudkøbing'],
      },
    ],
  ],
};
const PAGE = `<html><head><script type="application/json" data-drupal-selector="drupal-settings-json">${JSON.stringify(settings)}</script></head><body></body></html>`;

describe('parseRodekorsShops', () => {
  it('parses stores with coordinates + dept URL and excludes clothing containers', () => {
    const shops = parseRodekorsShops(PAGE);
    expect(shops).toHaveLength(1);
    expect(shops[0]).toMatchObject({
      sourceType: 'rk',
      operatorToken: 'roede kors',
      title: 'Røde Kors Butik, Rudkøbing',
      street: 'Ørstedgade 6',
      postcode: '5900',
      city: 'Rudkøbing',
      category: 'genbrug',
      lat: 54.93626,
      lng: 10.71436,
      // contactWebsite points at the shop's OWN page, not the national list.
      contactWebsite: 'https://www.rodekors.dk/afdelinger/langeland',
      // RK publishes no trustworthy per-shop hours (dept page shows national
      // office hours), so hours are deliberately left unset — never invented.
      openingHoursText: null,
    });
  });

  it('returns nothing when the settings blob is absent', () => {
    expect(parseRodekorsShops('<html></html>')).toEqual([]);
  });
});

describe('ingestChainVenues with provided coordinates', () => {
  it('uses the source coordinates and never calls the geocoder', async () => {
    const db = openDb(':memory:');
    const shops = parseRodekorsShops(PAGE);
    const stats = await ingestChainVenues(db, shops, {
      geocodeAddress: async () => {
        throw new Error('geocoder must not be called when coordinates are provided');
      },
    });
    expect(stats).toMatchObject({ inserted: 1, skipped: 0 });
    const v = listVenues(db)[0]!;
    expect(v.lat).toBeCloseTo(54.93626, 4);
    expect(v.lng).toBeCloseTo(10.71436, 4);
  });
});
