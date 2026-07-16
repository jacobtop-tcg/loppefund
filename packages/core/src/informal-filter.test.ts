import { describe, expect, it } from 'vitest';
import {
  EMPTY_INFORMAL_FILTER,
  activeFilterCount,
  filterInformalPlaces,
  groupByTrustLayer,
  regionOptions,
  signalOptions,
  sortWithinLayers,
  typeOptions,
  type FilterablePlace,
  type InformalFilterState,
  type TextMatcher,
} from './informal-filter.ts';
import { searchFold } from './normalize.ts';

/**
 * Mirrors how the web app pairs its two Danish folds: searchFold() INDEXES both
 * spellings into the blob ("soenderborg sonderborg") while a QUERY is collapsed
 * to the lazy one ("sonderborg"). Feeding the indexing fold to a query and
 * substring-matching it never hits — the bug this suite caught on first run.
 */
const foldQuery = (s: string) =>
  s
    .toLowerCase()
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'o')
    .replaceAll('å', 'a')
    .replaceAll('oe', 'o')
    .replaceAll('aa', 'a');
const match: TextMatcher = (hay, q) =>
  foldQuery(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));

const place = (over: Partial<FilterablePlace> = {}): FilterablePlace => ({
  placeType: 'loppelade',
  inventorySignals: [],
  trustLayer: 'bekraeftet',
  municipality: 'Sønderborg',
  city: 'Guderup',
  fundScore: 50,
  confidence: 50,
  lastSeenAt: '2026-07-01',
  callBeforeVisiting: false,
  ...over,
  searchText: searchFold(over.searchText ?? 'Loppeladen Guderup'),
});

const f = (over: Partial<InformalFilterState>): InformalFilterState => ({
  ...EMPTY_INFORMAL_FILTER,
  ...over,
});

describe('hidden-place filtering', () => {
  it('returns everything when nothing is constrained', () => {
    const places = [place(), place({ trustLayer: 'radar' })];
    expect(filterInformalPlaces(places, EMPTY_INFORMAL_FILTER, match)).toHaveLength(2);
    expect(activeFilterCount(EMPTY_INFORMAL_FILTER)).toBe(0);
  });

  it('matches Danish text through folding (ø/æ/å must not break search)', () => {
    const places = [place({ searchText: 'Loppeladen ved Sønderborg' })];
    for (const q of ['sønderborg', 'soenderborg', 'sonderborg', 'SØNDERBORG']) {
      expect(filterInformalPlaces(places, f({ query: q }), match)).toHaveLength(1);
    }
    expect(filterInformalPlaces(places, f({ query: 'aarhus' }), match)).toHaveLength(0);
  });

  it('ORs within signals and ANDs across categories', () => {
    const vinyl = place({ inventorySignals: ['vinyl'], placeType: 'loppelade' });
    const lego = place({ inventorySignals: ['lego'], placeType: 'gaardsalg' });
    const both = place({ inventorySignals: ['vinyl', 'lego'], placeType: 'loppelade' });
    const all = [vinyl, lego, both];
    // vinyl OR lego -> all three
    expect(filterInformalPlaces(all, f({ signals: ['vinyl', 'lego'] }), match)).toHaveLength(3);
    // (vinyl OR lego) AND loppelade -> drops the gaardsalg
    expect(
      filterInformalPlaces(all, f({ signals: ['vinyl', 'lego'], types: ['loppelade'] }), match),
    ).toHaveLength(2);
  });

  it('applies the fund floor, region and call-first filters', () => {
    const all = [
      place({ fundScore: 80, municipality: 'Sønderborg' }),
      place({ fundScore: 40, municipality: 'Sønderborg' }),
      place({ fundScore: 90, municipality: 'Aarhus', callBeforeVisiting: true }),
    ];
    expect(filterInformalPlaces(all, f({ minFund: 70 }), match)).toHaveLength(2);
    expect(filterInformalPlaces(all, f({ region: 'Sønderborg' }), match)).toHaveLength(2);
    expect(filterInformalPlaces(all, f({ hideCallFirst: true }), match)).toHaveLength(2);
    expect(filterInformalPlaces(all, f({ minFund: 70, hideCallFirst: true }), match)).toHaveLength(1);
  });

  // THE INVARIANT. Everything else is convenience; this is the product promise.
  it('NEVER promotes a place across trust layers, whatever the filter or sort', () => {
    const radarStar = place({
      trustLayer: 'radar', fundScore: 100, confidence: 99, lastSeenAt: '2026-07-15',
    });
    const dullConfirmed = place({
      trustLayer: 'bekraeftet', fundScore: 1, confidence: 1, lastSeenAt: '2020-01-01',
    });
    const all = [radarStar, dullConfirmed];

    for (const sort of ['fund', 'sikkerhed', 'senest'] as const) {
      const sections = sortWithinLayers(all, sort);
      // The tempting rumour stays in Radar even when it wins every sort key.
      expect(sections.find((s) => s.layer === 'bekraeftet')!.places).toEqual([dullConfirmed]);
      expect(sections.find((s) => s.layer === 'radar')!.places).toEqual([radarStar]);
      // And the dependable layer is always offered first.
      expect(sections[0]!.layer).toBe('bekraeftet');
      expect(sections[2]!.layer).toBe('radar');
    }
  });

  it('sorts within a layer by the chosen key', () => {
    const a = place({ fundScore: 10, confidence: 90, lastSeenAt: '2026-01-01' });
    const b = place({ fundScore: 90, confidence: 10, lastSeenAt: '2026-07-01' });
    expect(sortWithinLayers([a, b], 'fund')[0]!.places[0]!.fundScore).toBe(90);
    expect(sortWithinLayers([a, b], 'sikkerhed')[0]!.places[0]!.confidence).toBe(90);
    expect(sortWithinLayers([a, b], 'senest')[0]!.places[0]!.lastSeenAt).toBe('2026-07-01');
  });

  it("does not mutate the caller's array while sorting", () => {
    const all = [place({ fundScore: 1 }), place({ fundScore: 99 })];
    const before = [...all];
    sortWithinLayers(all, 'fund');
    expect(all).toEqual(before);
  });

  it('groups every place and loses none', () => {
    const all = [place(), place({ trustLayer: 'radar' }), place({ trustLayer: 'kontroller-foerst' })];
    expect([...groupByTrustLayer(all).values()].flat()).toHaveLength(3);
  });

  // A chip that returns zero results promises inventory we do not have.
  it('offers only options that actually exist, most common first', () => {
    const all = [
      place({ inventorySignals: ['vinyl', 'lego'], placeType: 'loppelade', municipality: 'Sønderborg' }),
      place({ inventorySignals: ['vinyl'], placeType: 'loppelade', municipality: 'Aabenraa' }),
      place({ inventorySignals: [], placeType: 'doedsbo', municipality: null }),
    ];
    expect(signalOptions(all)).toEqual(['vinyl', 'lego']); // vinyl twice -> first
    expect(signalOptions(all)).not.toContain('moebler'); // nobody has furniture
    expect(typeOptions(all)).toEqual(['loppelade', 'doedsbo']);
    // Danish collation treats "Aa" as "Å", which sorts AFTER Z — so Aabenraa
    // comes last, not first. That surprises an English eye but is correct for a
    // Danish list, and it is ICU's job, not ours.
    expect(regionOptions(all)).toEqual(['Sønderborg', 'Aabenraa']);
  });

  it('counts active filters for the clear affordance', () => {
    expect(activeFilterCount(f({ query: '  ' }))).toBe(0); // whitespace is not a filter
    expect(activeFilterCount(f({ query: 'vinyl', types: ['loppelade'], minFund: 70 }))).toBe(3);
    expect(activeFilterCount(f({ signals: ['vinyl', 'lego'], hideCallFirst: true }))).toBe(3);
  });
});
