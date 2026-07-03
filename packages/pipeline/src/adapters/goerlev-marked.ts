/**
 * Gørlev Heste- og Kræmmermarked (goerlevhesteogkraemmer.dk) — a traditional
 * horse & flea market held twice a year (summer + autumn) at the market grounds
 * in 4281 Gørlev. Dates change yearly and both editions are announced as
 * "i uge NN den D.-D. <måned>". We anchor on that "uge N den" phrase so we pick
 * up BOTH market windows and never mistake the page's "Redigeret den …" edit
 * timestamp for a market date. Year is inferred to the current year when the
 * source omits it — which yields either the correct upcoming date or a past date
 * the canonicalizer drops, never a wrong future date.
 */
import type { EventCategory, Occurrence, RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://goerlevhesteogkraemmer.dk/';

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, marts: 3, april: 4, maj: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, december: 12,
};

/** Extract both "i uge NN den D.-D. <måned>" market windows as occurrences. */
export function parseGoerlevDates(html: string, currentYear: number): Occurrence[] {
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const re =
    /uge\s*\d+\s*den\s*([\d.\s–—-]+?)\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\s*(\d{4})?/gi;
  const seen = new Set<string>();
  const occ: Occurrence[] = [];
  for (const m of txt.matchAll(re)) {
    const days = (m[1]!.match(/\d+/g) ?? []).map(Number);
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (days.length === 0 || !mo) continue;
    const y = m[3] ? Number(m[3]) : currentYear;
    const d1 = Math.min(...days);
    const d2 = Math.max(...days);
    if (d2 - d1 > 6) continue; // a market window, not a stray range
    for (let d = d1; d <= d2; d++) {
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!seen.has(iso)) {
        seen.add(iso);
        occ.push({ date: iso, startTime: null, endTime: null });
      }
    }
  }
  return occ.sort((a, b) => a.date.localeCompare(b.date));
}

export const goerlevMarked: SourceAdapter = {
  key: 'goerlev-marked',
  name: 'Gørlev Heste- og Kræmmermarked',
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
    const occurrences = parseGoerlevDates(res.body, new Date().getUTCFullYear());
    if (occurrences.length === 0) return [];
    return [
      {
        sourceKey: 'goerlev-marked',
        sourceUrl: BASE,
        sourceEventId: 'goerlev-marked',
        title: 'Gørlev Heste- og Kræmmermarked',
        description:
          'Traditionsrigt heste- og kræmmermarked i Gørlev — sommer- og efterårsmarked med kræmmerstande, dyr og hyggeligt marked.',
        category: 'kraemmermarked' as EventCategory,
        venueName: 'Gørlev Markedsplads',
        postcode: '4281',
        city: 'Gørlev',
        indoorOutdoor: 'outdoor',
        contactWebsite: BASE,
        occurrences,
      },
    ];
  },
};
