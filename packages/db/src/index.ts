import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { searchFold, type CanonicalEvent, type Occurrence, type RawEvent } from '@loppefund/core';
import { migrate } from './schema.ts';

export { migrate };

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 24);
}

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  migrate(db);
  return db;
}

/**
 * Read-only open for consumers (the web app): no migration writes, so many
 * parallel build workers can read the same file without lock contention.
 */
export function openDbReadOnly(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

export interface SourceRow {
  key: string;
  name: string;
  base_url: string;
  trust: number;
  active: number;
}

export function upsertSource(
  db: DatabaseSync,
  s: { key: string; name: string; baseUrl: string; trust: number },
): void {
  db.prepare(
    `INSERT INTO sources(key, name, base_url, trust) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET name=excluded.name, base_url=excluded.base_url, trust=excluded.trust`,
  ).run(s.key, s.name, s.baseUrl, s.trust);
}

export function recordDocument(
  db: DatabaseSync,
  d: { sourceKey: string; url: string; httpStatus: number; contentHash: string | null },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO documents(source_key, url, fetched_at, http_status, content_hash)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(d.sourceKey, d.url, new Date().toISOString(), d.httpStatus, d.contentHash);
}

/**
 * Store a raw extraction; returns id and whether the payload changed.
 * extracted_at doubles as "last seen at the source": an unchanged payload
 * from a LIVE crawl still bumps it (the source is re-confirming the data),
 * while offline reprocessing passes touch=false so rebuilds never fabricate
 * freshness.
 */
export function upsertRawEvent(
  db: DatabaseSync,
  raw: RawEvent,
  opts: { touch?: boolean } = {},
): { id: number; changed: boolean } {
  const payload = JSON.stringify(raw);
  const hash = hashContent(payload);
  const existing = db
    .prepare(
      `SELECT id, content_hash FROM raw_events WHERE source_key = ? AND source_event_id = ?`,
    )
    .get(raw.sourceKey, raw.sourceEventId) as
    | { id: number; content_hash: string }
    | undefined;
  const now = new Date().toISOString();
  if (existing) {
    if (existing.content_hash === hash) {
      if (opts.touch !== false) {
        db.prepare(`UPDATE raw_events SET extracted_at = ? WHERE id = ?`).run(now, existing.id);
      }
      return { id: existing.id, changed: false };
    }
    if (opts.touch === false) return { id: existing.id, changed: true };
    db.prepare(
      `UPDATE raw_events SET payload = ?, content_hash = ?, extracted_at = ? WHERE id = ?`,
    ).run(payload, hash, now, existing.id);
    return { id: existing.id, changed: true };
  }
  const res = db
    .prepare(
      `INSERT INTO raw_events(source_key, source_event_id, source_url, payload, extracted_at, content_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(raw.sourceKey, raw.sourceEventId, raw.sourceUrl, payload, now, hash);
  return { id: Number(res.lastInsertRowid), changed: true };
}

export interface EventRow {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  venue_name: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
  geocode_quality: string | null;
  organizer: string | null;
  contact_website: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  price_text: string | null;
  is_free: number | null;
  stall_count_text: string | null;
  indoor_outdoor: string;
  schedule_text: string | null;
  opening_hours_text: string | null;
  status: string;
  confidence: number;
  field_provenance: string;
  first_seen_at: string;
  last_seen_at: string;
  /** Amenities JSON (see @loppefund/core Amenities) or null. */
  amenities: string | null;
}

type EventValues = Omit<CanonicalEvent, 'id' | 'fieldProvenance' | 'isFree'> & {
  isFree: boolean | null;
  fieldProvenance: Record<string, string>;
  /** Serialized Amenities or null. */
  amenities?: string | null;
};

const EVENT_COLUMNS = `slug, title, description, category, venue_name, street, postcode, city,
  municipality, lat, lng, geocode_quality, organizer, contact_website, contact_email,
  contact_phone, price_text, is_free, stall_count_text, indoor_outdoor, schedule_text,
  opening_hours_text, status, confidence, field_provenance, first_seen_at, last_seen_at,
  search_text, amenities`;

function eventParams(e: EventValues): Array<string | number | null> {
  const searchText = searchFold(
    [e.title, e.venueName, e.city, e.municipality, e.description ?? '']
      .filter(Boolean)
      .join(' '),
  );
  return [
    e.slug, e.title, e.description, e.category, e.venueName, e.street, e.postcode, e.city,
    e.municipality, e.lat, e.lng, e.geocodeQuality, e.organizer, e.contactWebsite,
    e.contactEmail, e.contactPhone, e.priceText,
    e.isFree === null ? null : e.isFree ? 1 : 0,
    e.stallCountText, e.indoorOutdoor, e.scheduleText, e.openingHoursText, e.status,
    e.confidence, JSON.stringify(e.fieldProvenance), e.firstSeenAt, e.lastSeenAt,
    searchText, e.amenities ?? null,
  ];
}

export function insertEvent(db: DatabaseSync, e: EventValues): number {
  const placeholders = EVENT_COLUMNS.split(',').map(() => '?').join(', ');
  const res = db
    .prepare(`INSERT INTO events(${EVENT_COLUMNS}) VALUES (${placeholders})`)
    .run(...eventParams(e));
  return Number(res.lastInsertRowid);
}

export function updateEvent(db: DatabaseSync, id: number, e: EventValues): void {
  const assignments = EVENT_COLUMNS.split(',')
    .map((c) => `${c.trim()} = ?`)
    .join(', ');
  db.prepare(`UPDATE events SET ${assignments} WHERE id = ?`).run(
    ...eventParams(e),
    id,
  );
}

export function replaceOccurrences(
  db: DatabaseSync,
  eventId: number,
  occurrences: Occurrence[],
): void {
  db.prepare(`DELETE FROM occurrences WHERE event_id = ?`).run(eventId);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO occurrences(event_id, date, start_time, end_time) VALUES (?, ?, ?, ?)`,
  );
  for (const o of occurrences) {
    ins.run(eventId, o.date, o.startTime, o.endTime);
  }
}

export function linkEventSource(
  db: DatabaseSync,
  eventId: number,
  rawEventId: number,
): void {
  // last_confirmed_at mirrors the raw event's extracted_at (= when the
  // source last showed this data), so offline rebuilds keep real freshness.
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO event_sources(event_id, raw_event_id, first_linked_at, last_confirmed_at)
     VALUES (?, ?, ?, COALESCE((SELECT extracted_at FROM raw_events WHERE id = ?), ?))
     ON CONFLICT(event_id, raw_event_id) DO UPDATE SET last_confirmed_at = excluded.last_confirmed_at`,
  ).run(eventId, rawEventId, now, rawEventId, now);
}

/** All active events with any occurrence in [from, to], with their occurrences in range. */
export interface EventWithOccurrences extends EventRow {
  source_count: number;
  occurrences: Array<{ date: string; start_time: string | null; end_time: string | null }>;
}

export function listEventsBetween(
  db: DatabaseSync,
  from: string,
  to: string,
): EventWithOccurrences[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT e.*, (
         SELECT COUNT(DISTINCT r.source_key) FROM event_sources es
         JOIN raw_events r ON r.id = es.raw_event_id
         WHERE es.event_id = e.id
       ) AS source_count
       FROM events e
       JOIN occurrences o ON o.event_id = e.id
       WHERE e.status = 'active' AND o.date >= ? AND o.date <= ?`,
    )
    .all(from, to) as unknown as (EventRow & { source_count: number })[];
  const occStmt = db.prepare(
    `SELECT date, start_time, end_time FROM occurrences
     WHERE event_id = ? AND date >= ? AND date <= ? ORDER BY date`,
  );
  return rows.map((e) => ({
    ...e,
    occurrences: occStmt.all(e.id, from, to) as unknown as EventWithOccurrences['occurrences'],
  }));
}

/**
 * Slugs of CANCELLED events that still have an occurrence in [from, to].
 *
 * Discovery surfaces (list, map, counts, recommendations) stay active-only via
 * listEventsBetween — a cancelled market must never appear in browsing. But a
 * market can be cancelled *after* its page was shared in a Facebook group or
 * bookmarked. If that page then 404s, the visitor loses the cancellation signal
 * and may still drive there. So a directly-navigated cancelled market must
 * resolve to a clear "AFLYST" page — this feeds those slugs into static
 * generation. Past-cancelled markets are excluded (no one is driving to them).
 */
export function listCancelledSlugsBetween(
  db: DatabaseSync,
  from: string,
  to: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT e.slug FROM events e
       JOIN occurrences o ON o.event_id = e.id
       WHERE e.status = 'cancelled' AND o.date >= ? AND o.date <= ?`,
    )
    .all(from, to) as unknown as Array<{ slug: string }>;
  return rows.map((r) => r.slug);
}

/** Events the pipeline retired because their source stopped listing them
 *  (status 'expired' via reconcileVanishedSourceEvents) but whose dates are
 *  still ahead — e.g. a Facebook event that rotated out of the feed. Their
 *  shared/bookmarked links deserve a soft "no longer advertised" page, not a
 *  silent 404. Browsing surfaces stay active-only. */
export function listVanishedSlugsBetween(
  db: DatabaseSync,
  from: string,
  to: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT e.slug FROM events e
       JOIN occurrences o ON o.event_id = e.id
       WHERE e.status = 'expired' AND o.date >= ? AND o.date <= ?`,
    )
    .all(from, to) as unknown as Array<{ slug: string }>;
  return rows.map((r) => r.slug);
}

export function getEventBySlug(
  db: DatabaseSync,
  slug: string,
): (EventRow & {
  occurrences: Array<{ date: string; start_time: string | null; end_time: string | null }>;
  sources: Array<{ source_key: string; source_url: string; name: string; last_confirmed_at: string }>;
}) | null {
  const e = db.prepare(`SELECT * FROM events WHERE slug = ?`).get(slug) as
    | EventRow
    | undefined;
  if (!e) return null;
  const occurrences = db
    .prepare(
      `SELECT date, start_time, end_time FROM occurrences WHERE event_id = ? ORDER BY date`,
    )
    .all(e.id) as unknown as Array<{ date: string; start_time: string | null; end_time: string | null }>;
  // One line per source — recurring series link many raw entries per source,
  // so collapse to the freshest confirmation per source_key.
  const sources = db
    .prepare(
      `SELECT r.source_key, s.name,
              MAX(es.last_confirmed_at) AS last_confirmed_at,
              (SELECT r2.source_url FROM event_sources es2
               JOIN raw_events r2 ON r2.id = es2.raw_event_id
               WHERE es2.event_id = es.event_id AND r2.source_key = r.source_key
               ORDER BY es2.last_confirmed_at DESC LIMIT 1) AS source_url
       FROM event_sources es
       JOIN raw_events r ON r.id = es.raw_event_id
       JOIN sources s ON s.key = r.source_key
       WHERE es.event_id = ?
       GROUP BY r.source_key`,
    )
    .all(e.id) as unknown as Array<{ source_key: string; source_url: string; name: string; last_confirmed_at: string }>;
  return { ...e, occurrences, sources };
}

/** FTS5 search over events; returns event ids ranked by relevance. */
export function searchEvents(db: DatabaseSync, query: string, limit = 50): number[] {
  const tokens = query
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Each token must match as typed or in a Danish ascii-folded form; groups
  // are joined with explicit AND (FTS5 rejects space-separated parenthesized
  // groups). Empty variants are dropped so no bare '""*' reaches the parser.
  const q = tokens
    .map((t) => {
      const variants = [...new Set([t, ...searchFold(t).split(' ')])].filter(Boolean);
      return `(${variants.map((v) => `"${v}"*`).join(' OR ')})`;
    })
    .join(' AND ');
  if (!q) return [];
  const rows = db
    .prepare(
      `SELECT rowid FROM events_fts WHERE events_fts MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(q, limit) as unknown as Array<{ rowid: number }>;
  return rows.map((r) => r.rowid);
}

/**
 * Candidate events for dedup matching: same postcode, geocoded within a
 * ~1km bbox, or identical title (catches recurring series that never
 * geocoded — no location data means postcode/bbox lookups find nothing).
 */
export function findCandidateEvents(
  db: DatabaseSync,
  opts: { postcode?: string | null; lat?: number | null; lng?: number | null; title?: string },
): EventRow[] {
  const candidates = new Map<number, EventRow>();
  if (opts.title) {
    for (const r of db
      .prepare(`SELECT * FROM events WHERE title = ? COLLATE NOCASE`)
      .all(opts.title) as unknown as EventRow[]) {
      candidates.set(r.id, r);
    }
    // Fuzzy title lookup via FTS so location-less variants
    // ("Loppemarked på Vanløse Torv" vs "Vanløse Torv Loppemarked") surface
    // as candidates; matchEvents still makes the final merge decision.
    for (const id of searchEvents(db, opts.title, 20)) {
      if (!candidates.has(id)) {
        const r = db.prepare(`SELECT * FROM events WHERE id = ?`).get(id) as EventRow | undefined;
        if (r) candidates.set(r.id, r);
      }
    }
  }
  if (opts.postcode) {
    for (const r of db
      .prepare(`SELECT * FROM events WHERE postcode = ?`)
      .all(opts.postcode) as unknown as EventRow[]) {
      candidates.set(r.id, r);
    }
  }
  if (opts.lat != null && opts.lng != null) {
    const dLat = 0.01; // ~1.1 km
    const dLng = 0.02; // ~1.2 km at 56°N
    for (const r of db
      .prepare(`SELECT * FROM events WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`)
      .all(opts.lat - dLat, opts.lat + dLat, opts.lng - dLng, opts.lng + dLng) as unknown as EventRow[]) {
      candidates.set(r.id, r);
    }
  }
  return [...candidates.values()];
}

export function occurrenceDates(db: DatabaseSync, eventId: number): string[] {
  return (
    db
      .prepare(`SELECT date FROM occurrences WHERE event_id = ? ORDER BY date`)
      .all(eventId) as unknown as Array<{ date: string }>
  ).map((r) => r.date);
}

// --- geocode cache ---

export interface GeocodeResult {
  lat: number | null;
  lng: number | null;
  quality: string | null;
  resolvedCity: string | null;
  resolvedPostcode: string | null;
}

export function getCachedGeocode(db: DatabaseSync, query: string): GeocodeResult | null {
  const r = db.prepare(`SELECT * FROM geocode_cache WHERE query = ?`).get(query) as
    | { lat: number | null; lng: number | null; quality: string | null; resolved_city: string | null; resolved_postcode: string | null }
    | undefined;
  return r
    ? { lat: r.lat, lng: r.lng, quality: r.quality, resolvedCity: r.resolved_city, resolvedPostcode: r.resolved_postcode }
    : null;
}

export function cacheGeocode(db: DatabaseSync, query: string, r: GeocodeResult): void {
  db.prepare(
    `INSERT INTO geocode_cache(query, lat, lng, quality, resolved_city, resolved_postcode, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(query) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, quality=excluded.quality,
       resolved_city=excluded.resolved_city, resolved_postcode=excluded.resolved_postcode, cached_at=excluded.cached_at`,
  ).run(query, r.lat, r.lng, r.quality, r.resolvedCity, r.resolvedPostcode, new Date().toISOString());
}

// --- community tips (the bridge from closed Facebook groups etc.) ---

export function insertTip(
  db: DatabaseSync,
  tip: { url?: string; text?: string; contact?: string },
): number {
  const res = db
    .prepare(`INSERT INTO tips(url, text, contact, submitted_at) VALUES (?, ?, ?, ?)`)
    .run(tip.url ?? null, tip.text ?? null, tip.contact ?? null, new Date().toISOString());
  return Number(res.lastInsertRowid);
}

export interface TipRow {
  id: number;
  url: string | null;
  text: string | null;
  contact: string | null;
  submitted_at: string;
  status: string;
}

export function listTips(db: DatabaseSync, status = 'new'): TipRow[] {
  return db
    .prepare(`SELECT * FROM tips WHERE status = ? ORDER BY submitted_at DESC`)
    .all(status) as unknown as TipRow[];
}

export function setTipStatus(db: DatabaseSync, id: number, status: 'processed' | 'rejected'): void {
  db.prepare(`UPDATE tips SET status = ? WHERE id = ?`).run(status, id);
}

// --- source candidates (auto-discovery funnel) ---

export interface SourceCandidateRow {
  domain: string;
  mentions: number;
  distinct_titles: number;
  sources: string;
  fields: string;
  first_seen: string;
  last_seen: string;
  status: string;
  probe_score: number | null;
  probe_signals: string | null;
  probed_at: string | null;
  notes: string | null;
}

/**
 * Refresh a candidate's mined counts. Deliberately never touches status,
 * notes or probe_* — re-mining must not reset a probed/promoted/rejected
 * verdict. Counts are absolute overwrites because mining is a full recompute.
 */
export function upsertSourceCandidate(
  db: DatabaseSync,
  c: {
    domain: string;
    mentions: number;
    distinctTitles: number;
    coveredTitles?: number;
    sources: string[];
    fields: string[];
    seenAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO source_candidates(domain, mentions, distinct_titles, covered_titles, sources, fields, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(domain) DO UPDATE SET
       mentions = excluded.mentions,
       distinct_titles = excluded.distinct_titles,
       covered_titles = excluded.covered_titles,
       sources = excluded.sources,
       fields = excluded.fields,
       last_seen = excluded.last_seen`,
  ).run(
    c.domain, c.mentions, c.distinctTitles, c.coveredTitles ?? null,
    JSON.stringify(c.sources), JSON.stringify(c.fields), c.seenAt, c.seenAt,
  );
}

export function listSourceCandidates(
  db: DatabaseSync,
  opts: { status?: string; minMentions?: number } = {},
): SourceCandidateRow[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.status) {
    where.push('status = ?');
    params.push(opts.status);
  }
  if (opts.minMentions !== undefined) {
    where.push('mentions >= ?');
    params.push(opts.minMentions);
  }
  const sql = `SELECT * FROM source_candidates
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY (probe_score IS NULL), probe_score DESC, mentions DESC`;
  return db.prepare(sql).all(...params) as unknown as SourceCandidateRow[];
}

/**
 * Domains a probe found to expose a machine-readable Tribe Events feed — the
 * safe-to-auto-ingest set for the discovered-feeds adapter. Rejected candidates
 * are excluded; a human "reject" is final. Own-domain filtering is the caller's
 * job (it knows the adapter registry).
 */
export function listStructuredFeedDomains(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `SELECT domain, probe_signals FROM source_candidates
       WHERE probe_signals IS NOT NULL AND status != 'rejected'`,
    )
    .all() as unknown as Array<{ domain: string; probe_signals: string }>;
  const out: string[] = [];
  for (const r of rows) {
    try {
      if ((JSON.parse(r.probe_signals) as { tribeApi?: boolean }).tribeApi === true) {
        out.push(r.domain);
      }
    } catch {
      // malformed signals JSON — skip, never guess a feed into existence
    }
  }
  return out;
}

export function markCandidateProbed(
  db: DatabaseSync,
  domain: string,
  r: { score: number; signals: object },
): void {
  db.prepare(
    `UPDATE source_candidates
     SET status = 'probed', probe_score = ?, probe_signals = ?, probed_at = ?
     WHERE domain = ? AND status NOT IN ('promoted', 'rejected')`,
  ).run(r.score, JSON.stringify(r.signals), new Date().toISOString(), domain);
}

export function setCandidateStatus(
  db: DatabaseSync,
  domain: string,
  status: 'candidate' | 'probed' | 'promoted' | 'rejected',
  notes?: string,
): void {
  db.prepare(
    `UPDATE source_candidates SET status = ?, notes = COALESCE(?, notes) WHERE domain = ?`,
  ).run(status, notes ?? null, domain);
}

// --- pipeline runs ---

export function startRun(db: DatabaseSync, sourceKey: string | null): number {
  const res = db
    .prepare(`INSERT INTO pipeline_runs(source_key, started_at) VALUES (?, ?)`)
    .run(sourceKey, new Date().toISOString());
  return Number(res.lastInsertRowid);
}

export function finishRun(db: DatabaseSync, runId: number, stats: object): void {
  db.prepare(`UPDATE pipeline_runs SET finished_at = ?, stats = ? WHERE id = ?`).run(
    new Date().toISOString(),
    JSON.stringify(stats),
    runId,
  );
}

/** Expire events whose last occurrence is in the past. Returns count. */
export function expirePastEvents(db: DatabaseSync, today: string): number {
  const res = db
    .prepare(
      `UPDATE events SET status = 'expired'
       WHERE status = 'active'
         AND id NOT IN (SELECT DISTINCT event_id FROM occurrences WHERE date >= ?)`,
    )
    .run(today);
  return Number(res.changes);
}

export interface VanishedReconciliation {
  prunedRawEvents: number;
  expiredEvents: number;
  /** Events that lost this source but still have others — the caller must
   *  re-derive their occurrences to drop the vanished source's dates. */
  survivingEventIds: number[];
}

/**
 * Reconcile a source that was just fully and successfully crawled: remove its
 * raw_events not seen since `sinceIso` (the source is up but no longer lists
 * them — cancelled/removed) and expire any event left with no sources at all.
 *
 * Trust safety: `extracted_at` is refreshed on every re-crawl (even unchanged
 * payloads), so `< sinceIso` means "the source was crawled this run but did
 * NOT re-list this event". Expiry is reversible — a re-listed event is restored
 * to 'active' on its next canonicalization (canonicalize.ts) — and listings
 * already show only status='active', so a wrongly-expired event self-heals on
 * the next crawl. The CALLER must gate this on a healthy full crawl (no limit,
 * events discovered, no fetch errors) so a source outage never triggers it.
 */
export function reconcileVanishedSourceEvents(
  db: DatabaseSync,
  sourceKey: string,
  sinceIso: string,
): VanishedReconciliation {
  const vanished = db
    .prepare(`SELECT id FROM raw_events WHERE source_key = ? AND extracted_at < ?`)
    .all(sourceKey, sinceIso) as unknown as Array<{ id: number }>;
  if (vanished.length === 0) {
    return { prunedRawEvents: 0, expiredEvents: 0, survivingEventIds: [] };
  }
  const rawIds = vanished.map((r) => r.id);
  const ph = rawIds.map(() => '?').join(',');
  const affected = db
    .prepare(`SELECT DISTINCT event_id FROM event_sources WHERE raw_event_id IN (${ph})`)
    .all(...rawIds) as unknown as Array<{ event_id: number }>;
  const affectedIds = affected.map((r) => r.event_id);
  db.prepare(`DELETE FROM event_sources WHERE raw_event_id IN (${ph})`).run(...rawIds);
  db.prepare(`DELETE FROM raw_events WHERE id IN (${ph})`).run(...rawIds);
  const survivingEventIds: number[] = [];
  let expiredEvents = 0;
  for (const id of affectedIds) {
    const remaining = db
      .prepare(`SELECT COUNT(*) AS c FROM event_sources WHERE event_id = ?`)
      .get(id) as unknown as { c: number };
    if (remaining.c === 0) {
      const res = db
        .prepare(`UPDATE events SET status = 'expired' WHERE id = ? AND status = 'active'`)
        .run(id);
      if (Number(res.changes) > 0) expiredEvents++;
    } else {
      survivingEventIds.push(id);
    }
  }
  return { prunedRawEvents: rawIds.length, expiredEvents, survivingEventIds };
}

// --- permanent venues (OpenStreetMap) ---

export interface VenueRow {
  id: number;
  slug: string;
  osm_type: string;
  osm_id: number;
  title: string;
  category: string;
  street: string | null;
  postcode: string | null;
  city: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
  opening_hours_text: string | null;
  contact_website: string | null;
  contact_phone: string | null;
  description: string | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  search_text: string;
}

export interface VenueValues {
  slug: string;
  osmType: string;
  osmId: number;
  title: string;
  category: string;
  street?: string | null;
  postcode?: string | null;
  city?: string | null;
  municipality?: string | null;
  lat?: number | null;
  lng?: number | null;
  openingHoursText?: string | null;
  contactWebsite?: string | null;
  contactPhone?: string | null;
  description?: string | null;
}

/**
 * Upsert one OSM venue, keyed on (osm_type, osm_id). The slug is set on first
 * insert and never changed on conflict, so a published /sted/<slug> URL stays
 * stable even if the venue is renamed upstream. `last_seen_at` is bumped every
 * run so a follow-up sweep can retire venues that vanished from OSM.
 */
export function upsertVenue(db: DatabaseSync, v: VenueValues): void {
  const searchText = searchFold(
    [v.title, v.city, v.municipality].filter(Boolean).join(' '),
  );
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO venues(slug, osm_type, osm_id, title, category, street, postcode, city,
       municipality, lat, lng, opening_hours_text, contact_website, contact_phone, description,
       status, first_seen_at, last_seen_at, search_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(osm_type, osm_id) DO UPDATE SET
       title=excluded.title, category=excluded.category, street=excluded.street,
       postcode=excluded.postcode, city=excluded.city, municipality=excluded.municipality,
       lat=excluded.lat, lng=excluded.lng, opening_hours_text=excluded.opening_hours_text,
       contact_website=excluded.contact_website, contact_phone=excluded.contact_phone,
       description=excluded.description, status='active',
       last_seen_at=excluded.last_seen_at, search_text=excluded.search_text`,
  ).run(
    v.slug, v.osmType, v.osmId, v.title, v.category, v.street ?? null, v.postcode ?? null,
    v.city ?? null, v.municipality ?? null, v.lat ?? null, v.lng ?? null,
    v.openingHoursText ?? null, v.contactWebsite ?? null, v.contactPhone ?? null,
    v.description ?? null, now, now, searchText,
  );
}

/** (osm_type/osm_id -> slug) for every venue, so an ingest reuses stable slugs
 *  and computes collision-free ones for genuinely new objects. */
export function existingVenueSlugs(db: DatabaseSync): {
  byOsm: Map<string, string>;
  used: Set<string>;
} {
  const rows = db
    .prepare(`SELECT slug, osm_type, osm_id FROM venues`)
    .all() as unknown as Array<{ slug: string; osm_type: string; osm_id: number }>;
  const byOsm = new Map<string, string>();
  const used = new Set<string>();
  for (const r of rows) {
    byOsm.set(`${r.osm_type}/${r.osm_id}`, r.slug);
    used.add(r.slug);
  }
  return { byOsm, used };
}

/** Retire venues not seen since `runStartIso` (a full sweep no longer lists them
 *  — closed/removed). Reversible: a re-listed venue flips back to active.
 *
 *  `osmTypes` scopes the sweep to ONE source (venues are namespaced by osm_type:
 *  'node'/'way'/'relation' = OpenStreetMap, 'kk' = Kirkens Korshær, …). Each
 *  source must retire only its OWN stale venues — an unscoped sweep after the
 *  OSM ingest would wrongly retire every chain venue (last seen in a different
 *  ingest), and vice-versa. Omitting `osmTypes` sweeps all sources (legacy). */
export function markStaleVenuesGone(
  db: DatabaseSync,
  runStartIso: string,
  osmTypes?: readonly string[],
): number {
  if (osmTypes && osmTypes.length === 0) return 0;
  const scope = osmTypes ? ` AND osm_type IN (${osmTypes.map(() => '?').join(',')})` : '';
  const res = db
    .prepare(`UPDATE venues SET status = 'gone' WHERE status = 'active' AND last_seen_at < ?${scope}`)
    .run(runStartIso, ...(osmTypes ?? []));
  return Number(res.changes);
}

/** The consumer app opens the DB read-only (no migration), so a database built
 *  before the venues table existed (schema < 3) has no `venues` table. Degrade
 *  to "no venues" rather than throwing — they appear once a crawl populates a
 *  migrated DB, exactly like the source_candidates.covered_titles guard. */
function venuesTableExists(db: DatabaseSync): boolean {
  const r = db
    .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'venues'`)
    .get() as { c: number };
  return r.c > 0;
}

/** Fill opening hours for venues that currently have NONE, from an operator-
 *  vetted {slug: osmHoursString} map (community "tilføj åbningstider" submissions
 *  in data/venue-hours.json). Only ever FILLS a gap — a source-provided
 *  opening_hours is never overwritten by community data — so it can only improve
 *  "hvad er åbent i dag?" coverage, never corrupt a crawled value. Idempotent;
 *  re-applies each crawl (which resets hours-less OSM rows to null). Returns the
 *  number of venues filled. */
export function applyVenueHours(db: DatabaseSync, hoursBySlug: Record<string, string>): number {
  if (!venuesTableExists(db)) return 0;
  const stmt = db.prepare(
    `UPDATE venues SET opening_hours_text = ?
     WHERE slug = ? AND status = 'active' AND (opening_hours_text IS NULL OR opening_hours_text = '')`,
  );
  let filled = 0;
  for (const [slug, hours] of Object.entries(hoursBySlug)) {
    if (typeof hours !== 'string' || !hours.trim()) continue;
    filled += Number(stmt.run(hours.trim(), slug).changes);
  }
  return filled;
}

export function listVenues(db: DatabaseSync): VenueRow[] {
  if (!venuesTableExists(db)) return [];
  return db
    .prepare(`SELECT * FROM venues WHERE status = 'active' ORDER BY category, title`)
    .all() as unknown as VenueRow[];
}

export function getVenueBySlug(db: DatabaseSync, slug: string): VenueRow | null {
  if (!venuesTableExists(db)) return null;
  return (
    (db.prepare(`SELECT * FROM venues WHERE slug = ?`).get(slug) as VenueRow | undefined) ?? null
  );
}

/** A payload still linked to an event, for re-deriving its occurrences. */
export function anyLinkedPayload(db: DatabaseSync, eventId: number): string | null {
  const row = db
    .prepare(
      `SELECT r.payload FROM event_sources es
       JOIN raw_events r ON r.id = es.raw_event_id
       WHERE es.event_id = ? LIMIT 1`,
    )
    .get(eventId) as unknown as { payload: string } | undefined;
  return row?.payload ?? null;
}
