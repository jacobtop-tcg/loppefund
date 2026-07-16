import { describe, expect, it } from 'vitest';
import { openDb, upsertInformalPlace, listInformalPlaces } from '../src/index.ts';

const base = {
  slug: 'lade', canonicalName: 'Loppeladen', placeType: 'loppelade',
  firstSeenAt: '2026-01-01', lastSeenAt: '2026-07-01', confidence: 50, fundScore: 50,
};
const vis = (db: Parameters<typeof listInformalPlaces>[0]) =>
  listInformalPlaces(db, { includeRejected: true })[0]!.address_visibility;

describe('address_visibility moves one way only', () => {
  // THE OBLIGATION. A private seller asks to be taken down. Before, the field
  // was frozen after insert, so this was silently ignored and the only real
  // takedown was hand-written SQL nobody had documented.
  it('a takedown ALWAYS goes through', () => {
    const db = openDb(':memory:');
    upsertInformalPlace(db, { ...base, addressVisibility: 'fuld', street: 'Bygaden 14' });
    expect(vis(db)).toBe('fuld');
    upsertInformalPlace(db, { ...base, addressVisibility: 'ikke-offentlig', street: 'Bygaden 14' });
    expect(vis(db)).toBe('ikke-offentlig');
  });

  it('tightens through every rung of the ladder', () => {
    const db = openDb(':memory:');
    upsertInformalPlace(db, { ...base, addressVisibility: 'fuld' });
    for (const next of ['omraade', 'kun-aabningsdage', 'kontakt-kraeves', 'intern', 'ikke-offentlig']) {
      upsertInformalPlace(db, { ...base, addressVisibility: next });
      expect(vis(db)).toBe(next);
    }
  });

  // The other direction stays a human decision made in review — a re-ingest
  // must never be able to put a private address back on the open web.
  it('NEVER loosens, however many times the file says so', () => {
    const db = openDb(':memory:');
    upsertInformalPlace(db, { ...base, addressVisibility: 'kontakt-kraeves' });
    for (const attempt of ['fuld', 'omraade', 'kun-aabningsdage', 'fuld']) {
      upsertInformalPlace(db, { ...base, addressVisibility: attempt });
      expect(vis(db)).toBe('kontakt-kraeves');
    }
  });

  it('an unchanged value is a no-op, not a loosening', () => {
    const db = openDb(':memory:');
    upsertInformalPlace(db, { ...base, addressVisibility: 'omraade' });
    upsertInformalPlace(db, { ...base, addressVisibility: 'omraade' });
    expect(vis(db)).toBe('omraade');
  });
});

describe('aliases survive a re-ingest', () => {
  // The column was read by entity resolution and written by nobody, while
  // ON CONFLICT wiped it — the same data-destroying shape as 38d4d71.
  it('are stored and kept when the vetted file supplies them', () => {
    const db = openDb(':memory:');
    upsertInformalPlace(db, { ...base, aliases: ['Laden hos Ruth', 'Ruths lade'] });
    upsertInformalPlace(db, { ...base, aliases: ['Laden hos Ruth', 'Ruths lade'] });
    const row = listInformalPlaces(db, { includeRejected: true })[0]!;
    expect(JSON.parse(row.aliases)).toEqual(['Laden hos Ruth', 'Ruths lade']);
  });
});
