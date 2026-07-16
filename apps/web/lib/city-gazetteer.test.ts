import { describe, expect, it } from 'vitest';
import { AMBIGUITY_KM, baseLabel, buildCityGazetteer, suggestCities } from './city-gazetteer.ts';

const row = (city: string, lat: number, lng: number) => ({ city, lat, lng });
const labels = (g: ReturnType<typeof buildCityGazetteer>) => g.map((c) => c.label);

describe('baseLabel', () => {
  it('strips one Danish postal district suffix', () => {
    expect(baseLabel('Odense C')).toBe('Odense');
    expect(baseLabel('København NV')).toBe('København');
    expect(baseLabel('Nykøbing F')).toBe('Nykøbing');
    expect(baseLabel('Harlev J')).toBe('Harlev');
  });
  it('leaves a plain town alone, suffix-shaped or not', () => {
    expect(baseLabel('Hårlev')).toBe('Hårlev');
    expect(baseLabel('Sønderborg')).toBe('Sønderborg');
    // Only ONE token comes off, and only if it is a known district.
    expect(baseLabel('Rønnede')).toBe('Rønnede');
    expect(baseLabel('Store Heddinge')).toBe('Store Heddinge');
  });
});

describe('buildCityGazetteer', () => {
  it('merges the districts of one real town into one offer', () => {
    // Odense's 8 districts span ~10.7 km in the live data — one town.
    const g = buildCityGazetteer([
      row('Odense C', 55.396, 10.39),
      row('Odense C', 55.398, 10.388),
      row('Odense SØ', 55.37, 10.44),
      row('Odense NV', 55.42, 10.36),
    ]);
    expect(labels(g)).toEqual(['Odense']);
    expect(g[0]!.weight).toBe(4);
    // The merged point sits among its members, not somewhere in the Baltic.
    expect(g[0]!.lat).toBeGreaterThan(55.36);
    expect(g[0]!.lat).toBeLessThan(55.43);
  });

  // THE LANDMINE, measured against the real database: Hårlev is on Stevns,
  // Harlev J is outside Aarhus, they are 166 km apart, and they fold to the
  // same key the moment the district suffix comes off. Merging them would hand
  // someone a start point 166 km from home and state it as fact — the exact
  // failure this whole feature exists to prevent.
  it('REFUSES to merge two different towns that merely spell alike', () => {
    const g = buildCityGazetteer([
      row('Hårlev', 55.353, 12.255), // Stevns
      row('Harlev J', 56.142, 10.001), // Aarhus, 166 km away
    ]);
    expect(labels(g).sort()).toEqual(['Harlev J', 'Hårlev']);
    // and never the seductive, wrong, merged form
    expect(labels(g)).not.toContain('Harlev');
    expect(labels(g)).not.toContain('Hårlev ');
  });

  it('keeps the three Nykøbings apart (294 km across three islands)', () => {
    const g = buildCityGazetteer([
      row('Nykøbing F', 54.769, 11.874), // Falster
      row('Nykøbing Sj', 55.924, 11.673), // Sjælland
      row('Nykøbing M', 56.793, 8.858), // Mors
    ]);
    expect(labels(g).sort()).toEqual(['Nykøbing F', 'Nykøbing M', 'Nykøbing Sj']);
    expect(labels(g)).not.toContain('Nykøbing');
  });

  // A single label must never be promoted to its base: we would be naming a town
  // whose position we do not actually know.
  it('never invents a base from a lone suffixed label', () => {
    const g = buildCityGazetteer([row('Nykøbing F', 54.769, 11.874)]);
    expect(labels(g)).toEqual(['Nykøbing F']);
  });

  it('merges case-only duplicates and keeps the capitalised spelling', () => {
    const g = buildCityGazetteer([
      row('Rønnede', 55.25, 12.02),
      row('Rønnede', 55.25, 12.02),
      row('rønnede', 55.26, 12.03),
    ]);
    expect(labels(g)).toEqual(['Rønnede']);
    expect(g[0]!.weight).toBe(3);
  });

  it('drops rows with no town or no position, and never throws on them', () => {
    const g = buildCityGazetteer([
      { city: null, lat: 55, lng: 12 },
      { city: 'Ukendt', lat: null, lng: null },
      { city: '   ', lat: 55, lng: 12 },
      row('Sønderborg', 54.914, 9.792),
    ]);
    expect(labels(g)).toEqual(['Sønderborg']);
  });

  // The live data has 15 of these: an address or a postcode crammed into the
  // city field. A town with a house number in it is not a town.
  it('never offers an address as a town', () => {
    const g = buildCityGazetteer([
      row('Friggasvej 14  Odense V', 55.4, 10.35),
      row(', 6640 Lunderskov, 6640 Lunderskov', 55.5, 9.3),
      row('Skalborg, 9200 Aalborg SV', 57.0, 9.9),
      row('Odense C', 55.396, 10.39),
    ]);
    expect(labels(g)).toEqual(['Odense C']);
  });

  it('ranks by how much data stands behind a town', () => {
    const g = buildCityGazetteer([
      row('Lille By', 56.0, 9.0),
      row('Stor By', 55.0, 12.0),
      row('Stor By', 55.01, 12.01),
      row('Stor By', 55.02, 12.02),
    ]);
    expect(labels(g)).toEqual(['Stor By', 'Lille By']);
  });

  it('the threshold sits in the measured gap between "same town" and "not close"', () => {
    // Odense (largest legitimate group) = 10.7 km; Hårlev/Harlev J = 166.1 km.
    expect(AMBIGUITY_KM).toBeGreaterThan(10.7);
    expect(AMBIGUITY_KM).toBeLessThan(166.1);
  });
});

describe('suggestCities', () => {
  const g = buildCityGazetteer([
    row('Sønderborg', 54.914, 9.792),
    row('Sønderborg', 54.915, 9.793),
    row('Søndersø', 55.5, 10.25),
    row('Aabenraa', 55.044, 9.418),
  ]);

  it('matches Danish spelling in every convention a visitor might type', () => {
    for (const q of ['sønderborg', 'soenderborg', 'sonderborg', 'SØNDER']) {
      expect(suggestCities(g, q).map((c) => c.label)).toContain('Sønderborg');
    }
  });

  it('puts prefix matches before mere containments', () => {
    // "København" folds to "kobenhavn" (starts with "kob"); "Nykøbing F" folds
    // to "nykobing f", which merely CONTAINS "kob". Someone typing "kob" means
    // the capital, so it must come first.
    const g2 = buildCityGazetteer([
      row('Nykøbing F', 54.769, 11.874),
      row('Nykøbing F', 54.77, 11.875),
      row('Nykøbing F', 54.771, 11.876), // heaviest, so only the rule can beat it
      row('København K', 55.68, 12.58),
    ]);
    // Note "København K", not "København": a lone label is never promoted to
    // its base — the rule this file exists to enforce, holding here too.
    expect(suggestCities(g2, 'kob').map((c) => c.label)).toEqual(['København K', 'Nykøbing F']);
  });

  it('returns the heaviest towns when nothing is typed', () => {
    expect(suggestCities(g, '')[0]!.label).toBe('Sønderborg'); // 2 rows behind it
  });

  it('finds nothing rather than guessing', () => {
    expect(suggestCities(g, 'zzzz')).toEqual([]);
  });
});
