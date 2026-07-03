/**
 * Bagagerumsmarked Viborg (bagagerumsmarkedviborg.dk) — a single, long-running
 * car-boot market at Dyreskuepladsen, Fabrikvej, 8800 Viborg, held the FIRST
 * WEEKEND (both Saturday and Sunday) of every month from April to October.
 * Saturday 06:00–15:00, Sunday 08:00–14:00. Gratis entré.
 *
 * The site is a static marketing page with no machine-readable data, so we fetch
 * it to confirm the market still exists (if it disappears, the reconciler expires
 * it) and generate the concrete occurrences from its published rule.
 */
import type { EventCategory, Occurrence, RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://bagagerumsmarkedviborg.dk/';

/** First Saturday of month `m` (1–12) in year `y`, as ISO yyyy-mm-dd. */
function firstSaturday(y: number, m: number): string {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const add = (6 - first.getUTCDay() + 7) % 7; // days from the 1st to Saturday
  return new Date(Date.UTC(y, m - 1, 1 + add)).toISOString().slice(0, 10);
}

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** First-weekend (Sat 06–15 + Sun 08–14) occurrences for Apr–Oct of each year. */
export function bagagerumViborgOccurrences(years: number[]): Occurrence[] {
  const occ: Occurrence[] = [];
  for (const y of years) {
    for (let m = 4; m <= 10; m++) {
      const sat = firstSaturday(y, m);
      occ.push({ date: sat, startTime: '06:00', endTime: '15:00' });
      occ.push({ date: addDaysIso(sat, 1), startTime: '08:00', endTime: '14:00' });
    }
  }
  return occ;
}

export function buildBagagerumViborgRaw(years: number[]): RawEvent {
  return {
    sourceKey: 'bagagerumsmarked-viborg',
    sourceUrl: BASE,
    sourceEventId: 'bagagerumsmarked-viborg',
    title: 'Bagagerumsmarked Viborg',
    description:
      'Bagagerumsmarked på Dyreskuepladsen den første weekend i hver måned, april–oktober. Ingen pladsreservation — mød bare op. Gratis entré for besøgende.',
    category: 'bagagerumsmarked' as EventCategory,
    venueName: 'Dyreskuepladsen',
    street: 'Fabrikvej',
    postcode: '8800',
    city: 'Viborg',
    isFree: true,
    indoorOutdoor: 'outdoor',
    scheduleText: 'Første weekend i hver måned (lørdag og søndag), april til oktober',
    occurrences: bagagerumViborgOccurrences(years),
  };
}

export const bagagerumsmarkedViborg: SourceAdapter = {
  key: 'bagagerumsmarked-viborg',
  name: 'Bagagerumsmarked Viborg',
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
    // Down, or no longer this market → emit nothing so the reconciler can expire
    // it rather than us publishing a stale certainty.
    if (res.status !== 200 || !/bagagerum/i.test(res.body)) return [];
    const thisYear = new Date().getUTCFullYear();
    return [buildBagagerumViborgRaw([thisYear, thisYear + 1])];
  },
};
