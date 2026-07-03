/**
 * Vorbasse Marked (vorbasse-marked.dk) — one of Denmark's largest kræmmer- and
 * livestock markets, held over a few consecutive days each July at the market
 * grounds in 6623 Vorbasse. The dates change every year and are stated in the
 * page heading ("Vorbasse Marked - 16. til 18. juli 2026"), so we parse them from
 * the live page rather than hard-coding — next year's dates are picked up
 * automatically, and if the page stops announcing a date the reconciler expires it.
 */
import type { EventCategory, Occurrence, RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://vorbasse-marked.dk/';

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, marts: 3, april: 4, maj: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, december: 12,
};

/** Parse "16. til 18. juli 2026" / "16.-18. juli 2026" into per-day occurrences. */
export function parseVorbasseDates(html: string): Occurrence[] {
  const m = html.match(
    /(\d{1,2})\.?\s*(?:til|[-–])\s*(\d{1,2})\.?\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\s*(\d{4})/i,
  );
  if (!m) return [];
  const d1 = Number(m[1]);
  const d2 = Number(m[2]);
  const mo = MONTHS[m[3]!.toLowerCase()];
  const y = Number(m[4]);
  // Sanity: a plausible multi-day market window, not a stray number range.
  if (!mo || d2 < d1 || d2 - d1 > 10) return [];
  const occ: Occurrence[] = [];
  for (let d = d1; d <= d2; d++) {
    occ.push({
      date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      startTime: null,
      endTime: null,
    });
  }
  return occ;
}

export const vorbasseMarked: SourceAdapter = {
  key: 'vorbasse-marked',
  name: 'Vorbasse Marked',
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
    if (res.status !== 200) return [];
    const occurrences = parseVorbasseDates(res.body);
    if (occurrences.length === 0) return [];
    return [
      {
        sourceKey: 'vorbasse-marked',
        sourceUrl: BASE,
        sourceEventId: 'vorbasse-marked',
        title: 'Vorbasse Marked',
        description:
          'Et af Danmarks største kræmmer- og dyrskuemarkeder — tusindvis af stande, dyr, tivoli og musik på markedspladsen i Vorbasse.',
        category: 'kraemmermarked' as EventCategory,
        venueName: 'Vorbasse Markedsplads',
        postcode: '6623',
        city: 'Vorbasse',
        indoorOutdoor: 'outdoor',
        contactWebsite: BASE,
        occurrences,
      },
    ];
  },
};
