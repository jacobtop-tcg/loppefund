/**
 * Rask Event / Bagagerumsmarkeder (bagagerumsmarkeder.dk) — a bagagerums-market
 * operator running seasonal markets in 9 cities (Aalborg, Aarhus, Ebeltoft,
 * Esbjerg, Herning, Holstebro, Randers, Silkeborg, Søndervig). Each city has its
 * own page listing that season's market dates (all same opening hours) and venue.
 *
 * The date list is plain text ("10. maj 14. juni 12. juli 9. august 13. september")
 * with no year on the market dates — while a stray "Download kalender (10. april
 * 2026)" DOES carry a year, so excluding year-suffixed dates cleanly drops it. Year
 * is taken from the page ("Markeder i 2026" / the calendar link).
 */
import { normalizeCategory, type Occurrence, type RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://bagagerumsmarkeder.dk/';
const CITY_SLUGS = [
  'aalborg', 'aarhus', 'ebeltoft', 'esbjerg', 'herning',
  'holstebro', 'randers', 'silkeborg', 'soendervig',
];

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, marts: 3, april: 4, maj: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, december: 12,
};

function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract a Rask Event city market: date list (no-year only), hours, venue. */
export function parseRaskEventCity(html: string, cityLabel: string): RawEvent | null {
  const txt = toText(html);
  const year = Number(
    (txt.match(/Markeder\s+i\s+(20\d{2})/i) || txt.match(/kalender[^)]*?(20\d{2})/i) || [])[1] ??
      0,
  );
  if (!year) return null;

  // Market dates are "D. month" WITHOUT a trailing year; the calendar-download
  // stray ("10. april 2026") has one, so the negative lookahead drops it.
  const dates = new Set<string>();
  for (const m of txt.matchAll(
    /(\d{1,2})\.\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\b(?!\s*\d{4})/gi,
  )) {
    const mo = MONTHS[m[2]!.toLowerCase()]!;
    dates.add(`${year}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`);
  }
  if (dates.size === 0) return null;

  const hrs = txt.match(/kl\.?\s*(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/i);
  const startTime = hrs ? `${hrs[1]!.padStart(2, '0')}:${hrs[2]}` : null;
  const endTime = hrs ? `${hrs[3]!.padStart(2, '0')}:${hrs[4]}` : null;
  const occurrences: Occurrence[] = [...dates].sort().map((date) => ({ date, startTime, endTime }));

  // Venue: "<Street> <no> … DK-<postcode> <City>" — postcode + city are reliable;
  // street/venue best-effort. Falls back to the city label alone.
  const addr = txt.match(/([A-ZÆØÅ][A-Za-zæøåÆØÅ.\s]*?\d+[A-Za-z]?)[,\s]+[A-Za-zæøåÆØÅ.\s-]*?DK[-\s]?(\d{4})\s+([A-ZÆØÅ][A-Za-zæøåÆØÅ\s]+?)(?:\s{2}|$|KØRSEL|Book)/);
  const street = addr?.[1]?.replace(/\s+/g, ' ').trim();
  const postcode = addr?.[2];
  const city = addr?.[3]?.trim() || cityLabel;

  return {
    sourceKey: 'raskevent',
    sourceUrl: `${BASE}${CITY_SLUGS.find((s) => cityLabel.toLowerCase().startsWith(s.slice(0, 4))) ?? ''}/`,
    sourceEventId: `raskevent-${cityLabel.toLowerCase()}`,
    title: `Bagagerumsmarked ${cityLabel}`,
    description: 'Bagagerumsmarked (Rask Event) — hygge og handel. Sælg fra bagagerummet eller gør et fund.',
    category: normalizeCategory('bagagerumsmarked'),
    venueName: street ? undefined : cityLabel,
    street,
    postcode,
    city,
    indoorOutdoor: 'outdoor',
    contactWebsite: BASE,
    occurrences,
  };
}

const LABEL: Record<string, string> = {
  aalborg: 'Aalborg', aarhus: 'Aarhus', ebeltoft: 'Ebeltoft', esbjerg: 'Esbjerg',
  herning: 'Herning', holstebro: 'Holstebro', randers: 'Randers', silkeborg: 'Silkeborg',
  soendervig: 'Søndervig',
};

export const raskevent: SourceAdapter = {
  key: 'raskevent',
  name: 'Bagagerumsmarkeder (Rask Event)',
  baseUrl: BASE,
  trust: 0.7,

  async discover(): Promise<string[]> {
    return CITY_SLUGS.map((s) => `${BASE}${s}/`);
  },
  extract(url: string, html: string): RawEvent | null {
    const slug = url.replace(/\/$/, '').split('/').pop() ?? '';
    return parseRaskEventCity(html, LABEL[slug] ?? slug);
  },
};
