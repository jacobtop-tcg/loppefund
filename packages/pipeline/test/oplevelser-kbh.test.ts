import { describe, expect, it } from 'vitest';
import { oplevelserKbh } from '../src/adapters/oplevelser-kbh.ts';
import type { FetchResult } from '../src/adapters/types.ts';

// A Tribe Events API page shaped like the real one, plus a second (empty) page.
function stubFetch(): (url: string) => Promise<FetchResult> {
  const page1 = JSON.stringify({
    total_pages: 1,
    events: [
      {
        id: 42,
        title: 'Loppemarked Tofteg&#229;rds Plads',
        url: 'https://oplevelser-i-koebenhavn.dk/event/toftegaard/',
        start_date: '2026-07-04 07:00:00',
        end_date: '2026-07-04 15:00:00',
        all_day: false,
        cost: 'Gratis',
        categories: [{ slug: 'loppemarked', name: 'Loppemarked' }],
        venue: { venue: 'Toftegårds Plads', address: 'Toftegårds Plads, 2500 Valby, Danmark' },
      },
    ],
  });
  const empty = JSON.stringify({ total_pages: 1, events: [] });
  return async (url: string) => ({
    url,
    status: 200,
    // Only page 1 of the loppemarked category returns the event; everything else empty.
    body: url.includes('categories=loppemarked') && url.includes('page=1') ? page1 : empty,
  });
}

describe('oplevelser-kbh adapter', () => {
  it('maps a Tribe market event to a clean raw with parsed address', async () => {
    const raws = await oplevelserKbh.fetchRawEvents!(stubFetch());
    expect(raws).toHaveLength(1);
    const r = raws[0]!;
    expect(r.sourceKey).toBe('oplevelser-kbh');
    expect(r.title).toBe('Loppemarked Toftegårds Plads'); // entity decoded
    expect(r.postcode).toBe('2500');
    expect(r.city).toBe('Valby');
    expect(r.isFree).toBe(true);
    expect(r.occurrences![0]).toEqual({ date: '2026-07-04', startTime: '07:00', endTime: '15:00' });
  });
});
