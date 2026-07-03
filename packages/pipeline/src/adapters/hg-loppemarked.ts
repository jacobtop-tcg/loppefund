/**
 * Høje Gladsaxe Loppemarked (hgloppemarked.dk) — a recurring Saturday market at
 * Høje Gladsaxe Torv 4, 2860 Søborg, run by Høje Gladsaxe IF: "hver lørdag 9–14"
 * across a season the page states as "23. maj – 10. oktober". This market also
 * arrives via Facebook, so this authoritative source CORROBORATES it (lifts it
 * from "ubekræftet" toward "bekræftet").
 *
 * The page has no machine data, so we parse the stated season and compute the
 * concrete Saturdays (inferring the current year), which self-updates each season.
 */
import type { EventCategory, Occurrence, RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://hgloppemarked.dk/';

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, marts: 3, april: 4, maj: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, december: 12,
};

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
}

/** All Saturdays 09:00–14:00 within the season "DD. month – DD. month" of `year`. */
export function parseHgSaturdays(html: string, year: number): Occurrence[] {
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = txt.match(
    /(\d{1,2})\.\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\s*[–—-]\s*(\d{1,2})\.\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)/i,
  );
  if (!m) return [];
  const mo1 = MONTHS[m[2]!.toLowerCase()];
  const mo2 = MONTHS[m[4]!.toLowerCase()];
  if (!mo1 || !mo2) return [];
  const start = `${year}-${String(mo1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  const end = `${year}-${String(mo2).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
  if (end < start) return [];
  const occ: Occurrence[] = [];
  let d = start;
  while (d <= end && weekday(d) !== 6) d = addDaysIso(d, 1); // advance to first Saturday
  for (; d <= end; d = addDaysIso(d, 7)) {
    occ.push({ date: d, startTime: '09:00', endTime: '14:00' });
  }
  return occ;
}

export const hgLoppemarked: SourceAdapter = {
  key: 'hg-loppemarked',
  name: 'Høje Gladsaxe Loppemarked',
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
    const occurrences = parseHgSaturdays(res.body, new Date().getUTCFullYear());
    if (occurrences.length === 0) return [];
    return [
      {
        sourceKey: 'hg-loppemarked',
        sourceUrl: BASE,
        sourceEventId: 'hg-loppemarked',
        title: 'Høje Gladsaxe Loppemarked',
        description:
          'Loppemarked hver lørdag 9–14 på Høje Gladsaxe Torv, drevet af Høje Gladsaxe IF. Giv ting nyt liv.',
        category: 'loppemarked' as EventCategory,
        venueName: 'Høje Gladsaxe Torv',
        street: 'Høje Gladsaxe Torv 4',
        postcode: '2860',
        city: 'Søborg',
        indoorOutdoor: 'outdoor',
        organizer: 'Høje Gladsaxe IF',
        contactWebsite: BASE,
        occurrences,
      },
    ];
  },
};
