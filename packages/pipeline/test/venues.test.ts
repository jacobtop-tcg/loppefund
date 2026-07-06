import { describe, expect, it } from 'vitest';
import { openDb, listVenues } from '@loppefund/db';
import { ingestOsmVenues } from '../src/venues.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Offline reverse-geocode stub so the test never hits DAWA.
const stubResolve = async (lat: number) => ({
  city: lat > 56 ? 'Aarhus' : 'Testby',
  postcode: '9999',
});
const opts = (elements: unknown[]) => ({ elements: elements as never, resolveLocation: stubResolve });

const ELEMENTS = [
  {
    type: 'node', id: 1, lat: 55.6, lon: 12.5,
    tags: {
      shop: 'charity', name: 'Røde Kors Butik', 'addr:city': 'København',
      'addr:street': 'Nørrebrogade', 'addr:housenumber': '10', 'addr:postcode': '2200',
      opening_hours: 'Mo-Fr 10:00-17:30; Sa 10:00-14:00',
    },
  },
  { type: 'way', id: 2, center: { lat: 56.1, lon: 10.2 }, tags: { shop: 'second_hand', name: 'Den Gamle Loppelade' } },
  { type: 'node', id: 3, lat: 55.4, lon: 11.1, tags: { shop: 'antiques', name: 'Antikgården' } },
  { type: 'node', id: 4, lat: 55.7, lon: 12.6, tags: { shop: 'second_hand', name: 'Reolmarkedet Amager' } },
  { type: 'node', id: 5, lat: 55.7, lon: 12.6, tags: { shop: 'second_hand' } }, // nameless -> skipped
];

describe('ingestOsmVenues', () => {
  it('classifies, locates and upserts OSM elements', async () => {
    const db = openDb(':memory:');
    const stats = await ingestOsmVenues(db, opts(ELEMENTS));
    expect(stats.fetched).toBe(5);
    expect(stats.skipped).toBe(1);
    expect(stats.upserted).toBe(4);

    const byTitle = Object.fromEntries(listVenues(db).map((v) => [v.title, v]));
    expect(byTitle['Røde Kors Butik']!.category).toBe('genbrug');
    expect(byTitle['Den Gamle Loppelade']!.category).toBe('loppebutik');
    expect(byTitle['Antikgården']!.category).toBe('antik');
    expect(byTitle['Reolmarkedet Amager']!.category).toBe('reolmarked');
    expect(byTitle['Røde Kors Butik']!.opening_hours_text).toContain('Mo-Fr');
    expect(byTitle['Røde Kors Butik']!.street).toBe('Nørrebrogade 10');
    // Town from OSM addr:city when present, else reverse-geocoded from coords.
    expect(byTitle['Røde Kors Butik']!.city).toBe('København');
    expect(byTitle['Den Gamle Loppelade']!.city).toBe('Aarhus'); // reverse (lat 56.1)
    expect(byTitle['Antikgården']!.city).toBe('Testby'); // reverse (lat 55.4)
    expect(byTitle['Den Gamle Loppelade']!.lat).toBeCloseTo(56.1, 3); // way center
  });

  it('recovers name-matched venues and refuses recycling facilities', async () => {
    // These mirror what the widened Overpass NAME clause returns: antiquarian
    // bookshops tagged shop=books (no second_hand), amenity=marketplace kræmmer-
    // markeder (no shop tag), and municipal recycling yards that must stay out.
    const db = openDb(':memory:');
    const els = [
      { type: 'node', id: 10, lat: 55.4, lon: 10.4, tags: { shop: 'books', name: 'Fyns Antikvariat' } },
      { type: 'node', id: 11, lat: 55.9, lon: 12.3, tags: { amenity: 'marketplace', name: 'Vejby Kræmmermarked' } },
      { type: 'node', id: 12, lat: 57.0, lon: 9.9, tags: { amenity: 'recycling', name: 'Thisted Genbrugscenter' } },
    ];
    const stats = await ingestOsmVenues(db, opts(els));
    expect(stats.upserted).toBe(2);
    expect(stats.skipped).toBe(1); // the recycling yard

    const byTitle = Object.fromEntries(listVenues(db).map((v) => [v.title, v]));
    expect(byTitle['Fyns Antikvariat']!.category).toBe('antik');
    expect(byTitle['Vejby Kræmmermarked']!.category).toBe('loppebutik');
    expect(byTitle['Thisted Genbrugscenter']).toBeUndefined();
  });

  it('is idempotent and keeps slugs stable across runs', async () => {
    const db = openDb(':memory:');
    await ingestOsmVenues(db, opts(ELEMENTS));
    const first = listVenues(db).find((v) => v.title === 'Antikgården')!;
    await sleep(5);
    await ingestOsmVenues(db, opts(ELEMENTS));
    const again = listVenues(db).find((v) => v.title === 'Antikgården')!;
    expect(again.slug).toBe(first.slug);
    expect(listVenues(db).length).toBe(4);
  });

  it('retires a venue that vanishes from a later full run', async () => {
    const db = openDb(':memory:');
    await ingestOsmVenues(db, opts(ELEMENTS));
    await sleep(5);
    const stats = await ingestOsmVenues(db, opts(ELEMENTS.filter((e) => e.id !== 3)));
    expect(stats.gone).toBe(1);
    expect(listVenues(db).find((v) => v.title === 'Antikgården')).toBeUndefined();
  });
});
