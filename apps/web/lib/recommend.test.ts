import { describe, expect, it } from 'vitest';
import { recommend } from './recommend.ts';
import type { EventSummary } from './data.ts';

const base = (over: Partial<EventSummary>): EventSummary => ({
  slug: 'x', title: 'X', category: 'loppemarked', venueName: null, city: null, postcode: null,
  municipality: null, lat: 55.7, lng: 12.5, approximate: false, isFree: null, indoorOutdoor: 'outdoor',
  stallCountText: null, status: 'active', confidence: 0.6, gem: false, familyFriendly: false,
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

  it('skips events with no upcoming occurrence and caps the list', () => {
    const past = base({ slug: 'p', occurrences: [{ date: '2026-06-01', startTime: null, endTime: null }] });
    const many = Array.from({ length: 8 }, (_, i) => base({ slug: `m${i}` }));
    const recs = recommend([past, ...many], pos, today, { distanceKm: dist, limit: 4 });
    expect(recs).toHaveLength(4);
    expect(recs.some((r) => r.event.slug === 'p')).toBe(false);
  });
});
