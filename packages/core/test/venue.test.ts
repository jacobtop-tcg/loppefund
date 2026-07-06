import { describe, expect, it } from 'vitest';
import { classifyVenue } from '../src/venue.ts';
import { parseOsmHours, osmOpenState } from '../src/osm-hours.ts';

describe('classifyVenue', () => {
  it('reads the name for the three types OSM cannot tag apart', () => {
    // All of these arrive as shop=second_hand from OSM.
    expect(classifyVenue({ shop: 'second_hand', name: 'Reolmarkedet Aarhus' })).toBe('reolmarked');
    expect(classifyVenue({ shop: 'second_hand', name: 'Den Gamle Loppelade' })).toBe('loppebutik');
    expect(classifyVenue({ shop: 'second_hand', name: 'Loppemarked på Havnen' })).toBe('loppebutik');
  });

  it('maps antique dealers and antiquarian bookshops to antik', () => {
    expect(classifyVenue({ shop: 'antiques', name: 'Antikgården' })).toBe('antik');
    expect(classifyVenue({ shop: 'books', name: 'Vangsgaards Antikvariat' })).toBe('antik');
  });

  it('reads kræmmermarked as part of the loppe family, not genbrug', () => {
    // amenity=marketplace kræmmermarkeder arrive with no shop tag; without the
    // name signal they would wrongly default to genbrug.
    expect(classifyVenue({ name: 'Vejby Kræmmermarked' })).toBe('loppebutik');
    expect(classifyVenue({ name: 'Bogense kræmmermarked' })).toBe('loppebutik');
  });

  it('maps charity shops and named genbrug operators to genbrug', () => {
    expect(classifyVenue({ shop: 'charity', name: 'Røde Kors Butik' })).toBe('genbrug');
    expect(classifyVenue({ shop: 'second_hand', name: 'Genbrug til Syd' })).toBe('genbrug');
    expect(classifyVenue({ shop: 'second_hand', operator: 'Kirkens Korshær' })).toBe('genbrug');
  });

  it('defaults a bare commercial second-hand shop to genbrug', () => {
    expect(classifyVenue({ shop: 'second_hand', name: 'Retro & More' })).toBe('genbrug');
  });

  it('lets a distinctive name override a generic shop tag', () => {
    // A charity-run flea barn still reads as a loppebutik by its name.
    expect(classifyVenue({ shop: 'charity', name: 'Loppeladen i Vejle' })).toBe('loppebutik');
  });
});

describe('parseOsmHours', () => {
  it('parses weekday ranges and lists', () => {
    expect(parseOsmHours('Mo-Fr 10:00-17:30; Sa 10:00-14:00; Su off')).toEqual([
      [[600, 1050]], [[600, 1050]], [[600, 1050]], [[600, 1050]], [[600, 1050]],
      [[600, 840]], [],
    ]);
  });

  it('handles a lunch break (two ranges on one day)', () => {
    const w = parseOsmHours('Mo 10:00-12:00,13:00-17:00')!;
    expect(w[0]).toEqual([[600, 720], [780, 1020]]);
  });

  it('applies a time-only rule to every day', () => {
    const w = parseOsmHours('10:00-16:00')!;
    expect(w.every((d) => d.length === 1 && d[0]![0] === 600)).toBe(true);
  });

  it('expands 24/7 and lets a later "off" rule override', () => {
    const w = parseOsmHours('24/7; Su off')!;
    expect(w[0]).toEqual([[0, 1440]]);
    expect(w[6]).toEqual([]);
  });

  it('skips holiday/month selectors instead of mis-parsing', () => {
    // The PH rule is dropped; the weekday rule still parses.
    const w = parseOsmHours('Mo-Fr 09:00-17:00; PH off')!;
    expect(w[0]).toEqual([[540, 1020]]);
  });

  it('returns null for unparseable or empty input', () => {
    expect(parseOsmHours('')).toBeNull();
    expect(parseOsmHours(null)).toBeNull();
    expect(parseOsmHours('by appointment')).toBeNull();
  });
});

describe('osmOpenState', () => {
  const HOURS = 'Mo-Fr 10:00-17:30; Sa 10:00-14:00; Su off';

  it('reports open now and the closing time', () => {
    // Wednesday (2) at 12:00 (720 min).
    expect(osmOpenState(HOURS, 2, 720)).toMatchObject({ known: true, open: true, closesAt: '17:30' });
  });

  it('reports the next opening later the same day', () => {
    // Wednesday at 08:00 — opens at 10:00 today.
    expect(osmOpenState(HOURS, 2, 480)).toMatchObject({ open: false, opensAt: '10:00', opensInDays: 0 });
  });

  it('rolls to the next open day when today is finished or closed', () => {
    // Sunday (6) is off -> next opening is Monday 10:00 (1 day ahead).
    expect(osmOpenState(HOURS, 6, 600)).toMatchObject({ open: false, opensAt: '10:00', opensInDays: 1 });
    // Friday after close (18:00) -> Saturday 10:00.
    expect(osmOpenState(HOURS, 4, 1080)).toMatchObject({ open: false, opensAt: '10:00', opensInDays: 1 });
  });

  it('marks hours unknown when the string cannot be parsed', () => {
    expect(osmOpenState('ring og aftal', 2, 720)).toMatchObject({ known: false, open: false });
  });

  it('formats a midnight close as 24:00, never 00:00', () => {
    // "Mo-Su 00:00-24:00" (an all-day tag) at 02:00 -> open, closes 24:00.
    expect(osmOpenState('Mo-Su 00:00-24:00', 0, 120)).toMatchObject({ open: true, closesAt: '24:00' });
  });
});
