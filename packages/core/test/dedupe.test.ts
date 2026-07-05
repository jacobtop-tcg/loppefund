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

  it('merges an identical recurring series split by a mis-geocode (same postcode + identical dates)', () => {
    const a = {
      title: 'Gentofte Loppemarked',
      lat: 55.75,
      lng: 12.55,
      postcode: '2820',
      dates: ['2026-07-04', '2026-07-11', '2026-07-18'],
    };
    const b = { ...a, lat: 55.78, lng: 12.58 }; // ~0.03° off — geocode disagreement
    expect(matchEvents(a, b).isMatch).toBe(true);
    // A different date list must NOT merge across the geocode gap.
    const c = { ...b, dates: ['2026-08-01', '2026-08-08', '2026-08-15'] };
    expect(matchEvents(a, c).isMatch).toBe(false);
  });

  it('merges when a placeholder street was cleaned to null on one side (Duedag case)', () => {
    // "Duedag i Ejstrupholm" arrived from two sources, one addressed "Byens
    // gader" (cleaned to null upstream), the other "Søndergade". A one-sided
    // street must not veto the merge; identical title + postcode + date wins.
    const a = { title: 'Duedag i Ejstrupholm', street: 'Søndergade', postcode: '7361', lat: 55.98, lng: 9.28, dates: ['2026-10-11'] };
    const b = { title: 'Duedag i Ejstrupholm', street: null, postcode: '7361', lat: 56.02, lng: 9.25, dates: ['2026-10-11'] };
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

  it('does not let a one-sided street override far-apart coordinates', () => {
    // Rural postcodes span >10 km; a street on only one side is no evidence.
    const a = {
      title: 'Loppemarked',
      street: 'Møllevej 3',
      postcode: '4720',
      lat: 55.0,
      lng: 12.0,
      dates: ['2026-07-04'],
    };
    const b = {
      title: 'Loppemarked',
      street: null,
      postcode: '4720',
      lat: 55.05,
      lng: 12.0,
      dates: ['2026-08-01'],
    };
    expect(matchEvents(a, b).isMatch).toBe(false);
  });

  it('merges a precise venue with the same market pinned to its postcode centroid (coordsPrecise=false)', () => {
    // Faaborg case: one source has the real harbour address (quality A), the other
    // only "Faaborg Havn" pinned to the 5600 postcode centroid ~5 km away. The
    // centroid must not read as a location that contradicts the real point.
    const centroid = {
      title: 'Loppemarked Faaborg Havn',
      street: null,
      postcode: '5600',
      lat: 55.112,
      lng: 10.3095,
      coordsPrecise: false,
      dates: ['2026-07-04'],
    };
    const precise = {
      title: 'Loppemarked på Havnen',
      street: 'Vestkaj 3',
      postcode: '5600',
      lat: 55.095,
      lng: 10.2377,
      coordsPrecise: true,
      dates: ['2026-07-04'],
    };
    // Distinctive title ("Faaborg") is on the centroid side, so match in that
    // direction (mergeDuplicateEvents tries both).
    expect(matchEvents(centroid, precise).isMatch).toBe(true);
  });

  it('still vetoes two PRECISE coordinates 5 km apart in the same postcode', () => {
    // Same shape as above but both coordinates are real points — the distance is
    // trustworthy, so they must stay separate (guards the coordsPrecise gate).
    const a = {
      title: 'Loppemarked Faaborg Havn',
      postcode: '5600',
      lat: 55.112,
      lng: 10.3095,
      dates: ['2026-07-04'],
    };
    const b = {
      title: 'Loppemarked på Havnen',
      street: 'Vestkaj 3',
      postcode: '5600',
      lat: 55.095,
      lng: 10.2377,
      dates: ['2026-07-04'],
    };
    expect(matchEvents(a, b).isMatch).toBe(false);
  });

  it('does not merge two DIFFERENT distinctive markets sharing a postcode district (weak title)', () => {
    // Viborg case: an outdoor "Bagagerumsmarked i Viborg" (real venue) and vague
    // Facebook "Indendørs markeder i Viborg (VBC)" (pinned to the town centroid)
    // share postcode 8800 and a date. Both titles are distinctive, but they are
    // only ~0.45 similar and are different markets — postcode+date must not merge.
    const real = {
      title: 'Bagagerumsmarked i Viborg',
      postcode: '8800',
      lat: 56.47,
      lng: 9.407,
      coordsPrecise: true,
      street: 'Fabrikvej 19',
      dates: ['2026-09-06'],
    };
    const vague = {
      title: 'Indendørs markeder i Viborg (VBC)',
      postcode: '8800',
      lat: 56.417,
      lng: 9.369,
      coordsPrecise: false, // geocoded to the Viborg centroid
      street: null,
      dates: ['2026-09-06'],
    };
    expect(matchEvents(real, vague).isMatch).toBe(false);
    expect(matchEvents(vague, real).isMatch).toBe(false);
  });

  it('does not merge two DIFFERENT markets in a postcode when one is a centroid and dates differ', () => {
    // A centroid must not become a wildcard that swallows a genuinely different
    // market: without overlapping dates and with a generic title, no merge.
    const centroid = {
      title: 'Loppemarked',
      postcode: '4720',
      lat: 55.0,
      lng: 12.0,
      coordsPrecise: false,
      dates: ['2026-07-04'],
    };
    const precise = {
      title: 'Loppemarked',
      street: 'Møllevej 3',
      postcode: '4720',
      lat: 55.05,
      lng: 12.0,
      coordsPrecise: true,
      dates: ['2026-08-01'],
    };
    expect(matchEvents(centroid, precise).isMatch).toBe(false);
  });

  it('vetoes julemarked against an uncategorized (andet) event at the same venue', () => {
    // Common case: a real Christmas market vs a different, uncategorized market
    // at the same harbour on the same December day must not collapse into one.
    const a = { ...broens, title: 'Julemarked på Havnen', category: 'julemarked', dates: ['2026-12-05'] };
    const b = { ...broens, title: 'Vintermarked på Havnen', category: 'andet', dates: ['2026-12-05'] };
    expect(matchEvents(a, b).isMatch).toBe(false);
  });

  it('does not merge two generic same-day markets sharing only a postcode when one lacks coords', () => {
    // Distinct kræmmermarkeder in the same postal district on the same Saturday;
    // one source published no coordinates. Postcode district != same spot.
    const a = {
      title: 'Kræmmermarked',
      category: 'kraemmermarked',
      postcode: '4200',
      lat: null,
      lng: null,
      street: null,
      dates: ['2026-08-15'],
    };
    const b = {
      title: 'Kræmmermarked',
      category: 'kraemmermarked',
      postcode: '4200',
      lat: 55.44,
      lng: 11.55,
      street: 'Ringstedvej 9',
      dates: ['2026-08-15'],
    };
    expect(matchEvents(a, b).isMatch).toBe(false);
  });

  it('still merges a DISTINCTIVE same-day market sharing a postcode when one lacks coords', () => {
    // The postcode-only tightening must not break legitimate same-market merges:
    // a distinctive title carries identity even without precise coordinates.
    const a = {
      title: 'Ringsted Kræmmermarked på Torvet',
      category: 'kraemmermarked',
      postcode: '4200',
      lat: null,
      lng: null,
      street: null,
      dates: ['2026-08-15'],
    };
    const b = {
      title: 'Ringsted Kræmmermarked på Torvet',
      category: 'kraemmermarked',
      postcode: '4200',
      lat: 55.44,
      lng: 11.79,
      street: null,
      dates: ['2026-08-15'],
    };
    expect(matchEvents(a, b).isMatch).toBe(true);
  });

  it('does not let a bare category title strong-match by containment', () => {
    // "Loppemarked" is contained in countless titles; different streets,
    // 270 m apart, disjoint dates -> must not merge.
    const a = {
      title: 'Loppemarked',
      street: 'Blågårdsgade 10',
      lat: 55.6879,
      lng: 12.5619,
      dates: ['2026-07-04'],
    };
    const b = {
      title: 'Loppemarked i Kulturhuset',
      street: 'Korsgade 5',
      lat: 55.6883,
      lng: 12.5583,
      dates: ['2026-07-11'],
    };
    expect(matchEvents(a, b).isMatch).toBe(false);
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
    // Street names must not trigger the gade/vej compound category.
    expect(normalizeCategory('Stort loppemarked på Byvej 12, 4000 Roskilde')).toBe('loppemarked');
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

  it('keeps a single low-trust source (Facebook 0.4) below the verified threshold despite good location + dates', () => {
    // One uncorroborated Facebook post must read as "ubekræftet" — bonuses
    // must not manufacture a confident label from a single low-trust source.
    expect(
      computeConfidence({
        maxSourceTrust: 0.4,
        sourceCount: 1,
        daysSinceVerified: 0,
        hasGoodLocation: true,
        hasConcreteDates: true,
      }),
    ).toBeLessThan(0.45);
  });

  it('keeps a single community tip (0.35) below the verified threshold', () => {
    expect(
      computeConfidence({
        maxSourceTrust: 0.35,
        sourceCount: 1,
        daysSinceVerified: 0,
        hasGoodLocation: true,
        hasConcreteDates: true,
      }),
    ).toBeLessThan(0.45);
  });

  it('lets a single trustworthy calendar source (0.6) clear the threshold', () => {
    expect(
      computeConfidence({
        maxSourceTrust: 0.6,
        sourceCount: 1,
        daysSinceVerified: 0,
        hasGoodLocation: true,
        hasConcreteDates: true,
      }),
    ).toBeGreaterThanOrEqual(0.45);
  });

  it('lets two corroborating low-trust sources clear the threshold', () => {
    // Corroboration is the escape hatch: a second source lifts the label.
    expect(
      computeConfidence({
        maxSourceTrust: 0.4,
        sourceCount: 2,
        daysSinceVerified: 0,
        hasGoodLocation: true,
        hasConcreteDates: true,
      }),
    ).toBeGreaterThanOrEqual(0.45);
  });
});

describe('date-in-title deduplication', () => {
  // Recurring markets are often published once per date with the date baked
  // into the title ("VBC Loppemarked 12. sep 2026"). Matching must read those
  // as one market, without letting a bare category word + date pass as a
  // distinctive identity (which would over-merge two unrelated markets).

  it('ignores an embedded date when comparing titles', () => {
    expect(titleSimilarity('VBC Loppemarked 12. sep 2026', 'VBC Loppemarked 10. okt 2026')).toBe(1);
    expect(titleSimilarity('Loppemarked Halmtorvet 16. august', 'Loppemarked Halmtorvet')).toBe(1);
  });

  it('keeps an edition number that is not a date ("3. sæson" != "4. sæson")', () => {
    expect(
      titleSimilarity('Bagagerumsmarked 3. sæson', 'Bagagerumsmarked 4. sæson'),
    ).toBeLessThan(1);
  });

  it('merges a recurring market listed once per date at the same venue', () => {
    const sep = {
      title: 'VBC Loppemarked 12. sep 2026',
      lat: 56.45, lng: 9.4, postcode: '8800', dates: ['2026-09-12'],
    };
    const okt = { ...sep, title: 'VBC Loppemarked 10. okt 2026', dates: ['2026-10-10'] };
    expect(matchEvents(sep, okt).isMatch).toBe(true);
  });

  it('merges dated listings of a distinctively-named series with no coordinates', () => {
    const a = { title: 'LOPPEMARKED HALMTORVET – 16 august', dates: ['2026-08-16'] };
    const b = { title: 'LOPPEMARKED HALMTORVET – 30 august', dates: ['2026-08-30'] };
    expect(matchEvents(a, b).isMatch).toBe(true);
  });

  it('does NOT merge two generic dated loppemarkeder with no shared location', () => {
    const a = { title: 'Loppemarked 5. juli 2026', dates: ['2026-07-05'] };
    const b = { title: 'Loppemarked 12. juli 2026', dates: ['2026-07-12'] };
    expect(matchEvents(a, b).isMatch).toBe(false);
  });

  it('does NOT merge generic dated titles that only share a postcode district', () => {
    // The critical guardrail: stripping the date must not let two different
    // "Loppemarked <date>" listings in one town collapse into each other.
    const a = { title: 'Loppemarked 5. juli 2026', postcode: '4230', dates: ['2026-07-05'] };
    const b = { title: 'Loppemarked 12. juli 2026', postcode: '4230', dates: ['2026-07-12'] };
    expect(matchEvents(a, b).isMatch).toBe(false);
  });
});
