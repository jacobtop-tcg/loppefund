/**
 * Adapter for kultunaut.dk — Denmark's largest event calendar, which also
 * powers many municipal "kulturkalender" white-labels (crawling the national
 * site covers those too; dedupe key is the ArrNr).
 *
 * robots.txt allows /perl/arrlist/, /perl/arrlist2/ and /perl/arrmore/.
 * Pages are iso-8859-1; the fetcher decodes by charset sniffing.
 * Event pages include coordinates directly (.lonlat), so no geocoding needed.
 */
import { parse } from 'node-html-parser';
import {
  normalizeCategory,
  parseDanishDate,
  parseOpeningHours,
  type Occurrence,
  type RawEvent,
} from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://www.kultunaut.dk';
const GENRE = 'Loppemarked%2FTorvedag%2FGenbrug';
const PAGE_SIZE = 12;
const MAX_PAGES = 80;

const MONTH = '(?:januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)';

/**
 * Parse Kultunaut date lines like
 *   "Fre. d. 3. juli 2026, kl. 10-16."
 *   "Lør. d. 4. juli - søn. d. 5. juli 2026, kl. 10-15."
 */
export function parseKultunautDate(text: string): Occurrence[] {
  const t = text.replace(/\s+/g, ' ').trim();
  const dateRe = new RegExp(`(\\d{1,2})\\.\\s*(${MONTH})(?:\\s*(\\d{4}))?`, 'gi');
  const found: Array<{ d: string; m: string; y?: string }> = [];
  for (const m of t.matchAll(dateRe)) {
    found.push({ d: m[1]!, m: m[2]!, y: m[3] });
  }
  if (found.length === 0) return [];
  // The year usually appears only on the last date; propagate backwards.
  const year = found[found.length - 1]!.y;
  if (!year) return [];
  const dates = found
    .map((f) => parseDanishDate(`${f.d}. ${f.m} ${f.y ?? year}`))
    .filter((d): d is string => d !== null);
  if (dates.length === 0) return [];

  const hours = parseOpeningHours(t.match(/kl\.?\s*[\d.:]+\s*[-–]\s*[\d.:]+/i)?.[0] ?? '');
  const startTime = hours.generic?.start ?? null;
  const endTime = hours.generic?.end ?? null;

  const out: Occurrence[] = [];
  const start = dates[0]!;
  const end = dates[dates.length - 1]!;
  let d = start;
  for (let i = 0; d <= end && i < 40; i++) {
    out.push({ date: d, startTime, endTime });
    const [y, mo, day] = d.split('-').map(Number) as [number, number, number];
    d = new Date(Date.UTC(y, mo - 1, day + 1)).toISOString().slice(0, 10);
  }
  return out;
}

/**
 * Kultunaut's genre facet is venue-selected and unreliable — yoga classes
 * show up under "Loppemarked/Torvedag/Genbrug". Require positive market
 * evidence in the event's own text before accepting it.
 */
const MARKET_SIGNAL =
  /loppe|marked|kr(æ|ae)mmer|genbrug|bagagerum|antik|vintage|brugt|stadeplads|byttemarked|torvedag|second ?hand|kirppu/i;

export function looksLikeMarket(title: string, description?: string): boolean {
  return MARKET_SIGNAL.test(`${title} ${description ?? ''}`);
}

export const kultunaut: SourceAdapter = {
  key: 'kultunaut',
  name: 'Kultunaut',
  baseUrl: BASE,
  trust: 0.65,

  async discover(fetch: FetchFn): Promise<string[]> {
    const arrNrs = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const url =
        page === 0
          ? `${BASE}/perl/arrlist/type-nynaut?Genre=${GENRE}&Area=`
          : `${BASE}/perl/arrlist2/type-nynaut?startnr=${page * PAGE_SIZE + 1}&Genre=${GENRE}&Area=`;
      const res = await fetch(url);
      if (res.status !== 200) break;
      const before = arrNrs.size;
      for (const m of res.body.matchAll(/data-arrnr="(\d+)"/g)) {
        arrNrs.add(m[1]!);
      }
      if (arrNrs.size === before) break; // empty page -> end of list
    }
    return [...arrNrs].map((nr) => `${BASE}/perl/arrmore/type-nynaut?ArrNr=${nr}`);
  },

  extract(url: string, html: string): RawEvent | null {
    const root = parse(html);
    const title = root.querySelector('h2.beta')?.text.trim();
    if (!title) return null;

    const genre = root.querySelector('h4.genre')?.text.trim();
    const place = root.querySelector('.event-place');
    const venueName = place?.querySelector('a')?.text.trim();
    // Address text like "Torvet, Gråsten" or "Storegade 12, 6300 Gråsten"
    const addressLines =
      place
        ?.querySelector('p')
        ?.structuredText.split(/\n|,/)
        .map((l) => l.trim())
        .filter(Boolean) ?? [];
    const street = addressLines[0];
    let city = addressLines.length > 1 ? addressLines[addressLines.length - 1] : undefined;
    let postcode: string | undefined;
    if (city) {
      const pc = city.match(/^([1-9]\d{3})\s+(.*)$/);
      if (pc) {
        postcode = pc[1];
        city = pc[2] || undefined;
      }
    }

    const dateText = root.querySelector('.event-date p')?.text ?? '';
    const occurrences = parseKultunautDate(dateText);

    const lonlatText = root.querySelector('.lonlat')?.innerHTML ?? '';
    const latMatch = lonlatText.match(/Lat:\s*([\d.]+)/);
    const lngMatch = lonlatText.match(/Lon:\s*([\d.]+)/);

    const description = root
      .querySelector('article.event-description')
      ?.structuredText.replace(/\n{3,}/g, '\n\n')
      .trim();

    // Price appears inside the description text, e.g. "Fri entré" / "Entré: 20 kr."
    let priceText: string | undefined;
    const priceMatch = description?.match(/(fri entré|gratis adgang|entré:?\s*[\w\d,.-]{1,20} ?kr\.?)/i);
    if (priceMatch) priceText = priceMatch[1];

    const externalLink = root
      .querySelector('a.whitebutton')
      ?.getAttribute('href');

    const arrNr = url.match(/ArrNr=(\d+)/)?.[1] ?? url;
    const cancelled = /aflyst/i.test(title) || undefined;

    if (!looksLikeMarket(title, description)) return null;

    // The genre is a catch-all ("Loppemarked/Torvedag/Genbrug"); the title
    // is more specific, so let it decide first. When the title says nothing
    // and the genre is the catch-all, stay honest with 'andet' rather than
    // picking an arbitrary sub-category.
    let category = normalizeCategory(title);
    if (category === 'andet' && genre && !/\//.test(genre)) {
      category = normalizeCategory(genre);
    }

    return {
      sourceKey: 'kultunaut',
      sourceUrl: url,
      sourceEventId: arrNr,
      title: title.replace(/\s*[-–]?\s*aflyst\s*!?\s*$/i, '').trim(),
      description: description || undefined,
      category,
      venueName,
      street,
      postcode,
      city,
      lat: latMatch ? Number(latMatch[1]) : undefined,
      lng: lngMatch ? Number(lngMatch[1]) : undefined,
      priceText,
      isFree: priceText ? /fri|gratis/i.test(priceText) : undefined,
      contactWebsite: externalLink ?? undefined,
      occurrences: occurrences.length > 0 ? occurrences : undefined,
      cancelled,
    };
  },
};
