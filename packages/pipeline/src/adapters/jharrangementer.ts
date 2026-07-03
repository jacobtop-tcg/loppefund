/**
 * Adapter for jharrangementer.dk — J.H. Arrangementer, an organizer that runs
 * large indoor kræmmer- & loppemarkeder at named arenas/halls across Denmark
 * (Køge Hallerne, Forum København, Odense/Aarhus Congress Center, Gigantium…).
 * These marquee venue markets are absent from the national calendars we already
 * crawl, so this is genuinely net-new coverage rather than duplicates.
 *
 * The site is a server-rendered Group Online page-builder (robots.txt allows
 * /for-besoegende/). Two pages hold the data between them:
 *   - /markedskalender.aspx  — a grid of (market name, weekend date) pairs, but
 *     no addresses. Each grid row's name cell links to the market's own city
 *     page as its FIRST anchor (later anchors are navigation noise).
 *   - /for-besoegende/<city>.aspx — the venue address (postcode + city), but no
 *     dates. Joined to the calendar by that first link.
 *
 * We deliberately extract only postcode + city, never a street: the address
 * blocks run the venue name straight into the street with no delimiter, and a
 * venue-polluted string makes DAWA return an uncertain (and sometimes wrong)
 * match. Postcode alone geocodes to the town centre — approximate but never
 * wrong. Occurrence times are left null (the pages list Sat/Sun hours only as
 * prose); we never guess times.
 */
import { parse, type HTMLElement } from 'node-html-parser';
import { normalizeCategory, type Occurrence, type RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://jharrangementer.dk';

/** A single market weekend read off the calendar grid. */
export interface JhEntry {
  title: string;
  venue: string;
  /** slug of the market's own /for-besoegende/<slug>.aspx page, if linked. */
  citySlug: string | null;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

/** "10/10-11/10-2026" -> { start: "2026-10-10", end: "2026-10-11" } */
const DATE_RANGE = /(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})-(\d{4})/;

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const clean = (s: string) =>
  s.replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim();

function daySpan(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
}

/** The enclosing grid row (`div.row`) of an element, walking up the tree. */
function closestRow(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node && !(node.classList && node.classList.contains('row'))) {
    node = node.parentNode as HTMLElement | null;
  }
  return node;
}

/**
 * Parse the calendar grid into dated market entries. Each date lives in a
 * `<strong>` in one grid column; the market name is the sibling column that
 * carries market wording. A weekend spanning more than a few days is a source
 * data-entry error and is dropped rather than expanded into wrong occurrences.
 */
export function parseCalendar(html: string): JhEntry[] {
  const root = parse(html);
  const out: JhEntry[] = [];
  const seen = new Set<string>();
  for (const strong of root.querySelectorAll('strong')) {
    const dm = DATE_RANGE.exec(strong.text);
    if (!dm) continue;
    const row = closestRow(strong);
    if (!row) continue;

    // Name cell = the column in this row that carries market wording and is not
    // the date column itself.
    let nameCell: HTMLElement | null = null;
    for (const col of row.querySelectorAll('.column')) {
      if (DATE_RANGE.test(col.text)) continue;
      if (/kr(æ|ae)mmer|loppe|marked/i.test(col.text)) {
        nameCell = col;
        break;
      }
    }
    if (!nameCell) continue;

    const title = clean(nameCell.text)
      // Some names trail a holiday label ("… Forum København Skærtorsdag -Langfredag").
      .replace(/\s*(sk(æ|ae)r?s?torsdag|langfredag).*$/i, '')
      .trim();
    const venue = clean((title.split(/\s+i\s+/).pop() ?? '').trim());

    const citySlug =
      nameCell
        .querySelectorAll('a')
        .map((a) => /\/for-besoegende\/([a-z0-9-]+)\.aspx/i.exec(a.getAttribute('href') ?? ''))
        .find((m): m is RegExpExecArray => m !== null)?.[1] ?? null;

    const [, d1, m1, d2, m2, y] = dm.map(Number) as [number, number, number, number, number, number];
    const start = iso(y, m1, d1);
    const end = iso(y, m2, d2);
    const span = daySpan(start, end);
    if (span < 0 || span > 6) continue; // corrupt range — skip, don't fabricate days

    const key = `${citySlug ?? venue}-${start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, venue, citySlug, start, end });
  }
  return out;
}

/**
 * Read the venue postcode + city off a /for-besoegende/<city>.aspx page.
 * Skips year-like tokens (20xx) and the "2630 Taastrup" office address that
 * appears in every page's footer.
 */
export function parseCityAddress(html: string): {
  postcode: string | null;
  city: string | null;
} {
  const text = clean(parse(html).text);
  // A postcode, then a city name plus an optional postal-district suffix. The
  // suffix uses a lookahead, not \b: JS word boundaries misfire on Danish
  // letters (e.g. "SØ" would truncate to "S" because Ø is not a \w char).
  const re =
    /\b([1-9]\d{3})\s+([A-ZÆØÅ][a-zæøå]+(?:\s(?:SØ|SV|NØ|NV|Øst|Vest|Nord|Syd|Falster|[CKMNSVØ])(?=\s|$))?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const postcode = m[1]!;
    if (postcode.startsWith('20')) continue; // year misread as a postcode
    if (postcode === '2630') continue; // JH office footer (Taastrup)
    return { postcode, city: clean(m[2]!) };
  }
  return { postcode: null, city: null };
}

/** Per-day occurrences across the weekend; times deliberately null. */
function toOccurrences(start: string, end: string): Occurrence[] {
  const out: Occurrence[] = [];
  let d = start;
  for (let i = 0; d <= end && i < 10; i++) {
    out.push({ date: d, startTime: null, endTime: null });
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    d = new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10);
  }
  return out;
}

export function jhEntryToRaw(
  entry: JhEntry,
  addr: { postcode?: string | null; city?: string | null } | null,
): RawEvent {
  const cityUrl = entry.citySlug
    ? `${BASE}/for-besoegende/${entry.citySlug}.aspx`
    : `${BASE}/markedskalender.aspx`;
  return {
    sourceKey: 'jharrangementer',
    sourceUrl: cityUrl,
    sourceEventId: `${entry.citySlug ?? 'marked'}-${entry.start}`,
    title: entry.title,
    category: normalizeCategory(entry.title),
    venueName: entry.venue || undefined,
    postcode: addr?.postcode ?? undefined,
    city: addr?.city ?? undefined,
    contactWebsite: entry.citySlug ? cityUrl : undefined,
    occurrences: toOccurrences(entry.start, entry.end),
  };
}

export const jharrangementer: SourceAdapter = {
  key: 'jharrangementer',
  name: 'J.H. Arrangementer',
  baseUrl: BASE,
  trust: 0.55,

  async discover(): Promise<string[]> {
    return []; // two-page API-shaped source; see fetchRawEvents
  },

  extract(): RawEvent | null {
    return null;
  },

  async fetchRawEvents(fetch: FetchFn): Promise<RawEvent[]> {
    const cal = await fetch(`${BASE}/markedskalender.aspx`);
    if (cal.status !== 200) return [];
    const entries = parseCalendar(cal.body);

    // Fetch each referenced city page once for its address.
    const addrBySlug = new Map<string, { postcode: string | null; city: string | null }>();
    for (const slug of new Set(entries.map((e) => e.citySlug).filter((s): s is string => !!s))) {
      const res = await fetch(`${BASE}/for-besoegende/${slug}.aspx`);
      addrBySlug.set(slug, res.status === 200 ? parseCityAddress(res.body) : { postcode: null, city: null });
    }

    return entries.map((e) =>
      jhEntryToRaw(e, e.citySlug ? (addrBySlug.get(e.citySlug) ?? null) : null),
    );
  },
};
