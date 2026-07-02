/**
 * Canonicalization: turn RawEvents into canonical events with dedup,
 * field-level provenance, occurrence materialization and confidence.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  computeConfidence,
  matchEvents,
  normalizeCategory,
  resolveSchedule,
  slugify,
  type IndoorOutdoor,
  type RawEvent,
} from '@loppefund/core';
import {
  findCandidateEvents,
  insertEvent,
  linkEventSource,
  occurrenceDates,
  replaceOccurrences,
  updateEvent,
  upsertRawEvent,
  type EventRow,
} from '@loppefund/db';
import { geocode } from './geocode.ts';

const HORIZON_DAYS = 180;

export interface CanonicalizeStats {
  created: number;
  merged: number;
  unchanged: number;
  skippedNoDates: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Field-wise merge: new value wins only if the field is empty or the new source is more trusted. */
function mergeField<T>(
  current: T | null,
  incoming: T | undefined,
  field: string,
  incomingSource: string,
  provenance: Record<string, string>,
  incomingTrust: number,
  currentTrust: (field: string) => number,
): T | null {
  if (incoming === undefined || incoming === null || incoming === ('' as unknown as T)) {
    return current;
  }
  if (current === null || current === undefined || incomingTrust >= currentTrust(field)) {
    provenance[field] = incomingSource;
    return incoming;
  }
  return current;
}

export async function canonicalizeRawEvent(
  db: DatabaseSync,
  raw: RawEvent,
  sourceTrust: Record<string, number>,
  stats: CanonicalizeStats,
): Promise<void> {
  const { id: rawId, changed } = upsertRawEvent(db, raw);
  const trust = sourceTrust[raw.sourceKey] ?? 0.5;
  const now = new Date().toISOString();

  // Seasonal override: a title that says jule is a julemarked no matter how
  // the source categorized it — this feeds the julemarked dedup veto, so it
  // must be applied consistently at canonicalization time.
  const rawCategory =
    normalizeCategory(raw.title) === 'julemarked' ? 'julemarked' : raw.category;

  // Resolve concrete occurrences. Events we cannot date are not shown to
  // consumers — a market without a date is a rumor, not an event.
  const occurrences = resolveSchedule(
    {
      dateRanges: raw.dateRanges,
      scheduleText: raw.scheduleText,
      openingHoursText: raw.openingHoursText,
    },
    { from: today(), horizonDays: HORIZON_DAYS },
  );
  if (raw.occurrences) {
    for (const o of raw.occurrences) {
      if (o.date >= today() && !occurrences.some((x) => x.date === o.date)) {
        occurrences.push(o);
      }
    }
    occurrences.sort((a, b) => a.date.localeCompare(b.date));
  }
  if (occurrences.length === 0) {
    stats.skippedNoDates++;
    return;
  }

  // Geocode when the source didn't provide coordinates.
  let lat = raw.lat ?? null;
  let lng = raw.lng ?? null;
  let geocodeQuality: string | null = raw.lat != null ? 'source' : null;
  let postcode = raw.postcode ?? null;
  let city = raw.city ?? null;
  if (lat === null && (raw.street || raw.postcode)) {
    const g = await geocode(db, {
      street: raw.street,
      postcode: raw.postcode,
      city: raw.city,
    });
    lat = g.lat;
    lng = g.lng;
    geocodeQuality = g.quality;
    postcode = postcode ?? g.resolvedPostcode;
    city = city ?? g.resolvedCity;
  }

  // Find the canonical event this raw event belongs to.
  const candidates = findCandidateEvents(db, { postcode, lat, lng, title: raw.title });
  const rawDates = occurrences.map((o) => o.date);
  let best: { event: EventRow; score: number } | null = null;
  for (const candidate of candidates) {
    const result = matchEvents(
      {
        title: raw.title,
        lat,
        lng,
        postcode,
        dates: rawDates,
        category: rawCategory,
        street: raw.street,
      },
      {
        title: candidate.title,
        lat: candidate.lat,
        lng: candidate.lng,
        postcode: candidate.postcode,
        dates: occurrenceDates(db, candidate.id),
        category: candidate.category,
        street: candidate.street,
      },
    );
    if (result.isMatch && (best === null || result.score > best.score)) {
      best = { event: candidate, score: result.score };
    }
  }

  const cancelled = raw.cancelled === true;

  if (best) {
    const e = best.event;
    // Re-linking the same raw event with unchanged payload only bumps freshness.
    linkEventSource(db, e.id, rawId);
    const provenance = JSON.parse(e.field_provenance) as Record<string, string>;
    const currentTrust = (field: string) =>
      sourceTrust[provenance[field] ?? ''] ?? 0;
    const m = <T>(cur: T | null, inc: T | undefined, field: string) =>
      mergeField(cur, inc, field, raw.sourceKey, provenance, trust, currentTrust);

    const sourceCount = (
      db.prepare(
        `SELECT COUNT(DISTINCT r.source_key) c FROM event_sources es
         JOIN raw_events r ON r.id = es.raw_event_id WHERE es.event_id = ?`,
      ).get(e.id) as { c: number }
    ).c;

    const merged = {
      slug: e.slug,
      title: m(e.title, raw.title, 'title') ?? e.title,
      description: m(e.description, raw.description, 'description'),
      category: (m(e.category, rawCategory, 'category') ?? 'andet') as ReturnType<typeof normalizeCategory>,
      venueName: m(e.venue_name, raw.venueName, 'venueName'),
      street: m(e.street, raw.street, 'street'),
      postcode: m(e.postcode, postcode ?? undefined, 'postcode'),
      city: m(e.city, city ?? undefined, 'city'),
      municipality: m(e.municipality, raw.municipality, 'municipality'),
      lat: m(e.lat, lat ?? undefined, 'lat'),
      lng: m(e.lng, lng ?? undefined, 'lng'),
      geocodeQuality: m(e.geocode_quality, geocodeQuality ?? undefined, 'geocodeQuality'),
      organizer: m(e.organizer, raw.organizer, 'organizer'),
      contactWebsite: m(e.contact_website, raw.contactWebsite, 'contactWebsite'),
      contactEmail: m(e.contact_email, raw.contactEmail, 'contactEmail'),
      contactPhone: m(e.contact_phone, raw.contactPhone, 'contactPhone'),
      priceText: m(e.price_text, raw.priceText, 'priceText'),
      isFree: m(e.is_free === null ? null : e.is_free === 1, raw.isFree, 'isFree'),
      stallCountText: m(e.stall_count_text, raw.stallCountText, 'stallCountText'),
      indoorOutdoor: (m(
        e.indoor_outdoor === 'unknown' ? null : e.indoor_outdoor,
        raw.indoorOutdoor === 'unknown' ? undefined : raw.indoorOutdoor,
        'indoorOutdoor',
      ) ?? 'unknown') as IndoorOutdoor,
      scheduleText: m(e.schedule_text, raw.scheduleText, 'scheduleText'),
      openingHoursText: m(e.opening_hours_text, raw.openingHoursText, 'openingHoursText'),
      status: (cancelled ? 'cancelled' : e.status === 'expired' ? 'active' : e.status) as 'active' | 'cancelled' | 'expired',
      confidence: 0,
      fieldProvenance: provenance,
      firstSeenAt: e.first_seen_at,
      lastSeenAt: now,
    };
    merged.confidence = computeConfidence({
      maxSourceTrust: Math.max(trust, ...Object.keys(provenance).map((f) => currentTrust(f))),
      sourceCount,
      daysSinceVerified: 0,
      // Postcode-centroid ("P") locations are approximate — not "good".
      hasGoodLocation: merged.lat !== null && !['C', 'P'].includes(merged.geocodeQuality ?? ''),
      hasConcreteDates: occurrences.length > 0,
    });
    updateEvent(db, e.id, merged);

    // Occurrences: union of existing future dates and this source's dates.
    const existing = db
      .prepare(`SELECT date, start_time, end_time FROM occurrences WHERE event_id = ?`)
      .all(e.id) as unknown as Array<{ date: string; start_time: string | null; end_time: string | null }>;
    const byDate = new Map(
      existing.map((o) => [o.date, { date: o.date, startTime: o.start_time, endTime: o.end_time }]),
    );
    for (const o of occurrences) {
      const prior = byDate.get(o.date);
      // Prefer entries that carry times over ones that don't.
      if (!prior || (prior.startTime === null && o.startTime !== null)) byDate.set(o.date, o);
    }
    replaceOccurrences(db, e.id, [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)));
    if (changed) stats.merged++;
    else stats.unchanged++;
    return;
  }

  // New canonical event.
  const provenance: Record<string, string> = {};
  for (const f of Object.keys(raw)) provenance[f] = raw.sourceKey;
  const baseSlug = slugify(`${raw.title} ${city ?? raw.municipality ?? ''}`);
  let slug = baseSlug;
  for (let i = 2; db.prepare(`SELECT 1 FROM events WHERE slug = ?`).get(slug); i++) {
    slug = `${baseSlug}-${i}`;
  }
  const id = insertEvent(db, {
    slug,
    title: raw.title,
    description: raw.description ?? null,
    category: rawCategory ?? 'andet',
    venueName: raw.venueName ?? null,
    street: raw.street ?? null,
    postcode,
    city,
    municipality: raw.municipality ?? null,
    lat,
    lng,
    geocodeQuality,
    organizer: raw.organizer ?? null,
    contactWebsite: raw.contactWebsite ?? null,
    contactEmail: raw.contactEmail ?? null,
    contactPhone: raw.contactPhone ?? null,
    priceText: raw.priceText ?? null,
    isFree: raw.isFree ?? null,
    stallCountText: raw.stallCountText ?? null,
    indoorOutdoor: raw.indoorOutdoor ?? 'unknown',
    scheduleText: raw.scheduleText ?? null,
    openingHoursText: raw.openingHoursText ?? null,
    status: cancelled ? 'cancelled' : 'active',
    confidence: computeConfidence({
      maxSourceTrust: trust,
      sourceCount: 1,
      daysSinceVerified: 0,
      hasGoodLocation: lat !== null && !['C', 'P'].includes(geocodeQuality ?? ''),
      hasConcreteDates: true,
    }),
    fieldProvenance: provenance,
    firstSeenAt: now,
    lastSeenAt: now,
  });
  replaceOccurrences(db, id, occurrences);
  linkEventSource(db, id, rawId);
  stats.created++;
}
