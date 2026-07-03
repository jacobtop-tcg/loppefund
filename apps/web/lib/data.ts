import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { addDays, isHiddenGem, searchFold, type Amenities } from '@loppefund/core';
import { summarizeReviews, type ReviewSummary } from './reviews.ts';
import { summarizePhotos, type Photo } from './photos.ts';
import {
  getEventBySlug,
  listCancelledSlugsBetween,
  listEventsBetween,
  openDb,
  openDbReadOnly,
} from '@loppefund/db';

let db: DatabaseSync | null = null;

function resolveDbPath(): string {
  if (process.env.LOPPEFUND_DB) return process.env.LOPPEFUND_DB;
  // Walk up from cwd until we find data/loppefund.db (monorepo root).
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'data', 'loppefund.db');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return join(process.cwd(), 'data', 'loppefund.db');
}

function getDb(): DatabaseSync {
  if (db) return db;
  const path = resolveDbPath();
  try {
    db = openDbReadOnly(path);
  } catch {
    // First-ever run without an existing db: create it, then reopen read-only.
    openDb(path).close();
    db = openDbReadOnly(path);
  }
  return db;
}

// Curated community content lives in data/<name>.json (slug -> raw[]), read once
// at build time. A missing/broken file just means "nothing curated yet".
const jsonCache = new Map<string, Record<string, unknown>>();
function readRepoJson(name: string): Record<string, unknown> {
  const cached = jsonCache.get(name);
  if (cached) return cached;
  let out: Record<string, unknown> = {};
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'data', `${name}.json`);
    if (existsSync(candidate)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
        if (parsed && typeof parsed === 'object') out = parsed as Record<string, unknown>;
      } catch {
        /* malformed — treat as empty */
      }
      break;
    }
    dir = dirname(dir);
  }
  jsonCache.set(name, out);
  return out;
}

/** Aggregated community reviews for one market (empty when none are curated). */
export function loadReviews(slug: string): ReviewSummary {
  return summarizeReviews(readRepoJson('reviews')[slug]);
}

/** Curated community photos for one market (empty when none are curated). */
export function loadPhotos(slug: string): Photo[] {
  return summarizePhotos(readRepoJson('photos')[slug]);
}

export interface SourceInfo {
  key: string;
  name: string;
  baseUrl: string;
  trust: number;
  eventCount: number;
}

/** Sources currently feeding the canonical database, with their live count of
 *  active markets. The trust weight is why some sources can confirm a market on
 *  their own while others need corroboration. */
export function listActiveSources(): SourceInfo[] {
  return getDb()
    .prepare(
      `SELECT s.key, s.name, s.base_url AS baseUrl, s.trust,
        (SELECT COUNT(DISTINCT es.event_id)
           FROM raw_events r
           JOIN event_sources es ON es.raw_event_id = r.id
           JOIN events e ON e.id = es.event_id AND e.status = 'active'
          WHERE r.source_key = s.key) AS eventCount
       FROM sources s
       ORDER BY eventCount DESC, s.name`,
    )
    .all() as unknown as SourceInfo[];
}

export interface DiscoveredSource {
  domain: string;
  mentions: number;
  distinctTitles: number;
  /** Titles already in the database; distinctTitles - this ≈ genuinely new
   *  markets. Null when discovery hasn't computed coverage for this DB yet. */
  coveredTitles: number | null;
  status: string;
  probeScore: number | null;
}

/** Domains the discovery engine has automatically surfaced from crawled data —
 *  the pipeline of candidate new sources. Social/search hosts are excluded. */
export function listDiscoveredSources(): DiscoveredSource[] {
  const db = getDb();
  // covered_titles was added after v1; a read-only DB built before the migration
  // ran won't have the column, so degrade gracefully instead of throwing.
  const hasCovered =
    (
      db
        .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('source_candidates') WHERE name = 'covered_titles'`)
        .get() as { c: number }
    ).c > 0;
  const coveredExpr = hasCovered ? 'covered_titles' : 'NULL';
  return db
    .prepare(
      `SELECT domain, mentions, distinct_titles AS distinctTitles,
              ${coveredExpr} AS coveredTitles, status, probe_score AS probeScore
       FROM source_candidates
       WHERE domain NOT LIKE '%facebook%' AND domain NOT LIKE '%google%'
         AND domain NOT LIKE '%instagram%' AND domain NOT LIKE '%youtube%'
       ORDER BY (probe_score IS NULL), probe_score DESC, mentions DESC`,
    )
    .all() as unknown as DiscoveredSource[];
}

/**
 * Coords from a postcode/city centroid (quality 'P'/'city') rather than an exact
 * street match ('source'/'A'/'B') — the pin is only roughly right, so the UI
 * flags it as "ca. placering" instead of implying street precision.
 */
export function isApproximateGeocode(quality: string | null | undefined): boolean {
  return quality != null && !['source', 'A', 'B'].includes(quality);
}

export interface EventSummary {
  slug: string;
  title: string;
  category: string;
  venueName: string | null;
  city: string | null;
  postcode: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
  /** Coords are a postcode/city centroid, not a precise street pin. */
  approximate: boolean;
  isFree: boolean | null;
  indoorOutdoor: string;
  stallCountText: string | null;
  status: string;
  confidence: number;
  /** Hidden-gem heuristic — see @loppefund/core gems.ts. */
  gem: boolean;
  /** From extracted amenities: kids activities mentioned in the description. */
  familyFriendly: boolean;
  /** Folded description snippet so client search can match e.g. "vintage". */
  searchText: string;
  occurrences: Array<{ date: string; startTime: string | null; endTime: string | null }>;
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(new Date());
}

export function listUpcomingEvents(horizonDays = 120): EventSummary[] {
  const from = todayIso();
  const to = addDays(from, horizonDays);
  return listEventsBetween(getDb(), from, to)
    .map((e) => ({
      slug: e.slug,
      title: e.title,
      category: e.category,
      venueName: e.venue_name,
      city: e.city,
      postcode: e.postcode,
      municipality: e.municipality,
      lat: e.lat,
      lng: e.lng,
      approximate: e.lat != null && isApproximateGeocode(e.geocode_quality),
      isFree: e.is_free === null ? null : e.is_free === 1,
      indoorOutdoor: e.indoor_outdoor,
      stallCountText: e.stall_count_text,
      status: e.status,
      confidence: e.confidence,
      gem: isHiddenGem({
        confidence: e.confidence,
        sourceCount: e.source_count,
        occurrenceCount: e.occurrences.length,
        hasLocation: e.lat != null && e.lng != null,
        descriptionLength: e.description?.length ?? 0,
        stallCountText: e.stall_count_text,
        isFreeKnown: e.is_free !== null,
        hasTimedOccurrence: e.occurrences.some((o) => o.start_time !== null),
        hasVenueName: e.venue_name !== null,
        hasOrganizerOrWebsite: e.organizer !== null || e.contact_website !== null,
      }),
      familyFriendly: e.amenities
        ? (JSON.parse(e.amenities) as Amenities).familyFriendly === true
        : false,
      // Enough folded description signal for keyword matches ('vintage',
      // 'børneloppemarked') without bloating the homepage payload — title,
      // city, venue, municipality and postcode are searched separately.
      searchText: e.description
        ? searchFold(e.description).replace(/\s+/g, ' ').trim().slice(0, 140)
        : '',
      // Cap the serialized occurrence list — always-open venues have one per
      // day, which bloats the payload without changing filter results.
      occurrences: e.occurrences.slice(0, 40).map((o) => ({
        date: o.date,
        startTime: o.start_time,
        endTime: o.end_time,
      })),
    }))
    .sort((a, b) => (a.occurrences[0]?.date ?? '').localeCompare(b.occurrences[0]?.date ?? ''));
}

/**
 * Slugs of cancelled markets whose date hasn't passed yet. Browsing surfaces
 * stay active-only; these exist so a shared/bookmarked link to a market that
 * was cancelled after sharing still resolves to a clear "AFLYST" page instead
 * of a 404 that hides the cancellation. Fed into generateStaticParams.
 */
export function listCancelledUpcomingSlugs(horizonDays = 180): string[] {
  const from = todayIso();
  return listCancelledSlugsBetween(getDb(), from, addDays(from, horizonDays));
}

export interface CityInfo {
  city: string;
  slug: string;
  count: number;
}

/** Cities with 2+ upcoming markets — the per-city SEO landing pages. */
export function listCities(): CityInfo[] {
  const bySlug = new Map<string, CityInfo>();
  for (const e of listUpcomingEvents(180)) {
    if (!e.city) continue;
    const slug = slugifyCity(e.city);
    if (!slug) continue;
    const existing = bySlug.get(slug);
    if (existing) existing.count++;
    else bySlug.set(slug, { city: e.city, slug, count: 1 });
  }
  return [...bySlug.values()]
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.count - a.count);
}

export function slugifyCity(city: string): string {
  return city
    .toLowerCase()
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'oe')
    .replaceAll('å', 'aa')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

export function listEventsForCity(citySlug: string): EventSummary[] {
  return listUpcomingEvents(180).filter(
    (e) => e.city && slugifyCity(e.city) === citySlug,
  );
}

export function loadEventDetail(slug: string) {
  const e = getEventBySlug(getDb(), slug);
  if (!e) return null;
  return {
    slug: e.slug,
    title: e.title,
    description: e.description,
    category: e.category,
    venueName: e.venue_name,
    street: e.street,
    postcode: e.postcode,
    city: e.city,
    municipality: e.municipality,
    lat: e.lat,
    lng: e.lng,
    approximate: e.lat != null && isApproximateGeocode(e.geocode_quality),
    organizer: e.organizer,
    contactWebsite: e.contact_website,
    contactEmail: e.contact_email,
    contactPhone: e.contact_phone,
    priceText: e.price_text,
    isFree: e.is_free === null ? null : e.is_free === 1,
    stallCountText: e.stall_count_text,
    indoorOutdoor: e.indoor_outdoor,
    scheduleText: e.schedule_text,
    openingHoursText: e.opening_hours_text,
    status: e.status,
    confidence: e.confidence,
    lastSeenAt: e.last_seen_at,
    amenities: e.amenities ? (JSON.parse(e.amenities) as Amenities) : null,
    occurrences: e.occurrences.map((o) => ({
      date: o.date,
      startTime: o.start_time,
      endTime: o.end_time,
    })),
    sources: e.sources.map((s) => ({
      name: s.name,
      url: s.source_url,
      lastConfirmedAt: s.last_confirmed_at,
    })),
  };
}
