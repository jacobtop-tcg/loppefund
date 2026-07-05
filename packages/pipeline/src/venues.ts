/**
 * Ingest permanent second-hand venues from OpenStreetMap via the Overpass API.
 *
 * OSM is the only source whose licence (ODbL) permits bulk download, storage
 * and independent display of names + opening hours — Google Places forbids
 * exactly this. Attribution ("© OpenStreetMap contributors") is shown in the
 * app footer. One Overpass request per run; not a polite-crawl target, so it
 * bypasses the PoliteFetcher/robots machinery and calls the API directly.
 */
import type { DatabaseSync } from 'node:sqlite';
import { classifyVenue, slugify, type VenueCategory } from '@loppefund/core';
import {
  cacheGeocode,
  existingVenueSlugs,
  getCachedGeocode,
  markStaleVenuesGone,
  upsertVenue,
} from '@loppefund/db';
import { reverseGeocode } from './adapters/visitdenmark.ts';

export type LocationResolver = (
  lat: number,
  lng: number,
) => Promise<{ city: string | null; postcode: string | null }>;

/**
 * Danish OSM shops almost never carry their own addr:* tags (addresses live on
 * separate address nodes), so we reverse-geocode the coordinates to a town via
 * DAWA — persistently cached in geocode_cache, so the ~1000 lookups happen once
 * and re-runs are instant. Failures leave the town blank; the map pin still
 * places the venue exactly.
 */
function dbCachedResolver(db: DatabaseSync): LocationResolver {
  return async (lat, lng) => {
    const key = `rev:${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = getCachedGeocode(db, key);
    if (cached) return { city: cached.resolvedCity, postcode: cached.resolvedPostcode };
    const r = await reverseGeocode(lat, lng);
    cacheGeocode(db, key, {
      lat, lng, quality: 'reverse',
      resolvedCity: r.city ?? null, resolvedPostcode: r.postcode ?? null,
    });
    return { city: r.city ?? null, postcode: r.postcode ?? null };
  };
}

// Public Overpass instances, tried in order (the main one rate-limits under load).
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Denmark: charity/second-hand/antique/antiquarian premises with tags + a point.
// loppemarked/loppelade/reolmarked have no distinct OSM tag — they arrive as
// shop=second_hand and are recovered by name in classifyVenue().
const OVERPASS_QUERY = `[out:json][timeout:180];
area["ISO3166-1"="DK"][admin_level=2]->.dk;
(
  nwr["shop"="charity"](area.dk);
  nwr["shop"="second_hand"](area.dk);
  nwr["shop"="antiques"](area.dk);
  nwr["shop"="books"]["second_hand"](area.dk);
  nwr["shop"]["second_hand"="only"](area.dk);
);
out center tags;`;

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface VenueIngestStats {
  fetched: number;
  upserted: number;
  skipped: number;
  gone: number;
  byCategory: Record<string, number>;
}

async function fetchOverpass(): Promise<OsmElement[]> {
  let lastErr: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await globalThis.fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Loppefund/1.0 (+https://jacobtop-tcg.github.io/loppefund; Danish flea-market directory)',
        },
        body: 'data=' + encodeURIComponent(OVERPASS_QUERY),
      });
      if (!res.ok) throw new Error(`Overpass ${endpoint} -> HTTP ${res.status}`);
      const json = (await res.json()) as { elements?: OsmElement[] };
      return json.elements ?? [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Overpass fetch failed');
}

function coords(el: OsmElement): { lat: number; lng: number } | null {
  if (el.lat != null && el.lon != null) return { lat: el.lat, lng: el.lon };
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  return null;
}

/**
 * Fetch OSM venues (or use `opts.elements` in tests) and upsert them, keeping
 * stable slugs and retiring any that vanished from OSM this run.
 */
export async function ingestOsmVenues(
  db: DatabaseSync,
  opts: { elements?: OsmElement[]; resolveLocation?: LocationResolver } = {},
): Promise<VenueIngestStats> {
  const runStart = new Date().toISOString();
  const elements = opts.elements ?? (await fetchOverpass());
  const resolveLocation = opts.resolveLocation ?? dbCachedResolver(db);
  const { byOsm, used } = existingVenueSlugs(db);
  const stats: VenueIngestStats = {
    fetched: elements.length,
    upserted: 0,
    skipped: 0,
    gone: 0,
    byCategory: {},
  };

  for (const el of elements) {
    const tags = el.tags ?? {};
    const title = (tags.name ?? tags.brand ?? tags.operator ?? '').trim();
    // A directory entry needs a name; unnamed premises are skipped (missing is
    // acceptable, a nameless pin is not).
    if (!title) {
      stats.skipped++;
      continue;
    }
    const category = classifyVenue({
      shop: tags.shop,
      name: title,
      operator: tags.operator,
      charity: tags.charity,
    }) as VenueCategory;

    const osmKey = `${el.type}/${el.id}`;
    let slug = byOsm.get(osmKey);
    if (!slug) {
      const base =
        slugify(`${title} ${tags['addr:city'] ?? tags['addr:postcode'] ?? ''}`) || `sted-${el.id}`;
      slug = base;
      let n = 2;
      while (used.has(slug)) slug = `${base}-${n++}`;
      used.add(slug);
      byOsm.set(osmKey, slug);
    }

    const c = coords(el);
    const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ') || null;
    // OSM town is usually absent in DK; fall back to reverse-geocoding coords.
    let city = tags['addr:city'] ?? null;
    let postcode = tags['addr:postcode'] ?? null;
    if (!city && c) {
      const loc = await resolveLocation(c.lat, c.lng);
      city = loc.city;
      postcode = postcode ?? loc.postcode;
    }
    upsertVenue(db, {
      slug,
      osmType: el.type,
      osmId: el.id,
      title,
      category,
      street,
      postcode,
      city,
      lat: c?.lat ?? null,
      lng: c?.lng ?? null,
      openingHoursText: tags.opening_hours ?? null,
      contactWebsite: tags.website ?? tags['contact:website'] ?? tags.url ?? null,
      contactPhone: tags.phone ?? tags['contact:phone'] ?? null,
      description: tags.description ?? null,
    });
    stats.upserted++;
    stats.byCategory[category] = (stats.byCategory[category] ?? 0) + 1;
  }

  stats.gone = markStaleVenuesGone(db, runStart);
  return stats;
}
