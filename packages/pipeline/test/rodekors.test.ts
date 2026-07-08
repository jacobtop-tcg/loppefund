import { describe, expect, it } from 'vitest';
import { openDb, listVenues, upsertVenue } from '@loppefund/db';
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
      // The "Tlf nr.: 22371418" line IS authoritative per-shop data — extracted
      // and prettified so a visitor can ring the shop to confirm before driving.
      contactPhone: '22 37 14 18',
    });
  });

  it('leaves the phone null when the address carries no "Tlf nr." line', () => {
    const noPhone = {
      rk_maps: [
        [
          {
            category: 'store',
            department: 'Etsted',
            location: { lat: '55.0', lng: '10.0' },
            address: ['Hovedgaden 1', '5000 Odense C'],
          },
        ],
      ],
    };
    const html = `<script data-drupal-selector="drupal-settings-json">${JSON.stringify(noPhone)}</script>`;
    expect(parseRodekorsShops(html)[0]!.contactPhone).toBeNull();
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
    // A freshly-inserted (unmatched) RK shop carries the shop's phone.
    expect(v.contact_phone).toBe('22 37 14 18');
  });

  // The exact Guderup case: an OSM "Røde Kors" charity node with NO phone gets
  // enriched by the authoritative RK record's phone — so a visitor can ring to
  // confirm a shop is really shoppable before driving to it.
  it('enriches a matched OSM venue that lacks a phone with the RK phone', async () => {
    const db = openDb(':memory:');
    upsertVenue(db, {
      slug: 'roede-kors-toejbutik', osmType: 'node', osmId: 3813041363,
      title: 'Røde Kors Tøjbutik', category: 'genbrug', street: null, postcode: '5900',
      city: 'Rudkøbing', lat: 54.93627, lng: 10.71437,
      openingHoursText: null, contactWebsite: 'http://rødekors.dk/langeland', contactPhone: null,
    });
    const stats = await ingestChainVenues(db, parseRodekorsShops(PAGE), {
      geocodeAddress: async () => { throw new Error('coords provided; geocoder must not run'); },
    });
    expect(stats).toMatchObject({ enriched: 1, inserted: 0 });
    const v = listVenues(db).find((x) => x.slug === 'roede-kors-toejbutik')!;
    expect(v.contact_phone).toBe('22 37 14 18');
  });

  it('keeps an existing OSM phone over the RK one when both are present', async () => {
    const db = openDb(':memory:');
    upsertVenue(db, {
      slug: 'roede-kors-toejbutik', osmType: 'node', osmId: 3813041363,
      title: 'Røde Kors Tøjbutik', category: 'genbrug', street: null, postcode: '5900',
      city: 'Rudkøbing', lat: 54.93627, lng: 10.71437,
      openingHoursText: null, contactWebsite: null, contactPhone: '+45 12 34 56 78',
    });
    await ingestChainVenues(db, parseRodekorsShops(PAGE), {
      geocodeAddress: async () => { throw new Error('coords provided; geocoder must not run'); },
    });
    const v = listVenues(db).find((x) => x.slug === 'roede-kors-toejbutik')!;
    expect(v.contact_phone).toBe('+45 12 34 56 78');
  });
});
