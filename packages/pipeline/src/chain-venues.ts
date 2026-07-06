/**
 * Ingest permanent second-hand venues from the Danish charity CHAINS' own
 * websites (Kirkens Korshær, and — via the same machinery — Røde Kors,
 * Folkekirkens Nødhjælp, …).
 *
 * Why: the venue layer was OpenStreetMap-only, and OSM's coverage of small-town
 * Danish genbrugsbutikker is thin — a real visit to Rudkøbing found 4–5 open
 * shops, only ONE of which was in OSM, and even that one had no opening hours.
 * A chain's own store list is authoritative (they know their shops + hours), so
 * it both fills coverage gaps AND supplies the opening hours OSM lacks.
 *
 * Trust first: a chain shop that matches an existing (OSM) venue nearby ENRICHES
 * it with hours rather than creating a duplicate; an unresolvable address is
 * skipped (a nameless/placeless pin is worse than a missing one). Each source is
 * namespaced by osm_type ('kk' etc.) so its stale-sweep never touches another's.
 */
import type { DatabaseSync } from 'node:sqlite';
import { slugify, type VenueCategory } from '@loppefund/core';
import { existingVenueSlugs, listVenues, markStaleVenuesGone, upsertVenue } from '@loppefund/db';

/** One shop from a chain's site, pre-classification/geocoding. */
export interface ChainVenue {
  /** osm_type discriminator for this source, e.g. 'kk'. Namespaces the venue. */
  sourceType: string;
  /** Stable numeric id within the source (e.g. the shop number in its URL). */
  sourceId: number;
  /** Folded token that must appear in a nearby venue's title to treat them as
   *  the same shop (the operator, e.g. 'korshaer'). Guards the dedup/merge. */
  operatorToken: string;
  title: string;
  category: VenueCategory;
  street: string | null;
  postcode: string | null;
  city: string | null;
  openingHoursText: string | null;
  contactWebsite: string | null;
}

export interface ChainIngestStats {
  fetched: number;
  inserted: number;
  enriched: number;
  skipped: number;
  gone: number;
}

export type AddressGeocoder = (a: {
  street?: string | null;
  postcode?: string | null;
  city?: string | null;
}) => Promise<{ lat: number; lng: number } | null>;

const DEDUP_METERS = 220;

const fold = (s: string) =>
  s.toLowerCase().replaceAll('æ', 'ae').replaceAll('ø', 'oe').replaceAll('å', 'aa');

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Upsert a batch of chain venues, deduping against venues from OTHER sources.
 *
 * For each shop: geocode the address; if it resolves to a spot within
 * {@link DEDUP_METERS} of an existing venue from a different source that shares
 * the operator token, ENRICH that venue with the chain's hours/website (keeping
 * its stable slug); otherwise upsert a fresh venue keyed on (sourceType,
 * sourceId). Finally retire this source's venues that vanished this run.
 */
export async function ingestChainVenues(
  db: DatabaseSync,
  venues: ChainVenue[],
  opts: { geocodeAddress: AddressGeocoder },
): Promise<ChainIngestStats> {
  const runStart = new Date().toISOString();
  const stats: ChainIngestStats = { fetched: venues.length, inserted: 0, enriched: 0, skipped: 0, gone: 0 };
  const sourceTypes = [...new Set(venues.map((v) => v.sourceType))];
  const { byOsm, used } = existingVenueSlugs(db);
  // Snapshot of existing active venues for cross-source dedup. Taken once: chain
  // shops enrich OSM venues (a fixed set), and same-source rows are handled by
  // the (sourceType, sourceId) upsert, so intra-run inserts needn't be matched.
  const existing = listVenues(db).filter((v) => v.lat != null && v.lng != null);

  for (const cv of venues) {
    const geo = await opts.geocodeAddress({ street: cv.street, postcode: cv.postcode, city: cv.city });
    // No trustworthy location → skip. Missing is acceptable; a mis-pinned shop
    // (e.g. dumped at a postcode centroid far from the street) is not.
    if (!geo) {
      stats.skipped++;
      continue;
    }

    // Same shop already mapped by ANOTHER source nearby? Enrich it, don't clone.
    const match = existing.find(
      (e) =>
        e.osm_type !== cv.sourceType &&
        haversineM(geo.lat, geo.lng, e.lat!, e.lng!) <= DEDUP_METERS &&
        fold(e.title).includes(cv.operatorToken),
    );
    if (match) {
      upsertVenue(db, {
        slug: match.slug,
        osmType: match.osm_type,
        osmId: match.osm_id,
        title: match.title,
        category: match.category,
        street: match.street ?? cv.street,
        postcode: match.postcode ?? cv.postcode,
        city: match.city ?? cv.city,
        municipality: match.municipality,
        lat: match.lat,
        lng: match.lng,
        // The chain is authoritative for hours; keep a shop-specific OSM website
        // over the generic chain page when OSM already has one.
        openingHoursText: cv.openingHoursText ?? match.opening_hours_text,
        contactWebsite: match.contact_website ?? cv.contactWebsite,
        contactPhone: match.contact_phone,
        description: match.description,
      });
      stats.enriched++;
      continue;
    }

    const osmKey = `${cv.sourceType}/${cv.sourceId}`;
    let slug = byOsm.get(osmKey);
    if (!slug) {
      const base =
        slugify(`${cv.title} ${cv.city ?? cv.postcode ?? ''}`) || `sted-${cv.sourceType}-${cv.sourceId}`;
      slug = base;
      let n = 2;
      while (used.has(slug)) slug = `${base}-${n++}`;
      used.add(slug);
      byOsm.set(osmKey, slug);
    }
    upsertVenue(db, {
      slug,
      osmType: cv.sourceType,
      osmId: cv.sourceId,
      title: cv.title,
      category: cv.category,
      street: cv.street,
      postcode: cv.postcode,
      city: cv.city,
      lat: geo.lat,
      lng: geo.lng,
      openingHoursText: cv.openingHoursText,
      contactWebsite: cv.contactWebsite,
    });
    stats.inserted++;
  }

  stats.gone = markStaleVenuesGone(db, runStart, sourceTypes);
  return stats;
}
