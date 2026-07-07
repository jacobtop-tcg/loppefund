import { describe, expect, it } from 'vitest';
import { recommend } from './recommend.ts';
import type { EventSummary } from './data.ts';

const base = (over: Partial<EventSummary>): EventSummary => ({
  slug: 'x', title: 'X', category: 'loppemarked', venueName: null, city: null, postcode: null,
  municipality: null, lat: 55.7, lng: 12.5, approximate: false, isFree: null, indoorOutdoor: 'outdoor',
  stallCountText: null, status: 'active', confidence: 0.6, sourceCount: 1, newlyAdded: false,
  gem: false, familyFriendly: false, accessible: false, cashOnly: false, recurrence: null,
  weatherDependent: false,
  searchText: '', occurrences: [{ date: '2026-07-04', startTime: '10:00', endTime: '15:00' }], ...over,
});

const dist = (aLat: number, aLng: number, bLat: number, bLng: number) =>
  Math.hypot(aLat - bLat, aLng - bLng) * 111; // rough km

describe('recommend', () => {
  const today = '2026-07-03';
  const pos = { lat: 55.7, lng: 12.5 };

  it('ranks a nearby hidden gem this weekend above a far low-confidence market', () => {
    const near = base({ slug: 'near', gem: true, confidence: 0.8, lat: 55.71, lng: 12.51 });
    const far = base({ slug: 'far', confidence: 0.45, lat: 57.0, lng: 9.9 });
    const recs = recommend([far, near], pos, today, { distanceKm: dist });
    expect(recs[0]!.event.slug).toBe('near');
  });

  it('gives each pick a timing reason and surfaces gem/free/near', () => {
    const e = base({ slug: 'g', gem: true, isFree: true, lat: 55.705, lng: 12.505 });
    const [r] = recommend([e], pos, today, { distanceKm: dist });
    expect(r!.reasons[0]).toMatch(/i dag|i morgen|på |d\. /);
    expect(r!.reasons.join(' ')).toContain('skjult perle');
  });

  it('keeps generic "godt bekræftet" from crowding out real feature chips', () => {
    // A market rich in real signals must not spend a chip slot on reassurance.
    const rich = base({ slug: 'r', gem: true, familyFriendly: true, isFree: true, confidence: 0.9,
      lat: 55.705, lng: 12.505 });
    const [r] = recommend([rich], pos, today, { distanceKm: dist });
    expect(r!.reasons).not.toContain('godt bekræftet');
    // A market whose only distinction is high confidence may still show it.
    const plain = base({ slug: 'p', confidence: 0.9, lat: 57, lng: 9.9 });
    const [p] = recommend([plain], null, today, {});
    expect(p!.reasons).toContain('godt bekræftet');
  });

  it('boosts a saved favorite and labels it "gemt af dig"', () => {
    // Two otherwise-identical far markets; the saved one must win + be flagged.
    const saved = base({ slug: 'saved', lat: 57, lng: 9.9, confidence: 0.6 });
    const other = base({ slug: 'other', lat: 57, lng: 9.9, confidence: 0.6 });
    const recs = recommend([other, saved], pos, today, {
      distanceKm: dist,
      favorites: new Set(['saved']),
    });
    expect(recs[0]!.event.slug).toBe('saved');
    expect(recs[0]!.isFavorite).toBe(true);
    expect(recs[0]!.reasons).toContain('gemt af dig');
    expect(recs.find((r) => r.event.slug === 'other')!.isFavorite).toBe(false);
  });

  it('labels a far-but-worthwhile market "værd at køre" and a near one "km væk"', () => {
    const near = base({ slug: 'near', lat: 55.705, lng: 12.505 }); // ~0.8 km
    // ~40 km gem — worth the drive
    const farGem = base({ slug: 'fargem', gem: true, lat: 56.06, lng: 12.5 });
    const recs = recommend([near, farGem], pos, today, { distanceKm: dist });
    const nearR = recs.find((r) => r.event.slug === 'near')!;
    const farR = recs.find((r) => r.event.slug === 'fargem')!;
    expect(nearR.reasons.some((x) => /km væk/.test(x))).toBe(true);
    expect(farR.reasons.some((x) => /værd at køre/.test(x))).toBe(true);
  });

  it('skips events with no upcoming occurrence and caps the list', () => {
    const past = base({ slug: 'p', occurrences: [{ date: '2026-06-01', startTime: null, endTime: null }] });
    const many = Array.from({ length: 8 }, (_, i) => base({ slug: `m${i}` }));
    const recs = recommend([past, ...many], pos, today, { distanceKm: dist, limit: 4 });
    expect(recs).toHaveLength(4);
    expect(recs.some((r) => r.event.slug === 'p')).toBe(false);
  });
});
