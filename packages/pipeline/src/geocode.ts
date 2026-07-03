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
  if (cached && cached.lat !== null) return cached;

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
    // Fallback: postcode visual centre — approximate but honest (quality "P").
    if (result.lat === null && address.postcode) {
      const pn = (await politeDawaFetch(`${DAWA}/postnumre/${address.postcode}`)) as {
        nr: string;
        navn: string;
        visueltcenter: [number, number];
      };
      if (pn.visueltcenter) {
        result = {
          lat: pn.visueltcenter[1],
          lng: pn.visueltcenter[0],
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
      if (hit?.visueltcenter && districts.length === 1) {
        result = {
          lat: hit.visueltcenter[1],
          lng: hit.visueltcenter[0],
          quality: 'P',
          resolvedCity: hit.navn,
          resolvedPostcode: hit.nr,
        };
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
