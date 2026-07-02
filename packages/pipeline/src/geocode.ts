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

export async function geocode(
  db: DatabaseSync,
  address: { street?: string; postcode?: string; city?: string },
): Promise<GeocodeResult> {
  const query = [address.street, address.postcode, address.city]
    .filter(Boolean)
    .join(', ');
  if (query.length < 4) return NO_MATCH;

  const cached = getCachedGeocode(db, query);
  if (cached) return cached;

  let result = NO_MATCH;
  try {
    if (address.street) {
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
  } catch {
    // Network/API failure: return NO_MATCH but do NOT cache it,
    // so the next run retries.
    return NO_MATCH;
  }
  cacheGeocode(db, query, result);
  return result;
}
