/**
 * Kirkeby Gamle Mejeri (kirkebygamlemejeri.dk) — "Fyns største indendørs
 * kræmmermarked": 50+ kræmmere on 100 stalls at Assensvej 13, 5771 Stenstrup,
 * every EVEN-week Sunday 10:00–16:00.
 *
 * A static (latin-1) marketing page with no machine-readable data. We fetch it to
 * confirm the market still runs (so the reconciler expires it if it disappears)
 * and emit its published recurrence; the canonicalizer turns "søndag i lige uger"
 * into concrete even-week Sundays via resolveSchedule.
 */
import type { EventCategory, RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://kirkebygamlemejeri.dk/';

export const kirkebyGamleMejeri: SourceAdapter = {
  key: 'kirkeby-gamle-mejeri',
  name: 'Kirkeby Gamle Mejeri',
  baseUrl: BASE,
  trust: 0.7,

  async discover(): Promise<string[]> {
    return [];
  },
  extract(): RawEvent | null {
    return null;
  },

  async fetchRawEvents(fetch: FetchFn): Promise<RawEvent[]> {
    const res = await fetch(BASE);
    // Down or no longer a market → emit nothing (the reconciler expires it).
    if (res.status !== 200 || !/marked/i.test(res.body)) return [];
    return [
      {
        sourceKey: 'kirkeby-gamle-mejeri',
        sourceUrl: BASE,
        sourceEventId: 'kirkeby-gamle-mejeri',
        title: 'Kræmmermarked på Kirkeby Gamle Mejeri',
        description:
          'Fyns største indendørs kræmmermarked — mere end 50 kræmmere fordelt på 100 stande. Søndag i lige uger.',
        category: 'kraemmermarked' as EventCategory,
        venueName: 'Kirkeby Gamle Mejeri',
        street: 'Assensvej 13',
        postcode: '5771',
        city: 'Stenstrup',
        indoorOutdoor: 'indoor',
        stallCountText: '100 stande',
        scheduleText: 'Søndag i lige uger',
        openingHoursText: 'Søndag 10-16',
      },
    ];
  },
};
