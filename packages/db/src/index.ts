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

/** Store a raw extraction; returns id and whether the payload changed since last time. */
export function upsertRawEvent(
  db: DatabaseSync,
  raw: RawEvent,
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
    if (existing.content_hash === hash) return { id: existing.id, changed: false };
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
}

type EventValues = Omit<CanonicalEvent, 'id' | 'fieldProvenance' | 'isFree'> & {
  isFree: boolean | null;
  fieldProvenance: Record<string, string>;
};

const EVENT_COLUMNS = `slug, title, description, category, venue_name, street, postcode, city,
  municipality, lat, lng, geocode_quality, organizer, contact_website, contact_email,
  contact_phone, price_text, is_free, stall_count_text, indoor_outdoor, schedule_text,
  opening_hours_text, status, confidence, field_provenance, first_seen_at, last_seen_at,
  search_text`;

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
    searchText,
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
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO event_sources(event_id, raw_event_id, first_linked_at, last_confirmed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(event_id, raw_event_id) DO UPDATE SET last_confirmed_at = excluded.last_confirmed_at`,
  ).run(eventId, rawEventId, now, now);
}

/** All active events with any occurrence in [from, to], with their occurrences in range. */
export interface EventWithOccurrences extends EventRow {
  occurrences: Array<{ date: string; start_time: string | null; end_time: string | null }>;
}

export function listEventsBetween(
  db: DatabaseSync,
  from: string,
  to: string,
): EventWithOccurrences[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT e.* FROM events e
       JOIN occurrences o ON o.event_id = e.id
       WHERE e.status = 'active' AND o.date >= ? AND o.date <= ?`,
    )
    .all(from, to) as unknown as EventRow[];
  const occStmt = db.prepare(
    `SELECT date, start_time, end_time FROM occurrences
     WHERE event_id = ? AND date >= ? AND date <= ? ORDER BY date`,
  );
  return rows.map((e) => ({
    ...e,
    occurrences: occStmt.all(e.id, from, to) as unknown as EventWithOccurrences['occurrences'],
  }));
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
  const sources = db
    .prepare(
      `SELECT r.source_key, r.source_url, s.name, es.last_confirmed_at
       FROM event_sources es
       JOIN raw_events r ON r.id = es.raw_event_id
       JOIN sources s ON s.key = r.source_key
       WHERE es.event_id = ?`,
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
  // Each token must match either as typed or in a Danish ascii-folded form.
  const q = tokens
    .map((t) => {
      const variants = new Set([t, ...searchFold(t).split(' ')]);
      return `(${[...variants].map((v) => `"${v}"*`).join(' OR ')})`;
    })
    .join(' ');
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

// --- pipeline runs ---

export function startRun(db: DatabaseSync, sourceKey: string | null): number {
  const res = db
    .prepare(`INSERT INTO pipeline_runs(source_key, started_at) VALUES (?, ?)`)
    .run(sourceKey, new Date().toISOString());
  return Number(res.lastInsertRowid);
}

export function finishRun(db: DatabaseSync, runId: number, stats: Record<string, number>): void {
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
