import { describe, expect, it } from 'vitest';
import { openDb, listVenues, upsertVenue } from '@loppefund/db';
import { parseKkShop, toOsmHours, fetchKirkensKorshaerVenues } from '../src/adapters/kirkenskorshaer.ts';
import { ingestChainVenues } from '../src/chain-venues.ts';

const SHOP_HTML = (rows: string) => `
  <h1>Kirkens Korshær Genbrug Testby</h1>
  <a href="#"><svg xmlns="..." class="feather feather-map-pin"><path d="M21 10c0 7-9 13-9 13"></path></svg>Testgade 5, 5000 Odense C</a>
  <div class='work-time'>${rows}</div>`;
const row = (day: string, time: string) =>
  `<div class="work-row"><span class="name">${day}:</span><span class="name-time">${time}</span></div>`;
const HOURS = [
  row('Mandag', 'Lukket'),
  row('Tirsdag', '10:00 - 17:00'),
  row('Onsdag', '10:00 - 17:00'),
  row('Torsdag', '10:00 - 17:00'),
  row('Fredag', '10:00 - 17:00'),
  row('Lørdag', '10:00 - 13:00'),
  row('Søndag', 'Lukket'),
].join('');
const URL = 'https://kirkenskorshaer.dk/genbrugsbutik/kirkens-korshaer-genbrug-42/';

describe('parseKkShop', () => {
  it('extracts id, name, address and grouped opening hours', () => {
    const v = parseKkShop(SHOP_HTML(HOURS), URL)!;
    expect(v).toMatchObject({
      sourceType: 'kk',
      sourceId: 42,
      operatorToken: 'korshaer',
      title: 'Kirkens Korshær Genbrug Testby',
      street: 'Testgade 5',
      postcode: '5000',
      city: 'Odense C',
      category: 'genbrug',
      contactWebsite: URL,
    });
    // Monday closed is omitted; consecutive equal days are grouped.
    expect(v.openingHoursText).toBe('Tu-Fr 10:00-17:00; Sa 10:00-13:00');
  });

  it('returns null when there is no parseable address (missing > wrong)', () => {
    expect(parseKkShop('<h1>Ingen adresse</h1>', URL)).toBeNull();
  });

  it('drops malformed time strings rather than emitting bad hours', () => {
    expect(toOsmHours({ Mandag: 'efter aftale', Tirsdag: 'Lukket' })).toBeNull();
    expect(toOsmHours({ Mandag: '10-17' })).toBeNull(); // needs HH:MM
  });
});

describe('fetchKirkensKorshaerVenues', () => {
  it('reads the sitemap and parses each shop (injected fetcher, no network)', async () => {
    const sitemap = `<urlset><url><loc>${URL}</loc></url><url><loc>https://kirkenskorshaer.dk/genbrugsbutik/kirkens-korshaer-genbrug-7/</loc></url></urlset>`;
    const pages: Record<string, string> = {
      'https://kirkenskorshaer.dk/genbrugsbutik-sitemap.xml': sitemap,
      [URL]: SHOP_HTML(HOURS),
      'https://kirkenskorshaer.dk/genbrugsbutik/kirkens-korshaer-genbrug-7/': SHOP_HTML(HOURS),
    };
    const venues = await fetchKirkensKorshaerVenues({ fetchText: async (u) => pages[u]!, delayMs: 0 });
    expect(venues.map((v) => v.sourceId).sort((a, b) => a - b)).toEqual([7, 42]);
  });
});

describe('ingestChainVenues', () => {
  const near = { lat: 55.0001, lng: 10.0001 }; // ~15 m from the seeded OSM venue
  const chain = (over: Partial<Parameters<typeof ingestChainVenues>[1][number]> = {}) => ({
    sourceType: 'kk', sourceId: 42, operatorToken: 'korshaer',
    title: 'Kirkens Korshær Genbrug Testby', category: 'genbrug' as const,
    street: 'Testgade 5', postcode: '5000', city: 'Odense C',
    openingHoursText: 'Tu-Fr 10:00-17:00; Sa 10:00-13:00', contactWebsite: URL, ...over,
  });

  it('enriches a matching OSM venue with hours instead of duplicating it', async () => {
    const db = openDb(':memory:');
    upsertVenue(db, { slug: 'kk-osm', osmType: 'node', osmId: 1, title: 'Kirkens Korshær Genbrug',
      category: 'genbrug', lat: 55.0, lng: 10.0, openingHoursText: null });
    const stats = await ingestChainVenues(db, [chain()], { geocodeAddress: async () => near });
    expect(stats).toMatchObject({ enriched: 1, inserted: 0 });
    const rows = listVenues(db);
    expect(rows).toHaveLength(1); // no duplicate
    expect(rows[0]!.slug).toBe('kk-osm'); // stable OSM slug preserved
    expect(rows[0]!.opening_hours_text).toBe('Tu-Fr 10:00-17:00; Sa 10:00-13:00'); // enriched
  });

  it('inserts a new venue when no nearby same-operator venue exists', async () => {
    const db = openDb(':memory:');
    upsertVenue(db, { slug: 'far', osmType: 'node', osmId: 1, title: 'Kirkens Korshær Genbrug',
      category: 'genbrug', lat: 57.5, lng: 9.9, openingHoursText: null }); // far away
    const stats = await ingestChainVenues(db, [chain()], { geocodeAddress: async () => near });
    expect(stats).toMatchObject({ enriched: 0, inserted: 1 });
    expect(listVenues(db).some((v) => v.osm_type === 'kk' && v.osm_id === 42)).toBe(true);
  });

  it('will not merge a different operator that happens to be nearby', async () => {
    const db = openDb(':memory:');
    upsertVenue(db, { slug: 'rk', osmType: 'node', osmId: 1, title: 'Røde Kors Genbrug',
      category: 'genbrug', lat: 55.0, lng: 10.0, openingHoursText: null });
    const stats = await ingestChainVenues(db, [chain()], { geocodeAddress: async () => near });
    expect(stats).toMatchObject({ enriched: 0, inserted: 1 }); // stays separate
    expect(listVenues(db)).toHaveLength(2);
  });

  it('skips a shop whose address cannot be geocoded', async () => {
    const db = openDb(':memory:');
    const stats = await ingestChainVenues(db, [chain()], { geocodeAddress: async () => null });
    expect(stats).toMatchObject({ inserted: 0, enriched: 0, skipped: 1 });
    expect(listVenues(db)).toHaveLength(0);
  });

  it('retires only its OWN stale venues, never another source', async () => {
    const db = openDb(':memory:');
    upsertVenue(db, { slug: 'osm-keep', osmType: 'node', osmId: 1, title: 'Røde Kors Genbrug',
      category: 'genbrug', lat: 57.5, lng: 9.9 }); // unrelated OSM venue, far away
    upsertVenue(db, { slug: 'kk-old', osmType: 'kk', osmId: 99, title: 'Kirkens Korshær Genbrug Gammel',
      category: 'genbrug', lat: 56.0, lng: 9.0 }); // a KK venue not in this run
    await new Promise((r) => setTimeout(r, 5));
    const stats = await ingestChainVenues(db, [chain()], { geocodeAddress: async () => near });
    // kk-old vanished this run -> gone; osm-keep is another source -> untouched.
    expect(stats.gone).toBe(1);
    const active = listVenues(db).map((v) => v.slug);
    expect(active).toContain('osm-keep');
    expect(active).not.toContain('kk-old');
  });
});
