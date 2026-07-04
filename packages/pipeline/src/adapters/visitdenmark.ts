/**
 * VisitDenmark tourist-bureau network — the national "Explore" platform.
 *
 * Dozens of Danish destination sites (VisitSønderjylland, VisitFyn, VisitAarhus,
 * VisitFaaborg, …) are React SPAs built on ONE shared backend: a JSON endpoint at
 * `/api/explore` fed by the national GuideDanmark product database. A plain
 * fetcher can't read the rendered pages, but the API underneath is clean and
 * open — and, crucially, the same on every site: an events listing is always
 * category 58 / subCategory 59, and every product carries coordinates + a stable
 * GuideDanmark id (the `gdk…` number in its URL).
 *
 * That's the unlock for the geographic gaps (Sønderjylland, Sydfyn, …) whose
 * local markets never reach a national calendar but DO get listed by their local
 * tourist bureau. We POST the events feed per destination, keep the ones whose
 * title reads as a market, and turn each into a canonical event:
 *   • coordinates come straight from the feed (no geocoding guesswork), and
 *   • the exact street/postcode/town is reverse-geocoded from those coordinates
 *     via DAWA — so these are first-class, regionally-filterable entries, not
 *     just map pins.
 * The GuideDanmark id is the dedup key, so a market listed by several bureaus
 * (a Fyn market on both VisitFyn and VisitOdense) collapses to one entry.
 *
 * This replaces the originally-planned self-hosted "tourism harvester": the API
 * is fetchable server-side, so it runs live in every crawl (always fresh) instead
 * of needing a manual browser step. If a site ever blocks the crawler, that one
 * domain simply yields nothing — the rest are unaffected.
 */
import { extractPostcode, type Occurrence, type RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

// The Explore feed is EVERY kind of event (concerts, sport, airshows, festivals),
// so the pipeline's broad market-signal gate over-matches here: a bare "vintage"
// (as in "Vintage Aerobatic World Championship") or "antik"/"brugt" would let a
// non-market through. On a general feed, insist on an actual market word — the
// Danish "marked" (only ever means "market") and its unambiguous cousins.
const MARKET_WORD = /loppe|marked|kr(æ|ae)mmer|bagagerum|torvedag|stadeplads|genbrugssalg/i;
// A GuideDanmark "… Program <date>" entry is a day-by-day schedule sub-page of a
// larger event (e.g. Nyborg's julemarked), not a distinct market — its near-dup
// siblings would clutter the app. Skip them.
const JUNK_TITLE = /\bprogram\b/i;
function isTourismMarket(title: string): boolean {
  return MARKET_WORD.test(title) && !JUNK_TITLE.test(title);
}

// Every Explore site uses the same category ids for its events listing.
const EVENTS_CATEGORY = 58;
const EVENTS_SUBCATEGORY = 59;
const MAX_PAGES = 60; // safety bound; the biggest sites have ~40 pages of events

// Destination sites confirmed to serve the Explore events feed. Curated for a
// national spread with the known coverage gaps first (Sønderjylland, Sydfyn).
// Adding a site is one line; a dead/blocked one is skipped gracefully at runtime.
export const EXPLORE_SITES: ReadonlyArray<{ domain: string; name: string }> = [
  { domain: 'visitsonderjylland.dk', name: 'VisitSønderjylland' },
  { domain: 'visitfaaborg.dk', name: 'VisitFaaborg' },
  { domain: 'visitsvendborg.dk', name: 'VisitSvendborg' },
  { domain: 'visitfyn.dk', name: 'VisitFyn' },
  { domain: 'visitodense.com', name: 'VisitOdense' },
  { domain: 'visitmiddelfart.dk', name: 'VisitMiddelfart' },
  { domain: 'visitaarhus.com', name: 'VisitAarhus' },
  { domain: 'visitherning.dk', name: 'VisitHerning' },
  { domain: 'visitvejle.com', name: 'VisitVejle' },
  { domain: 'destinationtrekantomraadet.dk', name: 'Destination Trekantområdet' },
  { domain: 'visitnordvestkysten.dk', name: 'VisitNordvestkysten' },
  { domain: 'visitmors.dk', name: 'VisitMors' },
  // Sjælland regions the national calendars cover thinly. (The Fyn destinations
  // on this platform — Nyborg, Kerteminde, Assens, Ærø — were verified to work
  // too, but VisitFyn already aggregates them, so by GuideDanmark-id dedup they
  // add nothing; omitted to keep the crawl lean.)
  { domain: 'visitkoege.dk', name: 'VisitKøge' },
  { domain: 'visitodsherred.dk', name: 'VisitOdsherred' },
  { domain: 'visitfjordlandet.dk', name: 'VisitFjordlandet' },
];

interface ExploreItem {
  id?: string;
  pid?: number;
  title?: string;
  path?: string;
  category?: string;
  subCategory?: string;
  location?: string; // "lat,lng"
  periodsByDate?: Array<{ startDate?: string; endDate?: string }>;
}

interface ExploreResponse {
  explore?: { total?: number; items?: ExploreItem[] };
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchEventsPage(domain: string, page: number): Promise<ExploreResponse | null> {
  try {
    const res = await fetch(`https://www.${domain}/api/explore`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': UA,
        referer: `https://www.${domain}/`,
      },
      body: JSON.stringify({
        filters: {},
        sort: 'DATE',
        page,
        category: EVENTS_CATEGORY,
        subCategory: EVENTS_SUBCATEGORY,
        traveler: null,
        startDate: null,
        endDate: null,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ExploreResponse;
  } catch {
    return null; // one site's failure never sinks the rest
  }
}

/** "55.057,9.742" -> { lat, lng }; null if absent/malformed. */
export function parseLocation(loc: string | undefined): { lat: number; lng: number } | null {
  if (!loc) return null;
  const parts = loc.split(',');
  if (parts.length < 2) return null;
  const a = Number.parseFloat((parts[0] ?? '').trim());
  const b = Number.parseFloat((parts[1] ?? '').trim());
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // Danish latitudes are ~54–58, longitudes ~8–15; the feed is "lat,lng".
  if (a < 50 || a > 60 || b < 3 || b > 20) return null;
  return { lat: a, lng: b };
}

/** period ranges -> distinct future occurrence dates (whole-day; times unknown). */
export function periodsToOccurrences(
  periods: Array<{ startDate?: string; endDate?: string }> | undefined,
  today: string,
): Occurrence[] {
  const dates = new Set<string>();
  for (const p of periods ?? []) {
    const start = (p.startDate ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
    const end = /^\d{4}-\d{2}-\d{2}$/.test((p.endDate ?? '').slice(0, 10))
      ? (p.endDate as string).slice(0, 10)
      : start;
    let day = start;
    for (let i = 0; day <= end && i < 30; i++) {
      if (day >= today) dates.add(day);
      const [y, m, d] = day.split('-').map(Number) as [number, number, number];
      day = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    }
  }
  return [...dates]
    .sort()
    .slice(0, 60)
    .map((date) => ({ date, startTime: null, endTime: null }));
}

// Reverse-geocode coordinates -> Danish address, cached per run by rounded coord.
const DAWA = 'https://api.dataforsyningen.dk';
const reverseCache = new Map<string, { street?: string; postcode?: string; city?: string }>();
let lastDawa = 0;

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<{ street?: string; postcode?: string; city?: string }> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = reverseCache.get(key);
  if (hit) return hit;
  let out: { street?: string; postcode?: string; city?: string } = {};
  try {
    const wait = lastDawa + 120 - Date.now();
    if (wait > 0) await sleep(wait);
    lastDawa = Date.now();
    const res = await fetch(`${DAWA}/adgangsadresser/reverse?x=${lng}&y=${lat}&struktur=mini`, {
      headers: { 'User-Agent': 'LoppefundBot/0.1' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const d = (await res.json()) as {
        vejnavn?: string;
        husnr?: string;
        postnr?: string;
        postnrnavn?: string;
      };
      out = {
        street: d.vejnavn ? `${d.vejnavn}${d.husnr ? ` ${d.husnr}` : ''}` : undefined,
        postcode: d.postnr || undefined,
        city: d.postnrnavn || undefined,
      };
    }
  } catch {
    // leave address blank — coordinates alone still place it on the map
  }
  reverseCache.set(key, out);
  return out;
}

/** One Explore item -> a market RawEvent, or null if it isn't a dated market. */
export async function itemToRaw(item: ExploreItem, today: string): Promise<RawEvent | null> {
  const title = item.title?.trim();
  if (!title || !isTourismMarket(title)) return null;
  const occurrences = periodsToOccurrences(item.periodsByDate, today);
  if (occurrences.length === 0) return null; // no future date -> can't place it in time

  const coords = parseLocation(item.location);
  let addr: { street?: string; postcode?: string; city?: string } = {};
  if (coords) addr = await reverseGeocode(coords.lat, coords.lng);
  // A coincidental postcode inside the town name never hurts, but prefer DAWA's.
  const postcode = addr.postcode ?? (addr.city ? extractPostcode(addr.city) ?? undefined : undefined);

  const id = item.pid ?? item.id ?? title;
  return {
    sourceKey: 'visitdenmark',
    sourceUrl: item.path ?? `https://www.visitdenmark.dk/gdk/${id}`,
    sourceEventId: `gdk-${id}`,
    title,
    // category left undefined — the canonicalizer derives it from the title.
    street: addr.street,
    postcode,
    city: addr.city,
    lat: coords?.lat,
    lng: coords?.lng,
    contactWebsite: item.path,
    occurrences,
  };
}

export const visitdenmark: SourceAdapter = {
  key: 'visitdenmark',
  name: 'Turistbureauer (VisitDenmark)',
  baseUrl: 'https://www.visitdenmark.dk',
  // Live, first-party tourist-bureau listings — structured and reliable, a touch
  // below a dedicated market calendar since the data is general-events, not
  // market-curated.
  trust: 0.6,

  async discover(): Promise<string[]> {
    return [];
  },
  extract(): RawEvent | null {
    return null;
  },

  async fetchRawEvents(_fetch: FetchFn): Promise<RawEvent[]> {
    const today = new Date().toISOString().slice(0, 10);
    // Collect market items across all sites, deduped by GuideDanmark id (the same
    // market listed by several bureaus merges its dates into one entry).
    const byId = new Map<string, ExploreItem>();
    for (const site of EXPLORE_SITES) {
      const first = await fetchEventsPage(site.domain, 0);
      if (!first?.explore) {
        console.log(`[visitdenmark] ${site.domain}: intet svar (springes over)`);
        continue;
      }
      const total = first.explore.total ?? 0;
      const per = first.explore.items?.length ?? 0;
      const pages = per > 0 ? Math.min(Math.ceil(total / per), MAX_PAGES) : 1;
      let siteMarkets = 0;
      for (let p = 0; p < pages; p++) {
        const resp = p === 0 ? first : await fetchEventsPage(site.domain, p);
        for (const item of resp?.explore?.items ?? []) {
          if (!item.title || !isTourismMarket(item.title)) continue;
          const key = String(item.pid ?? item.id ?? item.title);
          const prev = byId.get(key);
          if (prev) {
            // Merge occurrence periods across bureaus; keep the first path.
            prev.periodsByDate = [...(prev.periodsByDate ?? []), ...(item.periodsByDate ?? [])];
          } else {
            byId.set(key, { ...item });
            siteMarkets++;
          }
        }
        if (p < pages - 1) await sleep(120);
      }
      console.log(`[visitdenmark] ${site.domain}: ${total} events, ${siteMarkets} nye markeder`);
    }

    const out: RawEvent[] = [];
    for (const item of byId.values()) {
      const raw = await itemToRaw(item, today);
      if (raw) out.push(raw);
    }
    console.log(`[visitdenmark] ${out.length} markeder i alt (dateret, dedup pr. GuideDanmark-id)`);
    return out;
  },
};
