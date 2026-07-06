/**
 * Danmission Genbrug — the charity's second-hand shops, served by the site's
 * wp-google-maps REST endpoint (all markers in one call). The endpoint also
 * carries non-shop markers (project offices abroad), so we keep only markers
 * whose link is a /genbrugsbutik/ page. Each shop has coordinates + a full
 * address + hours embedded in the description, so no geocoding is needed.
 */
import { classifyVenue } from '@loppefund/core';
import type { ChainVenue } from '../chain-venues.ts';
import { danishHoursToOsm, stableId } from './danish-hours.ts';

const API = 'https://danmission.dk/wp-json/wpgmza/v1/markers';
const WEBSITE = 'https://danmission.dk/genbrug/find-din-butik/';
const UA = 'Loppefund/1.0 (+https://jacobtop-tcg.github.io/loppefund; Danish flea-market directory)';
const OPERATOR = 'Danmission';
const OPERATOR_TOKEN = 'danmission';

interface Marker {
  title?: string;
  address?: string;
  description?: string;
  lat?: string;
  lng?: string;
  link?: string;
}

export function parseDanmissionMarkers(markers: Marker[]): ChainVenue[] {
  const out: ChainVenue[] = [];
  const seen = new Set<number>();
  for (const m of markers) {
    if (!/\/genbrugsbutik\//i.test(m.link ?? '')) continue; // shops only, not offices
    // address like "Birkholmvej 2, 4320 Lejre"
    const am = (m.address ?? '').match(/^(.*?),\s*(\d{4})\s+(.+)$/);
    if (!am) continue;
    const street = am[1]!.trim();
    const postcode = am[2]!;
    const city = am[3]!.trim();
    const lat = Number(m.lat);
    const lng = Number(m.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const id = stableId(`${street}|${postcode}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const title = (m.title ?? `${OPERATOR} Genbrug, ${city}`).trim();
    out.push({
      sourceType: 'dm',
      sourceId: id,
      operatorToken: OPERATOR_TOKEN,
      title,
      category: classifyVenue({ name: title, operator: OPERATOR }),
      street,
      postcode,
      city,
      openingHoursText: danishHoursToOsm(m.description),
      contactWebsite: WEBSITE,
      lat,
      lng,
    });
  }
  return out;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await globalThis.fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export async function fetchDanmissionVenues(
  opts: { fetchJson?: (url: string) => Promise<unknown> } = {},
): Promise<ChainVenue[]> {
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const data = await fetchJson(API);
  const markers = Array.isArray(data) ? (data as Marker[]) : [];
  return parseDanmissionMarkers(markers);
}
