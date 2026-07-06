import { describe, expect, it } from 'vitest';
import { buildSearchIndex, suggestFor } from './search-index.ts';
import type { EventSummary, VenueSummary } from './data.ts';

const ev = (title: string, city: string): EventSummary =>
  ({ title, city, municipality: null }) as unknown as EventSummary;
const vn = (title: string, city: string): VenueSummary =>
  ({ title, city }) as unknown as VenueSummary;

const events = [
  ev('Kulhuse Loppemarked', 'Aarhus'),
  ev('Aarhus Bagagerumsmarked', 'Aarhus'),
  ev('Loppemarked på Torvet', 'Odense'),
];
const venues = [vn('Røde Kors Genbrug', 'Aarhus'), vn('Antikgården', 'Odense')];

describe('buildSearchIndex', () => {
  it('indexes deduped cities (weighted by market count), market names and venue names', () => {
    const idx = buildSearchIndex(events, venues);
    const cities = idx.filter((s) => s.kind === 'by').map((s) => s.label);
    expect(cities.sort()).toEqual(['Aarhus', 'Odense']);
    // Aarhus hosts 3 markets/venues, Odense 2 -> Aarhus ranks higher.
    const aarhus = idx.find((s) => s.label === 'Aarhus')!;
    const odense = idx.find((s) => s.label === 'Odense')!;
    expect(aarhus.weight).toBeGreaterThan(odense.weight);
    expect(idx.some((s) => s.kind === 'marked' && s.label === 'Kulhuse Loppemarked')).toBe(true);
    expect(idx.some((s) => s.kind === 'butik' && s.label === 'Antikgården')).toBe(true);
  });
});

describe('suggestFor', () => {
  const idx = buildSearchIndex(events, venues);

  it('returns nothing for < 2 chars', () => {
    expect(suggestFor(idx, 'a')).toEqual([]);
    expect(suggestFor(idx, '')).toEqual([]);
  });

  it('ranks a city prefix match first', () => {
    const top = suggestFor(idx, 'aar');
    expect(top[0]!.kind).toBe('by');
    expect(top[0]!.label).toBe('Aarhus');
  });

  it('is Danish-fold tolerant (ø/å/æ)', () => {
    // "rode" should match "Røde Kors Genbrug" via the fold.
    expect(suggestFor(idx, 'rode').some((s) => s.label === 'Røde Kors Genbrug')).toBe(true);
  });

  it('matches mid-string market names', () => {
    expect(suggestFor(idx, 'torvet').some((s) => s.label === 'Loppemarked på Torvet')).toBe(true);
  });
});
