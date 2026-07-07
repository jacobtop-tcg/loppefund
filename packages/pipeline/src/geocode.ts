/**
 * Geocoding via DAWA (Danmarks Adresser Web API, api.dataforsyningen.dk).
 * Free, official, and returns match quality: kategori A (exact),
 * B (safe match), C (uncertain). We only accept A and B.
 * Results are cached in SQLite indefinitely — addresses don't move.
 */
import type { DatabaseSync } from 'node:sqlite';
import { cacheGeocode, getCachedGeocode, type GeocodeResult } from '@loppefund/db';

const DAWA = 'https://api.dataforsyningen.dk';

let lastCall = 0;
async function politeDawaFetch(url: string): Promise<unknown> {
  const wait = lastCall + 150 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch(url, {
    headers: { 'User-Agent': 'LoppefundBot/0.1' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`DAWA ${res.status}`);
  return res.json();
}

const NO_MATCH: GeocodeResult = {
  lat: null, lng: null, quality: null, resolvedCity: null, resolvedPostcode: null,
};

// Denmark's land bounding box, with a small margin. Westernmost land is
// Blåvandshuk (~8.07°E), east is Christiansø (~15.19°E), north Skagen (~57.75°N),
// south Gedser (~54.55°N). Anything outside this is NOT a real Danish address —
// used to reject geocodes that land in the sea. DAWA's postcode "visueltcenter"
// is the visual centre of the postcode POLYGON, and for a coastal postcode with
// a large offshore area (e.g. 6857 Blåvand, whose polygon spans 5.7–8.3°E) that
// centre falls in the WATER, ~90 km from the town — a wrong pin. The guard turns
// such a result into a correct one (address-mean fallback) or a missing one,
// never a wrong one, per the iron rule "incorrect is worse than missing".
export const DK_LAND = { minLng: 7.8, maxLng: 15.3, minLat: 54.4, maxLat: 57.9 };
export function inDenmark(lat: number, lng: number): boolean {
  return lat >= DK_LAND.minLat && lat <= DK_LAND.maxLat && lng >= DK_LAND.minLng && lng <= DK_LAND.maxLng;
}

// Mean coordinate of real access addresses in a postcode — always on the
// populated land where people live, so it's a sound centroid even when the
// polygon's visual centre is offshore. Sampled (per_side) to keep it light.
async function postcodeAddressCentroid(postcode: string): Promise<[number, number] | null> {
  const addrs = (await politeDawaFetch(
    `${DAWA}/adgangsadresser?postnr=${encodeURIComponent(postcode)}&struktur=mini&per_side=100`,
  )) as Array<{ x?: number; y?: number }>;
  const pts = addrs.filter((a) => typeof a.x === 'number' && typeof a.y === 'number');
  if (pts.length === 0) return null;
  const lng = pts.reduce((s, a) => s + a.x!, 0) / pts.length;
  const lat = pts.reduce((s, a) => s + a.y!, 0) / pts.length;
  return [lng, lat];
}

// Resolve a postcode "visual centre" to a trustworthy point: use it when it's on
// Danish land, else fall back to the address mean, else give up (missing > sea).
async function landCentroid(
  postcode: string,
  visueltcenter: [number, number] | undefined,
): Promise<[number, number] | null> {
  if (visueltcenter && inDenmark(visueltcenter[1], visueltcenter[0])) return visueltcenter;
  const mean = await postcodeAddressCentroid(postcode);
  if (mean && inDenmark(mean[1], mean[0])) return mean;
  return null;
}

// The Danish address register (DAWA) only matches Danish. Sources sometimes
// anglicize places ("Copenhagen"), which fails datavask AND the city-centroid
// fallback — normalize the common exonyms to their Danish forms first.
const EXONYMS: Array<[RegExp, string]> = [
  [/\bcopenhagen\b/gi, 'København'],
  [/\belsinore\b/gi, 'Helsingør'],
  [/\bfunen\b/gi, 'Fyn'],
  [/\bjutland\b/gi, 'Jylland'],
  [/\bzealand\b/gi, 'Sjælland'],
  [/\baarhus\b/gi, 'Aarhus'],
];
function daNormalize(s?: string): string | undefined {
  if (!s) return s;
  let out = s;
  for (const [re, da] of EXONYMS) out = out.replace(re, da);
  return out;
}

export async function geocode(
  db: DatabaseSync,
  address: { street?: string; postcode?: string; city?: string },
): Promise<GeocodeResult> {
  const street = daNormalize(address.street);
  const city = daNormalize(address.city);
  const query = [street, address.postcode, city].filter(Boolean).join(', ');
  if (query.length < 4) return NO_MATCH;

  const cached = getCachedGeocode(db, query);
  // Only POSITIVE geocodes are trustworthy to cache. The geocoder keeps gaining
  // ways to resolve an address (postcode + city centroids, English-exonym
  // normalisation), so a past miss is usually just stale — e.g. a Facebook post
  // that only says "Faaborg" resolves to the 5600 centroid now, but an old null
  // entry would pin it nowhere forever, splitting the market off the map. So a
  // null cache hit is treated as a miss and re-geocoded. The cost is bounded:
  // truly hopeless queries (no resolvable token) exit above via the length guard
  // before any network call, so only plausible addresses re-hit DAWA.
  // A cached hit is reused — UNLESS it lands outside Denmark (an old poisoned
  // entry from the pre-guard sea-centroid bug); those re-geocode so they heal.
  if (cached && cached.lat !== null && inDenmark(cached.lat, cached.lng!)) return cached;

  let result = NO_MATCH;
  try {
    if (street) {
      const wash = (await politeDawaFetch(
        `${DAWA}/datavask/adgangsadresser?betegnelse=${encodeURIComponent(query)}`,
      )) as {
        kategori: 'A' | 'B' | 'C';
        resultater: Array<{ aktueladresse: { href: string; postnr: string; postnrnavn: string } }>;
      };
      const hit = wash.resultater[0];
      if ((wash.kategori === 'A' || wash.kategori === 'B') && hit) {
        const detail = (await politeDawaFetch(
          `${hit.aktueladresse.href}?struktur=mini`,
        )) as { x: number; y: number; postnr: string; postnrnavn: string };
        result = {
          lat: detail.y,
          lng: detail.x,
          quality: wash.kategori,
          resolvedCity: detail.postnrnavn ?? hit.aktueladresse.postnrnavn,
          resolvedPostcode: detail.postnr ?? hit.aktueladresse.postnr,
        };
      }
    }
    // Fallback: postcode centre — approximate but honest (quality "P"). Guarded
    // against offshore visueltcenter values via landCentroid (address mean).
    if (result.lat === null && address.postcode) {
      const pn = (await politeDawaFetch(`${DAWA}/postnumre/${address.postcode}`)) as {
        nr: string;
        navn: string;
        visueltcenter: [number, number];
      };
      const centre = await landCentroid(pn.nr, pn.visueltcenter);
      if (centre) {
        result = {
          lat: centre[1],
          lng: centre[0],
          quality: 'P',
          resolvedCity: pn.navn,
          resolvedPostcode: pn.nr,
        };
      }
    }
    // Town-name centroid via the postal-district register. The `city` field is
    // the obvious candidate; but Facebook posts routinely put a bare town in the
    // address line (parsed as `street`, e.g. just "Faaborg") with no city or
    // postcode — so when nothing else resolved, try the street as a town too.
    // Ambiguous names (several districts) stay unresolved — honesty first.
    const townCandidate =
      city ?? (result.lat === null && street && !address.postcode ? street : undefined);
    if (result.lat === null && townCandidate) {
      const districts = (await politeDawaFetch(
        `${DAWA}/postnumre?navn=${encodeURIComponent(townCandidate)}`,
      )) as Array<{ nr: string; navn: string; visueltcenter: [number, number] }>;
      const hit = districts[0];
      if (hit && districts.length === 1) {
        const centre = await landCentroid(hit.nr, hit.visueltcenter);
        if (centre) {
          result = {
            lat: centre[1],
            lng: centre[0],
            quality: 'P',
            resolvedCity: hit.navn,
            resolvedPostcode: hit.nr,
          };
        }
      }
    }
  } catch {
    // Network/API failure: return NO_MATCH but do NOT cache it,
    // so the next run retries.
    return NO_MATCH;
  }
  // Only cache a hit. A miss is left uncached so the next run — possibly with a
  // smarter geocoder — retries instead of inheriting a stale "nowhere".
  if (result.lat !== null) cacheGeocode(db, query, result);
  return result;
}
