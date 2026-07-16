import { describe, expect, it } from 'vitest';
import { openDb, upsertInformalPlace, addInformalSource } from '@loppefund/db';
import { checkInformalQuality, formatQualityReport } from '../src/informal-quality.ts';

const TODAY = '2026-07-15';

const base = {
  slug: 'lade', canonicalName: 'Loppeladen', placeType: 'loppelade',
  firstSeenAt: '2026-06-01', lastSeenAt: '2026-07-10', city: 'Guderup',
};

const findChecks = (db: Parameters<typeof checkInformalQuality>[0]) =>
  checkInformalQuality(db, TODAY).map((i) => i.check);

describe('informal data-quality report', () => {
  it('passes a clean place with nothing but an info line', () => {
    const db = openDb(':memory:');
    const id = upsertInformalPlace(db, {
      ...base, postcode: '6430', lat: 54.99, lng: 9.86, confidence: 60, fundScore: 70,
      status: 'recently_observed', addressVisibility: 'omraade',
    });
    addInformalSource(db, id, { sourceType: 'facebook_post', url: 'https://fb.com/1', observedAt: '2026-07-10' });
    const issues = checkInformalQuality(db, TODAY);
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
  });

  // THE CHECK THAT PROTECTS A PERSON: a precise address about to go public with
  // nobody having vetted it.
  it('flags a full address that no human vetted as an ERROR', () => {
    const db = openDb(':memory:');
    const id = upsertInformalPlace(db, {
      ...base, street: 'Bygaden 14', postcode: '6430', addressVisibility: 'fuld',
      confidence: 50, fundScore: 50,
    });
    addInformalSource(db, id, { sourceType: 'facebook_post', url: 'https://fb.com/1', observedAt: '2026-07-10' });
    const issue = checkInformalQuality(db, TODAY).find((i) => i.check === 'fuld-adresse-uden-vetting');
    expect(issue?.severity).toBe('error');
  });

  it('accepts a full address once an operator has reviewed it', () => {
    const db = openDb(':memory:');
    const id = upsertInformalPlace(db, {
      ...base, street: 'Bygaden 14', postcode: '6430', addressVisibility: 'fuld',
      confidence: 50, fundScore: 50,
    });
    addInformalSource(db, id, { sourceType: 'operator_review', observedAt: '2026-07-10', verifiedBy: 'jacob' });
    expect(findChecks(db)).not.toContain('fuld-adresse-uden-vetting');
  });

  it('catches a coordinate in the sea and an invalid postcode', () => {
    const db = openDb(':memory:');
    upsertInformalPlace(db, { ...base, lat: 48.9, lng: 2.3, postcode: '0999', confidence: 10, fundScore: 10 });
    const checks = findChecks(db);
    expect(checks).toContain('koordinat-uden-for-dk');
    expect(checks).toContain('ugyldigt-postnummer');
  });

  it('catches a score outside 0..100', () => {
    const db = openDb(':memory:');
    upsertInformalPlace(db, { ...base, postcode: '6430', confidence: 140, fundScore: -3 });
    const issues = checkInformalQuality(db, TODAY).filter((i) => i.check === 'score-uden-for-interval');
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('catches illogical status combinations', () => {
    const db = openDb(':memory:');
    // confirmed_active with nothing ever verified
    upsertInformalPlace(db, { ...base, postcode: '6430', status: 'confirmed_active', confidence: 90, fundScore: 50 });
    expect(findChecks(db)).toContain('ulogisk-status');
  });

  it('flags a stale "confirmed" place — the claim decays even if the row does not', () => {
    const db = openDb(':memory:');
    upsertInformalPlace(db, {
      ...base, postcode: '6430', status: 'confirmed_active',
      lastSeenAt: '2024-01-01', lastVerifiedAt: '2024-01-01', confidence: 90, fundScore: 50,
    });
    const checks = findChecks(db);
    expect(checks).toContain('foraeldet-bekraeftelse');
    expect(checks).toContain('ingen-aktivitet');
  });

  it('flags a place you must contact but cannot', () => {
    const db = openDb(':memory:');
    upsertInformalPlace(db, {
      ...base, postcode: '6430', addressVisibility: 'kontakt-kraeves', confidence: 40, fundScore: 60,
    });
    const issue = checkInformalQuality(db, TODAY).find((i) => i.check === 'kontakt-kraeves-uden-kontakt');
    expect(issue?.severity).toBe('error'); // a place nobody can reach or find is useless
  });

  it('flags a recurrence claim with no history to back it', () => {
    const db = openDb(':memory:');
    const id = upsertInformalPlace(db, {
      ...base, postcode: '6430', confidence: 40, fundScore: 40,
      recurrence: JSON.stringify({ weekdays: [7], pattern: 'hver søndag', season: null, notes: null }),
    });
    addInformalSource(db, id, { sourceType: 'facebook_post', url: 'https://fb.com/1', observedAt: '2026-07-10' });
    expect(findChecks(db)).toContain('tilbagevendende-uden-historik');
  });

  it('spots duplicate phones and addresses across places', () => {
    const db = openDb(':memory:');
    for (const slug of ['a', 'b']) {
      upsertInformalPlace(db, {
        ...base, slug, postcode: '6430', street: 'Bygaden 14', city: 'Guderup',
        phone: '+45 20 30 40 50', phoneNorm: '4520304050', confidence: 40, fundScore: 40,
      });
    }
    const checks = findChecks(db);
    expect(checks).toContain('dublet-telefon');
    expect(checks).toContain('dublet-adresse');
  });

  it('rejects unknown vocabulary loudly (an unknown visibility must never read as permissive)', () => {
    const db = openDb(':memory:');
    upsertInformalPlace(db, {
      ...base, postcode: '6430', placeType: 'noget-nyt', status: 'måske',
      addressVisibility: 'helt-åben', confidence: 40, fundScore: 40,
    });
    const checks = findChecks(db);
    expect(checks).toContain('ukendt-type');
    expect(checks).toContain('ukendt-status');
    expect(checks).toContain('ukendt-synlighed');
  });

  it('degrades to an empty report on a pre-v4 database rather than throwing', () => {
    const db = openDb(':memory:');
    db.exec('DROP TABLE informal_places');
    expect(() => checkInformalQuality(db, TODAY)).not.toThrow();
  });

  it('formats errors first and counts them', () => {
    const db = openDb(':memory:');
    upsertInformalPlace(db, { ...base, postcode: '0999', confidence: 200, fundScore: 40 });
    const out = formatQualityReport(checkInformalQuality(db, TODAY));
    expect(out).toMatch(/FEJL/);
    expect(out).toMatch(/fejl, \d+ advarsler/);
    expect(out.indexOf('FEJL')).toBeLessThan(out.indexOf('INFO'));
  });
});
