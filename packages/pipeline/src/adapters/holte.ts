/**
 * Holte Loppemarked (holte-loppemarked.dk) — one recurring outdoor Sunday
 * market with a season and a stated skip date, e.g. "Søndage fra 12. april til
 * 11. oktober (dog ikke d. 16. august)".
 *
 * Like the Gentofte adapter, the "every Sunday in season" rule is expanded into
 * CONCRETE occurrences in the adapter (the schedule resolver would otherwise
 * fill every day of a date range), and any parenthetical "dog ikke …" skip
 * dates are removed — so the calendar shows exactly the Sundays the market is
 * actually open, never a guessed one. The season/weekday/skip are re-read every
 * crawl, so next year's dates flow through without a code change.
 */
import { normalizeCategory, type RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';
import { seasonOccurrences } from './gentofte.ts';

const BASE = 'https://holte-loppemarked.dk/';
const KEY = 'holte';

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, marts: 3, april: 4, maj: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  mandag: 1, tirsdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lørdag: 6, søndag: 7,
};

function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&aring;/gi, 'å').replace(/&oslash;/gi, 'ø').replace(/&aelig;/gi, 'æ')
    .replace(/&#229;/g, 'å').replace(/&#248;/g, 'ø').replace(/&#230;/g, 'æ')
    .replace(/&nbsp;?/gi, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const mmdd = (day: number, month: number): string =>
  `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Parse Holte's season sentence into the single recurring market, or null. */
export function parseHolte(html: string, today: string): RawEvent | null {
  const txt = toText(html);
  // "<Weekday>e fra <D>. <month> til <D>. <month>"
  const m = txt.match(
    /(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)e?\s+fra\s+(\d{1,2})\.?\s+([a-zæøå]+)\s+til\s+(\d{1,2})\.?\s+([a-zæøå]+)/i,
  );
  if (!m) return null;
  const weekday = WEEKDAYS[m[1]!.toLowerCase()];
  const startDay = Number(m[2]);
  const startMonth = MONTHS[m[3]!.toLowerCase()];
  const endDay = Number(m[4]);
  const endMonth = MONTHS[m[5]!.toLowerCase()];
  if (!weekday || !startMonth || !endMonth) return null;

  // Skip dates from a parenthetical "(dog ikke d. 16. august …)".
  const skip = new Set<string>();
  const paren = txt.match(/\(([^)]*ikke[^)]*)\)/i)?.[1] ?? '';
  for (const s of paren.matchAll(/(\d{1,2})\.?\s+([a-zæøå]+)/gi)) {
    const mo = MONTHS[s[2]!.toLowerCase()];
    if (mo) skip.add(mmdd(Number(s[1]), mo));
  }

  const hrs = txt.match(/kl\.?\s*(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/i);
  const startTime = hrs ? `${hrs[1]!.padStart(2, '0')}:${hrs[2]}` : null;
  const endTime = hrs ? `${hrs[3]!.padStart(2, '0')}:${hrs[4]}` : null;

  const occurrences = seasonOccurrences({
    weekday, startMonth, startDay, endMonth, endDay, startTime, endTime, today,
  }).filter((o) => !skip.has(o.date.slice(5)));
  if (occurrences.length === 0) return null;

  const phone = txt
    .match(/tlf\.?:?\s*(\+?45[\s]?\d{2}[\s]?\d{2}[\s]?\d{2}[\s]?\d{2})/i)?.[1]
    ?.replace(/\s+/g, ' ')
    .trim();

  return {
    sourceKey: KEY,
    sourceUrl: BASE,
    sourceEventId: 'holte-loppemarked',
    title: 'Holte Loppemarked',
    description: 'Tilbagevendende udendørs søndagsloppemarked i Holte gennem sæsonen.',
    category: normalizeCategory('loppemarked'),
    city: 'Holte',
    indoorOutdoor: 'outdoor',
    contactWebsite: BASE,
    contactPhone: phone,
    scheduleText: m[0],
    occurrences,
  };
}

export const holte: SourceAdapter = {
  key: KEY,
  name: 'Holte Loppemarked',
  baseUrl: BASE,
  trust: 0.7, // the market's own site — authoritative for its own dates

  async discover(): Promise<string[]> {
    return [];
  },
  extract(): RawEvent | null {
    return null;
  },
  async fetchRawEvents(fetch: FetchFn): Promise<RawEvent[]> {
    const res = await fetch(BASE);
    if (res.status !== 200) return [];
    const raw = parseHolte(res.body, new Date().toISOString().slice(0, 10));
    return raw ? [raw] : [];
  },
};
