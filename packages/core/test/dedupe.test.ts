import { describe, expect, it } from 'vitest';
import { distanceMeters, matchEvents, titleSimilarity } from '../src/dedupe.ts';
import {
  normalizeCategory,
  normalizeIndoorOutdoor,
  parseIsFree,
  slugify,
} from '../src/normalize.ts';
import { computeConfidence } from '../src/confidence.ts';

describe('titleSimilarity', () => {
  it('is 1 for identical titles modulo casing/diacritics', () => {
    expect(titleSimilarity('Brøns Lopper', 'broens lopper')).toBe(1);
  });
  it('is high for near-identical titles', () => {
    expect(
      titleSimilarity('Loppemarked i Valby Hallen', 'Loppemarked Valbyhallen'),
    ).toBeGreaterThan(0.7);
  });
  it('is low for different markets', () => {
    expect(
      titleSimilarity('Bagagerumsmarked Odense Havn', 'Julemarked i Tivoli'),
    ).toBeLessThan(0.4);
  });
});

describe('distanceMeters', () => {
  it('computes plausible distance (Copenhagen city hall to Tivoli ~350m)', () => {
    const d = distanceMeters(55.6759, 12.5655, 55.6737, 12.5681);
    expect(d).toBeGreaterThan(150);
    expect(d).toBeLessThan(500);
  });
});

describe('matchEvents', () => {
  const broens = {
    title: 'Broens Lopper',
    lat: 55.6799,
    lng: 12.5988,
    postcode: '1401',
    dates: ['2026-07-05', '2026-07-19'],
  };

  it('matches same market from two sources at same spot', () => {
    const other = { ...broens, title: 'Broens Lopper – loppemarked på kajen' };
    expect(matchEvents(broens, other).isMatch).toBe(true);
  });

  it('rejects same-ish title at a different location', () => {
    const other = { ...broens, lat: 56.15, lng: 10.2 }; // Aarhus
    expect(matchEvents(broens, other).isMatch).toBe(false);
  });

  it('rejects different titles at the same location', () => {
    const other = { ...broens, title: 'Julemarked på Broens' };
    expect(matchEvents(broens, other).isMatch).toBe(false);
  });

  it('vetoes julemarked vs loppemarked at the same venue', () => {
    const a = { ...broens, title: 'Marked på Broens', category: 'loppemarked' };
    const b = { ...broens, title: 'Marked på Broens', category: 'julemarked' };
    expect(matchEvents(a, b).isMatch).toBe(false);
  });

  it('does not let near-synonym categories block a merge', () => {
    const a = { ...broens, category: 'loppemarked' };
    const b = { ...broens, title: 'Broens Lopper', category: 'genbrugsmarked' };
    expect(matchEvents(a, b).isMatch).toBe(true);
  });

  it('requires date overlap when only weak title + location', () => {
    const weak = {
      title: 'Loppemarked på kajen Broens',
      lat: 55.6799,
      lng: 12.5988,
      postcode: '1401',
      dates: ['2026-08-02'],
    };
    expect(matchEvents(broens, weak).isMatch).toBe(false);
    const withOverlap = { ...weak, dates: ['2026-07-05'] };
    expect(matchEvents(broens, withOverlap).isMatch).toBe(true);
  });

  it('does not match on title alone with no location or dates', () => {
    const a = { title: 'Loppemarked' };
    const b = { title: 'Loppemarked' };
    expect(matchEvents(a, b).isMatch).toBe(false);
  });

  it('merges recurring series entries with identical distinctive titles and no location', () => {
    const a = { title: 'Fredensborg Kokkedal Loppemarked', dates: ['2026-07-04'] };
    const b = { title: 'Fredensborg Kokkedal Loppemarked', dates: ['2026-07-11'] };
    expect(matchEvents(a, b).isMatch).toBe(true);
  });

  it('does not merge generic identical titles without location', () => {
    const a = { title: 'Loppemarked', dates: ['2026-07-04'] };
    const b = { title: 'Loppemarked', dates: ['2026-07-11'] };
    expect(matchEvents(a, b).isMatch).toBe(false);
  });

  it('does not merge identical titles at contradicting locations', () => {
    const a = { title: 'Sommerens Store Loppemarked', lat: 55.68, lng: 12.59, dates: ['2026-07-04'] };
    const b = { title: 'Sommerens Store Loppemarked', lat: 56.15, lng: 10.2, dates: ['2026-07-04'] };
    expect(matchEvents(a, b).isMatch).toBe(false);
  });

  it('merges identical title + postcode + street despite conflicting geocodes', () => {
    // Real case: "Bygaden 7" was geocoded to three different spots because
    // Denmark has two towns called Søborg. Postcode + street agreement wins.
    const a = {
      title: 'Kræmmermarked i Søborg ved Gilleleje',
      street: 'Bygaden 7',
      postcode: '3250',
      lat: 56.165,
      lng: 12.293,
      dates: ['2026-07-04'],
    };
    const b = {
      title: 'Kræmmermarked i Søborg ved Gilleleje',
      street: 'Bygaden 7, Søborg',
      postcode: '3250',
      lat: 55.95,
      lng: 12.15,
      dates: ['2026-08-01'],
    };
    expect(matchEvents(a, b).isMatch).toBe(true);
  });

  it('rejects two garage sales in the same postcode on the same day', () => {
    // Approximate postcode-centroid coords are identical; streets differ.
    const a = {
      title: 'Garagesalg Kongevej 2',
      street: 'Kongevej 2',
      postcode: '4450',
      lat: 55.66,
      lng: 11.42,
      dates: ['2026-07-04'],
    };
    const b = {
      title: 'Garagesalg Møllevej 5',
      street: 'Møllevej 5',
      postcode: '4450',
      lat: 55.66,
      lng: 11.42,
      dates: ['2026-07-04'],
    };
    expect(matchEvents(a, b).isMatch).toBe(false);
  });

  it('still merges when streets agree by containment', () => {
    const a = {
      title: 'Broens Lopper',
      street: 'Strandgade 95',
      postcode: '1401',
      lat: 55.6799,
      lng: 12.5988,
      dates: ['2026-07-05'],
    };
    const b = {
      title: 'Broens Lopper loppemarked',
      street: 'Strandgade 95, på kajen',
      postcode: '1401',
      lat: 55.6799,
      lng: 12.5988,
      dates: ['2026-07-05'],
    };
    expect(matchEvents(a, b).isMatch).toBe(true);
  });
});

describe('normalize helpers', () => {
  it('slugifies Danish text', () => {
    expect(slugify('Høje Gladsaxe Loppemarked')).toBe(
      'hoeje-gladsaxe-loppemarked',
    );
  });
  it('normalizes categories', () => {
    expect(normalizeCategory('Loppemarked')).toBe('loppemarked');
    expect(normalizeCategory('Kræmmermarked')).toBe('kraemmermarked');
    expect(normalizeCategory('Bagagerumsmarked')).toBe('bagagerumsmarked');
    expect(normalizeCategory('Gade/vej/gårdloppemarked')).toBe('byloppemarked');
    expect(normalizeCategory('Dyrskue')).toBe('andet');
    // Seasonal jule outranks the market-type words inside compound titles.
    expect(normalizeCategory('Julekræmmermarked i Hårlev Hallen')).toBe('julemarked');
    expect(normalizeCategory('Jul på Haughus Gods')).toBe('julemarked');
    expect(normalizeCategory('Juleloppemarked')).toBe('julemarked');
  });
  it('normalizes indoor/outdoor', () => {
    expect(normalizeIndoorOutdoor('Udendørs')).toBe('outdoor');
    expect(normalizeIndoorOutdoor('Indendørs')).toBe('indoor');
    expect(normalizeIndoorOutdoor('Både inden- og udendørs')).toBe('mixed');
  });
  it('parses free entry', () => {
    expect(parseIsFree('Gratis')).toBe(true);
    expect(parseIsFree('25 kr.')).toBe(false);
    expect(parseIsFree(undefined)).toBeNull();
  });
});

describe('computeConfidence', () => {
  it('scores a fresh, corroborated, complete event high', () => {
    expect(
      computeConfidence({
        maxSourceTrust: 0.8,
        sourceCount: 2,
        daysSinceVerified: 1,
        hasGoodLocation: true,
        hasConcreteDates: true,
      }),
    ).toBeGreaterThanOrEqual(0.85);
  });
  it('scores a stale single-source event low', () => {
    expect(
      computeConfidence({
        maxSourceTrust: 0.5,
        sourceCount: 1,
        daysSinceVerified: 100,
        hasGoodLocation: false,
        hasConcreteDates: false,
      }),
    ).toBeLessThan(0.45);
  });
});
