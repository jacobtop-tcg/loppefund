import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  addInformalReport,
  addInformalSource,
  getInformalPlaceBySlug,
  informalPlacesTableExists,
  listInformalPlaces,
  openDb,
  upsertInformalPlace,
} from '../src/index.ts';

const base = {
  slug: 'lade-ved-guderup',
  canonicalName: 'Loppeladen ved Guderup',
  placeType: 'loppelade',
  firstSeenAt: '2026-06-01',
  lastSeenAt: '2026-07-10',
};

describe('informal_places schema', () => {
  it('creates the table and round-trips a place with its sources and reports', () => {
    const db = openDb(':memory:');
    expect(informalPlacesTableExists(db)).toBe(true);
    const id = upsertInformalPlace(db, {
      ...base,
      street: 'Bagvejen 12',
      city: 'Guderup',
      lat: 54.99,
      lng: 9.86,
      geoPrecision: 'exact',
      addressVisibility: 'omraade',
      phone: '+45 20 30 40 50',
      phoneNorm: '4520304050',
      confidence: 61,
      fundScore: 88,
      inventorySignals: ['usorteret', 'moebler'],
    });
    addInformalSource(db, id, {
      sourceType: 'facebook_post',
      url: 'https://facebook.com/p/1',
      observedAt: '2026-07-10',
      excerpt: 'Laden er åben på lørdag',
      verifiedBy: null,
    });
    addInformalReport(db, id, { visitedAt: '2026-07-05', wasOpen: true, priceLevel: 'lav' });

    const got = getInformalPlaceBySlug(db, 'lade-ved-guderup')!;
    expect(got.canonical_name).toBe('Loppeladen ved Guderup');
    expect(got.address_visibility).toBe('omraade');
    expect(got.confidence).toBe(61);
    expect(got.fund_score).toBe(88);
    expect(JSON.parse(got.inventory_signals)).toEqual(['usorteret', 'moebler']);
    expect(got.sources).toHaveLength(1);
    expect(got.reports).toHaveLength(1);
  });

  it('never rewrites the slug on conflict (published URLs must not move)', () => {
    const db = openDb(':memory:');
    const id1 = upsertInformalPlace(db, base);
    const id2 = upsertInformalPlace(db, { ...base, canonicalName: 'Nyt navn' });
    expect(id2).toBe(id1);
    const got = getInformalPlaceBySlug(db, 'lade-ved-guderup')!;
    expect(got.canonical_name).toBe('Nyt navn'); // name updates
    expect(got.slug).toBe('lade-ved-guderup'); // URL does not
  });

  it('keeps re-observed sources idempotent (independence, not volume)', () => {
    const db = openDb(':memory:');
    const id = upsertInformalPlace(db, base);
    const s = {
      sourceType: 'facebook_post',
      url: 'https://facebook.com/p/1',
      observedAt: '2026-07-10',
    };
    addInformalSource(db, id, s);
    addInformalSource(db, id, s);
    addInformalSource(db, id, s);
    expect(getInformalPlaceBySlug(db, base.slug)!.sources).toHaveLength(1);
  });

  it('hides rejected places from the default listing', () => {
    const db = openDb(':memory:');
    upsertInformalPlace(db, base);
    upsertInformalPlace(db, { ...base, slug: 'afvist', status: 'rejected' });
    expect(listInformalPlaces(db)).toHaveLength(1);
    expect(listInformalPlaces(db, { includeRejected: true })).toHaveLength(2);
  });

  it('cascades sources and reports when a place is deleted', () => {
    const db = openDb(':memory:');
    const id = upsertInformalPlace(db, base);
    addInformalSource(db, id, { sourceType: 'user_tip', observedAt: '2026-07-01' });
    addInformalReport(db, id, { visitedAt: '2026-07-01' });
    db.prepare(`DELETE FROM informal_places WHERE id = ?`).run(id);
    const orphanSrc = db
      .prepare(`SELECT COUNT(*) AS c FROM informal_place_sources`)
      .get() as { c: number };
    const orphanRep = db
      .prepare(`SELECT COUNT(*) AS c FROM informal_place_reports`)
      .get() as { c: number };
    expect(orphanSrc.c).toBe(0);
    expect(orphanRep.c).toBe(0);
  });
});

// ===========================================================================
// THE DEPLOY GUARD. migrate() runs only from openDb(); the static export uses
// openDbReadOnly() and a push build restores a CACHED DB that predates v4. If
// these reads threw instead of degrading, the whole site would fail to build —
// exactly the trap venuesTableExists() was added for.
// ===========================================================================
describe('pre-v4 database (the cached-DB deploy path)', () => {
  const legacyDb = () => {
    // A DB that has events but no informal_places — i.e. written before v4.
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY, slug TEXT)`);
    return db;
  };

  it('reports the table as absent instead of throwing', () => {
    expect(informalPlacesTableExists(legacyDb())).toBe(false);
  });

  it('degrades listInformalPlaces to an empty list', () => {
    expect(listInformalPlaces(legacyDb())).toEqual([]);
  });

  it('degrades getInformalPlaceBySlug to null', () => {
    expect(getInformalPlaceBySlug(legacyDb(), 'whatever')).toBeNull();
  });
});
