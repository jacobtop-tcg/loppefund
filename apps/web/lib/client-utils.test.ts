import { describe, expect, it } from 'vitest';
import {
  buildTripUrl,
  DEFAULT_EXPLORER_PARAMS,
  foldForSearch,
  matchesQuery,
  optimizeTripOrder,
  parseExplorerParams,
  serializeExplorerParams,
  tripDistanceKm,
  type ExplorerParams,
} from './client-utils.ts';

describe('matchesQuery', () => {
  const hay = foldForSearch('Stort Loppemarked i Odense C · Kræmmerhallen');
  it('matches multi-word queries regardless of token order', () => {
    // The bug: a plain substring match fails because "odense" precedes
    // "loppemarked" in the query but follows it in the haystack.
    expect(matchesQuery(hay, foldForSearch('odense loppemarked'))).toBe(true);
    expect(matchesQuery(hay, foldForSearch('loppemarked odense'))).toBe(true);
  });
  it('still matches single-word and folded (æøå) queries', () => {
    expect(matchesQuery(hay, foldForSearch('kræmmer'))).toBe(true);
    expect(matchesQuery(hay, foldForSearch('ODENSE'))).toBe(true);
  });
  it('requires every token to be present (AND, not OR)', () => {
    expect(matchesQuery(hay, foldForSearch('odense aarhus'))).toBe(false);
  });
  it('an empty query matches everything', () => {
    expect(matchesQuery(hay, '')).toBe(true);
    expect(matchesQuery(hay, '   ')).toBe(true);
  });
  it('forgives a single fumbled letter (edit distance 1) on 4+ char tokens', () => {
    expect(matchesQuery(hay, foldForSearch('loppmarked'))).toBe(true); // missing 'e'
    expect(matchesQuery(foldForSearch('Aarhus C'), foldForSearch('arhus'))).toBe(true);
  });
  it('does not fuzzy-match short tokens or two-error typos (never invents matches)', () => {
    expect(matchesQuery(hay, foldForSearch('ode'))).toBe(true); // substring, fast path
    expect(matchesQuery(hay, foldForSearch('xyz'))).toBe(false); // <4 chars, no fuzzy
    expect(matchesQuery(hay, foldForSearch('loppomarkat'))).toBe(false); // >1 edit away
  });
});

// Mirror of Explorer's dateRangeFor to pin the Sunday "næste weekend" bug.
function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function weekdayOfIso(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}
function nextWeekendRange(today: string): [string, string] {
  const wd = weekdayOfIso(today);
  const thisSat = wd === 7 ? addDaysIso(today, -1) : addDaysIso(today, (6 - wd + 7) % 7);
  const thisSun = addDaysIso(thisSat, 1);
  return [addDaysIso(thisSat, 7), addDaysIso(thisSun, 7)];
}

describe('nextWeekendRange', () => {
  it('is a valid forward range on every weekday incl. Sunday', () => {
    // 2026-07-05 is a Sunday; the old code produced an inverted range here.
    for (let i = 0; i < 7; i++) {
      const day = addDaysIso('2026-07-05', i);
      const [from, to] = nextWeekendRange(day);
      expect(from <= to).toBe(true);
      expect(weekdayOfIso(from)).toBe(6); // Saturday
      expect(weekdayOfIso(to)).toBe(7); // Sunday
      expect(from > day).toBe(true); // strictly in the future
    }
  });
});

describe('buildTripUrl', () => {
  it('returns null below 2 stops', () => {
    expect(buildTripUrl([])).toBeNull();
    expect(buildTripUrl([{ lat: 55.6761, lng: 12.5683 }])).toBeNull();
  });

  it('routes through waypoints to the last stop as destination', () => {
    const url = buildTripUrl([
      { lat: 55.6761, lng: 12.5683 },
      { lat: 56.1629, lng: 10.2039 },
    ])!;
    const p = new URL(url).searchParams;
    expect(p.get('api')).toBe('1');
    expect(p.get('travelmode')).toBe('driving');
    expect(p.get('destination')).toBe('56.162900,10.203900');
    expect(p.get('waypoints')).toBe('55.676100,12.568300');
  });

  it('joins multiple waypoints with | in route order', () => {
    const url = buildTripUrl([
      { lat: 55.1, lng: 12.1 },
      { lat: 55.2, lng: 12.2 },
      { lat: 55.3, lng: 12.3 },
    ])!;
    expect(new URL(url).searchParams.get('waypoints')).toBe(
      '55.100000,12.100000|55.200000,12.200000',
    );
    expect(url).toContain('%7C');
  });
});

describe('optimizeTripOrder', () => {
  // Four stops roughly on a NE Zealand line; scrambled input order.
  const A = { id: 'A', lat: 55.40, lng: 12.30 }; // south
  const B = { id: 'B', lat: 55.60, lng: 12.35 };
  const C = { id: 'C', lat: 55.80, lng: 12.40 };
  const D = { id: 'D', lat: 56.00, lng: 12.45 }; // north
  const scrambled = [C, A, D, B];

  it('returns <=1 stop unchanged', () => {
    expect(optimizeTripOrder([])).toEqual([]);
    expect(optimizeTripOrder([A])).toEqual([A]);
  });

  it('keeps exactly the same set of stops (no drops or dupes)', () => {
    const out = optimizeTripOrder(scrambled, { lat: 55.35, lng: 12.28 });
    expect(out).toHaveLength(4);
    expect(new Set(out.map((s) => s.id))).toEqual(new Set(['A', 'B', 'C', 'D']));
  });

  it('orders nearest-first from the user start (S->A->B->C->D)', () => {
    const out = optimizeTripOrder(scrambled, { lat: 55.35, lng: 12.28 });
    expect(out.map((s) => s.id)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('anchors on the northernmost stop and chains south when start is unknown', () => {
    const out = optimizeTripOrder(scrambled);
    expect(out.map((s) => s.id)).toEqual(['D', 'C', 'B', 'A']);
  });

  it('never produces a longer route than the raw scrambled order', () => {
    const start = { lat: 55.35, lng: 12.28 };
    const optimized = tripDistanceKm(optimizeTripOrder(scrambled, start), start);
    const raw = tripDistanceKm(scrambled, start);
    expect(optimized).toBeLessThanOrEqual(raw);
  });
});

describe('tripDistanceKm', () => {
  it('is 0 for zero or one stop without a start', () => {
    expect(tripDistanceKm([])).toBe(0);
    expect(tripDistanceKm([{ lat: 55.6, lng: 12.5 }])).toBe(0);
  });

  it('counts the start->first leg when a start is given', () => {
    const stops = [{ lat: 55.5, lng: 12.5 }];
    const withStart = tripDistanceKm(stops, { lat: 55.0, lng: 12.5 });
    expect(withStart).toBeGreaterThan(50); // ~55.6 km per half-degree lat
  });

  it('sums consecutive legs in order', () => {
    const stops = [
      { lat: 55.0, lng: 12.0 },
      { lat: 55.5, lng: 12.0 },
      { lat: 56.0, lng: 12.0 },
    ];
    // Two half-degree-lat legs, ~55.6 km each.
    expect(tripDistanceKm(stops)).toBeGreaterThan(105);
    expect(tripDistanceKm(stops)).toBeLessThan(115);
  });
});

describe('parseExplorerParams', () => {
  it('returns all defaults for an empty query string', () => {
    expect(parseExplorerParams('')).toEqual(DEFAULT_EXPLORER_PARAMS);
    expect(parseExplorerParams('?')).toEqual(DEFAULT_EXPLORER_PARAMS);
  });

  it('parses each key from a fully-populated URL', () => {
    const parsed = parseExplorerParams(
      '?dato=idag&kat=antikmarked&q=aarhus&gratis=1&familie=1&stor=1&handicap=1&bekr=1&inde=1&gemt=1&perler=1&visning=kort&tur=e:broens-lopper,v:antik-2b',
    );
    expect(parsed).toEqual<ExplorerParams>({
      dateFilter: 'idag',
      category: 'antikmarked',
      query: 'aarhus',
      freeOnly: true,
      familyOnly: true,
      biggerOnly: true,
      accessibleOnly: true,
      verifiedOnly: true,
      inOut: 'indoor',
      savedOnly: true,
      gemsFirst: true,
      view: 'map',
      trip: ['e:broens-lopper', 'v:antik-2b'],
    });
  });

  it('drops malformed trip tokens (never injects junk state from a mangled URL)', () => {
    const parsed = parseExplorerParams('?tur=e:ok-slug,junk,x:bad,e:UPPER,v:also-ok');
    expect(parsed.trip).toEqual(['e:ok-slug', 'v:also-ok']);
  });

  it('accepts a leading ? or none', () => {
    expect(parseExplorerParams('dato=alle')).toEqual(
      parseExplorerParams('?dato=alle'),
    );
  });

  it('maps ude=1 to outdoor and ignores inde when both present (inde wins)', () => {
    expect(parseExplorerParams('?ude=1').inOut).toBe('outdoor');
    expect(parseExplorerParams('?inde=1&ude=1').inOut).toBe('indoor');
  });

  it('falls back to the default date filter for unknown values', () => {
    expect(parseExplorerParams('?dato=nonsense').dateFilter).toBe('weekend');
    expect(parseExplorerParams('?dato=').dateFilter).toBe('weekend');
  });

  it('treats non-"1" flag values as false', () => {
    const parsed = parseExplorerParams('?gratis=0&familie=true&gemt=yes&perler=');
    expect(parsed.freeOnly).toBe(false);
    expect(parsed.familyOnly).toBe(false);
    expect(parsed.savedOnly).toBe(false);
    expect(parsed.gemsFirst).toBe(false);
  });

  it('treats an empty category as null', () => {
    expect(parseExplorerParams('?kat=').category).toBeNull();
  });

  it('only treats visning=kort as the map view', () => {
    expect(parseExplorerParams('?visning=kort').view).toBe('map');
    expect(parseExplorerParams('?visning=liste').view).toBe('list');
    expect(parseExplorerParams('').view).toBe('list');
  });
});

describe('serializeExplorerParams', () => {
  it('serializes the default state to the empty string', () => {
    expect(serializeExplorerParams(DEFAULT_EXPLORER_PARAMS)).toBe('');
  });

  it('omits the default weekend date filter but keeps others', () => {
    expect(serializeExplorerParams({ ...DEFAULT_EXPLORER_PARAMS, dateFilter: 'weekend' })).toBe('');
    expect(serializeExplorerParams({ ...DEFAULT_EXPLORER_PARAMS, dateFilter: 'idag' })).toBe('dato=idag');
  });

  it('trims whitespace and omits an empty query', () => {
    expect(serializeExplorerParams({ ...DEFAULT_EXPLORER_PARAMS, query: '   ' })).toBe('');
    expect(serializeExplorerParams({ ...DEFAULT_EXPLORER_PARAMS, query: '  loppe  ' })).toBe('q=loppe');
  });

  it('encodes inOut as inde or ude', () => {
    expect(serializeExplorerParams({ ...DEFAULT_EXPLORER_PARAMS, inOut: 'indoor' })).toBe('inde=1');
    expect(serializeExplorerParams({ ...DEFAULT_EXPLORER_PARAMS, inOut: 'outdoor' })).toBe('ude=1');
  });

  it('round-trips a fully-populated state', () => {
    const state: ExplorerParams = {
      dateFilter: 'naeste-weekend',
      category: 'kraemmermarked',
      query: 'København',
      freeOnly: true,
      familyOnly: true,
      biggerOnly: true,
      accessibleOnly: true,
      verifiedOnly: true,
      inOut: 'outdoor',
      savedOnly: true,
      gemsFirst: true,
      view: 'map',
      trip: ['e:kbh-laengste', 'e:vanloese-torv'],
    };
    expect(parseExplorerParams('?' + serializeExplorerParams(state))).toEqual(state);
  });

  it('round-trips a partially-populated state', () => {
    const state: ExplorerParams = {
      ...DEFAULT_EXPLORER_PARAMS,
      dateFilter: 'aabent-nu',
      freeOnly: true,
    };
    expect(parseExplorerParams('?' + serializeExplorerParams(state))).toEqual(state);
  });
});
