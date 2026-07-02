/**
 * Turn a pasted announcement (typically a Facebook-group post) into a draft
 * RawEvent. Facebook posts are informal: dates often lack years ("Lørdag d.
 * 11/7 kl. 10-15"), addresses are inline, titles are the first line.
 *
 * Tips enter the canonical layer at LOW trust — they render as "ubekræftet"
 * until a human confirms or another source corroborates them. That keeps the
 * community funnel open without compromising the trust promise.
 */
import {
  extractPostcode,
  normalizeCategory,
  parseDanishDate,
  parseOpeningHours,
  type Occurrence,
  type RawEvent,
} from '@loppefund/core';

const MONTH = '(?:januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)';

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Find Danish date expressions in free text, resolving missing years to the
 * next occurrence on/after `refDate`: "11/7" or "11. juli" in June 2026 is
 * 2026-07-11; the same text in August resolves to 2027.
 */
export function scanDates(text: string, refDate: string): string[] {
  const [refY] = refDate.split('-').map(Number) as [number];
  const found = new Set<string>();

  // Full dates first — delegate to the strict core parser.
  for (const m of text.matchAll(
    new RegExp(`\\d{1,2}[./-]\\d{1,2}[./ -]\\d{4}|\\d{1,2}\\.?\\s+${MONTH}\\s+\\d{4}`, 'gi'),
  )) {
    const parsed = parseDanishDate(m[0]);
    if (parsed) found.add(parsed);
  }

  // Year-less forms: "11/7", "d. 11. juli", "11. juli"
  const MONTHS: Record<string, number> = {
    januar: 1, februar: 2, marts: 3, april: 4, maj: 5, juni: 6,
    juli: 7, august: 8, september: 9, oktober: 10, november: 11, december: 12,
  };
  const yearless: Array<{ d: number; mo: number }> = [];
  for (const m of text.matchAll(new RegExp(`(\\d{1,2})\\.?\\s+(${MONTH})(?!\\s+\\d{4})`, 'gi'))) {
    yearless.push({ d: Number(m[1]), mo: MONTHS[m[2]!.toLowerCase()]! });
  }
  for (const m of text.matchAll(/(?<![\d./-])(\d{1,2})\/(\d{1,2})(?![\d./-])/g)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) yearless.push({ d, mo });
  }
  for (const { d, mo } of yearless) {
    const thisYear = iso(refY, mo, d);
    found.add(thisYear >= refDate ? thisYear : iso(refY + 1, mo, d));
  }

  return [...found].sort();
}

/** Street + house number, e.g. "Byvej 12", "Søndre Alle 3B". */
const STREET_RE =
  /([A-ZÆØÅ][a-zæøåé.]+(?:\s+[A-ZÆØÅa-zæøåé.]+){0,3}\s+\d{1,3}[a-zA-Z]?)(?=[\s,.]|$)/;

export function parseTip(
  tip: { id: number; url: string | null; text: string | null },
  refDate: string,
): RawEvent | null {
  const text = tip.text?.trim() ?? '';
  if (!text && !tip.url) return null;
  if (!text) return null; // URL-only tips need a human (or a fetcher) first.

  const dates = scanDates(text, refDate);
  if (dates.length === 0) return null; // no date -> not yet an event

  const hours = parseOpeningHours(text.match(/kl\.?\s*[\d.:]+\s*[-–]\s*[\d.:]+/i)?.[0] ?? '');
  const occurrences: Occurrence[] = dates.map((date) => ({
    date,
    startTime: hours.generic?.start ?? null,
    endTime: hours.generic?.end ?? null,
  }));

  // Title: first non-empty line, de-shouted, sensibly truncated.
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) ?? 'Loppemarked';
  const title = firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;

  const postcode = extractPostcode(text) ?? undefined;
  const street = text.match(STREET_RE)?.[1];
  let city: string | undefined;
  if (postcode) {
    const cityMatch = text.match(
      new RegExp(`${postcode}\\s+([A-ZÆØÅ][a-zæøåé]+(?:\\s+[A-ZÆØÅ][a-zæøåé]+)?)`),
    );
    city = cityMatch?.[1];
  }

  return {
    sourceKey: 'tip',
    sourceUrl: tip.url || `tip:${tip.id}`,
    sourceEventId: `tip-${tip.id}`,
    title,
    description: text.length > title.length ? text : undefined,
    category: normalizeCategory(text),
    street,
    postcode,
    city,
    occurrences,
  };
}
