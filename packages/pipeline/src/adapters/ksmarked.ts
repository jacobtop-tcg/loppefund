/**
 * KS Marked & Event ApS (ksmarked.dk) — an operator running big INDOOR
 * loppe-/kræmmermarkeder in ~10 Danish towns (Rønde, Haderslev, Svendborg,
 * Aars, Sønderborg, Fredericia, Herning, Viborg, Grindsted), each a weekend at
 * an idrætscenter/arena.
 *
 * All the dated data lives on the homepage in two shapes:
 *  1. DETAILED cards for the nearest markets — town, a "D month, YYYY -
 *     D month, YYYY" weekend range, venue name, and a street address.
 *  2. A MARKEDSKALENDER list of every market as a bare (town, "D month, YYYY")
 *     pair — the complete spine, but no venue/address.
 * We parse both: the detailed cards give exact venue+address for the featured
 * few; the calendar supplies the rest at town-centroid precision (approximate
 * but never wrong — the market IS in that town). A market with no concrete date
 * is simply absent; missing is acceptable, a guessed date is not.
 */
import { normalizeCategory, parseDanishDate, type Occurrence, type RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://ksmarked.dk/';
const KEY = 'ksmarked';

// "3 oktober, 2026" — Danish month name, comma before the year (parseDanishDate
// wants a space, so the comma is normalised away before parsing).
const DATE_LINE =
  /^\d{1,2}\.?\s+(?:januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december),?\s*\d{4}$/i;

// Layout labels and nav that sit between/around the market data — never a town.
const NON_TOWN = new Set([
  '-', 'For besøgende', 'For udstillere', 'Bliv udstiller', 'Book stand', 'Læs mere',
  'Markedskalender', 'Forrige', 'Næste', 'Nyhedsbrev', 'Om os', 'Kontakt', 'Velkommen til',
]);

function toLines(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

const asIso = (line: string): string | null => parseDanishDate(line.replace(',', ' '));

/** A plausible town heading: has a letter, isn't a date, isn't a layout label. */
function isTown(line: string | undefined): line is string {
  return (
    !!line && !DATE_LINE.test(line) && !NON_TOWN.has(line) && /[A-Za-zÆØÅæøå]/.test(line) &&
    line.length <= 40
  );
}

/** Town shown as "Svendborg 2026"/"Svendborg 2027" — drop the disambiguating year. */
const cleanTown = (town: string): string => town.replace(/\s+20\d{2}\s*$/, '').trim();

interface Market {
  town: string;
  start: string;
  end?: string;
  venue?: string;
  street?: string;
  postcode?: string;
}

/** Split a detailed card's address line into street + optional postcode. */
function parseAddr(line: string | undefined): { street?: string; postcode?: string } {
  if (!line || DATE_LINE.test(line) || NON_TOWN.has(line)) return {};
  const m = line.match(/^(.+?),?\s*(\d{4})\s+[A-ZÆØÅ]/);
  if (m) return { street: m[1]!.trim(), postcode: m[2] };
  // No postcode inline (e.g. "Stadionvej 5") — keep it only if it looks like a
  // street (has a number), else drop rather than store a stray label.
  return /\d/.test(line) ? { street: line } : {};
}

export function parseKsMarked(html: string): RawEvent[] {
  const lines = toLines(html);
  const markets = new Map<string, Market>(); // key: cleanTown|startIso

  for (let i = 0; i < lines.length; i++) {
    if (!isTown(lines[i])) continue;
    const town = lines[i]!;
    if (!DATE_LINE.test(lines[i + 1] ?? '')) continue;
    const start = asIso(lines[i + 1]!);
    if (!start) continue;

    // Detailed card: town, start, "-", end, venue, address.
    if (lines[i + 2] === '-' && DATE_LINE.test(lines[i + 3] ?? '')) {
      const end = asIso(lines[i + 3]!) ?? undefined;
      const venue = isTown(lines[i + 4]) ? lines[i + 4] : undefined;
      const { street, postcode } = parseAddr(lines[i + 5]);
      markets.set(`${cleanTown(town)}|${start}`, { town, start, end, venue, street, postcode });
    } else {
      // Calendar pair: town, start (no venue/address). Never downgrade a market
      // we already captured from its richer detailed card.
      const key = `${cleanTown(town)}|${start}`;
      if (!markets.has(key)) markets.set(key, { town, start });
    }
  }

  const out: RawEvent[] = [];
  for (const m of markets.values()) {
    const city = cleanTown(m.town);
    const occurrences: Occurrence[] = [];
    // Weekend range → each day; single date → just that day. Capped defensively.
    let d = m.start;
    const last = m.end && m.end >= m.start ? m.end : m.start;
    for (let n = 0; d <= last && n < 4; n++) {
      occurrences.push({ date: d, startTime: null, endTime: null });
      const [y, mo, day] = d.split('-').map(Number) as [number, number, number];
      d = new Date(Date.UTC(y, mo - 1, day + 1)).toISOString().slice(0, 10);
    }
    out.push({
      sourceKey: KEY,
      sourceUrl: BASE,
      sourceEventId: `${KEY}-${city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${m.start}`,
      title: `Loppemarked ${city}`,
      description: 'Stort indendørs loppe- og kræmmermarked (KS Marked & Event).',
      category: normalizeCategory('loppemarked'),
      venueName: m.venue,
      street: m.street,
      postcode: m.postcode,
      city,
      indoorOutdoor: 'indoor',
      contactWebsite: BASE,
      occurrences,
    });
  }
  return out;
}

export const ksmarked: SourceAdapter = {
  key: KEY,
  name: 'KS Marked & Event',
  baseUrl: BASE,
  trust: 0.7, // an operator's own market list — authoritative for its own markets

  async discover(): Promise<string[]> {
    return []; // homepage-list source; see fetchRawEvents
  },
  extract(): RawEvent | null {
    return null;
  },
  async fetchRawEvents(fetch: FetchFn): Promise<RawEvent[]> {
    const res = await fetch(BASE);
    if (res.status !== 200) return [];
    return parseKsMarked(res.body);
  },
};
